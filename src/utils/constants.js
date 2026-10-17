'use strict';

/**
 * ROLES — hanya untuk user yang AKSES-nya AKTIF (active_until > sekarang).
 * "batch" = maksimal nomor yang bisa diproses DALAM SATU KALI kirim/command.
 * Selama akses aktif: TIDAK ADA limit harian — cuma dibatasi batch per kirim.
 */
const ROLES = {
  RAKYAT:   { label: 'RAKYAT',   emoji: '💎', batch: 8  },
  PEJABAT:  { label: 'PEJABAT',  emoji: '🏅', batch: 25 },
  PRESIDEN: { label: 'PRESIDEN', emoji: '👑', batch: 50 },
};

// User TANPA akses aktif (baru daftar / akses kadaluarsa):
// dibatasi sekian fix per hari TOTAL — boleh kirim banyak nomor sekaligus
// asal sisa kuota harian masih cukup.
const FREE_DAILY_LIMIT = 3;
const FREE_LABEL = { label: 'FREE', emoji: '🫥' };

const PACKAGES = {
  RAKYAT: [
    { dur: 1,  price: 5000,   label: '1 Hari — Rp 5.000'   },
    { dur: 3,  price: 14000,  label: '3 Hari — Rp 14.000'  },
    { dur: 7,  price: 32000,  label: '7 Hari — Rp 32.000'  },
    { dur: 30, price: 120000, label: '30 Hari — Rp 120.000' },
  ],
  PEJABAT: [
    { dur: 1,  price: 9000,   label: '1 Hari — Rp 9.000'   },
    { dur: 3,  price: 25000,  label: '3 Hari — Rp 25.000'  },
    { dur: 7,  price: 50000,  label: '7 Hari — Rp 50.000'  },
    { dur: 30, price: 200000, label: '30 Hari — Rp 200.000' },
  ],
  PRESIDEN: [
    { dur: 1,  price: 16000,  label: '1 Hari — Rp 16.000'  },
    { dur: 3,  price: 44000,  label: '3 Hari — Rp 44.000'  },
    { dur: 7,  price: 92000,  label: '7 Hari — Rp 92.000'  },
    { dur: 30, price: 336000, label: '30 Hari — Rp 336.000' },
  ],
};

// Tukar koin referral jadi masa aktif (dipakai berdasar role TERAKHIR user,
// fallback FREE kalau tidak punya role aktif/belum pernah upgrade).
const COIN_EXCHANGE = {
  FREE:     [{ coins: 5,  dur: 1 }, { coins: 12, dur: 3 }, { coins: 25, dur: 7 }],
  RAKYAT:   [{ coins: 5,  dur: 1 }, { coins: 12, dur: 3 }, { coins: 25, dur: 7 }],
  PEJABAT:  [{ coins: 10, dur: 1 }, { coins: 25, dur: 3 }, { coins: 50, dur: 7 }],
  PRESIDEN: [{ coins: 20, dur: 1 }, { coins: 50, dur: 3 }, { coins: 100,dur: 7 }],
};

module.exports = { ROLES, FREE_DAILY_LIMIT, FREE_LABEL, PACKAGES, COIN_EXCHANGE };
