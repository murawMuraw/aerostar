// apps/game_1/server.js

require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

// ============================================
//  КОНСТАНТЫ
// ============================================
const PORT = process.env.PORT || 3002;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const MAX_PLAYERS = 7;
const INACTIVITY_TIMEOUT = 48 * 60 * 60 * 1000;
const GROUNDED_TIMEOUT = 5 * 60 * 1000;

// ============================================
//  MIDDLEWARE
// ============================================
app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
    console.log(`📡 ${req.method} ${req.url}`);
    next();
});

// ============================================
//  КЕШИ
// ============================================
const windCache = new Map();
const currentCache = new Map();
const CACHE_TTL = 600000;

// ============================================
//  ХРАНИЛИЩЕ
// ============================================
const players = new Map();

// ============================================
//  СОСТОЯНИЕ КОРАБЛЕЙ (7 штук)
// ============================================
const shipStates = {
    'klip_10': { taken: false, playerId: null },
    'klip_20': { taken: false, playerId: null },
    'klip_30': { taken: false, playerId: null },
    'columb': { taken: false, playerId: null },
    'pirat': { taken: false, playerId: null },
    'ap': { taken: false, playerId: null },
    '19c_m': { taken: false, playerId: null }
};

// ============================================
//  АВТОРИЗАЦИЯ
// ============================================

// Простая БД в памяти (для демонстрации)
const users = new Map(); // username -> { id, username, email, passwordHash }
const sessions = new Map(); // sessionId -> userId

// Хэширование (в реальном проекте используйте bcrypt)
function hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
        const char = password.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return `hash_${hash}_${password.length}`;
}

// Регистрация
app.post('/api/register', (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ success: false, message: 'Все поля обязательны' });
    }
    
    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ success: false, message: 'Имя от 3 до 20 символов' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Пароль минимум 6 символов' });
    }
    
    if (users.has(username)) {
        return res.status(400).json({ success: false, message: 'Пользователь уже существует' });
    }
    
    const id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    users.set(username, {
        id,
        username,
        email,
        passwordHash: hashPassword(password),
        createdAt: Date.now()
    });
    
    console.log(`✅ User registered: ${username}`);
    res.json({ success: true, message: 'Регистрация успешна' });
});

// Вход
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    const user = users.get(username);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Неверное имя или пароль' });
    }
    
    if (user.passwordHash !== hashPassword(password)) {
        return res.status(401).json({ success: false, message: 'Неверное имя или пароль' });
    }
    
    // Создаём сессию
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessions.set(sessionId, user.id);
    
    console.log(`🔓 User logged in: ${username}`);
    res.json({ 
        success: true, 
        user: { id: user.id, username: user.username, email: user.email },
        sessionId
    });
});

// Проверка сессии
app.get('/api/session', (req, res) => {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId || !sessions.has(sessionId)) {
        return res.json({ user: null });
    }
    
    const userId = sessions.get(sessionId);
    let foundUser = null;
    for (const [_, user] of users) {
        if (user.id === userId) {
            foundUser = { id: user.id, username: user.username, email: user.email };
            break;
        }
    }
    
    res.json({ user: foundUser });
});

// Выход
app.post('/api/logout', (req, res) => {
    const sessionId = req.headers['x-session-id'];
    if (sessionId) {
        sessions.delete(sessionId);
        console.log(`🚪 User logged out`);
    }
    res.json({ success: true });
});

// ============================================
//  ВЫБОР КОРАБЛЯ (для зарегистрированных)
// ============================================
app.post('/api/select_ship', (req, res) => {
    const { shipId } = req.body;
    const sessionId = req.headers['x-session-id'];
    
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ success: false, message: 'Требуется авторизация' });
    }
    
    const userId = sessions.get(sessionId);
    
    // Проверяем, свободен ли корабль
    if (shipStates[shipId] && shipStates[shipId].taken) {
        // Проверяем, не принадлежит ли он этому пользователю
        if (shipStates[shipId].playerId !== userId) {
            return res.status(400).json({ success: false, message: 'Этот корабль уже занят' });
        }
    }
    
    // Сохраняем выбор
    shipStates[shipId].taken = true;
    shipStates[shipId].playerId = userId;
    
    console.log(`⛵ User ${userId} selected ship: ${shipId}`);
    res.json({ success: true, message: 'Корабль выбран' });
});

