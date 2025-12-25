// /api/cta.js
export default async function handler(req, res) {
  // --- CORS: allow your Webflow domain(s) to call this endpoint ---
  res.setHeader("Access-Control-Allow-Origin", "https://www.ai-business-engine.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  try {
    const payload = req.body || {};

    // --- Forward to Make server-to-server (no browser CORS issues) ---
    const MAKE_WEBHOOK = process.env.MAKE_WEBHOOK_URL;

    if (!MAKE_WEBHOOK) {
      return res.status(500).json({ ok: false, error: "MAKE_WEBHOOK_URL missing" });
    }

    const r = await fetch(MAKE_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    return res.status(200).json({ ok: true, forwarded: r.ok });
  } catch (e) {
    return res.status(500).json({ ok: false });
  }
}
