/**
 * ГЛАВНЫЙ ИГРОВОЙ СЕРВЕР «ФИЕСТА» (Порт 3001)
 * Версия 3.0 - с поддержкой комнат и идентификации пилотов
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Подключаем модули
const dbModule = require('./database');
const gameEngine = require('./engine');
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
const MAX_PARTICIPANTS = 7;
const SIMULATION_INTERVAL = 5000;

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
    raceDurationHours: 24
};

let balloons = {};
let nextRaceNumber = 1;
let simulationIntervals = new Map();

// Хранилище соответствия socket.id -> pilotId
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
                raceStartDateTime: saved.raceStartDateTime ? new Date(saved.raceStartDateTime) : raceConfig.raceStartDateTime
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
        raceDurationHours: raceConfig.raceDurationHours
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2));
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================
function isInStartZone(lat, lng) {
    if (!raceConfig.allowedStartRegion) return true;
    const zone = raceConfig.allowedStartRegion;
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
    if (raceConfig.raceStarted && !raceConfig.raceFinished && isRaceTimeExpired()) {
        raceConfig.raceFinished = true;
        saveConfigToFile();
        
        for (const [id, interval] of simulationIntervals) {
            clearInterval(interval);
        }
        simulationIntervals.clear();
        
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
// СИМУЛЯЦИЯ ДВИЖЕНИЯ ШАРА
// ============================================
async function startBalloonSimulation(balloonId) {
    console.log(`🎈 Starting simulation for balloon ${balloonId}`);
    
    const interval = setInterval(async () => {
        const balloon = balloons[balloonId];
        
        if (!balloon) {
            clearInterval(interval);
            simulationIntervals.delete(balloonId);
            return;
        }
        
        if (!raceConfig.raceStarted && isRaceStarted()) {
            raceConfig.raceStarted = true;
            saveConfigToFile();
            io.emit('fiesta-race-started', { 
                message: "🏁 ГОНКА НАЧАЛАСЬ! Все шары в движении! 🏁",
                timestamp: raceConfig.raceStartDateTime
            });
            console.log("🏁 Race has started!");
        }
        
        checkAndFinishRaceByTime();
        
        if (!raceConfig.raceStarted || raceConfig.raceFinished) {
            return;
        }
        
        try {
            const wind = await windService.getWindAtPosition(balloon.lat, balloon.lng, balloon.altitude);
            
            const speedLatPerSecond = wind.speed / 111000;
            const speedLngPerSecond = wind.speed / (111000 * Math.cos(balloon.lat * Math.PI / 180));
            const intervalSeconds = SIMULATION_INTERVAL / 1000;
            const windDirectionRad = wind.direction * Math.PI / 180;
            const moveDirectionRad = windDirectionRad + Math.PI;
            
            const latChange = Math.cos(moveDirectionRad) * speedLatPerSecond * intervalSeconds;
            const lngChange = Math.sin(moveDirectionRad) * speedLngPerSecond * intervalSeconds;
            
            balloon.lat += latChange;
            balloon.lng += lngChange;
            balloon.speed = wind.speed * 3.6;
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
            
            // Отправляем обновление ВСЕМ в комнате гонки
            io.to('race-room').emit('fiesta-balloon-updated', balloon);
            
            const distanceToFinish = getDistanceFromLatLonInKm(
                balloon.lat, balloon.lng,
                raceConfig.finishCoords.lat, raceConfig.finishCoords.lng
            );
            
            if (distanceToFinish < 50 && !balloon.finished) {
                balloon.finished = true;
                balloon.finishTime = Date.now();
                
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
// НАСТРОЙКА EXPRESS
// ============================================
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'fiesta.html'));
});

// ============================================
// ОСНОВНАЯ ЛОГИКА SOCKET.IO
// ============================================
io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);
    let currentPilotId = null;
    
    // Отправляем конфигурацию новому клиенту
    socket.emit('fiesta-race-config', {
        finishCoords: raceConfig.finishCoords,
        allowedStartRegion: raceConfig.allowedStartRegion,
        registrationWindowFrom: raceConfig.registrationWindowFrom,
        registrationWindowTo: raceConfig.registrationWindowTo,
        raceStartDateTime: raceConfig.raceStartDateTime,
        maxParticipants: raceConfig.maxParticipants,
        raceStarted: raceConfig.raceStarted,
        raceFinished: raceConfig.raceFinished
    });
    
    socket.emit('fiesta-balloon-catalog', balloonCatalog);
    socket.emit('fiesta-all-balloons', Object.values(balloons));
    
   
   // ============================================
// АУТЕНТИФИКАЦИЯ (ВХОД ПИЛОТА ПО ЛОГИНУ И ПАРОЛЮ ИЛИ ЗРИТЕЛЯ)
// ============================================
socket.on('fiesta-auth', (authData) => {
    // 1. Поиск пилота по username и сверка пароля (используем email)
    if (!authData.isSpectator && authData.username) {
        const balloon = Object.values(balloons).find(b => 
            b.username.toLowerCase() === authData.username.trim().toLowerCase()
        );

        if (balloon && balloon.email === authData.password) {
            // Успешная авторизация, привязка сокета
            balloon.socketId = socket.id;
            // ... (дальнейшая логика авторизации)
            socket.emit('fiesta-auth-success', { role: 'pilot', pilotId: balloon.id });
        } else {
            socket.emit('fiesta-auth-error', { message: 'Ошибка авторизации' });
        }
    } else {
        // Вход зрителя
        socket.join('race-room');
        socket.emit('fiesta-auth-success', { role: 'spectator' });
    }
});

    
        // =========================================================================
    // РЕГИСТРАЦИЯ И СТАРТ НОВОГО АЭРОНАВТА (МАКСИМУМ 7 УЧАСТНИКОВ)
    // =========================================================================
    socket.on('fiesta-start-flight', (data) => {
        console.log('📝 Received registration attempt:', data);

        // 1. Проверяем лимит участников (максимум 7)
        const currentPilotsCount = Object.keys(balloons).length;
        if (currentPilotsCount >= 10) {
            console.log('❌ Registration rejected: limit of 10 players reached.');
            socket.emit('fiesta-registration-error', { 
                message: 'Registration is closed. The maximum limit of 10 aeronauts has been reached.' 
            });
            return;
        }

        // 2. Проверяем уникальность имени пилота (Username)
        const nameExists = Object.values(balloons).some(
            b => b.username.toLowerCase() === data.username.trim().toLowerCase()
        );
        if (nameExists) {
            console.log(`❌ Registration rejected: Name "${data.username}" is already taken.`);
            socket.emit('fiesta-registration-error', { 
                message: 'This aeronaut name is already registered. Please choose another name.' 
            });
            return;
        }

        // 3. Проверяем уникальность выбранного шара (Balloon Style / Color)
        const balloonExists = Object.values(balloons).some(
            b => b.balloonColor === data.balloonColor
        );
        if (balloonExists) {
            console.log(`❌ Registration rejected: Balloon texture "${data.balloonColor}" is already selected.`);
            socket.emit('fiesta-registration-error', { 
                message: 'This balloon design is already taken by another aeronaut. Please select a different balloon.' 
            });
            return;
        }

        // 4. Если все проверки пройдены успешно — создаем пилота (оригинальная логика)
        const pilotId = 'pilot_' + Math.random().toString(36).substr(2, 9);
        
        balloons[pilotId] = {
            id: pilotId,
            socketId: socket.id,
            username: data.username.trim(),
            email: data.email, // Используется как пароль для входа в Гондолу
            balloonColor: data.balloonColor,
            lat: currentConfig.startCoords.lat,
            lng: currentConfig.startCoords.lng,
            altitude: 0,
            verticalSpeed: 0,
            fuel: 100,
            ballast: 4,
            isFinished: false,
            trajectory: [[currentConfig.startCoords.lat, currentConfig.startCoords.lng]]
        };

        console.log(`🎉 Success! Aeronaut registered. ID: ${pilotId}`);
        
        // Отправляем успешный статус и ID пилота для сохранения
        socket.emit('fiesta-start-success', { pilotId: pilotId, username: data.username });
        
        // Обновляем карту для всех участников
        io.emit('fiesta-all-balloons', balloons);
    });

    
    // ============================================
    // УПРАВЛЕНИЕ ШАРОМ (только для пилота)
    // ============================================
    socket.on('fiesta-change-altitude', (data) => {
        // Проверяем, что этот сокет принадлежит пилоту
        if (!currentPilotId || !balloons[currentPilotId]) {
            socket.emit('fiesta-error', 'Not authenticated as pilot');
            return;
        }
        
        const balloon = balloons[currentPilotId];
        const newAltitude = Math.min(Math.max(data.altitude, 0), 15000);
        balloon.altitude = newAltitude;
        
        const levelInfo = windService.getPressureLevelInfo(newAltitude);
        balloon.layerName = levelInfo.name;
        
        // Отправляем обновление всем в комнате гонки
        io.to('race-room').emit('fiesta-balloon-updated', balloon);
        console.log(`📈 Pilot ${balloon.username} changed altitude to ${newAltitude}m`);
    });
    
    // ============================================
    // АДМИНИСТРАТОРСКИЕ ФУНКЦИИ
    // ============================================
    socket.on('fiesta-admin-change-rules', (rules) => {
        // Проверка прав администратора (можно расширить)
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
            
            io.to('race-room').emit('fiesta-race-config', {
                finishCoords: raceConfig.finishCoords,
                allowedStartRegion: raceConfig.allowedStartRegion,
                registrationWindowFrom: raceConfig.registrationWindowFrom,
                registrationWindowTo: raceConfig.registrationWindowTo,
                raceStartDateTime: raceConfig.raceStartDateTime,
                maxParticipants: raceConfig.maxParticipants,
                raceStarted: raceConfig.raceStarted,
                raceFinished: raceConfig.raceFinished
            });
            
            socket.emit('fiesta-config-saved', { success: true });
            console.log('🔧 Race config updated by admin');
        } else {
            socket.emit('fiesta-error', 'Admin privileges required');
        }
    });
    
    socket.on('fiesta-force-race-start', () => {
        if (!raceConfig.raceStarted) {
            raceConfig.raceStarted = true;
            saveConfigToFile();
            
            io.to('race-room').emit('fiesta-race-started', { 
                message: "🏁 АДМИНИСТРАТОР ЗАПУСТИЛ ГОНКУ! Всем удачи! 🏁",
                timestamp: new Date(),
                forced: true
            });
            
            console.log("🏁 Race force-started by admin");
            socket.emit('fiesta-config-saved', { success: true });
        }
    });
    
    socket.on('fiesta-force-race-finish', () => {
        if (!raceConfig.raceFinished) {
            raceConfig.raceFinished = true;
            saveConfigToFile();
            
            for (const [id, interval] of simulationIntervals) {
                clearInterval(interval);
            }
            simulationIntervals.clear();
            
            io.to('race-room').emit('fiesta-race-finished', {
                message: "🏁 АДМИНИСТРАТОР ЗАВЕРШИЛ ГОНКУ! Спасибо за участие! 🏁",
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
        console.log(`📢 Admin announcement: ${data.message}`);
    });
    
    // ============================================
    // ВСПОМОГАТЕЛЬНЫЕ СОБЫТИЯ
    // ============================================
    socket.on('fiesta-get-participants', () => {
        socket.emit('fiesta-all-balloons', Object.values(balloons));
    });
    
    // ============================================
    // ОТКЛЮЧЕНИЕ
    // ============================================
    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
        
        if (currentPilotId && balloons[currentPilotId]) {
            const balloon = balloons[currentPilotId];
            balloon.pilotConnected = false;
            balloon.lastSeen = Date.now();
            
            console.log(`📡 Pilot ${balloon.username} disconnected, but balloon #${balloon.raceNumber} continues flying`);
            
            io.to('race-room').emit('fiesta-pilot-disconnected', {
                pilotId: currentPilotId,
                username: balloon.username
            });
            
            // НЕ удаляем шар!
        }
        
        socketToPilot.delete(socket.id);
    });
});

// ============================================
// ЗАПУСК СЕРВЕРА
// ============================================
loadConfig();
setInterval(checkAndFinishRaceByTime, 60000);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🎮 Fiesta Game Server running on port ${PORT}`);
    console.log(`📍 Race page: http://localhost:${PORT}/fiesta.html`);
    console.log(`📝 Register page: http://localhost:${PORT}/register.html`);
    console.log(`🔧 Admin page: http://localhost:${PORT}/admin.html`);
    console.log(`👥 Max participants: ${MAX_PARTICIPANTS}`);
    console.log(`🏁 Race start time: ${raceConfig.raceStartDateTime.toLocaleString()}`);
    console.log(`🎯 Finish: ${raceConfig.finishCoords.lat}, ${raceConfig.finishCoords.lng}`);
    if (raceConfig.allowedStartRegion) {
        console.log(`🗺️ Start region: ${raceConfig.allowedStartRegion.minLat}°-${raceConfig.allowedStartRegion.maxLat}°, ${raceConfig.allowedStartRegion.minLng}°-${raceConfig.allowedStartRegion.maxLng}°`);
    }
    console.log(`🌬️ Wind service: ACTIVE`);
    console.log(`⏱️ Simulation interval: ${SIMULATION_INTERVAL/1000} seconds`);
});
