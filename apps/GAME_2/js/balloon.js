//Логика полёта, движение шара
// ========== МОДУЛЬ УПРАВЛЕНИЯ ШАРОМ ==========

// Расчет следующей точки на основе ветра
function calculateNextPoint(start, wind, seconds) {
    const windDirection = (wind.direction + 180) % 360;
    const distance = wind.speed * seconds;
    const distanceKm = distance / 1000;
    const R = 6371; // Радиус Земли в км
    
    const lat1 = start.lat * Math.PI / 180;
    const lon1 = start.lng * Math.PI / 180;
    const bearing = windDirection * Math.PI / 180;
    
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distanceKm/R) + 
                   Math.cos(lat1) * Math.sin(distanceKm/R) * Math.cos(bearing));
    const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(distanceKm/R) * Math.cos(lat1), 
                   Math.cos(distanceKm/R) - Math.sin(lat1) * Math.sin(lat2));
    
    return { 
        lat: lat2 * 180 / Math.PI, 
        lng: lon2 * 180 / Math.PI 
    };
}

// Обновление прогноза полета
async function updateForecast(startPoint) {
    if (!startPoint) return;
    
    const wind = await getWindData(startPoint.lat, startPoint.lng);
    if (!wind) return;
    
    window.App.currentWind = wind;
    updateWindDisplay(wind);
    
    window.App.forecastPoints = [startPoint];
    let currentPoint = startPoint;
    
    for (let i = 1; i <= 12; i++) {
        const nextPoint = calculateNextPoint(currentPoint, wind, 300);
        window.App.forecastPoints.push(L.latLng(nextPoint.lat, nextPoint.lng));
        currentPoint = L.latLng(nextPoint.lat, nextPoint.lng);
    }
    
    if (window.App.forecastLine) {
        window.map.removeLayer(window.App.forecastLine);
    }
    
    window.App.forecastLine = L.polyline(window.App.forecastPoints, {
        color: '#00aaff', 
        weight: 3, 
        opacity: 0.7, 
        dashArray: '5, 5'
    }).addTo(window.map);
}

