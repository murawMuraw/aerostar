// core/World.js

class World {

    constructor(game) {

        this.game = game;

        this.running = false;

        this.lastUpdate = null;

        // Мир рассчитывается примерно раз в секунду
        this.updateInterval = 1000;

        // Защита от параллельных обновлений
        this.updating = false;
    }


    // ======================================================
    // ЗАПУСК
    // ======================================================

    start() {

        if (this.running) {
            return;
        }

        this.running = true;
        this.lastUpdate = Date.now();

        console.log("World started");
    }


    // ======================================================
    // ОСТАНОВКА
    // ======================================================

    stop() {

        this.running = false;
        this.lastUpdate = null;

        console.log("World stopped");
    }


    // ======================================================
    // ОБНОВЛЕНИЕ МИРА
    // ======================================================

    async update(dt) {

        if (!this.running) {
            return;
        }

        // Не допускаем одновременных запросов
        // к WindManager / OceanManager.

        if (this.updating) {
            return;
        }

        this.updating = true;

        try {

            const ship = this.game.ships.getShip();

            if (!ship) {
                return;
            }


            // --------------------------------------------------
            // КОРАБЛЬ НА СУШЕ
            // --------------------------------------------------

            if (ship.grounded) {

                ship.speed = 0;

                return;
            }


            // --------------------------------------------------
            // ЯКОРЬ
            // --------------------------------------------------

            if (ship.anchor) {

                ship.speed = 0;

                ship.lastUpdate = Date.now();

                return;
            }


            // --------------------------------------------------
            // ИГРА ЗАКОНЧЕНА
            // --------------------------------------------------

            if (ship.finished) {

                ship.speed = 0;

                return;
            }


            // --------------------------------------------------
            // ПАРУСЫ УБРАНЫ
            // --------------------------------------------------

            if (ship.sail <= 0) {

                ship.speed = 0;

                return;
            }


            // --------------------------------------------------
            // ВЕТЕР
            // --------------------------------------------------

            const wind = await this.game.wind.get(
                ship.lat,
                ship.lng
            );


            // --------------------------------------------------
            // ТЕЧЕНИЕ
            // --------------------------------------------------

            let current = null;

            if (
                this.game.ocean &&
                typeof this.game.ocean.get === "function"
            ) {
                current = await this.game.ocean.get(
                    ship.lat,
                    ship.lng
                );
            }


            // --------------------------------------------------
            // Если ветер отсутствует
            // --------------------------------------------------

            if (!wind) {

                ship.speed = 0;

                return;
            }


            // --------------------------------------------------
            // Сохраняем окружение в корабле
            // --------------------------------------------------

            ship.setWind(
                wind.speed,
                wind.direction,
                wind.gust
            );


            if (current) {

                ship.setCurrent(
                    current.speed,
                    current.direction
                );

            } else {

                ship.setCurrent(0, 0);
            }


            // --------------------------------------------------
            // РАСЧЁТ
            // --------------------------------------------------

            const movement =
                this.calculateMovement(
                    ship,
                    wind,
                    current,
                    dt
                );


            if (!movement) {

                ship.speed = 0;

                return;
            }


            const newLat =
                ship.lat + movement.dLat;

            const newLng =
                ship.lng + movement.dLng;


            // --------------------------------------------------
            // ПРОВЕРКА СУШИ
            // --------------------------------------------------

            const collision =
                this.checkLandCollision(
                    ship.lat,
                    ship.lng,
                    newLat,
                    newLng
                );


            if (collision) {

                ship.ground();

                console.log(
                    `Ship stopped by land at ${ship.lat}, ${ship.lng}`
                );

                this.saveShipState();

                this.game.broadcastState();

                return;
            }


            // --------------------------------------------------
            // НОВАЯ ПОЗИЦИЯ
            // --------------------------------------------------

            ship.lat = newLat;
            ship.lng = newLng;

            ship.speed = movement.speed;

            ship.lastUpdate = Date.now();


            // --------------------------------------------------
            // СОХРАНЕНИЕ
            // --------------------------------------------------

            this.saveShipState();


            // --------------------------------------------------
            // SOCKET.IO
            // --------------------------------------------------

            this.game.broadcastState();

        } catch (error) {

            console.error(
                "World update error:",
                error
            );

        } finally {

            this.updating = false;
        }
    }


    // ======================================================
    // ФИЗИКА
    // ======================================================

