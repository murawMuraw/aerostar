/**
 * ГЛАВНЫЙ ИГРОВОЙ СЕРВЕР «ФИЕСТА» (Порт 3001)
 * Управляет сессиями пилотов, выбором уникальных шаров и бортовых номеров,
 * сокетами трансляции гонки и фоновым движком симуляции.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Подключаем изолированные игровые модули и физический движок
const dbModule = require('./database');
const gameEngine = require('./engine');
const balloonCatalog = require('./balloonCatalog');

const app = express();
const server = http.createServer(app);

// Инициализируем сокеты с поддержкой CORS для интеграции с любым окружением
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = 3001;

// Настраиваем Express на раздачу статических файлов игрового фронтенда (папка public)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ==========================================
// ЛОГИКА ВЕБ-СОКЕТОВ (SOCKET.IO)
// ==========================================
io.on('connection', (socket) => {
    console.log(`[Game Server] 🎮 Подключился новый пилот/зритель: ${socket.id}`);

    /**
     * 1. Авторизация игрока в системе соревнований
     * Срабатывает при открытии страницы игры
     */
    socket.on('fiesta-auth', async (userData) => {
        // Ожидаем email и username пользователя
        socket.userEmail = userData.email;
        socket.username = userData.username;
        
        console.log(`[Game Server] Пилот ${socket.username} (${socket.userEmail}) авторизован в игре.`);
        
        // Отправляем игроку список доступных кастомных дизайнов из каталога
        socket.emit('fiesta-balloon-catalog', balloonCatalog);

        // Проверяем, зарегистрирован ли уже этот пилот и запущен ли его шар
        const playerBalloon = await dbModule.getPlayer(socket.userEmail);
        if (playerBalloon) {
            // Передаем персональное состояние его шара
            socket.emit('fiesta-my-state', playerBalloon);
        }

        // Отправляем массив ВСЕХ остальных летящих шаров для отрисовки общей карты фиесты
        const allActiveBalloons = await dbModule.rawDb.find({ status: 'flying' });
        socket.emit('fiesta-all-balloons', allActiveBalloons);
    });

    /**
     * 2. Команда на старт (взлет из Южной/Северной Америки)
     * Срабатывает, когда игрок выбрал точку на карте, скин шара и нажал «Взлет»
     */
    socket.on('fiesta-start-flight', async (startData) => {
        const { lat, lng, styleId } = startData; // Получаем координаты клика и ID скина
        
        if (!socket.userEmail) {
            return socket.emit('fiesta-error', 'Ошибка авторизации. Перезапустите страницу.');
        }

        try {
            // Регистрируем игрока. Функция сама выдаст бортовой номер и проверит styleId
            const newBalloon = await dbModule.registerPlayer(
                socket.userEmail, 
                socket.username, 
                styleId, 
                lat, 
                lng
            );
            
            // Возвращаем пилоту подтверждение успешного старта с его номером
            socket.emit('fiesta-my-state', newBalloon);
            
            // Транслируем появление нового уникального шара абсолютно всем зрителям на карте гонки
            io.emit('fiesta-balloon-created', newBalloon);
            
            console.log(`[Game Server] 🚀 Борт ${newBalloon.raceNumber} (${newBalloon.balloonStyle.name}) пилота ${socket.username} успешно взлетел из точки [${lat}, ${lng}]`);
        } catch (error) {
            // Отправляем клиенту сообщение об ошибке (например, если он уже зарегистрирован)
            socket.emit('fiesta-error', error.message);
        }
    });

    /**
     * 3. Управление высотой полета аэростата
     * Срабатывает, когда игрок двигает ползунок высоты, чтобы поймать другой ветер
     */
    socket.on('fiesta-change-altitude', async (data) => {
        const { altitude } = data;
        
        if (!socket.userEmail) {
            return socket.emit('fiesta-error', 'Ошибка сессии авторизации.');
        }

        try {
            // Обновляем высоту шара в базе данных
            await dbModule.updatePlayerAltitude(socket.userEmail, altitude);
            
            // Получаем обновленный документ из БД
            const updatedBalloon = await dbModule.getPlayer(socket.userEmail);
            
            // Отправляем пилоту подтверждение изменения
            socket.emit('fiesta-my-state', updatedBalloon);
            
            console.log(`[Game Server] ↕️ Пилот ${socket.username} перевел борт ${updatedBalloon.raceNumber} на высоту ${altitude} метров.`);
        } catch (error) {
            socket.emit('fiesta-error', error.message);
        }
    });

    /**
     * 4. Отключение клиента (закрытие вкладки браузера)
     * Шар при этом НЕ удаляется, а продолжает лететь в фоновом режиме движка
     */
    socket.on('disconnect', () => {
        console.log(`[Game Server] 🔴 Сессия сокета закрыта: ${socket.id}`);
    });
});

// ==========================================
// ЗАПУСК ИГРОВОГО СЕРВЕРА И ФИЗИЧЕСКОГО ДВИЖКА
// ==========================================
server.listen(PORT, () => {
    console.log(`\n==================================================================`);
    console.log(`[Game Server] 🚀 Сервер виртуальных соревнований запущен на порту ${PORT}`);
    console.log(`[Game Server] 🌐 Локальный адрес игрового интерфейса: http://localhost:${PORT}`);
    
    // Запуск бесконечного цикла симуляции полетов.
    // Шаг симуляции — каждые 60000 мс (1 минута). Движок будет двигать шары 24/7 
    // по реальным прогнозам векторов высотных ветров, даже в оффлайн-режиме.
    gameEngine.startEngineLoop(dbModule.rawDb, io, 60000);
    console.log(`[Game Server] ⚙️ Фоновый физический движок успешно синхронизирован с БД`);
    console.log(`==================================================================\n`);
});

