// core/GameServer.js

const ShipManager = require("../managers/ShipManager");
const WindManager = require("../managers/WindManager");
const OceanManager = require("../managers/OceanManager");

const World = require("./World");
const GameLoop = require("./GameLoop");


class GameServer {

    constructor(io) {

        this.io = io;

        // ==================================================
        // ЕДИНСТВЕННЫЙ КОРАБЛЬ
        // ==================================================

        this.ships = new ShipManager();


        // ==================================================
        // ОКРУЖЕНИЕ
        // ==================================================

        this.wind = new WindManager();

        this.ocean = new OceanManager();


        // ==================================================
        // МИР
        // ==================================================

        this.world = new World(this);


        // ==================================================
        // ИГРОВОЙ ЦИКЛ
        // ==================================================

        this.loop = new GameLoop(this);


        // ==================================================
        // СОСТОЯНИЕ
        // ==================================================

        this.running = false;
    }


    // ======================================================
    // ЗАПУСК
    // ======================================================

    start() {

        if (this.running) {
            return;
        }

        console.log("Game server started");


        // Создаём единственный корабль.
        //
        // ShipManager должен сам восстановить
        // сохранённое состояние из data/ship.json,
        // если оно существует.

        if (!this.ships.getShip()) {

            this.ships.create(
                "klip_20",
                "Klip_20"
            );
        }


        // Запускаем World

        this.world.start();


        // Запускаем постоянный серверный цикл

        this.loop.start();


        this.running = true;
    }


    // ======================================================
    // ОСТАНОВКА
    // ======================================================

    stop() {

        if (!this.running) {
            return;
        }

        this.loop.stop();

        this.world.stop();

        this.running = false;
    }


    // ======================================================
    // КОРАБЛЬ
    // ======================================================

    getShip() {

        return this.ships.getShip();
    }


    getShipState() {

        return this.ships.getState();
    }


    // ======================================================
    // УПРАВЛЕНИЕ
    // ======================================================

    setHeading(heading) {

        return this.ships.setHeading(heading);
    }


    setRudder(rudder) {

        return this.ships.setRudder(rudder);
    }


    setSail(sail) {

        return this.ships.setSail(sail);
    }


    // ======================================================
    // ЯКОРЬ
    // ======================================================

    dropAnchor() {

        return this.ships.dropAnchor();
    }


    raiseAnchor() {

        return this.ships.raiseAnchor();
    }


    toggleAnchor() {

        return this.ships.toggleAnchor();
    }


    // ======================================================
    // ПОЛОЖЕНИЕ
    // ======================================================

    setPosition(lat, lng) {

        return this.ships.setPosition(
            lat,
            lng
        );
    }


    // ======================================================
    // ВЕТЕР
    // ======================================================

    setWind(speed, direction, gust = 0) {

        return this.ships.setWind(
            speed,
            direction,
            gust
        );
    }


    // ======================================================
    // ТЕЧЕНИЕ
    // ======================================================

    setCurrent(speed, direction) {

        return this.ships.setCurrent(
            speed,
            direction
        );
    }


    // ======================================================
    // ДВИЖЕНИЕ
    // ======================================================

    isMoving() {

        return this.ships.isMoving();
    }


    // ======================================================
    // СОСТОЯНИЕ ИГРЫ
    // ======================================================

    getGameState() {

        return {
            running: this.running,
            ship: this.ships.getState(),
            timestamp: Date.now()
        };
    }


    // ======================================================
    // SOCKET.IO
    // ======================================================

    broadcastState() {

        if (!this.io) {
            return;
        }

        this.io.emit(
            "game_state",
            this.getGameState()
        );
    }


    // ======================================================
    // ИГРОВОЙ ТИК
    // ======================================================

    tick(dt) {

        this.world.update(dt);
    }
}


module.exports = GameServer;
