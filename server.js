// ----- Boot & crash logging -----
process.on('uncaughtException', e => { console.error('UNCAUGHT', e); process.exit(1); });
process.on('unhandledRejection', e => { console.error('UNHANDLED', e); process.exit(1); });
console.log('[Boot] DreamCanvas (Multi-Provider) starting…');

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const FormData = require('form-data');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---- provider selector ----
const PROVIDER = (process.env.PROVIDER || 'stability').toLowerCase();
// stability env: STABILITY_API_KEY
// generic env: PROVIDER_URL, PROVIDER_API_KEY, PROVIDER_AUTH_HEADER, PROVIDER_AUTH_VALUE

// ---- basics ----
app.get('/', (_req, res) =>
  res.type('text').send(`DreamCanvas API is up. Provider=${PROVIDER}. Try GET /health or POST /ai/generate.`)
);
app.get('/health', (_req, res) =>
  res.json({ ok: true, provider: PROVIDER, time: new Date().toISOString() })
);

// ---- debug: show what’s configured (no secrets) ----
app.get('/debug', (_req, res) => {
  const dbg = { ok: true, provider: PROVIDER, time: new Date().toISOString() };
  if (PROVIDER === 'stability') {
    dbg.hasKey = !!(process.env.STABILITY_API_KEY || '').trim();
  } else if (PROVIDER === 'generic') {
    dbg.url = process.env.PROVIDER_URL || '';
    dbg.hasKey = !!(process.env.PROVIDER_API_KEY || '').trim();
    dbg.authHeader = process.env.PROVIDER_AUTH_HEADER || 'Authorization';
  }
  res.json(dbg);
});

// ---- whoami/selftest per provider ----
app.get('/whoami', async (_req, res) => {
  try {
    if (PROVIDER === 'stability') {
      const KEY = (process.env.STABILITY_API_KEY || '').trim();
      if (!KEY) return res.status(500).json({ ok:false, error:'Missing STABILITY_API_KEY' });
      const r = await fetch('https://api.stability.ai/v1/user/account', {
        headers: { Authorization: `Bearer ${KEY}` }
      });
      const txt = await r.text().catch(()=> '');
      if (!r.ok) return res.status(r.status).json({ ok:false, status:r.status, msg: txt.slice(0,400) });
      return res.json({ ok:true, status:r.status, account: JSON.parse(txt) });
    }
    // generic providers often don’t have a whoami; just report config
    return res.json({ ok:true, provider: 'generic', info: 'No whoami endpoint for generic.' });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e).slice(0,400) });
  }
});

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

    // generic provider selftest (simple POST expecting JSON success)
    const KEY = (process.env.PROVIDER_API_KEY || '').trim();
    const URL = (process.env.PROVIDER_URL || '').trim();
    const HDR = (process.env.PROVIDER_AUTH_HEADER || 'Authorization').trim();
    const VAL = (process.env.PROVIDER_AUTH_VALUE || `Bearer ${KEY}`).replace('${PROVIDER_API_KEY}', KEY);

    if (!URL) return res.status(500).json({ ok:false, error:'Missing PROVIDER_URL' });
    const payload = { prompt: 'health check', aspect_ratio: '1:1' };
    const r = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', [HDR]: VAL, Accept:'application/json' },
      body: JSON.stringify(payload)
    });
    const raw = await r.text();
    return res.status(r.ok ? 200 : r.status).json({ ok:r.ok, status:r.status, body: raw.slice(0,400) });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e).slice(0,400) });
  }
});

// ---- main generate route ----
let inFlight = 0;
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

    // ---- generic JSON provider (url or base64) ----
    const KEY = (process.env.PROVIDER_API_KEY || '').trim();
    const URL = (process.env.PROVIDER_URL || '').trim();
    const HDR = (process.env.PROVIDER_AUTH_HEADER || 'Authorization').trim();
    const VAL = (process.env.PROVIDER_AUTH_VALUE || `Bearer ${KEY}`).replace('${PROVIDER_API_KEY}', KEY);

    if (!URL) return res.status(500).json({ error:'Missing PROVIDER_URL on server' });

    const payload = { prompt, aspect_ratio: aspect }; // map fields as needed
    const pr = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', [HDR]: VAL, Accept:'application/json' },
      body: JSON.stringify(payload)
    });
    const raw = await pr.text();
    if (!pr.ok) {
      console.error('[Provider FAIL]', pr.status, raw.slice(0,300));
      return res.status(pr.status).json({ error: raw || `Provider error ${pr.status}` });
    }
    let out = null; try { out = JSON.parse(raw); } catch {}
    let dataUrl = out?.imageUrl || out?.url;
    if (!dataUrl) {
      const b64 = out?.image?.base64 || out?.images?.[0]?.base64 || null;
      if (b64) dataUrl = `data:image/jpeg;base64,${b64}`;
    }
    if (!dataUrl) return res.status(500).json({ error: 'No image returned from provider', debug: raw.slice(0,200) });
    return res.json({ imageUrl: dataUrl, aspect });
  } catch (err) {
    console.error('Generation error:', err);
    return res.status(500).json({ error: err?.message || 'Image generation failed' });
  } finally {
    inFlight--;
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`DreamCanvas API running on :${PORT} (provider=${PROVIDER})`));
