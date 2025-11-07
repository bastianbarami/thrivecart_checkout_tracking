// api/capi.js
/**
 * Minimaler, robuster Relay-Endpunkt zu Meta CAPI
 * - GET     /api/capi?ping=1         -> 200 ok (Health-Check)
 * - OPTIONS /api/capi                -> 204 (CORS Preflight)
 * - POST    /api/capi                -> leitet Events an Meta weiter
 *
 * Body (POST):
 *  - ENTWEDER: { events: [ {..Meta Event..}, ... ] }
 *  - ODER:     { event:  {..Meta Event..} }  (wird zu events:[...] gewrappt)
 *
 * ENV Variablen (Vercel → Settings → Environment Variables):
 *  - META_PIXEL_ID
 *  - META_ACCESS_TOKEN
 *  - META_TEST_EVENT_CODE (optional)
 *  - CORS_ALLOW_ORIGIN    (Komma-getrennte Origins, ohne Leerzeichen)
 */

const ALLOWED_ORIGINS = (process.env.CORS_ALLOW_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const META_PIXEL_ID = process.env.META_PIXEL_ID || "";
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "";
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || "";

// ---- kleine Utils -----------------------------------------------------------
function setCors(res, origin) {
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

async function readJsonBody(req) {
  // Falls Vercel den Body schon geparst hat:
  if (req.body && typeof req.body === "object") return req.body;

  // Ansonsten Stream lesen:
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getQuery(req) {
  // req.query ist in @vercel/node nicht garantiert; daher selbst parsen
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const out = {};
  url.searchParams.forEach((v, k) => (out[k] = v));
  return out;
}

// ---- Handler (CommonJS Export) ----------------------------------------------
module.exports = async (req, res) => {
  const origin = req.headers.origin || "";
  setCors(res, origin);

  const query = getQuery(req);

  // Health / Ping
  if (req.method === "GET") {
    if ("ping" in query) return send(res, 200, { ok: true, ping: "pong" });
    return send(res, 405, { ok: false, error: "Use POST for events" });
  }

  // CORS Preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    return send(res, 405, { ok: false, error: "Method not allowed" });
  }

  if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {
    return send(res, 500, { ok: false, error: "Server missing META env vars" });
  }

  // Body lesen/normalisieren
  const body = await readJsonBody(req);
  let events = [];
  if (Array.isArray(body.events)) {
    events = body.events;
  } else if (body.event && typeof body.event === "object") {
    events = [body.event];
  } else {
    return send(res, 400, {
      ok: false,
      error: "Missing 'events' array or 'event' object",
    });
  }

  // Optional Test-Event erzwingen (per ?test=1 oder Header x-meta-test: 1)
  const forcingTest = query.test === "1" || req.headers["x-meta-test"] === "1";
  const payload = {
    data: events,
    ...(forcingTest && META_TEST_EVENT_CODE
      ? { test_event_code: META_TEST_EVENT_CODE }
      : {}),
  };

  try {
    const graphUrl = `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(
      META_ACCESS_TOKEN
    )}`;

    const resp = await fetch(graphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const out = await resp.json().catch(() => ({}));
    return send(res, resp.ok ? 200 : 400, { ok: resp.ok, meta: out });
  } catch (err) {
    return send(res, 500, { ok: false, error: String(err?.message || err) });
  }
};
