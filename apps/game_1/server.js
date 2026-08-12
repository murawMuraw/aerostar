// server.js

const path = require("path");
const http = require("http");

const express = require("express");
const { Server } = require("socket.io");

const GameServer = require("./core/GameServer");
const registerSocketHandlers = require("./socket/SocketHandlers");


// ==========================================================
// EXPRESS
// ==========================================================

const app = express();

app.use(express.json());


// ==========================================================
// HTTP SERVER
// ==========================================================

const server = http.createServer(app);


// ==========================================================
// SOCKET.IO
// ==========================================================

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});


// ==========================================================
// PORT
// ==========================================================

const PORT = process.env.PORT || 3002;


// ==========================================================
// STATIC FILES
// ==========================================================

app.use(express.static(
    path.join(__dirname, "public")
));


// ==========================================================
// GAME SERVER
// ==========================================================

const game = new GameServer(io);


// ==========================================================
// SOCKET HANDLERS
// ==========================================================

registerSocketHandlers(io, game);


// ==========================================================
// API
// ==========================================================


// ----------------------------------------------------------
// Health check
// ----------------------------------------------------------

app.get("/health", (req, res) => {

    res.json({
        status: "ok",
        gameRunning: game.running
    });

});


// ----------------------------------------------------------
// Полное состояние игры
// ----------------------------------------------------------

app.get("/api/state", (req, res) => {

    res.json(
        game.getGameState()
    );

});


// ----------------------------------------------------------
// Состояние корабля
// ----------------------------------------------------------

app.get("/api/ship", (req, res) => {

    const ship = game.getShip();

    if (!ship) {

        return res.status(404).json({
            success: false,
            message: "Ship not initialized"
        });

    }

    res.json({
        success: true,
        ship: ship.getState()
    });

});


// ----------------------------------------------------------
// Управление курсом
// ----------------------------------------------------------

app.post("/api/control/heading", (req, res) => {

    const { heading } = req.body;

    const success = game.setHeading(heading);

    if (!success) {

        return res.status(400).json({
            success: false,
            message: "Invalid heading"
        });

    }

    res.json({
        success: true,
        heading: game.getShip().heading
    });

});


// ----------------------------------------------------------
// Управление рулём
// ----------------------------------------------------------

app.post("/api/control/rudder", (req, res) => {

    const { rudder } = req.body;

    const success = game.setRudder(rudder);

    if (!success) {

        return res.status(400).json({
            success: false,
            message: "Invalid rudder value"
        });

    }

    res.json({
        success: true,
        rudder: game.getShip().rudder
    });

});


// ----------------------------------------------------------
// Управление парусом
// ----------------------------------------------------------

app.post("/api/control/sail", (req, res) => {

    const { sail } = req.body;

    const success = game.setSail(sail);

    if (!success) {

        return res.status(400).json({
            success: false,
            message: "Invalid sail value"
        });

    }

    res.json({
        success: true,
        sail: game.getShip().sail
    });

});


// ----------------------------------------------------------
// ЯКОРЬ
// ----------------------------------------------------------

app.post("/api/control/anchor", (req, res) => {

    const { anchor } = req.body;

    let success;

    if (anchor === true) {

        success = game.dropAnchor();

    } else if (anchor === false) {

        success = game.raiseAnchor();

    } else {

        success = game.toggleAnchor();

    }

    if (!success) {

        return res.status(400).json({
            success: false,
            message: "Unable to change anchor state"
        });

    }

    const ship = game.getShip();

    res.json({
        success: true,
        anchor: ship.anchor
    });

});


// ==========================================================
// ROOT
// ==========================================================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(__dirname, "public", "game.html")
    );

});


// ==========================================================
// ERROR HANDLER
// ==========================================================

app.use((err, req, res, next) => {

    console.error("Server error:", err);

    res.status(500).json({
        success: false,
        message: "Internal server error"
    });

});


// ==========================================================
// START GAME
// ==========================================================

game.start();


// ==========================================================
// START HTTP SERVER
// ==========================================================

server.listen(PORT, "0.0.0.0", () => {

    console.log("--------------------------------------");
    console.log("Sailing game server started");
    console.log("Port:", PORT);
    console.log("Ship: klip_20");
    console.log("--------------------------------------");

});
