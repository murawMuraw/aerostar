// routes/auth.js
module.exports=function(app,game){


    app.post("/api/register",(req,res)=>{


        const result = game.login();


        res.json({

            userId: result.player.userId,

            sessionId: result.sessionId

        });


    });


};
