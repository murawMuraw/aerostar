//UI компоненты
// ========== UI КОМПОНЕНТЫ И ОТОБРАЖЕНИЕ ==========

// Управление индикатором загрузки
function showLoading(message = 'Load... 🗺️') {
    const loading = document.getElementById('loading');
    if (loading) {
        loading.innerHTML = message;
        loading.style.display = 'block';
    }
}

function hideLoading(delay = 0) {
    if (delay > 0) {
        setTimeout(() => {
            const loading = document.getElementById('loading');
            if (loading) loading.style.display = 'none';
        }, delay);
    } else {
        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'none';
    }
}

// Обновление информации о пользователе в интерфейсе
function updateProfileUI() {
    const profileStatus = document.getElementById('profileStatus');
    const profileBtn = document.getElementById('profileButton');
    
    if (!profileStatus || !profileBtn) return;
    
    if (window.App.currentUser) {
        profileStatus.textContent = window.App.currentUser.email;
        profileBtn.style.background = 'rgba(255,255,255,0.95)';
        profileBtn.style.borderColor = '#4caf50';
    } else if (window.App.isGuest) {
        profileStatus.textContent = 'Guest';
        profileBtn.style.background = 'rgba(255,255,255,0.95)';
        profileBtn.style.borderColor = '#ff9800';
    }
}

// Отображение модального окна авторизации
function showAuthModal(show = true) {
    const authModal = document.getElementById('authModal');
    if (authModal) {
        authModal.classList.toggle('hidden', !show);
    }
}

// Обновление отображения координат
function updateCoordDisplay(lat, lng) {
    const coordDisplay = document.getElementById('coordinates');
    if (coordDisplay) {
        coordDisplay.innerHTML = `Lat:${lat.toFixed(6)}<br>Lng: ${lng.toFixed(6)}`;
    }
}

// Отображение информации о ветре
function updateWindDisplay(wind) {
    const windInfo = document.getElementById('windInfo');
    if (!windInfo) return;
    
    if (wind) {
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const index = Math.round(wind.direction / 45) % 8;
        windInfo.innerHTML = `
            <div>🌬️ Wind ${wind.speed.toFixed(1)} м/с</div>
            <div>🧭 Direction ${wind.direction}° (${directions[index]})</div>
            ${wind.gust ? `<div>💨 Wind gusts ${wind.gust.toFixed(1)} м/с</div>` : ''}
            <div>⏱️  ${new Date().toLocaleTimeString()}</div>
        `;
    } else {
        windInfo.innerHTML = `<div>🌬️  --</div><div>🧭  --</div><div>📏  -- м/с</div>`;
    }
}

// Обновление статуса полёта
function updateFlightStatus(status, message) {
    const flightStatus = document.getElementById('flightStatus');
    if (!flightStatus) return;
    
    const statusClasses = {
        'ready': 'status-ready',
        'flying': 'status-flying',
        'waiting': 'status-waiting'
    };
    
    flightStatus.className = `flight-status ${statusClasses[status] || statusClasses.ready}`;
    
    const messages = {
        'ready': '⏸️ ',
        'flying': '🎈 ',
        'waiting': '⏳'
    };
    
    flightStatus.innerHTML = message || messages[status] || '⏸️ ';
}

// Обновление подсказки
function updateHint(message) {
    const hint = document.getElementById('hint');
    if (hint) {
        hint.innerHTML = message;
        hint.style.display = 'block';
    }
}

function hideHint() {
    const hint = document.getElementById('hint');
    if (hint) {
        hint.style.display = 'none';
    }
}

// Управление кнопкой старта
function setStartButtonEnabled(enabled) {
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        startBtn.disabled = !enabled;
    }
}

