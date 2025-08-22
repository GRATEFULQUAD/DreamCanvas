const FormData = require('form-data');

// ...

// SD3 endpoint + multipart form-data
const URL = 'https://api.stability.ai/v2beta/stable-image/generate/sd3';

// Build multipart form
const form = new FormData();
form.append('prompt', prompt);
form.append('aspect_ratio', aspect);     // "1:1" | "16:9" | "9:16"
form.append('output_format', 'jpeg');    // get back a JPEG image

const resp = await fetch(URL, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${KEY}`,
    'Accept': 'image/*',                 // <-- not image/jpeg
    ...form.getHeaders()                 // sets correct multipart Content-Type
  },
  body: form
});

if (!resp.ok) {
  const text = await resp.text().catch(() => '');
  return res.status(resp.status).json({ error: text || `Stability error ${resp.status}` });
}

// bytes -> data URL
const buf = Buffer.from(await resp.arrayBuffer());
const b64 = buf.toString('base64');
const dataUrl = `data:image/jpeg;base64,${b64}`;

return res.json({ imageUrl: dataUrl, aspect });
