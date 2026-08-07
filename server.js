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
  muted: 'rgba(255,255,255,0.85)',
  faint: 'rgba(255,255,255,0.72)',
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
  const bot = ctx.createLinearGradient(0, HEIGHT * 0.33, 0, HEIGHT);
  bot.addColorStop(0, 'rgba(8,10,13,0)');
  bot.addColorStop(0.45, 'rgba(8,10,13,0.80)');
  bot.addColorStop(1, 'rgba(8,10,13,0.97)');
  ctx.fillStyle = bot;
  ctx.fillRect(0, HEIGHT * 0.33, WIDTH, HEIGHT * 0.67);
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
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 비자 pill (테두리 배지: [ VISA {값} ])
function drawVisaPill(ctx, x, y, text) {
  const h = 54, r = 12, padX = 22, gap = 12;
  ctx.font = `bold 30px ${FB()}`;
  const label = 'VISA';
  const labelW = ctx.measureText(label).width;
  ctx.font = `500 30px ${FR()}`;
  const textW = ctx.measureText(text).width;
  const w = padX * 2 + labelW + gap + textW;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = 'rgba(43,213,118,0.14)';
  ctx.fill();
  ctx.strokeStyle = COLOR.accent; ctx.lineWidth = 2; ctx.stroke();
  const ty = y + h / 2;
  ctx.textBaseline = 'middle';
  ctx.font = `bold 30px ${FB()}`; ctx.fillStyle = COLOR.accent;
  ctx.fillText(label, x + padX, ty);
  ctx.font = `500 30px ${FR()}`; ctx.fillStyle = COLOR.ink;
  ctx.fillText(text, x + padX + labelW + gap, ty);
  ctx.textBaseline = 'top';
  return w;
}

// 실제 급여인지 판별 ($숫자 있고, 의미없는 값이 아닌 경우만 강조)
function isRealSalary(s) {
  if (!s) return false;
  const t = String(s).trim();
  // 무의미 급여 패턴
  if (/협의|문의|추후|미정|별도|상담|후 결정|negotiable|tbd|doe/i.test(t)) return false;
  // $1, 1달러 등 형식적 최소값
  const nums = (t.match(/[0-9][0-9,]*/g) || []).map(n => Number(n.replace(/,/g,'')));
  const maxNum = nums.length ? Math.max(...nums) : 0;
  if (maxNum <= 1) return false;
  // 숫자(달러/K 등)가 실제로 있으면 실급여
  return /\$|[0-9]{2,}|k\b|usd|시급|연봉|월급|주급/i.test(t) && maxNum >= 2;
}

function drawJobCard(ctx, f) {
  const barX = 84;
  const textX = 116;
  const rightPad = 84;
  const maxW = WIDTH - textX - rightPad;
  const bottomMargin = 180;

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  // 타이틀 줄바꿈(최대 3줄)
  ctx.font = `bold 84px ${FB()}`;
  let titleLines = wrapWords(ctx, f.job_title || '', maxW);
  const titleLineH = 100;
  if (titleLines.length > 3) {
    titleLines = titleLines.slice(0, 3);
    titleLines[2] = ellipsize(ctx, titleLines[2], maxW);
  }

  const rows = [];
  // 회사명 (존재감 ↑: 36px Bold)
  if (f.company && f.company.trim()) {
    rows.push({ h: 48, gap: 18, identity: true, draw: (y) => {
      ctx.font = `bold 36px ${FB()}`; ctx.fillStyle = COLOR.muted;
      ctx.fillText(ellipsize(ctx, f.company, maxW), textX, y);
    }});
  }
  // 직무 (히어로)
  const hasSummary = f.job_summary && f.job_summary.trim() && titleLines.length < 3;
  rows.push({ h: titleLines.length * titleLineH, gap: hasSummary ? 12 : 34, identity: true, draw: (y) => {
    ctx.font = `bold 84px ${FB()}`; ctx.fillStyle = COLOR.ink;
    titleLines.forEach((l, i) => ctx.fillText(l, textX, y + i * titleLineH));
  }});
  // 업무 요약 키워드 (직무 밑)
  if (hasSummary) {
    rows.push({ h: 44, gap: 36, draw: (y) => {
      ctx.font = `32px ${FR()}`; ctx.fillStyle = COLOR.muted;
      ctx.fillText(ellipsize(ctx, f.job_summary, maxW), textX, y);
    }});
  }
  // 지역 · 고용형태
  const hasType = f.employment_type && f.employment_type.trim();
  rows.push({ h: 50, gap: 22, draw: (y) => {
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
  // 급여 (초록 강조 텍스트)
  const hasSalary = f.salary && f.salary.trim();
  const hasVisa = f.visa && f.visa.trim();
  const salaryReal = hasSalary && isRealSalary(f.salary);
  if (hasSalary) {
    rows.push({ h: 56, gap: hasVisa ? 18 : 22, draw: (y) => {
      // 실제 급여만 초록 강조, "면접 후 협의"·$1 등은 회색
      ctx.font = salaryReal ? `bold 46px ${FB()}` : `40px ${FR()}`;
      ctx.fillStyle = salaryReal ? COLOR.accent : COLOR.muted;
      ctx.fillText(f.salary, textX, y);
    }});
  }
  // 비자 (pill 배지로 분리)
  if (hasVisa) {
    rows.push({ h: 54, gap: 22, draw: (y) => {
      drawVisaPill(ctx, textX, y, ellipsize(ctx, f.visa, maxW - 200));
    }});
  }
  // 복지 (한 줄)
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
  const blockTop = y;

  // 짧은 브랜드 accent 바: 회사명+직무(identity) 영역까지만
  let identityH = 0;
  for (let i = 0; i < rows.length; i++) {
    identityH += rows[i].h;
    const nextIsIdentity = (i + 1 < rows.length) && rows[i + 1].identity;
    if (rows[i].identity && !nextIsIdentity) break;
    identityH += rows[i].gap;
  }
  ctx.fillStyle = COLOR.brand;
  ctx.fillRect(barX, blockTop + 4, 6, Math.max(identityH - 8, 40));

  // 행 그리기
  for (const r of rows) { r.draw(y); y += r.h + r.gap; }
}

// ── 커버 V2 (날짜 작게 + 히어로 크게 + 서브) ──
function drawCoverV2(ctx, f) {
  const barX = 84, textX = 116, rightPad = 84;
  const maxW = WIDTH - textX - rightPad;
  const bottomMargin = 190;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  // 히어로 줄바꿈 (최대 2줄)
  ctx.font = `bold 88px ${FB()}`;
  let heroLines = wrapWords(ctx, f.hero || '', maxW);
  const heroLineH = 100;
  if (heroLines.length > 2) { heroLines = heroLines.slice(0, 2); heroLines[1] = ellipsize(ctx, heroLines[1], maxW); }

  const rows = [];
  if (f.date && f.date.trim()) {
    rows.push({ h: 92, gap: 18, draw: (y) => {
      ctx.font = `bold 78px ${FB()}`; ctx.fillStyle = COLOR.ink; ctx.fillText(f.date, textX, y);
    }});
  }
  rows.push({ h: heroLines.length * heroLineH, gap: (f.sub && f.sub.trim()) ? 24 : 0, draw: (y) => {
    ctx.font = `bold 88px ${FB()}`; ctx.fillStyle = COLOR.ink;
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
        job_summary: b.job_summary,
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
