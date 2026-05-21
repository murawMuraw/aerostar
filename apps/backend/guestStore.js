class GuestBalloonStore {
  constructor() {
    // Основное хранилище
    this.guestBalloons = new Map();
    
    // Время жизни записи (например, 1 минута)
    this.TTL = 60 * 1000; 

    // Запускаем автоматическую очистку каждую минуту
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Генерация уникального ID для гостя
   */
  generateGuestId() {
    return `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Сохранить шарик. 
   * Добавляем метку времени updatedAt для отслеживания "свежести" записи.
   */
  set(userId, balloon) {
    this.guestBalloons.set(userId, {
      ...balloon,
      updatedAt: Date.now() // Метка для очистки
    });
  }

  /**
   * Получить шарик.
   * При каждом обращении обновляем метку времени, чтобы продлить жизнь записи.
   */
  get(userId) {
    const data = this.guestBalloons.get(userId);
    if (data) {
      data.updatedAt = Date.now(); // "Освежаем" запись при использовании
      return data;
    }
    return null;
  }

  /**
   * Удаление по ID пользователя
   */
  delete(userId) {
    return this.guestBalloons.delete(userId);
  }

  /**
   * Проверка наличия
   */
  has(userId) {
    return this.guestBalloons.has(userId);
  }

  /**
   * Получить все шарики в виде массива
   */
  getAll() {
    return Array.from(this.guestBalloons.values());
  }

  /**
   * Поиск шарика по его внутреннему ID
   */
  getByBalloonId(balloonId) {
    for (const [key, balloon] of this.guestBalloons.entries()) {
      if (balloon.id === balloonId) {
        return { key, balloon };
      }
    }
    return null;
  }

  /**
   * Получить только летающие шарики
   */
  getActive() {
    return Array.from(this.guestBalloons.values()).filter(b => b.is_flying);
  }

  /**
   * Метод очистки: удаляет записи, которые старше чем заданный TTL
   */
  cleanup() {
    const now = Date.now();
    let deletedCount = 0;

    for (const [userId, balloon] of this.guestBalloons.entries()) {
      if (now - balloon.updatedAt > this.TTL) {
        this.guestBalloons.delete(userId);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`[Cleanup]: Удалено ${deletedCount} неактивных гостей.`);
    }
  }

  /**
   * Текущее количество объектов в памяти
   */
  get size() {
    return this.guestBalloons.size;
  }
}

// Экспортируем экземпляр (Singleton)
module.exports = new GuestBalloonStore();
