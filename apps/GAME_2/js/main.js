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
    
    // 2. Инициализация правой карты (вид от первого лица) в точке по умолчанию
    const povContainer = document.getElementById('pov-map');
    if (povContainer) {
        console.log('✅ Контейнер pov-map найден. Размеры:', povContainer.offsetWidth, 'x', povContainer.offsetHeight);
    } else {
        console.error('❌ Контейнер pov-map НЕ найден в HTML!');
    }

    initPovMap(52.12, 23.72); 
    
    // 3. Инициализация обработчиков кнопок (START, Reset)
    initUIHandlers();
    
    // 4. Восстановление сессии (если было)
    if (typeof restoreSession === 'function') restoreSession();
    
    // 5. Скрываем загрузочный экран
    hideLoading(1000);

    console.log('✅ App is ready');
});

// ─── ЛЕВАЯ КАРТА (КАРТА МИРА) ───
function initMap() {
    window.map = L.map('map', {
        center: [52.12, 23.72],
        zoom: 2, 
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        keyboard: false
    });

    L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri',
        maxZoom: 19
    }).addTo(window.map);

    window.map.on('click', async function(e) {
        if (window.App.isFlying) {
            showError('Cannot select a new point during flight. Reset the flight first.');
            return;
        }

        const { lat, lng } = e.latlng;

        if (window.App.startMarker) {
            window.map.removeLayer(window.App.startMarker);
        }

        window.App.startMarker = L.marker([lat, lng]).addTo(window.map);
        window.App.balloonPosition = L.latLng(lat, lng);

        if (typeof initPovMap === 'function') {
            initPovMap(lat, lng);
        }

        updateCoordDisplay(lat, lng);
        updateFlightStatus('waiting', '⏳ Fetching wind forecast...');
        
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

    povMap = L.map('pov-map', {
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        touchZoom: false,
        doubleClickZoom: false,
        keyboard: false,
        zoomSnap: 0.1,
        center: [lat, lon],
        zoom: 15
    });

    const povLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19 }
    ).addTo(povMap);

    // Принудительно обновляем размеры карты после создания
    setTimeout(() => {
        povMap.invalidateSize();
    }, 100);
}

// ─── СИНХРОНИЗАЦИЯ КАРТ ПРИ ДВИЖЕНИИ ШАРА ───
function syncMaps(lat, lon) {
    if (window.map && window.balloonMarker) {
        window.balloonMarker.setLatLng([lat, lon]);
    }

    if (!povMap) {
        initPovMap(lat, lon);
    } else {
        povMap.setView([lat, lon], povMap.getZoom(), { animate: true, duration: 0.5 });
    }
    
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
            if (povMap) {
                povMap.setView([52.12, 23.72], 15); 
            }
        });
    }

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
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled Promise rejection:', e.reason);
});
