const TIMEOUT_MS = 12000;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
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
      body: JSON.stringify({ action: 'get_conversations' }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!makeRes.ok) {
      return res.status(502).json({ success: false, error: `Make.com returned ${makeRes.status}` });
    }

    let data;
    try {
      data = await makeRes.json();
    } catch {
      return res.status(502).json({ success: false, error: 'Make.com returned invalid JSON' });
    }

    // Support both array response (raw rows) and {conversations:[]} envelope
    const rows = Array.isArray(data) ? data : (data.conversations || []);
    return res.status(200).json({ success: true, conversations: rows });

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return res.status(504).json({ success: false, error: 'Make.com timed out after 12s' });
    }
    console.error('[conversations]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
