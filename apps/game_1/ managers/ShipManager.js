// managers/ShipManager.js
const crypto = require("crypto");
const Ship = require("../models/Ship");

class ShipManager {

    constructor() {

        // Единственный корабль игры
        this.ship = null;

    }


    // ======================================================
    // СОЗДАНИЕ КОРАБЛЯ
    // ======================================================

    create(type = "klip_20", name = "Klip_20") {

        // Если корабль уже существует —
        // не создаём второй
        if (this.ship) {
            return this.ship;
        }

        const ship = new Ship(type);

        ship.id = crypto.randomUUID();
        ship.name = name;

        this.ship = ship;

        return ship;
    }


    // ======================================================
    // ПОЛУЧИТЬ КОРАБЛЬ
    // ======================================================

    get() {

        return this.ship;
    }


    // ======================================================
    // ПОЛУЧИТЬ СОСТОЯНИЕ
    // ======================================================

    getState() {

        if (!this.ship) {
            return null;
        }

        return this.ship.getState();
    }


    // ======================================================
    // ПОЛОЖЕНИЕ
    // ======================================================

    setPosition(lat, lng) {

        if (!this.ship) {
            return false;
        }

        this.ship.setPosition(lat, lng);

        return true;
    }


    // ======================================================
    // КУРС
    // ======================================================

    setHeading(heading) {

        if (!this.ship) {
            return false;
        }

        return this.ship.setHeading(heading);
    }


    // ======================================================
    // РУЛЬ
    // ======================================================

    setRudder(rudder) {

        if (!this.ship) {
            return false;
        }

        return this.ship.setRudder(rudder);
    }


    // ======================================================
    // ПАРУС
    // ======================================================

    setSail(sail) {

        if (!this.ship) {
            return false;
        }

        return this.ship.setSail(sail);
    }


    // ======================================================
    // ЯКОРЬ
    // ======================================================

    dropAnchor() {

        if (!this.ship) {
            return false;
        }

        return this.ship.dropAnchor();
    }


    raiseAnchor() {

        if (!this.ship) {
            return false;
        }

        return this.ship.raiseAnchor();
    }


    toggleAnchor() {

        if (!this.ship) {
            return false;
        }

        return this.ship.toggleAnchor();
    }


    // ======================================================
    // ВЕТЕР
    // ======================================================

    setWind(speed, direction) {

        if (!this.ship) {
            return false;
        }

        this.ship.setWind(speed, direction);

        return true;
    }


    // ======================================================
    // ТЕЧЕНИЕ
    // ======================================================

    setCurrent(speed, direction) {

        if (!this.ship) {
            return false;
        }

        this.ship.setCurrent(speed, direction);

        return true;
    }


    // ======================================================
    // ПРОВЕРКА ДВИЖЕНИЯ
    // ======================================================

    isMoving() {

        if (!this.ship) {
            return false;
        }

        return this.ship.isMoving();
    }


    // ======================================================
    // ПОСАДКА НА МЕЛЬ
    // ======================================================

    ground() {

        if (!this.ship) {
            return false;
        }

        return this.ship.ground();
    }


    // ======================================================
    // СКОРОСТЬ
    // ======================================================

    setSpeed(speed) {

        if (!this.ship) {
            return false;
        }

        const value = Number(speed);

        if (!Number.isFinite(value)) {
            return false;
        }

        this.ship.speed = Math.max(0, value);

        return true;
    }


    // ======================================================
    // ПОЛУЧИТЬ КОРАБЛЬ ДЛЯ WORLD
    // ======================================================

    getShip() {

        return this.ship;
    }


    // ======================================================
    // ПОЛУЧИТЬ ПУБЛИЧНОЕ СОСТОЯНИЕ
    // ======================================================

    getPublicState() {

        if (!this.ship) {
            return {
                exists: false
            };
        }

        return {
            exists: true,
            ship: this.ship.getState()
        };
    }


    // ======================================================
    // ОЧИСТКА
    // ======================================================

    clear() {

        this.ship = null;
    }

}


module.exports = ShipManager;

