class Ship {

    constructor(type) {

        this.type = type;

        this.owner = null;

        this.name = "";

        this.lat = 0;
        this.lng = 0;

        this.heading = 0;

        this.speed = 0;

        this.rudder = 0;

        this.sail = 100;

        this.anchor = true;

        this.finished = false;

        this.distance = 0;

        this.lastUpdate = Date.now();

    }

  setOwner(player) {

    if (!player) {
        this.ownerId = null;
        this.owner = null;
        return;
    }

    this.ownerId = player.userId || player.id;
    this.owner = player;

}

    updatePosition(lat, lng) {

        this.lat = lat;
        this.lng = lng;
        this.lastUpdate = Date.now();

    }

    updateHeading(heading) {

        this.heading = heading;

    }

    updateSpeed(speed) {

        this.speed = speed;

    }

}

module.exports = Ship;
