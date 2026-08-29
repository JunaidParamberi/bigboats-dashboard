const TIMEOUT_MS = 10000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { phone, mode } = req.body || {};

  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing required field: phone' });
  }
  if (!['ai', 'human'].includes(mode)) {
    return res.status(400).json({ success: false, error: 'Field "mode" must be "ai" or "human"' });
  }
  if (!/^\d{7,15}$/.test(phone)) {
    return res.status(400).json({ success: false, error: 'Invalid phone number format' });
  }

  const webhookUrl = process.env.MAKE_DASHBOARD_WEBHOOK_URL;
  const apiKey = process.env.DASHBOARD_API_KEY;

  if (!webhookUrl) {
    return res.status(500).json({ success: false, error: 'Server configuration error: MAKE_DASHBOARD_WEBHOOK_URL is not set' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const makeRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ action: 'takeover', phone, mode }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!makeRes.ok) {
      return res.status(502).json({ success: false, error: `Make.com returned ${makeRes.status}` });
    }

    return res.status(200).json({ success: true, message: `Mode set to ${mode}` });

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return res.status(504).json({ success: false, error: 'Make.com timed out after 10s' });
    }
    console.error('[takeover]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
