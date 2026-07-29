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
//  CONSTANTS
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
//  CACHE
// ============================================
const windCache = new Map();
const currentCache = new Map();
const CACHE_TTL = 600000;

// ============================================
//  STORAGE
// ============================================
const players = new Map(); // userId -> Ship
const socketToUser = new Map(); // socketId -> userId
const pendingSelections = new Map();

// ============================================
//  SHIP STATES (7 ships)
// ============================================
let shipStates = {};

function initShipStates() {
    shipStates = {
        'klip_10': { taken: false, userId: null },
        'klip_20': { taken: false, userId: null },
        'klip_30': { taken: false, userId: null },
        'columb': { taken: false, userId: null },
        'pirat': { taken: false, userId: null },
        'ap': { taken: false, userId: null },
        '19c_m': { taken: false, userId: null }
    };
}

initShipStates();

// ============================================
//  AUTHENTICATION
// ============================================

const users = new Map();
const sessions = new Map();

function hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
        const char = password.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return `hash_${hash}_${password.length}`;
}

app.post('/api/register', (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ success: false, message: 'Username must be 3-20 characters' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    
    if (users.has(username)) {
        return res.status(400).json({ success: false, message: 'User already exists' });
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
    res.json({ success: true, message: 'Registration successful' });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    const user = users.get(username);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
    
    if (user.passwordHash !== hashPassword(password)) {
        return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
    
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessions.set(sessionId, user.id);
    
    console.log(`🔓 User logged in: ${username}`);
    res.json({ 
        success: true, 
        user: { id: user.id, username: user.username, email: user.email },
        sessionId
    });
});

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

app.post('/api/logout', (req, res) => {
    const sessionId = req.headers['x-session-id'];
    if (sessionId) {
        sessions.delete(sessionId);
        console.log(`🚪 User logged out`);
    }
    res.json({ success: true });
});

// ============================================
//  SELECT SHIP
// ============================================
app.post('/api/select_ship', (req, res) => {
    const { shipId } = req.body;
    const sessionId = req.headers['x-session-id'];
    
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ 
            success: false, 
            message: 'Authentication required'
        });
    }
    
    const userId = sessions.get(sessionId);
    
    if (!shipStates[shipId]) {
        return res.status(400).json({ 
            success: false, 
            message: 'Invalid ship ID'
        });
    }
    
    // Проверяем, свободен ли корабль (по userId, а не по socket.id!)
    if (shipStates[shipId].taken && shipStates[shipId].userId !== userId) {
        return res.status(400).json({ 
            success: false, 
            message: 'This ship is already taken'
        });
    }
    
    // Освобождаем все корабли этого пользователя
    for (const [id, state] of Object.entries(shipStates)) {
        if (state.userId === userId) {
            state.taken = false;
            state.userId = null;
        }
    }
    
    // Занимаем выбранный корабль
    shipStates[shipId].taken = true;
    shipStates[shipId].userId = userId;
    
    const shipName = req.body.shipName || shipId;
    pendingSelections.set(sessionId, {
        shipId: shipId,
        shipName: shipName,
        userId: userId,
        timestamp: Date.now()
    });
    
    console.log(`⛵ User ${userId} selected ship: ${shipId} (${shipName})`);
    
    res.json({ 
        success: true, 
        message: 'Ship selected successfully',
        data: {
            shipId: shipId,
            shipName: shipName,
            userId: userId
        }
    });
});

app.get('/api/selected_ship', (req, res) => {
    const sessionId = req.headers['x-session-id'];
    console.log(`🔍 Checking selected ship for session: ${sessionId ? sessionId.substring(0, 20) + '...' : 'none'}`);
    
    if (!sessionId || !sessions.has(sessionId)) {
        console.log('❌ Invalid or missing session');
        return res.status(401).json({ success: false, message: 'Invalid session' });
    }
    
    const userId = sessions.get(sessionId);
    console.log(`👤 User ID: ${userId}`);
    
    // Ищем корабль пользователя
    for (const [shipId, state] of Object.entries(shipStates)) {
        if (state.userId === userId && state.taken) {
            console.log(`✅ Found ship: ${shipId} for user ${userId}`);
            return res.json({
                success: true,
                data: { 
                    shipId: shipId,
                    shipName: shipId
                }
            });
        }
    }
    
    // Проверяем в players
    if (players.has(userId)) {
        const ship = players.get(userId);
        console.log(`✅ Found ship in players: ${ship.shipType} for user ${userId}`);
        return res.json({
            success: true,
            data: { 
                shipId: ship.shipType,
                shipName: ship.name
            }
        });
    }
    
    console.log(`❌ No ship found for user ${userId}`);
    res.json({ success: false });
});

