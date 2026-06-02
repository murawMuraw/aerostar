
/**
 * ИГРОВОЙ СЕРВИС ВЫСОТНЫХ ВЕТРОВ
 * Использует модель GFS (Global Forecast System) через бесплатный API Open-Meteo
 */

/**
 * Карта высот в метрах и соответствующих им изобарических уровней (hPa)
 * Дополнительно хранит описание для вывода игроку в интерфейс.
 */
const PRESSURE_LEVELS = [
  { maxAltitude: 1500,  level: '925hPa', name: 'Приземный слой (эшелон 1)' },
  { maxAltitude: 3000,  level: '850hPa', name: 'Нижняя тропосфера (эшелон 2)' },
  { maxAltitude: 5500,  level: '700hPa', name: 'Средняя тропосфера (эшелон 3)' },
  { maxAltitude: 9000,  level: '500hPa', name: 'Высотная тропосфера (эшелон 4)' },
  { maxAltitude: 11000, level: '300hPa', name: 'Струйное течение - Jet Stream (эшелон 5)' },
  { maxAltitude: 14000, level: '250hPa', name: 'Нижняя стратосфера (эшелон 6)' },
  { maxAltitude: Infinity, level: '200hPa', name: 'Стратосфера (максимальный эшелон)' }
];

/**
 * Подбирает метеорологический уровень давления в зависимости от высоты полета шара
 * @param {number} altitudeMeters - Высота шара в метрах
 * @returns {Object} Объект уровня давления { level, name }
 */
function getPressureLevelInfo(altitudeMeters) {
  return PRESSURE_LEVELS.find(p => altitudeMeters <= p.maxAltitude);
}

/**
 * Запрашивает вектор высотного ветра для конкретной точки Земли
 * @param {number} lat - Широта (-90 до 90)
 * @param {number} lng - Долгота (-180 до 180)
 * @param {number} altitude - Высота в метрах
 * @returns {Promise<Object>} Данные ветра: speed (м/с), direction (градусы), name (название эшелона)
 */
async function getWindAtPosition(lat, lng, altitude) {
  const levelInfo = getPressureLevelInfo(altitude);
  const targetLevel = levelInfo.level;

  // Формируем URL к Open-Meteo Pressure Level API
  // Запрашиваем скорость и направление ветра на выбранном hPa уровне в м/с
  const url = `https://open-meteo.com{lat}&longitude=${lng}&hourly=windspeed_${targetLevel},winddirection_${targetLevel}&wind_speed_unit=ms&forecast_days=1`;

  try {
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
    const rawSpeed = hourlyData[`windspeed_${targetLevel}`][currentUTCHour];
    const rawDirection = hourlyData[`winddirection_${targetLevel}`][currentUTCHour];

    // Проверяем валидность полученных данных
    if (rawSpeed === undefined || rawDirection === undefined) {
      throw new Error('Не удалось найти данные на текущий час');
    }

    return {
      speed: Number(rawSpeed),         // Скорость в метрах в секунду (м/с)
      direction: Number(rawDirection), // Направление от 0 до 360 градусов (откуда дует)
      layerName: levelInfo.name,       // Красивое имя эшелона для пилота
      level: targetLevel               // Код уровня (например, '500hPa')
    };

  } catch (error) {
    console.error(`[WindService Error] Координаты: [${lat}, ${lng}], Высота: ${altitude}м. Причина:`, error.message);
    
    // БЕЗОПАСНЫЙ РЕЗЕРВНЫЙ ВАРЬЯНТ (Пассат / Западный перенос)
    // Если упал интернет или API выдал ошибку, выдаем стабильный умеренный ветер, 
    // чтобы игра не зависла и шары участников не упали на месте.
    return {
      speed: 4.5,                      // 4.5 м/с (~16 км/ч)
      direction: 270,                  // Строго с запада на восток (поможет лететь к Парижу)
      layerName: `${levelInfo.name} (Резервный режим)`,
      level: targetLevel
    };
  }
}

module.exports = {
  getWindAtPosition,
  getPressureLevelInfo
};
