// Builds the security headers in vercel.json, including a Content-Security-Policy that allows the page's
// own inline scripts by hash. Run `npm run csp` after editing an inline <script>; CI runs `--check`
// and fails if vercel.json is out of date.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const pages = fs.readdirSync(path.join(ROOT, "public")).filter((f) => f.endsWith(".html"));
const hashes = new Set();
for (const f of pages) {
  const html = fs.readFileSync(path.join(ROOT, "public", f), "utf8");
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) hashes.add("'sha256-" + crypto.createHash("sha256").update(m[1], "utf8").digest("base64") + "'");
}
const FIREBASE_AUTH_DOMAIN = "https://world-markets-27f52.firebaseapp.com";
const csp = [
  "default-src 'self'",
  `script-src 'self' ${[...hashes].sort().join(" ")} https://cdn.jsdelivr.net https://www.gstatic.com https://apis.google.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
  "img-src 'self' data: https://*.googleusercontent.com",
  "connect-src 'self' https://cdn.jsdelivr.net https://*.googleapis.com https://apis.google.com https://www.gstatic.com",
  `frame-src ${FIREBASE_AUTH_DOMAIN} https://accounts.google.com https://apis.google.com`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const headers = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // the Google sign-in popup has to be able to report back, so popups keep their link to this page
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
];

const file = path.join(ROOT, "vercel.json");
const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
cfg.cleanUrls = true;
cfg.headers = [{ source: "/(.*)", headers }];
const out = JSON.stringify(cfg, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (fs.readFileSync(file, "utf8") !== out) { console.error("vercel.json is out of date: run `npm run csp` and commit it"); process.exit(1); }
  console.log("security headers up to date");
} else {
  fs.writeFileSync(file, out);
  console.log("wrote vercel.json with " + hashes.size + " inline script hash(es)");
}
