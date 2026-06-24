const fetch = require('node-fetch');

// Кэш: ключ — координаты (lat_lng), значение — { timestamp, layers: [...] }
const windCache = new Map();
const CACHE_TTL = 300000; // 5 минут
const MAX_RETRIES = 10; // Максимальное количество попыток
const RETRY_DELAY = 5000; // Задержка между попытками (5 секунд)

const PRESSURE_LEVELS = [
  { altitude: 0, param: 'wind_speed_10m,wind_direction_10m', keySpeed: 'wind_speed_10m', keyDir: 'wind_direction_10m', name: 'Surface Layer' },
  { altitude: 1000, param: 'wind_speed_1000hPa,wind_direction_1000hPa', keySpeed: 'wind_speed_1000hPa', keyDir: 'wind_direction_1000hPa', name: 'Lower Winds' },
  { altitude: 3000, param: 'wind_speed_700hPa,wind_direction_700hPa', keySpeed: 'wind_speed_700hPa', keyDir: 'wind_direction_700hPa', name: 'Mid Winds' },
  { altitude: 5000, param: 'wind_speed_500hPa,wind_direction_500hPa', keySpeed: 'wind_speed_500hPa', keyDir: 'wind_direction_500hPa', name: 'Upper Winds' },
  { altitude: 10000, param: 'wind_speed_250hPa,wind_direction_250hPa', keySpeed: 'wind_speed_250hPa', keyDir: 'wind_direction_250hPa', name: 'Jet Stream' }
];

// Хранилище для активных запросов
const pendingRequests = new Map();

/**
 * Получает информацию о слое по высоте
 */
function getPressureLevelInfo(altitude) {
  const nearest = PRESSURE_LEVELS.reduce((prev, curr) => 
    Math.abs(curr.altitude - altitude) < Math.abs(prev.altitude - altitude) ? curr : prev
  );
  
  return {
    name: nearest.name,
    altitude: nearest.altitude
  };
}

/**
 * Задержка (промис)
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Запрашивает погоду для координат с повторными попытками
 */
async function fetchWindForPosition(lat, lng, retryCount = 0) {
  const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
  
  // Проверяем кэш
  const cached = windCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log(`📦 Using cached wind for ${cacheKey}`);
    return cached.layers;
  }

  // Проверяем, есть ли уже активный запрос для этих координат
  const requestKey = cacheKey;
  if (pendingRequests.has(requestKey)) {
    console.log(`⏳ Waiting for pending request for ${cacheKey}`);
    return await pendingRequests.get(requestKey);
  }

  // Создаем промис для запроса
  const requestPromise = (async () => {
    const allParams = PRESSURE_LEVELS.map(level => level.param).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=${allParams}`;

    let lastError = null;
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(`🌤️ Fetching weather for ${lat}, ${lng}... (attempt ${attempt + 1}/${MAX_RETRIES})`);
        
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();

        if (!data || !data.current) {
          throw new Error('Invalid Open-Meteo response structure');
        }

        const parsedLayers = PRESSURE_LEVELS.map(level => {
          let speed = 0;
          let direction = 0;
          
          // Проверяем наличие данных
          if (data.current[level.keySpeed] !== undefined && data.current[level.keySpeed] !== null) {
            // Конвертируем км/ч в м/с
            speed = Math.round((data.current[level.keySpeed] / 3.6) * 10) / 10;
          } else {
            throw new Error(`No speed data for ${level.name}`);
          }
          
          if (data.current[level.keyDir] !== undefined && data.current[level.keyDir] !== null) {
            direction = Math.round(data.current[level.keyDir]);
          } else {
            throw new Error(`No direction data for ${level.name}`);
          }
          
          return {
            altitude: level.altitude,
            layerName: level.name,
            speed: speed,
            direction: direction
          };
        });

        // Сохраняем в кэш
        windCache.set(cacheKey, {
          timestamp: Date.now(),
          layers: parsedLayers
        });

        console.log(`✅ Wind data cached for ${cacheKey}`);
        return parsedLayers;
        
      } catch (error) {
        lastError = error;
        console.error(`❌ Attempt ${attempt + 1} failed for ${lat}, ${lng}:`, error.message);
        
        if (attempt < MAX_RETRIES - 1) {
          console.log(`⏳ Waiting ${RETRY_DELAY}ms before retry...`);
          await sleep(RETRY_DELAY);
        }
      }
    }

    // Если все попытки провалились
    console.error(`❌ All ${MAX_RETRIES} attempts failed for ${lat}, ${lng}`);
    throw new Error(`Failed to fetch weather after ${MAX_RETRIES} attempts: ${lastError.message}`);
  })();

  // Сохраняем запрос в pending
  pendingRequests.set(requestKey, requestPromise);
  
  try {
    const result = await requestPromise;
    return result;
  } finally {
    // Удаляем из pending после завершения
    pendingRequests.delete(requestKey);
  }
}

/**
 * Основная функция для получения ветра в позиции
 */
async function getWindAtPosition(lat, lng, altitude) {
  try {
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
  } catch (error) {
    console.error(`❌ Error getting wind for position ${lat}, ${lng}:`, error.message);
    // В случае ошибки возвращаем значения по умолчанию
    return {
      speed: 5.0,
      direction: 180,
      layerName: 'Default (Error)',
      altitude: altitude,
      timestamp: Date.now()
    };
  }
}

/**
 * Функция для обновления кэша для конкретного шара
 */
async function fetchAndCacheWindForBalloon(balloonId, lat, lng) {
  try {
    const layers = await fetchWindForPosition(lat, lng);
    // Сохраняем в кэш с ключом по balloonId для обратной совместимости
    const cacheKey = `balloon_${balloonId}`;
    windCache.set(cacheKey, {
      timestamp: Date.now(),
      layers: layers,
      lat: lat,
      lng: lng
    });
    console.log(`✅ Wind cached for balloon ${balloonId}`);
    return true;
  } catch (error) {
    console.error(`❌ Error caching wind for balloon ${balloonId}:`, error.message);
    return false;
  }
}

/**
 * Получение ветра из кэша для шара
 */
function getCachedWindForBalloon(balloonId, altitude) {
  const cacheKey = `balloon_${balloonId}`;
  const cached = windCache.get(cacheKey);
  
  // Если кэш пуст или устарел - возвращаем значения по умолчанию
  if (!cached || (Date.now() - cached.timestamp) > CACHE_TTL) {
    console.log(`⚠️ No valid cache for balloon ${balloonId}, waiting for API response...`);
    return {
      speed: 0,
      direction: 0,
      layerName: 'Waiting for data...'
    };
  }

  // Находим ближайший слой по высоте
  const nearest = cached.layers.reduce((prev, curr) => 
    Math.abs(curr.altitude - altitude) < Math.abs(prev.altitude - altitude) ? curr : prev
  );

  return {
    speed: nearest.speed,
    direction: nearest.direction,
    layerName: nearest.layerName
  };
}

/**
 * Проверяет, есть ли данные в кэше
 */
function hasValidCache(balloonId) {
  const cacheKey = `balloon_${balloonId}`;
  const cached = windCache.get(cacheKey);
  return cached && (Date.now() - cached.timestamp) < CACHE_TTL;
}

// Экспортируем все функции
module.exports = {
  getWindAtPosition,
  getPressureLevelInfo,
  fetchWindForPosition,
  fetchAndCacheWindForBalloon,
  getCachedWindForBalloon,
  hasValidCache,
  PRESSURE_LEVELS
};
