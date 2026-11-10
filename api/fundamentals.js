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
const minor = (cur) => ["GBp", "GBX", "ZAc", "ILA"].includes(cur); // price is in pence/cents

// Share count when Yahoo leaves it blank (as it does for NSE): profit / earnings per share.
function sharesFrom(ks) {
  if (num(ks.sharesOutstanding)) return num(ks.sharesOutstanding);
  if (num(ks.impliedSharesOutstanding)) return num(ks.impliedSharesOutstanding);
  const ni = num(ks.netIncomeToCommon), eps = num(ks.trailingEps);
  return ni && eps && ni > 0 && eps > 0 ? ni / eps : null;
}

// market cap for symbols the quote endpoint left blank
async function fillCaps(out) {
  const missing = Object.keys(out).filter((s) => !out[s].marketCap);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(8, missing.length) }, async () => {
    while (i < missing.length) {
      const s = missing[i++];
      try {
        const j = await yget("https://query2.finance.yahoo.com/v10/finance/quoteSummary/" + encodeURIComponent(s) + "?modules=price,defaultKeyStatistics");
        const r = j.quoteSummary.result[0], p = r.price || {}, sh = sharesFrom(r.defaultKeyStatistics || {});
        const px = num(p.regularMarketPrice);
        if (num(p.marketCap)) out[s].marketCap = num(p.marketCap);
        else if (sh && px) out[s].marketCap = sh * px * (minor(p.currency) ? 0.01 : 1);
      } catch (e) { /* leave it blank */ }
    }
  }));
  return out;
}

// the next results date: Yahoo gives a window (start/end) while it's an estimate, then the confirmed day
function nextResults(q) {
  const now = Date.now() / 1000;
  const cands = [num(q.earningsTimestampStart), num(q.earningsTimestamp), num(q.earningsTimestampEnd)].filter((t) => t && t > now - 86400);
  if (!cands.length) return {};
  return { results: Math.min(...cands), resultsEstimate: !!q.isEarningsDateEstimate || (num(q.earningsTimestampStart) && num(q.earningsTimestampEnd) && num(q.earningsTimestampStart) !== num(q.earningsTimestampEnd)) };
}

async function batch(symbols) {
  const fields = [
    "marketCap", "trailingPE", "forwardPE", "priceToBook", "trailingAnnualDividendYield", "dividendYield",
    "epsTrailingTwelveMonths", "currency", "sharesOutstanding", "regularMarketPrice", "shortName",
    "earningsTimestamp", "earningsTimestampStart", "earningsTimestampEnd", "isEarningsDateEstimate",
  ].join(",");
  const j = await yget("https://query2.finance.yahoo.com/v7/finance/quote?symbols=" + encodeURIComponent(symbols.join(",")) + "&fields=" + fields);
  const out = {};
  for (const q of (j.quoteResponse && j.quoteResponse.result) || []) {
    // dividendYield is already a percent; the trailing figure mixes units for pence-quoted shares
    const dy = num(q.dividendYield) != null ? num(q.dividendYield) : minor(q.currency) ? null : num(q.trailingAnnualDividendYield) != null ? num(q.trailingAnnualDividendYield) * 100 : null;
    // Yahoo leaves market cap blank for some exchanges (NSE among them); rebuild it from shares x price
    let mc = num(q.marketCap);
    if (!mc && num(q.sharesOutstanding) && num(q.regularMarketPrice)) mc = num(q.sharesOutstanding) * num(q.regularMarketPrice) * (minor(q.currency) ? 0.01 : 1);
    out[q.symbol] = {
      currency: realCur(q.currency),
      marketCap: mc,
      pe: num(q.trailingPE),
      fpe: num(q.forwardPE),
      pb: num(q.priceToBook) != null ? num(q.priceToBook) * (minor(q.currency) ? 0.01 : 1) : null,
      divYield: dy,
      eps: num(q.epsTrailingTwelveMonths),
      ...nextResults(q),
    };
  }
  return fillCaps(out);
}

async function detail(symbol) {
  const mods = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile,calendarEvents";
  const j = await yget("https://query2.finance.yahoo.com/v10/finance/quoteSummary/" + encodeURIComponent(symbol) + "?modules=" + mods);
  const r = j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
  if (!r) throw new Error("No fundamentals for " + symbol);
  const p = r.price || {}, sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {}, fd = r.financialData || {}, ap = r.assetProfile || {};
  const ce = (r.calendarEvents && r.calendarEvents.earnings) || {};
  const ed = (ce.earningsDate || []).map(num).filter(Boolean);
  const money = fd.financialCurrency || realCur(p.currency);
  const pctOf = (v) => (num(v) == null ? null : num(v) * 100);
  const desc = ap.longBusinessSummary || "";
  const k = minor(p.currency) ? 0.01 : 1; // ratios built on a pence price need scaling back
  let mc = num(p.marketCap);
  if (!mc && sharesFrom(ks) && num(p.regularMarketPrice)) mc = sharesFrom(ks) * num(p.regularMarketPrice) * k;
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
    marketCap: mc,
    pe: num(sd.trailingPE),
    fpe: num(sd.forwardPE) != null ? num(sd.forwardPE) : num(ks.forwardPE),
    pb: num(ks.priceToBook) != null ? num(ks.priceToBook) * k : null,
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
    target: num(fd.targetMeanPrice) != null ? num(fd.targetMeanPrice) * k : null, // in pounds etc., like the prices
    results: ed.length ? Math.min(...ed) : null,
    resultsEstimate: ed.length > 1 || !!ce.isEarningsDateEstimate,
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
    results: Math.floor(Date.now() / 1000) + Math.floor(r() * 80) * 86400, resultsEstimate: r() > 0.5,
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

// signed-in visitors only (see _auth.js)
const { requireUser } = require("./_auth");

module.exports = requireUser(async function handler(req, res) {
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
});
