// server.js — DreamCanvas (ModelsLab) + History + Soft Limit + Support message
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ------------------- ENV -------------------
const PORT = process.env.PORT || 10000;
const PROVIDER = (process.env.PROVIDER || "modelslab").toLowerCase();

const MODELSLAB_API_KEY = (process.env.MODELSLAB_API_KEY || "").trim();
const MODEL_NAME = (process.env.MODEL_NAME || "realistic-vision-v5.1").trim();
// Default to the endpoint that worked for you; override with MODELSLAB_URL if needed.
const MODELSLAB_URL =
  (process.env.MODELSLAB_URL || "https://modelslab.com/api/v1/image").trim();

const FREE_PER_USER = parseInt(process.env.FREE_PER_USER || "2", 10);
const CASHTAG = (process.env.CASHTAG || "").replace(/^\$/, "");

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
// ----------- SUPPORT / DONATION MESSAGE (PayPal only) ------------
const DONATION_MESSAGE =
  "You do NOT need to — but if you’d like to help with costs (plus I’ll be your best friend 💜), you can donate to my Picture Fund. It is in no way required to get pictures — it’s just my way of saying YOU ARE AWESOME.";

app.get("/support", (req, res) => {
  const paypal = (process.env.PAYPAL_USERNAME || "").trim();
  const paypalBase = paypal ? `https://paypal.me/${encodeURIComponent(paypal)}` : null;

  res.json({
    ok: true,
    message: DONATION_MESSAGE,
    paypal: paypalBase ? { username: paypal, web: paypalBase } : null
  });
});
// ------------------- SUPPORT / DONATION MESSAGE -------------------
const DONATE_AMOUNTS = [2, 3, 5];
const DONATION_MESSAGE =
  "You do NOT need to — but if you’d like to help with costs (plus I’ll be your best friend 💜), you can donate to my Picture Fund. It is in no way required to get pictures — it’s just my way of saying YOU ARE AWESOME.";

app.get("/support", (req, res) => {
  const tag = CASHTAG ? `https://cash.app/$${CASHTAG}` : null;
  res.json({
    ok: true,
    message: DONATION_MESSAGE,
    cashtag: CASHTAG || null,
    donate: tag,
    amounts: DONATE_AMOUNTS,
    links: tag
      ? DONATE_AMOUNTS.map((amt) => ({ amount: amt, url: `${tag}/${amt}` }))
      : [],
  });
});

// ------------------- HELPERS -------------------
function sizeFromAspect(aspect = "16:9") {
  // Use multiples of 64 to stay compatible; these map visually to 16:9 and 9:16.
  if (String(aspect).trim() === "9:16") return { width: 768, height: 1344 };
  return { width: 1280, height: 768 }; // 16:9 default
}
function pickUrl(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.image === "string") return obj.image;
  if (typeof obj.url === "string") return obj.url;
  if (Array.isArray(obj.output) && obj.output[0]) {
    return typeof obj.output[0] === "string" ? obj.output[0] : obj.output[0].url;
  }
  if (Array.isArray(obj.data) && obj.data[0]) {
    return typeof obj.data[0] === "string" ? obj.data[0] : obj.data[0].url;
  }
  if (Array.isArray(obj.images) && typeof obj.images[0] === "string") {
    return obj.images[0];
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
    donate: CASHTAG ? `https://cash.app/$${CASHTAG}` : null,
    time: new Date().toISOString(),
  });
});
app.get("/", (req, res) => {
  res.send(
    `<pre>DreamCanvas server (ModelsLab)
Endpoints:
  GET  /health
  GET  /support
  GET  /ai/history
  POST /ai/generate   { prompt, aspect: "16:9" | "9:16" }
</pre>`
  );
});

// ------------------- GENERATE -------------------
app.post("/ai/generate", async (req, res) => {
  try {
    if (PROVIDER !== "modelslab")
      return res.status(400).json({ error: "PROVIDER must be 'modelslab'" });
    if (!MODELSLAB_API_KEY)
      return res.status(401).json({ error: "Missing MODELSLAB_API_KEY" });

    const prompt = (req.body?.prompt || "").trim();
    const aspect = (req.body?.aspect || "16:9").trim();
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    // soft free limit
    const gate = checkQuota(req);
    if (!gate.ok) {
      const donate = CASHTAG ? `https://cash.app/$${CASHTAG}` : undefined;
      return res.status(429).json({
        error: `Free limit reached (${FREE_PER_USER}/day). Come back tomorrow 💜`,
        donate,
      });
    }

    const { width, height } = sizeFromAspect(aspect);

    const payload = {
      key: MODELSLAB_API_KEY,    // ModelsLab expects key in JSON body
      prompt,
      width,
      height,
      model_id: MODEL_NAME,      // many accounts accept model_id
      // Optional tuning:
      // samples: 1, steps: 30, guidance_scale: 7, safety_checker: false, enhance_prompt: true,
      output_format: "jpg",
    };

    const resp = await fetch(MODELSLAB_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });

    const txt = await resp.text();
    let data = {};
    try { data = JSON.parse(txt); } catch { /* leave as {} */ }

    if (!resp.ok) {
      const msg = data?.message || data?.error || txt || `HTTP ${resp.status}`;
      return res.status(resp.status).json({ error: `ModelsLab ${resp.status}: ${msg}` });
    }

    const imageUrl = pickUrl(data) || pickUrl(data?.data);
    if (!imageUrl) {
      return res.status(502).json({ error: "ModelsLab returned no image URL", rawPreview: txt?.slice(0, 500) });
    }

    // track successful gen
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
  console.log(`[Boot] DreamCanvas up on :${PORT} (provider=modelslab)`);
});
