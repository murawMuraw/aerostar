// watch-main.js - Полная версия со статистикой
(function() {
    'use strict';

    console.log('🎈 Запуск Watch App со статистикой...');

    // ==================== КОНФИГУРАЦИЯ ====================
    const CONFIG = {
        defaultCenter: [20, 0],
        defaultZoom: 3,
        maxTrackPoints: 500
    };

    // ==================== ИНИЦИАЛИЗАЦИЯ КАРТЫ ====================
    const map = L.map('map', {
        zoomControl: false,
        attributionControl: true,
        fadeAnimation: true,
        zoomAnimation: true
    }).setView(CONFIG.defaultCenter, CONFIG.defaultZoom);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; CartoDB'
    }).addTo(map);

    console.log('🗺️ Карта инициализирована');

    // ==================== ПЕРЕМЕННЫЕ ====================
    let balloonMarker = null;
    let pathLine = null;
    let trackPoints = [];
    let isFirstUpdate = true;
    let socket = null;
    
    // Переменные для статистики
    let startPosition = null;
    let flightStartTime = null;
    let flightTimerInterval = null;
    let totalDistance = 0;
    let lastPosition = null;
    let isStatsInitialized = false;
    let positionCount = 0;

    // ==================== ФУНКЦИИ СТАТИСТИКИ ====================
    function haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const toRad = (deg) => deg * Math.PI / 180;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function formatDistance(meters) {
        if (meters < 1000) return `${Math.round(meters)} m`;
        return `${(meters / 1000).toFixed(2)} km`;
    }

    function formatCoords(lat, lon) {
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lon >= 0 ? 'E' : 'W';
        return `${Math.abs(lat).toFixed(4)}°${latDir} ${Math.abs(lon).toFixed(4)}°${lonDir}`;
    }

    function initStats(lat, lon) {
        if (isStatsInitialized) {
            console.log('📊 Статистика уже инициализирована');
            return;
        }
        
        console.log('🎯 ИНИЦИАЛИЗАЦИЯ СТАТИСТИКИ с координатами:', lat, lon);
        
        startPosition = { lat, lon };
        lastPosition = { lat, lon };
        flightStartTime = Date.now();
        isStatsInitialized = true;
        
        // Обновляем стартовые координаты
        document.getElementById('startPosition').textContent = 
            `${lat.toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${lon.toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
        
        // Запускаем таймер
        if (flightTimerInterval) clearInterval(flightTimerInterval);
        flightTimerInterval = setInterval(() => {
            if (flightStartTime) {
                const elapsed = (Date.now() - flightStartTime) / 1000;
                document.getElementById('flightTime').textContent = formatTime(elapsed);
            }
        }, 1000);
        
        // Первое обновление
        document.getElementById('flightTime').textContent = '00:00:00';
        document.getElementById('currentCoords').textContent = formatCoords(lat, lon);
        document.getElementById('distanceActual').textContent = '0 m';
        document.getElementById('distanceStraight').textContent = '0 m';
        
        console.log('✅ Статистика инициализирована!');
    }

    function updateStats(lat, lon) {
        positionCount++;
        console.log(`📊 Обновление статистики #${positionCount}:`, lat, lon);
        
        // Если статистика ещё не инициализирована - инициализируем
        if (!isStatsInitialized) {
            initStats(lat, lon);
            return;
        }
        
        const currentTime = Date.now();
        
        // Обновляем время
        if (flightStartTime) {
            const elapsed = (currentTime - flightStartTime) / 1000;
            document.getElementById('flightTime').textContent = formatTime(elapsed);
        }

        // Обновляем текущие координаты
        document.getElementById('currentCoords').textContent = formatCoords(lat, lon);

        // Расчёт расстояний
        if (lastPosition) {
            const segmentDist = haversineDistance(
                lastPosition.lat, lastPosition.lon,
                lat, lon
            );
            if (segmentDist > 0.5) { // игнорируем изменения меньше 0.5 метра
                totalDistance += segmentDist;
                console.log(`📏 Добавлено ${segmentDist.toFixed(1)} м, всего: ${totalDistance.toFixed(1)} м`);
            }
        }
        lastPosition = { lat, lon };

        // Фактическое расстояние
        document.getElementById('distanceActual').textContent = formatDistance(totalDistance);

        // Прямое расстояние от старта
        if (startPosition) {
            const straightDist = haversineDistance(
                startPosition.lat, startPosition.lon,
                lat, lon
            );
            document.getElementById('distanceStraight').textContent = formatDistance(straightDist);
        }
    }

    function resetStats() {
        console.log('🔄 Сброс статистики');
        isStatsInitialized = false;
        startPosition = null;
        flightStartTime = null;
        totalDistance = 0;
        lastPosition = null;
        positionCount = 0;
        if (flightTimerInterval) {
            clearInterval(flightTimerInterval);
            flightTimerInterval = null;
        }
        document.getElementById('flightTime').textContent = '--:--:--';
        document.getElementById('currentCoords').textContent = '--° --°';
        document.getElementById('distanceActual').textContent = '-- km';
        document.getElementById('distanceStraight').textContent = '-- km';
        document.getElementById('startPosition').textContent = '--';
    }

    // ==================== ОТРИСОВКА БАЛЛОНА ====================
    function createBalloonIcon() {
        return L.divIcon({
            className: 'balloon-marker',
            html: `
                <div style="position:relative; width:32px; height:32px;">
                    <svg viewBox="0 0 32 32" style="width:32px; height:32px; filter:drop-shadow(0 2px 8px rgba(0,0,0,0.5));">
                        <circle cx="16" cy="13" r="11" fill="#e74c3c" stroke="#c0392b" stroke-width="1.5"/>
                        <circle cx="16" cy="13" r="11" fill="url(#balloonGrad)" stroke="#c0392b" stroke-width="1.5"/>
                        <ellipse cx="16" cy="22" rx="4" ry="2" fill="#c0392b"/>
                        <line x1="14" y1="24" x2="12" y2="30" stroke="#c0392b" stroke-width="1.5"/>
                        <line x1="18" y1="24" x2="20" y2="30" stroke="#c0392b" stroke-width="1.5"/>
                        <defs>
                            <radialGradient id="balloonGrad" cx="40%" cy="35%">
                                <stop offset="0%" stop-color="#ff6b6b"/>
                                <stop offset="100%" stop-color="#c0392b"/>
                            </radialGradient>
                        </defs>
                    </svg>
                    <div style="position:absolute; top:-4px; right:-4px; width:10px; height:10px; background:#00ff88; border-radius:50%; border:2px solid #fff; box-shadow:0 0 10px rgba(0,255,136,0.5);"></div>
                </div>
            `,
            iconSize: [32, 32],
            iconAnchor: [16, 30],
            popupAnchor: [0, -30]
        });
    }

    // ==================== ОБНОВЛЕНИЕ ПОЗИЦИИ ====================
    function updateBalloon(lat, lon) {
        console.log(`📍 Новая позиция: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
        
        // Обновляем статистику
        updateStats(lat, lon);

        // Обновляем координаты в панели
        document.getElementById('coords').innerHTML = `
            <span class="status-dot"></span>
            ${lat.toFixed(6)}° ${lat >= 0 ? 'N' : 'S'}, ${lon.toFixed(6)}° ${lon >= 0 ? 'E' : 'W'}
        `;

        // Создаём маркер при первом обновлении
        if (!balloonMarker) {
            console.log('🎈 Создание маркера баллона');
            balloonMarker = L.marker([lat, lon], {
                icon: createBalloonIcon(),
                zIndexOffset: 1000
            }).addTo(map);
            
            pathLine = L.polyline([], {
                color: '#ff6b6b',
                weight: 2,
                opacity: 0.6,
                dashArray: '5, 8',
                lineJoin: 'round'
            }).addTo(map);
        }

        // Обновляем позицию
        balloonMarker.setLatLng([lat, lon]);

        // Добавляем точку в трек
        trackPoints.push([lat, lon]);
        if (trackPoints.length > CONFIG.maxTrackPoints) {
            trackPoints.shift();
        }
        pathLine.setLatLngs(trackPoints);

        // При первом обновлении центрируем карту
        if (isFirstUpdate) {
            console.log('🎯 Первое обновление - центрируем карту');
            map.setView([lat, lon], 6, { animate: true });
            isFirstUpdate = false;
        }
    }

    // ==================== СОЕДИНЕНИЕ ПО WEBSOCKET ====================
    function connectWebSocket() {
        console.log('🔌 Подключение к WebSocket...');
        
        try {
            socket = io({
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: 10,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                timeout: 20000
            });

            socket.on('connect', () => {
                console.log('✅ Socket подключен');
                document.getElementById('connectionStatus').textContent = '● Connected';
                document.getElementById('connectionStatus').style.borderLeftColor = '#00ff88';
                
                // Запрашиваем данные при подключении
                socket.emit('watch-join');
                console.log('📤 Отправлен запрос watch-join');
            });

            socket.on('position', (data) => {
                console.log('📡 Получены данные с сервера:', data);
                if (data && typeof data.lat === 'number' && typeof data.lon === 'number') {
                    // Проверяем, что координаты валидны
                    if (data.lat >= -90 && data.lat <= 90 && data.lon >= -180 && data.lon <= 180) {
                        updateBalloon(data.lat, data.lon);
                    } else {
                        console.warn('⚠️ Невалидные координаты:', data);
                    }
                } else {
                    console.warn('⚠️ Неверный формат данных:', data);
                }
            });

            socket.on('connect_error', (err) => {
                console.warn('⚠️ Ошибка подключения:', err);
                document.getElementById('connectionStatus').textContent = '⚠️ Connection error';
                document.getElementById('connectionStatus').style.borderLeftColor = '#ff6b6b';
            });

            socket.on('reconnect', () => {
                console.log('🔄 Переподключено');
                document.getElementById('connectionStatus').textContent = '● Connected';
                document.getElementById('connectionStatus').style.borderLeftColor = '#00ff88';
                socket.emit('watch-join');
            });

            socket.on('disconnect', (reason) => {
                console.log('🔌 Отключено:', reason);
                document.getElementById('connectionStatus').textContent = '⏳ Disconnected';
                document.getElementById('connectionStatus').style.borderLeftColor = '#ffaa00';
            });

        } catch (error) {
            console.error('❌ Ошибка инициализации Socket:', error);
            document.getElementById('connectionStatus').textContent = '❌ Connection failed';
            document.getElementById('connectionStatus').style.borderLeftColor = '#ff0000';
            setTimeout(connectWebSocket, 5000);
        }
    }

    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    function init() {
        console.log('🚀 Инициализация Watch App...');
        
        // Сброс статистики
        resetStats();
        
        // Подключение к WebSocket
        connectWebSocket();

        // Обработка видимости страницы
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && socket && socket.connected) {
                console.log('👁️ Страница видна - запрос обновления');
                socket.emit('watch-join');
            }
        });

        console.log('✅ Watch App инициализирован');
        console.log('📊 Ожидание данных для статистики...');
    }

    // Запуск
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
