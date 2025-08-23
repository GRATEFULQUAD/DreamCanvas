let inFlight = 0;
app.post('/ai/generate', async (req, res) => {
  if (inFlight >= 1) return res.status(429).json({ error: 'One at a time, please 🫶' });
  inFlight++;
  try {
    let prompt = (req.body?.prompt || '').trim();
    let aspect  = (req.body?.aspect || '1:1').toLowerCase();
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
    aspect = aspect.includes('16:9') ? '16:9' : aspect.includes('9:16') ? '9:16' : '1:1';

    const PROVIDER = (process.env.PROVIDER || 'stability').toLowerCase();

    // ---------- REPLICATE ----------
    if (PROVIDER === 'replicate') {
      const TOKEN = (process.env.REPLICATE_API_TOKEN || '').trim();
      const MODEL = (process.env.REPLICATE_MODEL || 'black-forest-labs/flux-schnell').trim();
      const POLL_MS = +(process.env.REPLICATE_POLL_MS || 1200);
      if (!TOKEN) return res.status(500).json({ error: 'Missing REPLICATE_API_TOKEN on server' });

      // 1) create a prediction (uses the model’s default version)
      const createUrl = `https://api.replicate.com/v1/models/${MODEL}/predictions`;
      const start = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${TOKEN}`,     // Replicate auth format
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          input: {
            prompt,
            aspect_ratio: aspect  // flux-* models accept "1:1" | "16:9" | "9:16"
            // add other inputs if you want (guidance, steps, seed, etc.)
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

      // 2) poll until done
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
        // optional: timeout guard (e.g., 90s)
        if (Date.now() - t0 > 90_000) return res.status(504).json({ error: 'Replicate timeout' });
      }

      if (status !== 'succeeded') {
        return res.status(500).json({ error: `Replicate ${status || 'failed'}` });
      }

      // Replicate usually returns an array of image URLs
      let url = Array.isArray(output) ? output[0] : (output?.[0] || output?.image || output?.url);
      if (!url) return res.status(500).json({ error: 'Replicate returned no image URL' });

      // send back a direct URL (frontend <img src> can use it)
      return res.json({ imageUrl: url, aspect });
    }

    // ---------- STABILITY (existing) ----------
    if ((process.env.PROVIDER || 'stability').toLowerCase() === 'stability') {
      const KEY = (process.env.STABILITY_API_KEY || '').trim();
      if (!KEY) return res.status(500).json({ error: 'Missing STABILITY_API_KEY on server' });
      const URL = 'https://api.stability.ai/v2beta/stable-image/generate/sd3';
      const FormData = require('form-data');
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

    // ---------- fallback ----------
    return res.status(500).json({ error: 'Unknown PROVIDER. Set PROVIDER=replicate or stability.' });

  } catch (err) {
    console.error('Generation error:', err);
    return res.status(500).json({ error: err?.message || 'Image generation failed' });
  } finally {
    inFlight--;
  }
});
