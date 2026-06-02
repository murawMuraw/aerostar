/**
 * ИГРОВОЙ МОДУЛЬ БАЗЫ ДАННЫХ «ФИЕСТА»
 * Хранит состояние участников соревнований и историю их треков
 */

const Datastore = require('nedb-promises');
const path = require('path');
const balloonCatalog = require('./balloonCatalog');

// Основная база данных игроков
const db = Datastore.create({
    filename: path.join(__dirname, 'data', 'fiesta.db'),
    autoload: true
});

// База данных настроек гонки
const settingsDb = Datastore.create({
    filename: path.join(__dirname, 'data', 'fiesta_settings.db'),
    autoload: true
});

// Настраиваем уникальный индекс по email
db.ensureIndex({ fieldName: 'email', unique: true }).catch(err => {
    console.error('[DB] Ошибка создания индекса email:', err.message);
});

/**
 * Регистрация нового пилота в соревновании
 */
async function registerPlayer(email, username, styleId, startLat, startLng) {
    const selectedStyle = balloonCatalog[styleId];
    if (!selectedStyle) {
        throw new Error('Выбранный дизайн шара не найден в каталоге!');
    }

    const totalRegistered = await db.count({});
    const raceNumber = totalRegistered + 1;
    const formattedNumber = "№" + String(raceNumber).padStart(3, '0');

    const newBalloon = {
        email: email,
        username: username,
        raceNumber: formattedNumber,
        balloonStyle: selectedStyle,
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
            throw new Error('Вы уже зарегистрированы в этой фиесте!');
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
 * Изменение высоты шара игроком
 */
async function updatePlayerAltitude(email, newAltitude) {
    if (newAltitude < 0 || newAltitude > 15000) {
        throw new Error('Недопустимая высота для аэростата (от 0 до 15000м)');
    }
    
    return await db.update(
        { email: email, status: 'flying' },
        { $set: { altitude: Number(newAltitude) } },
        { returnUpdatedDocs: true }
    );
}

/**
 * Фиксация финиша
 */
async function setPlayerFinished(email) {
    return await db.update(
        { email: email },
        { $set: { status: 'finished', speed: 0 } }
    );
}

/**
 * Получить текущие активные настройки гонки
 */
async function getActiveRaceConfig() {
    let config = await settingsDb.findOne({ type: 'race_config' });
    
    if (!config) {
        config = {
            type: 'race_config',
            finishCoords: { lat: 48.8584, lng: 2.2945 },
            startWindowFrom: new Date("2026-06-02T00:00:00Z").getTime(),
            startWindowTo: new Date("2026-06-10T23:59:59Z").getTime(),
            allowedStartRegion: {
                minLat: -56.0, maxLat: 75.0,
                minLng: -168.0, maxLng: -34.0
            },
            updatedBy: 'system'
        };
        await settingsDb.insert(config);
    }
    return config;
}

/**
 * Обновление настроек гонки администратором
 */
async function updateRaceConfig(adminEmail, newConfig) {
    if (adminEmail !== 'aerostar@aerost.art') {
        throw new Error('Доступ запрещен. Вы не являетесь администратором.');
    }

    return await settingsDb.update(
        { type: 'race_config' },
        { 
            $set: {
                finishCoords: { lat: Number(newConfig.lat), lng: Number(newConfig.lng) },
                startWindowFrom: new Date(newConfig.dateFrom).getTime(),
                startWindowTo: new Date(newConfig.dateTo).getTime(),
                allowedStartRegion: {
                    minLat: Number(newConfig.minLat), maxLat: Number(newConfig.maxLat),
                    minLng: Number(newConfig.minLng), maxLng: Number(newConfig.maxLng)
                },
                updatedBy: adminEmail,
                lastUpdated: Date.now()
            }
        },
        { returnUpdatedDocs: true }
    );
}

// ПРАВИЛЬНЫЙ СИНТАКСИС ЭКСПОРТА ОБЪЕКТА
module.exports = {
    rawDb: db,
    registerPlayer: registerPlayer,
    getPlayer: getPlayer,
    updatePlayerAltitude: updatePlayerAltitude,
    setPlayerFinished: setPlayerFinished,
    getActiveRaceConfig: getActiveRaceConfig,
    updateRaceConfig: updateRaceConfig
};
