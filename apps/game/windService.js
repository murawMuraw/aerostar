const fetch = require('node-fetch');

// Кэш: ключ — координаты (lat_lng), значение — { timestamp, layers: [...] }
const windCache = new Map();
const CACHE_TTL = 300000; // 5 минут

const PRESSURE_LEVELS = [
  { altitude: 0, param: 'wind_speed_10m,wind_direction_10m', keySpeed: 'wind_speed_10m', keyDir: 'wind_direction_10m', name: 'Surface Layer' },
  { altitude: 1000, param: 'wind_speed_1000hPa,wind_direction_1000hPa', keySpeed: 'wind_speed_1000hPa', keyDir: 'wind_direction_1000hPa', name: 'Lower Winds' },
  { altitude: 3000, param: 'wind_speed_700hPa,wind_direction_700hPa', keySpeed: 'wind_speed_700hPa', keyDir: 'wind_direction_700hPa', name: 'Mid Winds' },
  { altitude: 5000, param: 'wind_speed_500hPa,wind_direction_500hPa', keySpeed: 'wind_speed_500hPa', keyDir: 'wind_direction_500hPa', name: 'Upper Winds' },
  { altitude: 10000, param: 'wind_speed_250hPa,wind_direction_250hPa', keySpeed: 'wind_speed_250hPa', keyDir: 'wind_direction_250hPa', name: 'Jet Stream' }
];

/**
 * Получает информацию о слое по высоте
 */
function getPressureLevelInfo(altitude) {
  // Находим ближайший слой
  const nearest = PRESSURE_LEVELS.reduce((prev, curr) => 
    Math.abs(curr.altitude - altitude) < Math.abs(prev.altitude - altitude) ? curr : prev
  );
  
  return {
    name: nearest.name,
    altitude: nearest.altitude
  };
}

/**
 * Запрашивает погоду для координат
 */
async function fetchWindForPosition(lat, lng) {
  const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
  
  // Проверяем кэш
  const cached = windCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log(`📦 Using cached wind for ${cacheKey}`);
    return cached.layers;
  }

  const allParams = PRESSURE_LEVELS.map(level => level.param).join(',');
  const url = `https://open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=${allParams}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (!data || !data.current) throw new Error('Invalid Open-Meteo response structure');

    const parsedLayers = PRESSURE_LEVELS.map(level => ({
      altitude: level.altitude,
      layerName: level.name,
      speed: Math.round((data.current[level.keySpeed] / 3.6) * 10) / 10, // км/ч -> м/с
      direction: Math.round(data.current[level.keyDir])
    }));

    // Сохраняем в кэш
    windCache.set(cacheKey, {
      timestamp: Date.now(),
      layers: parsedLayers
    });

    console.log(`✅ Wind data cached for ${cacheKey}`);
    return parsedLayers;
  } catch (error) {
    console.error(`❌ Error fetching wind for ${lat}, ${lng}:`, error.message);
    // Возвращаем дефолтные значения
    return PRESSURE_LEVELS.map(level => ({
      altitude: level.altitude,
      layerName: level.name,
      speed: 3.0,
      direction: 90
    }));
  }
}

/**
 * Основная функция для получения ветра в позиции
 */
async function getWindAtPosition(lat, lng, altitude) {
  const layers = await fetchWindForPosition(lat, lng);
  
  // Находим ближайший слой по высоте
  const nearest = layers.reduce((prev, curr) => 
    Math.abs(curr.altitude - altitude) < Math.abs(prev.altitude - altitude) ? curr : prev
  );

  return {
    speed: nearest.speed,
    direction: nearest.direction,
    layerName: nearest.layerName,
    altitude: nearest.altitude,
    timestamp: Date.now()
  };
}

// Экспортируем все функции, которые используются в server.js
module.exports = {
  getWindAtPosition,
  getPressureLevelInfo,
  fetchWindForPosition, // для внешнего использования
  PRESSURE_LEVELS
};
