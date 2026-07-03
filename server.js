const express = require('express');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fetch = require('node-fetch');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '50mb' }));

const fontsDir = path.join(__dirname, 'fonts');
if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir);

function resolveFont(base) {
  for (const ext of ['.otf', '.ttf']) {
    const p = path.join(fontsDir, base + ext);
    if (fs.existsSync(p)) return p;
  }
  return path.join(fontsDir, base + '.otf'); // 기본값(없어도 아래에서 존재 검사)
}
const regular = resolveFont('Pretendard-Regular');
const bold = resolveFont('Pretendard-Bold');

function setupFonts() {
  if (fs.existsSync(regular) && fs.existsSync(bold)) {
    GlobalFonts.registerFromPath(regular, 'Pretendard');
    GlobalFonts.registerFromPath(bold, 'Pretendard-Bold');
    console.log('Pretendard fonts loaded successfully!');
  } else {
    console.error('Pretendard font files missing. Upload Pretendard-Regular and Pretendard-Bold (.otf or .ttf) to the /fonts folder.');
  }
}

setupFonts();

const WIDTH = 1080;
const HEIGHT = 1350;

// ── 디자인 토큰 ──
const COLOR = {
  ink: '#FFFFFF',
  muted: 'rgba(255,255,255,0.76)',
  faint: 'rgba(255,255,255,0.60)',
  brand: '#0096FA',   // HeyKorean 블루
  accent: '#2BD576',  // 급여·비자 강조 (초록)
};

const FB = () => (fs.existsSync(bold) ? 'Pretendard-Bold' : 'sans-serif');
const FR = () => (fs.existsSync(regular) ? 'Pretendard' : 'sans-serif');

