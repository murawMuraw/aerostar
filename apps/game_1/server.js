// server.js — полный сервер для игры Regatta с ветром и течениями

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3002;

// =====================
// 1. СТАТИЧЕСКИЕ ФАЙЛЫ
// =====================
app.use(express.static('public'));
app.use(express.json());

// =====================
// 2. КЕШИ ДАННЫХ
// =====================
const windCache = new Map();
const currentCache = new Map();
const CACHE_TTL = 600000; // 10 минут

// =====================
// 3. РАСШИРЕННАЯ МОДЕЛЬ ОКЕАНСКИХ ТЕЧЕНИЙ
// =====================

class OceanCurrentModel {
    constructor() {
        // Основные течения мира с их параметрами
        this.currents = [
            // ===== СЕВЕРНАЯ АТЛАНТИКА =====
            {
                name: 'Gulf Stream',
                type: 'warm',
                regions: [
                    { latMin: 24, latMax: 45, lngMin: -80, lngMax: -60 },
                    { latMin: 45, latMax: 55, lngMin: -60, lngMax: -40 }
                ],
                speed: 2.5,
                direction: 45,
                variation: 15
            },
            {
                name: 'North Atlantic Drift',
                type: 'warm',
                regions: [
                    { latMin: 45, latMax: 60, lngMin: -40, lngMax: -10 }
                ],
                speed: 1.8,
                direction: 60,
                variation: 20
            },
            
            // ===== ЮЖНАЯ АТЛАНТИКА =====
            {
                name: 'Brazil Current',
                type: 'warm',
                regions: [
                    { latMin: -30, latMax: -10, lngMin: -50, lngMax: -35 }
                ],
                speed: 1.5,
                direction: 180,
                variation: 15
            },
            {
                name: 'South Atlantic Current',
                type: 'cold',
                regions: [
                    { latMin: -40, latMax: -30, lngMin: -50, lngMax: 10 }
                ],
                speed: 1.2,
                direction: 90,
                variation: 20
            },
            {
                name: 'Benguela Current',
                type: 'cold',
                regions: [
                    { latMin: -35, latMax: -20, lngMin: 5, lngMax: 15 }
                ],
                speed: 1.0,
                direction: 350,
                variation: 10
            },
            
            // ===== СЕВЕРНЫЙ ТИХИЙ ОКЕАН =====
            {
                name: 'Kuroshio Current',
                type: 'warm',
                regions: [
                    { latMin: 20, latMax: 35, lngMin: 120, lngMax: 150 }
                ],
                speed: 2.2,
                direction: 50,
                variation: 15
            },
            {
                name: 'North Pacific Current',
                type: 'warm',
                regions: [
                    { latMin: 35, latMax: 45, lngMin: 150, lngMax: -130 }
                ],
                speed: 1.5,
                direction: 80,
                variation: 20
            },
            {
                name: 'California Current',
                type: 'cold',
                regions: [
                    { latMin: 25, latMax: 40, lngMin: -130, lngMax: -115 }
                ],
                speed: 0.8,
                direction: 160,
                variation: 15
            },
            
            // ===== ЮЖНЫЙ ТИХИЙ ОКЕАН =====
            {
                name: 'East Australian Current',
                type: 'warm',
                regions: [
                    { latMin: -35, latMax: -20, lngMin: 150, lngMax: 160 }
                ],
                speed: 1.8,
                direction: 180,
                variation: 15
            },
            {
                name: 'South Pacific Current',
                type: 'cold',
                regions: [
                    { latMin: -45, latMax: -35, lngMin: 160, lngMax: -70 }
                ],
                speed: 1.0,
                direction: 90,
                variation: 20
            },
            {
                name: 'Peru Current',
                type: 'cold',
                regions: [
                    { latMin: -30, latMax: -10, lngMin: -90, lngMax: -70 }
                ],
                speed: 0.9,
                direction: 340,
                variation: 10
            },
            
            // ===== ИНДИЙСКИЙ ОКЕАН =====
            {
                name: 'Agulhas Current',
                type: 'warm',
                regions: [
                    { latMin: -35, latMax: -25, lngMin: 25, lngMax: 35 }
                ],
                speed: 2.0,
                direction: 210,
                variation: 15
            },
            {
                name: 'West Australian Current',
                type: 'cold',
                regions: [
                    { latMin: -35, latMax: -20, lngMin: 110, lngMax: 120 }
                ],
                speed: 0.7,
                direction: 350,
                variation: 10
            },
            {
                name: 'South Indian Current',
                type: 'cold',
                regions: [
                    { latMin: -40, latMax: -30, lngMin: 40, lngMax: 110 }
                ],
                speed: 1.0,
                direction: 90,
                variation: 20
            },
            
            // ===== ЭКВАТОРИАЛЬНЫЕ ТЕЧЕНИЯ =====
            {
                name: 'North Equatorial Current (Atlantic)',
                type: 'warm',
                regions: [
                    { latMin: 5, latMax: 15, lngMin: -60, lngMax: -20 }
                ],
                speed: 0.8,
                direction: 270,
                variation: 15
            },
            {
                name: 'South Equatorial Current (Atlantic)',
                type: 'warm',
                regions: [
                    { latMin: -10, latMax: 0, lngMin: -50, lngMax: 0 }
                ],
                speed: 0.9,
                direction: 270,
                variation: 15
            },
            {
                name: 'North Equatorial Current (Pacific)',
                type: 'warm',
                regions: [
                    { latMin: 10, latMax: 20, lngMin: 130, lngMax: -120 }
                ],
                speed: 0.7,
                direction: 270,
                variation: 15
            },
            {
                name: 'South Equatorial Current (Pacific)',
                type: 'warm',
                regions: [
                    { latMin: -10, latMax: 5, lngMin: 160, lngMax: -80 }
                ],
                speed: 0.8,
                direction: 270,
                variation: 15
            },
            {
                name: 'Equatorial Countercurrent',
                type: 'warm',
                regions: [
                    { latMin: 5, latMax: 10, lngMin: -50, lngMax: 0 }
                ],
                speed: 0.6,
                direction: 90,
                variation: 10
            },
            
            // ===== АНТАРКТИЧЕСКИЕ ТЕЧЕНИЯ =====
            {
                name: 'Antarctic Circumpolar Current',
                type: 'cold',
                regions: [
                    { latMin: -65, latMax: -50, lngMin: -180, lngMax: 180 }
                ],
                speed: 1.5,
                direction: 90,
                variation: 10,
                isCircumpolar: true
            },
            
            // ===== СЕВЕРНЫЙ ЛЕДОВИТЫЙ ОКЕАН =====
            {
                name: 'East Greenland Current',
                type: 'cold',
                regions: [
                    { latMin: 65, latMax: 80, lngMin: -40, lngMax: -10 }
                ],
                speed: 0.8,
                direction: 180,
                variation: 10
            },
            {
                name: 'Norwegian Current',
                type: 'warm',
                regions: [
                    { latMin: 60, latMax: 70, lngMin: -10, lngMax: 20 }
                ],
                speed: 0.9,
                direction: 45,
                variation: 15
            }
        ];
        
        // Сезонные вариации
        this.seasonalFactors = {
            summer: 1.2,
            winter: 0.8,
            spring: 1.0,
            autumn: 1.0
        };
    }

