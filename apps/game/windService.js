const fetch = require('node-fetch');

// Кэш, где ключ — ID шара, а значение — объект с ветром на всех высотах для этого шара
const ballonsWindCache = new Map();

// Слои давления, которые мы запрашиваем у GFS
const PRESSURE_LAYERS = [
  { level: '10m', hpa: '10m' },
  { level: '1000hPa', hpa: '1000hPa' },
  { level: '850hPa', hpa: '850hPa' },
  { level: '700hPa', hpa: '700hPa' },
  { level: '500hPa', hpa: '500hPa' },
  { level: '300hPa', hpa: '300hPa' }
];

// Массив для поиска ближайшего слоя по высоте в метрах
const ALTITUDE_MAP = [
  { alt: 0, suffix: '10m', name: 'Surface' },
  { alt: 1000, suffix: '1000hPa', name: '1000 hPa' },
  { alt: 2000, suffix: '850hPa', name: '850 hPa' },
  { alt: 3000, suffix: '700hPa', name: '700 hPa' },
  { alt: 5000, suffix: '500hPa', name: '500 hPa' },
  { alt: 9000, suffix: '300hPa', name: '300 hPa' }
];

/**
 * Пакетное обновление ветра для всех активных шаров (1 запрос на всех)
 */
async function updateWindForBalloons(balloonsList) {
  if (balloonsList.length === 0) return;

  // 1. Формируем списки координат через запятую
  const lats = balloonsList.map(b => b.lat.toFixed(4)).join(',');
  const lngs = balloonsList.map(b => b.lng.toFixed(4)).join(',');

  // 2. Формируем список всех нужных параметров ветра для GFS
  const params = PRESSURE_LAYERS.map(l => `wind_speed_${l.level},wind_direction_${l.level}`).join(',');
  
  const url = `https://open-meteo.com{lats}&longitude=${lngs}&current=${params}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    // Переводим ответ в массив (Open-Meteo возвращает массив объектов, если передано несколько координат)
    const dataArray = Array.isArray(data) ? data : [data];

    // 3. Раскладываем данные по конкретным шарам в кэш
    balloonsList.forEach((balloon, index) => {
      const balloonData = dataArray[index];
      if (!balloonData || !balloonData.current) return;

      const layersWind = {};
      ALTITUDE_MAP.forEach(layer => {
        const speedKmh = balloonData.current[`wind_speed_${layer.suffix}`] || 0;
        const direction = balloonData.current[`wind_direction_${layer.suffix}`] || 0;

        layersWind[layer.suffix] = {
          speed: Math.round((speedKmh / 3.6) * 10) / 10, // км/ч -> м/с
          direction: Math.round(direction),
          layerName: layer.name
        };
      });

      // Сохраняем в кэш весь "пирог" ветров для этого шара
      ballonsWindCache.set(balloon.id, {
        timestamp: Date.now(),
        layers: layersWind
      });
    });

    console.log(`🌤 [WindService] Пакетный кэш ветра обновлен для ${balloonsList.length} шаров.`);
  } catch (error) {
    console.error('❌ [WindService] Ошибка пакетного запроса ветра:', error.message);
  }
}

/**
 * Синхронное получение ветра из кэша для конкретного шара на его текущей высоте
 */
function getWindFromCache(balloonId, altitude) {
  const cached = ballonsWindCache.get(balloonId);
  
  // Если гонка только началась и кэш еще пуст
  if (!cached) {
    return { speed: 3.0, direction: 180, layerName: 'Fallback Default' };
  }

  // Находим ближайший по высоте слой
  const closest = ALTITUDE_MAP.reduce((prev, curr) => 
    Math.abs(curr.alt - altitude) < Math.abs(prev.alt - altitude) ? curr : prev
  );

  return cached.layers[closest.suffix];
}

module.exports = {
  updateWindForBalloons,
  getWindFromCache
};
