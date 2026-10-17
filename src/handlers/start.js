'use strict';

const {
  getUser, getUserByReferralCode, setReferral, addCoins, getQuota,
} = require('../db/models');
const {
  renderMainMenu, mainMenuText, mainMenuKeyboard, escHtml, E,
} = require('../utils/helpers');
const { richReply } = require('../utils/richMessage');

async function handleStart(ctx) {
  const user    = await getUser(ctx.from.id);
  const payload = ctx.startPayload || '';

  if (payload.startsWith('REF') && !user.referred_by) {
    const refUser = await getUserByReferralCode(payload);
    if (refUser && refUser._id !== user._id) {
      await setReferral(user._id, refUser._id);
      await addCoins(refUser._id, 1);
      try {
        await ctx.telegram.sendMessage(
          refUser._id,
          `${E.coin} <b>+1 Koin!</b>\n\n<blockquote>${escHtml(user.full_name || 'Seseorang')} baru saja join via link referralmu!</blockquote>`,
          { parse_mode: 'HTML' }
        );
      } catch {}
    }
  }

  const freshUser = await getUser(ctx.from.id);
  const quota     = getQuota(freshUser);

  // /start selalu kirim pesan BARU (belum tentu ada pesan lama untuk dihapus)
  await richReply(ctx, mainMenuText(freshUser, quota), mainMenuKeyboard());
}

async function handleBackMain(ctx) {
  await ctx.answerCbQuery();
  ctx.session           = ctx.session || {};
  ctx.session.state     = null;
  ctx.session.pendingList = null;

  const user  = await getUser(ctx.from.id);
  const quota = getQuota(user);
  await renderMainMenu(ctx, user, quota);
}

module.exports = { handleStart, handleBackMain };
