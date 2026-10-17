'use strict';

/**
 * backup.js — backup database MongoDB (mongodump) & kirim ke owner
 * secara berkala sebagai arsip .gz.
 *
 * PENTING: butuh binary `mongodump` terinstall di server/VPS (satu paket
 * dengan "MongoDB Database Tools", TERPISAH dari MongoDB server itu sendiri):
 *   https://www.mongodb.com/try/download/database-tools
 */

const { spawn } = require('child_process');
const fs        = require('fs');
const os        = require('os');
const path      = require('path');
const CONFIG    = require('../../config');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Jalankan mongodump dalam mode --archive --gzip (satu file output),
 * kembalikan path file.
 */
function dumpDatabase() {
  return new Promise((resolve, reject) => {
    const outPath = path.join(os.tmpdir(), `kyz-backup-${timestamp()}.archive.gz`);
    const args = [
      `--uri=${require('../db/database').getActiveUri() || CONFIG.MONGO_URI}`,
      `--db=${CONFIG.MONGO_DB_NAME}`,
      `--archive=${outPath}`,
      '--gzip',
    ];

    const proc = spawn(CONFIG.DB_TOOLS.MONGODUMP_BIN, args);

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => reject(err)); // mongodump tidak ditemukan dll

    proc.on('close', code => {
      if (code === 0) resolve(outPath);
      else reject(new Error(stderr || `mongodump keluar dengan kode ${code}`));
    });
  });
}

async function runBackup(telegram) {
  let filePath;
  try {
    filePath = await dumpDatabase();
    const stats = fs.statSync(filePath);

    if (stats.size === 0) {
      throw new Error('File backup kosong (0 bytes) — kemungkinan mongodump gagal diam-diam.');
    }

    await telegram.sendDocument(
      CONFIG.OWNER_ID,
      { source: filePath, filename: path.basename(filePath) },
      {
        caption:
          `💾 <b>Backup Database Otomatis (MongoDB)</b>\n\n` +
          `📅 Waktu  : <code>${new Date().toLocaleString('id-ID')}</code>\n` +
          `📦 Ukuran : <code>${(stats.size / 1024).toFixed(1)} KB</code>\n\n` +
          `Restore: <code>mongorestore --uri="..." --archive=file --gzip</code>`,
        parse_mode: 'HTML',
      }
    );
    console.log('[BACKUP] Berhasil dikirim ke owner.');
  } catch (err) {
    console.error('[BACKUP ERROR]', err.message);
    try {
      await telegram.sendMessage(
        CONFIG.OWNER_ID,
        `❌ <b>Backup Database GAGAL</b>\n\n` +
        `Error: <code>${err.message}</code>\n\n` +
        `Pastikan <code>mongodump</code> terinstall di server (paket "MongoDB Database Tools", terpisah dari MongoDB server).`,
        { parse_mode: 'HTML' }
      );
    } catch {}
  } finally {
    if (filePath) fs.unlink(filePath, () => {});
  }
}

function startBackupScheduler(telegram) {
  const intervalMs = CONFIG.BACKUP_INTERVAL_MS || 12 * 60 * 60 * 1000;
  console.log(`[BACKUP] Terjadwal tiap ${Math.round(intervalMs / 3600000)} jam.`);
  setInterval(() => runBackup(telegram), intervalMs);
}

module.exports = { startBackupScheduler, runBackup };
