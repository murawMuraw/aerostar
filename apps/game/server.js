/**
 * ГЛАВНЫЙ ИГРОВОЙ СЕРВЕР «ФИЕСТА» (Порт 3001)
 * Управляет сессиями пилотов, выбором уникальных шаров и бортовых номеров,
 * сокетами трансляции гонки и фоновым движком симуляции.
 * 
 * Версия 2.0:
 * - Удалена зона старта круг
 * - Окно старта заменено на окно регистрации участников
 * - Добавлена точная дата и время старта гонки
 * - Интегрирован реальный сервис ветров
 * - Добавлена прямоугольная зона старта (allowedStartRegion)
 * - ИСПРАВЛЕНИЕ: Шар больше не удаляется при отключении пилота (ни до, ни после старта)
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

// Подключаем изолированные игровые модули и физический движок
const dbModule = require('./database');
const gameEngine = require('./engine');
const balloonCatalog = require('./balloonCatalog');
const windService = require('./windService');

const app = express();
const server = http.createServer(app);

// Инициализируем сокеты с поддержкой CORS и HTTP polling
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true
});

const PORT = 3001;

// Настраиваем Express на раздачу статических файлов игрового фронтенда (папка public)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Файл для сохранения конфигурации гонки
const CONFIG_FILE = path.join(__dirname, 'race-config.json');

// Максимальное количество участников
const MAX_PARTICIPANTS = 7;

// Интервал симуляции (мс)
const SIMULATION_INTERVAL = 5000; // 5 секунд

// Данные игры
let raceConfig = {
    finishCoords: { lat: 48.8566, lng: 2.3522 }, // Париж по умолчанию
    allowedStartRegion: {  // Прямоугольная зона старта
        minLat: 25,
        maxLat: 50,
        minLng: -120,
        maxLng: -70
    },
    registrationWindowFrom: new Date('2024-06-01'), // Начало регистрации
    registrationWindowTo: new Date('2024-12-31'),   // Конец регистрации
    raceStartDateTime: new Date('2024-12-31T12:00:00'), // Точная дата и время старта гонки
    maxParticipants: MAX_PARTICIPANTS,
    raceStarted: false, // Флаг начала гонки
    raceFinished: false,  // Флаг окончания гонки
    raceDurationHours: 24 // ДОБАВЛЕНО: Длительность гонки в часах (для автоматического завершения)
};

let balloons = {};
let nextRaceNumber = 1;
let simulationIntervals = new Map(); // Хранилище интервалов симуляции для каждого шара

// Загрузка конфигурации из файла
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
            console.log(`   Registration window: ${raceConfig.registrationWindowFrom.toLocaleString()} - ${raceConfig.registrationWindowTo.toLocaleString()}`);
            console.log(`   Race start time: ${raceConfig.raceStartDateTime.toLocaleString()}`);
            console.log(`   Finish location: ${raceConfig.finishCoords.lat}, ${raceConfig.finishCoords.lng}`);
            if (raceConfig.allowedStartRegion) {
                console.log(`   Start region: ${raceConfig.allowedStartRegion.minLat}°-${raceConfig.allowedStartRegion.maxLat}°, ${raceConfig.allowedStartRegion.minLng}°-${raceConfig.allowedStartRegion.maxLng}°`);
            }
        } catch(e) {
            console.error('Error loading config:', e);
        }
    } else {
        saveConfigToFile();
        console.log('📝 Created default race config file');
    }
}

// Сохранение конфигурации в файл
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
        raceDurationHours: raceConfig.raceDurationHours // ДОБАВЛЕНО
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2));
    console.log('💾 Race config saved to file');
}

// Проверка, находится ли точка в зоне старта
function isInStartZone(lat, lng) {
    if (!raceConfig.allowedStartRegion) return true;
    const zone = raceConfig.allowedStartRegion;
    return lat >= zone.minLat && lat <= zone.maxLat && 
           lng >= zone.minLng && lng <= zone.maxLng;
}

// Проверка, открыта ли регистрация
function isRegistrationOpen() {
    const now = new Date();
    return now >= raceConfig.registrationWindowFrom && now <= raceConfig.registrationWindowTo;
}

// Проверка, началась ли гонка
function isRaceStarted() {
    const now = new Date();
    return now >= raceConfig.raceStartDateTime;
}

// ДОБАВЛЕНО: Проверка, закончилось ли время гонки
function isRaceTimeExpired() {
    if (!raceConfig.raceStarted) return false;
    const now = new Date();
    const raceEndTime = new Date(raceConfig.raceStartDateTime);
    raceEndTime.setHours(raceEndTime.getHours() + raceConfig.raceDurationHours);
    return now >= raceEndTime;
}

// ДОБАВЛЕНО: Автоматическое завершение гонки по времени
function checkAndFinishRaceByTime() {
    if (raceConfig.raceStarted && !raceConfig.raceFinished && isRaceTimeExpired()) {
        raceConfig.raceFinished = true;
        saveConfigToFile();
        
        // Останавливаем все симуляции
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

// Функция расчета расстояния между координатами (формула гаверсинуса)
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

// Функция симуляции движения с использованием реальных данных ветра
async function startBalloonSimulation(balloonId) {
    console.log(`🎈 Starting wind simulation for balloon ${balloonId}`);
    
    const interval = setInterval(async () => {
        const balloon = balloons[balloonId];
        
        // Проверяем существование шара
        if (!balloon) {
            clearInterval(interval);
            simulationIntervals.delete(balloonId);
            return;
        }
        
        // Проверяем, началась ли гонка
        if (!raceConfig.raceStarted && isRaceStarted()) {
            raceConfig.raceStarted = true;
            saveConfigToFile(); // ДОБАВЛЕНО: сохраняем состояние
            io.emit('fiesta-race-started', { 
                message: "🏁 ГОНКА НАЧАЛАСЬ! Все шары в движении! 🏁",
                timestamp: raceConfig.raceStartDateTime
            });
            console.log("🏁 Race has started!");
        }
        
        // ДОБАВЛЕНО: Автоматическая проверка окончания гонки по времени
        checkAndFinishRaceByTime();
        
        // Если гонка еще не началась - не двигаем шары
        if (!raceConfig.raceStarted) {
            return;
        }
        
        // Если гонка уже закончилась - останавливаем симуляцию
        if (raceConfig.raceFinished) {
            clearInterval(interval);
            simulationIntervals.delete(balloonId);
            return;
        }
        
        try {
            // Получаем реальные данные ветра для текущей позиции и высоты
            const wind = await windService.getWindAtPosition(balloon.lat, balloon.lng, balloon.altitude);
            
            // Конвертируем скорость из м/с в градусы/секунду
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
            
            io.emit('fiesta-balloon-updated', balloon);
            
            const distanceToFinish = getDistanceFromLatLonInKm(
                balloon.lat, balloon.lng,
                raceConfig.finishCoords.lat, raceConfig.finishCoords.lng
            );
            
            if (distanceToFinish < 50 && !balloon.finished) {
                balloon.finished = true;
                balloon.finishTime = Date.now();
                
                io.emit('fiesta-message', {
                    type: 'finish',
                    message: `🎉 ПОБЕДА! ${balloon.username} достиг финиша! 🎉`,
                    balloon: balloon,
                    finishTime: balloon.finishTime
                });
                
                console.log(`🏆 Balloon ${balloon.raceNumber} (${balloon.username}) finished the race!`);
                
                clearInterval(interval);
                simulationIntervals.delete(balloonId);
            }
            
        } catch (error) {
            console.error(`Error in simulation for balloon ${balloonId}:`, error);
        }
        
    }, SIMULATION_INTERVAL);
    
    simulationIntervals.set(balloonId, interval);
}

// Загружаем конфигурацию при старте
loadConfig();

// Запускаем периодическую проверку окончания гонки (каждую минуту)
setInterval(checkAndFinishRaceByTime, 60000);

// Корневой маршрут - перенаправляем на fiesta.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'fiesta.html'));
});

// WebSocket события
io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);
    let currentUser = null;
    let currentBalloonId = null;
    
    // Отправляем текущую конфигурацию гонки новому клиенту
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
    
    // Отправляем каталог шаров
    socket.emit('fiesta-balloon-catalog', balloonCatalog);
    
    // Отправляем список всех активных шаров
    const allBalloons = Object.values(balloons);
    socket.emit('fiesta-all-balloons', allBalloons);
    
    // Аутентификация
    socket.on('fiesta-auth', (user) => {
        currentUser = user;
        console.log('📝 User authenticated:', user.username, user.email);
        
        // ДОБАВЛЕНО: Попытка переподключения к существующему шару
        for (const [id, balloon] of Object.entries(balloons)) {
            if (balloon.username === user.username && balloon.email === user.email) {
                currentBalloonId = id;
                balloon.socketId = socket.id;
                balloon.pilotConnected = true;
                socket.emit('fiesta-my-state', balloon);
                console.log(`🔄 Pilot ${balloon.username} reconnected to balloon #${balloon.raceNumber}`);
                break;
            }
        }
    });
    
    // Получить участников
    socket.on('fiesta-get-participants', () => {
        socket.emit('fiesta-all-balloons', Object.values(balloons));
    });
    
    // Старт полета (регистрация участника)
    socket.on('fiesta-start-flight', async (data) => {
        if (!currentUser) {
            socket.emit('fiesta-error', 'Authentication required');
            return;
        }
        
        if (!isRegistrationOpen()) {
            socket.emit('fiesta-error', 'Registration window is closed. Cannot join the race.');
            return;
        }
        
        if (raceConfig.raceStarted) {
            socket.emit('fiesta-error', 'Race has already started. Cannot join.');
            return;
        }
        
        const currentParticipants = Object.keys(balloons).length;
        if (currentParticipants >= MAX_PARTICIPANTS) {
            socket.emit('fiesta-error', `Maximum ${MAX_PARTICIPANTS} participants reached. Race is full!`);
            return;
        }
        
        const { lat, lng, styleId } = data;
        
        if (!isInStartZone(lat, lng)) {
            socket.emit('fiesta-error', 'Start location not in allowed start region');
            return;
        }
        
        const balloonId = Date.now().toString() + socket.id;
        const raceNumber = nextRaceNumber++;
        
        const style = balloonCatalog[styleId] || balloonCatalog.classic;
        
        const newBalloon = {
            id: balloonId,
            _id: balloonId,
            raceNumber: raceNumber,
            username: currentUser.username,
            email: currentUser.email,
            lat: lat,
            lng: lng,
            altitude: 1000,
            speed: 0,
            layerName: 'Ожидание старта',
            balloonStyle: style,
            path: [{ lat, lng, altitude: 1000, timestamp: Date.now() }],
            socketId: socket.id,
            lastUpdate: Date.now(),
            registeredAt: Date.now(),
            finished: false,
            pilotConnected: true // ДОБАВЛЕНО: флаг подключения пилота
        };
        
        balloons[balloonId] = newBalloon;
        currentBalloonId = balloonId;
        
        socket.emit('fiesta-my-state', newBalloon);
        io.emit('fiesta-balloon-created', newBalloon);
        
        console.log(`🎈 Balloon registered: #${raceNumber} (${currentUser.username}) at ${lat}, ${lng}`);
        console.log(`   Total participants: ${Object.keys(balloons).length}/${MAX_PARTICIPANTS}`);
        console.log(`   Race starts at: ${raceConfig.raceStartDateTime.toLocaleString()}`);
        
        await startBalloonSimulation(balloonId);
    });
    
    // Изменение высоты
    socket.on('fiesta-change-altitude', (data) => {
        if (currentBalloonId && balloons[currentBalloonId]) {
            const balloon = balloons[currentBalloonId];
            const newAltitude = Math.min(Math.max(data.altitude, 0), 15000);
            balloon.altitude = newAltitude;
            
            const levelInfo = windService.getPressureLevelInfo(newAltitude);
            balloon.layerName = levelInfo.name;
            
            io.emit('fiesta-balloon-updated', balloon);
            console.log(`📈 Balloon ${balloon.raceNumber} changed altitude to ${newAltitude}m (${levelInfo.name})`);
        }
    });
    
    // Админ: изменение правил гонки
    socket.on('fiesta-admin-change-rules', (rules) => {
        if (currentUser && currentUser.email === 'aerostar@aerost.art') {
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
                console.log(`   Updated start region: ${raceConfig.allowedStartRegion.minLat}°-${raceConfig.allowedStartRegion.maxLat}°, ${raceConfig.allowedStartRegion.minLng}°-${raceConfig.allowedStartRegion.maxLng}°`);
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
            
            io.emit('fiesta-race-config', {
                finishCoords: raceConfig.finishCoords,
                allowedStartRegion: raceConfig.allowedStartRegion,
                registrationWindowFrom: raceConfig.registrationWindowFrom,
                registrationWindowTo: raceConfig.registrationWindowTo,
                raceStartDateTime: raceConfig.raceStartDateTime,
                maxParticipants: raceConfig.maxParticipants,
                raceStarted: raceConfig.raceStarted,
                raceFinished: raceConfig.raceFinished
            });
            
            console.log('🔧 Race config updated by admin');
            console.log(`   New finish: ${raceConfig.finishCoords.lat}, ${raceConfig.finishCoords.lng}`);
            console.log(`   New race start time: ${raceConfig.raceStartDateTime.toLocaleString()}`);
            
            socket.emit('fiesta-config-saved', { success: true });
        } else {
            socket.emit('fiesta-error', 'Admin privileges required');
        }
    });
    
    // Принудительный старт гонки (админ)
    socket.on('fiesta-force-race-start', () => {
        if (currentUser && currentUser.email === 'aerostar@aerost.art') {
            if (!raceConfig.raceStarted) {
                raceConfig.raceStarted = true;
                saveConfigToFile();
                
                io.emit('fiesta-race-started', { 
                    message: "🏁 АДМИНИСТРАТОР ЗАПУСТИЛ ГОНКУ! Всем удачи! 🏁",
                    timestamp: new Date(),
                    forced: true
                });
                
                console.log("🏁 Race force-started by admin");
                socket.emit('fiesta-config-saved', { success: true });
            } else {
                socket.emit('fiesta-error', 'Race has already started');
            }
        } else {
            socket.emit('fiesta-error', 'Admin privileges required');
        }
    });
    
    // ИСПРАВЛЕНО: Отключение - НЕ удаляем шар, только помечаем пилота как оффлайн
    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
        if (currentBalloonId && balloons[currentBalloonId]) {
            const balloon = balloons[currentBalloonId];
            balloon.pilotConnected = false;
            balloon.lastSeen = Date.now();
            
            console.log(`📡 Pilot ${balloon.username} disconnected, but balloon #${balloon.raceNumber} continues flying`);
            
            // Оповещаем всех, что пилот отключился (но шар остается)
            io.emit('fiesta-pilot-disconnected', {
                balloonId: currentBalloonId,
                username: balloon.username
            });
            
            // НЕ удаляем шар!
            // НЕ останавливаем симуляцию!
        }
    });
});

// Запуск сервера
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🎮 Fiesta Game Server running on port ${PORT}`);
    console.log(`📍 Race page: http://localhost:${PORT}/fiesta.html`);
    console.log(`📝 Register page: http://localhost:${PORT}/register.html`);
    console.log(`🔧 Admin page: http://localhost:${PORT}/admin.html`);
    console.log(`🎈 Gondola page: http://localhost:${PORT}/gondola.html`);
    console.log(`💾 Config file: ${CONFIG_FILE}`);
    console.log(`👥 Max participants: ${MAX_PARTICIPANTS}`);
    console.log(`📅 Registration period: ${raceConfig.registrationWindowFrom.toLocaleString()} - ${raceConfig.registrationWindowTo.toLocaleString()}`);
    console.log(`🏁 Race start time: ${raceConfig.raceStartDateTime.toLocaleString()}`);
    console.log(`🎯 Finish location: ${raceConfig.finishCoords.lat}, ${raceConfig.finishCoords.lng}`);
    if (raceConfig.allowedStartRegion) {
        console.log(`🗺️ Start region: ${raceConfig.allowedStartRegion.minLat}°-${raceConfig.allowedStartRegion.maxLat}°, ${raceConfig.allowedStartRegion.minLng}°-${raceConfig.allowedStartRegion.maxLng}°`);
    }
    console.log(`🌬️ Wind service: ACTIVE (real-time weather data)`);
    console.log(`⏱️ Simulation interval: ${SIMULATION_INTERVAL/1000} seconds`);
    console.log(`⏰ Race duration: ${raceConfig.raceDurationHours} hours (auto-finish)`);
});
