// server.js — DreamCanvas + ModelsLab v6 (strong style mapping)
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();

// --- CORS setup ---
const ALLOW_ORIGINS = [
  "https://dreamcanvas-fxui.onrender.com",
  "http://localhost:3000",
];
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      cb(null, ALLOW_ORIGINS.includes(origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "1mb" }));

// --- ENV setup ---
const PORT = process.env.PORT || 10000;
const MODELSLAB_API_KEY = (process.env.MODELSLAB_API_KEY || "").trim();
const DEFAULT_MODEL = (process.env.MODELSLAB_MODEL || "realistic-vision-v5.1").trim();

// --- helper: aspect -> width/height ---
function dimsFromAspect(aspect = "16:9") {
  const a = String(aspect).replace("x", ":").trim();
  if (a === "9:16") return { width: 768, height: 1344 };     // a bit taller to show detail
  if (a === "16:9") return { width: 1344, height: 768 };     // a bit wider to show detail
  return { width: 1024, height: 1024 };
}

// --- strong, distinct looks per style ---
const STYLE_MAP = {
  realistic: {
    prefix:
      "photorealistic, natural lighting, DSLR bokeh, detailed textures, 35mm lens, high dynamic range",
    negative:
      "cartoon, anime, flat shading, low detail, extra limbs, blurry, watermark, text, logo",
    // model: "realistic-vision-v5.1",
  },
  cyberpunk: {
    prefix:
      "CYBERPUNK neon city, holograms, rain-soaked streets, reflective puddles, volumetric fog, rim lighting, teal–magenta palette, chromatic aberration, synthwave",
    negative: "daylight countryside, pastel cute, medieval, flat colors",
    // model: "sdxl-cyberpunk",
  },
  anime: {
    prefix:
      "ANIME style, clean line art, cel shading, big expressive eyes, flat vibrant colors, studio key art",
    negative: "photoreal, film grain, gritty pores, harsh realism",
    // model: "anything-v5",
  },
  comic: {
    prefix:
      "COMIC BOOK style, bold inked outlines, halftone dots, dynamic composition, dramatic shadows, screen-tone texture",
    negative: "photoreal, glossy cg render, lifelike skin pores",
    // model: "sdxl-illustration",
  },
  watercolor: {
    prefix:
      "WATERCOLOR painting, soft bleeding edges, paper texture, pastel palette, hand-painted feel",
    negative: "hard pixels, plastic sheen, ultra sharp, photoreal",
    // model: "dreamshaper-8",
  },
  "digital-art": {
    prefix:
      "digital art, glossy surfaces, dramatic studio lighting, subsurface glow, high contrast",
    negative: "grainy, muddy colors, washed out",
    // model: "dreamshaper-8",
  },
  pixel: {
    prefix:
      "PIXEL ART, crisp 1px edges, limited retro palette, 16-bit game sprite look, subtle dithering",
    negative: "smooth gradients, photoreal, painterly soft edges",
    // model: "pixel-art",
  },
};

function pickStyle(style) {
  const key = String(style || "").toLowerCase();
  return STYLE_MAP[key] || STYLE_MAP.realistic;
}

// --- health check ---
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    provider: "modelslab",
    hasKey: Boolean(MODELSLAB_API_KEY),
    model: DEFAULT_MODEL,
    donate:
      process.env.PAYPAL_FULL_URL ||
      "https://paypal.me/tomkumaton?locale.x=en_US&country.x=US",
    donateMessage:
      "You do NOT need to — but if you’d like to help with costs (and I’ll be your best friend 💜), you can donate to my Picture Fund. It is in no way required to get pictures — it’s just my way of saying YOU ARE AWESOME.",
    time: new Date().toISOString(),
  });
});

// (optional) styles list for the UI
app.get("/styles", (req, res) => {
  res.json({
    styles: Object.keys(STYLE_MAP),
  });
});

// --- image generation ---
app.post("/ai/generate", async (req, res) => {
  try {
    const { prompt = "", aspect = "16:9", style = "realistic", seed } = req.body || {};
    if (!MODELSLAB_API_KEY) return res.status(401).json({ error: "Missing MODELSLAB_API_KEY" });
    if (!prompt.trim()) return res.status(400).json({ error: "Missing prompt" });

    const { width, height } = dimsFromAspect(aspect);
    const s = pickStyle(style);

    const fullPrompt = `${s.prefix}. ${prompt}`.trim();
    const negative = s.negative || "";

    // If you know ModelsLab accepts a model selector, you can pass it.
    // Otherwise we keep DEFAULT_MODEL which you set in Render env.
    const modelToUse = DEFAULT_MODEL; // or s.model || DEFAULT_MODEL;

    // Build payload for ModelsLab v6
    const payload = {
      key: MODELSLAB_API_KEY,           // body key
      model: modelToUse,
      model_id: modelToUse,             // some endpoints require model_id
      prompt: fullPrompt,
      negative_prompt: negative,
      width,
      height,
      samples: 1,
      steps: 28,
      guidance_scale: 7.5,
      safety_checker: false,
      output_format: "url",
      // if their API supports fixed seeds, uncomment to make style tests repeatable:
      // seed: typeof seed === "number" ? seed : undefined,
    };

    const resp = await fetch("https://modelslab.com/api/v6/realtime/text2img", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // also include header auth (harmless if not required)
        Authorization: `Bearer ${MODELSLAB_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {}

    if (!resp.ok) {
      return res.status(resp.status).json({ error: "ModelsLab error", rawPreview: text });
    }

    // try common shapes for url arrays
    let imageUrl =
      data?.imageUrl ||
      data?.url ||
      (Array.isArray(data?.output) && data.output[0]) ||
      (Array.isArray(data?.images) && (data.images[0]?.url || data.images[0])) ||
      (Array.isArray(data?.data) && (data.data[0]?.url || data.data[0])) ||
      null;

    if (!imageUrl) {
      return res
        .status(500)
        .json({ error: "ModelsLab returned no image URL", rawPreview: text });
    }

    res.json({ imageUrl, aspect, style });
  } catch (err) {
    console.error("Generate error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// --- boot server ---
app.listen(PORT, () => {
  console.log(`[Boot] DreamCanvas (ModelsLab) running on :${PORT}`);
});
