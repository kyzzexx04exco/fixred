'use strict';

const { getUser, spendCoins, hasActiveAccess } = require('../db/models');
const { PACKAGES, COIN_EXCHANGE }  = require('../utils/constants');
const {
  escHtml, E, EB, btn, btnUrl, kb, renderScreen,
} = require('../utils/helpers');

// ══════════════════════════════════════════════════
//  UPGRADE
// ══════════════════════════════════════════════════

async function handleUpgrade(ctx) {
  await ctx.answerCbQuery();
  await renderScreen(ctx,
    `<h3>${E.up} Upgrade Level</h3>\n` +
    `<blockquote>Selama masa aktif berjalan, kuota kirim JADI UNLIMITED per hari — cuma dibatasi berapa nomor boleh diproses dalam satu kali kirim (batch).</blockquote>\n\n` +
    `${E.gem} RAKYAT   → 8 nomor/kirim, unlimited/hari\n` +
    `${E.medal} PEJABAT  → 25 nomor/kirim, unlimited/hari\n` +
    `${E.crown} PRESIDEN → 50 nomor/kirim, unlimited/hari`,
    kb([
      [btn(`${EB.gem} RAKYAT   — 8 nomor/kirim`,   'pkg_RAKYAT',   'primary')],
      [btn(`${EB.medal} PEJABAT  — 25 nomor/kirim`, 'pkg_PEJABAT',  'success')],
      [btn(`${EB.crown} PRESIDEN — 50 nomor/kirim`, 'pkg_PRESIDEN', 'success')],
      [btn(`${EB.back} Kembali`, 'back_main', 'danger')],
    ])
  );
}

async function handlePkgRole(ctx, role) {
  await ctx.answerCbQuery();
  const pkgs = PACKAGES[role];
  await renderScreen(ctx,
    `<h3>${E.rocket} Paket ${role}</h3>\n` +
    `<aside>Pilih durasi aktif yang sesuai budget kamu. Selama aktif: unlimited kirim/hari.</aside>`,
    kb([
      ...pkgs.map(p => [btn(`${EB.cart} ${p.label}`, `buy_${role}_${p.dur}`, 'success')]),
      [btn(`${EB.back} Kembali`, 'upgrade', 'danger')],
    ])
  );
}

async function handleBuyPackage(ctx, role, dur) {
  await ctx.answerCbQuery();
  const pkg = PACKAGES[role]?.find(p => p.dur === Number(dur));
  if (!pkg) return ctx.answerCbQuery('Paket tidak ditemukan', true);

  const qrisUrl = `https://api.pakasir.com/qris?nominal=${pkg.price}&note=KYZ_${role}_${dur}d`;

  await renderScreen(ctx,
    `<h3>${E.card} Order Pembelian</h3>\n` +
    `Paket  : <b>${role} — ${dur} Hari</b>\n` +
    `Harga  : <b>Rp ${pkg.price.toLocaleString('id-ID')}</b>\n\n` +
    `<blockquote>Scan atau klik QRIS untuk membayar. Setelah bayar, kirim bukti ke admin untuk aktivasi.</blockquote>\n\n` +
    `<a href="${qrisUrl}">${E.link} Klik untuk buka QRIS</a>`,
    kb([
      [btnUrl(`${EB.card} Bayar QRIS`, qrisUrl, 'success')],
      [btn(`${EB.home} Menu Utama`, 'back_main', 'primary')],
    ])
  );
}

// ══════════════════════════════════════════════════
//  REFERRAL & REDEEM
// ══════════════════════════════════════════════════

