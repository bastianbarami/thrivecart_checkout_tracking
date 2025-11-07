export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Minimal-Extraktion – wir verfeinern das Mapping später:
    const orderId   = body?.order_id || body?.invoice_id || body?.transaction_id;
    const value     = parseFloat(body?.order_total || body?.charge_total || '0') || 0;
    const currency  = (body?.currency || 'EUR').toUpperCase();
    const contentIds = body?.product_id ? [`tc_${body.product_id}`] : undefined;

    // Identifier (werden später verbessert – vorerst leer/optional)
    const fbp = body?.fbp || '';
    const fbc = body?.fbc || '';
    const eid = body?.event_id || body?.eid || undefined; // Dedup

    // (Optional) gehashte Email als external_id — reichen wir später korrekt an
    const external_id = body?.customer?.email_hash || undefined;

    // Meta Secrets aus ENV
    const pixel_id     = process.env.META_PIXEL_ID;
    const access_token = process.env.META_ACCESS_TOKEN;

    // Client Infos (EMQ)
    const client_ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    const client_ua = req.headers['user-agent'];

    // Relay an /api/capi
    const capiUrl = `${process.env.PUBLIC_BASE_URL}/api/capi`;
    const capiResp = await fetch(capiUrl, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        pixel_id, access_token,
        event_name: 'Purchase',
        event_time: Math.floor(Date.now()/1000),
        event_id: eid, fbp, fbc, external_id,
        client_ip, client_ua,
        value, currency, order_id: orderId, content_ids: contentIds
        // test_event_code: 'OPTIONAL_TEST_CODE'
      })
    });

    const capiJson = await capiResp.json();
    if (!capiResp.ok) return res.status(capiResp.status).json({ error: 'capi_failed', details: capiJson });

    return res.status(200).json({ ok: true, meta: capiJson });
  } catch (e) {
    console.error('thrivecart webhook error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
