require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// AI image generation endpoint
app.post('/ai/generate', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      n: 1
    });

    res.json({ url: result.data[0].url });
  } catch (err) {
    console.error("AI generation error:", err);
    res.status(500).json({ error: "Image generation failed" });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`DreamCanvas backend running on port ${PORT}`));
