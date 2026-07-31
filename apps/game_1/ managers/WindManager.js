// managers/WindManager.js

class WindManager {

    constructor() {

        this.wind = null;

    }

    async getWind(lat, lng) {

        return this.wind;

    }

    async update(dt) {

        // Пока ничего не делаем

    }

}

module.exports = WindManager;
