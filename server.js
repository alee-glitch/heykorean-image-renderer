const express = require('express');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fetch = require('node-fetch');
const sharp = require('sharp');
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' }));

// Register Korean fonts
GlobalFonts.registerFromPath(path.join(__dirname, 'fonts/NotoSansCJK-Regular.ttc'), 'NotoKR');
GlobalFonts.registerFromPath(path.join(__dirname, 'fonts/NotoSansCJK-Bold.ttc'), 'NotoKR-Bold');

const WIDTH = 1080;
const HEIGHT = 1350;

function wrapWords(ctx, text, maxWidth) {
  const paragraphs = text.split(/\n/);
  const allLines = [];
  for (const para of paragraphs) {
    if (!para.trim()) { allLines.push(''); continue; }
    const words = para.split(' ');
    let current = '';
    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        allLines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) allLines.push(current);
  }
  return allLines.filter(l => l !== '');
}

async function getImageBuffer(imageUrl) {
  if (imageUrl.startsWith('data:')) {
    const base64Data = imageUrl.split(',')[1];
    return Buffer.from(base64Data, 'base64');
  }
  const response = await fetch(imageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  return response.buffer();
}

app.get('/health', (req, res) => res.json({ status: 'ok', fonts: 'NotoKR loaded' }));

app.post('/render', async (req, res) => {
  try {
    const { image_url, title, subtitle } = req.body;
    if (!image_url || !title) {
      return res.status(400).json({ error: 'image_url and title are required' });
    }

    // Fetch + resize background
    const imgBuffer = await getImageBuffer(image_url);
    const resizedBuffer = await sharp(imgBuffer)
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'center' })
      .png()
      .toBuffer();

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Draw background
    const bgImage = await loadImage(resizedBuffer);
    ctx.drawImage(bgImage, 0, 0, WIDTH, HEIGHT);

    // Dark gradient overlay (bottom 58%)
    const grad = ctx.createLinearGradient(0, HEIGHT * 0.42, 0, HEIGHT);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.45, 'rgba(0,0,0,0.62)');
    grad.addColorStop(1, 'rgba(0,0,0,0.87)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, HEIGHT * 0.42, WIDTH, HEIGHT * 0.58);

    const padX = 64;
    const maxW = WIDTH - padX * 2;
    const bottomPad = 88;

    // Measure title to position everything from bottom up
    ctx.font = `bold 80px NotoKR-Bold`;
    const titleLines = wrapWords(ctx, title, maxW);
    const titleLineH = 100;
    const titleBlockH = titleLines.length * titleLineH;

    // Draw subtitle above title
    if (subtitle) {
      ctx.font = `36px NotoKR`;
      const subLines = wrapWords(ctx, subtitle, maxW);
      const subLineH = 50;
      const subBlockH = subLines.length * subLineH;
      const subStartY = HEIGHT - bottomPad - titleBlockH - 18 - subBlockH;
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.textBaseline = 'top';
      subLines.forEach((line, i) => ctx.fillText(line, padX, subStartY + i * subLineH));
    }

    // Draw title
    const titleStartY = HEIGHT - bottomPad - titleBlockH;
    ctx.font = `bold 80px NotoKR-Bold`;
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'top';
    titleLines.forEach((line, i) => ctx.fillText(line, padX, titleStartY + i * titleLineH));

    // Return PNG
    const output = canvas.toBuffer('image/png');
    res.set('Content-Type', 'image/png');
    res.set('Content-Length', output.length);
    res.send(output);

  } catch (err) {
    console.error('Render error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Image renderer running on port ${PORT}`));
