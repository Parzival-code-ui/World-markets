// GET /api/chart?symbol=^NSEI&range=1y
// Price history for the click-to-open chart. Ranges: 1d 5d 1mo 6mo 1y 5y.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const RANGES = {
  "1d": { interval: "5m", ttl: 60 },
  "5d": { interval: "30m", ttl: 120 },
  "1mo": { interval: "1d", ttl: 600 },
  "6mo": { interval: "1d", ttl: 1800 },
  "1y": { interval: "1d", ttl: 1800 },
  "5y": { interval: "1wk", ttl: 3600 },
};

function send(res, code, body, ttl) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  if (ttl) res.setHeader("Cache-Control", `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 5}`);
  res.end(JSON.stringify(body));
}

function mock(symbol, range) {
  const n = { "1d": 78, "5d": 65, "1mo": 22, "6mo": 126, "1y": 252, "5y": 260 }[range];
  const step = { "1d": 300, "5d": 1800, "1mo": 86400, "6mo": 86400, "1y": 86400, "5y": 604800 }[range];
  let h = 0;
  for (const c of symbol + range) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => ((h = (h * 1664525 + 1013904223) >>> 0) / 4294967296);
  const now = Math.floor(Date.now() / 1000);
  let v = 1000 + rnd() * 20000;
  const points = [];
  for (let i = 0; i < n; i++) { v *= 1 + (rnd() - 0.48) * 0.02; points.push([now - (n - i) * step, +v.toFixed(2)]); }
  const cl = points.map((p) => p[1]);
  return { symbol, range, currency: null, tz: "UTC", price: cl[n - 1], prevClose: cl[0],
    dayHigh: Math.max(...cl.slice(-10)), dayLow: Math.min(...cl.slice(-10)),
    high52: Math.max(...cl) * 1.05, low52: Math.min(...cl) * 0.95, points, mock: true };
}

module.exports = async function handler(req, res) {
  const qs = req.query && req.query.symbol != null ? req.query : Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const symbol = String(qs.symbol || "").trim();
  const range = RANGES[qs.range] ? qs.range : "1mo";
  if (!symbol) return send(res, 400, { error: "pass ?symbol=" });
  if (process.env.MOCK === "1") return send(res, 200, mock(symbol, range));

  try {
    const { interval, ttl } = RANGES[range];
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) +
      `?range=${range}&interval=${interval}&includePrePost=false`;
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) return send(res, 502, { error: "HTTP " + r.status });
    const j = await r.json();
    const d = j && j.chart && j.chart.result && j.chart.result[0];
    if (!d || !d.meta) return send(res, 502, { error: "no data" });
    const m = d.meta, ts = d.timestamp || [];
    const close = (d.indicators && d.indicators.quote && d.indicators.quote[0].close) || [];
    const points = [];
    for (let i = 0; i < ts.length; i++) if (close[i] != null) points.push([ts[i], +close[i].toFixed(4)]);
    send(res, 200, {
      symbol, range,
      currency: m.currency || null,
      tz: m.exchangeTimezoneName || "UTC",
      price: m.regularMarketPrice ?? (points.length ? points[points.length - 1][1] : null),
      prevClose: range === "1d" ? (m.chartPreviousClose ?? m.previousClose ?? null) : (points.length ? points[0][1] : null),
      dayHigh: m.regularMarketDayHigh ?? null,
      dayLow: m.regularMarketDayLow ?? null,
      high52: m.fiftyTwoWeekHigh ?? null,
      low52: m.fiftyTwoWeekLow ?? null,
      points,
    }, ttl);
  } catch (e) {
    send(res, 502, { error: String(e.message || e) });
  }
};
