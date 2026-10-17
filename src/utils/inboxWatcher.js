'use strict';

/**
 * inboxWatcher.js — cek inbox tiap email sender secara berkala lewat IMAP,
 * cari balasan dari WhatsApp yang menyebut salah satu nomor yang sedang
 * menunggu notifikasi (fix_history.notified = FALSE), lalu kirim notifikasi
 * ke user Telegram terkait.
 *
 * CATATAN: WhatsApp membalas dari alamat & format yang bisa berubah
 * sewaktu-waktu, jadi deteksi ini berbasis heuristik (cocokkan domain
 * pengirim + keberadaan nomor telepon di body/subject). Jika ternyata
 * polanya beda, sesuaikan fungsi `looksLikeWAReply()` di bawah.
 */

const { ImapFlow } = require('imapflow');
const CONFIG       = require('../../config');
const {
  getActiveSenders, getPendingNotify, markNotified,
} = require('../db/models');
const { sendRich } = require('./richMessage');

function looksLikeWAReply(fromAddr, subject, text) {
  const domain = (CONFIG.REPLY_FROM_DOMAIN || 'whatsapp.com').toLowerCase();
  const from   = String(fromAddr || '').toLowerCase();
  return from.includes(domain);
}

function extractSnippet(text, maxLen = 300) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + '…' : clean;
}

/**
 * Cek satu mailbox sender, cocokkan dengan daftar pending notify.
 */
async function checkOneSender(sender, telegram) {
  if (!sender.imap_host) return;

  const pending = await getPendingNotify(sender.email);
  if (!pending.length) return; // tidak ada yang perlu dicek untuk sender ini

  let client;
  try {
    client = new ImapFlow({
      host: sender.imap_host,
      port: sender.imap_port || 993,
      secure: true,
      auth: { user: sender.email, pass: sender.password },
      logger: false,
    });

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Cek email yang masuk dalam 7 hari terakhir saja (supaya tidak scan seluruh inbox)
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const uids  = await client.search({ since });
      if (!uids || !uids.length) return;

      // Ambil pesan terbaru dulu, batasi 50 biar tidak berat
      const recentUids = uids.slice(-50);

      for (const uid of recentUids) {
        const msg = await client.fetchOne(uid, { envelope: true, source: true });
        if (!msg) continue;

        const fromAddr = msg.envelope?.from?.[0]?.address || '';
        const subject  = msg.envelope?.subject || '';
        const bodyText = msg.source ? msg.source.toString('utf8') : '';

        if (!looksLikeWAReply(fromAddr, subject, bodyText)) continue;

        // Cocokkan dengan nomor yang masih pending notifikasi
        for (const item of pending) {
          if (item.notified) continue; // sudah ditandai di loop sebelumnya
          const phoneVariants = [item.phone, `+${item.phone}`];
          const matched = phoneVariants.some(p =>
            subject.includes(p) || bodyText.includes(p)
          );

          if (matched) {
            try {
              await sendRich(telegram, item.user_id,
                `<h3>🔔 Balasan WhatsApp Diterima!</h3>\n` +
                `<table>` +
                `<tr><td>📱 Nomor</td><td><code>+${item.phone}</code></td></tr>` +
                `<tr><td>📧 Dari</td><td><code>${fromAddr}</code></td></tr>` +
                `<tr><td>📌 Subjek</td><td><i>${subject}</i></td></tr>` +
                `</table>\n` +
                `<blockquote>${extractSnippet(bodyText)}</blockquote>\n\n` +
                `Cek email <code>${sender.email}</code> untuk detail lengkap.`
              );
            } catch (err) {
              console.error(`[NOTIFY ERROR] user ${item.user_id}:`, err.message);
            }
            await markNotified(item._id, extractSnippet(bodyText));
            item.notified = true; // supaya tidak double-notify dalam loop yang sama
          }
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    console.error(`[INBOX WATCHER] Gagal cek ${sender.email}:`, err.message);
    try { await client?.logout(); } catch {}
  }
}

/**
 * Jalankan satu putaran cek untuk semua sender aktif.
 */
async function runInboxCheck(telegram) {
  try {
    const senders = await getActiveSenders();
    for (const sender of senders) {
      await checkOneSender(sender, telegram);
    }
  } catch (err) {
    console.error('[INBOX WATCHER] Error:', err.message);
  }
}

/**
 * Mulai polling berkala.
 */
function startInboxWatcher(telegram) {
  const intervalMs = CONFIG.INBOX_CHECK_INTERVAL_MS || 5 * 60 * 1000;
  console.log(`[INBOX WATCHER] Aktif, cek tiap ${Math.round(intervalMs / 60000)} menit.`);

  // Jalankan sekali di awal (setelah delay kecil biar bot sudah stabil)
  setTimeout(() => runInboxCheck(telegram), 15_000);

  setInterval(() => runInboxCheck(telegram), intervalMs);
}

module.exports = { startInboxWatcher, runInboxCheck };
