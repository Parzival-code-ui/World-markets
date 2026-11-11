// Unit tests for public/lib/core.js. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../public/lib/core.js");

const NSE = { id: "in", tz: "Asia/Kolkata", days: [1, 2, 3, 4, 5], sessions: [["09:15", "15:30"]] };
const HKX = { id: "hk", tz: "Asia/Hong_Kong", days: [1, 2, 3, 4, 5], sessions: [["09:30", "12:00"], ["13:00", "16:00"]] };
const at = (iso) => new Date(iso);

test("market open, closed, lunch and weekend", () => {
  assert.equal(C.status(NSE, {}, at("2026-11-11T05:00:00Z")).kind, "open"); // 10:30 IST Wed
  assert.equal(C.status(NSE, {}, at("2026-11-11T11:00:00Z")).kind, "closed"); // 16:30 IST
  assert.equal(C.status(HKX, {}, at("2026-11-11T04:30:00Z")).kind, "lunch"); // 12:30 HKT
  const sat = C.status(NSE, {}, at("2026-11-14T05:00:00Z"));
  assert.equal(sat.kind, "closed");
  assert.equal(sat.mins, 2 * 1440 - 75); // Monday 09:15 from Saturday 10:30
});

test("holidays close the market and push the next opening", () => {
  const HOL = { in: { through: "2026-12-31", days: { "2026-11-11": "Test Day", "2026-11-12": ["12:00", "Half Day"] } } };
  const s = C.status(NSE, HOL, at("2026-11-11T05:00:00Z"));
  assert.equal(s.kind, "closed");
  assert.equal(s.holiday, "Test Day");
  const e = C.status(NSE, HOL, at("2026-11-12T05:00:00Z")); // 10:30 on the early-close day
  assert.equal(e.kind, "open");
  assert.equal(e.mins, 90);
  assert.equal(C.status(NSE, HOL, at("2026-11-12T07:00:00Z")).kind, "closed"); // 12:30
  // past the data's end date, regular hours apply
  assert.equal(C.holidayOn(NSE, "2027-01-26", HOL), null);
});

test("zonedEpoch turns a local time into the right instant", () => {
  assert.equal(new Date(C.zonedEpoch("2026-12-09", "14:00", "America/New_York")).toISOString(), "2026-12-09T19:00:00.000Z");
  assert.equal(new Date(C.zonedEpoch("2026-12-04", "10:00", "Asia/Kolkata")).toISOString(), "2026-12-04T04:30:00.000Z");
});

test("currency signs", () => {
  assert.deepEqual(C.affix("RELIANCE.NS", null, false), ["₹", ""]);
  assert.deepEqual(C.affix("AAPL", "USD", false), ["$", ""]);
  assert.deepEqual(C.affix("HSBA.L", "GBP", false), ["£", ""]);
  assert.deepEqual(C.affix("^NSEI", "INR", true), ["", ""]);
  assert.deepEqual(C.affix("FTSEMIB.MI", "EUR", true), ["", ""]);
  assert.deepEqual(C.affix("^TNX", null, true), ["", "%"]);
  assert.deepEqual(C.affix("INR=X", null, true), ["₹", ""]);
  assert.deepEqual(C.affix("EURUSD=X", null, false), ["$", ""]);
  assert.deepEqual(C.affix("GC=F", null, false), ["$", ""]);
  assert.deepEqual(C.affix("XYZ", "CZK", false), ["", " CZK"]);
});

test("returns seen in another currency", () => {
  // S&P +10% while the rupee weakens 5% against the dollar (INR per USD up 5%): +15.5% in rupees
  assert.ok(Math.abs(C.returnIn(0.1, null, 0.05) - 0.155) < 1e-12);
  // Nifty +10% while INR per USD rises 5%: in dollars it's 1.1 / 1.05 - 1
  assert.ok(Math.abs(C.returnIn(0.1, 0.05, null) - (1.1 / 1.05 - 1)) < 1e-12);
  assert.equal(C.returnIn(null, 0, 0), null);
  assert.ok(Math.abs(C.change(100, 112) - 0.12) < 1e-12);
});

test("xirr", () => {
  const d = (s) => Date.parse(s);
  // 1000 in, 1100 out exactly a year later: 10%
  assert.ok(Math.abs(C.xirr([[d("2025-01-01"), -1000], [d("2026-01-01"), 1100]]) - 0.1) < 1e-6);
  // money only going in: no answer
  assert.equal(C.xirr([[d("2025-01-01"), -1000], [d("2026-01-01"), -10]]), null);
  // a loss
  assert.ok(C.xirr([[d("2025-01-01"), -1000], [d("2026-01-01"), 800]]) < 0);
});

test("holding: lots, average price, gain, long- and short-term", () => {
  const now = Date.parse("2026-11-11T00:00:00Z");
  const h = C.holding([{ d: "2025-01-10", p: 100, q: 10 }, { d: "2026-06-01", p: 130, q: 10, fee: 20 }], 150, now);
  assert.equal(h.qty, 20);
  assert.equal(h.cost, 2320);
  assert.equal(h.avg, 116);
  assert.equal(h.value, 3000);
  assert.equal(h.pl, 680);
  assert.equal(h.longQty, 10);
  assert.equal(h.shortQty, 10);
  assert.ok(h.irr > 0);
  // a price with no quantity still gives a percentage
  const p = C.holding([{ p: 200 }], 220, now);
  assert.ok(Math.abs(p.plPct - 0.1) < 1e-12);
  assert.equal(p.value, null);
  assert.equal(p.irr, null);
});

test("benchmark buys the index on the same dates", () => {
  const pts = [[Date.parse("2025-01-10T10:00:00Z") / 1000, 20000], [Date.parse("2026-06-01T10:00:00Z") / 1000, 25000]];
  const at2 = (d) => C.closeOn(pts, d);
  const b = C.benchmark([{ d: "2025-01-10", p: 100, q: 10 }, { d: "2026-06-01", p: 100, q: 10 }], at2, 26000);
  // 1000 at 20000 (0.05 units) + 1000 at 25000 (0.04 units) = 0.09 units, worth 2340
  assert.ok(Math.abs(b.value - 2340) < 1e-9);
  assert.equal(C.closeOn(pts, "2025-01-09"), null);
});

test("returns endpoint maths", () => {
  const { returnsFrom } = require("../api/returns.js");
  const day = 86400, t0 = Date.UTC(2021, 10, 1) / 1000;
  // a price that grows 10% a year, one point a day for five years and ten days
  const pts = [];
  for (let i = 0; i <= 5 * 365 + 12; i++) pts.push([t0 + i * day, 100 * Math.pow(1.1, i / 365)]);
  const r = returnsFrom(pts);
  assert.ok(Math.abs(r.y1 - 0.1) < 0.002);
  assert.ok(Math.abs(r.y3 - (Math.pow(1.1, 3) - 1)) < 0.005);
  assert.ok(r.y5 > 0.6 && r.y5 < 0.62);
  // a short history doesn't pretend to know the 5-year number
  assert.equal(returnsFrom(pts.slice(-400)).y5, null);
});
