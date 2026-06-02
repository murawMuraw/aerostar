/**
 * ГЛАВНЫЙ ИГРОВОЙ СЕРВЕР «ФИЕСТА» (Порт 3001)
 * Управляет сессиями игроков, сокетами и запускает физический движок
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Подключаем наши изолированные игровые модули
const dbModule = require('./database');
const gameEngine = require('./engine');

const app = express();
const server = http.createServer(app);

// Инициализируем сокеты с поддержкой CORS для интеграции с фронтендом
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = 3001;

// Настраиваем Express на раздачу статических файлов игрового фронтенда
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Ограничения для гонки (финиш — Эйфелева башня)
const FINISH_COORDS = { lat: 48.8584, lng: 2.2945 };

// ==========================================
// ЛОГИКА ВЕБ-СОКЕТОВ (SOCKET.IO)
// ==========================================
io.on('connection', (socket) => {
    console.log(`[Game Server] 🎮 Подключился новый пилот/зритель: ${socket.id}`);

    // 1. Вход игрока в соревнование
    socket.on('fiesta-auth', async (userData) => {
        // Ожидаем email и username пользователя
        socket.userEmail = userData.email;
        socket.username = userData.username;
        
        console.log(`[Game Server] Пилот ${socket.username} (${socket.userEmail}) авторизован в игре.`);
        
        // Отправляем игроку его текущий шар (если он уже зарегистрирован и летит)
        const playerBalloon = await dbModule.getPlayer(socket.userEmail);
        if (playerBalloon) {
            socket.emit('fiesta-my-state', playerBalloon);
        }

        // Отправляем массив ВСЕХ остальных летящих шаров для отрисовки на общей карте
        const allActiveBalloons = await dbModule.rawDb.find({ status: 'flying' });
        socket.emit('fiesta-all-balloons', allActiveBalloons);
    });

    // 2. Команда на старт (взлет из Америки)
    socket.on('fiesta-start-flight', async (startData) => {
        const { lat, lng } = startData;
        
        if (!socket.userEmail) {
            return socket.emit('fiesta-error', 'Ошибка авторизации. Перезапустите страницу.');
        }

        try {
            const newBalloon = await dbModule.registerPlayer(socket.userEmail, socket.username, lat, lng);
            
            // Уведомляем игрока об успешном старте
            socket.emit('fiesta-my-state', newBalloon);
            
            // Транслируем появление нового шара всем остальным участникам на карте
            io.emit('fiesta-balloon-created', newBalloon);
            console.log(`[Game Server] 🚀 Шар пилота ${socket.username} успешно взлетел из точки [${lat}, ${lng}]`);
        } catch (error) {
            socket.emit('fiesta-error', error.message);
        }
    });

    // 3. Изменение высоты (управление эшелонами ветра)
    socket.on('fiesta-change-altitude', async (data) => {
        const { altitude } = data;
        
        if (!socket.userEmail) return;

        try {
            await dbModule.updatePlayerAltitude(socket.userEmail, altitude);
            
            // Получаем обновленный шар и возвращаем игроку подтверждение
            const updated = await dbModule.getPlayer(socket.userEmail);
            socket.emit('fiesta-my-state', updated);
            
            console.log(`[Game Server] ↕️ Пилот ${socket.username} изменил высоту на ${altitude} метров.`);
        } catch (error) {
            socket.emit('fiesta-error', error.message);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[Game Server] 🔴 Соединение закрыто: ${socket.id}`);
    });
});

// ==========================================
// ЗАПУСК СЕРВЕРА И ФИЗИЧЕСКОГО ДВИЖКА
// ==========================================
server.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`[Game Server] 🚀 Сервер Игры запущен на порту ${PORT}`);
    console.log(`[Game Server] 🌍 Игровой фронтенд доступен локально: http://localhost:${PORT}`);
    
    // Запуск бесконечного цикла симуляции полетов
    // Шаг симуляции — каждые 60000 мс (1 минута). Сервер будет двигать шары 24/7 по реальным ветрам.
    gameEngine.startEngineLoop(dbModule.rawDb, io, 60000);
    console.log(`==================================================\n`);
});

