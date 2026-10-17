'use strict';

const dns = require('dns');
const { MongoClient } = require('mongodb');
const { srvToStandardUri } = require('./srvFallback');
const CONFIG = require('../../config');

// Prefer IPv4 — banyak VPS/hosting/Termux punya IPv6 rusak sehingga
// koneksi ke Atlas menggantung walau kredensial benar.
try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}

const CLIENT_OPTS = {
  serverSelectionTimeoutMS: 20000,
  connectTimeoutMS: 20000,
  family: 4,
  retryWrites: true,
};

let client = null;
let db = null;
let activeUri = null;

function maskUri(uri) {
  return String(uri).replace(/\/\/([^:@/]+):[^@]*@/, '//$1:****@');
}

/** Terjemahkan error driver jadi petunjuk yang bisa langsung dipakai. */
function serverErrors(err) {
  try {
    const servers = err && err.reason && err.reason.servers;
    if (!servers) return '';
    return [...servers.entries()].map(([h, d]) => `${h}: ${d.error ? d.error.message : 'tanpa error'}`).join(' | ');
  } catch (_) { return ''; }
}

function explainMongoError(err) {
  const msg = String(err && err.message || err);
  if (/tlsv1 alert|ssl3_read_bytes|SSL routines|closed|ECONNRESET|EPIPE/i.test(msg + ' ' + serverErrors(err)))
    return 'Server Atlas MEMUTUS koneksi saat TLS/login (port terbuka tapi ditolak). Penyebab terbanyak: (1) IP publik server belum ada di Atlas → Network Access (coba 0.0.0.0/0 lalu tunggu 1-2 menit status "Active"), (2) cluster M0 sedang PAUSED → Atlas → Database → klik "Resume", (3) user/password salah.';
  if (err.syscall === 'querySrv' || /querySrv/i.test(msg))
    return 'DNS SRV gagal (DNS server hosting kamu memblokir/timeout). Bot akan otomatis pakai DNS-over-HTTPS.';
  if (/Authentication failed|bad auth|AuthenticationFailed/i.test(msg))
    return 'Username/password salah ATAU user belum ada di Atlas → Database Access. Karakter spesial password harus di-encode (# → %23, @ → %40, : → %3A, / → %2F).';
  if (/not authorized|requires authentication/i.test(msg))
    return 'User tidak punya hak ke database ini. Beri role readWrite di Atlas → Database Access.';
  if (/ssl|tls|certificate/i.test(msg))
    return 'Masalah TLS/SSL. Cek jam sistem server & versi Node.js (disarankan 18+).';
  if (/ETIMEDOUT|timed out|ReplicaSetNoPrimary|ECONNRESET/i.test(msg))
    return 'Timeout level jaringan: (1) IP PUBLIK mesin yang menjalankan bot belum ada di Atlas → Network Access (jalankan `node cek-koneksi.js` untuk melihat IP-nya), atau (2) hosting kamu memblokir port 27017 keluar.';
  return null;
}

async function tryConnect(uri) {
  const c = new MongoClient(uri, CLIENT_OPTS);
  try {
    await c.connect();
    // Pastikan benar-benar bisa auth & query, bukan sekadar socket terbuka
    await c.db(CONFIG.MONGO_DB_NAME).command({ ping: 1 });
    return c;
  } catch (e) {
    try { await c.close(); } catch (_) {}
    throw e;
  }
}

