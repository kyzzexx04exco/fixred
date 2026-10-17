'use strict';

const CONFIG = require('../../config');
const { ROLES, FREE_LABEL } = require('./constants');
const { richReply, kvTable } = require('./richMessage');

const P = CONFIG.PREMIUM_EMOJI_IDS;

/**
 * Satu sumber data emoji, dipecah jadi dua turunan:
 *   - E  → untuk TEKS PESAN (rich_message.html). Boleh pakai <tg-emoji>
 *          karena HTML di-parse di badan pesan.
 *   - EB → untuk LABEL BUTTON. WAJIB plain unicode — Telegram TIDAK
 *          PERNAH parse HTML/tag apapun di teks button, jadi kalau E
 *          (yang ada tag <tg-emoji>) dipakai di button, yang muncul
 *          ke user adalah teks mentah tag-nya (bug yang kemarin kejadian).
 *          Makanya SEMUA pemanggilan btn()/btnUrl() di seluruh project
 *          HARUS pakai EB, tidak boleh E.
 */
const EMOJI_DEFS = {
  // Ada ID premium asli (dari file yang di-extract user)
  user:    { id: P.user,     ch: '👤' },
  search:  { id: P.search,   ch: '🔍' },
  idcard:  { id: P.idcard,   ch: '🪪' },
  status:  { id: P.status,   ch: '📌' },
  clock:   { id: P.clock,    ch: '🕐' },
  chart:   { id: P.chart_up, ch: '📈' },
  chartG:  { id: P.chart_g,  ch: '📊' },
  receipt: { id: P.receipt,  ch: '🧾' },
  gem:     { id: P.gem1,     ch: '💎' },
  gem2:    { id: P.gem2,     ch: '💎' },
  gem3:    { id: P.gem3,     ch: '💎' },
  pin:     { id: P.pin,      ch: '📌' },
  link:    { id: P.link,     ch: '🔗' },
  gem4:    { id: P.gem4,     ch: '💎' },

  // Belum ada ID premium real — plain unicode biasa
  fire: { ch: '🔥' }, crown: { ch: '👑' }, medal: { ch: '🏅' }, ghost: { ch: '🫥' },
  star: { ch: '⭐' }, zap: { ch: '⚡' }, trophy: { ch: '🏆' }, gift: { ch: '🎁' },
  book: { ch: '📖' }, list: { ch: '📋' }, up: { ch: '⬆️' }, home: { ch: '🏠' }, check: { ch: '✅' },
  cross: { ch: '❌' }, warning: { ch: '⚠️' }, coin: { ch: '🪙' }, lock: { ch: '🔒' }, rocket: { ch: '🚀' },
  red: { ch: '🔴' }, mail: { ch: '📧' }, phone: { ch: '📱' }, back: { ch: '🔙' }, cart: { ch: '🛒' },
  card: { ch: '💳' }, people: { ch: '👥' }, date: { ch: '📅' }, pen: { ch: '✏️' },
  refresh: { ch: '🔄' }, inbox: { ch: '📨' }, bell: { ch: '🔔' },
};

const E  = {}; // teks pesan — boleh premium
const EB = {}; // label button — WAJIB plain

// Peta emoji-unicode → ID premium (hanya yang ID-nya TUNGGAL/tidak ambigu),
// dipakai btn() untuk otomatis menampilkan emoji premium di tombol.
const ICON_BY_CHAR = {};
const _count = {};

for (const [key, def] of Object.entries(EMOJI_DEFS)) {
  // ID bisa ditaruh di EMOJI_DEFS ATAU cukup ditambah di config.PREMIUM_EMOJI_IDS[key]
  const id = def.id || P[key];
  const ch = def.ch;
  E[key]  = id ? `<tg-emoji emoji-id="${id}">${ch}</tg-emoji>` : ch;
  EB[key] = ch;
  if (id) {
    _count[ch] = (_count[ch] || 0) + 1;
    ICON_BY_CHAR[ch] = id;
  }
}
for (const ch of Object.keys(_count)) if (_count[ch] > 1) delete ICON_BY_CHAR[ch];

// ── String helpers ────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizePhone(raw) {
  let digits = String(raw).replace(/[^\d]/g, '');
  if (digits.startsWith('0')) digits = '62' + digits.slice(1);
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

// ── Button builder helpers ─────────────────────────────────────────────
// style: 'primary' (biru) | 'success' (hijau) | 'danger' (merah)

