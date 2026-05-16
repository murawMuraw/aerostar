const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('./database');
const { authenticateToken } = require('./auth');
const guestStore = require('./guestStore');
const { getWindData } = require('./windService');
const { getPlaceName } = require('./locationService');
const config = require('./config');

const router = express.Router();

// ========== HEALTH CHECK ==========
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    env: config.env
  });
});

// ========== ПУБЛИЧНЫЕ API ==========
router.get('/wind', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lon);
  
  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }
  
  try {
    const wind = await getWindData(lat, lng);
    res.json(wind);
  } catch (error) {
    console.error('❌ Ошибка получения ветра:', error.message);
    res.status(500).json({ error: 'Failed to get wind data' });
  }
});

router.get('/place', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lon);
  
  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }
  
  try {
    const place = await getPlaceName(lat, lng);
    if (!place.error) {
      res.json(place);
    } else {
      res.status(500).json(place);
    }
  } catch (error) {
    console.error('Ошибка получения места:', error.message);
    res.status(500).json({ found: false, error: 'Internal Server Error' });
  }
});

// ========== АВТОРИЗАЦИЯ ==========
router.post('/auth/register', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email и пароль обязательны' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
  }
  
  try {
    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, password_hash]
    );
    
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, config.jwtSecret, { expiresIn: '7d' });
    
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (error) {
    if (error.code === '23505') {
      res.status(400).json({ error: 'Email уже зарегистрирован' });
    } else {
      console.error('Ошибка регистрации:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }
});

router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    
    if (!valid) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    
    const token = jwt.sign({ userId: user.id, email: user.email }, config.jwtSecret, { expiresIn: '7d' });
    
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, created_at FROM users WHERE id = $1', [req.user.userId]);
    
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'Пользователь не найден' });
    }
  } catch (error) {
    console.error('Ошибка получения пользователя:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ========== API ШАРОВ ==========
router.get('/balloons/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM balloons WHERE user_id = $1 AND is_flying = true ORDER BY start_time DESC LIMIT 1',
      [req.user.userId]
    );
    
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'Шар не найден' });
    }
  } catch (error) {
    console.error('Ошибка получения шара:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/balloons/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (guestStore.has(userId)) {
      const guestBalloon = guestStore.get(userId);
      if (guestBalloon.is_flying) {
        console.log(`📦 Найден гостевой шар для ${userId}`);
        return res.json(guestBalloon);
      }
    }
    
    const result = await pool.query(
      'SELECT * FROM balloons WHERE user_id = $1 AND is_flying = true ORDER BY start_time DESC LIMIT 1',
      [userId]
    );
    
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'Шар не найден' });
    }
  } catch (error) {
    console.error('Ошибка получения шара:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/balloons', async (req, res) => {
  const { lat, lng, userId, isGuest = true } = req.body;
  
  if (!lat || !lng || !userId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  try {
    const wind = await getWindData(lat, lng);
    
    if (!wind) {
      return res.status(500).json({ error: 'Не удалось получить данные о ветре' });
    }
    
    if (isGuest || userId.toString().startsWith('guest_')) {
      const balloonId = guestStore.generateGuestId();
      
      const guestBalloon = {
        id: balloonId,
        user_id: userId,
        start_lat: lat,
        start_lng: lng,
        current_lat: lat,
        current_lng: lng,
        start_time: new Date(),
        last_update: new Date(),
        wind_speed: wind.speed,
        wind_direction: wind.direction,
        is_flying: true,
        path: [{ lat, lng, time: new Date() }],
        socketId: null
      };
      
      guestStore.set(userId, guestBalloon);
      
      console.log(`🎈 Создан гостевой шар ${balloonId} для ${userId}`);
      return res.json(guestBalloon);
    }
    
    const result = await pool.query(
      `INSERT INTO balloons 
       (user_id, start_lat, start_lng, current_lat, current_lng, wind_speed, wind_direction, path)
       VALUES ($1, $2, $3, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, lat, lng, wind.speed, wind.direction, JSON.stringify([{lat, lng, time: new Date()}])]
    );
    
    console.log(`🎈 Создан авторизованный шар для пользователя ${userId}`);
    res.json(result.rows[0]);
    
  } catch (error) {
    console.error('Ошибка создания шара:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/balloons/:id/stop', async (req, res) => {
  try {
    const { id } = req.params;
    
    const guestBalloon = guestStore.getByBalloonId(id);
    
    if (guestBalloon) {
      guestBalloon.balloon.is_flying = false;
      guestStore.set(guestBalloon.key, guestBalloon.balloon);
      console.log(`🛑 Гостевой шар ${id} остановлен`);
      return res.json({ success: true });
    }
    
    await pool.query('UPDATE balloons SET is_flying = false WHERE id = $1', [id]);
    console.log(`🛑 Авторизованный шар ${id} остановлен`);
    res.json({ success: true });
    
  } catch (error) {
    console.error('Ошибка остановки шара:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ========== ИСПРАВЛЕННЫЙ ЭНДПОИНТ /api/balloons ==========
router.get('/balloons', async (req, res) => {
  try {
    // Добавляем JOIN с таблицей users, чтобы получить email
    const dbResult = await pool.query(
      `SELECT b.id, b.user_id, b.current_lat, b.current_lng, b.wind_speed, b.last_update, b.start_time, u.email 
       FROM balloons b
       LEFT JOIN users u ON b.user_id = u.id
       WHERE b.is_flying = true`
    );
    
    // Для гостевых шаров email не будет (или можно использовать user_id как идентификатор)
    const guestBalloonsList = guestStore.getActive().map(balloon => ({
      id: balloon.id,
      user_id: balloon.user_id,
      email: null, // или `guest_${balloon.user_id}`
      current_lat: balloon.current_lat,
      current_lng: balloon.current_lng,
      wind_speed: balloon.wind_speed,
      last_update: balloon.last_update,
      start_time: balloon.start_time
    }));
    
    const allBalloons = [...dbResult.rows, ...guestBalloonsList];
    console.log(`📊 Отправлено шаров: ${allBalloons.length} (БД: ${dbResult.rows.length}, гости: ${guestBalloonsList.length})`);
    res.json(allBalloons);
    
  } catch (error) {
    console.error('Ошибка получения шаров:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ========== СТАТИСТИКА ==========
router.get('/stats', async (req, res) => {
  try {
    const activeDbBalloons = await pool.query('SELECT COUNT(*) FROM balloons WHERE is_flying = true');
    const activeGuestBalloons = guestStore.getActive().length;
    const totalDbBalloons = await pool.query('SELECT COUNT(*) FROM balloons');
    
    res.json({
      active_balloons_db: parseInt(activeDbBalloons.rows[0].count),
      active_balloons_guest: activeGuestBalloons,
      total_active_balloons: parseInt(activeDbBalloons.rows[0].count) + activeGuestBalloons,
      total_balloons_ever: parseInt(totalDbBalloons.rows[0].count),
      guest_balloons_in_memory: guestStore.size,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
