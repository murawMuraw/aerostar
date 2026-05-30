const guestStore = require('./guestStore');

// Хранилище для публичного шара
let publicBalloonState = {
    position: null,
    path: [],
    lastUpdate: null
};

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log('🟢 Новый клиент подключен:', socket.id);
    
    // ========== СУЩЕСТВУЮЩАЯ ЛОГИКА ГОСТЕВЫХ ШАРОВ ==========
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
    
    // ========== НОВАЯ ЛОГИКА ПУБЛИЧНОГО ШАРА ==========
    
    // Клиент (watch.html) запрашивает состояние публичного шара
    socket.on('watch-public-balloon', () => {
      console.log(`👀 Клиент ${socket.id} начал просмотр публичного шара`);
      
      // Отправляем текущее состояние если есть
      if (publicBalloonState.position) {
        socket.emit('public-balloon-state', publicBalloonState);
      }
      
      // Добавляем клиента в комнату публичного шара
      socket.join('public-balloon-room');
    });
    
    // Обновление позиции от владельца публичного шара (aerostar@aerost.art)
    socket.on('update-public-balloon', (data) => {
      // Проверяем email пользователя (нужно получить из токена)
      // Для этого нужно, чтобы socket хранил userEmail
      if (socket.userEmail !== 'aerostar@aerost.art') {
        console.warn(`⚠️ Отказано в обновлении публичного шара для ${socket.userEmail}`);
        return;
      }
      
      console.log(`🎈 Публичный шар обновлен: ${data.position.lat}, ${data.position.lng}`);
      
      publicBalloonState = {
        position: data.position,
        path: data.path || [],
        lastUpdate: new Date()
      };
      
      // Рассылаем всем в комнате публичного шара
      io.to('public-balloon-room').emit('public-balloon-update', publicBalloonState);
    });
    
    // Аутентификация пользователя для определения email
    socket.on('authenticate', (token) => {
      try {
        // Здесь нужно декодировать JWT токен и получить email
        // Пример с простым декодированием (без проверки подписи)
        const decoded = Buffer.from(token.split('.')[1], 'base64').toString();
        const userData = JSON.parse(decoded);
        socket.userEmail = userData.email;
        
        console.log(`✅ Socket ${socket.id} аутентифицирован как ${socket.userEmail}`);
        
        // Если это владелец публичного шара, добавляем его в специальную комнату
        if (socket.userEmail === 'aerostar@aerost.art') {
          socket.join('public-balloon-owner');
          console.log(`👑 Владелец публичного шара ${socket.userEmail} авторизован`);
        }
      } catch (error) {
        console.error('Ошибка аутентификации socket:', error);
      }
    });
    
    // ========== СУЩЕСТВУЮЩАЯ ЛОГИКА ОТКЛЮЧЕНИЯ ==========
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
