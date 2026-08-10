const Player = require("../models/Player");

class PlayerManager {

    constructor() {

        // userId -> Player
        this.players = new Map();

    }

    create(username, email = null, password = null) {

        // Не создаём второго игрока с тем же username
        if (this.players.has(username)) {
            return null;
        }

        // Проверяем email
        for (const player of this.players.values()) {

            if (email && player.email === email) {
                return null;
            }

        }

        const player = new Player(
            username,
            username,
            email,
            password
        );

        this.players.set(username, player);

        return player;

    }

    get(userId) {

        return this.players.get(userId) || null;

    }

    exists(userId) {

        return this.players.has(userId);

    }

    remove(userId) {

        return this.players.delete(userId);

    }

    connect(userId, socketId) {

        const player = this.get(userId);

        if (!player) {
            return null;
        }

        player.connect(socketId);

        return player;

    }

    disconnect(userId) {

        const player = this.get(userId);

        if (!player) {
            return false;
        }

        player.disconnect();

        return true;

    }

    assignShip(userId, shipId, shipName = null) {

        const player = this.get(userId);

        if (!player) {
            return false;
        }

        player.assignShip(shipId, shipName);

        return true;

    }

    removeShip(userId) {

        const player = this.get(userId);

        if (!player) {
            return false;
        }

        player.removeShip();

        return true;

    }

    getBySocket(socketId) {

        for (const player of this.players.values()) {

            if (player.socketId === socketId) {
                return player;
            }

        }

        return null;

    }

    getAll() {

        return Array.from(this.players.values());

    }

    getOnline() {

        return this.getAll()
            .filter(player => player.connected);

    }

    count() {

        return this.players.size;

    }

    clear() {

        this.players.clear();

    }

}

module.exports = PlayerManager;