// ============================================
//  МОДЕЛЬ ТЕЧЕНИЙ (упрощённая)
// ============================================
class OceanCurrentModel {
    getCurrent(lat, lng) {
        const speed = 0.3 + Math.sin(lat * 0.1) * 0.2 + Math.cos(lng * 0.08) * 0.2;
        const direction = (Math.atan2(Math.sin(lat * 0.3), Math.cos(lng * 0.2)) * 180 / Math.PI + 180) % 360;
        const rad = direction * Math.PI / 180;
        return {
            speed: Math.max(0, speed),
            direction: direction,
            u: speed * Math.cos(rad),
            v: speed * Math.sin(rad)
        };
    }
}

const oceanCurrents = new OceanCurrentModel();

// ============================================
//  ФУНКЦИИ ДЛЯ ВЕТРА И ТЕЧЕНИЙ
// ============================================
async function fetchWindData(lat, lng) {
    if (!OPENWEATHER_API_KEY) {
        return { speed: 5 + Math.random() * 10, direction: Math.floor(Math.random() * 360), gust: 0 };
    }
    
    const key = `${parseFloat(lat).toFixed(2)},${parseFloat(lng).toFixed(2)}`;
    if (windCache.has(key)) {
        const cached = windCache.get(key);
        if (Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
    }
    
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=metric`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.wind) {
            const result = {
                speed: data.wind.speed * 1.94384,
                direction: data.wind.deg || 0,
                gust: data.wind.gust ? data.wind.gust * 1.94384 : 0
            };
            windCache.set(key, { data: result, timestamp: Date.now() });
            return result;
        }
    } catch (error) {
        console.error('OpenWeatherMap error:', error);
    }
    return { speed: 5 + Math.random() * 10, direction: Math.floor(Math.random() * 360), gust: 0 };
}

async function fetchCurrentData(lat, lng) {
    const key = `${parseFloat(lat).toFixed(2)},${parseFloat(lng).toFixed(2)}`;
    if (currentCache.has(key)) {
        const cached = currentCache.get(key);
        if (Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
    }
    const current = oceanCurrents.getCurrent(lat, lng);
    const result = { speed: current.speed, direction: current.direction, u: current.u, v: current.v };
    currentCache.set(key, { data: result, timestamp: Date.now() });
    return result;
}

// ============================================
//  API
// ============================================
app.get('/api/players', (req, res) => {
    const playerList = [];
    for (const [id, ship] of players) {
        playerList.push({
            id: id,
            name: ship.name,
            isOnline: ship.isOnline,
            isEliminated: ship.isEliminated || false,
            isGrounded: ship.isGrounded,
            shipType: ship.shipType,
            lat: ship.lat,
            lng: ship.lng
        });
    }
    res.json({
        players: playerList,
        maxPlayers: MAX_PLAYERS,
        current: playerList.filter(p => !p.isEliminated).length
    });
});

app.get('/api/ships/state', (req, res) => {
    res.json(shipStates);
});

app.get('/api/wind', async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'Missing lat/lng' });
    const data = await fetchWindData(parseFloat(lat), parseFloat(lng));
    res.json(data);
});

app.get('/api/current', async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'Missing lat/lng' });
    const data = await fetchCurrentData(parseFloat(lat), parseFloat(lng));
    res.json(data);
});

app.get('/api/currents/grid', (req, res) => {
    const { latMin, latMax, lngMin, lngMax, step } = req.query;
    const grid = [];
    const stepVal = parseFloat(step || 10);
    for (let lat = parseFloat(latMin || -60); lat <= parseFloat(latMax || 60); lat += stepVal) {
        for (let lng = parseFloat(lngMin || -180); lng <= parseFloat(lngMax || 180); lng += stepVal) {
            const current = oceanCurrents.getCurrent(lat, lng);
            grid.push({ lat, lng, speed: current.speed, direction: current.direction, u: current.u, v: current.v });
        }
    }
    res.json(grid);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/selection.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'selection.html'));
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

// ============================================
//  КЛАСС КОРАБЛЯ
// ============================================
class Ship {
    constructor(id, name, lat, lng, shipType) {
        this.id = id;
        this.name = name;
        this.shipType = shipType;
        this.lat = lat;
        this.lng = lng;
        this.heading = 0;
        this.sailPosition = 0.5;
        this.targetSailPosition = 0.5;
        this.isAnchored = false;
        this.isGrounded = false;
        this.isEliminated = false;
        this.speed = 0;
        this.isOnline = true;
        this.lastSeen = Date.now();
        this.distanceTraveled = 0;
        this.groundTime = null;
        this.color = `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`;
    }

    update(wind, current, deltaTime) {
        if (this.isEliminated) return;
        if (this.isAnchored) { this.speed = 0; return; }

        if (this.isGrounded) {
            this.speed = 0;
            if (!this.groundTime) this.groundTime = Date.now();
            if (Date.now() - this.groundTime > GROUNDED_TIMEOUT) {
                this.eliminate('Сел на мель');
            }
            return;
        }
        this.groundTime = null;

        const sailDiff = this.targetSailPosition - this.sailPosition;
        this.sailPosition += sailDiff * deltaTime * 0.5;
        this.sailPosition = Math.max(0, Math.min(1, this.sailPosition));

        const windSpeed = wind.speed || 5;
        const windDirection = wind.direction || 0;
        const angleToWind = this.heading - windDirection;
        const windEffect = Math.cos(angleToWind * Math.PI / 180);
        const sailEfficiency = Math.max(0.1, (windEffect + 1) / 2);
        const maxSpeed = this.sailPosition * 10 * sailEfficiency;
        
        this.speed += (maxSpeed - this.speed) * deltaTime * 0.3;
        this.speed = Math.max(0, Math.min(10, this.speed));

        let latDelta = 0, lngDelta = 0;
        
        if (this.speed > 0.05) {
            const latPerSecond = (this.speed * 0.514) / 111320;
            const lngPerSecond = latPerSecond / Math.cos(this.lat * Math.PI / 180);
            latDelta += latPerSecond * Math.cos(this.heading * Math.PI / 180);
            lngDelta += lngPerSecond * Math.sin(this.heading * Math.PI / 180);
        }

        if (current && current.speed > 0.05) {
            const currentSpeedMs = current.speed * 0.514;
            const latPerSecond = currentSpeedMs / 111320;
            const lngPerSecond = latPerSecond / Math.cos(this.lat * Math.PI / 180);
            const currentRad = current.direction * Math.PI / 180;
            latDelta += latPerSecond * Math.cos(currentRad);
            lngDelta += lngPerSecond * Math.sin(currentRad);
        }

        const newLat = this.lat + latDelta * deltaTime;
        const newLng = this.lng + lngDelta * deltaTime;

        if (!isOnLand(newLat, newLng)) {
            this.lat = newLat;
            this.lng = newLng;
            this.distanceTraveled += Math.sqrt(latDelta*latDelta + lngDelta*lngDelta) * 111320;
        } else {
            if (!this.isGrounded) {
                this.isGrounded = true;
                this.groundTime = Date.now();
                this.speed = 0;
                io.emit('ship_grounded', { playerId: this.id, name: this.name, lat: this.lat, lng: this.lng });
            }
        }

        this.lastSeen = Date.now();
    }

    eliminate(reason) {
        if (this.isEliminated) return;
        this.isEliminated = true;
        this.isOnline = false;
        this.speed = 0;
        io.emit('ship_eliminated', { playerId: this.id, name: this.name, reason: reason });
        for (const [id, state] of Object.entries(shipStates)) {
            if (state.playerId === this.id) {
                state.taken = false;
                state.playerId = null;
                break;
            }
        }
        broadcastState();
    }

    turn(delta) {
        if (this.isEliminated) return { success: false, message: 'Выбыл' };
        if (this.isAnchored) return { success: false, message: 'На якоре' };
        if (this.isGrounded) return { success: false, message: 'На мели' };
        this.heading = (this.heading + delta) % 360;
        if (this.heading < 0) this.heading += 360;
        return { success: true };
    }

    setSail(pos) {
        if (this.isEliminated) return { success: false, message: 'Выбыл' };
        if (this.isAnchored) return { success: false, message: 'На якоре' };
        if (this.isGrounded) return { success: false, message: 'На мели' };
        this.targetSailPosition = Math.max(0, Math.min(1, pos));
        return { success: true };
    }

    raiseSail() { return this.setSail(1); }
    lowerSail() { return this.setSail(0); }

    dropAnchor() {
        if (this.isEliminated) return { success: false, message: 'Выбыл' };
        if (this.isGrounded) return { success: false, message: 'На мели' };
        this.isAnchored = true;
        this.speed = 0;
        return { success: true };
    }

    weighAnchor() {
        if (this.isEliminated) return { success: false, message: 'Выбыл' };
        if (this.isGrounded) return { success: false, message: 'На мели' };
        this.isAnchored = false;
        return { success: true };
    }

    getState() {
        return {
            id: this.id,
            name: this.name,
            shipType: this.shipType,
            lat: this.lat,
            lng: this.lng,
            heading: this.heading,
            speed: this.speed,
            sailPosition: this.sailPosition,
            isAnchored: this.isAnchored,
            isGrounded: this.isGrounded,
            isEliminated: this.isEliminated,
            isOnline: this.isOnline,
            distanceTraveled: this.distanceTraveled,
            color: this.color
        };
    }
}

// ============================================
//  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================
function isOnLand(lat, lng) {
    const landMasses = [
        { latMin: 36, latMax: 70, lngMin: -10, lngMax: 40 },
        { latMin: -35, latMax: 37, lngMin: -20, lngMax: 50 },
        { latMin: 25, latMax: 70, lngMin: -130, lngMax: -60 },
        { latMin: -55, latMax: 12, lngMin: -80, lngMax: -35 },
        { latMin: 10, latMax: 75, lngMin: 40, lngMax: 150 },
        { latMin: -40, latMax: -10, lngMin: 113, lngMax: 155 },
    ];
    for (const region of landMasses) {
        if (lat >= region.latMin && lat <= region.latMax &&
            lng >= region.lngMin && lng <= region.lngMax) {
            return true;
        }
    }
    return false;
}

function getAllPlayersState() {
    const result = {};
    for (const [id, ship] of players) {
        result[id] = ship.getState();
    }
    return result;
}

function broadcastState() {
    io.emit('state', { players: getAllPlayersState(), timestamp: Date.now() });
}

// ============================================
//  ОЧИСТКА НЕАКТИВНЫХ
// ============================================
setInterval(() => {
    const now = Date.now();
    const toRemove = [];
    for (const [id, ship] of players) {
        if (ship.isEliminated) { toRemove.push(id); continue; }
        if (!ship.isOnline && (now - ship.lastSeen) > INACTIVITY_TIMEOUT) {
            ship.eliminate('Неактивен');
            toRemove.push(id);
        }
    }
    for (const id of toRemove) {
        const ship = players.get(id);
        if (ship) {
            for (const [shipId, state] of Object.entries(shipStates)) {
                if (state.playerId === id) { state.taken = false; state.playerId = null; break; }
            }
            players.delete(id);
            console.log(`🧹 Removed: ${ship.name}`);
            io.emit('player_removed', { playerId: id, name: ship.name });
        }
    }
    if (toRemove.length > 0) broadcastState();
}, 30000);

// ============================================
//  ИГРОВОЙ ЦИКЛ
// ============================================
setInterval(async () => {
    const deltaTime = 1 / 30;
    for (const [id, ship] of players) {
        if (ship.isEliminated || ship.shipType === 'guest') continue;
        try {
            const wind = await fetchWindData(ship.lat, ship.lng);
            const current = await fetchCurrentData(ship.lat, ship.lng);
            ship.update(wind, current, deltaTime);
        } catch (error) {
            console.error(`Error updating ${id}:`, error);
        }
    }
    broadcastState();
}, 1000 / 30);

// ============================================
//  SOCKET.IO
// ============================================
io.on('connection', (socket) => {
    console.log('🔗 New connection:', socket.id);

    // ==========================================
    //  ВХОД КАК ГОСТЬ
    // ==========================================
    socket.on('join_as_guest', (data) => {
        const { lat, lng } = data;
        
        const guest = new Ship(socket.id, 'Гость', lat, lng, 'guest');
        guest.isOnline = true;
        players.set(socket.id, guest);
        
        socket.emit('joined', {
            role: 'guest',
            ship: guest.getState(),
            players: getAllPlayersState()
        });
        
        console.log(`👁 Guest joined at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        broadcastState();
    });

    // ==========================================
    //  ВХОД С КОРАБЛЁМ
    // ==========================================
    socket.on('join_with_ship', (data) => {
        const { shipId, shipName, lat, lng } = data;

        // Проверяем, свободен ли корабль
        if (shipStates[shipId] && shipStates[shipId].taken) {
            socket.emit('join_error', { message: 'Этот корабль уже занят' });
            return;
        }

        // Проверяем лимит игроков
        const activePlayers = Array.from(players.values()).filter(p => p.isOnline && !p.isEliminated && p.shipType !== 'guest');
        if (activePlayers.length >= MAX_PLAYERS) {
            socket.emit('join_error', { message: `Максимум ${MAX_PLAYERS} игроков` });
            return;
        }

        // Проверяем, что точка в океане
        if (isOnLand(lat, lng)) {
            socket.emit('join_error', { message: 'Нельзя стартовать на суше!' });
            return;
        }

        // Создаём игрока
        const player = new Ship(socket.id, shipName, lat, lng, shipId);
        players.set(socket.id, player);

        shipStates[shipId].taken = true;
        shipStates[shipId].playerId = socket.id;

        socket.emit('joined', {
            role: 'player',
            ship: player.getState(),
            players: getAllPlayersState()
        });

        io.emit('player_joined', { playerId: socket.id, name: player.name, shipId: shipId });
        broadcastState();
        console.log(`⛵ ${shipName} joined at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    });

    // ==========================================
    //  УПРАВЛЕНИЕ
    // ==========================================
    socket.on('turn', (data) => {
        const ship = players.get(socket.id);
        if (ship && ship.isOnline && !ship.isEliminated && ship.shipType !== 'guest') {
            const result = ship.turn(data.delta || 0);
            socket.emit('action_result', { action: 'turn', success: result.success, ...result });
            if (result.success) broadcastState();
        }
    });

    socket.on('sail', (data) => {
        const ship = players.get(socket.id);
        if (ship && ship.isOnline && !ship.isEliminated && ship.shipType !== 'guest') {
            let result;
            if (data.action === 'raise') result = ship.raiseSail();
            else if (data.action === 'lower') result = ship.lowerSail();
            else result = ship.setSail(data.position || 0.5);
            socket.emit('action_result', { action: 'sail', success: result.success, ...result });
            if (result.success) broadcastState();
        }
    });

    socket.on('anchor', (data) => {
        const ship = players.get(socket.id);
        if (ship && ship.isOnline && !ship.isEliminated && ship.shipType !== 'guest') {
            const result = data.action === 'drop' ? ship.dropAnchor() : ship.weighAnchor();
            socket.emit('action_result', { action: 'anchor', success: result.success, ...result });
            if (result.success) broadcastState();
        }
    });

    // ==========================================
    //  ЧАТ
    // ==========================================
    socket.on('chat', (data) => {
        const ship = players.get(socket.id);
        const name = ship ? ship.name : 'Unknown';
        io.emit('chat', { playerId: socket.id, name: name, message: data.message });
    });

    // ==========================================
    //  ОТКЛЮЧЕНИЕ
    // ==========================================
    socket.on('disconnect', () => {
        const ship = players.get(socket.id);
        if (ship) {
            ship.isOnline = false;
            ship.lastSeen = Date.now();
            console.log(`💤 ${ship.name} went offline`);
            io.emit('player_left', { playerId: socket.id, name: ship.name, isOffline: true });
            broadcastState();
        }
    });
});

// ============================================
//  ЗАПУСК
// ============================================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Regatta server running at http://0.0.0.0:${PORT}`);
    console.log(`👥 Max players: ${MAX_PLAYERS}`);
    console.log(`🌊 Wind + currents enabled\n`);
    console.log(`📋 API endpoints:`);
    console.log(`  - POST /api/register`);
    console.log(`  - POST /api/login`);
    console.log(`  - GET  /api/session`);
    console.log(`  - POST /api/logout`);
    console.log(`  - POST /api/select_ship`);
    console.log(`  - GET  /api/ships/state`);
    console.log(`  - GET  /api/players\n`);
});
