/**
 * ИГРОВОЙ СЕРВИС ВЫСОТНЫХ ВЕТРОВ
 * Использует встроенный fetch (Node.js 18+)
 */

const CACHE_TTL =120000;
const windCache = new Map();

const PRESSURE_LEVELS = [
  { maxAltitude: 1500,  level: '925hPa', name: 'Приземный слой', pressure: 925 },
  { maxAltitude: 3000,  level: '850hPa', name: 'Нижняя тропосфера', pressure: 850 },
  { maxAltitude: 5500,  level: '700hPa', name: 'Средняя тропосфера', pressure: 700 },
  { maxAltitude: 9000,  level: '500hPa', name: 'Высотная тропосфера', pressure: 500 },
  { maxAltitude: 11000, level: '300hPa', name: 'Струйное течение', pressure: 300 },
  { maxAltitude: 14000, level: '250hPa', name: 'Нижняя стратосфера', pressure: 250 },
  { maxAltitude: Infinity, level: '200hPa', name: 'Стратосфера', pressure: 200 }
];

function getPressureLevelInfo(altitudeMeters) {
  const level = PRESSURE_LEVELS.find(p => altitudeMeters <= p.maxAltitude);
  return {
    level: level.level,
    name: level.name,
    pressure: level.pressure
  };
}

function getCacheKey(lat, lng, pressure) {
  const roundedLat = Math.round(lat * 100) / 100;
  const roundedLng = Math.round(lng * 100) / 100;
  return `${roundedLat},${roundedLng},${pressure}hPa`;
}

async function getWindAtPosition(lat, lng, altitude) {
  // Валидация входных данных
  if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    console.log(`[WindService] ❌ Невалидные координаты: ${lat}, ${lng}`);
    const levelInfo = getPressureLevelInfo(altitude || 1000);
    return {
      speed: 5 + Math.random() * 5,
      direction: 180 + Math.random() * 180,
      layerName: `${levelInfo.name} (резерв)`,
      level: levelInfo.level,
      pressure: levelInfo.pressure,
      altitude: altitude || 1000,
      timestamp: Date.now(),
      isFallback: true
    };
  }

  const levelInfo = getPressureLevelInfo(altitude);
  const targetLevel = levelInfo.level;
  const pressure = levelInfo.pressure;
  
  const cacheKey = getCacheKey(lat, lng, pressure);
  const cached = windCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log(`[WindService] 📦 Кэш для ${cacheKey}`);
    return cached.data;
  }

  // Формируем URL вручную, без URLSearchParams для совместимости
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=windspeed_${targetLevel},winddirection_${targetLevel}&wind_speed_unit=ms&forecast_days=1`;
  
  console.log(`[WindService] 🌐 Запрос: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Aerostar/2.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data?.hourly) {
      throw new Error('Нет данных hourly в ответе');
    }

    const currentUTCHour = new Date().getUTCHours();
    const windSpeedKey = `windspeed_${targetLevel}`;
    const windDirectionKey = `winddirection_${targetLevel}`;
    
    // Проверяем, есть ли данные за текущий час
    let speed = data.hourly[windSpeedKey]?.[currentUTCHour];
    let direction = data.hourly[windDirectionKey]?.[currentUTCHour];
    
    // Если нет - берём первый доступный час
    if (speed === undefined && data.hourly[windSpeedKey]?.length > 0) {
      speed = data.hourly[windSpeedKey][0];
      direction = data.hourly[windDirectionKey]?.[0] || 270;
      console.log(`[WindService] ⏰ Использован час 0 вместо ${currentUTCHour}`);
    }
    
    if (speed === undefined) {
      throw new Error(`Нет данных для ${targetLevel}`);
    }
    
    const windData = {
      speed: Number(speed),
      direction: Number(direction) || 270,
      layerName: levelInfo.name,
      level: targetLevel,
      pressure: pressure,
      altitude: altitude,
      timestamp: Date.now()
    };
    
    windCache.set(cacheKey, { data: windData, timestamp: Date.now() });
    console.log(`[WindService] ✅ Ветер: ${windData.speed} м/с, ${windData.direction}°`);
    
    return windData;
    
  } catch (error) {
    console.error(`[WindService] ❌ Ошибка:`, error.message);
    
    // Возвращаем резервный ветер
    const fallbackSpeed = 8 + Math.random() * 7;
    const fallbackDirection = 180 + Math.random() * 180;
    
    const fallbackData = {
      speed: fallbackSpeed,
      direction: fallbackDirection,
      layerName: `${levelInfo.name} (резерв)`,
      level: targetLevel,
      pressure: pressure,
      altitude: altitude,
      timestamp: Date.now(),
      isFallback: true
    };
    
    console.log(`[WindService] 🔄 Резерв: ${fallbackSpeed.toFixed(1)} м/с, ${Math.round(fallbackDirection)}°`);
    windCache.set(cacheKey, { data: fallbackData, timestamp: Date.now() - 3000 });
    return fallbackData;
  }
}

function clearWindCache() {
  windCache.clear();
  console.log('[WindService] 🗑️ Кэш очищен');
}

function getCacheStats() {
  return {
    totalEntries: windCache.size,
    cacheTTLms: CACHE_TTL
  };
}

module.exports = {
  getWindAtPosition,
  getPressureLevelInfo,
  altitudeToPressure: (m) => Math.round(1013.25 * Math.pow(1 - 0.0000225577 * m, 5.25588)),
  clearWindCache,
  getCacheStats
};
