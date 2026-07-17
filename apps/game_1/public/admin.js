// admin.js

let map = null;
let startMarker = null;
let finishMarker = null;
let currentRaceData = null;
let startLatLng = null;
let finishLatLng = null;

document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // 1. КАРТА
    // ==========================================
    map = L.map('start-map').setView([40, -30], 3);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri'
    }).addTo(map);

    // ==========================================
    // 2. КЛИКИ ПО КАРТЕ
    // ==========================================
    map.on('click', (e) => {
        const { lat, lng } = e.latlng;

        // Shift + клик = финиш
        if (e.originalEvent.shiftKey) {
            setFinishMarker(lat, lng);
        } else {
            // Обычный клик = старт
            setStartMarker(lat, lng);
        }
    });

    // ==========================================
    // 3. FLATPICKR (календарь)
    // ==========================================
    flatpickr("#race-date", {
        dateFormat: "d.m.Y",
        minDate: "today",
        disableMobile: true,
        onChange: updateRaceDisplay
    });

    flatpickr("#race-time", {
        enableTime: true,
        noCalendar: true,
        dateFormat: "H:i",
        time_24hr: true,
        minuteIncrement: 5,
        onChange: updateRaceDisplay
    });

    // ==========================================
    // 4. ЗАГРУЗКА ДАННЫХ
    // ==========================================
    loadRace();
    loadPlayers();
    setInterval(loadPlayers, 10000);

    // ==========================================
    // 5. ОБРАБОТЧИКИ КНОПОК
    // ==========================================
    document.querySelectorAll('.admin-tabs button').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.admin-tabs button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');

            // Обновляем карту при переключении
            if (btn.dataset.tab === 'race' && map) {
                setTimeout(() => map.invalidateSize(), 100);
            }
        };
    });

    document.getElementById('btn-save-race').onclick = saveRace;
    document.getElementById('btn-start-race').onclick = startRace;
    document.getElementById('btn-finish-race').onclick = finishRace;
    document.getElementById('btn-add-race').onclick = addRace;
    document.getElementById('btn-send-chat').onclick = sendChatMessage;

    // ==========================================
    // 6. КЛИК ПО МАРКЕРУ ДЛЯ УДАЛЕНИЯ
    // ==========================================
    function setupMarkerClick(marker, type) {
        marker.on('click', () => {
            if (confirm(`Удалить точку ${type}?`)) {
                if (type === 'старта') {
                    map.removeLayer(startMarker);
                    startMarker = null;
                    startLatLng = null;
                    document.getElementById('start-coords').value = '—';
                    document.getElementById('start-name').value = '';
                } else {
                    map.removeLayer(finishMarker);
                    finishMarker = null;
                    finishLatLng = null;
                    document.getElementById('finish-coords').value = '—';
                    document.getElementById('finish-name').value = '';
                }
                updateMarkerInfo();
            }
        });
    }

    // Сохраняем функции в глобальную область для использования в setStartMarker/setFinishMarker
    window.setupMarkerClick = setupMarkerClick;
});

// ==========================================
//  ФУНКЦИИ ДЛЯ РАБОТЫ С МАРКЕРАМИ
// ==========================================

function setStartMarker(lat, lng) {
    // Удаляем старый маркер
    if (startMarker) map.removeLayer(startMarker);

    startLatLng = { lat, lng };

    const icon = L.divIcon({
        className: 'start-marker',
        html: '🏁 СТАРТ',
        iconSize: [60, 24],
        iconAnchor: [30, 12]
    });

    startMarker = L.marker([lat, lng], { icon, draggable: true })
        .addTo(map)
        .bindPopup(`🏁 Старт<br>${lat.toFixed(4)}, ${lng.toFixed(4)}`);

    // Перетаскивание маркера
    startMarker.on('dragend', () => {
        const pos = startMarker.getLatLng();
        startLatLng = { lat: pos.lat, lng: pos.lng };
        document.getElementById('start-coords').value = `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`;
        updateMarkerInfo();
    });

    // Клик для удаления
    startMarker.on('click', () => {
        if (confirm('Удалить точку старта?')) {
            map.removeLayer(startMarker);
            startMarker = null;
            startLatLng = null;
            document.getElementById('start-coords').value = '—';
            document.getElementById('start-name').value = '';
            updateMarkerInfo();
        }
    });

    document.getElementById('start-coords').value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    updateMarkerInfo();
    map.setView([lat, lng], 6);
}

function setFinishMarker(lat, lng) {
    if (finishMarker) map.removeLayer(finishMarker);

    finishLatLng = { lat, lng };

    const icon = L.divIcon({
        className: 'finish-marker',
        html: '🎯 ФИНИШ',
        iconSize: [60, 24],
        iconAnchor: [30, 12]
    });

    finishMarker = L.marker([lat, lng], { icon, draggable: true })
        .addTo(map)
        .bindPopup(`🎯 Финиш<br>${lat.toFixed(4)}, ${lng.toFixed(4)}`);

    finishMarker.on('dragend', () => {
        const pos = finishMarker.getLatLng();
        finishLatLng = { lat: pos.lat, lng: pos.lng };
        document.getElementById('finish-coords').value = `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`;
        updateMarkerInfo();
    });

    finishMarker.on('click', () => {
        if (confirm('Удалить точку финиша?')) {
            map.removeLayer(finishMarker);
            finishMarker = null;
            finishLatLng = null;
            document.getElementById('finish-coords').value = '—';
            document.getElementById('finish-name').value = '';
            updateMarkerInfo();
        }
    });

    document.getElementById('finish-coords').value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    updateMarkerInfo();
    map.setView([lat, lng], 6);
}

