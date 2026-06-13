const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const BUNDLED_DATA_DIR = path.join(PROJECT_ROOT, 'data');

function resolveDataDir() {
  const configured = process.env.DATA_DIR?.trim();
  if (configured) return path.resolve(configured);

  // Render: use mounted persistent disk (see render.yaml)
  if (process.env.RENDER) return '/var/data';

  return BUNDLED_DATA_DIR;
}

const DATA_DIR = resolveDataDir();

function getDbPath() {
  const configured = process.env.DATABASE_PATH?.trim();
  if (configured) return path.resolve(configured);
  return path.join(DATA_DIR, 'booking.db');
}

function getInvoicesDir() {
  return path.join(DATA_DIR, 'invoices');
}

function getPricingFile() {
  return path.join(DATA_DIR, 'pricing.json');
}

function getCouponsFile() {
  return path.join(DATA_DIR, 'coupons.json');
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(getInvoicesDir(), { recursive: true });
}

function copyIfMissing(src, dest) {
  if (!fs.existsSync(src) || fs.existsSync(dest)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function copyDirIfMissing(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return 0;
  fs.mkdirSync(destDir, { recursive: true });
  let copied = 0;
  for (const name of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, name);
    const dest = path.join(destDir, name);
    if (fs.statSync(src).isFile() && copyIfMissing(src, dest)) copied += 1;
  }
  return copied;
}

function migrateLegacyDataIfNeeded() {
  if (path.resolve(DATA_DIR) === path.resolve(BUNDLED_DATA_DIR)) return;

  ensureDataDir();
  const marker = path.join(DATA_DIR, '.storage-ready');
  if (fs.existsSync(marker)) return;

  let migrated = 0;
  for (const name of ['booking.db', 'booking.db-wal', 'booking.db-shm', 'pricing.json', 'coupons.json']) {
    if (copyIfMissing(path.join(BUNDLED_DATA_DIR, name), path.join(DATA_DIR, name))) {
      migrated += 1;
      console.log(`   Storage: copied ${name} to persistent data folder`);
    }
  }

  migrated += copyDirIfMissing(path.join(BUNDLED_DATA_DIR, 'invoices'), getInvoicesDir());
  if (migrated > 0) console.log(`   Storage: migrated ${migrated} file(s) to ${DATA_DIR}`);

  fs.writeFileSync(marker, new Date().toISOString(), 'utf8');
}

function warnIfEphemeralOnRender() {
  if (!process.env.RENDER) return;

  const deployPath = path.join(PROJECT_ROOT, 'data');
  const resolvedData = path.resolve(DATA_DIR);
  const insideDeployTree = resolvedData.startsWith(path.resolve(PROJECT_ROOT));

  if (insideDeployTree) {
    console.warn('');
    console.warn('⚠️  DATA_DIR is inside the app folder — orders will be LOST on every deploy.');
    console.warn('   Set DATA_DIR=/var/data and attach a Render persistent disk (Starter plan).');
    console.warn('');
    return;
  }

  try {
    const probe = path.join(DATA_DIR, '.write-probe');
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
  } catch (err) {
    console.warn('');
    console.warn(`⚠️  Cannot write to DATA_DIR (${DATA_DIR}): ${err.message}`);
    console.warn('   Attach a persistent disk mounted at /var/data in the Render dashboard.');
    console.warn('');
  }
}

module.exports = {
  DATA_DIR,
  BUNDLED_DATA_DIR,
  ensureDataDir,
  migrateLegacyDataIfNeeded,
  warnIfEphemeralOnRender,
  getDbPath,
  getInvoicesDir,
  getPricingFile,
  getCouponsFile,
};
