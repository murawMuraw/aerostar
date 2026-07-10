const express = require('express');
const path = require('path');
const app = express();
const PORT = 3002;

// Раздаём статические файлы из текущей папки
app.use(express.static(__dirname));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'regatta.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Regatta server running at http://0.0.0.0:${PORT}`);
});
