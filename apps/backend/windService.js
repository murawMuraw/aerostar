const axios = require('axios');
const config = require('./config');

async function getWindData(lat, lng) {
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${config.openWeatherApiKey}&units=metric`;
    const response = await axios.get(url);
    
    // Получаем температуру из блока main
    const temp = response.data.main && response.data.main.temp !== undefined 
      ? response.data.main.temp 
      : '--';

    // Получаем осадки (проверяем дождь или снег за последний 1 час '1h')
    let precip = 0;
    if (response.data.rain && response.data.rain['1h']) {
      precip = response.data.rain['1h'];
    } else if (response.data.snow && response.data.snow['1h']) {
      precip = response.data.snow['1h'];
    }

    if (response.data.wind) {
      return {
        speed: response.data.wind.speed,
        direction: response.data.wind.deg,
        gust: response.data.wind.gust || 0,
        temp: temp,       // <-- Добавили температуру в ответ
        precip: precip    // <-- Добавили объем осадков в ответ
      };
    }
    
    // Если блока wind почему-то нет, но погода пришла
    return {
      speed: 0,
      direction: 0,
      gust: 0,
      temp: temp,
      precip: precip
    };

  } catch (error) {
    console.error('Ошибка получения ветра и погоды:', error.message);
    console.log('⚠️ Используем тестовые данные ветра и погоды');
    // Дефолтные тестовые данные на случай ошибки API
    return {
      speed: 3.0,
      direction: 270,
      gust: 0,
      temp: 15,
      precip: 0.0
    };
  }
}

function calculateNewPosition(lat, lng, windSpeed, windDirection, seconds) {
  const windRad = (windDirection + 180) * Math.PI / 180;
  const distance = windSpeed * seconds;
  const distanceKm = distance / 1000;
  const R = 6371;
  
  const lat1 = lat * Math.PI / 180;
  const lon1 = lng * Math.PI / 180;
  const bearing = windRad;
  
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distanceKm/R) + 
                         Math.cos(lat1) * Math.sin(distanceKm/R) * Math.cos(bearing));
  
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(distanceKm/R) * Math.cos(lat1), 
                                 Math.cos(distanceKm/R) - Math.sin(lat1) * Math.sin(lat2));
  
  return {
    lat: lat2 * 180 / Math.PI,
    lng: lon2 * 180 / Math.PI
  };
}

module.exports = { getWindData, calculateNewPosition };

