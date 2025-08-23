// server.js  — DreamCanvas (ModelsLab) + History (last 10)
require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ------------------- ENV -------------------
const PORT = process.env.PORT || 10000;
const PROVIDER = (process.env.PROVIDER || "modelslab").toLowerCase();

// ModelsLab config
const MODELSLAB_API_KEY = process.env.MODELSLAB_API_KEY || "";
// ModelsLab’s image endpoint. (We keep it overrideable via env just in case.)
const MODELSLAB_URL =
  process.env.MODELSLAB_URL || "https://modelslab.com/api/v1/image";

// default model (you can override via env MODEL_NAME)
const MODEL_NAME = process.env.MODEL_NAME || "realistic-vision-v5.1";

// ------------------- HISTORY (rolling last 10) -------------------
const history = []; // [{ url, time }]
function pushHistory(url) {
  if (!url) return;
  history.unshift({ url, time: new Date().toISOString() });
  if (history.length > 10) history.pop();
}
app.get("/ai/history", (req, res) => {
  res.json({ history });
});

// ------------------- HELPERS -------------------
function sizeFromAspect(aspect = "16:9") {
  // simple HD pair; adjust if you change your buttons
  if (aspect === "9:16") return { width: 720, height: 1280 };
  return { width: 1280, height: 720 };
}

function pickUrl(obj) {
  // Try several common response shapes to find a URL
  if (!obj || typeof obj !== "object") return null;

  if (typeof obj.image === "string") return obj.image;
  if (typeof obj.url === "string") return obj.url;

  if (Array.isArray(obj.output) && obj.output[0]) {
    if (typeof obj.output[0] === "string") return obj.output[0];
    if (typeof obj.output[0].url === "string") return obj.output[0].url;
  }
  if (Array.isArray(obj.data) && obj.data[0]) {
    if (typeof obj.data[0] === "string") return obj.data[0];
    if (typeof obj.data[0].url === "string") return obj.data[0].url;
  }
  if (obj.result && typeof obj.result === "string") return obj.result;

  return null;
}

// ------------------- HEALTH / WHOAMI -------------------
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    provider: PROVIDER,
    hasKey: Boolean(MODELSLAB_API_KEY),
    model: MODEL_NAME,
    time: new Date().toISOString(),
  });
});

// Simple “whoami” stub (ModelsLab doesn’t expose an account whoami)
app.get("/whoami", (req, res) => {
  res.json({
    ok: true,
    provider: PROVIDER,
    msg: "ModelsLab whoami not available; key presence only",
    hasKey: Boolean(MODELSLAB_API_KEY),
    time: new Date().toISOString(),
  });
});

// ------------------- GENERATE -------------------
app.post("/ai/generate", async (req, res) => {
  try {
    if (PROVIDER !== "modelslab") {
      return res.status(400).json({ error: "PROVIDER must be 'modelslab'" });
    }
    if (!MODELSLAB_API_KEY) {
      return res.status(401).json({ error: "Missing MODELSLAB_API_KEY" });
    }

    const prompt = (req.body?.prompt || "").trim();
    const aspect = (req.body?.aspect || "16:9").trim();

    if (!prompt) {
      return res.status(400).json({ error: "Please provide a prompt." });
    }

    const { width, height } = sizeFromAspect(aspect);

    // ModelsLab expects JSON. Typical fields:
    // key, prompt, width, height, model_id (or model)
    const payload = {
      key: MODELSLAB_API_KEY,
      prompt,
      width,
      height,
      model_id: MODEL_NAME, // leave as-is; some accounts expect `model_id`
      // If your account needs "model" instead, uncomment the next line:
      // model: MODEL_NAME,
      // Extra hints (optional):
      // samples: 1,
      // safety_checker: false,
      // enhance_prompt: true,
    };

    const resp = await fetch(MODELSLAB_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const txt = await resp.text();
    let data = {};
    try {
      data = JSON.parse(txt);
    } catch (_) {
      // not JSON
    }

    if (!resp.ok) {
      // Surface provider error message if present
      const providerMsg =
        (data && (data.message || data.error)) || txt || "request failed";
      return res
        .status(resp.status)
        .json({ error: `ModelsLab ${resp.status}: ${providerMsg}` });
    }

    const imageUrl = pickUrl(data);
    if (!imageUrl) {
      return res.status(500).json({
        error: "ModelsLab returned no image URL",
        rawPreview: txt?.slice(0, 500),
      });
    }

    // Add to rolling history
    pushHistory(imageUrl);

    return res.json({ imageUrl, aspect });
  } catch (err) {
    console.error("Generate error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
});

// ------------------- ROOT -------------------
app.get("/", (req, res) => {
  res.send(
    `<pre>DreamCanvas server (ModelsLab)\n\nEndpoints:\n  GET  /health\n  GET  /whoami\n  GET  /ai/history\n  POST /ai/generate  { prompt, aspect: "16:9" | "9:16" }\n</pre>`
  );
});

// ------------------- START -------------------
app.listen(PORT, () => {
  console.log(`[Boot] DreamCanvas (ModelsLab) running on port ${PORT}`);
});
