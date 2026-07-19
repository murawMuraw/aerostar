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
        this.role = null;
        this.isGuest = false;
        this.shipType = null; // Тип корабля для отображения
    }

    init() {
        this.initMap();
        this.initSocket();
        this.setupShipPanel();
        this.setupControls();
        this.setupChat();
        this.setupUI();
        this.loadShipsState();
        
        // Проверяем, есть ли выбранный корабль
        this.checkSelectedShip();
    }

    initMap() {
        this.map = L.map('map', { center: [20, 0], zoom: 2.5, zoomControl: false });

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; Esri',
            maxZoom: 19
        }).addTo(this.map);

        L.control.zoom({ position: 'bottomright' }).addTo(this.map);

        this.map.on('click', (e) => {
            if (this.isSelectingStart && this.selectedShip && !this.isGuest) {
                this.confirmStart(e.latlng.lat, e.latlng.lng);
            }
        });
    }

    initSocket() {
        this.socket = io({ transports: ['websocket', 'polling'] });

        this.socket.on('connect', () => {
            console.log('✅ Connected');
            // При подключении проверяем, есть ли выбранный корабль
            this.checkSelectedShip();
        });

        this.socket.on('joined', (data) => {
            this.playerId = data.ship.id;
            this.ship = data.ship;
            this.role = data.role;
            this.isGuest = (this.role === 'guest');
            this.shipType = this.ship.shipType;
            
            if (this.isGuest) {
                document.getElementById('guest-message').style.display = 'block';
                document.getElementById('controls-panel').style.display = 'none';
                document.getElementById('chat-input').disabled = true;
                document.getElementById('chat-send').disabled = true;
                this.showNotification('👁 Вы вошли как наблюдатель', 'info');
                this.addChatMessage('👁 Вы наблюдатель', 'system');
            } else {
                document.getElementById('guest-message').style.display = 'none';
                document.getElementById('controls-panel').style.display = 'flex';
                document.getElementById('chat-input').disabled = false;
                document.getElementById('chat-send').disabled = false;
                this.showNotification(`⛵ ${this.ship.name} в море!`, 'success');
                this.addChatMessage(`⛵ ${this.ship.name} в море!`, 'system');
                
                this.isRacing = true;
                this.hasSelectedShip = true;
                
                // Показываем миниатюру корабля в панели
                this.showShipThumbnail(this.ship.shipType);
                
                this.updateShipInfo();
                this.updatePlayers(data.players);
            }
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

    // ============================================
    //  ПРОВЕРКА ВЫБРАННОГО КОРАБЛЯ
    // ============================================
    checkSelectedShip() {
        const selectedShipData = localStorage.getItem('selectedShip');
        if (selectedShipData) {
            try {
                const data = JSON.parse(selectedShipData);
                this.selectedShip = data.shipId;
                this.selectedShipName = data.shipName;
                this.shipType = data.shipId;
                
                // Если есть выбранный корабль, предлагаем стартовать
                if (this.socket && this.socket.connected) {
                    this.autoStartShip();
                }
            } catch (e) {
                console.error('Error parsing selected ship:', e);
            }
        }
    }

    // ============================================
    //  АВТОМАТИЧЕСКИЙ СТАРТ КОРАБЛЯ
    // ============================================
    autoStartShip() {
        if (!this.selectedShip || this.isGuest) return;
        
        // Случайная точка в океане
        const lat = 20 + (Math.random() - 0.5) * 30;
        const lng = (Math.random() - 0.5) * 60;
        
        this.showNotification(`⛵ Запуск ${this.selectedShipName}...`, 'info');
        
        this.socket.emit('join_with_ship', {
            shipId: this.selectedShip,
            shipName: this.selectedShipName,
            lat: lat,
            lng: lng
        });
        
        // Очищаем localStorage после старта
        localStorage.removeItem('selectedShip');
    }

    // ============================================
    //  ОТОБРАЖЕНИЕ МИНИАТЮРЫ КОРАБЛЯ
    // ============================================
    showShipThumbnail(shipType) {
        const panel = document.getElementById('ship-panel');
        // Удаляем старую миниатюру
        const oldThumb = document.getElementById('ship-thumbnail');
        if (oldThumb) oldThumb.remove();
        
        // Создаём новую
        const thumb = document.createElement('div');
        thumb.id = 'ship-thumbnail';
        thumb.style.cssText = `
            width: 60px;
            height: 60px;
            border: 2px solid rgba(74, 158, 255, 0.3);
            border-radius: 12px;
            background: rgba(74, 158, 255, 0.05);
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 8px;
            padding: 8px;
        `;
        
        const img = document.createElement('img');
        img.src = `images/${shipType}.png`;
        img.alt = this.selectedShipName || shipType;
        img.style.cssText = `
            width: 40px;
            height: 40px;
            object-fit: contain;
            filter: brightness(1);
        `;
        img.onerror = () => {
            img.style.display = 'none';
            thumb.innerHTML = '⛵';
            thumb.style.fontSize = '30px';
        };
        
        thumb.appendChild(img);
        
        // Вставляем после кнопки выбора
        const selectBtn = panel.querySelector('.panel-action-btn');
        if (selectBtn) {
            selectBtn.after(thumb);
        } else {
            panel.prepend(thumb);
        }
    }

    setupShipPanel() {
        // В новой версии панель только для выбора корабля
        // Кнопка выбора уже есть в HTML
        const selectBtn = document.getElementById('btn-select-ship');
        if (selectBtn) {
            selectBtn.addEventListener('click', () => {
                window.location.href = '/selection.html';
            });
        }
    }

    selectShip(btn) {
        // Эта функция больше не используется, но оставлена для совместимости
        if (this.isGuest) {
            this.showNotification('👁 Гости не могут выбирать корабль', 'warning');
            return;
        }
        window.location.href = '/selection.html';
    }

    confirmStart(lat, lng) {
        if (this.startHint) { this.map.removeLayer(this.startHint); this.startHint = null; }
        if (this.startTimeout) { clearTimeout(this.startTimeout); this.startTimeout = null; }

        if (this.isGuest) {
            this.showNotification('👁 Гости не могут запускать корабль', 'warning');
            return;
        }
        
        this.socket.emit('join_with_ship', {
            shipId: this.selectedShip,
            shipName: this.selectedShipName,
            lat: lat,
            lng: lng
        });

        this.isSelectingStart = false;
        this.map.getContainer().style.cursor = 'default';
    }

    loadShipsState() {
        fetch('/api/ships/state')
            .then(r => r.json())
            .then(data => {
                // Обновляем состояние в localStorage если нужно
                // (уже не нужно, так как используем localStorage для выбора)
            })
            .catch(err => console.error('Failed to load ships state:', err));
    }

    updatePlayers(players) {
        if (this.ship && this.playerId) {
            if (!this.markers[this.playerId]) {
                const icon = this.createShipIcon(this.ship);
                this.markers[this.playerId] = L.marker([this.ship.lat, this.ship.lng], { icon })
                    .addTo(this.map)
                    .bindPopup(this.createPopup(this.ship));
            } else {
                this.markers[this.playerId].setLatLng([this.ship.lat, this.ship.lng]);
                this.markers[this.playerId].setPopupContent(this.createPopup(this.ship));
                // Обновляем иконку
                const icon = this.createShipIcon(this.ship);
                this.markers[this.playerId].setIcon(icon);
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

    createShipIcon(player) {
        const isOwn = player.id === this.playerId;
        const size = isOwn ? 34 : 28;
        const fontSize = isOwn ? 20 : 14;
        
        // Пытаемся загрузить изображение корабля
        const shipType = player.shipType || 'klip_10';
        const imgUrl = `images/${shipType}.png`;
        
        return L.divIcon({
            className: 'ship-marker',
            html: `<div style="
                width: ${size}px;
                height: ${size}px;
                background: ${isOwn ? 'rgba(74, 158, 255, 0.15)' : 'rgba(255,255,255,0.05)'};
                border: 2px solid ${isOwn ? '#4a9eff' : (player.isOnline ? '#fff' : '#666')};
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: ${fontSize}px;
                box-shadow: ${isOwn ? '0 0 20px rgba(74,158,255,0.3)' : 'none'};
                transform: rotate(${player.heading || 0}deg);
                padding: 4px;
            ">
                <img src="${imgUrl}" style="width:${size-8}px;height:${size-8}px;object-fit:contain;filter:brightness(1);" 
                     onerror="this.style.display='none';this.parentElement.textContent='⛵'">
            </div>`,
            iconSize: [size + 6, size + 6],
            iconAnchor: [(size + 6) / 2, (size + 6) / 2]
        });
    }

    updatePlayer(id, player) {
        const icon = this.createShipIcon(player);

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
            if (!this.isRacing || this.isGuest || !this.socket) return;
            if (document.activeElement?.tagName === 'INPUT') return;

            switch (e.key) {
                case 'ArrowLeft': this.socket.emit('turn', { delta: -15 }); e.preventDefault(); break;
                case 'ArrowRight': this.socket.emit('turn', { delta: 15 }); e.preventDefault(); break;
                case 'ArrowUp': this.socket.emit('sail', { action: 'raise' }); e.preventDefault(); break;
                case 'ArrowDown': this.socket.emit('sail', { action: 'lower' }); e.preventDefault(); break;
                case ' ': this.socket.emit('anchor', { action: this.ship?.isAnchored ? 'weigh' : 'drop' }); e.preventDefault(); break;
            }
        });

        document.getElementById('btn-left').onclick = () => {
            if (!this.isGuest) this.socket.emit('turn', { delta: -15 });
        };
        document.getElementById('btn-right').onclick = () => {
            if (!this.isGuest) this.socket.emit('turn', { delta: 15 });
        };
        document.getElementById('btn-raise').onclick = () => {
            if (!this.isGuest) this.socket.emit('sail', { action: 'raise' });
        };
        document.getElementById('btn-lower').onclick = () => {
            if (!this.isGuest) this.socket.emit('sail', { action: 'lower' });
        };
        document.getElementById('btn-anchor').onclick = () => {
            if (!this.isGuest) {
                this.socket.emit('anchor', { action: this.ship?.isAnchored ? 'weigh' : 'drop' });
            }
        };

        document.getElementById('resetBtn').onclick = () => {
            if (this.isRacing && !this.isGuest && confirm('Сбросить корабль?')) {
                this.socket.emit('leave_race');
                localStorage.removeItem('selectedShip');
                location.reload();
            }
        };
    }

    setupChat() {
        document.getElementById('chat-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && this.socket && this.isRacing && !this.isGuest) {
                const msg = e.target.value.trim();
                if (msg) { this.socket.emit('chat', { message: msg }); e.target.value = ''; }
            }
        });

        document.getElementById('chat-send').onclick = () => {
            if (!this.isRacing || this.isGuest) return;
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
        // Чат
        document.getElementById('chat-toggle').onclick = () => {
            const chat = document.getElementById('chat');
            const messages = document.getElementById('chat-messages');
            const inputArea = document.getElementById('chat-input-area');
            if (chat.style.height === '40px') {
                chat.style.height = '300px';
                messages.style.display = 'block';
                inputArea.style.display = 'flex';
            } else {
                chat.style.height = '40px';
                messages.style.display = 'none';
                inputArea.style.display = 'none';
            }
        };
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
