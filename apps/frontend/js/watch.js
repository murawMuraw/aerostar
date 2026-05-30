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
        { "🛰️ ESRI Satellite": esriSatellite, "🗺️ OSM Standard": osmStandard },
        null,
        { position: 'topleft', collapsed: false }
    ).addTo(map);
    
    L.control.scale({ metric: true, position: 'bottomleft' }).addTo(map);
    
    console.log('✅ Map initialized');
}

// Начинаем следить за публичным шаром
function startWatching() {
    updateInterval = setInterval(fetchPublicBalloon, 2000);
    console.log('👀 Начали следить за публичным шаром (обновление каждые 2 сек)');
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

// Отрисовка шара на карте (как в index.html)
function renderBalloon(data) {
    if (!data || !data.position) return;
    
    // Удаляем старый маркер
    if (publicBalloonMarker) {
        map.removeLayer(publicBalloonMarker);
    }
    
    // Такая же иконка как в index.html
    const balloonIcon = L.icon({
        iconUrl: '/images/balloon.png',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16]
    });
    
    publicBalloonMarker = L.marker([data.position.lat, data.position.lng], {
        icon: balloonIcon,
        zIndexOffset: 1000
    }).addTo(map);
    
    // Попап с информацией
    publicBalloonMarker.bindPopup(`
        <div style="text-align: center;">
            <strong>🎈 Aerostar Balloon</strong><br>
            📍 ${data.position.lat.toFixed(4)}°, ${data.position.lng.toFixed(4)}°
        </div>
    `);
    
    // Центрируем карту если шар далеко
    const center = map.getCenter();
    const distance = map.distance(center, [data.position.lat, data.position.lng]);
    if (distance > 5000) {
        map.setView([data.position.lat, data.position.lng], map.getZoom());
    }
    
    // Отрисовываем путь (такая же красная линия как в index.html)
    if (data.path && data.path.length > 0) {
        if (publicPathLine) {
            map.removeLayer(publicPathLine);
        }
        
        const latlngs = data.path.map(point => [point.lat, point.lng]);
        publicPathLine = L.polyline(latlngs, { 
            color: '#ff4444', 
            weight: 4, 
            opacity: 0.8 
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

console.log('🎈 Watch script loaded');
