/**
 * ИГРОВОЙ ФИЗИЧЕСКИЙ ДВИЖОК «ФИЕСТА»
 * Отвечает за симуляцию полета всех шаров по сфере Земли
 */

const windService = require('./windService');

// Константы для математических расчетов
const EARTH_RADIUS_METERS = 6371000; // Радиус Земли в метрах
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Расчет перемещения точки по поверхности сферы (Формула смещения по азимуту)
 * @param {number} lat - Текущая широта (градусы)
 * @param {number} lng - Текущая долгота (градусы)
 * @param {number} speedMS - Скорость ветра (метров в секунду)
 * @param {number} windDirectionDeg - Направление ветра (откуда дует, в градусах)
 * @param {number} timeSeconds - Время шага симуляции в секундах (например, 60 секунд)
 * @returns {Object} Новые координаты { lat, lng }
 */
function calculateNextCoordinates(lat, lng, speedMS, windDirectionDeg, timeSeconds) {
    // Метеорологический ветер дует ОТКУДА-ТО. Шар летит В ТУ ЖЕ СТОРОНУ.
    // Направление движения (bearing) = (направление ветра + 180°)
    const bearingDeg = (windDirectionDeg + 180) % 360;
    
    // Переводим всё в радианы
    const lat1 = lat * DEG_TO_RAD;
    const lng1 = lng * DEG_TO_RAD;
    const bearingRad = bearingDeg * DEG_TO_RAD;
    
    // Расстояние, пройденное за этот игровой тик (в метрах)
    const distanceMeters = speedMS * timeSeconds;
    
    // Угловое расстояние
    const angularDistance = distanceMeters / EARTH_RADIUS_METERS;

    // Сферическая формула расчета новой широты
    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(angularDistance) +
        Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad)
    );

    // Сферическая формула расчета новой долготы
    const lng2 = lng1 + Math.atan2(
        Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1),
        Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

    // Переводим обратно в градусы
    let newLat = lat2 * RAD_TO_DEG;
    let newLng = lng2 * RAD_TO_DEG;

    // Нормализуем долготу, чтобы она оставалась в границах от -180 до +180 градусов
    newLng = ((newLng + 540) % 360) - 180;

    return { lat: newLat, lng: newLng };
}

/**
 * Главный цикл симуляции гонки (Игровой тик)
 * Вызывается сервером периодически (например, раз в 1-5 минут)
 * @param {Object} db - Экземпляр вашей игровой базы данных
 * @param {Object} io - Socket.io инстанс для рассылки координат игрокам в реальном времени
 */
async function runSimulationTick(db, io) {
    console.log(`[Engine] 🕒 Запуск тика симуляции: ${new Date().toISOString()}`);
    
    try {
        // 1. Получаем из БД только те шары, которые сейчас находятся в статусе полета ('flying')
        const activeBalloons = await db.find({ status: 'flying' });
        
        if (activeBalloons.length === 0) {
            return; // Летать некому, выходим
        }

        // Интервал времени между тиками в секундах (например, если запускаем раз в минуту = 60с)
        const TICK_INTERVAL_SECONDS = 60; 

        // 2. Обрабатываем каждый шар по очереди
        for (const balloon of activeBalloons) {
            // Запрашиваем актуальный ветер для текущей точки и высоты шара
            const wind = await windService.getWindAtPosition(balloon.lat, balloon.lng, balloon.altitude);
            
            // Считаем новые координаты
            const nextCoords = calculateNextCoordinates(
                balloon.lat, 
                balloon.lng, 
                wind.speed, 
                wind.direction, 
                TICK_INTERVAL_SECONDS
            );

            // Рассчитываем текущую путевую скорость в км/ч для отображения в интерфейсе
            const speedKmH = wind.speed * 3.6;

            // Добавляем новую точку в массив пройденного пути (трек полета)
            const updatedPath = [...(balloon.path || [])];
            // Чтобы база данных не переполнялась за 50 дней, сохраняем точку в трек, например, раз в 10 тиков 
            // или пишем каждую, если шаг симуляции более редкий (например, раз в 10-15 минут)
            updatedPath.push([nextCoords.lat, nextCoords.lng]);

            // 3. Обновляем данные шара в базе данных
            await db.update(
                { _id: balloon._id },
                { 
                    $set: { 
                        lat: nextCoords.lat, 
                        lng: nextCoords.lng,
                        speed: speedKmH,
                        windDirection: wind.direction,
                        layerName: wind.layerName,
                        path: updatedPath,
                        lastUpdate: Date.now()
                    } 
                }
            );

            // 4. Отправляем обновленную телеметрию в сокеты игры в реальном времени
            // Клиенты, у которых открыта страница фиесты, мгновенно увидят сдвиг шаров
            io.emit('fiesta-balloon-updated', {
                id: balloon._id,
                username: balloon.username,
                lat: nextCoords.lat,
                lng: nextCoords.lng,
                altitude: balloon.altitude,
                speed: speedKmH,
                path: updatedPath
            });
        }
        
        console.log(`[Engine] ✅ Успешно обработано шаров: ${activeBalloons.length}`);

    } catch (error) {
        console.error('[Engine Error] Критическая ошибка в цикле симуляции:', error.message);
    }
}

/**
 * Инициализирует бесконечный автоматический цикл полета на сервере
 */
function startEngineLoop(db, io, intervalMs = 60000) {
    // Запускаем симуляцию сразу при старте сервера и затем с интервалом
    runSimulationTick(db, io);
    
    setInterval(() => {
        runSimulationTick(db, io);
    }, intervalMs);
    
    console.log(`[Engine] 🚀 Физический движок успешно запущен. Интервал: ${intervalMs / 1000}с`);
}

module.exports = {
    calculateNextCoordinates,
    startEngineLoop
};

