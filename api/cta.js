// /api/cta.js
export default async function handler(req, res) {
  // Allowlist of origins (add more if needed)
  const ALLOWED = new Set([
    "https://www.ai-business-engine.com",
    "https://ai-business-engine.com",
    "https://checkout.ai-business-engine.com"
  ]);

  const origin = req.headers.origin || "";
  if (ALLOWED.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  try {
    const MAKE_WEBHOOK = process.env.MAKE_WEBHOOK_URL;
    if (!MAKE_WEBHOOK) {
      return res.status(500).json({ ok: false, error: "MAKE_WEBHOOK_URL missing" });
    }

    // Normalize payload (if body arrives as a JSON string, parse it)
    let payload = req.body || {};
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch (_) {}
    }

    const r = await fetch(MAKE_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    return res.status(200).json({ ok: true, forwarded: r.ok });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
