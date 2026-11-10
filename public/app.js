(() => {
  const REFRESH_MS = 60_000;
  const M = window.MARKETS, G = window.GLOBAL, IN = window.INDIA;
  const REGIONS = ["All", "Americas", "Europe", "Middle East & Africa", "Asia-Pacific"];
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = { quotes: {}, prev: {}, region: "All", view: "cards", q: "", openOnly: false, sort: { key: "changePct", dir: -1 }, stockSort: { key: "changePct", dir: -1 }, fetchedAt: null, mock: false, error: null, hadData: false, stale: false, fund: {}, fundT: {}, stockMkt: "us", stocksSort: { key: "marketCap", dir: -1 } };
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  // last prices seen, so a return visit paints instantly
  const cached = store.get("wm-quotes");
  if (cached && cached.quotes && Date.now() - cached.t < 3 * 864e5) {
    state.quotes = cached.quotes; state.fetchedAt = cached.t; state.hadData = true; state.stale = true;
  }
  const cachedF = store.get("wm-fund");
  if (cachedF && cachedF.f && Date.now() - cachedF.t < 864e5) state.fund = cachedF.f; // shown at once, refreshed in the background

  // ── symbols & names ──────────────────────────────────────────────────────
  const fx = (c) => (c === "USD" ? null : c + "=X");
  const symbols = new Set(["INR=X"]);
  const NAMES = {};
  M.forEach((c) => {
    c.indices.forEach(([s, n]) => { symbols.add(s); NAMES[s] = { name: n, sub: `${c.flag} ${c.name}, ${c.exchange}` }; });
    if (fx(c.ccy)) symbols.add(fx(c.ccy));
    if (c.y10Live) symbols.add(c.y10Live);
  });
  G.forEach((g) => g.items.forEach(([s, n, u]) => { symbols.add(s); NAMES[s] = { name: n, sub: g.group + (u ? ", in " + u : "") }; }));
  IN.headline.forEach(([s, n]) => { symbols.add(s); NAMES[s] = NAMES[s] || { name: n, sub: "🇮🇳 India" }; });
  IN.sectors.forEach(([s, n]) => { symbols.add(s); NAMES[s] = NAMES[s] || { name: "Nifty " + n, sub: "🇮🇳 India sector index" }; });
  IN.stocks.forEach(([s, n, sec]) => { symbols.add(s); NAMES[s] = { name: n, sub: `🇮🇳 ${sec}, NSE: ${s.replace(".NS", "")}` }; });
  NAMES["INR=X"] = { name: "US dollar in rupees", sub: "USD / INR" };
  const byId = Object.fromEntries(M.map((c) => [c.id, c]));
  // largest companies per market (Stocks tab); India reuses the deep-dive list
  const SM = window.STOCK_MARKETS.map((m) => (m.stocks ? m : Object.assign({}, m, { stocks: IN.stocks })));
  const STOCK_SET = new Set();
  SM.forEach((m) => m.stocks.forEach(([s, n, sec]) => { STOCK_SET.add(s); NAMES[s] = NAMES[s] || { name: n, sub: `${m.flag} ${sec}` }; }));
  symbols.add("DKK=X"); // so European market caps can be compared in dollars
  const MAC = window.MACRO || {};

  // ── helpers ──────────────────────────────────────────────────────────────
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const yurl = (s) => "https://finance.yahoo.com/quote/" + encodeURIComponent(s);
  const loading = () => !state.fetchedAt && !state.error;
  const SK = '<span class="sk"></span>';
  function fmt(v, d) {
    if (v == null || !isFinite(v)) return loading() ? SK : "—";
    if (d == null) d = Math.abs(v) >= 1 ? 2 : 4;
    return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function pct(v) {
    if (v == null || !isFinite(v)) return loading() ? SK : '<span class="na">—</span>';
    return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2) + "%";
  }
  const cls = (v) => (v == null || !isFinite(v) ? "na" : v > 0 ? "up" : v < 0 ? "down" : "flat");
  const sym = (s, inner, extra = "") => `<a href="${yurl(s)}" data-sym="${esc(s)}" class="lnk ${extra}">${inner}</a>`;
  const px = (s, d) => `<span class="px" data-px="${esc(s)}">${fmt((state.quotes[s] || {}).price, d)}</span>`;
  const chip = (v) => `<span class="chg ${cls(v)}">${pct(v)}</span>`;
  const Qv = (s) => state.quotes[s] || {};
  // live-tagged pieces: patch() finds these by data attribute and updates them in place
  const chipS = (s, inv) => { const v = Qv(s).changePct; return `<span class="chg ${cls(inv ? -v : v)}" data-pc="${esc(s)}"${inv ? " data-inv" : ""}>${pct(v)}</span>`; };
  const pctT = (s, f = "changePct", sfx = "", extra = "", plain = false) => { const v = Qv(s)[f]; return `<span class="${extra} ${plain ? "" : cls(v)}" data-pt="${esc(s)}" data-f="${f}" data-sfx="${esc(sfx)}"${plain ? " data-plain" : ""}>${v != null ? pct(v) + sfx : loading() ? SK : ""}</span>`; };
  const sparkS = (s, w = 64, h = 22) => `<span class="spk" data-sp="${esc(s)}" data-w="${w}" data-h="${h}">${spark(Qv(s).spark, w, h)}</span>`;
  const listJoin = (a) => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];

  function spark(arr, w = 64, h = 22) {
    if (!arr || arr.length < 2) return `<svg class="spark" width="${w}" height="${h}" aria-hidden="true"></svg>`;
    const min = Math.min(...arr), max = Math.max(...arr), r = max - min || 1;
    const pts = arr.map((v, i) => [((i / (arr.length - 1)) * w).toFixed(1), (h - 2 - ((v - min) / r) * (h - 4)).toFixed(1)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join("");
    const c = arr[arr.length - 1] >= arr[0] ? "var(--up)" : "var(--down)";
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}L${w} ${h}L0 ${h}Z" fill="${c}" opacity=".12"/><path d="${d}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }
  // theme palette, read from CSS variables so the heatmap and map follow the chosen theme
  let pal;
  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const trip = (n) => cs.getPropertyValue(n).split(",").map((x) => +x.trim());
    pal = { base: trip("--heat-base"), up: trip("--heat-up"), down: trip("--heat-down"), land: cs.getPropertyValue("--land").trim(), text: cs.getPropertyValue("--text").trim() };
  }
  readPalette();
  function heatRGB(p, max = 3) {
    if (p == null || !isFinite(p)) return pal.base;
    const t = Math.min(Math.abs(p) / max, 1), tgt = p >= 0 ? pal.up : pal.down;
    return pal.base.map((v, i) => Math.round(v + (tgt[i] - v) * (0.22 + 0.78 * t)));
  }
  const heatColor = (p, max) => `rgb(${heatRGB(p, max).join(",")})`;
  function tileStyle(p, max) {
    const c = heatRGB(p, max), lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    return `--tile:rgb(${c.join(",")});--tile-ink:${lum > 0.6 ? "#0f172a" : "#fff"}`;
  }

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
  function status(c) {
    const { wd, min, label } = localParts(c.tz);
    const ses = c.sessions.map(([a, b]) => [toMin(a), toMin(b)]);
    if (c.days.includes(wd)) {
      for (const [a, b] of ses) if (min >= a && min < b) return { kind: "open", text: "Open", mins: b - min, sub: "Closes in " + dur(b - min), label };
      if (min >= ses[0][0] && min < ses[ses.length - 1][1]) {
        const next = ses.find(([a]) => a > min);
        return { kind: "lunch", text: "Lunch break", mins: next[0] - min, sub: "Reopens in " + dur(next[0] - min), label };
      }
    }
    let best = Infinity;
    for (let d = 0; d < 8; d++) {
      if (!c.days.includes((wd + d) % 7)) continue;
      const m = d * 1440 + ses[0][0] - min;
      if (m > 0) { best = m; break; }
    }
    return { kind: "closed", text: "Closed", mins: best, sub: "Opens in " + dur(best), label };
  }
  const isLive = (c) => ["open", "lunch"].includes(status(c).kind);

  // ── data ─────────────────────────────────────────────────────────────────
  async function load() {
    const btn = $("#refresh");
    btn.classList.add("spin");
    try {
      const r = await fetch("/api/quotes?symbols=" + encodeURIComponent([...symbols, ...extraSyms()].join(",")));
      if (!r.ok) throw new Error("the price service answered " + r.status);
      const j = await r.json();
      state.prev = Object.fromEntries(Object.entries(state.quotes).map(([k, v]) => [k, v && v.price]));
      // keep the last good value for any symbol that failed this round
      const fresh = j.quotes || {};
      for (const k in fresh) if (fresh[k] && fresh[k].price == null && state.quotes[k] && state.quotes[k].price != null) fresh[k] = state.quotes[k];
      state.quotes = fresh;
      state.fetchedAt = j.fetchedAt || Date.now();
      state.mock = !!j.mock;
      state.error = null;
      state.stale = false;
      if (!j.mock) store.set("wm-quotes", { t: state.fetchedAt, quotes: state.quotes });
    } catch (e) {
      state.error = e.message || "network error";
    }
    setTimeout(() => btn.classList.remove("spin"), 400);
    if (state.hadData && !state.error) patch(); else render();
    if (!state.error) state.hadData = true;
  }

  // stocks outside the always-loaded set: fetched only while their market is open in the Stocks tab
  const stockList = () => (SM.find((m) => m.id === state.stockMkt) || SM[0]).stocks;
  const extraSyms = () => (state.view === "stocks" ? stockList().map((x) => x[0]).filter((s) => !symbols.has(s)) : []);
  const extraBusy = new Set();
  async function loadExtra() {
    const need = extraSyms().filter((s) => !state.quotes[s] && !extraBusy.has(s));
    if (!need.length) return;
    need.forEach((s) => extraBusy.add(s));
    try {
      const j = await fetch("/api/quotes?symbols=" + encodeURIComponent(need.join(","))).then((r) => r.json());
      Object.assign(state.quotes, j.quotes || {});
    } catch (e) { /* the next minute's refresh includes them */ }
    need.forEach((s) => extraBusy.delete(s));
    if (state.view === "stocks") renderMain();
  }

  // ── fundamentals ─────────────────────────────────────────────────────────
  const fundBusy = new Set();
  let fundErr = null;
  function ensureFund(list) {
    const need = list.filter((s) => !fundBusy.has(s) && !(state.fundT[s] && Date.now() - state.fundT[s] < 3600e3));
    if (!need.length) return;
    need.forEach((s) => fundBusy.add(s));
    fetch("/api/fundamentals?symbols=" + encodeURIComponent(need.join(","))).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "the service answered " + r.status);
      Object.assign(state.fund, j.fundamentals || {});
      need.forEach((s) => (state.fundT[s] = Date.now()));
      fundErr = null;
      if (!j.mock) store.set("wm-fund", { t: Date.now(), f: state.fund });
    }).catch((e) => {
      fundErr = e.message || "network error";
      need.forEach((s) => (state.fundT[s] = Date.now() - 3300e3)); // try again in about 5 minutes
    }).finally(() => {
      need.forEach((s) => fundBusy.delete(s));
      if (["stocks", "india"].includes(state.view)) renderMain();
    });
  }
  const fundDetail = {};
  function getFundDetail(s) {
    const hit = fundDetail[s];
    if (hit && Date.now() - hit.t < 3600e3) return hit.p;
    const p = fetch("/api/fundamentals?symbol=" + encodeURIComponent(s)).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
      return d;
    });
    fundDetail[s] = { t: Date.now(), p };
    p.catch(() => delete fundDetail[s]);
    return p;
  }
  const CUR = { USD: "$", INR: "₹", GBP: "£", EUR: "€", JPY: "¥", CNY: "¥", HKD: "HK$", TWD: "NT$", KRW: "₩", SGD: "S$", AUD: "A$", CHF: "CHF ", DKK: "DKK ", IDR: "Rp " };
  function money(v, cur) {
    if (v == null || !isFinite(v)) return "—";
    const neg = v < 0 ? "−" : "";
    v = Math.abs(v);
    if (cur === "INR") { // Indian convention: crore and lakh crore
      const cr = v / 1e7;
      return neg + "₹" + (cr >= 1e5 ? (cr / 1e5).toFixed(2) + " lakh cr" : cr >= 1 ? Math.round(cr).toLocaleString("en-IN") + " cr" : Math.round(v).toLocaleString("en-IN"));
    }
    const c = CUR[cur] != null ? CUR[cur] : cur ? cur + " " : "";
    const [d, u] = v >= 1e12 ? [1e12, "T"] : v >= 1e9 ? [1e9, "B"] : v >= 1e6 ? [1e6, "M"] : [1, ""];
    return neg + c + (v / d).toFixed(v / d >= 100 ? 0 : 1) + u;
  }
  const usdOf = (v, cur) => { if (v == null) return null; if (!cur || cur === "USD") return v; const r = Qv(cur + "=X").price; return r ? v / r : null; };
  const ratio = (v, d = 1) => (v == null || !isFinite(v) || v <= 0 ? "—" : v.toFixed(d));
  const pctPlain = (v, d = 1) => (v == null || !isFinite(v) ? "—" : (v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + "%");
  const tickerOf = (s) => s.replace(/\.(NS|L|T|HK|SS|SZ|TW|KS|SI|AX|JK|AS|DE|PA|CO|SW)$/, "");

  // economy facts from the IMF, shown on country cards, the map and the India view
  function econHTML(id) {
    const e = MAC[id];
    if (!e) return "";
    const it = (k, v, sign, sfx = "%") => `<div><dt>${k}</dt><dd>${v == null ? "—" : (sign && v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + sfx}</dd></div>`;
    const gdp = e[4] >= 1000 ? "$" + (e[4] / 1000).toFixed(1) + " trillion" : "$" + Math.round(e[4]) + " billion";
    return `<div class="econ" title="${esc(window.MACRO_SOURCE || "IMF")}"><p class="econ-h">Economy in 2026<span>${gdp} GDP</span></p>
      <dl>${it("GDP growth", e[0], 1)}${it("Inflation", e[1])}${it("Unemployment", e[2])}${it("Debt to GDP", e[3], 0)}</dl></div>`;
  }
  const econLine = (id) => { const e = MAC[id]; return e ? `<span class="muted">Economy: ${e[0] > 0 ? "+" : ""}${e[0].toFixed(1)}% growth, ${e[1].toFixed(1)}% inflation (IMF, 2026)</span>` : ""; };

  // ── hero ─────────────────────────────────────────────────────────────────
  const REGION_KEYS = [["Asia-Pacific", ["jp", "cn", "hk", "in", "kr", "au"]], ["Europe", ["uk", "de", "fr", "eu", "ch"]], ["the Middle East and Africa", ["sa", "za", "il", "ae"]], ["the Americas", ["us", "ca", "br"]]];
  const CITY = { us: "New York", uk: "London", de: "Frankfurt", jp: "Tokyo", cn: "Shanghai", hk: "Hong Kong", in: "Mumbai", au: "Sydney" };

  function renderHero() {
    const open = REGION_KEYS.filter(([, ids]) => ids.some((id) => isLive(byId[id]))).map(([n]) => n);
    const majors = Object.keys(CITY).map((id) => ({ id, s: status(byId[id]) }));
    let h;
    if (open.length) h = `Markets are open in ${listJoin(open)}.`;
    else {
      const wd = new Date().getDay();
      h = wd === 0 || wd === 6 ? "It's the weekend, so the major markets are closed." : "The major markets are closed right now.";
    }
    const closing = majors.filter((m) => m.s.kind !== "closed").sort((a, b) => a.s.mins - b.s.mins)[0];
    const opening = majors.filter((m) => m.s.kind === "closed").sort((a, b) => a.s.mins - b.s.mins)[0];
    const parts = [];
    if (closing) parts.push(`${CITY[closing.id]} ${closing.s.kind === "lunch" ? "reopens after lunch in" : "closes in"} ${dur(closing.s.mins)}.`);
    if (opening) parts.push(`${CITY[opening.id]} opens in ${dur(opening.s.mins)}.`);
    const ind = status(byId.in);
    if (![closing, opening].some((m) => m && m.id === "in")) parts.push(ind.kind === "closed" ? `Indian markets open in ${dur(ind.mins)}.` : `Indian markets close in ${dur(ind.mins)}.`);
    $("#headline").textContent = h;
    $("#subline").textContent = parts.join(" ");
    renderRibbon();
    renderHighlights();
  }

  // 24h ribbon in the viewer's time, one lane per trading region
  const LANES = [
    { name: "Asia-Pacific", region: "Asia-Pacific", from: ["jp", "09:00"], to: ["in", "15:30"], ids: ["jp", "cn", "hk", "in", "au", "kr"] },
    { name: "Europe", region: "Europe", from: ["uk", "08:00"], to: ["de", "17:30"], ids: ["uk", "de", "fr", "eu", "ch"] },
    { name: "Americas", region: "Americas", from: ["us", "09:30"], to: ["br", "17:00"], ids: ["us", "ca", "br"] },
  ];
  function viewerMin(id, hhmm, now) {
    const off = tzOffsetMin(byId[id].tz, now), vo = -now.getTimezoneOffset();
    return ((toMin(hhmm) - off + vo) % 1440 + 1440) % 1440;
  }
  function renderRibbon() {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const lanes = LANES.map((L) => {
      const s = viewerMin(L.from[0], L.from[1], now), e0 = viewerMin(L.to[0], L.to[1], now);
      const segs = e0 > s ? [[s, e0]] : [[s, 1440], [0, e0]];
      const live = L.ids.some((id) => isLive(byId[id]));
      const n = L.ids.filter((id) => isLive(byId[id])).length;
      return `<button class="lane ${live ? "live" : ""}" data-region="${L.region}" title="Show ${L.name}">
        <span class="lane-name">${L.name}</span>
        <span class="lane-track">${segs.map(([a, b], i) => `<span class="lane-bar" style="left:${(a / 1440) * 100}%;width:${((b - a) / 1440) * 100}%">${i === 0 ? `<em>${live ? n + " open" : "closed"}</em>` : ""}</span>`).join("")}</span>
      </button>`;
    }).join("");
    const ticks = [0, 6, 12, 18, 24].map((h) => `<span style="left:${(h / 24) * 100}%">${h === 24 ? "" : String(h).padStart(2, "0") + ":00"}</span>`).join("");
    const t = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    $("#ribbon").innerHTML = `<div class="lanes">${lanes}
      <div class="axis"><span class="lane-name"></span><span class="lane-track">${ticks}</span></div>
      <div class="nowline ${nowMin / 1440 > 0.78 ? "edge-r" : nowMin / 1440 < 0.12 ? "edge-l" : ""}" style="--x:${(nowMin / 1440).toFixed(4)}"><span>${t} your time</span></div></div>`;
  }

  function renderHighlights() {
    const rows = [];
    M.forEach((c) => c.indices.forEach(([s, n]) => { const q = state.quotes[s]; if (!s.includes("VIX") && q && q.changePct != null) rows.push({ c, s, n, q }); }));
    rows.sort((a, b) => b.q.changePct - a.q.changePct);
    const best = rows[0], worst = rows[rows.length - 1];
    const key = (best ? best.s : "") + "|" + (worst ? worst.s : "");
    if (renderHighlights.key === key && $("#highlights").children.length) return; // values get patched in place
    renderHighlights.key = key;
    const tile = (label, s, name, where) => `<a class="hl" href="${yurl(s)}" data-sym="${esc(s)}">
        <span class="hl-label">${label}</span>
        <span class="hl-name">${esc(name)}</span>
        <span class="hl-where">${where}</span>
        <span class="hl-row"><span class="hl-px">${px(s)}</span>${chipS(s)}</span>
        ${sparkS(s, 220, 36)}</a>`;
    $("#highlights").innerHTML =
      (best ? tile("Strongest today", best.s, best.n, `${best.c.flag} ${esc(best.c.name)}`) : tile("Strongest today", "^GSPC", "Waiting for prices", "")) +
      (worst ? tile("Weakest today", worst.s, worst.n, `${worst.c.flag} ${esc(worst.c.name)}`) : tile("Weakest today", "^DJI", "Waiting for prices", "")) +
      tile("India", "^NSEI", "Nifty 50", "🇮🇳 NSE") +
      tile("United States", "^GSPC", "S&P 500", "🇺🇸 NYSE and Nasdaq");
  }

  function renderStrip() {
    $("#strip").innerHTML = G.map((g) => `<div class="strip-group"><span class="strip-title">${esc(g.group)}</span>${g.items.map(([s, n]) =>
      `<a class="pill" href="${yurl(s)}" data-sym="${esc(s)}"><span class="pill-n">${esc(n)}</span><span class="pill-p">${px(s)}</span>${pctT(s, "changePct", "", "pill-c")}</a>`
    ).join("")}</div>`).join("");
  }

  function renderStatus() {
    const el = $("#status-line");
    if (state.error) { el.textContent = `Prices didn't load because ${state.error}. Retrying in a minute.`; el.classList.add("err"); }
    else if (state.stale) { el.textContent = `Showing prices from ${new Date(state.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Updating…`; el.classList.remove("err"); }
    else if (state.fetchedAt) { el.textContent = `Updated ${new Date(state.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, refreshes every minute`; el.classList.remove("err"); }
    $("#demo-banner").hidden = !state.mock;
  }

  // ── countries ────────────────────────────────────────────────────────────
  function filtered() {
    const q = state.q.toLowerCase();
    return M.filter((c) => (state.region === "All" || c.region === state.region)
      && (!state.openOnly || isLive(c))
      && (!q || c.name.toLowerCase().includes(q) || c.exchange.toLowerCase().includes(q) || c.ccy.toLowerCase().includes(q) || c.indices.some(([s, n]) => n.toLowerCase().includes(q) || s.toLowerCase().includes(q))));
  }
  function fxFact(c) {
    const usdinr = (state.quotes["INR=X"] || {}).price;
    if (c.ccy === "USD") return { v: usdinr ? "₹" + fmt(usdinr, 2) : fmt(null), d: "per dollar" };
    const per = (state.quotes[fx(c.ccy)] || {}).price;
    if (c.ccy === "INR") return { v: per ? "₹" + fmt(per, 2) : fmt(null), d: "per US dollar" };
    if (!per) return { v: fmt(null), d: c.ccy };
    const inr = usdinr ? usdinr / per : null;
    return per > 20 ? { v: `${fmt(per, 2)} ${c.ccy}`, d: inr ? `per dollar, ₹${fmt(inr, inr < 1 ? 4 : 2)} each` : "per dollar" }
      : { v: `$${fmt(1 / per, 4)}`, d: inr ? `per ${c.ccy}, ₹${fmt(inr, 2)}` : `per ${c.ccy}` };
  }
  function facts(c) {
    const f = fxFact(c);
    const pol = c.policy ? { v: c.policy[0].toFixed(2) + "%", d: "as of " + c.policy[1] } : { v: "—", d: c.policyNote || "" };
    let y;
    const yl = c.y10Live && state.quotes[c.y10Live];
    if (yl && yl.price != null) y = { v: fmt(yl.price, 2) + "%", d: `live, ${yl.change >= 0 ? "+" : "−"}${Math.abs(yl.change * 100).toFixed(0)} bp today` };
    else if (c.y10) y = { v: c.y10[0].toFixed(2) + "%", d: "as of " + c.y10[1] };
    else y = { v: c.wgb ? `<a class="ext" href="https://www.worldgovernmentbonds.com/country/${c.wgb}/" target="_blank" rel="noopener">See yield</a>` : "—", d: "no free source" };
    const mc = c.mcap ? { v: "$" + c.mcap[0].toFixed(1) + " trillion", d: c.mcap[1] } : null;
    const item = (k, o) => `<div><dt>${k}</dt><dd>${o.v}</dd><dd class="d">${o.d}</dd></div>`;
    return `<div class="factwrap" data-facts="${c.id}"><dl class="facts">${item("Currency", f)}${item("Policy rate", pol)}${item("10-year yield", y)}${mc ? item("Market size", mc) : ""}</dl>${econHTML(c.id)}</div>`;
  }
  const stInner = (s) => `<span class="dot"></span><span><b>${s.text}</b><small>${s.sub}, ${s.label} local</small></span>`;
  function card(c) {
    const s = status(c);
    const rows = c.indices.map(([s2, n]) =>
      `<li>${sym(s2, `<span class="ix-n">${esc(n)}</span>`)}<span class="ix-p">${px(s2)}</span>${chipS(s2)}${pctT(s2, "change1mPct", "", "ix-m")}${sparkS(s2)}</li>`
    ).join("");
    return `<article class="card ${s.kind}" id="c-${c.id}" data-card="${c.id}">
      <header><span class="flag">${c.flag}</span><div class="who"><h3>${esc(c.name)}</h3><p>${esc(c.exchange)}</p></div>
        <div class="st" data-st="${c.id}">${stInner(s)}</div></header>
      <ul class="ix">${rows}</ul>
      ${facts(c)}
    </article>`;
  }
  function allRows(list) {
    const rows = [];
    list.forEach((c) => c.indices.forEach(([s, n]) => { if (s.includes("VIX")) return; rows.push({ c, s, n, q: state.quotes[s] || {} }); }));
    return rows;
  }

  // ── world map ────────────────────────────────────────────────────────────
  const ISO = { "840": "us", "124": "ca", "076": "br", "484": "mx", "032": "ar", "152": "cl", "826": "uk", "276": "de", "250": "fr", "380": "it", "724": "es", "528": "nl", "756": "ch", "752": "se", "616": "pl", "792": "tr", "682": "sa", "784": "ae", "376": "il", "710": "za", "818": "eg", "356": "in", "156": "cn", "392": "jp", "410": "kr", "158": "tw", "036": "au", "554": "nz", "360": "id", "458": "my", "764": "th", "608": "ph", "704": "vn", "586": "pk" };
  const EURO = ["040", "056", "246", "372", "620", "300", "703", "705", "233", "428", "440", "442", "191", "196", "470"];
  const DOTS = { hk: [114.17, 22.32], sg: [103.82, 1.35] };
  let mapGeo = null, mapLoading = null;
  const mainMove = (c) => (state.quotes[c.indices[0][0]] || {}).changePct;
  function ensureMap() {
    if (mapGeo) return Promise.resolve(mapGeo);
    if (!mapLoading) mapLoading = fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json").then((r) => r.json()).then((topo) => (mapGeo = topojson.feature(topo, topo.objects.countries).features.filter((f) => f.id !== "010")));
    return mapLoading;
  }
  function renderMap(el) {
    el.innerHTML = `<section class="panel mapwrap"><div class="panel-h"><div><h2>Today's move by country</h2><p class="muted">Each country is shaded by its main index. A glowing dot means that market is open now. Click a country to see its chart.</p></div>
      <div class="legend" aria-hidden="true"><span>−3%</span><i></i><span>+3%</span></div></div>
      <div id="map" class="map"><div class="empty">Drawing the map…</div></div><div id="maptip" class="tip" hidden></div></section>
      <section class="panel"><div class="panel-h"><div><h2>Trading hours in your time</h2><p class="muted">${esc(Intl.DateTimeFormat().resolvedOptions().timeZone.replace("_", " "))}. Green bars are trading now.</p></div></div><div id="timeline"></div></section>`;
    renderTimeline($("#timeline"));
    ensureMap().then((features) => {
      if (state.view !== "map") return;
      const box = $("#map");
      const W = box.clientWidth || 1100, H = Math.round(W * 0.47);
      const proj = d3.geoNaturalEarth1().fitExtent([[2, 2], [W - 2, H - 2]], { type: "FeatureCollection", features });
      const path = d3.geoPath(proj);
      const tip = $("#maptip");
      const fillFor = (f) => ISO[f.id] ? heatColor(mainMove(byId[ISO[f.id]])) : EURO.includes(f.id) ? heatColor(mainMove(byId.eu)) : pal.land;
      let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="World map shaded by daily market moves">`;
      features.forEach((f) => {
        const id = ISO[f.id] || (EURO.includes(f.id) ? "eu" : "");
        svg += `<path d="${path(f)}" fill="${fillFor(f)}" class="${id ? "cty" : "cty-off"}" ${id ? `data-m="${id}" data-nm="${esc(f.properties.name)}"` : ""}/>`;
      });
      M.forEach((c) => {
        const open = isLive(c);
        let xy = null;
        if (DOTS[c.id]) xy = proj(DOTS[c.id]);
        else if (open) { const iso = Object.keys(ISO).find((k) => ISO[k] === c.id); const f = features.find((x) => x.id === iso); if (f) xy = path.centroid(f); }
        if (!xy || isNaN(xy[0])) return;
        if (DOTS[c.id]) svg += `<circle cx="${xy[0]}" cy="${xy[1]}" r="5" fill="${heatColor(mainMove(c))}" stroke="${pal.text}" stroke-width="1" class="cty" data-m="${c.id}" data-nm="${esc(c.name)}"/>`;
        if (open) svg += `<circle cx="${xy[0]}" cy="${xy[1]}" r="3.5" class="opendot"/>`;
      });
      box.innerHTML = svg + "</svg>";
      box.querySelectorAll("[data-m]").forEach((p) => {
        p.addEventListener("mousemove", (e) => {
          const c = byId[p.dataset.m], q = state.quotes[c.indices[0][0]] || {}, st = status(c);
          tip.hidden = false;
          tip.innerHTML = `<b>${c.flag} ${esc(p.dataset.nm)}</b>${p.dataset.m === "eu" && p.dataset.nm !== "Euro Area" ? '<span class="muted">Shown with the Euro Stoxx 50</span>' : ""}
            <span class="tip-row"><span>${esc(c.indices[0][1])}</span><span>${fmt(q.price)}</span><span class="${cls(q.changePct)}">${pct(q.changePct)}</span></span><span class="muted">${st.text}. ${st.sub}.</span>${econLine(p.dataset.m)}`;
          const r = box.getBoundingClientRect();
          tip.style.left = Math.min(e.clientX - r.left + 16, r.width - 240) + "px";
          tip.style.top = e.clientY - r.top + 70 + "px";
        });
        p.addEventListener("mouseleave", () => (tip.hidden = true));
        p.addEventListener("click", () => openChart(byId[p.dataset.m].indices[0][0]));
      });
    }).catch(() => { const m = $("#map"); if (m) m.innerHTML = '<div class="empty">The map needs cdn.jsdelivr.net to load. Check your connection and refresh.</div>'; });
  }
  function renderTimeline(el) {
    const now = new Date(), vo = -now.getTimezoneOffset(), nowMin = now.getHours() * 60 + now.getMinutes();
    const rows = M.map((c) => {
      const off = tzOffsetMin(c.tz, now), today = c.days.includes(localParts(c.tz, now).wd), segs = [];
      c.sessions.forEach(([a, b]) => {
        const s = (toMin(a) - off + vo + 2880) % 1440, e = s + (toMin(b) - toMin(a));
        if (e <= 1440) segs.push([s, e]); else { segs.push([s, 1440]); segs.push([0, e - 1440]); }
      });
      return { c, segs, today, first: (toMin(c.sessions[0][0]) - off + vo + 2880) % 1440, st: status(c) };
    }).sort((a, b) => a.first - b.first);
    el.innerHTML = `<div class="tl">
      <div class="tl-row tl-axis"><div class="tl-l"></div><div class="tl-track">${[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => `<span style="left:${(h / 24) * 100}%">${String(h % 24).padStart(2, "0")}:00</span>`).join("")}</div></div>
      ${rows.map((r) => `<div class="tl-row"><div class="tl-l"><span class="flag">${r.c.flag}</span>${esc(r.c.name)}</div>
        <div class="tl-track">${r.segs.map(([s, e]) => `<div class="tl-bar ${r.st.kind === "open" ? "on" : ""} ${r.today ? "" : "off"}" style="left:${(s / 1440) * 100}%;width:${((e - s) / 1440) * 100}%" title="${esc(r.c.exchange)}, ${r.c.sessions.map((x) => x.join("–")).join(" and ")} local time"></div>`).join("")}
        ${r.today ? "" : '<span class="tl-note">No session today</span>'}</div></div>`).join("")}
      <div class="tl-now" style="--x:${(nowMin / 1440).toFixed(4)}"></div></div>`;
  }

  // ── India ────────────────────────────────────────────────────────────────
  function renderIndia(el) {
    const Q = (s) => state.quotes[s] || {};
    const head = IN.headline.map(([s, n]) => {
      const inr = s === "INR=X";
      return `<a class="itile" href="${yurl(s)}" data-sym="${esc(s)}"><span class="it-n">${esc(n)}</span>
        <span class="it-p">${inr ? "₹" : ""}${px(s)}</span>
        <span class="it-c">${chipS(s, inr)}${pctT(s, "change1mPct", " this month", "muted", true)}</span>
        ${sparkS(s, 220, 34)}</a>`;
    }).join("");
    const secs = IN.sectors.map(([s, n]) => ({ s, n, q: Q(s) })).sort((a, b) => (b.q.changePct ?? -1e9) - (a.q.changePct ?? -1e9));
    const sectorHtml = secs.map((r) => `<a class="tile" href="${yurl(r.s)}" data-sym="${esc(r.s)}" data-tile="${esc(r.s)}" data-max="2" style="${tileStyle(r.q.changePct, 2)}"><span class="tn">${esc(r.n)}</span><span class="tp">${pct(r.q.changePct)}</span><span class="tc">${r.q.change1mPct != null ? pct(r.q.change1mPct) + " this month" : ""}</span></a>`).join("");
    ensureFund(IN.stocks.map((x) => x[0]));
    const s = status(byId.in);
    el.innerHTML = `
      <section class="in-hero"><div><h2>India today</h2><p class="muted">NSE and BSE are <b class="${s.kind}">${s.text.toLowerCase()}</b>. ${s.sub}.</p></div>
        <div class="breadth" id="breadth" title="How many of the 30 largest stocks are up or down today">${breadthHTML()}</div></section>
      <div class="itiles">${head}</div>
      ${econHTML("in")}
      <section class="panel"><div class="panel-h"><div><h2>Sectors</h2><p class="muted">Sorted by today's move. Click a sector to see its chart.</p></div></div><div class="heat sectors">${sectorHtml}</div></section>
      <section class="panel"><div class="panel-h"><div><h2>Largest companies</h2><p class="muted">30 of the biggest Nifty 50 stocks. Click a column to sort, or a company for its full fundamentals.</p></div></div>
      ${stockTable(IN.stocks, state.stockSort, "data-sk", "Price (₹)")}${fundNote()}</section>`;
    el.querySelectorAll("[data-sk]").forEach((b) => b.onclick = () => {
      state.stockSort = nextSort(state.stockSort, b.dataset.sk);
      renderIndia(el);
    });
  }

  // ── stocks: one table component for India and every other market ─────────
  const nextSort = (cur, key) => ({ key, dir: cur.key === key ? -cur.dir : (["n", "sec", "pe"].includes(key) ? 1 : -1) });
  function stockTable(list, sortState, attr, priceLabel = "Price") {
    const k = sortState.key, d = sortState.dir;
    const rows = list.map(([s, n, sec]) => ({ s, n, sec, q: Qv(s), f: state.fund[s] }));
    const val = (r) => {
      if (k === "n") return r.n;
      if (k === "sec") return r.sec;
      if (["marketCap", "pe", "divYield"].includes(k)) {
        if (!r.f) return null;
        if (k === "marketCap") return usdOf(r.f.marketCap, r.f.currency);
        if (k === "pe") return r.f.pe > 0 ? r.f.pe : null;
        return r.f.divYield || null;
      }
      return r.q[k];
    };
    rows.sort((a, b) => { const x = val(a), y = val(b); if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y) : x - y) * d; });
    const th = (key, label, r, tip) => `<th class="${r ? "r" : ""}" aria-sort="${k === key ? (d > 0 ? "ascending" : "descending") : "none"}"${tip ? ` title="${tip}"` : ""}><button ${attr}="${key}">${label}<i>${k === key ? (d > 0 ? "↑" : "↓") : ""}</i></button></th>`;
    const fc = (r, html) => (r.f ? html : fundBusy.has(r.s) ? SK : "—");
    return `<div class="tscroll"><table class="t stk"><thead><tr>${th("n", "Company")}${th("sec", "Sector")}${th("price", priceLabel, 1)}${th("changePct", "Today", 1)}${th("change1mPct", "Month", 1)}${th("pe", "P/E", 1, "Price to earnings, last 12 months")}${th("marketCap", "Market cap", 1)}${th("divYield", "Dividend", 1, "Dividend yield, last 12 months")}<th class="r">Trend</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${sym(r.s, `<b>${esc(r.n)}</b><small>${esc(tickerOf(r.s))}</small>`)}</td><td class="muted">${esc(r.sec)}</td>
        <td class="r">${px(r.s)}</td><td class="r">${chipS(r.s)}</td><td class="r">${pctT(r.s, "change1mPct")}</td>
        <td class="r">${fc(r, ratio(r.f && r.f.pe))}</td><td class="r">${fc(r, money(r.f && r.f.marketCap, r.f && r.f.currency))}</td><td class="r">${fc(r, r.f && r.f.divYield ? pctPlain(r.f.divYield, 2) : "—")}</td><td class="r">${sparkS(r.s)}</td></tr>`).join("")}
      </tbody></table></div>`;
  }
  const fundNote = () => fundErr
    ? `<p class="note">Valuations didn't load (${esc(fundErr)}). Prices still update, and valuations try again in a few minutes.</p>`
    : `<p class="note">P/E uses the last 12 months of earnings, so loss-making companies show a dash. Market caps are in each company's trading currency and sort in US dollars. Valuations come from Yahoo Finance and refresh hourly.</p>`;

  function findStockMkt(q) {
    q = q.toLowerCase();
    const m = SM.find((x) => x.stocks.some(([s, n]) => n.toLowerCase().includes(q) || tickerOf(s).toLowerCase() === q));
    return m ? m.id : null;
  }
  function renderStocks(el) {
    const m = SM.find((x) => x.id === state.stockMkt) || SM[0];
    const q = state.q.toLowerCase();
    const list = m.stocks.filter(([s, n, sec]) => !q || n.toLowerCase().includes(q) || s.toLowerCase().includes(q) || sec.toLowerCase().includes(q));
    if (q && !list.length && findStockMkt(q) && findStockMkt(q) !== m.id) { state.stockMkt = findStockMkt(q); return renderStocks(el); }
    ensureFund(m.stocks.map((x) => x[0]));
    loadExtra();
    el.innerHTML = `<div class="chips mkts" id="mkts" role="group" aria-label="Market">${SM.map((x) => `<button class="chip ${x.id === m.id ? "on" : ""}" data-mk="${x.id}" aria-pressed="${x.id === m.id}">${x.flag} ${esc(x.name)}</button>`).join("")}</div>
      <section class="panel"><div class="panel-h"><div><h2>Largest companies in ${esc(m.name)}</h2><p class="muted">Click a company for its chart, valuation, profitability and balance sheet. Click a column to sort.</p></div></div>
      ${list.length ? stockTable(list, state.stocksSort, "data-sk2") : `<div class="empty"><p>No companies in ${esc(m.name)} match “${esc(state.q)}”.</p></div>`}${fundNote()}</section>`;
    el.querySelector("#mkts").onclick = (e) => {
      const b = e.target.closest("[data-mk]");
      if (!b || b.dataset.mk === state.stockMkt) return;
      state.stockMkt = b.dataset.mk;
      const go = () => renderStocks(el);
      if (document.startViewTransition && !REDUCED) document.startViewTransition(go); else go();
    };
    el.querySelectorAll("[data-sk2]").forEach((b) => b.onclick = () => {
      state.stocksSort = nextSort(state.stocksSort, b.dataset.sk2);
      renderStocks(el);
    });
  }

  // ── main ─────────────────────────────────────────────────────────────────
  function renderMain() {
    const main = $("#main");
    $("#filters").hidden = ["map", "india", "stocks"].includes(state.view);
    if (state.view === "india") return renderIndia(main);
    if (state.view === "stocks") return renderStocks(main);
    if (state.view === "map") return renderMap(main);
    const list = filtered();
    if (!list.length) {
      main.innerHTML = `<div class="empty"><p>No markets match${state.q ? ` “${esc(state.q)}”` : ""}${state.openOnly ? " that are open right now" : ""}.</p><button class="btn" id="clear">Clear filters</button></div>`;
      $("#clear").onclick = () => { state.q = ""; $("#search").value = ""; state.openOnly = false; $("#open-only").checked = false; state.region = "All"; renderChips(); renderMain(); };
      return;
    }
    if (state.view === "cards") {
      const regs = state.region === "All" ? REGIONS.slice(1) : [state.region];
      main.innerHTML = regs.map((r) => {
        const cs = list.filter((c) => c.region === r);
        if (!cs.length) return "";
        const n = cs.filter(isLive).length;
        return `<section class="region"><h2>${r}<span>${n ? `${n} of ${cs.length} open` : "All closed"}</span></h2><div class="grid">${cs.map(card).join("")}</div></section>`;
      }).join("");
    } else if (state.view === "heat") {
      const rows = allRows(list).sort((a, b) => (b.q.changePct ?? -1e9) - (a.q.changePct ?? -1e9));
      main.innerHTML = `<section class="panel"><div class="panel-h"><div><h2>Every index, strongest to weakest</h2><p class="muted">Deeper green or red means a bigger move today.</p></div><div class="legend" aria-hidden="true"><span>−3%</span><i></i><span>+3%</span></div></div>
        <div class="heat">${rows.map((r) => `<a class="tile" href="${yurl(r.s)}" data-sym="${esc(r.s)}" data-tile="${esc(r.s)}" style="${tileStyle(r.q.changePct)}"><span class="tn">${esc(r.n)}</span><span class="tp">${pct(r.q.changePct)}</span><span class="tc">${r.c.flag} ${esc(r.c.name)}</span></a>`).join("")}</div></section>`;
    } else {
      const k = state.sort.key, d = state.sort.dir;
      const val = (r) => k === "name" ? r.n : k === "country" ? r.c.name : k === "status" ? status(r.c).kind : r.q[k];
      const rows = allRows(list).sort((a, b) => { const x = val(a), y = val(b); if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y) : x - y) * d; });
      const th = (key, label, r) => `<th class="${r ? "r" : ""}" aria-sort="${k === key ? (d > 0 ? "ascending" : "descending") : "none"}"><button data-k="${key}">${label}<i>${k === key ? (d > 0 ? "↑" : "↓") : ""}</i></button></th>`;
      main.innerHTML = `<section class="panel"><div class="tscroll"><table class="t"><thead><tr>${th("country", "Country")}${th("name", "Index")}${th("price", "Level", 1)}${th("changePct", "Today", 1)}${th("change1mPct", "Month", 1)}${th("status", "Market")}<th class="r">Trend</th></tr></thead><tbody>
        ${rows.map((r) => { const s = status(r.c); return `<tr><td><span class="flag">${r.c.flag}</span>${esc(r.c.name)}</td><td>${sym(r.s, esc(r.n))}</td>
          <td class="r">${px(r.s)}</td><td class="r">${chipS(r.s)}</td><td class="r">${pctT(r.s, "change1mPct")}</td><td><span class="mstat ${s.kind}" data-ms="${r.c.id}">${s.text}</span></td><td class="r">${sparkS(r.s)}</td></tr>`; }).join("")}
        </tbody></table></div></section>`;
      main.querySelectorAll("[data-k]").forEach((b) => b.onclick = () => {
        const key = b.dataset.k;
        state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : (["name", "country", "status"].includes(key) ? 1 : -1) };
        renderMain();
      });
    }
  }

  function breadthHTML() {
    const st = IN.stocks.map(([s]) => Qv(s).changePct);
    const adv = st.filter((v) => v > 0).length, dec = st.filter((v) => v < 0).length, unch = st.length - adv - dec;
    return `<div class="bbar"><i class="bup" style="flex:${adv}"></i><i class="bun" style="flex:${unch}"></i><i class="bdn" style="flex:${dec}"></i></div>
      <p><span class="up">${adv} up</span>, <span class="muted">${unch} flat</span>, <span class="down">${dec} down</span> among the 30 largest stocks</p>`;
  }

  // ── in-place updates ─────────────────────────────────────────────────────
  // Numbers roll from their old value to the new one; nothing else on the page moves.
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function roll(el, a, b) {
    if (REDUCED || a == null || b == null || a === b) { el.textContent = fmt(b); return; }
    const d = Math.abs(b) >= 1 ? 2 : 4, t0 = performance.now(), T = 650;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / T);
      el.textContent = fmt(a + (b - a) * ease(k), d);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    el.classList.remove("fl-up", "fl-down"); void el.offsetWidth;
    el.classList.add(b > a ? "fl-up" : "fl-down");
  }
  function patch() {
    renderStatus();
    renderHero(); // headline text, ribbon and (only if leaders changed) the highlight cards
    document.querySelectorAll("[data-px]").forEach((el) => roll(el, state.prev[el.dataset.px], Qv(el.dataset.px).price));
    document.querySelectorAll("[data-pc]").forEach((el) => {
      const v = Qv(el.dataset.pc).changePct;
      el.className = "chg " + cls(el.hasAttribute("data-inv") ? -v : v);
      el.innerHTML = pct(v);
    });
    document.querySelectorAll("[data-pt]").forEach((el) => {
      const v = Qv(el.dataset.pt)[el.dataset.f];
      if (!el.hasAttribute("data-plain")) { el.classList.remove("up", "down", "flat", "na"); el.classList.add(cls(v)); }
      el.innerHTML = v != null ? pct(v) + el.dataset.sfx : "";
    });
    document.querySelectorAll("[data-sp]").forEach((el) => { el.innerHTML = spark(Qv(el.dataset.sp).spark, +el.dataset.w, +el.dataset.h); });
    document.querySelectorAll("[data-tile]").forEach((el) => {
      const q = Qv(el.dataset.tile);
      el.setAttribute("style", tileStyle(q.changePct, +(el.dataset.max || 3)));
      el.querySelector(".tp").innerHTML = pct(q.changePct);
    });
    document.querySelectorAll("[data-facts]").forEach((el) => { el.outerHTML = facts(byId[el.dataset.facts]); });
    const br = $("#breadth"); if (br) br.innerHTML = breadthHTML();
    document.querySelectorAll("#map path[data-m], #map circle[data-m]").forEach((p) => p.setAttribute("fill", heatColor(mainMove(byId[p.dataset.m]))));
    if (modal.sym) modalPrice();
  }
  // open/closed labels change with the clock, not with prices
  function patchStatus() {
    document.querySelectorAll("[data-st]").forEach((el) => {
      const c = byId[el.dataset.st], s = status(c);
      el.innerHTML = stInner(s);
      const card = el.closest(".card"); if (card) card.className = "card " + s.kind;
    });
    document.querySelectorAll("[data-ms]").forEach((el) => { const s = status(byId[el.dataset.ms]); el.className = "mstat " + s.kind; el.textContent = s.text; });
  }

  // ── chart sheet ──────────────────────────────────────────────────────────
  const RANGES = [["1d", "1D"], ["5d", "5D"], ["1mo", "1M"], ["6mo", "6M"], ["1y", "1Y"], ["5y", "5Y"]];
  const RANGE_WORD = { "1d": "Today", "5d": "5 days", "1mo": "1 month", "6mo": "6 months", "1y": "1 year", "5y": "5 years" };
  const chartCache = {};
  const modal = { sym: null, range: "1mo", lastFocus: null };
  function openChart(s, viaKeyboard) {
    modal.sym = s; modal.lastFocus = document.activeElement;
    const m = $("#modal"); m.hidden = false; requestAnimationFrame(() => m.classList.add("in"));
    document.body.classList.add("locked");
    drawModal();
    setTimeout(() => (viaKeyboard ? $("#m-close") : $(".mbox")).focus({ preventScroll: true }), 50);
  }
  function closeChart() {
    const m = $("#modal"); m.classList.remove("in");
    setTimeout(() => { m.hidden = true; }, REDUCED ? 0 : 220);
    document.body.classList.remove("locked"); modal.sym = null;
    if (modal.lastFocus) modal.lastFocus.focus({ preventScroll: true });
  }
  // promises are cached too, so a hover-prefetch and the click share one request
  function getChart(s, range) {
    const key = s + "|" + range, hit = chartCache[key];
    if (hit && Date.now() - hit.t < 60_000) return hit.p;
    const p = fetch(`/api/chart?symbol=${encodeURIComponent(s)}&range=${range}`).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
      return d;
    });
    chartCache[key] = { t: Date.now(), p };
    p.catch(() => delete chartCache[key]);
    return p;
  }
  function modalPrice() {
    const q = state.quotes[modal.sym] || {};
    $("#m-price").innerHTML = `<span class="m-p">${fmt(q.price)}</span>${chip(q.changePct)}<span class="muted">today</span>`;
  }
  async function drawModal() {
    const s = modal.sym, range = modal.range, nm = NAMES[s] || { name: s, sub: "" };
    $("#m-title").innerHTML = `<h2>${esc(nm.name)}</h2><p class="muted">${esc(nm.sub)}</p>`;
    $("#m-ranges").innerHTML = RANGES.map(([k, l]) => `<button data-r="${k}" role="tab" aria-selected="${k === range}" class="${k === range ? "on" : ""}">${l}</button>`).join("");
    $("#m-yahoo").href = yurl(s);
    modalPrice();
    drawFund(s);
    const p = getChart(s, range);
    // only show the placeholder if the data isn't already here
    let settled = false; p.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    if (!settled) { $("#m-chart").innerHTML = '<div class="chart-sk"></div>'; $("#m-stats").innerHTML = ""; }
    try {
      const d = await p;
      if (modal.sym !== s || modal.range !== range) return;
      drawSvgChart(d, range);
      const rc = d.price != null && d.prevClose ? ((d.price - d.prevClose) / d.prevClose) * 100 : null;
      const rng = (lo, hi, v) => (lo != null && hi != null && v != null && hi > lo)
        ? `<div class="rbar"><i style="left:${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%"></i></div><div class="rlab"><span>${fmt(lo)}</span><span>${fmt(hi)}</span></div>` : '<p class="muted">Not available</p>';
      $("#m-stats").innerHTML = `
        <div><dt>${RANGE_WORD[range]}</dt><dd class="big ${cls(rc)}">${pct(rc)}</dd></div>
        <div><dt>Today's range</dt>${rng(d.dayLow, d.dayHigh, d.price)}</div>
        <div><dt>52-week range</dt>${rng(d.low52, d.high52, d.price)}</div>
        <div><dt>Below 52-week high</dt><dd class="big ${cls(d.high52 ? d.price - d.high52 : null)}">${d.high52 ? pct(((d.price - d.high52) / d.high52) * 100) : "—"}</dd></div>`;
    } catch (e) {
      $("#m-chart").innerHTML = `<div class="empty">The chart didn't load (${esc(e.message)}). Pick a range to try again.</div>`;
    }
  }
  // company fundamentals under the chart (stocks only; indices and currencies have none)
  async function drawFund(s) {
    const box = $("#m-fund");
    if (!STOCK_SET.has(s)) { box.innerHTML = ""; box.dataset.s = ""; return; }
    if (box.dataset.s === s) return; // already showing; range changes don't touch it
    box.dataset.s = s;
    box.innerHTML = '<div class="fund-sk"></div>';
    try {
      const f = await getFundDetail(s);
      if (modal.sym === s) box.innerHTML = fundHTML(f, s);
    } catch (e) {
      box.dataset.s = "";
      if (modal.sym === s) box.innerHTML = `<p class="note">Fundamentals didn't load (${esc(e.message)}). Close the chart and open it again to retry.</p>`;
    }
  }
  const RATING = { strong_buy: "Strong buy", buy: "Buy", hold: "Hold", underperform: "Underperform", sell: "Sell", strong_sell: "Strong sell" };
  function fundHTML(f, s) {
    const c = f.currency, rc = f.reportingCurrency || c;
    const item = (k, v, hint) => `<div><dt>${k}</dt><dd>${v}</dd>${hint ? `<dd class="d">${hint}</dd>` : ""}</div>`;
    const grp = (title, items) => `<section class="fgrp"><h4>${title}</h4><dl>${items.join("")}</dl></section>`;
    const sg = (v) => (v == null || !isFinite(v) ? "—" : `<span class="${cls(v)}">${(v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1)}%</span>`);
    const p0 = Qv(s).price, up = f.target && p0 ? ((f.target - p0) / p0) * 100 : null;
    const what = [f.sector, f.industry].filter(Boolean).join(", ");
    const bits = [what, f.employees ? Math.round(f.employees).toLocaleString("en-US") + " employees" : "", f.country ? "based in " + esc(f.country) : ""].filter(Boolean);
    return `<div class="fund-h"><h3>Fundamentals</h3>${bits.length ? `<p class="muted">${esc(bits.join(", ")).replace(/&amp;/g, "&")}</p>` : ""}${f.about ? `<p class="about">${esc(f.about)}</p>` : ""}</div>
      <div class="fgrid">
        ${grp("Valuation", [item("Market cap", money(f.marketCap, c)), item("P/E", ratio(f.pe), "last 12 months"), item("Forward P/E", ratio(f.fpe), "next 12 months"), item("Price to book", ratio(f.pb, 2)), item("Price to sales", ratio(f.ps, 2)), item("EV to EBITDA", ratio(f.evEbitda)), item("Earnings per share", f.eps != null ? fmt(f.eps, 2) : "—", "last 12 months"), item("Dividend yield", f.divYield ? pctPlain(f.divYield, 2) : "—", f.payout ? Math.round(f.payout) + "% of profit paid out" : "")])}
        ${grp("Profitability", [item("Return on equity", pctPlain(f.roe)), item("Return on assets", pctPlain(f.roa)), item("Gross margin", pctPlain(f.grossMargin)), item("Operating margin", pctPlain(f.operatingMargin)), item("Net margin", pctPlain(f.profitMargin)), item("Beta", f.beta != null ? f.beta.toFixed(2) : "—", "swing vs the market")])}
        ${grp("Growth", [item("Revenue growth", sg(f.revenueGrowth), "vs a year ago"), item("Earnings growth", sg(f.earningsGrowth), "vs a year ago"), item("Revenue", money(f.revenue, rc), "last 12 months"), item("Free cash flow", money(f.freeCashflow, rc), "last 12 months")])}
        ${grp("Balance sheet", [item("Cash", money(f.cash, rc)), item("Debt", money(f.debt, rc)), item("Debt to equity", f.debtToEquity != null ? f.debtToEquity.toFixed(2) + "×" : "—"), item("Current ratio", f.currentRatio != null ? f.currentRatio.toFixed(2) : "—", "short-term assets ÷ liabilities")])}
        ${f.rating || f.target ? grp("Analysts", [item("Consensus", RATING[f.rating] || "—", f.analysts ? f.analysts + " analysts" : ""), item("Average price target", f.target ? fmt(f.target) : "—", up != null ? `${up >= 0 ? "+" : "−"}${Math.abs(up).toFixed(1)}% from the current price` : "")]) : ""}
      </div><p class="note">From Yahoo Finance. Company financials are reported in ${esc(rc)}.</p>`;
  }

  function drawSvgChart(d, range) {
    const box = $("#m-chart"), pts = d.points || [];
    if (pts.length < 2) { box.innerHTML = '<div class="empty">Yahoo Finance has no history for this range. Try a longer one.</div>'; return; }
    const W = box.clientWidth || 760, H = Math.min(320, Math.max(220, Math.round(W * 0.42))), L = 4, R = 58, T = 14, B = 26;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (range === "1d" && d.prevClose) { lo = Math.min(lo, d.prevClose); hi = Math.max(hi, d.prevClose); }
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const X = (i) => L + (i / (pts.length - 1)) * (W - L - R);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const base = range === "1d" && d.prevClose ? d.prevClose : ys[0];
    const col = ys[ys.length - 1] >= base ? "var(--up)" : "var(--down)";
    const line = pts.map((p, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p[1]).toFixed(1)).join("");
    const area = line + `L${X(pts.length - 1).toFixed(1)} ${H - B}L${X(0).toFixed(1)} ${H - B}Z`;
    const nice = (n) => { const e = Math.pow(10, Math.floor(Math.log10(n))), f = n / e; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e; };
    const step = nice((hi - lo) / 4);
    let grid = "";
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${W - R + 8}" y="${Y(v) + 4}" class="gt">${fmt(v, step < 1 ? 2 : 0)}</text>`;
    const tz = d.tz || "UTC";
    const fmtX = (t) => {
      const dt = new Date(t * 1000);
      if (range === "1d") return dt.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
      if (range === "5d") return dt.toLocaleDateString("en-GB", { timeZone: tz, weekday: "short" });
      if (range === "5y") return dt.toLocaleDateString("en-GB", { timeZone: tz, year: "numeric" });
      if (range === "1y") return dt.toLocaleDateString("en-GB", { timeZone: tz, month: "short", year: "2-digit" });
      return dt.toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "short" });
    };
    let xl = "";
    const nT = Math.min(W < 500 ? 4 : 6, pts.length);
    for (let k = 0; k < nT; k++) { const i = Math.round((k / (nT - 1)) * (pts.length - 1)); xl += `<text x="${X(i)}" y="${H - 6}" class="gt" text-anchor="${k === 0 ? "start" : k === nT - 1 ? "end" : "middle"}">${fmtX(xs[i])}</text>`; }
    const prev = range === "1d" && d.prevClose ? `<line x1="${L}" x2="${W - R}" y1="${Y(d.prevClose)}" y2="${Y(d.prevClose)}" class="prev"/><text x="${L + 4}" y="${Y(d.prevClose) - 6}" class="gt">Yesterday's close</text>` : "";
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" id="m-svg" role="img" aria-label="Price chart">
      <defs><linearGradient id="gfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".3"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      ${grid}${prev}<path d="${area}" fill="url(#gfill)" class="area"/><path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" class="line" pathLength="1"/>${xl}
      <g id="hov" visibility="hidden"><line id="hx" y1="${T}" y2="${H - B}" class="cross"/><circle id="hc" r="5" fill="${col}" stroke="var(--panel)" stroke-width="2.5"/></g>
      <rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent" id="hit"/></svg><div id="m-tip" class="tip" hidden></div>`;
    const svg = $("#m-svg"), hov = $("#hov"), tip = $("#m-tip");
    const move = (clientX) => {
      const r = svg.getBoundingClientRect();
      const x = ((clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(((x - L) / (W - L - R)) * (pts.length - 1))));
      hov.setAttribute("visibility", "visible");
      $("#hx").setAttribute("x1", X(i)); $("#hx").setAttribute("x2", X(i));
      $("#hc").setAttribute("cx", X(i)); $("#hc").setAttribute("cy", Y(ys[i]));
      const ch = ((ys[i] - base) / base) * 100;
      const intraday = range === "1d" || range === "5d";
      const when = new Date(xs[i] * 1000).toLocaleString("en-GB", { timeZone: tz, day: "numeric", month: "short", year: intraday ? undefined : "numeric", hour: intraday ? "2-digit" : undefined, minute: intraday ? "2-digit" : undefined });
      tip.hidden = false;
      tip.innerHTML = `<b>${fmt(ys[i])}</b> <span class="${cls(ch)}">${pct(ch)}</span><span class="muted">${when}</span>`;
      const pxl = (X(i) / W) * r.width;
      tip.style.left = Math.max(0, Math.min(pxl - 70, r.width - 160)) + "px";
      tip.style.top = Math.max(0, (Y(ys[i]) / H) * r.height - 66) + "px";
    };
    const hit = $("#hit");
    hit.addEventListener("mousemove", (e) => move(e.clientX));
    hit.addEventListener("touchmove", (e) => { move(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
    const hide = () => { hov.setAttribute("visibility", "hidden"); tip.hidden = true; };
    hit.addEventListener("mouseleave", hide); hit.addEventListener("touchend", hide);
  }

  // ── render & controls ────────────────────────────────────────────────────
  function render() {
    renderHighlights.key = null;
    renderStatus(); renderHero(); renderStrip(); renderMain();
    if (modal.sym) modalPrice();
  }
  function renderChips() {
    $("#regions").innerHTML = REGIONS.map((r) => `<button class="chip ${r === state.region ? "on" : ""}" data-r="${r}" aria-pressed="${r === state.region}">${r === "All" ? "All regions" : r}</button>`).join("");
  }
  function moveInk() {
    const b = document.querySelector(`#views button[data-view="${state.view}"]`), ink = $("#tab-ink");
    if (!b || !ink) return;
    ink.style.width = b.offsetWidth + "px";
    ink.style.transform = `translateX(${b.offsetLeft}px)`;
    if (b.scrollIntoView && window.innerWidth < 700) b.scrollIntoView({ inline: "center", block: "nearest", behavior: REDUCED ? "auto" : "smooth" });
  }
  function setView(v, opts = {}) {
    state.view = v;
    document.querySelectorAll("#views button").forEach((x) => { const on = x.dataset.view === v; x.classList.toggle("on", on); x.setAttribute("aria-selected", on); });
    moveInk();
    try { history.replaceState(null, "", v === "cards" ? location.pathname : "#" + v); } catch (e) {}
    const go = () => renderMain();
    if (document.startViewTransition && !REDUCED && !opts.instant) document.startViewTransition(go); else go();
  }
  function goToRegion(r) {
    state.region = r; renderChips();
    setView("cards");
    const t = document.querySelector(".tabs-wrap");
    if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 8, behavior: REDUCED ? "auto" : "smooth" });
  }

  // ── themes ───────────────────────────────────────────────────────────────
  const THEMES = [
    ["auto", "Match my device", ["#0f1726", "#f6f7f9", "#f6b94c"]],
    ["night", "Night", ["#0f1726", "#151f33", "#f6b94c"]],
    ["graphite", "Graphite", ["#121314", "#1d1e21", "#5ccfe6"]],
    ["ocean", "Ocean", ["#06232a", "#0b3038", "#7ce0c3"]],
    ["day", "Daylight", ["#f6f7f9", "#ffffff", "#2563eb"]],
  ];
  const dark = window.matchMedia("(prefers-color-scheme: light)");
  function applyTheme() {
    const pick = store.get("wm-theme") || "auto";
    const t = pick === "auto" ? (dark.matches ? "day" : "night") : pick;
    document.documentElement.dataset.theme = t;
    if (store.get("wm-cb")) document.documentElement.dataset.cb = "1"; else delete document.documentElement.dataset.cb;
    const meta = document.querySelector('meta[name="theme-color"]');
    readPalette();
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    const pop = $("#theme-pop");
    if (pop) {
      pop.querySelectorAll("[data-theme-pick]").forEach((b) => b.setAttribute("aria-checked", b.dataset.themePick === pick));
      $("#cb-toggle").checked = !!store.get("wm-cb");
    }
  }
  function toggleThemes(open) {
    const pop = $("#theme-pop"), btn = $("#theme-btn");
    const show = open ?? pop.hidden;
    pop.hidden = !show; btn.setAttribute("aria-expanded", show);
    if (show) requestAnimationFrame(() => pop.classList.add("in")); else pop.classList.remove("in");
  }
  $("#theme-list").innerHTML = THEMES.map(([id, name, sw]) => `<button role="radio" data-theme-pick="${id}" class="tp-item"><span class="sw" style="--a:${sw[0]};--b:${sw[1]};--c:${sw[2]}"></span>${name}</button>`).join("");
  $("#theme-btn").onclick = (e) => { e.stopPropagation(); toggleThemes(); };
  $("#theme-pop").onclick = (e) => {
    e.stopPropagation();
    const b = e.target.closest("[data-theme-pick]");
    if (!b) return;
    store.set("wm-theme", b.dataset.themePick);
    const go = () => { applyTheme(); render(); };
    if (document.startViewTransition && !REDUCED) document.startViewTransition(go); else go();
  };
  $("#cb-toggle").onchange = (e) => { store.set("wm-cb", e.target.checked); applyTheme(); render(); };
  document.addEventListener("click", (e) => { if (!$("#theme-pop").hidden && !e.target.closest("#theme-pop")) toggleThemes(false); });
  dark.addEventListener("change", () => { if ((store.get("wm-theme") || "auto") === "auto") { applyTheme(); render(); } });
  applyTheme();

  renderChips();
  $("#regions").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; state.region = b.dataset.r; renderChips(); renderMain(); };
  $("#views").onclick = (e) => { const b = e.target.closest("button"); if (b) setView(b.dataset.view); };
  $("#ribbon").onclick = (e) => { const b = e.target.closest("[data-region]"); if (b) goToRegion(b.dataset.region); };
  // ── search: results drop down under the box, so they're visible wherever you are on the page ──
  const IDX = [];
  const seenCcy = new Set();
  const CCY_NAME = { CAD: "Canadian dollar", BRL: "Brazilian real", MXN: "Mexican peso", ARS: "Argentine peso", CLP: "Chilean peso", GBP: "British pound sterling", EUR: "Euro", CHF: "Swiss franc", SEK: "Swedish krona", PLN: "Polish zloty", TRY: "Turkish lira", SAR: "Saudi riyal", AED: "UAE dirham", ILS: "Israeli shekel", ZAR: "South African rand", EGP: "Egyptian pound", INR: "Indian rupee", CNY: "Chinese yuan renminbi", HKD: "Hong Kong dollar", JPY: "Japanese yen", KRW: "South Korean won", TWD: "Taiwan dollar", SGD: "Singapore dollar", AUD: "Australian dollar", NZD: "New Zealand dollar", IDR: "Indonesian rupiah", MYR: "Malaysian ringgit", THB: "Thai baht", PHP: "Philippine peso", VND: "Vietnamese dong", PKR: "Pakistani rupee" };
  M.forEach((c) => {
    IDX.push({ k: "c", c, name: c.name, icon: c.flag, sub: `${c.exchange}, ${c.ccy}`, hay: [c.name, c.exchange, c.ccy, ...c.indices.map((x) => x[1])].join(" ").toLowerCase() });
    if (c.ccy !== "USD" && !seenCcy.has(c.ccy)) {
      seenCcy.add(c.ccy);
      NAMES[c.ccy + "=X"] = { name: `${CCY_NAME[c.ccy] || c.ccy} (${c.ccy})`, sub: `${c.flag} ${c.ccy} per US dollar` };
    }
  });
  const FLAG = /^([\u{1F1E6}-\u{1F1FF}]{2}|🌏)\s*/u;
  Object.entries(NAMES).forEach(([s, n]) => {
    const m = n.sub.match(FLAG);
    const ccyOf = s.endsWith("=X") ? M.filter((c) => c.ccy + "=X" === s).map((c) => c.name + " " + (CCY_NAME[c.ccy] || "")).join(" ") + " currency forex fx usd dollar" : "";
    IDX.push({ k: "s", s, name: n.name, icon: m ? m[1] : "", sub: n.sub.replace(FLAG, ""), tick: tickerOf(s).toLowerCase(), hay: (n.name + " " + s + " " + n.sub + " " + ccyOf).toLowerCase() });
  });
  function searchHits(q) {
    q = q.toLowerCase().trim();
    if (!q) return [];
    const words = q.split(/[\s/,]+/).filter(Boolean);
    const hits = [];
    for (const it of IDX) {
      const nm = it.name.toLowerCase();
      let sc = nm.startsWith(q) || it.tick === q ? 0 : (" " + nm).includes(" " + q) ? 1 : it.hay.includes(q) ? 2 : words.every((w) => it.hay.includes(w)) ? 3 : -1;
      if (sc < 0) continue;
      if (it.k === "c") sc -= 0.5; // countries first when equally good
      hits.push([sc, it]);
    }
    return hits.sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length).slice(0, 8).map((x) => x[1]);
  }
  const sbox = $("#search");
  const spop = document.createElement("div");
  spop.id = "search-pop"; spop.className = "search-pop"; spop.hidden = true; spop.setAttribute("role", "listbox");
  document.body.appendChild(spop);
  let hits = [], active = 0;
  function placePop() {
    const r = sbox.closest(".search").getBoundingClientRect();
    const w = Math.min(Math.max(r.width, 380), window.innerWidth - 24);
    spop.style.top = r.bottom + 8 + "px";
    spop.style.left = Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12)) + "px";
    spop.style.width = w + "px";
  }
  function drawPop() {
    const q = sbox.value.trim();
    if (!q) { spop.hidden = true; sbox.setAttribute("aria-expanded", "false"); return; }
    hits = searchHits(q);
    active = Math.min(active, Math.max(0, hits.length - 1));
    spop.innerHTML = hits.length ? hits.map((it, i) => {
      const s = it.k === "c" ? it.c.indices[0][0] : it.s, qq = Qv(s);
      const right = qq.price != null ? `<span class="sp-r">${it.k === "c" ? `<small>${esc(it.c.indices[0][1])}</small>` : fmt(qq.price)}${chip(qq.changePct)}</span>` : "";
      return `<button class="sp-item ${i === active ? "on" : ""}" data-i="${i}" role="option" aria-selected="${i === active}"><span class="sp-ic">${it.icon}</span><span class="sp-t"><b>${esc(it.name)}</b><small>${esc(it.k === "c" ? "Country, " + it.sub : it.sub)}</small></span>${right}</button>`;
    }).join("") : `<p class="sp-empty">Nothing matches “${esc(q)}”. Try a country, an index, a company or a currency.</p>`;
    placePop();
    spop.hidden = false; sbox.setAttribute("aria-expanded", "true");
  }
  function closePop() { spop.hidden = true; sbox.setAttribute("aria-expanded", "false"); }
  function choose(it) {
    if (!it) return;
    closePop(); sbox.value = ""; sbox.blur();
    if (it.k === "s") return openChart(it.s);
    // a country: show its card, wherever the filters were
    state.q = ""; state.region = "All"; state.openOnly = false; $("#open-only").checked = false; renderChips();
    setView("cards", { instant: true });
    requestAnimationFrame(() => {
      const card = $("#c-" + it.c.id);
      if (!card) return;
      card.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "center" });
      card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
    });
  }
  sbox.setAttribute("aria-controls", "search-pop"); sbox.setAttribute("aria-autocomplete", "list");
  sbox.oninput = () => { active = 0; drawPop(); };
  sbox.onfocus = () => { if (sbox.value.trim()) drawPop(); };
  sbox.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!hits.length) return;
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      drawPop();
      const on = spop.querySelector(".sp-item.on"); if (on) on.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") { e.preventDefault(); choose(hits[active]); }
    else if (e.key === "Escape") { e.stopPropagation(); closePop(); sbox.blur(); }
  });
  spop.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the box while clicking
  spop.addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) choose(hits[+b.dataset.i]); });
  document.addEventListener("click", (e) => { if (!spop.hidden && !e.target.closest("#search-pop") && !e.target.closest(".search")) closePop(); });
  window.addEventListener("resize", () => { if (!spop.hidden) placePop(); });
  window.addEventListener("scroll", () => { if (!spop.hidden) placePop(); }, { passive: true });
  $("#open-only").onchange = (e) => { state.openOnly = e.target.checked; renderMain(); };
  $("#refresh").onclick = load;
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-sym]");
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return; // modifier-click still opens Yahoo
    e.preventDefault();
    openChart(a.dataset.sym, e.detail === 0);
  });
  $("#m-ranges").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; modal.range = b.dataset.r; drawModal(); };
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.closest("#m-close")) closeChart(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#theme-pop") && !$("#theme-pop").hidden) return toggleThemes(false);
    if (e.key === "Escape" && modal.sym) return closeChart();
    if (modal.sym && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const i = RANGES.findIndex((r) => r[0] === modal.range) + (e.key === "ArrowRight" ? 1 : -1);
      if (i >= 0 && i < RANGES.length) { e.preventDefault(); modal.range = RANGES[i][0]; drawModal(); }
      return;
    }
    if (e.key === "/" && document.activeElement.tagName !== "INPUT") { e.preventDefault(); $("#search").focus(); }
  });

  // load a chart while the pointer rests on its row, so the click opens instantly
  if (window.matchMedia("(hover: hover)").matches) {
    let ht;
    document.addEventListener("pointerover", (e) => {
      const a = e.target.closest("[data-sym]");
      clearTimeout(ht);
      if (a) ht = setTimeout(() => {
        getChart(a.dataset.sym, modal.range).catch(() => {});
        if (STOCK_SET.has(a.dataset.sym)) getFundDetail(a.dataset.sym).catch(() => {});
      }, 120);
    });
  }

  // phones: drag the sheet down to close it
  (() => {
    const box = $(".mbox");
    let y0 = null, dy = 0;
    box.addEventListener("touchstart", (e) => {
      const fromTop = e.touches[0].clientY - box.getBoundingClientRect().top;
      if (box.scrollTop > 0 || fromTop > 90 || window.innerWidth > 760) return;
      y0 = e.touches[0].clientY; dy = 0; box.style.transition = "none";
    }, { passive: true });
    box.addEventListener("touchmove", (e) => {
      if (y0 == null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      box.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    box.addEventListener("touchend", () => {
      if (y0 == null) return;
      box.style.transition = ""; box.style.transform = "";
      if (dy > 90) closeChart();
      y0 = null;
    });
  })();
  let rz;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { moveInk(); if (state.view === "map") renderMain(); if (modal.sym) drawModal(); }, 200); });

  const rs = window.REF_SOURCES;
  $("#ref-sources").textContent = `policy rates from ${rs.policy}; 10-year yields from ${rs.y10}; market sizes from ${rs.mcap}; economy figures from the ${window.MACRO_SOURCE || "IMF"}`;

  const initial = location.hash.slice(1);
  if (["map", "heat", "table", "stocks", "india"].includes(initial)) setView(initial, { instant: true });
  render();
  requestAnimationFrame(moveInk);
  if (document.fonts) document.fonts.ready.then(moveInk);
  load();
  setInterval(load, REFRESH_MS);
  setInterval(() => { renderHero(); patchStatus(); if (state.view === "map") renderTimeline($("#timeline")); }, 30_000);
})();