app.post('/api/clear_ship_selection', (req, res) => {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ success: false });
    }
    
    const userId = sessions.get(sessionId);
    
    for (const [id, state] of Object.entries(shipStates)) {
        if (state.userId === userId) {
            state.taken = false;
            state.userId = null;
        }
    }
    
    if (players.has(userId)) {
        players.delete(userId);
    }
    
    console.log(`🧹 Cleared ship selection for user ${userId}`);
    res.json({ success: true });
});

// ============================================
//  OCEAN CURRENT MODEL
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
//  WIND AND CURRENT FUNCTIONS
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
//  API ENDPOINTS
// ============================================
app.get('/api/players', (req, res) => {
    const playerList = [];
    for (const [userId, ship] of players) {
        playerList.push({
            userId: userId,
            name: ship.name,
            isOnline: ship.isOnline,
            isEliminated: ship.isEliminated || false,
            isGrounded: ship.isGrounded,
            isFinished: ship.isFinished || false,
            shipType: ship.shipType,
            lat: ship.lat,
            lng: ship.lng,
            heading: ship.heading,
            speed: ship.speed
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/selection.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'selection.html'));
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

// ============================================
//  SHIP CLASS
// ============================================
class Ship {
    constructor(userId, name, lat, lng, shipType) {
        this.userId = userId;
        this.name = name || shipType || 'Ship';
        this.shipType = shipType;
        this.lat = lat;
        this.lng = lng;
        this.heading = 0;
        this.sailPosition = 0.5;
        this.targetSailPosition = 0.5;
        this.isAnchored = false;
        this.isGrounded = false;
        this.isEliminated = false;
        this.isFinished = false;
        this.speed = 0;
        this.isOnline = true;
        this.lastSeen = Date.now();
        this.distanceTraveled = 0;
        this.groundTime = null;
        this.color = `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`;
        this.finishPoint = null;
        this.startPoint = { lat, lng };
        this.socketId = null;
    }

    update(wind, current, deltaTime) {
        if (this.isEliminated || this.isFinished) return;
        
        if (this.isAnchored) { 
            this.speed = 0; 
            return; 
        }

        if (this.isGrounded) {
            this.speed = 0;
            if (!this.groundTime) this.groundTime = Date.now();
            if (Date.now() - this.groundTime > GROUNDED_TIMEOUT) {
                this.eliminate('Grounded');
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
        const maxSpeed = this.sailPosition * 12 * sailEfficiency;
        
        this.speed += (maxSpeed - this.speed) * deltaTime * 0.3;
        this.speed = Math.max(0, Math.min(12, this.speed));

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

        if (isOnLand(newLat, newLng)) {
            if (!this.isGrounded) {
                this.isGrounded = true;
                this.groundTime = Date.now();
                this.speed = 0;
                io.emit('ship_grounded', { userId: this.userId, name: this.name, lat: this.lat, lng: this.lng });
            }
            return;
        }

        this.lat = newLat;
        this.lng = newLng;
        this.distanceTraveled += Math.sqrt(latDelta*latDelta + lngDelta*lngDelta) * 111320;

        if (this.finishPoint) {
            const distance = this.getDistanceTo(this.finishPoint.lat, this.finishPoint.lng);
            if (distance < 0.5) {
                this.finish();
            }
        }

        this.lastSeen = Date.now();
    }

    getDistanceTo(lat, lng) {
        const R = 6371;
        const dLat = (lat - this.lat) * Math.PI / 180;
        const dLng = (lng - this.lng) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(this.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    finish() {
        if (this.isFinished) return;
        this.isFinished = true;
        this.speed = 0;
        io.emit('ship_finished', { userId: this.userId, name: this.name });
        console.log(`🏁 ${this.name} finished the race!`);
    }

    eliminate(reason) {
        if (this.isEliminated) return;
        this.isEliminated = true;
        this.isOnline = false;
        this.speed = 0;
        io.emit('ship_eliminated', { userId: this.userId, name: this.name, reason: reason });
        for (const [id, state] of Object.entries(shipStates)) {
            if (state.userId === this.userId) {
                state.taken = false;
                state.userId = null;
                break;
            }
        }
        broadcastState();
    }

    turn(delta) {
        if (this.isEliminated) return { success: false, message: 'Eliminated' };
        if (this.isFinished) return { success: false, message: 'Finished' };
        if (this.isAnchored) return { success: false, message: 'Anchored' };
        if (this.isGrounded) return { success: false, message: 'Grounded' };
        this.heading = (this.heading + delta) % 360;
        if (this.heading < 0) this.heading += 360;
        return { success: true, heading: this.heading };
    }

    setSail(pos) {
        if (this.isEliminated) return { success: false, message: 'Eliminated' };
        if (this.isFinished) return { success: false, message: 'Finished' };
        if (this.isAnchored) return { success: false, message: 'Anchored' };
        if (this.isGrounded) return { success: false, message: 'Grounded' };
        const roundedPos = Math.round(pos * 10) / 10;
        this.targetSailPosition = Math.max(0, Math.min(1, roundedPos));
        return { success: true, sailPosition: this.targetSailPosition };
    }

    raiseSail() { return this.setSail(Math.min(1, this.targetSailPosition + 0.1)); }
    lowerSail() { return this.setSail(Math.max(0, this.targetSailPosition - 0.1)); }

    dropAnchor() {
        if (this.isEliminated) return { success: false, message: 'Eliminated' };
        if (this.isFinished) return { success: false, message: 'Finished' };
        if (this.isGrounded) return { success: false, message: 'Grounded' };
        this.isAnchored = true;
        this.speed = 0;
        io.emit('ship_anchored', { userId: this.userId, name: this.name });
        return { success: true };
    }

    weighAnchor() {
        if (this.isEliminated) return { success: false, message: 'Eliminated' };
        if (this.isFinished) return { success: false, message: 'Finished' };
        if (this.isGrounded) return { success: false, message: 'Grounded' };
        this.isAnchored = false;
        return { success: true };
    }

    setFinishPoint(lat, lng) {
        if (isOnLand(lat, lng)) {
            return { success: false, message: 'Finish point cannot be on land' };
        }
        this.finishPoint = { lat, lng };
        return { success: true };
    }

    setSocketId(socketId) {
        this.socketId = socketId;
        this.isOnline = true;
        this.lastSeen = Date.now();
    }

    getState() {
        return {
            userId: this.userId,
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
            isFinished: this.isFinished,
            isOnline: this.isOnline,
            distanceTraveled: this.distanceTraveled,
            color: this.color,
            finishPoint: this.finishPoint
        };
    }
}

// ============================================
//  HELPER FUNCTIONS
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
    for (const [userId, ship] of players) {
        result[userId] = ship.getState();
    }
    return result;
}

function broadcastState() {
    io.emit('state', { players: getAllPlayersState(), timestamp: Date.now() });
}

function getUserIdBySocket(socketId) {
    return socketToUser.get(socketId) || null;
}

// ============================================
//  CLEANUP INACTIVE PLAYERS
// ============================================
setInterval(() => {
    const now = Date.now();
    for (const [userId, ship] of players) {
        if (ship.isEliminated || ship.isFinished) {
            continue;
        }
        if (!ship.isOnline && (now - ship.lastSeen) > INACTIVITY_TIMEOUT) {
            console.log(`⏳ ${ship.name} is sailing without captain`);
        }
    }
}, 30000);

// ============================================
//  GAME LOOP
// ============================================
setInterval(async () => {
    const deltaTime = 1 / 30;
    const windData = {};
    const currentData = {};
    
    for (const [userId, ship] of players) {
        if (ship.isEliminated || ship.isFinished) continue;
        try {
            const wind = await fetchWindData(ship.lat, ship.lng);
            const current = await fetchCurrentData(ship.lat, ship.lng);
            ship.update(wind, current, deltaTime);
            
            windData[userId] = wind;
            currentData[userId] = current;
        } catch (error) {
            console.error(`Error updating ${userId}:`, error);
        }
    }
    
    const state = { 
        players: getAllPlayersState(), 
        timestamp: Date.now(),
        wind: windData,
        current: currentData
    };
    io.emit('state', state);
}, 1000 / 30);

// ============================================
//  SOCKET.IO
// ============================================
io.on('connection', (socket) => {
    console.log('🔗 New connection:', socket.id);

    // ==========================================
    //  AUTH - привязываем сокет к пользователю
    // ==========================================
    socket.on('auth', (data) => {
        const { sessionId } = data;
        if (!sessionId || !sessions.has(sessionId)) {
            socket.emit('auth_error', { message: 'Invalid session' });
            return;
        }
        
        const userId = sessions.get(sessionId);
        socketToUser.set(socket.id, userId);
        console.log(`🔑 Socket ${socket.id} bound to user ${userId}`);
        
        // Проверяем, есть ли у пользователя корабль
        if (players.has(userId)) {
            const ship = players.get(userId);
            ship.setSocketId(socket.id);
            console.log(`🔄 Ship ${ship.name} reconnected for user ${userId}`);
            
            socket.emit('joined', {
                role: 'player',
                ship: ship.getState(),
                players: getAllPlayersState()
            });
            
            io.emit('player_joined', { 
                userId: userId, 
                name: ship.name, 
                shipId: ship.shipType 
            });
            
            broadcastState();
        } else {
            socket.emit('auth_success', { userId });
        }
    });

    // ==========================================
    //  JOIN AS GUEST
    // ==========================================
    socket.on('join_as_guest', (data) => {
        const { lat, lng } = data;
        const userId = `guest_${socket.id}`;
        
        const guest = new Ship(userId, 'Guest', lat, lng, 'guest');
        guest.setSocketId(socket.id);
        socketToUser.set(socket.id, userId);
        players.set(userId, guest);
        
        socket.emit('joined', {
            role: 'guest',
            ship: guest.getState(),
            players: getAllPlayersState()
        });
        
        console.log(`👁 Guest joined at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        broadcastState();
    });

    // ==========================================
    //  JOIN WITH SHIP
    // ==========================================
    socket.on('join_with_ship', (data) => {
        const { shipId, shipName, lat, lng } = data;
        const userId = getUserIdBySocket(socket.id);
        
        console.log(`📥 Join with ship: ${shipId}, ${shipName} for user ${userId}`);
        
        if (!userId) {
            socket.emit('join_error', { message: 'User not authenticated' });
            return;
        }

        // Проверяем, свободен ли корабль (по userId!)
        if (shipStates[shipId] && shipStates[shipId].taken && shipStates[shipId].userId !== userId) {
            socket.emit('join_error', { message: 'This ship is already taken' });
            return;
        }

        if (isOnLand(lat, lng)) {
            socket.emit('join_error', { message: 'Cannot start on land! Choose a point in the ocean' });
            return;
        }

        // Если у пользователя уже есть корабль - обновляем его
        if (players.has(userId)) {
            const existingShip = players.get(userId);
            existingShip.lat = lat;
            existingShip.lng = lng;
            existingShip.setSocketId(socket.id);
            existingShip.isOnline = true;
            
            socket.emit('joined', {
                role: 'player',
                ship: existingShip.getState(),
                players: getAllPlayersState()
            });
            
            io.emit('player_joined', { 
                userId: userId, 
                name: existingShip.name, 
                shipId: shipId 
            });
            
            broadcastState();
            console.log(`⛵ ${existingShip.name} updated position for user ${userId}`);
            return;
        }

        // Создаем новый корабль
        const player = new Ship(userId, shipName || shipId, lat, lng, shipId);
        player.setSocketId(socket.id);
        players.set(userId, player);

        shipStates[shipId].taken = true;
        shipStates[shipId].userId = userId;

        socket.emit('joined', {
            role: 'player',
            ship: player.getState(),
            players: getAllPlayersState()
        });

        io.emit('player_joined', { 
            userId: userId, 
            name: player.name, 
            shipId: shipId 
        });
        
        broadcastState();
        console.log(`⛵ ${player.name} joined at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    });

    // ==========================================
    //  RECONNECT SHIP - ПО userId
    // ==========================================
    socket.on('reconnect_ship', (data) => {
        const { shipId, shipName } = data;
        const userId = getUserIdBySocket(socket.id);
        
        console.log(`🔄 Reconnect request: ${shipId}, ${shipName} for user ${userId}`);
        
        if (!userId) {
            socket.emit('join_error', { message: 'User not authenticated' });
            return;
        }

        // Ищем корабль по userId
        let existingShip = null;
        if (players.has(userId)) {
            existingShip = players.get(userId);
        }
        
        if (!existingShip) {
            // Проверяем в shipStates
            for (const [id, state] of Object.entries(shipStates)) {
                if (state.userId === userId && state.taken) {
                    // Создаем корабль заново с последними известными координатами
                    // В реальном приложении нужно хранить последние координаты в БД
                    const newShip = new Ship(userId, shipName || shipId, 20, 0, shipId);
                    newShip.setSocketId(socket.id);
                    players.set(userId, newShip);
                    existingShip = newShip;
                    break;
                }
            }
        }
        
        if (!existingShip) {
            console.log(`❌ Ship not found for user ${userId}`);
            socket.emit('join_error', { message: 'Ship not found, please select a new one' });
            return;
        }
        
        // Обновляем сокет
        existingShip.setSocketId(socket.id);
        existingShip.isOnline = true;
        
        // Если был на якоре - снимаем
        if (existingShip.isAnchored) {
            existingShip.isAnchored = false;
            console.log(`⚓ ${existingShip.name} auto-weighed anchor`);
        }
        
        // Обновляем состояние в shipStates
        if (shipId && shipStates[shipId]) {
            shipStates[shipId].taken = true;
            shipStates[shipId].userId = userId;
        }
        
        socket.emit('joined', {
            role: 'player',
            ship: existingShip.getState(),
            players: getAllPlayersState()
        });
        
        io.emit('player_joined', { 
            userId: userId, 
            name: existingShip.name, 
            shipId: existingShip.shipType 
        });
        
        broadcastState();
        console.log(`🔄 ${existingShip.name} reconnected successfully for user ${userId}`);
    });

    // ==========================================
    //  SET FINISH POINT
    // ==========================================
    socket.on('set_finish', (data) => {
        const userId = getUserIdBySocket(socket.id);
        if (!userId) return;
        
        const ship = players.get(userId);
        if (ship && ship.isOnline && !ship.isEliminated && ship.shipType !== 'guest') {
            const { lat, lng } = data;
            const result = ship.setFinishPoint(lat, lng);
            socket.emit('action_result', { action: 'finish', success: result.success, ...result });
            if (result.success) {
                broadcastState();
                console.log(`🏁 ${ship.name} set finish point at ${lat}, ${lng}`);
            }
        }
    });

    // ==========================================
    //  CONTROLS - 1 click = 1 degree
    // ==========================================
    socket.on('turn', (data) => {
        const userId = getUserIdBySocket(socket.id);
        if (!userId) return;
        
        const ship = players.get(userId);
        if (ship && ship.isOnline && !ship.isEliminated && ship.shipType !== 'guest') {
            const delta = data.delta || 0;
            const result = ship.turn(delta);
            socket.emit('action_result', { action: 'turn', success: result.success, ...result });
            if (result.success) broadcastState();
        }
    });

    socket.on('sail', (data) => {
        const userId = getUserIdBySocket(socket.id);
        if (!userId) return;
        
        const ship = players.get(userId);
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
        const userId = getUserIdBySocket(socket.id);
        if (!userId) return;
        
        const ship = players.get(userId);
        if (ship && ship.isOnline && !ship.isEliminated && ship.shipType !== 'guest') {
            const result = data.action === 'drop' ? ship.dropAnchor() : ship.weighAnchor();
            socket.emit('action_result', { action: 'anchor', success: result.success, ...result });
            if (result.success) broadcastState();
        }
    });

    // ==========================================
    //  CHAT
    // ==========================================
    socket.on('chat', (data) => {
        const userId = getUserIdBySocket(socket.id);
        const ship = userId ? players.get(userId) : null;
        const name = ship ? ship.name : 'Unknown';
        io.emit('chat', { userId: userId, name: name, message: data.message });
    });

    // ==========================================
    //  DISCONNECT
    // ==========================================
    socket.on('disconnect', () => {
        const userId = getUserIdBySocket(socket.id);
        if (userId && players.has(userId)) {
            const ship = players.get(userId);
            ship.isOnline = false;
            ship.lastSeen = Date.now();
            console.log(`💤 ${ship.name} went offline, ship continues sailing`);
            io.emit('player_left', { userId: userId, name: ship.name, isOffline: true });
            broadcastState();
        }
        
        // Удаляем привязку сокета
        socketToUser.delete(socket.id);
    });
});

// ============================================
//  START SERVER
// ============================================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Regatta server running at http://0.0.0.0:${PORT}`);
    console.log(`👥 Max players: ${MAX_PLAYERS}`);
    console.log(`🌊 Wind + currents enabled`);
    console.log(`⚓ 1 click = 1° turn, 1 click = 10% sail\n`);
    console.log(`📋 API endpoints:`);
    console.log(`  - POST /api/register`);
    console.log(`  - POST /api/login`);
    console.log(`  - GET  /api/session`);
    console.log(`  - POST /api/logout`);
    console.log(`  - POST /api/select_ship`);
    console.log(`  - GET  /api/selected_ship`);
    console.log(`  - GET  /api/ships/state`);
    console.log(`  - GET  /api/players\n`);
});
