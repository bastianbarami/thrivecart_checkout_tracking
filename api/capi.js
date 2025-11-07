export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const {
      pixel_id, access_token, event_name, event_time,
      event_id, fbp, fbc, external_id, client_ip, client_ua,
      value, currency, order_id, content_ids, test_event_code
    } = req.body || {};

    if (!pixel_id || !access_token || !event_name) {
      return res.status(400).json({ error: 'missing pixel / token / event_name' });
    }

    const user_data = {};
    if (external_id) user_data.external_id = external_id;
    if (fbp) user_data.fbp = fbp;
    if (fbc) user_data.fbc = fbc;
    if (client_ip) user_data.client_ip_address = client_ip;
    if (client_ua) user_data.client_user_agent = client_ua;

    const custom_data = {
      value: typeof value === 'number' ? value : undefined,
      currency: currency || 'EUR',
      content_ids: content_ids || undefined,
      order_id: order_id || undefined
    };

    const payload = {
      data: [{
        event_name,
        event_time: event_time || Math.floor(Date.now()/1000),
        event_id,
        action_source: 'website',
        user_data,
        custom_data
      }]
    };

    if (test_event_code) payload.test_event_code = test_event_code;

    const url = `https://graph.facebook.com/v17.0/${pixel_id}/events?access_token=${access_token}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });

    const json = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(json);
    return res.status(200).json(json);
  } catch (e) {
    console.error('capi error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