function updateMarkerInfo() {
    const info = document.getElementById('marker-info');
    let html = '';

    if (startLatLng) {
        html += `🏁 <b>Старт</b>: ${startLatLng.lat.toFixed(4)}, ${startLatLng.lng.toFixed(4)}<br>`;
    }

    if (finishLatLng) {
        html += `🎯 <b>Финиш</b>: ${finishLatLng.lat.toFixed(4)}, ${finishLatLng.lng.toFixed(4)}<br>`;
    }

    if (!startLatLng && !finishLatLng) {
        html = '<span style="color:#8899aa;">Кликните по карте для установки точек</span>';
    }

    info.innerHTML = html;
}

// ==========================================
//  ЗАГРУЗКА ТЕКУЩЕЙ ГОНКИ
// ==========================================

function loadRace() {
    fetch('/api/admin/race')
        .then(r => r.json())
        .then(data => {
            currentRaceData = data;
            if (data) {
                // Восстанавливаем маркеры из данных
                if (data.startLat && data.startLng) {
                    setStartMarker(data.startLat, data.startLng);
                    document.getElementById('start-name').value = data.startName || '';
                }
                if (data.finishLat && data.finishLng) {
                    setFinishMarker(data.finishLat, data.finishLng);
                    document.getElementById('finish-name').value = data.finishName || '';
                }

                // Восстанавливаем дату/время
                if (data.startTime) {
                    const date = new Date(data.startTime);
                    document.getElementById('race-date').value = 
                        `${String(date.getDate()).padStart(2,'0')}.${String(date.getMonth()+1).padStart(2,'0')}.${date.getFullYear()}`;
                    document.getElementById('race-time').value = 
                        `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
                }

                // Обновляем отображение
                document.getElementById('display-start').textContent = 
                    `${data.startName || '—'} (${data.startLat?.toFixed(2) || '—'}°, ${data.startLng?.toFixed(2) || '—'}°)`;
                document.getElementById('display-finish').textContent = 
                    `${data.finishName || '—'} (${data.finishLat?.toFixed(2) || '—'}°, ${data.finishLng?.toFixed(2) || '—'}°)`;
                document.getElementById('display-time').textContent = 
                    data.startTime ? new Date(data.startTime).toLocaleString() : '—';

                updateRaceStatus(data.status);
            }
        });
}

function updateRaceStatus(status) {
    const statusMap = {
        'scheduled': { text: '⏳ Запланирована', class: 'scheduled' },
        'active': { text: '🚀 Активна', class: 'active' },
        'finished': { text: '🏁 Завершена', class: 'finished' }
    };
    const s = statusMap[status] || statusMap.scheduled;
    const container = document.querySelector('.current-race');
    if (container) {
        container.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <span style="font-weight:600;">
                    ${status === 'active' ? '🚀 Гонка идёт!' : 
                      status === 'finished' ? '🏁 Гонка завершена' : 
                      '⏳ Гонка запланирована'}
                </span>
                <span class="race-status ${s.class}">${s.text}</span>
            </div>
        `;
    }
}

function updateRaceDisplay() {
    const date = document.getElementById('race-date').value;
    const time = document.getElementById('race-time').value;
    if (date && time) {
        const [d, m, y] = date.split('.');
        const [h, min] = time.split(':');
        const dt = new Date(y, m-1, d, h, min);
        document.getElementById('display-time').textContent = dt.toLocaleString();
    }
}

// ==========================================
//  СОХРАНЕНИЕ ГОНКИ
// ==========================================

function saveRace() {
    const date = document.getElementById('race-date').value;
    const time = document.getElementById('race-time').value;
    let startTime = null;

    if (date && time) {
        const [d, m, y] = date.split('.');
        const [h, min] = time.split(':');
        startTime = new Date(y, m-1, d, h, min).toISOString();
    }

    const raceData = {
        startName: document.getElementById('start-name').value,
        startLat: startLatLng?.lat || null,
        startLng: startLatLng?.lng || null,
        finishName: document.getElementById('finish-name').value,
        finishLat: finishLatLng?.lat || null,
        finishLng: finishLatLng?.lng || null,
        startTime: startTime
    };

    if (!raceData.startLat || !raceData.finishLat) {
        alert('❌ Установите точки старта и финиша на карте!');
        return;
    }

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

// ==========================================
//  СТАРТ / ФИНИШ ГОНКИ
// ==========================================

function startRace() {
    if (!startLatLng || !finishLatLng) {
        alert('❌ Сначала установите точки старта и финиша!');
        return;
    }

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

// ==========================================
//  ИГРОКИ
// ==========================================

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
        });
}

// ==========================================
//  ЧАТ
// ==========================================

function sendChatMessage() {
    const text = document.getElementById('chat-message-text').value.trim();
    if (!text) {
        alert('Введите текст сообщения');
        return;
    }

    fetch('/api/admin/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            alert('✅ Сообщение отправлено всем игрокам!');
            document.getElementById('chat-message-text').value = '';
        }
    });
}

// ==========================================
//  ДОБАВЛЕНИЕ ГОНКИ В РАСПИСАНИЕ
// ==========================================

function addRace() {
    alert('Функция добавления гонки в разработке');
}
