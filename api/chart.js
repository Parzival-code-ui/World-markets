// GET /api/chart?symbol=^NSEI&range=1y
// Price history for the click-to-open chart. Ranges: 1d 5d 1mo 6mo 1y 5y.
// Each point is [time, close, volume]. Daily ranges also carry 50- and 200-day moving averages,
// worked out from extra history before the range starts so the lines run the full width.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const DAY = 86400;
const RANGES = {
  "1d": { interval: "5m", ttl: 60 },
  "5d": { interval: "30m", ttl: 120 },
  "1mo": { interval: "1d", ttl: 600, days: 31 },
  "6mo": { interval: "1d", ttl: 1800, days: 183 },
  "1y": { interval: "1d", ttl: 1800, days: 366 },
  "5y": { interval: "1d", ttl: 3600, days: 1827 },
};
const LOOKBACK = 300; // calendar days, comfortably more than 200 trading days

function send(res, code, body, ttl) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  if (ttl) res.setHeader("Cache-Control", `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 5}`);
  res.end(JSON.stringify(body));
}

// simple moving average over closes; null until there are n values
function sma(cl, n) {
  const out = new Array(cl.length).fill(null);
  let sum = 0;
  for (let i = 0; i < cl.length; i++) {
    sum += cl[i];
    if (i >= n) sum -= cl[i - n];
    if (i >= n - 1) out[i] = +(sum / n).toFixed(4);
  }
  return out;
}

// cut the lookback off again, keeping averages aligned with the visible points
function finish(all, range) {
  const cl = all.map((p) => p[1]);
  const cfg = RANGES[range];
  if (!cfg.days) return { points: all, ma50: null, ma200: null };
  const s50 = sma(cl, 50), s200 = sma(cl, 200);
  const start = Math.floor(Date.now() / 1000) - cfg.days * DAY;
  let k = all.findIndex((p) => p[0] >= start);
  if (k < 0) k = 0;
  const has200 = s200.some((v) => v != null);
  return { points: all.slice(k), ma50: s50.slice(k), ma200: has200 ? s200.slice(k) : null };
}

function mock(symbol, range) {
  const cfg = RANGES[range];
  const step = { "1d": 300, "5d": 1800 }[range] || DAY;
  const n = cfg.days ? Math.round((cfg.days + LOOKBACK) * 5 / 7) : { "1d": 78, "5d": 65 }[range];
  let h = 0;
  for (const c of symbol + range) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => ((h = (h * 1664525 + 1013904223) >>> 0) / 4294967296);
  const now = Math.floor(Date.now() / 1000);
  let v = 1000 + rnd() * 20000;
  const all = [];
  for (let i = 0; i < n; i++) {
    v *= 1 + (rnd() - 0.48) * 0.02;
    all.push([now - Math.round((n - i) * step * (cfg.days ? 7 / 5 : 1)), +v.toFixed(2), Math.round(1e6 + rnd() * 4e6)]);
  }
  const f = finish(all, range);
  const cl = f.points.map((p) => p[1]);
  return { symbol, range, name: null, currency: null, tz: "UTC", price: cl[cl.length - 1], prevClose: cl[0],
    dayHigh: Math.max(...cl.slice(-10)), dayLow: Math.min(...cl.slice(-10)),
    high52: Math.max(...cl) * 1.05, low52: Math.min(...cl) * 0.95, ...f, mock: true };
}

// signed-in visitors only (see _auth.js)
const { requireUser } = require("./_auth");

module.exports = requireUser(async function handler(req, res) {
  const qs = req.query && req.query.symbol != null ? req.query : Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const symbol = String(qs.symbol || "").trim();
  const range = RANGES[qs.range] ? qs.range : "1mo";
  if (!symbol) return send(res, 400, { error: "pass ?symbol=" });
  if (process.env.MOCK === "1") return send(res, 200, mock(symbol, range));

  try {
    const { interval, ttl, days } = RANGES[range];
    const now = Math.floor(Date.now() / 1000);
    const span = days ? `period1=${now - (days + LOOKBACK) * DAY}&period2=${now + DAY}` : `range=${range}`;
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) +
      `?${span}&interval=${interval}&includePrePost=false`;
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) return send(res, r.status === 404 ? 404 : 502, { error: r.status === 404 ? "Yahoo Finance doesn't know this symbol" : "HTTP " + r.status });
    const j = await r.json();
    const d = j && j.chart && j.chart.result && j.chart.result[0];
    if (!d || !d.meta) return send(res, 502, { error: "no data" });
    const m = d.meta, ts = d.timestamp || [];
    const q = (d.indicators && d.indicators.quote && d.indicators.quote[0]) || {};
    const close = q.close || [], vol = q.volume || [];
    const all = [];
    for (let i = 0; i < ts.length; i++) if (close[i] != null) all.push([ts[i], +close[i].toFixed(4), vol[i] || 0]);
    const f = finish(all, range);
    const pts = f.points;
    send(res, 200, {
      symbol, range,
      name: m.longName || m.shortName || null,
      exchange: m.fullExchangeName || m.exchangeName || null,
      type: m.instrumentType || null,
      currency: m.currency || null,
      tz: m.exchangeTimezoneName || "UTC",
      price: m.regularMarketPrice ?? (pts.length ? pts[pts.length - 1][1] : null),
      prevClose: range === "1d" ? (m.chartPreviousClose ?? m.previousClose ?? null) : (pts.length ? pts[0][1] : null),
      dayHigh: m.regularMarketDayHigh ?? null,
      dayLow: m.regularMarketDayLow ?? null,
      high52: m.fiftyTwoWeekHigh ?? null,
      low52: m.fiftyTwoWeekLow ?? null,
      ...f,
    }, ttl);
  } catch (e) {
    send(res, 502, { error: String(e.message || e) });
  }
});
