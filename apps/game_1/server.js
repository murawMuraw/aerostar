// apps/game_1/server.js

// ============================================
//  ЗАГРУЗКА ЛОКАЛЬНОГО .env
// ============================================
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);

// ============================================
//  НАСТРОЙКА SOCKET.IO
// ============================================
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

// ============================================
//  ЧТЕНИЕ ПЕРЕМЕННЫХ ИЗ .env
// ============================================
const PORT = process.env.PORT || 3002;
const NODE_ENV = process.env.NODE_ENV || 'development';
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS) || 12;
const INACTIVITY_TIMEOUT_HOURS = parseInt(process.env.INACTIVITY_TIMEOUT_HOURS) || 48;
const GROUNDED_TIMEOUT_SECONDS = parseInt(process.env.GROUNDED_TIMEOUT_SECONDS) || 300;

const INACTIVITY_TIMEOUT = INACTIVITY_TIMEOUT_HOURS * 60 * 60 * 1000;
const GROUNDED_TIMEOUT = GROUNDED_TIMEOUT_SECONDS * 1000;

// ============================================
//  MIDDLEWARE
// ============================================
app.use(express.json());
app.use(express.static('public'));

// Логирование запросов
app.use((req, res, next) => {
    console.log(`📡 ${req.method} ${req.url}`);
    next();
});

// ============================================
//  КЕШИ
// ============================================
const windCache = new Map();
const currentCache = new Map();
const CACHE_TTL = 600000; // 10 минут

// ============================================
//  ХРАНИЛИЩЕ
// ============================================
const players = new Map();
const registeredUsers = new Map();
const guestSessions = new Map();

