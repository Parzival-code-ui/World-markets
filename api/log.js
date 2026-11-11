// Browser error reports. Each one is written to the Vercel function log (Vercel → project → Logs, filter "client-error"),
// so problems on visitors' devices show up without a third-party service.
const seen = new Map(); // per-instance: drop repeats so one broken page can't flood the log

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
  let body = "";
  for await (const chunk of req) { body += chunk; if (body.length > 8000) break; }
  let e = {};
  try { e = JSON.parse(body.slice(0, 8000)); } catch (x) {}
  const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
  const msg = clip(e.msg, 500), key = msg + clip(e.src, 200) + clip(e.line, 10);
  const now = Date.now();
  if (msg && (!seen.has(key) || now - seen.get(key) > 600000)) {
    seen.set(key, now);
    if (seen.size > 500) seen.clear();
    console.error("client-error", JSON.stringify({
      msg, src: clip(e.src, 200), line: clip(e.line, 10), stack: clip(e.stack, 1500), page: clip(e.page, 200),
      ua: clip(req.headers["user-agent"], 160), ver: clip(e.ver, 20),
    }));
  }
  res.statusCode = 204;
  res.end();
};
