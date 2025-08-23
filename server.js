// server.js — DreamCanvas backend (ModelsLab)
// -------------------------------------------

require("dotenv").config();
const express = require("express");
const cors = require("cors");

// Node 18+ has global fetch. If not available, uncomment this:
// const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ---------- Config (env + sane defaults) ----------
const PORT = process.env.PORT || 10000;

const PROVIDER = (process.env.PROVIDER || "modelslab").toLowerCase();
const MODELSLAB_BASE = process.env.MODELSLAB_BASE || "https://modelslab.com";
const MODELSLAB_API_KEY = process.env.MODELSLAB_API_KEY || "";
const MODEL = process.env.MODELSLAB_MODEL || "realistic-vision-v5.1";

// Free tier per-user limit (by day), soft block
const FREE_PER_USER = parseInt(process.env.FREE_PER_USER || "2", 10);
const CASHTAG = (process.env.CASHTAG || "").replace(/^\$/, "");

// ---------- Tiny in-memory quota (resets when dyno restarts) ----------
const counters = new Map(); // key -> { count, day }

function userKey(req) {
  // Prefer an app user id if you send one; fallback to IP
  const uid =
    req.headers["x-user-id"] ||
    req.headers["x-base44-userid"] ||
    req.headers["x-client-id"] ||
    "";
  const ip =
    (req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim() ||
    req.ip ||
    "unknown";
  return uid || ip;
}

function checkQuota(req) {
  const key = userKey(req);
  const today = new Date().toISOString().slice(0, 10);
  let row = counters.get(key);
  if (!row || row.day !== today) row = { count: 0, day: today };
  if (row.count >= FREE_PER_USER) {
    return { ok: false, key, row };
  }
  counters.set(key, row); // store baseline
  return { ok: true, key, row };
}

function bumpQuota(key) {
  const today = new Date().toISOString().slice(0, 10);
  const row = counters.get(key) || { count: 0, day: today };
  if (row.day !== today) {
    row.count = 0;
    row.day = today;
  }
  row.count += 1;
  counters.set(key, row);
  return row.count;
}

// ---------- Helpers ----------
function pickSize(aspect = "16:9") {
  const a = String(aspect).trim();
  if (a === "9:16" || a === "portrait") {
    return { width: 1080, height: 1920, aspect: "9:16" };
  }
  // default landscape
  return { width: 1920, height: 1080, aspect: "16:9" };
}

function extractUrl(payload) {
  // ModelsLab has returned URLs in a few shapes across plans. Try them all.
  if (!payload) return null;

  // Common patterns
  if (typeof payload === "string" && /^https?:\/\//i.test(payload)) return payload;

  if (payload.imageUrl && /^https?:\/\//i.test(payload.imageUrl)) return payload.imageUrl;
  if (payload.url && /^https?:\/\//i.test(payload.url)) return payload.url;

  // Some responses: { output: ["https://..."] } or { images:["..."] }
  if (Array.isArray(payload.output) && payload.output[0]) return payload.output[0];
  if (Array.isArray(payload.images) && payload.images[0]) return payload.images[0];

  // Nested
  if (payload.data && Array.isArray(payload.data) && payload.data[0]) {
    const first = payload.data[0];
    if (typeof first === "string" && /^https?:\/\//i.test(first)) return first;
    if (first && first.url && /^https?:\/\//i.test(first.url)) return first.url;
  }

  return null;
}

// ---------- Health ----------
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    provider: PROVIDER,
    time: new Date().toISOString(),
    hasKey: !!MODELSLAB_API_KEY,
    model: MODEL,
  });
});

// Friendly root
app.get("/", (req, res) => {
  res.type("text").send(
    "DreamCanvas server is up. Try GET /health or POST /ai/generate"
  );
});

// ---------- MAIN: Generate ----------
app.post("/ai/generate", async (req, res) => {
  try {
    // Soft free limit
    const gate = checkQuota(req);
    if (!gate.ok) {
      return res.status(429).json({
        error: `Free limit reached (${FREE_PER_USER}/day). Please come back tomorrow.`,
        donate: CASHTAG ? `https://cash.app/$${CASHTAG}` : undefined,
      });
    }

    const prompt = (req.body?.prompt || "").trim();
    const aspect = (req.body?.aspect || "16:9").trim();

    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }
    if (!MODELSLAB_API_KEY) {
      return res.status(500).json({ error: "MODELSLAB_API_KEY missing" });
    }

    const { width, height } = pickSize(aspect);

    // ModelsLab Text-to-Image (JSON). Endpoint differs by plan; this one matches
    // what worked for you previously (and we handle shape flexibly on parse).
    const url = `${MODELSLAB_BASE.replace(/\/+$/,"")}/api/v1/image`;
    const body = {
      key: MODELSLAB_API_KEY,
      prompt,
      width,
      height,
      // tuned for wallpapers & cost control
      samples: 1,
      steps: 30,
      guidance_scale: 7,
      safety_checker: false,
      enhance_prompt: true,
      // if your plan supports it:
      lora_strength: 0,
      negative_prompt:
        "low quality, blurry, distorted, deformed, extra limbs, text, watermark",
      output_format: "jpg",
      model_id: MODEL, // many ModelsLab endpoints accept model_id
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const preview = await resp.text(); // for debugging odd shapes
    let data = {};
    try { data = JSON.parse(preview); } catch (_) {}

    if (!resp.ok) {
      // Some error shapes: { status:'error', message:'...' }
      const msg = data?.message || data?.error || preview || `HTTP ${resp.status}`;
      return res.status(502).json({ error: msg, rawPreview: preview });
    }

    const imageUrl = extractUrl(data) || extractUrl(data?.data);
    if (!imageUrl) {
      return res
        .status(502)
        .json({ error: "ModelsLab returned no image URL", rawPreview: preview });
    }

    bumpQuota(gate.key);
    return res.json({ imageUrl, aspect });
  } catch (err) {
    console.error("[/ai/generate] error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`[Boot] DreamCanvas (ModelsLab) running on port ${PORT}`);
});
