// Make Render logs actually helpful
process.on('uncaughtException', e => { console.error('UNCAUGHT', e); process.exit(1); });
process.on('unhandledRejection', e => { console.error('UNHANDLED', e); process.exit(1); });
console.log('[Boot] DreamCanvas (Stability) starting…');

require('dotenv').config();
const express = require('express');
const cors = require('cors');

// node-fetch (ESM) shim for CommonJS
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// health + friendly root
app.get('/', (_req, res) =>
  res.type('text').send('DreamCanvas Stability API is up. Try GET /health or POST /ai/generate.')
);
app.get('/health', (_req, res) => res.json({ ok: true, provider: 'Stability', time: new Date().toISOString() }));

/**
 * POST /ai/generate
 * Body: { prompt: string, aspect?: "16:9" | "9:16" | "1:1" }
 * Returns: { imageUrl: "data:image/jpeg;base64,..." , aspect }
 */
app.post('/ai/generate', async (req, res) => {
  try {
    let prompt = (req.body?.prompt || req.body?.description || req.body?.text || '').trim();
    let aspect  = (req.body?.aspect || req.body?.size || '1:1').toString().toLowerCase();
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    // normalize aspect
    if (aspect.includes('16:9')) aspect = '16:9';
    else if (aspect.includes('9:16')) aspect = '9:16';
    else aspect = '1:1';

    const KEY = process.env.STABILITY_API_KEY;
    if (!KEY) return res.status(500).json({ error: 'Missing STABILITY_API_KEY on server' });

    // SD3 JSON endpoint: returns raw image bytes when Accept: image/jpeg
    const URL = 'https://api.stability.ai/v2beta/stable-image/generate/sd3';

    const resp = await fetch(URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KEY}`,
        'Accept': 'image/jpeg',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        aspect_ratio: aspect // "1:1" | "16:9" | "9:16"
        // optional: output_format: 'jpeg', seed, negative_prompt, cfg_scale, etc.
      })
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      // 402 here usually means credits/plan limit
      return res.status(resp.status).json({ error: text || `Stability error ${resp.status}` });
    }

    // Convert bytes -> data URL so frontend can <img src="...">
    const buf = Buffer.from(await resp.arrayBuffer());
    const b64 = buf.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${b64}`;

    return res.json({ imageUrl: dataUrl, aspect });
  } catch (err) {
    console.error('Stability generation error:', err);
    return res.status(500).json({ error: err?.message || 'Image generation failed' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`DreamCanvas Stability API running on :${PORT}`));
