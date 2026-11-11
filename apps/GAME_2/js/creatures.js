/*
 * js/creatures.js
 *
 * Magic — географические встречи с мифическими существами.
 *
 * База существ загружается из ./data/creatures.json.
 * Существо появляется, если шар находится:
 *   1. В нужной географической зоне (zone_id).
 *   2. В пределах радиуса появления существа (radiusKm).
 *
 * Сохраняется прежняя механика:
 *   - плавное появление;
 *   - увеличение изображения;
 *   - исчезновение при выходе из радиуса;
 *   - ручное отпускание существа;
 *   - запрет повторного появления до выхода из зоны.
 */

(function () {
    'use strict';

    // ------------------------------------------------------------
    // 1. БАЗА СУЩЕСТВ
    // ------------------------------------------------------------

    const CREATURES_URL = './data/creatures.json';

    // Массив заполняется после загрузки JSON.
    const creatures = [];

    let creaturesLoaded = false;
    let creaturesLoadError = null;

    // ------------------------------------------------------------
    // 2. DOM-ЭЛЕМЕНТЫ
    // ------------------------------------------------------------

    const overlay = document.getElementById('creatureOverlay');
    const imgEl = document.getElementById('creatureImg');
    const nameEl = document.getElementById('creatureName');
    const releaseBtn = document.getElementById('releaseBtn');
    const caption = document.getElementById('mapCaption');

    if (!overlay || !imgEl || !nameEl) {
        console.warn(
            '[creatures] Не найдены creatureOverlay / creatureImg / creatureName'
        );
        return;
    }

    // ------------------------------------------------------------
    // 3. СОСТОЯНИЕ МОДУЛЯ
    // ------------------------------------------------------------

    let activeCreature = null;
    let lastPosition = null;
    let lastZoneId = null;

    let transitionTimer = null;
    let transitionToken = 0;
    let isLeaving = false;

    const dismissedIds = new Set();

    // ------------------------------------------------------------
    // 4. ГЕОГРАФИЧЕСКИЕ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // ------------------------------------------------------------

    function distanceKm(lat1, lon1, lat2, lon2) {
        const toRad = value => value * Math.PI / 180;

        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);

        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) *
            Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;

        const safeA = Math.min(1, Math.max(0, a));

        return 6371 * 2 * Math.atan2(
            Math.sqrt(safeA),
            Math.sqrt(1 - safeA)
        );
    }

    function validCoordinates(lat, lon) {
        return Number.isFinite(lat) &&
            Number.isFinite(lon) &&
            lat >= -90 && lat <= 90 &&
            lon >= -180 && lon <= 180;
    }

    /*
     * Получаем ID зоны.
     *
     * Приоритет:
     *   1. Зона, переданная третьим аргументом update().
     *   2. window.App.currentZone.
     *   3. Определение через MagicZones.
     */

    function getZoneId(lat, lon, suppliedZone) {
        if (typeof suppliedZone === 'string') {
            return suppliedZone;
        }

        if (suppliedZone && typeof suppliedZone === 'object') {
            return suppliedZone.id || suppliedZone.zone_id || null;
        }

        const currentZone = window.App?.currentZone;

        if (currentZone) {
            if (typeof currentZone === 'string') {
                return currentZone;
            }

            if (currentZone.id || currentZone.zone_id) {
                return currentZone.id || currentZone.zone_id;
            }
        }

        if (window.MagicZones?.findByCoordinates) {
            const found = window.MagicZones.findByCoordinates(lat, lon);

            if (found) {
                return found.id || found.zone_id || null;
            }
        }

        return null;
    }

    // ------------------------------------------------------------
    // 5. ЗАГРУЗКА БАЗЫ ИЗ JSON
    // ------------------------------------------------------------

    function normalizeCreature(raw) {
        if (!raw || !raw.id) return null;

        const lat = Number(raw.lat);
        const lon = Number(raw.lon);
        const radiusKm = Number(raw.radiusKm);

        if (!validCoordinates(lat, lon) ||
            !Number.isFinite(radiusKm) ||
            radiusKm <= 0) {
            console.warn(
                '[creatures] Пропущена запись с некорректными координатами:',
                raw.id
            );
            return null;
        }

        /*
         * Временная совместимость со старым creatures.json:
         * все нынешние записи — греческая мифология.
         *
         * После добавления zone_id во все записи JSON
         * эта подстановка будет использоваться только
         * для старых записей без zone_id.
         */

        let zoneId = raw.zone_id || null;

        if (!zoneId && raw.originType === 'greek_mythology') {
            zoneId = 'zone_01';
        }

        if (!zoneId) {
            console.warn(
                '[creatures] У существа отсутствует zone_id:',
                raw.id
            );
            return null;
        }

        return {
            ...raw,
            lat,
            lon,
            radiusKm,
            zone_id: zoneId,
            name: raw.name || raw.name_en || raw.id,
            img: raw.img || ''
        };
    }

    async function loadCreatures() {
        try {
            const response = await fetch(CREATURES_URL, {
                headers: {
                    Accept: 'application/json'
                },
                cache: 'no-cache'
            });

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}: ${CREATURES_URL}`
                );
            }

            const data = await response.json();

            if (!Array.isArray(data)) {
                throw new Error('creatures.json должен содержать массив');
            }

            creatures.length = 0;

            for (const raw of data) {
                const creature = normalizeCreature(raw);

                if (creature) {
                    creatures.push(creature);
                }
            }

            creaturesLoaded = true;

            console.log(
                '[creatures] База загружена:',
                creatures.length,
                'существ'
            );

            // Если шар уже движется — сразу проверяем его положение.
            if (lastPosition) {
                processPosition(
                    lastPosition.lat,
                    lastPosition.lon,
                    lastZoneId
                );
            }

            return creatures;

        } catch (error) {
            creaturesLoadError = error;

            console.error(
                '[creatures] Ошибка загрузки creatures.json:',
                error
            );

            return [];
        }
    }

    // ------------------------------------------------------------
    // 6. ПОИСК БЛИЖАЙШЕГО СУЩЕСТВА
    // ------------------------------------------------------------

    function findNearby(lat, lon, zoneId) {
        if (!zoneId) return null;

        let nearest = null;
        let nearestDistance = Infinity;

        for (const creature of creatures) {

            // Сначала проверяем географическую зону.
            if (creature.zone_id !== zoneId) {
                continue;
            }

            const distance = distanceKm(
                lat,
                lon,
                creature.lat,
                creature.lon
            );

            if (
                distance <= creature.radiusKm &&
                distance < nearestDistance
            ) {
                nearest = creature;
                nearestDistance = distance;
            }
        }

        return nearest;
    }

    // ------------------------------------------------------------
    // 7. УПРАВЛЕНИЕ ТАЙМЕРАМИ
    // ------------------------------------------------------------

    function clearTransitionTimer() {
        if (transitionTimer !== null) {
            clearTimeout(transitionTimer);
            transitionTimer = null;
        }
    }

    // ------------------------------------------------------------
    // 8. ПОЯВЛЕНИЕ СУЩЕСТВА
    // ------------------------------------------------------------

    function showCreature(creature) {
        if (
            activeCreature &&
            activeCreature.id === creature.id &&
            !isLeaving
        ) {
            return;
        }

        clearTransitionTimer();

        const token = ++transitionToken;

        activeCreature = creature;
        isLeaving = false;

        imgEl.alt = creature.name;

        imgEl.onerror = function () {
            console.error(
                '[creatures] Не удалось загрузить изображение:',
                creature.img
            );
        };

        imgEl.src = creature.img;
        nameEl.textContent = creature.name;

        overlay.classList.remove(
            'is-large',
            'is-leaving',
            'is-appearing'
        );

        requestAnimationFrame(function () {
            if (token !== transitionToken) return;

            overlay.classList.add('is-appearing');

            transitionTimer = setTimeout(function () {
                if (
                    token !== transitionToken ||
                    !activeCreature ||
                    activeCreature.id !== creature.id
                ) {
                    return;
                }

                overlay.classList.add('is-large');
                transitionTimer = null;

            }, 80);
        });

        console.log(
            '[creatures] Появление:',
            creature.name,
            '| зона:',
            creature.zone_id
        );
    }

    // ------------------------------------------------------------
    // 9. ИСЧЕЗНОВЕНИЕ СУЩЕСТВА
    // ------------------------------------------------------------

    function hideCreature(options) {
        const settings = options || {};

        if (!activeCreature) return;

        clearTransitionTimer();

        const token = ++transitionToken;

        isLeaving = true;

        overlay.classList.remove('is-large');

        if (settings.immediate) {
            overlay.classList.remove(
                'is-appearing',
                'is-leaving'
            );

            activeCreature = null;
            isLeaving = false;

            return;
        }

        overlay.classList.add('is-leaving');

        transitionTimer = setTimeout(function () {
            if (token !== transitionToken) return;

            overlay.classList.remove(
                'is-appearing',
                'is-leaving',
                'is-large'
            );

            imgEl.removeAttribute('src');
            nameEl.textContent = '';

            activeCreature = null;
            isLeaving = false;
            transitionTimer = null;

            console.log('[creatures] Существо исчезло');

        }, 700);
    }

    // ------------------------------------------------------------
    // 10. РУЧНОЕ ОТПУСКАНИЕ
    // ------------------------------------------------------------

    function releaseActiveCreature() {
        if (!activeCreature) return;

        dismissedIds.add(activeCreature.id);

        console.log(
            '[creatures] Существо отпущено:',
            activeCreature.name
        );

        hideCreature();
    }

    if (releaseBtn) {
        releaseBtn.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();

            releaseActiveCreature();
        });
    }

    // ------------------------------------------------------------
    // 11. ОБРАБОТКА ПОЛОЖЕНИЯ ШАРА
    // ------------------------------------------------------------

    function processPosition(lat, lon, zoneId) {

        if (!creaturesLoaded) return;

        if (caption) {
            caption.textContent =
                'широта ' + lat.toFixed(3) +
                ', долгота ' + lon.toFixed(3);
        }

        // Если зона не определена, не показываем существ.
        if (!zoneId) {
            if (activeCreature) {
                hideCreature();
            }

            return;
        }

        // Сбрасываем ручное отпускание после выхода из радиуса.
        for (const creature of creatures) {
            if (dismissedIds.has(creature.id)) {
                const distance = distanceKm(
                    lat,
                    lon,
                    creature.lat,
                    creature.lon
                );

                if (distance > creature.radiusKm) {
                    dismissedIds.delete(creature.id);
                }
            }
        }

        // Ищем существо только в текущей зоне.
        const nearby = findNearby(lat, lon, zoneId);

        // Если активное существо больше не в своей зоне или радиусе —
        // начинаем его исчезновение.
        if (activeCreature) {
            const activeDistance = distanceKm(
                lat,
                lon,
                activeCreature.lat,
                activeCreature.lon
            );

            const wrongZone =
                activeCreature.zone_id !== zoneId;

            if (
                wrongZone ||
                activeDistance > activeCreature.radiusKm
            ) {
                hideCreature();
            }
        }

        // Не показываем новое существо, пока предыдущее исчезает.
        if (
            !nearby ||
            dismissedIds.has(nearby.id) ||
            isLeaving
        ) {
            return;
        }

        if (!activeCreature) {
            showCreature(nearby);
            return;
        }

        // Если зоны существ пересеклись — переключаемся на ближайшее.
        if (activeCreature.id !== nearby.id) {
            hideCreature({ immediate: true });
            showCreature(nearby);
        }
    }

    // ------------------------------------------------------------
    // 12. ПУБЛИЧНОЕ ОБНОВЛЕНИЕ
    // ------------------------------------------------------------

    /*
     * Основной вызов:
     *
     * AerostarCreatures.update(lat, lon, zone)
     *
     * Третий аргумент необязателен.
     * Если он не передан, модуль пытается получить зону
     * из App.currentZone или MagicZones.
     */

    function updateCreatures(lat, lon, suppliedZone) {
        lat = Number(lat);
        lon = Number(lon);

        if (!validCoordinates(lat, lon)) {
            console.warn(
                '[creatures] Некорректные координаты:',
                lat,
                lon
            );
            return;
        }

        lastPosition = { lat, lon };

        lastZoneId = getZoneId(
            lat,
            lon,
            suppliedZone
        );

        if (!creaturesLoaded) {
            return;
        }

        processPosition(lat, lon, lastZoneId);
    }

    // ------------------------------------------------------------
    // 13. ПУБЛИЧНЫЙ API
    // ------------------------------------------------------------

    window.AerostarCreatures = {
        update: updateCreatures,

        hide: function () {
            if (activeCreature) {
                dismissedIds.add(activeCreature.id);
            }

            hideCreature();
        },

        list: creatures,

        getPosition: function () {
            return lastPosition
                ? { ...lastPosition }
                : null;
        },

        getCurrentZone: function () {
            return lastZoneId;
        },

        isLoaded: function () {
            return creaturesLoaded;
        },

        getLoadError: function () {
            return creaturesLoadError;
        },

        reload: loadCreatures
    };

    // ------------------------------------------------------------
    // 14. ЗАПУСК ЗАГРУЗКИ
    // ------------------------------------------------------------

    loadCreatures();

})();
