// ----- Boot & crash logging -----
process.on('uncaughtException', e => { console.error('UNCAUGHT', e); process.exit(1); });
process.on('unhandledRejection', e => { console.error('UNHANDLED', e); process.exit(1); });
console.log('[Boot] DreamCanvas (Stability) starting…');

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const FormData = require('form-data');
// node-fetch (ESM) shim for CommonJS
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
app.get('/whoami', async (_req, res) => {
  try {
    const KEY = (process.env.STABILITY_API_KEY || '').trim();
    if (!KEY) return res.status(500).json({ ok:false, error:'Missing STABILITY_API_KEY' });

    const r = await fetch('https://api.stability.ai/v1/user/account', {
      headers: { Authorization: `Bearer ${KEY}` }
    });

    const txt = await r.text().catch(()=> '');
    if (!r.ok) return res.status(r.status).json({ ok:false, status:r.status, msg: txt.slice(0,400) });

    return res.json({ ok:true, status:r.status, account: JSON.parse(txt) });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e).slice(0,400) });
  }
});
const app = express();

// ---- CORS (open; optionally lock later with an allowlist) ----
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---- Friendly root & health ----
app.get('/', (_req, res) =>
  res.type('text').send('DreamCanvas Stability API is up. Try GET /health or POST /ai/generate.')
);
app.get('/health', (_req, res) =>
  res.json({ ok: true, provider: 'Stability', time: new Date().toISOString() })
);

// ---- Debug: verify key presence (does NOT expose it) ----
app.get('/debug', (_req, res) => {
  const KEY = (process.env.STABILITY_API_KEY || '').trim();
  res.json({
    ok: true,
    provider: 'Stability',
    hasKey: !!KEY,
    keyLooksRight: KEY.startsWith('sk-') && KEY.length > 20,
    time: new Date().toISOString()
  });
});

// ---- Self-test: try a tiny Stability call & report status ----
app.get('/selftest', async (_req, res) => {
  try {
    const KEY = (process.env.STABILITY_API_KEY || '').trim();
    if (!KEY) return res.status(500).json({ ok: false, error: 'Missing STABILITY_API_KEY on server' });

    const URL = 'https://api.stability.ai/v2beta/stable-image/generate/sd3';
    const form = new FormData();
    form.append('prompt', 'health check');
    form.append('aspect_ratio', '1:1');
    form.append('output_format', 'jpeg');

    const r = await fetch(URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KEY}`,
        Accept: 'image/*',
        ...form.getHeaders()
      },
      body: form
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(r.status).json({ ok: false, status: r.status, msg: (txt || `Stability error ${r.status}`).slice(0, 400) });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return res.json({ ok: true, status: r.status, bytes: buf.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e).slice(0, 400) });
  }
});

// ---- Main generate route (POST JSON -> multipart to Stability) ----
let inFlight = 0; // simple “one at a time” guard
app.post('/ai/generate', async (req, res) => {
  if (inFlight >= 1) return res.status(429).json({ error: 'One at a time, please 🫶' });
  inFlight++;

  try {
    let prompt = (req.body?.prompt || req.body?.description || req.body?.text || '').trim();
    let aspect  = (req.body?.aspect || req.body?.size || '1:1').toString().toLowerCase();
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    // normalize aspect
    if (aspect.includes('16:9')) aspect = '16:9';
    else if (aspect.includes('9:16')) aspect = '9:16';
    else aspect = '1:1';

    const KEY = (process.env.STABILITY_API_KEY || '').trim();
    if (!KEY) return res.status(500).json({ error: 'Missing STABILITY_API_KEY on server' });

    const URL = 'https://api.stability.ai/v2beta/stable-image/generate/sd3';

    const form = new FormData();
    form.append('prompt', prompt);
    form.append('aspect_ratio', aspect);   // "1:1" | "16:9" | "9:16"
    form.append('output_format', 'jpeg');  // return JPEG

    const resp = await fetch(URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KEY}`, // <- REQUIRED
        Accept: 'image/*',              // <- REQUIRED by Stability
        ...form.getHeaders()
      },
      body: form
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('[Stability FAIL]', resp.status, text.slice(0, 300));
      return res.status(resp.status).json({ error: text || `Stability error ${resp.status}` });
    }

    // bytes -> data URL for easy <img src="...">
    const buf = Buffer.from(await resp.arrayBuffer());
    const b64 = buf.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${b64}`;
    return res.json({ imageUrl: dataUrl, aspect });
  } catch (err) {
    console.error('Stability generation error:', err);
    return res.status(500).json({ error: err?.message || 'Image generation failed' });
  } finally {
    inFlight--;
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`DreamCanvas Stability API running on :${PORT}`));
