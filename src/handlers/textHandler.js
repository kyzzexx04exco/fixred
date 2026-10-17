'use strict';

const CONFIG               = require('../../config');
const { setSetting }       = require('../db/models');
const { handlePhoneInput, parsePhoneList } = require('./fixMerah');
const { escHtml }          = require('../utils/helpers');
const { richReply }        = require('../utils/richMessage');

async function handleText(ctx) {
  ctx.session  = ctx.session || {};
  const state  = ctx.session.state;
  const text   = ctx.message.text?.trim() || '';

  if (text.startsWith('/')) return;

  // ── State khusus: owner lagi edit template email ──────────────────
  if (state === 'waiting_template') {
    if (ctx.from.id !== CONFIG.OWNER_ID) {
      ctx.session.state = null;
      return ctx.reply('Akses ditolak.', { parse_mode: 'HTML' });
    }
    if (!text.includes('{nomor}')) {
      return ctx.reply(
        `Template harus mengandung <code>{nomor}</code>.\nCoba lagi:`,
        { parse_mode: 'HTML' }
      );
    }
    await setSetting('appeal_template', text);
    ctx.session.state = null;
    return richReply(ctx,
      `Template berhasil diperbarui!\n\n<pre>${escHtml(text)}</pre>`
    );
  }

  // ── Auto-detect nomor HP (satu atau banyak sekaligus) ──────────────
  // Berlaku baik sedang di state 'waiting_phone' (abis klik Fix Merah)
  // ATAU tidak dalam state apapun (langsung kirim nomor tanpa klik tombol).
  const { valid } = parsePhoneList(text);

  if (state === 'waiting_phone' || valid.length > 0) {
    return handlePhoneInput(ctx);
  }

  // Bukan state yang relevan & tidak ada nomor valid → abaikan diam-diam
}

module.exports = { handleText };