// ============================================
//  МОДЕЛЬ ТЕЧЕНИЙ
// ============================================
class OceanCurrentModel {
    constructor() {
        this.currents = [
            // Северная Атлантика
            {
                name: 'Gulf Stream',
                type: 'warm',
                regions: [
                    { latMin: 24, latMax: 45, lngMin: -80, lngMax: -60 },
                    { latMin: 45, latMax: 55, lngMin: -60, lngMax: -40 }
                ],
                speed: 2.5,
                direction: 45,
                variation: 15
            },
            {
                name: 'North Atlantic Drift',
                type: 'warm',
                regions: [
                    { latMin: 45, latMax: 60, lngMin: -40, lngMax: -10 }
                ],
                speed: 1.8,
                direction: 60,
                variation: 20
            },
            // Южная Атлантика
            {
                name: 'Brazil Current',
                type: 'warm',
                regions: [
                    { latMin: -30, latMax: -10, lngMin: -50, lngMax: -35 }
                ],
                speed: 1.5,
                direction: 180,
                variation: 15
            },
            {
                name: 'South Atlantic Current',
                type: 'cold',
                regions: [
                    { latMin: -40, latMax: -30, lngMin: -50, lngMax: 10 }
                ],
                speed: 1.2,
                direction: 90,
                variation: 20
            },
            {
                name: 'Benguela Current',
                type: 'cold',
                regions: [
                    { latMin: -35, latMax: -20, lngMin: 5, lngMax: 15 }
                ],
                speed: 1.0,
                direction: 350,
                variation: 10
            },
            // Северный Тихий океан
            {
                name: 'Kuroshio Current',
                type: 'warm',
                regions: [
                    { latMin: 20, latMax: 35, lngMin: 120, lngMax: 150 }
                ],
                speed: 2.2,
                direction: 50,
                variation: 15
            },
            {
                name: 'North Pacific Current',
                type: 'warm',
                regions: [
                    { latMin: 35, latMax: 45, lngMin: 150, lngMax: -130 }
                ],
                speed: 1.5,
                direction: 80,
                variation: 20
            },
            {
                name: 'California Current',
                type: 'cold',
                regions: [
                    { latMin: 25, latMax: 40, lngMin: -130, lngMax: -115 }
                ],
                speed: 0.8,
                direction: 160,
                variation: 15
            },
            // Южный Тихий океан
            {
                name: 'East Australian Current',
                type: 'warm',
                regions: [
                    { latMin: -35, latMax: -20, lngMin: 150, lngMax: 160 }
                ],
                speed: 1.8,
                direction: 180,
                variation: 15
            },
            {
                name: 'South Pacific Current',
                type: 'cold',
                regions: [
                    { latMin: -45, latMax: -35, lngMin: 160, lngMax: -70 }
                ],
                speed: 1.0,
                direction: 90,
                variation: 20
            },
            {
                name: 'Peru Current',
                type: 'cold',
                regions: [
                    { latMin: -30, latMax: -10, lngMin: -90, lngMax: -70 }
                ],
                speed: 0.9,
                direction: 340,
                variation: 10
            },
            // Индийский океан
            {
                name: 'Agulhas Current',
                type: 'warm',
                regions: [
                    { latMin: -35, latMax: -25, lngMin: 25, lngMax: 35 }
                ],
                speed: 2.0,
                direction: 210,
                variation: 15
            },
            {
                name: 'West Australian Current',
                type: 'cold',
                regions: [
                    { latMin: -35, latMax: -20, lngMin: 110, lngMax: 120 }
                ],
                speed: 0.7,
                direction: 350,
                variation: 10
            },
            {
                name: 'South Indian Current',
                type: 'cold',
                regions: [
                    { latMin: -40, latMax: -30, lngMin: 40, lngMax: 110 }
                ],
                speed: 1.0,
                direction: 90,
                variation: 20
            },
            // Экваториальные течения
            {
                name: 'North Equatorial Current (Atlantic)',
                type: 'warm',
                regions: [
                    { latMin: 5, latMax: 15, lngMin: -60, lngMax: -20 }
                ],
                speed: 0.8,
                direction: 270,
                variation: 15
            },
            {
                name: 'South Equatorial Current (Atlantic)',
                type: 'warm',
                regions: [
                    { latMin: -10, latMax: 0, lngMin: -50, lngMax: 0 }
                ],
                speed: 0.9,
                direction: 270,
                variation: 15
            },
            {
                name: 'North Equatorial Current (Pacific)',
                type: 'warm',
                regions: [
                    { latMin: 10, latMax: 20, lngMin: 130, lngMax: -120 }
                ],
                speed: 0.7,
                direction: 270,
                variation: 15
            },
            {
                name: 'South Equatorial Current (Pacific)',
                type: 'warm',
                regions: [
                    { latMin: -10, latMax: 5, lngMin: 160, lngMax: -80 }
                ],
                speed: 0.8,
                direction: 270,
                variation: 15
            },
            {
                name: 'Equatorial Countercurrent',
                type: 'warm',
                regions: [
                    { latMin: 5, latMax: 10, lngMin: -50, lngMax: 0 }
                ],
                speed: 0.6,
                direction: 90,
                variation: 10
            },
            // Антарктические течения
            {
                name: 'Antarctic Circumpolar Current',
                type: 'cold',
                regions: [
                    { latMin: -65, latMax: -50, lngMin: -180, lngMax: 180 }
                ],
                speed: 1.5,
                direction: 90,
                variation: 10,
                isCircumpolar: true
            },
            // Северный Ледовитый океан
            {
                name: 'East Greenland Current',
                type: 'cold',
                regions: [
                    { latMin: 65, latMax: 80, lngMin: -40, lngMax: -10 }
                ],
                speed: 0.8,
                direction: 180,
                variation: 10
            },
            {
                name: 'Norwegian Current',
                type: 'warm',
                regions: [
                    { latMin: 60, latMax: 70, lngMin: -10, lngMax: 20 }
                ],
                speed: 0.9,
                direction: 45,
                variation: 15
            }
        ];

        this.seasonalFactors = {
            summer: 1.2,
            winter: 0.8,
            spring: 1.0,
            autumn: 1.0
        };
    }

    getCurrent(lat, lng, date = new Date()) {
        const season = this.getSeason(date);
        const seasonalFactor = this.seasonalFactors[season] || 1.0;
        const activeCurrents = this.findActiveCurrents(lat, lng);
        
        if (activeCurrents.length === 0) {
            return this.generateBackgroundCurrent(lat, lng);
        }
        
        let totalU = 0;
        let totalV = 0;
        
        for (const current of activeCurrents) {
            const { u, v } = this.calculateCurrentVector(current, lat, lng, seasonalFactor);
            totalU += u;
            totalV += v;
        }
        
        const speed = Math.sqrt(totalU * totalU + totalV * totalV);
        const direction = (Math.atan2(totalU, totalV) * 180 / Math.PI + 360) % 360;
        
        return {
            speed: Math.min(speed, 4.0),
            direction: direction,
            u: totalU,
            v: totalV,
            components: activeCurrents.map(c => c.name),
            season: season
        };
    }

