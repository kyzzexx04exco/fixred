'use strict';

const CONFIG            = require('../../config');
const { upsertUser }    = require('../db/models');
const { E, EB, btnUrl, kb } = require('../utils/helpers');

const VALID_STATUS = ['member', 'administrator', 'creator', 'restricted'];

let warnedOwnerOnce = false;

/**
 * Cek apakah user adalah member channel & group yang diwajibkan.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function checkMembership(ctx) {
  const chanTarget = CONFIG.REQUIRED_CHANNEL_ID || (CONFIG.REQUIRED_CHANNEL ? `@${CONFIG.REQUIRED_CHANNEL}` : null);
  const groupTarget = CONFIG.REQUIRED_GROUP_ID   || (CONFIG.REQUIRED_GROUP   ? `@${CONFIG.REQUIRED_GROUP}`   : null);

  // Tidak ada channel/group yang diwajibkan → selalu lolos
  if (!chanTarget && !groupTarget) return { ok: true };

  const uid = ctx.from.id;

  try {
    const checks = [];
    if (chanTarget)  checks.push(ctx.telegram.getChatMember(chanTarget, uid));
    if (groupTarget) checks.push(ctx.telegram.getChatMember(groupTarget, uid));

    const results = await Promise.all(checks);
    const allOk   = results.every(r => VALID_STATUS.includes(r.status));
    return { ok: allOk };
  } catch (err) {
    console.error('[MEMBERSHIP CHECK ERROR]', err.message);

    // Beri tahu owner SEKALI saja supaya tahu bot belum admin / config salah
    if (!warnedOwnerOnce) {
      warnedOwnerOnce = true;
      try {
        await ctx.telegram.sendMessage(
          CONFIG.OWNER_ID,
          `⚠️ <b>Gagal cek membership channel/group!</b>\n\n` +
          `Error: <code>${err.message}</code>\n\n` +
          `Pastikan:\n` +
          `1. Bot sudah di-invite jadi admin di channel & group\n` +
          `2. REQUIRED_CHANNEL / REQUIRED_GROUP di config.js benar\n` +
          `3. Jika channel/group private, isi REQUIRED_CHANNEL_ID / REQUIRED_GROUP_ID (numeric)\n\n` +
          `Mode saat ini: <b>${CONFIG.FAILOPEN_ON_MEMBERSHIP_ERROR ? 'FAIL-OPEN (semua diizinkan)' : 'FAIL-CLOSED (semua ditolak)'}</b>`,
          { parse_mode: 'HTML' }
        );
      } catch {}
    }

    return { ok: CONFIG.FAILOPEN_ON_MEMBERSHIP_ERROR, error: err.message };
  }
}

async function mainMiddleware(ctx, next) {
  if (!ctx.from) return next();

  await upsertUser(ctx);

  if (ctx.from.id === CONFIG.OWNER_ID) return next();

  const text = ctx.message?.text || '';
  if (text.startsWith('/start')) return next();

  const { ok } = await checkMembership(ctx);
  if (!ok) {
    // Tutup loading spinner kalau ini dari button click
    if (ctx.callbackQuery) {
      try { await ctx.answerCbQuery('Kamu belum join channel/group!', true); } catch {}
    }

    const rows = [];
    if (CONFIG.REQUIRED_CHANNEL || CONFIG.REQUIRED_CHANNEL_ID) {
      rows.push([btnUrl(
        `${EB.mail} Join Channel`,
        CONFIG.REQUIRED_CHANNEL ? `https://t.me/${CONFIG.REQUIRED_CHANNEL}` : `https://t.me/c/${String(CONFIG.REQUIRED_CHANNEL_ID).replace('-100', '')}`,
        'primary'
      )]);
    }
    if (CONFIG.REQUIRED_GROUP || CONFIG.REQUIRED_GROUP_ID) {
      rows.push([btnUrl(
        `${EB.people} Join Group`,
        CONFIG.REQUIRED_GROUP ? `https://t.me/${CONFIG.REQUIRED_GROUP}` : `https://t.me/c/${String(CONFIG.REQUIRED_GROUP_ID).replace('-100', '')}`,
        'success'
      )]);
    }

    await ctx.reply(
      `${E.lock} <b>AKSES DITOLAK</b>\n\n` +
      `<blockquote>Kamu wajib join channel &amp; group dulu sebelum pakai bot ini.</blockquote>\n\n` +
      `Setelah join, ketik /start lagi untuk verifikasi ulang.`,
      { parse_mode: 'HTML', ...kb(rows) }
    );
    return;
  }

  return next();
}

module.exports = { mainMiddleware, checkMembership };
