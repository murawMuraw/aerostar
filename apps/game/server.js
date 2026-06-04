/**
 * ГЛАВНЫЙ ИГРОВОЙ СЕРВЕР «ФИЕСТА» (Порт 3001)
 * Управляет сессиями пилотов, выбором уникальных шаров и бортовых номеров,
 * сокетами трансляции гонки и фоновым движком симуляции.
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

// Данные игры
let raceConfig = {
    finishCoords: { lat: 48.8566, lng: 2.3522 }, // Париж по умолчанию
    startWindowFrom: new Date('2024-06-01'),
    startWindowTo: new Date('2024-12-31'),
    allowedStartRegion: {
        minLat: 15,
        maxLat: 60,
        minLng: -130,
        maxLng: -30
    }
};

let balloons = {};
let nextRaceNumber = 1;

// Загрузка конфигурации из файла
function loadConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            raceConfig = saved;
            console.log('✅ Loaded race config from file:', raceConfig.finishCoords);
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
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(raceConfig, null, 2));
    console.log('💾 Race config saved to file');
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
    socket.emit('fiesta-race-config', raceConfig);
    
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
    
    // Старт полета
    socket.on('fiesta-start-flight', (data) => {
        if (!currentUser) {
            socket.emit('fiesta-error', 'Authentication required');
            return;
        }
        
        const { lat, lng, styleId } = data;
        
        // Проверка координат старта
        if (lat < raceConfig.allowedStartRegion.minLat || lat > raceConfig.allowedStartRegion.maxLat ||
            lng < raceConfig.allowedStartRegion.minLng || lng > raceConfig.allowedStartRegion.maxLng) {
            socket.emit('fiesta-error', 'Start location not in allowed region (Americas)');
            return;
        }
        
        // Проверка даты старта
        const now = new Date();
        if (now < raceConfig.startWindowFrom || now > raceConfig.startWindowTo) {
            socket.emit('fiesta-error', 'Race start window is closed');
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
            altitude: 1000,
            speed: 15 + Math.random() * 10,
            layerName: 'Surface Layer (0-2km)',
            balloonStyle: style,
            path: [{ lat, lng }],
            socketId: socket.id,
            lastUpdate: Date.now()
        };
        
        balloons[balloonId] = newBalloon;
        currentBalloonId = balloonId;
        
        // Отправляем созданному пользователю его состояние
        socket.emit('fiesta-my-state', newBalloon);
        
        // Оповещаем всех о новом шаре
        socket.broadcast.emit('fiesta-balloon-created', newBalloon);
        
        console.log(`🎈 Balloon created: #${raceNumber} (${currentUser.username}) at ${lat}, ${lng}`);
        
        // Запускаем симуляцию движения
        startBalloonSimulation(balloonId);
    });
    
    // Изменение высоты
    socket.on('fiesta-change-altitude', (data) => {
        if (currentBalloonId && balloons[currentBalloonId]) {
            const balloon = balloons[currentBalloonId];
            balloon.altitude = data.altitude;
            
            // Меняем скорость и слой в зависимости от высоты
            if (balloon.altitude < 2000) {
                balloon.speed = 10 + Math.random() * 10;
                balloon.layerName = 'Surface Layer (0-2km)';
            } else if (balloon.altitude < 5000) {
                balloon.speed = 25 + Math.random() * 15;
                balloon.layerName = 'Lower Winds (2-5km)';
            } else if (balloon.altitude < 8000) {
                balloon.speed = 40 + Math.random() * 20;
                balloon.layerName = 'Mid Winds (5-8km)';
            } else {
                balloon.speed = 60 + Math.random() * 30;
                balloon.layerName = 'Jet Stream (8km+)';
            }
            
            socket.emit('fiesta-balloon-updated', balloon);
        }
    });
    
    // Функция симуляции движения
    function startBalloonSimulation(balloonId) {
        const interval = setInterval(() => {
            const balloon = balloons[balloonId];
            if (!balloon) {
                clearInterval(interval);
                return;
            }
            
            // Движение на основе скорости
            const latChange = (balloon.speed / 111000) * (Math.random() - 0.5) * 0.3;
            const lngChange = (balloon.speed / (111000 * Math.cos(balloon.lat * Math.PI / 180))) * (Math.random() - 0.5) * 0.3;
            
            balloon.lat += latChange;
            balloon.lng += lngChange;
            balloon.path.push({ lat: balloon.lat, lng: balloon.lng });
            
            // Ограничиваем длину пути
            if (balloon.path.length > 100) {
                balloon.path = balloon.path.slice(-100);
            }
            
            balloon.lastUpdate = Date.now();
            
            // Оповещаем всех об обновлении
            io.emit('fiesta-balloon-updated', balloon);
            
            // Проверка финиша
            const distanceToFinish = getDistanceFromLatLonInKm(
                balloon.lat, balloon.lng,
                raceConfig.finishCoords.lat, raceConfig.finishCoords.lng
            );
            
            if (distanceToFinish < 50) {
                io.emit('fiesta-message', {
                    type: 'finish',
                    message: `🎉 Congratulations! ${balloon.username} reached the finish line! 🎉`,
                    balloon: balloon
                });
                clearInterval(interval);
            }
        }, 5000);
    }
    
    // Админ: изменение правил гонки
    socket.on('fiesta-admin-change-rules', (rules) => {
        // Проверка прав администратора
        if (currentUser && currentUser.email === 'aerostar@aerost.art') {
            raceConfig.finishCoords = { 
                lat: parseFloat(rules.lat), 
                lng: parseFloat(rules.lng) 
            };
            raceConfig.startWindowFrom = new Date(rules.dateFrom);
            raceConfig.startWindowTo = new Date(rules.dateTo);
            raceConfig.allowedStartRegion = {
                minLat: parseFloat(rules.minLat),
                maxLat: parseFloat(rules.maxLat),
                minLng: parseFloat(rules.minLng),
                maxLng: parseFloat(rules.maxLng)
            };
            
            // Сохраняем в файл
            saveConfigToFile();
            
            // Оповещаем всех об изменении правил
            io.emit('fiesta-race-config', raceConfig);
            console.log('🔧 Race config updated by admin:', raceConfig.finishCoords);
            
            socket.emit('fiesta-config-saved', { success: true });
        } else {
            socket.emit('fiesta-error', 'Admin privileges required');
        }
    });
    
    // Отключение
    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
        if (currentBalloonId) {
            delete balloons[currentBalloonId];
            io.emit('fiesta-balloon-removed', currentBalloonId);
            console.log(`🗑️ Balloon removed: ${currentBalloonId}`);
        }
    });
});

// Функция расчета расстояния между координатами
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

// Запуск сервера
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🎮 Fiesta Game Server running on port ${PORT}`);
    console.log(`📍 Race page: http://localhost:${PORT}/fiesta.html`);
    console.log(`🔧 Admin page: http://localhost:${PORT}/admin.html`);
    console.log(`💾 Config file: ${CONFIG_FILE}`);
    console.log(`🌍 Allowed region: ${raceConfig.allowedStartRegion.minLat}° to ${raceConfig.allowedStartRegion.maxLat}°`);
    console.log(`🏁 Finish: ${raceConfig.finishCoords.lat}, ${raceConfig.finishCoords.lng}`);
});

