// Serverless quote proxy (Vercel / any Node host).
// GET /api/quotes?symbols=^GSPC,^NSEI,INR=X
// Fetches each symbol from Yahoo Finance's public chart endpoint (no key needed),
// normalises it, and lets the CDN cache the response for 60s.

const MAX_SYMBOLS = 200;
const CONCURRENCY = 12;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function dayKey(tsSec, gmtoffset) {
  return Math.floor((tsSec + (gmtoffset || 0)) / 86400);
}

async function fetchOne(symbol) {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) +
    "?range=1mo&interval=1d&includePrePost=false";
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.meta) throw new Error("no data");
  const m = res.meta;
  const ts = res.timestamp || [];
  const raw = (res.indicators && res.indicators.quote && res.indicators.quote[0].close) || [];
  const bars = [];
  for (let i = 0; i < ts.length; i++) if (raw[i] != null) bars.push([ts[i], raw[i]]);

  let price = m.regularMarketPrice != null ? m.regularMarketPrice : bars.length ? bars[bars.length - 1][1] : null;
  const t = m.regularMarketTime || (bars.length ? bars[bars.length - 1][0] : null);

  // Previous close = last daily close from a day before the latest trade's day.
  let prev = null;
  if (bars.length && t) {
    const today = dayKey(t, m.gmtoffset);
    for (let i = bars.length - 1; i >= 0; i--) {
      if (dayKey(bars[i][0], m.gmtoffset) < today) { prev = bars[i][1]; break; }
    }
  }
  if (prev == null) prev = m.previousClose != null ? m.previousClose : null;
  let first = bars.length ? bars[0][1] : null;

  // London shares come in pence, US grains in cents and so on: hand back pounds, dollars...
  const k = MINOR[m.currency] ? 0.01 : 1;
  const sc = (v) => (v == null ? null : +(v * k).toFixed(6));
  if (k !== 1) { price = sc(price); prev = sc(prev); first = sc(first); bars.forEach((b) => (b[1] = b[1] * k)); }
  return {
    symbol,
    price,
    prevClose: prev,
    change: price != null && prev != null ? price - prev : null,
    changePct: price != null && prev ? ((price - prev) / prev) * 100 : null,
    change1mPct: price != null && first ? ((price - first) / first) * 100 : null,
    currency: MINOR[m.currency] || m.currency || null,
    time: t,
    spark: bars.map((b) => +b[1].toFixed(6)),
  };
}

// Yahoo's minor-unit currencies and the main currency they belong to
const MINOR = { GBp: "GBP", GBX: "GBP", USX: "USD", ZAc: "ZAR", ILA: "ILS" };

// Demo mode (MOCK=1): deterministic fake prices so the UI can be tried offline.
function mockOne(symbol) {
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => ((h = (h * 1664525 + 1013904223) >>> 0) / 4294967296);
  const base = symbol.endsWith("=X") ? 0.5 + rnd() * 150 : 500 + rnd() * 40000;
  const spark = [base];
  for (let i = 1; i < 22; i++) spark.push(spark[i - 1] * (1 + (rnd() - 0.5) * 0.03));
  const price = spark[21], prev = spark[20];
  return {
    symbol, price, prevClose: prev, change: price - prev,
    changePct: ((price - prev) / prev) * 100,
    change1mPct: ((price - spark[0]) / spark[0]) * 100,
    currency: null, time: Math.floor(Date.now() / 1000), spark,
  };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); }
      catch (e) { out[k] = { symbol: items[k], error: String(e.message || e) }; }
    }
  });
  await Promise.all(workers);
  return out;
}

module.exports = async function handler(req, res) {
  const q = req.query && req.query.symbols != null
    ? req.query.symbols
    : new URL(req.url, "http://x").searchParams.get("symbols");
  const symbols = [...new Set(String(q || "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, MAX_SYMBOLS);
  if (!symbols.length) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "pass ?symbols=A,B,C" }));
  }
  const mock = process.env.MOCK === "1";
  const list = mock ? symbols.map(mockOne) : await pool(symbols, CONCURRENCY, fetchOne);
  const quotes = {};
  for (const x of list) quotes[x.symbol] = x;

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  res.end(JSON.stringify({ mock, fetchedAt: Date.now(), quotes }));
};
