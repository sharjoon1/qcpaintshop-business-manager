const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const LOGO_PATH = path.join(__dirname, 'public/uploads/logos/logo-1770737238581-627910713.png');
const ANDROID_RES = path.join(__dirname, '../qcpaintshop-android/app/src/main/res');
const PWA_ICONS = path.join(__dirname, 'public/icons');

// Android mipmap sizes for launcher icons
const ANDROID_SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

// Android adaptive icon foreground sizes (108dp * density)
const ANDROID_FOREGROUND_SIZES = {
  'mipmap-mdpi': 108,
  'mipmap-hdpi': 162,
  'mipmap-xhdpi': 216,
  'mipmap-xxhdpi': 324,
  'mipmap-xxxhdpi': 432,
};

// PWA icon sizes
const PWA_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

async function createGradientBackground(size) {
  // Create gradient background using SVG
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#667eea"/>
        <stop offset="100%" style="stop-color:#764ba2"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#grad)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function createRoundMask(size) {
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function createSquareIcon(size) {
  // Create gradient background
  const bgBuffer = await createGradientBackground(size);

  // Load and resize logo to fit with padding
  const padding = Math.round(size * 0.08);
  const logoMaxWidth = size - (padding * 2);
  const logoMaxHeight = Math.round(size * 0.55); // Logo is wide, limit height

  const logoBuffer = await sharp(LOGO_PATH)
    .resize(logoMaxWidth, logoMaxHeight, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const logoMeta = await sharp(logoBuffer).metadata();

  // Center the logo on the gradient background
  const left = Math.round((size - logoMeta.width) / 2);
  const top = Math.round((size - logoMeta.height) / 2);

  return sharp(bgBuffer)
    .composite([{ input: logoBuffer, left, top }])
    .png()
    .toBuffer();
}

async function createRoundIcon(size) {
  const squareBuffer = await createSquareIcon(size);
  const maskBuffer = await createRoundMask(size);

  return sharp(squareBuffer)
    .composite([{ input: maskBuffer, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function createForegroundIcon(size) {
  // Adaptive icon foreground: logo centered in the inner safe zone
  // Safe zone is the inner 66/108 = ~61% of the canvas (circle)
  // So we put the logo within about 60% of the canvas size

  // Transparent canvas
  const canvas = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).png().toBuffer();

  // Logo sized to fit in the safe zone (about 55% of total size for good margins)
  const logoMaxWidth = Math.round(size * 0.55);
  const logoMaxHeight = Math.round(size * 0.35);

  const logoBuffer = await sharp(LOGO_PATH)
    .resize(logoMaxWidth, logoMaxHeight, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const logoMeta = await sharp(logoBuffer).metadata();
  const left = Math.round((size - logoMeta.width) / 2);
  const top = Math.round((size - logoMeta.height) / 2);

  return sharp(canvas)
    .composite([{ input: logoBuffer, left, top }])
    .png()
    .toBuffer();
}

async function main() {
  console.log('Generating icons from QC Paint Shop logo...\n');

  // === Android launcher icons (square) ===
  console.log('--- Android Launcher Icons ---');
  for (const [folder, size] of Object.entries(ANDROID_SIZES)) {
    const outDir = path.join(ANDROID_RES, folder);

    // Square icon
    const squareBuffer = await createSquareIcon(size);
    const squarePath = path.join(outDir, 'ic_launcher.png');
    await sharp(squareBuffer).toFile(squarePath);
    console.log(`  ${folder}/ic_launcher.png (${size}x${size})`);

    // Round icon
    const roundBuffer = await createRoundIcon(size);
    const roundPath = path.join(outDir, 'ic_launcher_round.png');
    await sharp(roundBuffer).toFile(roundPath);
    console.log(`  ${folder}/ic_launcher_round.png (${size}x${size})`);
  }

  // === Android adaptive icon foregrounds ===
  console.log('\n--- Android Adaptive Foregrounds ---');
  for (const [folder, size] of Object.entries(ANDROID_FOREGROUND_SIZES)) {
    const outDir = path.join(ANDROID_RES, folder);
    const fgBuffer = await createForegroundIcon(size);
    const fgPath = path.join(outDir, 'ic_launcher_foreground.png');
    await sharp(fgBuffer).toFile(fgPath);
    console.log(`  ${folder}/ic_launcher_foreground.png (${size}x${size})`);
  }

  // === PWA icons ===
  console.log('\n--- PWA Icons ---');
  for (const size of PWA_SIZES) {
    const buffer = await createSquareIcon(size);
    const outPath = path.join(PWA_ICONS, `icon-${size}x${size}.png`);
    await sharp(buffer).toFile(outPath);
    console.log(`  icon-${size}x${size}.png`);
  }

  console.log('\nAll icons generated successfully!');
}

main().catch(console.error);
