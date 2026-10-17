'use strict';

const nodemailer = require('nodemailer');
const CONFIG     = require('../../config');
const {
  getActiveSenders, markAttempt, getSetting,
} = require('../db/models');

function makeTransporter(sender) {
  const port = Number(sender.smtp_port) || 587;
  return nodemailer.createTransport({
    host:   sender.smtp_host,
    port,
    // Port 465 = implicit TLS (secure:true wajib dari awal koneksi).
    // Port 587/lainnya = STARTTLS (secure:false, upgrade setelah connect).
    // Hardcode secure:false sebelumnya bikin koneksi gagal/timeout kalau
    // sender pakai port 465.
    secure: port === 465,
    auth:   { user: sender.email, pass: sender.password },
    tls:    { rejectUnauthorized: false },
    connectionTimeout: 15000, // 15 detik — biar gagalnya cepat & jelas, gak nge-hang
    greetingTimeout:   15000,
    socketTimeout:     20000,
  });
}

/**
 * Kirim email banding WhatsApp (round-robin multi-sender).
 * Setiap sender yang DICOBA (sukses atau gagal) langsung ditandai supaya
 * rotasi tetap adil — sender yang baru gagal tidak akan terus-menerus
 * dicoba duluan di percobaan berikutnya.
 * @param {string} phone  E.164 tanpa '+'
 * @returns {Promise<{success: boolean, usedEmail: string|null}>}
 */
async function sendAppealEmail(phone) {
  const template = (await getSetting('appeal_template')) || '+{nomor}';
  const body     = template.replace('{nomor}', phone);
  const senders  = await getActiveSenders();

  if (!senders.length) {
    console.error('[MAILER] Tidak ada email sender aktif.');
    return { success: false, usedEmail: null };
  }

  for (const sender of senders) {
    try {
      const t = makeTransporter(sender);
      await t.sendMail({
        from:    `"KYZ Fix Merah" <${sender.email}>`,
        to:      CONFIG.EMAIL_TARGET,
        subject: CONFIG.EMAIL_SUBJECT,
        text:    body,
      });
      await markAttempt(sender.seq, true);
      console.log(`[MAILER OK] ${sender.email} -> +${phone}`);
      return { success: true, usedEmail: sender.email };
    } catch (err) {
      await markAttempt(sender.seq, false);
      console.error(`[MAILER FAIL] ${sender.email}: ${err.message}`);
    }
  }

  return { success: false, usedEmail: null };
}

async function sendTestEmail(sender) {
  const t = makeTransporter(sender);
  await t.sendMail({
    from:    `"KYZ Bot TEST" <${sender.email}>`,
    to:      CONFIG.EMAIL_TARGET,
    subject: `[TEST] KYZ Sender #${sender.seq}`,
    text:    `Tes dari sender #${sender.seq} (${sender.email})\nTimestamp: ${new Date().toISOString()}`,
  });
  await markAttempt(sender.seq, true);
}

module.exports = { sendAppealEmail, sendTestEmail, makeTransporter };
