/**
 * ГЛАВНЫЙ ИГРОВОЙ СЕРВЕР «ФИЕСТА» (Порт 3001)
 * Версия 3.3 - с оптимизированными интервалами и кэшированием
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

// Подключаем модули
const balloonCatalog = require('./balloonCatalog');
const windService = require('./windService');

const app = express();
const server = http.createServer(app);

// Инициализируем сокеты
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true
});

const PORT = 3001;
const CONFIG_FILE = path.join(__dirname, 'race-config.json');
const PILOTS_FILE = path.join(__dirname, 'pilots.json');
const MAX_PARTICIPANTS = 10;
const SIMULATION_INTERVAL = 30000; // 30 секунд (было 5000)
const SALT_ROUNDS = 10;

// Данные игры
let raceConfig = {
    finishCoords: { lat: 48.8566, lng: 2.3522 },
    allowedStartRegion: {
        minLat: 25,
        maxLat: 50,
        minLng: -120,
        maxLng: -70
    },
    registrationWindowFrom: new Date('2024-06-01'),
    registrationWindowTo: new Date('2024-12-31'),
    raceStartDateTime: new Date('2024-12-31T12:00:00'),
    maxParticipants: MAX_PARTICIPANTS,
    raceStarted: false,
    raceFinished: false,
    raceDurationHours: 24,
    raceStatus: 'idle' // idle | registration | racing | finished
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
                registrationWindowFrom: saved.registrationWindowFrom ? new Date(saved.registrationWindowFrom) : raceConfig.registrationWindowFrom,
                registrationWindowTo: saved.registrationWindowTo ? new Date(saved.registrationWindowTo) : raceConfig.registrationWindowTo,
                raceStartDateTime: saved.raceStartDateTime ? new Date(saved.raceStartDateTime) : raceConfig.raceStartDateTime,
                raceStatus: saved.raceStatus || 'idle'
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
        raceStatus: raceConfig.raceStatus
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2));
}

// ============================================
// УПРАВЛЕНИЕ СТАТУСАМИ
// ============================================
function setRaceStatus(status) {
    const validStatuses = ['idle', 'registration', 'racing', 'finished'];
    if (!validStatuses.includes(status)) {
        console.error(`❌ Invalid status: ${status}`);
        return false;
    }
    
    raceConfig.raceStatus = status;
    
    switch (status) {
        case 'idle':
            raceConfig.raceStarted = false;
            raceConfig.raceFinished = false;
            // Закрываем регистрацию
            raceConfig.registrationWindowFrom = new Date('1970-01-01');
            raceConfig.registrationWindowTo = new Date('1970-01-01');
            // Останавливаем все симуляции
            stopAllSimulations();
            break;
        case 'registration':
            raceConfig.raceStarted = false;
            raceConfig.raceFinished = false;
            // Открываем регистрацию на 7 дней
            raceConfig.registrationWindowFrom = new Date();
            raceConfig.registrationWindowTo = new Date();
            raceConfig.registrationWindowTo.setDate(raceConfig.registrationWindowTo.getDate() + 7);
            stopAllSimulations();
            break;
        case 'racing':
            raceConfig.raceStarted = true;
            raceConfig.raceFinished = false;
            // Закрываем регистрацию
            raceConfig.registrationWindowTo = new Date();
            // Запускаем симуляцию для всех шаров
            startAllSimulations();
            break;
        case 'finished':
            raceConfig.raceStarted = false;
            raceConfig.raceFinished = true;
            // Останавливаем все симуляции
            stopAllSimulations();
            break;
    }
    
    saveConfigToFile();
    console.log(`📊 Race status changed to: ${status}`);
    return true;
}

function startAllSimulations() {
    console.log('🚀 Starting simulations for all balloons...');
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
        raceStatus: raceConfig.raceStatus
    };
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
            lastUpdate: balloon.lastUpdate || Date.now()
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
                    path: [],
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
// ОБНОВЛЕНИЕ ВЕТРА ДЛЯ ВСЕХ ШАРОВ
// ============================================
async function updateWeatherForAllBalloons() {
    const balloonIds = Object.keys(balloons);
    if (balloonIds.length === 0) return;
    
    console.log(`🌤️ Обновление погоды для ${balloonIds.length} шаров...`);
    
    // Обновляем ветер для каждого шара
    for (const id of balloonIds) {
        const balloon = balloons[id];
        if (!balloon || balloon.finished) continue;
        
        try {
            const wind = await windService.getWindAtPosition(balloon.lat, balloon.lng, balloon.altitude);
            // Сохраняем ветер в шаре для использования в симуляции
            balloon._cachedWind = wind;
            console.log(`🌤️ Ветер для ${balloon.username}: ${wind.speed} м/с, ${wind.direction}°`);
        } catch (error) {
            console.error(`❌ Ошибка получения ветра для ${balloon.username}:`, error.message);
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

function isRegistrationOpen() {
    const now = new Date();
    return now >= raceConfig.registrationWindowFrom && now <= raceConfig.registrationWindowTo;
}

function isRaceStarted() {
    const now = new Date();
    return now >= raceConfig.raceStartDateTime;
}

function isRaceTimeExpired() {
    if (!raceConfig.raceStarted) return false;
    const now = new Date();
    const raceEndTime = new Date(raceConfig.raceStartDateTime);
    raceEndTime.setHours(raceEndTime.getHours() + raceConfig.raceDurationHours);
    return now >= raceEndTime;
}

function checkAndFinishRaceByTime() {
    if (raceConfig.raceStatus === 'racing' && isRaceTimeExpired()) {
        setRaceStatus('finished');
        io.emit('fiesta-race-finished', {
            message: "🏁 Время гонки истекло! Спасибо за участие! 🏁",
            timestamp: new Date()
        });
        console.log("🏁 Race finished automatically due to time limit");
    }
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
// СИМУЛЯЦИЯ ДВИЖЕНИЯ ШАРА (С ИСПОЛЬЗОВАНИЕМ КЭШИРОВАННОГО ВЕТРА)
// ============================================
async function startBalloonSimulation(balloonId) {
    if (simulationIntervals.has(balloonId)) {
        console.log(`⏭️ Simulation already running for ${balloonId}`);
        return;
    }
    
    console.log(`🎈 Starting simulation for balloon ${balloonId}`);
    
    const interval = setInterval(async () => {
        const balloon = balloons[balloonId];
        
        if (!balloon) {
            clearInterval(interval);
            simulationIntervals.delete(balloonId);
            return;
        }
        
        if (raceConfig.raceStatus !== 'racing') {
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
            // Используем кэшированный ветер или запрашиваем новый
            let wind = balloon._cachedWind;
            if (!wind) {
                console.log(`🔄 Нет кэшированного ветра для ${balloon.username}, запрашиваю...`);
                wind = await windService.getWindAtPosition(balloon.lat, balloon.lng, balloon.altitude);
                balloon._cachedWind = wind;
            }
            
            // Расчёт движения
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
            balloon.layerName = wind.layerName;
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

// ============================================
// ВОССТАНОВЛЕНИЕ СИМУЛЯЦИИ ПРИ СТАРТЕ
// ============================================
function restoreSimulations() {
    console.log('🔄 Restoring simulations...');
    console.log(`📊 Current status: ${raceConfig.raceStatus}`);
    console.log(`📊 Balloons loaded: ${Object.keys(balloons).length}`);
    
    if (raceConfig.raceStatus === 'racing') {
        // Сначала обновляем погоду для всех шаров
        setTimeout(() => {
            updateWeatherForAllBalloons();
        }, 1000);
        
        // Затем запускаем симуляции
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

// Секретные эндпоинты
app.get('/reset-race', (req, res) => {
    console.log('🔄 Сброс гонки по запросу /reset-race');
    setRaceStatus('idle');
    res.send(`
        <h1>✅ Race Reset Successful!</h1>
        <p>Status: <strong>${raceConfig.raceStatus}</strong></p>
        <p><a href="/admin.html">Go to Admin Panel</a> | <a href="/fiesta.html">Go to Race</a></p>
    `);
});

app.get('/force-start-now', (req, res) => {
    if (raceConfig.raceStatus !== 'racing') {
        setRaceStatus('racing');
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
    
    // Отправляем конфигурацию новому клиенту
    socket.emit('fiesta-race-config', getConfigForClient());
    socket.emit('fiesta-balloon-catalog', balloonCatalog);
    socket.emit('fiesta-all-balloons', Object.values(balloons));
    
    // ============================================
    // РЕГИСТРАЦИЯ НОВОГО ПИЛОТА
    // ============================================
    socket.on('fiesta-start-flight', async (data) => {
        console.log('📝 Registration attempt:', { ...data, password: '***' });

        if (raceConfig.raceStatus !== 'registration' && raceConfig.raceStatus !== 'idle') {
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

        if (raceConfig.raceStatus === 'racing') {
            socket.emit('fiesta-registration-complete', { 
                success: false,
                message: 'Race has already started!' 
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
        const selectedBalloon = balloonCatalog[data.balloonColor] || balloonCatalog.classic;
        
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

        console.log(`✅ New pilot: ${data.username} (Race #${raceNumber}) - Password hashed`);
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
        
        // Если гонка уже идёт - запускаем симуляцию
        if (raceConfig.raceStatus === 'racing') {
            startBalloonSimulation(pilotId);
        }
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
            
            // Если гонка идёт, но симуляция не запущена - запускаем
            if (raceConfig.raceStatus === 'racing' && !simulationIntervals.has(balloon.id)) {
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
    // АДМИНИСТРАТОРСКИЕ ФУНКЦИИ
    // ============================================
    socket.on('fiesta-admin-change-rules', (rules) => {
        if (rules.adminKey === 'aerostar2024') {
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
            if (rules.raceStartDateTime) {
                raceConfig.raceStartDateTime = new Date(rules.raceStartDateTime);
                raceConfig.raceStarted = false;
            }
            if (rules.raceDurationHours) {
                raceConfig.raceDurationHours = rules.raceDurationHours;
            }
            
            saveConfigToFile();
            
            io.to('race-room').emit('fiesta-race-config', getConfigForClient());
            socket.emit('fiesta-config-saved', { success: true });
            console.log('🔧 Race config updated by admin');
        } else {
            socket.emit('fiesta-error', 'Admin privileges required');
        }
    });
    
    socket.on('fiesta-admin-set-status', (data) => {
        if (data.adminKey === 'aerostar2024') {
            const success = setRaceStatus(data.status);
            if (success) {
                socket.emit('fiesta-status-changed', { status: data.status });
                io.to('race-room').emit('fiesta-race-config', getConfigForClient());
                socket.emit('fiesta-config-saved', { success: true });
            } else {
                socket.emit('fiesta-error', 'Invalid status');
            }
        } else {
            socket.emit('fiesta-error', 'Admin privileges required');
        }
    });
    
    socket.on('fiesta-force-race-start', () => {
        if (raceConfig.raceStatus !== 'racing') {
            setRaceStatus('racing');
            io.to('race-room').emit('fiesta-race-started', { 
                message: "🏁 АДМИНИСТРАТОР ЗАПУСТИЛ ГОНКУ! 🏁",
                timestamp: new Date(),
                forced: true
            });
            console.log("🏁 Race force-started by admin");
            socket.emit('fiesta-config-saved', { success: true });
        }
    });
    
    socket.on('fiesta-force-race-finish', () => {
        if (raceConfig.raceStatus !== 'finished') {
            setRaceStatus('finished');
            io.to('race-room').emit('fiesta-race-finished', {
                message: "🏁 АДМИНИСТРАТОР ЗАВЕРШИЛ ГОНКУ! 🏁",
                timestamp: new Date(),
                forced: true
            });
            console.log("🏁 Race force-finished by admin");
            socket.emit('fiesta-config-saved', { success: true });
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

loadConfig();
loadPilotsFromFile();

// Восстанавливаем симуляции
setTimeout(() => {
    restoreSimulations();
}, 2000);

// Периодическое обновление ветра для всех шаров (каждые 60 секунд)
setInterval(() => {
    if (raceConfig.raceStatus === 'racing' && Object.keys(balloons).length > 0) {
        updateWeatherForAllBalloons();
    }
}, 60000); // 1 минута

// Автоматическая проверка окончания гонки
setInterval(checkAndFinishRaceByTime, 60000);

// Автоматический старт по расписанию
setInterval(() => {
    if (raceConfig.raceStatus !== 'racing' && 
        raceConfig.raceStatus !== 'finished' &&
        isRaceStarted() && 
        !raceConfig.raceFinished) {
        setRaceStatus('racing');
        io.to('race-room').emit('fiesta-race-started', { 
            message: "🏁 ГОНКА НАЧАЛАСЬ АВТОМАТИЧЕСКИ! 🏁",
            timestamp: raceConfig.raceStartDateTime
        });
        console.log("🏁 Race started automatically!");
    }
}, 1000);

// Периодическое сохранение пилотов (каждые 30 секунд)
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
    console.log(`🏁 Race start: ${raceConfig.raceStartDateTime.toLocaleString()}`);
    console.log(`🎯 Finish: ${raceConfig.finishCoords.lat}, ${raceConfig.finishCoords.lng}`);
});
