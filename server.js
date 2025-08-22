// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// simple health check so you can test the service is up
app.get('/health', (req, res) => res.json({ ok: true }));

// only allow sizes you support
const ALLOWED_SIZES = new Set(['1024x1024', '1080x1920']);

app.post('/ai/generate', async (req, res) => {
  try {
    const { prompt, size = '1280x720' } = req.body || {};

    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt' });
    }
    if (!ALLOWED_SIZES.has(size)) {
      return res.status(400).json({ error: 'Invalid size' });
    }

    const result = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      size,
      n: 1,
    });
// --- add these two routes ---
app.get('/', (req, res) => {
  res.send('DreamCanvas backend is alive ✅');
});

app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});
// --- end add ---
    const url = result.data[0].url;
    return res.json({ url });
  } catch (err) {
    console.error('AI generation error:', err);
    return res.status(500).json({
      error: 'AI generation failed',
      details: err.message,
    });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`DreamCanvas server running on port ${PORT}`));
