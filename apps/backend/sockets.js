const guestStore = require('./guestStore');

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log('🟢 Новый клиент подключен:', socket.id);
    
    socket.on('join-balloon', (balloonId) => {
      socket.join(`balloon-${balloonId}`);
      console.log(`📡 Клиент ${socket.id} присоединился к шару ${balloonId}`);
      
      const guestBalloon = guestStore.getByBalloonId(balloonId);
      if (guestBalloon) {
        guestBalloon.balloon.socketId = socket.id;
        guestStore.set(guestBalloon.key, guestBalloon.balloon);
        
        socket.emit('balloon-state', guestBalloon.balloon);
        console.log(`🔗 Гостевой шар ${balloonId} привязан к сокету ${socket.id}`);
      }
    });
    
    socket.on('disconnect', () => {
      console.log('🔴 Клиент отключен:', socket.id);
      
      let deletedCount = 0;
      const toDelete = [];
      
      for (const [guestId, balloon] of guestStore.guestBalloons.entries()) {
        if (balloon.socketId === socket.id) {
          toDelete.push(guestId);
          console.log(`🗑️ Гостевой шар ${balloon.id} будет удален (закрыт браузер)`);
          
          io.to(`balloon-${balloon.id}`).emit('balloon-removed', { 
            balloonId: balloon.id,
            reason: 'guest_disconnected' 
          });
        }
      }
      
      toDelete.forEach(guestId => {
        guestStore.delete(guestId);
        deletedCount++;
      });
      
      if (deletedCount > 0) {
        console.log(`✅ Удалено ${deletedCount} гостевых шаров после отключения клиента`);
      }
    });
  });
};
