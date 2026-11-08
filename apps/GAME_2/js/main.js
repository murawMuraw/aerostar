/* Aerostar GAME_2: independent world overview and close POV satellite map. */
(() => {
  'use strict';

  const WORLD_CENTER = [20, 0], WORLD_ZOOM = 2, POV_ZOOM = 17;
  const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

  let povMap = null, worldMarker = null, routeLine = null, resizeTimer = null, selectionId = 0;

  const $ = id => document.getElementById(id);

  const appState = () => {
    window.App = window.App || {};
    window.App.actualPathPoints = window.App.actualPathPoints || [];
    return window.App;
  };

  const setText = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };

  const call = (name, ...args) =>
    typeof window[name] === 'function'
      ? window[name](...args)
      : undefined;


  function setOverviewInteraction(enabled) {
    if (!window.map) return;

    [
      'dragging',
      'scrollWheelZoom',
      'doubleClickZoom',
      'touchZoom',
      'boxZoom',
      'keyboard'
    ].forEach(key => {
      const handler = window.map[key];

      if (handler &&
          typeof handler[enabled ? 'enable' : 'disable'] === 'function') {
        handler[enabled ? 'enable' : 'disable']();
      }
    });
  }


  // ---------------------------------------------------------
  // WORLD MAP — карта мира для выбора точки запуска
  // ---------------------------------------------------------

  function initMap() {
    const app = appState();

    window.map = L.map('map', {
      center: WORLD_CENTER,
      zoom: WORLD_ZOOM,
      minZoom: 2,
      maxZoom: 19,
      zoomControl: false,
      worldCopyJump: true,
      preferCanvas: true
    });

    L.tileLayer(ESRI, {
      attribution: 'Tiles © Esri',
      minZoom: 2,
      maxZoom: 19
    }).addTo(window.map);


    // Выбор точки запуска нажатием на карту.
    window.map.on('click', async event => {
      if (app.isFlying) return;

      const lat = event.latlng.lat;
      const lng = event.latlng.lng;
      const id = ++selectionId;

      app.balloonPosition = L.latLng(lat, lng);

      if (app.startMarker) {
        window.map.removeLayer(app.startMarker);
      }

      app.startMarker = L.marker([lat, lng]).addTo(window.map);

      setText(
        'mapCaption',
        `LAT ${lat.toFixed(4)} · LON ${lng.toFixed(4)}`
      );

      call('updateCoordDisplay', lat, lng);
      call('updateFlightStatus', 'waiting', 'Fetching wind forecast…');
      call('updateHint', 'Fetching wind forecast…');

      const button = $('startBtn');
      if (button) button.disabled = true;

      try {
        if (typeof window.getWindData !== 'function') {
          throw new Error('Wind service is unavailable');
        }

        const wind = await window.getWindData(lat, lng);

        // Игнорируем устаревший ответ, если пользователь
        // успел выбрать другую точку.
        if (id !== selectionId) return;

        if (!wind) {
          throw new Error('Wind forecast is unavailable');
        }

        app.currentWind = wind;

        call('updateWindDisplay', wind);
        call('updateFlightStatus', 'ready', 'Ready to fly');
        call('updateHint', 'Launch point selected. Press START');

        if (button) button.disabled = false;

      } catch (error) {
        if (id !== selectionId) return;

        console.warn('[GAME_2] Wind lookup failed:', error);

        call('updateFlightStatus', 'error', 'Wind data unavailable');
        call(
          'updateHint',
          'Could not get wind data. Please select the point again.'
        );
      }
    });
  }


  // ---------------------------------------------------------
  // POV MAP — спутниковый вид из корзины воздушного шара
  // ---------------------------------------------------------

  function initPovMap(lat, lon) {

    if (povMap) {
      povMap.invalidateSize(true);
      povMap.setView([lat, lon], POV_ZOOM, { animate: false });
      return;
    }

    povMap = L.map('pov-map', {
      center: [lat, lon],
      zoom: POV_ZOOM,
      minZoom: 12,
      maxZoom: 19,
      zoomControl: false,
      attributionControl: true,

      // Пользователь не двигает карту руками.
      // Она перемещается вслед за воздушным шаром.
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      boxZoom: false,
      keyboard: false,

      zoomSnap: 0.1,
      preferCanvas: true
    });

    L.tileLayer(ESRI, {
      attribution: 'Tiles © Esri',
      minZoom: 12,
      maxZoom: 19
    }).addTo(povMap);

    // На этой карте нет маркера и линии маршрута.
    // Это вид пассажира из корзины.
  }


  // ---------------------------------------------------------
  // START — переход в режим полёта
  // ---------------------------------------------------------

  function activateFlightView(lat, lon) {
    const root = $('app');

    if (!root) return;

    initPovMap(lat, lon);

    root.classList.add('flight-mode');

    // Запрещаем взаимодействие с обзорной картой.
   // setOverviewInteraction(false);

    // Ждём окончания CSS-анимации изменения размеров карты.
    clearTimeout(resizeTimer);

    resizeTimer = setTimeout(() => {

      if (window.map) {
        window.map.invalidateSize(true);

        window.map.setView(
          [lat, lon],
          WORLD_ZOOM,
          { animate: false }
        );
      }

      if (povMap) {
        povMap.invalidateSize(true);

        povMap.setView(
          [lat, lon],
          POV_ZOOM,
          { animate: false }
        );
      }

    }, 900);

    setText('flight-status', '🎈 Drifting with the wind');

    const wind = appState().currentWind;

    if (wind) {
      setText(
        'wind-status',
        `Wind ${Number(wind.speed).toFixed(1)} m/s · ${Math.round(Number(wind.direction))}°`
      );
    }
  }


  // ---------------------------------------------------------
  // СИНХРОНИЗАЦИЯ КАРТ ПРИ ДВИЖЕНИИ ШАРА
  // ---------------------------------------------------------

  function syncMaps(lat, lon) {

    lat = Number(lat);
    lon = Number(lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }

    const app = appState();
    const point = [lat, lon];

    // Создаём маркер шара на карте мира.
    if (!worldMarker && window.map) {

      worldMarker = L.circleMarker(point, {
        radius: 6,
        color: '#fff',
        weight: 2,
        fillColor: '#ed5145',
        fillOpacity: 1
      }).addTo(window.map);

      app.balloonMarker = worldMarker;

    } else if (worldMarker) {

      worldMarker.setLatLng(point);
    }

    // Сохраняем глобальный масштаб карты мира.
    if (
      window.map &&
      app.isFlying &&
      window.map.getZoom() !== WORLD_ZOOM
    ) {
      window.map.setZoom(
        WORLD_ZOOM,
        { animate: false }
      );
    }

    // Перемещаем спутниковую карту под наблюдателем.
    // Маркер шара здесь не показываем.
    if (povMap) {
      povMap.setView(
        point,
        POV_ZOOM,
        {
          animate: true,
          duration: 0.8
        }
      );
    }

    setText(
      'mapCaption',
      `LAT ${lat.toFixed(4)} · LON ${lon.toFixed(4)}`
    );
  }


  // ---------------------------------------------------------
  // МАРШРУТ — отображается только на карте мира
  // ---------------------------------------------------------

  function addFlightPathPoint(position) {

    if (!window.map || !position) return;

    const points = appState().actualPathPoints;

    const point = L.latLng(
      Number(position.lat),
      Number(position.lng)
    );

    // Не добавляем слишком близкие точки.
    if (
      points.length &&
      window.map.distance(point, points[points.length - 1]) < 20
    ) {
      return;
    }

    points.push(point);

    if (routeLine) {

      routeLine.setLatLngs(points);

    } else {

      routeLine = L.polyline(points, {
        color: '#ff654f',
        weight: 3,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(window.map);
    }

    // Маршрут намеренно не отображается на POV-карте.
  }


  // ---------------------------------------------------------
  // RESET — возвращение к выбору точки запуска
  // ---------------------------------------------------------

  function resetFlightView() {

    const root = $('app');

    if (root) {
      root.classList.remove('flight-mode');
    }

    clearTimeout(resizeTimer);

    setOverviewInteraction(true);

    if (worldMarker && window.map) {
      window.map.removeLayer(worldMarker);
    }

    worldMarker = null;

    if (routeLine && window.map) {
      window.map.removeLayer(routeLine);
    }

    routeLine = null;

    if (povMap) {
      povMap.remove();
      povMap = null;
    }

    if (window.map) {

      requestAnimationFrame(() => {

        window.map.invalidateSize(true);

        window.map.setView(
          WORLD_CENTER,
          WORLD_ZOOM,
          { animate: true }
        );
      });
    }

    setText('mapCaption', 'Select a launch point');
    setText('flight-status', 'Choose your launch point');
    setText('wind-status', '');

    const button = $('startBtn');

    if (button) {
      button.disabled = true;
    }
  }


  // ---------------------------------------------------------
  // ОБРАБОТЧИКИ КНОПОК
  // ---------------------------------------------------------

  function initUIHandlers() {

    const start = $('startBtn');
    const reset = $('resetBtn');

    if (start) {
      start.addEventListener('click', () => {
        call('startFlight');
      });
    }

    if (reset) {
      reset.addEventListener('click', () => {

        call('resetFlight');

        // Безопасно, если resetFlight() уже вызывает этот метод.
        resetFlightView();
      });
    }

    document.addEventListener('keydown', event => {

      if (event.key === 'Escape') {

        const modal = $('authModal');

        if (modal && !modal.classList.contains('hidden')) {
          call('showAuthModal', false);
        }
      }
    });
  }


  // ---------------------------------------------------------
  // ПУБЛИЧНЫЕ ФУНКЦИИ ДЛЯ balloon.js
  // Имена оставлены без изменений.
  // ---------------------------------------------------------

  window.activateFlightView = activateFlightView;
  window.syncMaps = syncMaps;
  window.addFlightPathPoint = addFlightPathPoint;
  window.resetFlightView = resetFlightView;


  // ---------------------------------------------------------
  // ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ СТРАНИЦЫ
  // ---------------------------------------------------------

  document.addEventListener('DOMContentLoaded', () => {

    if (typeof L === 'undefined') {
      console.error('[GAME_2] Leaflet did not load');
      return;
    }

    appState();

    initMap();
    initUIHandlers();

    const loading = $('loading');

    if (loading) {
      setTimeout(() => loading.classList.add('hidden'), 450);
    }

    console.log(
      '[GAME_2] World overview and POV maps initialized.'
    );
  });

})();
