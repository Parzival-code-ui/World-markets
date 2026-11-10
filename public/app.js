(() => {
  const REFRESH_MS = 60_000;
  const M = window.MARKETS;
  const G = window.GLOBAL;
  const IN = window.INDIA;
  const REGIONS = ["All", "Americas", "Europe", "Middle East & Africa", "Asia-Pacific"];
  const CLOCKS = [["New York", "America/New_York"], ["São Paulo", "America/Sao_Paulo"], ["London", "Europe/London"], ["Frankfurt", "Europe/Berlin"], ["Dubai", "Asia/Dubai"], ["Mumbai", "Asia/Kolkata"], ["Shanghai", "Asia/Shanghai"], ["Tokyo", "Asia/Tokyo"], ["Sydney", "Australia/Sydney"]];

  const state = { quotes: {}, region: "All", view: "cards", q: "", openOnly: false, sort: { key: "changePct", dir: -1 }, stockSort: { key: "changePct", dir: -1 }, fetchedAt: null, mock: false, error: null };

  // ── symbols & names ──────────────────────────────────────────────────────
  const fx = (c) => (c === "USD" ? null : c + "=X");
  const symbols = new Set(["INR=X"]);
  const NAMES = {}; // symbol → { name, sub }
  M.forEach((c) => {
    c.indices.forEach(([s, n]) => { symbols.add(s); NAMES[s] = { name: n, sub: `${c.flag} ${c.name} · ${c.exchange}` }; });
    if (fx(c.ccy)) symbols.add(fx(c.ccy));
    if (c.y10Live) symbols.add(c.y10Live);
  });
  G.forEach((g) => g.items.forEach(([s, n, u]) => { symbols.add(s); NAMES[s] = { name: n, sub: g.group + (u ? " · " + u : "") }; }));
  IN.headline.forEach(([s, n]) => { symbols.add(s); NAMES[s] = NAMES[s] || { name: n, sub: "🇮🇳 India" }; });
  IN.sectors.forEach(([s, n]) => { symbols.add(s); NAMES[s] = NAMES[s] || { name: "Nifty " + n, sub: "🇮🇳 India · sector index" }; });
  IN.stocks.forEach(([s, n, sec]) => { symbols.add(s); NAMES[s] = { name: n, sub: `🇮🇳 NSE: ${s.replace(".NS", "")} · ${sec}` }; });
  NAMES["INR=X"] = NAMES["INR=X"] || { name: "USD / INR", sub: "Rupees per US dollar" };

  // ── helpers ──────────────────────────────────────────────────────────────
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const yurl = (s) => "https://finance.yahoo.com/quote/" + encodeURIComponent(s);
  function fmt(v, d) {
    if (v == null || !isFinite(v)) return "—";
    if (d == null) d = Math.abs(v) >= 1 ? 2 : 4;
    return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function pct(v) {
    if (v == null || !isFinite(v)) return '<span class="na">—</span>';
    return (v > 0 ? "+" : "") + v.toFixed(2) + "%";
  }
  const cls = (v) => (v == null || !isFinite(v) ? "na" : v > 0 ? "up" : v < 0 ? "down" : "");
  const sym = (s, inner, extra = "") => `<a href="${yurl(s)}" data-sym="${esc(s)}" class="lnk ${extra}">${inner}</a>`;

  function spark(arr, w = 64, h = 22) {
    if (!arr || arr.length < 2) return `<svg class="spark" style="width:${w}px;height:${h}px"></svg>`;
    const min = Math.min(...arr), max = Math.max(...arr), r = max - min || 1;
    const d = arr.map((v, i) => (i ? "L" : "M") + ((i / (arr.length - 1)) * w).toFixed(1) + " " + (h - 2 - ((v - min) / r) * (h - 4)).toFixed(1)).join("");
    const col = arr[arr.length - 1] >= arr[0] ? "var(--up)" : "var(--down)";
    return `<svg class="spark" style="width:${w}px;height:${h}px" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  function heatColor(p, max = 3) {
    if (p == null || !isFinite(p)) return "#2a3040";
    const t = Math.min(Math.abs(p) / max, 1);
    const tgt = p >= 0 ? [22, 163, 74] : [220, 38, 38];
    const base = [42, 48, 64];
    return `rgb(${base.map((v, i) => Math.round(v + (tgt[i] - v) * (0.25 + 0.75 * t))).join(",")})`;
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
  function status(c) {
    const { wd, min, label } = localParts(c.tz);
    const ses = c.sessions.map(([a, b]) => [toMin(a), toMin(b)]);
    if (c.days.includes(wd)) {
      for (const [a, b] of ses) if (min >= a && min < b) return { kind: "open", text: "Open", sub: "closes in " + dur(b - min), label };
      if (min >= ses[0][0] && min < ses[ses.length - 1][1]) {
        const next = ses.find(([a]) => a > min);
        return { kind: "lunch", text: "Lunch break", sub: "reopens in " + dur(next[0] - min), label };
      }
    }
    let best = Infinity;
    for (let d = 0; d < 8; d++) {
      if (!c.days.includes((wd + d) % 7)) continue;
      const m = d * 1440 + ses[0][0] - min;
      if (m > 0) { best = m; break; }
    }
    return { kind: "closed", text: "Closed", sub: "opens in " + dur(best), label };
  }
  function dur(m) {
    if (!isFinite(m)) return "—";
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
  }

  // ── data fetch ───────────────────────────────────────────────────────────
  async function load() {
    $("#refresh").disabled = true;
    try {
      const r = await fetch("/api/quotes?symbols=" + encodeURIComponent([...symbols].join(",")));
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      state.quotes = j.quotes || {};
      state.fetchedAt = j.fetchedAt || Date.now();
      state.mock = !!j.mock;
      state.error = null;
    } catch (e) {
      state.error = e.message;
    }
    $("#refresh").disabled = false;
    render();
  }

  // ── top sections ─────────────────────────────────────────────────────────
  function renderStatus() {
    const n = Object.values(state.quotes).filter((x) => x && x.price != null).length;
    let t = state.fetchedAt ? `${n} live quotes · updated ${new Date(state.fetchedAt).toLocaleTimeString()} · auto-refresh 60s · click any index for its chart` : "Loading quotes…";
    if (state.error) t = `Couldn't load quotes (${state.error}). Showing reference data only.`;
    $("#status-line").textContent = t;
    $("#demo-banner").hidden = !state.mock;
  }
  function renderClocks() {
    $("#clocks").innerHTML = CLOCKS.map(([n, tz]) => `<div class="clock"><span>${n}</span><span class="t">${localParts(tz).label}</span></div>`).join("");
  }
  function renderGlobal() {
    $("#global").innerHTML = G.map((g) => `
      <div class="gbox"><h3>${esc(g.group)}</h3>
        ${g.items.map(([s, n, u]) => {
          const q = state.quotes[s] || {};
          return `<div class="grow">${sym(s, `${esc(n)}<span class="u">${esc(u)}</span>`, "n")}
            <div class="num">${fmt(q.price)}</div><div class="chg ${cls(q.changePct)}">${pct(q.changePct)}</div>${spark(q.spark)}</div>`;
        }).join("")}
      </div>`).join("");
  }

  function filtered() {
    const q = state.q.toLowerCase();
    return M.filter((c) => (state.region === "All" || c.region === state.region)
      && (!state.openOnly || status(c).kind === "open")
      && (!q || c.name.toLowerCase().includes(q) || c.exchange.toLowerCase().includes(q) || c.ccy.toLowerCase().includes(q) || c.indices.some(([s, n]) => n.toLowerCase().includes(q) || s.toLowerCase().includes(q))));
  }

  // ── country cards ────────────────────────────────────────────────────────
  function fxCell(c) {
    const usdinr = (state.quotes["INR=X"] || {}).price;
    if (c.ccy === "USD") return { v: usdinr ? "₹" + fmt(usdinr, 2) : "—", d: "1 USD in INR" };
    const q = state.quotes[fx(c.ccy)] || {};
    const per = q.price;
    if (c.ccy === "INR") return { v: per ? fmt(per, 2) : "—", d: `INR per USD <span class="${cls(-q.changePct)}">${q.changePct != null ? pct(-q.changePct) : ""}</span>` };
    const big = per && per > 20;
    const vsInr = per && usdinr ? usdinr / per : null;
    return {
      v: per ? (big ? fmt(per, 2) + " " + c.ccy : "$" + fmt(1 / per, 4)) : "—",
      d: (big ? `${c.ccy} per USD` : `1 ${c.ccy} in USD`) + (vsInr ? ` · ₹${fmt(vsInr, vsInr < 1 ? 4 : 2)}` : ""),
    };
  }
  function macro(c) {
    const f = fxCell(c);
    const pol = c.policy ? { v: c.policy[0].toFixed(2) + "%", d: c.policy[1] } : { v: "—", d: c.policyNote || "n/a" };
    let y;
    const yl = c.y10Live && state.quotes[c.y10Live];
    if (yl && yl.price != null) y = { v: fmt(yl.price, 2) + '%<span class="live">LIVE</span>', d: (yl.change != null ? (yl.change >= 0 ? "+" : "") + (yl.change * 100).toFixed(0) + " bp today" : "") };
    else if (c.y10) y = { v: c.y10[0].toFixed(2) + "%", d: c.y10[1] };
    else y = { v: c.wgb ? `<a href="https://www.worldgovernmentbonds.com/country/${c.wgb}/" target="_blank" rel="noopener">view ↗</a>` : "—", d: "no free feed" };
    const mc = c.mcap ? { v: "$" + c.mcap[0].toFixed(1) + "T", d: c.mcap[1] } : { v: "—", d: "" };
    const cell = (k, o) => `<div><div class="k">${k}</div><div class="v">${o.v}</div><div class="d">${o.d}</div></div>`;
    return `<div class="macro">${cell("Currency", f)}${cell("Policy rate", pol)}${cell("10Y yield", y)}${cell("Market cap", mc)}</div>`;
  }
  function card(c) {
    const s = status(c);
    const rows = c.indices.map(([s2, n]) => {
      const q = state.quotes[s2] || {};
      return `<div class="idx"><div class="nm">${sym(s2, esc(n))}</div>
        <div class="num">${fmt(q.price)}</div><div class="chg ${cls(q.changePct)}">${pct(q.changePct)}</div>
        <div class="m1 ${cls(q.change1mPct)}">${q.change1mPct != null ? pct(q.change1mPct) : ""}</div>${spark(q.spark)}</div>`;
    }).join("");
    return `<article class="card" id="c-${c.id}">
      <div class="card-h">
        <div><div class="title"><span class="flag">${c.flag}</span><h2>${esc(c.name)}</h2></div><div class="ex">${esc(c.exchange)} · ${c.sessions.map((x) => x.join("–")).join(", ")} local</div></div>
        <div class="st"><span class="pill ${s.kind}">${s.text}</span><div class="lt">${s.label} · ${s.sub}</div></div>
      </div>
      <div class="idx hdr"><div>Index</div><div class="num">Last</div><div class="num">1D</div><div class="num">1M</div><div class="num">1M trend</div></div>
      ${rows}
      ${macro(c)}
    </article>`;
  }

  function allRows(list) {
    const rows = [];
    list.forEach((c) => c.indices.forEach(([s, n]) => { if (s.includes("VIX")) return; rows.push({ c, s, n, q: state.quotes[s] || {} }); }));
    return rows;
  }

  // ── world map ────────────────────────────────────────────────────────────
  // ISO 3166 numeric codes (world-atlas ids) → market id
  const ISO = { "840": "us", "124": "ca", "076": "br", "484": "mx", "032": "ar", "152": "cl", "826": "uk", "276": "de", "250": "fr", "380": "it", "724": "es", "528": "nl", "756": "ch", "752": "se", "616": "pl", "792": "tr", "682": "sa", "784": "ae", "376": "il", "710": "za", "818": "eg", "356": "in", "156": "cn", "392": "jp", "410": "kr", "158": "tw", "036": "au", "554": "nz", "360": "id", "458": "my", "764": "th", "608": "ph", "704": "vn", "586": "pk" };
  // other euro-area members shaded with the Euro Stoxx 50
  const EURO = ["040", "056", "246", "372", "620", "300", "703", "705", "233", "428", "440", "442", "191", "196", "470"];
  const DOTS = { hk: [114.17, 22.32], sg: [103.82, 1.35] };
  const byId = Object.fromEntries(M.map((c) => [c.id, c]));
  let mapGeo = null, mapLoading = null;

  function mainMove(c) { return (state.quotes[c.indices[0][0]] || {}).changePct; }

  async function ensureMap() {
    if (mapGeo) return mapGeo;
    if (!mapLoading) mapLoading = fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json").then((r) => r.json()).then((topo) => {
      mapGeo = topojson.feature(topo, topo.objects.countries).features.filter((f) => f.id !== "010");
      return mapGeo;
    });
    return mapLoading;
  }

  function renderMap(el) {
    el.innerHTML = `<div class="mapwrap"><div class="maphead"><div><h2 class="region-h" style="margin:0">Today's move by country</h2><div class="muted small">Main index 1-day change · <span class="dotlegend"></span> market open now · click a country for its chart</div></div>
      <div class="legend"><span>−3%</span><div class="lg"></div><span>+3%</span></div></div>
      <div id="map" class="map"><div class="empty">Loading map…</div></div><div id="maptip" class="maptip" hidden></div></div>
      <div class="tl-wrap"><h2 class="region-h">Trading hours in your time (${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)})</h2><div id="timeline"></div></div>`;
    renderTimeline($("#timeline"));
    ensureMap().then((features) => {
      if (state.view !== "map") return;
      const box = $("#map");
      const W = box.clientWidth || 1100, H = Math.round(W * 0.48);
      const proj = d3.geoNaturalEarth1().fitExtent([[4, 4], [W - 4, H - 4]], { type: "FeatureCollection", features });
      const path = d3.geoPath(proj);
      const tip = $("#maptip");
      const fillFor = (f) => {
        const id = ISO[f.id];
        if (id) return heatColor(mainMove(byId[id]));
        if (EURO.includes(f.id)) return heatColor(mainMove(byId.eu));
        return "#1b2130";
      };
      let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">`;
      features.forEach((f) => {
        const id = ISO[f.id] || (EURO.includes(f.id) ? "eu" : "");
        svg += `<path d="${path(f)}" fill="${fillFor(f)}" class="${id ? "cty" : "cty-off"}" ${id ? `data-m="${id}" data-nm="${esc(f.properties.name)}"` : ""}/>`;
      });
      M.forEach((c) => {
        const open = status(c).kind === "open";
        let xy = null;
        if (DOTS[c.id]) xy = proj(DOTS[c.id]);
        else if (open) {
          const iso = Object.keys(ISO).find((k) => ISO[k] === c.id);
          const f = features.find((x) => x.id === iso);
          if (f) xy = path.centroid(f);
        }
        if (!xy || isNaN(xy[0])) return;
        if (DOTS[c.id]) svg += `<circle cx="${xy[0]}" cy="${xy[1]}" r="5" fill="${heatColor(mainMove(c))}" stroke="#e6e9ef" stroke-width="1" class="cty" data-m="${c.id}" data-nm="${esc(c.name)}"/>`;
        if (open) svg += `<circle cx="${xy[0]}" cy="${xy[1]}" r="3.5" class="opendot"/>`;
      });
      svg += "</svg>";
      box.innerHTML = svg;
      box.querySelectorAll("[data-m]").forEach((p) => {
        p.addEventListener("mousemove", (e) => {
          const c = byId[p.dataset.m];
          const q = state.quotes[c.indices[0][0]] || {};
          const st = status(c);
          tip.hidden = false;
          tip.innerHTML = `<b>${c.flag} ${esc(p.dataset.nm)}</b>${p.dataset.m === "eu" && p.dataset.nm !== "Euro Area" ? '<div class="muted small">Euro area · shown with Euro Stoxx 50</div>' : ""}
            <div class="tiprow"><span>${esc(c.indices[0][1])}</span><span class="num">${fmt(q.price)}</span><span class="${cls(q.changePct)}">${pct(q.changePct)}</span></div>
            <div class="muted small">${st.text} · ${st.label} local · ${st.sub}</div>`;
          const r = box.getBoundingClientRect();
          tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 230) + "px";
          tip.style.top = e.clientY - r.top + 14 + "px";
        });
        p.addEventListener("mouseleave", () => (tip.hidden = true));
        p.addEventListener("click", () => { const c = byId[p.dataset.m]; openChart(c.indices[0][0]); });
      });
    }).catch(() => { $("#map").innerHTML = '<div class="empty">Map could not load (needs internet access to cdn.jsdelivr.net).</div>'; });
  }

  function renderTimeline(el) {
    const now = new Date();
    const viewerOff = -now.getTimezoneOffset();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const rows = M.map((c) => {
      const off = tzOffsetMin(c.tz, now);
      const today = c.days.includes(localParts(c.tz, now).wd);
      const segs = [];
      c.sessions.forEach(([a, b]) => {
        let s = (toMin(a) - off + viewerOff + 2880) % 1440, e = s + (toMin(b) - toMin(a));
        if (e <= 1440) segs.push([s, e]); else { segs.push([s, 1440]); segs.push([0, e - 1440]); }
      });
      const first = (toMin(c.sessions[0][0]) - off + viewerOff + 2880) % 1440;
      return { c, segs, today, first, st: status(c) };
    }).sort((a, b) => a.first - b.first);
    const ticks = [0, 3, 6, 9, 12, 15, 18, 21, 24];
    el.innerHTML = `<div class="tl">
      <div class="tl-row tl-axis"><div class="tl-l"></div><div class="tl-track">${ticks.map((h) => `<span style="left:${(h / 24) * 100}%">${String(h % 24).padStart(2, "0")}:00</span>`).join("")}</div></div>
      ${rows.map((r) => `<div class="tl-row"><div class="tl-l">${r.c.flag} ${esc(r.c.name)} <span class="pill ${r.st.kind}">${r.st.text}</span></div>
        <div class="tl-track">${r.segs.map(([s, e]) => `<div class="tl-bar ${r.st.kind === "open" ? "on" : ""} ${r.today ? "" : "off"}" style="left:${(s / 1440) * 100}%;width:${((e - s) / 1440) * 100}%" title="${esc(r.c.exchange)} ${r.c.sessions.map((x) => x.join("–")).join(", ")} local"></div>`).join("")}
        ${r.today ? "" : '<span class="tl-note">no session today</span>'}</div></div>`).join("")}
      <div class="tl-now" style="left:calc(var(--pad) + var(--tl-l) + (100% - 2 * var(--pad) - var(--tl-l)) * ${(nowMin / 1440).toFixed(4)})"><span>now</span></div>
    </div>`;
  }

  // ── India deep-dive ──────────────────────────────────────────────────────
  function renderIndia(el) {
    const Q = (s) => state.quotes[s] || {};
    const head = IN.headline.map(([s, n]) => {
      const q = Q(s);
      const inv = s === "INR=X";
      return `<div class="itile">${sym(s, `<div class="in-n">${esc(n)}</div>`)}
        <div class="in-p">${s === "INR=X" ? "₹" : ""}${fmt(q.price)}</div>
        <div class="in-c"><span class="chg ${cls(inv ? -q.changePct : q.changePct)}">${pct(q.changePct)}</span><span class="m1 ${cls(q.change1mPct)}">1M ${pct(q.change1mPct)}</span></div>
        ${spark(q.spark, 150, 30)}</div>`;
    }).join("");

    const secs = IN.sectors.map(([s, n]) => ({ s, n, q: Q(s) })).sort((a, b) => (b.q.changePct ?? -1e9) - (a.q.changePct ?? -1e9));
    const sectorHtml = secs.map((r) => `<a class="tile" href="${yurl(r.s)}" data-sym="${esc(r.s)}" style="background:${heatColor(r.q.changePct, 2)}">
      <div><div class="tn">${esc(r.n)}</div><div class="tc">1M ${pct(r.q.change1mPct)}</div></div><div class="tp">${pct(r.q.changePct)}</div></a>`).join("");

    const st = IN.stocks.map(([s, n, sec]) => ({ s, n, sec, q: Q(s) }));
    const adv = st.filter((r) => r.q.changePct > 0).length, dec = st.filter((r) => r.q.changePct < 0).length, unch = st.length - adv - dec;
    const k = state.stockSort.key, d = state.stockSort.dir;
    const val = (r) => (k === "n" ? r.n : k === "sec" ? r.sec : r.q[k]);
    st.sort((a, b) => { const x = val(a), y = val(b); if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y) : x - y) * d; });
    const th = (key, label, r) => `<th data-sk="${key}" class="${r ? "r" : ""}">${label}${k === key ? (d > 0 ? " ▲" : " ▼") : ""}</th>`;

    const nifty = Q("^NSEI");
    const s = status(byId.in);
    el.innerHTML = `
      <div class="in-hero"><div><h2 class="in-title">🇮🇳 India</h2><div class="muted">NSE · BSE · ${s.label} IST · <span class="pill ${s.kind}">${s.text}</span> ${s.sub}</div></div>
        <div class="breadth"><div class="muted small">Top 30 stocks today</div>
          <div class="bbar"><div class="bup" style="flex:${adv}"></div><div class="bun" style="flex:${unch}"></div><div class="bdn" style="flex:${dec}"></div></div>
          <div class="small"><span class="up">${adv} up</span> · <span class="muted">${unch} flat</span> · <span class="down">${dec} down</span></div></div></div>
      <div class="itiles">${head}</div>
      <h2 class="region-h">Sectors today <span class="muted small" style="text-transform:none;letter-spacing:0">· sorted by 1-day move · Nifty 50 ${pct(nifty.changePct)}</span></h2>
      <div class="heat sectors">${sectorHtml}</div>
      <h2 class="region-h">Top 30 Nifty stocks</h2>
      <table class="t" id="stocks"><thead><tr>${th("n", "Company")}${th("sec", "Sector")}${th("price", "Price (₹)", 1)}${th("changePct", "1D", 1)}${th("change1mPct", "1M", 1)}<th>1M trend</th></tr></thead><tbody>
        ${st.map((r) => `<tr><td>${sym(r.s, `<b>${esc(r.n)}</b> <span class="muted small">${esc(r.s.replace(".NS", ""))}</span>`)}</td><td class="muted">${esc(r.sec)}</td>
          <td class="r num">${fmt(r.q.price)}</td><td class="r"><span class="chg ${cls(r.q.changePct)}">${pct(r.q.changePct)}</span></td>
          <td class="r m1 ${cls(r.q.change1mPct)}">${pct(r.q.change1mPct)}</td><td>${spark(r.q.spark)}</td></tr>`).join("")}
      </tbody></table>
      <p class="muted small">Stock list: 30 of the largest Nifty 50 companies. NSE prices on Yahoo Finance can be delayed by up to 15 minutes.</p>`;
    el.querySelectorAll("th[data-sk]").forEach((h) => h.onclick = () => {
      const key = h.dataset.sk;
      state.stockSort = { key, dir: state.stockSort.key === key ? -state.stockSort.dir : (["n", "sec"].includes(key) ? 1 : -1) };
      renderIndia(el);
    });
  }

  // ── main area ────────────────────────────────────────────────────────────
  function renderMain() {
    const main = $("#main");
    document.body.dataset.view = state.view;
    if (state.view === "india") return renderIndia(main);
    if (state.view === "map") return renderMap(main);

    const list = filtered();
    if (!list.length) { main.innerHTML = '<div class="empty">No markets match.</div>'; return; }
    if (state.view === "cards") {
      const regs = state.region === "All" ? REGIONS.slice(1) : [state.region];
      main.innerHTML = regs.map((r) => {
        const cs = list.filter((c) => c.region === r);
        return cs.length ? `<h2 class="region-h">${r}</h2><div class="grid">${cs.map(card).join("")}</div>` : "";
      }).join("");
    } else if (state.view === "heat") {
      const rows = allRows(list).sort((a, b) => (b.q.changePct ?? -1e9) - (a.q.changePct ?? -1e9));
      main.innerHTML = `<div class="heat">${rows.map((r) => `<a class="tile" href="${yurl(r.s)}" data-sym="${esc(r.s)}" style="background:${heatColor(r.q.changePct)}">
        <div><div class="tn">${esc(r.n)}</div><div class="tc">${r.c.flag} ${esc(r.c.name)}</div></div><div class="tp">${pct(r.q.changePct)}</div></a>`).join("")}</div>`;
    } else {
      const k = state.sort.key, d = state.sort.dir;
      const val = (r) => k === "name" ? r.n : k === "country" ? r.c.name : k === "status" ? status(r.c).kind : r.q[k];
      const rows = allRows(list).sort((a, b) => {
        const x = val(a), y = val(b);
        if (x == null) return 1; if (y == null) return -1;
        return (typeof x === "string" ? x.localeCompare(y) : x - y) * d;
      });
      const th = (key, label, r) => `<th data-k="${key}" class="${r ? "r" : ""}">${label}${k === key ? (d > 0 ? " ▲" : " ▼") : ""}</th>`;
      main.innerHTML = `<table class="t"><thead><tr>${th("country", "Country")}${th("name", "Index")}${th("price", "Last", 1)}${th("changePct", "1D", 1)}${th("change1mPct", "1M", 1)}${th("status", "Market")}<th>1M trend</th></tr></thead><tbody>
        ${rows.map((r) => { const s = status(r.c); return `<tr><td>${r.c.flag} ${esc(r.c.name)}</td><td>${sym(r.s, esc(r.n))}</td>
          <td class="r num">${fmt(r.q.price)}</td><td class="r"><span class="chg ${cls(r.q.changePct)}">${pct(r.q.changePct)}</span></td>
          <td class="r m1 ${cls(r.q.change1mPct)}">${pct(r.q.change1mPct)}</td><td><span class="pill ${s.kind}">${s.text}</span></td><td>${spark(r.q.spark)}</td></tr>`; }).join("")}
        </tbody></table>`;
      main.querySelectorAll("th[data-k]").forEach((el) => el.onclick = () => {
        const key = el.dataset.k;
        state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : (["name", "country", "status"].includes(key) ? 1 : -1) };
        renderMain();
      });
    }
  }

  // ── chart modal ──────────────────────────────────────────────────────────
  const RANGES = [["1d", "1D"], ["5d", "5D"], ["1mo", "1M"], ["6mo", "6M"], ["1y", "1Y"], ["5y", "5Y"]];
  const chartCache = {};
  const modal = { sym: null, range: "1mo" };

  function openChart(s) {
    modal.sym = s;
    $("#modal").hidden = false;
    document.body.style.overflow = "hidden";
    drawModal();
  }
  function closeChart() { $("#modal").hidden = true; document.body.style.overflow = ""; modal.sym = null; }

  async function getChart(s, range) {
    const key = s + "|" + range;
    const hit = chartCache[key];
    if (hit && Date.now() - hit.t < 60_000) return hit.d;
    const r = await fetch(`/api/chart?symbol=${encodeURIComponent(s)}&range=${range}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    chartCache[key] = { t: Date.now(), d };
    return d;
  }

  async function drawModal() {
    const s = modal.sym, range = modal.range;
    const nm = NAMES[s] || { name: s, sub: "" };
    const q = state.quotes[s] || {};
    $("#m-title").innerHTML = `<div class="m-name">${esc(nm.name)}</div><div class="muted small">${esc(nm.sub)} · ${esc(s)}</div>`;
    $("#m-ranges").innerHTML = RANGES.map(([k, l]) => `<button data-r="${k}" class="${k === range ? "on" : ""}">${l}</button>`).join("");
    $("#m-yahoo").href = yurl(s);
    $("#m-price").innerHTML = `<span class="m-p">${fmt(q.price)}</span> <span class="chg ${cls(q.changePct)}">${pct(q.changePct)}</span> <span class="muted small">today</span>`;
    $("#m-chart").innerHTML = '<div class="empty">Loading chart…</div>';
    $("#m-stats").innerHTML = "";
    try {
      const d = await getChart(s, range);
      if (modal.sym !== s || modal.range !== range) return;
      drawSvgChart(d, range);
      const rc = d.price != null && d.prevClose ? ((d.price - d.prevClose) / d.prevClose) * 100 : null;
      const rng = (lo, hi, v) => (lo != null && hi != null && v != null && hi > lo)
        ? `<div class="rbar"><div class="rdot" style="left:${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%"></div></div><div class="rlab"><span>${fmt(lo)}</span><span>${fmt(hi)}</span></div>` : '<div class="muted">—</div>';
      $("#m-stats").innerHTML = `
        <div><div class="k">${RANGES.find((x) => x[0] === range)[1]} change</div><div class="v ${cls(rc)}">${pct(rc)}</div></div>
        <div><div class="k">Day range</div>${rng(d.dayLow, d.dayHigh, d.price)}</div>
        <div><div class="k">52-week range</div>${rng(d.low52, d.high52, d.price)}</div>
        <div><div class="k">From 52W high</div><div class="v ${cls(d.high52 ? d.price - d.high52 : null)}">${d.high52 ? pct(((d.price - d.high52) / d.high52) * 100) : "—"}</div></div>`;
    } catch (e) {
      $("#m-chart").innerHTML = `<div class="empty">Couldn't load chart (${esc(e.message)}).</div>`;
    }
  }

  function drawSvgChart(d, range) {
    const box = $("#m-chart");
    const pts = d.points || [];
    if (pts.length < 2) { box.innerHTML = '<div class="empty">No data for this range.</div>'; return; }
    const W = box.clientWidth || 760, H = 300, L = 8, R = 64, T = 12, B = 26;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (range === "1d" && d.prevClose) { lo = Math.min(lo, d.prevClose); hi = Math.max(hi, d.prevClose); }
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    // x by index so overnight/weekend gaps don't leave holes
    const X = (i) => L + (i / (pts.length - 1)) * (W - L - R);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const base = range === "1d" && d.prevClose ? d.prevClose : ys[0];
    const up = ys[ys.length - 1] >= base;
    const col = up ? "#22c55e" : "#ef4444";
    const line = pts.map((p, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p[1]).toFixed(1)).join("");
    const area = line + `L${X(pts.length - 1).toFixed(1)} ${H - B}L${X(0).toFixed(1)} ${H - B}Z`;
    const nice = (n) => { const e = Math.pow(10, Math.floor(Math.log10(n))); const f = n / e; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e; };
    const step = nice((hi - lo) / 5);
    let grid = "";
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${W - R + 6}" y="${Y(v) + 4}" class="gt">${fmt(v, step < 1 ? 2 : 0)}</text>`;
    const tz = d.tz || "UTC";
    const fmtX = (t) => {
      const dt = new Date(t * 1000);
      if (range === "1d") return dt.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
      if (range === "5d") return dt.toLocaleDateString("en-GB", { timeZone: tz, weekday: "short", day: "numeric" });
      if (range === "5y") return dt.toLocaleDateString("en-GB", { timeZone: tz, month: "short", year: "numeric" });
      return dt.toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "short" });
    };
    let xl = "";
    const nT = Math.min(6, pts.length);
    for (let k = 0; k < nT; k++) { const i = Math.round((k / (nT - 1)) * (pts.length - 1)); xl += `<text x="${X(i)}" y="${H - 6}" class="gt" text-anchor="${k === 0 ? "start" : k === nT - 1 ? "end" : "middle"}">${fmtX(xs[i])}</text>`; }
    const prev = range === "1d" && d.prevClose ? `<line x1="${L}" x2="${W - R}" y1="${Y(d.prevClose)}" y2="${Y(d.prevClose)}" class="prev"/><text x="${L + 4}" y="${Y(d.prevClose) - 4}" class="gt">prev close ${fmt(d.prevClose)}</text>` : "";
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" id="m-svg">
      <defs><linearGradient id="gfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      ${grid}${prev}<path d="${area}" fill="url(#gfill)"/><path d="${line}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round"/>${xl}
      <g id="hov" visibility="hidden"><line id="hx" y1="${T}" y2="${H - B}" class="cross"/><circle id="hc" r="4" fill="${col}" stroke="#0b0e14" stroke-width="2"/></g>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" id="hit"/></svg><div id="m-tip" class="maptip" hidden></div>`;
    const svg = $("#m-svg"), hov = $("#hov"), tip = $("#m-tip");
    $("#hit").addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(((x - L) / (W - L - R)) * (pts.length - 1))));
      hov.setAttribute("visibility", "visible");
      $("#hx").setAttribute("x1", X(i)); $("#hx").setAttribute("x2", X(i));
      $("#hc").setAttribute("cx", X(i)); $("#hc").setAttribute("cy", Y(ys[i]));
      const ch = ((ys[i] - base) / base) * 100;
      const when = new Date(xs[i] * 1000).toLocaleString("en-GB", { timeZone: tz, day: "numeric", month: "short", year: range === "5y" || range === "1y" ? "numeric" : undefined, hour: range === "1d" || range === "5d" ? "2-digit" : undefined, minute: range === "1d" || range === "5d" ? "2-digit" : undefined });
      tip.hidden = false;
      tip.innerHTML = `<div class="num"><b>${fmt(ys[i])}</b> <span class="${cls(ch)}">${pct(ch)}</span></div><div class="muted small">${when}</div>`;
      const px = (X(i) / W) * r.width;
      tip.style.left = Math.min(px + 12, r.width - 170) + "px";
      tip.style.top = (Y(ys[i]) / H) * r.height - 50 + "px";
    });
    $("#hit").addEventListener("mouseleave", () => { hov.setAttribute("visibility", "hidden"); tip.hidden = true; });
  }

  function render() {
    renderStatus(); renderClocks(); renderGlobal();
    // the map redraws itself; avoid re-fetching geometry, just repaint
    renderMain();
    if (modal.sym) { const q = state.quotes[modal.sym] || {}; $("#m-price").innerHTML = `<span class="m-p">${fmt(q.price)}</span> <span class="chg ${cls(q.changePct)}">${pct(q.changePct)}</span> <span class="muted small">today</span>`; }
  }

  // ── controls ─────────────────────────────────────────────────────────────
  $("#regions").innerHTML = REGIONS.map((r) => `<button class="chip ${r === "All" ? "on" : ""}" data-r="${r}">${r}</button>`).join("");
  $("#regions").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.region = b.dataset.r;
    document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === b));
    if (["map", "india"].includes(state.view)) setView("cards"); else renderMain();
  };
  function setView(v) {
    state.view = v;
    document.querySelectorAll("#views button").forEach((x) => x.classList.toggle("on", x.dataset.view === v));
    try { history.replaceState(null, "", v === "cards" ? location.pathname : "#" + v); } catch (e) {}
    renderMain();
  }
  $("#views").onclick = (e) => { const b = e.target.closest("button"); if (b) setView(b.dataset.view); };
  $("#search").oninput = (e) => { state.q = e.target.value.trim(); if (["map", "india"].includes(state.view)) setView("cards"); else renderMain(); };
  $("#open-only").onchange = (e) => { state.openOnly = e.target.checked; renderMain(); };
  $("#refresh").onclick = load;

  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-sym]");
    if (!a || e.ctrlKey || e.metaKey) return; // ctrl/cmd-click still opens Yahoo
    e.preventDefault();
    openChart(a.dataset.sym);
  });
  $("#m-ranges").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; modal.range = b.dataset.r; drawModal(); };
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.closest("#m-close")) closeChart(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.sym) closeChart(); });
  let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (state.view === "map") renderMain(); if (modal.sym) drawModal(); }, 250); });

  const rs = window.REF_SOURCES;
  $("#ref-sources").textContent = `policy rates from ${rs.policy}; 10Y yields from ${rs.y10}; market caps from ${rs.mcap}`;

  const initial = location.hash.slice(1);
  if (["map", "heat", "table", "india"].includes(initial)) setView(initial);
  render();
  load();
  setInterval(load, REFRESH_MS);
  setInterval(() => { renderClocks(); if (state.view === "map") renderTimeline($("#timeline")); }, 30_000);
})();