    // ============================================
    //  ОСНОВНОЙ МЕТОД ДЛЯ ПОЛУЧЕНИЯ ТЕЧЕНИЯ
    // ============================================
    getCurrent(lat, lng, date = new Date()) {
        // 1. Определяем сезон
        const season = this.getSeason(date);
        const seasonalFactor = this.seasonalFactors[season] || 1.0;
        
        // 2. Находим все течения, влияющие на эту точку
        const activeCurrents = this.findActiveCurrents(lat, lng);
        
        if (activeCurrents.length === 0) {
            // Нет течений — слабый дрейф
            return this.generateBackgroundCurrent(lat, lng);
        }
        
        // 3. Суммируем влияние всех течений
        let totalU = 0;
        let totalV = 0;
        
        for (const current of activeCurrents) {
            const { u, v } = this.calculateCurrentVector(
                current,
                lat,
                lng,
                seasonalFactor
            );
            totalU += u;
            totalV += v;
        }
        
        // 4. Вычисляем результирующее течение
        const speed = Math.sqrt(totalU * totalU + totalV * totalV);
        const direction = (Math.atan2(totalU, totalV) * 180 / Math.PI + 360) % 360;
        
        return {
            speed: Math.min(speed, 4.0), // Максимальная скорость течения
            direction: direction,
            u: totalU,
            v: totalV,
            components: activeCurrents.map(c => c.name),
            season: season
        };
    }

