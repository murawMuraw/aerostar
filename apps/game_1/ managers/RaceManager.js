class RaceManager {

    constructor() {

        this.started = false;

    }

    update(dt) {

    }

    getState() {

        return {
            started: this.started
        };

    }

}

module.exports = RaceManager;
