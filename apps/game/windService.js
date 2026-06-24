const fetch = require('node-fetch');

// Кэш: ключ — balloonId, значение — { timestamp, layers: [...] }
const balloonWindCache = new Map();

const PRESSURE_LEVELS = [
  { altitude: 0, param: 'wind_speed_10m,wind_direction_10m', keySpeed: 'wind_speed_10m', keyDir: 'wind_direction_10m', name: 'Surface Layer' },
  { altitude: 1000, param: 'wind_speed_1000hPa,wind_direction_1000hPa', keySpeed: 'wind_speed_1000hPa', keyDir: 'wind_direction_1000hPa', name: 'Lower Winds' },
  { altitude: 3000, param: 'wind_speed_700hPa,wind_direction_700hPa', keySpeed: 'wind_speed_700hPa', keyDir: 'wind_direction_700hPa', name: 'Mid Winds' },
  { altitude: 5000, param: 'wind_speed_500hPa,wind_direction_500hPa', keySpeed: 'wind_speed_500hPa', keyDir: 'wind_direction_500hPa', name: 'Upper Winds' },
  { altitude: 10000, param: 'wind_speed_250hPa,wind_direction_250hPa', keySpeed: 'wind_speed_250hPa', keyDir: 'wind_direction_250hPa', name: 'Jet Stream' }
];

/**
 * Запрашивает погоду для координат конкретного шара и сохраняет в кэш
 */
async function fetchAndCacheWindForBalloon(balloonId, lat, lng) {
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

    balloonWindCache.set(balloonId, {
      timestamp: Date.now(),
      layers: parsedLayers
    });
    
    return true;
  } catch (error) {
    console.error(`❌ Error fetching wind for balloon ${balloonId}:`, error.message);
    return false;
  }
}

/**
 * Синхронно возвращает ветер из кэша для шара на его текущей высоте
 */
function getCachedWindForBalloon(balloonId, altitude) {
  const cached = balloonWindCache.get(balloonId);
  
  // Если игра только запустилась и кэш еще пуст — даем дефолтный ветер, чтобы сервер не упал
  if (!cached) {
    return { speed: 3.0, direction: 90, layerName: 'Initial Layer' }; 
  }

  // Находим ближайший по высоте атмосферный слой
  return cached.layers.reduce((prev, curr) => 
    Math.abs(curr.altitude - altitude) < Math.abs(prev.altitude - altitude) ? curr : prev
  );
}

// Экспортируем ровно те функции, которые вызываем в server.js
module.exports = {
  fetchAndCacheWindForBalloon,
  getCachedWindForBalloon
};
