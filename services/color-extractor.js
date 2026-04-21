'use strict';

const COLOR_MAP = {
    'off white':   '#FAF9F6',
    'sky blue':    '#7DD3FC',
    'brick red':   '#B22222',
    'off-white':   '#FAF9F6',
    white:         '#FFFFFF',
    ivory:         '#F5F0E8',
    cream:         '#FDE8CC',
    beige:         '#E8D5B0',
    wheat:         '#D4C5A9',
    sand:          '#C8B89A',
    yellow:        '#FCD34D',
    orange:        '#FB923C',
    red:           '#EF4444',
    maroon:        '#7F1D1D',
    pink:          '#F9A8D4',
    peach:         '#FBBF9A',
    brown:         '#92400E',
    chocolate:     '#78350F',
    green:         '#22C55E',
    sage:          '#C8D8C8',
    teal:          '#0D9488',
    blue:          '#3B82F6',
    navy:          '#1E3A5F',
    grey:          '#9CA3AF',
    gray:          '#9CA3AF',
    silver:        '#D1D5DB',
    black:         '#111827',
    lilac:         '#D0C0D8',
    lavender:      '#E0D7F0',
    terracotta:    '#C1440E',
    rust:          '#B7410E',
};

// Multi-word keys sorted before single-word to prevent partial matches
const SORTED_KEYS = Object.keys(COLOR_MAP).sort((a, b) => b.split(' ').length - a.split(' ').length);

function extractColor(itemName) {
    if (!itemName) return null;
    for (const key of SORTED_KEYS) {
        const pattern = new RegExp(`(?:^|\\s)${key.replace(/-/g, '[\\s-]')}(?:\\s|$)`, 'i');
        if (pattern.test(itemName)) {
            const displayName = key.split(/[\s-]+/).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
            return { colorName: displayName, colorCode: COLOR_MAP[key] };
        }
    }
    return null;
}

module.exports = { extractColor, COLOR_MAP };
