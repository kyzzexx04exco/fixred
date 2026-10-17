'use strict';

/**
 * Ubah URI mongodb+srv:// jadi URI standar mongodb://host1,host2,host3
 * dengan resolve SRV/TXT lewat DNS-over-HTTPS (port 443).
 *
 * Kenapa: banyak hosting/VPS/ISP memblokir/men-timeout DNS UDP untuk query SRV
 * (error "querySrv ETIMEDOUT"/"ECONNREFUSED"), padahal HTTPS normal jalan.
 */

const DOH_ENDPOINTS = [
  'https://dns.google/resolve',
  'https://cloudflare-dns.com/dns-query',
];

function parseSrvUri(uri) {
  const m = /^mongodb\+srv:\/\/(?:([^:@/]+):([^@]*)@)?([^/?]+)\/?([^?]*)\??(.*)$/.exec(uri);
  if (!m) return null;
  return { user: m[1], pass: m[2], host: m[3], db: m[4] || '', query: m[5] || '' };
}

async function dohQuery(name, type, fetchImpl = globalThis.fetch) {
  let lastErr;
  for (const base of DOH_ENDPOINTS) {
    try {
      const res = await fetchImpl(`${base}?name=${encodeURIComponent(name)}&type=${type}`, {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      return json.Answer || [];
    } catch (e) { lastErr = e; }
  }
  throw new Error('DoH gagal: ' + (lastErr && lastErr.message));
}

async function srvToStandardUri(uri, fetchImpl) {
  const p = parseSrvUri(uri);
  if (!p) throw new Error('Bukan URI mongodb+srv:// yang valid');

  const [srv, txt] = await Promise.all([
    dohQuery(`_mongodb._tcp.${p.host}`, 'SRV', fetchImpl),
    dohQuery(p.host, 'TXT', fetchImpl).catch(() => []),
  ]);

  const hosts = srv
    .filter(a => a.type === 33 || /^\d+ \d+ \d+ /.test(a.data))
    .map(a => a.data.trim().split(/\s+/))
    .map(([, , port, target]) => `${target.replace(/\.$/, '')}:${port}`);
  if (!hosts.length) throw new Error('SRV record kosong untuk ' + p.host);

  // TXT berisi authSource & replicaSet (kadang dipotong jadi beberapa string ber-quote)
  const txtOpts = txt.map(a => String(a.data).replace(/"\s*"/g, '').replace(/^"|"$/g, '')).join('&');

  const params = new URLSearchParams(txtOpts);
  new URLSearchParams(p.query).forEach((v, k) => params.set(k, v));
  if (!params.has('tls') && !params.has('ssl')) params.set('tls', 'true');

  const auth = p.user ? `${p.user}:${p.pass}@` : '';
  return `mongodb://${auth}${hosts.join(',')}/${p.db}?${params.toString()}`;
}

module.exports = { parseSrvUri, dohQuery, srvToStandardUri };
