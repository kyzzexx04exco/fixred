/**
 * ============================================================
 * KYZ FIX MERAH — Entry Point
 * ============================================================
 * Install : npm install
 * Run     : node bot.js
 * Dev     : npx nodemon bot.js
 *
 * Env vars (atau edit config.js):
 *   MONGO_URI, MONGO_DB_NAME
 *
 * Syarat tambahan:
 *   - binary `mongodump` terinstall di server untuk fitur backup otomatis
 *     (paket "MongoDB Database Tools", terpisah dari MongoDB server)
 *   - Rich message (sendRichMessage) perlu Bot API server yang sudah
 *     mendukung Bot API 10.1+ (fitur baru, rilis 2026)
 *   - Emoji premium (<tg-emoji>) perlu akun OWNER_ID (pemilik bot) punya
 *     Telegram Premium aktif, kalau tidak otomatis fallback ke emoji biasa
 * ============================================================
 */

'use strict';

const { Telegraf, session } = require('telegraf');
const CONFIG                = require('./config');
const { initDB }            = require('./src/db/database');

const { mainMiddleware }       = require('./src/handlers/middleware');
const { handleStart, handleBackMain } = require('./src/handlers/start');
const { handleFixMerah, handleConfirmFix } = require('./src/handlers/fixMerah');
const { handleStatistik, handleLeaderboard, handleRiwayat } = require('./src/handlers/stats');
const {
  handleUpgrade, handlePkgRole, handleBuyPackage,
  handleReferral, handleRedeem, handlePanduan,
} = require('./src/handlers/features');
const { handleText }           = require('./src/handlers/textHandler');
const {
  cmdSetRole, cmdEditTemplate, cmdListEmail,
  cmdAddEmail, cmdDelEmail, cmdToggleEmail, cmdTestEmail,
  cmdSetImap, cmdBackupNow, cmdCheckMember, handleEmojiIds,
} = require('./src/handlers/ownerCommands');

const { startInboxWatcher }    = require('./src/utils/inboxWatcher');
const { startBackupScheduler } = require('./src/utils/backup');

function checkPlaceholderConfig() {
  const warnings = [];
  if (CONFIG.BOT_TOKEN === 'ISI_BOT_TOKEN_DISINI') warnings.push('BOT_TOKEN belum diisi!');
  if (CONFIG.OWNER_ID === 123456789) warnings.push('OWNER_ID masih default (123456789) — ganti dengan Telegram ID kamu!');
  if (CONFIG.REQUIRED_CHANNEL === 'nama_channel') warnings.push('REQUIRED_CHANNEL masih placeholder — validasi join channel akan selalu GAGAL/error sampai diisi atau dikosongkan.');
  if (CONFIG.REQUIRED_GROUP === 'nama_group') warnings.push('REQUIRED_GROUP masih placeholder — validasi join group akan selalu GAGAL/error sampai diisi atau dikosongkan.');
  if (CONFIG.EMAIL_FROM === 'bot@gmail.com') warnings.push('EMAIL_FROM masih placeholder — tambahkan email sender asli via /add_email.');

  if (warnings.length) {
    console.warn('\n⚠️  PERINGATAN KONFIGURASI (config.js):');
    warnings.forEach(w => console.warn('   - ' + w));
    console.warn('');
  }
}

async function main() {
  checkPlaceholderConfig();

  // Init MongoDB & index
  await initDB();

  const bot = new Telegraf(CONFIG.BOT_TOKEN);

  bot.use(session());
  bot.use(mainMiddleware);

  // ── Commands ───────────────────────────────────────────────
  bot.start(handleStart);
  bot.command('set_role',      cmdSetRole);
  bot.command('edit_template', cmdEditTemplate);
  bot.command('list_email',    cmdListEmail);
  bot.command('add_email',     cmdAddEmail);
  bot.command('del_email',     cmdDelEmail);
  bot.command('toggle_email',  cmdToggleEmail);
  bot.command('test_email',    cmdTestEmail);
  bot.command('set_imap',      cmdSetImap);
  bot.command('backup_now',    cmdBackupNow);
  bot.command('check_member',  cmdCheckMember);

  // ── Callback Queries ───────────────────────────────────────
  bot.action('back_main',    handleBackMain);
  bot.action('fix_merah',    handleFixMerah);
  bot.action('confirm_fix',  handleConfirmFix);
  bot.action('statistik',    handleStatistik);
  bot.action('leaderboard',  handleLeaderboard);
  bot.action('riwayat',      handleRiwayat);
  bot.action('upgrade',      handleUpgrade);
  bot.action('referral',     handleReferral);
  bot.action('panduan',      handlePanduan);

  bot.action('pkg_RAKYAT',   ctx => handlePkgRole(ctx, 'RAKYAT'));
  bot.action('pkg_PEJABAT',  ctx => handlePkgRole(ctx, 'PEJABAT'));
  bot.action('pkg_PRESIDEN', ctx => handlePkgRole(ctx, 'PRESIDEN'));

  bot.action(/^buy_(\w+)_(\d+)$/, ctx => {
    const [, role, dur] = ctx.match;
    return handleBuyPackage(ctx, role, dur);
  });

  bot.action(/^redeem_(\d+)_(\d+)$/, ctx => {
    const [, coins, dur] = ctx.match;
    return handleRedeem(ctx, coins, dur);
  });

  // ── Text (handlePhoneInput dipanggil lewat textHandler.js) ──
  bot.on('message', handleEmojiIds);   // owner kirim emoji premium → dapat ID-nya
  bot.on('text', handleText);

  // ── Global error handler (supaya bot tidak crash diam-diam) ─
  bot.catch((err, ctx) => {
    console.error(`[BOT ERROR] update ${ctx.updateType}:`, err);
  });

  // ── Launch ─────────────────────────────────────────────────
  await bot.launch();
  console.log('✅ Bot KYZ Fix Merah aktif!');

  // ── Background jobs ──────────────────────────────────────────
  startInboxWatcher(bot.telegram);   // cek balasan WA tiap beberapa menit
  startBackupScheduler(bot.telegram); // backup DB tiap 12 jam ke owner

  process.once('SIGINT',  () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch(err => {
  console.error('❌ Gagal start bot:', err);
  process.exit(1);
});
