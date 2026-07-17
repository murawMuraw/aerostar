// ========== watch-main.js - Упрощенная версия для watch.html ==========
// Только основные функции: карта + отображение шара

console.log('🚀 Watch App Starting (simplified)');

// ========== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==========
let map = null;
let publicBalloonMarker = null;
let publicPathLine = null;
let updateInterval = null;
let lastPublicData = null;

// ========== ИНИЦИАЛИЗАЦИЯ ==========
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM loaded, initializing watch app...');
    
    // Загружаем конфигурацию
    if (typeof loadConfig === 'function') {
        loadConfig();
    }
    
    // Инициализируем карту
    initWatchMap();
    
    // Запускаем получение данных
    startWatching();
    
    // Скрываем лишние элементы
    hideUnnecessaryElements();
});

// ========== КАРТА ==========
function initWatchMap() {
    console.log('🗺️ Initializing watch map...');
    
    // Проверяем, не создана ли уже карта
    if (window._map) {
        map = window._map;
        console.log('📦 Using existing map instance');
        return;
    }
    
    map = L.map('map', {
        center: [52.12, 23.72],
        zoom: 8,
        zoomControl: true
    });
    
    // Спутниковый слой
    const esriSatellite = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri',
        maxZoom: 19
    });
    
    // OSM слой
    const osmStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    });
    
    esriSatellite.addTo(map);
    
    L.control.layers(
        { "🛰️ Satellite": esriSatellite, "🗺️ OSM": osmStandard },
        null,
        { position: 'topleft', collapsed: false }
    ).addTo(map);
    
    L.control.scale({ metric: true, position: 'bottomleft' }).addTo(map);
    
    // Сохраняем в глобальную переменную для других функций
    window._map = map;
    
    console.log('✅ Watch map initialized');
}

// ========== ПОЛУЧЕНИЕ ДАННЫХ ==========
function startWatching() {
    console.log('👀 Start watching public balloon');
    
    // Первый запрос сразу
    fetchPublicBalloon();
    
    // Запускаем интервал
    updateInterval = setInterval(fetchPublicBalloon, 2000);
}

async function fetchPublicBalloon() {
    try {
        const response = await fetch('/api/public-aerostar');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data && data.position) {
            renderBalloon(data);
            updateStatus(`🟢 LIVE ${new Date().toLocaleTimeString()}`);
            
            // Обновляем координаты в панели
            updateCoords(data.position);
        } else {
            updateStatus('⏳ Waiting for data...');
        }
    } catch (error) {
        console.error('❌ Error fetching public balloon:', error);
        updateStatus('❌ Connection error');
    }
}

// ========== ОТРИСОВКА ШАРА ==========
function renderBalloon(data) {
    if (!map) {
        console.error('❌ Map not initialized');
        return;
    }

    const lat = data.position.lat;
    const lng = data.position.lng;
    
    if (isNaN(lat) || isNaN(lng)) {
        console.warn('⚠️ Invalid coordinates:', { lat, lng });
        return;
    }

    const currentPos = [lat, lng];
    
    // === 1. МАРКЕР ===
    if (publicBalloonMarker) {
        map.removeLayer(publicBalloonMarker);
        publicBalloonMarker = null;
    }

    const balloonIcon = L.icon({
        iconUrl: '/images/balloon.png',
        iconSize: [64, 64],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
        className: 'double-size-balloon'
    });

    publicBalloonMarker = L.marker(currentPos, {
        icon: balloonIcon,
        zIndexOffset: 1000
    }).addTo(map);

    publicBalloonMarker.bindPopup(`
        <div style="text-align: center; min-width: 150px; padding: 5px;">
            <strong>🎈 Aerostar Balloon</strong><br>
            📍 ${lat.toFixed(6)}°, ${lng.toFixed(6)}°<br>
            🕐 ${new Date().toLocaleTimeString()}
        </div>
    `);

    // === 2. ТРЕК ===
    if (data.path && Array.isArray(data.path) && data.path.length > 1) {
        if (publicPathLine) {
            map.removeLayer(publicPathLine);
            publicPathLine = null;
        }

        const pathPoints = data.path
            .filter(p => p && !isNaN(p.lat) && !isNaN(p.lng))
            .map(p => [p.lat, p.lng]);

        if (pathPoints.length > 1) {
            publicPathLine = L.polyline(pathPoints, {
                color: '#ff4444',
                weight: 4,
                opacity: 0.8,
                smoothFactor: 1
            }).addTo(map);
            
            console.log(`📏 Path drawn with ${pathPoints.length} points`);
        }
    }

    // === 3. ЦЕНТРИРОВАНИЕ ===
    const center = map.getCenter();
    const distance = map.distance(center, currentPos);
    
    if (distance > 5000) {
        map.setView(currentPos, map.getZoom());
    } else if (distance > 100) {
        map.panTo(currentPos);
    }
}

// ========== ОБНОВЛЕНИЕ КООРДИНАТ В ПАНЕЛИ ==========
function updateCoords(position) {
    const coordsEl = document.getElementById('coords');
    if (coordsEl && position) {
        coordsEl.innerHTML = `
            <span class="status-dot"></span>
            📍 ${position.lat.toFixed(6)}°, ${position.lng.toFixed(6)}°
        `;
    }
}

// ========== СТАТУС ==========
function updateStatus(message) {
    const statusEl = document.getElementById('connectionStatus');
    if (statusEl) {
        statusEl.textContent = message;
        
        if (message.includes('LIVE') || message.includes('Connected')) {
            statusEl.style.borderLeftColor = '#00ff88';
        } else if (message.includes('Error') || message.includes('error')) {
            statusEl.style.borderLeftColor = '#ff4444';
        } else {
            statusEl.style.borderLeftColor = '#ffaa00';
        }
    }
}

// ========== СКРЫТИЕ ЛИШНИХ ЭЛЕМЕНТОВ ==========
function hideUnnecessaryElements() {
    setTimeout(() => {
        const selectors = [
            '.control-panel',
            '.sidebar', 
            '.menu',
            '.controls',
            '#controls',
            '.user-controls',
            '#userControls',
            '.user-panel',
            '#userPanel',
            '.auth-panel',
            '#authPanel',
            '.login-form',
            '#loginForm'
        ];
        
        selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                if (el) el.style.display = 'none';
            });
        });
        
        console.log('✅ Unnecessary elements hidden');
    }, 500);
}

// ========== ОЧИСТКА ПРИ ЗАКРЫТИИ ==========
window.addEventListener('beforeunload', () => {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    
    if (publicBalloonMarker) {
        map?.removeLayer(publicBalloonMarker);
        publicBalloonMarker = null;
    }
    
    if (publicPathLine) {
        map?.removeLayer(publicPathLine);
        publicPathLine = null;
    }
});

console.log('🎈 Watch main script loaded');
