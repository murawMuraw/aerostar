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
    raceFinished: false  // Флаг окончания гонки
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
        raceFinished: raceConfig.raceFinished
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
            io.emit('fiesta-race-started', { 
                message: "🏁 ГОНКА НАЧАЛАСЬ! Все шары в движении! 🏁",
                timestamp: raceConfig.raceStartDateTime
            });
            console.log("🏁 Race has started!");
        }
        
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
            // 1 градус широты ≈ 111 км = 111,000 метров
            // Скорость в градусах в секунду = (скорость в м/с) / 111,000
            const speedLatPerSecond = wind.speed / 111000;
            const speedLngPerSecond = wind.speed / (111000 * Math.cos(balloon.lat * Math.PI / 180));
            
            // Вычисляем изменение координат за интервал симуляции (в секундах)
            const intervalSeconds = SIMULATION_INTERVAL / 1000;
            
            // Направление ветра: откуда дует (метеорологическое)
            // Ветер дует ИЗ направления, поэтому для движения нужно использовать противоположное направление
            const windDirectionRad = wind.direction * Math.PI / 180;
            
            // Вычисляем смещение (ветер дует ИЗ direction, значит шар движется ПО направлению direction + 180°)
            const moveDirectionRad = windDirectionRad + Math.PI;
            
            const latChange = Math.cos(moveDirectionRad) * speedLatPerSecond * intervalSeconds;
            const lngChange = Math.sin(moveDirectionRad) * speedLngPerSecond * intervalSeconds;
            
            // Обновляем координаты шара
            balloon.lat += latChange;
            balloon.lng += lngChange;
            
            // Обновляем скорость для отображения (км/ч для интерфейса)
            balloon.speed = wind.speed * 3.6; // Конвертируем м/с в км/ч
            balloon.layerName = wind.layerName;
            balloon.windDirection = wind.direction;
            balloon.lastWindUpdate = wind.timestamp;
            
            // Добавляем точку в маршрут
            balloon.path.push({ 
                lat: balloon.lat, 
                lng: balloon.lng,
                altitude: balloon.altitude,
                timestamp: Date.now()
            });
            
            // Ограничиваем длину пути (последние 200 точек)
            if (balloon.path.length > 200) {
                balloon.path = balloon.path.slice(-200);
            }
            
            balloon.lastUpdate = Date.now();
            
            // Оповещаем всех об обновлении
            io.emit('fiesta-balloon-updated', balloon);
            
            // Проверяем финиш
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
                
                // Останавливаем симуляцию для финишировавшего шара
                clearInterval(interval);
                simulationIntervals.delete(balloonId);
            }
            
        } catch (error) {
            console.error(`Error in simulation for balloon ${balloonId}:`, error);
            // При ошибке продолжаем симуляцию с предыдущими значениями
        }
        
    }, SIMULATION_INTERVAL);
    
    simulationIntervals.set(balloonId, interval);
}

