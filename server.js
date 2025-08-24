// === Add/replace these near your existing helpers ===

// Strong style map (backend is the single source of truth)
const STYLE_MAP = {
  realistic: {
    prefix:  "photorealistic, natural lighting, detailed textures, depth of field",
    negative:"cartoon, comic, pop art, 3d plastic, low detail, watermark, text, logo",
    cfg: 6.0,
  },
  cyberpunk: {
    prefix:  "neon cyberpunk, rain-soaked streets, reflective puddles, holograms, volumetric fog, teal-magenta rim lighting",
    negative:"pastel cute, watercolor bleed, medieval, pop art dots, plastic 3d",
    cfg: 8.0,
  },
  anime: {
    prefix:  "ANIME style, clean line art, cel shading, big expressive eyes, flat vibrant colors",
    negative:"photoreal skin pores, film grain, plastic 3d render, pop art dots",
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

function dimsFromAspect(aspect = "16:9") {
  const a = String(aspect).replace("x", ":").trim();
  if (a === "9:16")  return { width: 768, height: 1344 };
  if (a === "16:9")  return { width: 1344, height: 768 };
  return { width: 1024, height: 1024 };
}

// === Inside your /ai/generate handler, replace the body-build section with this ===

app.post("/ai/generate", async (req, res) => {
  try {
    const { prompt = "", aspect = "16:9", style = "realistic", seed } = req.body || {};
    if (!MODELSLAB_API_KEY) return res.status(401).json({ error: "Missing MODELSLAB_API_KEY" });
    if (!prompt.trim())     return res.status(400).json({ error: "Missing prompt" });

    const { width, height } = dimsFromAspect(aspect);
    const S = pickStyle(style);

    // Backend composes the final prompt (frontend sends raw prompt + style only)
    const finalPrompt = `${S.prefix}. ${prompt.trim()}`.trim();
    const negative    = S.negative || "";
    const cfg         = typeof S.cfg === "number" ? S.cfg : 7.0;

    const providerBody = {
      key: MODELSLAB_API_KEY,
      model: DEFAULT_MODEL,
      model_id: DEFAULT_MODEL,
      prompt: finalPrompt,
      negative_prompt: negative,
      width, height,
      steps: 32,
      guidance_scale: cfg,
      safety_checker: false,
      output_format: "url",
      ...(seed ? { seed } : {}),
    };

    // Debug log so we can SEE the style & cfg used
    console.log("[ai] gen", {
      aspect, style, cfg, width, height,
      promptPreview: finalPrompt.slice(0, 120)
    });

    const resp = await fetch("https://modelslab.com/api/v6/realtime/text2img", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MODELSLAB_API_KEY}`,
      },
      body: JSON.stringify(providerBody),
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
