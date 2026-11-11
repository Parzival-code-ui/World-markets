// Pure logic for World Markets: market hours, currency signs, returns and portfolio maths.
// No DOM and no network, so it runs in the browser (window.WMCore) and under Node for the tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WMCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── time zones & market hours ────────────────────────────────────────────
  const WDN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const tzCache = {};
  function localParts(tz, now = new Date()) {
    const f = tzCache[tz] || (tzCache[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }));
    const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
    const hh = +p.hour % 24;
    return { wd: WDN[p.weekday], min: hh * 60 + +p.minute, label: String(hh).padStart(2, "0") + ":" + p.minute, y: +p.year, mo: +p.month, d: +p.day };
  }
  function tzOffsetMin(tz, now = new Date()) {
    const p = localParts(tz, now);
    const asUTC = Date.UTC(p.y, p.mo - 1, p.d, Math.floor(p.min / 60), p.min % 60);
    return Math.round((asUTC - Math.floor(now.getTime() / 60000) * 60000) / 60000);
  }
  const toMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  function dur(m) {
    if (!isFinite(m)) return "—";
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
  }
  const ymd = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  // a holiday or early close for market c on date (YYYY-MM-DD); beyond the data's `through` date, regular hours apply
  function holidayOn(c, date, HOL) {
    const h = HOL && HOL[c.id];
    if (!h || date > h.through) return null;
    const v = h.days[date];
    return !v ? null : Array.isArray(v) ? { early: toMin(v[0]), at: v[0], name: v[1] } : { name: v };
  }
  // the day's sessions in local minutes, cut short on an early-close day
  function sessionsOn(c, hol) {
    let ses = c.sessions.map(([a, b]) => [toMin(a), toMin(b)]);
    if (hol && hol.early != null) ses = ses.filter(([a]) => a < hol.early).map(([a, b]) => [a, Math.min(b, hol.early)]);
    return ses;
  }
  function status(c, HOL, now = new Date()) {
    const { wd, min, label, y, mo, d } = localParts(c.tz, now);
    const hol = holidayOn(c, ymd(y, mo, d), HOL);
    const shut = hol && hol.early == null && c.days.includes(wd);
    const ses = sessionsOn(c, hol);
    if (c.days.includes(wd) && !shut && ses.length) {
      for (const [a, b] of ses) if (min >= a && min < b) {
        const early = hol && hol.early != null;
        return { kind: "open", text: "Open", mins: b - min, sub: early ? `Closes early at ${hol.at} for ${hol.name}, in ${dur(b - min)}` : "Closes in " + dur(b - min), label, early: early ? hol.name : null };
      }
      if (min >= ses[0][0] && min < ses[ses.length - 1][1]) {
        const next = ses.find(([a]) => a > min);
        return { kind: "lunch", text: "Lunch break", mins: next[0] - min, sub: "Reopens in " + dur(next[0] - min), label };
      }
    }
    // next opening, skipping weekends and full-day holidays
    let best = Infinity;
    for (let k = 0; k < 12; k++) {
      if (!c.days.includes((wd + k) % 7)) continue;
      const h2 = holidayOn(c, ymd(y, mo, d + k), HOL);
      if (h2 && h2.early == null) continue;
      const m = k * 1440 + toMin(c.sessions[0][0]) - min;
      if (m > 0) { best = m; break; }
    }
    if (shut) return { kind: "closed", text: "Holiday", holiday: hol.name, mins: best, sub: `Closed for ${hol.name}. Opens in ${dur(best)}`, label };
    return { kind: "closed", text: "Closed", mins: best, sub: "Opens in " + dur(best), label };
  }
  // epoch ms of a wall-clock time in a time zone
  function zonedEpoch(date, hhmm, tz) {
    const [y, m, d] = date.split("-").map(Number), [h, mi] = (hhmm || "12:00").split(":").map(Number);
    let t = Date.UTC(y, m - 1, d, h, mi);
    for (let k = 0; k < 2; k++) t = Date.UTC(y, m - 1, d, h, mi) - tzOffsetMin(tz, new Date(t)) * 60000;
    return t;
  }

  // ── currency signs ───────────────────────────────────────────────────────
  const CSIGN = { USD: "$", INR: "₹", GBP: "£", EUR: "€", JPY: "¥", CNY: "¥", HKD: "HK$", TWD: "NT$", KRW: "₩", SGD: "S$", AUD: "A$", CAD: "C$", NZD: "NZ$",
    BRL: "R$", MXN: "MX$", CHF: "CHF ", ZAR: "R", TRY: "₺", ILS: "₪", PHP: "₱", THB: "฿", VND: "₫", IDR: "Rp ", MYR: "RM ", PKR: "Rs ", SAR: "SAR ", AED: "AED ",
    SEK: "kr ", DKK: "kr ", NOK: "kr ", PLN: "zł ", EGP: "E£", ARS: "AR$", CLP: "CLP$", QAR: "QAR ", KWD: "KWD " };
  const RATE_SYMS = new Set(["^IRX", "^FVX", "^TNX", "^TYX"]);
  // the trading currency: the quote's own, or a guess from the ticker before the quote arrives
  function currencyOf(s, quoted) {
    if (quoted) return quoted;
    let m;
    if ((m = /^([A-Z]{3})?([A-Z]{3})=X$/.exec(s))) return m[2]; // XXX=X is XXX per dollar; EURUSD=X is dollars per euro
    if (/-USD$/.test(s) || /=F$/.test(s)) return "USD";
    if (/\.(NS|BO)$/.test(s)) return "INR";
    return null;
  }
  // [before, after] a price: "$" for dollars, "%" for yields, nothing for index points
  function affix(s, cur, isIndex) {
    if (RATE_SYMS.has(s)) return ["", "%"];
    if (s[0] === "^" || (isIndex && !/=X$/.test(s))) return ["", ""];
    const c = currencyOf(s, cur);
    if (!c) return ["", ""];
    if (c === "GBp" || c === "GBX") return ["", "p"];
    if (c === "USX") return ["", "¢"];
    if (c === "ZAc" || c === "ZAC") return ["", "c"];
    if (c === "ILA") return ["", " ag"];
    return CSIGN[c] ? [CSIGN[c], ""] : ["", " " + c];
  }

  // ── returns in another currency ──────────────────────────────────────────
  // A local return r (0.1 = 10%) seen from another currency. fxLocal and fxTarget are the changes, over the
  // same period, in "units per US dollar" for the local and target currencies (null or 0 for the dollar).
  function returnIn(r, fxLocal, fxTarget) {
    if (r == null || !isFinite(r)) return null;
    if ((fxLocal != null && !isFinite(fxLocal)) || (fxTarget != null && !isFinite(fxTarget))) return null;
    return ((1 + r) * (1 + (fxTarget || 0))) / (1 + (fxLocal || 0)) - 1;
  }
  // percent change between two prices, as a fraction
  const change = (from, to) => (from && to != null && isFinite(from) && isFinite(to) ? to / from - 1 : null);

  // ── portfolio maths ──────────────────────────────────────────────────────
  // XIRR: the yearly rate that makes the dated cash flows add up to zero. flows: [[epochMs, amount]],
  // money paid in negative, value today positive. Returns a fraction (0.12 = 12% a year) or null.
  function xirr(flows) {
    const f = flows.filter(([t, a]) => isFinite(t) && isFinite(a) && a !== 0);
    if (f.length < 2 || !f.some(([, a]) => a > 0) || !f.some(([, a]) => a < 0)) return null;
    const t0 = Math.min(...f.map(([t]) => t)), Y = 365 * 864e5;
    const npv = (r) => f.reduce((s, [t, a]) => s + a / Math.pow(1 + r, (t - t0) / Y), 0);
    // bisection between -99.99% and +10,000%: slow but never wanders off
    let lo = -0.9999, hi = 100, flo = npv(lo), fhi = npv(hi);
    if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2, fm = npv(mid);
      if (Math.abs(fm) < 1e-7 || hi - lo < 1e-10) return mid;
      if (fm * flo > 0) { lo = mid; flo = fm; } else hi = mid;
    }
    return (lo + hi) / 2;
  }
  // a holding made of buy lots [{d: "YYYY-MM-DD"|null, p, q, fee}] at today's price
  function holding(lots, price, now = Date.now()) {
    const ok = (lots || []).filter((l) => l && l.p > 0);
    const withQty = ok.filter((l) => l.q > 0);
    const qty = withQty.reduce((s, l) => s + l.q, 0);
    const cost = withQty.reduce((s, l) => s + l.p * l.q + (l.fee || 0), 0);
    // average price: by quantity when there is one, otherwise the plain average of the prices entered
    const avg = qty ? cost / qty : ok.length ? ok.reduce((s, l) => s + l.p, 0) / ok.length : null;
    const value = qty && price != null ? price * qty : null;
    const pl = value != null ? value - cost : null;
    const plPct = avg && price != null ? price / avg - 1 : null;
    // XIRR only when every lot with a quantity has a date
    const dated = withQty.length && withQty.every((l) => l.d);
    const irr = dated && value != null ? xirr([...withQty.map((l) => [Date.parse(l.d), -(l.p * l.q + (l.fee || 0))]), [now, value]]) : null;
    // listed shares in India count as long-term after 12 months; show the split by quantity
    const yearAgo = new Date(now); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const longQty = withQty.filter((l) => l.d && Date.parse(l.d) <= yearAgo.getTime()).reduce((s, l) => s + l.q, 0);
    const first = withQty.filter((l) => l.d).map((l) => l.d).sort()[0] || null;
    return { qty, cost: withQty.length ? cost : null, avg, value, pl, plPct, irr, longQty, shortQty: dated ? qty - longQty : null, first, lots: ok.length };
  }
  // the same money put into a benchmark on the same dates: priceAt(date) gives the benchmark's close
  function benchmark(lots, priceAt, priceNow) {
    const withQty = (lots || []).filter((l) => l && l.p > 0 && l.q > 0 && l.d);
    if (!withQty.length || priceNow == null) return null;
    let units = 0, cost = 0;
    for (const l of withQty) {
      const b = priceAt(l.d);
      if (!b) return null;
      const amt = l.p * l.q + (l.fee || 0);
      units += amt / b; cost += amt;
    }
    return { cost, value: units * priceNow, ret: (units * priceNow) / cost - 1 };
  }
  // closing price on a date, or the last one before it, from [[epochSec, close], ...] sorted by time
  function closeOn(points, date) {
    const t = Date.parse(date + "T23:59:59Z") / 1000;
    let best = null;
    for (const p of points) { if (p[0] <= t) best = p[1]; else break; }
    return best;
  }

  return { localParts, tzOffsetMin, toMin, dur, ymd, holidayOn, sessionsOn, status, zonedEpoch, CSIGN, RATE_SYMS, currencyOf, affix, returnIn, change, xirr, holding, benchmark, closeOn };
});
