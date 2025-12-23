// api/funnel.js
// Forwarder ai-business-engine.com (Browser) → Vercel → Make Webhook

module.exports = async (req, res) => {
  const origin = req.headers.origin || "";

  // Allow ONLY your website origin
  const isAllowedOrigin = /^https:\/\/(www\.)?ai-business-engine\.com$/i.test(origin);

  if (isAllowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin); // must be explicit (not *)
    res.setHeader("Access-Control-Allow-Credentials", "true"); // <-- FIX for credentials: include
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  // Parse JSON body
  let body = {};
  try {
    body =
      (typeof req.body === "object" && req.body !== null)
        ? req.body
        : JSON.parse(req.body || "{}");
  } catch (e) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      ok: false,
      error: "Invalid JSON",
      detail: String((e && e.message) || e)
    }));
  }

  const MAKE_WEBHOOK = "https://hook.us1.make.com/d87it8opv8vck2ym9zm56wu9lin5orla";

  try {
    const r = await fetch(MAKE_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const text = await r.text().catch(() => "");
    res.statusCode = r.ok ? 200 : 502;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      ok: r.ok,
      forwarded_to: "make",
      make_status: r.status,
      make_body_preview: text.slice(0, 200)
    }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      ok: false,
      forwarded_to: "make",
      error: String((e && e.message) || e)
    }));
  }
};
