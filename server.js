// server.js — CommonJS, ModelsLab v6, CORS, aspect fix, health
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();

// --- CORS: allow your app + local dev
const ALLOW_ORIGINS = [
  "https://dreamcanvas-fxui.onrender.com",
  "http://localhost:3000",
];
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    cb(null, ALLOW_ORIGINS.includes(origin));
  },
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
}));
app.use(express.json({ limit: "1mb" }));

// --- ENV
const PORT = process.env.PORT || 10000;
const MODELSLAB_API_KEY = (process.env.MODELSLAB_API_KEY || "").trim();
const MODEL = (process.env.MODELSLAB_MODEL || "realistic-vision-v5.1").trim();

// --- helpers
function dimsFromAspect(aspect = "16:9") {
  const a = String(aspect).replace("x", ":").trim();
  if (a === "9:16")  return { width: 720,  height: 1280 }; // portrait
  if (a === "16:9")  return { width: 1280, height: 720  }; // landscape
  return { width: 1024, height: 1024 };                    // fallback square
}

// --- health
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    provider: "modelslab",
    hasKey: Boolean(MODELSLAB_API_KEY),
    model: MODEL,
    donate: process.env.PAYPAL_FULL_URL || "https://paypal.me/tomkumaton?locale.x=en_US&country.x=US",
    donateMessage:
      "You do NOT need to — but if you’d like to help with costs (plus I’ll be your best friend 💜), you can donate to my Picture Fund. It is in no way required to get pictures — it’s just my way of saying YOU ARE AWESOME.",
    time: new Date().toISOString(),
  });
});

// --- generate
app.post("/ai/generate", async (req, res) => {
  try {
    const { prompt = "", aspect = "16:9" } = req.body || {};
    if (!MODELSLAB_API_KEY) return res.status(401).json({ error: "Missing MODELSLAB_API_KEY" });
    if (!prompt.trim())     return res.status(400).json({ error: "Missing prompt" });

    const { width, height } = dimsFromAspect(aspect);

    const body = {
      prompt: prompt.trim(),
      model: MODEL,
      model_id: MODEL,          // some accounts read model_id
      width,
      height,
      samples: 1,
      steps: 28,
      guidance_scale: 7,
      safety_checker: false,
      output_format: "url"
    };

    const resp = await fetch("https://modelslab.com/api/v6/realtime/text2img", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MODELSLAB_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    let data = {};
    try { data = JSON.parse(text); } catch {}

    if (!resp.ok) {
      return res.status(resp.status).json({ error: "ModelsLab error", rawPreview: text });
    }

    // normalize URL
    let imageUrl =
      data?.imageUrl ||
      data?.url ||
      (Array.isArray(data?.output) && data.output[0]) ||
      (Array.isArray(data?.images) && (data.images[0]?.url || data.images[0])) ||
      (Array.isArray(data?.data) && (data.data[0]?.url || data.data[0])) ||
      null;

    if (!imageUrl) {
      return res.status(500).json({ error: "ModelsLab returned no image URL", rawPreview: text });
    }

    res.json({ imageUrl, aspect });
  } catch (err) {
    console.error("Generate error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// --- boot
app.listen(PORT, () => {
  console.log(`[Boot] DreamCanvas (ModelsLab) on :${PORT}`);
});
