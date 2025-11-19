/**
 * Minimal Relay Endpoint for Meta Conversions API (CAPI)
 * ------------------------------------------------------
 * - GET  /api/capi?ping=1   → 200 { ok: true, ping: "pong" }  (Health)
 * - OPTIONS                 → 204 (CORS Preflight)
 * - POST /api/capi          → relays events to Meta
 *
 * Input:
 *   { event: {...} }  OR  { events: [ {...}, ... ] }
 *
 * ENV (Vercel → Settings → Environment Variables):
 *   META_PIXEL_ID
 *   META_ACCESS_TOKEN
 *   META_TEST_EVENT_CODE     (optional)
 *   CORS_ALLOW_ORIGIN        (comma-separated, no spaces)
 */

const ALLOWED_ORIGINS = (process.env.CORS_ALLOW_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const META_PIXEL_ID        = process.env.META_PIXEL_ID;
const META_ACCESS_TOKEN    = process.env.META_ACCESS_TOKEN;
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || "";

// Blocklist for event names that should NOT be forwarded to Meta
const BLOCKED_EVENTS = new Set([
  "VideoProgress",
  "VideoSummary"
]);

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
  // --- CORS ---
  setCors(res, req.headers.origin || "");

  // --- Health Check (GET /api/capi?ping=1) ---
  if (req.method === "GET") {
    if (req.query && Object.prototype.hasOwnProperty.call(req.query, "ping")) {
      return sendJson(res, 200, { ok: true, ping: "pong" });
    }
    return sendJson(res, 405, { ok: false, error: "Use POST for events" });
  }

  // --- Preflight (OPTIONS) ---
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  // --- Only POST beyond this point ---
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }

  if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {
    return sendJson(res, 500, { ok: false, error: "Server missing META env vars" });
  }

  // --- Parse body safely ---
  let body = {};
  try {
    if (typeof req.body === "object" && req.body !== null) {
      // Next.js / Vercel often passes already-parsed JSON here
      body = req.body;
    } else if (typeof req.body === "string" && req.body.trim() !== "") {
      body = JSON.parse(req.body);
    } else {
      // Fallback if no body or empty string
      body = {};
    }
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
  }

  // --- Normalise to events array ---
  let events = [];
  if (Array.isArray(body.events)) {
    events = body.events;
  } else if (body.event && typeof body.event === "object") {
    events = [body.event];
  } else {
    return sendJson(res, 400, {
      ok: false,
      error: "Missing 'events' array or 'event' object"
    });
  }

  // --- Inject / normalise user_data (IP & UA belong here) ---
  // Extract client IP / UA from headers
  const forwarded = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || req.socket?.remoteAddress || "";
  const ua = req.headers["user-agent"] || "";

  events = events.map(ev => {
    const e = { ...ev };
    const ud = { ...(e.user_data || {}) };

    // If client_ip_address / client_user_agent came in the event directly,
    // move them safely into user_data.
    if (e.client_ip_address && !ud.client_ip_address) {
      ud.client_ip_address = e.client_ip_address;
    }
    if (e.client_user_agent && !ud.client_user_agent) {
      ud.client_user_agent = e.client_user_agent;
    }

    // If not present, derive from request
    if (!ud.client_ip_address && ip) {
      ud.client_ip_address = ip;
    }
    if (!ud.client_user_agent && ua) {
      ud.client_user_agent = ua;
    }

    delete e.client_ip_address;
    delete e.client_user_agent;

    e.user_data = ud;
    return e;
  });

  // --- Block unwanted events (e.g. noisy VideoProgress etc.) ---
  const beforeCount = events.length;
  events = events.filter(e => {
    const name = e && e.event_name;
    return !BLOCKED_EVENTS.has(name);
  });

  const blockedCount = beforeCount - events.length;
  if (blockedCount > 0) {
    console.log(`[CAPI Relay] skipped ${blockedCount} blocked event(s)`);
  }

  // If nothing left after filtering, intentionally do not forward to Meta
  if (events.length === 0) {
    res.statusCode = 204; // No Content
    return res.end();
  }

  // --- Support "test mode" via query or header ---
  const forcingTest =
    (req.query && req.query.test === "1") ||
    req.headers["x-meta-test"] === "1";

  const payload = {
    data: events,
    ...(forcingTest && META_TEST_EVENT_CODE
      ? { test_event_code: META_TEST_EVENT_CODE }
      : {})
  };

  // --- Relay to Meta ---
  try {
    const url =
      `https://graph.facebook.com/v18.0/${encodeURIComponent(
        META_PIXEL_ID
      )}/events?access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const out = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error("[CAPI Relay] Meta responded with error", out);
    }

    return sendJson(res, resp.ok ? 200 : 400, {
      ok: resp.ok,
      meta: out
    });
  } catch (err) {
    console.error("[CAPI Relay] fetch error", err);
    return sendJson(res, 500, {
      ok: false,
      error: String((err && err.message) || err)
    });
  }
};
