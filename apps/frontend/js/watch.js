// ========== WATCH PAGE - LIVE PUBLIC BALLOON ==========
// Hybrid: WebSocket + HTTP Fallback

let map;
let publicBalloonMarker = null;
let publicPathLine = null;
let lastPosition = null;
let updateInterval = null;
let httpFallbackActive = false;
const socket = io('/', {
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
});

// ========== DIAGNOSTICS ==========
console.log('🔍 Starting diagnostics...');

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎈 Watch page initialized');
    initMap();
    setupWebSocketListeners();
    updateStatus('🔄 Connecting to server...');
    
    // Start HTTP fallback after 3 seconds if WebSocket doesn't work
    setTimeout(() => {
        if (!publicBalloonMarker) {
            console.warn('⚠️ WebSocket data timeout, using HTTP fallback');
            startHttpFallback();
        }
    }, 3000);
});

// Cleanup on close
window.addEventListener('beforeunload', () => {
    if (socket) socket.disconnect();
    if (updateInterval) clearInterval(updateInterval);
    if (publicBalloonMarker) map?.removeLayer(publicBalloonMarker);
    if (publicPathLine) map?.removeLayer(publicPathLine);
});

// ========== MAP INITIALIZATION ==========
function initMap() {
    console.log('🗺️ Initializing map...');
    
    map = L.map('map', {
        center: [52.12, 23.72],
        zoom: 8,
        zoomControl: true
    });
    
    // Satellite layer
    const esriSatellite = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri',
        maxZoom: 19
    });
    
    // OSM layer
    const osmStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    });
    
    // Default: satellite
    esriSatellite.addTo(map);
    
    // Layer switcher
    L.control.layers(
        { 
            "🛰️ Satellite": esriSatellite, 
            "🗺️ OSM": osmStandard 
        },
        null,
        { position: 'topleft', collapsed: false }
    ).addTo(map);
    
    // Scale control
    L.control.scale({ metric: true, position: 'bottomleft' }).addTo(map);
    
    console.log('✅ Map initialized');
}

// ========== WEBSOCKET ==========
function setupWebSocketListeners() {
    // Main event - receiving balloon data
    socket.on('balloonsData', (data) => {
        console.log('🎈 WebSocket data received:', data);
        try {
            // Extract public balloon
            let publicBalloon;
            if (Array.isArray(data)) {
                publicBalloon = data.find(b => b?.isPublic) || data[0];
            } else {
                publicBalloon = data?.isPublic !== undefined ? data : null;
            }
            
            if (publicBalloon) {
                renderBalloon(publicBalloon);
                updateStatus(`🟢 LIVE (WS) ${new Date().toLocaleTimeString()}`);
                // Disable HTTP fallback if active
                if (httpFallbackActive) {
                    httpFallbackActive = false;
                    if (updateInterval) {
                        clearInterval(updateInterval);
                        updateInterval = null;
                    }
                }
            } else {
                updateStatus('⏳ Waiting for public balloon...');
            }
        } catch (error) {
            console.error('Data processing error:', error);
            updateStatus('❌ Data error');
        }
    });

    // Connection error handling
    socket.on('connect', () => {
        console.log('✅ WebSocket connected');
        updateStatus('🟢 Connected (WS)');
    });

    socket.on('connect_error', (err) => {
        console.error('❌ WebSocket connection error:', err);
        updateStatus('❌ WebSocket error');
        // Start HTTP fallback if not already started
        if (!httpFallbackActive && !updateInterval) {
            startHttpFallback();
        }
    });

    socket.on('disconnect', () => {
        console.warn('⚠️ WebSocket disconnected');
        updateStatus('⏸️ WebSocket disconnected');
    });

    socket.on('reconnect', () => {
        console.log('🔄 WebSocket reconnected');
        updateStatus('🟢 Reconnected (WS)');
    });
}

// ========== HTTP FALLBACK ==========
function startHttpFallback() {
    if (httpFallbackActive) return;
    httpFallbackActive = true;
    console.log('🔄 Starting HTTP fallback (every 2 seconds)');
    updateStatus('🔄 HTTP polling...');
    
    // First request immediately
    fetchPublicBalloon();
    
    // Start interval
    updateInterval = setInterval(fetchPublicBalloon, 2000);
}

