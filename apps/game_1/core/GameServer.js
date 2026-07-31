// core/GameServer.js

const SessionManager = require("../managers/SessionManager");
const PlayerManager  = require("../managers/PlayerManager");
const ShipManager    = require("../managers/ShipManager");

const WindManager    = require("../managers/WindManager");
const OceanManager   = require("../managers/OceanManager");
const RaceManager    = require("../managers/RaceManager");
const World = require("./World");

const GameLoop       = require("./GameLoop");

class GameServer {

    constructor(io) {

        this.io = io;

        this.sessions = new SessionManager();
        this.players  = new PlayerManager();
        this.ships    = new ShipManager();

        this.wind  = new WindManager();
        this.ocean = new OceanManager();
        this.race  = new RaceManager();
        this.world = new World(this);
        this.loop = new GameLoop(this);

    }

    //----------------------------------------------------------
    // Запуск
    //----------------------------------------------------------

    start() {

        console.log("Game server started");

        this.loop.start();
        this.world.start();
       this.loop.start();

    }

    stop() {

        this.loop.stop();
       this.loop.stop();
       this.world.stop();
    }

    //----------------------------------------------------------
    // Авторизация
    //----------------------------------------------------------

    login(userId) {

        let player = this.players.get(userId);

        if (!player)
            player = this.players.create(userId);

        const sessionId = this.sessions.create(userId);

        player.sessionId = sessionId;

        return {

            player,
            sessionId

        };

    }

    logout(sessionId) {

        const userId = this.sessions.getUser(sessionId);

        if (!userId)
            return false;

        this.disconnect(userId);

        this.leaveRace(userId);

        this.sessions.remove(sessionId);

        this.players.remove(userId);

        return true;

    }

    //----------------------------------------------------------
    // Socket
    //----------------------------------------------------------

    connect(userId, socketId) {

        return this.players.connect(userId, socketId);

    }

    disconnect(userId) {

        return this.players.disconnect(userId);

    }

    //----------------------------------------------------------
    // Регата
    //----------------------------------------------------------

    joinRace(userId, shipType) {

        const player = this.players.get(userId);

        if (!player)
            return null;

        const ship = this.ships.getByType(shipType);

        if (!ship)
            return null;

        if (!this.ships.isAvailable(shipType))
            return null;

        this.ships.assignOwner(ship.id, player);

        player.assignShip(ship.id);

        return ship;

    }

    leaveRace(userId) {

        const player = this.players.get(userId);

        if (!player)
            return false;

        if (!player.shipId)
            return true;

        this.ships.release(player.shipId);

        player.removeShip();

        return true;

    }

    //----------------------------------------------------------
    // Управление кораблем
    //----------------------------------------------------------

    updatePosition(userId, lat, lng) {

        const player = this.players.get(userId);

        if (!player || !player.shipId)
            return false;

        return this.ships.setPosition(
            player.shipId,
            lat,
            lng
        );

    }

    setHeading(userId, heading) {

        const player = this.players.get(userId);

        if (!player || !player.shipId)
            return false;

        return this.ships.setHeading(
            player.shipId,
            heading
        );

    }

    setSail(userId, sail) {

        const player = this.players.get(userId);

        if (!player || !player.shipId)
            return false;

        return this.ships.setSail(
            player.shipId,
            sail
        );

    }

    setRudder(userId, rudder) {

        const player = this.players.get(userId);

        if (!player || !player.shipId)
            return false;

        return this.ships.setRudder(
            player.shipId,
            rudder
        );

    }

    setAnchor(userId, anchor) {

        const player = this.players.get(userId);

        if (!player || !player.shipId)
            return false;

        return this.ships.setAnchor(
            player.shipId,
            anchor
        );

    }

    //----------------------------------------------------------
    // Состояние игры
    //----------------------------------------------------------

    getGameState() {

        return {

            players : this.players.count(),

            online  : this.players.getOnline().length,

            ships   : this.ships.getActive(),

            race    : this.race.getState()

        };

    }

    //----------------------------------------------------------
    // Рассылка
    //----------------------------------------------------------

    broadcastState() {

        this.io.emit(
            "game_state",
            this.getGameState()
        );

    }

    //----------------------------------------------------------
    // Игровой тик
    //----------------------------------------------------------

    tick(dt) {

        this.world.update(dt);

    }

}

module.exports = GameServer;
