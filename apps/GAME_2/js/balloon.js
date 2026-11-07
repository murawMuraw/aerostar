/* GAME_2 balloon flight — browser-side movement, no Aerost.art backend routes. */
(() => {
  'use strict';

  const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

  function validWind(data) {
    return data && Number.isFinite(Number(data.speed)) &&
      Number.isFinite(Number(data.direction)) && Number(data.speed) >= 0;
  }

  // Public Open-Meteo forecast API. Wind speed is requested in m/s.
  async function getWindData(lat, lon) {
    const url = new URL(OPEN_METEO);
    url.search = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: 'wind_speed_10m,wind_direction_10m,temperature_2m,precipitation',
      wind_speed_unit: 'ms',
      timezone: 'auto'
    }).toString();

    try {
      const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
      const json = await response.json();
      const current = json.current || {};
      const wind = {
        speed: Number(current.wind_speed_10m),
        direction: Number(current.wind_direction_10m),
        gust: Number(current.wind_gusts_10m || 0),
        temp: current.temperature_2m ?? '--',
        precip: current.precipitation ?? '--'
      };
      if (!validWind(wind)) throw new Error('Wind fields are missing in Open-Meteo response');
      return wind;
    } catch (error) {
      console.error('[GAME_2] Wind request failed:', error);
      return null;
    }
  }

  function calculateNextPoint(start, wind, seconds) {
    // Meteorological wind direction points FROM; balloon drifts TO the opposite direction.
    const bearing = ((Number(wind.direction) + 180) % 360) * Math.PI / 180;
    const distanceKm = (Number(wind.speed) * seconds) / 1000;
    const R = 6371;
    const lat1 = start.lat * Math.PI / 180;
    const lon1 = start.lng * Math.PI / 180;
    const angular = distanceKm / R;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
    );
    return { lat: lat2 * 180 / Math.PI, lng: ((lon2 * 180 / Math.PI + 540) % 360) - 180 };
  }

  async function updateForecast(point) {
    if (!point) return null;
    const wind = await getWindData(point.lat, point.lng);
    if (!wind) return null;
    window.App.currentWind = wind;
    if (typeof window.updateWindDisplay === 'function') window.updateWindDisplay(wind);
    return wind;
  }

  function notifyCreatures(position) {
    if (typeof window.checkNearbyPlace === 'function') {
      window.checkNearbyPlace(position.lat, position.lng);
    } else if (window.AerostarCreatures?.update) {
      window.AerostarCreatures.update(position.lat, position.lng);
    }
  }

  function moveBalloon() {
    const app = window.App;
    if (!app.isFlying || !app.balloonPosition || !app.currentWind) return;
    const next = calculateNextPoint(app.balloonPosition, app.currentWind, 1);
    app.balloonPosition = L.latLng(next.lat, next.lng);

    if (typeof window.syncMaps === 'function') window.syncMaps(next.lat, next.lng);
    if (typeof window.updateCoordDisplay === 'function') window.updateCoordDisplay(next.lat, next.lng);
    notifyCreatures(app.balloonPosition);
    if (typeof window.addFlightPathPoint === 'function') {
      window.addFlightPathPoint(app.balloonPosition);
    }
  }

  async function startFlight() {
    const app = window.App;
    if (!app.balloonPosition) {
      if (typeof window.showError === 'function') window.showError('Select a launch point first.');
      return;
    }

    const start = document.getElementById('startBtn');
    if (start) start.disabled = true;

    try {
      // Always fetch a fresh wind sample at the selected launch point.
      const wind = await updateForecast(app.balloonPosition);
      if (!wind) throw new Error('Real wind forecast is unavailable. Please try again.');

      app.isFlying = true;
      app.actualPathPoints = [L.latLng(app.balloonPosition.lat, app.balloonPosition.lng)];

      if (app.startMarker) {
        window.map.removeLayer(app.startMarker);
        app.startMarker = null;
      }

      if (typeof window.activateFlightView === 'function') {
        window.activateFlightView(app.balloonPosition.lat, app.balloonPosition.lng);
      }

      // Add a simple visible marker to the overview map. The POV map has its own marker.
      if (app.balloonMarker) window.map.removeLayer(app.balloonMarker);
      app.balloonMarker = L.circleMarker(app.balloonPosition, {
        radius: 6, color: '#fff', weight: 2, fillColor: '#e34b3f', fillOpacity: 1
      }).addTo(window.map);

      notifyCreatures(app.balloonPosition);
      if (app.movementInterval) clearInterval(app.movementInterval);
      app.movementInterval = setInterval(moveBalloon, 1000);

      if (app.windUpdateInterval) clearInterval(app.windUpdateInterval);
      app.windUpdateInterval = setInterval(async () => {
        if (!app.isFlying || !app.balloonPosition) return;
        const fresh = await updateForecast(app.balloonPosition);
        if (fresh) {
          const el = document.getElementById('wind-status');
          if (el) el.textContent = `Wind ${fresh.speed.toFixed(1)} m/s · ${Math.round(fresh.direction)}°`;
        }
      }, 60000);

      if (typeof window.setStartButtonEnabled === 'function') window.setStartButtonEnabled(false);
      if (typeof window.updateFlightStatus === 'function') window.updateFlightStatus('flying', '🎈 FLIGHT');
      if (typeof window.hideHint === 'function') window.hideHint();
      const status = document.getElementById('flight-status');
      if (status) status.textContent = '🎈 Drifting with the wind';
      const windStatus = document.getElementById('wind-status');
      if (windStatus) windStatus.textContent = `Wind ${wind.speed.toFixed(1)} m/s · ${Math.round(wind.direction)}°`;
      console.log('[GAME_2] Flight started with Open-Meteo wind:', wind);
    } catch (error) {
      console.error('[GAME_2] Start failed:', error);
      app.isFlying = false;
      if (start) start.disabled = false;
      if (typeof window.showError === 'function') window.showError(error.message);
      if (typeof window.updateFlightStatus === 'function') window.updateFlightStatus('ready', 'Ready to fly');
    }
  }

  function resetFlight() {
    const app = window.App;
    if (app.movementInterval) clearInterval(app.movementInterval);
    if (app.windUpdateInterval) clearInterval(app.windUpdateInterval);
    app.movementInterval = null;
    app.windUpdateInterval = null;

    app.isFlying = false;
    app.balloonPosition = null;
    app.currentWind = null;
    app.actualPathPoints = [];
    app.forecastPoints = [];
    app.balloonId = null;

    if (app.balloonMarker && window.map) window.map.removeLayer(app.balloonMarker);
    if (app.startMarker && window.map) window.map.removeLayer(app.startMarker);
    app.balloonMarker = null;
    app.startMarker = null;

    if (window.AerostarCreatures?.hide) window.AerostarCreatures.hide();
    if (typeof window.resetFlightView === 'function') window.resetFlightView();
    if (typeof window.updateCoordDisplay === 'function') window.updateCoordDisplay(0, 0);
    if (typeof window.updateWindDisplay === 'function') window.updateWindDisplay(null);
    if (typeof window.setStartButtonEnabled === 'function') window.setStartButtonEnabled(false);
    if (typeof window.updateFlightStatus === 'function') window.updateFlightStatus('ready', 'Choose a launch point');
    if (typeof window.updateHint === 'function') window.updateHint('Click anywhere on the map to choose a launch point');
    const caption = document.getElementById('mapCaption');
    if (caption) caption.textContent = 'Select a launch point';
    const hint = document.getElementById('hint');
    if (hint) hint.style.opacity = '1';
  }

  // Keep the function names expected by main.js and legacy UI helpers.
  window.getWindData = getWindData;
  window.calculateNextPoint = calculateNextPoint;
  window.updateForecast = updateForecast;
  window.moveBalloon = moveBalloon;
  window.startFlight = startFlight;
  window.resetFlight = resetFlight;
})();
