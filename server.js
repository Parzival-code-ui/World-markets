// Local dev server: `npm start` → http://localhost:3000 (`npm run demo` for made-up prices)
// Serves /public and runs the same /api functions Vercel runs.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "public");
const API = path.join(__dirname, "api");
// the same security headers Vercel sends (vercel.json), so local testing catches anything they block
const HEADERS = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "vercel.json"), "utf8")).headers[0].headers; } catch (e) { return []; } })();
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".xml": "application/xml" };

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  for (const h of HEADERS) res.setHeader(h.key, h.key === "Content-Security-Policy" ? h.value.replace("; upgrade-insecure-requests", "") : h.value);
  const m = /^\/api\/([a-z-]+)$/.exec(u.pathname);
  if (m) {
    const f = path.join(API, m[1] + ".js");
    if (fs.existsSync(f)) return require(f)(req, res);
    res.statusCode = 404; return res.end("Not found");
  }
  let p = path.normalize(path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname));
  if (!p.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  if (!path.extname(p) && fs.existsSync(p + ".html")) p += ".html"; // /about → about.html, like Vercel's cleanUrls
  fs.readFile(p, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end("Not found"); }
    res.setHeader("Content-Type", TYPES[path.extname(p)] || "application/octet-stream");
    res.end(buf);
  });
}).listen(PORT, () => console.log(`World Markets running at http://localhost:${PORT}${process.env.MOCK === "1" ? "  (demo data)" : ""}`));
