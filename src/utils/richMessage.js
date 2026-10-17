'use strict';

/**
 * richMessage.js — wrapper tipis di atas method Bot API resmi
 * `sendRichMessage` (Bot API 10.1–10.3, rilis Juni–Agustus 2026).
 *
 * INI FITUR RESMI TELEGRAM, bukan library pihak ketiga. Dokumentasinya ada
 * di https://core.telegram.org/bots/api#sendrichmessage — tapi karena masih
 * sangat baru, library Telegraf yang kita pakai (versi lama) belum punya
 * method ter-typed untuk ini. Makanya kita panggil langsung lewat
 * `telegram.callApi()`, escape hatch bawaan Telegraf buat method Bot API
 * apapun walau belum didukung secara resmi oleh librarynya.
 *
 * `rich_message.html` menerima HTML dengan tag TAMBAHAN dibanding
 * parse_mode biasa: <h1>-<h6>, <table>, <details>, <footer>, <aside>, dll —
 * selain tag lama (<b>, <i>, <blockquote>, <code>, <pre>, <tg-emoji>, dst
 * yang tetap jalan seperti biasa). Limit 32.768 karakter per pesan (vs 4096
 * di pesan biasa) dan maksimal 500 block.
 *
 * CATATAN PENTING: fitur ini BARU BANGET (hitungan minggu), jadi Claude
 * tidak bisa menguji end-to-end terhadap server Telegram asli di sandbox
 * ini (tidak ada akses jaringan). Implementasi di bawah mengikuti dokumentasi
 * resmi yang berhasil ditemukan, tapi kalau ternyata ada field yang berubah
 * / belum didukung penuh, kirim pesan error-nya supaya bisa disesuaikan cepat.
 */

/**
 * Rapikan HTML sebelum dikirim.
 * Heading <h1>-<h6> (font serif) & <aside> adalah tampilan BAWAAN rich message
 * Telegram — bukan bug — jadi dibiarkan apa adanya.
 * Yang diubah cuma tabel: dibuat `bordered` (garis tegas, lebar penuh) seperti
 * contoh bot rich message lain, bukan tabel polos tanpa garis.
 */
function normalizeRichHtml(html) {
  return String(html).replace(/<table>/g, '<table bordered>');
}

async function sendRich(telegram, chatId, html, extra = {}) {
  return telegram.callApi('sendRichMessage', {
    chat_id: chatId,
    rich_message: { html: normalizeRichHtml(html) },
    ...extra,
  });
}

/**
 * Reply rich message, otomatis ambil chat id dari ctx (baik dari pesan
 * biasa maupun callback_query).
 */
async function richReply(ctx, html, extra = {}) {
  const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
  return sendRich(ctx.telegram, chatId, html, extra);
}

/**
 * Bikin tabel HTML dari pasangan [label, value] — pengganti ASCII-art
 * box-drawing yang dipakai sebelumnya, sekarang jadi tabel HTML asli.
 */
function kvTable(rows, header) {
  const head = header
    ? `<tr><th>${header[0]}</th><th>${header[1]}</th></tr>`
    : '';
  const trs = rows
    .map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`)
    .join('');
  return `<table>${head}${trs}</table>`;
}

module.exports = { sendRich, richReply, kvTable, normalizeRichHtml };
