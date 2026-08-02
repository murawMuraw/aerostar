// routes/auth.js
const crypto = require("crypto");
module.exports=function(app,game){


    app.post("/api/register",(req,res)=>{


        const userId =
            req.body.userId ||
            crypto.randomUUID();


        const result =
            game.login(userId);


        res.json({

            userId,
            sessionId: result.sessionId

        });


    });


};
