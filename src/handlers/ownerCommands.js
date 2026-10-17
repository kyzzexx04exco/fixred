'use strict';

const CONFIG = require('../../config');
const {
  setRole, getSetting,
  listSenders, addSender, deleteSender,
  toggleSender, setImapConfig, getSenderById, poolStats,
} = require('../db/models');
const { sendTestEmail }    = require('../utils/mailer');
const { runBackup }        = require('../utils/backup');
const { checkMembership }  = require('./middleware');
const { ROLES }            = require('../utils/constants');
const { escHtml, E }       = require('../utils/helpers');
const { richReply }        = require('../utils/richMessage');

function ownerOnly(ctx) {
  if (ctx.from.id !== CONFIG.OWNER_ID) {
    ctx.reply(`${E.lock} Akses ditolak.`, { parse_mode: 'HTML' });
    return false;
  }
  return true;
}

// /set_role USER_ID ROLE [HARI]
// Contoh: /set_role 123456 RAKYAT 7   → aktifkan RAKYAT selama 7 hari dari sekarang
//         /set_role 123456 FREE      → cabut akses (balik ke FREE)
async function cmdSetRole(ctx) {
  if (!ownerOnly(ctx)) return;
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 3) {
    return ctx.reply(
      `Usage: <code>/set_role USER_ID ROLE [HARI]</code>\n` +
      `Role: FREE | RAKYAT | PEJABAT | PRESIDEN\n\n` +
      `Contoh:\n<code>/set_role 123456 RAKYAT 7</code> → aktif 7 hari\n` +
      `<code>/set_role 123456 FREE</code> → cabut akses`,
      { parse_mode: 'HTML' }
    );
  }
  const targetId = parseInt(parts[1]);
  const role     = parts[2].toUpperCase();
  const days     = parts[3] ? parseInt(parts[3]) : null;

  if (role !== 'FREE' && !ROLES[role]) {
    return ctx.reply('Role tidak valid.', { parse_mode: 'HTML' });
  }

  const activeUntil = role === 'FREE'
    ? null
    : (days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : undefined);

  await setRole(targetId, role, activeUntil);

  const info = role === 'FREE'
    ? 'akses dicabut, balik ke FREE'
    : (days ? `aktif ${days} hari (s/d ${activeUntil.toLocaleString('id-ID')})` : 'role diubah (masa aktif tidak diubah)');

  await richReply(ctx,
    `${E.check} User <b>${targetId}</b>: <b>${role}</b> — ${info}`
  );
}

// /edit_template
async function cmdEditTemplate(ctx) {
  if (!ownerOnly(ctx)) return;
  ctx.session       = ctx.session || {};
  ctx.session.state = 'waiting_template';

  const current = (await getSetting('appeal_template')) || '+{nomor}';
  await ctx.reply(
    `${E.pen} <b>Edit Template Email Banding</b>\n\n` +
    `Template sekarang:\n<pre>${escHtml(current)}</pre>\n\n` +
    `Kirim template baru. Gunakan <code>{nomor}</code> sebagai placeholder.`,
    { parse_mode: 'HTML' }
  );
}

// /list_email
async function cmdListEmail(ctx) {
  if (!ownerOnly(ctx)) return;
  const senders = await listSenders();
  if (!senders.length) {
    return ctx.reply(
      `${E.warning} Belum ada email sender. Tambah dengan /add_email`,
      { parse_mode: 'HTML' }
    );
  }
  const pool  = await poolStats();
  const lines = senders.map(s => {
    const status = s.active ? `${E.check} [AKTIF]` : `${E.cross} [MATI]`;
    const last   = s.last_used ? new Date(s.last_used).toLocaleString('id-ID') : 'belum dipakai';
    return (
      `${status} <b>#${s.seq}</b> <code>${escHtml(s.email)}</code>\n` +
      `   Label    : ${escHtml(s.label || '-')}\n` +
      `   SMTP     : ${escHtml(s.smtp_host)}:${s.smtp_port}\n` +
      `   IMAP     : ${escHtml(s.imap_host || '-')}:${s.imap_port || '-'}\n` +
      `   Terkirim : ${s.total_sent}\n` +
      `   Terakhir : ${last}`
    );
  }).join('\n\n');

  await ctx.reply(
    `${E.mail} <b>Email Sender Pool</b>\n` +
    `Total: ${pool.total} | Aktif: ${pool.active} | Total Kirim: ${pool.total_sent}\n\n` +
    lines,
    { parse_mode: 'HTML' }
  );
}

