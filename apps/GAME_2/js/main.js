/* Aerostar GAME_2 — world locator + close POV map. */
(() => {
  'use strict';

  const WORLD_CENTER = [20, 0];
  const WORLD_ZOOM = 2;
  const POV_ZOOM = 17;
  const ESRI_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

  let povMap = null;
  let worldMarker = null;
  let worldPathLine = null;
  let resizeTimer = null;
  let selectionRequest = 0;

  const $ = id => document.getElementById(id);
  const app = () => {
    window.App = window.App || {};
    window.App.actualPathPoints = window.App.actualPathPoints || [];
    return window.App;
  };

  function safeCall(name, ...args) {
    if (typeof window[name] === 'function') return window[name](...args);
  }

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
  }

  function initMap() {
    const state = app();

    // The inset remains interactive during flight: zoom, pan and layer switching.
    window.map = L.map('map', {
      center: WORLD_CENTER,
      zoom: WORLD_ZOOM,
      minZoom: 1,
      maxZoom: 19,
      zoomControl: false,
      worldCopyJump: true,
      preferCanvas: true
    });

    const esri = L.tileLayer(ESRI_URL, {
      attribution: 'Tiles © Esri',
      minZoom: 1,
      maxZoom: 19,
      noWrap: false
    });
    const osm = L.tileLayer(OSM_URL, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      minZoom: 1,
      maxZoom: 19,
      subdomains: 'abc',
      noWrap: false
    });

    esri.addTo(window.map);

    // Both base maps are offered on the world inset; ESRI is the default.
    L.control.layers(
      { 'ESRI Satellite': esri, 'OSM Standard': osm },
      null,
      { collapsed: true, position: 'topright' }
    ).addTo(window.map);

    // Zoom controls are deliberately retained on the small world map.
    L.control.zoom({ position: 'bottomright' }).addTo(window.map);

    window.map.on('click', async event => {
      if (state.isFlying) return;

      const lat = event.latlng.lat;
      const lon = event.latlng.lng;
      const requestId = ++selectionRequest;

      state.balloonPosition = L.latLng(lat, lon);

      if (state.startMarker) window.map.removeLayer(state.startMarker);
      state.startMarker = L.marker([lat, lon]).addTo(window.map);

      setText('mapCaption', `LAT ${lat.toFixed(4)} · LON ${lon.toFixed(4)}`);
      safeCall('updateCoordDisplay', lat, lon);
      safeCall('updateFlightStatus', 'waiting', 'Fetching wind forecast…');
      safeCall('updateHint', 'Fetching wind forecast…');

      const startButton = $('startBtn');
      if (startButton) startButton.disabled = true;

      try {
        if (typeof window.getWindData !== 'function') {
          throw new Error('Open-Meteo wind service is unavailable');
        }
        const wind = await window.getWindData(lat, lon);

        // Discard an older response if a newer launch point was selected.
        if (requestId !== selectionRequest) return;
        if (!wind) throw new Error('Wind forecast is unavailable');

        state.currentWind = wind;
        safeCall('updateWindDisplay', wind);
        safeCall('updateFlightStatus', 'ready', 'Ready to fly');
        safeCall('updateHint', 'Launch point selected. Press START');
        if (startButton) startButton.disabled = false;
      } catch (error) {
        if (requestId !== selectionRequest) return;
        console.warn('[GAME_2] Wind lookup failed:', error);
        safeCall('updateFlightStatus', 'error', 'Wind data unavailable');
        safeCall('updateHint', 'Could not get wind data. Select another point or try again.');
      }
    });
  }

  function createPovMap(lat, lon) {
    if (!povMap) {
      povMap = L.map('pov-map', {
        center: [lat, lon],
        zoom: POV_ZOOM,
        minZoom: 12,
        maxZoom: 19,
        zoomControl: false,
        attributionControl: true,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
        zoomSnap: 0.1,
        preferCanvas: true
      });

      L.tileLayer(ESRI_URL, {
        attribution: 'Tiles © Esri',
        minZoom: 12,
        maxZoom: 19
      }).addTo(povMap);
    }

    requestAnimationFrame(() => {
      if (!povMap) return;
      povMap.invalidateSize(true);
      povMap.setView([lat, lon], POV_ZOOM, { animate: false });
    });
  }

  function activateFlightView(lat, lon) {
    const root = $('app');
    if (!root) return;

    createPovMap(lat, lon);
    root.classList.add('flight-mode');

    // Set the world inset's initial flight view once. Later syncs only pan it,
    // preserving whatever zoom the user chooses with +/- or the mouse wheel.
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.map) {
        window.map.invalidateSize(true);
        window.map.setView([lat, lon], WORLD_ZOOM, { animate: false });
      }
      if (povMap) {
        povMap.invalidateSize(true);
        povMap.setView([lat, lon], POV_ZOOM, { animate: false });
      }
    }, 850);

    setText('flight-status', '🎈 Drifting with the wind');
    const wind = app().currentWind;
    if (wind) {
      setText('wind-status',
        `Wind ${Number(wind.speed).toFixed(1)} m/s · ${Math.round(Number(wind.direction))}°`);
    }
  }

  function syncMaps(lat, lon) {
    lat = Number(lat);
    lon = Number(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const point = [lat, lon];

    // Keep the balloon visible in the world inset without changing its zoom.
    if (window.map && app().isFlying) {
      if (!worldMarker) {
        worldMarker = L.circleMarker(point, {
          radius: 6, color: '#fff', weight: 2,
          fillColor: '#ed5145', fillOpacity: 1
        }).addTo(window.map);
        app().balloonMarker = worldMarker;
      } else {
        worldMarker.setLatLng(point);
      }
      window.map.panTo(point, { animate: true, duration: 0.6 });
    }

    // The close POV map follows the balloon. It has no marker or route line.
    if (povMap) {
      povMap.panTo(point, { animate: true, duration: 0.8 });
    }

    setText('mapCaption', `LAT ${lat.toFixed(4)} · LON ${lon.toFixed(4)}`);
  }

  function addPathPoint(position) {
    if (!window.map || !position) return;

    const lat = Number(position.lat);
    const lon = Number(position.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const points = app().actualPathPoints;
    const point = L.latLng(lat, lon);

    if (points.length &&
        window.map.distance(point, points[points.length - 1]) < 20) return;

    points.push(point);

    // The route is shown only on the world map, never over the passenger view.
    if (worldPathLine) {
      worldPathLine.setLatLngs(points);
    } else {
      worldPathLine = L.polyline(points, {
        color: '#ff654f',
        weight: 3,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(window.map);
    }
  }

  function resetView() {
    const root = $('app');
    if (root) root.classList.remove('flight-mode');
    clearTimeout(resizeTimer);

    if (worldMarker && window.map) window.map.removeLayer(worldMarker);
    worldMarker = null;
    if (worldPathLine && window.map) window.map.removeLayer(worldPathLine);
    worldPathLine = null;

    if (povMap) {
      povMap.remove();
      povMap = null;
    }

    if (window.map) {
      requestAnimationFrame(() => {
        window.map.invalidateSize(true);
        window.map.setView(WORLD_CENTER, WORLD_ZOOM, { animate: true });
      });
    }

    setText('mapCaption', 'Select a launch point');
    setText('flight-status', 'Choose your launch point');
    setText('wind-status', '');

    const startButton = $('startBtn');
    if (startButton) startButton.disabled = true;
  }

  function initUIHandlers() {
    const start = $('startBtn');
    const reset = $('resetBtn');

    if (start) {
      start.addEventListener('click', () => safeCall('startFlight'));
    }

    // balloon.js resetFlight() invokes resetFlightView(); do not reset twice.
    if (reset) {
      reset.addEventListener('click', () => safeCall('resetFlight'));
    }
  }

  // Public names consumed by the existing balloon.js.
  window.activateFlightView = activateFlightView;
  window.syncMaps = syncMaps;
  window.addFlightPathPoint = addPathPoint;
  window.resetFlightView = resetView;

  document.addEventListener('DOMContentLoaded', () => {
    if (typeof L === 'undefined') {
      console.error('[GAME_2] Leaflet did not load');
      return;
    }
    app();
    initMap();
    initUIHandlers();

    const loading = $('loading');
    if (loading) setTimeout(() => loading.classList.add('hidden'), 450);

    console.log('[GAME_2] World map, OSM/Satellite switch and basket POV ready.');
  });
})();
