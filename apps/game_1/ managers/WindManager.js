// managers/WindManager.js
const https = require("https");


class WindManager {

    constructor(options = {}) {

        this.apiKey =
            options.apiKey ||
            process.env.OPENWEATHER_API_KEY ||
            process.env.OPENWEATHERMAP_API_KEY ||
            "";

        // последние данные ветра
        this.current = {

            speed: 0,
            direction: 0,
            gust: 0,
            timestamp: 0

        };


        // координаты последнего запроса

        this.lastLat = null;
        this.lastLng = null;


        // обновление не чаще чем раз в 10 минут

        this.updateInterval = 
            10 * 60 * 1000;


        this.lastUpdate = 0;


        this.requestRunning = false;


    }



    // ----------------------------------------------------------
    // World.js вызывает этот метод
    // Он НЕ async
    // ----------------------------------------------------------

    get(lat, lng) {


        const now = Date.now();


        /*
         * Если корабль ушёл далеко
         * или прошло время обновления,
         * запускаем новый запрос
         */

        if (

            !this.requestRunning &&

            (
                !this.lastLat ||
                this.distanceChanged(lat, lng) ||
                now - this.lastUpdate > this.updateInterval
            )

        ) {

            this.update(
                lat,
                lng
            );

        }



        return this.current;

    }





    // ----------------------------------------------------------
    // Фоновое обновление ветра
    // ----------------------------------------------------------

    async update(lat, lng) {


        if (!this.apiKey) {

            console.warn(
                "WindManager: API key missing"
            );

            return;

        }



        this.requestRunning = true;


        try {


            const wind =
                await this.fetchWind(
                    lat,
                    lng
                );


            if (wind) {


                this.current = wind;


                this.lastLat = Number(lat);
                this.lastLng = Number(lng);

                this.lastUpdate =
                    Date.now();


            }


        }

        catch(error) {


            console.error(
                "Wind update failed:",
                error.message
            );


            /*
             * Старый ветер сохраняем.
             * Корабль продолжает движение.
             */

        }


        finally {

            this.requestRunning = false;

        }

    }





    // ----------------------------------------------------------
    // Запрос OpenWeather
    // ----------------------------------------------------------

    fetchWind(lat, lng) {


        return new Promise(
            (resolve, reject) => {


                const url =
                    "https://api.openweathermap.org/data/2.5/weather" +
                    `?lat=${lat}` +
                    `&lon=${lng}` +
                    `&appid=${this.apiKey}` +
                    "&units=metric";



                const req = https.get(
                    url,
                    res => {


                        let data = "";



                        res.on(
                            "data",
                            chunk => {

                                data += chunk;

                            }
                        );



                        res.on(
                            "end",
                            () => {


                                if (
                                    res.statusCode !== 200
                                ) {

                                    reject(
                                        new Error(
                                            "OpenWeather HTTP " +
                                            res.statusCode
                                        )
                                    );

                                    return;

                                }



                                try {


                                    const json =
                                        JSON.parse(data);



                                    const wind =
                                        json.wind || {};



                                    resolve({

                                        speed:
                                            Number(
                                                wind.speed
                                            ) || 0,


                                        direction:
                                            Number(
                                                wind.deg
                                            ) || 0,


                                        gust:
                                            Number(
                                                wind.gust
                                            ) || 0,


                                        timestamp:
                                            Date.now()

                                    });



                                }

                                catch(e) {

                                    reject(e);

                                }


                            }
                        );


                    }
                );



                req.setTimeout(
                    8000,
                    () => {

                        req.destroy();

                        reject(
                            new Error(
                                "Wind timeout"
                            )
                        );

                    }
                );



                req.on(
                    "error",
                    reject
                );


            }
        );

    }





    // ----------------------------------------------------------
    // Проверка изменения координат
    // ----------------------------------------------------------

    distanceChanged(lat, lng) {


        if (
            this.lastLat === null ||
            this.lastLng === null
        ) {

            return true;

        }



        const dLat =
            Math.abs(
                lat - this.lastLat
            );


        const dLng =
            Math.abs(
                lng - this.lastLng
            );



        /*
         * примерно 10 км
         */

        return (
            dLat > 0.1 ||
            dLng > 0.1
        );

    }




    // ----------------------------------------------------------
    // Очистка
    // ----------------------------------------------------------

    clear() {

        this.current = {

            speed:0,
            direction:0,
            gust:0,
            timestamp:0

        };


        this.lastLat = null;
        this.lastLng = null;

    }

}



module.exports = WindManager;
