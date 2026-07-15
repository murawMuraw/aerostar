// admin.js

let map = null;
let startMarker = null;
let finishMarker = null;
let currentRaceData = null;

document.addEventListener('DOMContentLoaded', () => {
    // Карта
    map = L.map('start-map').setView([40, -30], 3);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri'
    }).addTo(map);

    // Загружаем текущую гонку
    loadRace();

    // Вкладки
    document.querySelectorAll('.admin-tabs button').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.admin-tabs button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
        };
    });

    // Сохранение гонки
    document.getElementById('btn-save-race').onclick = saveRace;

    // Старт гонки
    document.getElementById('btn-start-race').onclick = startRace;

    // Финиш
    document.getElementById('btn-finish-race').onclick = finishRace;

    // Обновление маркеров при изменении координат
    ['start-lat', 'start-lng', 'finish-lat', 'finish-lng'].forEach(id => {
        document.getElementById(id).oninput = updateMarkers;
    });

    // Кнопка добавления гонки
    document.getElementById('btn-add-race').onclick = addRace;

    // Загрузка игроков
    loadPlayers();
    setInterval(loadPlayers, 10000);
});

function loadRace() {
    fetch('/api/admin/race')
        .then(r => r.json())
        .then(data => {
            currentRaceData = data;
            if (data) {
                document.getElementById('start-name').value = data.startName || '';
                document.getElementById('start-lat').value = data.startLat || 0;
                document.getElementById('start-lng').value = data.startLng || 0;
                document.getElementById('finish-name').value = data.finishName || '';
                document.getElementById('finish-lat').value = data.finishLat || 0;
                document.getElementById('finish-lng').value = data.finishLng || 0;

                document.getElementById('display-start').textContent = 
                    `${data.startName || '—'} (${data.startLat?.toFixed(2) || '—'}°, ${data.startLng?.toFixed(2) || '—'}°)`;
                document.getElementById('display-finish').textContent = 
                    `${data.finishName || '—'} (${data.finishLat?.toFixed(2) || '—'}°, ${data.finishLng?.toFixed(2) || '—'}°)`;

                updateMarkers();

                // Обновляем статус
                const statusMap = {
                    'scheduled': { text: '⏳ Запланирована', class: 'scheduled' },
                    'active': { text: '🚀 Активна', class: 'active' },
                    'finished': { text: '🏁 Завершена', class: 'finished' }
                };
                const status = statusMap[data.status] || statusMap.scheduled;
                document.querySelector('.current-race').innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                        <span style="font-weight:600;">
                            ${data.status === 'active' ? '🚀 Гонка идёт!' : 
                              data.status === 'finished' ? '🏁 Гонка завершена' : 
                              '⏳ Гонка запланирована'}
                        </span>
                        <span class="race-status ${status.class}">${status.text}</span>
                    </div>
                `;
            }
        });
}

function updateMarkers() {
    const startLat = parseFloat(document.getElementById('start-lat').value);
    const startLng = parseFloat(document.getElementById('start-lng').value);
    const finishLat = parseFloat(document.getElementById('finish-lat').value);
    const finishLng = parseFloat(document.getElementById('finish-lng').value);

    if (startMarker) map.removeLayer(startMarker);
    if (finishMarker) map.removeLayer(finishMarker);

    if (!isNaN(startLat) && !isNaN(startLng) && startLat !== 0 && startLng !== 0) {
        startMarker = L.marker([startLat, startLng], {
            icon: L.divIcon({ 
                className: 'start-marker', 
                html: '🏁 СТАРТ', 
                iconSize: [60, 24],
                iconAnchor: [30, 12]
            })
        }).addTo(map);
        map.setView([startLat, startLng], 4);
    }

    if (!isNaN(finishLat) && !isNaN(finishLng) && finishLat !== 0 && finishLng !== 0) {
        finishMarker = L.marker([finishLat, finishLng], {
            icon: L.divIcon({ 
                className: 'finish-marker', 
                html: '🎯 ФИНИШ', 
                iconSize: [60, 24],
                iconAnchor: [30, 12]
            })
        }).addTo(map);
    }
}

function saveRace() {
    const raceData = {
        startName: document.getElementById('start-name').value,
        startLat: parseFloat(document.getElementById('start-lat').value),
        startLng: parseFloat(document.getElementById('start-lng').value),
        finishName: document.getElementById('finish-name').value,
        finishLat: parseFloat(document.getElementById('finish-lat').value),
        finishLng: parseFloat(document.getElementById('finish-lng').value)
    };

    fetch('/api/admin/race', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(raceData)
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            alert('✅ Маршрут сохранён!');
            loadRace();
        }
    });
}

function startRace() {
    if (confirm('🚀 Запустить гонку?\nИгроки смогут начать движение!')) {
        fetch('/api/admin/race/start', { method: 'POST' })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    alert('✅ Гонка начата!');
                    loadRace();
                }
            });
    }
}

function finishRace() {
    if (confirm('🏁 Завершить гонку?')) {
        fetch('/api/admin/race/finish', { method: 'POST' })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    alert('✅ Гонка завершена!');
                    loadRace();
                }
            });
    }
}

function loadPlayers() {
    fetch('/api/players')
        .then(r => r.json())
        .then(data => {
            const list = document.getElementById('players-list');
            if (!data.players || data.players.length === 0) {
                list.innerHTML = `<div style="color:#8899aa; font-style:italic; padding:10px;">Нет активных игроков</div>`;
                return;
            }
            list.innerHTML = data.players.map(p => `
                <div class="player-item">
                    <span>🚢 ${p.name}</span>
                    <span class="status ${p.isOnline ? 'online' : 'offline'}">
                        ${p.isOnline ? '🟢 Онлайн' : '🔴 Офлайн'}
                        ${p.isEliminated ? ' 💀 Выбыл' : ''}
                    </span>
                </div>
            `).join('');
        })
        .catch(() => {
            document.getElementById('players-list').innerHTML = 
                `<div style="color:#ff6b6b; padding:10px;">❌ Ошибка загрузки</div>`;
        });
}

function addRace() {
    // В будущем можно добавить форму для создания расписания
    alert('Функция добавления гонки в разработке');
}
