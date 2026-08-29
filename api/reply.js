const TIMEOUT_MS = 15000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { phone, message } = req.body || {};

  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing required field: phone' });
  }
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing required field: message' });
  }
  if (!/^\d{7,15}$/.test(phone)) {
    return res.status(400).json({ success: false, error: 'Invalid phone number format' });
  }
  if (message.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Message cannot be empty' });
  }
  if (message.length > 4096) {
    return res.status(400).json({ success: false, error: 'Message too long (max 4096 chars)' });
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
      body: JSON.stringify({ action: 'reply', phone, message }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!makeRes.ok) {
      return res.status(502).json({ success: false, error: `Make.com returned ${makeRes.status}` });
    }

    return res.status(200).json({ success: true, message: 'Reply sent' });

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return res.status(504).json({ success: false, error: 'Make.com timed out after 15s' });
    }
    console.error('[reply]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
