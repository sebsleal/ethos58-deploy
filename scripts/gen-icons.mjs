import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Icon SVG (option B — signal blip) ───────────────────────────────────────
// viewBox 200×200, dark warm charcoal bg, off-white E with S-curve middle bar
const iconSvg = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="200" rx="44" fill="#1a1714"/>
  <g fill="none" stroke="#f3eee8" stroke-width="9" stroke-linecap="square" stroke-linejoin="miter">
    <line x1="64" y1="52" x2="140" y2="52"/>
    <line x1="64" y1="148" x2="140" y2="148"/>
    <line x1="64" y1="52" x2="64" y2="148"/>
  </g>
  <path d="M64 100 L80 100 C86 100 88 84 100 84 C112 84 114 116 120 116 C126 116 128 100 134 100 L140 100"
        fill="none" stroke="#f3eee8" stroke-width="9" stroke-linecap="butt" stroke-linejoin="round"/>
</svg>`;

async function generatePng(svgString, outputPath, size) {
  await sharp(Buffer.from(svgString))
    .resize(size, size)
    .png()
    .toFile(outputPath);
  console.log(`✓  ${size}×${size}  →  ${outputPath.replace(ROOT, '.')}`);
}

// ─── Splash SVG — full dark background, centred E glyph (no rounded rect) ───
// Canvas 2732×2732. Mark is scaled to ~320px, centred.
const SPLASH_CANVAS = 2732;
const MARK_SCALE = 2.2;        // smaller, minimal splash — subtle centred mark
const MARK_CX = 102 * MARK_SCALE;  // centre-x of mark in scaled space
const MARK_CY = 100 * MARK_SCALE;  // centre-y of mark in scaled space
const TX = SPLASH_CANVAS / 2 - MARK_CX;
const TY = SPLASH_CANVAS / 2 - MARK_CY;

const splashSvg = `<svg width="${SPLASH_CANVAS}" height="${SPLASH_CANVAS}" viewBox="0 0 ${SPLASH_CANVAS} ${SPLASH_CANVAS}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${SPLASH_CANVAS}" height="${SPLASH_CANVAS}" fill="#1a1714"/>
  <g transform="translate(${TX}, ${TY}) scale(${MARK_SCALE})">
    <g fill="none" stroke="#f3eee8" stroke-width="9" stroke-linecap="square" stroke-linejoin="miter">
      <line x1="64" y1="52" x2="140" y2="52"/>
      <line x1="64" y1="148" x2="140" y2="148"/>
      <line x1="64" y1="52" x2="64" y2="148"/>
    </g>
    <path d="M64 100 L80 100 C86 100 88 84 100 84 C112 84 114 116 120 116 C126 116 128 100 134 100 L140 100"
          fill="none" stroke="#f3eee8" stroke-width="9" stroke-linecap="butt" stroke-linejoin="round"/>
  </g>
</svg>`;

async function main() {
  // ── iOS app icon (Xcode single 1024×1024) ──────────────────────────────────
  const iosDir = join(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
  mkdirSync(iosDir, { recursive: true });
  await generatePng(iconSvg(1024), join(iosDir, 'AppIcon-512@2x.png'), 1024);

  // ── iOS splash (all three slots use same 2732×2732 image) ─────────────────
  const splashDir = join(ROOT, 'ios/App/App/Assets.xcassets/Splash.imageset');
  mkdirSync(splashDir, { recursive: true });
  const splashBuf = Buffer.from(splashSvg);
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    await sharp(splashBuf).resize(SPLASH_CANVAS, SPLASH_CANVAS).png().toFile(join(splashDir, name));
    console.log(`✓  splash  →  ${name}`);
  }

  // ── Web PWA icons ──────────────────────────────────────────────────────────
  const publicDir = join(ROOT, 'public');
  await generatePng(iconSvg(512), join(publicDir, 'icon-512.png'), 512);
  await generatePng(iconSvg(192), join(publicDir, 'icon-192.png'), 192);

  // ── favicon ────────────────────────────────────────────────────────────────
  await generatePng(iconSvg(32), join(publicDir, 'favicon.png'), 32);
  writeFileSync(join(publicDir, 'favicon.svg'), iconSvg(32));
  console.log(`✓  favicon.svg  →  ./public/favicon.svg`);

  console.log('\nAll icons generated.');
}

main().catch(console.error);
