/**
 * ИГРОВОЙ МОДУЛЬ БАЗЫ ДАННЫХ «ФИЕСТА»
 * Хранит состояние участников соревнований и историю их треков
 */

const Datastore = require('nedb-promises');
const path = require('path');
const balloonCatalog = require('./balloonCatalog'); // Подключаем каталог

// Создаем и инициализируем файл базы данных внутри папки проекта
const db = Datastore.create({
    filename: path.join(__dirname, 'data', 'fiesta.db'),
    autoload: true // Автоматически создавать файл, если его нет
});

// Настраиваем индексы для ускорения поиска по email (id) игрока
db.ensureIndex({ fieldName: 'email', unique: true }).catch(err => {
    console.error('[DB] Ошибка создания индекса email:', err.message);
});

/**
 * Регистрация нового пилота в соревновании
 * @param {string} email - Уникальный email пользователя (из сессии)
 * @param {string} username - Имя или никнейм пилота для таблицы лидеров
 * @param {number} startLat - Начальная широта старта в Америке
 * @param {number} startLng - Начальная долгота старта в Америке
 */
async function registerPlayer(email, username, styleId, startLat, startLng) {
    // 1. Проверяем, существует ли выбранный дизайн
    const selectedStyle = balloonCatalog[styleId];
    if (!selectedStyle) {
        throw new Error('Выбранный дизайн шара не найден в каталоге!');
    }

    // 2. Генерируем уникальный порядковый номер шара
    // Считаем сколько всего шаров уже зарегистрировано в этой гонке
    const totalRegistered = await db.count({});
    const raceNumber = totalRegistered + 1; // Следующий номер
    
    // Форматируем номер в красивый вид (например, 1 -> "№001", 12 -> "№012")
    const formattedNumber = `№${String(raceNumber).padStart(3, '0')}`;

    const newBalloon = {
        email: email,
        username: username,
        raceNumber: formattedNumber, // Бортовой номер шара
        balloonStyle: selectedStyle,  // Объект дизайна { id, name, filter }
        lat: startLat,
        lng: startLng,
        altitude: 1000, 
        speed: 0,
        windDirection: 0,
        layerName: 'Приземный слой (эшелон 1)',
        status: 'flying', 
        path: [[startLat, startLng]], 
        registeredAt: Date.now(),
        lastUpdate: Date.now()
    };

    try {
        return await db.insert(newBalloon);
    } catch (error) {
        if (error.message.includes('uniqueViolated')) {
            throw new Error('Вы уже зарегистрированы! У вас может быть только один бортовой номер.');
        }
        throw error;
    }
}

/**
 * Получить данные конкретного игрока
 */
async function getPlayer(email) {
    return await db.findOne({ email: email });
}

/**
 * Изменение высоты шара игроком (Главный игровой процесс)
 * @param {string} email - Кого обновляем
 * @param {number} newAltitude - Новая высота в метрах
 */
async function updatePlayerAltitude(email, newAltitude) {
    if (newAltitude < 0 || newAltitude > 15000) {
        throw new Error('Недопустимая высота для аэростата (разрешено от 0 до 15000м)');
    }
    
    return await db.update(
        { email: email, status: 'flying' },
        { $set: { altitude: Number(newAltitude) } },
        { returnUpdatedDocs: true }
    );
}

/**
 * Фиксация финиша (если игрок вошел в радиус Эйфелевой башни)
 */
async function setPlayerFinished(email) {
    return await db.update(
        { email: email },
        { $set: { status: 'finished', speed: 0 } }
    );
}

/**
 * Экспортируем функции и сам инстанс БД для физического движка engine.js
 */
module.exports = {
    rawDb: db,
    registerPlayer,
    getPlayer: async (email) => await db.findOne({ email }),
    updatePlayerAltitude: async (email, alt) => await db.update({ email, status: 'flying' }, { $set: { altitude: Number(alt) } }),
    setPlayerFinished: async (email) => await db.update({ email }, { $set: { status: 'finished', speed: 0 } })
};