/** Urutan percobaan: URI asli → URI standar hasil DoH → MONGO_URI_DIRECT (manual). */
async function connectWithRetry(rounds = 2) {
  let lastErr;
  for (let r = 1; r <= rounds; r++) {
    const candidates = [{ name: 'URI asli', get: async () => CONFIG.MONGO_URI }];

    if (/^mongodb\+srv:/.test(CONFIG.MONGO_URI)) {
      candidates.push({
        name: 'SRV via DNS-over-HTTPS',
        get: async () => srvToStandardUri(CONFIG.MONGO_URI),
      });
    }
    if (CONFIG.MONGO_URI_DIRECT) {
      candidates.push({ name: 'MONGO_URI_DIRECT', get: async () => CONFIG.MONGO_URI_DIRECT });
    }

    for (const cand of candidates) {
      try {
        const uri = await cand.get();
        console.log(`[DB] (${r}/${rounds}) Coba "${cand.name}":`, maskUri(uri));
        client = await tryConnect(uri);
        activeUri = uri;
        console.log(`[DB] Terhubung via "${cand.name}".`);
        return;
      } catch (err) {
        lastErr = err;
        console.error(`[DB] "${cand.name}" gagal: ${err.name}: ${err.message}`);
        const se = serverErrors(err);
        if (se) console.error('[DB] Detail per server: ' + se);
        const hint = explainMongoError(err);
        if (hint) console.error('[DB] Petunjuk: ' + hint);
      }
    }
    if (r < rounds) await new Promise(res => setTimeout(res, 3000));
  }
  console.error('\n[DB] Semua cara gagal. Jalankan:  node cek-koneksi.js  untuk diagnosa lengkap (IP publik, DNS, port 27017).\n');
  throw lastErr;
}

function getDB() {
  if (!db) throw new Error('DB belum di-init — panggil initDB() dulu sebelum query.');
  return db;
}

/**
 * Ambil nomor urut berikutnya (auto-increment) untuk koleksi tertentu.
 * Dipakai supaya email_senders tetap punya ID pendek (#1, #2, dst)
 * walau MongoDB sendiri pakai ObjectId.
 */
async function nextSeq(name) {
  const res = await db.collection('counters').findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );
  // Driver versi berbeda mengembalikan shape sedikit beda (ModifyResult vs dokumen langsung)
  const doc = res && typeof res === 'object' && 'value' in res ? res.value : res;
  return doc.seq;
}

/**
 * Inisialisasi koneksi, index, & seed data awal.
 */
async function initDB() {
  await connectWithRetry();
  db = client.db(CONFIG.MONGO_DB_NAME);

  await Promise.all([
    db.collection('users').createIndex({ referral_code: 1 }, { unique: true, sparse: true }),
    db.collection('fix_history').createIndex({ user_id: 1, created_at: -1 }),
    db.collection('fix_history').createIndex({ email_used: 1, status: 1, notified: 1 }),
    db.collection('email_senders').createIndex({ email: 1 }, { unique: true }),
    db.collection('email_senders').createIndex({ seq: 1 }, { unique: true, sparse: true }),
  ]);

  // Seed template default
  await db.collection('settings').updateOne(
    { _id: 'appeal_template' },
    { $setOnInsert: { value: '+{nomor}' } },
    { upsert: true }
  );

  // Pastikan counter email_senders ada
  await db.collection('counters').updateOne(
    { _id: 'email_senders' },
    { $setOnInsert: { seq: 0 } },
    { upsert: true }
  );

  // Seed email default sekali jika koleksi kosong & bukan placeholder
  if (CONFIG.EMAIL_FROM !== 'bot@gmail.com') {
    const count = await db.collection('email_senders').countDocuments();
    if (count === 0) {
      const seq = await nextSeq('email_senders');
      await db.collection('email_senders').insertOne({
        seq,
        email: CONFIG.EMAIL_FROM,
        password: CONFIG.EMAIL_PASS,
        smtp_host: CONFIG.EMAIL_SMTP,
        smtp_port: CONFIG.EMAIL_PORT,
        imap_host: CONFIG.EMAIL_IMAP || CONFIG.EMAIL_SMTP.replace('smtp.', 'imap.'),
        imap_port: CONFIG.EMAIL_IMAP_PORT || 993,
        label: 'Default',
        active: true,
        total_sent: 0,
        last_used: null,
        created_at: new Date(),
      });
    }
  }

  console.log('[DB] MongoDB terhubung, index & seed siap.');
}

module.exports = { initDB, getDB, nextSeq, getActiveUri: () => activeUri, get client() { return client; } };