    // ============================================
    //  ПОИСК АКТИВНЫХ ТЕЧЕНИЙ В ТОЧКЕ
    // ============================================
    findActiveCurrents(lat, lng) {
        const active = [];
        
        for (const current of this.currents) {
            // Для циркумполярного течения
            if (current.isCircumpolar) {
                if (lat >= current.regions[0].latMin && 
                    lat <= current.regions[0].latMax) {
                    active.push(current);
                }
                continue;
            }
            
            // Проверяем все регионы течения
            for (const region of current.regions) {
                // Обработка пересечения 180° меридиана
                let lngMin = region.lngMin;
                let lngMax = region.lngMax;
                
                if (lngMin > lngMax) {
                    // Течение пересекает 180°
                    if (lng >= lngMin || lng <= lngMax) {
                        if (lat >= region.latMin && lat <= region.latMax) {
                            active.push(current);
                            break;
                        }
                    }
                } else {
                    // Обычный случай
                    if (lng >= lngMin && lng <= lngMax) {
                        if (lat >= region.latMin && lat <= region.latMax) {
                            active.push(current);
                            break;
                        }
                    }
                }
            }
        }
        
        return active;
    }

    // ============================================
    //  ВЫЧИСЛЕНИЕ ВЕКТОРА ТЕЧЕНИЯ
    // ============================================
    calculateCurrentVector(current, lat, lng, seasonalFactor) {
        // 1. Базовая скорость течения
        let speed = current.speed * seasonalFactor;
        
        // 2. Добавляем вариацию в зависимости от широты
        const latVariation = 0.5 + Math.sin(lat * 0.1) * 0.5;
        speed *= (0.8 + latVariation * 0.4);
        
        // 3. Добавляем случайную вариацию (реалистичность)
        const randomVariation = 0.85 + Math.random() * 0.3;
        speed *= randomVariation;
        
        // 4. Направление с вариацией
        let direction = current.direction;
        
        // Добавляем широтную зависимость направления
        const latDirectionShift = Math.sin(lat * 0.05) * 10;
        direction += latDirectionShift;
        
        // Случайная вариация направления
        const directionVariation = (Math.random() - 0.5) * current.variation;
        direction += directionVariation;
        
        // Нормализуем направление
        direction = (direction + 360) % 360;
        
        // 5. Вычисляем компоненты вектора
        const rad = direction * Math.PI / 180;
        const u = speed * Math.cos(rad);
        const v = speed * Math.sin(rad);
        
        return { u, v };
    }

    // ============================================
    //  ФОНОВОЕ ТЕЧЕНИЕ (если нет основных)
    // ============================================
    generateBackgroundCurrent(lat, lng) {
        // Слабый дрейф, основанный на глобальной циркуляции
        const baseSpeed = 0.2 + Math.sin(lat * 0.2) * 0.1 + Math.cos(lng * 0.15) * 0.1;
        const direction = (Math.atan2(Math.sin(lat * 0.3), Math.cos(lng * 0.2)) * 180 / Math.PI + 180) % 360;
        
        const rad = direction * Math.PI / 180;
        const u = baseSpeed * Math.cos(rad);
        const v = baseSpeed * Math.sin(rad);
        
        return {
            speed: baseSpeed,
            direction: direction,
            u: u,
            v: v,
            components: ['background'],
            season: 'background'
        };
    }

