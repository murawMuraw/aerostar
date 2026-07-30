class Player {

    constructor(userId) {

        this.userId = userId;

        this.sessionId = null;

        this.socketId = null;

        this.connected = false;

        this.ship = null;

        this.loginTime = Date.now();

        this.lastSeen = Date.now();

    }

    connect(socketId) {

        this.socketId = socketId;
        this.connected = true;
        this.lastSeen = Date.now();

    }

    disconnect() {

        this.socketId = null;
        this.connected = false;
        this.lastSeen = Date.now();

    }

    assignShip(ship) {

        this.ship = ship;

    }

    removeShip() {

        this.ship = null;

    }

}

module.exports = Player;
