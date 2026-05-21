// Подключаем модуль pg (PostgreSQL клиент) и деструктурируем из него класс Pool
// Pool - пул соединений с БД, позволяет эффективно управлять подключениями
const { Pool } = require('pg');

// Подключаем конфигурационный файл (вероятно, содержит databaseUrl и другие настройки)
const config = require('./config');

// Создаем экземпляр пула соединений с PostgreSQL
const pool = new Pool({
  // Строка подключения к БД (формат: postgresql://user:password@host:port/database)
  connectionString: config.databaseUrl,
  
  // Настройки SSL для безопасного соединения
  // rejectUnauthorized: false - отключает проверку SSL сертификата
  // ⚠️ Внимание: это снижает безопасность, подходит только для разработки/тестирования
  ssl: { rejectUnauthorized: false }
});

/**
 * Инициализация структуры базы данных
 * Создает необходимые таблицы, если они не существуют
 */
async function initDatabase() {
  try {
    // Таблица пользователей
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- Уникальный идентификатор пользователя, генерируется автоматически
        email TEXT UNIQUE NOT NULL,                     -- Email пользователя (уникальный и обязательный)
        password_hash TEXT NOT NULL,                    -- Хеш пароля (никогда не храним пароль в открытом виде!)
        created_at TIMESTAMP DEFAULT NOW()              -- Время регистрации пользователя
      )
    `);
    
    // Таблица воздушных шаров (отслеживание полетов)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS balloons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- Уникальный ID шара
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,  -- Владелец шара, при удалении пользователя удаляются и его шары
        start_lat FLOAT,        -- Широта точки старта
        start_lng FLOAT,        -- Долгота точки старта
        current_lat FLOAT,      -- Текущая широта шара
        current_lng FLOAT,      -- Текущая долгота шара
        start_time TIMESTAMP DEFAULT NOW(),   -- Время начала полета
        last_update TIMESTAMP DEFAULT NOW(),  -- Время последнего обновления координат
        wind_speed FLOAT,       -- Скорость ветра (влияет на движение шара)
        wind_direction FLOAT,   -- Направление ветра в градусах
        is_flying BOOLEAN DEFAULT true,  -- Статус полета (true - в полете, false - приземлился)
        path JSONB DEFAULT '[]'          -- История перемещений (массив точек в формате JSON)
      )
    `);
    
    console.log('✅ База данных инициализирована');
  } catch (error) {
    console.error('❌ Ошибка инициализации БД:', error.message);
  }
}

// Экспортируем пул соединений и функцию инициализации для использования в других модулях
module.exports = { pool, initDatabase };
