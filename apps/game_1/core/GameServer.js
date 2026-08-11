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
        // КОРАБЛЬ
        // ==================================================

        // В игре существует один парусник
        this.ships = new ShipManager();


        // ==================================================
        // ОКРУЖЕНИЕ
        // ==================================================

        // Реальный ветер
        this.wind = new WindManager();

        // Океан / течения / суша
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
    // ЗАПУСК СЕРВЕРА
    // ======================================================

    start() {

        if (this.running) {
            return;
        }

        console.log("Game server started");


        // Создаём единственный корабль
        this.ships.create(
            "klip_20",
            "Klip_20"
        );


        // Запускаем мир
        this.world.start();


        // Запускаем постоянный серверный цикл
        this.loop.start();


        this.running = true;

    }


    // ======================================================
    // ОСТАНОВКА СЕРВЕРА
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
    // ПОЛУЧИТЬ КОРАБЛЬ
    // ======================================================

    getShip() {

        return this.ships.getShip();

    }


    // ======================================================
    // СОСТОЯНИЕ КОРАБЛЯ
    // ======================================================

    getShipState() {

        return this.ships.getState();

    }


    // ======================================================
    // УПРАВЛЕНИЕ КОРАБЛЁМ
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

    setWind(speed, direction) {

        return this.ships.setWind(
            speed,
            direction
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
    // ПРОВЕРКА ДВИЖЕНИЯ
    // ======================================================

    isMoving() {

        return this.ships.isMoving();

    }


    // ======================================================
    // СОСТОЯНИЕ ИГРЫ
    // ======================================================

    getGameState() {

        const ship = this.ships.getState();

        return {

            running: this.running,

            ship: ship,

            timestamp: Date.now()

        };

    }


    // ======================================================
    // РАССЫЛКА СОСТОЯНИЯ
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

        // World отвечает за физику:
        //
        // ветер
        // течение
        // парус
        // руль
        // координаты
        // столкновение с сушей
        //
        // GameServer только передаёт управление миру.

        this.world.update(dt);


        // После расчёта нового состояния
        // отправляем его подключённым клиентам.

        this.broadcastState();

    }

}


module.exports = GameServer;

