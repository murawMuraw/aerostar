// managers/WindManager.js

const https = require("https");

class WindManager {

    constructor(options = {}) {

        this.apiKey =
            options.apiKey ||
            process.env.OPENWEATHER_API_KEY ||
            process.env.OPENWEATHERMAP_API_KEY ||
            "";

        this.cache = new Map();

        // Время жизни данных о ветре
        // 10 минут.
        this.cacheTTL = 10 * 60 * 1000;

        this.timeout = 8000;

    }

    // ----------------------------------------------------------
    // Получить ветер в точке
    // ----------------------------------------------------------

    async get(lat, lng) {

        if (
            !Number.isFinite(Number(lat)) ||
            !Number.isFinite(Number(lng))
        ) {
            return null;
        }

        lat = Number(lat);
        lng = Number(lng);

        const key = this.getCacheKey(lat, lng);

        const cached = this.cache.get(key);

        if (
            cached &&
            Date.now() - cached.timestamp < this.cacheTTL
        ) {
            return cached.data;
        }

        if (!this.apiKey) {

            console.warn(
                "WindManager: OPENWEATHER_API_KEY is not configured"
            );

            return null;
        }

        try {

            const data = await this.fetchWind(lat, lng);

            if (!data) {
                return null;
            }

            this.cache.set(key, {
                timestamp: Date.now(),
                data
            });

            return data;

        } catch (error) {

            console.error(
                "WindManager error:",
                error.message
            );

            /*
             * Если API временно недоступен,
             * используем старые данные.
             */

            if (cached) {
                return cached.data;
            }

            return null;
        }

    }

    // ----------------------------------------------------------
    // OpenWeather
    // ----------------------------------------------------------

    fetchWind(lat, lng) {

        return new Promise((resolve, reject) => {

            const url =
                "https://api.openweathermap.org/data/2.5/weather" +
                `?lat=${encodeURIComponent(lat)}` +
                `&lon=${encodeURIComponent(lng)}` +
                `&appid=${encodeURIComponent(this.apiKey)}` +
                "&units=metric";

            const request = https.get(
                url,
                response => {

                    let body = "";

                    response.on(
                        "data",
                        chunk => {
                            body += chunk;
                        }
                    );

                    response.on(
                        "end",
                        () => {

                            if (
                                response.statusCode < 200 ||
                                response.statusCode >= 300
                            ) {

                                reject(
                                    new Error(
                                        `OpenWeather HTTP ${response.statusCode}`
                                    )
                                );

                                return;
                            }

                            try {

                                const json =
                                    JSON.parse(body);

                                const wind =
                                    json.wind || {};

                                const speed =
                                    Number(wind.speed) || 0;

                                const direction =
                                    Number(wind.deg) || 0;

                                resolve({

                                    speed,
                                    direction,

                                    // Дополнительная информация
                                    gust:
                                        Number(wind.gust) || 0,

                                    timestamp:
                                        Date.now()

                                });

                            } catch (error) {

                                reject(error);

                            }

                        }
                    );

                }
            );

            request.setTimeout(
                this.timeout,
                () => {

                    request.destroy();

                    reject(
                        new Error(
                            "OpenWeather request timeout"
                        )
                    );

                }
            );

            request.on(
                "error",
                reject
            );

        });

    }

    // ----------------------------------------------------------
    // Ключ кеша
    // ----------------------------------------------------------

    getCacheKey(lat, lng) {

        /*
         * Не нужно хранить ветер для каждого
         * миллиметра координат.
         *
         * Округляем до 0.1 градуса.
         */

        const roundedLat =
            Math.round(lat * 10) / 10;

        const roundedLng =
            Math.round(lng * 10) / 10;

        return `${roundedLat}:${roundedLng}`;

    }

    // ----------------------------------------------------------
    // Очистить кеш
    // ----------------------------------------------------------

    clearCache() {

        this.cache.clear();

    }

}

module.exports = WindManager;
