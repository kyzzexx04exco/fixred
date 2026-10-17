'use strict';
/**
 * Diagnosa koneksi MongoDB Atlas.  Jalankan:  node cek-koneksi.js
 * Tidak butuh paket tambahan. Menunjukkan di langkah mana koneksi putus.
 */
const dns = require('dns').promises;
const net = require('net');
const CONFIG = require('./config');
const { parseSrvUri, dohQuery } = require('./src/db/srvFallback');

const ok = m => console.log('  ✅ ' + m);
const bad = m => console.log('  ❌ ' + m);

function tcp(host, port, ms = 8000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const s = net.connect({ host, port, family: 4 });
    const done = r => { s.destroy(); resolve(r); };
    s.setTimeout(ms, () => done({ ok: false, err: 'TIMEOUT ' + ms + 'ms' }));
    s.on('connect', () => done({ ok: true, ms: Date.now() - t0 }));
    s.on('error', e => done({ ok: false, err: e.code || e.message }));
  });
}

(async () => {
  console.log('\n[1] IP publik mesin ini (whitelist IP INI di Atlas → Network Access):');
  try {
    const ip = await (await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(8000) })).text();
    ok(ip);
  } catch (e) { bad('tidak bisa cek IP publik: ' + e.message); }

  const p = parseSrvUri(CONFIG.MONGO_URI);
  let hosts = [];
  if (!p) {
    console.log('\nURI bukan mongodb+srv, cek langsung host di URI.');
    const m = /@([^/?]+)/.exec(CONFIG.MONGO_URI);
    hosts = m ? m[1].split(',') : [];
  } else {
    console.log(`\n[2] DNS SRV via DNS sistem (_mongodb._tcp.${p.host}):`);
    try {
      const r = await dns.resolveSrv('_mongodb._tcp.' + p.host);
      ok(r.map(x => `${x.name}:${x.port}`).join(', '));
      hosts = r.map(x => `${x.name}:${x.port}`);
    } catch (e) { bad(`${e.code || e.message}  → DNS hosting kamu bermasalah (bot otomatis pakai DoH)`); }

    console.log('\n[3] DNS SRV via DNS-over-HTTPS:');
    try {
      const r = await dohQuery('_mongodb._tcp.' + p.host, 'SRV');
      const h = r.map(a => { const [, , port, t] = a.data.trim().split(/\s+/); return `${t.replace(/\.$/, '')}:${port}`; });
      ok(h.join(', '));
      if (!hosts.length) hosts = h;
    } catch (e) { bad(e.message); }
  }

  console.log('\n[4] Koneksi TCP ke server Atlas (port 27017):');
  let anyOk = false;
  for (const h of hosts) {
    const [host, port] = h.split(':');
    const r = await tcp(host, Number(port || 27017));
    if (r.ok) { ok(`${h} terbuka (${r.ms}ms)`); anyOk = true; } else bad(`${h} → ${r.err}`);
  }

  console.log('\n[5] Tes LOGIN sungguhan (driver MongoDB + ping):');
  try {
    const { MongoClient } = require('mongodb');
    const { srvToStandardUri } = require('./src/db/srvFallback');
    let uri = CONFIG.MONGO_URI;
    if (/^mongodb\+srv:/.test(uri) && !hosts.length) uri = await srvToStandardUri(uri);
    const c = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, family: 4 });
    try { await c.connect(); await c.db(CONFIG.MONGO_DB_NAME).command({ ping: 1 }); ok('LOGIN BERHASIL — database bisa dipakai'); }
    catch (e) {
      bad(e.name + ': ' + e.message);
      const sv = e.reason && e.reason.servers;
      if (sv) for (const [h, d] of sv.entries()) console.log('     · ' + h + ' → ' + (d.error ? d.error.message : '-'));
    } finally { try { await c.close(); } catch (_) {} }
  } catch (e) { bad('paket mongodb belum terpasang? jalankan: npm install  (' + e.message + ')'); }

  console.log('\n[Kesimpulan]');
  if (!hosts.length) console.log('  Tidak ada host ditemukan: cek nama cluster di MONGO_URI.');
  else if (anyOk) console.log('  Jaringan OK. Kalau bot masih gagal → cek username/password & role user di Atlas → Database Access, atau IP belum di-whitelist (Atlas diam-diam menolak IP asing, kelihatannya seperti timeout).');
  else console.log('  Port 27017 tidak bisa dijangkau dari mesin ini. Dua kemungkinan:\n   (a) IP publik di atas belum ada di Atlas → Network Access (untuk tes: Add IP 0.0.0.0/0), ATAU\n   (b) hosting/ISP memblokir port 27017 keluar → pindah hosting/VPS, atau pakai VPN/MongoDB lokal.');
  console.log('');
})();