    // ============================================
    //  ОПРЕДЕЛЕНИЕ СЕЗОНА
    // ============================================
    getSeason(date) {
        const month = date.getMonth(); // 0-11
        const day = date.getDate();
        
        // Северное полушарие
        if ((month === 2 && day >= 20) || (month >= 3 && month <= 4) || (month === 5 && day <= 20)) {
            return 'spring';
        } else if ((month === 5 && day >= 21) || (month >= 6 && month <= 7) || (month === 8 && day <= 22)) {
            return 'summer';
        } else if ((month === 8 && day >= 23) || (month >= 9 && month <= 10) || (month === 11 && day <= 20)) {
            return 'autumn';
        } else {
            return 'winter';
        }
    }

    // ============================================
    //  ПОЛУЧЕНИЕ ДАННЫХ ДЛЯ ВИЗУАЛИЗАЦИИ
    // ============================================
    getCurrentsForVisualization(latMin, latMax, lngMin, lngMax, step = 5) {
        const data = [];
        
        for (let lat = latMin; lat <= latMax; lat += step) {
            for (let lng = lngMin; lng <= lngMax; lng += step) {
                const current = this.getCurrent(lat, lng);
                data.push({
                    lat: lat,
                    lng: lng,
                    speed: current.speed,
                    direction: current.direction,
                    u: current.u,
                    v: current.v
                });
            }
        }
        
        return data;
    }

    // ============================================
    //  ПОЛУЧЕНИЕ ИНФОРМАЦИИ О ТЕЧЕНИИ ДЛЯ UI
    // ============================================
    getCurrentInfo(lat, lng) {
        const current = this.getCurrent(lat, lng);
        const activeNames = current.components || [];
        
        let description = '';
        if (activeNames.length === 0 || activeNames.includes('background')) {
            description = 'Слабое фоновое течение';
        } else {
            description = activeNames.join(' + ');
        }
        
        return {
            speed: current.speed,
            direction: current.direction,
            description: description,
            season: current.season
        };
    }
}

// Создаём экземпляр модели течений
const oceanCurrents = new OceanCurrentModel();
console.log('🌊 Ocean Current Model initialized');
console.log('   - Based on classic ocean currents schematic');
console.log('   - Seasonal variations enabled');
console.log('   - ' + oceanCurrents.currents.length + ' major currents defined');

// =====================
// 4. API ДЛЯ ВЕТРА И ТЕЧЕНИЙ
// =====================

// 4.1 ПОЛУЧЕНИЕ ВЕТРА (OpenWeatherMap)
async function fetchWindData(lat, lng) {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    
    if (!apiKey) {
        return generateTestWind(lat, lng);
    }
    
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.wind) {
            return {
                speed: data.wind.speed * 1.94384, // м/с → узлы
                direction: data.wind.deg || 0,
                gust: data.wind.gust ? data.wind.gust * 1.94384 : 0
            };
        }
    } catch (error) {
        console.error('OpenWeatherMap error:', error);
    }
    
    return generateTestWind(lat, lng);
}

function generateTestWind(lat, lng) {
    const baseSpeed = 5 + Math.sin(lat * 0.1) * 5 + Math.cos(lng * 0.1) * 3;
    const direction = (Math.atan2(lat, lng) * 180 / Math.PI + 180) % 360;
    
    return {
        speed: Math.max(0, baseSpeed + (Math.random() - 0.5) * 4),
        direction: direction + (Math.random() - 0.5) * 30,
        gust: Math.random() * 3
    };
}

