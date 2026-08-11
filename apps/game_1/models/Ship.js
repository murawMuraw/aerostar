
// models/Ship.js

class Ship {

    constructor(type = "klip_20") {

        // --------------------------------------------------
        // Идентификация
        // --------------------------------------------------

        this.id = null;

        this.type = type;
        this.name = "Klip_20";

        // --------------------------------------------------
        // Положение
        // --------------------------------------------------

        this.lat = 0;
        this.lng = 0;

        // Последнее серверное обновление
        this.lastUpdate = Date.now();

        // --------------------------------------------------
        // Движение
        // --------------------------------------------------

        // Курс корабля в градусах
        // 0   = север
        // 90  = восток
        // 180 = юг
        // 270 = запад
        this.heading = 0;

        // Скорость в узлах
        this.speed = 0;

        // --------------------------------------------------
        // Управление
        // --------------------------------------------------

        // Положение руля:
        // -1 = полностью влево
        //  0 = прямо
        //  1 = полностью вправо
        this.rudder = 0;

        // Парус:
        // 0 = убраны
        // 1 = полностью подняты
        this.sail = 1;

        // --------------------------------------------------
        // Якорь
        // --------------------------------------------------

        this.anchor = false;

        // --------------------------------------------------
        // Состояние корабля
        // --------------------------------------------------

        // Корабль сел на мель / столкнулся с сушей
        this.grounded = false;

        // Игра закончена
        this.finished = false;

        // --------------------------------------------------
        // Окружение
        // --------------------------------------------------

        // Текущий ветер
        this.wind = {
            speed: 0,
            direction: 0
        };

        // Текущее течение
        this.current = {
            speed: 0,
            direction: 0
        };
    }


    // ======================================================
    // ПОЛОЖЕНИЕ
    // ======================================================

    setPosition(lat, lng) {

        this.lat = Number(lat);
        this.lng = Number(lng);

        this.lastUpdate = Date.now();
    }


    // ======================================================
    // КУРС
    // ======================================================

    setHeading(heading) {

        let value = Number(heading);

        if (!Number.isFinite(value)) {
            return false;
        }

        // Нормализуем 0...360
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

        // Ограничиваем диапазон -1...1
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

        // 0...1
        value = Math.max(0, Math.min(1, value));

        this.sail = value;

        return true;
    }


    // ======================================================
    // ЯКОРЬ
    // ======================================================

    dropAnchor() {

        this.anchor = true;
        this.speed = 0;

        return true;
    }


    raiseAnchor() {

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

    setWind(speed, direction) {

        this.wind.speed = Number(speed) || 0;

        let value = Number(direction) || 0;

        value = ((value % 360) + 360) % 360;

        this.wind.direction = value;
    }


    // ======================================================
    // ТЕЧЕНИЕ
    // ======================================================

    setCurrent(speed, direction) {

        this.current.speed = Number(speed) || 0;

        let value = Number(direction) || 0;

        value = ((value % 360) + 360) % 360;

        this.current.direction = value;
    }


    // ======================================================
    // ОСТАНОВКА НА СУШЕ
    // ======================================================

    ground() {

        this.grounded = true;
        this.speed = 0;
        this.rudder = 0;

        return true;
    }


    // ======================================================
    // СОСТОЯНИЕ
    // ======================================================

    isMoving() {

        return !this.anchor &&
               !this.grounded &&
               !this.finished;
    }


    // ======================================================
    // СЕРВЕРНОЕ СОСТОЯНИЕ
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
                direction: this.wind.direction
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

