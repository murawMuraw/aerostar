// socket/SocketHandlers.js

module.exports = function registerSocketHandlers(io, game) {

    io.on("connection", (socket) => {

        console.log(`Client connected: ${socket.id}`);

        //------------------------------------------------------
        // JOIN
        //------------------------------------------------------

        socket.on("join", ({ userId, shipType }) => {

            try {

                game.connect(userId, socket.id);

                const ship = game.joinRace(userId, shipType);

                if (!ship) {

                    socket.emit("join_error", {
                        message: "Ship unavailable"
                    });

                    return;

                }

                socket.emit("joined", {
                    shipId: ship.id
                });

                game.broadcastState();

            }
            catch (err) {

                console.error(err);

            }

        });

        //------------------------------------------------------
        // RECONNECT
        //------------------------------------------------------

        socket.on("reconnect", ({ userId }) => {

            try {

                game.connect(userId, socket.id);

                socket.emit("reconnected");

                game.broadcastState();

            }
            catch (err) {

                console.error(err);

            }

        });

        //------------------------------------------------------
        // RUDDER
        //------------------------------------------------------

        socket.on("rudder", ({ userId, value }) => {

            game.setRudder(userId, value);

        });

        //------------------------------------------------------
        // HEADING
        //------------------------------------------------------

        socket.on("heading", ({ userId, value }) => {

            game.setHeading(userId, value);

        });

        //------------------------------------------------------
        // SAIL
        //------------------------------------------------------

        socket.on("sail", ({ userId, value }) => {

            game.setSail(userId, value);

        });

        //------------------------------------------------------
        // ANCHOR
        //------------------------------------------------------

        socket.on("anchor", ({ userId, value }) => {

            game.setAnchor(userId, value);

        });

        //------------------------------------------------------
        // POSITION
        //------------------------------------------------------

        socket.on("position", ({ userId, lat, lng }) => {

            game.updatePosition(
                userId,
                lat,
                lng
            );

        });

        //------------------------------------------------------
        // CHAT
        //------------------------------------------------------

        socket.on("chat", (msg) => {

            io.emit("chat", msg);

        });

        //------------------------------------------------------
        // DISCONNECT
        //------------------------------------------------------

        socket.on("disconnect", () => {

            const player =
                game.players.getBySocket(socket.id);

            if (!player)
                return;

            game.disconnect(player.userId);

            console.log(`Disconnected ${player.userId}`);

            game.broadcastState();

        });

    });

};