// 4.2 ПОЛУЧЕНИЕ ТЕЧЕНИЙ (внутренняя модель + HYCOM)
async function fetchCurrentData(lat, lng) {
    // Проверяем кеш
    const key = `${parseFloat(lat).toFixed(2)},${parseFloat(lng).toFixed(2)}`;
    
    if (currentCache.has(key)) {
        const cached = currentCache.get(key);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.data;
        }
    }
    
    // Если есть API ключ для HYCOM — используем его
    const apiKey = process.env.HYCOM_API_KEY;
    
    if (apiKey) {
        try {
            // Попытка получить реальные данные
            const url = `https://api.hycom.org/thredds/dodsC/GLBv0.08/expt_93.0/tseries?lat=${lat}&lon=${lng}`;
            const response = await fetch(url);
            
            if (response.ok) {
                const data = await response.json();
                const current = {
                    speed: Math.sqrt(data.u * data.u + data.v * data.v) * 1.94384,
                    direction: (Math.atan2(data.u, data.v) * 180 / Math.PI + 360) % 360,
                    u: data.u,
                    v: data.v,
                    source: 'HYCOM'
                };
                
                currentCache.set(key, { data: current, timestamp: Date.now() });
                return current;
            }
        } catch (error) {
            console.log('HYCOM API unavailable, using internal model');
        }
    }
    
    // Используем внутреннюю модель течений
    const current = oceanCurrents.getCurrent(lat, lng);
    const result = {
        speed: current.speed,
        direction: current.direction,
        u: current.u,
        v: current.v,
        source: 'internal_model',
        components: current.components || [],
        season: current.season || 'unknown'
    };
    
    // Кешируем результат
    currentCache.set(key, { data: result, timestamp: Date.now() });
    
    return result;
}

// =====================
// 5. API МАРШРУТЫ
// =====================

// Получение ветра
app.get('/api/wind', async (req, res) => {
    const { lat, lng } = req.query;
    const key = `${parseFloat(lat).toFixed(2)},${parseFloat(lng).toFixed(2)}`;
    
    if (windCache.has(key)) {
        const cached = windCache.get(key);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            return res.json(cached.data);
        }
    }
    
    try {
        const windData = await fetchWindData(lat, lng);
        windCache.set(key, { data: windData, timestamp: Date.now() });
        res.json(windData);
    } catch (error) {
        console.error('Wind API error:', error);
        res.json(generateTestWind(lat, lng));
    }
});

// Получение течения в конкретной точке
app.get('/api/current', async (req, res) => {
    const { lat, lng } = req.query;
    
    if (!lat || !lng) {
        return res.status(400).json({ error: 'Missing lat/lng parameters' });
    }
    
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    
    if (isNaN(latNum) || isNaN(lngNum)) {
        return res.status(400).json({ error: 'Invalid lat/lng values' });
    }
    
    try {
        const currentData = await fetchCurrentData(latNum, lngNum);
        res.json(currentData);
    } catch (error) {
        console.error('Current API error:', error);
        res.status(500).json({ error: 'Failed to fetch current data' });
    }
});

// Получение сетки течений для визуализации
app.get('/api/currents/grid', (req, res) => {
    const { latMin, latMax, lngMin, lngMax, step } = req.query;
    
    const grid = oceanCurrents.getCurrentsForVisualization(
        parseFloat(latMin || -60),
        parseFloat(latMax || 60),
        parseFloat(lngMin || -180),
        parseFloat(lngMax || 180),
        parseFloat(step || 10)
    );
    
    res.json(grid);
});

// Получение информации о течении (с описанием)
app.get('/api/current/info', (req, res) => {
    const { lat, lng } = req.query;
    
    if (!lat || !lng) {
        return res.status(400).json({ error: 'Missing lat/lng parameters' });
    }
    
    const info = oceanCurrents.getCurrentInfo(
        parseFloat(lat),
        parseFloat(lng)
    );
    
    res.json(info);
});

