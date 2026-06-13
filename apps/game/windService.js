/**
 * ИГРОВОЙ СЕРВИС ВЫСОТНЫХ ВЕТРОВ
 * Использует модель GFS (Global Forecast System) через бесплатный API Open-Meteo
 * 
 * Версия 2.0:
 * - Ветер возвращается в м/с
 * - Высота преобразуется в hPa согласно международной стандартной атмосфере
 * - Исправлены опечатки в URL
 * - Встроенное кэширование запросов (10 секунд)
 */
const fetch = require('node-fetch');
const CACHE_TTL = 10000; // Время жизни кэша 10 секунд

/**
 * Кэш для хранения данных о ветре
 * Структура: cache.set(key, { data, timestamp })
 */
const windCache = new Map();

/**
 * Карта высот в метрах и соответствующих им изобарических уровней (hPa)
 * Основано на международной стандартной атмосфере (ISA)
 */
const PRESSURE_LEVELS = [
  { maxAltitude: 1500,  level: '925hPa', name: 'Приземный слой (эшелон 1)', pressure: 925 },
  { maxAltitude: 3000,  level: '850hPa', name: 'Нижняя тропосфера (эшелон 2)', pressure: 850 },
  { maxAltitude: 5500,  level: '700hPa', name: 'Средняя тропосфера (эшелон 3)', pressure: 700 },
  { maxAltitude: 9000,  level: '500hPa', name: 'Высотная тропосфера (эшелон 4)', pressure: 500 },
  { maxAltitude: 11000, level: '300hPa', name: 'Струйное течение (эшелон 5)', pressure: 300 },
  { maxAltitude: 14000, level: '250hPa', name: 'Нижняя стратосфера (эшелон 6)', pressure: 250 },
  { maxAltitude: Infinity, level: '200hPa', name: 'Стратосфера (максимальный эшелон)', pressure: 200 }
];

/**
 * Преобразует высоту в метрах в давление (hPa) по стандартной атмосфере
 * Используется упрощенная барометрическая формула для тропосферы
 * @param {number} altitudeMeters - Высота в метрах
 * @returns {number} Давление в hPa
 */
function altitudeToPressure(altitudeMeters) {
  // Стандартное давление на уровне моря: 1013.25 hPa
  // Температурный градиент: -6.5°C на км
  // Упрощенная формула: P = P0 * (1 - 0.0000225577 * h)^5.25588
  const h = altitudeMeters;
  const pressure = 1013.25 * Math.pow(1 - 0.0000225577 * h, 5.25588);
  return Math.round(pressure);
}

/**
 * Подбирает метеорологический уровень давления в зависимости от высоты полета шара
 * @param {number} altitudeMeters - Высота шара в метрах
 * @returns {Object} Объект уровня давления { level, name, pressure }
 */
function getPressureLevelInfo(altitudeMeters) {
  const level = PRESSURE_LEVELS.find(p => altitudeMeters <= p.maxAltitude);
  return {
    level: level.level,
    name: level.name,
    pressure: level.pressure
  };
}

/**
 * Генерирует уникальный ключ для кэша на основе координат, высоты и времени
 * @param {number} lat - Широта
 * @param {number} lng - Долгота  
 * @param {number} pressure - Давление в hPa
 * @returns {string} Ключ для кэша
 */
function getCacheKey(lat, lng, pressure) {
  // Округляем координаты до 2 знаков для группировки близких запросов
  const roundedLat = Math.round(lat * 100) / 100;
  const roundedLng = Math.round(lng * 100) / 100;
  return `${roundedLat},${roundedLng},${pressure}hPa`;
}

/**
 * Запрашивает вектор высотного ветра для конкретной точки Земли
 * @param {number} lat - Широта (-90 до 90)
 * @param {number} lng - Долгота (-180 до 180)
 * @param {number} altitude - Высота в метрах
 * @returns {Promise<Object>} Данные ветра: speed (м/с), direction (градусы), name (название эшелона)
 */
