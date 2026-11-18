// Stock screener built on Perspective (FINOS, open-sourced by J.P. Morgan): one table of every company
// in the Stocks tab that people can filter, sort, group and chart themselves. Loaded only when the
// screener is opened, from jsDelivr at a pinned version. Exposes window.WMScreener for app.js.
//
// Every instruction to the viewer goes through one queue, so a click on a view while the screener is
// still starting (or a tab switch mid-load) can never send it two things at once.
(() => {
  const V = "3.8.0";
  const CDN = (pkg, file) => `https://cdn.jsdelivr.net/npm/@finos/${pkg}@${V}/dist/${file}`;
  let ready = null, worker = null, table = null, viewer = null, shown = null, wanted = "all";

  // the columns, in the order people see them
  const SCHEMA = {
    Company: "string", Ticker: "string", Market: "string", Sector: "string", Currency: "string",
    Price: "float", "Today %": "float", "1 month %": "float", "1 year %": "float",
    "Market cap ($bn)": "float", "P/E": "float", "P/B": "float", "Dividend %": "float", "Next results": "date",
    Symbol: "string",
  };
  // gains in green and losses in red; sensible decimals
  // (the site's own up/down colours, read when the view is set so they follow the theme and colour-blind mode)
  const css = (v, d) => (getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d);
  const COLS = () => {
    const pctCol = { number_fg_mode: "color", fixed: 2, pos_fg_color: css("--up", "#3ecf8e"), neg_fg_color: css("--down", "#ff6b6b") };
    return { "Today %": pctCol, "1 month %": pctCol, "1 year %": pctCol, Price: { fixed: 2 }, "Market cap ($bn)": { fixed: 1 }, "P/E": { fixed: 1 }, "P/B": { fixed: 1 }, "Dividend %": { fixed: 2 } };
  };
  const SHOW = ["Company", "Market", "Sector", "Price", "Today %", "1 month %", "1 year %", "Market cap ($bn)", "P/E", "P/B", "Dividend %", "Next results"];

  // what a group's total row shows: averages for returns, medians for valuations, sums only where adding up makes sense
  const AGG = { Company: "count", "Today %": "avg", "1 month %": "avg", "1 year %": "avg", "P/E": "median", "P/B": "median", "Dividend %": "avg",
    "Market cap ($bn)": "sum", Price: "avg", Market: "dominant", Sector: "dominant", Ticker: "dominant", Currency: "dominant", "Next results": "first" };
  const GROUPED = ["Company", "Today %", "1 month %", "1 year %", "Market cap ($bn)", "P/E", "P/B", "Dividend %"];

  // ready-made views; people can change anything from there
  const PRESETS = {
    all: { group_by: [], filter: [], sort: [["Market cap ($bn)", "desc"]], plugin: "Datagrid" },
    value: { group_by: [], filter: [["P/E", ">", 0]], sort: [["P/E", "asc"]], plugin: "Datagrid" },
    dividend: { group_by: [], filter: [["Dividend %", ">", 0]], sort: [["Dividend %", "desc"]], plugin: "Datagrid" },
    sector: { group_by: ["Sector"], filter: [], sort: [["Market cap ($bn)", "desc"]], plugin: "Datagrid", columns: GROUPED },
    market: { group_by: ["Market"], filter: [], sort: [["Market cap ($bn)", "desc"]], plugin: "Datagrid", columns: GROUPED },
    movers: { group_by: ["Company"], filter: [], sort: [["Today %", "desc"]], plugin: "Y Bar", columns: ["Today %"] },
  };
  const themeName = () => (document.documentElement.dataset.theme === "day" ? "Pro Light" : "Pro Dark");

  // one instruction at a time; a failed step doesn't block the next
  let queue = Promise.resolve();
  const enqueue = (fn) => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };

  function loadCSS(href) {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href; l.crossOrigin = "anonymous";
    document.head.appendChild(l);
  }
  function load() {
    if (ready) return ready;
    loadCSS(CDN("perspective-viewer", "css/themes.css"));
    ready = (async () => {
      const [{ default: perspective }] = await Promise.all([
        import(CDN("perspective", "cdn/perspective.js")),
        import(CDN("perspective-viewer", "cdn/perspective-viewer.js")),
      ]);
      await Promise.all([import(CDN("perspective-viewer-datagrid", "cdn/perspective-viewer-datagrid.js")), import(CDN("perspective-viewer-d3fc", "cdn/perspective-viewer-d3fc.js"))]);
      worker = await perspective.worker();
      table = await worker.table(SCHEMA, { index: "Symbol" });
    })();
    ready.catch(() => { ready = null; });
    return ready;
  }
  function config(name) {
    const p = PRESETS[name] || PRESETS.all;
    return {
      plugin: p.plugin, columns: p.columns || SHOW, group_by: p.group_by, split_by: [], filter: p.filter, sort: p.sort,
      expressions: {}, aggregates: AGG, settings: false, theme: themeName(), title: null, columns_config: COLS(),
    };
  }
  // throw away a viewer that failed to start, so the next attempt begins clean
  function discard() {
    if (viewer) { try { viewer.delete && viewer.delete(); } catch (e) {} viewer.remove(); }
    viewer = null; shown = null;
  }

  window.WMScreener = {
    PRESETS,
    onPick: null,
    loaded: () => !!(table && viewer && shown),
    // put the screener in `host`, showing `rows`; resolves true once it's on screen, false if the visitor left
    mount(host, rows, preset) {
      if (preset) wanted = preset;
      return enqueue(async () => {
        await load();
        if (!host.isConnected) return false; // the visitor moved to another tab meanwhile; try again when they're back
        if (rows && rows.length) await table.update(rows);
        if (!viewer) {
          viewer = document.createElement("perspective-viewer");
          viewer.className = "psp";
          // a click on a company's row opens its chart; the row carries only the visible columns, so app.js finds it by name
          viewer.addEventListener("perspective-click", (e) => { const r = e.detail && e.detail.row; if (r && this.onPick && (r.Symbol || typeof r.Company === "string")) this.onPick(r); });
          // the viewer builds its toolbar when it joins the page, so attach it before loading data into it
          host.replaceChildren(viewer);
          try { await viewer.load(table); }
          catch (e) { discard(); throw e; }
        } else host.replaceChildren(viewer);
        if (!host.isConnected) return false;
        try { await viewer.restore(config(wanted)); shown = wanted; }
        catch (e) { discard(); throw e; }
        viewer.notifyResize && viewer.notifyResize();
        return true;
      });
    },
    update(rows) { return enqueue(async () => { if (table && rows && rows.length) await table.update(rows); }); },
    // a view picked before the screener is ready is remembered and applied when it is
    preset(name) {
      wanted = name;
      return enqueue(async () => { if (viewer && shown && viewer.isConnected) { await viewer.restore(config(name)); shown = name; } });
    },
    retheme() { return enqueue(async () => { if (viewer && shown && viewer.isConnected) await viewer.restore({ theme: themeName(), columns_config: COLS() }); }); },
    resize() { if (viewer && viewer.notifyResize) viewer.notifyResize(); },
  };
})();
