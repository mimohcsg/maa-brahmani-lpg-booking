const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', 'public', 'assets');
const LOGO_SVG = path.join(ASSETS_DIR, 'gogas-logo.svg');
const LOGO_PNG = path.join(ASSETS_DIR, 'gogas-logo.png');

async function ensureLogoPng() {
  if (fs.existsSync(LOGO_PNG)) return LOGO_PNG;

  if (!fs.existsSync(LOGO_SVG)) return null;

  try {
    const sharp = require('sharp');
    await sharp(LOGO_SVG).resize(640, 200).png().toFile(LOGO_PNG);
    return LOGO_PNG;
  } catch (e) {
    console.warn('Logo PNG fallback skipped:', e.message);
    return null;
  }
}

function getLogoPngPath() {
  return fs.existsSync(LOGO_PNG) ? LOGO_PNG : null;
}

function getLogoPublicUrl(baseUrl) {
  const base = (baseUrl || '').replace(/\/$/, '');
  return base ? `${base}/assets/gogas-logo.png` : '/assets/gogas-logo.png';
}

module.exports = {
  ensureLogoPng,
  getLogoPngPath,
  getLogoPublicUrl,
  LOGO_PNG,
};