// Telegram TIDAK parse HTML di label tombol, jadi emoji premium di tombol
// dipasang lewat field `icon_custom_emoji_id` (Bot API 9.4). Kalau label diawali
// emoji yang punya ID premium, emoji itu dipindah ke field icon (teks dibersihkan).
function withIcon(button) {
  const m = /^(\S+?)\s+(.*)$/u.exec(button.text);
  if (m && ICON_BY_CHAR[m[1]]) {
    return { ...button, text: m[2], icon_custom_emoji_id: ICON_BY_CHAR[m[1]] };
  }
  return button;
}

function btn(text, callback_data, style = 'primary') {
  return withIcon({ text, callback_data, style });
}

function btnUrl(text, url, style = 'primary') {
  return withIcon({ text, url, style });
}

function kb(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

// ── Role emoji helper (untuk TEKS pesan, boleh pakai E) ─────────────────

function roleEmoji(role, active) {
  if (!active) return FREE_LABEL.emoji;
  return { RAKYAT: E.gem, PEJABAT: E.medal, PRESIDEN: E.crown }[role] ?? FREE_LABEL.emoji;
}

function roleLabel(role, active) {
  if (!active) return FREE_LABEL.label;
  return ROLES[role]?.label ?? FREE_LABEL.label;
}

// ── Main menu (versi rich HTML) ─────────────────────────────────────────

function mainMenuText(user, quota) {
  const active = quota.unlimited;
  const activeUntil = user.active_until ? new Date(user.active_until).toLocaleString('id-ID') : '—';
  const pct = user.total_fix > 0
    ? ((user.total_success / user.total_fix) * 100).toFixed(0)
    : '0';

  const img = CONFIG.START_PHOTO_URL
    ? `<img src="${CONFIG.START_PHOTO_URL}" alt="KYZ Fix Merah" />`
    : '';

  return (
    img +
    `<h2>${E.fire} KYZ FIX MERAH</h2>\n` +
    `<aside>Bot banding WhatsApp otomatis — kirim satu atau banyak nomor sekaligus.</aside>\n\n` +
    `<h3>${E.user} Profil Kamu</h3>\n` +
    kvTable([
      [`${E.idcard} Nama`,  escHtml(user.full_name || 'User')],
      [`${roleEmoji(user.role, active)} Level`, roleLabel(user.role, active)],
      [`${E.clock} Aktif s/d`, activeUntil],
      [`${E.zap} Kuota`, active ? `${quota.maxPerSubmit} nomor/kirim (unlimited harian)` : `${quota.dailyCap} nomor/hari`],
      [`${E.coin} Koin`, String(user.coins)],
    ], ['Info', 'Detail']) +
    `\n<h3>${E.chart} Statistik</h3>\n` +
    kvTable([
      [`${E.mail} Terkirim`, String(user.total_fix)],
      [`${E.check} Sukses`,   String(user.total_success)],
      [`${E.rocket} Rasio`,   `${pct}%`],
    ], ['Data', 'Jumlah']) +
    `\n<footer>KYZ Fix Merah Bot</footer>`
  );
}

function mainMenuKeyboard() {
  return kb([
    [btn(`${EB.red} Fix Merah`, 'fix_merah', 'danger')],
    [
      btn(`${EB.chartG} Statistik`,   'statistik',   'primary'),
      btn(`${EB.trophy} Leaderboard`, 'leaderboard', 'primary'),
    ],
    [btn(`${EB.up} Upgrade Level`, 'upgrade', 'success')],
    [
      btn(`${EB.gift} Referral`, 'referral', 'primary'),
      btn(`${EB.book} Panduan`,  'panduan',  'primary'),
    ],
    [btn(`${EB.list} Riwayat Fix`, 'riwayat', 'primary')],
  ]);
}

// ── Screen renderer ──────────────────────────────────────────────────
// Selalu KIRIM PESAN BARU, TIDAK PERNAH hapus pesan sebelumnya — biar
// histori chat tetap utuh dan user bisa scroll balik lihat langkah lama.

async function renderMainMenu(ctx, user, quota) {
  const html = mainMenuText(user, quota);
  const keyboard = mainMenuKeyboard();
  return richReply(ctx, html, keyboard);
}

async function renderScreen(ctx, html, keyboard) {
  return richReply(ctx, html, keyboard);
}

module.exports = {
  escHtml, normalizePhone,
  mainMenuText, mainMenuKeyboard,
  renderMainMenu, renderScreen,
  btn, btnUrl, kb,
  roleEmoji, roleLabel, E, EB,
};
