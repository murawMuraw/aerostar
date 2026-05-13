 // ========== КОНФИГУРАЦИЯ ПРИЛОЖЕНИЯ ==========

// Определяем API URL в зависимости от окружения
// Для Render production используем жестко заданный URL вашего бэкенда
// Для локальной разработки используем localhost
const API_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000'  // Локальная разработка
    : '';  // 

window.App = {
    // API конфигурация
    API_URL: API_URL,
 
    // Зоны тумана (в метрах)
    ZONES: { 
        BRIGHT: 5000,   // Зона полной видимости
        MEDIUM: 10000,  // Зона средней видимости  
        HAZE: 15000     // Зона тумана
    },
    
    // Состояние авторизации
    token: localStorage.getItem('token'),
    currentUser: null,
    isGuest: !localStorage.getItem('token'),
    
    // Состояние полёта
    isFlying: false,
    startMarker: null,
    balloonMarker: null,
    balloonPosition: null,
    currentWind: null,
    forecastLine: null,
    pathLine: null,
    forecastPoints: [],
    actualPathPoints: [],
    movementInterval: null,
    windUpdateInterval: null,
    balloonId: null,
    
    // UI состояние
    lastPlaceCheck: null
};

// Для отладки - выводим в консоль информацию о конфигурации
console.log('🔧 Конфигурация приложения:', {
    API_URL: window.App.API_URL,
    environment: window.location.hostname === 'localhost' ? 'development' : 'production',
    hostname: window.location.hostname
});
