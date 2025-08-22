// Show real errors in Render logs
process.on('uncaughtException', e => { console.error('UNCAUGHT', e); process.exit(1); });
process.on('unhandledRejection', e => { console.error('UNHANDLED', e); process.exit(1); });
console.log('[Boot] DreamCanvas (Flux) starting…');

require('dotenv').config();
const express = require('express');
const cors = require('cors');

// node-fetch (ESM) shim for CommonJS
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// simple checks
app.get('/', (_, res) => res.type('text').send('DreamCanvas Flux API is up. Try GET /health or POST /ai/generate.'));
app.get('/health', (_, res) => res.json({ ok: true, provider: 'Flux', time: new Date().toISOString() }));

// POST /ai/generate  { prompt: string, aspect?: "16:9"|"9:16"|"1:1" }
app.post('/ai/generate', async (req, res) => {
  try {
    let prompt = (req.body?.prompt || req.body?.description || req.body?.text || '').trim();
    let aspect  = (req.body?.aspect || req.body?.size || '1:1').toString().toLowerCase();

    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    // normalize aspect
    if (aspect.includes('16:9')) aspect = '16:9';
    else if (aspect.includes('9:16')) aspect = '9:16';
    else aspect = '1:1';

    const KEY = process.env.FLUX_API_KEY;
    if (!KEY) return res.status(500).json({ error: 'Missing FLUX_API_KEY on server' });

    const FLUX_ENDPOINT = 'https://api.bfl.ai/v1/flux-dev'; // free tier

    // 1) submit job
    const submit = await fetch(FLUX_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-key': KEY,
        'accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        aspect_ratio: aspect
      })
    });

    const submitJson = await submit.json();
    if (!submit.ok) {
      return res.status(submit.status).json({ error: submitJson?.error || 'Flux submit failed' });
    }

    const polling_url = submitJson?.polling_url;
    if (!polling_url) return res.status(502).json({ error: 'Flux did not return a polling_url' });

    // 2) poll until Ready
    const start = Date.now();
    const TIMEOUT_MS = 60_000;
    const INTERVAL_MS = 900;

    while (true) {
      if (Date.now() - start > TIMEOUT_MS) {
        return res.status(504).json({ error: 'Flux generation timed out' });
      }
      const poll = await fetch(polling_url, {
        method: 'GET',
        headers: { 'x-key': KEY, 'accept': 'application/json' }
      });
      const j = await poll.json();

      if (j?.status === 'Ready') {
        const imageUrl = j?.result?.sample;
        if (!imageUrl) return res.status(502).json({ error: 'Flux returned no image URL' });
        return res.json({ url: imageUrl, aspect });
      }
      if (j?.status === 'Error' || j?.status === 'Failed') {
        return res.status(502).json({ error: j?.error || 'Flux reported failure' });
      }
      await new Promise(r => setTimeout(r, INTERVAL_MS));
    }
  } catch (err) {
    console.error('Flux generation error:', err);
    return res.status(500).json({ error: err?.message || 'Image generation failed' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`DreamCanvas Flux API running on :${PORT}`));
