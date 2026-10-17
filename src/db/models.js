'use strict';

/**
 * models.js — semua query MongoDB:
 *   - users (+ logic kuota akses)
 *   - fix_history (+ notifikasi balasan WA)
 *   - email_senders
 *   - settings
 */

const { ObjectId } = require('mongodb');
const { getDB, nextSeq } = require('./database');
const { ROLES, FREE_DAILY_LIMIT } = require('../utils/constants');

// ══════════════════════════════════════════════════
//  USERS
// ══════════════════════════════════════════════════

async function getUser(id) {
  return getDB().collection('users').findOne({ _id: id });
}

async function upsertUser(ctx) {
  const db = getDB();
  const { id, username, first_name, last_name } = ctx.from;
  const full_name = [first_name, last_name].filter(Boolean).join(' ');
  const code = `REF${id}`;

  await db.collection('users').updateOne(
    { _id: id },
    {
      $set: { username: username || '', full_name },
      $setOnInsert: {
        role: 'FREE',
        coins: 0,
        active_until: null,
        total_fix: 0,
        total_success: 0,
        referral_code: code,
        referred_by: null,
        created_at: new Date(),
      },
    },
    { upsert: true }
  );

  return getUser(id);
}

async function getUserByReferralCode(code) {
  return getDB().collection('users').findOne({ referral_code: code });
}

async function countTodayFix(userId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return getDB().collection('fix_history').countDocuments({
    user_id: userId,
    created_at: { $gte: start },
  });
}

async function recordFix(userId, phone, status, emailUsed) {
  const db = getDB();
  const doc = {
    user_id: userId,
    phone,
    status,
    email_used: emailUsed || null,
    notified: false,
    reply_snippet: null,
    replied_at: null,
    created_at: new Date(),
  };
  const { insertedId } = await db.collection('fix_history').insertOne(doc);

  const inc = { total_fix: 1 };
  if (status === 'success') inc.total_success = 1;
  await db.collection('users').updateOne({ _id: userId }, { $inc: inc });

  return insertedId;
}

async function getHistory(userId, limit = 10) {
  return getDB().collection('fix_history')
    .find({ user_id: userId })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
}

/**
 * Set role + (opsional) masa aktif eksplisit. Dipakai owner via /set_role.
 * @param {Date|null} activeUntil null = tidak diubah, Date = set eksplisit
 */
async function setRole(userId, role, activeUntil) {
  const update = { $set: { role } };
  if (activeUntil !== undefined) update.$set.active_until = activeUntil;
  await getDB().collection('users').updateOne({ _id: userId }, update);
}

/**
 * Tukar koin jadi tambahan masa aktif. Kalau user masih punya sisa masa
 * aktif, ditambahkan dari situ (bukan dari sekarang) — jadi tidak hangus.
 */
async function spendCoins(userId, costCoins, days) {
  const db = getDB();
  const user = await getUser(userId);
  const now = new Date();
  const base = (user.active_until && new Date(user.active_until) > now)
    ? new Date(user.active_until)
    : now;
  const newUntil = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

  await db.collection('users').updateOne(
    { _id: userId },
    { $inc: { coins: -costCoins }, $set: { active_until: newUntil } }
  );
}

async function addCoins(userId, amount) {
  await getDB().collection('users').updateOne({ _id: userId }, { $inc: { coins: amount } });
}

async function setReferral(userId, referrerId) {
  await getDB().collection('users').updateOne(
    { _id: userId, referred_by: null },
    { $set: { referred_by: referrerId } }
  );
}

// ══════════════════════════════════════════════════
//  KUOTA — akses aktif = unlimited (dibatasi batch/kirim),
//  tanpa akses = limit harian FREE_DAILY_LIMIT
// ══════════════════════════════════════════════════

function hasActiveAccess(user) {
  return !!(user.active_until && new Date(user.active_until) > new Date());
}

/**
 * @returns {{unlimited: boolean, maxPerSubmit: number, dailyCap: number|null}}
 */
function getQuota(user) {
  if (hasActiveAccess(user) && ROLES[user.role]) {
    return { unlimited: true, maxPerSubmit: ROLES[user.role].batch, dailyCap: null };
  }
  return { unlimited: false, maxPerSubmit: FREE_DAILY_LIMIT, dailyCap: FREE_DAILY_LIMIT };
}

// ══════════════════════════════════════════════════
//  FIX HISTORY — notifikasi balasan WhatsApp
// ══════════════════════════════════════════════════

async function getPendingNotify(senderEmail) {
  return getDB().collection('fix_history').find({
    email_used: senderEmail, status: 'success', notified: false,
  }).sort({ created_at: -1 }).toArray();
}

