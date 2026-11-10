// Checks that a request comes from a signed-in visitor.
// The browser sends its Firebase ID token as "Authorization: Bearer <token>"; we verify the token's
// signature against Google's published keys, so no secret or service account is needed here.
// Files starting with "_" in /api are helpers, not public endpoints.

const crypto = require("crypto");
const { PROJECT_ID } = require("./_firebase");

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
  if (process.env.MOCK === "1") return token.startsWith("mock-") ? { sub: token.slice(5) } : null;
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
    return claims;
  } catch (e) {
    return null;
  }
}

// wraps an endpoint so it only answers signed-in visitors.
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

module.exports = { verify, requireUser };
