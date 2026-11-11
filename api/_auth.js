// Request checks for the API: who is asking (verify) and how often (limited).
// The browser sends its Firebase ID token as "Authorization: Bearer <token>"; we verify the token's
// signature against Google's published keys, so no secret or service account is needed here.
// Files starting with "_" in /api are helpers, not public endpoints.

const crypto = require("crypto");
const { PROJECT_ID, ADMIN_UID } = require("./_firebase");

const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let certs = null, certsUntil = 0;

async function getCerts() {
  if (certs && Date.now() < certsUntil) return certs;
  const r = await fetch(CERTS_URL);
  if (!r.ok) throw new Error("couldn't fetch Google's signing keys");
  certs = await r.json();
  const m = /max-age=(\d+)/.exec(r.headers.get("cache-control") || "");
  certsUntil = Date.now() + (m ? +m[1] : 3600) * 1000;
  return certs;
}

const b64 = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

// returns the token's claims (uid in .sub) or null
async function verify(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) return null;
  if (process.env.MOCK === "1") return token.startsWith("mock-") ? { sub: token.slice(5), _token: token } : null;
  if (!PROJECT_ID) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const head = JSON.parse(b64(parts[0]).toString("utf8"));
    const claims = JSON.parse(b64(parts[1]).toString("utf8"));
    if (head.alg !== "RS256" || !head.kid) return null;
    const keys = await getCerts();
    const cert = keys[head.kid];
    if (!cert) return null;
    const ok = crypto.createVerify("RSA-SHA256").update(parts[0] + "." + parts[1]).verify(cert, b64(parts[2]));
    const now = Math.floor(Date.now() / 1000);
    if (!ok || claims.aud !== PROJECT_ID || claims.iss !== "https://securetoken.google.com/" + PROJECT_ID) return null;
    if (!claims.sub || claims.exp < now || claims.iat > now + 300) return null;
    claims._token = token;
    return claims;
  } catch (e) {
    return null;
  }
}

// Has the site owner let this account in? The answer is the "status" field of access/{uid} in Firestore,
// which only the owner can set to "approved". We read it with the visitor's own token (the database rules
// let each account read its own entry), so no service account is needed. Answers are kept briefly.
const access = new Map();
async function approvalOf(user) {
  if (!user) return "none";
  if (user.sub === ADMIN_UID) return "approved";
  if (process.env.MOCK === "1") return user.sub.startsWith("pending") ? "pending" : "approved";
  const hit = access.get(user.sub);
  if (hit && hit.until > Date.now()) return hit.status;
  let status = "none";
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/access/${encodeURIComponent(user.sub)}`, { headers: { Authorization: "Bearer " + user._token } });
    if (r.ok) { const j = await r.json(); status = (j.fields && j.fields.status && j.fields.status.stringValue) || "pending"; }
  } catch (e) { return "error"; }
  // let an approval take effect within a minute; a removal within five
  access.set(user.sub, { status, until: Date.now() + (status === "approved" ? 300e3 : 30e3) });
  if (access.size > 2000) access.delete(access.keys().next().value);
  return status;
}

// wraps an endpoint so it only answers signed-in visitors the owner has approved.
// Answers can't sit in the shared CDN cache any more (that would hand them to signed-out visitors),
// so each warm instance keeps recent answers for a minute instead of asking Yahoo again.
const memo = new Map();
function requireUser(handler, ttlSec = 60) {
  return async function (req, res) {
    const user = await verify(req);
    const send = (code, type, body, cache) => {
      res.statusCode = code;
      res.setHeader("Content-Type", type);
      res.setHeader("Cache-Control", cache);
      res.end(body);
    };
    if (!user) return send(401, "application/json", JSON.stringify({ error: "Sign in to use this", signIn: true }), "no-store");
    const st = await approvalOf(user);
    if (st !== "approved") return send(403, "application/json", JSON.stringify({ error: st === "error" ? "Couldn't check your access. Try again." : "Your account is waiting for approval", access: st }), "no-store");
    req.user = user;
    const key = req.url, hit = memo.get(key);
    if (hit && hit.until > Date.now()) return send(200, hit.type, hit.body, "private, max-age=60");
    // capture what the endpoint sends, keep successful answers, and mark them private
    const headers = {};
    const realEnd = res.end.bind(res), realSet = res.setHeader.bind(res);
    res.setHeader = (k, v) => { headers[k.toLowerCase()] = v; if (!/^cache-control$/i.test(k)) realSet(k, v); };
    res.end = (body) => {
      realSet("Cache-Control", res.statusCode === 200 ? "private, max-age=60" : "no-store");
      if (res.statusCode === 200 && typeof body === "string") {
        memo.set(key, { until: Date.now() + ttlSec * 1000, type: headers["content-type"] || "application/json", body });
        if (memo.size > 400) memo.delete(memo.keys().next().value);
      }
      return realEnd(body);
    };
    return handler(req, res);
  };
}

module.exports = { verify, requireUser, limited, approvalOf };


// Rate limit for the public data endpoints. Most answers come from Vercel's shared cache and never reach
// this code; what does reach it (new searches, unusual symbols) is limited per visitor: per signed-in
// account when a token is sent, otherwise per IP address. Counts live in each warm instance, which is
// enough to stop one client hammering Yahoo through us.
const hits = new Map();
function clientKey(req, user) {
  if (user) return "u:" + user.sub;
  const f = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return "ip:" + (req.headers["x-real-ip"] || f || (req.socket && req.socket.remoteAddress) || "?");
}
function limited(handler, perMinute = 60) {
  return async function (req, res) {
    const user = await verify(req).catch(() => null);
    req.user = user;
    const key = clientKey(req, user), now = Date.now();
    let h = hits.get(key);
    if (!h || now - h.t > 60000) { h = { t: now, n: 0 }; hits.set(key, h); }
    h.n++;
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.t > 60000) hits.delete(k);
    const cap = user ? perMinute * 2 : perMinute;
    if (h.n > cap) {
      res.statusCode = 429;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Retry-After", String(Math.ceil((h.t + 60000 - now) / 1000)));
      return res.end(JSON.stringify({ error: "Too many requests. Wait a minute and try again." }));
    }
    return handler(req, res);
  };
}
