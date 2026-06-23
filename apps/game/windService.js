const fetch = require('node-fetch');

// Глобальный кэш для хранения последнего состояния
let globalWindCache = null;
let pollingIntervalId = null;

// Настройка слоев атмосферы
const PRESSURE_LEVELS = [
  { altitude: 0, param: 'wind_speed_10m,wind_direction_10m', keySpeed: 'wind_speed_10m', keyDir: 'wind_direction_10m', name: 'Surface Layer' },
  { altitude: 1000, param: 'wind_speed_1000hPa,wind_direction_1000hPa', keySpeed: 'wind_speed_1000hPa', keyDir: 'wind_direction_1000hPa', name: 'Lower Winds' },
  { altitude: 2000, param: 'wind_speed_850hPa,wind_direction_850hPa', keySpeed: 'wind_speed_850hPa', keyDir: 'wind_direction_850hPa', name: 'Mid-Lower Winds' },
  { altitude: 3000, param: 'wind_speed_700hPa,wind_direction_700hPa', keySpeed: 'wind_speed_700hPa', keyDir: 'wind_direction_700hPa', name: 'Mid Winds' },
  { altitude: 5000, param: 'wind_speed_500hPa,wind_direction_500hPa', keySpeed: 'wind_speed_500hPa', keyDir: 'wind_direction_500hPa', name: 'Upper Winds' },
  { altitude: 8000, param: 'wind_speed_300hPa,wind_direction_300hPa', keySpeed: 'wind_speed_300hPa', keyDir: 'wind_direction_300hPa', name: 'High Winds' },
  { altitude: 10000, param: 'wind_speed_250hPa,wind_direction_250hPa', keySpeed: 'wind_speed_250hPa', keyDir: 'wind_direction_250hPa', name: 'Jet Stream' }
];

/**
 * Запуск фонового обновления данных (вызывать при старте сервера)
 */
function startWindPolling(lat, lng) {
  if (pollingIntervalId) return;

  // Склеиваем все параметры в один запрос для GFS
  const allParams = PRESSURE_LEVELS.map(level => level.param).join(',');
  const url = `https://open-meteo.com{lat}&longitude=${lng}&current=${allParams}`;

  const updateCache = async () => {
    try {
      console.log(`🌤 [Polling] Updating wind data for ${lat}, ${lng}...`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      if (!data || !data.current) throw new Error('Invalid data structure');

      // Парсим ответ и структурируем слои по высотам
      const parsedLayers = PRESSURE_LEVELS.map(level => {
        const speedKmh = data.current[level.keySpeed] || 0;
        const direction = data.current[level.keyDir] || 0;
        return {
          altitude: level.altitude,
          layerName: level.name,
          speed: Math.round((speedKmh / 3.6) * 10) / 10, // км/ч -> м/с
          direction: Math.round(direction)
        };
      });

      globalWindCache = {
        timestamp: Date.now(),
        layers: parsedLayers
      };
      console.log('📦 [Polling] Cache successfully updated');
    } catch (error) {
      console.error('❌ [Polling] Error fetching wind data:', error.message);
    }
  };

  // Первый запуск при инициализации
  updateCache();

  // Запуск интервала на 300 000 мс (300 секунд)
  pollingIntervalId = setInterval(updateCache, 300000);
}

/**
 * Быстрое получение данных из кэша для конкретной высоты
 */
function getWindAtPosition(altitude = 1000) {
  // Если кэш пуст (например, первый запрос еще выполняется), отдаем временный fallback
  if (!globalWindCache) {
    console.warn('⚠ Cache is empty, returning temporary fallback');
    return { speed: 5.0, direction: 180, altitude, source: 'initial-fallback' };
  }

  // Находим ближайший по высоте слой из закэшированных данных
  const closestLayer = globalWindCache.layers.reduce((prev, curr) => 
    Math.abs(curr.altitude - altitude) < Math.abs(prev.altitude - altitude) ? curr : prev
  );

  return {
    ...closestLayer,
    requestedAltitude: altitude,
    cacheAge: Math.round((Date.now() - globalWindCache.timestamp) / 1000),
    source: 'cache'
  };
}

/**
 * Остановка фонового процесса (для тестов или перезагрузки)
 */
function stopWindPolling() {
  if (pollingIntervalId) {
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
    console.log('🧹 Polling stopped');
  }
}

module.exports = {
  startWindPolling,
  getWindAtPosition,
  stopWindPolling
};
