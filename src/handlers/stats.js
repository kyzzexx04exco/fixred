'use strict';

const { globalStats, leaderboard, getHistory } = require('../db/models');
const { escHtml, E, EB, btn, kb, renderScreen } = require('../utils/helpers');
const { kvTable } = require('../utils/richMessage');

const backRow = () => kb([[btn(`${EB.home} Menu Utama`, 'back_main', 'primary')]]);

async function handleStatistik(ctx) {
  await ctx.answerCbQuery();
  const s   = await globalStats();
  const pct = s.total_fix > 0
    ? ((s.total_success / s.total_fix) * 100).toFixed(1)
    : '0.0';

  await renderScreen(ctx,
    `<h3>${E.chartG} Statistik Global</h3>\n` +
    `<h4>${E.people} Pengguna</h4>\n` +
    kvTable([
      ['Total User',  String(s.total_users)],
      ['Sudah Pakai', String(s.started)],
    ]) +
    `\n<h4>${E.red} Fix Merah</h4>\n` +
    kvTable([
      ['Total Kirim',  String(s.total_fix)],
      ['Total Sukses', String(s.total_success)],
      ['Persentase',   `${pct}%`],
    ]) +
    `\n<h4>${E.mail} Email Sender Pool</h4>\n` +
    kvTable([
      ['Total Sender', String(s.pool.total)],
      ['Aktif',        String(s.pool.active)],
      ['Total Kirim',  String(s.pool.total_sent)],
    ]),
    backRow()
  );
}

async function handleLeaderboard(ctx) {
  await ctx.answerCbQuery();
  const rows   = await leaderboard();
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

  const lines = rows.length
    ? rows.map((r, i) => {
        const name = escHtml(r.full_name || r.username || `User${i + 1}`);
        const pct  = r.total_fix > 0
          ? ((r.total_success / r.total_fix) * 100).toFixed(0)
          : 0;
        return `${medals[i]} <b>${name}</b> — ${E.check} ${r.total_success} sukses · ${E.rocket} ${pct}%`;
      }).join('\n')
    : '<i>Belum ada data.</i>';

  await renderScreen(ctx,
    `<h3>${E.trophy} Leaderboard Fix Merah</h3>\n` +
    `<aside>Top 10 pengguna terbaik</aside>\n\n` +
    lines,
    backRow()
  );
}

async function handleRiwayat(ctx) {
  await ctx.answerCbQuery();
  const rows = await getHistory(ctx.from.id);

  const lines = rows.length
    ? rows.map(r => {
        const ico = r.status === 'success' ? E.check : E.cross;
        const via = r.email_used ? ` via ${escHtml(r.email_used)}` : '';
        const ts  = new Date(r.created_at).toLocaleString('id-ID');
        const nt  = r.notified ? ` ${E.bell}` : '';
        return `${ico} <code>+${r.phone}</code>${via}${nt}\n<i>${ts}</i>`;
      }).join('\n\n')
    : '<i>Belum ada riwayat.</i>';

  await renderScreen(ctx,
    `<h3>${E.list} Riwayat Fix Merah</h3>\n` +
    `<aside>10 pengiriman terakhir</aside>\n\n` +
    lines,
    backRow()
  );
}

module.exports = { handleStatistik, handleLeaderboard, handleRiwayat };
