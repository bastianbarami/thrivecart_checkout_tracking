// Minimaler Forwarder ai-business-engine.com → Make Webhook (keine CORS-Probleme)
module.exports = async (req, res) => {
  // CORS (optional, da gleicher Origin-Aufruf geplant)
  const origin = req.headers.origin || "";
  if (/^https:\/\/(www\.)?ai-business-engine\.com$/i.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") { res.statusCode = 405; return res.end("Method not allowed"); }

  let body = {};
  try {
    body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
  } catch {
    res.statusCode = 400; return res.end("Invalid JSON");
  }

  try {
    const r = await fetch("https://hook.us1.make.com/d87it8opv8vck2ym9zm56wu9lin5orla", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    res.statusCode = r.ok ? 200 : 502;
    res.setHeader("Content-Type","application/json");
    res.end(JSON.stringify({ ok: r.ok }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type","application/json");
    res.end(JSON.stringify({ ok:false, error: String(e && e.message || e) }));
  }
};
