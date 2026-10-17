'use strict';

const CONFIG = {
  BOT_TOKEN:        '8854574586:AAF3bpbvmSWE-iGkh9pfeG2D2KaTAqVeAwc',
  OWNER_ID:         8785329222,

  // ── Wajib join (kosongkan string jika tidak ingin validasi) ──────────
  REQUIRED_CHANNEL: 'Kyzzch',
  REQUIRED_GROUP:   'Kyzdiscussion',
  REQUIRED_CHANNEL_ID: null,
  REQUIRED_GROUP_ID:   null,
  FAILOPEN_ON_MEMBERSHIP_ERROR: false,

  // Foto yang tampil di /start (URL publik, kosongkan '' untuk tanpa foto)
  START_PHOTO_URL: 'https://files.catbox.moe/9nzpbq.png',

  // Email pengirim default (seed awal, bisa ditambah via /add_email)
  EMAIL_FROM:       'bot@gmail.com',
  EMAIL_PASS:       'app_password',
  EMAIL_SMTP:       'smtp.gmail.com',
  EMAIL_PORT:       587,
  EMAIL_IMAP:       'imap.gmail.com',
  EMAIL_IMAP_PORT:  993,

  EMAIL_TARGET:     'support@support.whatsapp.com',
  EMAIL_SUBJECT:    'Saya tidak dapat login ke dalam whatsapp',
  REPLY_FROM_DOMAIN: 'whatsapp.com',

  INBOX_CHECK_INTERVAL_MS: 5 * 60 * 1000,
  BACKUP_INTERVAL_MS:      12 * 60 * 60 * 1000,

  // ── MongoDB ───────────────────────────────────────────────────────────
  MONGO_URI:     'mongodb+srv://kyzzexx04excho_db_user:qAGr3JMMgJmrR6hP@kyz.0k64sp4.mongodb.net',
  MONGO_DB_NAME: 'kyz',

  /**
   * ID custom emoji premium ASLI (hasil extract dari pesan Telegram beneran
   * via "Show Json Bot" / forward ke bot semacam itu). HANYA render sebagai
   * emoji premium kalau OWNER_ID di atas (akun pemilik bot) punya Telegram
   * Premium aktif — ini syarat resminya (Bot API 9.4), bukan soal Fragment.
   * Kalau owner tidak premium, Telegram otomatis fallback ke emoji unicode
   * biasa di dalam tag <tg-emoji>, jadi aman dipakai kapan pun.
   *
   * Mau nambah lagi? Forward pesan yang ada custom emoji-nya ke bot semacam
   * "Show Json Bot" / "RawDataBot", cari field "custom_emoji_id" di hasil
   * JSON-nya, lalu tambahkan di bawah.
   */
  PREMIUM_EMOJI_IDS: {
    user:     '5260399854500191689', // 👤
    search:   '5258011929993026890', // 🔍
    idcard:   '5814247475141153332', // 🪪
    status:   '5884366771913233289', // status badge
    clock:    '5316591603123502631', // 🕐
    chart_up: '6206343625232619150', // 📈
    chart_g:  '5224450179368767019', // 📊
    receipt:  '5444856076954520455', // 🧾
    gem1:     '5312016608254762256', // 💎 (RAKYAT)
    gem2:     '5199785165735367039', // 💎 (PEJABAT)
    gem3:     '6204104220694550861', // 💎 (PRESIDEN)
    pin:      '6206190608432764318', // 📌
    link:     '6206497372176913599', // 🔗
    gem4:     '5891044423856296980', // 💎 (redeem)
  },

  DB_TOOLS: {
    // Binary mongodump harus terinstall untuk fitur backup otomatis
    // (satu paket dengan mongodb-database-tools)
    MONGODUMP_BIN: 'mongodump',
  },
};

module.exports = CONFIG;
