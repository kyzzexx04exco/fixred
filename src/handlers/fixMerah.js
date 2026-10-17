'use strict';

const { getUser, countTodayFix, recordFix, getQuota } = require('../db/models');
const { sendAppealEmail }         = require('../utils/mailer');
const {
  normalizePhone, escHtml, E, EB, btn, kb, renderScreen,
} = require('../utils/helpers');
const { richReply } = require('../utils/richMessage');
const CONFIG = require('../../config');

// Batas keras anti-abuse (terlepas dari role) — satu kali kirim gak akan
// pernah diproses lebih dari ini meski user punya akses PRESIDEN sekalipun,
// biar gak ada yang nyoba kirim ribuan nomor dalam satu pesan.
const HARD_CEILING = 200;

/**
 * Parse teks bebas jadi daftar nomor valid + yang gagal divalidasi.
 * Nomor dipisah newline, koma, atau titik-koma. Duplikat dibuang.
 */
function parsePhoneList(text) {
  const parts = text.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  const seen  = new Set();
  const valid = [];
  const invalid = [];

  for (const part of parts) {
    const phone = normalizePhone(part);
    if (!phone) { invalid.push(part); continue; }
    if (seen.has(phone)) continue;
    seen.add(phone);
    valid.push(phone);
  }
  return { valid: valid.slice(0, HARD_CEILING), invalid };
}

async function handleFixMerah(ctx) {
  await ctx.answerCbQuery();
  ctx.session       = ctx.session || {};
  ctx.session.state = 'waiting_phone';

  const user  = await getUser(ctx.from.id);
  const quota = getQuota(user);

  const info = quota.unlimited
    ? `${E.check} Akses aktif — bisa kirim sampai <b>${quota.maxPerSubmit} nomor sekaligus</b>, tanpa batas harian.`
    : `${E.warning} Tanpa akses aktif — maksimal <b>${quota.dailyCap} nomor per hari</b> (total, boleh dikirim sekaligus).`;

  await renderScreen(ctx,
    `<h3>${E.red} Fix Merah — Banding WhatsApp</h3>\n` +
    `<blockquote>Kirimkan satu atau beberapa nomor WhatsApp sekaligus — pisahkan tiap nomor dengan baris baru atau koma.</blockquote>\n\n` +
    `${info}\n\n` +
    `${E.zap} <b>Format yang diterima:</b>\n` +
    `<code>+62812xxxxxxxx</code> / <code>62812xxxxxxxx</code> / <code>0812xxxxxxxx</code>\n\n` +
    `${E.pen} <b>Contoh kirim banyak sekaligus:</b>\n` +
    `<pre>0812xxxxxxxx\n0813xxxxxxxx\n0814xxxxxxxx</pre>`,
    kb([[btn(`${EB.cross} Batal`, 'back_main', 'danger')]])
  );
}

