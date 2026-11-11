(() => {
  const REFRESH_MS = 60_000;
  const M = window.MARKETS, G = window.GLOBAL, IN = window.INDIA;
  const REGIONS = ["All", "Americas", "Europe", "Middle East & Africa", "Asia-Pacific"];
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = { quotes: {}, prev: {}, region: "All", view: "cards", q: "", openOnly: false, sort: { key: "changePct", dir: -1 }, stockSort: { key: "changePct", dir: -1 }, fetchedAt: null, mock: false, error: null, hadData: false, stale: false, fund: {}, fundT: {}, stockMkt: "us", stocksSort: { key: "marketCap", dir: -1 }, calKind: "all", calDays: 45 };
  // accounts (auth.js): most of the site needs a signed-in visitor; the homepage stays open as a preview
  const AU = window.WMAuth || { user: null, known: true, ready: Promise.resolve(null), onChange() {}, token: async () => null, load: async () => null, save: async () => {} };
  const authed = () => !!AU.user;
  // email accounts confirm their address before anything is saved to them (Google accounts already have)
  const unverified = () => !!AU.user && AU.user.verified === false;
  const LOCKED = ["mine"]; // market data is open to everyone; the account holds what is personal
  async function authFetch(url) {
    const t = await AU.token().catch(() => null);
    const r = await fetch(url, t ? { headers: { Authorization: "Bearer " + t } } : {});
    if (r.status === 429) toast("Too many requests from this device. Wait a minute and try again.");
    return r;
  }
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
  // the visitor's watchlist: [{ s: symbol, n: name, sub }], kept in this browser
  const watch = (store.get("wm-watch") || []).filter((w) => w && w.s).slice(0, 60);
  watch.forEach((w) => { NAMES[w.s] = NAMES[w.s] || { name: w.n || w.s, sub: w.sub || "" }; if (w.stock) STOCK_SET.add(w.s); });

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
  // currency signs: shares, commodities, currencies and crypto get their currency; index levels are points, yields are %
  const INDEX_SET = new Set(["DX-Y.NYB"]);
  M.forEach((c) => c.indices.forEach(([x]) => INDEX_SET.add(x)));
  IN.headline.forEach(([x]) => INDEX_SET.add(x));
  IN.sectors.forEach(([x]) => INDEX_SET.add(x));
  const curOf = (s) => C.currencyOf(s, Qv(s).currency);
  const affix = (s) => C.affix(s, Qv(s).currency, INDEX_SET.has(s));
  // a price as text with its sign, for one-off places (search lists, chart sheet)
  const money2 = (s, v, d) => { if (v == null || !isFinite(v)) return fmt(v, d); const [a, b] = affix(s); return a + fmt(v, d) + b; };
  const affixAttrs = (s) => { const [a, b] = affix(s); return `data-pre="${esc(a)}" data-suf="${esc(b)}"`; };
  const px = (s, d) => `<span class="px" data-px="${esc(s)}" ${affixAttrs(s)}>${fmt((state.quotes[s] || {}).price, d)}</span>`;
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

  // ── time zones & market hours (logic lives in lib/core.js) ───────────────
  const C = window.WMCore;
  const HOL = window.HOLIDAYS || {};
  const { localParts, tzOffsetMin, toMin, dur, ymd, sessionsOn } = C;
  const holidayOn = (c, date) => C.holidayOn(c, date, HOL);
  const status = (c) => C.status(c, HOL);
  const isLive = (c) => ["open", "lunch"].includes(status(c).kind);

  // ── data ─────────────────────────────────────────────────────────────────
  async function load() {
    const btn = $("#refresh");
    btn.classList.add("spin");
    try {
      const want = [...new Set([...symbols, ...extraSyms(), ...watch.map((w) => w.s)])].slice(0, 200);
      const r = await fetch("/api/quotes?symbols=" + encodeURIComponent(want.join(",")));
      if (!r.ok) throw new Error("the price service answered " + r.status);
      const j = await r.json();
      state.prev = Object.fromEntries(Object.entries(state.quotes).map(([k, v]) => [k, v && v.price]));
      // keep the last good value for any symbol that failed this round, and count the failures
      const fresh = j.quotes || {};
      let failed = 0;
      for (const k in fresh) if (fresh[k] && fresh[k].price == null) {
        failed++;
        if (state.quotes[k] && state.quotes[k].price != null) fresh[k] = state.quotes[k];
      }
      state.failed = failed;
      state.asked = want.length;
      // anything loaded on the side (another market's stocks) stays until the next refresh replaces it
      for (const k in state.quotes) if (!fresh[k]) fresh[k] = state.quotes[k];
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
  const extraSyms = () => (state.view === "stocks" ? stockList().map((x) => x[0]) : state.view === "india" ? (IN.adrs || []).flatMap(([a, n]) => [a, n]) : []).filter((s) => !symbols.has(s));
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
    if (["stocks", "india"].includes(state.view)) renderMain();
  }

  // ── fundamentals ─────────────────────────────────────────────────────────
  const fundBusy = new Set();
  let fundErr = null;
  function ensureFund(list) {
    const all = list.filter((s) => !fundBusy.has(s) && !(state.fundT[s] && Date.now() - state.fundT[s] < 3600e3));
    for (let i = 0; i < all.length; i += 50) fundBatch(all.slice(i, i + 50)); // the service takes up to 60 at a time
  }
  function fundBatch(need) {
    if (!need.length) return;
    need.forEach((s) => fundBusy.add(s));
    authFetch("/api/fundamentals?symbols=" + encodeURIComponent(need.join(","))).then(async (r) => {
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
      if (["stocks", "india", "cal"].includes(state.view)) renderMain();
    });
  }
  const fundDetail = {};
  function getFundDetail(s) {
    const hit = fundDetail[s];
    if (hit && Date.now() - hit.t < 3600e3) return hit.p;
    const p = authFetch("/api/fundamentals?symbol=" + encodeURIComponent(s)).then(async (r) => {
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
    return `<div class="econ" title="${esc(window.MACRO_SOURCE || "IMF")}"><p class="econ-h">Economy in 2026<span>${gdp} GDP</span></p><p class="econ-src muted">IMF estimates, World Economic Outlook, October 2026</p>
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
    if (ind.holiday) parts.push(`Indian markets are closed today for ${ind.holiday} and open in ${dur(ind.mins)}.`);
    else if (![closing, opening].some((m) => m && m.id === "in")) parts.push(ind.kind === "closed" ? `Indian markets open in ${dur(ind.mins)}.` : `Indian markets close in ${dur(ind.mins)}.`);
    // other big markets shut for a holiday today
    const hols = majors.filter((m) => m.id !== "in" && m.s.holiday).map((m) => `${CITY[m.id]} (${m.s.holiday})`);
    if (hols.length) parts.push(`Closed today for holidays: ${listJoin(hols)}.`);
    const early = majors.filter((m) => m.s.early).map((m) => CITY[m.id]);
    if (early.length) parts.push(`${listJoin(early)} ${early.length > 1 ? "close" : "closes"} early today.`);
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

  // ── watchlist ────────────────────────────────────────────────────────────
  function renderWatch() {
    const el = $("#watch");
    if (!el) return;
    // visitors get one line on what an account adds, until they close it
    if (!authed()) {
      el.hidden = !AU.known || !!store.get("wm-join-x") || !!AU.unavailable;
      el.innerHTML = el.hidden ? "" : `<div class="join"><p><b>Make your own list.</b> A free account keeps the markets you follow at the top of this page and tracks what you've bought, on your phone and laptop.</p>
        <button class="btn primary" data-signin="join">Create a free account</button><button class="mc-x join-x" aria-label="Close" data-joinx><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div>`;
      return;
    }
    el.hidden = !watch.length;
    if (el.hidden) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="watch-h"><h2>My markets</h2><button class="linkbtn" data-goview="mine">Add or remove</button></div>
      <div class="watch-row">${watch.map((w) => `<a class="wcard" href="${yurl(w.s)}" data-sym="${esc(w.s)}">
        <span class="wc-n">${esc(w.n || w.s)}</span><span class="wc-s">${esc(tickerOf(w.s))}</span>
        <span class="wc-row"><span class="wc-p">${px(w.s)}</span>${chipS(w.s)}</span>${sparkS(w.s, 150, 28)}</a>`).join("")}</div>`;
  }
  const isWatched = (s) => watch.some((w) => w.s === s);
  function toggleWatch(s, quiet) {
    if (!authed()) return openAuth("watch");
    if (unverified()) { setView("mine"); return toast("Confirm your email first. The link is in your inbox."); }
    const i = watch.findIndex((w) => w.s === s);
    if (i >= 0) { watch.splice(i, 1); if (!quiet) toast(`Removed ${NAMES[s] ? NAMES[s].name : s} from My markets`); }
    else {
      if (watch.length >= 60) return toast("My markets is full at 60. Remove one first.");
      const nm = NAMES[s] || { name: s, sub: "" };
      watch.push({ s, n: nm.name, sub: nm.sub, stock: STOCK_SET.has(s) || undefined });
      toast(`Added ${nm.name} to My markets`);
      if (!state.quotes[s]) quoteFor([s]).then(renderWatch);
    }
    store.set("wm-watch", watch);
    syncSave();
    renderWatch();
    starBtn();
  }
  // one-off quotes for symbols outside the regular refresh (watchlist adds, searched stocks)
  async function quoteFor(list) {
    try {
      const j = await fetch("/api/quotes?symbols=" + encodeURIComponent(list.join(","))).then((r) => r.json());
      Object.assign(state.quotes, j.quotes || {});
    } catch (e) { /* the next refresh will try again */ }
  }
  let toastT;
  function toast(msg) {
    let el = $("#toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add("in");
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("in"), 2600);
  }

  function renderStatus() {
    const el = $("#status-line");
    if (state.error) { el.textContent = `Prices didn't load because ${state.error}. Retrying in a minute.`; el.classList.add("err"); }
    else if (state.stale) { el.textContent = `Showing prices from ${new Date(state.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Updating…`; el.classList.remove("err"); }
    else if (state.fetchedAt && state.failed > Math.max(5, (state.asked || 0) * 0.2)) {
      // the price source is partly down: say so rather than quietly showing old numbers
      el.textContent = `Updated ${new Date(state.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, but ${state.failed} prices didn't update and show their last known value`;
      el.classList.add("err");
    }
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
      const lp = localParts(c.tz, now), off = tzOffsetMin(c.tz, now), segs = [];
      const hol = holidayOn(c, ymd(lp.y, lp.mo, lp.d));
      const today = c.days.includes(lp.wd) && !(hol && hol.early == null);
      sessionsOn(c, hol).forEach(([a, b]) => {
        const s = (a - off + vo + 2880) % 1440, e = s + (b - a);
        if (e <= 1440) segs.push([s, e]); else { segs.push([s, 1440]); segs.push([0, e - 1440]); }
      });
      const note = hol && hol.early == null && c.days.includes(lp.wd) ? `Closed for ${hol.name}` : !today ? "No session today" : hol ? `Early close, ${hol.name}` : "";
      return { c, segs, today, note, first: (toMin(c.sessions[0][0]) - off + vo + 2880) % 1440, st: status(c) };
    }).sort((a, b) => a.first - b.first);
    el.innerHTML = `<div class="tl">
      <div class="tl-row tl-axis"><div class="tl-l"></div><div class="tl-track">${[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => `<span style="left:${(h / 24) * 100}%">${String(h % 24).padStart(2, "0")}:00</span>`).join("")}</div></div>
      ${rows.map((r) => `<div class="tl-row"><div class="tl-l"><span class="flag">${r.c.flag}</span>${esc(r.c.name)}</div>
        <div class="tl-track">${r.segs.map(([s, e]) => `<div class="tl-bar ${r.st.kind === "open" ? "on" : ""} ${r.today ? "" : "off"}" style="left:${(s / 1440) * 100}%;width:${((e - s) / 1440) * 100}%" title="${esc(r.c.exchange)}, ${r.c.sessions.map((x) => x.join("–")).join(" and ")} local time"></div>`).join("")}
        ${r.note ? `<span class="tl-note">${esc(r.note)}</span>` : ""}</div></div>`).join("")}
      <div class="tl-now" style="--x:${(nowMin / 1440).toFixed(4)}"></div></div>`;
  }

  // ── India ────────────────────────────────────────────────────────────────
  // what happened elsewhere since India last traded, the usual "global cues" before the open
  function cuesHTML() {
    const row = (s, n, note) => { const q = Qv(s); return `<a class="cue" href="${yurl(s)}" data-sym="${esc(s)}"><span>${esc(n)}</span><span class="cue-v">${px(s)}</span>${chipS(s, s === "INR=X")}${note ? `<small class="muted">${note}</small>` : ""}</a>`; };
    const usSt = status(byId.us), asia = ["jp", "hk"].map((id) => byId[id]).filter(Boolean);
    const usNote = usSt.kind === "open" ? "trading now" : "last session";
    return `<section class="panel"><div class="panel-h"><div><h2>Global cues</h2><p class="muted">What moved elsewhere since India last traded. Wall Street closes at about 1:30 or 2:30 am in India, depending on US daylight saving.</p></div></div>
      <div class="cues">
        ${row("^GSPC", "S&P 500", usNote)}${row("^IXIC", "Nasdaq", usNote)}${row("^DJI", "Dow Jones", usNote)}
        ${asia.map((c) => row(c.indices[0][0], c.indices[0][1], status(c).kind === "open" ? "trading now" : "")).join("")}
        ${row("BZ=F", "Brent crude")}${row("INR=X", "Dollar in rupees", "green = rupee stronger")}${row("^TNX", "US 10-year yield")}${row("DX-Y.NYB", "Dollar index")}
      </div></section>`;
  }
  // ADRs: the same company's shares in New York, turned into rupees and compared with the NSE price
  function adrHTML() {
    const usdinr = Qv("INR=X").price;
    const rows = (IN.adrs || []).map(([a, n, name]) => {
      const qa = Qv(a), qn = Qv(n);
      let prem = null, ratio = null;
      if (qa.price && qn.price && usdinr) {
        const raw = (qa.price * usdinr) / qn.price;
        ratio = Math.max(1, Math.round(raw)); // shares per ADR, read off the prices themselves
        prem = raw / ratio - 1;
        if (ratio > 10) { ratio = null; prem = null; } // prices that don't line up: show nothing rather than nonsense
      }
      return `<tr><td>${sym(a, esc(name))}<small class="muted"> ${esc(a)}${ratio > 1 ? `, 1 ADR = ${ratio} shares` : ""}</small></td><td class="r">${px(a)}</td><td class="r">${chipS(a)}</td><td class="r">${px(n)}</td><td class="r">${chipS(n)}</td>
        <td class="r"><span class="${prem == null ? "na" : ""}" title="ADR price in rupees compared with the NSE price">${prem == null ? "—" : (prem >= 0 ? "+" : "−") + Math.abs(prem * 100).toFixed(1) + "%"}</span></td></tr>`;
    }).join("");
    return `<section class="panel"><div class="panel-h"><div><h2>Indian companies in New York</h2><p class="muted">ADRs trade after India closes, so their move is an early hint for the next day. Premium is the ADR price in rupees against the NSE price.</p></div></div>
      <div class="tscroll"><table class="t"><thead><tr><th>Company</th><th class="r">New York</th><th class="r">Today</th><th class="r">NSE</th><th class="r">Today</th><th class="r">Premium</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }
  function renderIndia(el) {
    const Q = (s) => state.quotes[s] || {};
    const head = IN.headline.map(([s, n]) => {
      const inr = s === "INR=X";
      return `<a class="itile" href="${yurl(s)}" data-sym="${esc(s)}"><span class="it-n">${esc(n)}</span>
        <span class="it-p">${px(s)}</span>
        <span class="it-c">${chipS(s, inr)}${pctT(s, "change1mPct", " this month", "muted", true)}</span>
        ${RET.r[s] && !inr ? `<span class="it-r muted">${["ytd", "y1"].map((p) => RET.r[s][p] != null ? `<span class="${cls(RET.r[s][p])}">${pct(RET.r[s][p] * 100)}</span> ${p === "ytd" ? "this year" : "in a year"}` : "").filter(Boolean).join(", ")}</span>` : ""}
        ${sparkS(s, 220, 34)}</a>`;
    }).join("");
    const secs = IN.sectors.map(([s, n]) => ({ s, n, q: Q(s) })).sort((a, b) => (b.q.changePct ?? -1e9) - (a.q.changePct ?? -1e9));
    const sectorHtml = secs.map((r) => `<a class="tile" href="${yurl(r.s)}" data-sym="${esc(r.s)}" data-tile="${esc(r.s)}" data-max="2" style="${tileStyle(r.q.changePct, 2)}"><span class="tn">${esc(r.n)}</span><span class="tp">${pct(r.q.changePct)}</span><span class="tc">${r.q.change1mPct != null ? pct(r.q.change1mPct) + " this month" : ""}</span></a>`).join("");
    ensureFund(IN.stocks.map((x) => x[0]));
    ensureReturns(IN.headline.map((x) => x[0]));
    loadExtra();
    const s = status(byId.in);
    el.innerHTML = `
      <section class="in-hero"><div><h2>India today</h2><p class="muted">${s.holiday ? `NSE and BSE are <b class="closed">closed today</b> for ${esc(s.holiday)}. They open in ${dur(s.mins)}.` : `NSE and BSE are <b class="${s.kind}">${s.text.toLowerCase()}</b>. ${s.sub}.`}</p></div>
        <div class="breadth" id="breadth" title="How many of the 30 largest stocks are up or down today">${breadthHTML()}</div></section>
      <div class="itiles">${head}</div>
      ${cuesHTML()}
      ${adrHTML()}
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
        <td class="r">${fc(r, ratio(r.f && r.f.pe))}</td><td class="r"${r.f && r.f.mcEst ? ' title="Estimated: profit ÷ earnings per share × price"' : ""}>${fc(r, (r.f && r.f.mcEst ? "≈ " : "") + money(r.f && r.f.marketCap, r.f && r.f.currency))}</td><td class="r">${fc(r, r.f && r.f.divYield ? pctPlain(r.f.divYield, 2) : "—")}</td><td class="r">${sparkS(r.s)}</td></tr>`).join("")}
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


  // ── calendar: rate decisions, inflation releases, company results, market holidays ──
  const CAL_KINDS = [["all", "Everything"], ["rate", "Interest rates"], ["cpi", "Inflation"], ["data", "Jobs and growth"], ["results", "Company results"], ["expiry", "F&O expiry"], ["holiday", "Market holidays"]];
  const CAL_LABEL = { rate: "Interest rates", cpi: "Inflation", data: "Economy", results: "Results", holiday: "Holiday", expiry: "F&O expiry" };
  // a wall-clock time in some time zone, as a moment
  const zonedEpoch = C.zonedEpoch;
  const localDay = (t) => new Date(t).toLocaleDateString("en-CA"); // YYYY-MM-DD in the viewer's zone
  function calEvents() {
    const ev = [];
    (window.CALENDAR || []).forEach(([date, time, tz, kind, title, flag]) => {
      const t = zonedEpoch(date, time, tz);
      ev.push({ kind, title, flag, t, day: time ? localDay(t) : date, timed: !!time, sub: time ? "" : "Announced when the meeting ends, usually around midday in Tokyo" });
    });
    // NSE monthly F&O expiry: the last Tuesday of the month, or the trading day before if that's a holiday.
    // Beyond the holiday data the plain last Tuesday is shown, marked as not yet confirmed.
    const nse = byId.in, hin = HOL.in;
    for (let k = 0; k < 7; k++) {
      const now = new Date(), y = now.getFullYear(), m = now.getMonth() + k;
      const last = new Date(Date.UTC(y, m + 1, 0));
      const back = (last.getUTCDay() - 2 + 7) % 7;
      let d = new Date(Date.UTC(y, m + 1, -back));
      const known = hin && d.toISOString().slice(0, 10) <= hin.through;
      if (known) while (holidayOn(nse, d.toISOString().slice(0, 10)) || [0, 6].includes(d.getUTCDay())) d = new Date(d - 864e5);
      const date = d.toISOString().slice(0, 10), t = zonedEpoch(date, "15:30", "Asia/Kolkata");
      const moved = d.getUTCDay() !== 2;
      ev.push({ kind: "expiry", title: "NSE monthly F&O expiry", flag: "🇮🇳", t, day: localDay(t), timed: true,
        sub: moved ? "Brought forward from Tuesday because of a market holiday" : known ? "Nifty, Bank Nifty and stock futures and options" : "Last Tuesday of the month; check NSE's holiday list nearer the time" });
    }
    // full-day exchange closures, one row per date
    const byDate = {};
    M.forEach((c) => {
      const h = HOL[c.id];
      if (h) Object.entries(h.days).forEach(([date, v]) => { if (!Array.isArray(v)) (byDate[date] = byDate[date] || []).push({ c, why: v }); });
    });
    Object.entries(byDate).forEach(([date, list]) => {
      const one = list.length === 1 ? list[0] : null;
      ev.push({ kind: "holiday", day: date, t: zonedEpoch(date, "00:00", "UTC"), timed: false,
        title: one ? `${one.c.name} closed` : `${list.length} markets closed`, flag: one ? one.c.flag : "",
        sub: one ? one.why : list.map((x) => `${x.c.flag} ${x.c.name} (${x.why})`).join(", ") });
    });
    // company results, from the fundamentals feed
    STOCK_SET.forEach((s) => {
      const f = state.fund[s];
      if (!f || !f.results) return;
      const t = f.results * 1000, flag = ((NAMES[s] || {}).sub || "").match(FLAG);
      ev.push({ kind: "results", title: `${nameOf(s)} results`, sub: f.resultsEstimate ? "Expected around this date" : "", flag: flag ? flag[1] : "", sym: s, day: localDay(t), t, timed: false });
    });
    return ev;
  }
  function renderCal(el) {
    ensureFund([...STOCK_SET]);
    const today = localDay(Date.now()), tmr = localDay(Date.now() + 864e5);
    const until = localDay(Date.now() + state.calDays * 864e5);
    const ev = calEvents().filter((e) => e.day >= today && e.day <= until && (state.calKind === "all" || e.kind === state.calKind))
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.t - b.t));
    const days = [];
    ev.forEach((e) => { if (!days.length || days[days.length - 1].day !== e.day) days.push({ day: e.day, items: [] }); days[days.length - 1].items.push(e); });
    const dayName = (d) => d === today ? "Today" : d === tmr ? "Tomorrow" : new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    const time = (e) => (e.timed ? new Date(e.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : e.kind === "holiday" ? "All day" : e.kind === "rate" ? "Midday JST" : "");
    const item = (e) => {
      const inner = `<span class="ev-t">${time(e)}</span><span class="ev-f">${e.flag}</span><span class="ev-b"><b>${esc(e.title)}</b>${e.sub ? `<small>${esc(e.sub)}</small>` : ""}</span><span class="ev-k k-${e.kind}">${CAL_LABEL[e.kind]}</span>`;
      return e.sym ? `<li><a class="ev" href="${yurl(e.sym)}" data-sym="${esc(e.sym)}">${inner}</a></li>` : `<li><div class="ev">${inner}</div></li>`;
    };
    const busy = [...STOCK_SET].some((s) => fundBusy.has(s));
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ");
    el.innerHTML = `<section class="panel cal"><div class="panel-h"><div><h2>Coming up</h2><p class="muted">Interest rate decisions, inflation figures, results from the companies on this site, and exchange holidays. Times are in your time zone (${esc(zone)}).</p></div></div>
      <div class="chips" id="cal-kinds" role="group" aria-label="Show">${CAL_KINDS.map(([k, l]) => `<button class="chip ${state.calKind === k ? "on" : ""}" data-ck="${k}" aria-pressed="${state.calKind === k}">${l}</button>`).join("")}</div>
      ${days.length ? days.map((g) => `<h3 class="cal-day">${dayName(g.day)}</h3><ul class="evs">${g.items.map(item).join("")}</ul>`).join("") : `<div class="empty"><p>Nothing scheduled in the next ${state.calDays} days${state.calKind !== "all" ? " for this filter" : ""}.</p></div>`}
      ${busy && state.calKind !== "rate" && state.calKind !== "cpi" && state.calKind !== "holiday" ? '<p class="note">Loading company results dates…</p>' : ""}
      <div class="cal-more"><button class="btn" id="cal-more">Show ${state.calDays < 365 ? "the next " + Math.min(365, state.calDays * 2) + " days" : "less"}</button></div>
      <p class="note">Central bank and inflation dates are the official schedules as of ${esc(window.CALENDAR_CHECKED || "")}; holidays as of ${esc(window.HOLIDAYS_CHECKED || "")}. Results dates come from Yahoo Finance and can move.</p></section>`;
    el.querySelector("#cal-kinds").onclick = (e) => { const b = e.target.closest("[data-ck]"); if (b) { state.calKind = b.dataset.ck; renderCal(el); } };
    el.querySelector("#cal-more").onclick = () => { state.calDays = state.calDays < 365 ? Math.min(365, state.calDays * 2) : 45; renderCal(el); };
  }

  // ── main ─────────────────────────────────────────────────────────────────
  function renderMain() {
    const main = $("#main");
    $("#filters").hidden = ["map", "india", "stocks", "cal", "mine"].includes(state.view);
    if (LOCKED.includes(state.view) && !authed()) return renderLocked(main);
    if (LOCKED.includes(state.view) && unverified()) return renderVerify(main);
    if (state.view === "mine") return renderMine(main);
    if (state.view === "india") return renderIndia(main);
    if (state.view === "stocks") return renderStocks(main);
    if (state.view === "cal") return renderCal(main);
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
      const all = allRows(list);
      ensureReturns([...all.map((r) => r.s), ...new Set(M.map((c) => fx(c.ccy)).filter(Boolean)), "INR=X"]);
      const P = [["d", "Today"], ["m1", "1 month"], ["ytd", "This year"], ["y1", "1 year"], ["y3", "3 years", 3], ["y5", "5 years", 5]];
      const rv = (r, p, n) => { const v = retOf(r.s, p, r.c.ccy); return n ? perYear(v, n) : v; };
      const k = state.sort.key === "changePct" ? "d" : state.sort.key, d = state.sort.dir;
      const val = (r) => k === "name" ? r.n : k === "country" ? r.c.name : k === "status" ? status(r.c).kind : k === "price" ? r.q.price : (() => { const pp = P.find((x) => x[0] === k); return pp ? rv(r, pp[0], pp[2]) : null; })();
      const rows = all.sort((a, b) => { const x = val(a), y = val(b); if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y) : x - y) * d; });
      const th = (key, label, r, title) => `<th class="${r ? "r" : ""}" aria-sort="${k === key ? (d > 0 ? "ascending" : "descending") : "none"}"${title ? ` title="${esc(title)}"` : ""}><button data-k="${key}">${label}<i>${k === key ? (d > 0 ? "↑" : "↓") : ""}</i></button></th>`;
      const cur = state.retCur;
      main.innerHTML = `<section class="panel"><div class="panel-h"><div><h2>Every index, over time</h2><p class="muted">${cur === "local" ? "Changes in each market's own currency." : `Changes as ${cur === "INR" ? "an Indian investor" : "a dollar investor"} would see them, after the currency move. 3- and 5-year figures are per year.`}${cur === "local" ? " 3- and 5-year figures are per year." : ""}</p></div>
        <div class="seg" role="radiogroup" aria-label="Show changes in">${Object.entries(RCUR).map(([c, l]) => `<button role="radio" aria-checked="${c === cur}" class="${c === cur ? "on" : ""}" data-rcur="${c}">${c === "INR" ? "₹ " : c === "USD" ? "$ " : ""}${l}</button>`).join("")}</div></div>
        <div class="tscroll"><table class="t ret"><thead><tr>${th("country", "Country")}${th("name", "Index")}${th("price", "Level", 1)}${P.map(([p, l, n]) => th(p, l, 1, n ? "Average per year" : "")).join("")}${th("status", "Market")}</tr></thead><tbody>
        ${rows.map((r) => { const s = status(r.c); return `<tr><td><span class="flag">${r.c.flag}</span>${esc(r.c.name)}</td><td>${sym(r.s, esc(r.n))}</td>
          <td class="r">${px(r.s)}</td>${P.map(([p, , n]) => `<td class="r">${p === "d" && cur === "local" ? chipS(r.s) : retCell(rv(r, p, n))}</td>`).join("")}<td><span class="mstat ${s.kind}" data-ms="${r.c.id}">${s.text}</span></td></tr>`; }).join("")}
        </tbody></table></div>
        <p class="src">Source: Yahoo Finance daily closes; longer periods refresh every six hours. Currency-adjusted figures use each currency's change against the US dollar over the same period.</p></section>`;
      main.querySelectorAll("[data-rcur]").forEach((b) => b.onclick = () => { state.retCur = b.dataset.rcur; store.set("wm-retcur", state.retCur); renderMain(); });
      main.querySelectorAll("[data-k]").forEach((b) => b.onclick = () => {
        const key = b.dataset.k;
        const cur = state.sort.key === "changePct" ? "d" : state.sort.key;
        state.sort = { key, dir: cur === key ? -state.sort.dir : (["name", "country", "status"].includes(key) ? 1 : -1) };
        renderMain();
      });
    }
  }

  // ── longer-period returns (api/returns.js), cached in the browser for six hours ──
  const RET_TTL = 6 * 3600e3;
  const RET = (() => { const c = store.get("wm-ret"); return c && c.v === 1 ? c : { v: 1, t: {}, r: {} }; })();
  let retBusy = false;
  function ensureReturns(list) {
    const now = Date.now();
    const need = [...new Set(list)].filter((s) => s && !(RET.t[s] > now - RET_TTL));
    if (!need.length || retBusy) return;
    retBusy = true;
    const chunks = [];
    for (let i = 0; i < need.length; i += 80) chunks.push(need.slice(i, i + 80));
    Promise.all(chunks.map((c) => fetch("/api/returns?symbols=" + encodeURIComponent(c.join(","))).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
      .then((res) => {
        res.forEach((j) => j && Object.entries(j.returns || {}).forEach(([k, v]) => { RET.r[k] = v; RET.t[k] = j.mock ? now - RET_TTL + 60e3 : now; }));
        store.set("wm-ret", RET);
      })
      .finally(() => { retBusy = false; if (["table", "india", "mine"].includes(state.view)) renderMain(); });
  }
  // the change of symbol s over period p ("d" = today), in local currency or seen from INR or USD
  const RCUR = { local: "Local currency", INR: "Rupees", USD: "Dollars" };
  state.retCur = RCUR[store.get("wm-retcur")] ? store.get("wm-retcur") : "local";
  function retOf(s, p, ccy, target = state.retCur) {
    const raw = p === "d" ? (Qv(s).changePct != null ? Qv(s).changePct / 100 : null) : RET.r[s] ? RET.r[s][p] : null;
    if (raw == null || target === "local" || !ccy || ccy === target) return raw;
    const fxr = (c) => {
      if (c === "USD") return 0;
      const f = fx(c);
      return p === "d" ? (Qv(f).changePct != null ? Qv(f).changePct / 100 : null) : RET.r[f] ? RET.r[f][p] : null;
    };
    const a = fxr(ccy), b = target === "USD" ? 0 : fxr(target);
    return a == null || b == null ? null : C.returnIn(raw, a, b);
  }
  // 3- and 5-year changes read better per year
  const perYear = (r, n) => (r == null ? null : Math.pow(1 + r, 1 / n) - 1);
  const retCell = (v) => `<span class="${cls(v)}">${v == null ? (RET.r && Object.keys(RET.r).length ? "—" : SK) : pct(v * 100)}</span>`;

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
    document.querySelectorAll("[data-px]").forEach((el) => { const [a, b] = affix(el.dataset.px); el.dataset.pre = a; el.dataset.suf = b; roll(el, state.prev[el.dataset.px], Qv(el.dataset.px).price); });
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
    patchHoldings();
    if (state.view === "table" && state.retCur !== "local" && !document.activeElement.closest("#main")) { const x = $(".tscroll") && $(".tscroll").scrollLeft; renderMain(); if (x && $(".tscroll")) $(".tscroll").scrollLeft = x; }
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
  const modal = { sym: null, range: "1mo", lastFocus: null, cmp: null };
  // chart overlays the visitor has switched on, remembered in this browser
  const copts = Object.assign({ vol: true, ma50: true, ma200: true }, store.get("wm-copts") || {});
  function openChart(s, viaKeyboard, keepCmp) {
    if (modal.sym !== s && !keepCmp) modal.cmp = null;
    modal.sym = s; modal.lastFocus = document.activeElement;
    const m = $("#modal"); m.hidden = false; requestAnimationFrame(() => m.classList.add("in"));
    document.body.classList.add("locked");
    drawModal();
    setTimeout(() => (viaKeyboard ? $("#m-close") : $(".mbox")).focus({ preventScroll: true }), 50);
  }
  function closeChart() {
    const m = $("#modal"); m.classList.remove("in");
    setTimeout(() => { m.hidden = true; }, REDUCED ? 0 : 220);
    document.body.classList.remove("locked"); modal.sym = null; modal.cmp = null;
    writeHash();
    if (modal.lastFocus) modal.lastFocus.focus({ preventScroll: true });
  }
  // the address bar always describes what's on screen, so it can be shared as is
  function hashFor() {
    const parts = [];
    if (state.view !== "cards") parts.push(state.view);
    if (modal.sym) {
      parts.push("chart=" + encodeURIComponent(modal.sym));
      if (modal.range !== "1mo") parts.push("range=" + modal.range);
      if (modal.cmp) parts.push("vs=" + encodeURIComponent(modal.cmp));
    }
    return parts.length ? "#" + parts.join("&") : location.pathname + location.search;
  }
  const writeHash = () => { try { history.replaceState(null, "", hashFor()); } catch (e) {} };
  // promises are cached too, so a hover-prefetch and the click share one request
  function getChart(s, range) {
    const key = s + "|" + range, hit = chartCache[key];
    if (hit && Date.now() - hit.t < 60_000) return hit.p;
    const p = authFetch(`/api/chart?symbol=${encodeURIComponent(s)}&range=${range}`).then(async (r) => {
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
    // when this price is from, so nobody mistakes an old print for a live one
    let asOf = "";
    if (q.time) {
      const t = new Date(q.time * 1000), mins = (Date.now() - t) / 60000;
      const same = t.toDateString() === new Date().toDateString();
      const when = t.toLocaleString([], same ? { hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
      asOf = `<span class="m-asof muted" title="Your time. Prices from Yahoo Finance; some exchanges are delayed 15 to 20 minutes.">${mins < 2 ? "just now" : "as of " + when}</span>`;
    }
    $("#m-price").innerHTML = `<span class="m-p">${money2(modal.sym, q.price)}</span>${chip(q.changePct)}<span class="muted">today</span>${asOf}`;
  }
  function starBtn() {
    const b = $("#m-star");
    if (!b || !modal.sym) return;
    const on = isWatched(modal.sym);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on);
    b.setAttribute("aria-label", on ? "Remove from watchlist" : "Add to watchlist");
    b.title = on ? "Remove from watchlist (S)" : "Add to watchlist (S)";
  }
  const nameOf = (s) => (NAMES[s] ? NAMES[s].name : s);
  function drawTitle(s) {
    const nm = NAMES[s] || { name: s, sub: "" };
    $("#m-title").innerHTML = `<h2>${esc(nm.name)}</h2><p class="muted">${esc(nm.sub)}</p>`;
  }
  const quoteBusy = new Set();
  async function drawModal() {
    const s = modal.sym, range = modal.range, cmp = modal.cmp;
    drawTitle(s);
    $("#m-ranges").innerHTML = RANGES.map(([k, l]) => `<button data-r="${k}" role="tab" aria-selected="${k === range}" class="${k === range ? "on" : ""}">${l}</button>`).join("");
    $("#m-yahoo").href = yurl(s);
    starBtn(); modalPrice(); drawFund(s); writeHash();
    // symbols reached by search or a shared link may not be in the regular price refresh
    if (!state.quotes[s] && !quoteBusy.has(s)) {
      quoteBusy.add(s);
      quoteFor([s]).then(() => { quoteBusy.delete(s); if (modal.sym === s) modalPrice(); });
    }
    const p = getChart(s, range);
    const pc = cmp ? getChart(cmp, range).catch((e) => ({ error: e.message })) : Promise.resolve(null);
    const both = Promise.all([p, pc]);
    // only show the placeholder if the data isn't already here
    let settled = false; both.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    if (!settled) { $("#m-chart").innerHTML = '<div class="chart-sk"></div>'; $("#m-stats").innerHTML = ""; }
    try {
      const [d, dc] = await both;
      if (modal.sym !== s || modal.range !== range || modal.cmp !== cmp) return;
      if (d.name && (!NAMES[s] || NAMES[s].name === s)) { NAMES[s] = { name: d.name, sub: d.exchange || "" }; drawTitle(s); }
      if (d.type === "EQUITY" && !STOCK_SET.has(s)) { STOCK_SET.add(s); drawFund(s); }
      if (dc && dc.name && !NAMES[cmp]) NAMES[cmp] = { name: dc.name, sub: dc.exchange || "" };
      if (dc && !dc.error) drawCompare(d, dc, range); else drawSvgChart(d, range);
      drawTools(d, dc);
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
      $("#m-tools").innerHTML = "";
    }
  }
  // overlay switches and the comparison picker under the chart
  const CMP_PICKS = ["^GSPC", "^NSEI", "^IXIC", "^FTSE", "^N225", "^HSI", "GC=F", "BTC-USD"];
  function drawTools(d, dc) {
    const box = $("#m-tools");
    const hasVol = (d.points || []).some((p) => p[2] > 0);
    const tg = (k, label, cls2) => `<button class="tgl ${cls2}" data-opt="${k}" aria-pressed="${!!copts[k]}"><i></i>${label}</button>`;
    const overlays = modal.cmp ? "" : (hasVol ? tg("vol", "Volume", "t-vol") : "") + (d.ma50 ? tg("ma50", "50-day average", "t-ma50") : "") + (d.ma200 ? tg("ma200", "200-day average", "t-ma200") : "");
    const cmpPart = modal.cmp
      ? `<span class="cmp-on">Compared with ${esc(nameOf(modal.cmp))}${dc && dc.error ? ` (didn't load: ${esc(dc.error)})` : ""}<button data-cmp-clear aria-label="Stop comparing">×</button></span>`
      : `<button class="tgl t-cmp" data-cmp-open aria-expanded="false">Compare with…</button>`;
    box.innerHTML = `<div class="tools-row">${overlays}${cmpPart}</div><div class="cmp-pick" id="cmp-pick" hidden>
      <input id="cmp-q" type="search" placeholder="Type an index, stock or currency" autocomplete="off" aria-label="Find something to compare with" />
      <div id="cmp-list" class="cmp-list">${cmpList("")}</div></div>`;
  }
  function cmpList(q) {
    let items;
    if (!q.trim()) items = CMP_PICKS.filter((s) => s !== modal.sym).map((s) => ({ s, name: nameOf(s) }));
    else items = searchHits(q).map((it) => (it.k === "c" ? { s: it.c.indices[0][0], name: `${it.c.indices[0][1]} (${it.c.name})` } : { s: it.s, name: it.name })).filter((x) => x.s !== modal.sym).slice(0, 6);
    return items.length ? items.map((x) => `<button class="chip" data-cmp="${esc(x.s)}">${esc(x.name)}</button>`).join("") : '<p class="muted">Nothing here matches. Try an index name like "Nikkei".</p>';
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
        ${grp("Valuation", [item("Market cap", (f.mcEst ? "≈ " : "") + money(f.marketCap, c), f.mcEst ? "estimated: profit ÷ earnings per share × price" : ""), item("P/E", ratio(f.pe), "last 12 months"), item("Forward P/E", ratio(f.fpe), "next 12 months"), item("Price to book", ratio(f.pb, 2)), item("Price to sales", ratio(f.ps, 2)), item("EV to EBITDA", ratio(f.evEbitda)), item("Earnings per share", f.eps != null ? fmt(f.eps, 2) : "—", "last 12 months"), item("Dividend yield", f.divYield ? pctPlain(f.divYield, 2) : "—", f.payout ? Math.round(f.payout) + "% of profit paid out" : "")])}
        ${grp("Profitability", [item("Return on equity", pctPlain(f.roe)), item("Return on assets", pctPlain(f.roa)), item("Gross margin", pctPlain(f.grossMargin)), item("Operating margin", pctPlain(f.operatingMargin)), item("Net margin", pctPlain(f.profitMargin)), item("Beta", f.beta != null ? f.beta.toFixed(2) : "—", "swing vs the market")])}
        ${grp("Growth", [item("Revenue growth", sg(f.revenueGrowth), "vs a year ago"), item("Earnings growth", sg(f.earningsGrowth), "vs a year ago"), item("Revenue", money(f.revenue, rc), "last 12 months"), item("Free cash flow", money(f.freeCashflow, rc), "last 12 months")])}
        ${grp("Balance sheet", [item("Cash", money(f.cash, rc)), item("Debt", money(f.debt, rc)), item("Debt to equity", f.debtToEquity != null ? f.debtToEquity.toFixed(2) + "×" : "—"), item("Current ratio", f.currentRatio != null ? f.currentRatio.toFixed(2) : "—", "short-term assets ÷ liabilities")])}
        ${f.rating || f.target ? grp("Analysts", [item("Consensus", RATING[f.rating] || "—", f.analysts ? f.analysts + " analysts" : ""), item("Average price target", f.target ? fmt(f.target) : "—", up != null ? `${up >= 0 ? "+" : "−"}${Math.abs(up).toFixed(1)}% from the current price` : "")]) : ""}
      </div><p class="note">Source: Yahoo Finance. Company financials are reported in ${esc(rc)}.${f.mcEst ? " Figures marked ≈ are our estimate where Yahoo gives none." : ""}</p>`;
  }

  const niceStep = (n) => { const e = Math.pow(10, Math.floor(Math.log10(n))), f = n / e; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e; };
  function timeFmt(range, tz) {
    return (t) => {
      const dt = new Date(t * 1000);
      if (range === "1d") return dt.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
      if (range === "5d") return dt.toLocaleDateString("en-GB", { timeZone: tz, weekday: "short" });
      if (range === "5y") return dt.toLocaleDateString("en-GB", { timeZone: tz, year: "numeric" });
      if (range === "1y") return dt.toLocaleDateString("en-GB", { timeZone: tz, month: "short", year: "2-digit" });
      return dt.toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "short" });
    };
  }
  const whenFmt = (t, range, tz) => {
    const intraday = range === "1d" || range === "5d";
    return new Date(t * 1000).toLocaleString("en-GB", { timeZone: tz, day: "numeric", month: "short", year: intraday ? undefined : "numeric", hour: intraday ? "2-digit" : undefined, minute: intraday ? "2-digit" : undefined });
  };
  const volFmt = (v) => (v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? Math.round(v / 1e3) + "K" : String(v));
  // pointer and touch tracking shared by both chart kinds
  function hoverize(W, onMove) {
    const svg = $("#m-svg"), hit = $("#hit"), hov = $("#hov"), tip = $("#m-tip");
    const move = (clientX) => {
      const r = svg.getBoundingClientRect();
      hov.setAttribute("visibility", "visible");
      tip.hidden = false;
      onMove(((clientX - r.left) / r.width) * W, r, tip);
    };
    hit.addEventListener("mousemove", (e) => move(e.clientX));
    hit.addEventListener("touchmove", (e) => { move(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
    const hide = () => { hov.setAttribute("visibility", "hidden"); tip.hidden = true; };
    hit.addEventListener("mouseleave", hide); hit.addEventListener("touchend", hide);
  }
  const placeTip = (tip, r, W, H, x, y) => {
    tip.style.left = Math.max(0, Math.min((x / W) * r.width - 70, r.width - 180)) + "px";
    tip.style.top = Math.max(0, (y / H) * r.height - 76) + "px";
  };

  function drawSvgChart(d, range) {
    const box = $("#m-chart"), pts = d.points || [];
    if (pts.length < 2) { box.innerHTML = '<div class="empty">Yahoo Finance has no history for this range. Try a longer one.</div>'; return; }
    const W = box.clientWidth || 760, H = Math.min(340, Math.max(230, Math.round(W * 0.44))), L = 4, R = 58, T = 14, B = 26;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), vs = pts.map((p) => p[2] || 0);
    const showVol = copts.vol && vs.some((v) => v > 0);
    const m50 = copts.ma50 && d.ma50 ? d.ma50 : null, m200 = copts.ma200 && d.ma200 ? d.ma200 : null;
    const VH = showVol ? Math.round((H - T - B) * 0.2) : 0, PB = H - B - (showVol ? VH + 8 : 0); // price area bottom
    const inView = [...ys, ...(m50 || []).filter((v) => v != null), ...(m200 || []).filter((v) => v != null)];
    let lo = Math.min(...inView), hi = Math.max(...inView);
    if (range === "1d" && d.prevClose) { lo = Math.min(lo, d.prevClose); hi = Math.max(hi, d.prevClose); }
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const X = (i) => L + (i / (pts.length - 1)) * (W - L - R);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (PB - T);
    const base = range === "1d" && d.prevClose ? d.prevClose : ys[0];
    const col = ys[ys.length - 1] >= base ? "var(--up)" : "var(--down)";
    const line = pts.map((p, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p[1]).toFixed(1)).join("");
    const area = line + `L${X(pts.length - 1).toFixed(1)} ${PB}L${X(0).toFixed(1)} ${PB}Z`;
    const maPath = (arr) => { let s = "", pen = false; arr.forEach((v, i) => { if (v == null) { pen = false; return; } s += (pen ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); pen = true; }); return s; };
    const step = niceStep((hi - lo) / 4);
    let grid = "";
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${W - R + 8}" y="${Y(v) + 4}" class="gt">${fmt(v, step < 1 ? 2 : 0)}</text>`;
    let vol = "";
    if (showVol) {
      const maxV = Math.max(...vs) || 1, bw = Math.max(1, ((W - L - R) / pts.length) * 0.72);
      vs.forEach((v, i) => { if (!v) return; const h = (v / maxV) * VH; vol += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" class="${i && ys[i] < ys[i - 1] ? "vb dn" : "vb"}"/>`; });
      vol += `<text x="${W - R + 8}" y="${H - B - VH + 10}" class="gt">Vol</text>`;
    }
    const tz = d.tz || "UTC", fmtX = timeFmt(range, tz);
    let xl = "";
    const nT = Math.min(W < 500 ? 4 : 6, pts.length);
    for (let k = 0; k < nT; k++) { const i = Math.round((k / (nT - 1)) * (pts.length - 1)); xl += `<text x="${X(i)}" y="${H - 6}" class="gt" text-anchor="${k === 0 ? "start" : k === nT - 1 ? "end" : "middle"}">${fmtX(xs[i])}</text>`; }
    const prev = range === "1d" && d.prevClose ? `<line x1="${L}" x2="${W - R}" y1="${Y(d.prevClose)}" y2="${Y(d.prevClose)}" class="prev"/><text x="${L + 4}" y="${Y(d.prevClose) - 6}" class="gt">Yesterday's close</text>` : "";
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" id="m-svg" role="img" aria-label="Price chart of ${esc(nameOf(modal.sym))}">
      <defs><linearGradient id="gfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".3"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      ${grid}${prev}${vol}<path d="${area}" fill="url(#gfill)" class="area"/>
      ${m200 ? `<path d="${maPath(m200)}" class="ma ma200"/>` : ""}${m50 ? `<path d="${maPath(m50)}" class="ma ma50"/>` : ""}
      <path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" class="line" pathLength="1"/>${xl}
      <g id="hov" visibility="hidden"><line id="hx" y1="${T}" y2="${H - B}" class="cross"/><circle id="hc" r="5" fill="${col}" stroke="var(--panel)" stroke-width="2.5"/></g>
      <rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent" id="hit"/></svg><div id="m-tip" class="tip" hidden></div>`;
    hoverize(W, (x, r, tip) => {
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(((x - L) / (W - L - R)) * (pts.length - 1))));
      $("#hx").setAttribute("x1", X(i)); $("#hx").setAttribute("x2", X(i));
      $("#hc").setAttribute("cx", X(i)); $("#hc").setAttribute("cy", Y(ys[i]));
      const ch = ((ys[i] - base) / base) * 100;
      const extra = [m50 && m50[i] != null ? `<span class="tip-ma ma50">50-day ${fmt(m50[i])}</span>` : "", m200 && m200[i] != null ? `<span class="tip-ma ma200">200-day ${fmt(m200[i])}</span>` : "", showVol && vs[i] ? `<span class="muted">Volume ${volFmt(vs[i])}</span>` : ""].join("");
      tip.innerHTML = `<b>${money2(modal.sym, ys[i])}</b> <span class="${cls(ch)}">${pct(ch)}</span>${extra}<span class="muted">${whenFmt(xs[i], range, tz)}</span>`;
      placeTip(tip, r, W, H, X(i), Y(ys[i]));
    });
  }

  // two lines rebased to the same start, on a shared time axis
  function drawCompare(d1, d2, range) {
    const box = $("#m-chart");
    const a0 = d1.points || [], b0 = d2.points || [];
    if (a0.length < 2 || b0.length < 2) return drawSvgChart(d1, range);
    const t0 = Math.max(a0[0][0], b0[0][0]), t1 = Math.max(a0[a0.length - 1][0], b0[b0.length - 1][0]);
    const trim = (pts) => { let k = pts.findIndex((p) => p[0] >= t0); if (k > 0 && pts[k][0] > t0) k--; return pts.slice(Math.max(0, k)); };
    const A = trim(a0), Bs = trim(b0);
    if (A.length < 2 || Bs.length < 2 || t1 <= t0) {
      box.innerHTML = '<div class="empty">These two don\'t trade at overlapping times in this range. Try 5D or longer.</div>';
      return;
    }
    const rb = (pts) => pts.map((p) => [p[0], (p[1] / pts[0][1] - 1) * 100]);
    const ra = rb(A), rbb = rb(Bs);
    const W = box.clientWidth || 760, H = Math.min(340, Math.max(230, Math.round(W * 0.44))), L = 4, R = 58, T = 14, B = 26;
    const all = [...ra, ...rbb].map((p) => p[1]);
    let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const X = (t) => L + ((Math.max(t0, t) - t0) / (t1 - t0)) * (W - L - R);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const path = (pts) => pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join("");
    const step = niceStep((hi - lo) / 4);
    let grid = "";
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${W - R + 8}" y="${Y(v) + 4}" class="gt">${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(step < 1 ? 1 : 0)}%</text>`;
    const tz = d1.tz || "UTC", fmtX = timeFmt(range, tz);
    let xl = "";
    const nT = W < 500 ? 4 : 6;
    for (let k = 0; k < nT; k++) { const t = t0 + (k / (nT - 1)) * (t1 - t0); xl += `<text x="${X(t)}" y="${H - 6}" class="gt" text-anchor="${k === 0 ? "start" : k === nT - 1 ? "end" : "middle"}">${fmtX(t)}</text>`; }
    const endA = ra[ra.length - 1][1], endB = rbb[rbb.length - 1][1];
    const sg = (v) => `<b class="${cls(v)}">${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%</b>`;
    box.innerHTML = `<div class="cmp-legend"><span><i class="k1"></i>${esc(nameOf(modal.sym))} ${sg(endA)}</span><span><i class="k2"></i>${esc(nameOf(modal.cmp))} ${sg(endB)}</span></div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" id="m-svg" role="img" aria-label="${esc(nameOf(modal.sym))} compared with ${esc(nameOf(modal.cmp))}">
      ${grid}<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" class="prev"/>
      <path d="${path(rbb)}" class="cline c2"/><path d="${path(ra)}" class="cline c1"/>${xl}
      <g id="hov" visibility="hidden"><line id="hx" y1="${T}" y2="${H - B}" class="cross"/><circle id="hc" r="4.5" class="cdot c1"/><circle id="hc2" r="4.5" class="cdot c2"/></g>
      <rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent" id="hit"/></svg><div id="m-tip" class="tip" hidden></div>`;
    const near = (pts, t) => { let lo2 = 0, hi2 = pts.length - 1; while (hi2 - lo2 > 1) { const m = (lo2 + hi2) >> 1; if (pts[m][0] <= t) lo2 = m; else hi2 = m; } return Math.abs(pts[hi2][0] - t) < Math.abs(pts[lo2][0] - t) ? pts[hi2] : pts[lo2]; };
    hoverize(W, (x, r, tip) => {
      const t = t0 + ((Math.max(L, Math.min(W - R, x)) - L) / (W - L - R)) * (t1 - t0);
      const pa = near(ra, t), pb = near(rbb, t);
      $("#hx").setAttribute("x1", X(t)); $("#hx").setAttribute("x2", X(t));
      $("#hc").setAttribute("cx", X(pa[0])); $("#hc").setAttribute("cy", Y(pa[1]));
      $("#hc2").setAttribute("cx", X(pb[0])); $("#hc2").setAttribute("cy", Y(pb[1]));
      tip.innerHTML = `<span class="tip-row2"><i class="k1"></i>${esc(nameOf(modal.sym))} ${sg(pa[1])}</span><span class="tip-row2"><i class="k2"></i>${esc(nameOf(modal.cmp))} ${sg(pb[1])}</span><span class="muted">${whenFmt(t, range, tz)}</span>`;
      placeTip(tip, r, W, H, X(t), Y(pa[1]));
    });
  }

  // ── render & controls ────────────────────────────────────────────────────
  function render() {
    renderHighlights.key = null;
    renderStatus(); renderHero(); renderWatch(); renderStrip(); renderMain();
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
    writeHash();
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
    store.set("wm-theme", b.dataset.themePick); syncSave();
    const go = () => { applyTheme(); render(); };
    if (document.startViewTransition && !REDUCED) document.startViewTransition(go); else go();
  };
  $("#cb-toggle").onchange = (e) => { store.set("wm-cb", e.target.checked); syncSave(); applyTheme(); render(); };
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
  // anything else listed anywhere: Yahoo Finance's own search, fetched after a short pause in typing
  const remoteCache = {};
  let remoteT;
  function remoteFor(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2) return [];
    if (remoteCache[q]) return remoteCache[q];
    clearTimeout(remoteT);
    remoteT = setTimeout(() => {
      remoteCache[q] = "loading";
      authFetch("/api/search?q=" + encodeURIComponent(q)).then((r) => r.json()).then((j) => { remoteCache[q] = j.results || []; })
        .catch(() => { remoteCache[q] = []; })
        .finally(() => { if (sbox.value.trim().toLowerCase() === q && document.activeElement === sbox) drawPop(); remoteDone(); });
    }, 220);
    return "loading";
  }
  function drawPop() {
    const q = sbox.value.trim();
    if (!q) { spop.hidden = true; sbox.setAttribute("aria-expanded", "false"); return; }
    const local = searchHits(q);
    const known = new Set(local.map((it) => (it.k === "c" ? it.c.indices[0][0] : it.s)));
    const rem = remoteFor(q);
    const extra = Array.isArray(rem) ? rem.filter((r) => !known.has(r.symbol)).slice(0, 6)
      .map((r) => ({ k: "r", s: r.symbol, name: r.name, icon: "", sub: [r.type, r.exchange].filter(Boolean).join(", "), kind: r.kind })) : [];
    hits = [...local, ...extra];
    active = Math.min(active, Math.max(0, hits.length - 1));
    const row = (it, i) => {
      const s = it.k === "c" ? it.c.indices[0][0] : it.s, qq = Qv(s);
      const right = qq.price != null ? `<span class="sp-r">${it.k === "c" ? `<small>${esc(it.c.indices[0][1])}</small>` : money2(s, qq.price)}${chip(qq.changePct)}</span>`
        : it.k === "r" ? `<span class="sp-r"><small>${esc(tickerOf(it.s))}</small></span>` : "";
      return `<button class="sp-item ${i === active ? "on" : ""}" data-i="${i}" role="option" aria-selected="${i === active}"><span class="sp-ic">${it.icon}</span><span class="sp-t"><b>${esc(it.name)}</b><small>${esc(it.k === "c" ? "Country, " + it.sub : it.sub)}</small></span>${right}</button>`;
    };
    let html = local.map(row).join("");
    if (extra.length) html += `<p class="sp-sec">More from Yahoo Finance</p>` + extra.map((it, j) => row(it, local.length + j)).join("");
    else if (rem === "loading") html += `<p class="sp-sec">Searching every market…</p>`;
    else if (rem === "signin" && q.length > 1) html += `<button class="sp-item sp-signin" data-signin="search"><span class="sp-t"><b>Sign in to search every listed company</b><small>Free account, Google or email</small></span></button>`;
    if (!hits.length && rem !== "loading" && rem !== "signin") html = `<p class="sp-empty">Nothing matches “${esc(q)}”. Try a country, an index, a company or a ticker like TCS.NS.</p>`;
    spop.innerHTML = html;
    placePop();
    spop.hidden = false; sbox.setAttribute("aria-expanded", "true");
  }
  function closePop() { spop.hidden = true; sbox.setAttribute("aria-expanded", "false"); }
  function choose(it) {
    if (!it) return;
    closePop(); sbox.value = ""; sbox.blur();
    if (it.k === "s") return openChart(it.s);
    if (it.k === "r") {
      NAMES[it.s] = NAMES[it.s] || { name: it.name, sub: it.sub };
      if (it.kind === "EQUITY") STOCK_SET.add(it.s);
      return openChart(it.s);
    }
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
  $("#m-star").onclick = () => modal.sym && toggleWatch(modal.sym);
  $("#m-share").onclick = async () => {
    writeHash();
    const url = location.href, title = nameOf(modal.sym) + " on World Markets";
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) { try { await navigator.share({ title, url }); } catch (e) {} return; }
    try { await navigator.clipboard.writeText(url); toast("Link copied. It opens this exact chart."); }
    catch (e) { toast("Copy the link from your address bar to share this chart."); }
  };
  // overlays and comparison under the chart
  $("#m-tools").addEventListener("click", (e) => {
    const o = e.target.closest("[data-opt]");
    if (o) { copts[o.dataset.opt] = !copts[o.dataset.opt]; store.set("wm-copts", copts); syncSave(); return drawModal(); }
    if (e.target.closest("[data-cmp-open]")) {
      const pick = $("#cmp-pick"), btn = e.target.closest("[data-cmp-open]");
      pick.hidden = !pick.hidden; btn.setAttribute("aria-expanded", !pick.hidden);
      if (!pick.hidden) $("#cmp-q").focus();
      return;
    }
    const c = e.target.closest("[data-cmp]");
    if (c) { modal.cmp = c.dataset.cmp; return drawModal(); }
    if (e.target.closest("[data-cmp-clear]")) { modal.cmp = null; drawModal(); }
  });
  $("#m-tools").addEventListener("input", (e) => { if (e.target.id === "cmp-q") $("#cmp-list").innerHTML = cmpList(e.target.value); });
  $("#m-tools").addEventListener("keydown", (e) => {
    if (e.target.id === "cmp-q" && e.key === "Enter") { const first = $("#cmp-list [data-cmp]"); if (first) { e.preventDefault(); first.click(); } }
  });
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.closest("#m-close")) closeChart(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#theme-pop") && !$("#theme-pop").hidden) return toggleThemes(false);
    if (e.key === "Escape" && modal.sym) return closeChart();
    const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName);
    if (modal.sym && !typing && (e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey) { e.preventDefault(); return toggleWatch(modal.sym); }
    if (modal.sym && !typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const i = RANGES.findIndex((r) => r[0] === modal.range) + (e.key === "ArrowRight" ? 1 : -1);
      if (i >= 0 && i < RANGES.length) { e.preventDefault(); modal.range = RANGES[i][0]; drawModal(); }
      return;
    }
    if (e.key === "/" && document.activeElement.tagName !== "INPUT") { e.preventDefault(); $("#search").focus(); }
  });

  // ── my markets: the visitor's own picks, chosen from everything the site knows ──
  const EXTRA = {
    com: [["PL=F", "Platinum", "$/oz"], ["PA=F", "Palladium", "$/oz"], ["ALI=F", "Aluminium", "$/t"], ["HO=F", "Heating Oil", "$/gal"], ["RB=F", "Gasoline (RBOB)", "$/gal"],
      ["ZW=F", "Wheat", "$/bu"], ["ZC=F", "Corn", "$/bu"], ["ZS=F", "Soybeans", "$/bu"], ["KC=F", "Coffee", "$/lb"], ["SB=F", "Sugar", "$/lb"], ["CT=F", "Cotton", "$/lb"], ["CC=F", "Cocoa", "$/t"]],
    cry: [["BNB-USD", "BNB", "USD"], ["DOGE-USD", "Dogecoin", "USD"], ["ADA-USD", "Cardano", "USD"], ["TRX-USD", "Tron", "USD"]],
    fx: [["EURUSD=X", "Euro in dollars", "EUR / USD"], ["GBPUSD=X", "Pound in dollars", "GBP / USD"], ["EURINR=X", "Euro in rupees", "EUR / INR"], ["GBPINR=X", "Pound in rupees", "GBP / INR"]],
  };
  const KINDS = [["idx", "Indices"], ["stk", "Stocks"], ["com", "Commodities"], ["fx", "Currencies"], ["cry", "Crypto"], ["rate", "Rates"], ["oth", "Other"]];
  const KIND_OF_GROUP = { Commodities: "com", Crypto: "cry", "US Rates & Dollar": "rate" };
  const CAT = []; // { s, n, sub, k, tag }
  const CAT_BY = {};
  const catAdd = (s, n, sub, k, tag) => { if (CAT_BY[s]) return; const it = { s, n, sub, k, tag }; CAT.push(it); CAT_BY[s] = it; NAMES[s] = NAMES[s] || { name: n, sub }; };
  M.forEach((c) => c.indices.forEach(([s, n]) => catAdd(s, n, `${c.flag} ${c.name}`, "idx", c.region)));
  IN.sectors.forEach(([s, n]) => catAdd(s, "Nifty " + n, "🇮🇳 India sector", "idx", "India sectors"));
  G.forEach((g) => g.items.forEach(([s, n, u]) => catAdd(s, n, u ? "in " + u : g.group, s === "DX-Y.NYB" ? "fx" : KIND_OF_GROUP[g.group], null)));
  EXTRA.com.forEach(([s, n, u]) => catAdd(s, n, "in " + u, "com", null));
  EXTRA.cry.forEach(([s, n, u]) => catAdd(s, n, "in " + u, "cry", null));
  M.forEach((c) => { const f = fx(c.ccy); if (f) catAdd(f, `${CCY_NAME[c.ccy] || c.ccy}`, `${c.flag} ${c.ccy} per US dollar`, "fx", null); });
  EXTRA.fx.forEach(([s, n, u]) => catAdd(s, n, u, "fx", null));
  SM.forEach((m) => m.stocks.forEach(([s, n, sec]) => catAdd(s, n, `${m.flag} ${sec}`, "stk", m.id)));
  const kindOf = (w) => w.k || (CAT_BY[w.s] && CAT_BY[w.s].k) || (w.stock || STOCK_SET.has(w.s) ? "stk" : "oth");
  const MINE_MAX = 60;

  const pick = { open: false, k: "com", q: "", mkt: SM[0].id };
  function renderMine(el) {
    const groups = KINDS.map(([k, label]) => [k, label, watch.filter((w) => kindOf(w) === k)]).filter((g) => g[2].length);
    if (!watch.length) pick.open = true; // nothing picked yet: start with the picker
    const showPick = pick.open;
    el.innerHTML = `<div class="mine">
      <div class="mine-h"><div><h2>My markets</h2><p class="muted">${watch.length ? `${watch.length} of ${MINE_MAX} picked. They also appear at the top of the homepage.` : "Pick the prices you check most: an index, a share, crude oil, gold, a currency or a coin."}</p></div>
        ${watch.length ? `<button class="btn ${showPick ? "" : "primary"}" id="mine-add" aria-expanded="${showPick}">${showPick ? "Done adding" : "Add markets"}</button>` : ""}</div>
      ${showPick ? pickerHTML() : ""}
      ${holdSummary()}
      ${groups.map(([k, label, list]) => `<section class="mine-g"><h3>${label}</h3><div class="mine-grid">${list.map((w) => `
        <div class="mcard"><a href="${yurl(w.s)}" data-sym="${esc(w.s)}">
          <span class="wc-n">${esc(w.n || w.s)}</span><span class="wc-s">${esc((CAT_BY[w.s] && CAT_BY[w.s].sub) || w.sub || tickerOf(w.s))}</span>
          <span class="wc-row"><span class="wc-p">${px(w.s)}</span>${chipS(w.s)}</span>${sparkS(w.s, 220, 34)}</a>
          <div class="mc-hold" data-pl="${esc(w.s)}">${plHTML(w)}</div>
          <button class="mc-x" data-unpick="${esc(w.s)}" aria-label="Remove ${esc(w.n || w.s)}" title="Remove"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        </div>`).join("")}</div></section>`).join("")}
    </div>`;
    if (showPick) drawPickList();
  }
  function pickerHTML() {
    return `<div class="picker" id="picker">
      <label class="pk-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m13 13 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input id="pk-q" type="search" placeholder="Search, e.g. crude, gold, Infosys, Tesla, yen" value="${esc(pick.q)}" autocomplete="off" aria-label="Search markets to add" /></label>
      <div class="pk-kinds" role="tablist" aria-label="Kind">${KINDS.filter(([k]) => k !== "oth").map(([k, l]) => `<button class="chip ${!pick.q && pick.k === k ? "on" : ""}" data-pk="${k}" role="tab" aria-selected="${!pick.q && pick.k === k}">${l}</button>`).join("")}</div>
      <div id="pk-list" class="pk-list" role="list"></div>
    </div>`;
  }
  function pickItems() {
    const q = pick.q.trim().toLowerCase();
    if (q) {
      const words = q.split(/\s+/);
      const local = CAT.filter((it) => { const h = (it.n + " " + it.sub + " " + it.s).toLowerCase(); return words.every((w) => h.includes(w)); }).slice(0, 30);
      const rem = remoteFor(q);
      const seen = new Set(local.map((it) => it.s));
      const extra = Array.isArray(rem) ? rem.filter((r) => !seen.has(r.symbol)).slice(0, 8).map((r) => ({ s: r.symbol, n: r.name, sub: [r.type, r.exchange].filter(Boolean).join(", "), k: { EQUITY: "stk", INDEX: "idx", CURRENCY: "fx", CRYPTOCURRENCY: "cry", FUTURE: "com" }[r.kind] || "oth", remote: true })) : [];
      return { rows: [...local, ...extra], note: rem === "loading" ? "Searching every market…" : !local.length && !extra.length ? `Nothing matches “${esc(pick.q)}”.` : "" };
    }
    if (pick.k === "stk") return { rows: CAT.filter((it) => it.k === "stk" && it.tag === pick.mkt), stocks: true };
    if (pick.k === "idx") return { rows: CAT.filter((it) => it.k === "idx"), grouped: true };
    return { rows: CAT.filter((it) => it.k === pick.k) };
  }
  function drawPickList() {
    const box = $("#pk-list");
    if (!box) return;
    const { rows, note, stocks, grouped } = pickItems();
    const missing = rows.map((r) => r.s).filter((s) => !state.quotes[s] && !pickBusy.has(s)).slice(0, 60);
    if (missing.length) { missing.forEach((s) => pickBusy.add(s)); quoteFor(missing).then(() => { missing.forEach((s) => pickBusy.delete(s)); patchPickPrices(); }); }
    let last = null;
    const row = (it) => {
      const on = isWatched(it.s), q = Qv(it.s);
      let head = "";
      if (grouped && it.tag !== last) { last = it.tag; head = `<p class="pk-sec">${esc(it.tag)}</p>`; }
      return head + `<button class="pk-item ${on ? "on" : ""}" data-pick="${esc(it.s)}" aria-pressed="${on}" role="listitem">
        <span class="pk-t"><b>${esc(it.n)}</b><small>${esc(it.sub)}</small></span>
        <span class="pk-r" data-pkp="${esc(it.s)}">${q.price != null ? `${money2(it.s, q.price)} ${chip(q.changePct)}` : ""}</span>
        <span class="pk-b" aria-hidden="true">${on ? "✓" : "+"}</span></button>`;
    };
    box.innerHTML = (stocks ? `<div class="pk-mkts">${SM.map((m) => `<button class="chip ${m.id === pick.mkt ? "on" : ""}" data-pkm="${m.id}">${m.flag} ${esc(m.name)}</button>`).join("")}</div>` : "")
      + rows.map(row).join("") + (note ? `<p class="pk-note">${note}</p>` : "");
  }
  const pickBusy = new Set();
  function patchPickPrices() {
    document.querySelectorAll("[data-pkp]").forEach((el) => { const q = Qv(el.dataset.pkp); if (q.price != null) el.innerHTML = `${money2(el.dataset.pkp, q.price)} ${chip(q.changePct)}`; });
  }
  function addPick(it) {
    if (isWatched(it.s)) { toggleWatch(it.s, true); return; }
    if (watch.length >= MINE_MAX) return toast(`You can pick up to ${MINE_MAX}. Remove one first.`);
    NAMES[it.s] = NAMES[it.s] || { name: it.n, sub: it.sub };
    if (it.k === "stk") STOCK_SET.add(it.s);
    watch.push({ s: it.s, n: it.n, sub: it.sub, k: it.k, stock: it.k === "stk" || undefined });
    store.set("wm-watch", watch); syncSave(); renderWatch();
    if (!state.quotes[it.s]) quoteFor([it.s]).then(() => { renderWatch(); if (state.view === "mine") patch(); });
  }
  document.addEventListener("click", (e) => {
    if (state.view !== "mine") return;
    const main = $("#main");
    if (!main.contains(e.target)) return;
    if (e.target.closest("#mine-add")) { pick.open = !pick.open; return renderMain(); }
    const u = e.target.closest("[data-unpick]");
    if (u) { e.preventDefault(); toggleWatch(u.dataset.unpick, true); return renderMain(); }
    const k = e.target.closest("[data-pk]");
    if (k) { pick.k = k.dataset.pk; pick.q = ""; return renderMain(); }
    const m = e.target.closest("[data-pkm]");
    if (m) { pick.mkt = m.dataset.pkm; return drawPickList(); }
    const p = e.target.closest("[data-pick]");
    if (p) {
      const it = CAT_BY[p.dataset.pick] || pickItems().rows.find((r) => r.s === p.dataset.pick);
      if (!it) return;
      const y = window.scrollY, listTop = $("#pk-list").scrollTop;
      addPick(it);
      renderMine(main); // keep the picker where it was
      $("#pk-list").scrollTop = listTop; window.scrollTo(0, y);
      const again = document.querySelector(`[data-pick="${CSS.escape(it.s)}"]`); if (again) again.focus({ preventScroll: true });
    }
  });
  let pkT;
  document.addEventListener("input", (e) => {
    if (e.target.id !== "pk-q") return;
    pick.q = e.target.value;
    document.querySelectorAll("[data-pk]").forEach((b) => { const on = !pick.q && b.dataset.pk === pick.k; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    clearTimeout(pkT); pkT = setTimeout(drawPickList, 120);
  });
  // Yahoo search answers arrive later; redraw the list when they do
  const remoteDone = () => { if (state.view === "mine" && pick.q && $("#pk-list")) drawPickList(); };

  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-goview]");
    if (!g) return;
    e.preventDefault(); setView(g.dataset.goview);
    const t = document.querySelector(".tabs-wrap");
    if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 8, behavior: REDUCED ? "auto" : "smooth" });
  });

  // ── holdings: buy lots (date, price, quantity, fees) for anything in My markets ──
  const canHold = (w) => !["idx", "rate"].includes(kindOf(w));
  // older saves kept one buy price and quantity; they become a single undated lot
  const lotsOf = (w) => (Array.isArray(w.lots) ? w.lots : w.buy ? [{ p: w.buy, q: w.qty || null, d: null }] : []);
  const toINR = (v, cur) => {
    if (v == null || !cur) return null;
    if (cur === "INR") return v;
    const usd = usdOf(v, cur), r = Qv("INR=X").price;
    return usd != null && r ? usd * r : null;
  };
  const inr = (v) => (v == null || !isFinite(v) ? "—" : (v < 0 ? "−" : "") + "₹" + Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 }));
  const signed = (s, v) => { if (v == null || !isFinite(v)) return "—"; const [a, b] = affix(s); return (v > 0 ? "+" : v < 0 ? "−" : "") + a + fmt(Math.abs(v)) + b; };
  const qtyFmt = (q) => q.toLocaleString("en-US", { maximumFractionDigits: 6 });
  const yr = (r) => (r == null ? "" : `${r >= 0 ? "+" : "−"}${Math.abs(r * 100).toFixed(1)}% a year`);
  function plHTML(w) {
    const lots = lotsOf(w);
    if (!lots.length) return canHold(w) ? `<button class="hold-add" data-hold="${esc(w.s)}">+ Add what you bought</button>` : "";
    const h = C.holding(lots, Qv(w.s).price);
    const term = h.shortQty != null && kindOf(w) === "stk" && curOf(w.s) === "INR"
      ? (h.shortQty === 0 ? "all held over a year" : h.longQty === 0 ? "all held under a year" : `${qtyFmt(h.longQty)} over a year, ${qtyFmt(h.shortQty)} under`) : "";
    return `<button class="hold" data-hold="${esc(w.s)}" title="Edit what you bought">
      <span class="muted">${h.qty ? `${qtyFmt(h.qty)} at ${money2(w.s, h.avg)} average` : `Bought at ${money2(w.s, h.avg)}`}${h.lots > 1 ? `, ${h.lots} buys` : ""}</span>
      <span class="${cls(h.plPct)}"><b>${pct(h.plPct == null ? null : h.plPct * 100)}</b>${h.pl != null ? ` ${signed(w.s, h.pl)}` : ""}${h.irr != null ? ` <small>(${yr(h.irr)})</small>` : ""}</span>
      ${term ? `<span class="muted small">${term}</span>` : ""}</button>`;
  }
  // Nifty 50 daily history, to compare with putting the same money into the index on the same dates
  let bench = null, benchBusy = false;
  function ensureBench() {
    if (bench || benchBusy) return;
    benchBusy = true;
    getChart("^NSEI", "5y").then((d) => { bench = d.points; if (state.view === "mine") renderMain(); }).catch(() => {}).finally(() => { benchBusy = false; });
  }
  function portfolio() {
    const hs = watch.filter((w) => canHold(w) && lotsOf(w).some((l) => l.q > 0));
    let cost = 0, value = 0, miss = 0, flows = [], benchLots = [], undated = 0;
    const byKind = {}, byCur = {};
    hs.forEach((w) => {
      const c = curOf(w.s), p = Qv(w.s).price, lots = lotsOf(w).filter((l) => l.p > 0 && l.q > 0);
      const h = C.holding(lots, p);
      const a = toINR(h.cost, c), b = h.value != null ? toINR(h.value, c) : null;
      if (a == null || b == null) { miss++; return; }
      cost += a; value += b;
      const k = KINDS.find((x) => x[0] === kindOf(w))[1];
      byKind[k] = (byKind[k] || 0) + b; byCur[c] = (byCur[c] || 0) + b;
      // money in, in rupees at today's rate (an approximation for foreign holdings)
      const rate = a / h.cost;
      lots.forEach((l) => {
        const amt = (l.p * l.q + (l.fee || 0)) * rate;
        if (l.d) { flows.push([Date.parse(l.d), -amt]); benchLots.push({ d: l.d, p: amt, q: 1 }); } else undated++;
      });
    });
    if (!hs.length) return null;
    const irr = !undated && flows.length ? C.xirr([...flows, [Date.now(), value]]) : null;
    let vsNifty = null;
    if (bench && !undated && benchLots.length) {
      const pts = bench.map((x) => [x[0], x[1]]);
      // today's level: the live quote, unless it disagrees wildly with the history (then the history's last close)
      const last = pts[pts.length - 1][1], live = Qv("^NSEI").price;
      vsNifty = C.benchmark(benchLots, (d) => C.closeOn(pts, d), live && Math.abs(live / last - 1) < 0.15 ? live : last);
    }
    return { n: hs.length - miss, miss, cost, value, gain: value - cost, irr, vsNifty, undated, byKind, byCur };
  }
  function bars(obj, total) {
    const list = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    const hue = ["var(--sun)", "var(--cmp)", "var(--up)", "var(--ma200)", "var(--ma50)", "var(--muted)"];
    return `<div class="alloc-bar">${list.map(([, v], i) => `<i style="flex:${v};background:${hue[i % hue.length]}"></i>`).join("")}</div>
      <ul class="alloc-key">${list.map(([k, v], i) => `<li><i style="background:${hue[i % hue.length]}"></i>${esc(k)} <b>${Math.round((v / total) * 100)}%</b></li>`).join("")}</ul>`;
  }
  function holdSummary() {
    const P = portfolio();
    if (!P) return "";
    if (!P.undated) ensureBench();
    const g = P.cost ? P.gain / P.cost : null;
    const nifty = P.vsNifty ? `<div><span class="muted">Same money in the Nifty 50</span><b>${inr(P.vsNifty.value)} <small class="${cls(P.vsNifty.ret)}">${pct(P.vsNifty.ret * 100)}</small></b>
      <span class="muted small">${P.value >= P.vsNifty.value ? "You're ahead by " + inr(P.value - P.vsNifty.value) : "The index is ahead by " + inr(P.vsNifty.value - P.value)}</span></div>` : "";
    return `<div class="hold-sum" data-holdsum>
      <div class="hs-nums">
        <div><span class="muted">Invested</span><b>${inr(P.cost)}</b></div>
        <div><span class="muted">Worth now</span><b>${inr(P.value)}</b></div>
        <div><span class="muted">Gain or loss</span><b class="${cls(P.gain)}">${P.gain > 0 ? "+" : ""}${inr(P.gain)} <small>${pct(g == null ? null : g * 100)}</small></b>${P.irr != null ? `<span class="muted small">${yr(P.irr)} (XIRR)</span>` : ""}</div>
        ${nifty}
      </div>
      ${P.value > 0 ? `<div class="hs-alloc"><div><h4>By type</h4>${bars(P.byKind, P.value)}</div><div><h4>By currency</h4>${bars(P.byCur, P.value)}</div></div>` : ""}
      <p class="muted">${P.n} holding${P.n === 1 ? "" : "s"}, in rupees at today's exchange rates.${P.undated ? " Add buy dates to see the yearly return and the Nifty comparison." : ""}${P.miss ? ` ${P.miss} left out while their price loads.` : ""} Not tax or investment advice.</p>
    </div>`;
  }
  function patchHoldings() {
    if (state.view !== "mine") return;
    document.querySelectorAll("[data-pl]").forEach((el) => { const w = watch.find((x) => x.s === el.dataset.pl); if (w) el.innerHTML = plHTML(w); });
    const sum = document.querySelector("[data-holdsum]");
    if (sum) sum.outerHTML = holdSummary() || "";
  }
  function holdBox(w) {
    const [a, b] = affix(w.s);
    const unit = (a.trim() || b.trim() || curOf(w.s) || "").trim();
    const today = new Date().toLocaleDateString("en-CA");
    let lots = lotsOf(w).map((l) => ({ ...l }));
    if (!lots.length) lots = [{ d: today, p: null, q: null, fee: null }];
    const d = document.createElement("div");
    d.className = "confirm"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-labelledby", "hb-t");
    const row = (l, i) => `<fieldset class="lot" data-i="${i}"><legend class="vh">Buy ${i + 1}</legend>
      <label>Date<input name="d" type="date" max="${today}" value="${l.d || ""}" /></label>
      <label>Price${unit ? ` (${esc(unit)})` : ""}<input name="p" type="text" inputmode="decimal" autocomplete="off" value="${l.p ?? ""}" placeholder="${Qv(w.s).price != null ? fmt(Qv(w.s).price).replace(/,/g, "") : ""}" /></label>
      <label>Quantity<input name="q" type="text" inputmode="decimal" autocomplete="off" value="${l.q ?? ""}" /></label>
      <label>Fees<input name="fee" type="text" inputmode="decimal" autocomplete="off" value="${l.fee ?? ""}" placeholder="0" /></label>
      <button type="button" class="mc-x lot-x" data-rm="${i}" aria-label="Remove buy ${i + 1}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></fieldset>`;
    const draw = () => {
      d.innerHTML = `<form class="cbox hbox" novalidate>
        <h3 id="hb-t">${esc(w.n || w.s)}</h3>
        <p>One line for each time you bought. Dates give you the yearly return and the Nifty comparison; quantity gives you amounts. Only you can see this.</p>
        <div class="lots">${lots.map(row).join("")}</div>
        <button type="button" class="linkbtn" data-addlot>+ Add another buy</button>
        <p class="auth-msg" hidden></p>
        <div class="cbtns">${lotsOf(w).length ? `<button type="button" class="btn" data-a="del">Remove all</button>` : ""}<button type="button" class="btn" data-a="no">Cancel</button><button type="submit" class="btn primary">Save</button></div>
      </form>`;
    };
    const read = () => [...d.querySelectorAll(".lot")].map((f) => Object.fromEntries(["d", "p", "q", "fee"].map((k) => [k, f.querySelector(`[name=${k}]`).value])));
    const num = (v) => { v = String(v).replace(/[,\s₹$£€¥]/g, ""); return v === "" ? null : +v; };
    draw();
    document.body.appendChild(d);
    const msg = () => d.querySelector(".auth-msg");
    const close = () => { d.remove(); const x = document.querySelector(`[data-hold="${CSS.escape(w.s)}"]`); if (x) x.focus({ preventScroll: true }); };
    const done = () => { delete w.buy; delete w.qty; store.set("wm-watch", watch); syncSave(); close(); if (state.view === "mine") { const y = window.scrollY; renderMain(); window.scrollTo(0, y); } };
    const err = (t, el) => { const m = msg(); m.textContent = t; m.hidden = false; if (el) el.focus(); };
    d.addEventListener("submit", (e) => {
      e.preventDefault();
      const raw = read(), out = [];
      for (let i = 0; i < raw.length; i++) {
        const r = raw[i], f = d.querySelectorAll(".lot")[i];
        if (!r.p && !r.q && !r.fee) continue; // an empty line is ignored
        const p = num(r.p), q = num(r.q), fee = num(r.fee);
        if (p == null || !isFinite(p) || p <= 0) return err(`Buy ${i + 1}: enter the price you paid, as a number above zero.`, f.querySelector("[name=p]"));
        if (q != null && (!isFinite(q) || q <= 0)) return err(`Buy ${i + 1}: quantity should be a number above zero, or leave it empty.`, f.querySelector("[name=q]"));
        if (fee != null && (!isFinite(fee) || fee < 0)) return err(`Buy ${i + 1}: fees should be zero or more.`, f.querySelector("[name=fee]"));
        if (r.d && r.d > today) return err(`Buy ${i + 1}: the date can't be in the future.`, f.querySelector("[name=d]"));
        const l = { p };
        if (r.d) l.d = r.d; if (q) l.q = q; if (fee) l.fee = fee;
        out.push(l);
      }
      if (!out.length) return err("Enter at least one price, or choose Remove all.");
      if (out.length > 1 && out.some((l) => !l.q)) return err("With more than one buy, give each a quantity so they can be added up.");
      w.lots = out.sort((x, y) => (x.d || "").localeCompare(y.d || ""));
      done(); toast(`Saved ${out.length > 1 ? out.length + " buys" : "your buy"} for ${w.n || w.s}`);
    });
    d.addEventListener("click", (e) => {
      const b2 = e.target.closest("[data-a]");
      if (e.target === d || (b2 && b2.dataset.a === "no")) return close();
      if (b2 && b2.dataset.a === "del") { delete w.lots; done(); toast("Removed what you bought"); return; }
      if (e.target.closest("[data-addlot]")) {
        lots = read().map((r) => ({ d: r.d, p: r.p, q: r.q, fee: r.fee }));
        if (lots.length >= 30) return err("Up to 30 buys per holding.");
        lots.push({ d: today, p: null, q: null, fee: null }); draw();
        d.querySelectorAll(".lot")[lots.length - 1].querySelector("[name=p]").focus();
      }
      const rm = e.target.closest("[data-rm]");
      if (rm) { lots = read().map((r) => ({ d: r.d, p: r.p, q: r.q, fee: r.fee })); lots.splice(+rm.dataset.rm, 1); if (!lots.length) lots.push({ d: today, p: null, q: null, fee: null }); draw(); }
    });
    d.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    d.addEventListener("input", () => (msg().hidden = true));
    setTimeout(() => { const f = d.querySelector("[name=p]"); if (f) f.focus(); }, 30);
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-hold]");
    if (!b) return;
    e.preventDefault();
    const w = watch.find((x) => x.s === b.dataset.hold);
    if (w) holdBox(w);
  });

  // ── accounts ─────────────────────────────────────────────────────────────
  let pendingChart = null, authMode = "in", authWhy = null;
  document.addEventListener("click", (e) => { if (e.target.closest("[data-joinx]")) { store.set("wm-join-x", 1); renderWatch(); } });
  const WHY = {
    join: () => "Keep your own list of markets and track what you've bought.",
    mine: () => "Sign in to keep your own list of markets and track what you've bought.",
    chart: (n) => `Sign in to open the chart${n ? " for " + n : ""}.`,
    view: () => "Sign in to see this part of World Markets.",
    watch: () => "Sign in to keep a watchlist.",
    search: () => "Sign in to search every listed company.",
  };
  const LOCK_COPY = {
    mine: ["My markets", "Your own list of prices to follow: indices, shares, crude oil, gold, currencies, crypto and bond yields."],
    map: ["World map", "Every market on one map, with a 24-hour timeline of trading sessions."],
    heat: ["Heatmap", "Every index, shaded by today's move, grouped by region."],
    table: ["Table", "All markets in one sortable table: price, day, month and year changes."],
    stocks: ["Stocks", "The largest companies in seven markets, with valuations, dividends and results dates."],
    cal: ["Calendar", "Central bank meetings, inflation releases, company results and market holidays."],
    india: ["India", "Nifty, Sensex, sector indices and the top 50 companies with valuation columns."],
  };
  function renderVerify(main) {
    main.innerHTML = `<div class="locked-panel">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>
      <h2>Confirm your email</h2>
      <p>We sent a link to <b>${esc(AU.user.email)}</b>. Click it, then come back here. Check your spam folder if it isn't there.</p>
      <button class="btn primary" data-verified>I've clicked the link</button>
      <p class="muted small"><button class="linkbtn" data-resend>Send the email again</button></p>
    </div>`;
  }
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-verified]")) {
      await AU.refresh().catch(() => {});
      if (unverified()) toast("Not confirmed yet. Click the link in the email first.");
      else { toast("Email confirmed"); pullSettings(); }
    }
    if (e.target.closest("[data-resend]")) {
      try { await AU.resendVerification(); toast("Sent. Check your inbox."); }
      catch (x) { toast(x && x.code === "auth/too-many-requests" ? "Already sent recently. Wait a few minutes." : "Couldn't send it. Try again later."); }
    }
  });
  function renderLocked(main) {
    const [t, d] = LOCK_COPY[state.view] || ["This view", ""];
    main.innerHTML = `<div class="locked-panel">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>
      <h2>${esc(t)}</h2><p>${esc(d)}</p>
      ${AU.known ? `<button class="btn primary" data-signin="${state.view === "mine" ? "mine" : "view"}">Sign in to continue</button><p class="muted small">Free. Use your Google account or an email and password.</p>`
        : `<p class="muted small">Checking whether you're signed in…</p>`}
    </div>`;
  }
  const authEl = $("#auth");
  let authFocus = null;
  function openAuth(why, name) {
    authWhy = why;
    $("#auth-why").textContent = AU.unavailable || (WHY[why] || WHY.view)(name);
    setAuthMode(why === "join" ? "up" : "in");
    authFocus = document.activeElement;
    authEl.hidden = false; requestAnimationFrame(() => authEl.classList.add("in"));
    document.body.classList.add("locked");
    setTimeout(() => $("#auth-google").focus({ preventScroll: true }), 60);
  }
  function closeAuth(keepPending) {
    if (authEl.hidden) return;
    if (!keepPending) pendingChart = null;
    authEl.classList.remove("in");
    setTimeout(() => { authEl.hidden = true; }, REDUCED ? 0 : 200);
    if (!modal.sym) document.body.classList.remove("locked");
    if (authFocus && authFocus.focus) authFocus.focus({ preventScroll: true });
  }
  function setAuthMode(m) {
    authMode = m;
    const f = $("#auth-form");
    f.dataset.mode = m;
    $("#auth-title").textContent = { in: "Sign in", up: "Create your account", reset: "Reset your password" }[m];
    $("#auth-name-row").hidden = m !== "up";
    $("#auth-pw-row").hidden = m === "reset";
    $("#auth-pw").autocomplete = m === "up" ? "new-password" : "current-password";
    $("#auth-submit").textContent = { in: "Sign in", up: "Create account", reset: "Send reset link" }[m];
    $("#auth-switch").innerHTML = m === "up" ? `Already have an account? <button type="button" class="linkbtn" data-mode="in">Sign in</button>`
      : m === "reset" ? `<button type="button" class="linkbtn" data-mode="in">Back to sign in</button>`
      : `New here? <button type="button" class="linkbtn" data-mode="up">Create an account</button>`;
    $("#auth-forgot").hidden = m !== "in";
    $("#auth-alt").hidden = m === "reset";
    authMsg("");
  }
  function authMsg(t, ok) { const el = $("#auth-msg"); el.textContent = t; el.className = "auth-msg" + (ok ? " ok" : ""); el.hidden = !t; }
  const ERR = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/invalid-credential": "That email and password don't match an account. Check them, or create an account.",
    "auth/wrong-password": "That email and password don't match an account. Check them, or create an account.",
    "auth/user-not-found": "That email and password don't match an account. Check them, or create an account.",
    "auth/email-already-in-use": "There's already an account with that email. Sign in instead, or reset the password.",
    "auth/weak-password": "Use a password of at least 6 characters.",
    "auth/missing-password": "Enter your password.",
    "auth/too-many-requests": "Too many tries. Wait a few minutes, or reset your password.",
    "auth/network-request-failed": "No connection to the sign-in service. Check your internet and try again.",
    "auth/popup-closed-by-user": "",
    "auth/cancelled-popup-request": "",
    "auth/unauthorized-domain": "Sign-in isn't allowed on this web address yet. The site owner needs to add it in Firebase.",
    "auth/operation-not-allowed": "This sign-in method isn't switched on yet.",
    "auth/account-exists-with-different-credential": "That email already signs in another way. Use email and password, or the method you used before.",
    "auth/requires-recent-login": "For safety, sign out and back in, then try again.",
  };
  const errText = (e) => (e && e.code in ERR ? ERR[e.code] : (e && e.message) || "Something went wrong. Try again.");
  async function busy(btn, fn) {
    if (AU.unavailable) return authMsg(AU.unavailable);
    btn.disabled = true; authEl.classList.add("busy");
    try { await fn(); } catch (e) { authMsg(errText(e)); }
    btn.disabled = false; authEl.classList.remove("busy");
  }
  $("#auth-google").onclick = (e) => busy(e.currentTarget, () => AU.signInGoogle());
  $("#auth-form").onsubmit = (e) => {
    e.preventDefault();
    const email = $("#auth-email").value.trim(), pw = $("#auth-pw").value, name = $("#auth-name").value.trim();
    if (!email) return authMsg("Enter your email address.");
    if (authMode === "reset") return busy($("#auth-submit"), async () => { await AU.resetPassword(email); authMsg(`If there's an account for ${email}, a reset link is on its way. Check your inbox.`, true); });
    if (!pw) return authMsg("Enter your password.");
    busy($("#auth-submit"), () => (authMode === "up" ? AU.signUpEmail(email, pw, name) : AU.signInEmail(email, pw)));
  };
  $("#auth-form").addEventListener("input", () => authMsg(""));
  authEl.addEventListener("click", (e) => {
    if (e.target === authEl || e.target.closest("#auth-close")) return closeAuth();
    const m = e.target.closest("[data-mode]");
    if (m) { setAuthMode(m.dataset.mode); (m.dataset.mode === "up" ? $("#auth-name") : $("#auth-email")).focus(); }
    if (e.target.closest("#auth-forgot")) { setAuthMode("reset"); $("#auth-email").focus(); }
  });
  authEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); return closeAuth(); }
    if (e.key === "Tab") { // keep focus inside the sheet
      const f = [...authEl.querySelectorAll("button:not([disabled]), input:not([hidden]), a[href]")].filter((x) => x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  // any "sign in" button anywhere on the page
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-signin]");
    if (!b) return;
    e.preventDefault(); closePop();
    openAuth(b.dataset.signin);
  });

  // header account button and menu
  const acct = $("#acct"), amenu = $("#acct-menu");
  const initials = (u) => (u.name || u.email || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  function renderAcct() {
    const u = AU.user;
    acct.classList.toggle("signed", !!u);
    acct.setAttribute("aria-label", u ? "Your account" : "Sign in");
    acct.innerHTML = !AU.known ? `<span class="acct-dot"></span>`
      : u ? (u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer" />` : `<span class="acct-ini">${esc(initials(u))}</span>`)
      : `<span>Sign in</span>`;
    if (u) {
      $("#am-name").textContent = u.name;
      $("#am-email").textContent = u.email;
    } else toggleAcct(false);
  }
  function toggleAcct(on) {
    amenu.hidden = !on; acct.setAttribute("aria-expanded", on);
    if (on) amenu.querySelector("button").focus();
  }
  acct.onclick = (e) => { e.stopPropagation(); if (!AU.known) return; if (!AU.user) return openAuth("view"); toggleAcct(amenu.hidden); };
  document.addEventListener("click", (e) => { if (!amenu.hidden && !e.target.closest("#acct-menu")) toggleAcct(false); });
  amenu.addEventListener("keydown", (e) => { if (e.key === "Escape") { toggleAcct(false); acct.focus(); } });
  $("#am-out").onclick = async () => { toggleAcct(false); await AU.signOut(); toast("You're signed out"); };
  $("#am-delete").onclick = async () => {
    toggleAcct(false);
    const sure = await confirmBox("Delete your account?", "This removes your account, your watchlist and your saved settings from World Markets. It can't be undone.", "Delete account");
    if (!sure) return;
    try { await AU.deleteAccount(); toast("Your account has been deleted"); }
    catch (e) { toast(e && e.code === "auth/requires-recent-login" ? "For safety, sign out and back in, then delete the account." : errText(e)); }
  };
  // a small in-page confirm, so nothing blocks the page
  function confirmBox(title, body, yes) {
    return new Promise((done) => {
      const d = document.createElement("div");
      d.className = "confirm"; d.setAttribute("role", "alertdialog"); d.setAttribute("aria-modal", "true");
      d.innerHTML = `<div class="cbox"><h3>${esc(title)}</h3><p>${esc(body)}</p><div class="cbtns"><button class="btn" data-a="0">Keep my account</button><button class="btn danger" data-a="1">${esc(yes)}</button></div></div>`;
      document.body.appendChild(d);
      const end = (v) => { d.remove(); done(v); };
      d.addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (b) end(b.dataset.a === "1"); else if (e.target === d) end(false); });
      d.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); end(false); } });
      d.querySelector("[data-a='0']").focus();
    });
  }

  // watchlist and settings live in the account, so they follow the visitor to other devices
  let saveT, syncing = false, dirty = false;
  const flush = () => { clearTimeout(saveT); if (!dirty || !authed() || unverified()) return; dirty = false; AU.save({ watch, theme: store.get("wm-theme") || "auto", cb: !!store.get("wm-cb"), copts }).catch((e) => { dirty = true; console.warn("save failed", e); }); };
  function syncSave() {
    if (!authed() || unverified() || syncing) return;
    dirty = true; clearTimeout(saveT); saveT = setTimeout(flush, 400);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
  async function pullSettings() {
    let d = null;
    try { d = await AU.load(); } catch (e) { console.warn("load failed", e); }
    syncing = true;
    if (d) {
      if (Array.isArray(d.watch)) {
        // the account's copy wins: picks can only be changed while signed in, so it is always the latest
        watch.splice(0, watch.length, ...d.watch.filter((w) => w && w.s).slice(0, 60));
        watch.forEach((w) => { NAMES[w.s] = NAMES[w.s] || { name: w.n || w.s, sub: w.sub || "" }; if (w.stock) STOCK_SET.add(w.s); });
        store.set("wm-watch", watch);
      }
      if (d.theme) store.set("wm-theme", d.theme);
      if (typeof d.cb === "boolean") store.set("wm-cb", d.cb);
      if (d.copts) Object.assign(copts, d.copts), store.set("wm-copts", copts);
      applyTheme();
    }
    syncing = false;
    if (!d) syncSave(); // first sign-in: create the account's settings
    const missing = watch.map((w) => w.s).filter((s) => !state.quotes[s]);
    if (missing.length) quoteFor(missing).then(renderWatch);
    render();
  }
  let lastUid;
  function onAuth(u) {
    const uid = u ? u.uid : null;
    renderAcct();
    if (uid === lastUid && lastUid !== undefined) return render();
    const first = lastUid === undefined;
    lastUid = uid;
    if (u) {
      const go = pendingChart;
      closeAuth(true); pendingChart = null;
      if (!first) toast(`Signed in as ${u.name}`);
      pullSettings();
      if (go) { modal.range = go.range || modal.range; modal.cmp = go.cmp; openChart(go.s, false, !!go.cmp); }
      else if (first) applyHash(true);
    } else {
      if (!first) { watch.splice(0); store.set("wm-watch", []); } // signing out clears this device
      if (modal.sym) closeChart();
      render();
      if (first) applyHash(true);
    }
  }
  renderAcct();

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

  // the address can name a view and a chart: #india&chart=TCS.NS&range=1y&vs=^NSEI
  function readHash() {
    const hp = location.hash.slice(1).split("&").filter(Boolean);
    const view = hp[0] && !hp[0].includes("=") ? hp[0] : "cards";
    const q = Object.fromEntries(hp.filter((x) => x.includes("=")).map((x) => { const i = x.indexOf("="); return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))]; }));
    return { view: ["mine", "map", "heat", "table", "stocks", "cal", "india"].includes(view) ? view : "cards", ...q };
  }
  function applyHash(first) {
    const h = readHash();
    if (h.view !== state.view) setView(h.view, { instant: true });
    if (h.chart) {
      if (RANGES.some((r) => r[0] === h.range)) modal.range = h.range;
      const same = modal.sym === h.chart;
      modal.cmp = h.vs || null;
      if (!same || first) openChart(h.chart, false, true); else drawModal();
    } else if (modal.sym) closeChart();
  }
  window.addEventListener("hashchange", () => applyHash(false));
  render();
  if (AU.known) applyHash(true); else { const v = readHash().view; if (v !== state.view) setView(v, { instant: true }); }
  AU.onChange(onAuth);
  requestAnimationFrame(moveInk);
  if (document.fonts) document.fonts.ready.then(moveInk);
  load();
  setInterval(load, REFRESH_MS);
  setInterval(() => { renderHero(); patchStatus(); if (state.view === "map") renderTimeline($("#timeline")); }, 30_000);
})();
