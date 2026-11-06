/*
 * js/creatures.js
 *
 * Географические встречи с мифическими существами.
 *
 * Модуль НЕ запускает демонстрационное движение и НЕ задаёт стартовые
 * координаты шара. Он реагирует только на координаты, которые передаёт
 * основной модуль полёта через AerostarCreatures.update(lat, lon).
 *
 * Запись существа:
 * {
 *   id: "cmok",
 *   name: "Цмок",
 *   lat: 52.1,
 *   lon: 23.7,
 *   radiusKm: 10,
 *   img: "images/creatures/cmok.webp"
 * }
 */

(function () {
    'use strict';

    // ---------------------------------------------------------------------
    // 1. База существ.
    // Пока это тестовые записи. Позже их можно вынести в JSON/API.
    // ---------------------------------------------------------------------
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

    // ---------------------------------------------------------------------
    // 2. DOM-элементы. Если блоки не добавлены в HTML, модуль не падает.
    // ---------------------------------------------------------------------
    const overlay = document.getElementById('creatureOverlay');
    const imgEl = document.getElementById('creatureImg');
    const nameEl = document.getElementById('creatureName');
    const releaseBtn = document.getElementById('releaseBtn');
    const caption = document.getElementById('mapCaption');

    if (!overlay || !imgEl || !nameEl) {
        console.warn('[creatures] Не найдены creatureOverlay / creatureImg / creatureName');
        return;
    }

    // ---------------------------------------------------------------------
    // 3. Состояние модуля.
    // lastPosition становится известна только после первого реального
    // вызова update() из логики полёта.
    // dismissedIds не позволяет снова показывать отпущенное существо,
    // пока шар не покинет его географическую зону.
    // ---------------------------------------------------------------------
    let activeCreature = null;
    let lastPosition = null;
    let transitionTimer = null;
    let transitionToken = 0;
    let isLeaving = false;

    const dismissedIds = new Set();

    // ---------------------------------------------------------------------
    // 4. Расстояние по дуге большого круга (формула гаверсинусов).
    // Возвращает расстояние в километрах.
    // ---------------------------------------------------------------------
    function distanceKm(lat1, lon1, lat2, lon2) {
        const toRad = value => value * Math.PI / 180;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);

        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) *
            Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;

        // Защита от погрешности округления, при которой a может
        // незначительно выйти за диапазон [0, 1].
        const safeA = Math.min(1, Math.max(0, a));
        return 6371 * 2 * Math.atan2(Math.sqrt(safeA), Math.sqrt(1 - safeA));
    }

    // Проверка координат на корректность.
    function validCoordinates(lat, lon) {
        return Number.isFinite(lat) &&
            Number.isFinite(lon) &&
            lat >= -90 && lat <= 90 &&
            lon >= -180 && lon <= 180;
    }

    // ---------------------------------------------------------------------
    // 5. Определение существ в зоне шара.
    // Если несколько зон перекрываются, выбираем ближайшее существо.
    // ---------------------------------------------------------------------
    function findNearby(lat, lon) {
        let nearest = null;
        let nearestDistance = Infinity;

        for (const creature of creatures) {
            const distance = distanceKm(lat, lon, creature.lat, creature.lon);

            if (distance <= creature.radiusKm && distance < nearestDistance) {
                nearest = creature;
                nearestDistance = distance;
            }
        }

        return nearest;
    }

    function clearTransitionTimer() {
        if (transitionTimer !== null) {
            clearTimeout(transitionTimer);
            transitionTimer = null;
        }
    }

    // ---------------------------------------------------------------------
    // 6. Показ существа.
    // Токен перехода не даёт старому таймеру завершить уже новую анимацию.
    // ---------------------------------------------------------------------
    function showCreature(creature) {
        if (activeCreature && activeCreature.id === creature.id && !isLeaving) {
            return;
        }

        clearTransitionTimer();
        const token = ++transitionToken;

        activeCreature = creature;
        isLeaving = false;

        imgEl.alt = creature.name;
        imgEl.onerror = function () {
            console.error('[creatures] Не удалось загрузить изображение:', creature.img);
        };
        imgEl.src = creature.img;
        nameEl.textContent = creature.name;

        overlay.classList.remove('is-large', 'is-leaving', 'is-appearing');

        // Сначала браузер фиксирует исходное состояние, затем запускает
        // появление. Это позволяет CSS transition сработать предсказуемо.
        requestAnimationFrame(function () {
            if (token !== transitionToken) return;

            overlay.classList.add('is-appearing');

            transitionTimer = setTimeout(function () {
                if (token !== transitionToken || !activeCreature ||
                    activeCreature.id !== creature.id) return;

                overlay.classList.add('is-large');
                transitionTimer = null;
            }, 80);
        });
    }

    // ---------------------------------------------------------------------
    // 7. Скрытие существа.
    // immediate=true используется при замене существа или очистке.
    // ---------------------------------------------------------------------
    function hideCreature(options) {
        const settings = options || {};
        if (!activeCreature) return;

        clearTransitionTimer();
        const token = ++transitionToken;
        isLeaving = true;

        overlay.classList.remove('is-large');

        if (settings.immediate) {
            overlay.classList.remove('is-appearing', 'is-leaving');
            activeCreature = null;
            isLeaving = false;
            return;
        }

        overlay.classList.add('is-leaving');

        transitionTimer = setTimeout(function () {
            if (token !== transitionToken) return;

            overlay.classList.remove('is-appearing', 'is-leaving', 'is-large');
            imgEl.removeAttribute('src');
            nameEl.textContent = '';
            activeCreature = null;
            isLeaving = false;
            transitionTimer = null;
        }, 700);
    }

    // ---------------------------------------------------------------------
    // 8. Ручное отпускание.
    // Запоминаем ID существа. Оно не появится снова, пока шар не выйдет
    // за радиус его зоны. Это исключает повторное всплытие при каждом
    // очередном обновлении координат.
    // ---------------------------------------------------------------------
    function releaseActiveCreature() {
        if (!activeCreature) return;

        dismissedIds.add(activeCreature.id);
        hideCreature();
    }

    if (releaseBtn) {
        releaseBtn.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            releaseActiveCreature();
        });
    }

    // ---------------------------------------------------------------------
    // 9. Обновление положения шара.
    // Вызывается только основным кодом полёта:
    // window.AerostarCreatures.update(currentLat, currentLon)
    // ---------------------------------------------------------------------
    function updateCreatures(lat, lon) {
        lat = Number(lat);
        lon = Number(lon);

        if (!validCoordinates(lat, lon)) {
            console.warn('[creatures] Получены некорректные координаты:', lat, lon);
            return;
        }

        lastPosition = { lat, lon };

        if (caption) {
            caption.textContent =
                'широта ' + lat.toFixed(3) + ', долгота ' + lon.toFixed(3);
        }

        // Сбрасываем запрет повторного показа только после фактического
        // выхода шара из радиуса соответствующего существа.
        for (const creature of creatures) {
            if (dismissedIds.has(creature.id)) {
                const distance = distanceKm(lat, lon, creature.lat, creature.lon);
                if (distance > creature.radiusKm) {
                    dismissedIds.delete(creature.id);
                }
            }
        }

        const nearby = findNearby(lat, lon);

        // Если активное существо больше не в зоне шара — скрываем.
        if (activeCreature) {
            const activeDistance = distanceKm(
                lat, lon, activeCreature.lat, activeCreature.lon
            );

            if (activeDistance > activeCreature.radiusKm) {
                hideCreature();
            }
        }

        // Не показываем новое существо, пока предыдущее уходит.
        if (!nearby || dismissedIds.has(nearby.id) || isLeaving) {
            return;
        }

        if (!activeCreature) {
            showCreature(nearby);
            return;
        }

        // Если зоны пересеклись, переключаемся на ближайшее существо.
        if (activeCreature.id !== nearby.id) {
            hideCreature({ immediate: true });
            showCreature(nearby);
        }
    }

    // ---------------------------------------------------------------------
    // 10. Публичный API. Никаких демо-кликов и тестового вызова при загрузке.
    // ---------------------------------------------------------------------
    window.AerostarCreatures = {
        update: updateCreatures,
        hide: function () {
            if (activeCreature) dismissedIds.add(activeCreature.id);
            hideCreature();
        },
        list: creatures,
        getPosition: function () {
            return lastPosition ? { ...lastPosition } : null;
        }
    };

    console.log('[creatures] Модуль загружен. Существ в базе:', creatures.length);
})();
