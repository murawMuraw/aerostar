/* GAME_2 main controller: one world map + one close satellite POV map. */
(() => {
  'use strict';

  const DEFAULT_CENTER = [20, 0];
  const WORLD_ZOOM = 2;
  const POV_ZOOM = 17;
  const ESRI_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

  let povMap = null;
  let povMarker = null;
  let povPathLine = null;
  let worldPathLine = null;

  const $ = id => document.getElementById(id);

  function safeCall(name, ...args) {
    if (typeof window[name] === 'function') return window[name](...args);
  }

  function setStatus(text) {
    const el = $('flight-status');
    if (el) el.textContent = text;
  }

  function initMap() {
    window.map = L.map('map', {
      center: DEFAULT_CENTER, zoom: WORLD_ZOOM,
      zoomControl: false, worldCopyJump: true,
      minZoom: 2, maxZoom: 19
    });
    L.tileLayer(ESRI_URL, {
      attribution: 'Tiles © Esri', maxZoom: 19, noWrap: false
    }).addTo(window.map);

    window.map.on('click', async event => {
      if (window.App.isFlying) return;
      const { lat, lng } = event.latlng;
      window.App.balloonPosition = L.latLng(lat, lng);

      if (window.App.startMarker) window.map.removeLayer(window.App.startMarker);
      window.App.startMarker = L.marker([lat, lng]).addTo(window.map);

      const caption = $('mapCaption');
      if (caption) caption.textContent = `LAT ${lat.toFixed(4)} · LON ${lng.toFixed(4)}`;

      safeCall('updateCoordDisplay', lat, lng);
      safeCall('updateFlightStatus', 'waiting', 'Fetching wind…');
      safeCall('updateHint', 'Fetching wind forecast…');
      const start = $('startBtn');
      if (start) start.disabled = true;

      const wind = await window.getWindData(lat, lng);
      if (wind) {
        window.App.currentWind = wind;
        safeCall('updateWindDisplay', wind);
        safeCall('updateFlightStatus', 'ready', 'Ready to fly');
        safeCall('updateHint', 'Launch point selected. Press START');
        if (start) start.disabled = false;
      } else {
        safeCall('updateFlightStatus', 'error', 'Wind data unavailable');
        safeCall('updateHint', 'Could not get wind data. Select the point again in a moment.');
        setStatus('Wind forecast unavailable');
      }
    });
  }

  function createPovMap(lat, lon) {
    const panel = $('pov-panel');
    if (!panel) return;
    if (!povMap) {
      povMap = L.map('pov-map', {
        center: [lat, lon], zoom: POV_ZOOM, zoomControl: false,
        dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
        touchZoom: false, keyboard: false, zoomSnap: 0.1,
        attributionControl: true
      });
      L.tileLayer(ESRI_URL, {
        attribution: 'Tiles © Esri', maxZoom: 19
      }).addTo(povMap);
    }
    panel.classList.add('is-active');
    requestAnimationFrame(() => {
      povMap.invalidateSize(true);
      povMap.setView([lat, lon], POV_ZOOM, { animate: false });
    });
    if (!povMarker) {
      povMarker = L.circleMarker([lat, lon], {
        radius: 5, color: '#fff', weight: 2,
        fillColor: '#e34b3f', fillOpacity: 1
      }).addTo(povMap);
    } else povMarker.setLatLng([lat, lon]);
  }

  function activateFlightView(lat, lon) {
    const app = $('app');
    if (!app) return;
    app.classList.add('flight-mode');
    createPovMap(lat, lon);
    setTimeout(() => {
      window.map.invalidateSize(true);
      window.map.setView([lat, lon], WORLD_ZOOM, { animate: true, duration: 0.7 });
    }, 80);
    setStatus('🎈 In flight');
    const windStatus = $('wind-status');
    if (windStatus && window.App.currentWind) {
      const w = window.App.currentWind;
      windStatus.textContent = `Wind ${Number(w.speed).toFixed(1)} m/s · ${Math.round(w.direction)}°`;
    }
  }

  function syncMaps(lat, lon) {
    const point = [lat, lon];
    if (window.App.balloonMarker) window.App.balloonMarker.setLatLng(point);
    if (povMap) {
      povMap.panTo(point, { animate: true, duration: 0.9 });
      if (povMarker) povMarker.setLatLng(point);
    }
    if (window.map && window.App.isFlying) {
      if (!window.App.balloonMarker) {
        window.App.balloonMarker = L.circleMarker(point, {
          radius: 6, color: '#fff', weight: 2,
          fillColor: '#e34b3f', fillOpacity: 1
        }).addTo(window.map);
      }
    }
    const caption = $('mapCaption');
    if (caption) caption.textContent = `LAT ${lat.toFixed(4)} · LON ${lon.toFixed(4)}`;
  }

  function addPathPoint(position) {
    const point = [position.lat, position.lng];
    if (window.App.actualPathPoints.length === 0 ||
        window.map.distance(position, window.App.actualPathPoints[window.App.actualPathPoints.length - 1]) > 20) {
      window.App.actualPathPoints.push(L.latLng(position.lat, position.lng));
      if (worldPathLine) window.map.removeLayer(worldPathLine);
      worldPathLine = L.polyline(window.App.actualPathPoints, {
        color: '#ff654f', weight: 3, opacity: .9
      }).addTo(window.map);
      if (povMap) {
        if (povPathLine) povMap.removeLayer(povPathLine);
        povPathLine = L.polyline(window.App.actualPathPoints, {
          color: '#ff654f', weight: 3, opacity: .85
        }).addTo(povMap);
      }
    }
  }

  function resetView() {
    const app = $('app');
    if (app) app.classList.remove('flight-mode');
    if (window.map) {
      window.map.invalidateSize(true);
      window.map.setView(DEFAULT_CENTER, WORLD_ZOOM, { animate: true });
    }
    if (povMap) {
      if (povMarker) { povMap.removeLayer(povMarker); povMarker = null; }
      if (povPathLine) { povMap.removeLayer(povPathLine); povPathLine = null; }
    }
    if (worldPathLine) { window.map.removeLayer(worldPathLine); worldPathLine = null; }
    setStatus('Choose your launch point');
    const windStatus = $('wind-status');
    if (windStatus) windStatus.textContent = '';
    const start = $('startBtn');
    if (start) start.disabled = true;
  }

  function initUIHandlers() {
    const start = $('startBtn');
    const reset = $('resetBtn');
    if (start) start.addEventListener('click', () => {
      if (typeof window.startFlight === 'function') window.startFlight();
    });
    if (reset) reset.addEventListener('click', () => {
      if (typeof window.resetFlight === 'function') window.resetFlight();
      resetView();
    });
  }

  window.activateFlightView = activateFlightView;
  window.syncMaps = syncMaps;
  window.addFlightPathPoint = addPathPoint;
  window.resetFlightView = resetView;

  document.addEventListener('DOMContentLoaded', () => {
    if (typeof L === 'undefined') {
      console.error('[GAME_2] Leaflet did not load');
      return;
    }
    initMap();
    initUIHandlers();
    const loading = $('loading');
    if (loading) setTimeout(() => loading.classList.add('hidden'), 450);
    console.log('[GAME_2] World map ready. Select a launch point.');
  });
})();
