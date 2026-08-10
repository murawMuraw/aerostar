
// routes/auth.js

module.exports = function(app, game) {

    // -----------------------------------------------------
    // REGISTER
    // -----------------------------------------------------

    app.post("/api/register", (req, res) => {

        try {

            const {
                username,
                email,
                password
            } = req.body;

            if (!username || !email || !password) {
                return res.status(400).json({
                    success: false,
                    message: "Username, email and password are required"
                });
            }

            if (username.length < 3 || username.length > 20) {
                return res.status(400).json({
                    success: false,
                    message: "Username must be 3-20 characters"
                });
            }

            if (password.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: "Password must be at least 6 characters"
                });
            }

            // Используем PlayerManager, если он есть
            if (!game.players || typeof game.players.create !== "function") {
                return res.status(500).json({
                    success: false,
                    message: "Player system is not available"
                });
            }

            const player = game.players.create(
                username,
                email,
                password
            );

            if (!player) {
                return res.status(400).json({
                    success: false,
                    message: "Username or email already exists"
                });
            }

            res.json({
                success: true,
                user: {
                    id: player.id || player.userId,
                    userId: player.userId || player.id,
                    username: player.username,
                    email: player.email
                }
            });

        } catch (error) {

            console.error("REGISTER ERROR:", error);

            res.status(500).json({
                success: false,
                message: "Registration failed"
            });
        }
    });


    // -----------------------------------------------------
    // LOGIN
    // -----------------------------------------------------

    app.post("/api/login", (req, res) => {

        try {

            const {
                username,
                password
            } = req.body;

            if (!username || !password) {
                return res.status(400).json({
                    success: false,
                    message: "Username and password are required"
                });
            }

            if (!game.login || typeof game.login !== "function") {
                return res.status(500).json({
                    success: false,
                    message: "Login system is not available"
                });
            }

            const result = game.login(
                username,
                password
            );

            if (!result || !result.player) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid username or password"
                });
            }

            const player = result.player;

            res.json({
                success: true,

                user: {
                    id: player.id || player.userId,
                    userId: player.userId || player.id,
                    username: player.username,
                    email: player.email
                },

                sessionId: result.sessionId
            });

        } catch (error) {

            console.error("LOGIN ERROR:", error);

            res.status(500).json({
                success: false,
                message: "Login failed"
            });
        }
    });


    // -----------------------------------------------------
    // SESSION
    // -----------------------------------------------------

    app.get("/api/session", (req, res) => {

        try {

            const sessionId =
                req.headers["x-session-id"];

            if (!sessionId) {
                return res.json({
                    user: null
                });
            }

            if (!game.sessions ||
                typeof game.sessions.get !== "function") {

                return res.json({
                    user: null
                });
            }

            const session =
                game.sessions.get(sessionId);

            if (!session) {
                return res.json({
                    user: null
                });
            }

            const player =
                game.players.get(session.userId);

            if (!player) {
                return res.json({
                    user: null
                });
            }

            res.json({
                user: {
                    id: player.id || player.userId,
                    userId: player.userId || player.id,
                    username: player.username,
                    email: player.email
                }
            });

        } catch (error) {

            console.error("SESSION ERROR:", error);

            res.status(500).json({
                user: null
            });
        }
    });


    // -----------------------------------------------------
    // LOGOUT
    // -----------------------------------------------------

    app.post("/api/logout", (req, res) => {

        try {

            const sessionId =
                req.headers["x-session-id"];

            if (sessionId &&
                game.sessions &&
                typeof game.sessions.delete === "function") {

                game.sessions.delete(sessionId);
            }

            res.json({
                success: true
            });

        } catch (error) {

            console.error("LOGOUT ERROR:", error);

            res.json({
                success: true
            });
        }
    });

};

