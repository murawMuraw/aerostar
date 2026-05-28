const { pool } = require('./database');
const guestStore = require('./guestStore');
const { getWindData, calculateNewPosition } = require('./windService');

async function updateAllBalloons(io) {
  console.log('🔄 Фоновое обновление всех шаров...');
  
  try {
    // 1. Обновляем шары авторизованных пользователей (из БД)
    const balloons = await pool.query('SELECT * FROM balloons WHERE is_flying = true');
    
    // Получаем текущую минуту для проверки интервала прореживания
    const currentMinutes = new Date().getMinutes();
    const shouldSaveToHistory = currentMinutes % 10 === 0;
    
    for (const balloon of balloons.rows) {
      const wind = await getWindData(balloon.current_lat, balloon.current_lng);
      
      if (wind) {
        const newPos = calculateNewPosition(
          balloon.current_lat, balloon.current_lng,
          wind.speed, wind.direction, 60
        );
        
        let trimmedPath = balloon.path || [];
        
        // Добавляем точку в историю только раз в 10 минут
        if (shouldSaveToHistory) {
          trimmedPath.push({ 
            lat: balloon.current_lat, 
            lng: balloon.current_lng, 
            time: new Date() 
          });
          
          // Ограничиваем историю до 5 040 точек (ровно 5 недель пути)
          trimmedPath = trimmedPath.slice(-5040);
        }
        
        await pool.query(
          `UPDATE balloons SET 
            current_lat = $1, 
            current_lng = $2,
            wind_speed = $3, 
            wind_direction = $4,
            last_update = NOW(), 
            path = $5::jsonb
           WHERE id = $6`,
          [newPos.lat, newPos.lng, wind.speed, wind.direction, JSON.stringify(trimmedPath), balloon.id]
        );
        
        io.to(`balloon-${balloon.id}`).emit('balloon-update', {
          lat: newPos.lat,
          lng: newPos.lng,
          windSpeed: wind.speed,
          windDirection: wind.direction,
          path: trimmedPath
        });
        
        console.log(`✅ Авторизованный шар ${balloon.id.substring(0, 8)} обновлен ${shouldSaveToHistory ? '(точка добавлена в историю)' : ''}`);
      }
    }
    
    // 2. Обновляем гостевые шары (из памяти) - ОСТАВЛЕНО БЕЗ ИЗМЕНЕНИЙ
    console.log(`🔄 Обновление гостевых шаров: ${guestStore.size} active`);
    
    const activeGuests = guestStore.getActive();
    for (const balloon of activeGuests) {
      const wind = await getWindData(balloon.current_lat, balloon.current_lng);
      
      if (wind) {
        const newPos = calculateNewPosition(
          balloon.current_lat, balloon.current_lng,
          wind.speed, wind.direction, 60
        );
        
        const path = balloon.path || [];
        path.push({ 
          lat: balloon.current_lat, 
          lng: balloon.current_lng, 
          time: new Date() 
        });
        
        const trimmedPath = path.slice(-10000);
        
        const updatedBalloon = {
          ...balloon,
          current_lat: newPos.lat,
          current_lng: newPos.lng,
          wind_speed: wind.speed,
          wind_direction: wind.direction,
          last_update: new Date(),
          path: trimmedPath
        };
        
        guestStore.set(balloon.user_id, updatedBalloon);
        
        io.to(`balloon-${balloon.id}`).emit('balloon-update', {
          lat: newPos.lat,
          lng: newPos.lng,
          windSpeed: wind.speed,
          windDirection: wind.direction,
          path: trimmedPath
        });
        
        console.log(`✅ Гостевой шар ${balloon.id} обновлен`);
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка фонового обновления:', error.message);
  }
}

module.exports = { updateAllBalloons };

