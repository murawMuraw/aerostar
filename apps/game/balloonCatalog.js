/**
 * КАТАЛОГ ДОСТУПНЫХ МОДЕЛЕЙ АЭРОСТАТОВ
 */
const BALLOON_STYLES = {
    'classic_blue': { id: 'classic_blue', name: 'Синий Классик', filter: 'none' },
    'fire_red':     { id: 'fire_red', name: 'Огненный Рубин', filter: 'hue-rotate(145deg) saturate(2.5) brightness(0.9)' },
    'emerald_go':  { id: 'emerald_go', name: 'Изумрудный Ветрочет', filter: 'hue-rotate(65deg) saturate(2) brightness(0.9)' },
    'gold_sunset':  { id: 'gold_sunset', name: 'Золотой Закат', filter: 'hue-rotate(200deg) saturate(3) brightness(1.1)' },
    'purple_strato':{ id: 'purple_strato', name: 'Пурпурный Стратос', filter: 'hue-rotate(270deg) saturate(2)' },
    'neon_toxic':   { id: 'neon_toxic', name: 'Неоновый Шторм', filter: 'hue-rotate(100deg) saturate(3) brightness(1.2)' }
};

module.exports = BALLOON_STYLES;
