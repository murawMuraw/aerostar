// server.js

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const GameServer = require("./core/GameServer");
const registerSocketHandlers = require("./socket/SocketHandlers");

const shipsRoutes = require("./routes/ships");
const authRoutes = require("./routes/auth");
const raceRoutes = require("./routes/race");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3002;

// ----------------------------------------------------------
// Middleware
// ----------------------------------------------------------

app.use(express.json());

app.use(express.static(
    path.join(__dirname, "public")
));

// ----------------------------------------------------------
// Game Server
// ----------------------------------------------------------

const game = new GameServer(io);

// ----------------------------------------------------------
// Ships
//
// ID/type должны совпадать с selection.html
// ----------------------------------------------------------

const ships = [
    {
        id: "klip_10",
        name: "Clipper-10"
    },
    {
        id: "klip_20",
        name: "Clipper-20"
    },
    {
        id: "klip_30",
        name: "Clipper-30"
    },
    {
        id: "columb",
        name: "Columbus"
    },
    {
        id: "pirat",
        name: "Pirate"
    },
    {
        id: "ap",
        name: "AP"
    },
    {
        id: "19c_m",
        name: "19th Century"
    }
];

for (const ship of ships) {
    game.ships.create(ship.id, ship.name);
}

// ----------------------------------------------------------
// HTTP API
// ----------------------------------------------------------

shipsRoutes(app, game);
authRoutes(app, game);

if (typeof raceRoutes === "function") {
    raceRoutes(app, game);
}

// ----------------------------------------------------------
// Socket.IO
// ----------------------------------------------------------

registerSocketHandlers(io, game);

// ----------------------------------------------------------
// Health
// ----------------------------------------------------------

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        service: "regatta",
        port: PORT
    });
});

// ----------------------------------------------------------
// Full game state
// ----------------------------------------------------------

app.get("/state", (req, res) => {
    try {
        res.json(game.getGameState());
    } catch (error) {
        console.error("GET /state ERROR:", error);

        res.status(500).json({
            success: false,
            message: "Failed to get game state"
        });
    }
});

// ----------------------------------------------------------
// Start
// ----------------------------------------------------------

game.start();

server.listen(PORT, "0.0.0.0", () => {

    console.log("--------------------------------------");
    console.log("Regatta server started");
    console.log("Port:", PORT);
    console.log("--------------------------------------");

});