    findActiveCurrents(lat, lng) {
        const active = [];
        for (const current of this.currents) {
            if (current.isCircumpolar) {
                if (lat >= current.regions[0].latMin && lat <= current.regions[0].latMax) {
                    active.push(current);
                }
                continue;
            }
            for (const region of current.regions) {
                let lngMin = region.lngMin;
                let lngMax = region.lngMax;
                if (lngMin > lngMax) {
                    if (lng >= lngMin || lng <= lngMax) {
                        if (lat >= region.latMin && lat <= region.latMax) {
                            active.push(current);
                            break;
                        }
                    }
                } else {
                    if (lng >= lngMin && lng <= lngMax) {
                        if (lat >= region.latMin && lat <= region.latMax) {
                            active.push(current);
                            break;
                        }
                    }
                }
            }
        }
        return active;
    }

    calculateCurrentVector(current, lat, lng, seasonalFactor) {
        let speed = current.speed * seasonalFactor;
        const latVariation = 0.5 + Math.sin(lat * 0.1) * 0.5;
        speed *= (0.8 + latVariation * 0.4);
        const randomVariation = 0.85 + Math.random() * 0.3;
        speed *= randomVariation;
        
        let direction = current.direction;
        const latDirectionShift = Math.sin(lat * 0.05) * 10;
        direction += latDirectionShift;
        const directionVariation = (Math.random() - 0.5) * current.variation;
        direction += directionVariation;
        direction = (direction + 360) % 360;
        
        const rad = direction * Math.PI / 180;
        return { u: speed * Math.cos(rad), v: speed * Math.sin(rad) };
    }

    generateBackgroundCurrent(lat, lng) {
        const baseSpeed = 0.2 + Math.sin(lat * 0.2) * 0.1 + Math.cos(lng * 0.15) * 0.1;
        const direction = (Math.atan2(Math.sin(lat * 0.3), Math.cos(lng * 0.2)) * 180 / Math.PI + 180) % 360;
        const rad = direction * Math.PI / 180;
        return {
            speed: baseSpeed,
            direction: direction,
            u: baseSpeed * Math.cos(rad),
            v: baseSpeed * Math.sin(rad),
            components: ['background'],
            season: 'background'
        };
    }

    getSeason(date) {
        const month = date.getMonth();
        const day = date.getDate();
        if ((month === 2 && day >= 20) || (month >= 3 && month <= 4) || (month === 5 && day <= 20)) return 'spring';
        if ((month === 5 && day >= 21) || (month >= 6 && month <= 7) || (month === 8 && day <= 22)) return 'summer';
        if ((month === 8 && day >= 23) || (month >= 9 && month <= 10) || (month === 11 && day <= 20)) return 'autumn';
        return 'winter';
    }

    getCurrentsForVisualization(latMin, latMax, lngMin, lngMax, step = 5) {
        const data = [];
        for (let lat = latMin; lat <= latMax; lat += step) {
            for (let lng = lngMin; lng <= lngMax; lng += step) {
                const current = this.getCurrent(lat, lng);
                data.push({
                    lat: lat,
                    lng: lng,
                    speed: current.speed,
                    direction: current.direction,
                    u: current.u,
                    v: current.v
                });
            }
        }
        return data;
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
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.data;
        }
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
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.data;
        }
    }
    
    const current = oceanCurrents.getCurrent(lat, lng);
    const result = {
        speed: current.speed,
        direction: current.direction,
        u: current.u,
        v: current.v,
        source: 'internal_model',
        components: current.components || [],
        season: current.season || 'unknown'
    };
    currentCache.set(key, { data: result, timestamp: Date.now() });
    return result;
}

// ============================================
//  API МАРШРУТЫ
// ============================================

// 1. Получение списка игроков
app.get('/api/players', (req, res) => {
    const playerList = [];
    for (const [id, ship] of players) {
        if (ship.isGuest) continue;
        playerList.push({
            id: id,
            name: ship.name,
            isOnline: ship.isOnline,
            isEliminated: ship.isEliminated || false,
            isGrounded: ship.isGrounded
        });
    }
    res.json({
        players: playerList,
        maxPlayers: MAX_PLAYERS,
        current: playerList.filter(p => !p.isEliminated).length,
        eliminated: playerList.filter(p => p.isEliminated).length
    });
});

// 2. Получение ветра
app.get('/api/wind', async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
        return res.status(400).json({ error: 'Missing lat/lng parameters' });
    }
    const data = await fetchWindData(parseFloat(lat), parseFloat(lng));
    res.json(data);
});

