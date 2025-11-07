/**
 * Minimaler, robuster Relay-Endpunkt zu Meta Conversions API (CAPI)
 * ---------------------------------------------------------------
 * - GET  /api/capi?ping=1     → Health Check ("pong")
 * - OPTIONS                   → CORS Preflight
 * - POST /api/capi            → Event-Weiterleitung an Meta
 *
 * Erwartetes Format (vom Browser / Thrivecart / Make Webhook):
 *   - { "event":  { ... } }
 *   - { "events": [ ... ] }
 *
 * ENV Variablen (in Vercel → Settings → Environment Variables):
 *   META_PIXEL_ID        = 1337997101285196
 *   META_ACCESS_TOKEN    = (dein Access Token)
 *   META_TEST_EVENT_CODE = TEST53810
 *   CORS_ALLOW_ORIGIN    = https://checkout.bastianbarami.com
 */

const ALLOWED_ORIGINS = (process.env.CORS_ALLOW_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const META_PIXEL_ID        = process.env.META_PIXEL_ID;
const META_ACCESS_TOKEN    = process.env.META_ACCESS_TOKEN;
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || "";

/* --------------------- Hilfsfunktionen --------------------- */

function setCors(res, origin) {
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function bad(res, code, msg) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: false, error: msg }));
}

/* --------------------- Haupt-Handler --------------------- */

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  setCors(res, origin);

  // GET → Health Check
  if (req.method === "GET") {
    if (req.query && ("ping" in req.query)) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, ping: "pong" }));
      return;
    }
    bad(res, 405, "Use POST for events");
    return;
  }

  // OPTIONS → Preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Nur POST erlaubt
  if (req.method !== "POST") {
    bad(res, 405, "Method not allowed");
    return;
  }

  if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {
    bad(res, 500, "Server missing META environment variables");
    return;
  }

  /* --------------------- Body einlesen --------------------- */

  let body = {};
  try {
    body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
  } catch {
    bad(res, 400, "Invalid JSON body");
    return;
  }

  // Einheitliches Format sicherstellen
  let events = [];
  if (Array.isArray(body.events)) {
    events = body.events;
  } else if (body.event && typeof body.event === "object") {
    events = [body.event];
  } else {
    bad(res, 400, "Missing 'events' array or 'event' object");
    return;
  }

  /* --------------------- NEU: Automatisches Matching --------------------- */
  // (Meta verlangt mindestens IP & User-Agent für Zuordnung)
  const forwarded = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || req.socket?.remoteAddress || "";
  const ua = req.headers["user-agent"] || "";

  events = events.map(e => ({
    ...e,
    client_ip_address: e.client_ip_address || ip || undefined,
    client_user_agent: e.client_user_agent || ua || undefined,
  }));

  /* --------------------- Testmodus --------------------- */
  const forcingTest =
    (req.query && req.query.test === "1") || req.headers["x-meta-test"] === "1";

  const payload = {
    data: events,
    test_event_code:
      forcingTest && META_TEST_EVENT_CODE ? META_TEST_EVENT_CODE : undefined,
  };

  /* --------------------- Meta-Request --------------------- */
  try {
    const graphUrl = `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(
      META_ACCESS_TOKEN
    )}`;

    const resp = await fetch(graphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const out = await resp.json();
    res.statusCode = resp.ok ? 200 : 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: resp.ok, meta: out }));
  } catch (err) {
    bad(res, 500, String(err?.message || err));
  }
}
