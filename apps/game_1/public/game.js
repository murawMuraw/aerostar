// public/game.js

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
        this.startHint = null;
        this.startTimeout = null;
        this.lastState = null;
    }

    init() {
        this.role = null; // 'guest' или 'player'
        this.initMap();
        this.initSocket();
        this.setupShipPanel();
        this.setupControls();
        this.setupChat();
        this.setupUI();
        this.loadShipsState();
    }

    initMap() {
        this.map = L.map('map', { center: [20, 0], zoom: 2.5, zoomControl: false });

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; Esri',
            maxZoom: 19
        }).addTo(this.map);

        L.control.zoom({ position: 'bottomright' }).addTo(this.map);

        this.map.on('click', (e) => {
            if (this.isSelectingStart && this.selectedShip) {
                this.confirmStart(e.latlng.lat, e.latlng.lng);
            }
        });
    }

    initSocket() {
        this.socket = io({ transports: ['websocket', 'polling'] });

        this.socket.on('connect', () => console.log('✅ Connected'));

        this.socket.on('joined', (data) => {
            this.playerId = data.ship.id;
            this.ship = data.ship;
            this.role = data.role; // 'guest' или 'player'
            if (this.role === 'guest') {
        // Гость — только наблюдение
        document.getElementById('guest-message').style.display = 'block';
        document.getElementById('player-ships').style.display = 'none';
        document.getElementById('controls-panel').style.display = 'none';
        document.getElementById('chat-input').disabled = true;
        document.getElementById('chat-send').disabled = true;
        document.getElementById('startBtn').disabled = true;
        document.getElementById('hint').textContent = '👁 Вы наблюдатель';
        this.showNotification('👁 Вы вошли как наблюдатель', 'info');
    } else {
        // Игрок — полное управление
        document.getElementById('guest-message').style.display = 'none';
        document.getElementById('player-ships').style.display = 'flex';
        document.getElementById('controls-panel').style.display = 'flex';
        document.getElementById('chat-input').disabled = false;
        document.getElementById('chat-send').disabled = false;
        document.getElementById('hint').textContent = '⛵ Корабль в море!';
        this.showNotification('⛵ Вы управляете кораблём!', 'success');
    }
            this.updatePlayers(data.players);
            this.isRacing = true;
            this.hasSelectedShip = true;

            document.getElementById('controls-panel').style.display = 'flex';
            document.getElementById('chat-input').disabled = false;
            document.getElementById('chat-send').disabled = false;

            document.querySelectorAll('.ship-btn').forEach(b => {
                b.style.opacity = '0.3';
                b.style.cursor = 'not-allowed';
                b.style.pointerEvents = 'none';
            });

            const btn = document.querySelector(`.ship-btn[data-ship="${this.selectedShip}"]`);
            if (btn) {
                btn.classList.add('taken');
                btn.querySelector('.status-dot').className = 'status-dot taken';
            }

            document.getElementById('startBtn').disabled = true;
            document.getElementById('hint').textContent = '⛵ Корабль в море!';

            this.updateShipInfo();
            this.updatePlayers(data.players);
            this.showNotification('⛵ Корабль в море!', 'success');
        });

        this.socket.on('state', (data) => {
            this.lastState = data;
            this.updatePlayers(data.players);
            if (this.ship && data.players[this.playerId]) {
                this.ship = data.players[this.playerId];
                this.updateShipInfo();
            }
        });

        this.socket.on('player_joined', (data) => {
            this.addChatMessage(`🚢 ${data.name} присоединился`, 'system');
        });

        this.socket.on('player_left', (data) => {
            if (data.isOffline) {
                this.addChatMessage(`💤 ${data.name} вышел (корабль в пути)`, 'system');
            }
        });

        this.socket.on('ship_grounded', (data) => {
            this.showNotification(`⚠️ ${data.name} на мели!`, 'danger');
            this.addChatMessage(`⚠️ ${data.name} на мели!`, 'danger');
        });

        this.socket.on('ship_anchored', (data) => {
            this.addChatMessage(`⚓ ${data.name} на якоре`, 'system');
        });

        this.socket.on('action_result', (data) => {
            if (!data.success) {
                this.showNotification(`❌ ${data.message}`, 'warning');
            }
        });

        this.socket.on('chat', (data) => {
            this.addChatMessage(`⛵ ${data.name}: ${data.message}`, 'user');
        });

        this.socket.on('join_error', (data) => {
            this.showNotification(`❌ ${data.message}`, 'danger');
            this.hasSelectedShip = false;
            this.isSelectingStart = false;
            this.map.getContainer().style.cursor = 'default';
            this.loadShipsState();
        });
    }

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
            this.showNotification('🚫 Этот корабль занят', 'warning');
            return;
        }

        document.querySelectorAll('.ship-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedShip = btn.dataset.ship;
        this.selectedShipName = btn.dataset.name;
        this.hasSelectedShip = true;

        document.querySelectorAll('.ship-btn').forEach(b => {
            if (b !== btn) {
                b.style.opacity = '0.3';
                b.style.cursor = 'not-allowed';
                b.style.pointerEvents = 'none';
            }
        });

        this.isSelectingStart = true;
        this.map.getContainer().style.cursor = 'crosshair';
        document.getElementById('hint').textContent = '📍 Кликните по карте для старта';
        document.getElementById('startBtn').disabled = false;
        this.showNotification('📍 Кликните по карте для старта', 'info');

        if (this.startHint) this.map.removeLayer(this.startHint);
        this.startHint = L.popup()
            .setLatLng([this.map.getCenter().lat, this.map.getCenter().lng])
            .setContent('📍 <b>Кликните по карте</b>')
            .openOn(this.map);

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
                document.getElementById('hint').textContent = '👆 Выберите корабль, затем кликните на карту';
                document.getElementById('startBtn').disabled = true;
                this.showNotification('⏰ Время истекло', 'warning');
            }
        }, 30000);
    }

    confirmStart(lat, lng) {
        if (this.startHint) { this.map.removeLayer(this.startHint); this.startHint = null; }
        if (this.startTimeout) { clearTimeout(this.startTimeout); this.startTimeout = null; }

        this.socket.emit('join_with_ship', {
            shipId: this.selectedShip,
            shipName: this.selectedShipName,
            lat: lat,
            lng: lng
        });

        this.isSelectingStart = false;
        this.map.getContainer().style.cursor = 'default';
        document.getElementById('hint').textContent = '⏳ Запуск...';
    }

    loadShipsState() {
        fetch('/api/ships/state')
            .then(r => r.json())
            .then(data => {
                document.querySelectorAll('.ship-btn').forEach(btn => {
                    const state = data[btn.dataset.ship];
                    if (state && state.taken) {
                        btn.classList.add('taken');
                        btn.style.opacity = '0.3';
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
            });
    }

    updatePlayers(players) {
        if (this.ship && this.playerId) {
            if (!this.markers[this.playerId]) {
                const icon = L.divIcon({
                    className: 'ship-marker',
                    html: `<div style="
                        width: 30px; height: 30px;
                        background: ${this.ship.color || '#4CAF50'};
                        border: 2px solid #fff;
                        border-radius: 50%;
                        display: flex; align-items: center; justify-content: center;
                        font-size: 16px;
                        box-shadow: 0 0 15px rgba(74,158,255,0.3);
                        transform: rotate(${this.ship.heading || 0}deg);
                    ">⛵</div>`,
                    iconSize: [34, 34],
                    iconAnchor: [17, 17]
                });
                this.markers[this.playerId] = L.marker([this.ship.lat, this.ship.lng], { icon })
                    .addTo(this.map)
                    .bindPopup(this.createPopup(this.ship));
            } else {
                this.markers[this.playerId].setLatLng([this.ship.lat, this.ship.lng]);
                this.markers[this.playerId].setPopupContent(this.createPopup(this.ship));
            }
        }

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
        const statusIcon = player.isEliminated ? '💀' :
                          player.isGrounded ? '⚠️' :
                          player.isAnchored ? '⚓' :
                          !player.isOnline ? '💤' : '⛵';

        const icon = L.divIcon({
            className: 'ship-marker',
            html: `<div style="
                width: 28px; height: 28px;
                background: ${player.color || '#4CAF50'};
                border: 2px solid ${player.isOnline ? '#fff' : '#666'};
                border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                font-size: 14px;
                opacity: ${player.isOnline ? 1 : 0.4};
                transform: rotate(${player.heading || 0}deg);
            ">${statusIcon}</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
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
    }

    createPopup(player) {
        const shipNames = {
            'klip_10': 'Клипер-10',
            'klip_20': 'Клипер-20',
            'klip_30': 'Клипер-30',
            'columb': 'Колумб',
            'pirat': 'Пират',
            'ap': 'АП',
            '19c_m': '19-й век'
        };

        let status = '🟢 В пути';
        if (player.isEliminated) status = '💀 Выбыл';
        else if (player.isGrounded) status = '⚠ На мели';
        else if (player.isAnchored) status = '⚓ На якоре';
        else if (!player.isOnline) status = '💤 Офлайн';

        return `
            <strong>${player.name}</strong><br>
            🚢 ${shipNames[player.shipType] || player.shipType}<br>
            ${status}<br>
            🧭 ${player.heading || 0}° | ⛵ ${(player.speed || 0).toFixed(1)} уз<br>
            📏 ${(player.distanceTraveled || 0).toFixed(0)} км
        `;
    }

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
    }

    setupControls() {
        document.addEventListener('keydown', (e) => {
            if (!this.isRacing || !this.socket) return;
            if (document.activeElement?.tagName === 'INPUT') return;

            switch (e.key) {
                case 'ArrowLeft': this.socket.emit('turn', { delta: -15 }); e.preventDefault(); break;
                case 'ArrowRight': this.socket.emit('turn', { delta: 15 }); e.preventDefault(); break;
                case 'ArrowUp': this.socket.emit('sail', { action: 'raise' }); e.preventDefault(); break;
                case 'ArrowDown': this.socket.emit('sail', { action: 'lower' }); e.preventDefault(); break;
                case ' ': this.socket.emit('anchor', { action: this.ship?.isAnchored ? 'weigh' : 'drop' }); e.preventDefault(); break;
            }
        });

        document.getElementById('btn-left').onclick = () => this.socket.emit('turn', { delta: -15 });
        document.getElementById('btn-right').onclick = () => this.socket.emit('turn', { delta: 15 });
        document.getElementById('btn-raise').onclick = () => this.socket.emit('sail', { action: 'raise' });
        document.getElementById('btn-lower').onclick = () => this.socket.emit('sail', { action: 'lower' });
        document.getElementById('btn-anchor').onclick = () => {
            this.socket.emit('anchor', { action: this.ship?.isAnchored ? 'weigh' : 'drop' });
        };

        document.getElementById('resetBtn').onclick = () => {
            if (this.isRacing && confirm('Сбросить корабль?')) {
                this.socket.emit('leave_race');
                location.reload();
            }
        };

        document.getElementById('startBtn').onclick = () => {
            if (this.selectedShip && this.isSelectingStart) {
                this.map.getContainer().style.cursor = 'crosshair';
                document.getElementById('hint').textContent = '📍 Кликните по карте для старта';
                this.showNotification('📍 Кликните по карте для старта', 'info');
            }
        };
    }

    setupChat() {
        document.getElementById('chat-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && this.socket && this.isRacing) {
                const msg = e.target.value.trim();
                if (msg) { this.socket.emit('chat', { message: msg }); e.target.value = ''; }
            }
        });

        document.getElementById('chat-send').onclick = () => {
            if (!this.isRacing) return;
            const input = document.getElementById('chat-input');
            const msg = input.value.trim();
            if (msg && this.socket) { this.socket.emit('chat', { message: msg }); input.value = ''; }
        };
    }

    addChatMessage(text, type = 'user') {
        const div = document.createElement('div');
        div.className = `chat-${type}`;
        div.textContent = text;
        this.chatMessages.appendChild(div);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    setupUI() {
        // Профиль
        document.getElementById('profileButton').addEventListener('click', () => {
            const modal = document.getElementById('authModal');
            modal.classList.toggle('visible');
            modal.classList.toggle('hidden');
        });

        // Авторизация
        document.getElementById('continueGuestBtn').addEventListener('click', () => {
            document.getElementById('authModal').classList.add('hidden');
            document.getElementById('authModal').classList.remove('visible');
        });

        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const target = tab.dataset.tab;
                document.getElementById('loginForm').classList.toggle('hidden', target !== 'login');
                document.getElementById('registerForm').classList.toggle('hidden', target !== 'register');
            });
        });
    }

    showNotification(message, type = 'info') {
        const div = document.createElement('div');
        div.className = `notification ${type}`;
        div.textContent = message;
        const container = document.getElementById('notifications') || document.body;
        container.appendChild(div);
        setTimeout(() => {
            div.style.opacity = '0';
            div.style.transition = 'opacity 0.5s';
            setTimeout(() => div.remove(), 500);
        }, 3500);
    }
}

// ============================================
//  ЗАПУСК
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const game = new RegattaGame();
    game.init();
});