// 3. Получение течения (точка)
app.get('/api/current', async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
        return res.status(400).json({ error: 'Missing lat/lng parameters' });
    }
    const data = await fetchCurrentData(parseFloat(lat), parseFloat(lng));
    res.json(data);
});

// 4. Получение сетки течений
app.get('/api/currents/grid', (req, res) => {
    const { latMin, latMax, lngMin, lngMax, step } = req.query;
    const grid = oceanCurrents.getCurrentsForVisualization(
        parseFloat(latMin || -60),
        parseFloat(latMax || 60),
        parseFloat(lngMin || -180),
        parseFloat(lngMax || 180),
        parseFloat(step || 10)
    );
    res.json(grid);
});

// 5. Регистрация
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Необходимы имя и пароль' });
    }
    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ success: false, message: 'Имя должно быть 3-20 символов' });
    }
    if (password.length < 4) {
        return res.status(400).json({ success: false, message: 'Пароль должен быть минимум 4 символа' });
    }
    if (registeredUsers.has(username)) {
        return res.status(400).json({ success: false, message: 'Пользователь с таким именем уже существует' });
    }
    
    const passwordHash = Buffer.from(password).toString('base64');
    registeredUsers.set(username, { password: passwordHash, shipId: null });
    saveUsers();
    console.log(`✅ New user registered: ${username}`);
    res.json({ success: true, message: 'Регистрация успешна' });
});

// 6. Вход
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Необходимы имя и пароль' });
    }
    
    const userData = registeredUsers.get(username);
    if (!userData) {
        return res.status(401).json({ success: false, message: 'Неверное имя или пароль' });
    }
    
    const passwordHash = Buffer.from(password).toString('base64');
    if (userData.password !== passwordHash) {
        return res.status(401).json({ success: false, message: 'Неверное имя или пароль' });
    }
    
    // Проверяем, есть ли у игрока активный корабль
    let hasActiveShip = false;
    let shipIsEliminated = false;
    for (const [id, ship] of players) {
        if (ship.owner === username) {
            if (ship.isEliminated) {
                shipIsEliminated = true;
            } else {
                hasActiveShip = true;
            }
            break;
        }
    }
    
    if (shipIsEliminated) {
        for (const [id, ship] of players) {
            if (ship.owner === username) {
                players.delete(id);
                break;
            }
        }
        userData.shipId = null;
        saveUsers();
    }
    
    if (!hasActiveShip && !shipIsEliminated) {
        const activePlayers = Array.from(players.values()).filter(p => p.isOnline && !p.isGuest && !p.isEliminated);
        if (activePlayers.length >= MAX_PLAYERS) {
            return res.status(403).json({
                success: false,
                message: `Максимум ${MAX_PLAYERS} игроков. Попробуйте позже.`
            });
        }
    }
    
    const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
    res.json({ success: true, token, username, message: 'Вход выполнен успешно' });
});

// 7. Корневой маршрут
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 8. Поддержка regatta.html
app.get('/regatta.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 9. favicon.ico
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});
// ============================================
//  АДМИН-API
// ============================================

let currentRace = {
    startName: 'Порт Ливерпуль',
    startLat: 53.4,
    startLng: -3.0,
    finishName: 'Порт Нью-Йорк',
    finishLat: 40.7,
    finishLng: -74.0,
    status: 'scheduled', // scheduled, active, finished
    startTime: null,
    finishTime: null
};

// Получить текущую гонку
app.get('/api/admin/race', (req, res) => {
    res.json(currentRace);
});

// Сохранить гонку
app.post('/api/admin/race', (req, res) => {
    const { startName, startLat, startLng, finishName, finishLat, finishLng } = req.body;
    if (startName) currentRace.startName = startName;
    if (startLat) currentRace.startLat = startLat;
    if (startLng) currentRace.startLng = startLng;
    if (finishName) currentRace.finishName = finishName;
    if (finishLat) currentRace.finishLat = finishLat;
    if (finishLng) currentRace.finishLng = finishLng;
    res.json({ success: true });
});

// Старт гонки
app.post('/api/admin/race/start', (req, res) => {
    currentRace.status = 'active';
    currentRace.startTime = Date.now();
    io.emit('race_started', currentRace);
    res.json({ success: true });
});

// Финиш гонки
app.post('/api/admin/race/finish', (req, res) => {
    currentRace.status = 'finished';
    currentRace.finishTime = Date.now();
    io.emit('race_finished', currentRace);
    res.json({ success: true });
});

