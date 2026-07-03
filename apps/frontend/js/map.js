//Инициализация карты, слои

// --- НАСТРОЙКИ КАРТЫ ---
// Для отображения всей Европы: центр примерно на (50°N, 10°E), начальный масштаб 4
const EUROPE_CENTER = [50.00, 10.00];
const INITIAL_ZOOM = 3;

// Создание карты (глобальная переменная)
window.map = L.map('map', { 
    center: EUROPE_CENTER, 
    zoom: INITIAL_ZOOM, 
    zoomControl: true 
});

// --- ИНДИКАТОР ПРОГРЕССА И ПОКАЗ МОДАЛЬНОГО ОКНА ---

const loadingElement = document.getElementById('loading');
const WELCOME_KEY = 'welcome_shown';

function hideLoading() {
    if (loadingElement) loadingElement.style.display = 'none';
}

function showWelcomeModalDelayed() {
    if (localStorage.getItem(WELCOME_KEY)) return;
    const modal = document.getElementById('welcomeModal');
    if (!modal) return;
    // Задержка после отрисовки тайлов
    setTimeout(() => modal.style.display = 'flex', 1500);
}

// --- ДОБАВЛЕНИЕ СЛОЁВ КАРТЫ ---
const esriSatellite = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
    attribution: 'Tiles © Esri', 
    maxZoom: 19 
});

const osmStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
    attribution: '© OpenStreetMap', 
    maxZoom: 19 
});

// Добавляем спутниковый слой по умолчанию
esriSatellite.addTo(window.map);

// Слушаем загрузку слоя, а не карты
esriSatellite.on('load', function() {
    hideLoading();
    showWelcomeModalDelayed();
});

// Контрол переключения слоёв
L.control.layers(
    { 
        "🛰️ Спутник ESRI": esriSatellite, 
        "🗺️ Схема OSM": osmStandard 
    }, 
    null, 
    { 
        position: 'topleft', 
        collapsed: false 
    }
).addTo(window.map);

// Контрол масштаба
L.control.scale({ 
    metric: true, 
    position: 'bottomleft' 
}).addTo(window.map);

// --- ОСТАЛЬНЫЕ ФУНКЦИИ ---
// Функция для обработки клика по карте (будет вызвана из main.js)
function onMapClick(callback) {
    window.map.on('click', async function(e) {
        if (window.App.isFlying) return;
        const { lat, lng } = e.latlng;
        
        // Очищаем предыдущий маркер
        if (window.App.startMarker) {
            window.map.removeLayer(window.App.startMarker);
        }
        
        // Создаём новый маркер
        window.App.startMarker = L.marker([lat, lng]).addTo(window.map);
        window.App.balloonPosition = L.latLng(lat, lng);
        
        // Вызываем callback с координатами
        if (callback) callback(lat, lng);
    });
}

// Функция для обновления тумана при движении карты
function initHazeOnMove() {
    window.map.on('move', () => { 
        if (window.App.balloonPosition && window.App.isFlying) {
            updateHaze(window.App.balloonPosition);
        }
    });
}

// Функция для обновления тумана при изменении размера окна
function initHazeOnResize() {
    window.addEventListener('resize', () => { 
        if (window.App.balloonPosition && window.App.isFlying) {
            updateHaze(window.App.balloonPosition);
        }
    });
}

// Экспорт функций (если используете модули)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { onMapClick, initHazeOnMove, initHazeOnResize };
}
