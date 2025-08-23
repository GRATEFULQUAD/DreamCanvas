// ----- Boot & crash logging -----
process.on('uncaughtException', e => { console.error('UNCAUGHT', e); process.exit(1); });
process.on('unhandledRejection', e => { console.error('UNHANDLED', e); process.exit(1); });
console.log('[Boot] DreamCanvas (Modelslab-only) starting…');

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---- BASIC ROUTES ----
app.get('/', (_req, res) =>
  res.type('text').send('DreamCanvas API is up (provider=modelslab). Try GET /health or POST /ai/generate.')
);

app.get('/health', (_req, res) =>
  res.json({ ok: true, provider: 'modelslab', time: new Date().toISOString() })
);

app.get('/debug', (_req, res) => {
  res.json({
    ok: true,
    provider: 'modelslab',
    hasKey: !!(process.env.MODELSLAB_API_KEY || '').trim(),
    model: process.env.MODELSLAB_MODEL || 'realistic-vision-v5.1',
    time: new Date().toISOString()
  });
});

// ---- Self-test (hits Modelslab using your key) ----
app.get('/selftest', async (_req, res) => {
  try {
    const KEY = (process.env.MODELSLAB_API_KEY || '').trim();
    const MODEL = (process.env.MODELSLAB_MODEL || 'realistic-vision-v5.1').trim();
    if (!KEY) return res.status(500).json({ ok:false, error:'Missing MODELSLAB_API_KEY' });

    const r = await fetch('https://modelslab.com/api/v6/realtime/text2img', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        key: KEY,
        prompt: 'health check',
        model_id: MODEL,
        width: 1024,
        height: 1024,
        samples: 1
      })
    });
    const txt = await r.text();
    return res.status(r.ok ? 200 : r.status).json({ ok: r.ok, status: r.status, body: txt.slice(0, 400) });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e).slice(0,400) });
  }
});

// ---- MAIN GENERATE ROUTE (Modelslab only) ----
let inFlight = 0;
app.post('/ai/generate', async (req, res) => {
  if (inFlight >= 1) return res.status(429).json({ error: 'One at a time, please 🫶' });
  inFlight++;

  try {
    const KEY = (process.env.MODELSLAB_API_KEY || '').trim();
    const MODEL = (process.env.MODELSLAB_MODEL || 'realistic-vision-v5.1').trim();
    if (!KEY) return res.status(500).json({ error: 'Missing MODELSLAB_API_KEY on server' });

    let prompt = (req.body?.prompt || req.body?.description || req.body?.text || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
    let aspect = (req.body?.aspect || '1:1').toLowerCase();

    // Use sizes that are multiples of 64 (Modelslab requirement)
    // 16:9 → 1280x768 ; 9:16 → 768x1344 ; 1:1 → 1024x1024
    const width  = aspect.includes('16:9') ? 1280 : aspect.includes('9:16') ? 768  : 1024;
    const height = aspect.includes('9:16') ? 1344 : aspect.includes('16:9') ? 768 : 1024;

    const resp = await fetch('https://modelslab.com/api/v6/realtime/text2img', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        key: KEY,          // key in body (no Authorization header)
        prompt,
        model_id: MODEL,
        width, height,
        samples: 1
      })
    });

    const txt = await resp.text();
    if (!resp.ok) {
      console.error('[ModelsLab FAIL]', resp.status, txt.slice(0,300));
      return res.status(resp.status).json({ error: txt || `ModelsLab error ${resp.status}` });
    }

    let data; try { data = JSON.parse(txt); } catch { data = {}; }

    // Common response shapes
    let url =
      data?.output?.[0] ||
      data?.data?.[0]?.url ||
      data?.url || null;

    if (!url) {
      // base64 fallbacks
      const b64 =
        (Array.isArray(data?.images) && typeof data.images[0] === 'string' && data.images[0].startsWith('data:image'))
          ? data.images[0].split(',')[1]
          : (data?.image_base64 || null);
      if (b64) url = `data:image/jpeg;base64,${b64}`;
    }

    if (!url) {
      console.error('[ModelsLab PARSE] raw:', txt.slice(0, 400));
      return res.status(500).json({ error: 'ModelsLab returned no image URL', rawPreview: txt.slice(0,200) });
    }

    return res.json({ imageUrl: url, aspect });
  } catch (err) {
    console.error('Generation error:', err);
    return res.status(500).json({ error: err?.message || 'Image generation failed' });
  } finally {
    inFlight--;
  }
});

// ---- START SERVER ----
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`DreamCanvas API running on :${PORT} (provider=modelslab)`));
