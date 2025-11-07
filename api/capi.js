// api/capi.js
/**
 * Minimaler, robuster Relay-Endpunkt zu Meta CAPI
 * - GET  /api/capi?ping=1 -> 200 ok (Health-Check)
 * - OPTIONS -> CORS Preflight
 * - POST /api/capi -> leitet Events an Meta weiter
 *
 * Erwartetes Body-Format (Browser/Thrivecart -> Relay):
 *  - ENTWEDER: { events: [ {... Meta Event ...} ] }
 *  - ODER:     { event:  {... Meta Event ...} }   (wird zu events:[] gewrappt)
 *
 * ENV-Variablen (in Vercel → Settings → Environment Variables):
 *  - META_PIXEL_ID        (z.B. 1337997101285196)
 *  - META_ACCESS_TOKEN    (Dein langer Access Token)
 *  - META_TEST_EVENT_CODE (optional, z.B. TEST53810)
 *  - CORS_ALLOW_ORIGIN    (Komma-getrennte Origins, ohne Leerzeichen!)
 */

const ALLOWED_ORIGINS = (process.env.CORS_ALLOW_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const META_PIXEL_ID     = process.env.META_PIXEL_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || "";

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

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  setCors(res, origin);

  // Health / Ping
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

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    bad(res, 405, "Method not allowed");
    return;
  }

  if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {
    bad(res, 500, "Server missing META env vars");
    return;
  }

  // Body einlesen
  let body = {};
  try {
    body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
  } catch (e) {
    bad(res, 400, "Invalid JSON body");
    return;
  }

  // Flexibles Input-Format -> Immer zu { events: [...] } normalisieren
  let events = [];
  if (Array.isArray(body.events)) {
    events = body.events;
  } else if (body.event && typeof body.event === "object") {
    events = [body.event];
  } else {
    bad(res, 400, "Missing 'events' array or 'event' object");
    return;
  }

  // Test-Event optional automatisch ergänzen (nur wenn gefordert)
  const forcingTest = (req.query && req.query.test === "1") || (req.headers["x-meta-test"] === "1");
  const payload = {
    data: events,
    test_event_code: forcingTest && META_TEST_EVENT_CODE ? META_TEST_EVENT_CODE : undefined
  };

  try {
    const graphUrl = `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`;

    const resp = await fetch(graphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const out = await resp.json();
    res.statusCode = resp.ok ? 200 : 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: resp.ok, meta: out }));
  } catch (err) {
    bad(res, 500, String(err && err.message || err));
  }
}
