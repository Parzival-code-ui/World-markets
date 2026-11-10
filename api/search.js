// GET /api/search?q=paytm
// Finds any listed company, fund, index, currency or crypto on Yahoo Finance, for the search box.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const TYPES = { EQUITY: "Stock", ETF: "ETF", INDEX: "Index", MUTUALFUND: "Fund", CURRENCY: "Currency", CRYPTOCURRENCY: "Crypto", FUTURE: "Futures" };

function send(res, code, body, ttl) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  if (ttl) res.setHeader("Cache-Control", `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 6}`);
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  const qs = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const q = String(qs.q || "").trim().slice(0, 60);
  if (q.length < 2) return send(res, 400, { error: "type at least 2 characters" });
  if (process.env.MOCK === "1") {
    const up = q.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5) || "DEMO";
    return send(res, 200, { mock: true, results: [
      { symbol: up, name: q + " Inc (demo)", exchange: "NASDAQ", type: "Stock", kind: "EQUITY" },
      { symbol: up + ".NS", name: q + " Ltd (demo)", exchange: "NSE", type: "Stock", kind: "EQUITY" },
    ] });
  }
  const path = "/v1/finance/search?q=" + encodeURIComponent(q) + "&quotesCount=10&newsCount=0&listsCount=0&enableFuzzyQuery=false";
  for (const host of ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"]) {
    try {
      const r = await fetch(host + path, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!r.ok) continue;
      const j = await r.json();
      const results = (j.quotes || [])
        .filter((x) => x.symbol && TYPES[x.quoteType])
        .slice(0, 8)
        .map((x) => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, exchange: x.exchDisp || x.exchange || "", type: TYPES[x.quoteType], kind: x.quoteType }));
      return send(res, 200, { results }, 3600);
    } catch (e) { /* try the other host */ }
  }
  return send(res, 502, { error: "Yahoo search didn't answer" });
};
