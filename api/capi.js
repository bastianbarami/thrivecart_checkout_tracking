/**
 * Minimaler Relay-Endpunkt zur Meta Conversions API (CAPI)
 * -------------------------------------------------------
 * - GET  /api/capi?ping=1   → 200 pong (Health)
 * - OPTIONS                 → 204 (CORS Preflight)
 * - POST /api/capi          → leitet Events an Meta weiter
 *
 * Eingabe:
 *   { event: {...} }  ODER  { events: [ {...}, ... ] }
 *
 * ENV (Vercel → Settings → Environment Variables):
 *   META_PIXEL_ID
 *   META_ACCESS_TOKEN
 *   META_TEST_EVENT_CODE     (optional)
 *   CORS_ALLOW_ORIGIN        (kommagetrennt, ohne Leerzeichen!)
 */

const ALLOWED_ORIGINS = (process.env.CORS_ALLOW_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const META_PIXEL_ID        = process.env.META_PIXEL_ID;
const META_ACCESS_TOKEN    = process.env.META_ACCESS_TOKEN;
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || "";

function setCors(res, origin) {
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  setCors(res, req.headers.origin || "");

  // Health
  if (req.method === "GET") {
    if (req.query && ("ping" in req.query)) {
      return sendJson(res, 200, { ok: true, ping: "pong" });
    }
    return sendJson(res, 405, { ok: false, error: "Use POST for events" });
  }

  // Preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }

  if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {
    return sendJson(res, 500, { ok: false, error: "Server missing META env vars" });
  }

  // Body parsen
  let body = {};
  try {
    body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
  } catch {
    return sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
  }

  // Events normalisieren
  let events = [];
  if (Array.isArray(body.events)) {
    events = body.events;
  } else if (body.event && typeof body.event === "object") {
    events = [body.event];
  } else {
    return sendJson(res, 400, { ok: false, error: "Missing 'events' array or 'event' object" });
  }

  // --- user_data sauber aufbauen (IP/UA gehören HIER hinein) ---
  const forwarded = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || req.socket?.remoteAddress || "";
  const ua = req.headers["user-agent"] || "";

  events = events.map(ev => {
    const e = { ...ev };
    // vorhandene user_data respektieren, sonst Objekt anlegen
    const ud = { ...(e.user_data || {}) };

    // Falls fälschlich auf Top-Level übergeben, nach user_data verschieben
    if (e.client_ip_address && !ud.client_ip_address) ud.client_ip_address = e.client_ip_address;
    if (e.client_user_agent && !ud.client_user_agent) ud.client_user_agent = e.client_user_agent;

    // Serverseitig aus Headern ergänzen (wenn nicht gesetzt)
    if (!ud.client_ip_address && ip) ud.client_ip_address = ip;
    if (!ud.client_user_agent && ua) ud.client_user_agent = ua;

    // Aufräumen top-level
    delete e.client_ip_address;
    delete e.client_user_agent;

    e.user_data = ud;
    return e;
  });
  // -------------------------------------------------------------

  // Test-Modus unterstützen
  const forcingTest = (req.query && req.query.test === "1") || req.headers["x-meta-test"] === "1";
  const payload = {
    data: events,
    ...(forcingTest && META_TEST_EVENT_CODE ? { test_event_code: META_TEST_EVENT_CODE } : {})
  };

  // An Meta senden
  try {
    const url = `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
    const out = await resp.json().catch(() => ({}));
    return sendJson(res, resp.ok ? 200 : 400, { ok: resp.ok, meta: out });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: String(err && err.message || err) });
  }
};