async function getWindAtPosition(lat, lng, altitude) {
  // Получаем информацию об уровне давления
  const levelInfo = getPressureLevelInfo(altitude);
  const targetLevel = levelInfo.level;
  const pressure = levelInfo.pressure;
  
  // Проверяем кэш
  const cacheKey = getCacheKey(lat, lng, pressure);
  const cached = windCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log(`[WindService] Использован кэш для ${cacheKey}`);
    return cached.data;
  }

  // Формируем правильный URL к Open-Meteo API
  // Используем pressure level API для получения ветра на конкретном барическом уровне
  const baseUrl = 'https://api.open-meteo.com/v1/forecast';
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lng.toString(),
    hourly: `windspeed_${targetLevel},winddirection_${targetLevel}`,
    wind_speed_unit: 'ms',
    forecast_days: '1'
  });
  
  const url = `${baseUrl}?${params.toString()}`;

  try {
    console.log(`[WindService] Запрос ветра: ${url}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    const hourlyData = data.hourly;
    
    if (!hourlyData) {
      throw new Error('Данные погоды отсутствуют в ответе API');
    }

    // Определяем текущий час по UTC (метеомодели всегда работают по всемирному времени)
    const currentUTCHour = new Date().getUTCHours();
    
    // Извлекаем скорость (м/с) и направление (откуда дует, в градусах)
    const windSpeedKey = `windspeed_${targetLevel}`;
    const windDirectionKey = `winddirection_${targetLevel}`;
    
    const rawSpeed = hourlyData[windSpeedKey]?.[currentUTCHour];
    const rawDirection = hourlyData[windDirectionKey]?.[currentUTCHour];

    // Проверяем валидность полученных данных
    if (rawSpeed === undefined || rawDirection === undefined) {
      throw new Error(`Не удалось найти данные на час ${currentUTCHour} для уровня ${targetLevel}`);
    }

    const windData = {
      speed: Number(rawSpeed),         // Скорость в метрах в секунду (м/с)
      direction: Number(rawDirection), // Направление от 0 до 360 градусов (откуда дует)
      layerName: levelInfo.name,       // Красивое имя эшелона для пилота
      level: targetLevel,              // Код уровня (например, '500hPa')
      pressure: pressure,              // Давление в hPa
      altitude: altitude,              // Исходная высота в метрах
      timestamp: Date.now()            // Время получения данных
    };
    
    // Сохраняем в кэш
    windCache.set(cacheKey, {
      data: windData,
      timestamp: Date.now()
    });
    
    console.log(`[WindService] Ветер на ${levelInfo.name} (${pressure}hPa): ${windData.speed} м/с, направление ${windData.direction}°`);
    
    return windData;

  } catch (error) {
    console.error(`[WindService Error] Координаты: [${lat}, ${lng}], Высота: ${altitude}м (${targetLevel}). Причина:`, error.message);
    
    // БЕЗОПАСНЫЙ РЕЗЕРВНЫЙ ВАРИАНТ
    // Если упал интернет или API выдал ошибку, выдаем стабильный умеренный ветер
    console.log(`[WindService] Использован резервный режим для ${cacheKey}`);
    
    const fallbackData = {
      speed: 5.0,                      // 5 м/с (~18 км/ч) - умеренный ветер
      direction: 270,                  // Строго с запада на восток (поможет лететь к Парижу)
      layerName: `${levelInfo.name} (Резервный режим)`,
      level: targetLevel,
      pressure: pressure,
      altitude: altitude,
      timestamp: Date.now(),
      isFallback: true
    };
    
    // Резервные данные тоже кэшируем, но с меньшим TTL (5 секунд)
    windCache.set(cacheKey, {
      data: fallbackData,
      timestamp: Date.now() - (CACHE_TTL / 2) // Чтобы быстрее обновились при восстановлении связи
    });
    
    return fallbackData;
  }
}

/**
 * Очищает кэш ветров (полезно при смене метеоусловий)
 */
function clearWindCache() {
  windCache.clear();
  console.log('[WindService] Кэш ветров очищен');
}

/**
 * Получает статистику кэша (для отладки)
 * @returns {Object} Статистика кэша
 */
function getCacheStats() {
  const now = Date.now();
  let validCount = 0;
  let expiredCount = 0;
  
  for (const [key, value] of windCache.entries()) {
    if (now - value.timestamp < CACHE_TTL) {
      validCount++;
    } else {
      expiredCount++;
    }
  }
  
  return {
    totalEntries: windCache.size,
    validEntries: validCount,
    expiredEntries: expiredCount,
    cacheTTLms: CACHE_TTL
  };
}

module.exports = {
  getWindAtPosition,
  getPressureLevelInfo,
  altitudeToPressure,
  clearWindCache,
  getCacheStats
};
