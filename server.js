const express = require('express');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fetch = require('node-fetch');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const app = express();
app.use(express.json({ limit: '50mb' }));

const fontsDir = path.join(__dirname, 'fonts');
if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir);

const regular = path.join(fontsDir, 'NotoSansCJK-Regular.ttc');
const bold = path.join(fontsDir, 'NotoSansCJK-Bold.ttc');

function setupFonts() {
  if (fs.existsSync(regular) && fs.existsSync(bold)) {
    console.log('Fonts already exist, loading...');
    GlobalFonts.registerFromPath(regular, 'NotoKR');
    GlobalFonts.registerFromPath(bold, 'NotoKR-Bold');
    return;
  }

  console.log('Installing Korean fonts...');
  try {
    execSync('apt-get install -y fonts-noto-cjk', { stdio: 'pipe' });
    const src = '/usr/share/fonts/opentype/noto';
    if (fs.existsSync(`${src}/NotoSansCJK-Regular.ttc`)) {
      fs.copyFileSync(`${src}/NotoSansCJK-Regular.ttc`, regular);
      fs.copyFileSync(`${src}/NotoSansCJK-Bold.ttc`, bold);
      console.log('Fonts installed via apt-get');
    }
  } catch (e) {
    console.log('apt-get failed:', e.message);
  }

  if (fs.existsSync(regular) && fs.existsSync(bold)) {
    GlobalFonts.registerFromPath(regular, 'NotoKR');
    GlobalFonts.registerFromPath(bold, 'NotoKR-Bold');
    console.log('Fonts loaded successfully!');
  } else {
    console.error('Font installation failed, Korean text may not render correctly');
  }
}

setupFonts();

const WIDTH = 1080;
const HEIGHT = 1350;

function wrapWords(ctx, text, maxWidth) {
  const paragraphs = text.split(/\n/);
  const allLines = [];
  for (const para of paragraphs) {
    if (!para.trim()) continue;
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
  return allLines;
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

app.get('/health', (req, res) => {
  const fontsLoaded = fs.existsSync(regular) && fs.existsSync(bold);
  res.json({ status: 'ok', fonts: fontsLoaded ? 'loaded' : 'missing' });
});

app.post('/render', async (req, res) => {
  try {
    const { image_url, title, subtitle } = req.body;
    if (!image_url || !title) {
      return res.status(400).json({ error: 'image_url and title are required' });
    }

    const imgBuffer = await getImageBuffer(image_url);
    const resizedBuffer = await sharp(imgBuffer)
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'center' })
      .png()
      .toBuffer();

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    const bgImage = await loadImage(resizedBuffer);
    ctx.drawImage(bgImage, 0, 0, WIDTH, HEIGHT);

    const grad = ctx.createLinearGradient(0, HEIGHT * 0.42, 0, HEIGHT);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.45, 'rgba(0,0,0,0.62)');
    grad.addColorStop(1, 'rgba(0,0,0,0.88)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, HEIGHT * 0.42, WIDTH, HEIGHT * 0.58);

    const padX = 90;
    const maxW = WIDTH - padX * 2;
    const bottomPad = 220;

    const fontFamily = fs.existsSync(regular) ? 'NotoKR-Bold' : 'sans-serif';
    const fontFamilyRegular = fs.existsSync(regular) ? 'NotoKR' : 'sans-serif';

    ctx.font = `bold 90px ${fontFamily}`;
    const titleLines = wrapWords(ctx, title, maxW);
    const titleLineH = 112;
    const titleBlockH = titleLines.length * titleLineH;

    if (subtitle) {
      ctx.font = `bold 43px ${fontFamilyRegular}`;
      const subLines = wrapWords(ctx, subtitle, maxW);
      const subLineH = 54;
      const subBlockH = subLines.length * subLineH;
      const subStartY = HEIGHT - bottomPad - titleBlockH - 32 - subBlockH;
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.textBaseline = 'top';
      subLines.forEach((line, i) => ctx.fillText(line, padX, subStartY + i * subLineH));
    }

    const titleStartY = HEIGHT - bottomPad - titleBlockH;
    ctx.font = `bold 90px ${fontFamily}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'top';
    titleLines.forEach((line, i) => ctx.fillText(line, padX, titleStartY + i * titleLineH));

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