// /add_email email|pass[|smtp|port|label]
async function cmdAddEmail(ctx) {
  if (!ownerOnly(ctx)) return;
  const raw = ctx.message.text.replace('/add_email', '').trim();
  if (!raw) {
    return ctx.reply(
      `${E.pen} <b>Cara Tambah Email Sender:</b>\n\n` +
      `Minimal:\n<code>/add_email email|password</code>\n\n` +
      `Lengkap:\n<code>/add_email email|password|smtp_host|port|label</code>`,
      { parse_mode: 'HTML' }
    );
  }
  const [email, password, smtp_host, smtp_port, label] = raw.split('|').map(s => s.trim());
  if (!email || !password) {
    return ctx.reply(
      `Format salah. Minimal: <code>/add_email email|password</code>`,
      { parse_mode: 'HTML' }
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return ctx.reply(`${E.cross} Format email tidak valid.`, { parse_mode: 'HTML' });
  }
  const ok = await addSender({
    email, password,
    smtp_host: smtp_host || 'smtp.gmail.com',
    smtp_port: parseInt(smtp_port) || 587,
    label:     label || '',
  });
  if (!ok) {
    return ctx.reply(
      `${E.warning} Email <code>${escHtml(email)}</code> sudah ada di database.`,
      { parse_mode: 'HTML' }
    );
  }
  await ctx.reply(
    `${E.check} <b>Email Sender Ditambahkan!</b>\n\n` +
    `Email  : <code>${escHtml(email)}</code>\n` +
    `SMTP   : ${escHtml(smtp_host || 'smtp.gmail.com')}:${smtp_port || 587}\n` +
    `Label  : ${escHtml(label || '-')}`,
    { parse_mode: 'HTML' }
  );
}

// /del_email SEQ
async function cmdDelEmail(ctx) {
  if (!ownerOnly(ctx)) return;
  const seq = parseInt(ctx.message.text.trim().split(/\s+/)[1]);
  if (!seq) return ctx.reply('Usage: <code>/del_email SEQ</code>', { parse_mode: 'HTML' });

  const sender = await getSenderById(seq);
  if (!sender) return ctx.reply(`${E.cross} Sender #${seq} tidak ditemukan.`, { parse_mode: 'HTML' });

  await deleteSender(seq);
  await ctx.reply(
    `${E.check} Email <code>${escHtml(sender.email)}</code> (#${seq}) dihapus dari pool.`,
    { parse_mode: 'HTML' }
  );
}

// /toggle_email SEQ
async function cmdToggleEmail(ctx) {
  if (!ownerOnly(ctx)) return;
  const seq = parseInt(ctx.message.text.trim().split(/\s+/)[1]);
  if (!seq) return ctx.reply('Usage: <code>/toggle_email SEQ</code>', { parse_mode: 'HTML' });

  const sender = await getSenderById(seq);
  if (!sender) return ctx.reply(`${E.cross} Sender #${seq} tidak ditemukan.`, { parse_mode: 'HTML' });

  const newActive = !sender.active;
  await toggleSender(seq, newActive);
  await ctx.reply(
    `<code>${escHtml(sender.email)}</code> sekarang: <b>${newActive ? `${E.check} AKTIF` : `${E.cross} NONAKTIF`}</b>`,
    { parse_mode: 'HTML' }
  );
}

// /test_email SEQ
async function cmdTestEmail(ctx) {
  if (!ownerOnly(ctx)) return;
  const seq = parseInt(ctx.message.text.trim().split(/\s+/)[1]);
  if (!seq) return ctx.reply('Usage: <code>/test_email SEQ</code>', { parse_mode: 'HTML' });

  const sender = await getSenderById(seq);
  if (!sender) return ctx.reply(`${E.cross} Sender #${seq} tidak ditemukan.`, { parse_mode: 'HTML' });

  await ctx.reply(
    `${E.mail} Mengirim email tes dari <code>${escHtml(sender.email)}</code>...`,
    { parse_mode: 'HTML' }
  );
  try {
    await sendTestEmail(sender);
    await ctx.reply(`${E.check} Email tes berhasil dikirim!`, { parse_mode: 'HTML' });
  } catch (err) {
    await ctx.reply(
      `${E.cross} Gagal kirim tes.\nError: <code>${escHtml(err.message)}</code>`,
      { parse_mode: 'HTML' }
    );
  }
}

// /set_imap SEQ imap_host [port]
async function cmdSetImap(ctx) {
  if (!ownerOnly(ctx)) return;
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 3) {
    return ctx.reply(
      `Usage: <code>/set_imap SEQ imap_host [port]</code>\n` +
      `Contoh: <code>/set_imap 1 imap.gmail.com 993</code>`,
      { parse_mode: 'HTML' }
    );
  }
  const seq  = parseInt(parts[1]);
  const host = parts[2];
  const port = parseInt(parts[3]) || 993;

  const sender = await getSenderById(seq);
  if (!sender) return ctx.reply(`${E.cross} Sender #${seq} tidak ditemukan.`, { parse_mode: 'HTML' });

  await setImapConfig(seq, host, port);
  await ctx.reply(
    `${E.check} IMAP sender #${seq} diupdate: <code>${escHtml(host)}:${port}</code>`,
    { parse_mode: 'HTML' }
  );
}