// Выбор парусника и старта
app.post('/api/select', (req, res) => {
    const { shipId, startPoint } = req.body;
    // Сохраняем выбор в сессии игрока
    // Здесь можно сохранить в базу или в память
    res.json({ success: true });
});




// ============================================
//  РАБОТА С ПОЛЬЗОВАТЕЛЯМИ (JSON)
// ============================================
const usersFile = path.join(__dirname, 'data', 'users.json');

function loadUsers() {
    try {
        if (fs.existsSync(usersFile)) {
            const data = fs.readFileSync(usersFile, 'utf8');
            const users = JSON.parse(data);
            for (const [username, userData] of Object.entries(users)) {
                registeredUsers.set(username, userData);
            }
            console.log(`👥 Loaded ${registeredUsers.size} registered users`);
        }
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function saveUsers() {
    try {
        const users = {};
        for (const [username, userData] of registeredUsers) {
            users[username] = userData;
        }
        fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
    } catch (error) {
        console.error('Error saving users:', error);
    }
}

if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'));
}
loadUsers();

// ============================================
//  КЛАСС КОРАБЛЯ
// ============================================
class Ship {
    constructor(id, name, lat, lng, isGuest = false, owner = null) {
        this.id = id;
        this.name = name;
        this.owner = owner || name;
        this.isGuest = isGuest;
        this.lat = lat;
        this.lng = lng;
        this.heading = 0;
        this.sailPosition = 0.5;
        this.targetSailPosition = 0.5;
        this.isAnchored = false;
        this.isGrounded = false;
        this.isEliminated = false;
        this.eliminationReason = null;
        this.eliminationTime = null;
        this.speed = 0;
        this.currentDrift = { lat: 0, lng: 0 };
        this.shipType = Math.floor(Math.random() * 3) + 1;
        this.isOnline = true;
        this.lastSeen = Date.now();
        this.raceId = null;
        this.finishTime = null;
        this.distanceTraveled = 0;
        this.groundTime = null;
        this.helpRequested = false;
        this.color = `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`;
    }

    update(wind, current, deltaTime) {
        if (this.isEliminated) return;
        if (this.isAnchored) {
            this.speed = 0;
            return;
        }

        if (this.isGrounded) {
            this.speed = 0;
            if (!this.groundTime) {
                this.groundTime = Date.now();
            }
            if (Date.now() - this.groundTime > GROUNDED_TIMEOUT) {
                this.eliminate('Сел на мель и не смог сняться');
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
        
        const speedDiff = maxSpeed - this.speed;
        this.speed += speedDiff * deltaTime * 0.3;
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
                io.emit('ship_grounded', {
                    playerId: this.id,
                    name: this.name,
                    lat: this.lat,
                    lng: this.lng
                });
            }
        }

        this.currentDrift = {
            lat: latDelta * deltaTime * 111320,
            lng: lngDelta * deltaTime * 111320 * Math.cos(this.lat * Math.PI / 180)
        };

        this.lastSeen = Date.now();
    }

    eliminate(reason) {
        if (this.isEliminated) return;
        this.isEliminated = true;
        this.eliminationReason = reason;
        this.eliminationTime = Date.now();
        this.isOnline = false;
        this.speed = 0;
        
        console.log(`💀 ${this.name} выбыл из игры: ${reason}`);
        io.emit('ship_eliminated', {
            playerId: this.id,
            name: this.name,
            reason: reason
        });
        
        if (this.owner) {
            for (const [username, data] of registeredUsers) {
                if (data.shipId === this.id) {
                    data.shipId = null;
                    saveUsers();
                    break;
                }
            }
        }
        broadcastState();
    }

    turn(deltaDegrees) {
        if (this.isEliminated) return { success: false, message: 'Корабль выбыл из игры' };
        if (this.isAnchored) return { success: false, message: 'Корабль на якоре' };
        if (this.isGrounded) return { success: false, message: 'Корабль на мели' };
        this.heading = (this.heading + deltaDegrees) % 360;
        if (this.heading < 0) this.heading += 360;
        return { success: true, heading: this.heading };
    }

    setSail(position) {
        if (this.isEliminated) return { success: false, message: 'Корабль выбыл из игры' };
        if (this.isAnchored) return { success: false, message: 'Корабль на якоре' };
        if (this.isGrounded) return { success: false, message: 'Корабль на мели' };
        this.targetSailPosition = Math.max(0, Math.min(1, position));
        return { success: true, sailPosition: this.targetSailPosition };
    }

    raiseSail() { return this.setSail(1); }
    lowerSail() { return this.setSail(0); }

    dropAnchor() {
        if (this.isEliminated) return { success: false, message: 'Корабль выбыл из игры' };
        if (this.isGrounded) return { success: false, message: 'Корабль на мели' };
        this.isAnchored = true;
        this.speed = 0;
        return { success: true, message: 'Якорь брошен' };
    }

    weighAnchor() {
        if (this.isEliminated) return { success: false, message: 'Корабль выбыл из игры' };
        if (this.isGrounded) return { success: false, message: 'Корабль на мели' };
        this.isAnchored = false;
        return { success: true, message: 'Якорь поднят' };
    }

    requestHelp() {
        if (this.isEliminated) return { success: false, message: 'Корабль выбыл из игры' };
        if (!this.isGrounded) return { success: false, message: 'Корабль не на мели' };
        this.helpRequested = true;
        io.emit('help_requested', {
            playerId: this.id,
            name: this.name,
            lat: this.lat,
            lng: this.lng
        });
        return { success: true, message: 'Запрос помощи отправлен' };
    }

    getState() {
        return {
            id: this.id,
            name: this.name,
            isGuest: this.isGuest,
            lat: this.lat,
            lng: this.lng,
            heading: this.heading,
            speed: this.speed,
            sailPosition: this.sailPosition,
            isAnchored: this.isAnchored,
            isGrounded: this.isGrounded,
            isEliminated: this.isEliminated,
            eliminationReason: this.eliminationReason,
            isOnline: this.isOnline,
            distanceTraveled: this.distanceTraveled,
            shipType: this.shipType,
            color: this.color,
            drift: this.currentDrift
        };
    }
}

// ============================================
//  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================
function getRandomStartPosition() {
    const positions = [
        { lat: 50, lng: -10 }, { lat: 40, lng: -30 }, { lat: 30, lng: -15 },
        { lat: 20, lng: -20 }, { lat: 0, lng: 10 }, { lat: -20, lng: 20 },
        { lat: 35, lng: 130 }, { lat: -30, lng: 150 }, { lat: 45, lng: -60 },
        { lat: 25, lng: -80 }, { lat: -10, lng: -40 }, { lat: 10, lng: -60 }
    ];
    const usedPositions = new Set();
    for (const [, ship] of players) {
        if (!ship.isEliminated) {
            usedPositions.add(`${ship.lat.toFixed(1)},${ship.lng.toFixed(1)}`);
        }
    }
    for (const pos of positions) {
        const key = `${pos.lat.toFixed(1)},${pos.lng.toFixed(1)}`;
        if (!usedPositions.has(key)) return pos;
    }
    return positions[Math.floor(Math.random() * positions.length)];
}

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
    io.emit('state', {
        players: getAllPlayersState(),
        timestamp: Date.now()
    });
}

