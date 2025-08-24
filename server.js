// server.js — DreamCanvas (ModelsLab v6, style-driven)
require("dotenv").config();
const express = require("express");
const cors = require("cors");

// ---------- Config ----------
const PORT = process.env.PORT || 10000;
const MODELSLAB_API_KEY = (process.env.MODELSLAB_API_KEY || "").trim();
// You can change default model in Render env later, e.g. "realistic-vision-v5.1"
const DEFAULT_MODEL = (process.env.MODELSLAB_MODEL || "realistic-vision-v5.1").trim();

// ---------- CORS (allow your app origins) ----------
const ALLOW = new Set([
  "https://dreamcanvas-fxui.onrender.com", // your Base44 app URL
  "http://localhost:3000",
  "http://localhost:5173",
]);
const app = express();
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    cb(null, ALLOW.has(origin));
  },
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
}));
app.use(express.json({ limit: "1mb" }));

// ---------- Helpers ----------
function dimsFromAspect(aspect = "16:9") {
  const a = String(aspect).replace("x", ":").trim();
  if (a === "9:16")  return { width: 768,  height: 1344 };
  if (a === "16:9")  return { width: 1344, height: 768  };
  return { width: 1024, height: 1024 };
}

// One source of truth for style prompts (backend composes)
const STYLE_MAP = {
  realistic: {
    prefix:  "photorealistic, natural lighting, detailed textures, depth of field",
    negative:"cartoon, comic, pop art, plastic 3d, low detail, watermark, text, logo",
    cfg: 6.0,
  },
  cyberpunk: {
    prefix:  "neon cyberpunk, rainy night, reflective puddles, holograms, volumetric fog, teal-magenta rim lighting",
    negative:"pastel cute, watercolor bleed, medieval, pop art dots, plastic 3d",
    cfg: 8.0,
  },
  anime: {
    prefix:  "ANIME style, clean line art, cel shading, big expressive eyes, flat vibrant colors",
    negative:"photoreal pores, film grain, plastic 3d render, pop art dots",
    cfg: 8.6,
  },
  comic: {
    prefix:  "COMIC BOOK style, bold inked outlines, halftone shading, dynamic composition, screen-tone texture",
    negative:"photoreal, glossy 3d, watercolor bleed",
    cfg: 8.6,
  },
  watercolor: {
    prefix:  "WATERCOLOR painting, soft bleeding edges, paper texture, pastel palette, hand-painted feel",
    negative:"photoreal plastic sheen, halftone comic dots, pixel art",
    cfg: 7.5,
  },
  "digital-art": {
    prefix:  "digital concept art, dramatic studio lighting, subsurface glow, high contrast",
    negative:"grainy, washed out, watercolor bleed, comic halftone",
    cfg: 7.5,
  },
  pixel: {
    prefix:  "PIXEL ART, crisp 1px edges, limited retro palette, subtle dithering, 16-bit aesthetic",
    negative:"photoreal, smooth gradients, watercolor bleed, glossy 3d plastic",
    cfg: 9.2,
  },
};
function pickStyle(style) {
  const key = String(style || "").toLowerCase();
  return STYLE_MAP[key] || STYLE_MAP.realistic;
}

// ---------- Health ----------
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    provider: "modelslab",
    hasKey: Boolean(MODELSLAB_API_KEY),
    model: DEFAULT_MODEL,
    time: new Date().toISOString(),
  });
});

// ---------- Generate ----------
app.post("/ai/generate", async (req, res) => {
  try {
    if (!MODELSLAB_API_KEY) return res.status(401).json({ error: "Missing MODELSLAB_API_KEY" });

    const { prompt = "", aspect = "16:9", style = "realistic", seed } = req.body || {};
    if (!prompt.trim()) return res.status(400).json({ error: "Missing prompt" });

    const { width, height } = dimsFromAspect(aspect);
    const S = pickStyle(style);

    const finalPrompt = `${S.prefix}. ${prompt.trim()}`.trim();
    const negative    = S.negative || "";
    const cfg         = typeof S.cfg === "number" ? S.cfg : 7.0;

    // Debug line so you can see what was sent
    console.log("[ai] gen", {
      aspect, style, cfg, width, height,
      promptPreview: finalPrompt.slice(0, 120),
      seed: seed ?? "new",
    });

    const body = {
      key: MODELSLAB_API_KEY,
      model: DEFAULT_MODEL,
      model_id: DEFAULT_MODEL,
      prompt: finalPrompt,
      negative_prompt: negative,
      width, height,
      samples: 1,
      steps: 32,
      guidance_scale: cfg,
      safety_checker: false,
      output_format: "url",
      ...(seed ? { seed } : {}),
    };

    // Node 18+ has global fetch on Render
    const resp = await fetch("https://modelslab.com/api/v6/realtime/text2img", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MODELSLAB_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    let data = {};
    try { data = JSON.parse(text); } catch {}

    if (!resp.ok) {
      return res.status(resp.status).json({ error: "ModelsLab error", rawPreview: text });
    }

    const imageUrl =
      data?.imageUrl ||
      data?.url ||
      (Array.isArray(data?.output) && data.output[0]) ||
      (Array.isArray(data?.images) && (data.images[0]?.url || data.images[0])) ||
      (Array.isArray(data?.data) && (data.data[0]?.url || data.data[0])) ||
      null;

    if (!imageUrl) {
      return res.status(500).json({ error: "ModelsLab returned no image URL", rawPreview: text });
    }

    const usedSeed = data?.seed ?? seed ?? Math.floor(Math.random() * 1e9);
    res.json({ imageUrl, aspect, style, seed: usedSeed });
  } catch (err) {
    console.error("Generate error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// ---------- Boot ----------
app.listen(PORT, () => {
  console.log(`[Boot] DreamCanvas (ModelsLab) running on :${PORT}`);
});
