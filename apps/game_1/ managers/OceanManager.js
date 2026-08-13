// managers/OceanManager.js


class OceanManager {


    constructor() {


        this.current = {

            speed: 0,
            direction: 0,
            timestamp: Date.now()

        };


        this.cache = new Map();


        /*
         * обновление течения
         * позже можно заменить API
         */

        this.updateInterval =
            60 * 60 * 1000;



    }





    // ----------------------------------------------------------
    // World.js вызывает этот метод
    // ----------------------------------------------------------

    get(lat, lng) {


        const key =
            this.getCacheKey(
                lat,
                lng
            );



        const cached =
            this.cache.get(key);



        if (cached) {

            return cached;

        }



        /*
         * Пока простая модель течений.
         *
         * Позже здесь будет:
         *
         * Copernicus Marine
         * NOAA
         * HYCOM
         *
         */


        const current =
            this.calculateCurrent(
                lat,
                lng
            );



        this.cache.set(
            key,
            current
        );


        return current;


    }







    // ----------------------------------------------------------
    // Модель течения
    // ----------------------------------------------------------

    calculateCurrent(lat, lng) {



        /*
         * Базовое океаническое течение.
         *
         * Скорость:
         * метров в секунду
         *
         * Направление:
         * градусы
         *
         * 0   север
         * 90  восток
         * 180 юг
         * 270 запад
         */



        return {


            speed:
                0.05,


            direction:
                90,


            timestamp:
                Date.now()


        };


    }







    // ----------------------------------------------------------
    // Проверка берега
    // ----------------------------------------------------------

    isLand(lat, lng) {



        /*
         * Здесь будет проверка
         * по береговой линии.
         *
         * Пока океан открыт.
         */



        return false;


    }







    // ----------------------------------------------------------
    // Очистка кеша
    // ----------------------------------------------------------

    clear() {


        this.cache.clear();


    }







    // ----------------------------------------------------------
    // Ключ кеша
    // ----------------------------------------------------------

    getCacheKey(lat, lng) {


        /*
         * 0.1 градуса примерно 10 км
         *
         * Нет смысла хранить
         * каждую точку.
         */


        const rLat =
            Math.round(
                lat * 10
            ) / 10;



        const rLng =
            Math.round(
                lng * 10
            ) / 10;



        return `${rLat}:${rLng}`;


    }



}



module.exports = OceanManager;