// Загружаем конфигурацию при старте
loadConfig();

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
        
        // Проверка: открыта ли регистрация
        if (!isRegistrationOpen()) {
            socket.emit('fiesta-error', 'Registration window is closed. Cannot join the race.');
            return;
        }
        
        // Проверка: не началась ли уже гонка
        if (raceConfig.raceStarted) {
            socket.emit('fiesta-error', 'Race has already started. Cannot join.');
            return;
        }
        
        // Проверка количества участников
        const currentParticipants = Object.keys(balloons).length;
        if (currentParticipants >= MAX_PARTICIPANTS) {
            socket.emit('fiesta-error', `Maximum ${MAX_PARTICIPANTS} participants reached. Race is full!`);
            return;
        }
        
        const { lat, lng, styleId } = data;
        
        // Проверка координат старта
        if (!isInStartZone(lat, lng)) {
            socket.emit('fiesta-error', 'Start location not in allowed start region');
            return;
        }
        
        // Создаем новый шар
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
            altitude: 1000, // Начальная высота 1000 метров
            speed: 0, // Начинаем с нулевой скорости до старта гонки
            layerName: 'Ожидание старта',
            balloonStyle: style,
            path: [{ lat, lng, altitude: 1000, timestamp: Date.now() }],
            socketId: socket.id,
            lastUpdate: Date.now(),
            registeredAt: Date.now(),
            finished: false
        };
        
        balloons[balloonId] = newBalloon;
        currentBalloonId = balloonId;
        
        // Отправляем созданному пользователю его состояние
        socket.emit('fiesta-my-state', newBalloon);
        
        // Оповещаем всех о новом шаре
        io.emit('fiesta-balloon-created', newBalloon);
        
        console.log(`🎈 Balloon registered: #${raceNumber} (${currentUser.username}) at ${lat}, ${lng}`);
        console.log(`   Total participants: ${Object.keys(balloons).length}/${MAX_PARTICIPANTS}`);
        console.log(`   Race starts at: ${raceConfig.raceStartDateTime.toLocaleString()}`);
        
        // Запускаем симуляцию движения (она будет ждать старта гонки)
        await startBalloonSimulation(balloonId);
    });
    
    // Изменение высоты
    socket.on('fiesta-change-altitude', (data) => {
        if (currentBalloonId && balloons[currentBalloonId]) {
            const balloon = balloons[currentBalloonId];
            const newAltitude = Math.min(Math.max(data.altitude, 0), 15000); // Ограничиваем 0-15000 метров
            balloon.altitude = newAltitude;
            
            // Получаем информацию о новом слое для отображения
            const levelInfo = windService.getPressureLevelInfo(newAltitude);
            balloon.layerName = levelInfo.name;
            
            io.emit('fiesta-balloon-updated', balloon);
            console.log(`📈 Balloon ${balloon.raceNumber} changed altitude to ${newAltitude}m (${levelInfo.name})`);
        }
    });
    
    // Админ: изменение правил гонки
    socket.on('fiesta-admin-change-rules', (rules) => {
        // Проверка прав администратора
        if (currentUser && currentUser.email === 'aerostar@aerost.art') {
            // Обновляем финиш
            if (rules.finishCoords) {
                raceConfig.finishCoords = { 
                    lat: parseFloat(rules.finishCoords.lat), 
                    lng: parseFloat(rules.finishCoords.lng)
                };
            }
            
            // Обновляем зону старта (прямоугольник)
            if (rules.allowedStartRegion) {
                raceConfig.allowedStartRegion = {
                    minLat: parseFloat(rules.allowedStartRegion.minLat),
                    maxLat: parseFloat(rules.allowedStartRegion.maxLat),
                    minLng: parseFloat(rules.allowedStartRegion.minLng),
                    maxLng: parseFloat(rules.allowedStartRegion.maxLng)
                };
                console.log(`   Updated start region: ${raceConfig.allowedStartRegion.minLat}°-${raceConfig.allowedStartRegion.maxLat}°, ${raceConfig.allowedStartRegion.minLng}°-${raceConfig.allowedStartRegion.maxLng}°`);
            }
            
            // Обновляем окно регистрации
            if (rules.registrationWindowFrom) {
                raceConfig.registrationWindowFrom = new Date(rules.registrationWindowFrom);
            }
            if (rules.registrationWindowTo) {
                raceConfig.registrationWindowTo = new Date(rules.registrationWindowTo);
            }
            
            // Обновляем время старта гонки
            if (rules.raceStartDateTime) {
                raceConfig.raceStartDateTime = new Date(rules.raceStartDateTime);
                raceConfig.raceStarted = false; // Сбрасываем флаг старта при изменении времени
            }
            
            // Сохраняем в файл
            saveConfigToFile();
            
            // Оповещаем всех об изменении правил
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
    
    // Отключение
    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
        if (currentBalloonId && balloons[currentBalloonId]) {
            // Не удаляем шар, если гонка уже началась
            if (!raceConfig.raceStarted) {
                const balloon = balloons[currentBalloonId];
                console.log(`🗑️ Balloon removed: #${balloon.raceNumber} (${balloon.username}) - registration cancelled`);
                delete balloons[currentBalloonId];
                
                // Останавливаем симуляцию
                if (simulationIntervals.has(currentBalloonId)) {
                    clearInterval(simulationIntervals.get(currentBalloonId));
                    simulationIntervals.delete(currentBalloonId);
                }
                
                io.emit('fiesta-balloon-removed', currentBalloonId);
                io.emit('fiesta-all-balloons', Object.values(balloons));
            } else {
                console.log(`⚠️ Balloon ${currentBalloonId} remains in race (race already started)`);
            }
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
});