// Тестовый маршрут для проверки модели течений
app.get('/api/currents/test', (req, res) => {
    const testPoints = [
        { lat: 30, lng: -75, name: 'Gulf Stream' },
        { lat: 25, lng: 130, name: 'Kuroshio' },
        { lat: -30, lng: 155, name: 'East Australian' },
        { lat: -60, lng: 0, name: 'Antarctic Circumpolar' },
        { lat: 0, lng: -40, name: 'Equatorial Atlantic' },
        { lat: 0, lng: 160, name: 'Equatorial Pacific' },
        { lat: -25, lng: 10, name: 'Benguela' },
        { lat: 30, lng: -120, name: 'California' },
        { lat: -30, lng: 30, name: 'Agulhas' },
    ];
    
    const results = testPoints.map(point => {
        const current = oceanCurrents.getCurrent(point.lat, point.lng);
        return {
            ...point,
            current: {
                speed: current.speed.toFixed(2),
                direction: current.direction.toFixed(0),
                u: current.u.toFixed(3),
                v: current.v.toFixed(3),
                components: current.components || ['background'],
                season: current.season || 'unknown'
            }
        };
    });
    
    res.json({
        model: 'Ocean Current Model v1.0',
        based_on: 'Classic ocean currents schematic',
        test_points: results,
        season: oceanCurrents.getSeason(new Date())
    });
});

// Получение списка маршрутов
app.get('/api/routes', (req, res) => {
    try {
        const routes = JSON.parse(fs.readFileSync('data/routes.json', 'utf8'));
        res.json(routes);
    } catch {
        res.json(defaultRoutes);
    }
});

// Получение лидерборда
app.get('/api/leaderboard', (req, res) => {
    try {
        const leaderboard = JSON.parse(fs.readFileSync('data/leaderboard.json', 'utf8'));
        res.json(leaderboard);
    } catch {
        res.json([]);
    }
});

// Сохранение результата
app.post('/api/score', (req, res) => {
    const { playerName, routeId, time } = req.body;
    
    let leaderboard = [];
    try {
        leaderboard = JSON.parse(fs.readFileSync('data/leaderboard.json', 'utf8'));
    } catch {
        leaderboard = [];
    }
    
    leaderboard.push({
        playerName,
        routeId,
        time,
        date: new Date().toISOString()
    });
    
    leaderboard.sort((a, b) => a.time - b.time);
    
    if (leaderboard.length > 100) {
        leaderboard = leaderboard.slice(0, 100);
    }
    
    fs.writeFileSync('data/leaderboard.json', JSON.stringify(leaderboard, null, 2));
    res.json({ success: true });
});

// =====================
// 6. ИГРОВОЕ СОСТОЯНИЕ
// =====================
const gameState = {
    players: {},
    startTime: Date.now()
};

class Player {
    constructor(id, name, lat, lng) {
        this.id = id;
        this.name = name;
        this.lat = lat;
        this.lng = lng;
        this.heading = 0;
        this.speed = 0;
        this.targetSpeed = 0;
        this.shipType = 1;
        this.currentDrift = { lat: 0, lng: 0 };
        this.lastUpdate = Date.now();
        this.raceId = null;
        this.finishTime = null;
        this.distanceTraveled = 0;
    }
}