async function fetchPublicBalloon() {
    try {
        console.log('📡 HTTP request to /api/public-aerostar');
        const response = await fetch('/api/public-aerostar');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        console.log('📡 HTTP data received:', data);
        
        if (data.position) {
            renderBalloon(data);
            updateStatus(`🟢 LIVE (HTTP) ${new Date().toLocaleTimeString()}`);
            
            // Hide loading
            const loadingEl = document.getElementById('loading');
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
        } else {
            updateStatus('⏳ Waiting for data...');
        }
    } catch (error) {
        console.error('❌ HTTP request error:', error);
        updateStatus('❌ HTTP error');
    }
}

// ========== RENDER BALLOON ==========
function renderBalloon(data) {
    if (!map) {
        console.error('❌ Map not initialized');
        return;
    }

    // Extract coordinates (support different formats)
    const lat = data?.position?.lat ?? data?.latitude;
    const lng = data?.position?.lng ?? data?.longitude;

    // Validate coordinates
    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
        console.warn('⚠️ Invalid coordinates:', { lat, lng });
        return;
    }

    const currentPos = [lat, lng];
    
    // Check if position changed
    const positionChanged = !lastPosition || 
        Math.abs(lastPosition[0] - lat) > 0.00001 || 
        Math.abs(lastPosition[1] - lng) > 0.00001;
    
    if (positionChanged) {
        console.log(`📍 New position: ${lat.toFixed(6)}°, ${lng.toFixed(6)}°`);
        lastPosition = currentPos;
        
        // Update coordinates in info panel
        const coordsEl = document.getElementById('coords');
        if (coordsEl) {
            coordsEl.innerHTML = `
                <span class="status-dot"></span>
                📍 ${lat.toFixed(6)}°, ${lng.toFixed(6)}°
            `;
        }
    }

    // === 1. UPDATE MARKER ===
    if (publicBalloonMarker) {
        map.removeLayer(publicBalloonMarker);
        publicBalloonMarker = null;
    }

    // Create icon (enlarged via CSS class)
    const balloonIcon = L.icon({
        iconUrl: '/images/balloon.png',
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
        className: 'double-size-balloon'
    });

    // Add marker
    publicBalloonMarker = L.marker(currentPos, {
        icon: balloonIcon,
        zIndexOffset: 1000
    }).addTo(map);

    // Popup with info
    publicBalloonMarker.bindPopup(`
        <div style="text-align: center; min-width: 150px; padding: 5px;">
            <strong>🎈 Aerostar Balloon</strong><br>
            📍 ${lat.toFixed(6)}°, ${lng.toFixed(6)}°<br>
            🕐 ${new Date().toLocaleTimeString()}
        </div>
    `);

    // === 2. DRAW PATH ===
    if (data.path && Array.isArray(data.path) && data.path.length > 1) {
        // Remove old path
        if (publicPathLine) {
            map.removeLayer(publicPathLine);
            publicPathLine = null;
        }

        // Convert path points
        const pathPoints = data.path.map(point => {
            const pLat = point?.lat ?? point?.latitude;
            const pLng = point?.lng ?? point?.longitude;
            if (pLat != null && pLng != null && !isNaN(pLat) && !isNaN(pLng)) {
                return [pLat, pLng];
            }
            return null;
        }).filter(p => p !== null);

        if (pathPoints.length > 1) {
            // Main path line
            publicPathLine = L.polyline(pathPoints, {
                color: '#ff4444',
                weight: 4,
                opacity: 0.8,
                smoothFactor: 1
            }).addTo(map);

            console.log(`📏 Path drawn with ${pathPoints.length} points`);
        }
    } else if (data.path && data.path.length === 1) {
        console.log('📍 Only start position, no path yet');
    }

    // === 3. CENTER MAP ===
    if (positionChanged) {
        const center = map.getCenter();
        const distance = map.distance(center, currentPos);
        
        if (distance > 5000) { // > 5 km
            map.setView(currentPos, map.getZoom());
            console.log(`🎯 Centering to new position (${distance.toFixed(0)}m)`);
        } else if (distance > 100) {
            map.panTo(currentPos);
        }
    }

    // Hide loading
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
        loadingEl.style.display = 'none';
    }
}

// ========== STATUS UPDATE ==========
function updateStatus(message) {
    const statusEl = document.getElementById('connectionStatus');
    if (statusEl) {
        statusEl.textContent = message;
        
        // Change indicator color based on status
        if (message.includes('LIVE') || message.includes('Connected') || message.includes('HTTP')) {
            statusEl.style.borderLeftColor = '#00ff88';
        } else if (message.includes('Error') || message.includes('disconnected')) {
            statusEl.style.borderLeftColor = '#ff4444';
        } else {
            statusEl.style.borderLeftColor = '#ffaa00';
        }
    }
}

console.log('🎈 Watch script loaded with WebSocket + HTTP fallback');
