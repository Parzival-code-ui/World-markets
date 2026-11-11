// GET /api/returns?symbols=^NSEI,^GSPC,INR=X
// Price changes over longer periods for each symbol: 1 month, year to date, 1, 3 and 5 years.
// Each value is a fraction (0.12 = +12%), from daily closes over the last five years and a bit.
// Cached for six hours: these numbers barely move within a day.

// approved accounts only, with a per-visitor rate limit (see _auth.js)
const { limited, requireUser } = require("./_auth");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const MAX = 80;
const TTL = 6 * 3600;

function send(res, code, body, ttl) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", ttl ? `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 4}` : "no-store");
  res.end(JSON.stringify(body));
}

// close on a date or the last trading day before it; points are [epochSec, close] sorted by time
function closeOnOrBefore(pts, t) {
  let lo = 0, hi = pts.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] <= t) { best = pts[mid][1]; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}
const ago = (t, { y = 0, m = 0 }) => { const d = new Date(t * 1000); d.setUTCFullYear(d.getUTCFullYear() - y, d.getUTCMonth() - m); return Math.floor(d / 1000); };

function returnsFrom(pts) {
  if (pts.length < 2) return null;
  const [tLast, last] = pts[pts.length - 1];
  const r = (from) => (from ? last / from - 1 : null);
  const first = pts[0][0];
  // only report a period the history really covers (allowing a week's slack for holidays)
  const covered = (t) => t >= first - 7 * 86400;
  const at = (t) => (covered(t) ? closeOnOrBefore(pts, t) : null);
  const yearStart = Math.floor(Date.UTC(new Date(tLast * 1000).getUTCFullYear(), 0, 1) / 1000) - 1;
  return {
    last, asOf: tLast,
    m1: r(at(ago(tLast, { m: 1 }))),
    ytd: r(at(yearStart)),
    y1: r(at(ago(tLast, { y: 1 }))),
    y3: r(at(ago(tLast, { y: 3 }))),
    y5: r(at(ago(tLast, { y: 5 }))),
  };
}

async function one(symbol) {
  const now = Math.floor(Date.now() / 1000);
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) +
    `?period1=${now - (5 * 366 + 10) * 86400}&period2=${now + 86400}&interval=1d&includePrePost=false`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) return null;
  const j = await r.json();
  const d = j && j.chart && j.chart.result && j.chart.result[0];
  if (!d) return null;
  const ts = d.timestamp || [], cl = (d.indicators && d.indicators.quote && d.indicators.quote[0].close) || [];
  const pts = [];
  for (let i = 0; i < ts.length; i++) if (cl[i] != null) pts.push([ts[i], cl[i]]);
  const out = returnsFrom(pts);
  if (out) out.currency = (d.meta && d.meta.currency) || null;
  return out;
}

function mock(symbol) {
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const r = (k) => (((h >> k) % 1000) / 1000 - 0.35) * 0.6;
  return { last: 100, asOf: Math.floor(Date.now() / 1000), m1: r(1) / 6, ytd: r(3) / 2, y1: r(5) / 1.5, y3: r(7) * 1.4, y5: r(9) * 2, currency: null, mock: true };
}

module.exports = requireUser(limited(async function handler(req, res) {
  const u = new URL(req.url, "http://localhost");
  const list = [...new Set((u.searchParams.get("symbols") || "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (!list.length) return send(res, 400, { error: "symbols required" });
  if (list.length > MAX || list.some((s) => s.length > 30)) return send(res, 400, { error: `up to ${MAX} symbols` });
  if (process.env.MOCK === "1") return send(res, 200, { returns: Object.fromEntries(list.map((s) => [s, mock(s)])), mock: true }, 60);
  const out = {};
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(10, list.length) }, async () => {
    while (i < list.length) {
      const s = list[i++];
      try { out[s] = await one(s); } catch (e) { out[s] = null; }
    }
  }));
  send(res, 200, { returns: out }, Object.values(out).some(Boolean) ? TTL : 60);
}, 30), 21600);

module.exports.returnsFrom = returnsFrom;
