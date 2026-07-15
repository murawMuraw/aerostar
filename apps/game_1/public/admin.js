// admin.js

let map = null;
let startMarker = null;
let finishMarker = null;

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
        document.getElementById(id).onchange = updateMarkers;
    });

    // Загрузка игроков
    loadPlayers();
});

function loadRace() {
    fetch('/api/admin/race')
        .then(r => r.json())
        .then(data => {
            if (data) {
                document.getElementById('start-name').value = data.startName || '';
                document.getElementById('start-lat').value = data.startLat || 0;
                document.getElementById('start-lng').value = data.startLng || 0;
                document.getElementById('finish-name').value = data.finishName || '';
                document.getElementById('finish-lat').value = data.finishLat || 0;
                document.getElementById('finish-lng').value = data.finishLng || 0;
                updateMarkers();
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

    if (startLat && startLng) {
        startMarker = L.marker([startLat, startLng], {
            icon: L.divIcon({ className: 'start-marker', html: '🏁 СТАРТ', iconSize: [80, 30] })
        }).addTo(map);
        map.setView([startLat, startLng], 4);
    }

    if (finishLat && finishLng) {
        finishMarker = L.marker([finishLat, finishLng], {
            icon: L.divIcon({ className: 'finish-marker', html: '🎯 ФИНИШ', iconSize: [80, 30] })
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
            alert('✅ Гонка сохранена!');
        }
    });
}

function startRace() {
    if (confirm('🚀 Запустить гонку?')) {
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
            list.innerHTML = data.players.map(p => `
                <div style="padding:8px;background:rgba(255,255,255,0.05);margin:4px 0;border-radius:6px;">
                    🚢 ${p.name} — ${p.isOnline ? '🟢 Онлайн' : '🔴 Офлайн'}
                    ${p.isEliminated ? '💀 Выбыл' : ''}
                </div>
            `).join('');
        });
}
