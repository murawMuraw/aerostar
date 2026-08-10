class Player {

    constructor(userId, username = null, email = null, password = null) {

        this.userId = userId;
        this.id = userId;

        this.username = username || userId;
        this.email = email || null;
        this.password = password || null;

        this.sessionId = null;

        this.socketId = null;
        this.connected = false;

        this.shipId = null;
        this.shipName = null;

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

    assignShip(shipId, shipName = null) {

        this.shipId = shipId;
        this.shipName = shipName || shipId;

    }

    removeShip() {

        this.shipId = null;
        this.shipName = null;

    }

}

module.exports = Player;
