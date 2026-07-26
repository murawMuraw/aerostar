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
        this.isSelectingFinish = false;
        this.chatMessages = document.getElementById('chat-messages');
        this.startHint = null;
        this.finishHint = null;
        this.startTimeout = null;
        this.lastState = null;
        this.role = null;
        this.isGuest = false;
        this.shipType = null;
        this.markerUpdateTimeout = null;
        this.playerName = null;
        this.lastWind = null;
        this.lastCurrent = null;
        this.finishMarker = null;
        this.startMarker = null;
        
        // Race condition fixes
        this.isStarting = false;
        this.startAttempts = 0;
        this.maxStartAttempts = 3;
        this.startTimer = null;
        this.confirmationTimer = null;
    }

    init() {
        this.initMap();
        this.initSocket();
        this.setupShipPanel();
        this.setupControls();
        this.setupChat();
        this.setupUI();
        this.loadShipsState();
        this.checkSelectedShip();
    }

    // ============================================
    //  MAP INITIALIZATION
    // ============================================
    initMap() {
        this.map = L.map('map', { 
            center: [20, 0], 
            zoom: 2.5, 
            zoomControl: false,
            maxZoom: 19,
            minZoom: 2
        });

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; Esri',
            maxZoom: 19
        }).addTo(this.map);

        L.control.zoom({ position: 'bottomright' }).addTo(this.map);

        this.map.on('zoomend', () => {
            this.updateAllMarkers();
        });

        this.map.on('click', (e) => {
            const lat = e.latlng.lat;
            const lng = e.latlng.lng;
            
            if (this.isSelectingStart && this.selectedShip && !this.isGuest) {
                this.confirmStart(lat, lng);
            } else if (this.isSelectingFinish && this.ship && !this.isGuest) {
                this.confirmFinish(lat, lng);
            }
        });
    }

    // ============================================
    //  SHIP SIZE DEPENDING ON ZOOM LEVEL (2x LARGER)
    // ============================================
    getShipSize(zoom, isOwn) {
        let baseSize;
        if (zoom >= 11) baseSize = 42;
        else if (zoom >= 8) baseSize = 34;
        else if (zoom >= 5) baseSize = 26;
        else if (zoom >= 3) baseSize = 20;
        else baseSize = 16;
        
        baseSize = baseSize * 2;
        const size = isOwn ? Math.round(baseSize * 1.3) : baseSize;
        return Math.max(24, Math.min(120, size));
    }

    // ============================================
    //  CLEAN SHIP MARKER - NO CIRCLES
    // ============================================
    createShipIcon(player) {
        const isOwn = player.id === this.playerId;
        const zoom = this.map.getZoom();
        const size = this.getShipSize(zoom, isOwn);
        const shipType = player.shipType || 'klip_10';
        const imgUrl = `images/${shipType}.png`;
        
        if (isOwn) {
            return L.divIcon({
                className: 'ship-marker own',
                html: `<div style="
                    width: ${size}px;
                    height: ${size}px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    filter: drop-shadow(0 0 20px rgba(74,158,255,0.6));
                    transform: rotate(${player.heading || 0}deg);
                    transition: transform 0.3s ease;
                ">
                    <img src="${imgUrl}" style="
                        width: ${size}px;
                        height: ${size}px;
                        object-fit: contain;
                    " onerror="this.style.display='none';this.parentElement.innerHTML='<span style=\\'font-size:'${Math.round(size*0.75)}'px;color:#4a9eff;\\'>⛵</span>'">
                </div>`,
                iconSize: [size, size],
                iconAnchor: [size/2, size/2]
            });
        }
        
        const opacity = player.isOnline ? 0.85 : 0.3;
        const statusIcon = player.isEliminated ? '💀' :
                          player.isFinished ? '🏁' :
                          player.isGrounded ? '⚠️' :
                          player.isAnchored ? '⚓' : '';
        
        return L.divIcon({
            className: 'ship-marker other',
            html: `<div style="
                width: ${size}px;
                height: ${size}px;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                transform: rotate(${player.heading || 0}deg);
                transition: transform 0.3s ease;
            ">
                <img src="${imgUrl}" style="
                    width: ${size}px;
                    height: ${size}px;
                    object-fit: contain;
                    opacity: ${opacity};
                    filter: drop-shadow(0 0 8px rgba(0,0,0,0.3));
                " onerror="this.style.display='none';this.parentElement.innerHTML='<span style=\\'font-size:'${Math.round(size*0.6)}'px;color:#8899aa;\\'>⛵</span>'">
                ${statusIcon ? `<span style="position:absolute;top:-${Math.round(size*0.3)}px;right:-${Math.round(size*0.3)}px;font-size:${Math.round(size*0.4)}px;text-shadow:0 0 4px rgba(0,0,0,0.8);">${statusIcon}</span>` : ''}
            </div>`,
            iconSize: [size, size],
            iconAnchor: [size/2, size/2]
        });
    }

    // ============================================
    //  UPDATE ALL MARKERS
    // ============================================
    updateAllMarkers() {
        if (this.markerUpdateTimeout) {
            clearTimeout(this.markerUpdateTimeout);
        }
        
        this.markerUpdateTimeout = setTimeout(() => {
            if (this.ship && this.playerId && this.markers[this.playerId]) {
                const icon = this.createShipIcon(this.ship);
                this.markers[this.playerId].setIcon(icon);
            }
            
            if (this.lastState && this.lastState.players) {
                for (const [id, player] of Object.entries(this.lastState.players)) {
                    if (id !== this.playerId && this.markers[id]) {
                        const icon = this.createShipIcon(player);
                        this.markers[id].setIcon(icon);
                    }
                }
            }
            this.markerUpdateTimeout = null;
        }, 100);
    }

    // ============================================
    //  UPDATE COMPASS
    // ============================================
    updateCompass(windDirection, currentDirection) {
        const windArrow = document.getElementById('windArrow');
        const currentArrow = document.getElementById('currentArrow');
        
        if (windArrow) {
            windArrow.style.transform = `translate(-50%, -50%) rotate(${windDirection || 0}deg)`;
        }
        
        if (currentArrow) {
            currentArrow.style.transform = `translate(-50%, -50%) rotate(${currentDirection || 0}deg)`;
        }
    }

    // ============================================
    //  CHECK SELECTED SHIP
    // ============================================
    checkSelectedShip() {
        const selectedShipData = localStorage.getItem('selectedShip');
        if (selectedShipData) {
            try {
                const data = JSON.parse(selectedShipData);
                
                if (!data.confirmed) {
                    console.log('⚠️ Selection not confirmed, waiting...');
                    this.waitForConfirmation();
                    return;
                }
                
                if (data.timestamp && (Date.now() - data.timestamp) > 30000) {
                    console.log('⏰ Selection data too old, clearing...');
                    localStorage.removeItem('selectedShip');
                    return;
                }
                
                this.selectedShip = data.shipId;
                this.selectedShipName = data.shipName;
                this.shipType = data.shipId;
                this.playerName = data.shipName;
                
                console.log('📦 Loaded confirmed ship:', this.selectedShip, this.selectedShipName);
                
                if (this.socket && this.socket.connected) {
                    this.autoStartShip();
                }
            } catch (e) {
                console.error('Error parsing selected ship:', e);
                localStorage.removeItem('selectedShip');
            }
        }
    }

    // ============================================
    //  WAIT FOR CONFIRMATION
    // ============================================
    waitForConfirmation() {
        let attempts = 0;
        const maxAttempts = 20;
        
        if (this.confirmationTimer) {
            clearInterval(this.confirmationTimer);
        }
        
        this.confirmationTimer = setInterval(() => {
            attempts++;
            const data = localStorage.getItem('selectedShip');
            if (data) {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.confirmed) {
                        clearInterval(this.confirmationTimer);
                        this.confirmationTimer = null;
                        console.log('✅ Confirmation received, proceeding...');
                        this.checkSelectedShip();
                        return;
                    }
                } catch (e) {}
            }
            
            if (attempts >= maxAttempts) {
                clearInterval(this.confirmationTimer);
                this.confirmationTimer = null;
                console.log('⚠️ Confirmation timeout, clearing...');
                localStorage.removeItem('selectedShip');
                this.showNotification('❌ Ship selection timeout, please try again', 'danger');
                this.isStarting = false;
                this.startAttempts = 0;
            }
        }, 500);
    }

    // ============================================
    //  AUTO START SHIP
    // ============================================
    autoStartShip() {
        if (!this.selectedShip || this.isGuest) {
            console.log('❌ No ship selected or is guest');
            return;
        }
        
        if (this.isRacing) {
            console.log('⚠️ Ship already racing');
            return;
        }
        
        if (this.isStarting) {
            console.log('⚠️ Start already in progress');
            return;
        }
        
        if (this.startAttempts >= this.maxStartAttempts) {
            console.log('❌ Max start attempts reached');
            this.showNotification('❌ Failed to start ship, please refresh', 'danger');
            localStorage.removeItem('selectedShip');
            return;
        }
        
        this.isStarting = true;
        this.startAttempts++;
        
        // Start selection mode
        this.isSelectingStart = true;
        this.map.getContainer().style.cursor = 'crosshair';
        this.showNotification('📍 Click on the map to choose START point (ocean only!)', 'info');
        this.addChatMessage('📍 Click on the map to choose START point', 'system');
        
        // Clear any existing start hint
        if (this.startHint) {
            this.map.removeLayer(this.startHint);
            this.startHint = null;
        }
        
        // Show hint on map
        this.startHint = L.popup()
            .setLatLng([this.map.getCenter().lat, this.map.getCenter().lng])
            .setContent('📍 <b>Click on the ocean</b> to set start point')
            .openOn(this.map);
        
        // Timeout for start selection
        this.startTimeout = setTimeout(() => {
            if (this.isSelectingStart) {
                this.isSelectingStart = false;
                this.map.getContainer().style.cursor = 'default';
                this.isStarting = false;
                if (this.startHint) {
                    this.map.removeLayer(this.startHint);
                    this.startHint = null;
                }
                this.showNotification('⏰ Start selection timeout, please try again', 'warning');
                localStorage.removeItem('selectedShip');
            }
        }, 60000); // 60 seconds to choose start
    }

    // ============================================
    //  CONFIRM START
    // ============================================
    confirmStart(lat, lng) {
        // Check if on land
        if (this.isOnLand(lat, lng)) {
            this.showNotification('❌ Cannot start on land! Click on the ocean', 'danger');
            return;
        }

        if (this.startHint) {
            this.map.removeLayer(this.startHint);
            this.startHint = null;
        }
        if (this.startTimeout) {
            clearTimeout(this.startTimeout);
            this.startTimeout = null;
        }

        if (this.isGuest) {
            this.showNotification('👁 Spectators cannot start a ship', 'warning');
            return;
        }

        // Show start marker
        if (this.startMarker) {
            this.map.removeLayer(this.startMarker);
        }
        this.startMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'start-marker',
                html: '🚩',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            })
        }).addTo(this.map)
          .bindPopup('🏁 START');

        this.showNotification(`✅ Start point set at ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
        this.addChatMessage(`📍 Start point set`, 'system');

        // Now ask for finish point
        this.isSelectingStart = false;
        this.isSelectingFinish = true;
        this.map.getContainer().style.cursor = 'crosshair';
        this.showNotification('📍 Click on the map to choose FINISH point (ocean only!)', 'info');
        this.addChatMessage('📍 Click on the map to choose FINISH point', 'system');

        // Show finish hint
        if (this.finishHint) {
            this.map.removeLayer(this.finishHint);
        }
        this.finishHint = L.popup()
            .setLatLng([this.map.getCenter().lat, this.map.getCenter().lng])
            .setContent('🏁 <b>Click on the ocean</b> to set finish point')
            .openOn(this.map);

        // Send start point to server
        this.socket.emit('join_with_ship', {
            shipId: this.selectedShip,
            shipName: this.selectedShipName,
            lat: lat,
            lng: lng
        });

        this.isStarting = false;
        this.map.getContainer().style.cursor = 'default';
    }

    // ============================================
    //  CONFIRM FINISH
    // ============================================
    confirmFinish(lat, lng) {
        if (this.isOnLand(lat, lng)) {
            this.showNotification('❌ Finish point cannot be on land! Click on the ocean', 'danger');
            return;
        }

        if (this.finishHint) {
            this.map.removeLayer(this.finishHint);
            this.finishHint = null;
        }

        // Show finish marker
        if (this.finishMarker) {
            this.map.removeLayer(this.finishMarker);
        }
        this.finishMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'finish-marker',
                html: '🏁',
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            })
        }).addTo(this.map)
          .bindPopup('🏁 FINISH');

        this.showNotification(`✅ Finish point set at ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
        this.addChatMessage(`🏁 Finish point set`, 'system');

        this.isSelectingFinish = false;
        this.map.getContainer().style.cursor = 'default';

        // Send finish point to server
        this.socket.emit('set_finish', { lat, lng });

        // Remove start selection from localStorage
        localStorage.removeItem('selectedShip');
    }

    // ============================================
    //  CHECK IF ON LAND
    // ============================================
    isOnLand(lat, lng) {
        const landMasses = [
            { latMin: 36, latMax: 70, lngMin: -10, lngMax: 40 },
            { latMin: -35, latMax: 37, lngMin: -20, lngMax: 50 },
            { latMin: 25, latMax: 70, lngMin: -130, lngMax: -60 },
            { latMin: -55, latMax: 12, lngMin: -80, lngMax: -35 },
            { latMin: 10, latMax: 75, lngMin: 40, lngMax: 150 },
            { latMin: -40, latMax: -10, lngMin: 113, lngMax: 155 },
        ];
        for (const region of landMasses) {
            if (lat >= region.latMin && lat <= region.latMax &&
                lng >= region.lngMin && lng <= region.lngMax) {
                return true;
            }
        }
        return false;
    }

    // ============================================
    //  SOCKET.IO
    // ============================================
    initSocket() {
        this.socket = io({ transports: ['websocket', 'polling'] });

        this.socket.on('connect', () => {
            console.log('✅ Connected');
            this.checkSelectedShip();
        });

        this.socket.on('joined', (data) => {
            console.log('📥 Joined event:', data);
            
            this.playerId = data.ship.id;
            this.ship = data.ship;
            this.role = data.role;
            this.isGuest = (this.role === 'guest');
            this.shipType = this.ship.shipType;
            this.playerName = this.ship.name;
            
            // Reset start flags
            this.isStarting = false;
            this.startAttempts = 0;
            this.isSelectingStart = false;
            this.isSelectingFinish = false;
            
            if (this.startTimer) {
                clearTimeout(this.startTimer);
                this.startTimer = null;
            }
            
            if (this.confirmationTimer) {
                clearInterval(this.confirmationTimer);
                this.confirmationTimer = null;
            }
            
            if (this.startHint) {
                this.map.removeLayer(this.startHint);
                this.startHint = null;
            }
            if (this.finishHint) {
                this.map.removeLayer(this.finishHint);
                this.finishHint = null;
            }
            
            if (this.isGuest) {
                document.getElementById('guest-message').style.display = 'block';
                document.getElementById('controls-panel').style.display = 'none';
                document.getElementById('chat-input').disabled = true;
                document.getElementById('chat-send').disabled = true;
                this.showNotification('👁 You are a spectator', 'info');
                this.addChatMessage('👁 You are a spectator', 'system');
                this.map.getContainer().style.cursor = 'default';
            } else {
                document.getElementById('guest-message').style.display = 'none';
                document.getElementById('controls-panel').style.display = 'flex';
                document.getElementById('chat-input').disabled = false;
                document.getElementById('chat-send').disabled = false;
                
                const shipName = this.ship.name || this.selectedShipName || 'Ship';
                this.showNotification(`⛵ ${shipName} is at sea!`, 'success');
                this.addChatMessage(`⛵ ${shipName} is at sea!`, 'system');
                
                this.isRacing = true;
                this.hasSelectedShip = true;
                
                // Remove from localStorage ONLY after successful start
                localStorage.removeItem('selectedShip');
                console.log('🗑️ Removed selectedShip from localStorage');
                
                this.showShipThumbnail(this.ship.shipType);
                this.updateShipInfo();
                this.updatePlayers(data.players);
                
                // Show finish selection if not set
                if (!this.ship.finishPoint) {
                    this.isSelectingFinish = true;
                    this.map.getContainer().style.cursor = 'crosshair';
                    this.showNotification('📍 Click on the map to choose FINISH point (ocean only!)', 'info');
                    this.addChatMessage('📍 Click on the map to choose FINISH point', 'system');
                    
                    if (this.finishHint) {
                        this.map.removeLayer(this.finishHint);
                    }
                    this.finishHint = L.popup()
                        .setLatLng([this.map.getCenter().lat, this.map.getCenter().lng])
                        .setContent('🏁 <b>Click on the ocean</b> to set finish point')
                        .openOn(this.map);
                }
            }
        });

        this.socket.on('state', (data) => {
            this.lastState = data;
            this.updatePlayers(data.players);
            if (this.ship && data.players[this.playerId]) {
                this.ship = data.players[this.playerId];
                this.updateShipInfo();
                
                // Check if ship finished
                if (this.ship.isFinished) {
                    this.showNotification(`🏁 ${this.ship.name} finished the race!`, 'success');
                    this.addChatMessage(`🏁 ${this.ship.name} finished the race!`, 'system');
                }
            }
            
            // Update compass with wind and current data
            if (data.wind && data.current && this.playerId) {
                const wind = data.wind[this.playerId];
                const current = data.current[this.playerId];
                if (wind && current) {
                    this.lastWind = wind;
                    this.lastCurrent = current;
                    this.updateCompass(wind.direction, current.direction);
                }
            }
        });

        this.socket.on('player_joined', (data) => {
            this.addChatMessage(`🚢 ${data.name} joined the race`, 'system');
        });

        this.socket.on('player_left', (data) => {
            if (data.isOffline) {
                this.addChatMessage(`💤 ${data.name} went offline (ship is sailing)`, 'system');
            }
        });

        this.socket.on('ship_grounded', (data) => {
            this.showNotification(`⚠️ ${data.name} is grounded!`, 'danger');
            this.addChatMessage(`⚠️ ${data.name} is grounded!`, 'danger');
        });

        this.socket.on('ship_anchored', (data) => {
            this.addChatMessage(`⚓ ${data.name} dropped anchor`, 'system');
        });

        this.socket.on('ship_finished', (data) => {
            this.showNotification(`🏁 ${data.name} finished the race!`, 'success');
            this.addChatMessage(`🏁 ${data.name} finished the race!`, 'system');
        });

        this.socket.on('action_result', (data) => {
            if (!data.success) {
                this.showNotification(`❌ ${data.message}`, 'warning');
            } else {
                if (data.action === 'turn') {
                    this.showNotification(`🧭 Heading: ${data.heading}°`, 'info');
                } else if (data.action === 'sail') {
                    this.showNotification(`⛵ Sail: ${Math.round(data.sailPosition * 100)}%`, 'info');
                }
            }
        });

        this.socket.on('chat', (data) => {
            this.addChatMessage(`⛵ ${data.name}: ${data.message}`, 'user');
        });

        this.socket.on('join_error', (data) => {
            console.log('❌ Join error:', data);
            this.showNotification(`❌ ${data.message}`, 'danger');
            
            // Reset flags
            this.isStarting = false;
            this.startAttempts = 0;
            this.isSelectingStart = false;
            this.isSelectingFinish = false;
            this.hasSelectedShip = false;
            this.map.getContainer().style.cursor = 'default';
            
            if (this.startTimer) {
                clearTimeout(this.startTimer);
                this.startTimer = null;
            }
            if (this.startHint) {
                this.map.removeLayer(this.startHint);
                this.startHint = null;
            }
            if (this.finishHint) {
                this.map.removeLayer(this.finishHint);
                this.finishHint = null;
            }
            
            if (data.message && data.message.includes('already taken')) {
                localStorage.removeItem('selectedShip');
                this.showNotification('🔄 Ship was taken, please select another', 'warning');
            }
            
            this.loadShipsState();
        });
    }

    // ============================================
    //  SHOW SHIP THUMBNAIL
    // ============================================
    showShipThumbnail(shipType) {
        const panel = document.getElementById('ship-panel');
        const oldThumb = document.getElementById('ship-thumbnail');
        if (oldThumb) oldThumb.remove();
        
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
        
        const selectBtn = panel.querySelector('.panel-action-btn');
        if (selectBtn) {
            selectBtn.after(thumb);
        } else {
            panel.prepend(thumb);
        }
    }

    // ============================================
    //  SETUP SHIP PANEL
    // ============================================
    setupShipPanel() {
        const selectBtn = document.getElementById('btn-select-ship');
        if (selectBtn) {
            selectBtn.addEventListener('click', () => {
                window.location.href = '/selection.html';
            });
        }
    }

    // ============================================
    //  LOAD SHIPS STATE
    // ============================================
    loadShipsState() {
        fetch('/api/ships/state')
            .then(r => r.json())
            .then(data => {})
            .catch(err => console.error('Failed to load ships state:', err));
    }

    // ============================================
    //  UPDATE PLAYERS
    // ============================================
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

    // ============================================
    //  UPDATE SINGLE PLAYER
    // ============================================
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

    // ============================================
    //  CREATE POPUP
    // ============================================
    createPopup(player) {
        const shipNames = {
            'klip_10': 'Clipper-10',
            'klip_20': 'Clipper-20',
            'klip_30': 'Clipper-30',
            'columb': 'Columbus',
            'pirat': 'Pirate',
            'ap': 'AP',
            '19c_m': '19th Century'
        };

        const displayName = player.name || shipNames[player.shipType] || player.shipType || 'Unknown';

        let status = '🟢 Sailing';
        if (player.isEliminated) status = '💀 Eliminated';
        else if (player.isFinished) status = '🏁 Finished!';
        else if (player.isGrounded) status = '⚠ Grounded';
        else if (player.isAnchored) status = '⚓ Anchored';
        else if (!player.isOnline) status = '💤 Offline (sailing)';

        return `
            <strong>${displayName}</strong><br>
            🚢 ${shipNames[player.shipType] || player.shipType}<br>
            ${status}<br>
            🧭 ${player.heading || 0}° | ⛵ ${(player.speed || 0).toFixed(1)} kn<br>
            📏 ${(player.distanceTraveled || 0).toFixed(0)} km
        `;
    }

    // ============================================
    //  UPDATE SHIP INFO
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
            anchorBtn.textContent = '⚓ Weigh';
        } else {
            anchorBtn.classList.remove('active');
            anchorBtn.textContent = '⚓ Anchor';
        }
        
        // Update status
        const statusDisplay = document.getElementById('ship-status-display');
        if (statusDisplay) {
            if (this.ship.isFinished) statusDisplay.textContent = '🏁 Finished!';
            else if (this.ship.isEliminated) statusDisplay.textContent = '💀 Eliminated';
            else if (this.ship.isGrounded) statusDisplay.textContent = '⚠ Grounded';
            else if (this.ship.isAnchored) statusDisplay.textContent = '⚓ Anchored';
            else if (!this.ship.isOnline) statusDisplay.textContent = '💤 Offline (sailing)';
            else statusDisplay.textContent = '🟢 Sailing';
        }
    }

    // ============================================
    //  SETUP CONTROLS
    // ============================================
    setupControls() {
        document.addEventListener('keydown', (e) => {
            if (!this.isRacing || this.isGuest || !this.socket) return;
            if (document.activeElement?.tagName === 'INPUT') return;

            switch (e.key) {
                case 'ArrowLeft': this.socket.emit('turn', { delta: -1 }); e.preventDefault(); break;
                case 'ArrowRight': this.socket.emit('turn', { delta: 1 }); e.preventDefault(); break;
                case 'ArrowUp': this.socket.emit('sail', { action: 'raise' }); e.preventDefault(); break;
                case 'ArrowDown': this.socket.emit('sail', { action: 'lower' }); e.preventDefault(); break;
                case ' ': this.socket.emit('anchor', { action: this.ship?.isAnchored ? 'weigh' : 'drop' }); e.preventDefault(); break;
            }
        });

        document.getElementById('btn-left').onclick = () => {
            if (!this.isGuest) this.socket.emit('turn', { delta: -1 });
        };
        document.getElementById('btn-right').onclick = () => {
            if (!this.isGuest) this.socket.emit('turn', { delta: 1 });
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
            if (this.isRacing && !this.isGuest && confirm('Reset ship?')) {
                this.socket.emit('leave_race');
                localStorage.removeItem('selectedShip');
                this.isStarting = false;
                this.startAttempts = 0;
                this.isRacing = false;
                if (this.startTimer) {
                    clearTimeout(this.startTimer);
                    this.startTimer = null;
                }
                location.reload();
            }
        };
    }

    // ============================================
    //  SETUP CHAT
    // ============================================
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

    // ============================================
    //  ADD CHAT MESSAGE
    // ============================================
    addChatMessage(text, type = 'user') {
        const div = document.createElement('div');
        div.className = `chat-${type}`;
        div.textContent = text;
        this.chatMessages.appendChild(div);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    // ============================================
    //  SETUP UI
    // ============================================
    setupUI() {
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

    // ============================================
    //  SHOW NOTIFICATION
    // ============================================
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
//  START
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const game = new RegattaGame();
    game.init();
});