    calculateMovement(
        ship,
        wind,
        current,
        dt
    ) {

        if (!wind) {
            return null;
        }


        // --------------------------------------------------
        // ВЕТЕР
        // --------------------------------------------------

        const windSpeed =
            Number(wind.speed) || 0;

        const windDirection =
            Number(wind.direction) || 0;


        // --------------------------------------------------
        // ТЕЧЕНИЕ
        // --------------------------------------------------

        const currentSpeed =
            current &&
            Number.isFinite(Number(current.speed))
                ? Number(current.speed)
                : 0;

        const currentDirection =
            current &&
            Number.isFinite(Number(current.direction))
                ? Number(current.direction)
                : 0;


        // --------------------------------------------------
        // ПАРУС
        // --------------------------------------------------

        const sailPower =
            Math.max(
                0,
                Math.min(
                    1,
                    Number(ship.sail) || 0
                )
            );


        if (sailPower <= 0) {
            return null;
        }


        // --------------------------------------------------
        // УГОЛ МЕЖДУ КУРСОМ И ВЕТРОМ
        // --------------------------------------------------

        const heading =
            Number(ship.heading) || 0;

        let angle =
            Math.abs(
                windDirection - heading
            );

        if (angle > 180) {
            angle = 360 - angle;
        }


        /*
         * Простая модель эффективности паруса.
         *
         * При ветре строго сзади/спереди
         * эффективность ниже.
         *
         * Максимум — при боковом ветре.
         */

        const angleRad =
            angle * Math.PI / 180;

        const sailEfficiency =
            Math.max(
                0.15,
                Math.sin(angleRad)
            );


        // --------------------------------------------------
        // СКОРОСТЬ ОТ ВЕТРА
        // --------------------------------------------------

        const windVelocity =
            windSpeed *
            sailPower *
            sailEfficiency;


        // --------------------------------------------------
        // ВЕКТОР ВЕТРА
        // --------------------------------------------------

        const windRad =
            windDirection *
            Math.PI / 180;


        const currentRad =
            currentDirection *
            Math.PI / 180;


        let velocityX =
            windVelocity *
            Math.sin(windRad);


        let velocityY =
            windVelocity *
            Math.cos(windRad);


        // --------------------------------------------------
        // ТЕЧЕНИЕ
        // --------------------------------------------------

        velocityX +=
            currentSpeed *
            Math.sin(currentRad);

        velocityY +=
            currentSpeed *
            Math.cos(currentRad);


        // --------------------------------------------------
        // ИТОГОВАЯ СКОРОСТЬ
        // --------------------------------------------------

        const environmentalSpeed =
            Math.sqrt(
                velocityX * velocityX +
                velocityY * velocityY
            );


        if (
            environmentalSpeed <= 0 &&
            currentSpeed <= 0
        ) {
            return null;
        }


        // --------------------------------------------------
        // УПРАВЛЕНИЕ РУЛЁМ
        // --------------------------------------------------

        const rudder =
            Number(ship.rudder) || 0;


        /*
         * Скорость поворота.
         *
         * 1 единица rudder = 5 градусов/секунду
         */

        const turnRate =
            5 * rudder;


        let newHeading =
            heading +
            turnRate * dt;


        newHeading =
            ((newHeading % 360) + 360) % 360;


        ship.heading = newHeading;


        // --------------------------------------------------
        // КУРС КОРАБЛЯ
        // --------------------------------------------------

        const headingRad =
            newHeading *
            Math.PI / 180;


        /*
         * Сейчас управление кораблём
         * осуществляется через его курс.
         *
         * Течение продолжает воздействовать
         * независимо от курса.
         */


        const sailVelocity =
            windVelocity;


        let shipVelocityX =
            sailVelocity *
            Math.sin(headingRad);

        let shipVelocityY =
            sailVelocity *
            Math.cos(headingRad);


        // Течение добавляется к движению

        shipVelocityX +=
            currentSpeed *
            Math.sin(currentRad);

        shipVelocityY +=
            currentSpeed *
            Math.cos(currentRad);


        // --------------------------------------------------
        // ИТОГОВАЯ СКОРОСТЬ
        // --------------------------------------------------

        const speed =
            Math.sqrt(
                shipVelocityX * shipVelocityX +
                shipVelocityY * shipVelocityY
            );


        // --------------------------------------------------
        // МЕТРЫ/СЕКУНДУ
        // --------------------------------------------------

        const metersPerSecond =
            speed * 0.514444;


        const distance =
            metersPerSecond * dt;


        // --------------------------------------------------
        // КООРДИНАТЫ
        // --------------------------------------------------

        const earthRadius = 6371000;


        const dLat =
            (
                distance *
                Math.cos(headingRad)
            ) /
            earthRadius *
            (180 / Math.PI);


        const latitudeRad =
            ship.lat *
            Math.PI / 180;


        const cosLat =
            Math.cos(latitudeRad);


        // Защита около полюсов

        if (Math.abs(cosLat) < 0.000001) {
            return {
                dLat,
                dLng: 0,
                speed
            };
        }


        const dLng =
            (
                distance *
                Math.sin(headingRad)
            ) /
            (
                earthRadius *
                cosLat
            ) *
            (180 / Math.PI);


        return {

            dLat,
            dLng,

            speed
        };
    }


    // ======================================================
    // ПРОВЕРКА СУШИ
    // ======================================================

    checkLandCollision(
        oldLat,
        oldLng,
        newLat,
        newLng
    ) {

        if (
            this.game.ocean &&
            typeof this.game.ocean.isLand === "function"
        ) {

            return this.game.ocean.isLand(
                newLat,
                newLng
            );
        }


        return false;
    }


    // ======================================================
    // СОХРАНЕНИЕ
    // ======================================================

    saveShipState() {

        /*
         * Сам World не знает структуру ship.json.
         *
         * Сохраняем через ShipManager,
         * если он предоставляет такой метод.
         */

        if (
            this.game.ships &&
            typeof this.game.ships.save === "function"
        ) {

            try {
                this.game.ships.save();
            } catch (error) {

                console.error(
                    "Failed to save ship:",
                    error.message
                );
            }
        }
    }
}


module.exports = World;
