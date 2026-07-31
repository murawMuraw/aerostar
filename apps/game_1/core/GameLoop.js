// core/GameLoop.js

class GameLoop {

    constructor(game) {

        this.game = game;

        this.timer = null;

        this.running = false;

        // Интервал обновления (100 мс = 10 FPS сервера)
        this.interval = 100;

        this.lastTime = 0;

    }

    //----------------------------------------------------------
    // Запуск игрового цикла
    //----------------------------------------------------------

    start() {

        if (this.running)
            return;

        this.running = true;

        this.lastTime = Date.now();

        this.timer = setInterval(() => {

            this.update();

        }, this.interval);

        console.log("GameLoop started");

    }

    //----------------------------------------------------------
    // Остановка
    //----------------------------------------------------------

    stop() {

        if (!this.running)
            return;

        clearInterval(this.timer);

        this.timer = null;

        this.running = false;

        console.log("GameLoop stopped");

    }

    //----------------------------------------------------------
    // Один тик
    //----------------------------------------------------------

    update() {

        const now = Date.now();

        const dt = (now - this.lastTime) / 1000.0;

        this.lastTime = now;

        try {

            // Обновить мир
            this.game.world.update(dt);

            // Разослать новое состояние клиентам
            this.game.broadcastState();

        }
        catch (err) {

            console.error("GameLoop:", err);

        }

    }

    //----------------------------------------------------------
    // Изменить частоту
    //----------------------------------------------------------

    setInterval(ms) {

        this.interval = ms;

        if (this.running) {

            this.stop();
            this.start();

        }

    }

    //----------------------------------------------------------
    // Получить частоту
    //----------------------------------------------------------

    getInterval() {

        return this.interval;

    }

    //----------------------------------------------------------
    // Проверить состояние
    //----------------------------------------------------------

    isRunning() {

        return this.running;

    }

}

module.exports = GameLoop;
