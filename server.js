require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Image generation route
app.post('/ai/generate', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1280x720", // HD resolution
      n: 1,
    });

    res.json({ url: result.data[0].url });
  } catch (error) {
    console.error("AI generation error:", error);
    res.status(500).json({ error: "Image generation failed" });
  }
});

// Start server
const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`🚀 DreamCanvas AI server running on port ${PORT}`);
});
