// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

/**
 * IMPORTANT: Set OPENAI_API_KEY in Render -> Environment
 */
if (!process.env.OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY environment variable.');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Simple health endpoint so Render and you can verify it's up.
 */
app.get('/health', (_req, res) => {
  res.json({ ok: true, name: 'DreamCanvas API', time: new Date().toISOString() });
});

/**
 * Generate image
 * Body: { prompt: string, aspect?: "16:9" | "9:16" }
 *
 * Note: gpt-image-1 supports fixed sizes (e.g., 1024x1024). To avoid
 * "invalid size" errors, we always request 1024x1024 and let the
 * frontend crop/fit if it wants a 16:9/9:16 wallpaper.
 */
app.post('/ai/generate', async (req, res) => {
  try {
    const { prompt, aspect } = req.body || {};

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Missing or invalid "prompt".' });
    }

    // Optional: log aspect for debugging; not used to size the request
    const requestedAspect = aspect === '16:9' || aspect === '9:16' ? aspect : '1:1';

    // Request a safe, valid size
    const size = '1024x1024';

    const result = await openai.images.generate({
      model: 'gpt-image-1',
      prompt: prompt.trim(),
      size,
      n: 1,
      // Return base64 so we can send a data URL back (no external hosting needed)
      response_format: 'b64_json',
    });

    const data = result?.data?.[0];
    if (!data?.b64_json) {
      return res.status(502).json({ error: 'No image returned from OpenAI.' });
    }

    // Data URL that your frontend can put directly in an <img src="...">
    const imageUrl = `data:image/png;base64,${data.b64_json}`;

    res.json({
      imageUrl,
      meta: {
        sizeRequested: size,
        aspectRequested: requestedAspect,
        model: 'gpt-image-1',
      },
    });
  } catch (err) {
    // Try to surface a helpful error message
    const message =
      err?.response?.data?.error?.message ||
      err?.message ||
      'Image generation failed.';
    console.error('AI generation error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * Render uses PORT it injects; fall back locally if needed.
 * If your Render dashboard shows a different internal port, keep using process.env.PORT.
 */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`DreamCanvas API running on port ${PORT}`);
});
