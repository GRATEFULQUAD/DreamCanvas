// Crash logging (so Render shows real errors instead of just "Exited with status 1")
process.on('uncaughtException', e => { console.error('UNCAUGHT', e); process.exit(1); });
process.on('unhandledRejection', e => { console.error('UNHANDLED', e); process.exit(1); });
console.log('[Boot] starting DreamCanvas server…');

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

// Create OpenAI client using env var
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'DreamCanvas API', time: new Date().toISOString() });
});

// Main generation route
app.post('/ai/generate', async (req, res) => {
  try {
    let prompt =
      (req.body && (req.body.prompt || req.body.description || req.body.text)) || '';
    let size = (req.body && (req.body.size || req.body.aspect)) || '';

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Missing prompt' });
    }
    prompt = prompt.trim();

    // Normalize size / aspect to valid OpenAI values
    const normalizeSize = (raw) => {
      if (!raw) return '1024x1024';
      const v = String(raw).toLowerCase().replace(/\s+/g, '');
      if (v === '16:9') return '1792x1024';
      if (v === '9:16') return '1024x1792';
      if (v === '1:1' || v === 'square') return '1024x1024';
      if (v.includes('1280x720')) return '1792x1024';
      if (v.includes('720x1280')) return '1024x1792';
      if (v.includes('1024x1024')) return '1024x1024';
      if (v.includes('1792x1024')) return '1792x1024';
      if (v.includes('1024x1792')) return '1024x1792';
      return '1024x1024';
    };

    size = normalizeSize(size);

    const ALLOWED = new Set(['1024x1024', '1792x1024', '1024x1792']);
    if (!ALLOWED.has(size)) size = '1024x1024';

    // Call OpenAI
    const result = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      size
    });

    const url = result?.data?.[0]?.url;
    if (!url) {
      return res.status(502).json({ error: 'No image URL returned from OpenAI' });
    }

    return res.json({ url, size });
  } catch (err) {
    console.error('AI generation error:', err?.response?.data || err);
    const message =
      err?.response?.data?.error?.message ||
      err?.message ||
      'Image generation failed';
    return res.status(500).json({ error: message });
  }
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`DreamCanvas API running on port ${PORT}`);
});
