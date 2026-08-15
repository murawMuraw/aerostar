// models/Ship.js

class Ship {

    constructor(type = "klip_20", name = "Klip_20") {

        // ==================================================
        // ИДЕНТИФИКАЦИЯ
        // ==================================================

        this.id = null;
        this.type = type;
        this.name = name;

        // ==================================================
        // ПОЛОЖЕНИЕ
        // ==================================================

        this.lat = 0;
        this.lng = 0;

        this.lastUpdate = Date.now();

        // ==================================================
        // ДВИЖЕНИЕ
        // ==================================================

        // 0 = север
        // 90 = восток
        // 180 = юг
        // 270 = запад
        this.heading = 0;

        // Скорость в узлах
        this.speed = 0;

        // ==================================================
        // УПРАВЛЕНИЕ
        // ==================================================

        // -1 ... +1
        this.rudder = 0;

        // 0 ... 1
        this.sail = 1;

        // ==================================================
        // ЯКОРЬ
        // ==================================================

        this.anchor = false;

        // ==================================================
        // СОСТОЯНИЕ
        // ==================================================

        // Столкнулся с сушей
        this.grounded = false;

        // Зарезервировано для будущего завершения путешествия
        this.finished = false;

        // ==================================================
        // ОКРУЖЕНИЕ
        // ==================================================

        this.wind = {
            speed: 0,
            direction: 0,
            gust: 0
        };

        this.current = {
            speed: 0,
            direction: 0
        };
    }


    // ======================================================
    // ПОЛОЖЕНИЕ
    // ======================================================

    setPosition(lat, lng) {

        lat = Number(lat);
        lng = Number(lng);

        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
        ) {
            return false;
        }

        this.lat = lat;
        this.lng = lng;
        this.lastUpdate = Date.now();

        return true;
    }


    // ======================================================
    // КУРС
    // ======================================================

    setHeading(heading) {

        let value = Number(heading);

        if (!Number.isFinite(value)) {
            return false;
        }

        value = ((value % 360) + 360) % 360;

        this.heading = value;

        return true;
    }


    // ======================================================
    // РУЛЬ
    // ======================================================

    setRudder(rudder) {

        let value = Number(rudder);

        if (!Number.isFinite(value)) {
            return false;
        }

        value = Math.max(-1, Math.min(1, value));

        this.rudder = value;

        return true;
    }


    // ======================================================
    // ПАРУС
    // ======================================================

    setSail(sail) {

        let value = Number(sail);

        if (!Number.isFinite(value)) {
            return false;
        }

        value = Math.max(0, Math.min(1, value));

        this.sail = value;

        return true;
    }


    // ======================================================
    // ЯКОРЬ
    // ======================================================

    dropAnchor() {

        if (this.grounded || this.finished) {
            return false;
        }

        this.anchor = true;
        this.speed = 0;

        return true;
    }


    raiseAnchor() {

        if (this.grounded || this.finished) {
            return false;
        }

        this.anchor = false;

        return true;
    }


    toggleAnchor() {

        if (this.anchor) {
            return this.raiseAnchor();
        }

        return this.dropAnchor();
    }


    // ======================================================
    // ВЕТЕР
    // ======================================================

    setWind(speed, direction, gust = 0) {

        const windSpeed = Number(speed);
        const windDirection = Number(direction);
        const windGust = Number(gust);

        this.wind.speed =
            Number.isFinite(windSpeed)
                ? Math.max(0, windSpeed)
                : 0;

        this.wind.direction =
            Number.isFinite(windDirection)
                ? ((windDirection % 360) + 360) % 360
                : 0;

        this.wind.gust =
            Number.isFinite(windGust)
                ? Math.max(0, windGust)
                : 0;
    }


    // ======================================================
    // ТЕЧЕНИЕ
    // ======================================================

    setCurrent(speed, direction) {

        const currentSpeed = Number(speed);
        const currentDirection = Number(direction);

        this.current.speed =
            Number.isFinite(currentSpeed)
                ? Math.max(0, currentSpeed)
                : 0;

        this.current.direction =
            Number.isFinite(currentDirection)
                ? ((currentDirection % 360) + 360) % 360
                : 0;
    }


    // ======================================================
    // ОСТАНОВКА НА СУШЕ
    // ======================================================

    ground() {

        this.grounded = true;
        this.anchor = false;
        this.speed = 0;
        this.rudder = 0;

        return true;
    }


    // ======================================================
    // ПРОВЕРКА ДВИЖЕНИЯ
    // ======================================================

    isMoving() {

        return (
            !this.anchor &&
            !this.grounded &&
            !this.finished &&
            this.sail > 0
        );
    }


    // ======================================================
    // СОСТОЯНИЕ
    // ======================================================

    getState() {

        return {

            id: this.id,

            type: this.type,
            name: this.name,

            lat: this.lat,
            lng: this.lng,

            heading: this.heading,
            speed: this.speed,

            rudder: this.rudder,
            sail: this.sail,

            anchor: this.anchor,

            grounded: this.grounded,
            finished: this.finished,

            wind: {
                speed: this.wind.speed,
                direction: this.wind.direction,
                gust: this.wind.gust
            },

            current: {
                speed: this.current.speed,
                direction: this.current.direction
            },

            lastUpdate: this.lastUpdate
        };
    }
}


module.exports = Ship;
