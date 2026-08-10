// routes/ships.js

module.exports = function(app, game) {

    // -----------------------------------------------------
    // GET /api/ships
    // -----------------------------------------------------

    app.get("/api/ships", (req, res) => {

        try {

            res.json(
                game.ships.getAll()
            );

        } catch (error) {

            console.error(
                "GET /api/ships ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message: error.message
            });

        }

    });


    // -----------------------------------------------------
    // GET /api/ships/state
    // -----------------------------------------------------

    app.get("/api/ships/state", (req, res) => {

        try {

            const ships =
                game.ships.getAll();

            res.json(ships);

        } catch (error) {

            console.error(
                "GET /api/ships/state ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message: error.message
            });

        }

    });


    // -----------------------------------------------------
    // POST /api/select_ship
    // -----------------------------------------------------

    app.post("/api/select_ship", (req, res) => {

        try {

            const sessionId =
                req.headers["x-session-id"];

            const {
                shipId,
                shipName
            } = req.body;

            console.log(
                "SELECT SHIP:",
                {
                    sessionId,
                    shipId,
                    shipName
                }
            );

            if (!sessionId) {

                return res.status(401).json({
                    success: false,
                    message: "Not authenticated"
                });

            }

            if (!shipId) {

                return res.status(400).json({
                    success: false,
                    message: "Ship ID is required"
                });

            }

            const session =
                game.sessions.get(sessionId);

            if (!session) {

                return res.status(401).json({
                    success: false,
                    message: "Invalid session"
                });

            }

            const userId =
                session.userId;

            const player =
                game.players.get(userId);

            if (!player) {

                return res.status(401).json({
                    success: false,
                    message: "Player not found"
                });

            }

            const ship =
                game.joinRace(
                    userId,
                    shipId
                );

            if (!ship) {

                return res.status(400).json({
                    success: false,
                    message: "Ship unavailable"
                });

            }

            res.json({

                success: true,

                data: {
                    shipId: ship.id || shipId,
                    shipName:
                        ship.name ||
                        shipName ||
                        shipId
                },

                ship

            });

        } catch (error) {

            console.error(
                "POST /api/select_ship ERROR:",
                error
            );

            // Временно возвращаем реальную ошибку.
            // После отладки можно заменить message
            // на общее "Failed to select ship".

            res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "Failed to select ship"

            });

        }

    });


    // -----------------------------------------------------
    // GET /api/selected_ship
    // -----------------------------------------------------

    app.get("/api/selected_ship", (req, res) => {

        try {

            const sessionId =
                req.headers["x-session-id"];

            if (!sessionId) {

                return res.json({
                    success: true,
                    data: null
                });

            }

            const session =
                game.sessions.get(sessionId);

            if (!session) {

                return res.json({
                    success: true,
                    data: null
                });

            }

            const player =
                game.players.get(
                    session.userId
                );

            if (!player) {

                return res.json({
                    success: true,
                    data: null
                });

            }

            if (!player.shipId) {

                return res.json({
                    success: true,
                    data: null
                });

            }

            res.json({

                success: true,

                data: {

                    shipId:
                        player.shipId,

                    shipName:
                        player.shipName ||
                        player.shipId

                }

            });

        } catch (error) {

            console.error(
                "GET /api/selected_ship ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    error.message,

                data: null

            });

        }

    });


    // -----------------------------------------------------
    // CLEAR SHIP
    // -----------------------------------------------------

    app.post("/api/clear_ship_selection", (req, res) => {

        try {

            const sessionId =
                req.headers["x-session-id"];

            if (!sessionId) {

                return res.status(401).json({
                    success: false,
                    message: "Not authenticated"
                });

            }

            const session =
                game.sessions.get(sessionId);

            if (!session) {

                return res.status(401).json({
                    success: false,
                    message: "Invalid session"
                });

            }

            const userId =
                session.userId;

            game.leaveRace(userId);

            res.json({
                success: true
            });

        } catch (error) {

            console.error(
                "CLEAR SHIP ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    error.message

            });

        }

    });

};
