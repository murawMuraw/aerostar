// managers/SessionManager.js

const crypto = require("crypto");

class SessionManager {

    constructor() {

        // sessionId -> userId
        this.sessions = new Map();

        // userId -> sessionId
        this.users = new Map();

    }

    /**
     * Создать новую сессию для пользователя
     */
    create(userId) {

        // Если у пользователя уже есть сессия — удалить её
        this.removeByUser(userId);

        const sessionId = crypto.randomUUID();

        this.sessions.set(sessionId, userId);
        this.users.set(userId, sessionId);

        return sessionId;
    }

    /**
     * Проверить существование сессии
     */
    exists(sessionId) {

        return this.sessions.has(sessionId);

    }

    /**
     * Получить userId по sessionId
     */
    getUser(sessionId) {

        return this.sessions.get(sessionId) || null;

    }

    /**
     * Получить sessionId пользователя
     */
    getSession(userId) {

        return this.users.get(userId) || null;

    }

    /**
     * Проверить валидность сессии
     */
    validate(sessionId) {

        return this.sessions.has(sessionId);

    }

    /**
     * Удалить сессию по sessionId
     */
    remove(sessionId) {

        const userId = this.sessions.get(sessionId);

        if (!userId) return false;

        this.sessions.delete(sessionId);
        this.users.delete(userId);

        return true;

    }

    /**
     * Удалить сессию пользователя
     */
    removeByUser(userId) {

        const sessionId = this.users.get(userId);

        if (!sessionId) return false;

        this.users.delete(userId);
        this.sessions.delete(sessionId);

        return true;

    }

    /**
     * Очистить все сессии
     */
    clear() {

        this.sessions.clear();
        this.users.clear();

    }

    /**
     * Количество активных сессий
     */
    count() {

        return this.sessions.size;

    }

    /**
     * Список всех сессий (для отладки)
     */
    list() {

        return Array.from(this.sessions.entries()).map(([sessionId, userId]) => ({
            sessionId,
            userId
        }));

    }

}

module.exports = SessionManager;
