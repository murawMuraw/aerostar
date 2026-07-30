class Player {

    constructor(userId) {

        this.userId = userId;

        this.sessionId = null;

        this.socketId = null;

        this.connected = false;

        this.shipId = null;

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

    assignShip(shipId) {

        this.shipId = shipId;

    }

    removeShip() {

        this.shipId = null;

    }

}

module.exports = Player;
