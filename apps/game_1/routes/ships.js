app.post("/api/ship/create",(req,res)=>{


    const ship =
    game.createPlayerShip(
        "klip_20"
    );


    if(!ship){

        return res.status(500).json({

            success:false

        });

    }


    res.json({

        success:true,

        ship

    });


});
