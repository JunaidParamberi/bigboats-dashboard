/**
 * Big Boats UAE — Local dev server
 * Serves index.html and proxies /api/* to Make.com.
 *
 * For production use Vercel (api/*.js serverless functions).
 * For local dev:  npm start
 */
import 'dotenv/config';
import express from 'express';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const TIMEOUT_MS = 15000;

// Make.com URLs (local dev uses separate webhooks until unified scenario is built)
const MAKE = {
  conversations: process.env.MAKE_GET_CONVERSATIONS_URL,
  reply:         process.env.MAKE_SEND_REPLY_URL,
  takeover:      process.env.MAKE_TAKEOVER_URL,
};

app.use(express.json());

// Serve dashboard (supports index.html or dashboard.html)
const candidates = ['index.html', 'dashboard.html'].map(f => join(__dirname, f));
const DASHBOARD_FILE = candidates.find(f => existsSync(f)) || candidates[0];
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(DASHBOARD_FILE));

// Helper: call Make.com with timeout
async function callMake(url, body) {
  if (!url) throw Object.assign(new Error('Webhook URL not configured in .env'), { status: 500 });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw Object.assign(new Error(`Make.com returned ${res.status}`), { status: 502 });
    return res;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw Object.assign(new Error('Make.com timed out'), { status: 504 });
    throw e;
  }
}

// GET /api/conversations
app.get('/api/conversations', async (req, res) => {
  try {
    const makeRes = await callMake(MAKE.conversations, {});
    const data = await makeRes.json();
    const rows = Array.isArray(data) ? data : (data.conversations || []);
    res.json({ success: true, conversations: rows });
  } catch (e) {
    console.error('[conversations]', e.message);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

// GET /api/messages?phone=...
app.get('/api/messages', async (req, res) => {
  const { phone } = req.query;
  if (!phone || !/^\d{7,15}$/.test(phone))
    return res.status(400).json({ success: false, error: 'Invalid or missing phone param' });
  try {
    const makeRes = await callMake(MAKE.conversations, {});
    const data = await makeRes.json();
    const rows = (Array.isArray(data) ? data : (data.conversations || []))
      .filter(r => r.phone === phone);
    res.json({ success: true, messages: rows });
  } catch (e) {
    console.error('[messages]', e.message);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

// POST /api/reply
app.post('/api/reply', async (req, res) => {
  const { phone, message } = req.body || {};
  if (!phone || !/^\d{7,15}$/.test(phone))
    return res.status(400).json({ success: false, error: 'Invalid or missing phone' });
  if (!message || !message.trim())
    return res.status(400).json({ success: false, error: 'Message cannot be empty' });
  if (message.length > 4096)
    return res.status(400).json({ success: false, error: 'Message too long (max 4096 chars)' });
  try {
    await callMake(MAKE.reply, { to: phone, message });
    res.json({ success: true, message: 'Reply sent' });
  } catch (e) {
    console.error('[reply]', e.message);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

// POST /api/takeover
app.post('/api/takeover', async (req, res) => {
  const { phone, mode } = req.body || {};
  if (!phone || !/^\d{7,15}$/.test(phone))
    return res.status(400).json({ success: false, error: 'Invalid or missing phone' });
  if (!['ai', 'human'].includes(mode))
    return res.status(400).json({ success: false, error: 'mode must be "ai" or "human"' });
  try {
    await callMake(MAKE.takeover, { phone, mode });
    res.json({ success: true, message: `Mode set to ${mode}` });
  } catch (e) {
    console.error('[takeover]', e.message);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ Big Boats dashboard running at http://localhost:${PORT}\n`);
  console.log('  Conversations:', MAKE.conversations ? '✓' : '⚠ set MAKE_GET_CONVERSATIONS_URL in .env');
  console.log('  Reply:        ', MAKE.reply         ? '✓' : '⚠ set MAKE_SEND_REPLY_URL in .env');
  console.log('  Takeover:     ', MAKE.takeover      ? '✓' : '⚠ set MAKE_TAKEOVER_URL in .env');
  console.log('');
});
