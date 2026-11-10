// Largest companies by market, for the Stocks tab. [Yahoo symbol, company, sector]
// India reuses the 30 stocks from india.js.
window.STOCK_MARKETS = [
  { id: "us", flag: "🇺🇸", name: "United States", stocks: [
    ["AAPL", "Apple", "Technology"], ["MSFT", "Microsoft", "Technology"], ["NVDA", "Nvidia", "Semiconductors"],
    ["AMZN", "Amazon", "Consumer"], ["GOOGL", "Alphabet", "Communication"], ["META", "Meta Platforms", "Communication"],
    ["AVGO", "Broadcom", "Semiconductors"], ["BRK-B", "Berkshire Hathaway", "Financials"], ["TSLA", "Tesla", "Auto"],
    ["JPM", "JPMorgan Chase", "Banks"], ["LLY", "Eli Lilly", "Pharma"], ["V", "Visa", "Financials"],
    ["WMT", "Walmart", "Consumer"], ["XOM", "Exxon Mobil", "Energy"], ["JNJ", "Johnson & Johnson", "Pharma"],
  ] },
  { id: "in", flag: "🇮🇳", name: "India", stocks: null },
  { id: "uk", flag: "🇬🇧", name: "United Kingdom", stocks: [
    ["AZN.L", "AstraZeneca", "Pharma"], ["SHEL.L", "Shell", "Energy"], ["HSBA.L", "HSBC", "Banks"],
    ["ULVR.L", "Unilever", "Consumer"], ["RIO.L", "Rio Tinto", "Metals"], ["BP.L", "BP", "Energy"],
    ["GSK.L", "GSK", "Pharma"], ["BATS.L", "British American Tobacco", "Consumer"], ["REL.L", "RELX", "Media"],
    ["LSEG.L", "London Stock Exchange Group", "Financials"],
  ] },
  { id: "eu", flag: "🇪🇺", name: "Europe", stocks: [
    ["ASML.AS", "ASML", "Semiconductors"], ["SAP.DE", "SAP", "Technology"], ["MC.PA", "LVMH", "Consumer"],
    ["NOVO-B.CO", "Novo Nordisk", "Pharma"], ["NESN.SW", "Nestlé", "Consumer"], ["ROG.SW", "Roche", "Pharma"],
    ["SIE.DE", "Siemens", "Industrials"], ["TTE.PA", "TotalEnergies", "Energy"], ["OR.PA", "L'Oréal", "Consumer"],
    ["ALV.DE", "Allianz", "Insurance"],
  ] },
  { id: "jp", flag: "🇯🇵", name: "Japan", stocks: [
    ["7203.T", "Toyota", "Auto"], ["6758.T", "Sony", "Technology"], ["8306.T", "Mitsubishi UFJ", "Banks"],
    ["6501.T", "Hitachi", "Industrials"], ["9983.T", "Fast Retailing", "Consumer"], ["9984.T", "SoftBank Group", "Communication"],
    ["8035.T", "Tokyo Electron", "Semiconductors"], ["6861.T", "Keyence", "Technology"], ["7974.T", "Nintendo", "Communication"],
    ["4063.T", "Shin-Etsu Chemical", "Materials"],
  ] },
  { id: "cn", flag: "🇨🇳", name: "China and Hong Kong", stocks: [
    ["0700.HK", "Tencent", "Communication"], ["9988.HK", "Alibaba", "Consumer"], ["600519.SS", "Kweichow Moutai", "Consumer"],
    ["1398.HK", "ICBC", "Banks"], ["0939.HK", "China Construction Bank", "Banks"], ["0941.HK", "China Mobile", "Communication"],
    ["300750.SZ", "CATL", "Industrials"], ["1810.HK", "Xiaomi", "Technology"], ["3690.HK", "Meituan", "Consumer"],
    ["1299.HK", "AIA Group", "Insurance"],
  ] },
  { id: "ap", flag: "🌏", name: "Rest of Asia-Pacific", stocks: [
    ["2330.TW", "TSMC", "Semiconductors"], ["005930.KS", "Samsung Electronics", "Technology"], ["000660.KS", "SK Hynix", "Semiconductors"],
    ["D05.SI", "DBS Group", "Banks"], ["CBA.AX", "Commonwealth Bank", "Banks"], ["BHP.AX", "BHP", "Metals"],
    ["2317.TW", "Hon Hai (Foxconn)", "Technology"], ["BBCA.JK", "Bank Central Asia", "Banks"],
  ] },
];
