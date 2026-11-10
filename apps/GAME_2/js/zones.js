
/*
 * GAME_2 / Magic — географические игровые зоны.
 *
 * Загружает data/zones.geojson относительно index.html
 * и определяет зону по координатам шара.
 *
 * Не требует Turf.js и других дополнительных библиотек.
 */

(() => {
  'use strict';

  const DATA_URL = './data/zones.geojson';

  let features = [];
  let loaded = false;
  let loadError = null;

  // Проверка попадания точки в одно кольцо GeoJSON.
  function pointInRing(lon, lat, ring) {
    let inside = false;

    for (
      let i = 0, j = ring.length - 1;
      i < ring.length;
      j = i++
    ) {
      const xi = Number(ring[i][0]);
      const yi = Number(ring[i][1]);
      const xj = Number(ring[j][0]);
      const yj = Number(ring[j][1]);

      const intersects =
        ((yi > lat) !== (yj > lat)) &&
        (lon <
          ((xj - xi) * (lat - yi)) /
          ((yj - yi) || 1e-12) + xi);

      if (intersects) {
        inside = !inside;
      }
    }

    return inside;
  }

  // GeoJSON Polygon:
  // первое кольцо — внешняя граница,
  // остальные кольца — отверстия.
  function pointInPolygonCoordinates(lon, lat, rings) {
    if (
      !rings ||
      !rings.length ||
      !pointInRing(lon, lat, rings[0])
    ) {
      return false;
    }

    for (let i = 1; i < rings.length; i++) {
      if (pointInRing(lon, lat, rings[i])) {
        return false;
      }
    }

    return true;
  }

  function pointInFeature(lon, lat, feature) {
    const geometry = feature && feature.geometry;

    if (!geometry) return false;

    if (geometry.type === 'Polygon') {
      return pointInPolygonCoordinates(
        lon,
        lat,
        geometry.coordinates
      );
    }

    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.some(polygon =>
        pointInPolygonCoordinates(lon, lat, polygon)
      );
    }

    return false;
  }

  // Определение игровой зоны по координатам шара.
  // Входные координаты: широта, долгота.
  function findByCoordinates(lat, lon) {
    lat = Number(lat);
    lon = Number(lon);

    if (
      !loaded ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      return null;
    }

    if (
      lat < -90 || lat > 90 ||
      lon < -180 || lon > 180
    ) {
      return null;
    }

    // Глобальная зона инопланетян
    // не участвует в обычном поиске.
    for (const feature of features) {
      const props = feature.properties || {};

      if (
        props.zone_type === 'global_overlay' ||
        !feature.geometry
      ) {
        continue;
      }

      if (pointInFeature(lon, lat, feature)) {
        return {
          id: props.zone_id,
          name_ru: props.name_ru,
          name_en: props.name_en,
          type: props.zone_type || 'geographic'
        };
      }
    }

    return null;
  }

  // Загрузка GeoJSON.
  async function load() {
    try {
      const response = await fetch(DATA_URL, {
        headers: {
          Accept: 'application/geo+json, application/json'
        }
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} while loading ${DATA_URL}`
        );
      }

      const geojson = await response.json();

      if (
        !geojson ||
        geojson.type !== 'FeatureCollection' ||
        !Array.isArray(geojson.features)
      ) {
        throw new Error(
          'Invalid zones GeoJSON FeatureCollection'
        );
      }

      features = geojson.features;
      loaded = true;

      const geographicCount = features.filter(feature =>
        feature.geometry &&
        feature.properties?.zone_type !== 'global_overlay'
      ).length;

      console.log(
        `[Magic zones] Загружено зон: ${geographicCount}; ` +
        `всего записей: ${features.length}`
      );

      return true;

    } catch (error) {
      loadError = error;

      console.error(
        '[Magic zones] Не удалось загрузить зоны:',
        error
      );

      return false;
    }
  }

  // Начинаем загрузку сразу после подключения скрипта.
  const ready = load();

  // Публичный интерфейс модуля.
  window.MagicZones = {
    ready,
    load,
    findByCoordinates,

    getAll: () => features.slice(),

    isLoaded: () => loaded,

    getError: () => loadError
  };

})();
