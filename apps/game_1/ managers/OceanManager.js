// managers/OceanManager.js

class OceanManager {

    constructor() {

        this.cache = new Map();

        this.cacheTTL = 30 * 60 * 1000;

    }

    // ----------------------------------------------------------
    // Получить течение в точке
    // ----------------------------------------------------------

    get(lat, lng) {

        if (
            !Number.isFinite(Number(lat)) ||
            !Number.isFinite(Number(lng))
        ) {
            return {
                speed: 0,
                direction: 0
            };
        }

        lat = Number(lat);
        lng = Number(lng);

        const key = this.getCacheKey(lat, lng);

        const cached = this.cache.get(key);

        if (
            cached &&
            Date.now() - cached.timestamp < this.cacheTTL
        ) {
            return cached.data;
        }

        /*
         * Пока используем базовую модель.
         *
         * Здесь позже можно подключить
         * реальный источник океанических течений.
         */

        const current = this.calculateCurrent(
            lat,
            lng
        );

        this.cache.set(key, {
            timestamp: Date.now(),
            data: current
        });

        return current;

    }

    // ----------------------------------------------------------
    // Модель течения
    // ----------------------------------------------------------

    calculateCurrent(lat, lng) {

        /*
         * Временная модель.
         *
         * Она НЕ является реальными
         * океаническими данными.
         *
         * Пока ставим слабое течение.
         */

        return {

            speed: 0.1,

            direction: 90

        };

    }

    // ----------------------------------------------------------
    // Проверка суши
    // ----------------------------------------------------------

    isLand(lat, lng) {

        /*
         * ВАЖНО:
         *
         * Этот метод нельзя делать через простую
         * проверку диапазона координат.
         *
         * Для реального столкновения с берегом
         * нужна геометрия береговой линии.
         *
         * Пока возвращаем false.
         */

        return false;

    }

    // ----------------------------------------------------------
    // Ключ кеша
    // ----------------------------------------------------------

    getCacheKey(lat, lng) {

        const roundedLat =
            Math.round(lat * 10) / 10;

        const roundedLng =
            Math.round(lng * 10) / 10;

        return `${roundedLat}:${roundedLng}`;

    }

    // ----------------------------------------------------------
    // Очистить кеш
    // ----------------------------------------------------------

    clearCache() {

        this.cache.clear();

    }

}

module.exports = OceanManager;