// Окружность на грани видимости
function updateHaze(center) {
    const canvas = document.getElementById('haze-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    canvas.width = window.map.getSize().x;
    canvas.height = window.map.getSize().y;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (!center || !window.App.isFlying) return;
    
    const centerPoint = window.map.latLngToContainerPoint(center);
    
    const metersPerPixel = window.map.distance(
        window.map.containerPointToLatLng([0, 0]), 
        window.map.containerPointToLatLng([1, 0])
    );
    
    const radius = (window.App.ZONES.HAZE || 500) / metersPerPixel;
    
    // Рисуем окружность
    ctx.beginPath();
    ctx.arc(centerPoint.x, centerPoint.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 150, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Добавляем маленькие метки на окружности (как на радаре)
    const numMarks = 8;
    for (let i = 0; i < numMarks; i++) {
        const angle = (i / numMarks) * Math.PI * 2;
        const x = centerPoint.x + Math.cos(angle) * radius;
        const y = centerPoint.y + Math.sin(angle) * radius;
        
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 150, 255, 0.8)';
        ctx.fill();
    }
    
    ctx.font = '12px Arial';
    ctx.fillStyle = 'rgba(0, 150, 255, 0.7)';
    ctx.shadowBlur = 0;
    ctx.fillText('⟡', centerPoint.x + radius - 10, centerPoint.y);
    ctx.fillText('⟡', centerPoint.x - radius + 10, centerPoint.y);
    ctx.fillText('⟡', centerPoint.x, centerPoint.y + radius - 10);
    ctx.fillText('⟡', centerPoint.x, centerPoint.y - radius + 10);
}

// Движение шара
function moveBalloon() {
    if (!window.App.isFlying || !window.App.balloonPosition || !window.App.currentWind) return;
    
    const nextPoint = calculateNextPoint(window.App.balloonPosition, window.App.currentWind, 1);
    window.App.balloonPosition = L.latLng(nextPoint.lat, nextPoint.lng);
    
    if (window.App.balloonMarker) {
        window.App.balloonMarker.setLatLng(window.App.balloonPosition);
    }
    
    updateCoordDisplay(window.App.balloonPosition.lat, window.App.balloonPosition.lng);
    updateHaze(window.App.balloonPosition);
    
    checkNearbyPlace(window.App.balloonPosition.lat, window.App.balloonPosition.lng);
    
    if (window.App.actualPathPoints.length === 0 || 
        window.map.distance(window.App.balloonPosition, window.App.actualPathPoints[window.App.actualPathPoints.length - 1]) > 10) {
        window.App.actualPathPoints.push(window.App.balloonPosition);
        
        if (window.App.pathLine) {
            window.map.removeLayer(window.App.pathLine);
        }
        
        window.App.pathLine = L.polyline(window.App.actualPathPoints, { 
            color: '#ff4444', 
            weight: 4, 
            opacity: 0.8 
        }).addTo(window.map);
        
        shareToPublicBalloon(window.App.balloonPosition, window.App.actualPathPoints);
    }
}

// Старт полета
// Старт полета (Исправленная версия с поддержкой погоды)
async function startFlight() {
    if (!window.App.balloonPosition) {
        showError('Select the starting point on the map');
        return;
    }
    
    updateFlightStatus('waiting', '⏳ ');
    
    try {
        const response = await apiRequest('/api/balloons', {
            method: 'POST',
            body: JSON.stringify({ 
                lat: window.App.balloonPosition.lat, 
                lng: window.App.balloonPosition.lng, 
                userId: getUserId(),
                isGuest: window.App.isGuest 
            })
        });
        
        const balloon = await response.json();
        if (balloon.error) throw new Error(balloon.error);
        
        window.App.balloonId = balloon.id;
        
        // ИСПРАВЛЕНИЕ: Передаем в объект также температуру и осадки, которые вернул сервер
        window.App.currentWind = { 
            speed: balloon.wind_speed, 
            direction: balloon.wind_direction,
            gust: balloon.wind_gust || 0,
            temp: balloon.temp !== undefined ? balloon.temp : '--',
            precip: balloon.precip !== undefined ? balloon.precip : '--'
        };
        
        // Сразу же отображаем полные данные на главной панели
        updateWindDisplay(window.App.currentWind);
        
        if (window.App.startMarker) {
            window.map.removeLayer(window.App.startMarker);
            window.App.startMarker = null;
        }
        
        const balloonIcon = L.icon({
            iconUrl: '/images/balloon.png',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            popupAnchor: [0, -16]
        });
        
        window.App.balloonMarker = L.marker(window.App.balloonPosition, { 
            icon: balloonIcon, 
            zIndexOffset: 1000 
        }).addTo(window.map);
        
        window.App.actualPathPoints = [window.App.balloonPosition];
        
        shareToPublicBalloon(window.App.balloonPosition, window.App.actualPathPoints);
        
        if (window.App.movementInterval) clearInterval(window.App.movementInterval);
        window.App.movementInterval = setInterval(moveBalloon, 1000);
        
        // Интервал обновления погоды (работает раз в минуту, запрашивает кэш сервера)
        if (window.App.windUpdateInterval) clearInterval(window.App.windUpdateInterval);
        window.App.windUpdateInterval = setInterval(async () => {
            if (window.App.isFlying && window.App.balloonPosition) {
                const newWind = await getWindData(window.App.balloonPosition.lat, window.App.balloonPosition.lng);
                if (newWind) {
                    window.App.currentWind = newWind;
                    updateWindDisplay(window.App.currentWind);
                    updateForecast(window.App.balloonPosition);
                }
            }
        }, 60000);
        
        window.App.isFlying = true;
        setStartButtonEnabled(false);
        updateFlightStatus('flying', '🎈 FLIGHT');
        hideHint();
        updateHaze(window.App.balloonPosition);
        showSuccess('The flight has begun! Follow the ball on the map');
        
    } catch (error) {
        console.error('Ошибка старта:', error);
        showError('Failed to create balloon: ' + error.message);
        updateFlightStatus('ready', '⏸️ ');
    }
}

// Восстановление полета после перезагрузки
async function restoreBalloon() {
    try {
        const userId = getUserId();
        const response = await fetch(`${window.App.API_URL}/api/balloons/${userId}`);
        
        if (response.status === 404) return false;
        
        const balloon = await response.json();
        if (balloon && balloon.is_flying) {
            console.log('🔄Restoring the ball:', balloon.id);
            
            window.App.balloonPosition = L.latLng(balloon.current_lat, balloon.current_lng);
            window.App.currentWind = { 
                speed: balloon.wind_speed, 
                direction: balloon.wind_direction 
            };
            window.App.balloonId = balloon.id;
            
            if (balloon.path && balloon.path.length > 0) {
                window.App.actualPathPoints = balloon.path.map(p => L.latLng(p.lat, p.lng));
                if (window.App.pathLine) window.map.removeLayer(window.App.pathLine);
                window.App.pathLine = L.polyline(window.App.actualPathPoints, { 
                    color: '#ff4444', 
                    weight: 4, 
                    opacity: 0.8 
                }).addTo(window.map);
            }
            
            const balloonIcon = L.icon({
                iconUrl: '/images/balloon.png',
                iconSize: [32, 32],
                iconAnchor: [16, 16],
                popupAnchor: [0, -16]
            });
            
            window.App.balloonMarker = L.marker(window.App.balloonPosition, { 
                icon: balloonIcon, 
                zIndexOffset: 1000 
            }).addTo(window.map);
            
            window.map.setView(window.App.balloonPosition, 10);
            updateCoordDisplay(window.App.balloonPosition.lat, window.App.balloonPosition.lng);
            updateWindDisplay(window.App.currentWind);
            
            window.App.isFlying = true;
            setStartButtonEnabled(false);
            updateFlightStatus('flying', '🎈 FLIGHT');
            hideHint();
            updateHaze(window.App.balloonPosition);
            
            if (window.App.movementInterval) clearInterval(window.App.movementInterval);
            window.App.movementInterval = setInterval(moveBalloon, 1000);
            
            if (window.App.windUpdateInterval) clearInterval(window.App.windUpdateInterval);
            window.App.windUpdateInterval = setInterval(async () => {
                if (window.App.isFlying && window.App.balloonPosition) {
                    const newWind = await getWindData(window.App.balloonPosition.lat, window.App.balloonPosition.lng);
                    if (newWind) {
                        window.App.currentWind = newWind;
                        updateWindDisplay(window.App.currentWind);
                    }
                }
            }, 60000);
            
            shareToPublicBalloon(window.App.balloonPosition, window.App.actualPathPoints);
            
            return true;
        }
        return false;
        
    } catch (error) {
        console.error('Restore Error', error);
        return false;
    }
}

// Сброс полета
function resetFlight() {
    if (window.App.movementInterval) {
        clearInterval(window.App.movementInterval);
        window.App.movementInterval = null;
    }
    
    if (window.App.windUpdateInterval) {
        clearInterval(window.App.windUpdateInterval);
        window.App.windUpdateInterval = null;
    }
    
    if (window.App.balloonId) {
        apiRequest(`/api/balloons/${window.App.balloonId}/stop`, { method: 'POST' }).catch(console.error);
    }
    
    if (window.App.balloonMarker) {
        window.map.removeLayer(window.App.balloonMarker);
        window.App.balloonMarker = null;
    }
    
    if (window.App.startMarker) {
        window.map.removeLayer(window.App.startMarker);
        window.App.startMarker = null;
    }
    
    if (window.App.forecastLine) {
        window.map.removeLayer(window.App.forecastLine);
        window.App.forecastLine = null;
    }
    
    if (window.App.pathLine) {
        window.map.removeLayer(window.App.pathLine);
        window.App.pathLine = null;
    }
    
    window.App.forecastPoints = [];
    window.App.actualPathPoints = [];
    window.App.isFlying = false;
    window.App.balloonPosition = null;
    window.App.currentWind = null;
    window.App.balloonId = null;
    
    updateCoordDisplay(0, 0);
    updateWindDisplay(null);
    setStartButtonEnabled(false);
    updateFlightStatus('ready', '⏸️');
    updateHint('👆 Select your starting location');
    updateHaze(null);
    hidePlaceInfo();
    
    showSuccess('Stop');
}

// ========== ПУБЛИЧНАЯ ТРАНСЛЯЦИЯ ДЛЯ AEROSTAR ==========
async function shareToPublicBalloon(position, path) {
    if (!window.App.currentUser || window.App.currentUser.email !== 'aerostar@aerost.art') {
        return;
    }
    
    if (!window.App.token) {
        console.warn('⚠️ Нет токена для авторизации');
        return;
    }
    
    if (!position) {
        console.warn('⚠️ Нет позиции для отправки');
        return;
    }
    
    try {
        const response = await fetch('/api/public-aerostar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.App.token}`
            },
            body: JSON.stringify({
                position: { lat: position.lat, lng: position.lng },
                path: path ? path.map(p => ({ lat: p.lat, lng: p.lng })) : []
            })
        });
        
        if (response.ok) {
            console.log(`📡 Публичный шар обновлен: ${position.lat}, ${position.lng}`);
        } else {
            const error = await response.json();
            console.warn('⚠️ Ошибка обновления публичного шара:', error.error);
        }
    } catch (error) {
        console.error('❌ Ошибка отправки публичного шара:', error);
    }
}
