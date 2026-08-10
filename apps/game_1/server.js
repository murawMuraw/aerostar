// apps/game_1/server.js

const path = require("path");
const http = require("http");

const express = require("express");
const { Server } = require("socket.io");

const GameServer = require("./core/GameServer");
const registerSocketHandlers = require("./socket/SocketHandlers");

const app = express();
const server = http.createServer(app);

// ---------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ---------------------------------------------------------
// Configuration
// ---------------------------------------------------------

const PORT = process.env.PORT || 3002;

// ---------------------------------------------------------
// Middleware
// ---------------------------------------------------------

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------
// Game Server
// ---------------------------------------------------------

const game = new GameServer(io);

// ---------------------------------------------------------
// API Routes
// ---------------------------------------------------------

const shipsRoutes = require("./routes/ships");
const authRoutes = require("./routes/auth");

shipsRoutes(app, game);
authRoutes(app, game);

// ---------------------------------------------------------
// Static files
// ---------------------------------------------------------

app.use(express.static(
    path.join(__dirname, "public")
));

// ---------------------------------------------------------
// Create ships
//
// IMPORTANT:
// These IDs must correspond to the ships used by
// public/selection.html
// ---------------------------------------------------------

const ships = [
    "klip_10",
    "klip_20",
    "klip_30",
    "columb",
    "pirat",
    "ap",
    "19c_m"
];

for (const type of ships) {
    try {
        game.ships.create(type, type);
        console.log(`Ship created: ${type}`);
    } catch (error) {
        console.error(`Failed to create ship "${type}":`, error);
    }
}

// ---------------------------------------------------------
// Socket handlers
// ---------------------------------------------------------

registerSocketHandlers(io, game);

// ---------------------------------------------------------
// Health check
// ---------------------------------------------------------

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        service: "regatta",
        port: PORT
    });
});

// ---------------------------------------------------------
// Full game state
// ---------------------------------------------------------

app.get("/state", (req, res) => {
    try {
        res.json(game.getGameState());
    } catch (error) {
        console.error("GET /state error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to get game state"
        });
    }
});

// ---------------------------------------------------------
// 404 API handler
// ---------------------------------------------------------

app.use("/api", (req, res) => {
    res.status(404).json({
        success: false,
        message: "API endpoint not found",
        path: req.originalUrl
    });
});

// ---------------------------------------------------------
// Error handler
// ---------------------------------------------------------

app.use((err, req, res, next) => {
    console.error("Express error:", err);

    if (res.headersSent) {
        return next(err);
    }

    res.status(500).json({
        success: false,
        message: "Internal server error"
    });
});

// ---------------------------------------------------------
// Start game
// ---------------------------------------------------------

console.log("--------------------------------------");
console.log("Initializing Regatta server...");

try {
    game.start();
    console.log("Game server started");
} catch (error) {
    console.error("Failed to start game:", error);
    process.exit(1);
}

// ---------------------------------------------------------
// Start HTTP server
// ---------------------------------------------------------

server.listen(PORT, "0.0.0.0", () => {
    console.log("--------------------------------------");
    console.log("Regatta server started");
    console.log("Port:", PORT);
    console.log("Ships:", ships.join(", "));
    console.log("--------------------------------------");
});

// ---------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------

function shutdown(signal) {
    console.log(`\n${signal} received. Shutting down...`);

    try {
        game.stop();
    } catch (error) {
        console.error("Game stop error:", error);
    }

    server.close(() => {
        console.log("HTTP server stopped");
        process.exit(0);
    });

    setTimeout(() => {
        console.error("Forced shutdown");
        process.exit(1);
    }, 5000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