// =====================
// 7. WebSocket
// =====================
wss.on('connection', (ws) => {
    console.log('🔗 Новый игрок подключен');
    let playerId = null;
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'join':
                    playerId = data.playerId || `player_${Date.now()}`;
                    const startPos = getRandomStartPosition();
                    
                    const player = new Player(
                        playerId,
                        data.name || 'Sailor',
                        startPos.lat,
                        startPos.lng
                    );
                    
                    gameState.players[playerId] = player;
                    
                    const wind = await fetchWindData(player.lat, player.lng);
                    const current = await fetchCurrentData(player.lat, player.lng);
                    
                    ws.send(JSON.stringify({
                        type: 'joined',
                        playerId: playerId,
                        position: { lat: player.lat, lng: player.lng },
                        wind: wind,
                        current: current
                    }));
                    
                    broadcast({
                        type: 'player_joined',
                        playerId: playerId,
                        name: player.name
                    });
                    break;
                    
                case 'move':
                    const p = gameState.players[playerId];
                    if (p) {
                        p.heading = (p.heading + (data.delta || 0)) % 360;
                        if (p.heading < 0) p.heading += 360;
                    }
                    break;
                    
                case 'speed':
                    const pl = gameState.players[playerId];
                    if (pl) {
                        pl.targetSpeed = Math.max(0, Math.min(10, data.speed || 0));
                    }
                    break;
                    
                case 'chat':
                    broadcast({
                        type: 'chat',
                        playerId: playerId,
                        message: data.message
                    });
                    break;
            }
        } catch (error) {
            console.error('WebSocket error:', error);
        }
    });
    
    ws.on('close', () => {
        if (playerId) {
            delete gameState.players[playerId];
            broadcast({
                type: 'player_left',
                playerId: playerId
            });
            console.log(`👋 Игрок ${playerId} отключен`);
        }
    });
});

// =====================
// 8. ИГРОВОЙ ЦИКЛ
// =====================
const TICK_INTERVAL = 1000 / 60;

setInterval(async () => {
    const now = Date.now();
    const deltaTime = (now - gameState.startTime) / 1000;
    gameState.startTime = now;
    
    for (const [id, player] of Object.entries(gameState.players)) {
        try {
            // 1. Получаем ВЕТЕР
            const wind = await fetchWindData(player.lat, player.lng);
            
            // 2. Получаем ТЕЧЕНИЕ
            const current = await fetchCurrentData(player.lat, player.lng);
            
            // 3. Обновляем скорость от парусов
            const speedDiff = player.targetSpeed - player.speed;
            player.speed += speedDiff * deltaTime * 0.3;
            player.speed = Math.max(0, Math.min(10, player.speed));
            
            // 4. Движение от ВЕТРА
            let latDelta = 0;
            let lngDelta = 0;
            
            if (player.speed > 0.1) {
                const angleToWind = player.heading - wind.direction;
                const windEffect = Math.cos(angleToWind * Math.PI / 180);
                const efficiency = Math.max(0.1, (windEffect + 1) / 2);
                
                const sailSpeed = player.speed * wind.speed * efficiency * 0.008;
                
                const latPerSecond = (sailSpeed * 0.514) / 111320;
                const lngPerSecond = latPerSecond / Math.cos(player.lat * Math.PI / 180);
                
                latDelta += latPerSecond * Math.cos(player.heading * Math.PI / 180);
                lngDelta += lngPerSecond * Math.sin(player.heading * Math.PI / 180);
            }
            
            // 5. Движение от ТЕЧЕНИЯ
            if (current.speed > 0.1) {
                const currentSpeedKnots = current.speed * 0.514;
                const latPerSecond = currentSpeedKnots / 111320;
                const lngPerSecond = latPerSecond / Math.cos(player.lat * Math.PI / 180);
                
                const currentRad = current.direction * Math.PI / 180;
                latDelta += latPerSecond * Math.cos(currentRad);
                lngDelta += lngPerSecond * Math.sin(currentRad);
            }
            
            // 6. Применяем движение
            const newLat = player.lat + latDelta * deltaTime;
            const newLng = player.lng + lngDelta * deltaTime;
            
            if (!isOnLand(newLat, newLng)) {
                player.lat = newLat;
                player.lng = newLng;
            } else {
                player.speed = 0;
                player.targetSpeed = 0;
            }
            
            player.currentDrift = {
                lat: latDelta * deltaTime * 111320,
                lng: lngDelta * deltaTime * 111320 * Math.cos(player.lat * Math.PI / 180)
            };
            
        } catch (error) {
            console.error(`Error updating player ${id}:`, error);
        }
    }
    
    if (Math.floor(Date.now() / 100) % 3 === 0) {
        broadcastState();
    }
}, TICK_INTERVAL);

