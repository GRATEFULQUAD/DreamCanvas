// server.js — DreamCanvas (ModelsLab) + History + Free Limit + PayPal (forced URL)
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ------------------- ENV -------------------
const PORT = process.env.PORT || 10000;
const PROVIDER = "modelslab";

const MODELSLAB_API_KEY = (process.env.MODELSLAB_API_KEY || "").trim();
const MODEL_NAME = (process.env.MODEL_NAME || "realistic-vision-v5.1").trim();

// Guard against placeholder / bad URLs; provide a sane default
let MODELSLAB_URL = (process.env.MODELSLAB_URL || "").trim();
if (!MODELSLAB_URL || MODELSLAB_URL.includes("<") || !/^https?:\/\//.test(MODELSLAB_URL)) {
  MODELSLAB_URL = "https://modelslab.com/api/v6/realtime/text2img";
}

const FREE_PER_USER = parseInt(process.env.FREE_PER_USER || "2", 10);

// PayPal (forced single URL)
const PAYPAL_USERNAME = (process.env.PAYPAL_USERNAME || "").trim();
const PAYPAL_FULL_URL = (process.env.PAYPAL_FULL_URL || "").trim();
const PAYPAL_BASE = PAYPAL_FULL_URL ||
  (PAYPAL_USERNAME ? `https://paypal.me/${encodeURIComponent(PAYPAL_USERNAME)}` : "");

// ------------------- SIMPLE QUOTA (soft, per day, in-memory) -------------------
const counters = new Map(); // key -> { count, day }
function userKey(req) {
  const uid =
    req.headers["x-user-id"] ||
    req.headers["x-base44-userid"] ||
    req.headers["x-client-id"] ||
    "";
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.ip ||
    "unknown";
  return uid || ip;
}
function checkQuota(req) {
  const key = userKey(req);
  const today = new Date().toISOString().slice(0, 10);
  let row = counters.get(key);
  if (!row || row.day !== today) row = { count: 0, day: today };
  if (row.count >= FREE_PER_USER) return { ok: false, key, row };
  counters.set(key, row);
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

// ------------------- SUPPORT / DONATION (PayPal forced URL) -------------------
const DONATION_MESSAGE =
  "You do NOT need to — but if you’d like to help with costs (plus I’ll be your best friend 💜), you can donate to my Picture Fund. It is in no way required to get pictures — it’s just my way of saying YOU ARE AWESOME.";

app.get("/support", (req, res) => {
  const web = PAYPAL_BASE && PAYPAL_BASE.startsWith("http") ? PAYPAL_BASE : null;
  res.json({
    ok: true,
    message: DONATION_MESSAGE,
    paypal: web ? { web, amounts: [], links: [] } : null
  });
});

// ------------------- HELPERS -------------------
function sizeFromAspect(aspect = "16:9") {
  // Multiples of 64 for diffusion models; visually 16:9 / 9:16
  if (String(aspect).trim() === "9:16") return { width: 768, height: 1344 };
  return { width: 1280, height: 768 }; // 16:9 default
}
function pickUrl(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.image === "string") return obj.image;
  if (typeof obj.url === "string") return obj.url;
  if (Array.isArray(obj.output) && obj.output[0]) {
    return typeof obj.output[0] === "string" ? obj.output[0] : obj.output[0]?.url;
  }
  if (Array.isArray(obj.images) && typeof obj.images[0] === "string") {
    return obj.images[0];
  }
  if (Array.isArray(obj.data) && obj.data[0]) {
    const first = obj.data[0];
    if (typeof first === "string") return first;
    if (first && typeof first.url === "string") return first.url;
  }
  if (typeof obj.result === "string") return obj.result;
  return null;
}

// ------------------- HEALTH / ROOT -------------------
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    provider: PROVIDER,
    hasKey: Boolean(MODELSLAB_API_KEY),
    model: MODEL_NAME,
    donate: PAYPAL_BASE || null,
    freePerDay: FREE_PER_USER,
    time: new Date().toISOString(),
  });
});
app.get("/", (req, res) => {
  res.send(
    `<pre>DreamCanvas server
Provider: ${PROVIDER}
Endpoints:
  GET  /health
  GET  /support          (PayPal message + single forced URL)
  GET  /ai/history
  POST /ai/generate      { prompt, aspect: "16:9" | "9:16" }
</pre>`
  );
});

// ------------------- GENERATE -------------------
app.post("/ai/generate", async (req, res) => {
  try {
    if (!MODELSLAB_API_KEY)
      return res.status(401).json({ error: "Missing MODELSLAB_API_KEY" });

    const prompt = (req.body?.prompt || "").trim();
    const aspect = (req.body?.aspect || "16:9").trim();
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    // free daily soft limit
    const gate = checkQuota(req);
    if (!gate.ok) {
      return res.status(429).json({
        error: `Free limit reached (${FREE_PER_USER}/day). Come back tomorrow 💜`,
        paypal: PAYPAL_BASE || undefined
      });
    }

    const { width, height } = sizeFromAspect(aspect);

    // ModelsLab typically expects key in JSON body (not Authorization header)
    const payload = {
      key: MODELSLAB_API_KEY,
      prompt,
      width,
      height,
      model_id: MODEL_NAME,     // some accounts accept "model" instead
      output_format: "jpg",
      // Optional tunings:
      // steps: 28,
      // guidance_scale: 7,
      // enhance_prompt: true,
      // samples: 1,
    };

    const resp = await fetch(MODELSLAB_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });

    const txt = await resp.text();
    let data = {};
    try { data = JSON.parse(txt); } catch {}

    if (!resp.ok) {
      const msg = data?.message || data?.error || txt || `HTTP ${resp.status}`;
      return res.status(502).json({ error: `Provider error: ${msg}`, rawPreview: txt.slice(0, 500) });
    }

    const imageUrl = pickUrl(data) || pickUrl(data?.data);
    if (!imageUrl) {
      return res.status(502).json({
        error: "ModelsLab returned no image URL",
        rawPreview: txt?.slice(0, 500),
      });
    }

    pushHistory(imageUrl);
    bumpQuota(gate.key);

    return res.json({ imageUrl, aspect });
  } catch (err) {
    console.error("Generate error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
});

// ------------------- START -------------------
app.listen(PORT, () => {
  console.log(`[Boot] DreamCanvas up on :${PORT} (provider=${PROVIDER})`);
});