async function handlePhoneInput(ctx) {
  const raw = ctx.message.text.trim();
  const { valid, invalid } = parsePhoneList(raw);

  if (!valid.length) {
    return richReply(ctx,
      `${E.cross} Tidak ada nomor valid yang terdeteksi di pesan kamu.\nCoba lagi dengan format yang benar (lihat /panduan).`,
      {}
    );
  }

  const user  = await getUser(ctx.from.id);
  const quota = getQuota(user);

  let toProcess = valid;
  let note = '';

  if (quota.unlimited) {
    // Akses aktif: tidak ada limit harian, cuma dibatasi batch per kirim
    if (valid.length > quota.maxPerSubmit) {
      toProcess = valid.slice(0, quota.maxPerSubmit);
      note = `${E.warning} Kamu kirim ${valid.length} nomor, tapi batch maksimal level kamu adalah <b>${quota.maxPerSubmit} nomor/kirim</b>. Hanya ${toProcess.length} nomor pertama yang diproses sekarang — kirim sisanya di command terpisah.`;
    }
  } else {
    // Tanpa akses aktif: limit total per hari
    const already   = await countTodayFix(user._id);
    const remaining = Math.max(0, quota.dailyCap - already);

    if (remaining <= 0) {
      ctx.session.state = null;
      return richReply(ctx,
        `${E.warning} <h3>Kuota Harian Habis</h3>\n` +
        `<blockquote>Kamu sudah melakukan <b>${already}</b> fix hari ini. Limit tanpa akses aktif: <b>${quota.dailyCap} nomor/hari</b>.</blockquote>\n\n` +
        `Upgrade untuk akses unlimited (dibatasi batch per kirim, bukan harian), atau tunggu besok.`,
        kb([
          [btn(`${EB.up} Upgrade Sekarang`, 'upgrade',   'success')],
          [btn(`${EB.home} Menu Utama`,      'back_main', 'primary')],
        ])
      );
    }

    if (valid.length > remaining) {
      toProcess = valid.slice(0, remaining);
      note = `${E.warning} Sisa kuota harian kamu <b>${remaining} nomor</b>. Hanya ${toProcess.length} nomor pertama yang diproses — sisanya besok, atau upgrade untuk unlimited.`;
    }
  }

  ctx.session.pendingList = toProcess;
  ctx.session.state       = 'confirm_phone';

  const listText = toProcess.map((p, i) => `${i + 1}. <code>+${p}</code>`).join('\n');
  const invalidText = invalid.length
    ? `\n\n${E.cross} <b>Diabaikan (format salah):</b> ${invalid.map(escHtml).join(', ')}`
    : '';

  await richReply(ctx,
    `${E.zap} <h3>Konfirmasi Banding (${toProcess.length} nomor)</h3>\n` +
    `${listText}${invalidText}${note ? '\n\n' + note : ''}\n\n` +
    `Lanjutkan pengiriman banding ke <code>${CONFIG.EMAIL_TARGET}</code>?`,
    kb([[
      btn(`${EB.check} IYA, Kirim!`, 'confirm_fix', 'success'),
      btn(`${EB.cross} BATAL`,       'back_main',   'danger'),
    ]])
  );
}

async function handleConfirmFix(ctx) {
  await ctx.answerCbQuery('⏳ Memproses...');
  ctx.session = ctx.session || {};
  const list  = ctx.session.pendingList;

  if (!list || !list.length) {
    return renderScreen(ctx,
      `${E.warning} Sesi kadaluarsa. Silakan mulai ulang dari menu Fix Merah.`,
      kb([[btn(`${EB.home} Menu Utama`, 'back_main', 'primary')]])
    );
  }

  const user = await getUser(ctx.from.id);

  let successCount = 0;
  let failCount    = 0;
  const resultLines = [];

  for (const phone of list) {
    const { success, usedEmail } = await sendAppealEmail(phone);
    await recordFix(user._id, phone, success ? 'success' : 'failed', usedEmail);
    if (success) successCount++; else failCount++;
    resultLines.push(
      `${success ? E.check : E.cross} <code>+${phone}</code>${usedEmail ? ' via ' + escHtml(usedEmail) : ''}`
    );
  }

  ctx.session.state       = null;
  ctx.session.pendingList = null;

  await renderScreen(ctx,
    `<h3>${E.check} Selesai Diproses</h3>\n` +
    `Berhasil: <b>${successCount}</b> &nbsp;|&nbsp; Gagal: <b>${failCount}</b>\n\n` +
    resultLines.join('\n') +
    `\n\n<blockquote>${E.bell} Kamu akan otomatis dikirimi notifikasi kalau ada balasan dari WhatsApp. Tunggu 1–3 hari kerja.</blockquote>`,
    kb([[btn(`${EB.home} Menu Utama`, 'back_main', 'primary')]])
  );
}

module.exports = { handleFixMerah, handlePhoneInput, handleConfirmFix, parsePhoneList };
