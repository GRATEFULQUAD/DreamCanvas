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

app.post('/ai/generate', async (req, res) => {
  try {
    const result = await openai.images.generate({
  model: "gpt-image-1",
  prompt,
  size: "1280x720", // cheaper HD resolution
  n: 1 // only 1 image to save cost
});
    res.json({ url: result.data[0].url });
// --- Save a copy to Google Drive folder ---
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const fs = require('fs');
const path = require('path');

const gDriveBase = "G:/THE CASTLE/My Drive/DEAMCANVAS";
if (!fs.existsSync(gDriveBase)) fs.mkdirSync(gDriveBase, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const filePath = path.join(gDriveBase, `wallpaper-${timestamp}.png`);

const resp = await fetch(url);
const buf = Buffer.from(await resp.arrayBuffer());
fs.writeFileSync(filePath, buf);
  } catch (error) {
    console.error("AI generation error:", error);
    res.status(500).json({ error: "Failed to generate image" });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`DreamCanvas server running on http://localhost:${PORT}`);
});
