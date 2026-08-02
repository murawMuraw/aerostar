// routes/ships.js

module.exports = function(app, game){


    // список кораблей
    app.get("/api/ships", (req,res)=>{

        res.json(
            game.ships.getAll()
        );

    });


    // состояние кораблей
    app.get("/api/ships/state", (req,res)=>{

        res.json({

            ships: game.ships.getAll()

        });

    });


    // выбор корабля игроком
    app.post("/api/select_ship", (req,res)=>{

        const {
            userId,
            shipType
        } = req.body;


        const ship = game.joinRace(
            userId,
            shipType
        );


        if(!ship){

            res.status(400).json({

                error:"Ship unavailable"

            });

            return;

        }


        res.json({

            success:true,
            ship

        });


    });


};
