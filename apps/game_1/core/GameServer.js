const SessionManager = require("../managers/SessionManager");
const PlayerManager  = require("../managers/PlayerManager");
const ShipManager    = require("../managers/ShipManager");

const WindManager  = require("../managers/WindManager");
const OceanManager = require("../managers/OceanManager");
const RaceManager  = require("../managers/RaceManager");

const World = require("./World");
const GameLoop = require("./GameLoop");

class GameServer {

    constructor(io) {

        this.io = io;

        this.sessions = new SessionManager();
        this.players = new PlayerManager();
        this.ships = new ShipManager();

        this.wind = new WindManager();
        this.ocean = new OceanManager();
        this.race = new RaceManager();

        this.world = new World(this);
        this.loop = new GameLoop(this);

    }

    // ----------------------------------------------------------
    // START / STOP
    // ----------------------------------------------------------

    start() {

        console.log("Game server started");

        this.world.start();
        this.loop.start();

    }

    stop() {

        this.loop.stop();
        this.world.stop();

    }

    // ----------------------------------------------------------
    // AUTH
    // ----------------------------------------------------------

    login(username, password) {

        const player = this.players.get(username);

        if (!player) {
            return null;
        }

        if (player.password !== password) {
            return null;
        }

        const sessionId = this.sessions.create(username);

        player.sessionId = sessionId;

        return {
            player,
            sessionId
        };

    }

    logout(sessionId) {

        const userId = this.sessions.getUser(sessionId);

        if (!userId) {
            return false;
        }

        this.disconnect(userId);
        this.leaveRace(userId);

        this.sessions.remove(sessionId);
        this.players.remove(userId);

        return true;

    }

    // ----------------------------------------------------------
    // SOCKET
    // ----------------------------------------------------------

    connect(userId, socketId) {

        return this.players.connect(
            userId,
            socketId
        );

    }

    disconnect(userId) {

        return this.players.disconnect(userId);

    }

    // ----------------------------------------------------------
    // RACE
    // ----------------------------------------------------------

    joinRace(userId, shipId) {

        const player = this.players.get(userId);

        if (!player) {
            console.log("joinRace: player not found", userId);
            return null;
        }

        const ship = this.ships.getByType(shipId);

        if (!ship) {
            console.log("joinRace: ship not found", shipId);
            return null;
        }

        if (!this.ships.isAvailable(shipId)) {
            console.log("joinRace: ship unavailable", shipId);
            return null;
        }

        this.ships.assignOwner(
            ship.id,
            player
        );

        player.assignShip(
            ship.id,
            ship.name || ship.type || shipId
        );

        return ship;

    }

    leaveRace(userId) {

        const player = this.players.get(userId);

        if (!player) {
            return false;
        }

        if (!player.shipId) {
            return true;
        }

        this.ships.release(
            player.shipId
        );

        player.removeShip();

        return true;

    }

    // ----------------------------------------------------------
    // SHIP CONTROL
    // ----------------------------------------------------------

    updatePosition(userId, lat, lng) {

        const player = this.players.get(userId);

        if (!player || !player.shipId) {
            return false;
        }

        return this.ships.setPosition(
            player.shipId,
            lat,
            lng
        );

    }

    setHeading(userId, heading) {

        const player = this.players.get(userId);

        if (!player || !player.shipId) {
            return false;
        }

        return this.ships.setHeading(
            player.shipId,
            heading
        );

    }

    setSail(userId, sail) {

        const player = this.players.get(userId);

        if (!player || !player.shipId) {
            return false;
        }

        return this.ships.setSail(
            player.shipId,
            sail
        );

    }

    setRudder(userId, rudder) {

        const player = this.players.get(userId);

        if (!player || !player.shipId) {
            return false;
        }

        return this.ships.setRudder(
            player.shipId,
            rudder
        );

    }

    setAnchor(userId, anchor) {

        const player = this.players.get(userId);

        if (!player || !player.shipId) {
            return false;
        }

        return this.ships.setAnchor(
            player.shipId,
            anchor
        );

    }

    // ----------------------------------------------------------
    // STATE
    // ----------------------------------------------------------

    getGameState() {

        return {

            players: this.players.count(),

            online:
                this.players.getOnline().length,

            ships:
                this.ships.getActive(),

            race:
                this.race.getState()

        };

    }

    // ----------------------------------------------------------
    // BROADCAST
    // ----------------------------------------------------------

    broadcastState() {

        this.io.emit(
            "game_state",
            this.getGameState()
        );

    }

    // ----------------------------------------------------------
    // TICK
    // ----------------------------------------------------------

    tick(dt) {

        this.world.update(dt);

    }

}

module.exports = GameServer;