async function handleReferral(ctx) {
  await ctx.answerCbQuery();
  const user    = await getUser(ctx.from.id);
  const botInfo = ctx.botInfo;
  const link    = `https://t.me/${botInfo.username}?start=${user.referral_code}`;

  const roleKey  = hasActiveAccess(user) && COIN_EXCHANGE[user.role] ? user.role : 'FREE';
  const exchange = COIN_EXCHANGE[roleKey];
  const excLines = exchange.map(e => `${E.coin} ${e.coins} koin = <b>${e.dur} hari</b>`).join('\n');

  await renderScreen(ctx,
    `<h3>${E.gift} Program Referral</h3>\n` +
    `${E.link} Link referralmu:\n<code>${link}</code>\n\n` +
    `${E.coin} Koin kamu: <b>${user.coins}</b> &nbsp;|&nbsp; ${E.people} 1 teman = +1 Koin\n\n` +
    `<b>Tukar Koin (level ${roleKey})</b>\n${excLines}\n\n` +
    `Pilih penukaran di bawah:`,
    kb([
      ...exchange.map(e => [btn(
        `${EB.refresh} ${e.coins} Koin → ${e.dur} Hari`,
        `redeem_${e.coins}_${e.dur}`,
        'success'
      )]),
      [btn(`${EB.home} Menu Utama`, 'back_main', 'primary')],
    ])
  );
}

async function handleRedeem(ctx, coins, dur) {
  await ctx.answerCbQuery();
  const cost = parseInt(coins);
  const days = parseInt(dur);
  const user = await getUser(ctx.from.id);

  if (user.coins < cost) {
    return ctx.answerCbQuery(
      `Koin tidak cukup! Kamu punya ${user.coins}, butuh ${cost}.`,
      true
    );
  }

  await spendCoins(user._id, cost, days);

  await renderScreen(ctx,
    `<h3>${E.check} Penukaran Berhasil!</h3>\n` +
    `${E.coin} Digunakan: <b>${cost} koin</b>\n` +
    `${E.date} Aktif: <b>${days} hari</b>`,
    kb([[btn(`${EB.home} Menu Utama`, 'back_main', 'primary')]])
  );
}

// ══════════════════════════════════════════════════
//  PANDUAN — pakai <details> (collapsible), cocok sama fitur rich message baru
// ══════════════════════════════════════════════════

async function handlePanduan(ctx) {
  await ctx.answerCbQuery();
  await renderScreen(ctx,
    `<h2>${E.book} Panduan Bot KYZ</h2>\n\n` +
    `<details><summary>${E.red} 1. Fix Merah (kirim banyak nomor sekaligus)</summary>` +
    `Klik Fix Merah → kirim satu atau BANYAK nomor WA sekaligus (pisahkan dengan baris baru/koma) → konfirmasi → bot kirim email banding otomatis ke support@support.whatsapp.com untuk tiap nomor.</details>\n\n` +
    `<details><summary>${E.up} 2. Upgrade Level</summary>` +
    `Pilih Upgrade Level → pilih paket → bayar via QRIS. Selama masa aktif berjalan, kuota kirim UNLIMITED per hari (cuma dibatasi berapa nomor boleh diproses sekaligus / batch).</details>\n\n` +
    `<details><summary>${E.gift} 3. Referral</summary>` +
    `Bagikan link → tiap teman join = +1 koin → tukar koin untuk tambahan masa aktif gratis.</details>\n\n` +
    `<details><summary>${E.zap} 4. Level &amp; Kuota</summary>` +
    `FREE (tanpa akses aktif): 3 nomor/hari total\n` +
    `${E.gem} RAKYAT (aktif): 8 nomor/kirim, unlimited/hari\n` +
    `${E.medal} PEJABAT (aktif): 25 nomor/kirim, unlimited/hari\n` +
    `${E.crown} PRESIDEN (aktif): 50 nomor/kirim, unlimited/hari</details>\n\n` +
    `<details><summary>${E.phone} 5. Format Nomor</summary>` +
    `<code>+62812xxxxxxxx</code> / <code>62812xxxxxxxx</code> / <code>0812xxxxxxxx</code></details>\n\n` +
    `<details><summary>${E.bell} 6. Notifikasi Balasan</summary>` +
    `Kalau WhatsApp balas email banding kamu, bot otomatis kirim notifikasi ke chat ini.</details>\n\n` +
    `<footer>Ada kendala? Hubungi admin.</footer>`,
    kb([[btn(`${EB.home} Menu Utama`, 'back_main', 'primary')]])
  );
}

module.exports = {
  handleUpgrade, handlePkgRole, handleBuyPackage,
  handleReferral, handleRedeem,
  handlePanduan,
};
