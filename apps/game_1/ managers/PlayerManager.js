// managers/PlayerManager.js

const Player = require("../models/Player");

class PlayerManager {

    constructor() {

        // userId -> Player
        this.players = new Map();

    }

    /**
     * Создать игрока
     */
    create(userId) {

        if (this.players.has(userId)) {
            return this.players.get(userId);
        }

        const player = new Player(userId);

        this.players.set(userId, player);

        return player;

    }

    /**
     * Получить игрока
     */
    get(userId) {

        return this.players.get(userId) || null;

    }

    /**
     * Проверить существование
     */
    exists(userId) {

        return this.players.has(userId);

    }

    /**
     * Удалить игрока
     */
    remove(userId) {

        return this.players.delete(userId);

    }

    /**
     * Подключение сокета
     */
    connect(userId, socketId) {

        const player = this.get(userId);

        if (!player) return null;

        player.connect(socketId);

        return player;

    }

    /**
     * Отключение сокета
     */
    disconnect(userId) {

        const player = this.get(userId);

        if (!player) return;

        player.disconnect();

    }

    /**
     * Назначить корабль
     */
    assignShip(userId, ship) {

        const player = this.get(userId);

        if (!player) return false;

        player.assignShip(ship);

        return true;

    }

    /**
     * Удалить корабль
     */
    removeShip(userId) {

        const player = this.get(userId);

        if (!player) return false;

        player.removeShip();

        return true;

    }

    /**
     * Все игроки
     */
    getAll() {

        return Array.from(this.players.values());

    }

    /**
     * Только подключённые
     */
    getOnline() {

        return this.getAll().filter(player => player.connected);

    }

    /**
     * Количество игроков
     */
    count() {

        return this.players.size;

    }

    /**
     * Очистить
     */
    clear() {

        this.players.clear();

    }

}

module.exports = PlayerManager;
