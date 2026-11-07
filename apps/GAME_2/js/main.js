// ========== MAIN MODULE (ENTRY POINT) ==========

// App Initialization
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Aerostar App Starting');

    if (typeof L === 'undefined') {
        console.error('Fatal Error: Leaflet library (L) is not defined.');
        return;
    }

    // 1. Инициализация левой карты (карта мира)
    initMap();
    
    // 2. Инициализация обработчиков кнопок (START, Reset)
    initUIHandlers();
    
    // 3. Восстановление сессии (если было)
    if (typeof restoreSession === 'function') restoreSession();
    
    // 4. Скрываем загрузочный экран
    hideLoading(1000);

    console.log('✅ App is ready');
});

// ─── ЛЕВАЯ КАРТА (КАРТА МИРА) ───
function initMap() {
    // Карта на весь экран в левой колонке, зум 2 (вид на весь глобус)
    window.map = L.map('map', {
        center: [52.12, 23.72],
        zoom: 2, 
        zoomControl: false,      // Убираем кнопки +/-
        dragging: false,         // Карта статична
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        keyboard: false
    });

    // Спутниковый слой ESRI
    L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri',
        maxZoom: 19
    }).addTo(window.map);

    // Клик по карте (выбор точки старта)
    window.map.on('click', async function(e) {
        if (window.App.isFlying) {
            showError('Cannot select a new point during flight. Reset the flight first.');
            return;
        }

        const { lat, lng } = e.latlng;

        // Удаляем старый маркер старта, если был
        if (window.App.startMarker) {
            window.map.removeLayer(window.App.startMarker);
        }

        // Ставим новый маркер
        window.App.startMarker = L.marker([lat, lng]).addTo(window.map);
        window.App.balloonPosition = L.latLng(lat, lng);

        // 👇 Инициализируем правую карту (вид от первого лица) в точке старта
        if (typeof initPovMap === 'function') {
            initPovMap(lat, lng);
        }

        updateCoordDisplay(lat, lng);
        updateFlightStatus('waiting', '⏳ Fetching wind forecast...');
        
        // Запрашиваем ветер для прогноза
        await updateForecast(window.App.balloonPosition);
        
        updateFlightStatus('ready', '⏸️ Ready to start');
        setStartButtonEnabled(true);
        updateHint('✅ Point selected. Press START');
    });
}

// ─── ПРАВАЯ КАРТА (ВИД ОТ ПЕРВОГО ЛИЦА) ───
let povMap = null;

function initPovMap(lat, lon) {
    if (povMap) return; // Уже создана

    // Создаем правую карту с высоким зумом (15 — как будто летим низко)
    povMap = L.map('pov-map', {
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        touchZoom: false,
        doubleClickZoom: false,
        keyboard: false,
        zoomSnap: 0.1
    }).setView([lat, lon], 15); 

    // Спутниковый слой ESRI
    L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19 }
    ).addTo(povMap);
}

// ─── СИНХРОНИЗАЦИЯ КАРТ ПРИ ДВИЖЕНИИ ШАРА ───
// Эта функция вызывается из balloon.js в moveBalloon()
function syncMaps(lat, lon) {
    // 1. Двигаем маркер на маленькой карте (map)
    if (window.map && window.balloonMarker) {
        window.balloonMarker.setLatLng([lat, lon]);
    }

    // 2. Если правая карта еще не создана (например, при восстановлении полета), создаем её
    if (!povMap) {
        initPovMap(lat, lon);
    } else {
        // 3. Плавно двигаем камеру на большой карте вслед за шаром
        povMap.setView([lat, lon], povMap.getZoom(), { animate: true, duration: 0.5 });
    }
    
    // Обновляем координаты на экране под левой картой
    const caption = document.getElementById('mapCaption');
    if (caption) {
        caption.textContent = `широта ${lat.toFixed(4)}, долгота ${lon.toFixed(4)}`;
    }
}

// ─── ОБРАБОТЧИКИ КНОПОК ───
function initUIHandlers() {
    const startBtn = document.getElementById('startBtn');
    const resetBtn = document.getElementById('resetBtn');

    if (startBtn) {
        startBtn.addEventListener('click', startFlight);
    }
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            resetFlight();
            // При сбросе полета камеру правой карты тоже возвращаем на место
            if (povMap) {
                povMap.setView([52.12, 23.72], 15); 
            }
        });
    }

    // Закрытие модалок по ESC (на всякий случай, если они остались в HTML)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const authModal = document.getElementById('authModal');
            if (authModal && !authModal.classList.contains('hidden')) {
                showAuthModal(false);
            }
        }
    });
}

// ─── ГЛОБАЛЬНАЯ ОБРАБОТКА ОШИБОК ───
window.addEventListener('error', (e) => {
    console.error('Global error:', e.error);
    // Можно раскомментировать, если нужно показывать ошибки пользователю
    // showError('An error occurred: ' + (e.error?.message || 'Unknown error'));
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled Promise rejection:', e.reason);
});
