//Инициализация карты, слои

// Создание карты (глобальная переменная)
window.map = L.map('map', { 
    center: [52.12, 23.72], 
    zoom: 8, 
    zoomControl: true 
});

// Добавление слоёв карты
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
