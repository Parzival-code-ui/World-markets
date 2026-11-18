// Stock screener built on Perspective (FINOS, open-sourced by J.P. Morgan): one table of every company
// in the Stocks tab that people can filter, sort, group and chart themselves. Loaded only when the
// screener is opened, from jsDelivr at a pinned version. Exposes window.WMScreener for app.js.
(() => {
  const V = "3.8.0";
  const CDN = (pkg, file) => `https://cdn.jsdelivr.net/npm/@finos/${pkg}@${V}/dist/${file}`;
  let ready = null, worker = null, table = null, viewer = null, lastPreset = null;

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
    all: { label: "Largest companies", group_by: [], split_by: [], filter: [], sort: [["Market cap ($bn)", "desc"]], plugin: "Datagrid" },
    value: { label: "Cheapest by P/E", group_by: [], split_by: [], filter: [["P/E", ">", 0]], sort: [["P/E", "asc"]], plugin: "Datagrid" },
    dividend: { label: "Highest dividends", group_by: [], split_by: [], filter: [["Dividend %", ">", 0]], sort: [["Dividend %", "desc"]], plugin: "Datagrid" },
    sector: { label: "By sector", group_by: ["Sector"], split_by: [], filter: [], sort: [["Market cap ($bn)", "desc"]], plugin: "Datagrid", columns: GROUPED },
    market: { label: "By market", group_by: ["Market"], split_by: [], filter: [], sort: [["Market cap ($bn)", "desc"]], plugin: "Datagrid", columns: GROUPED },
    movers: { label: "Today's movers (chart)", group_by: ["Company"], split_by: [], filter: [], sort: [["Today %", "desc"]], plugin: "Y Bar", columns: ["Today %"] },
  };

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
  const themeName = () => (document.documentElement.dataset.theme === "day" ? "Pro Light" : "Pro Dark");

  window.WMScreener = {
    PRESETS,
    onPick: null,
    loaded: () => !!table,
    // put the screener in `host`, showing `rows`; resolves once it's on screen
    async mount(host, rows, preset = "all") {
      await load();
      // the viewer builds its toolbar when it joins the page, so attach it before loading data into it
      const first = !viewer;
      if (first) {
        viewer = document.createElement("perspective-viewer"); viewer.className = "psp";
        // a click on a company's row opens its chart; the row carries only the visible columns, so app.js finds it by name
        viewer.addEventListener("perspective-click", (e) => { const r = e.detail && e.detail.row; if (r && this.onPick && (r.Symbol || typeof r.Company === "string")) this.onPick(r); });
      }
      host.replaceChildren(viewer);
      if (first) await viewer.load(table);
      if (rows && rows.length) await table.update(rows);
      if (preset !== lastPreset) await this.preset(preset);
      else await viewer.restore({ theme: themeName() });
      viewer.notifyResize && viewer.notifyResize();
    },
    async update(rows) { if (table && rows.length) await table.update(rows); },
    async preset(name) {
      const p = PRESETS[name] || PRESETS.all;
      lastPreset = name;
      if (!viewer) return;
      await viewer.restore({
        plugin: p.plugin, columns: p.columns || SHOW, group_by: p.group_by, split_by: p.split_by, filter: p.filter, sort: p.sort,
        expressions: {}, aggregates: AGG, settings: false, theme: themeName(), title: null,
        columns_config: COLS(),
      });
    },
    retheme() { if (viewer) viewer.restore({ theme: themeName(), columns_config: COLS() }); },
    resize() { if (viewer && viewer.notifyResize) viewer.notifyResize(); },
  };
})();
