// ========== WATCH PAGE - LIVE PUBLIC BALLOON ==========
// Гибрид: WebSocket + полная функциональность

let map;
let publicBalloonMarker = null;
let publicPathLine = null;
let lastPosition = null;
const socket = io('/'); // Подключение к серверу

// Инициализация страницы
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎈 Watch page initialized with WebSocket');
    initMap();
    setupWebSocketListeners();
    updateStatus('🔄 Подключение к серверу...');
});

// Очистка при закрытии
window.addEventListener('beforeunload', () => {
    if (socket) socket.disconnect();
    if (publicBalloonMarker) map?.removeLayer(publicBalloonMarker);
    if (publicPathLine) map?.removeLayer(publicPathLine);
});

// ========== ИНИЦИАЛИЗАЦИЯ КАРТЫ ==========
function initMap() {
    console.log('🗺️ Initializing map...');
    
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
    
    // По умолчанию спутник
    esriSatellite.addTo(map);
    
    // Переключение слоев
    L.control.layers(
        { 
            "🛰️ Спутник": esriSatellite, 
            "🗺️ OSM": osmStandard 
        },
        null,
        { position: 'topleft', collapsed: false }
    ).addTo(map);
    
    // Масштаб
    L.control.scale({ metric: true, position: 'bottomleft' }).addTo(map);
    
    console.log('✅ Map initialized');
}

// ========== WEBSOCKET ==========
function setupWebSocketListeners() {
    // Основное событие - получение данных шара
    socket.on('balloonsData', (data) => {
        try {
            console.log('📡 Получены данные:', data);
            
            // Извлекаем публичный шар
            let publicBalloon;
            if (Array.isArray(data)) {
                publicBalloon = data.find(b => b?.isPublic) || data[0];
            } else {
                publicBalloon = data?.isPublic !== undefined ? data : null;
            }
            
            if (publicBalloon) {
                renderBalloon(publicBalloon);
                updateStatus(`🟢 LIVE ${new Date().toLocaleTimeString()}`);
            } else {
                updateStatus('⏳ Ожидание публичного шара...');
            }
        } catch (error) {
            console.error('Ошибка обработки данных:', error);
            updateStatus('❌ Ошибка данных');
        }
    });

    // Обработка ошибок подключения
    socket.on('connect', () => {
        console.log('✅ WebSocket connected');
        updateStatus('🟢 Подключено');
    });

    socket.on('connect_error', (err) => {
        console.error('❌ WebSocket connection error:', err);
        updateStatus('❌ Ошибка подключения');
    });

    socket.on('disconnect', () => {
        console.warn('⚠️ WebSocket disconnected');
        updateStatus('⏸️ Отключено');
    });

    socket.on('reconnect', () => {
        console.log('🔄 WebSocket reconnected');
        updateStatus('🟢 Переподключено');
    });
}

// ========== ОТРИСОВКА ШАРА ==========
function renderBalloon(data) {
    if (!map) {
        console.error('❌ Карта не инициализирована');
        return;
    }

    // Извлекаем координаты
    const lat = data?.position?.lat ?? data?.latitude;
    const lng = data?.position?.lng ?? data?.longitude;

    // Проверка координат
    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
        console.warn('⚠️ Некорректные координаты:', { lat, lng });
        return;
    }

    const currentPos = [lat, lng];
    
    // Проверяем, изменилась ли позиция
    const positionChanged = !lastPosition || 
        Math.abs(lastPosition[0] - lat) > 0.0001 || 
        Math.abs(lastPosition[1] - lng) > 0.0001;
    
    if (positionChanged) {
        console.log(`📍 Новая позиция: ${lat.toFixed(4)}°, ${lng.toFixed(4)}°`);
        lastPosition = currentPos;
        
        // Обновляем координаты в info-panel
        const coordsEl = document.getElementById('coords');
        if (coordsEl) {
            coordsEl.textContent = `📍 ${lat.toFixed(6)}°, ${lng.toFixed(6)}°`;
        }
    }

    // === 1. ОБНОВЛЕНИЕ МАРКЕРА ===
    if (publicBalloonMarker) {
        map.removeLayer(publicBalloonMarker);
        publicBalloonMarker = null;
    }

    // Создаем иконку (увеличенная через CSS класс)
    const balloonIcon = L.icon({
        iconUrl: '/images/balloon.png',
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
        className: 'double-size-balloon' // CSS класс для увеличения
    });

    // Добавляем маркер
    publicBalloonMarker = L.marker(currentPos, {
        icon: balloonIcon,
        zIndexOffset: 1000
    }).addTo(map);

    // Попап с информацией
    publicBalloonMarker.bindPopup(`
        <div style="text-align: center; min-width: 150px; padding: 5px;">
            <strong>🎈 Aerostar Balloon</strong><br>
            📍 ${lat.toFixed(6)}°, ${lng.toFixed(6)}°<br>
            🕐 ${new Date().toLocaleTimeString()}
        </div>
    `);

    // === 2. ОТРИСОВКА ТРЕКА ===
    if (data.path && Array.isArray(data.path) && data.path.length > 1) {
        // Удаляем старый трек
        if (publicPathLine) {
            map.removeLayer(publicPathLine);
            publicPathLine = null;
        }

        // Преобразуем точки пути
        const pathPoints = data.path.map(point => {
            const pLat = point?.lat ?? point?.latitude;
            const pLng = point?.lng ?? point?.longitude;
            if (pLat != null && pLng != null && !isNaN(pLat) && !isNaN(pLng)) {
                return [pLat, pLng];
            }
            return null;
        }).filter(p => p !== null);

        if (pathPoints.length > 1) {
            // Основная линия трека
            publicPathLine = L.polyline(pathPoints, {
                color: '#ff4444',
                weight: 4,
                opacity: 0.8,
                smoothFactor: 1
            }).addTo(map);

            console.log(`📏 Отрисован трек из ${pathPoints.length} точек`);
        }
    } else if (data.path && data.path.length === 1) {
        console.log('📍 Только начальная позиция, трека пока нет');
    }

    // === 3. ЦЕНТРИРОВАНИЕ КАРТЫ ===
    if (positionChanged) {
        const center = map.getCenter();
        const distance = map.distance(center, currentPos);
        
        if (distance > 5000) { // > 5 км
            map.setView(currentPos, map.getZoom());
            console.log(`🎯 Центрирование на новую позицию (${distance.toFixed(0)}м)`);
        } else if (distance > 100) {
            map.panTo(currentPos);
        }
    }

    // Скрываем загрузку
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
        loadingEl.style.display = 'none';
    }
}

// ========== СТАТУС ==========
function updateStatus(message) {
    const statusEl = document.getElementById('connectionStatus');
    if (statusEl) {
        statusEl.textContent = message;
        
        // Меняем цвет индикатора в зависимости от статуса
        if (message.includes('LIVE') || message.includes('Подключено')) {
            statusEl.style.borderLeftColor = '#00ff88';
        } else if (message.includes('Ошибка') || message.includes('Отключено')) {
            statusEl.style.borderLeftColor = '#ff4444';
        } else {
            statusEl.style.borderLeftColor = '#ffaa00';
        }
    }
}

console.log('🎈 Watch script loaded with WebSocket + tracking');
