require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// quick health check
app.get('/health', (_, res) => res.json({ ok: true }));

// allow root hit to not 404
app.get('/', (_, res) => res.send('DreamCanvas API is running. POST /ai/generate'));

app.post('/ai/generate', async (req, res) => {
  try {
    // Accept multiple possible keys; default size if not provided
    let prompt =
      (req.body && (req.body.prompt || req.body.description || req.body.text)) || '';
    let size = (req.body && req.body.size) || '1024x1024';

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    // Only allow sizes OpenAI supports
    const ALLOWED_SIZES = new Set(['1024x1024', '1792x1024', '1024x1792']);
    if (!ALLOWED_SIZES.has(size)) {
      // fallback instead of hard failing
      size = '1024x1024';
    }

    // Generate image
    const result = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      size,
      // n: 1 // default is 1; uncomment if you like being explicit
    });

    // The SDK returns b64_json OR url depending on params.
    // By default we get a URL; normalize the response shape:
    const data = result.data?.[0];
    if (!data) {
      return res.status(502).json({ error: 'No image returned from OpenAI' });
    }

    const payload = data.url
      ? { url: data.url, size }
      : data.b64_json
      ? { b64: data.b64_json, size }
      : null;

    if (!payload) {
      return res.status(502).json({ error: 'Unexpected image payload from OpenAI' });
    }

    res.json(payload);
  } catch (err) {
    console.error('AI generation error:', err?.response?.data || err);
    const msg =
      err?.response?.data?.error?.message ||
      err?.message ||
      'Image generation failed';
    res.status(500).json({ error: msg });
  }
});

// use Render's assigned port
const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`DreamCanvas API server running on port ${PORT}`);
});DreamCanvas server running on port ${PORT}`));
