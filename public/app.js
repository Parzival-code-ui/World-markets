(() => {
  const REFRESH_MS = 60_000;
  const M = window.MARKETS;
  const G = window.GLOBAL;
  const REGIONS = ["All", "Americas", "Europe", "Middle East & Africa", "Asia-Pacific"];
  const CLOCKS = [["New York", "America/New_York"], ["São Paulo", "America/Sao_Paulo"], ["London", "Europe/London"], ["Frankfurt", "Europe/Berlin"], ["Dubai", "Asia/Dubai"], ["Mumbai", "Asia/Kolkata"], ["Shanghai", "Asia/Shanghai"], ["Tokyo", "Asia/Tokyo"], ["Sydney", "Australia/Sydney"]];

  const state = { quotes: {}, region: "All", view: "cards", q: "", openOnly: false, sort: { key: "changePct", dir: -1 }, fetchedAt: null, mock: false, error: null };

  // ── symbols to request ───────────────────────────────────────────────────
  const fx = (c) => (c === "USD" ? null : c + "=X");
  const symbols = new Set();
  M.forEach((c) => { c.indices.forEach(([s]) => symbols.add(s)); if (fx(c.ccy)) symbols.add(fx(c.ccy)); if (c.y10Live) symbols.add(c.y10Live); });
  symbols.add("INR=X");
  G.forEach((g) => g.items.forEach(([s]) => symbols.add(s)));

  // ── helpers ──────────────────────────────────────────────────────────────
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const yurl = (s) => "https://finance.yahoo.com/quote/" + encodeURIComponent(s);
  function fmt(v, d) {
    if (v == null || !isFinite(v)) return "—";
    if (d == null) d = Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 1 ? 2 : 4;
    return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function pct(v) {
    if (v == null || !isFinite(v)) return '<span class="na">—</span>';
    return (v > 0 ? "+" : "") + v.toFixed(2) + "%";
  }
  const cls = (v) => (v == null || !isFinite(v) ? "na" : v > 0 ? "up" : v < 0 ? "down" : "");

  function spark(arr) {
    if (!arr || arr.length < 2) return '<svg class="spark"></svg>';
    const w = 64, h = 22, min = Math.min(...arr), max = Math.max(...arr), r = max - min || 1;
    const pts = arr.map((v, i) => [(i / (arr.length - 1)) * w, h - 2 - ((v - min) / r) * (h - 4)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
    const col = arr[arr.length - 1] >= arr[0] ? "var(--up)" : "var(--down)";
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  // ── market hours ─────────────────────────────────────────────────────────
  const WDN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const tzCache = {};
  function localParts(tz, now = new Date()) {
    const f = tzCache[tz] || (tzCache[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }));
    const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
    return { wd: WDN[p.weekday], min: (+p.hour % 24) * 60 + +p.minute, label: p.hour + ":" + p.minute };
  }
  const toMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  function status(c) {
    const { wd, min, label } = localParts(c.tz);
    const ses = c.sessions.map(([a, b]) => [toMin(a), toMin(b)]);
    const tradingDay = c.days.includes(wd);
    if (tradingDay) {
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

  // ── renderers ────────────────────────────────────────────────────────────
  function renderStatus() {
    const n = Object.values(state.quotes).filter((x) => x && x.price != null).length;
    let t = state.fetchedAt ? `${n} live quotes · updated ${new Date(state.fetchedAt).toLocaleTimeString()} · auto-refresh 60s` : "Loading quotes…";
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
          return `<div class="grow"><div class="n"><a href="${yurl(s)}" target="_blank" rel="noopener">${esc(n)}</a><span class="u">${esc(u)}</span></div>
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

  function fxCell(c) {
    const usdinr = (state.quotes["INR=X"] || {}).price;
    if (c.ccy === "USD") return { v: usdinr ? "₹" + fmt(usdinr, 2) : "—", d: "1 USD in INR" };
    const q = state.quotes[fx(c.ccy)] || {};
    const per = q.price; // CCY per 1 USD
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
    const rows = c.indices.map(([sym, n]) => {
      const q = state.quotes[sym] || {};
      return `<div class="idx"><div class="nm"><a href="${yurl(sym)}" target="_blank" rel="noopener" title="${esc(sym)}">${esc(n)}</a></div>
        <div class="num">${fmt(q.price)}</div><div class="chg ${cls(q.changePct)}">${pct(q.changePct)}</div>
        <div class="m1 ${cls(q.change1mPct)}">${q.change1mPct != null ? pct(q.change1mPct) : ""}</div>${spark(q.spark)}</div>`;
    }).join("");
    return `<article class="card">
      <div class="card-h">
        <div><div class="title"><span class="flag">${c.flag}</span><h2>${esc(c.name)}</h2></div><div class="ex">${esc(c.exchange)} · ${c.sessions.map((x) => x.join("–")).join(", ")} local</div></div>
        <div class="st"><span class="pill ${s.kind}">${s.text}</span><div class="lt">${s.label} · ${s.sub}</div></div>
      </div>
      <div class="idx hdr"><div>Index</div><div class="num">Last</div><div class="num">1D</div><div class="num">1M</div><div class="num">1M trend</div></div>
      ${rows}
      ${macro(c)}
    </article>`;
  }

  function heatColor(p) {
    if (p == null || !isFinite(p)) return "#2a3040";
    const t = Math.min(Math.abs(p) / 3, 1);
    const [r, g, b] = p >= 0 ? [22, 163, 74] : [220, 38, 38];
    const base = [42, 48, 64];
    return `rgb(${base.map((v, i) => Math.round(v + ([r, g, b][i] - v) * (0.25 + 0.75 * t))).join(",")})`;
  }

  function allRows(list) {
    const rows = [];
    list.forEach((c) => c.indices.forEach(([s, n]) => { if (s.includes("VIX")) return; rows.push({ c, s, n, q: state.quotes[s] || {} }); }));
    return rows;
  }

  function renderMain() {
    const list = filtered();
    const main = $("#main");
    if (!list.length) { main.innerHTML = '<div class="empty">No markets match.</div>'; return; }

    if (state.view === "cards") {
      const regs = state.region === "All" ? REGIONS.slice(1) : [state.region];
      main.innerHTML = regs.map((r) => {
        const cs = list.filter((c) => c.region === r);
        return cs.length ? `<h2 class="region-h">${r}</h2><div class="grid">${cs.map(card).join("")}</div>` : "";
      }).join("");
    } else if (state.view === "heat") {
      const rows = allRows(list).sort((a, b) => (b.q.changePct ?? -1e9) - (a.q.changePct ?? -1e9));
      main.innerHTML = `<div class="heat">${rows.map((r) => `<a class="tile" href="${yurl(r.s)}" target="_blank" rel="noopener" style="background:${heatColor(r.q.changePct)}">
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
        ${rows.map((r) => { const s = status(r.c); return `<tr><td>${r.c.flag} ${esc(r.c.name)}</td><td><a href="${yurl(r.s)}" target="_blank" rel="noopener">${esc(r.n)}</a></td>
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

  function render() { renderStatus(); renderClocks(); renderGlobal(); renderMain(); }

  // ── controls ─────────────────────────────────────────────────────────────
  $("#regions").innerHTML = REGIONS.map((r) => `<button class="chip ${r === "All" ? "on" : ""}" data-r="${r}">${r}</button>`).join("");
  $("#regions").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.region = b.dataset.r;
    document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === b));
    renderMain();
  };
  $("#views").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.view = b.dataset.view;
    document.querySelectorAll("#views button").forEach((x) => x.classList.toggle("on", x === b));
    renderMain();
  };
  $("#search").oninput = (e) => { state.q = e.target.value.trim(); renderMain(); };
  $("#open-only").onchange = (e) => { state.openOnly = e.target.checked; renderMain(); };
  $("#refresh").onclick = load;
  const rs = window.REF_SOURCES;
  $("#ref-sources").textContent = `policy rates from ${rs.policy}; 10Y yields from ${rs.y10}; market caps from ${rs.mcap}`;

  render();
  load();
  setInterval(load, REFRESH_MS);
  setInterval(() => { renderClocks(); }, 30_000);
})();
