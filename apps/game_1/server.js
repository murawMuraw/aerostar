const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const GameServer = require("./core/GameServer");
const createRoutes = require("./routes");
const registerSocketHandlers = require("./socket/SocketHandlers");

const app = express();
const server = http.createServer(app);

const io = new Server(server);

const game = new GameServer(io);

createRoutes(app, game);

registerSocketHandlers(io, game);

game.start();

server.listen(3000);
