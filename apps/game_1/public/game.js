// game.js — полная версия для Regatta

class RegattaGame {
    constructor() {
        this.map = null;
        this.socket = null;
        this.playerId = null;
        this.ship = null;
        this.markers = {};
        this.selectedShip = null;
        this.selectedShipName = null;
        this.hasSelectedShip = false;
        this.isRacing = false;
        this.isSelectingStart = false;
        this.chatMessages = document.getElementById('chat-messages');
        this.notifications = document.getElementById('notifications');
        this.weatherInterval = null;
        this.startMarker = null;
        this.finishMarker = null;
    }

    // ============================================
    //  ИНИЦИАЛИЗАЦИЯ
    // ============================================
    async init() {
        this.initMap();
        this.initSocket();
        this.setupShipPanel();
        this.setupControls();
        this.setupChat();
        this.setupHomeButton();
        this.loadShipsState();
        this.loadRaceMarkers();

        // Обновляем погоду каждые 30 секунд
        this.weatherInterval = setInterval(() => this.updateWeather(), 30000);
    }

    // ============================================
    //  КАРТА
    // ============================================
    initMap() {
        this.map = L.map('map', {
            center: [20, 0],
            zoom: 2.5,
            zoomControl: true
        });

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; Esri',
            maxZoom: 19
        }).addTo(this.map);

        // Клик по карте для выбора старта
        this.map.on('click', (e) => {
            if (this.isSelectingStart && this.selectedShip) {
                this.confirmStart(e.latlng.lat, e.latlng.lng);
            }
        });

        // Добавляем кнопку масштаба
        L.control.zoom({
            position: 'bottomright'
        }).addTo(this.map);
    }

    // ============================================
    //  SOCKET
    // ============================================
    initSocket() {
        this.socket = io({
            transports: ['websocket', 'polling']
        });

        this.socket.on('connect', () => {
            console.log('✅ Socket connected');
        });

        this.socket.on('disconnect', () => {
            console.log('❌ Socket disconnected');
        });

        // ==========================================
        //  ПРИСОЕДИНЕНИЕ К ИГРЕ
        // ==========================================
        this.socket.on('joined', (data) => {
            this.playerId = data.ship.id;
            this.ship = data.ship;
            this.isRacing = true;
            this.hasSelectedShip = true;

            // Показываем панель управления
            document.getElementById('controls-panel').style.display = 'flex';
            document.getElementById('chat-input').disabled = false;
            document.getElementById('chat-send').disabled = false;

            // Блокируем все корабли
            document.querySelectorAll('.ship-btn').forEach(b => {
                b.style.opacity = '0.3';
                b.style.cursor = 'not-allowed';
                b.style.pointerEvents = 'none';
            });

            this.updateShipInfo();
            this.updatePlayers(data.players);
            this.showNotification('🚀 Добро пожаловать в регату!', 'success');
            this.addChatMessage('🚀 Вы в игре! Управляйте кораблём с помощью клавиатуры', 'system');
        });

        // ==========================================
        //  СОСТОЯНИЕ ИГРЫ
        // ==========================================
        this.socket.on('state', (data) => {
            this.updatePlayers(data.players);
            if (this.ship) {
                const updated = data.players[this.playerId];
                if (updated) {
                    this.ship = updated;
                    this.updateShipInfo();
                }
            }
        });

        // ==========================================
        //  СОБЫТИЯ ИГРОКОВ
        // ==========================================
        this.socket.on('player_joined', (data) => {
            this.addChatMessage(`🚢 ${data.name} присоединился к регате`, 'system');
        });

        this.socket.on('player_left', (data) => {
            if (data.isOffline) {
                this.addChatMessage(`💤 ${data.name} вышел (корабль продолжает путь)`, 'system');
            } else {
                this.addChatMessage(`👋 ${data.name} покинул регату`, 'system');
            }
        });

        this.socket.on('player_removed', (data) => {
            this.addChatMessage(`🧹 ${data.name} ${data.reason || 'покинул игру'}`, 'system');
            this.loadShipsState();
        });

        // ==========================================
        //  СОБЫТИЯ КОРАБЛЯ
        // ==========================================
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
            this.loadShipsState();
        });

        this.socket.on('help_requested', (data) => {
            this.showNotification(`🆘 ${data.name} просит помощи!`, 'warning');
            this.addChatMessage(`🆘 ${data.name} просит помощи!`, 'danger');
        });

        // ==========================================
        //  РЕЗУЛЬТАТЫ ДЕЙСТВИЙ
        // ==========================================
        this.socket.on('action_result', (data) => {
            if (!data.success) {
                this.showNotification(`❌ ${data.message}`, 'warning');
            }
        });

        // ==========================================
        //  ЧАТ
        // ==========================================
        this.socket.on('chat', (data) => {
            this.addChatMessage(`⛵ ${data.name}: ${data.message}`, 'user');
        });

        // ==========================================
        //  ОШИБКИ
        // ==========================================
        this.socket.on('join_error', (data) => {
            this.showNotification(`❌ ${data.message}`, 'danger');
            // Разблокируем корабли при ошибке
            this.hasSelectedShip = false;
            this.isSelectingStart = false;
            this.map.getContainer().style.cursor = 'default';
            this.loadShipsState();
        });
    }

    // ============================================
    //  ПАНЕЛЬ КОРАБЛЕЙ
    // ============================================
    setupShipPanel() {
        document.querySelectorAll('.ship-btn').forEach(btn => {
            btn.onclick = () => this.selectShip(btn);
        });
    }

    selectShip(btn) {
        if (this.hasSelectedShip) {
            this.showNotification('🚫 Вы уже выбрали корабль', 'warning');
            return;
        }
        if (btn.classList.contains('taken')) {
            this.showNotification('🚫 Этот корабль уже занят', 'warning');
            return;
        }

        // Снимаем выделение с других
        document.querySelectorAll('.ship-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedShip = btn.dataset.ship;
        this.selectedShipName = btn.dataset.name;
        this.hasSelectedShip = true;

        // Блокируем остальные кнопки
        document.querySelectorAll('.ship-btn').forEach(b => {
            if (b !== btn) {
                b.style.opacity = '0.3';
                b.style.cursor = 'not-allowed';
                b.style.pointerEvents = 'none';
            }
        });

        // Переключаемся в режим выбора старта
        this.isSelectingStart = true;
        this.showNotification('📍 Кликните по карте, чтобы выбрать место старта', 'info');
        this.addChatMessage('📍 Кликните по карте, чтобы выбрать место старта', 'system');

        // Меняем курсор
        this.map.getContainer().style.cursor = 'crosshair';

        // Показываем подсказку на карте
        if (this.startHint) {
            this.map.removeLayer(this.startHint);
        }
        this.startHint = L.popup()
            .setLatLng([this.map.getCenter().lat, this.map.getCenter().lng])
            .setContent('📍 <b>Кликните по карте</b> чтобы выбрать место старта')
            .openOn(this.map);

        // Авто-отмена через 30 секунд
        if (this.startTimeout) clearTimeout(this.startTimeout);
        this.startTimeout = setTimeout(() => {
            if (this.isSelectingStart) {
                this.isSelectingStart = false;
                this.map.getContainer().style.cursor = 'default';
                this.hasSelectedShip = false;
                this.selectedShip = null;
                document.querySelectorAll('.ship-btn').forEach(b => {
                    b.classList.remove('selected');
                    b.style.opacity = '1';
                    b.style.cursor = 'pointer';
                    b.style.pointerEvents = 'auto';
                });
                if (this.startHint) {
                    this.map.removeLayer(this.startHint);
                    this.startHint = null;
                }
                this.showNotification('⏰ Время выбора истекло, попробуйте снова', 'warning');
            }
        }, 30000);
    }

    confirmStart(lat, lng) {
        // Убираем подсказку
        if (this.startHint) {
            this.map.removeLayer(this.startHint);
            this.startHint = null;
        }
        if (this.startTimeout) {
            clearTimeout(this.startTimeout);
            this.startTimeout = null;
        }

        // Проверяем, что точка в океане (не на суше)
        // Делаем запрос к API течений — если точка на суше, вернётся ошибка
        fetch(`/api/current?lat=${lat}&lng=${lng}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error('Точка на суше или недоступна');
                }
                return response.json();
            })
            .then(() => {
                // Отправляем на сервер
                this.socket.emit('join_with_ship', {
                    shipId: this.selectedShip,
                    shipName: this.selectedShipName,
                    lat: lat,
                    lng: lng
                });

                this.isSelectingStart = false;
                this.map.getContainer().style.cursor = 'default';
                this.showNotification(`📍 Старт в ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
            })
            .catch((error) => {
                this.showNotification('❌ Нельзя стартовать на суше! Выберите точку в океане', 'danger');
                // Возвращаем возможность выбора
                this.isSelectingStart = true;
                this.map.getContainer().style.cursor = 'crosshair';
            });
    }

    // ============================================
    //  ЗАГРУЗКА СОСТОЯНИЯ КОРАБЛЕЙ
    // ============================================
    loadShipsState() {
        fetch('/api/ships/state')
            .then(r => r.json())
            .then(data => {
                document.querySelectorAll('.ship-btn').forEach(btn => {
                    const shipId = btn.dataset.ship;
                    const state = data[shipId];
                    if (state && state.taken) {
                        btn.classList.add('taken');
                        btn.style.opacity = '0.4';
                        btn.style.cursor = 'not-allowed';
                        btn.style.pointerEvents = 'none';
                        btn.querySelector('.status-dot').className = 'status-dot taken';
                    } else if (!this.hasSelectedShip) {
                        btn.classList.remove('taken');
                        btn.style.opacity = '1';
                        btn.style.cursor = 'pointer';
                        btn.style.pointerEvents = 'auto';
                        btn.querySelector('.status-dot').className = 'status-dot free';
                    }
                });
            })
            .catch(() => {});
    }

    // ============================================
    //  ЗАГРУЗКА МАРКЕРОВ СТАРТА/ФИНИША
    // ============================================
    loadRaceMarkers() {
        // Показываем стартовый порт (Санлукар-де-Баррамеда)
        const startPort = { lat: 36.78, lng: -6.35, name: 'Санлукар-де-Баррамеда' };

        if (!this.startMarker) {
            this.startMarker = L.marker([startPort.lat, startPort.lng], {
                icon: L.divIcon({
                    className: 'race-marker',
                    html: '🏁 СТАРТ',
                    iconSize: [60, 24],
                    iconAnchor: [30, 12]
                })
            }).addTo(this.map).bindPopup(`🏁 Порт старта: ${startPort.name}`);
        }
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
        const isEliminated = player.isEliminated;

        let statusIcon = '⛵';
        if (isEliminated) statusIcon = '💀';
        else if (player.isGrounded) statusIcon = '⚠️';
        else if (player.isAnchored) statusIcon = '⚓';
        else if (isOffline) statusIcon = '💤';

        const icon = L.divIcon({
            className: 'ship-marker',
            html: `<div style="
                width: 32px; height: 32px;
                background: ${player.color || '#4CAF50'};
                border: 2px solid ${isOffline ? '#666' : '#fff'};
                border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                font-size: 16px;
                opacity: ${isOffline ? 0.5 : 1};
                transform: rotate(${player.heading || 0}deg);
                transition: transform 0.3s;
            ">${statusIcon}</div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });

        if (!this.markers[id]) {
            this.markers[id] = L.marker([player.lat, player.lng], { icon })
                .addTo(this.map)
                .bindPopup(this.createPopup(player));
        } else {
            this.markers[id].setLatLng([player.lat, player.lng]);
            this.markers[id].setPopupContent(this.createPopup(player));
            this.markers[id].setIcon(icon);
        }
         // Создаём попап с информацией о ветре и течении
    const popupContent = this.createPopupWithWeather(player);

    if (!this.markers[id]) {
        this.markers[id] = L.marker([player.lat, player.lng], { icon })
            .addTo(this.map)
            .bindPopup(popupContent, {
                className: 'ship-popup',
                maxWidth: 260
            });
    } else {
        this.markers[id].setLatLng([player.lat, player.lng]);
        this.markers[id].setPopupContent(popupContent);
        this.markers[id].setIcon(icon);
    }
    }

    createPopup(player) {
        let status = '🟢 В пути';
        if (player.isEliminated) status = '💀 Выбыл';
        else if (player.isGrounded) status = '⚠ На мели';
        else if (player.isAnchored) status = '⚓ На якоре';
        else if (!player.isOnline) status = '💤 Офлайн';

        const shipNames = {
            'klip_10': 'Клипер-10',
            'klip_20': 'Клипер-20',
            'klip_30': 'Клипер-30',
            'Columb': 'Колумб',
            'pirat': 'Пират',
            'ap': 'АП',
            '19c_m': '19-й век'
        };

        return `
            <strong>${player.name}</strong><br>
            🚢 ${shipNames[player.shipType] || player.shipType}<br>
            ${status}<br>
            🧭 ${player.heading || 0}° | ⛵ ${(player.speed || 0).toFixed(1)} уз<br>
            📏 ${(player.distanceTraveled || 0).toFixed(0)} км
        `;
    }

    // ============================================
    //  ОБНОВЛЕНИЕ ИНФОРМАЦИИ О КОРАБЛЕ
    // ============================================
    updateShipInfo() {
        if (!this.ship) return;

        document.getElementById('ship-name-display').textContent = this.ship.name || '—';
        document.getElementById('heading-display').textContent = `${this.ship.heading || 0}°`;
        document.getElementById('speed-display').textContent = (this.ship.speed || 0).toFixed(1);
        document.getElementById('sail-display-mini').textContent = `${Math.round((this.ship.sailPosition || 0) * 100)}%`;
        document.getElementById('sail-fill-mini').style.width = `${Math.round((this.ship.sailPosition || 0) * 100)}%`;

        const anchorBtn = document.getElementById('btn-anchor');
        if (this.ship.isAnchored) {
            anchorBtn.classList.add('active');
            anchorBtn.textContent = '⚓ Сняться';
        } else {
            anchorBtn.classList.remove('active');
            anchorBtn.textContent = '⚓ Якорь';
        }

        const helpBtn = document.getElementById('btn-help');
        if (this.ship.isGrounded) {
            helpBtn.classList.add('active');
        } else {
            helpBtn.classList.remove('active');
        }
    }

    // ============================================
    //  УПРАВЛЕНИЕ
    // ============================================
    setupControls() {
        // Клавиатура
        document.addEventListener('keydown', (e) => {
            if (!this.isRacing || !this.socket) return;
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
        document.getElementById('btn-left').onclick = () => {
            if (this.isRacing) this.socket.emit('turn', { delta: -15 });
        };
        document.getElementById('btn-right').onclick = () => {
            if (this.isRacing) this.socket.emit('turn', { delta: 15 });
        };
        document.getElementById('btn-raise').onclick = () => {
            if (this.isRacing) this.socket.emit('sail', { action: 'raise' });
        };
        document.getElementById('btn-lower').onclick = () => {
            if (this.isRacing) this.socket.emit('sail', { action: 'lower' });
        };
        document.getElementById('btn-anchor').onclick = () => {
            if (this.isRacing) {
                this.socket.emit('anchor', {
                    action: this.ship?.isAnchored ? 'weigh' : 'drop'
                });
            }
        };
        document.getElementById('btn-help').onclick = () => {
            if (this.isRacing) this.socket.emit('request_help');
        };
    }

    // ============================================
    //  ЧАТ
    // ============================================
    setupChat() {
        document.getElementById('chat-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && this.socket && this.isRacing) {
                const msg = e.target.value.trim();
                if (msg) {
                    this.socket.emit('chat', { message: msg });
                    e.target.value = '';
                }
            }
        });

        document.getElementById('chat-send').onclick = () => {
            if (!this.isRacing) return;
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
    //  HOME
    // ============================================
    setupHomeButton() {
        document.getElementById('btn-home').onclick = () => {
            if (this.isRacing) {
                if (!confirm('Вы уверены, что хотите выйти из регаты?')) return;
                this.socket.emit('leave_race');
            }

            // Сбрасываем флаги
            this.hasSelectedShip = false;
            this.selectedShip = null;
            this.selectedShipName = null;
            this.isRacing = false;
            this.isSelectingStart = false;

            if (this.startTimeout) {
                clearTimeout(this.startTimeout);
                this.startTimeout = null;
            }
            if (this.startHint) {
                this.map.removeLayer(this.startHint);
                this.startHint = null;
            }

            location.reload();
        };
    }

    // ============================================
    //  ПОГОДА
    // ============================================
    updateWeather() {
        // Обновление погоды для отображения
        if (this.ship) {
            fetch(`/api/wind?lat=${this.ship.lat}&lng=${this.ship.lng}`)
                .then(r => r.json())
                .then(data => {
                    // Можно обновить отображение ветра в HUD
                })
                .catch(() => {});
        }
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
            setTimeout(() => {
                if (div.parentNode) div.remove();
            }, 500);
        }, 4000);
    }
}

// ============================================
//  ЗАПУСК
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const game = new RegattaGame();
    game.init();
});