// ============================================
//  ОЧИСТКА НЕАКТИВНЫХ
// ============================================
setInterval(() => {
    const now = Date.now();
    const toRemove = [];
    
    for (const [id, ship] of players) {
        if (ship.isEliminated) {
            toRemove.push(id);
            continue;
        }
        
        if (!ship.isOnline && (now - ship.lastSeen) > INACTIVITY_TIMEOUT) {
            ship.eliminate('Неактивен более 48 часов');
            toRemove.push(id);
            continue;
        }
        
        if (ship.isGuest && !ship.isOnline && (now - ship.lastSeen) > 60 * 60 * 1000) {
            toRemove.push(id);
            continue;
        }
    }
    
    for (const id of toRemove) {
        const ship = players.get(id);
        if (ship) {
            if (ship.owner) {
                for (const [username, data] of registeredUsers) {
                    if (data.shipId === id) {
                        data.shipId = null;
                        saveUsers();
                        break;
                    }
                }
            }
            players.delete(id);
            console.log(`🧹 Removed ship: ${ship.name}`);
            io.emit('player_removed', {
                playerId: id,
                name: ship.name,
                reason: ship.isEliminated ? 'Выбыл из игры' : 'Неактивен'
            });
        }
    }
    
    if (toRemove.length > 0) {
        broadcastState();
    }
}, 30000);