// /backup_now
async function cmdBackupNow(ctx) {
  if (!ownerOnly(ctx)) return;
  await ctx.reply(`${E.pen} Menjalankan backup database...`, { parse_mode: 'HTML' });
  await runBackup(ctx.telegram);
}

// /check_member USER_ID
async function cmdCheckMember(ctx) {
  if (!ownerOnly(ctx)) return;
  const targetId = parseInt(ctx.message.text.trim().split(/\s+/)[1]);
  if (!targetId) return ctx.reply('Usage: <code>/check_member USER_ID</code>', { parse_mode: 'HTML' });

  const fakeCtx = { from: { id: targetId }, telegram: ctx.telegram };
  const result  = await checkMembership(fakeCtx);

  await ctx.reply(
    `${E.chartG} <b>Status Membership User ${targetId}</b>\n\n` +
    `Hasil: <b>${result.ok ? `${E.check} LOLOS` : `${E.cross} DITOLAK`}</b>` +
    (result.error ? `\nError: <code>${escHtml(result.error)}</code>` : ''),
    { parse_mode: 'HTML' }
  );
}

module.exports = {
  cmdSetRole, cmdEditTemplate, cmdListEmail,
  cmdAddEmail, cmdDelEmail, cmdToggleEmail, cmdTestEmail,
  cmdSetImap, cmdBackupNow, cmdCheckMember,
};


/**
 * Owner kirim pesan berisi emoji premium (atau forward) ke bot → bot balas
 * daftar custom_emoji_id-nya, tinggal salin ke config.PREMIUM_EMOJI_IDS.
 */
async function handleEmojiIds(ctx, next) {
  const msg = ctx.message;
  if (ctx.from?.id !== CONFIG.OWNER_ID || !msg) return next();
  const text = msg.text || msg.caption || '';
  const ents = (msg.entities || msg.caption_entities || []).filter(e => e.type === 'custom_emoji');
  if (!ents.length) return next();

  const lines = ents.map(e => {
    const ch = text.slice(e.offset, e.offset + e.length);
    return `${e.custom_emoji_id}  ${ch}`;
  });
  await ctx.reply('ID emoji premium:\n\n' + lines.join('\n') +
    '\n\nSalin ke config.js → PREMIUM_EMOJI_IDS, mis:  fire: \'ID\',');
}

module.exports.handleEmojiIds = handleEmojiIds;
