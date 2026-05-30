// Конфигурация
const API_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000' 
    : '';

let map;
let publicBalloonMarker = null;
let publicPathLine = null;
let socket = null;

// Инициализация страницы
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎈 Watch page initialized');
    initMap();
    connectSocket();
});

// Инициализация карты
function initMap() {
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
    
    // Обычная карта
    const osmStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    });
    
    esriSatellite.addTo(map);
    
    // Переключатель слоёв
    L.control.layers(
        {
            "🛰️ Спутник": esriSatellite,
            "🗺️ Карта": osmStandard
        },
        null,
        { position: 'topleft', collapsed: false }
    ).addTo(map);
    
    // Масштаб
    L.control.scale({ metric: true, position: 'bottomleft' }).addTo(map);
}

// Подключение WebSocket
function connectSocket() {
    try {
        const wsUrl = API_URL || window.location.origin;
        socket = io(wsUrl);
        
        socket.on('connect', () => {
            console.log('✅ WebSocket connected');
            document.getElementById('loading').style.display = 'none';
            
            // Запрашиваем публичный шар
            socket.emit('watch-public-balloon');
        });
        
        // Получаем текущее состояние (новое название события)
        socket.on('public-balloon-state', (data) => {
            console.log('Received initial state:', data);
            renderPublicBalloon(data);
        });
        
        // Получаем обновления (новое название события)
        socket.on('public-balloon-update', (data) => {
            console.log('Received update:', data);
            renderPublicBalloon(data);
        });
        
        socket.on('disconnect', () => {
            console.log('❌ WebSocket disconnected');
            document.getElementById('loading').style.display = 'block';
            document.getElementById('loading').innerHTML = 'Потеря соединения. Переподключение...';
            setTimeout(() => connectSocket(), 3000);
        });
        
    } catch (error) {
        console.error('Socket connection error:', error);
        document.getElementById('loading').innerHTML = 'Ошибка подключения. Обновить страницу?';
    }
}

// Отрисовка публичного шара и пути
function renderPublicBalloon(state) {
    if (!state || !state.position) return;
    
    // Обновляем маркер шара
    if (publicBalloonMarker) {
        map.removeLayer(publicBalloonMarker);
    }
    
    // Кастомная иконка для просмотра
    const balloonIcon = L.divIcon({
        className: 'watch-balloon-marker',
        html: '🎈',
        iconSize: [40, 40],
        popupAnchor: [0, -20]
    });
    
    publicBalloonMarker = L.marker([state.position.lat, state.position.lng], {
        icon: balloonIcon
    }).addTo(map);
    
    // Добавляем попап с информацией
    publicBalloonMarker.bindPopup(`
        <div style="text-align: center;">
            <strong>🎈 Aerostar Balloon</strong><br>
            Текущая позиция
        </div>
    `);
    
    // Центрируем карту на шаре каждые 3 секунды (опционально)
    if (!window.isFollowing) {
        window.isFollowing = true;
        setInterval(() => {
            if (publicBalloonMarker && map) {
                map.setView([state.position.lat, state.position.lng], map.getZoom());
            }
        }, 3000);
    }
    
    // Отрисовываем путь
    if (state.path && state.path.length > 0) {
        if (publicPathLine) {
            map.removeLayer(publicPathLine);
        }
        
        const latlngs = state.path.map(point => [point.lat, point.lng]);
        
        publicPathLine = L.polyline(latlngs, {
            color: '#FF6B35',
            weight: 4,
            opacity: 0.8,
            smoothFactor: 1
        }).addTo(map);
    }
    
    // Обновляем информационную панель
    updateInfoPanel(state);
}

// Обновление информационной панели
function updateInfoPanel(state) {
    const panel = document.querySelector('.info-panel');
    if (!panel) return;
    
    const pointsCount = state.path ? state.path.length : 0;
    
    panel.innerHTML = `
        <h3>🎈 Aerostar Public Balloon</h3>
        <p>📍 Текущая позиция: ${state.position.lat.toFixed(4)}°, ${state.position.lng.toFixed(4)}°</p>
        <p>📊 Пройдено точек: ${pointsCount}</p>
        <p style="font-size: 11px; margin-top: 5px;">⏱️ Обновление в реальном времени</p>
    `;
}

// Отслеживание/Отключение следования за шаром (опционально)
let followEnabled = true;

function toggleFollow() {
    followEnabled = !followEnabled;
    const btn = document.getElementById('followBtn');
    if (btn) {
        btn.textContent = followEnabled ? '📌 Следовать' : '🔓 Свободно';
    }
}

// Добавляем кнопку следования (опционально)
setTimeout(() => {
    const followBtn = document.createElement('button');
    followBtn.id = 'followBtn';
    followBtn.textContent = '📌 Следовать';
    followBtn.style.cssText = `
        position: absolute;
        bottom: 20px;
        right: 20px;
        z-index: 1000;
        background: rgba(0,0,0,0.7);
        color: white;
        border: none;
        padding: 10px 15px;
        border-radius: 25px;
        cursor: pointer;
        font-size: 14px;
        backdrop-filter: blur(5px);
    `;
    followBtn.onclick = toggleFollow;
    document.body.appendChild(followBtn);
}, 1000);
