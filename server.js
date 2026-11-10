// Local dev server: `npm start` → http://localhost:3000
// Serves /public and the same /api/quotes function Vercel runs.
const http = require("http");
const fs = require("fs");
const path = require("path");
const quotes = require("./api/quotes");
const chart = require("./api/chart");
const fundamentals = require("./api/fundamentals");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname === "/api/quotes") return quotes(req, res);
  if (u.pathname === "/api/chart") return chart(req, res);
  if (u.pathname === "/api/fundamentals") return fundamentals(req, res);
  let p = path.normalize(path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname));
  if (!p.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  fs.readFile(p, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end("Not found"); }
    res.setHeader("Content-Type", TYPES[path.extname(p)] || "application/octet-stream");
    res.end(buf);
  });
}).listen(PORT, () => console.log(`World Markets running at http://localhost:${PORT}${process.env.MOCK === "1" ? "  (demo data)" : ""}`));