function wrapWords(ctx, text, maxWidth) {
  const paragraphs = String(text).split(/\n/);
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

function ellipsize(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

async function getImageBuffer(imageUrl) {
  if (imageUrl.startsWith('data:')) {
    const base64Data = imageUrl.split(',')[1];
    return Buffer.from(base64Data, 'base64');
  }
  const response = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  return response.buffer();
}

// 배경 + 스크림 공통
function drawBackground(ctx, bgImage) {
  ctx.drawImage(bgImage, 0, 0, WIDTH, HEIGHT);
  // 상단 살짝 어둡게 (아이브로우 가독성)
  const top = ctx.createLinearGradient(0, 0, 0, HEIGHT * 0.20);
  top.addColorStop(0, 'rgba(8,10,13,0.42)');
  top.addColorStop(1, 'rgba(8,10,13,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, WIDTH, HEIGHT * 0.20);
  // 하단 스크림
  const bot = ctx.createLinearGradient(0, HEIGHT * 0.40, 0, HEIGHT);
  bot.addColorStop(0, 'rgba(8,10,13,0)');
  bot.addColorStop(0.55, 'rgba(8,10,13,0.72)');
  bot.addColorStop(1, 'rgba(8,10,13,0.95)');
  ctx.fillStyle = bot;
  ctx.fillRect(0, HEIGHT * 0.40, WIDTH, HEIGHT * 0.60);
}

// 상단 브랜드 아이브로우 (전 슬라이드 고정 → 시리즈 인지)
function drawEyebrow(ctx) {
  const cy = 112;
  ctx.fillStyle = COLOR.brand;
  ctx.beginPath();
  ctx.arc(90 + 8, cy, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `bold 30px ${FB()}`;
  ctx.fillStyle = COLOR.ink;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('HEYKOREAN 구인구직', 90 + 28, cy + 1);
}

// 우상단 슬라이드 인덱스 (선택)
function drawIndex(ctx, index, total) {
  if (!index || !total) return;
  const s = String(index).padStart(2, '0');
  const t = ' / ' + String(total).padStart(2, '0');
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.font = `bold 30px ${FB()}`;
  const tW = ctx.measureText(t).width;
  ctx.fillStyle = COLOR.faint;
  ctx.fillText(t, WIDTH - 90, 112 + 1);
  ctx.fillStyle = COLOR.ink;
  ctx.fillText(s, WIDTH - 90 - tW, 112 + 1);
  ctx.textAlign = 'left';
}

// ── 공고 카드 레이아웃 ──
function drawJobCard(ctx, f) {
  const barX = 84;
  const textX = 116;
  const rightPad = 84;
  const maxW = WIDTH - textX - rightPad;
  const bottomMargin = 100;

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  // 타이틀 줄바꿈(최대 3줄) 사전 계산
  ctx.font = `bold 84px ${FB()}`;
  let titleLines = wrapWords(ctx, f.job_title || '', maxW);
  const titleLineH = 100;
  if (titleLines.length > 3) {
    titleLines = titleLines.slice(0, 3);
    titleLines[2] = ellipsize(ctx, titleLines[2], maxW);
  }

  // 행 구성 (존재하는 것만)
  const rows = [];
  if (f.company && f.company.trim()) {
    rows.push({ h: 42, gap: 20, draw: (y) => {
      ctx.font = `32px ${FR()}`; ctx.fillStyle = COLOR.muted;
      ctx.fillText(ellipsize(ctx, f.company, maxW), textX, y);
    }});
  }
  rows.push({ h: titleLines.length * titleLineH, gap: 30, draw: (y) => {
    ctx.font = `bold 84px ${FB()}`; ctx.fillStyle = COLOR.ink;
    titleLines.forEach((l, i) => ctx.fillText(l, textX, y + i * titleLineH));
  }});
  // region · employment
  const hasType = f.employment_type && f.employment_type.trim();
  rows.push({ h: 50, gap: 24, draw: (y) => {
    let x = textX;
    if (f.region && f.region.trim()) {
      ctx.font = `bold 40px ${FB()}`; ctx.fillStyle = COLOR.ink;
      ctx.fillText(f.region, x, y); x += ctx.measureText(f.region).width;
    }
    if (hasType) {
      ctx.font = `36px ${FR()}`; ctx.fillStyle = COLOR.faint;
      ctx.fillText('  ·  ', x, y + 4); x += ctx.measureText('  ·  ').width;
      ctx.fillStyle = COLOR.muted;
      ctx.fillText(ellipsize(ctx, f.employment_type, maxW - (x - textX)), x, y + 4);
    }
  }});
  // salary · visa (초록 강조)
  const hasSalary = f.salary && f.salary.trim();
  const hasVisa = f.visa && f.visa.trim();
  if (hasSalary || hasVisa) {
    rows.push({ h: 56, gap: 22, draw: (y) => {
      let x = textX;
      if (hasSalary) {
        ctx.font = `bold 46px ${FB()}`; ctx.fillStyle = COLOR.accent;
        ctx.fillText(f.salary, x, y); x += ctx.measureText(f.salary).width;
      }
      if (hasVisa) {
        if (hasSalary) { ctx.font = `34px ${FR()}`; ctx.fillStyle = COLOR.faint; ctx.fillText('   ·   ', x, y + 8); x += ctx.measureText('   ·   ').width; }
        ctx.font = `34px ${FR()}`; ctx.fillStyle = COLOR.accent;
        ctx.fillText(f.visa, x, y + 8);
      }
    }});
  }
  // benefits (한 줄)
  if (f.benefits && f.benefits.trim()) {
    rows.push({ h: 40, gap: 0, draw: (y) => {
      ctx.font = `29px ${FR()}`; ctx.fillStyle = COLOR.faint;
      ctx.fillText(ellipsize(ctx, f.benefits, maxW), textX, y);
    }});
  }

  // 전체 높이 → 하단 정렬
  let totalH = 0;
  rows.forEach((r, i) => { totalH += r.h + (i < rows.length - 1 ? r.gap : 0); });
  let y = HEIGHT - bottomMargin - totalH;

  // 좌측 브랜드 바
  ctx.fillStyle = COLOR.brand;
  ctx.fillRect(barX, y + 4, 6, totalH - 8);

  // 행 그리기
  for (const r of rows) { r.draw(y); y += r.h + r.gap; }
}

// ── 커버 V2 (날짜 작게 + 히어로 크게 + 서브) ──
function drawCoverV2(ctx, f) {
  const barX = 84, textX = 116, rightPad = 84;
  const maxW = WIDTH - textX - rightPad;
  const bottomMargin = 120;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  // 히어로 줄바꿈 (최대 2줄)
  ctx.font = `bold 116px ${FB()}`;
  let heroLines = wrapWords(ctx, f.hero || '', maxW);
  const heroLineH = 132;
  if (heroLines.length > 2) { heroLines = heroLines.slice(0, 2); heroLines[1] = ellipsize(ctx, heroLines[1], maxW); }

  const rows = [];
  if (f.date && f.date.trim()) {
    rows.push({ h: 42, gap: 22, draw: (y) => {
      ctx.font = `34px ${FR()}`; ctx.fillStyle = COLOR.muted; ctx.fillText(f.date, textX, y);
    }});
  }
  rows.push({ h: heroLines.length * heroLineH, gap: (f.sub && f.sub.trim()) ? 24 : 0, draw: (y) => {
    ctx.font = `bold 116px ${FB()}`; ctx.fillStyle = COLOR.ink;
    heroLines.forEach((l, i) => ctx.fillText(l, textX, y + i * heroLineH));
  }});
  if (f.sub && f.sub.trim()) {
    rows.push({ h: 52, gap: 0, draw: (y) => {
      ctx.font = `46px ${FR()}`; ctx.fillStyle = COLOR.muted; ctx.fillText(ellipsize(ctx, f.sub, maxW), textX, y);
    }});
  }

  let totalH = 0;
  rows.forEach((r, i) => { totalH += r.h + (i < rows.length - 1 ? r.gap : 0); });
  let y = HEIGHT - bottomMargin - totalH;
  ctx.fillStyle = COLOR.brand;
  ctx.fillRect(barX, y + 4, 6, totalH - 8);
  for (const r of rows) { r.draw(y); y += r.h + r.gap; }
}

// ── 커버/레거시 레이아웃 (title/subtitle) ──
function drawCover(ctx, title, subtitle) {
  const padX = 116;
  const maxW = WIDTH - padX - 84;
  const bottomPad = 200;

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  ctx.font = `bold 96px ${FB()}`;
  const titleLines = wrapWords(ctx, title, maxW);
  const titleLineH = 118;
  const titleBlockH = titleLines.length * titleLineH;

  if (subtitle && subtitle.trim()) {
    ctx.font = `44px ${FR()}`;
    const subLines = wrapWords(ctx, subtitle, maxW);
    const subLineH = 56;
    const subStartY = HEIGHT - bottomPad - titleBlockH - 28 - subLines.length * subLineH;
    ctx.fillStyle = COLOR.accent;
    subLines.forEach((l, i) => ctx.fillText(l, padX, subStartY + i * subLineH));
  }

  const titleStartY = HEIGHT - bottomPad - titleBlockH;
  // 좌측 브랜드 바
  ctx.fillStyle = COLOR.brand;
  ctx.fillRect(84, titleStartY + 6, 6, titleBlockH - 12);

  ctx.font = `bold 96px ${FB()}`;
  ctx.fillStyle = COLOR.ink;
  titleLines.forEach((l, i) => ctx.fillText(l, padX, titleStartY + i * titleLineH));
}

app.get('/health', (req, res) => {
  const fontsLoaded = fs.existsSync(regular) && fs.existsSync(bold);
  res.json({ status: 'ok', font: 'Pretendard', fonts: fontsLoaded ? 'loaded' : 'missing' });
});

app.post('/render', async (req, res) => {
  try {
    const b = req.body || {};
    const { image_url, job_title, title } = b;
    if (!image_url) return res.status(400).json({ error: 'image_url is required' });
    if (!job_title && !title && !b.hero) return res.status(400).json({ error: 'job_title, hero, or title is required' });

    const imgBuffer = await getImageBuffer(image_url);
    const resizedBuffer = await sharp(imgBuffer)
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'center' })
      .png()
      .toBuffer();

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');
    const bgImage = await loadImage(resizedBuffer);

    drawBackground(ctx, bgImage);
    drawEyebrow(ctx);

    if (job_title) {
      // 공고 카드
      drawIndex(ctx, b.index, b.total);
      drawJobCard(ctx, {
        company: b.company,
        job_title: b.job_title,
        region: b.region,
        employment_type: b.employment_type,
        salary: b.salary,
        visa: b.visa,
        benefits: b.benefits,
      });
    } else if (b.hero) {
      // 커버 V2 (날짜 + 히어로 + 서브)
      drawCoverV2(ctx, { date: b.date, hero: b.hero, sub: b.sub });
    } else {
      // 레거시 (title/subtitle)
      drawCover(ctx, title, b.subtitle);
    }

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
