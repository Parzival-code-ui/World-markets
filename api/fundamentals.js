// Company fundamentals from Yahoo Finance.
//   GET /api/fundamentals?symbols=AAPL,MSFT,TCS.NS   valuation snapshot for many stocks (tables)
//   GET /api/fundamentals?symbol=AAPL                full profile for one stock (chart sheet)
// Yahoo's quote endpoints need a session cookie and "crumb" token, fetched once and reused.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const MAX_SYMBOLS = 60;
let session = null; // { cookie, crumb, t }

function cookiesFrom(r) {
  const list = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [r.headers.get("set-cookie") || ""];
  return list.filter(Boolean).map((c) => c.split(";")[0]).join("; ");
}

async function getSession(force) {
  if (session && !force && Date.now() - session.t < 6 * 3600e3) return session;
  let cookie = "";
  for (const u of ["https://fc.yahoo.com/", "https://finance.yahoo.com/quote/AAPL"]) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA }, redirect: "manual" });
      cookie = cookiesFrom(r);
      if (cookie) break;
    } catch (e) { /* try the next one */ }
  }
  if (!cookie) throw new Error("Yahoo session cookie unavailable");
  const r = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: cookie } });
  const crumb = (await r.text()).trim();
  if (!r.ok || !crumb || crumb.length > 40 || crumb.includes("<")) throw new Error("Yahoo crumb unavailable (" + r.status + ")");
  session = { cookie, crumb, t: Date.now() };
  return session;
}

async function yget(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await getSession(attempt > 0);
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "crumb=" + encodeURIComponent(s.crumb), {
      headers: { "User-Agent": UA, Cookie: s.cookie, Accept: "application/json" },
    });
    if (r.status === 401 || r.status === 403) continue;
    if (!r.ok) throw new Error("Yahoo answered " + r.status);
    return r.json();
  }
  throw new Error("Yahoo refused the request");
}

const num = (v) => (v == null ? null : typeof v === "object" ? (v.raw != null ? v.raw : null) : isFinite(v) ? +v : null);
// Yahoo quotes some shares in minor units (London in pence); name the main currency.
const realCur = (cur) => ({ GBp: "GBP", GBX: "GBP", ZAc: "ZAR", ILA: "ILS" }[cur] || cur);

async function batch(symbols) {
  const fields = [
    "marketCap", "trailingPE", "forwardPE", "priceToBook", "trailingAnnualDividendYield", "dividendYield",
    "epsTrailingTwelveMonths", "currency", "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "shortName",
  ].join(",");
  const j = await yget("https://query2.finance.yahoo.com/v7/finance/quote?symbols=" + encodeURIComponent(symbols.join(",")) + "&fields=" + fields);
  const out = {};
  for (const q of (j.quoteResponse && j.quoteResponse.result) || []) {
    const dy = num(q.trailingAnnualDividendYield) != null ? num(q.trailingAnnualDividendYield) * 100 : num(q.dividendYield);
    out[q.symbol] = {
      currency: realCur(q.currency),
      marketCap: num(q.marketCap),
      pe: num(q.trailingPE),
      fpe: num(q.forwardPE),
      pb: num(q.priceToBook),
      divYield: dy,
      eps: num(q.epsTrailingTwelveMonths),
    };
  }
  return out;
}

