# World Markets

A live dashboard of stock markets around the world:

- **37 markets** (36 countries plus the euro area) across the Americas, Europe, the Middle East & Africa, and Asia-Pacific, with **53 major indices**. Each index shows its last level, 1-day and 1-month change, and a 1-month sparkline.
- **Market status** for every exchange: open, lunch break or closed, with local time and a countdown to the next open or close.
- **Currency** for each country, against USD and INR.
- **Policy rate, 10Y government bond yield and exchange market cap**, from a dated reference snapshot. The US 10Y yield is live.
- A **global strip** with commodities (gold, silver, WTI, Brent, natural gas, copper), crypto (BTC, ETH, SOL, XRP), US Treasury yields and the dollar index.
- Three views (**Countries**, **Heatmap** and a sortable **Table**), plus region filters, an "Open now" filter and search.
- Auto-refresh every 60 seconds.

## How it works

```
public/            static site (index.html, app.js, styles.css)
public/data/markets.js   ← every country, index symbol, trading hours and reference figure
api/quotes.js      serverless function: fetches quotes from Yahoo Finance and caches them for 60s
server.js          local dev server (serves the site + the same API)
scripts/check-symbols.js   checks every ticker returns data
```

Browsers can't call Yahoo Finance directly because of CORS, so the page calls this site's own `/api/quotes` function. That function fetches all symbols in parallel and returns clean JSON. Vercel's CDN caches the response for 60 seconds, so Yahoo receives roughly one request per symbol per minute however many people have the site open. **No API key is needed.**

## Run it on your laptop

You need Node.js 18 or newer (https://nodejs.org).

```bash
npm start            # live data   → http://localhost:3000
npm run demo         # fake data, works offline
npm run check        # lists any ticker symbols that return no data
```

Run `npm run check` once after you download the project. A few tickers for smaller exchanges (for example Chile, UAE, Egypt, Vietnam and Pakistan) are the ones most likely to need adjusting. To fix one, search for the index on finance.yahoo.com, copy the symbol shown in the page URL, and paste it into `public/data/markets.js`.

## Put it online (free, about 5 minutes)

**Option A: GitHub + Vercel, no terminal needed**
1. Create a free account on github.com, make a new repository, and upload this folder's contents.
2. Go to vercel.com, sign in with GitHub, choose **Add New → Project**, and import the repository.
3. Leave every setting at its default and click **Deploy**. You get a URL like `world-markets-yourname.vercel.app`.
4. Every later push to GitHub redeploys the site automatically. You can add a custom domain under Project → Settings → Domains.

**Option B: Vercel CLI**
```bash
npm i -g vercel
vercel          # first deploy (asks a few questions)
vercel --prod
```

## Updating the reference data

Policy rates, 10Y yields (all except the US) and market caps have no free live feed. They live in `public/data/markets.js` as `[value, "as-of"]` pairs, for example:

```js
policy: [5.50, "Oct 2026 (repo)"], y10: [7.23, "7 Oct 2026"], mcap: [4.34, "Mar 2026 (NSE)"]
```

Edit the numbers whenever a central bank moves. Each card shows its as-of date so viewers can see how fresh a figure is. Countries without a stored 10Y yield link out to worldgovernmentbonds.com.

The snapshot was taken on 10 Nov 2026. Sources: central-bank decisions as reported on Wikipedia's list of central bank rates and in recent news; 10Y yields from thetrading.tools (official daily series and OECD monthly data) and Trading Economics; market caps from World Federation of Exchanges data for March 2026. Sources sometimes disagree, so check a figure against the central bank's own site before relying on it.

## Adding a country or index

Copy any block in `MARKETS` inside `public/data/markets.js` and change the fields:

```js
{ id: "xx", name: "Country", flag: "🏳️", region: "Asia-Pacific", ccy: "XXX",
  exchange: "Exchange", tz: "Area/City", days: WD, sessions: [["09:00", "15:30"]],
  indices: [["^SYMBOL", "Index name"]], policy: [rate, "date"], y10: [yield, "date"] }
```

`tz` takes an IANA time zone name. `sessions` takes local open and close times; markets with a lunch break get two pairs.

## Limitations

- **Unofficial data source.** Yahoo Finance's chart endpoint is public but undocumented, and Yahoo can change or rate-limit it. It suits a personal or student project. For anything commercial, replace `fetchOne()` in `api/quotes.js` with a licensed provider such as Twelve Data, Financial Modeling Prep or Polygon; the rest of the site doesn't need to change.
- Some exchanges are **delayed 15–20 minutes**.
- Market open/closed status ignores **public holidays**.
- This site is for information and education only and is not investment advice.
