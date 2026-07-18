// game.js — новая концепция

class RegattaGame {
    constructor() {
        this.map = null;
        this.socket = null;
        this.playerId = null;
        this.ship = null;
        this.markers = {};
        this.selectedShip = null;
        this.selectedStart = null;
        this.isRacing = false;
        this.chatMessages = document.getElementById('chat-messages');
        this.notifications = document.getElementById('notifications');
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
        this.setupStartModal();

        // Загружаем состояние кораблей
        this.loadShipsState();

        // Обновляем погоду каждые 30 секунд
        setInterval(() => this.updateWeather(), 30000);
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

        // Показываем маркеры старта/финиша если есть
        this.loadRaceMarkers();
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
            this.updateStatus('connected');
        });

        this.socket.on('disconnect', () => {
            console.log('❌ Socket disconnected');
            this.updateStatus('disconnected');
        });

        // Состояние игры
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

        // Чат
        this.socket.on('chat', (data) => {
            const prefix = data.isGuest ? '👁' : '⛵';
            this.addChatMessage(`${prefix} ${data.name}: ${data.message}`, 'user');
        });

        // Сообщения от админа
        this.socket.on('admin_message', (data) => {
            this.showAdminMessage(data.text);
        });

        // Результаты действий
        this.socket.on('action_result', (data) => {
            if (!data.success) {
                this.showNotification(`❌ ${data.message}`, 'warning');
            }
        });

        // Ошибки
        this.socket.on('join_error', (data) => {
            this.showNotification(`❌ ${data.message}`, 'danger');
        });

        // События кораблей
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
            // Обновляем панель кораблей
            this.loadShipsState();
        });

        this.socket.on('help_requested', (data) => {
            this.showNotification(`🆘 ${data.name} просит помощи!`, 'warning');
            this.addChatMessage(`🆘 ${data.name} просит помощи!`, 'danger');
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
        // Если корабль занят — игнорируем
        if (btn.classList.contains('taken')) {
            this.showNotification('🚫 Этот корабль уже занят', 'warning');
            return;
        }

        // Если уже выбран этот корабль — снимаем выбор
        if (btn.classList.contains('selected')) {
            btn.classList.remove('selected');
            this.selectedShip = null;
            document.getElementById('controls-panel').style.display = 'none';
            return;
        }

        // Снимаем выделение с других
        document.querySelectorAll('.ship-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedShip = btn.dataset.ship;
        this.selectedShipName = btn.dataset.name;

        // Показываем модалку выбора старта
        this.showStartModal(btn.dataset.name);
    }

    // ============================================
    //  МОДАЛКА ВЫБОРА СТАРТА
    // ============================================
    setupStartModal() {
        document.getElementById('btn-cancel-start').onclick = () => {
            this.closeStartModal();
        };

        document.getElementById('btn-confirm-start').onclick = () => {
            this.confirmStart();
        };
    }

    showStartModal(shipName) {
        const modal = document.getElementById('start-modal');
        document.getElementById('start-modal-ship').innerHTML = `Корабль: <strong>${shipName}</strong>`;
        modal.classList.add('active');

        // Загружаем точки старта
        const list = document.getElementById('start-points-list');
        list.innerHTML = '';

        const startPoints = [
            { id: 'sp1', name: 'Порт Ливерпуль', lat: 53.4, lng: -3.0 },
            { id: 'sp2', name: 'Порт Саутгемптон', lat: 50.9, lng: -1.4 },
            { id: 'sp3', name: 'Порт Брест', lat: 48.4, lng: -4.5 },
            { id: 'sp4', name: 'Порт Нью-Йорк', lat: 40.7, lng: -74.0 },
            { id: 'sp5', name: 'Порт Гавр', lat: 49.5, lng: 0.1 },
            { id: 'sp6', name: 'Порт Роттердам', lat: 51.9, lng: 4.5 }
        ];

        startPoints.forEach(point => {
            const btn = document.createElement('button');
            btn.className = 'start-point-btn';
            btn.innerHTML = `
                <div>📍 ${point.name}</div>
                <div class="coords">${point.lat.toFixed(2)}°, ${point.lng.toFixed(2)}°</div>
            `;
            btn.dataset.pointId = point.id;
            btn.onclick = () => {
                document.querySelectorAll('.start-point-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.selectedStart = point;
                document.getElementById('btn-confirm-start').disabled = false;
            };
            list.appendChild(btn);
        });
    }

    closeStartModal() {
        document.getElementById('start-modal').classList.remove('active');
        document.querySelectorAll('.ship-btn').forEach(b => b.classList.remove('selected'));
        this.selectedShip = null;
        this.selectedStart = null;
        document.getElementById('btn-confirm-start').disabled = true;
    }

    confirmStart() {
        if (!this.selectedShip || !this.selectedStart) {
            this.showNotification('❌ Выберите корабль и точку старта', 'warning');
            return;
        }

        // Отправляем на сервер
        this.socket.emit('join_with_ship', {
            shipId: this.selectedShip,
            shipName: this.selectedShipName,
            startPoint: this.selectedStart
        });

        // Закрываем модалку
        document.getElementById('start-modal').classList.remove('active');

        // Показываем панель управления
        document.getElementById('controls-panel').style.display = 'flex';
        document.getElementById('chat-input').disabled = false;
        document.getElementById('chat-send').disabled = false;

        // Блокируем кнопку корабля
        const shipBtn = document.querySelector(`.ship-btn[data-ship="${this.selectedShip}"]`);
        if (shipBtn) {
            shipBtn.classList.add('taken');
            shipBtn.querySelector('.status-dot').className = 'status-dot racing';
        }

        this.isRacing = true;
        this.showNotification('🚀 Вы присоединились к гонке!', 'success');
        this.addChatMessage(`🚀 ${this.selectedShipName} вышел в море!`, 'system');
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
                        btn.querySelector('.status-dot').className = 'status-dot racing';
                    } else {
                        btn.classList.remove('taken');
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
        fetch('/api/admin/race')
            .then(r => r.json())
            .then(data => {
                if (data && data.startLat && data.startLng) {
                    L.marker([data.startLat, data.startLng], {
                        icon: L.divIcon({
                            className: 'race-marker',
                            html: '🏁 СТАРТ',
                            iconSize: [60, 24],
                            iconAnchor: [30, 12]
                        })
                    }).addTo(this.map).bindPopup(`🏁 Старт: ${data.startName || ''}`);
                }
                if (data && data.finishLat && data.finishLng) {
                    L.marker([data.finishLat, data.finishLng], {
                        icon: L.divIcon({
                            className: 'race-marker',
                            html: '🎯 ФИНИШ',
                            iconSize: [60, 24],
                            iconAnchor: [30, 12]
                        })
                    }).addTo(this.map).bindPopup(`🎯 Финиш: ${data.finishName || ''}`);
                }
            })
            .catch(() => {});
    }

    // ============================================
    //  ОБНОВЛЕНИЕ ИГРОКОВ
    // ============================================
    updatePlayers(players) {
        for (const [id, player] of Object.entries(players)) {
            if (id === this.playerId) continue;
            this.updatePlayer(id, player);
        }

        for (const [id, marker] of Object.entries(this.markers)) {
            if (id !== this.playerId && !players[id]) {
                this.map.removeLayer(marker);
                delete this.markers[id];
            }
        }
    }

    updatePlayer(id, player) {
        if (!this.markers[id]) {
            const icon = L.divIcon({
                className: 'ship-marker',
                html: `<div style="
                    width: 28px; height: 28px;
                    background: ${player.color || '#4CAF50'};
                    border: 2px solid ${player.isOnline ? '#fff' : '#666'};
                    border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 14px;
                    opacity: ${player.isOnline ? 1 : 0.5};
                ">⛵</div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });

            this.markers[id] = L.marker([player.lat, player.lng], { icon })
                .addTo(this.map)
                .bindPopup(this.createPopup(player));
        } else {
            this.markers[id].setLatLng([player.lat, player.lng]);
            this.markers[id].setPopupContent(this.createPopup(player));
        }
    }

    createPopup(player) {
        let status = '🟢 В пути';
        if (player.isEliminated) status = '💀 Выбыл';
        else if (player.isGrounded) status = '⚠ На мели';
        else if (player.isAnchored) status = '⚓ На якоре';
        else if (!player.isOnline) status = '💤 Офлайн';

        return `
            <strong>${player.name}</strong><br>
            ${status}<br>
            🧭 ${player.heading || 0}° | ⛵ ${(player.speed || 0).toFixed(1)} уз<br>
            📏 ${(player.distanceTraveled || 0).toFixed(0)} км
        `;
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
        } else {
            anchorBtn.classList.remove('active');
        }

        const helpBtn = document.getElementById('btn-help');
        if (this.ship.isGrounded) {
            helpBtn.classList.add('active');
        } else {
            helpBtn.classList.remove('active');
        }
    }

    // ============================================
    //  ПОГОДА
    // ============================================
    updateWeather() {
        // Можно добавить отображение погоды
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

    showAdminMessage(text) {
        const div = document.createElement('div');
        div.className = 'chat-admin';
        div.textContent = `📢 ${text}`;
        this.chatMessages.prepend(div);
        this.showNotification(`📢 ${text}`, 'info');

        setTimeout(() => {
            if (div.parentNode) {
                div.style.transition = 'opacity 0.5s';
                div.style.opacity = '0';
                setTimeout(() => div.remove(), 500);
            }
        }, 30000);
    }

    // ============================================
    //  HOME
    // ============================================
    setupHomeButton() {
        document.getElementById('btn-home').onclick = () => {
            if (this.isRacing) {
                if (!confirm('Вы уверены, что хотите выйти из гонки?')) return;
                this.socket.emit('leave_race');
            }
            location.reload();
        };
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

    updateStatus(status) {
        // Можно обновить статус в UI
    }
}

// ============================================
//  ЗАПУСК
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const game = new RegattaGame();
    game.init();
});
