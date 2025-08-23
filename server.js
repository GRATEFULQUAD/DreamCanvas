// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const MODELSLAB_API_KEY = process.env.MODELSLAB_API_KEY;
const MODEL = process.env.MODELSLAB_MODEL || "realistic-vision-v5.1";

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    provider: "modelslab",
    hasKey: !!MODELSLAB_API_KEY,
    model: MODEL,
    time: new Date().toISOString(),
    donate: "https://paypal.me/tomkumaton?locale.x=en_US&country.x=US",
    freePerDay: 2,
    message:
      "You do NOT need to, but if you would like to help with costs (and I’ll be your best friend 😉), you can donate to my picture fund. It is in no way required to get pictures — it’s just my way of saying YOU ARE AWESOME!"
  });
});

// Aspect → width/height
function dimsFromAspect(aspect = "16:9") {
  if (aspect === "9:16") return { width: 720, height: 1280 };
  if (aspect === "16:9") return { width: 1280, height: 720 };
  return { width: 1024, height: 1024 };
}

// Image generation endpoint
app.post("/ai/generate", async (req, res) => {
  try {
    const { prompt = "", aspect = "16:9" } = req.body;

    if (!prompt) return res.status(400).json({ error: "Missing prompt" });
    if (!MODELSLAB_API_KEY) return res.status(401).json({ error: "No MODELSLAB_API_KEY set" });

    const { width, height } = dimsFromAspect(aspect);

    const response = await fetch("https://modelslab.com/api/v6/realtime/text2img", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MODELSLAB_API_KEY}`,
      },
      body: JSON.stringify({
        prompt,
        model: MODEL,
        width,
        height,
        samples: 1,
        steps: 28,
        guidance_scale: 7,
        safety_checker: false,
        output_format: "url"
      }),
    });

    const data = await response.json();

    // Extract image URL from response
    let imageUrl = null;
    if (Array.isArray(data.output) && data.output.length > 0) {
      imageUrl = data.output[0];
    } else if (data.imageUrl) {
      imageUrl = data.imageUrl;
    } else if (data.url) {
      imageUrl = data.url;
    }

    if (!imageUrl) {
      return res.status(500).json({
        error: "ModelsLab returned no image URL",
        rawPreview: JSON.stringify(data),
      });
    }

    res.json({ imageUrl, aspect });

  } catch (error) {
    console.error("Error in /ai/generate:", error);
    res.status(500).json({ error: error.message });
  }
});

// Boot server
app.listen(PORT, () => {
  console.log(`[Boot] DreamCanvas (ModelsLab) running on port ${PORT}`);
});
