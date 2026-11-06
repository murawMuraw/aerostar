// ========== API ЗАПРОСЫ ==========

async function apiRequest(url, options = {}) {
    const headers = { 
        'Content-Type': 'application/json', 
        ...options.headers 
    };
    
    if (window.App.token) {
        headers['Authorization'] = `Bearer ${window.App.token}`;
    }
    
    const response = await fetch(`${window.App.API_URL}${url}`, { 
        ...options, 
        headers 
    });
    
    return response;
}

async function getWindData(lat, lng) {
    try {
        // Запрос к серверу (передаем координаты)
        const response = await fetch(`${window.App.API_URL}/api/wind?lat=${lat}&lon=${lng}`);
        const data = await response.json();
        
        // Проверяем, что сервер вернул корректный объект с данными
        if (data && data.speed !== undefined) {
            // Возвращаем весь объект целиком. 
            // Он должен содержать: data.speed, data.direction, data.temp, data.precip
            return data; 
        }
        return null;
    } catch (error) {
        console.error('Error getting wind and weather data:', error);
        return null;
    }
}

let lastPlaceCheck = null;

async function checkNearbyPlace(lat, lng) {
    const now = Date.now();
    if (lastPlaceCheck && (now - lastPlaceCheck) < 30000) {
        return;
    }
    lastPlaceCheck = now;
    
    try {
        const response = await fetch(`${window.App.API_URL}/api/place?lat=${lat}&lon=${lng}`);
        const data = await response.json();
        
        const placeInfo = document.getElementById('placeInfo');
        if (!placeInfo) return;
        
        if (data.found && data.name) {
            placeInfo.style.display = 'block';
            document.getElementById('placeName').innerHTML = `🏙️ ${data.name}${data.country ? `, ${data.country}` : ''}`;
            
            if (data.wikipedia_url) {
                document.getElementById('placeLink').innerHTML = `<a href="${data.wikipedia_url}" target="_blank" style="font-size: 13px; color: #4285f4; text-decoration: none;">📖 Посмотреть в Википедии →</a>`;
            } else {
                document.getElementById('placeLink').innerHTML = '<span style="font-size: 12px; color: #999;"></span>';
            }
            
            setTimeout(() => {
                if (placeInfo.style.display !== 'none') {
                    placeInfo.style.display = 'none';
                }
            }, 30000);
        } else {
            placeInfo.style.display = 'none';
        }
    } catch (error) {
        console.error('Error getting seat', error);
    }
}

// ИСПРАВЛЕННАЯ ФУНКЦИЯ - использует window.App
function getUserId() {
    if (window.App.currentUser && window.App.currentUser.id) {
        return window.App.currentUser.id;
    }
    
    let guestId = localStorage.getItem('guest_user_id');
    if (!guestId) {
        guestId = 'guest_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('guest_user_id', guestId);
    }
    return guestId;
}

function startServerPing() {
    setInterval(() => {
        fetch(`${window.App.API_URL}/api/health`)
            .then(response => response.json())
            .then(data => console.log('💓 Пинг сервера:', data.status))
            .catch(err => console.warn('⚠️ Пинг не удался:', err));
    }, 600000);
    
    console.log('🕐 Пинг настроен (каждые 10 минут)');
}
