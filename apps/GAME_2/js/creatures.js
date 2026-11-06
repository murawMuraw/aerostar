/* js/creatures.js — триггер мифических существ по координатам шара */

(function () {
  'use strict';

  /* ── База существ ──
     В реальном проекте — загрузка из JSON (fetch).
     radiusKm — радиус действия вокруг координаты.
     img — путь к PNG/WebP с прозрачным фоном. */
  const creatures = [
    {
      id: 'cmok',
      name: 'Цмок',
      lat: 52.1,
      lon: 23.7,
      radiusKm: 10,
      img: 'images/creatures/cmok.webp'
    },
    {
      id: 'zhezhik',
      name: 'Жевжик',
      lat: 52.15,
      lon: 23.75,
      radiusKm: 8,
      img: 'images/creatures/zhezhik.webp'
    }
  ];

  /* ── DOM ── */
  const overlay   = document.getElementById('creatureOverlay');
  const imgEl     = document.getElementById('creatureImg');
  const nameEl    = document.getElementById('creatureName');
  const releaseBtn= document.getElementById('releaseBtn');
  const caption   = document.getElementById('mapCaption');

  if (!overlay) {
    console.warn('[creatures] overlay не найден в DOM');
    return;
  }

  let activeCreature = null;
  let isAnimating = false;

  /* ── Утилита: расстояние между координатами (км) ── */
  function distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) *
              Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ── Поиск существа рядом с координатой ── */
  function findNearby(lat, lon) {
    return creatures.find(c =>
      distanceKm(lat, lon, c.lat, c.lon) <= c.radiusKm
    ) || null;
  }

  /* ── Показать существо ── */
  function showCreature(c) {
    if (isAnimating || (activeCreature && activeCreature.id === c.id)) return;
    isAnimating = true;
    activeCreature = c;

    imgEl.src = c.img;
    nameEl.textContent = c.name;

    overlay.classList.remove('is-large', 'is-leaving');

    requestAnimationFrame(function () {
      overlay.classList.add('is-appearing');
      setTimeout(function () {
        overlay.classList.add('is-large');
        isAnimating = false;
      }, 400);
    });
  }

  /* ── Скрыть существо ── */
  function hideCreature() {
    if (!activeCreature) return;
    overlay.classList.add('is-leaving');
    overlay.classList.remove('is-large');

    setTimeout(function () {
      overlay.classList.remove('is-appearing', 'is-leaving');
      activeCreature = null;
      isAnimating = false;
    }, 1000);
  }

  /* ── Кнопка «Отпустить» ── */
  if (releaseBtn) {
    releaseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      hideCreature();
    });
  }

  /* ── Проверка координат шара ──
     Публичная функция: вызывайте её из js/balloon.js / main.js
     каждый раз, когда обновляются координаты шара. */
  function updateCreatures(lat, lon) {
    // Подпись координат под картой
    if (caption) {
      caption.textContent =
        'широта ' + lat.toFixed(3) + ', долгота ' + lon.toFixed(3);
    }

    const nearby = findNearby(lat, lon);

    if (nearby && (!activeCreature || activeCreature.id !== nearby.id)) {
      showCreature(nearby);
    } else if (!nearby && activeCreature && !isAnimating) {
      hideCreature();
    }
  }

  /* ── Экспорт для других скриптов ── */
  window.AerostarCreatures = {
    update: updateCreatures,
    hide: hideCreature,
    list: creatures
  };

  /* ── Демо-режим: если js/balloon.js не вызывает updateCreatures,
     можно тестировать кликом по сцене (сдвиг на +0.01°). ── */
  const scenePanel = document.getElementById('scenePanel');
  let demoLat = 52.1;
  let demoLon = 23.7;
  if (scenePanel) {
    scenePanel.addEventListener('click', function (e) {
      if (e.target.closest('.creature-overlay')) return;
      demoLat += 0.01;
      demoLon += 0.01;
      updateCreatures(demoLat, demoLon);
    });
  }

  // Начальная инициализация подписи
  updateCreatures(demoLat, demoLon);

  console.log('[creatures] модуль загружен. Существ в базе:', creatures.length);
})();
