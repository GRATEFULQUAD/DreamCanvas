app.post('/ai/generate', async (req, res) => {
  try {
    // Accept flexible keys from the frontend
    let prompt =
      (req.body && (req.body.prompt || req.body.description || req.body.text)) || '';
    let size = (req.body && (req.body.size || req.body.aspect)) || ''; // can be "1024x1024" or "16:9"/"9:16"

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Missing prompt' });
    }
    prompt = prompt.trim();

    // Map common inputs to valid OpenAI sizes
    const normalizeSize = (raw) => {
      if (!raw) return '1024x1024'; // default safe size

      const v = String(raw).toLowerCase().replace(/\s+/g, '');

      // Accept aspect labels
      if (v === '16:9') return '1792x1024';
      if (v === '9:16')  return '1024x1792';
      if (v === '1:1' || v === 'square') return '1024x1024';

      // Accept common “nearby” dimensions and map to valid ones
      if (v.includes('1280x720')) return '1792x1024';
      if (v.includes('720x1280')) return '1024x1792';
      if (v.includes('1024x1024')) return '1024x1024';
      if (v.includes('1792x1024')) return '1792x1024';
      if (v.includes('1024x1792')) return '1024x1792';

      // fallback
      return '1024x1024';
    };

    size = normalizeSize(size);

    // Only allow sizes OpenAI supports
    const ALLOWED = new Set(['1024x1024', '1792x1024', '1024x1792']);
    if (!ALLOWED.has(size)) size = '1024x1024';

    // Call OpenAI
    const result = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      size,
      // n: 1 // default is 1
    });

    const url = result?.data?.[0]?.url;
    if (!url) {
      return res.status(502).json({ error: 'No image URL returned from OpenAI' });
    }

    return res.json({ url, size });
  } catch (err) {
    console.error('AI generation error:', err?.response?.data || err);
    const message =
      err?.response?.data?.error?.message ||
      err?.message ||
      'Image generation failed';
    return res.status(500).json({ error: message });
  }
});
