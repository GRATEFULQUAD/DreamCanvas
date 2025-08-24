// server.js — DreamCanvas (ModelsLab v6) — CommonJS, single listener

require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Node 18+ has global fetch
const app = express();

/* ---------- CONFIG (from .env) ---------- */
const PORT        = process.env.PORT || 10000; // Render injects PORT automatically
const API_KEY     = (process.env.MODELSLAB_API_KEY || '').trim();
const MODEL       = (process.env.MODELSLAB_MODEL || 'realistic-vision-v5.1').trim();
const PROVIDER    = (process.env.PROVIDER || 'modelslab').trim();
const PAYPAL_URL  = (process.env.PAYPAL_FULL_URL || '').trim();
const ENDPOINT    = (process.env.MODELSLAB_ENDPOINT || 'https://modelslab.com/api/v6/realtime/text2img').trim();

/* ---------- MIDDLEWARE ---------- */
app.use(express.json({ limit: '1mb' }));
app.use(cors({
  origin(origin, cb) {
    const allow = [
      'https://dreamcanvas-fxui.onrender.com',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ];
    if (!origin) return cb(null, true);
    cb(null, allow.includes(origin));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

/* ---------- HELPERS ---------- */
function dimsFromAspect(aspect = '16:9') {
  const a = String(aspect).replace('x', ':').trim();
  if (a === '9:16')  return { width: 720,  height: 1280 };
  if (a === '16:9')  return { width: 1280, height: 720  };
  return { width: 1024, height: 1024 }; // square fallback
}

const STYLE_GUIDES = {
  realistic: 'photorealistic, natural lighting, sharp details, true-to-life colors, shallow depth of field',
  cyberpunk: 'neon-lit cyberpunk city, holograms, rain, bokeh, high-contrast teal & magenta, gritty future tech',
  anime:     'anime illustration, cel shading, vibrant colors, expressive eyes, clean lineart, studio-quality',
  comic:     'American comic-book style, bold ink outlines, halftone dots, dynamic pose, dramatic lighting',
  watercolor:'watercolor painting, soft bleeding pigments, textured paper, gentle gradients, light outlines',
  oil:       'oil painting on canvas, impasto brush strokes, rich color blends, gallery lighting',
  pixel:     '16-bit pixel art, limited palette, crisp pixels, retro game aesthetic, side-lighting',
  lowpoly:   'low-poly 3D render, flat facets, minimal textures, strong rim light',
  concept:   'cinematic concept art, dramatic composition, volumetric light, ultra-detailed environment',
};

function buildStyledPrompt(prompt, styleKey) {
  const guide = STYLE_GUIDES[(styleKey || '').toLowerCase()];
  return guide ? `${guide}. ${prompt}` : prompt;
}

/* ---------- HEALTH ---------- */
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    provider: PROVIDER,
    hasKey: Boolean(API_KEY),
    model: MODEL,
    endpoint: ENDPOINT,
    donate: PAYPAL_URL || undefined,
    donateMessage: PAYPAL_URL
      ? "You do NOT need to — but if you’d like to help with costs (and I’ll be your best friend 💜), you can donate to my Picture Fund. It is in no way required to get pictures — it’s just my way of saying YOU ARE AWESOME."
      : undefined,
    time: new Date().toISOString(),
  });
});

/* ---------- GENERATE ---------- */
app.post('/ai/generate', async (req, res) => {
  try {
    if (!API_KEY) return res.status(401).json({ error: 'Missing MODELSLAB_API_KEY' });

    const {
      prompt = '',
      style  = 'realistic',  // "realistic" | "cyberpunk" | "anime" | ...
      aspect = '16:9',       // "16:9" | "9:16"
      seed,                  // optional
      steps = 28,
      guidance = 7
    } = req.body || {};

    if (!prompt.trim()) return res.status(400).json({ error: 'Missing prompt' });

    const finalPrompt = buildStyledPrompt(prompt.trim(), style);
    const { width, height } = dimsFromAspect(aspect);

    const body = {
      key: API_KEY,                 // ModelsLab accepts key in body
      model: MODEL,
      model_id: MODEL,
      prompt: finalPrompt,
      width,
      height,
      samples: 1,
      steps,
      guidance_scale: guidance,
      safety_checker: false,
      output_format: 'url',
      ...(seed ? { seed } : {}),
    };

    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // harmless to include; some setups read header too
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const raw = await resp.text();
    let data = {};
    try { data = JSON.parse(raw); } catch {}

    if (!resp.ok) {
      return res.status(resp.status).json({ error: 'ModelsLab error', rawPreview: raw });
    }

    const imageUrl =
      data?.imageUrl ||
      data?.url ||
      (Array.isArray(data?.output) && data.output[0]) ||
      (Array.isArray(data?.images) && (data.images[0]?.url || data.images[0])) ||
      (Array.isArray(data?.data) && (data.data[0]?.url || data.data[0])) ||
      null;

    if (!imageUrl) {
      return res.status(500).json({ error: 'ModelsLab returned no image URL', rawPreview: raw });
    }

    res.json({ imageUrl, aspect, style, seed: data?.seed ?? seed ?? null });
  } catch (err) {
    console.error('[Generate] error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

/* ---------- BOOT (single listener) ---------- */
app.listen(PORT, () => {
  console.log(`[Boot] DreamCanvas server up on :${PORT}`);
});