async function markNotified(id, replySnippet) {
  const _id = typeof id === 'string' ? new ObjectId(id) : id;
  await getDB().collection('fix_history').updateOne(
    { _id },
    { $set: { notified: true, reply_snippet: replySnippet || null, replied_at: new Date() } }
  );
}

// ══════════════════════════════════════════════════
//  EMAIL SENDERS (id pendek via counter, bukan ObjectId)
// ══════════════════════════════════════════════════

async function listSenders() {
  return getDB().collection('email_senders').find({}).sort({ seq: 1 }).toArray();
}

async function getActiveSenders() {
  return getDB().collection('email_senders')
    .find({ active: true })
    .sort({ last_used: 1, seq: 1 }) // null last_used (belum pernah dipakai) muncul duluan
    .toArray();
}

async function addSender({ email, password, smtp_host, smtp_port, imap_host, imap_port, label }) {
  const db = getDB();
  const existing = await db.collection('email_senders').findOne({ email });
  if (existing) return false;

  const host = smtp_host || 'smtp.gmail.com';
  const seq = await nextSeq('email_senders');
  await db.collection('email_senders').insertOne({
    seq, email, password,
    smtp_host: host,
    smtp_port: smtp_port || 587,
    imap_host: imap_host || host.replace('smtp.', 'imap.'),
    imap_port: imap_port || 993,
    label: label || '',
    active: true,
    total_sent: 0,
    last_used: null,
    created_at: new Date(),
  });
  return true;
}

async function deleteSender(seq) {
  const { deletedCount } = await getDB().collection('email_senders').deleteOne({ seq });
  return deletedCount > 0;
}

async function toggleSender(seq, active) {
  await getDB().collection('email_senders').updateOne({ seq }, { $set: { active } });
}

/**
 * Tandai sender sudah DICOBA (last_used selalu update, sukses/gagal),
 * supaya round-robin tetap adil. total_sent cuma naik kalau benar sukses.
 */
async function markAttempt(seq, success) {
  const update = { $set: { last_used: new Date() } };
  if (success) update.$inc = { total_sent: 1 };
  await getDB().collection('email_senders').updateOne({ seq }, update);
}

async function setImapConfig(seq, imapHost, imapPort) {
  await getDB().collection('email_senders').updateOne(
    { seq }, { $set: { imap_host: imapHost, imap_port: imapPort } }
  );
}

async function getSenderById(seq) {
  return getDB().collection('email_senders').findOne({ seq });
}

async function poolStats() {
  const db = getDB();
  const [total, active, agg] = await Promise.all([
    db.collection('email_senders').countDocuments(),
    db.collection('email_senders').countDocuments({ active: true }),
    db.collection('email_senders').aggregate([
      { $group: { _id: null, total_sent: { $sum: '$total_sent' } } },
    ]).toArray(),
  ]);
  return { total, active, total_sent: agg[0]?.total_sent || 0 };
}

// ══════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════

async function getSetting(key) {
  const doc = await getDB().collection('settings').findOne({ _id: key });
  return doc?.value ?? null;
}

async function setSetting(key, value) {
  await getDB().collection('settings').updateOne(
    { _id: key }, { $set: { value } }, { upsert: true }
  );
}

// ══════════════════════════════════════════════════
//  STATS (global)
// ══════════════════════════════════════════════════

async function globalStats() {
  const db = getDB();
  const [agg, pool] = await Promise.all([
    db.collection('users').aggregate([
      { $group: {
          _id: null,
          total_users: { $sum: 1 },
          started: { $sum: { $cond: [{ $gt: ['$total_fix', 0] }, 1, 0] } },
          total_fix: { $sum: '$total_fix' },
          total_success: { $sum: '$total_success' },
      } },
    ]).toArray(),
    poolStats(),
  ]);
  const a = agg[0] || { total_users: 0, started: 0, total_fix: 0, total_success: 0 };
  return { ...a, pool };
}

async function leaderboard() {
  return getDB().collection('users')
    .find({})
    .sort({ total_success: -1 })
    .limit(10)
    .toArray();
}

module.exports = {
  // users
  getUser, upsertUser, getUserByReferralCode, countTodayFix, recordFix,
  getHistory, setRole, spendCoins, addCoins, setReferral,
  // kuota
  hasActiveAccess, getQuota,
  // fix_history notify
  getPendingNotify, markNotified,
  // email_senders
  listSenders, getActiveSenders, addSender, deleteSender,
  toggleSender, markAttempt, setImapConfig, getSenderById, poolStats,
  // settings
  getSetting, setSetting,
  // stats
  globalStats, leaderboard,
};
