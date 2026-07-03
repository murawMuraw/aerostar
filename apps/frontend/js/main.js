// ========== MAIN MODULE (ENTRY POINT) ==========

// App Initialization
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Aerostar App Starting');

    // Check if Leaflet is loaded
    if (typeof L === 'undefined') {
        console.error('Fatal Error: Leaflet library (L) is not defined. Check your script tags.');
        return;
    }

    // 1. Map Initialization
    initMap();
    // 2. UI Handlers Initialization
    initUIHandlers();
    // 3. Auth Handlers Initialization
    initAuthHandlers();
    // 4. User Session Recovery
    restoreSession();
    // 5. Server Ping Setup
    startServerPing();
    // 6. Show Welcome Modal
   
    // 7. Hide Loading Overlay
    hideLoading(3000);

    console.log('✅ App is ready');
});

// Map and Events Initialization
function initMap() {
    // Create Map
    window.map = L.map('map', {
        center: [52.12, 23.72],
        zoom: 3,
        zoomControl: true
    });

    // Add Map Layers
    const esriSatellite = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri',
        maxZoom: 19
    });
    const osmStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    });

    esriSatellite.addTo(window.map);

    // Layer Controls
    L.control.layers(
        {
            "🛰️ ESRI Satellite": esriSatellite,
            "🗺️ OSM Standard": osmStandard
        },
        null,
        { position: 'topleft', collapsed: false }
    ).addTo(window.map);

    L.control.scale({ metric: true, position: 'bottomleft' }).addTo(window.map);

    esriSatellite.on('load', function() {
        // Показываем окно через 1.5 сек после загрузки карты
      if (!localStorage.getItem('welcome_dont_show')) {
          setTimeout(showWelcomeModal, 1500);
      }
  });

    
    // Map Click Handler
    window.map.on('click', async function(e) {
        if (window.App.isFlying) {
            showError('Cannot select a new point during flight. Reset the flight first.');
            return;
        }

        const { lat, lng } = e.latlng;

        // Clear previous marker
        if (window.App.startMarker) {
            window.map.removeLayer(window.App.startMarker);
        }

        // Create new marker
        window.App.startMarker = L.marker([lat, lng]).addTo(window.map);
        window.App.balloonPosition = L.latLng(lat, lng);

        // Update UI
        updateCoordDisplay(lat, lng);
        updateFlightStatus('waiting', '⏳ Fetching wind forecast...');
        
        await updateForecast(window.App.balloonPosition);
        
        updateFlightStatus('ready', '⏸️ Ready to start');
        setStartButtonEnabled(true);
        updateHint('✅ Point selected. Press START');
    });

    // Update haze on move
    window.map.on('move', () => {
        if (window.App.balloonPosition && window.App.isFlying) {
            updateHaze(window.App.balloonPosition);
        }
    });

    // Update haze on resize
    window.addEventListener('resize', () => {
        if (window.App.balloonPosition && window.App.isFlying) {
            updateHaze(window.App.balloonPosition);
        }
    });
}

// UI Handlers Initialization
function initUIHandlers() {
    // Flight Control Buttons
    const startBtn = document.getElementById('startBtn');
    const resetBtn = document.getElementById('resetBtn');

    if (startBtn) {
        startBtn.addEventListener('click', startFlight);
    }
    if (resetBtn) {
        resetBtn.addEventListener('click', resetFlight);
    }

    // Close Ad Banner
    //const closeAdBtn = document.getElementById('close-ad');
    //if (closeAdBtn) {
    //    closeAdBtn.addEventListener('click', hideAdBanner);
    //}

    // Welcome Modal
    const closeWelcomeBtn = document.getElementById('closeWelcomeBtn');
    if (closeWelcomeBtn) {
        closeWelcomeBtn.addEventListener('click', closeWelcomeModal);
    }

    const dontShowCheckbox = document.getElementById('dontShowCheckbox');
    if (dontShowCheckbox) {
        dontShowCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                localStorage.setItem('welcome_dont_show', 'true');
            } else {
                localStorage.removeItem('welcome_dont_show');
            }
        });
    }

    // Keyboard Handler (ESC closes modals)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const authModal = document.getElementById('authModal');
            const welcomeModal = document.getElementById('welcomeModal');
            if (authModal && !authModal.classList.contains('hidden')) {
                showAuthModal(false);
            }
            if (welcomeModal && !welcomeModal.classList.contains('hidden')) {
                closeWelcomeModal();
            }
             
            }
      });
}

// Global Error Handling
window.addEventListener('error', (e) => {
    console.error('Global error:', e.error);
    showError('An error occurred: ' + (e.error?.message || 'Unknown error'));
});

// Unhandled Promise Rejection Handling
window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled Promise rejection:', e.reason);
    showError('Error: ' + (e.reason?.message || 'Unknown error'));
});
