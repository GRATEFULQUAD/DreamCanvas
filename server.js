// Helpful crash logs
process.on('uncaughtException', e => { console.error('UNCAUGHT', e); process.exit(1); });
process.on('unhandledRejection', e => { console.error('UNHANDLED', e); process.exit(1); });
console.log('[Boot] DreamCanvas (Stability) starting…');

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const FormData = require('form-data');

// node-fetch (ESM) shim for CommonJS
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Root + health
app.get('/', (_req, res) =>
  res.type('text').send('DreamCanvas Stability API is up. Try GET /health or POST /ai/generate.')
);
app.get('/health', (_req, res) =>
  res.json({ ok: true, provider: 'Stability', time: new Date().toISOString() })
);

// --------- MAIN ROUTE (multipart to Stability) ----------
app.post('/ai/generate', async (req, res) => {
  try {
    let prompt = (req.body?.prompt || req.body?.description || req.body?.text || '').trim();
    let aspect  = (req.body?.aspect || req.body?.size || '1:1').toString().toLowerCase();
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    // normalize aspect to Stability options
    if (aspect.includes('16:9')) aspect = '16:9';
    else if (aspect.includes('9:16')) aspect = '9:16';
    else aspect = '1:1';

    const KEY = process.env.STABILITY_API_KEY;
    if (!KEY) return res.status(500).json({ error: 'Missing STABILITY_API_KEY on server' });

    const URL = 'https://api.stability.ai/v2beta/stable-image/generate/sd3';

    // Build multipart/form-data body
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('aspect_ratio', aspect);      // "1:1" | "16:9" | "9:16"
    form.append('output_format', 'jpeg');     // ask for JPEG back
    // You can also add: form.append('negative_prompt','...'), etc.

    const resp = await fetch(URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KEY}`,
        'Accept': 'image/*',                  // Stability expects image/* or application/json
        ...form.getHeaders()                  // proper multipart Content-Type
      },
      body: form
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
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
  }
});
// --------------------------------------------------------

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`DreamCanvas Stability API running on :${PORT}`));
