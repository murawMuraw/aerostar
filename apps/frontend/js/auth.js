// ========== МОДУЛЬ АВТОРИЗАЦИИ ==========

// Функции авторизации
async function login(email, password) {
    try {
        const response = await fetch(`${window.App.API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            window.App.token = data.token;
            window.App.currentUser = data.user;
            window.App.isGuest = false;
            localStorage.setItem('token', data.token);
            
            // 🔥 НОВОЕ: Отправляем токен в socket для аутентификации
            if (window.socket && window.socket.connected) {
                window.socket.emit('authenticate', data.token);
                console.log('🔐 Token sent to socket for authentication');
            }
            
            showAuthModal(false);
            updateProfileUI();
            clearAuthForms();
            await restoreBalloon();
            showSuccess('Welcome, ' + data.user.email + '!');
            return true;
        } else {
            showError(data.error || 'Login error');
            return false;
        }
    } catch (error) {
        console.error('Login error:', error);
        showError('Error connecting to server');
        return false;
    }
}

async function register(email, password) {
    if (password.length < 6) {
        showError('The password must be at least 6 characters');
        return false;
    }
    
    try {
        const response = await fetch(`${window.App.API_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            window.App.token = data.token;
            window.App.currentUser = data.user;
            window.App.isGuest = false;
            localStorage.setItem('token', data.token);
            
            // 🔥 НОВОЕ: Отправляем токен в socket для аутентификации
            if (window.socket && window.socket.connected) {
                window.socket.emit('authenticate', data.token);
                console.log('🔐 Token sent to socket for authentication');
            }
            
            showAuthModal(false);
            updateProfileUI();
            clearAuthForms();
            showSuccess('Registration successful! Welcome!');
            return true;
        } else {
            showError(data.error || 'Registration error');
            return false;
        }
    } catch (error) {
        console.error('Registration error:', error);
        showError('Error connecting to server');
        return false;
    }
}

function logout() {
    localStorage.removeItem('token');
    window.App.token = null;
    window.App.currentUser = null;
    window.App.isGuest = true;
    
    // 🔥 НОВОЕ: Сообщаем socket о выходе
    if (window.socket && window.socket.connected) {
        window.socket.emit('logout');
        console.log('🔓 Socket logged out');
    }
    
    updateProfileUI();
    resetFlight();
    showAuthModal(false);
    showSuccess('You are logged out of your account');
}

function continueAsGuest() {
    window.App.isGuest = true;
    window.App.currentUser = null;
    window.App.token = null;
    
    // 🔥 НОВОЕ: Для гостей отправляем guest-статус
    if (window.socket && window.socket.connected) {
        window.socket.emit('guest-mode', { isGuest: true });
        console.log('👤 Guest mode activated for socket');
    }
    
    showAuthModal(false);
    updateProfileUI();
    showSuccess('You are logged in as a guest');
}

// Восстановление сессии
async function restoreSession() {
    if (window.App.token) {
        try {
            const response = await fetch(`${window.App.API_URL}/api/auth/me`, {
                headers: { 'Authorization': `Bearer ${window.App.token}` }
            });
            const user = await response.json();
            
            if (user && !user.error) {
                window.App.currentUser = user;
                window.App.isGuest = false;
                updateProfileUI();
                
                // 🔥 НОВОЕ: Отправляем токен в socket после восстановления сессии
                if (window.socket && window.socket.connected) {
                    window.socket.emit('authenticate', window.App.token);
                    console.log('🔐 Session restored, token sent to socket');
                }
                
                await restoreBalloon();
            } else {
                logout();
            }
        } catch (error) {
            console.error('Session recovery error:', error);
            logout();
        }
    } else {
        updateProfileUI();
        // 🔥 НОВОЕ: Гостевой режим при отсутствии токена
        if (window.socket && window.socket.connected) {
            window.socket.emit('guest-mode', { isGuest: true });
        }
    }
}

// Инициализация обработчиков авторизации
function initAuthHandlers() {
    // Переключение табов в модальном окне
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            document.getElementById('loginForm').classList.toggle('hidden', tabName !== 'login');
            document.getElementById('registerForm').classList.toggle('hidden', tabName !== 'register');
        });
    });
    
    // Кнопки входа и регистрации
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    const continueGuestBtn = document.getElementById('continueGuestBtn');
    const profileButton = document.getElementById('profileButton');
    
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            login(
                document.getElementById('loginEmail').value,
                document.getElementById('loginPassword').value
            );
        });
    }
    
    if (registerBtn) {
        registerBtn.addEventListener('click', () => {
            register(
                document.getElementById('regEmail').value,
                document.getElementById('regPassword').value
            );
        });
    }
    
    if (continueGuestBtn) {
        continueGuestBtn.addEventListener('click', continueAsGuest);
    }
    
    if (profileButton) {
        profileButton.addEventListener('click', () => showAuthModal(true));
    }
    
    // 🔥 НОВОЕ: Обработчик закрытия модального окна для очистки форм
    const closeModalBtn = document.getElementById('closeAuthModal');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            clearAuthForms();
        });
    }
}

// 🔥 НОВАЯ ФУНКЦИЯ: Очистка форм авторизации
function clearAuthForms() {
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('regEmail').value = '';
    document.getElementById('regPassword').value = '';
}

// 🔥 НОВАЯ ФУНКЦИЯ: Проверка, является ли пользователь публичным вещателем
function isPublicBroadcaster() {
    return window.App.currentUser && window.App.currentUser.email === 'aerostar@aerost.art';
}

// 🔥 НОВАЯ ФУНКЦИЯ: Получение текущего email пользователя
function getUserEmail() {
    if (window.App.currentUser && window.App.currentUser.email) {
        return window.App.currentUser.email;
    }
    return null;
}
