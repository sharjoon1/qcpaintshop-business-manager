/**
 * One-time script: Generate painter OG image for WhatsApp/social previews
 * Run: node scripts/generate-painter-og.js
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const G = '#1B5E3B';
const GOLD = '#D4A24E';

const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${G}"/>
      <stop offset="100%" style="stop-color:#2D7A4F"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect y="580" width="1200" height="50" fill="${GOLD}"/>
  <text x="600" y="200" font-family="Arial,sans-serif" font-size="72" font-weight="bold" fill="white" text-anchor="middle">QUALITY COLOURS</text>
  <rect x="350" y="230" width="500" height="4" rx="2" fill="${GOLD}"/>
  <text x="600" y="310" font-family="Arial,sans-serif" font-size="48" fill="white" text-anchor="middle" opacity="0.95">Painters Program</text>
  <text x="600" y="400" font-family="Arial,sans-serif" font-size="32" fill="white" text-anchor="middle" opacity="0.8">Earn loyalty points on every paint purchase</text>
  <text x="600" y="450" font-family="Arial,sans-serif" font-size="28" fill="${GOLD}" text-anchor="middle" font-weight="600">Register now and start earning!</text>
  <text x="600" y="540" font-family="Arial,sans-serif" font-size="22" fill="white" text-anchor="middle" opacity="0.7">act.qcpaintshop.com</text>
</svg>`;

const dir = path.join(__dirname, '..', 'public', 'images');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

sharp(Buffer.from(svg))
    .png({ quality: 90 })
    .toFile(path.join(dir, 'painter-og.png'))
    .then(() => console.log('Created: public/images/painter-og.png'))
    .catch(e => console.error('Failed:', e));
