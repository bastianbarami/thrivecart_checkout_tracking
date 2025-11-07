// api/capi.js
// Minimaler CAPI-Endpunkt für Meta (Browser & Server nutzbar)
// Vercel Node 18, ESM nicht nötig; fetch ist global verfügbar

const PIXEL_ID = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || "";
const CORS = (process.env.CORS_ALLOW_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Helper: E-Mail → SHA256
const crypto = require("node:crypto");
function hashEmail(email) {
  if (!email) return undefined;
  const norm = String(email).trim().toLowerCase();
  if (!norm) return undefined;
  return crypto.createHash("sha256").update(norm).digest("hex");
}

// CORS: erlaubte Origins; no-origin (Server→Server) erlauben
function corsHeaders(req) {
  const origin = req.headers.origin || "";
  const allow = CORS.includes(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow || "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

module.exports = async (req, res) => {
  // Preflight
  if (req.method === "OPTIONS") {
    res.set(corsHeaders(req));
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  // Origin prüfen (Browser). Fehlt der Origin (Server→Server), erlauben wir es.
  const origin = req.headers.origin || "";
  if (origin && !CORS.includes(origin)) {
    res.set(corsHeaders(req));
    return res.status(403).json({ error: "Origin not allowed" });
  }

  // Payload lesen
  let body = {};
  try {
    body = req.body || {};
    if (typeof body === "string") body = JSON.parse(body);
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  // Erwartete Felder (alles optional bis auf event_name)
  const {
    event_name,
    event_time,              // optional; sonst jetzt
    event_source_url,        // z.B. window.location.href
    action_source = "website",
    email,                   // unverschlüsselt → wird gehasht
    value,                   // z.B. 499
    currency = "EUR",
    custom_data = {},        // frei erweiterbar (content_name etc.)
    test_event_code,         // optional überschreiben
  } = body;

  if (!event_name) {
    return res.status(400).json({ error: "Missing event_name" });
  }

  // User-Daten aufbereiten
  const user_data = {
    em: email ? [hashEmail(email)] : undefined,
    client_ip_address: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || undefined,
    client_user_agent: req.headers["user-agent"] || undefined,
  };

  // Custom-Data
  const cd = {
    value: value != null ? Number(value) : undefined,
    currency,
    ...custom_data,
  };

  // Meta-Events-Array
  const data = [{
    event_name,
    event_time: Number(event_time) || Math.floor(Date.now() / 1000),
    action_source,
    event_source_url,
    user_data,
    custom_data: cd,
  }];

  const url = `https://graph.facebook.com/v18.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
  const payload = {
    data,
    test_event_code: test_event_code || TEST_EVENT_CODE || undefined,
  };

  try {
    const fbRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const fbJson = await fbRes.json();
    res.set(corsHeaders(req));

    if (!fbRes.ok) {
      return res.status(fbRes.status).json({ error: "facebook_error", details: fbJson });
    }
    return res.status(200).json({ ok: true, fb: fbJson });
  } catch (e) {
    return res.status(500).json({ error: "request_failed", details: String(e?.message || e) });
  }
};
