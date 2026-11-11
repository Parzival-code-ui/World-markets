// Browser smoke test in demo mode (MOCK=1). Run with: npm run smoke
// Starts the local server and walks the main screens with the offline demo accounts:
// "demo" is the site owner, uids starting "pending" are waiting for approval.
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 3199, base = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ["server.js"], { env: { ...process.env, MOCK: "1", PORT: String(PORT) }, stdio: "inherit" });
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const as = (page, u) => page.evaluate((u) => { u ? localStorage.setItem("wm-demo-user", JSON.stringify(u)) : localStorage.removeItem("wm-demo-user"); }, u);
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
try {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) errors.push("CSP: " + m.text()); });
    await page.route("**/data/firebase.js", (r) => r.fulfill({ body: 'window.FIREBASE_CONFIG=null; window.WM_ADMIN="demo";', contentType: "text/javascript" }));
    await page.route("https://fonts.g*/**", (r) => r.abort());

    // signed out: only the gate, and the data API refuses
    await page.goto(base + "/"); await page.waitForTimeout(700);
    if (!(await page.locator("#gate [data-signin='gate']").isVisible())) fail("signed-out visitors should see the sign-in gate");
    if (await page.locator("#headline").isVisible()) fail("market data visible before sign-in");
    const api = await page.evaluate(() => fetch("/api/quotes?symbols=AAPL").then((r) => r.status));
    if (api !== 401) fail("quotes API should refuse signed-out requests, got " + api);

    // waiting for approval
    await as(page, { uid: "pending-1", name: "Pat Waiting", email: "p@example.com", photo: "", google: true, verified: true });
    await page.reload(); await page.waitForTimeout(800);
    if (!/with the owner/.test(await page.locator("#gate").innerText())) fail("pending account should see the waiting message");
    const api2 = await page.evaluate(() => fetch("/api/quotes?symbols=AAPL", { headers: { Authorization: "Bearer mock-pending-1" } }).then((r) => r.status));
    if (api2 !== 403) fail("quotes API should refuse a pending account, got " + api2);

    // the owner: whole site, charts, tabs, and the access list
    await as(page, { uid: "demo", name: "Owner", email: "o@example.com", photo: "", google: true, verified: true });
    await page.reload();
    await page.waitForSelector(".card", { timeout: 8000 });
    await page.locator("[data-sym='^NSEI']").first().click();
    await page.waitForSelector("#m-chart svg path", { timeout: 8000 }).catch(() => fail("chart did not open"));
    await page.keyboard.press("Escape");
    for (const v of ["map", "heat", "table", "stocks", "cal", "india"]) { await page.goto(base + "/#" + v); await page.waitForTimeout(400); }
    await page.locator("#acct").click(); await page.locator("#am-access").click(); await page.waitForTimeout(400);
    await page.locator(".access-box [data-acc-st='approved']").first().click(); await page.waitForTimeout(400);
    if (!/Have access/.test(await page.locator(".access-box").innerText())) fail("approving a request didn't move it to 'Have access'");
    await page.keyboard.press("Escape");

    // My markets: pick something and record a buy
    await page.goto(base + "/#mine"); await page.waitForTimeout(600);
    await page.locator("[data-pick='CL=F']").click(); await page.waitForTimeout(300);
    await page.goto(base + "/#mine"); await page.waitForTimeout(500);
    await page.locator("[data-hold='CL=F']").first().click();
    await page.locator(".lot [name=d]").first().fill("2025-01-15");
    await page.locator(".lot [name=p]").first().fill("70");
    await page.locator(".lot [name=q]").first().fill("10");
    await page.locator(".hbox .btn.primary").click(); await page.waitForTimeout(400);
    if (!/average/.test(await page.locator("[data-pl='CL=F']").innerText())) fail("saved buy didn't show on the card");

    for (const pth of ["/about", "/privacy"]) { const r = await page.goto(base + pth); if (!r.ok()) fail(pth + " did not load"); }
    if (errors.length) fail(`${w}px page errors: ${errors.join(" | ")}`);
    await page.close();
  }
} finally {
  await browser.close();
  srv.kill();
}
if (!process.exitCode) console.log("smoke test passed");
