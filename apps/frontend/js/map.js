// Инициализация карты, слои

// --- НАСТРОЙКИ КАРТЫ ---
// Для отображения всей Европы: центр примерно на (50°N, 10°E), начальный масштаб 4
const EUROPE_CENTER = [50.00, 10.00];
const INITIAL_ZOOM = 4;

// Создание карты (глобальная переменная)
window.map = L.map('map', { 
    center: EUROPE_CENTER, 
    zoom: INITIAL_ZOOM, 
    zoomControl: true 
});

// --- ИНДИКАТОР ПРОГРЕССА ЗАГРУЗКИ КАРТЫ ---
// Элемент загрузки уже есть в HTML: <div class="loading" id="loading">Loading Map... 🗺️</div>
const loadingElement = document.getElementById('loading');

// Функция для скрытия индикатора загрузки
function hideLoading() {
    if (loadingElement) {
        loadingElement.style.display = 'none';
        console.log('Loading indicator hidden');
    }
}

// Показываем индикатор при старте загрузки тайлов
window.map.on('load', function() {
    // Скрываем индикатор, когда карта полностью загружена
    hideLoading();
    console.log('Map loaded event fired');
});

// На случай, если событие 'load' не сработает (например, при кэшировании), добавляем таймаут
setTimeout(() => {
    hideLoading();
    console.log('Loading hidden by timeout (10s)');
}, 10000); // Максимум 10 секунд ожидания

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

// --- ПОКАЗ МОДАЛЬНОГО ОКНА ПОСЛЕ ЗАГРУЗКИ КАРТЫ ---
// Функция для показа модального окна (если оно ещё не показано и не скрыто через "Не показывать")
function showWelcomeModalDelayed() {
    const WELCOME_KEY = 'welcome_shown';
    
    // Проверяем, не скрыто ли окно навсегда
    if (localStorage.getItem(WELCOME_KEY)) {
        console.log('Welcome modal hidden by localStorage');
        return;
    }
    
    const modal = document.getElementById('welcomeModal');
    if (!modal) {
        console.log('Welcome modal element not found');
        return;
    }
    
    // Показываем модальное окно через 1.5 секунды после загрузки карты
    setTimeout(() => {
        modal.style.display = 'flex';
        console.log('Welcome modal shown after 1.5s delay');
    }, 1500);
}

// Запускаем показ модального окна после того, как карта полностью загрузится
// Используем событие 'load', которое срабатывает после загрузки всех тайлов
window.map.on('load', function() {
    console.log('Map load event - showing modal');
    showWelcomeModalDelayed();
});

// Также добавим обработчик на случай, если карта уже была загружена до подписки на событие
// (например, при очень быстрой загрузке или из кэша)
if (window.map._loaded) {
    console.log('Map already loaded - showing modal');
    showWelcomeModalDelayed();
}

// --- ОСТАЛЬНЫЕ ФУНКЦИИ (без изменений) ---
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
