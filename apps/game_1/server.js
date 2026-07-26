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
const INACTIVITY_TIMEOUT = 48 * 60 * 60 * 1000; // 48 hours
const GROUNDED_TIMEOUT = 5 * 60 * 1000; // 5 minutes

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
const players = new Map();
const pendingSelections = new Map();
const finishPoints = new Map(); // playerId -> { lat, lng }

// ============================================
//  SHIP STATES (7 ships)
// ============================================
let shipStates = {};

function initShipStates() {
    shipStates = {
        'klip_10': { taken: false, playerId: null },
        'klip_20': { taken: false, playerId: null },
        'klip_30': { taken: false, playerId: null },
        'columb': { taken: false, playerId: null },
        'pirat': { taken: false, playerId: null },
        'ap': { taken: false, playerId: null },
        '19c_m': { taken: false, playerId: null }
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
    
    if (shipStates[shipId].taken) {
        if (shipStates[shipId].playerId !== userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'This ship is already taken'
            });
        }
    }
    
    // Free all ships of this user
    for (const [id, state] of Object.entries(shipStates)) {
        if (state.playerId === userId) {
            state.taken = false;
            state.playerId = null;
        }
    }
    
    shipStates[shipId].taken = true;
    shipStates[shipId].playerId = userId;
    
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
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ success: false });
    }
    
    const userId = sessions.get(sessionId);
    
    for (const [shipId, state] of Object.entries(shipStates)) {
        if (state.playerId === userId && state.taken) {
            return res.json({
                success: true,
                data: { shipId, userId }
            });
        }
    }
    
    res.json({ success: false });
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
    for (const [id, ship] of players) {
        playerList.push({
            id: id,
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
    for (const [id, state] of Object.entries(shipStates)) {
        if (state.playerId) {
            let isActive = false;
            for (const [pid, ship] of players) {
                if (pid === state.playerId && ship.isOnline) {
                    isActive = true;
                    break;
                }
            }
            if (!isActive) {
                state.taken = false;
                state.playerId = null;
            }
        }
    }
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
    constructor(id, name, lat, lng, shipType) {
        this.id = id;
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

        // Sail adjustment (10% per click)
        const sailDiff = this.targetSailPosition - this.sailPosition;
        this.sailPosition += sailDiff * deltaTime * 0.5;
        this.sailPosition = Math.max(0, Math.min(1, this.sailPosition));

        // Wind effect
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

        // Current effect
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

        // Check for land (grounding)
        if (isOnLand(newLat, newLng)) {
            if (!this.isGrounded) {
                this.isGrounded = true;
                this.groundTime = Date.now();
                this.speed = 0;
                io.emit('ship_grounded', { playerId: this.id, name: this.name, lat: this.lat, lng: this.lng });
            }
            return;
        }

        this.lat = newLat;
        this.lng = newLng;
        this.distanceTraveled += Math.sqrt(latDelta*latDelta + lngDelta*lngDelta) * 111320;

        // Check if reached finish point
        if (this.finishPoint) {
            const distance = this.getDistanceTo(this.finishPoint.lat, this.finishPoint.lng);
            if (distance < 0.5) { // 500 meters
                this.finish();
            }
        }

        this.lastSeen = Date.now();
    }

    getDistanceTo(lat, lng) {
        const R = 6371; // Earth's radius in km
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
        io.emit('ship_finished', { playerId: this.id, name: this.name });
        console.log(`🏁 ${this.name} finished the race!`);
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
        // Round to nearest 10%
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
        io.emit('ship_anchored', { playerId: this.id, name: this.name });
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
    // Simple land detection (approximate)
    const landMasses = [
        { latMin: 36, latMax: 70, lngMin: -10, lngMax: 40 }, // Europe
        { latMin: -35, latMax: 37, lngMin: -20, lngMax: 50 }, // Africa
        { latMin: 25, latMax: 70, lngMin: -130, lngMax: -60 }, // North America
        { latMin: -55, latMax: 12, lngMin: -80, lngMax: -35 }, // South America
        { latMin: 10, latMax: 75, lngMin: 40, lngMax: 150 }, // Asia
        { latMin: -40, latMax: -10, lngMin: 113, lngMax: 155 }, // Australia
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
//  CLEANUP INACTIVE PLAYERS
// ============================================
setInterval(() => {
    const now = Date.now();
    const toRemove = [];
    for (const [id, ship] of players) {
        if (ship.isEliminated || ship.isFinished) { 
            toRemove.push(id); 
            continue; 
        }
        if (!ship.isOnline && (now - ship.lastSeen) > INACTIVITY_TIMEOUT) {
            // Ship continues sailing with last settings
            console.log(`⏳ ${ship.name} is sailing without captain`);
        }
    }
    // Don't remove ships, they continue sailing
}, 30000);

// ============================================
//  GAME LOOP
// ============================================
setInterval(async () => {
    const deltaTime = 1 / 30;
    const windData = {};
    const currentData = {};
    
    for (const [id, ship] of players) {
        if (ship.isEliminated || ship.isFinished) continue;
        try {
            const wind = await fetchWindData(ship.lat, ship.lng);
            const current = await fetchCurrentData(ship.lat, ship.lng);
            ship.update(wind, current, deltaTime);
            
            windData[id] = wind;
            currentData[id] = current;
        } catch (error) {
            console.error(`Error updating ${id}:`, error);
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
    //  JOIN AS GUEST
    // ==========================================
    socket.on('join_as_guest', (data) => {
        const { lat, lng } = data;
        
        const guest = new Ship(socket.id, 'Guest', lat, lng, 'guest');
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
    //  JOIN WITH SHIP
    // ==========================================
    socket.on('join_with_ship', (data) => {
        const { shipId, shipName, lat, lng } = data;

        console.log(`📥 Join with ship: ${shipId}, ${shipName} at ${lat}, ${lng}`);

        if (shipStates[shipId] && shipStates[shipId].taken) {
            if (shipStates[shipId].playerId !== socket.id) {
                socket.emit('join_error', { message: 'This ship is already taken' });
                return;
            }
        }

        // Check if on land
        if (isOnLand(lat, lng)) {
            socket.emit('join_error', { message: 'Cannot start on land! Choose a point in the ocean' });
            return;
        }

        // If socket already has a ship - remove old one
        if (players.has(socket.id)) {
            const oldShip = players.get(socket.id);
            for (const [id, state] of Object.entries(shipStates)) {
                if (state.playerId === socket.id) {
                    state.taken = false;
                    state.playerId = null;
                }
            }
            players.delete(socket.id);
        }

        const player = new Ship(socket.id, shipName || shipId, lat, lng, shipId);
        players.set(socket.id, player);

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
        console.log(`⛵ ${player.name} joined at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    });

    // ==========================================
    //  SET FINISH POINT
    // ==========================================
    socket.on('set_finish', (data) => {
        const ship = players.get(socket.id);
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
        const ship = players.get(socket.id);
        if (ship && ship.isOnline && !ship.isEliminated && ship.shipType !== 'guest') {
            const delta = data.delta || 0;
            const result = ship.turn(delta);
            socket.emit('action_result', { action: 'turn', success: result.success, ...result });
            if (result.success) broadcastState();
        }
    });

    // Sail - 1 click = 10%
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
    //  CHAT
    // ==========================================
    socket.on('chat', (data) => {
        const ship = players.get(socket.id);
        const name = ship ? ship.name : 'Unknown';
        io.emit('chat', { playerId: socket.id, name: name, message: data.message });
    });

    // ==========================================
    //  DISCONNECT - ship continues sailing
    // ==========================================
    socket.on('disconnect', () => {
        const ship = players.get(socket.id);
        if (ship) {
            ship.isOnline = false;
            ship.lastSeen = Date.now();
            console.log(`💤 ${ship.name} went offline, ship continues sailing`);
            io.emit('player_left', { playerId: socket.id, name: ship.name, isOffline: true });
            broadcastState();
        }
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
