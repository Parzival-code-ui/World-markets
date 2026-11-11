// Browser smoke test in demo mode (MOCK=1). Run with: npm run smoke
// Starts the local server, signs in with the offline demo account and walks the main screens.
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 3199, base = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ["server.js"], { env: { ...process.env, MOCK: "1", PORT: String(PORT) }, stdio: "inherit" });
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
try {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) errors.push("CSP: " + m.text()); });
    await page.route("**/data/firebase.js", (r) => r.fulfill({ body: "window.FIREBASE_CONFIG=null;", contentType: "text/javascript" }));
    await page.route("https://fonts.g*/**", (r) => r.abort());
    // signed out: homepage works and charts open
    await page.goto(base + "/");
    await page.waitForSelector(".card", { timeout: 8000 });
    if (!(await page.locator("#headline").innerText()).length) fail("no headline");
    await page.locator("[data-sym='^NSEI']").first().click();
    await page.waitForSelector("#m-chart svg path", { timeout: 8000 }).catch(() => fail("chart did not open signed out"));
    await page.keyboard.press("Escape");
    for (const v of ["map", "heat", "table", "stocks", "cal", "india"]) {
      await page.goto(base + "/#" + v); await page.waitForTimeout(500);
      if (await page.locator(".locked-panel").count()) fail(`${v} is locked for visitors`);
    }
    // personal pages ask for an account
    await page.goto(base + "/#mine"); await page.waitForTimeout(400);
    if (!(await page.locator(".locked-panel").count())) fail("My markets should ask visitors to sign in");
    // an email account that hasn't confirmed its address is asked to first
    await page.evaluate(() => localStorage.setItem("wm-demo-user", JSON.stringify({ uid: "demo", name: "New", email: "n@example.com", photo: "", google: false, verified: false })));
    await page.reload(); await page.waitForTimeout(700);
    if (!(await page.locator("[data-verified]").count())) fail("unconfirmed email account was not asked to confirm");
    await page.locator("[data-verified]").click(); await page.waitForTimeout(500);
    if (await page.locator("[data-verified]").count()) fail("confirming the email did not unlock My markets");
    // sign in (demo) and pick something
    await page.evaluate(() => localStorage.setItem("wm-demo-user", JSON.stringify({ uid: "demo", name: "Demo", email: "d@example.com", photo: "", google: false, verified: true })));
    await page.reload(); await page.waitForTimeout(900);
    await page.locator("[data-pick='CL=F']").click();
    await page.locator("[data-hold='CL=F']").first().click().catch(() => {});
    await page.waitForTimeout(300);
    if (errors.length) fail(`${w}px page errors: ${errors.join(" | ")}`);
    await page.close();
  }
} finally {
  await browser.close();
  srv.kill();
}
if (!process.exitCode) console.log("smoke test passed");
