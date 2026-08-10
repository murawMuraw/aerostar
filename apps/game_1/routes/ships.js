
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

            console.error("GET /api/ships ERROR:", error);

            res.status(500).json({
                success: false,
                message: "Failed to load ships"
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
                message: "Failed to load ship state"
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

            // -------------------------------------------------
            // Получаем пользователя из session
            // -------------------------------------------------

            if (!game.sessions ||
                typeof game.sessions.get !== "function") {

                return res.status(500).json({
                    success: false,
                    message: "Session system unavailable"
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

            const userId = session.userId;

            // -------------------------------------------------
            // Выбираем корабль
            // -------------------------------------------------

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
                    shipId: shipId,
                    shipName: shipName || shipId
                },

                ship: ship
            });

        } catch (error) {

            console.error(
                "POST /api/select_ship ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message: "Failed to select ship"
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
                    success: false,
                    data: null
                });
            }

            const session =
                game.sessions.get(sessionId);

            if (!session) {
                return res.json({
                    success: false,
                    data: null
                });
            }

            const userId = session.userId;

            const player =
                game.players.get(userId);

            if (!player) {
                return res.json({
                    success: false,
                    data: null
                });
            }

            // Если PlayerManager хранит выбранный корабль
            const shipId =
                player.shipId ||
                player.shipType ||
                player.selectedShip;

            if (!shipId) {
                return res.json({
                    success: true,
                    data: null
                });
            }

            res.json({
                success: true,

                data: {
                    shipId: shipId,
                    shipName:
                        player.shipName ||
                        shipId
                }
            });

        } catch (error) {

            console.error(
                "GET /api/selected_ship ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                data: null
            });
        }
    });


    // -----------------------------------------------------
    // POST /api/clear_ship_selection
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

            const userId = session.userId;

            // Используем существующий механизм выхода
            if (typeof game.leaveRace === "function") {
                game.leaveRace(userId);
            }

            const player =
                game.players.get(userId);

            if (player) {
                player.shipId = null;
                player.shipType = null;
                player.selectedShip = null;
                player.shipName = null;
            }

            res.json({
                success: true
            });

        } catch (error) {

            console.error(
                "POST /api/clear_ship_selection ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message: "Failed to clear ship selection"
            });
        }
    });

};