// Отображение информации о месте (населённый пункт)
function showPlaceInfo(placeData) {
    const placeInfo = document.getElementById('placeInfo');
    if (!placeInfo) return;
    
    if (placeData.found && placeData.name) {
        placeInfo.style.display = 'block';
        document.getElementById('placeName').innerHTML = `🏙️ ${placeData.name}${placeData.country ? `, ${placeData.country}` : ''}`;
        
        if (placeData.wikipedia_url) {
            document.getElementById('placeLink').innerHTML = `<a href="${placeData.wikipedia_url}" target="_blank" style="font-size: 13px; color: #4285f4; text-decoration: none;">📖 Посмотреть в Википедии →</a>`;
        } else {
            document.getElementById('placeLink').innerHTML = '<span style="font-size: 12px; color: #999;"></span>';
        }
        
        // Автоматически скрываем через 30 секунд
        setTimeout(() => {
            if (placeInfo.style.display !== 'none') {
                placeInfo.style.display = 'none';
            }
        }, 30000);
    } else {
        placeInfo.style.display = 'none';
    }
}

function hidePlaceInfo() {
    const placeInfo = document.getElementById('placeInfo');
    if (placeInfo) {
        placeInfo.style.display = 'none';
    }
}

// Приветственное модальное окно
function showWelcomeModal() {
    // Проверяем, нужно ли показывать окно
    const dontShow = localStorage.getItem('welcome_dont_show');
    if (dontShow === 'true') {
        return;
    }
    
    const modal = document.getElementById('welcomeModal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeWelcomeModal() {
    const modal = document.getElementById('welcomeModal');
    if (modal) {
        modal.classList.add('hidden');
    }
    
    // Проверяем, нужно ли запомнить выбор
    const checkbox = document.getElementById('dontShowCheckbox');
    if (checkbox && checkbox.checked) {
        localStorage.setItem('welcome_dont_show', 'true');
    }
}

// Управление рекламным баннером
function hideAdBanner() {
    const adContainer = document.getElementById('ad-container');
    if (adContainer) {
        adContainer.style.display = 'none';
    }
}

function showAdBanner() {
    const adContainer = document.getElementById('ad-container');
    if (adContainer) {
        adContainer.style.display = 'block';
    }
}

// Отображение ошибок
function showError(message, duration = 3000) {
    // Создаём временное уведомление об ошибке
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-notification';
    errorDiv.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #f44336;
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 20000;
            font-weight: bold;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            animation: slideIn 0.3s ease-out;
        ">
            ⚠️ ${message}
        </div>
    `;
    
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
        errorDiv.remove();
    }, duration);
}

// Показать успешное уведомление
function showSuccess(message, duration = 2000) {
    const successDiv = document.createElement('div');
    successDiv.className = 'success-notification';
    successDiv.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #4caf50;
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 20000;
            font-weight: bold;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            animation: slideIn 0.3s ease-out;
        ">
            ✅ ${message}
        </div>
    `;
    
    document.body.appendChild(successDiv);
    
    setTimeout(() => {
        successDiv.remove();
    }, duration);
}

// Очистка форм авторизации
function clearAuthForms() {
    const loginEmail = document.getElementById('loginEmail');
    const loginPassword = document.getElementById('loginPassword');
    const regEmail = document.getElementById('regEmail');
    const regPassword = document.getElementById('regPassword');
    const loginError = document.getElementById('loginError');
    const regError = document.getElementById('regError');
    
    if (loginEmail) loginEmail.value = '';
    if (loginPassword) loginPassword.value = '';
    if (regEmail) regEmail.value = '';
    if (regPassword) regPassword.value = '';
    if (loginError) loginError.textContent = '';
    if (regError) regError.textContent = '';
}

// Экспорт функций (если используете ES6 модули)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        showLoading,
        hideLoading,
        updateProfileUI,
        showAuthModal,
        updateCoordDisplay,
        updateWindDisplay,
        updateFlightStatus,
        updateHint,
        hideHint,
        setStartButtonEnabled,
        showPlaceInfo,
        hidePlaceInfo,
        showWelcomeModal,
        closeWelcomeModal,
        hideAdBanner,
        showAdBanner,
        showError,
        showSuccess,
        clearAuthForms
    };
}