// ============================================
//  SOCKET.IO
// ============================================
io.on('connection', (socket) => {
    console.log('🔗 New connection:', socket.id);
    
    let shipId = null;
    let isGuest = true;
    let username = null;

    socket.on('join_as_guest', () => {
        isGuest = true;
        username = `Гость_${socket.id.substring(0, 6)}`;
        guestSessions.set(socket.id, true);
        
        const startPos = getRandomStartPosition();
        const ship = new Ship(socket.id, username, startPos.lat, startPos.lng, true);
        ship.isOnline = true;
        players.set(socket.id, ship);
        shipId = socket.id;
        
        Promise.all([fetchWindData(ship.lat, ship.lng), fetchCurrentData(ship.lat, ship.lng)])
            .then(([windData, currentData]) => {
                socket.emit('joined', {
                    role: 'guest',
                    ship: ship.getState(),
                    wind: windData,
                    current: currentData,
                    players: getAllPlayersState()
                });
            });
        
        console.log(`👤 Guest ${username} joined`);
        broadcastState();
    });

    socket.on('join_as_player', async (data) => {
        const { token } = data;
        if (!token) {
            socket.emit('join_error', { message: 'Требуется авторизация' });
            return;
        }
        
        let decoded;
        try {
            decoded = Buffer.from(token, 'base64').toString('utf8');
            const [user, timestamp] = decoded.split(':');
            username = user;
        } catch (error) {
            socket.emit('join_error', { message: 'Неверный токен' });
            return;
        }
        
        const userData = registeredUsers.get(username);
        if (!userData) {
            socket.emit('join_error', { message: 'Пользователь не найден' });
            return;
        }
        
        let existingShip = null;
        for (const [id, ship] of players) {
            if (ship.owner === username && !ship.isEliminated) {
                existingShip = ship;
                break;
            }
        }
        
        if (existingShip) {
            existingShip.isOnline = true;
            existingShip.lastSeen = Date.now();
            shipId = existingShip.id;
            isGuest = false;
            
            if (existingShip.isGrounded) {
                socket.emit('ship_status', {
                    status: 'grounded',
                    message: 'Ваш корабль на мели! Попробуйте сняться.'
                });
            }
            
            const wind = await fetchWindData(existingShip.lat, existingShip.lng);
            const current = await fetchCurrentData(existingShip.lat, existingShip.lng);
            
            socket.emit('joined', {
                role: 'player',
                ship: existingShip.getState(),
                wind: wind,
                current: current,
                players: getAllPlayersState(),
                isReconnect: true
            });
            
            console.log(`♻️ Player ${username} reconnected`);
        } else {
            const activePlayers = Array.from(players.values())
                .filter(p => p.isOnline && !p.isGuest && !p.isEliminated);
            
            if (activePlayers.length >= MAX_PLAYERS) {
                socket.emit('join_error', {
                    message: `Максимум ${MAX_PLAYERS} игроков одновременно`
                });
                return;
            }
            
            const startPos = getRandomStartPosition();
            const ship = new Ship(socket.id, username, startPos.lat, startPos.lng, false, username);
            ship.isOnline = true;
            players.set(socket.id, ship);
            shipId = socket.id;
            isGuest = false;
            
            userData.shipId = socket.id;
            saveUsers();
            
            const wind = await fetchWindData(ship.lat, ship.lng);
            const current = await fetchCurrentData(ship.lat, ship.lng);
            
            socket.emit('joined', {
                role: 'player',
                ship: ship.getState(),
                wind: wind,
                current: current,
                players: getAllPlayersState(),
                isReconnect: false
            });
            
            io.emit('player_joined', {
                playerId: socket.id,
                name: ship.name,
                isGuest: false
            });
            
            console.log(`✨ Player ${username} joined`);
        }
        
        broadcastState();
    });

    const handleAction = (socket, action, handler) => {
        if (isGuest) {
            socket.emit('action_result', { action, success: false, message: 'Гости не могут управлять кораблём' });
            return;
        }
        const ship = players.get(socket.id);
        if (!ship) {
            socket.emit('action_result', { action, success: false, message: 'Корабль не найден' });
            return;
        }
        if (ship.isEliminated) {
            socket.emit('action_result', { action, success: false, message: 'Корабль выбыл из игры' });
            return;
        }
        const result = handler(ship);
        socket.emit('action_result', { action, success: result.success, ...result });
        if (result.success) broadcastState();
    };

    socket.on('turn', (data) => {
        handleAction(socket, 'turn', (ship) => ship.turn(data.delta || 0));
    });

    socket.on('sail', (data) => {
        handleAction(socket, 'sail', (ship) => {
            if (data.action === 'raise') return ship.raiseSail();
            if (data.action === 'lower') return ship.lowerSail();
            return ship.setSail(data.position || 0.5);
        });
    });

    socket.on('anchor', (data) => {
        handleAction(socket, 'anchor', (ship) => {
            if (data.action === 'drop') return ship.dropAnchor();
            return ship.weighAnchor();
        });
    });

    socket.on('request_help', () => {
        handleAction(socket, 'help', (ship) => ship.requestHelp());
    });

    socket.on('chat', (data) => {
        const ship = players.get(socket.id);
        const name = ship ? ship.name : 'Unknown';
        io.emit('chat', {
            playerId: socket.id,
            name: name,
            message: data.message,
            isGuest: isGuest
        });
    });

    socket.on('disconnect', () => {
        const ship = players.get(socket.id);
        if (ship) {
            if (isGuest) {
                players.delete(socket.id);
                guestSessions.delete(socket.id);
                console.log(`👋 Guest ${ship.name} disconnected`);
            } else {
                ship.isOnline = false;
                ship.lastSeen = Date.now();
                console.log(`💤 Player ${ship.name} went offline`);
                io.emit('player_left', {
                    playerId: socket.id,
                    name: ship.name,
                    isOffline: true
                });
                broadcastState();
            }
        }
    });
});

