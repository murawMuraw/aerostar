// ========== WATCH PAGE - LIVE PUBLIC BALLOON ==========

// Конфигурация
const API_URL = ''; // Пустая строка для продакшена

let map;
let publicBalloonMarker = null;
let publicPathLine = null;

// 🔥 Глобальный socket - ВАЖНО!
window.watchSocket = null;

// Инициализация страницы
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎈 Watch page initialized');
    initMap();
    connectSocket();
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

// Подключение WebSocket
function connectSocket() {
    try {
        console.log('🔌 Connecting to WebSocket...');
        
        // 🔥 СОЗДАЕМ ГЛОБАЛЬНЫЙ SOCKET
        window.watchSocket = io(window.location.origin, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 5
        });
        
        window.watchSocket.on('connect', () => {
            console.log('✅ WebSocket connected, id:', window.watchSocket.id);
            
            // Скрываем загрузку
            const loadingEl = document.getElementById('loading');
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
            
            // 🔥 ЗАПРАШИВАЕМ ПУБЛИЧНЫЙ ШАР
            console.log('📡 Requesting public balloon...');
            window.watchSocket.emit('watch-public-balloon');
        });
        
        // Получаем текущее состояние
        window.watchSocket.on('public-balloon-state', (data) => {
            console.log('📥 Received public-balloon-state:', data);
            if (data && data.position) {
                renderPublicBalloon(data);
            } else {
                console.log('⚠️ No balloon state available yet');
                const statusEl = document.getElementById('connectionStatus');
                if (statusEl) {
                    statusEl.textContent = '⏳ Ожидание начала трансляции...';
                }
            }
        });
        
        // Получаем обновления
        window.watchSocket.on('public-balloon-update', (data) => {
            console.log('🔄 Received public-balloon-update:', data);
            if (data && data.position) {
                renderPublicBalloon(data);
            }
        });
        
        window.watchSocket.on('connect_error', (error) => {
            console.error('Socket connection error:', error);
            const statusEl = document.getElementById('connectionStatus');
            if (statusEl) {
                statusEl.textContent = '❌ Ошибка подключения';
            }
        });
        
        window.watchSocket.on('disconnect', () => {
            console.log('❌ WebSocket disconnected');
            const statusEl = document.getElementById('connectionStatus');
            if (statusEl) {
                statusEl.textContent = '⚠️ Потеря соединения';
            }
            const loadingEl = document.getElementById('loading');
            if (loadingEl) {
                loadingEl.style.display = 'block';
            }
        });
        
    } catch (error) {
        console.error('Socket connection error:', error);
    }
}

// Отрисовка публичного шара
function renderPublicBalloon(state) {
    if (!state || !state.position) {
        console.warn('⚠️ No position data to render');
        return;
    }
    
    console.log('🎨 Rendering balloon at:', state.position);
    
    // Удаляем старый маркер
    if (publicBalloonMarker) {
        map.removeLayer(publicBalloonMarker);
    }
    
    // Создаем иконку шара
    const balloonIcon = L.divIcon({
        className: 'watch-balloon-marker',
        html: '🎈',
        iconSize: [48, 48],
        popupAnchor: [0, -24]
    });
    
    // Добавляем маркер
    publicBalloonMarker = L.marker([state.position.lat, state.position.lng], {
        icon: balloonIcon
    }).addTo(map);
    
    // Добавляем попап
    publicBalloonMarker.bindPopup(`
        <div style="text-align: center; padding: 5px;">
            <strong>🎈 Aerostar Balloon</strong><br>
            📍 ${state.position.lat.toFixed(4)}°, ${state.position.lng.toFixed(4)}°
        </div>
    `);
    
    // Открываем попап
    publicBalloonMarker.openPopup();
    
    // Центрируем карту на шаре
    map.setView([state.position.lat, state.position.lng], map.getZoom());
    
    // Отрисовываем путь
    if (state.path && state.path.length > 0) {
        console.log(`📏 Drawing path with ${state.path.length} points`);
        
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
    
    // Обновляем статус
    const statusEl = document.getElementById('connectionStatus');
    if (statusEl) {
        statusEl.textContent = '🟢 LIVE: Трансляция идет';
    }
    
    // Скрываем загрузку
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
        loadingEl.style.display = 'none';
    }
}

// 🔥 Для отладки в консоли
window.debugWatch = {
    emit: (event, data) => {
        if (window.watchSocket) {
            window.watchSocket.emit(event, data);
            console.log(`Emitted ${event}:`, data);
        } else {
            console.log('Socket not initialized');
        }
    },
    requestBalloon: () => {
        if (window.watchSocket) {
            window.watchSocket.emit('watch-public-balloon');
        } else {
            console.log('Socket not initialized');
        }
    },
    status: () => {
        console.log('Socket connected:', window.watchSocket?.connected);
        console.log('Balloon marker:', !!publicBalloonMarker);
    }
};

console.log('🎈 Watch page script loaded');
