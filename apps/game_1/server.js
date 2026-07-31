// server.js

const path = require("path");
const http = require("http");

const express = require("express");
const { Server } = require("socket.io");

const GameServer = require("./core/GameServer");
const registerSocketHandlers = require("./socket/SocketHandlers");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

//----------------------------------------------------------
// Конфигурация
//----------------------------------------------------------

const PORT = process.env.PORT || 3000;

//----------------------------------------------------------
// Статические файлы
//----------------------------------------------------------

app.use(express.static(
    path.join(__dirname, "public")
));

//----------------------------------------------------------
// Создание игрового сервера
//----------------------------------------------------------

const game = new GameServer(io);

//----------------------------------------------------------
// Создание кораблей
//----------------------------------------------------------

const ships = [

    "brig",
    "clipper",
    "frigate",
    "galleon",
    "caravel",
    "schooner",
    "cutter",
    "yacht"

];

for (const type of ships) {

    game.ships.create(type, type);

}

//----------------------------------------------------------
// Socket.IO
//----------------------------------------------------------

registerSocketHandlers(io, game);

//----------------------------------------------------------
// HTTP
//----------------------------------------------------------

app.get("/health", (req, res) => {

    res.json({
        status: "ok"
    });

});

app.get("/state", (req, res) => {

    res.json(
        game.getGameState()
    );

});

//----------------------------------------------------------
// Запуск
//----------------------------------------------------------

game.start();

server.listen(PORT, () => {

    console.log("--------------------------------------");
    console.log("Regatta server started");
    console.log("Port:", PORT);
    console.log("--------------------------------------");

});