// =====================
// 9. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =====================

function getRandomStartPosition() {
    const positions = [
        { lat: 50, lng: -10 },
        { lat: 40, lng: -30 },
        { lat: 30, lng: -15 },
        { lat: 20, lng: -20 },
        { lat: 0, lng: 10 },
        { lat: -20, lng: 20 },
        { lat: 35, lng: 130 },
        { lat: -30, lng: 150 },
    ];
    return positions[Math.floor(Math.random() * positions.length)];
}

function isOnLand(lat, lng) {
    const landMasses = [
        { latMin: 36, latMax: 70, lngMin: -10, lngMax: 40 },
        { latMin: -35, latMax: 37, lngMin: -20, lngMax: 50 },
        { latMin: 25, latMax: 70, lngMin: -130, lngMax: -60 },
        { latMin: -55, latMax: 12, lngMin: -80, lngMax: -35 },
        { latMin: 10, latMax: 75, lngMin: 40, lngMax: 150 },
        { latMin: -40, latMax: -10, lngMin: 113, lngMax: 155 },
    ];
    
    for (const region of landMasses) {
        if (lat >= region.latMin && lat <= region.latMax &&
            lng >= region.lngMin && lng <= region.lngMax) {
            return true;
        }
    }
    return false;
}

function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function broadcastState() {
    const state = {
        type: 'state',
        players: {}
    };
    
    for (const [id, player] of Object.entries(gameState.players)) {
        state.players[id] = {
            name: player.name,
            lat: player.lat,
            lng: player.lng,
            heading: player.heading,
            speed: player.speed,
            targetSpeed: player.targetSpeed,
            shipType: player.shipType,
            drift: player.currentDrift
        };
    }
    
    broadcast(state);
}

// =====================
// 10. ДЕФОЛТНЫЕ ДАННЫЕ
// =====================

const defaultRoutes = [
    {
        id: 'route_1',
        name: 'Atlantic Sprint',
        startLat: 50, startLng: -10,
        finishLat: 40, finishLng: -30,
        distance: 1500
    },
    {
        id: 'route_2',
        name: 'Equator Crossing',
        startLat: 30, startLng: -15,
        finishLat: 0, finishLng: 10,
        distance: 3500
    },
    {
        id: 'route_3',
        name: 'Gulf Stream Challenge',
        startLat: 25, startLng: -80,
        finishLat: 45, finishLng: -60,
        distance: 2500
    }
];

// =====================
// 11. ЗАПУСК СЕРВЕРА
// =====================

// Создаём папку data, если её нет
if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
}

// Создаём файлы с данными, если их нет
if (!fs.existsSync('data/routes.json')) {
    fs.writeFileSync('data/routes.json', JSON.stringify(defaultRoutes, null, 2));
}

if (!fs.existsSync('data/leaderboard.json')) {
    fs.writeFileSync('data/leaderboard.json', JSON.stringify([], null, 2));
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Regatta server running at http://0.0.0.0:${PORT}`);
    console.log(`🌊 With wind + ocean currents support`);
    console.log(`📊 Active players: ${Object.keys(gameState.players).length}`);
    console.log(`\n📡 API endpoints:`);
    console.log(`   GET /api/wind?lat=&lng=  - Wind data`);
    console.log(`   GET /api/current?lat=&lng= - Current data`);
    console.log(`   GET /api/currents/grid - Currents grid for visualization`);
    console.log(`   GET /api/currents/test - Test current model`);
    console.log(`   GET /api/routes - Available routes`);
    console.log(`   GET /api/leaderboard - Leaderboard`);
    console.log(`   POST /api/score - Save score`);
    console.log(`\n🌐 WebSocket: ws://0.0.0.0:${PORT}`);
});

// Обработка завершения
process.on('SIGINT', () => {
    console.log('\n🛑 Server shutting down...');
    process.exit();
});
