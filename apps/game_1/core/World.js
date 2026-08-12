// core/World.js

class World {

    constructor(game) {

        this.game = game;

        this.running = false;

        this.lastUpdate = null;

        // Интервал обновления мира.
        // Сам GameLoop вызывает update(dt).
        this.updateInterval = 1000;

    }

    // ----------------------------------------------------------
    // Запуск мира
    // ----------------------------------------------------------

    start() {

        if (this.running) {
            return;
        }

        this.running = true;
        this.lastUpdate = Date.now();

        console.log("World started");

    }

    // ----------------------------------------------------------
    // Остановка мира
    // ----------------------------------------------------------

    stop() {

        this.running = false;
        this.lastUpdate = null;

        console.log("World stopped");

    }

    // ----------------------------------------------------------
    // Игровой тик
    // ----------------------------------------------------------

    update(dt) {

        if (!this.running) {
            return;
        }

        const ship = this.game.ships.getPlayerShip();

        if (!ship) {
            return;
        }

        // ------------------------------------------------------
        // Якорь
        // ------------------------------------------------------

        if (ship.anchor === true) {

            ship.speed = 0;

            return;
        }

        // ------------------------------------------------------
        // Корабль уже остановлен сушей
        // ------------------------------------------------------

        if (ship.grounded === true) {

            ship.speed = 0;

            return;
        }

        // ------------------------------------------------------
        // Если нет паруса — корабль не движется
        // ------------------------------------------------------

        if (!ship.sail) {

            ship.speed = 0;

            return;
        }

        // ------------------------------------------------------
        // Получаем ветер
        // ------------------------------------------------------

        const wind = this.game.wind.get(
            ship.lat,
            ship.lng
        );

        // ------------------------------------------------------
        // Получаем течение
        // ------------------------------------------------------

        const current = this.game.ocean.get(
            ship.lat,
            ship.lng
        );

        // ------------------------------------------------------
        // Рассчитываем движение
        // ------------------------------------------------------

        const movement = this.calculateMovement(
            ship,
            wind,
            current,
            dt
        );

        if (!movement) {
            return;
        }

        const newLat = ship.lat + movement.dLat;
        const newLng = ship.lng + movement.dLng;

        // ------------------------------------------------------
        // Проверяем столкновение с сушей
        // ------------------------------------------------------

        const collision = this.checkLandCollision(
            ship.lat,
            ship.lng,
            newLat,
            newLng
        );

        if (collision) {

            ship.grounded = true;
            ship.speed = 0;

            console.log(
                `Ship stopped by land at ${ship.lat}, ${ship.lng}`
            );

            return;
        }

        // ------------------------------------------------------
        // Обновляем координаты
        // ------------------------------------------------------

        ship.lat = newLat;
        ship.lng = newLng;

        ship.lastUpdate = Date.now();

        ship.speed = movement.speed;

        // ------------------------------------------------------
        // Уведомляем клиентов
        // ------------------------------------------------------

        if (this.game.broadcastState) {
            this.game.broadcastState();
        }

    }

    // ----------------------------------------------------------
    // Расчёт движения
    // ----------------------------------------------------------

    calculateMovement(ship, wind, current, dt) {

        if (!wind) {
            return null;
        }

        /*
         * Ветер:
         *
         * wind.speed      скорость
         * wind.direction  направление в градусах
         *
         * Течение:
         *
         * current.speed
         * current.direction
         */

        const windSpeed = Number(wind.speed) || 0;
        const windDirection = Number(wind.direction) || 0;

        const currentSpeed =
            current && Number(current.speed)
                ? Number(current.speed)
                : 0;

        const currentDirection =
            current && Number(current.direction)
                ? Number(current.direction)
                : 0;

        // ------------------------------------------------------
        // Скорость корабля зависит от настройки паруса
        // ------------------------------------------------------

        const sailPower = this.getSailPower(ship.sail);

        /*
         * Это пока базовая модель.
         *
         * Позже сюда можно добавить:
         *
         * - угол к ветру
         * - сопротивление корпуса
         * - поворот руля
         * - характеристики корабля
         */

        const windVelocity = windSpeed * sailPower;

        const windRad =
            windDirection * Math.PI / 180;

        const currentRad =
            currentDirection * Math.PI / 180;

        // ------------------------------------------------------
        // Суммируем ветер и течение
        // ------------------------------------------------------

        const velocityX =
            windVelocity * Math.sin(windRad) +
            currentSpeed * Math.sin(currentRad);

        const velocityY =
            windVelocity * Math.cos(windRad) +
            currentSpeed * Math.cos(currentRad);

        const speed = Math.sqrt(
            velocityX * velocityX +
            velocityY * velocityY
        );

        // ------------------------------------------------------
        // Руль
        // ------------------------------------------------------

        const rudder =
            Number(ship.rudder) || 0;

        const heading =
            Number(ship.heading) || 0;

        let finalHeading = heading + rudder;

        finalHeading %= 360;

        if (finalHeading < 0) {
            finalHeading += 360;
        }

        ship.heading = finalHeading;

        // ------------------------------------------------------
        // Перевод скорости в градусы координат
        //
        // Здесь используется приближённая модель.
        // 1 узел = 1852 м/час.
        // ------------------------------------------------------

        const metersPerSecond =
            speed * 0.514444;

        const distance =
            metersPerSecond * dt;

        const headingRad =
            finalHeading * Math.PI / 180;

        const earthRadius = 6371000;

        const dLat =
            (distance * Math.cos(headingRad))
            / earthRadius
            * (180 / Math.PI);

        const latitudeRad =
            ship.lat * Math.PI / 180;

        const cosLat =
            Math.cos(latitudeRad);

        const dLng =
            (distance * Math.sin(headingRad))
            / (earthRadius * cosLat)
            * (180 / Math.PI);

        return {

            dLat,
            dLng,

            speed

        };

    }

    // ----------------------------------------------------------
    // Мощность паруса
    // ----------------------------------------------------------

    getSailPower(sail) {

        if (sail === false || sail === 0) {
            return 0;
        }

        /*
         * Если sail — число,
         * используем его как коэффициент.
         */

        if (typeof sail === "number") {

            return Math.max(
                0,
                Math.min(1, sail)
            );

        }

        /*
         * Если sail — строка.
         */

        if (typeof sail === "string") {

            const value = sail.toLowerCase();

            if (value === "full") {
                return 1;
            }

            if (value === "half") {
                return 0.5;
            }

            if (value === "low") {
                return 0.25;
            }

            if (value === "none") {
                return 0;
            }

        }

        // По умолчанию паруса подняты полностью.

        return 1;

    }

    // ----------------------------------------------------------
    // Проверка суши
    // ----------------------------------------------------------

    checkLandCollision(
        oldLat,
        oldLng,
        newLat,
        newLng
    ) {

        /*
         * World не должен сам хранить карту суши.
         *
         * Проверку передаём OceanManager.
         */

        if (
            this.game.ocean &&
            typeof this.game.ocean.isLand === "function"
        ) {

            return this.game.ocean.isLand(
                newLat,
                newLng
            );

        }

        /*
         * Пока OceanManager ещё не умеет определять сушу.
         *
         * В этом случае считаем,
         * что столкновения нет.
         */

        return false;

    }

}

module.exports = World;
