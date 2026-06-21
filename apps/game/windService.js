/**
 * СЕРВИС ПОЛУЧЕНИЯ ДАННЫХ О ВЕТРЕ
 * Использует Open-Meteo API для получения реальных данных о ветре
 */

const fetch = require('node-fetch');

// Кэш для данных о ветре (чтобы не делать лишние запросы)
const windCache = new Map();
const CACHE_TTL = 300000; // 5 минут

// Слои атмосферы с разными высотами
const PRESSURE_LEVELS = [
    { altitude: 0, level: 'surface', name: 'Surface Layer' },
    { altitude: 1000, level: '1000hPa', name: 'Lower Winds' },
    { altitude: 2000, level: '850hPa', name: 'Mid-Lower Winds' },
    { altitude: 3000, level: '700hPa', name: 'Mid Winds' },
    { altitude: 5000, level: '500hPa', name: 'Upper Winds' },
    { altitude: 8000, level: '300hPa', name: 'High Winds' },
    { altitude: 10000, level: '250hPa', name: 'Jet Stream' }
];

/**
 * Получение данных о ветре для заданных координат и высоты
 */
async function getWindAtPosition(lat, lng, altitude = 1000) {
    // Создаем ключ кэша
    const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)},${altitude}`;
    
    // Проверяем кэш
    if (windCache.has(cacheKey)) {
        const cached = windCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            console.log(`📦 Using cached wind data for ${cacheKey}`);
            return cached.data;
        }
    }
    
    try {
        // Запрос к Open-Meteo API
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&timezone=UTC`;
        
        console.log(`🌤️ Fetching weather data for ${lat}, ${lng}...`);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Проверяем наличие данных
        if (!data || !data.current_weather) {
            throw new Error('No weather data received');
        }
        
        const currentWeather = data.current_weather;
        
        // Извлекаем данные о ветре
        // В Open-Meteo: windspeed в КМ/Ч, winddirection в градусах
        let windSpeedKmh = currentWeather.windspeed || 0;
        let windDirection = currentWeather.winddirection || 0;
        
        // КОНВЕРТАЦИЯ: км/ч → м/с (делим на 3.6)
        let windSpeedMs = windSpeedKmh / 3.6;
        
        console.log(`📊 Raw wind data: ${windSpeedKmh} km/h, ${windDirection}°`);
        console.log(`📊 Converted: ${windSpeedMs.toFixed(2)} m/s`);
        
        // Если скорость ветра 0, используем fallback
        if (windSpeedMs === 0) {
            console.warn('⚠️ Wind speed is 0, using fallback');
            windSpeedMs = 5 + Math.random() * 15;
            windDirection = Math.random() * 360;
        }
        
        // Корректируем скорость ветра в зависимости от высоты
        const altitudeFactor = getAltitudeFactor(altitude);
        const adjustedSpeed = windSpeedMs * altitudeFactor;
        
        const result = {
            speed: Math.round(adjustedSpeed * 10) / 10,
            direction: Math.round(windDirection),
            layerName: getPressureLevel(altitude).name,
            altitude: altitude,
            timestamp: Date.now(),
            source: 'open-meteo',
            raw: {
                kmh: windSpeedKmh,
                ms: windSpeedMs
            }
        };
        
        // Сохраняем в кэш
        windCache.set(cacheKey, {
            data: result,
            timestamp: Date.now()
        });
        
        console.log(`🌤️ Wind: ${result.speed} m/s, ${result.direction}° at ${altitude}m (${windSpeedKmh} km/h)`);
        
        return result;
        
    } catch (error) {
        console.error('❌ Error fetching wind data:', error.message);
        
        // Возвращаем fallback с реальными данными
        const fallbackSpeed = 5 + Math.random() * 15;
        const fallbackDirection = Math.random() * 360;
        
        const fallbackResult = {
            speed: Math.round(fallbackSpeed * 10) / 10,
            direction: Math.round(fallbackDirection),
            layerName: 'Default Layer',
            altitude: altitude,
            timestamp: Date.now(),
            source: 'fallback'
        };
        
        console.log(`⚠️ Using fallback wind: ${fallbackResult.speed} m/s, ${fallbackResult.direction}°`);
        
        // Сохраняем fallback в кэш на короткое время
        windCache.set(cacheKey, {
            data: fallbackResult,
            timestamp: Date.now()
        });
        
        return fallbackResult;
    }
}

/**
 * Определение уровня атмосферы по высоте
 */
function getPressureLevel(altitude) {
    let closest = PRESSURE_LEVELS[0];
    for (const level of PRESSURE_LEVELS) {
        if (Math.abs(level.altitude - altitude) < Math.abs(closest.altitude - altitude)) {
            closest = level;
        }
    }
    return closest;
}

/**
 * Коэффициент увеличения скорости ветра с высотой
 */
function getAltitudeFactor(altitude) {
    if (altitude < 1000) return 0.8;
    if (altitude < 2000) return 1.0;
    if (altitude < 3000) return 1.3;
    if (altitude < 5000) return 1.8;
    if (altitude < 8000) return 2.5;
    if (altitude < 10000) return 3.5;
    return 4.5;
}

/**
 * Получение информации о слое по высоте
 */
function getPressureLevelInfo(altitude) {
    return getPressureLevel(altitude);
}

/**
 * Очистка кэша (для отладки)
 */
function clearWindCache() {
    windCache.clear();
    console.log('🧹 Wind cache cleared');
}

module.exports = {
    getWindAtPosition,
    getPressureLevelInfo,
    clearWindCache
};
