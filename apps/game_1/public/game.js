// ============================================
//  GAME.JS — основная логика клиента
// ============================================

class RegattaGame {
    constructor() {
        this.map = null;
        this.socket = null;
        this.playerId = null;
        this.role = null;
        this.ship = null;
        this.isGuest = true;
        this.markers = {};
        this.currentLayer = null;
        this.showCurrents = true;
        this.chatMessages = document.getElementById('chat-messages');
        this.notifications = document.getElementById('notifications');
        this.isAnchored = false;
        this.gameTime = 0;
        this.timeInterval = null;
    }

    // ============================================
    //  ИНИЦИАЛИЗАЦИЯ
    // ============================================
    async init() {
        // 1. Карта
        this.initMap();

        // 2. Socket.IO
        this.socket = io();

        // 3. Обработчики событий
        this.setupSocketHandlers();

        // 4. UI
        this.setupUI();

        // 5. Чат
        this.setupChat();

        // 6. Управление
        this.setupControls();

        // 7. Загрузка течений
        this.currentLayer = L.layerGroup().addTo(this.map);
        this.map.on('moveend', () => this.loadCurrents());
        
        // 8. Проверка статуса сервера
        this.checkServerStatus();
    }

    // ============================================
    //  КАРТА
    // ============================================
    initMap() {
        this.map = L.map('map', {
            center: [20, 0],
            zoom: 2.5,
            zoomControl: false,
            attributionControl: false
        });

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; Esri',
            maxZoom: 19
        }).addTo(this.map);

        // Масштаб
        L.control.zoom({
            position: 'bottomright'
        }).addTo(this.map);
    }

    // ============================================
    //  SOCKET ОБРАБОТЧИКИ
    // ============================================
    setupSocketHandlers() {
        // Подключение
        this.socket.on('connect', () => {
            console.log('✅ Socket connected');
            this.updateServerStatus(true);
        });

        this.socket.on('disconnect', () => {
            console.log('❌ Socket disconnected');
            this.updateServerStatus(false);
        });

        // Присоединение
        this.socket.on('joined', (data) => {
            this.playerId = data.ship.id;
            this.role = data.role;
            this.ship = data.ship;
            this.isGuest = data.role === 'guest';

            // Скрываем модалку
            document.getElementById('auth-modal').style.display = 'none';
            document.getElementById('hud').style.display = 'block';
            document.getElementById('chat').style.display = 'flex';

            // Обновляем HUD
            document.getElementById('ship-name').textContent = this.ship.name;
            document.getElementById('ship-role').textContent = this.isGuest ? '👁 Наблюдатель' : '⛵ Игрок';

            // Блокируем управление для гостей
            if (this.isGuest) {
                document.querySelectorAll('#controls .ctrl-btn').forEach(btn => {
                    btn.disabled = true;
                });
            }

            // Показываем уведомление
            if (data.isReconnect) {
                this.showNotification('♻️ Вы вернулись к своему кораблю!', 'success');
            } else if (this.isGuest) {
                this.showNotification('👁 Вы вошли как наблюдатель', 'info');
            } else {
                this.showNotification('⛵ Добро пожаловать в регату!', 'success');
            }

            // Обновляем состояние
            this.updateHUD();
            this.updatePlayers(data.players);
            this.updateWeather(data.wind, data.current);

            // Запускаем таймер
            this.startTimer();
        });

        // Состояние игры
        this.socket.on('state', (data) => {
            this.updatePlayers(data.players);
            if (this.ship) {
                const updated = data.players[this.playerId];
                if (updated) {
                    this.ship = updated;
                    this.updateHUD();
                }
            }
        });

        // События игроков
        this.socket.on('player_joined', (data) => {
            this.addChatMessage(`🚢 ${data.name} присоединился к гонке`, 'system');
        });

        this.socket.on('player_left', (data) => {
            if (data.isOffline) {
                this.addChatMessage(`💤 ${data.name} вышел, корабль продолжает путь`, 'system');
            }
        });

        this.socket.on('player_removed', (data) => {
            this.addChatMessage(`🧹 ${data.name} ${data.reason || 'покинул игру'}`, 'system');
        });

        // События корабля
        this.socket.on('ship_grounded', (data) => {
            this.showNotification(`⚠️ ${data.name} сел на мель!`, 'danger');
            this.addChatMessage(`⚠️ ${data.name} сел на мель!`, 'danger');
        });

        this.socket.on('ship_anchored', (data) => {
            this.addChatMessage(`⚓ ${data.name} встал на якорь`, 'system');
        });

        this.socket.on('ship_eliminated', (data) => {
            this.showNotification(`💀 ${data.name} выбыл: ${data.reason}`, 'danger');
            this.addChatMessage(`💀 ${data.name} выбыл: ${data.reason}`, 'danger');
        });

        this.socket.on('help_requested', (data) => {
            this.showNotification(`🆘 ${data.name} просит помощи!`, 'warning');
            this.addChatMessage(`🆘 ${data.name} просит помощи!`, 'danger');
        });

        // Результаты действий
        this.socket.on('action_result', (data) => {
            if (!data.success) {
                this.showNotification(`❌ ${data.message}`, 'warning');
            }
        });

        // Чат
        this.socket.on('chat', (data) => {
            const prefix = data.isGuest ? '👁' : '⛵';
            this.addChatMessage(`${prefix} ${data.name}: ${data.message}`, 'user');
        });

        // Ошибки
        this.socket.on('join_error', (data) => {
            document.getElementById('login-error').textContent = data.message;
            document.getElementById('login-error').style.display = 'block';
        });
    }

    // ============================================
    //  ОБНОВЛЕНИЕ ИГРОКОВ
    // ============================================
    updatePlayers(players) {
        for (const [id, player] of Object.entries(players)) {
            if (id === this.playerId) continue;
            this.updatePlayer(id, player);
        }

        // Удаляем отсутствующих
        for (const [id, marker] of Object.entries(this.markers)) {
            if (id !== this.playerId && !players[id]) {
                this.map.removeLayer(marker);
                delete this.markers[id];
            }
        }
    }

    updatePlayer(id, player) {
        const isOffline = !player.isOnline;
        const isGuest = player.isGuest;
        const isEliminated = player.isEliminated;

        if (!this.markers[id]) {
            const icon = this.createShipIcon(player);
            this.markers[id] = L.marker([player.lat, player.lng], { icon })
                .addTo(this.map)
                .bindPopup(this.createPopup(player));
        } else {
            this.markers[id].setLatLng([player.lat, player.lng]);
            this.markers[id].setPopupContent(this.createPopup(player));

            // Обновляем иконку
            this.markers[id].setIcon(this.createShipIcon(player));
        }
    }

    createShipIcon(player) {
        const color = player.color || '#4CAF50';
        let statusClass = 'online';
        let statusIcon = '⛵';

        if (player.isEliminated) {
            statusClass = 'eliminated';
            statusIcon = '💀';
        } else if (!player.isOnline) {
            statusClass = 'offline';
            statusIcon = '💤';
        } else if (player.isGuest) {
            statusClass = 'guest';
            statusIcon = '👁';
        }

        if (player.isAnchored) statusIcon = '⚓';
        if (player.isGrounded) statusIcon = '⚠';

        return L.divIcon({
            className: 'ship-marker',
            html: `
                <div class="ship-icon ${statusClass}" style="border-color: ${color};">
                    ${statusIcon}
                </div>
            `,
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });
    }

    createPopup(player) {
        let status = '🟢 В пути';
        if (player.isEliminated) status = '💀 Выбыл';
        else if (player.isGrounded) status = '⚠ На мели';
        else if (player.isAnchored) status = '⚓ На якоре';
        else if (!player.isOnline) status = '💤 Офлайн';

        const role = player.isGuest ? '👁 Гость' : '⛵ Игрок';

        return `
            <strong>${player.name}</strong><br>
            ${role}<br>
            ${status}<br>
            🧭 ${player.heading || 0}° | ⛵ ${(player.speed || 0).toFixed(1)} уз<br>
            📏 ${(player.distanceTraveled || 0).toFixed(0)} км
            ${player.eliminationReason ? `<br>💀 ${player.eliminationReason}` : ''}
        `;
    }

    // ============================================
    //  ТЕЧЕНИЯ
    // ============================================
    async loadCurrents() {
        if (!this.showCurrents) {
            this.currentLayer.clearLayers();
            return;
        }

        const bounds = this.map.getBounds();
        const gridSize = 5;

        const params = new URLSearchParams({
            latMin: bounds.getSouth(),
            latMax: bounds.getNorth(),
            lngMin: bounds.getWest(),
            lngMax: bounds.getEast(),
            step: gridSize
        });

        try {
            const response = await fetch(`/api/currents/grid?${params}`);
            const data = await response.json();

            this.currentLayer.clearLayers();

            for (const point of data) {
                if (point.speed > 0.1) {
                    const arrow = this.createCurrentArrow(point);
                    this.currentLayer.addLayer(arrow);
                }
            }
        } catch (error) {
            console.error('Failed to load currents:', error);
        }
    }

    createCurrentArrow(point) {
        const { lat, lng, speed, direction } = point;
        const length = Math.min(speed * 0.08, 1.2);
        const angle = (direction - 90) * Math.PI / 180;

        const endLat = lat + length * Math.cos(angle);
        const endLng = lng + length * Math.sin(angle);

        const color = this.getCurrentColor(speed);

        const line = L.polyline(
            [[lat, lng], [endLat, endLng]],
            {
                color: color,
                weight: 3 + speed * 0.5,
                opacity: 0.7,
                dashArray: null
            }
        );

        // Наконечник
        const headSize = 0.15;
        const headAngle = 0.6;
        const headPoints = [
            [endLat, endLng],
            [
                endLat - headSize * Math.cos(angle - headAngle),
                endLng - headSize * Math.sin(angle - headAngle)
            ],
            [
                endLat - headSize * Math.cos(angle + headAngle),
                endLng - headSize * Math.sin(angle + headAngle)
            ]
        ];

        const head = L.polyline(headPoints, {
            color: color,
            weight: 3,
            opacity: 0.7
        });

        return L.layerGroup([line, head]);
    }

    getCurrentColor(speed) {
        if (speed < 0.5) return '#4CAF50';
        if (speed < 1.0) return '#8BC34A';
        if (speed < 1.5) return '#FFC107';
        if (speed < 2.0) return '#FF9800';
        if (speed < 3.0) return '#FF5722';
        return '#F44336';
    }

    // ============================================
    //  HUD
    // ============================================
    updateHUD() {
        if (!this.ship) return;

        document.getElementById('heading-display').textContent = `${this.ship.heading || 0}°`;
        document.getElementById('speed-display').textContent = (this.ship.speed || 0).toFixed(1);
        document.getElementById('sail-display').textContent = `${Math.round((this.ship.sailPosition || 0) * 100)}%`;
        document.getElementById('sail-fill').style.width = `${Math.round((this.ship.sailPosition || 0) * 100)}%`;
        document.getElementById('distance-display').textContent = (this.ship.distanceTraveled || 0).toFixed(0);

        let status = 'В пути';
        let statusIcon = '🟢';
        if (this.ship.isEliminated) {
            status = 'Выбыл';
            statusIcon = '💀';
        } else if (this.ship.isGrounded) {
            status = 'На мели!';
            statusIcon = '⚠️';
        } else if (this.ship.isAnchored) {
            status = 'На якоре';
            statusIcon = '⚓';
        } else if (!this.ship.isOnline) {
            status = 'Офлайн';
            statusIcon = '💤';
        }

        document.getElementById('status-display').textContent = status;
        document.getElementById('ship-status-icon').textContent = statusIcon;

        // Обновляем кнопку якоря
        const anchorBtn = document.getElementById('btn-anchor');
        if (this.ship.isAnchored) {
            anchorBtn.classList.add('active');
            anchorBtn.textContent = '⚓ Сняться';
        } else {
            anchorBtn.classList.remove('active');
            anchorBtn.textContent = '⚓ Якорь';
        }

        // Обновляем кнопку помощи
        const helpBtn = document.getElementById('btn-help');
        if (this.ship.isGrounded) {
            helpBtn.classList.add('active');
        } else {
            helpBtn.classList.remove('active');
        }
    }

    updateWeather(wind, current) {
        if (wind) {
            document.getElementById('wind-display').textContent =
                `${wind.speed.toFixed(1)} уз, ${wind.direction}°`;
        }
        if (current) {
            document.getElementById('current-display').textContent =
                `${current.speed.toFixed(1)} уз, ${current.direction}°`;
        }
    }

    startTimer() {
        if (this.timeInterval) clearInterval(this.timeInterval);
        this.gameTime = 0;
        this.timeInterval = setInterval(() => {
            this.gameTime++;
            const minutes = Math.floor(this.gameTime / 60);
            const seconds = this.gameTime % 60;
            document.getElementById('time-display').textContent =
                `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }, 1000);
    }

    // ============================================
    //  УВЕДОМЛЕНИЯ
    // ============================================
    showNotification(message, type = 'info') {
        const div = document.createElement('div');
        div.className = `notification ${type}`;
        div.textContent = message;
        this.notifications.appendChild(div);

        setTimeout(() => {
            div.style.opacity = '0';
            div.style.transition = 'opacity 0.5s';
            setTimeout(() => div.remove(), 500);
        }, 4000);
    }

    // ============================================
    //  УПРАВЛЕНИЕ
    // ============================================
    setupControls() {
        // Клавиатура
        document.addEventListener('keydown', (e) => {
            if (this.isGuest || !this.socket) return;
            if (document.activeElement?.tagName === 'INPUT') return;

            switch (e.key) {
                case 'ArrowLeft':
                    this.socket.emit('turn', { delta: -15 });
                    e.preventDefault();
                    break;
                case 'ArrowRight':
                    this.socket.emit('turn', { delta: 15 });
                    e.preventDefault();
                    break;
                case 'ArrowUp':
                    this.socket.emit('sail', { action: 'raise' });
                    e.preventDefault();
                    break;
                case 'ArrowDown':
                    this.socket.emit('sail', { action: 'lower' });
                    e.preventDefault();
                    break;
                case ' ':
                    this.socket.emit('anchor', {
                        action: this.ship?.isAnchored ? 'weigh' : 'drop'
                    });
                    e.preventDefault();
                    break;
            }
        });

        // Кнопки
        document.getElementById('btn-left').onclick = () =>
            this.socket.emit('turn', { delta: -15 });
        document.getElementById('btn-right').onclick = () =>
            this.socket.emit('turn', { delta: 15 });
        document.getElementById('btn-raise').onclick = () =>
            this.socket.emit('sail', { action: 'raise' });
        document.getElementById('btn-lower').onclick = () =>
            this.socket.emit('sail', { action: 'lower' });
        document.getElementById('btn-anchor').onclick = () => {
            if (this.ship?.isAnchored) {
                this.socket.emit('anchor', { action: 'weigh' });
            } else {
                this.socket.emit('anchor', { action: 'drop' });
            }
        };
        document.getElementById('btn-help').onclick = () =>
            this.socket.emit('request_help');

        // Течения
        document.getElementById('toggle-currents').onclick = () => {
            this.showCurrents = !this.showCurrents;
            this.loadCurrents();
        };
    }

    // ============================================
    //  ЧАТ
    // ============================================
    setupChat() {
        document.getElementById('chat-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && this.socket) {
                const msg = e.target.value.trim();
                if (msg) {
                    this.socket.emit('chat', { message: msg });
                    e.target.value = '';
                }
            }
        });

        document.getElementById('chat-send').onclick = () => {
            const input = document.getElementById('chat-input');
            const msg = input.value.trim();
            if (msg && this.socket) {
                this.socket.emit('chat', { message: msg });
                input.value = '';
            }
        };

        document.getElementById('chat-toggle').onclick = () => {
            const messages = document.getElementById('chat-messages');
            const input = document.getElementById('chat-input-area');
            const isHidden = messages.style.display === 'none';
            messages.style.display = isHidden ? 'block' : 'none';
            input.style.display = isHidden ? 'flex' : 'none';
            document.getElementById('chat-toggle').textContent = isHidden ? '−' : '+';
        };
    }

    addChatMessage(text, type = 'user') {
        const div = document.createElement('div');
        div.className = `chat-${type}`;
        div.textContent = text;
        this.chatMessages.appendChild(div);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    // ============================================
    //  UI
    // ============================================
    setupUI() {
        // Вкладки авторизации
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
                document.getElementById(`${btn.dataset.tab}-form`).classList.add('active');
                document.getElementById('login-error').style.display = 'none';
                document.getElementById('register-error').style.display = 'none';
            };
        });

        // Вход
        document.getElementById('login-btn').onclick = () => {
            const username = document.getElementById('login-username').value;
            const password = document.getElementById('login-password').value;

            fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    this.socket.emit('join_as_player', { token: data.token });
                } else {
                    document.getElementById('login-error').textContent = data.message;
                    document.getElementById('login-error').style.display = 'block';
                }
            })
            .catch(() => {
                document.getElementById('login-error').textContent = 'Ошибка соединения с сервером';
                document.getElementById('login-error').style.display = 'block';
            });
        };

        // Регистрация
        document.getElementById('register-btn').onclick = () => {
            const username = document.getElementById('reg-username').value;
            const password = document.getElementById('reg-password').value;
            const confirm = document.getElementById('reg-password-confirm').value;

            if (password !== confirm) {
                document.getElementById('register-error').textContent = 'Пароли не совпадают';
                document.getElementById('register-error').style.display = 'block';
                return;
            }

            fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    document.getElementById('register-error').style.display = 'none';
                    this.showNotification('✅ Регистрация успешна! Теперь войдите.', 'success');
                    document.querySelector('[data-tab="login"]').click();
                    document.getElementById('login-username').value = username;
                } else {
                    document.getElementById('register-error').textContent = data.message;
                    document.getElementById('register-error').style.display = 'block';
                }
            });
        };

        // Гость
        document.getElementById('guest-btn').onclick = () => {
            this.socket.emit('join_as_guest');
        };

        // Enter для форм
        document.getElementById('login-password').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('login-btn').click();
        });
        document.getElementById('reg-password-confirm').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('register-btn').click();
        });

        // Получение количества игроков
        this.updatePlayerCount();
        setInterval(() => this.updatePlayerCount(), 30000);
    }

    updatePlayerCount() {
        fetch('/api/players')
            .then(r => r.json())
            .then(data => {
                document.getElementById('players-count').textContent =
                    `👥 Игроков: ${data.current || 0} / ${data.maxPlayers || 12}`;
            })
            .catch(() => {});
    }

    updateServerStatus(isOnline) {
        const status = document.getElementById('server-status');
        if (isOnline) {
            status.textContent = '🟢 Онлайн';
            status.style.color = '#4caf50';
        } else {
            status.textContent = '🔴 Офлайн';
            status.style.color = '#ff6b6b';
        }
    }

    checkServerStatus() {
        fetch('/api/players')
            .then(() => this.updateServerStatus(true))
            .catch(() => this.updateServerStatus(false));
    }
}

// Добавьте в setupSocketHandlers()

this.socket.on('admin_message', (data) => {
    // Показываем сообщение вверху чата
    const adminMsg = document.createElement('div');
    adminMsg.className = 'admin-message';
    adminMsg.innerHTML = `
        <div style="
            background: linear-gradient(135deg, #ffd966, #f7971e);
            color: #1a1a2e;
            padding: 10px 16px;
            border-radius: 10px;
            margin-bottom: 8px;
            font-weight: 600;
            font-size: 14px;
            box-shadow: 0 4px 15px rgba(247,151,30,0.3);
        ">
            📢 ${data.text}
        </div>
    `;
    
    const messages = document.getElementById('chat-messages');
    messages.prepend(adminMsg);
    
    // Авто-удаление через 30 секунд
    setTimeout(() => {
        if (adminMsg.parentNode) {
            adminMsg.style.transition = 'opacity 0.5s';
            adminMsg.style.opacity = '0';
            setTimeout(() => adminMsg.remove(), 500);
        }
    }, 30000);
});

// ============================================
//  ЗАПУСК
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const game = new RegattaGame();
    game.init();
});
