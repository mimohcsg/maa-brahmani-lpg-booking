const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const BUNDLED_DATA_DIR = path.join(PROJECT_ROOT, 'data');

function canUseDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-probe');
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function resolveStoragePaths() {
  const configuredDataDir = process.env.DATA_DIR?.trim();
  const configuredDb = process.env.DATABASE_PATH?.trim();

  if (configuredDataDir) {
    const resolved = path.resolve(configuredDataDir);
    if (canUseDir(resolved)) {
      return {
        dataDir: resolved,
        dbPath: configuredDb ? path.resolve(configuredDb) : path.join(resolved, 'booking.db'),
        persistent: resolved !== path.resolve(BUNDLED_DATA_DIR),
      };
    }
    console.warn('');
    console.warn(`⚠️  DATA_DIR (${configuredDataDir}) is not writable — is the Render disk attached?`);
    console.warn('   Falling back to ./data for now. Orders will reset on redeploy until disk is ready.');
    console.warn('');
  }

  const dataDir = BUNDLED_DATA_DIR;
  canUseDir(dataDir);
  return {
    dataDir,
    dbPath: path.join(dataDir, 'booking.db'),
    persistent: false,
  };
}

const storage = resolveStoragePaths();
const DATA_DIR = storage.dataDir;
const DB_PATH = storage.dbPath;
const IS_PERSISTENT = storage.persistent;

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
  if (!process.env.RENDER || IS_PERSISTENT) return;

  console.warn('');
  console.warn('⚠️  Using temporary storage — orders will be LOST on every deploy.');
  console.warn('   To keep data: upgrade to Starter, add a 1GB disk at /var/data, set DATA_DIR=/var/data');
  console.warn('');
}

module.exports = {
  DATA_DIR,
  DB_PATH,
  IS_PERSISTENT,
  BUNDLED_DATA_DIR,
  ensureDataDir,
  migrateLegacyDataIfNeeded,
  warnIfEphemeralOnRender,
  getDbPath: () => DB_PATH,
  getInvoicesDir,
  getPricingFile,
  getCouponsFile,
};