async function detail(symbol) {
  const mods = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile";
  const j = await yget("https://query2.finance.yahoo.com/v10/finance/quoteSummary/" + encodeURIComponent(symbol) + "?modules=" + mods);
  const r = j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
  if (!r) throw new Error("No fundamentals for " + symbol);
  const p = r.price || {}, sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {}, fd = r.financialData || {}, ap = r.assetProfile || {};
  const money = fd.financialCurrency || realCur(p.currency);
  const pctOf = (v) => (num(v) == null ? null : num(v) * 100);
  const desc = ap.longBusinessSummary || "";
  return {
    symbol,
    name: p.longName || p.shortName || symbol,
    currency: realCur(p.currency),
    reportingCurrency: money,
    sector: ap.sector || null,
    industry: ap.industry || null,
    employees: num(ap.fullTimeEmployees),
    country: ap.country || null,
    website: ap.website || null,
    about: desc.length > 420 ? desc.slice(0, desc.lastIndexOf(" ", 400)) + "…" : desc,
    marketCap: num(p.marketCap),
    pe: num(sd.trailingPE),
    fpe: num(sd.forwardPE) != null ? num(sd.forwardPE) : num(ks.forwardPE),
    pb: num(ks.priceToBook),
    ps: num(sd.priceToSalesTrailing12Months),
    evEbitda: num(ks.enterpriseToEbitda),
    eps: num(ks.trailingEps),
    divYield: pctOf(sd.dividendYield) != null ? pctOf(sd.dividendYield) : pctOf(sd.trailingAnnualDividendYield),
    payout: pctOf(sd.payoutRatio),
    beta: num(sd.beta) != null ? num(sd.beta) : num(ks.beta),
    roe: pctOf(fd.returnOnEquity),
    roa: pctOf(fd.returnOnAssets),
    debtToEquity: num(fd.debtToEquity) != null ? num(fd.debtToEquity) / 100 : null,
    currentRatio: num(fd.currentRatio),
    grossMargin: pctOf(fd.grossMargins),
    operatingMargin: pctOf(fd.operatingMargins),
    profitMargin: pctOf(fd.profitMargins),
    revenueGrowth: pctOf(fd.revenueGrowth),
    earningsGrowth: pctOf(fd.earningsGrowth),
    revenue: num(fd.totalRevenue),
    cash: num(fd.totalCash),
    debt: num(fd.totalDebt),
    freeCashflow: num(fd.freeCashflow),
    rating: fd.recommendationKey && fd.recommendationKey !== "none" ? fd.recommendationKey : null,
    analysts: num(fd.numberOfAnalystOpinions),
    target: num(fd.targetMeanPrice), // same units as the quoted price
  };
}

// Demo mode (MOCK=1): plausible fake numbers so the UI can be tried offline.
function mockOne(symbol, full) {
  let h = 7;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const r = () => ((h = (h * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cur = symbol.endsWith(".NS") ? "INR" : symbol.endsWith(".L") ? "GBP" : symbol.endsWith(".T") ? "JPY" : symbol.endsWith(".HK") ? "HKD" : "USD";
  const o = {
    currency: cur, marketCap: (20 + r() * 3000) * 1e9 * (cur === "INR" ? 83 : cur === "JPY" ? 150 : 1),
    pe: 8 + r() * 50, fpe: 7 + r() * 40, pb: 0.8 + r() * 12, divYield: r() * 4, eps: 2 + r() * 80,
  };
  if (!full) return o;
  return Object.assign(o, {
    symbol, name: symbol.split(".")[0] + " Holdings Ltd", reportingCurrency: cur, sector: "Technology", industry: "Software",
    employees: Math.round(5000 + r() * 200000), country: "Demo", website: "https://example.com",
    about: "Demo company profile. With live data this shows a short description of what the company does, from Yahoo Finance.",
    ps: 1 + r() * 10, evEbitda: 5 + r() * 25, payout: r() * 60, beta: 0.5 + r() * 1.2,
    roe: 5 + r() * 35, roa: 2 + r() * 15, debtToEquity: r() * 1.5, currentRatio: 0.8 + r() * 2,
    grossMargin: 20 + r() * 50, operatingMargin: 8 + r() * 30, profitMargin: 5 + r() * 25,
    revenueGrowth: -5 + r() * 30, earningsGrowth: -10 + r() * 40, revenue: (5 + r() * 300) * 1e9,
    cash: (1 + r() * 60) * 1e9, debt: (1 + r() * 80) * 1e9, freeCashflow: (0.5 + r() * 40) * 1e9,
    rating: ["buy", "hold", "strong_buy"][Math.floor(r() * 3)], analysts: Math.round(5 + r() * 40), target: null,
  });
}

function send(res, code, body, ttl) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  if (ttl) res.setHeader("Cache-Control", `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 6}`);
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  const qs = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const mock = process.env.MOCK === "1";
  try {
    if (qs.symbol) {
      const s = String(qs.symbol).trim();
      return send(res, 200, mock ? mockOne(s, true) : await detail(s), 21600);
    }
    const symbols = [...new Set(String(qs.symbols || "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, MAX_SYMBOLS);
    if (!symbols.length) return send(res, 400, { error: "pass ?symbols=A,B or ?symbol=A" });
    let data;
    if (mock) data = Object.fromEntries(symbols.map((s) => [s, mockOne(s)]));
    else data = await batch(symbols);
    return send(res, 200, { mock, fetchedAt: Date.now(), fundamentals: data }, 3600);
  } catch (e) {
    return send(res, 502, { error: String(e.message || e) });
  }
};
