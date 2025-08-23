// ----- Boot & crash logging -----
process.on('uncaughtException', e => { console.error('UNCAUGHT', e); process.exit(1); });
process.on('unhandledRejection', e => { console.error('UNHANDLED', e); process.exit(1); });
console.log('[Boot] DreamCanvas (Multi-Provider) starting…');

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const FormData = require('form-data');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

// ---- CONFIG ----
const PROVIDER = (process.env.PROVIDER || 'stability').toLowerCase();

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

// ---- DEBUG ROUTES (no secrets leaked) ----
app.get('/debug', (_req, res) => {
  const dbg = { ok: true, provider: PROVIDER, time: new Date().toISOString() };
  if (PROVIDER === 'stability') {
    dbg.hasKey = !!(process.env.STABILITY_API_KEY || '').trim();
  } else if (PROVIDER === 'replicate') {
    dbg.hasKey = !!(process.env.REPLICATE_API_TOKEN || '').trim();
    dbg.model  = (process.env.REPLICATE_MODEL || 'black-forest-labs/flux-schnell');
  }
  res.json(dbg);
});

// Stability account check
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

// Provider self-test
app.get('/selftest', async (_req, res) => {
  try {
    if (PROVIDER === 'stability') {
      const KEY = (process.env.STABILITY_API_KEY || '').trim();
      if (!KEY) return res.status(500).json({ ok:false, error:'Missing STABILITY_API_KEY on server' });

      const URL = 'https://api.stability.ai/v2beta/stable-image/generate/sd3';
      const form = new FormData();
      form.append('prompt', 'health check');
      form.append('aspect_ratio', '1:1');
      form.append('output_format', 'jpeg');

      const r = await fetch(URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, Accept: 'image/*', ...form.getHeaders() },
        body: form
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        return res.status(r.status).json({ ok:false, status:r.status, msg:(txt || `Stability error ${r.status}`).slice(0,400) });
      }
      const buf = Buffer.from(await r.arrayBuffer());
      return res.json({ ok:true, status:r.status, bytes: buf.length });
    }

    if (PROVIDER === 'replicate') {
      const TOKEN = (process.env.REPLICATE_API_TOKEN || '').trim();
      const MODEL = (process.env.REPLICATE_MODEL || 'black-forest-labs/flux-schnell').trim();
      if (!TOKEN) return res.status(500).json({ ok:false, error:'Missing REPLICATE_API_TOKEN on server' });

      const createUrl = `https://api.replicate.com/v1/models/${MODEL}/predictions`;
      const start = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${TOKEN}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ input: { prompt: 'health check', aspect_ratio: '1:1' } })
      });
      const raw = await start.text();
      return res.status(start.ok ? 200 : start.status).json({ ok:start.ok, status:start.status, body: raw.slice(0,400) });
    }

    return res.status(500).json({ ok:false, error:'Unknown PROVIDER' });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e).slice(0,400) });
  }
});

// ---- MAIN GENERATE ROUTE (multi-provider) ----
let inFlight = 0;
app.post('/ai/generate', async (req, res) => {
  if (inFlight >= 1) return res.status(429).json({ error: 'One at a time, please 🫶' });
  inFlight++;

  try {
    let prompt = (req.body?.prompt || '').trim();
    let aspect  = (req.body?.aspect || '1:1').toLowerCase();
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
        body: JSON.stringify({ input: { prompt, aspect_ratio: aspect } })
      });

      const startText = await start.text();
      if (!start.ok) {
        console.error('[Replicate create FAIL]', start.status, startText.slice(0,300));
        return res.status(start.status).json({ error: startText || `Replicate create ${start.status}` });
      }
      const created = JSON.parse(startText);
      const pollUrl = created?.urls?.get || created?.urls?.self;
      if (!pollUrl) return res.status(500).json({ error: 'Replicate did not return a poll URL' });

      // poll until done
      let status = created.status;
      let output = created.output;
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

      if (status !== 'succeeded') {
        return res.status(500).json({ error: `Replicate ${status || 'failed'}` });
      }

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

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.error('[Stability FAIL]', resp.status, text.slice(0,300));
        return res.status(resp.status).json({ error: text || `Stability error ${resp.status}` });
      }

      const buf = Buffer.from(await resp.arrayBuffer());
      const b64 = buf.toString('base64');
      return res.json({ imageUrl: `data:image/jpeg;base64,${b64}`, aspect });
    }

    return res.status(500).json({ error: 'Unknown PROVIDER. Use PROVIDER=replicate or stability.' });

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
