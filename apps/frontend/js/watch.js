// ========== WATCH PAGE - LIVE PUBLIC BALLOON ==========
// Простая версия без WebSocket, только HTTP запросы

let map;
let publicBalloonMarker = null;
let publicPathLine = null;
let updateInterval = null;

// Инициализация страницы
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎈 Watch page initialized');
    initMap();
    startWatching();
});

// Инициализация карты
function initMap() {
    console.log('🗺️ Initializing map...');
    
    map = L.map('map', {
        center: [52.12, 23.72],
        zoom: 8,
        zoomControl: true
    });
    
    const esriSatellite = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri',
        maxZoom: 19
    });
    
    const osmStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    });
    
    esriSatellite.addTo(map);
    
    L.control.layers(
        { "🛰️ Спутник": esriSatellite, "🗺️ Карта": osmStandard },
        null,
        { position: 'topleft', collapsed: false }
    ).addTo(map);
    
    L.control.scale({ metric: true, position: 'bottomleft' }).addTo(map);
    
    console.log('✅ Map initialized');
}

// Начинаем следить за публичным шаром
function startWatching() {
    // Обновляем каждые 2 секунды
    updateInterval = setInterval(fetchPublicBalloon, 2000);
    console.log('👀 Начали следить за публичным шаром (обновление каждые 2 сек)');
    
    // Первый запрос сразу
    fetchPublicBalloon();
}

// Получаем данные публичного шара
async function fetchPublicBalloon() {
    try {
        const response = await fetch('/api/public-aerostar');
        const data = await response.json();
        
        if (data.position) {
            renderBalloon(data);
            updateStatus(`🟢 LIVE: ${new Date().toLocaleTimeString()}`);
            
            // Скрываем загрузку
            const loadingEl = document.getElementById('loading');
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
        } else {
            updateStatus('⏳ Ожидание начала трансляции...');
        }
    } catch (error) {
        console.error('Ошибка получения публичного шара:', error);
        updateStatus('❌ Ошибка подключения');
    }
}

// Отрисовка шара на карте
function renderBalloon(data) {
    if (!data || !data.position) return;
    
    // Обновляем маркер
    if (publicBalloonMarker) {
        map.removeLayer(publicBalloonMarker);
    }
    
    const balloonIcon = L.divIcon({
        className: 'watch-balloon-marker',
        html: '🎈',
        iconSize: [48, 48],
        popupAnchor: [0, -24]
    });
    
    publicBalloonMarker = L.marker([data.position.lat, data.position.lng], {
        icon: balloonIcon
    }).addTo(map);
    
    publicBalloonMarker.bindPopup(`
        <div style="text-align: center; padding: 5px;">
            <strong>🎈 Aerostar Balloon</strong><br>
            📍 ${data.position.lat.toFixed(4)}°, ${data.position.lng.toFixed(4)}°<br>
            🕐 ${data.lastUpdate ? new Date(data.lastUpdate).toLocaleTimeString() : 'только что'}
        </div>
    `);
    
    // Центрируем карту (но не принудительно, только если шар далеко)
    const center = map.getCenter();
    const distance = map.distance(center, [data.position.lat, data.position.lng]);
    if (distance > 5000) { // если шар дальше 5км, центрируем
        map.setView([data.position.lat, data.position.lng], map.getZoom());
    }
    
    // Отрисовываем путь
    if (data.path && data.path.length > 0) {
        if (publicPathLine) {
            map.removeLayer(publicPathLine);
        }
        
        const latlngs = data.path.map(point => [point.lat, point.lng]);
        publicPathLine = L.polyline(latlngs, {
            color: '#FF6B35',
            weight: 4,
            opacity: 0.8,
            smoothFactor: 1
        }).addTo(map);
        
        console.log(`📏 Отрисован путь из ${data.path.length} точек`);
    }
}

// Обновление статуса
function updateStatus(message) {
    const statusEl = document.getElementById('connectionStatus');
    if (statusEl) {
        statusEl.textContent = message;
    }
}

// Очистка при закрытии страницы
window.addEventListener('beforeunload', () => {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
});

console.log('🎈 Watch script loaded (no WebSocket version)');
