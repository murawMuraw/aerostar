/**
 * ГЛАВНЫЙ ИГРОВОЙ СЕРВЕР «ФИЕСТА» (Порт 3001)
 * Версия 6.1 - исправлена длительность гонки
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

const balloonCatalog = require('./balloonCatalog');
const windService = require('./windService');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['polling', 'websocket'],
    allowEIO3: true
});

const PORT = 3001;
const CONFIG_FILE = path.join(__dirname, 'race-config.json');
const PILOTS_FILE = path.join(__dirname, 'pilots.json');
const MAX_PARTICIPANTS = 10;
const SIMULATION_INTERVAL = 60000;
const SALT_ROUNDS = 10;

// ============================================
// СОСТОЯНИЯ ИГРЫ
// ============================================
const GAME_STATES = {
    IDLE: 'idle',
    REGISTRATION: 'registration',
    RACING: 'racing',
    FINISHED: 'finished'
};

// Допустимые переходы между состояниями
const STATE_TRANSITIONS = {
    [GAME_STATES.IDLE]: [GAME_STATES.REGISTRATION],
    [GAME_STATES.REGISTRATION]: [GAME_STATES.RACING, GAME_STATES.IDLE],
    [GAME_STATES.RACING]: [GAME_STATES.FINISHED],
    [GAME_STATES.FINISHED]: [GAME_STATES.IDLE]
};

let raceConfig = {
    finishCoords: { lat: 48.8566, lng: 2.3522 },
    allowedStartRegion: {
        minLat: 25,
        maxLat: 50,
        minLng: -120,
        maxLng: -70
    },
    registrationWindowFrom: new Date('1970-01-01'),
    registrationWindowTo: new Date('1970-01-01'),
    raceStartDateTime: new Date('1970-01-01'),
    maxParticipants: MAX_PARTICIPANTS,
    raceStarted: false,
    raceFinished: false,
    raceDurationHours: 24,
    raceStatus: GAME_STATES.IDLE,
    scheduledStartTime: null,
    raceEndTime: null // Добавляем время окончания гонки
};

let balloons = {};
let simulationIntervals = new Map();
let socketToPilot = new Map();

// ============================================
// ЗАГРУЗКА И СОХРАНЕНИЕ КОНФИГУРАЦИИ
// ============================================
function loadConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            raceConfig = {
                ...raceConfig,
                ...saved,
                allowedStartRegion: saved.allowedStartRegion || raceConfig.allowedStartRegion,
                registrationWindowFrom: saved.registrationWindowFrom ? new Date(saved.registrationWindowFrom) : new Date('1970-01-01'),
                registrationWindowTo: saved.registrationWindowTo ? new Date(saved.registrationWindowTo) : new Date('1970-01-01'),
                raceStartDateTime: saved.raceStartDateTime ? new Date(saved.raceStartDateTime) : new Date('1970-01-01'),
                raceStatus: saved.raceStatus || GAME_STATES.IDLE,
                scheduledStartTime: saved.scheduledStartTime || null,
                raceDurationHours: saved.raceDurationHours || 24,
                raceEndTime: saved.raceEndTime || null
            };
            console.log('✅ Loaded race config from file');
        } catch(e) {
            console.error('Error loading config:', e);
        }
    } else {
        saveConfigToFile();
    }
}

function saveConfigToFile() {
    const configToSave = {
        finishCoords: raceConfig.finishCoords,
        allowedStartRegion: raceConfig.allowedStartRegion,
        registrationWindowFrom: raceConfig.registrationWindowFrom.toISOString(),
        registrationWindowTo: raceConfig.registrationWindowTo.toISOString(),
        raceStartDateTime: raceConfig.raceStartDateTime.toISOString(),
        maxParticipants: raceConfig.maxParticipants,
        raceStarted: raceConfig.raceStarted,
        raceFinished: raceConfig.raceFinished,
        raceDurationHours: raceConfig.raceDurationHours,
        raceStatus: raceConfig.raceStatus,
        scheduledStartTime: raceConfig.scheduledStartTime,
        raceEndTime: raceConfig.raceEndTime
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2));
}

// ============================================
// УПРАВЛЕНИЕ СОСТОЯНИЯМИ
// ============================================
function canTransitionTo(newState) {
    const allowed = STATE_TRANSITIONS[raceConfig.raceStatus] || [];
    return allowed.includes(newState);
}

function setRaceStatus(newStatus, options = {}) {
    if (!canTransitionTo(newStatus)) {
        console.error(`❌ Invalid transition: ${raceConfig.raceStatus} -> ${newStatus}`);
        return false;
    }

    const oldStatus = raceConfig.raceStatus;
    console.log(`🔄 State transition: ${oldStatus} -> ${newStatus}`);

    switch (newStatus) {
        case GAME_STATES.IDLE:
            raceConfig.raceStarted = false;
            raceConfig.raceFinished = false;
            raceConfig.raceStatus = GAME_STATES.IDLE;
            raceConfig.scheduledStartTime = null;
            raceConfig.registrationWindowFrom = new Date('1970-01-01');
            raceConfig.registrationWindowTo = new Date('1970-01-01');
            raceConfig.raceStartDateTime = new Date('1970-01-01');
            raceConfig.raceEndTime = null;
            balloons = {};
            savePilotsToFile();
            stopAllSimulations();
            console.log('🧹 All pilots cleared, config reset to IDLE');
            break;

        case GAME_STATES.REGISTRATION:
            raceConfig.raceStarted = false;
            raceConfig.raceFinished = false;
            raceConfig.raceStatus = GAME_STATES.REGISTRATION;
            raceConfig.raceEndTime = null;
            if (raceConfig.registrationWindowFrom.getTime() === new Date('1970-01-01').getTime()) {
                raceConfig.registrationWindowFrom = new Date();
                raceConfig.registrationWindowTo = new Date();
                raceConfig.registrationWindowTo.setDate(raceConfig.registrationWindowTo.getDate() + 7);
            }
            stopAllSimulations();
            console.log('📝 Registration opened');
            break;

        case GAME_STATES.RACING:
            raceConfig.raceStarted = true;
            raceConfig.raceFinished = false;
            raceConfig.raceStatus = GAME_STATES.RACING;
            raceConfig.registrationWindowTo = new Date();
            
            // Устанавливаем время старта и окончания
            if (raceConfig.raceStartDateTime.getTime() === new Date('1970-01-01').getTime()) {
                raceConfig.raceStartDateTime = new Date();
            }
            
            // ВАЖНО: Рассчитываем время окончания гонки
            const startTime = raceConfig.scheduledStartTime 
                ? new Date(raceConfig.scheduledStartTime) 
                : raceConfig.raceStartDateTime;
            
            raceConfig.raceEndTime = new Date(startTime);
            raceConfig.raceEndTime.setHours(raceConfig.raceEndTime.getHours() + raceConfig.raceDurationHours);
            
            console.log(`🏁 Race will end at ${raceConfig.raceEndTime.toUTCString()}`);
            console.log(`⏱️ Duration: ${raceConfig.raceDurationHours} hours`);
            
            startAllSimulations();
            console.log('🏁 Race started!');
            break;

        case GAME_STATES.FINISHED:
            raceConfig.raceStarted = false;
            raceConfig.raceFinished = true;
            raceConfig.raceStatus = GAME_STATES.FINISHED;
            stopAllSimulations();
            console.log('🏆 Race finished!');
            break;
    }

    saveConfigToFile();
    savePilotsToFile();
    
    io.emit('fiesta-state-changed', {
        oldState: oldStatus,
        newState: newStatus,
        config: getConfigForClient()
    });
    io.emit('fiesta-race-config', getConfigForClient());

    return true;
}

function getConfigForClient() {
    return {
        finishCoords: raceConfig.finishCoords,
        allowedStartRegion: raceConfig.allowedStartRegion,
        registrationWindowFrom: raceConfig.registrationWindowFrom,
        registrationWindowTo: raceConfig.registrationWindowTo,
        raceStartDateTime: raceConfig.raceStartDateTime,
        maxParticipants: raceConfig.maxParticipants,
        raceStarted: raceConfig.raceStarted,
        raceFinished: raceConfig.raceFinished,
        raceDurationHours: raceConfig.raceDurationHours,
        raceStatus: raceConfig.raceStatus,
        scheduledStartTime: raceConfig.scheduledStartTime,
        raceEndTime: raceConfig.raceEndTime
    };
}

// ============================================
// ФУНКЦИИ ДЛЯ РАБОТЫ С ВРЕМЕНЕМ (UTC)
// ============================================

function isRegistrationOpen() {
    const now = new Date();
    const nowUTC = new Date(now.toUTCString());
    
    const fromUTC = new Date(raceConfig.registrationWindowFrom.toUTCString());
    const toUTC = new Date(raceConfig.registrationWindowTo.toUTCString());
    
    return nowUTC >= fromUTC && nowUTC <= toUTC;
}

function isRaceTimeExpired() {
    if (!raceConfig.raceStarted) return false;
    if (!raceConfig.raceEndTime) return false;
    
    const now = new Date();
    const nowUTC = new Date(now.toUTCString());
    const endUTC = new Date(raceConfig.raceEndTime.toUTCString());
    
    console.log(`⏱️ Checking race time: now=${nowUTC.toUTCString()}, end=${endUTC.toUTCString()}`);
    
    return nowUTC >= endUTC;
}

// ============================================
// АВТОМАТИЧЕСКИЕ ПРОВЕРКИ
// ============================================

function checkAndOpenRegistration() {
    if (raceConfig.raceStatus !== GAME_STATES.IDLE) {
        return false;
    }
    
    const from = raceConfig.registrationWindowFrom;
    if (!from || from.getTime() === new Date('1970-01-01').getTime()) {
        return false;
    }
    
    const now = new Date();
    const nowUTC = new Date(now.toUTCString());
    const fromUTC = new Date(from.toUTCString());
    
    if (fromUTC <= nowUTC) {
        setRaceStatus(GAME_STATES.REGISTRATION);
        console.log(`📝 Registration opened automatically at ${fromUTC.toUTCString()}`);
        return true;
    }
    
    return false;
}

function checkAndStartRace() {
    if (raceConfig.raceStatus !== GAME_STATES.REGISTRATION) {
        return false;
    }
    
    const startTime = raceConfig.scheduledStartTime;
    if (!startTime) {
        return false;
    }
    
    const now = new Date();
    const nowUTC = new Date(now.toUTCString());
    const startUTC = new Date(startTime);
    
    if (startUTC <= nowUTC) {
        setRaceStatus(GAME_STATES.RACING);
        io.emit('fiesta-race-started', {
            message: `🏁 ГОНКА НАЧАЛАСЬ ПО РАСПИСАНИЮ! Продолжительность: ${raceConfig.raceDurationHours} часов 🏁`,
            timestamp: new Date(),
            scheduled: true
        });
        console.log(`🏁 Race started automatically at ${startUTC.toUTCString()}`);
        raceConfig.scheduledStartTime = null;
        saveConfigToFile();
        return true;
    }
    
    return false;
}

// ============================================
// СОХРАНЕНИЕ И ЗАГРУЗКА ПИЛОТОВ
// ============================================
function savePilotsToFile() {
    const pilotsToSave = {};
    for (const [id, balloon] of Object.entries(balloons)) {
        pilotsToSave[id] = {
            id: balloon.id,
            username: balloon.username,
            password: balloon.password,
            email: balloon.email,
            balloonColor: balloon.balloonColor,
            balloonStyle: balloon.balloonStyle,
            raceNumber: balloon.raceNumber,
            lat: balloon.lat,
            lng: balloon.lng,
            altitude: balloon.altitude,
            finished: balloon.finished,
            finishTime: balloon.finishTime,
            speed: balloon.speed || 0,
            layerName: balloon.layerName || 'Surface Layer',
            windDirection: balloon.windDirection || 0,
            lastUpdate: balloon.lastUpdate || Date.now(),
            path: balloon.path || []
        };
    }
    fs.writeFileSync(PILOTS_FILE, JSON.stringify(pilotsToSave, null, 2));
    console.log(`💾 Saved ${Object.keys(pilotsToSave).length} pilots to file`);
}

function loadPilotsFromFile() {
    if (fs.existsSync(PILOTS_FILE)) {
        try {
            const saved = JSON.parse(fs.readFileSync(PILOTS_FILE, 'utf8'));
            for (const [id, pilot] of Object.entries(saved)) {
                balloons[id] = {
                    ...pilot,
                    path: pilot.path || [],
                    lastUpdate: Date.now(),
                    pilotConnected: false,
                    lastSeen: Date.now(),
                    socketId: null
                };
            }
            console.log(`✅ Loaded ${Object.keys(balloons).length} pilots from file`);
        } catch(e) {
            console.error('Error loading pilots:', e);
        }
    } else {
        console.log('📝 No pilots file found, starting fresh');
    }
}

// ============================================
// ОБНОВЛЕНИЕ ВЕТРА
// ============================================
async function updateWeatherForAllBalloons() {
    const balloonIds = Object.keys(balloons);
    if (balloonIds.length === 0) return;
    
    console.log(`🌤️ Обновление погоды для ${balloonIds.length} шаров...`);
    
    for (const id of balloonIds) {
        const balloon = balloons[id];
        if (!balloon || balloon.finished) continue;
        
        try {
            const wind = await windService.getWindAtPosition(balloon.lat, balloon.lng, balloon.altitude);
            balloon._cachedWind = wind;
            console.log(`🌤️ Ветер для ${balloon.username}: ${wind.speed} м/с, ${wind.direction}°`);
        } catch (error) {
            console.error(`❌ Ошибка получения ветра для ${balloon.username}:`, error.message);
            if (!balloon._cachedWind) {
                console.warn(`⚠️ Нет кэшированного ветра для ${balloon.username}`);
            } else {
                console.log(`📦 Используем кэшированный ветер для ${balloon.username}`);
            }
        }
    }
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================
function isInStartZone(lat, lng) {
    if (!raceConfig.allowedStartRegion) return true;
    const zone = raceConfig.allowedStartRegion;
    if (typeof zone.minLat === 'undefined' || typeof zone.maxLat === 'undefined' ||
        typeof zone.minLng === 'undefined' || typeof zone.maxLng === 'undefined') {
        console.warn('Invalid start region configuration:', zone);
        return true;
    }
    return lat >= zone.minLat && lat <= zone.maxLat && 
           lng >= zone.minLng && lng <= zone.maxLng;
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function deg2rad(deg) {
    return deg * (Math.PI/180);
}

// ============================================
// СИМУЛЯЦИЯ ДВИЖЕНИЯ ШАРА
// ============================================
function startAllSimulations() {
    console.log('🚀 Starting simulations for all balloons...');
    
    setTimeout(() => {
        updateWeatherForAllBalloons();
    }, 1000);
    
    for (const [id, balloon] of Object.entries(balloons)) {
        if (!simulationIntervals.has(id)) {
            console.log(`▶️ Starting simulation for ${balloon.username || id}`);
            startBalloonSimulation(id);
        }
    }
}

function stopAllSimulations() {
    console.log('⏹️ Stopping all simulations...');
    for (const [id, interval] of simulationIntervals) {
        clearInterval(interval);
    }
    simulationIntervals.clear();
}

async function startBalloonSimulation(balloonId) {
    if (simulationIntervals.has(balloonId)) {
        console.log(`⏭️ Simulation already running for ${balloonId}`);
        return;
    }
    
    console.log(`🎈 Starting simulation for balloon ${balloonId}`);
    
    const balloon = balloons[balloonId];
    if (!balloon) {
        console.error(`❌ Balloon ${balloonId} not found`);
        return;
    }
    
    if (!balloon._cachedWind) {
        try {
            console.log(`🌤️ Getting initial wind for ${balloon.username}...`);
            const wind = await windService.getWindAtPosition(balloon.lat, balloon.lng, balloon.altitude);
            balloon._cachedWind = wind;
            balloon.speed = wind.speed;
            balloon.windDirection = wind.direction;
            balloon.layerName = wind.layerName;
            console.log(`✅ Initial wind for ${balloon.username}: ${wind.speed} m/s, ${wind.direction}°`);
            
            io.to('race-room').emit('fiesta-balloon-updated', balloon);
        } catch (error) {
            console.error(`❌ Error getting initial wind for ${balloon.username}:`, error.message);
        }
    } else {
        console.log(`📦 Using cached wind for ${balloon.username}: ${balloon._cachedWind.speed} m/s`);
    }
    
    const interval = setInterval(async () => {
        const balloon = balloons[balloonId];
        
        if (!balloon) {
            clearInterval(interval);
            simulationIntervals.delete(balloonId);
            return;
        }
        
        if (raceConfig.raceStatus !== GAME_STATES.RACING) {
            clearInterval(interval);
            simulationIntervals.delete(balloonId);
            console.log(`⏸️ Simulation stopped for ${balloonId} (status: ${raceConfig.raceStatus})`);
            return;
        }
        
        if (balloon.finished) {
            clearInterval(interval);
            simulationIntervals.delete(balloonId);
            return;
        }
        
        try {
            let wind = balloon._cachedWind;
            if (!wind || (Date.now() - wind.timestamp) > 300000) {
                console.log(`🔄 Обновление ветра для ${balloon.username}...`);
                try {
                    wind = await windService.getWindAtPosition(balloon.lat, balloon.lng, balloon.altitude);
                    balloon._cachedWind = wind;
                } catch (error) {
                    console.error(`❌ Ошибка получения ветра для ${balloon.username}:`, error.message);
                    if (!wind) {
                        console.warn(`⚠️ Нет данных о ветре для ${balloon.username}, пропускаем обновление`);
                        return;
                    }
                }
            }
            
            if (!wind) {
                console.warn(`⚠️ Нет данных о ветре для ${balloon.username}, пропускаем обновление`);
                return;
            }
            
            const speedLatPerSecond = wind.speed / 111000;
            const speedLngPerSecond = wind.speed / (111000 * Math.cos(balloon.lat * Math.PI / 180));
            const intervalSeconds = SIMULATION_INTERVAL / 1000;
            const windDirectionRad = wind.direction * Math.PI / 180;
            const moveDirectionRad = windDirectionRad + Math.PI;
            
            const latChange = Math.cos(moveDirectionRad) * speedLatPerSecond * intervalSeconds;
            const lngChange = Math.sin(moveDirectionRad) * speedLngPerSecond * intervalSeconds;
            
            balloon.lat += latChange;
            balloon.lng += lngChange;
            balloon.speed = wind.speed;
            balloon.layerName = wind.layerName || balloon.layerName || 'Default Layer';
            balloon.windDirection = wind.direction;
            balloon.lastWindUpdate = wind.timestamp;
            
            balloon.path.push({ 
                lat: balloon.lat, 
                lng: balloon.lng,
                altitude: balloon.altitude,
                timestamp: Date.now()
            });
            
            if (balloon.path.length > 200) {
                balloon.path = balloon.path.slice(-200);
            }
            
            balloon.lastUpdate = Date.now();
            
            io.to('race-room').emit('fiesta-balloon-updated', balloon);
            
            const distanceToFinish = getDistanceFromLatLonInKm(
                balloon.lat, balloon.lng,
                raceConfig.finishCoords.lat, raceConfig.finishCoords.lng
            );
            
            if (distanceToFinish < 50 && !balloon.finished) {
                balloon.finished = true;
                balloon.finishTime = Date.now();
                savePilotsToFile();
                
                io.to('race-room').emit('fiesta-message', {
                    type: 'finish',
                    message: `🎉 ПОБЕДА! ${balloon.username} достиг финиша! 🎉`,
                    balloon: balloon,
                    finishTime: balloon.finishTime
                });
                
                console.log(`🏆 Balloon ${balloon.raceNumber} (${balloon.username}) finished!`);
                
                clearInterval(interval);
                simulationIntervals.delete(balloonId);
            }
            
        } catch (error) {
            console.error(`Error in simulation for balloon ${balloonId}:`, error);
        }
        
    }, SIMULATION_INTERVAL);
    
    simulationIntervals.set(balloonId, interval);
}

function restoreSimulations() {
    console.log('🔄 Restoring simulations...');
    console.log(`📊 Current status: ${raceConfig.raceStatus}`);
    console.log(`📊 Balloons loaded: ${Object.keys(balloons).length}`);
    
    if (raceConfig.raceStatus === GAME_STATES.RACING) {
        setTimeout(() => {
            updateWeatherForAllBalloons();
        }, 1000);
        startAllSimulations();
    } else {
        console.log(`⏳ Race status is "${raceConfig.raceStatus}", waiting for start...`);
    }
}

// ============================================
// НАСТРОЙКА EXPRESS
// ============================================
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use('/images', express.static(path.join(__dirname, '../frontend/images')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'fiesta.html'));
});

app.get('/fiesta.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'fiesta.html'));
});

app.get('/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/reset-race', (req, res) => {
    console.log('🔄 Сброс гонки по запросу /reset-race');
    setRaceStatus(GAME_STATES.IDLE);
    res.send(`
        <h1>✅ Race Reset Successful!</h1>
        <p>Status: <strong>${raceConfig.raceStatus}</strong></p>
        <p><a href="/admin.html">Go to Admin Panel</a> | <a href="/fiesta.html">Go to Race</a></p>
    `);
});

app.get('/force-start-now', (req, res) => {
    if (raceConfig.raceStatus !== GAME_STATES.RACING) {
        setRaceStatus(GAME_STATES.RACING);
        res.send(`
            <h1>🏁 Race Started!</h1>
            <p>All ${Object.keys(balloons).length} balloons are now moving!</p>
            <p><a href="/fiesta.html">Go to Race</a></p>
        `);
        console.log('🏁 Race force-started via /force-start-now');
    } else {
        res.send(`
            <h1>⚠️ Race Already Started</h1>
            <p>Current status: ${raceConfig.raceStatus}</p>
            <p><a href="/fiesta.html">Go to Race</a></p>
        `);
    }
});

app.get('/sim-status', (req, res) => {
    res.json({
        status: raceConfig.raceStatus,
        balloons: Object.keys(balloons).length,
        simulations: simulationIntervals.size,
        running: simulationIntervals.size > 0
    });
});

// ============================================
// ОСНОВНАЯ ЛОГИКА SOCKET.IO
// ============================================
io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);
    
    socket.emit('fiesta-race-config', getConfigForClient());
    socket.emit('fiesta-balloon-catalog', balloonCatalog);
    socket.emit('fiesta-all-balloons', Object.values(balloons));
    socket.emit('fiesta-state-changed', {
        oldState: raceConfig.raceStatus,
        newState: raceConfig.raceStatus,
        config: getConfigForClient()
    });

    // ============================================
    // РЕГИСТРАЦИЯ НОВОГО ПИЛОТА
    // ============================================
    socket.on('fiesta-start-flight', async (data) => {
        console.log('📝 Registration attempt:', { ...data, password: '***' });

        if (raceConfig.raceStatus !== GAME_STATES.REGISTRATION) {
            socket.emit('fiesta-registration-complete', { 
                success: false,
                message: `Registration is not open. Current status: ${raceConfig.raceStatus}` 
            });
            return;
        }

        const currentPilotsCount = Object.keys(balloons).length;
        if (currentPilotsCount >= MAX_PARTICIPANTS) {
            socket.emit('fiesta-registration-complete', { 
                success: false,
                message: 'Registration closed. Maximum 10 aeronauts reached.' 
            });
            return;
        }

        const nameExists = Object.values(balloons).some(
            b => b.username.toLowerCase() === data.username.trim().toLowerCase()
        );
        if (nameExists) {
            socket.emit('fiesta-registration-complete', { 
                success: false,
                message: 'This callsign is already taken.' 
            });
            return;
        }

        const balloonExists = Object.values(balloons).some(
            b => b.balloonColor === data.balloonColor
        );
        if (balloonExists) {
            socket.emit('fiesta-registration-complete', { 
                success: false,
                message: 'This balloon design is already taken.' 
            });
            return;
        }

        if (!data.lat || !data.lng) {
            socket.emit('fiesta-registration-complete', { 
                success: false,
                message: 'Please click on map to select start position.' 
            });
            return;
        }

        if (!isInStartZone(data.lat, data.lng)) {
            socket.emit('fiesta-registration-complete', { 
                success: false,
                message: 'Start position must be within red zone on map.' 
            });
            return;
        }

        if (!isRegistrationOpen()) {
            socket.emit('fiesta-registration-complete', { 
                success: false,
                message: 'Registration window is closed.' 
            });
            return;
        }

        if (!data.password || data.password.length < 4) {
            socket.emit('fiesta-registration-complete', { 
                success: false,
                message: 'Password must be at least 4 characters.' 
            });
            return;
        }

        const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);
        console.log(`🔐 Password hashed for ${data.username}`);

        const pilotId = 'pilot_' + Math.random().toString(36).substr(2, 9);
        const raceNumber = currentPilotsCount + 1;
        const selectedBalloon = balloonCatalog[data.balloonColor] || balloonCatalog.bal1;
        
        balloons[pilotId] = {
            id: pilotId,
            socketId: socket.id,
            username: data.username.trim(),
            password: hashedPassword,
            email: data.email || '',
            balloonColor: data.balloonColor,
            balloonStyle: selectedBalloon,
            raceNumber: raceNumber,
            lat: data.lat,
            lng: data.lng,
            altitude: 1000,
            verticalSpeed: 0,
            fuel: 100,
            ballast: 4,
            finished: false,
            path: [{ lat: data.lat, lng: data.lng, altitude: 1000, timestamp: Date.now() }],
            speed: 0,
            layerName: 'Surface Layer',
            windDirection: 0,
            lastUpdate: Date.now(),
            pilotConnected: true,
            lastSeen: Date.now()
        };

        console.log(`✅ New pilot: ${data.username} (Race #${raceNumber})`);
        savePilotsToFile();
        
        socket.join('race-room');
        socketToPilot.set(socket.id, pilotId);
        socket.currentPilotId = pilotId;
        
        socket.emit('fiesta-registration-complete', { 
            success: true, 
            pilotId: pilotId,
            balloon: balloons[pilotId]
        });
        
        io.to('race-room').emit('fiesta-all-balloons', Object.values(balloons));
    });

    // ============================================
    // АУТЕНТИФИКАЦИЯ
    // ============================================
    socket.on('fiesta-auth', async (authData) => {
        console.log('🔐 Auth attempt:', { ...authData, password: '***' });
        
        if (authData.isSpectator) {
            socket.join('race-room');
            socket.emit('fiesta-auth-success', { 
                role: 'spectator',
                isSpectator: true
            });
            console.log('👤 Spectator joined');
            return;
        }
        
        if (!authData.username || !authData.password) {
            socket.emit('fiesta-auth-error', { 
                message: 'Please enter callsign and password' 
            });
            return;
        }
        
        const balloon = Object.values(balloons).find(b => 
            b.username.toLowerCase() === authData.username.trim().toLowerCase()
        );
        
        if (!balloon) {
            socket.emit('fiesta-auth-error', { 
                message: 'Invalid callsign or password' 
            });
            console.log(`❌ Auth failed: user ${authData.username} not found`);
            return;
        }
        
        const isValid = await bcrypt.compare(authData.password, balloon.password);
        
        if (isValid) {
            balloon.socketId = socket.id;
            balloon.pilotConnected = true;
            socket.currentPilotId = balloon.id;
            socketToPilot.set(socket.id, balloon.id);
            socket.join('race-room');
            
            socket.emit('fiesta-auth-success', { 
                role: 'pilot', 
                pilotId: balloon.id,
                balloon: balloon
            });
            
            console.log(`✅ Pilot ${balloon.username} authenticated successfully`);
            
            if (raceConfig.raceStatus === GAME_STATES.RACING && !simulationIntervals.has(balloon.id)) {
                startBalloonSimulation(balloon.id);
            }
            
            io.to('race-room').emit('fiesta-balloon-updated', balloon);
        } else {
            socket.emit('fiesta-auth-error', { 
                message: 'Invalid callsign or password' 
            });
            console.log(`❌ Auth failed for ${authData.username} - wrong password`);
        }
    });

    // ============================================
    // СМЕНА ПАРОЛЯ
    // ============================================
    socket.on('fiesta-change-password', async (data) => {
        if (!socket.currentPilotId || !balloons[socket.currentPilotId]) {
            socket.emit('fiesta-error', 'Not authenticated');
            return;
        }
        
        const balloon = balloons[socket.currentPilotId];
        const isValid = await bcrypt.compare(data.oldPassword, balloon.password);
        
        if (!isValid) {
            socket.emit('fiesta-error', 'Current password is incorrect');
            return;
        }
        
        if (!data.newPassword || data.newPassword.length < 4) {
            socket.emit('fiesta-error', 'New password must be at least 4 characters');
            return;
        }
        
        const hashedNewPassword = await bcrypt.hash(data.newPassword, SALT_ROUNDS);
        balloon.password = hashedNewPassword;
        savePilotsToFile();
        
        socket.emit('fiesta-password-changed', { success: true });
        console.log(`🔐 Password changed for ${balloon.username}`);
    });

    // ============================================
    // УПРАВЛЕНИЕ ВЫСОТОЙ
    // ============================================
    socket.on('fiesta-change-altitude', (data) => {
        if (!socket.currentPilotId || !balloons[socket.currentPilotId]) {
            socket.emit('fiesta-error', 'Not authenticated as pilot');
            return;
        }
        
        const balloon = balloons[socket.currentPilotId];
        const newAltitude = Math.min(Math.max(data.altitude, 0), 15000);
        balloon.altitude = newAltitude;
        
        const levelInfo = windService.getPressureLevelInfo(newAltitude);
        balloon.layerName = levelInfo.name;
        savePilotsToFile();
        
        io.to('race-room').emit('fiesta-balloon-updated', balloon);
        console.log(`📈 ${balloon.username} altitude → ${newAltitude}m`);
    });

    // ============================================
    // НОВАЯ ФУНКЦИЯ: СОХРАНЕНИЕ ПОЛНОЙ КОНФИГУРАЦИИ
    // ============================================
    socket.on('fiesta-save-full-config', (fullConfig) => {
        if (fullConfig.adminKey !== 'aerostar2024') {
            socket.emit('fiesta-error', 'Admin privileges required');
            return;
        }

        console.log('📝 Received full configuration from admin');
        let announcementSent = false;

        // 1. Обновляем правила гонки
        if (fullConfig.finishCoords) {
            raceConfig.finishCoords = { 
                lat: parseFloat(fullConfig.finishCoords.lat) || 0, 
                lng: parseFloat(fullConfig.finishCoords.lng) || 0
            };
        }

        if (fullConfig.allowedStartRegion) {
            raceConfig.allowedStartRegion = {
                minLat: parseFloat(fullConfig.allowedStartRegion.minLat) || 0,
                maxLat: parseFloat(fullConfig.allowedStartRegion.maxLat) || 0,
                minLng: parseFloat(fullConfig.allowedStartRegion.minLng) || 0,
                maxLng: parseFloat(fullConfig.allowedStartRegion.maxLng) || 0
            };
        }

        // ВАЖНО: Сохраняем длительность гонки
        if (fullConfig.raceDurationHours) {
            raceConfig.raceDurationHours = fullConfig.raceDurationHours;
            console.log(`⏱️ Race duration set to ${raceConfig.raceDurationHours} hours`);
        }

        // 2. Обновляем окно регистрации
        if (fullConfig.registrationWindowFrom && fullConfig.registrationWindowTo) {
            const fromDate = new Date(fullConfig.registrationWindowFrom);
            const toDate = new Date(fullConfig.registrationWindowTo);
            
            if (!isNaN(fromDate.getTime()) && !isNaN(toDate.getTime()) && toDate > fromDate) {
                raceConfig.registrationWindowFrom = fromDate;
                raceConfig.registrationWindowTo = toDate;
                console.log(`📝 Registration window set: ${fromDate.toUTCString()} — ${toDate.toUTCString()}`);
            } else {
                console.warn('⚠️ Invalid registration window dates, skipping');
            }
        } else {
            // Если регистрация не задана - очищаем
            raceConfig.registrationWindowFrom = new Date('1970-01-01');
            raceConfig.registrationWindowTo = new Date('1970-01-01');
            console.log('📝 Registration window cleared');
        }

        // 3. Обновляем запланированный старт
        if (fullConfig.scheduledStartTime) {
            const startTime = new Date(fullConfig.scheduledStartTime);
            if (!isNaN(startTime.getTime())) {
                const now = new Date();
                const nowUTC = new Date(now.toUTCString());
                const startUTC = new Date(startTime.toUTCString());
                
                if (startUTC > nowUTC) {
                    raceConfig.scheduledStartTime = startTime.toISOString();
                    console.log(`⏰ Scheduled start set: ${startUTC.toUTCString()}`);
                } else {
                    console.warn('⚠️ Start time is in the past, ignoring');
                    raceConfig.scheduledStartTime = null;
                }
            }
        } else {
            raceConfig.scheduledStartTime = null;
            console.log('⏰ Scheduled start cleared');
        }

        // Сохраняем конфигурацию
        saveConfigToFile();

        // 4. Проверяем, нужно ли открыть регистрацию
        const registrationOpened = checkAndOpenRegistration();

        // 5. Проверяем, нужно ли запустить гонку
        const raceStarted = checkAndStartRace();

        // 6. Отправляем объявление, если есть
        if (fullConfig.announcement && fullConfig.announcement.trim()) {
            io.to('race-room').emit('fiesta-admin-message', {
                message: fullConfig.announcement.trim(),
                timestamp: new Date().toISOString(),
                admin: 'Race Administrator'
            });
            announcementSent = true;
            console.log(`📢 Announcement sent: ${fullConfig.announcement.trim()}`);
        }

        // 7. Отправляем обновленную конфигурацию всем
        io.emit('fiesta-race-config', getConfigForClient());
        io.emit('fiesta-state-changed', {
            oldState: raceConfig.raceStatus,
            newState: raceConfig.raceStatus,
            config: getConfigForClient()
        });

        // 8. Подтверждение админу
        socket.emit('fiesta-config-saved', { 
            success: true,
            announcementSent: announcementSent,
            registrationOpened: registrationOpened,
            raceStarted: raceStarted
        });

        console.log('✅ Full configuration applied successfully');
        if (registrationOpened) console.log('📝 Registration was opened automatically');
        if (raceStarted) console.log('🏁 Race was started automatically');
    });

    // ============================================
    // СТАРЫЕ АДМИН-ФУНКЦИИ (оставляем для совместимости)
    // ============================================
    
    socket.on('fiesta-admin-set-status', (data) => {
        if (data.adminKey === 'aerostar2024') {
            const success = setRaceStatus(data.status);
            if (success) {
                socket.emit('fiesta-status-changed', { status: data.status });
                socket.emit('fiesta-config-saved', { success: true });
            } else {
                socket.emit('fiesta-error', `Cannot transition from ${raceConfig.raceStatus} to ${data.status}`);
            }
        } else {
            socket.emit('fiesta-error', 'Admin privileges required');
        }
    });

    socket.on('fiesta-admin-change-rules', (rules) => {
        if (rules.adminKey !== 'aerostar2024') {
            socket.emit('fiesta-error', 'Admin privileges required');
            return;
        }
        
        if (rules.finishCoords) {
            raceConfig.finishCoords = { 
                lat: parseFloat(rules.finishCoords.lat), 
                lng: parseFloat(rules.finishCoords.lng)
            };
        }
        
        if (rules.allowedStartRegion) {
            raceConfig.allowedStartRegion = {
                minLat: parseFloat(rules.allowedStartRegion.minLat),
                maxLat: parseFloat(rules.allowedStartRegion.maxLat),
                minLng: parseFloat(rules.allowedStartRegion.minLng),
                maxLng: parseFloat(rules.allowedStartRegion.maxLng)
            };
        }
        
        if (rules.registrationWindowFrom) {
            raceConfig.registrationWindowFrom = new Date(rules.registrationWindowFrom);
        }
        if (rules.registrationWindowTo) {
            raceConfig.registrationWindowTo = new Date(rules.registrationWindowTo);
        }
        if (rules.raceDurationHours) {
            raceConfig.raceDurationHours = rules.raceDurationHours;
        }
        if (rules.scheduledStartTime) {
            raceConfig.scheduledStartTime = rules.scheduledStartTime;
        }
        
        saveConfigToFile();
        
        io.emit('fiesta-race-config', getConfigForClient());
        io.emit('fiesta-state-changed', {
            oldState: raceConfig.raceStatus,
            newState: raceConfig.raceStatus,
            config: getConfigForClient()
        });
        
        socket.emit('fiesta-config-saved', { success: true });
        console.log('🔧 Race config updated by admin');
        
        const opened = checkAndOpenRegistration();
        if (opened) {
            io.emit('fiesta-race-config', getConfigForClient());
            io.emit('fiesta-state-changed', {
                oldState: GAME_STATES.IDLE,
                newState: GAME_STATES.REGISTRATION,
                config: getConfigForClient()
            });
        }
    });

    // ============================================
    // УСТАНОВКА ОКНА РЕГИСТРАЦИИ (устаревшая)
    // ============================================
    socket.on('fiesta-set-registration-window', (data) => {
        if (data.adminKey !== 'aerostar2024') {
            socket.emit('fiesta-error', 'Admin privileges required');
            return;
        }
        
        if (data.registrationFrom === null || data.registrationTo === null) {
            raceConfig.registrationWindowFrom = new Date('1970-01-01');
            raceConfig.registrationWindowTo = new Date('1970-01-01');
            saveConfigToFile();
            
            io.emit('fiesta-race-config', getConfigForClient());
            io.emit('fiesta-state-changed', {
                oldState: raceConfig.raceStatus,
                newState: raceConfig.raceStatus,
                config: getConfigForClient()
            });
            
            socket.emit('fiesta-registration-window-set', {
                success: true,
                registrationFrom: null,
                registrationTo: null
            });
            console.log('📝 Registration window cleared');
            return;
        }
        
        const fromDate = new Date(data.registrationFrom);
        const toDate = new Date(data.registrationTo);
        
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
            socket.emit('fiesta-error', 'Invalid registration times');
            return;
        }
        
        if (toDate <= fromDate) {
            socket.emit('fiesta-error', 'Registration close time must be after open time');
            return;
        }
        
        raceConfig.registrationWindowFrom = fromDate;
        raceConfig.registrationWindowTo = toDate;
        saveConfigToFile();
        
        const opened = checkAndOpenRegistration();
        
        io.emit('fiesta-race-config', getConfigForClient());
        io.emit('fiesta-state-changed', {
            oldState: raceConfig.raceStatus,
            newState: raceConfig.raceStatus,
            config: getConfigForClient()
        });
        
        socket.emit('fiesta-registration-window-set', {
            success: true,
            registrationFrom: fromDate.toISOString(),
            registrationTo: toDate.toISOString(),
            opened: opened
        });
        
        if (opened) {
            console.log(`📝 Registration opened immediately`);
        } else {
            console.log(`📝 Registration window set: ${fromDate.toUTCString()} — ${toDate.toUTCString()}`);
            console.log(`⏰ Registration will open at ${fromDate.toUTCString()}`);
        }
    });

    // ============================================
    // УСТАНОВКА СТАРТА ГОНКИ (устаревшая)
    // ============================================
    socket.on('fiesta-set-scheduled-start', (data) => {
        if (data.adminKey !== 'aerostar2024') {
            socket.emit('fiesta-error', 'Admin privileges required');
            return;
        }
        
        if (data.startTime === null) {
            raceConfig.scheduledStartTime = null;
            saveConfigToFile();
            
            io.emit('fiesta-race-config', getConfigForClient());
            io.emit('fiesta-state-changed', {
                oldState: raceConfig.raceStatus,
                newState: raceConfig.raceStatus,
                config: getConfigForClient()
            });
            
            socket.emit('fiesta-scheduled-start-set', {
                success: true,
                startTime: null
            });
            console.log('⏰ Scheduled start cancelled');
            return;
        }
        
        const startTime = new Date(data.startTime);
        if (isNaN(startTime.getTime())) {
            socket.emit('fiesta-error', 'Invalid start time');
            return;
        }
        
        const now = new Date();
        const nowUTC = new Date(now.toUTCString());
        const startUTC = new Date(startTime.toUTCString());
        
        if (startUTC <= nowUTC) {
            socket.emit('fiesta-error', 'Start time must be in the future (UTC)');
            return;
        }
        
        raceConfig.scheduledStartTime = startTime.toISOString();
        if (data.duration) {
            raceConfig.raceDurationHours = data.duration;
        }
        saveConfigToFile();
        
        io.emit('fiesta-race-config', getConfigForClient());
        io.emit('fiesta-state-changed', {
            oldState: raceConfig.raceStatus,
            newState: raceConfig.raceStatus,
            config: getConfigForClient()
        });
        
        socket.emit('fiesta-scheduled-start-set', {
            success: true,
            startTime: startTime.toISOString()
        });
        
        console.log(`⏰ Scheduled race start at ${startUTC.toUTCString()}`);
    });

    socket.on('fiesta-force-race-start', () => {
        if (raceConfig.raceStatus === GAME_STATES.REGISTRATION) {
            setRaceStatus(GAME_STATES.RACING);
            io.to('race-room').emit('fiesta-race-started', { 
                message: "🏁 АДМИНИСТРАТОР ЗАПУСТИЛ ГОНКУ! 🏁",
                timestamp: new Date(),
                forced: true
            });
            console.log("🏁 Race force-started by admin");
            socket.emit('fiesta-config-saved', { success: true });
        } else {
            socket.emit('fiesta-error', `Cannot start race from ${raceConfig.raceStatus} state`);
        }
    });

    socket.on('fiesta-force-race-finish', () => {
        if (raceConfig.raceStatus === GAME_STATES.RACING) {
            setRaceStatus(GAME_STATES.FINISHED);
            io.to('race-room').emit('fiesta-race-finished', {
                message: "🏁 АДМИНИСТРАТОР ЗАВЕРШИЛ ГОНКУ! 🏁",
                timestamp: new Date(),
                forced: true
            });
            console.log("🏁 Race force-finished by admin");
            socket.emit('fiesta-config-saved', { success: true });
        } else {
            socket.emit('fiesta-error', `Cannot finish race from ${raceConfig.raceStatus} state`);
        }
    });

    socket.on('fiesta-admin-announcement', (data) => {
        io.to('race-room').emit('fiesta-admin-message', {
            message: data.message,
            timestamp: new Date().toISOString(),
            admin: 'Race Administrator'
        });
        console.log(`📢 Admin: ${data.message}`);
    });
    
    socket.on('fiesta-get-participants', () => {
        socket.emit('fiesta-all-balloons', Object.values(balloons));
    });
    
    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
        
        if (socket.currentPilotId && balloons[socket.currentPilotId]) {
            const balloon = balloons[socket.currentPilotId];
            balloon.pilotConnected = false;
            balloon.lastSeen = Date.now();
            
            console.log(`📡 Pilot ${balloon.username} disconnected`);
            
            io.to('race-room').emit('fiesta-pilot-disconnected', {
                pilotId: socket.currentPilotId,
                username: balloon.username
            });
        }
        
        socketToPilot.delete(socket.id);
    });
});

// ============================================
// ЗАПУСК СЕРВЕРА
// ============================================

console.log('🔄 Initializing server in IDLE state...');
raceConfig.raceStatus = GAME_STATES.IDLE;
raceConfig.scheduledStartTime = null;
raceConfig.registrationWindowFrom = new Date('1970-01-01');
raceConfig.registrationWindowTo = new Date('1970-01-01');
raceConfig.raceStartDateTime = new Date('1970-01-01');
raceConfig.raceEndTime = null;
balloons = {};
saveConfigToFile();
savePilotsToFile();

loadConfig();
loadPilotsFromFile();

// Проверяем, нужно ли открыть регистрацию при запуске
checkAndOpenRegistration();

setTimeout(() => {
    restoreSimulations();
}, 2000);

// ============================================
// ГЛОБАЛЬНЫЕ ИНТЕРВАЛЫ
// ============================================

// Автоматическое открытие регистрации - проверка каждые 10 секунд
setInterval(() => {
    checkAndOpenRegistration();
}, 10000);

// Автоматический старт гонки - проверка каждые 10 секунд
setInterval(() => {
    checkAndStartRace();
}, 10000);

// Автоматическая проверка окончания гонки - каждые 10 секунд
setInterval(() => {
    if (raceConfig.raceStatus === GAME_STATES.RACING && isRaceTimeExpired()) {
        setRaceStatus(GAME_STATES.FINISHED);
        io.emit('fiesta-race-finished', {
            message: `🏁 Время гонки истекло! (${raceConfig.raceDurationHours} часов) Спасибо за участие! 🏁`,
            timestamp: new Date()
        });
        console.log(`🏁 Race finished automatically after ${raceConfig.raceDurationHours} hours (UTC)`);
    }
}, 10000); // Проверка каждые 10 секунд для точности

// Обновление ветра
setInterval(() => {
    if (raceConfig.raceStatus === GAME_STATES.RACING && Object.keys(balloons).length > 0) {
        updateWeatherForAllBalloons();
    }
}, 60000);

// Периодическое сохранение пилотов
setInterval(() => {
    if (Object.keys(balloons).length > 0) {
        savePilotsToFile();
    }
}, 30000);

// Запуск сервера
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎮 Fiesta Game Server running on port ${PORT}`);
    console.log(`📍 Race page: http://localhost:${PORT}/fiesta.html`);
    console.log(`📝 Register page: http://localhost:${PORT}/register.html`);
    console.log(`🔧 Admin page: http://localhost:${PORT}/admin.html`);
    console.log(`👥 Max participants: ${MAX_PARTICIPANTS}`);
    console.log(`🏁 Race status: ${raceConfig.raceStatus}`);
    console.log(`🎯 Finish: ${raceConfig.finishCoords.lat}, ${raceConfig.finishCoords.lng}`);
    console.log(`⏱️ Race duration: ${raceConfig.raceDurationHours} hours`);
    if (raceConfig.registrationWindowFrom && raceConfig.registrationWindowFrom.getTime() !== new Date('1970-01-01').getTime()) {
        console.log(`📝 Registration window: ${raceConfig.registrationWindowFrom.toUTCString()} — ${raceConfig.registrationWindowTo.toUTCString()}`);
    }
    if (raceConfig.scheduledStartTime) {
        console.log(`⏰ Scheduled start: ${new Date(raceConfig.scheduledStartTime).toUTCString()}`);
    }
    if (raceConfig.raceEndTime) {
        console.log(`🏁 Race end time: ${raceConfig.raceEndTime.toUTCString()}`);
    }
    console.log(`👥 Pilots: ${Object.keys(balloons).length}`);
});
