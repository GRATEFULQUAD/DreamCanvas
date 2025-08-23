// ----- Boot & crash logging -----
process.on('uncaughtException', e => { console.error('UNCAUGHT', e); process.exit(1); });
process.on('unhandledRejection', e => { console.error('UNHANDLED', e); process.exit(1); });
console.log('[Boot] DreamCanvas (Multi-Provider) starting…');

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const FormData = require('form-data');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const PROVIDER = (process.env.PROVIDER || 'replicate').toLowerCase();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---- BASIC ROUTES ----
app.get('/', (_req, res) =>
  res.type('text').send(`DreamCanvas API is up. Provider=${PROVIDER}. Try GET /health or POST /ai/generate.`)
);
app.get('/health', (_req, res) =>
  res.json({ ok: true, provider: PROVIDER, time: new Date().toISOString() })
);
app.get('/debug', (_req, res) => {
  const dbg = { ok: true, provider: PROVIDER, time: new Date().toISOString() };
  if (PROVIDER === 'replicate') {
    dbg.hasKey = !!(process.env.REPLICATE_API_TOKEN || '').trim();
    dbg.model  = process.env.REPLICATE_MODEL || 'black-forest-labs/flux-schnell';
  } else if (PROVIDER === 'stability') {
    dbg.hasKey = !!(process.env.STABILITY_API_KEY || '').trim();
  } else if (PROVIDER === 'modelslab') {
    dbg.hasKey = !!(process.env.MODELSLAB_API_KEY || '').trim();
    dbg.model  = process.env.MODELSLAB_MODEL || 'realistic-vision-v5.1';
  }
  res.json(dbg);
});

// Stability-only account check (optional)
app.get('/whoami', async (_req, res) => {
  if (PROVIDER !== 'stability') return res.json({ ok:true, provider: PROVIDER, info:'whoami is for Stability only' });
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

// ---- MAIN GENERATE ROUTE ----
let inFlight = 0;
app.post('/ai/generate', async (req, res) => {
  if (inFlight >= 1) return res.status(429).json({ error: 'One at a time, please 🫶' });
  inFlight++;

  try {
    let prompt = (req.body?.prompt || req.body?.description || req.body?.text || '').trim();
    let aspect  = (req.body?.aspect || req.body?.size || '1:1').toLowerCase();
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
    aspect = aspect.includes('16:9') ? '16:9' : aspect.includes('9:16') ? '9:16' : '1:1';

    // ---------- REPLICATE ----------
    if (PROVIDER === 'replicate') {
      const TOKEN = (process.env.REPLICATE_API_TOKEN || '').trim();
      const MODEL = (process.env.REPLICATE_MODEL || 'black-forest-labs/flux-schnell').trim();
      const POLL_MS = +(process.env.REPLICATE_POLL_MS || 1200);
      if (!TOKEN) return res.status(500).json({ error: 'Missing REPLICATE_API_TOKEN on server' });

      const createUrl = `https://api.replicate.com/v1/models/${MODEL}/predictions`;
      const start = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${TOKEN}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          input: {
            prompt,
            aspect_ratio: aspect // "1:1" | "16:9" | "9:16" (flux-* models)
          }
        })
      });

      const startText = await start.text();
      if (!start.ok) {
        console.error('[Replicate create FAIL]', start.status, startText.slice(0,300));
        return res.status(start.status).json({ error: startText || `Replicate create ${start.status}` });
      }
      const created = JSON.parse(startText);
      const pollUrl = created?.urls?.get || created?.urls?.self;
      if (!pollUrl) return res.status(500).json({ error: 'Replicate did not return a poll URL' });

      let status = created.status, output = created.output;
      const t0 = Date.now();
      while (status && !['succeeded', 'failed', 'canceled'].includes(status)) {
        await new Promise(r => setTimeout(r, POLL_MS));
        const pr = await fetch(pollUrl, {
          headers: { 'Authorization': `Token ${TOKEN}`, 'Accept': 'application/json' }
        });
        const txt = await pr.text();
        if (!pr.ok) {
          console.error('[Replicate poll FAIL]', pr.status, txt.slice(0,300));
          return res.status(pr.status).json({ error: txt || `Replicate poll ${pr.status}` });
        }
        const data = JSON.parse(txt);
        status = data.status;
        output = data.output;
        if (Date.now() - t0 > 90_000) return res.status(504).json({ error: 'Replicate timeout' });
      }

      if (status !== 'succeeded') return res.status(500).json({ error: `Replicate ${status || 'failed'}` });
      let url = Array.isArray(output) ? output[0] : (output?.[0] || output?.image || output?.url);
      if (!url) return res.status(500).json({ error: 'Replicate returned no image URL' });
      return res.json({ imageUrl: url, aspect });
    }

    // ---------- STABILITY ----------
    if (PROVIDER === 'stability') {
      const KEY = (process.env.STABILITY_API_KEY || '').trim();
      if (!KEY) return res.status(500).json({ error: 'Missing STABILITY_API_KEY on server' });

      const URL = 'https://api.stability.ai/v2beta/stable-image/generate/sd3';
      const form = new FormData();
      form.append('prompt', prompt);
      form.append('aspect_ratio', aspect);
      form.append('output_format', 'jpeg');

      const resp = await fetch(URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, Accept: 'image/*', ...form.getHeaders() },
        body: form
      });

      const textMaybe = await resp.text().catch(()=>'');
      if (!resp.ok) {
        console.error('[Stability FAIL]', resp.status, textMaybe.slice(0,300));
        return res.status(resp.status).json({ error: textMaybe || `Stability error ${resp.status}` });
      }
      // convert the text back to bytes if necessary
      const buf = Buffer.from(textMaybe || await resp.arrayBuffer());
      const isBinary = !textMaybe || !/^{/.test(textMaybe);
      const dataBuf = isBinary ? buf : Buffer.from(await (await fetch(URL)).arrayBuffer()); // fallback
      const b64 = (isBinary ? dataBuf : buf).toString('base64');
      return res.json({ imageUrl: `data:image/jpeg;base64,${b64}`, aspect });
    }

    // ---------- MODELSLAB ----------
    if (PROVIDER === 'modelslab') {
      const KEY = (process.env.MODELSLAB_API_KEY || '').trim();
      const MODEL = (process.env.MODELSLAB_MODEL || 'realistic-vision-v5.1').trim();
      if (!KEY) return res.status(500).json({ error: 'Missing MODELSLAB_API_KEY on server' });

      const resp = await fetch('https://modelslab.com/api/v1/image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          model_id: MODEL,
          prompt,
          width: aspect === '16:9' ? 1280 : aspect === '9:16' ? 720 : 1024,
          height: aspect === '9:16' ? 1280 : aspect === '16:9' ? 720 : 1024,
          samples: 1
        })
      });

      const txt = await resp.text();
      if (!resp.ok) {
        console.error('[ModelsLab FAIL]', resp.status, txt.slice(0,300));
        return res.status(resp.status).json({ error: txt || `ModelsLab error ${resp.status}` });
      }

      const data = JSON.parse(txt);
      const url = data?.output?.[0];
      if (!url) return res.status(500).json({ error: 'ModelsLab returned no image URL' });
      return res.json({ imageUrl: url, aspect });
    }

    return res.status(500).json({ error: 'Unknown PROVIDER. Use replicate, stability, or modelslab.' });

  } catch (err) {
    console.error('Generation error:', err);
    return res.status(500).json({ error: err?.message || 'Image generation failed' });
  } finally {
    inFlight--;
  }
});

// ---- START SERVER ----
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`DreamCanvas API running on :${PORT} (provider=${PROVIDER})`));