// ============================================
//  ИГРОВОЙ ЦИКЛ
// ============================================
setInterval(async () => {
    const deltaTime = 1 / 30;
    
    for (const [id, ship] of players) {
        if (ship.isEliminated) continue;
        try {
            const wind = await fetchWindData(ship.lat, ship.lng);
            const current = await fetchCurrentData(ship.lat, ship.lng);
            ship.update(wind, current, deltaTime);
        } catch (error) {
            console.error(`Error updating ship ${id}:`, error);
        }
    }
    
    broadcastState();
}, 1000 / 30);

// ============================================
//  АДМИН-API (дополнение)
// ============================================

// Отправка сообщения в чат
app.post('/api/admin/chat', (req, res) => {
    const { message } = req.body;
    if (!message) {
        return res.status(400).json({ success: false, error: 'Нет текста' });
    }

    // Отправляем всем игрокам
    io.emit('admin_message', {
        text: message,
        timestamp: Date.now()
    });

    res.json({ success: true });
});

// ============================================
//  СОСТОЯНИЕ КОРАБЛЕЙ
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

// Получить состояние кораблей
app.get('/api/ships/state', (req, res) => {
    res.json(shipStates);
});

// Вход с кораблём
socket.on('join_with_ship', (data) => {
    const { shipId, shipName, startPoint } = data;

    // Проверяем, свободен ли корабль
    if (shipStates[shipId] && shipStates[shipId].taken) {
        socket.emit('join_error', { message: 'Этот корабль уже занят' });
        return;
    }

    // Создаём игрока
    const player = new Ship(
        socket.id,
        shipName,
        startPoint.lat,
        startPoint.lng,
        false,
        socket.id
    );
    player.shipType = shipId;
    players.set(socket.id, player);

    // Помечаем корабль как занятый
    shipStates[shipId].taken = true;
    shipStates[shipId].playerId = socket.id;

    socket.emit('joined', {
        role: 'player',
        ship: player.getState(),
        players: getAllPlayersState()
    });

    io.emit('player_joined', {
        playerId: socket.id,
        name: player.name,
        shipId: shipId
    });

    broadcastState();
});

// Выход из гонки
socket.on('leave_race', () => {
    const ship = players.get(socket.id);
    if (ship) {
        // Освобождаем корабль
        for (const [id, state] of Object.entries(shipStates)) {
            if (state.playerId === socket.id) {
                state.taken = false;
                state.playerId = null;
                break;
            }
        }
        players.delete(socket.id);
        io.emit('player_left', { playerId: socket.id, name: ship.name });
        broadcastState();
    }
});


// ============================================
//  ЗАПУСК СЕРВЕРА
// ============================================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Regatta server running at http://0.0.0.0:${PORT}`);
    console.log(`📡 Socket.IO enabled on /socket.io/`);
    console.log(`👥 Max players: ${MAX_PLAYERS}`);
    console.log(`⏰ Inactivity timeout: ${INACTIVITY_TIMEOUT_HOURS} hours`);
    console.log(`⏳ Grounded timeout: ${GROUNDED_TIMEOUT_SECONDS} seconds`);
    console.log(`👤 Registered users: ${registeredUsers.size}`);
    console.log(`🌊 Wind + ocean currents enabled\n`);
});

// Обработка завершения
process.on('SIGINT', () => {
    console.log('\n🛑 Server shutting down...');
    process.exit();
});
