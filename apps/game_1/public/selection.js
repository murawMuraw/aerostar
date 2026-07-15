// selection.js

const ships = [
    { id: 1, name: 'Клипер "Бриз"', speed: 8, maneuver: 7, img: 'images/klip_10.png' },
    { id: 2, name: 'Клипер "Шторм"', speed: 10, maneuver: 5, img: 'images/klip_20.png' },
    { id: 3, name: 'Клипер "Волна"', speed: 6, maneuver: 9, img: 'images/klip_30.png' }
];

const startPoints = [
    { id: 'sp1', name: 'Порт Ливерпуль', lat: 53.4, lng: -3.0 },
    { id: 'sp2', name: 'Порт Саутгемптон', lat: 50.9, lng: -1.4 },
    { id: 'sp3', name: 'Порт Брест', lat: 48.4, lng: -4.5 },
    { id: 'sp4', name: 'Порт Нью-Йорк', lat: 40.7, lng: -74.0 }
];

let selectedShip = null;
let selectedStart = null;
let map = null;

document.addEventListener('DOMContentLoaded', () => {
    // Инициализация карты
    map = L.map('map-preview').setView([20, 0], 2);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri'
    }).addTo(map);

    // Рендерим корабли
    const grid = document.getElementById('ship-grid');
    ships.forEach(ship => {
        const card = document.createElement('div');
        card.className = 'ship-card';
        card.dataset.shipId = ship.id;
        card.innerHTML = `
            <img src="${ship.img}" alt="${ship.name}">
            <div class="ship-name">${ship.name}</div>
            <div class="ship-stats">⚡ ${ship.speed} уз | 🧭 ${ship.maneuver} маневр.</div>
        `;
        card.onclick = () => selectShip(ship.id);
        grid.appendChild(card);
    });

    // Рендерим точки старта
    const container = document.getElementById('start-points');
    startPoints.forEach(point => {
        const div = document.createElement('div');
        div.className = 'start-point';
        div.dataset.pointId = point.id;
        div.innerHTML = `
            <span>📍 ${point.name}</span>
            <span style="color:#8899aa;">${point.lat.toFixed(2)}°, ${point.lng.toFixed(2)}°</span>
        `;
        div.onclick = () => selectStart(point.id);
        container.appendChild(div);
    });

    // Кнопка старта
    document.getElementById('btn-start').onclick = startRace;
});

function selectShip(id) {
    selectedShip = ships.find(s => s.id === id);
    document.querySelectorAll('.ship-card').forEach(c => c.classList.remove('selected'));
    document.querySelector(`.ship-card[data-ship-id="${id}"]`).classList.add('selected');
    checkReady();
}

function selectStart(id) {
    selectedStart = startPoints.find(p => p.id === id);
    document.querySelectorAll('.start-point').forEach(p => p.classList.remove('selected'));
    document.querySelector(`.start-point[data-point-id="${id}"]`).classList.add('selected');
    
    // Обновляем карту
    map.setView([selectedStart.lat, selectedStart.lng], 6);
    L.marker([selectedStart.lat, selectedStart.lng]).addTo(map)
        .bindPopup(`🏁 ${selectedStart.name}`)
        .openPopup();
    
    checkReady();
}

function checkReady() {
    const btn = document.getElementById('btn-start');
    if (selectedShip && selectedStart) {
        btn.disabled = false;
    } else {
        btn.disabled = true;
    }
}

function startRace() {
    if (!selectedShip || !selectedStart) return;
    
    // Отправляем выбор на сервер
    fetch('/api/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            shipId: selectedShip.id,
            startPoint: selectedStart
        })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            window.location.href = '/';
        }
    });
}
