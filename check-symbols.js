// `npm run check` — asks Yahoo for every symbol in public/data/markets.js and
// lists the ones that return no price, so you can swap them for working tickers.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const quotes = require("../api/quotes");

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/data/markets.js"), "utf8"), ctx);
const syms = new Set(["INR=X"]);
ctx.window.MARKETS.forEach((c) => { c.indices.forEach(([s]) => syms.add(s)); if (c.ccy !== "USD") syms.add(c.ccy + "=X"); if (c.y10Live) syms.add(c.y10Live); });
ctx.window.GLOBAL.forEach((g) => g.items.forEach(([s]) => syms.add(s)));

const res = { setHeader() {}, end(body) {
  const { quotes: q } = JSON.parse(body);
  const bad = Object.values(q).filter((x) => x.price == null);
  Object.values(q).forEach((x) => console.log((x.price == null ? "✗ " : "✓ ") + x.symbol.padEnd(14) + (x.price ?? x.error)));
  console.log(`\n${syms.size - bad.length}/${syms.size} symbols OK` + (bad.length ? ` — fix: ${bad.map((b) => b.symbol).join(", ")}` : ""));
} };
quotes({ query: { symbols: [...syms].join(",") } }, res);
