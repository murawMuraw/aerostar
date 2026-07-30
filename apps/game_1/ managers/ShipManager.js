// managers/ShipManager.js

const crypto = require("crypto");
const Ship = require("../models/Ship");

class ShipManager {

    constructor() {

        // shipId -> Ship
        this.ships = new Map();

        // userId -> shipId
        this.playerShips = new Map();

        // type -> shipId
        // пока один корабль каждого типа
        this.typeShips = new Map();

    }

    /**
     * Создать корабль
     */
    create(type, name = "") {

        if (this.typeShips.has(type)) {
            throw new Error(`Ship type '${type}' already exists`);
        }

        const ship = new Ship(type);

        ship.id = crypto.randomUUID();
        ship.name = name;

        this.ships.set(ship.id, ship);
        this.typeShips.set(type, ship.id);

        return ship;

    }

    /**
     * Получить по shipId
     */
    get(shipId) {

        return this.ships.get(shipId) || null;

    }

    /**
     * Получить по типу
     */
    getByType(type) {

        const shipId = this.typeShips.get(type);

        if (!shipId) return null;

        return this.get(shipId);

    }

    /**
     * Получить корабль игрока
     */
    getByPlayer(userId) {

        const shipId = this.playerShips.get(userId);

        if (!shipId) return null;

        return this.get(shipId);

    }

    /**
     * Назначить владельца
     */
    assignOwner(shipId, player) {

        const ship = this.get(shipId);

        if (!ship)
            return false;

        // если корабль уже кому-то принадлежит
        if (ship.owner) {

            this.playerShips.delete(ship.owner.userId);

        }

        // если у игрока уже есть корабль
        const oldShip = this.getByPlayer(player.userId);

        if (oldShip) {

            oldShip.owner = null;

        }

        ship.owner = player;

        this.playerShips.set(player.userId, shipId);

        return true;

    }

    /**
     * Освободить корабль
     */
    release(shipId) {

        const ship = this.get(shipId);

        if (!ship)
            return false;

        if (ship.owner) {

            this.playerShips.delete(ship.owner.userId);

        }

        ship.owner = null;

        return true;

    }

    /**
     * Удалить корабль
     */
    remove(shipId) {

        const ship = this.get(shipId);

        if (!ship)
            return false;

        if (ship.owner) {

            this.playerShips.delete(ship.owner.userId);

        }

        this.typeShips.delete(ship.type);

        this.ships.delete(shipId);

        return true;

    }

    /**
     * Координаты
     */
    setPosition(shipId, lat, lng) {

        const ship = this.get(shipId);

        if (!ship)
            return false;

        ship.lat = lat;
        ship.lng = lng;
        ship.lastUpdate = Date.now();

        return true;

    }

    /**
     * Курс
     */
    setHeading(shipId, heading) {

        const ship = this.get(shipId);

        if (!ship)
            return false;

        ship.heading = heading;

        return true;

    }

    /**
     * Скорость
     */
    setSpeed(shipId, speed) {

        const ship = this.get(shipId);

        if (!ship)
            return false;

        ship.speed = speed;

        return true;

    }

    /**
     * Руль
     */
    setRudder(shipId, rudder) {

        const ship = this.get(shipId);

        if (!ship)
            return false;

        ship.rudder = rudder;

        return true;

    }

    /**
     * Парус
     */
    setSail(shipId, sail) {

        const ship = this.get(shipId);

        if (!ship)
            return false;

        ship.sail = sail;

        return true;

    }

    /**
     * Якорь
     */
    setAnchor(shipId, anchor) {

        const ship = this.get(shipId);

        if (!ship)
            return false;

        ship.anchor = anchor;

        return true;

    }

    /**
     * Есть ли корабль такого типа
     */
    hasType(type) {

        return this.typeShips.has(type);

    }

    /**
     * Свободен ли корабль
     */
    isAvailable(type) {

        const ship = this.getByType(type);

        if (!ship)
            return false;

        return ship.owner === null;

    }

    /**
     * Все корабли
     */
    getAll() {

        return [...this.ships.values()];

    }

    /**
     * Все активные корабли
     */
    getActive() {

        return this.getAll().filter(ship => ship.owner);

    }

    /**
     * Количество
     */
    count() {

        return this.ships.size;

    }

    /**
     * Очистить
     */
    clear() {

        this.ships.clear();
        this.playerShips.clear();
        this.typeShips.clear();

    }

}

module.exports = ShipManager;
