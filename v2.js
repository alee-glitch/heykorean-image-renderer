// v2.js — 캐러셀 템플릿 V2 (밝은 배경 · 축별 색)
//   POST /render/v2  { type: "cover" | "job" | "cta", ... }  →  PNG 1080x1350
// 기존 /render 는 그대로 둔다. 이 파일은 server.js 에서 require('./v2')(app) 한 줄로 붙는다.
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fetch = require('node-fetch');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const W = 1080, H = 1350, PX = 88, PT = 92, PB = 84, CW = W - PX * 2;

// ── 색 규칙 ──
const C = { ink: '#191F28', sub: '#4E5968', gray: '#8B95A1', line: '#E5E8EB', white: '#FFFFFF', green: '#00B06B' };
const AXIS = {
  region: { accent: '#0096FA', tint: '#E8F4FE', label: '지역' },
  cond:   { accent: '#00B06B', tint: '#E6F7EF', label: '조건' },
  job:    { accent: '#7C5CFC', tint: '#EFEBFE', label: '직군' },
};
const axisOf = (a) => AXIS[a] || AXIS.region;

// ── 폰트 (없는 굵기는 가까운 굵기로 대체) ──
const fontsDir = path.join(__dirname, 'fonts');
function fontFile(base) {
  for (const ext of ['.otf', '.ttf']) { const p = path.join(fontsDir, base + ext); if (fs.existsSync(p)) return p; }
  return null;
}
const FAMILY = {};
[[400, 'Pretendard-Regular'], [500, 'Pretendard-Medium'], [600, 'Pretendard-SemiBold'], [700, 'Pretendard-Bold']].forEach(([w, base]) => {
  const p = fontFile(base);
  if (p) { GlobalFonts.registerFromPath(p, 'PretV2-' + w); FAMILY[w] = 'PretV2-' + w; }
});
FAMILY[400] = FAMILY[400] || 'sans-serif';
FAMILY[700] = FAMILY[700] || FAMILY[400];
FAMILY[500] = FAMILY[500] || FAMILY[400];
FAMILY[600] = FAMILY[600] || FAMILY[700];

// ── 텍스트 도구 ──
const ASC = 0.928, CONTENT = 1.172;            // Pretendard 세로 메트릭 (em 기준)
const stripEmoji = (s) => String(s == null ? '' : s)
  .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, '').replace(/[ \t]{2,}/g, ' ').trim();
const clean = stripEmoji;

function setFont(ctx, weight, size, ls) {
  ctx.font = `${size}px "${FAMILY[weight]}"`;
  ctx.letterSpacing = `${((ls == null ? -0.02 : ls) * size).toFixed(2)}px`;
}
// CSS 의 line box 와 같은 위치에 기준선을 잡는다
const baseline = (top, lineH, size) => top + (lineH - CONTENT * size) / 2 + ASC * size;
const normalLH = (size) => CONTENT * size;

function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}
function wrap(ctx, text, maxW, maxLines) {
  const lines = [];
  for (const para of String(text).split(/\n/)) {
    let cur = '';
    for (const word of para.split(' ').filter(Boolean)) {
      const test = cur ? cur + ' ' + word : word;
      if (ctx.measureText(test).width <= maxW) { cur = test; continue; }
      if (cur) { lines.push(cur); cur = ''; }
      let w = word;                                   // 한 단어가 줄보다 길면 글자 단위로 끊는다
      while (ctx.measureText(w).width > maxW && w.length > 1) {
        let n = w.length; while (n > 1 && ctx.measureText(w.slice(0, n)).width > maxW) n--;
        lines.push(w.slice(0, n)); w = w.slice(n);
      }
      cur = w;
    }
    if (cur) lines.push(cur);
  }
  if (maxLines && lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = ellipsize(ctx, cut[maxLines - 1] + '…', maxW);
    return cut;
  }
  return lines;
}
// 한 줄에 맞을 때까지 글자 크기를 줄인다
function fitSize(ctx, text, weight, size, min, ls, maxW) {
  let s = size;
  for (; s > min; s -= 2) { setFont(ctx, weight, s, ls); if (ctx.measureText(text).width <= maxW) break; }
  return s;
}
// 서로 다른 스타일의 조각을 같은 기준선에 이어 그린다. align: 'left' | 'right'
function drawSegs(ctx, segs, x, baseY, align) {
  const widths = segs.map((s) => { setFont(ctx, s.w, s.size, s.ls); return ctx.measureText(s.t).width + (s.gap || 0); });
  let cx = align === 'right' ? x - widths.reduce((a, b) => a + b, 0) : x;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  segs.forEach((s, i) => {
    setFont(ctx, s.w, s.size, s.ls); ctx.fillStyle = s.color;
    ctx.fillText(s.t, cx + (s.gap || 0), baseY); cx += widths[i];
  });
  return cx;
}
function text(ctx, t, x, top, lineH, weight, size, color, ls) {
  setFont(ctx, weight, size, ls); ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(t, x, baseline(top, lineH, size));
}
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ── 로고 ──
const logoCache = new Map();
async function fetchLogo(url) {
  if (!url || typeof url !== 'string') return null;
  if (logoCache.has(url)) return logoCache.get(url);
  let img = null;
  try {
    let buf;
    if (url.startsWith('data:image/')) buf = Buffer.from(url.split(',')[1], 'base64');
    else if (/^https?:\/\//i.test(url)) {
      const r = await fetch(url, { timeout: 7000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error('logo ' + r.status);
      buf = await r.buffer();
    } else throw new Error('unsupported logo url');
    const flat = await sharp(buf).flatten({ background: '#ffffff' }).png().toBuffer();
    let out = flat;
    try { out = await sharp(flat).trim({ background: '#ffffff', threshold: 12 }).png().toBuffer(); } catch (e) { /* 단색 이미지 */ }
    img = await loadImage(out);
    if (!img.width || !img.height) img = null;
  } catch (e) { img = null; }
  if (logoCache.size > 300) logoCache.clear();
  logoCache.set(url, img);
  return img;
}
// 흰 타일 안에 로고를 비율 유지로 넣는다. 로고가 없으면 회사명을 글자로 적는다.
function drawTile(ctx, x, y, img, name, bordered) {
  const TW = 168, TH = 84, MW = 136, MH = 60;
  rrect(ctx, x, y, TW, TH, 18); ctx.fillStyle = C.white; ctx.fill();
  if (bordered) { rrect(ctx, x + 0.5, y + 0.5, TW - 1, TH - 1, 18); ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke(); }
  if (img) {
    const k = Math.min(MW / img.width, MH / img.height);
    const w = img.width * k, h = img.height * k;
    ctx.save(); rrect(ctx, x, y, TW, TH, 18); ctx.clip();
    ctx.drawImage(img, x + (TW - w) / 2, y + (TH - h) / 2, w, h); ctx.restore();
  } else if (name) {
    setFont(ctx, 700, 22, -0.02); ctx.fillStyle = C.ink;
    const lines = wrap(ctx, clean(name), MW + 8, 2);
    const lh = 27, top = y + (TH - lines.length * lh) / 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    lines.forEach((l, i) => ctx.fillText(l, x + TW / 2, baseline(top + i * lh, lh, 22)));
    ctx.textAlign = 'left';
  }
}

// ── 공통: 상단 날짜 줄 (커버 · 마지막 장) ──
function drawDateRow(ctx, date, day, label, labelColor, dayColor, inkColor) {
  const by = baseline(PT, 132, 132);
  drawSegs(ctx, [
    { t: clean(date), w: 700, size: 132, ls: -0.04, color: inkColor || C.ink },
    { t: clean(day || ''), w: 600, size: 56, color: dayColor || C.gray, gap: 18 },
  ], PX, by);
  if (label) {
    setFont(ctx, 700, 44); ctx.fillStyle = labelColor; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, W - PX, baseline(PT + 18, normalLH(44), 44)); ctx.textAlign = 'left';
  }
}

// ── 커버 ──
async function drawCover(ctx, b) {
  const ax = axisOf(b.axis);
  ctx.fillStyle = ax.tint; ctx.fillRect(0, 0, W, H);
  drawDateRow(ctx, b.date, b.day, clean(b.label || ax.label), ax.accent);

  const LH = 175.5, top1 = 448.5;
  const theme = clean(b.theme);
  const s1 = fitSize(ctx, theme, 700, 150, 84, -0.045, CW);
  text(ctx, theme, PX, top1, LH, 700, s1, C.ink, -0.045);
  const count = b.count != null ? b.count : 5;
  drawSegs(ctx, [
    { t: clean(b.count_prefix || '공고') + ' ', w: 700, size: 150, ls: -0.045, color: C.ink },
    { t: clean(b.count_text || `${count}곳`), w: 700, size: 150, ls: -0.045, color: ax.accent },
  ], PX, baseline(top1 + LH, LH, 150));

  const sub = clean(b.sub || (b.open_total != null ? `지금 열려 있는 ${Number(b.open_total).toLocaleString('en-US')}건에서 골랐어요` : ''));
  if (sub) { setFont(ctx, 500, 40); text(ctx, ellipsize(ctx, sub, CW), PX, top1 + LH * 2 + 38, normalLH(40), 500, 40, C.sub); }

  const logos = (Array.isArray(b.logos) ? b.logos : []).slice(0, 5);
  const imgs = await Promise.all(logos.map((l) => fetchLogo(l && (l.url || l.logo))));
  logos.forEach((l, i) => drawTile(ctx, PX + i * 184, 1110, imgs[i], l && l.name, false));
  text(ctx, clean(b.brand || '헤이코리안 구인구직'), PX, 1230, normalLH(30), 600, 30, C.gray);
}

// ── 공고 내지 ──
// 급여 공개가 법으로 의무인 주 (2026-11-14 확인, 주 법 기준). 이 주의 공고는 급여 금액이 없으면 쓰지 않는다.
// 바뀌는 법이라 분기마다 다시 확인한다. 델라웨어는 2027-09-26 시행 예정.
const PAY_REQUIRED_STATES = new Set(['CA', 'CO', 'CT', 'DC', 'HI', 'IL', 'ME', 'MD', 'MA', 'MN', 'NJ', 'NY', 'VT', 'VA', 'WA']);
// 단위별로 말이 되는 금액 범위(USD). 벗어나면 잘못 적은 급여로 본다. ($1, 월급을 연봉으로 적은 $4,000 등)
const PAY_RANGE = { '시급': [7.25, 200], '일급': [60, 1500], '주급': [250, 6000], '월급': [1000, 25000], '연봉': [15000, 600000] };
// kind: 'amount' 금액 있음 · 'nego' 협의 등 금액 없음 · 'none' 비어 있음.  bad: 금액이 있는데 믿을 수 없는 이유
function payInfo(pay, unit) {
  const t = clean(pay), u = clean(unit);
  if (!t) return { kind: 'none' };
  const nums = (t.match(/[0-9][0-9,]*(?:\.[0-9]+)?/g) || []).map((n) => Number(n.replace(/,/g, '')));
  if (!nums.length) return { kind: 'nego' };
  const range = PAY_RANGE[u];
  if (!range) return { kind: 'amount', nums, bad: `급여 단위가 "${u || '없음'}"이에요. 시급, 일급, 주급, 월급, 연봉 중 하나여야 해요.` };
  const lo = Math.min(...nums), hi = Math.max(...nums);
  if (lo < range[0]) {
    const hint = u === '연봉' && hi >= PAY_RANGE['월급'][0] && hi <= PAY_RANGE['월급'][1] ? ' 월급을 연봉으로 잘못 적은 공고일 수 있어요.' : '';
    return { kind: 'amount', nums, bad: `${u} $${lo.toLocaleString('en-US')}는 실제 급여로 볼 수 없어요.${hint}` };
  }
  if (hi > range[1]) return { kind: 'amount', nums, bad: `${u} $${hi.toLocaleString('en-US')}는 실제 급여로 볼 수 없어요. 단위가 잘못됐을 수 있어요.` };
  return { kind: 'amount', nums };
}
const isRealPay = (pay, unit) => { const i = payInfo(pay, unit); return i.kind === 'amount' && !i.bad; };
const arr = (v) => (Array.isArray(v) ? v : (v ? String(v).split(/\n/) : [])).map(clean).filter(Boolean);

// 내용이 넘치면 단계적으로 줄인다: 부가 설명 제거 → 항목 1줄 → 항목 수 축소
function planJob(ctx, b, level) {
  const maxLines = level >= 1 ? 1 : 2;
  const maxTasks = level >= 3 ? 2 : 3, maxNeeds = level >= 2 ? 1 : 2;
  const ops = []; let y = PT + 84 + 44;                     // 로고 줄 아래
  const add = (h, fn) => { ops.push({ y, fn }); y += h; };

  setFont(ctx, 500, 34);
  const co = ellipsize(ctx, clean(b.company), CW);
  if (co) add(normalLH(34) + 10, (yy) => text(ctx, co, PX, yy, normalLH(34), 500, 34, C.gray));

  let rs = 82; setFont(ctx, 700, rs, -0.035);
  let role = wrap(ctx, clean(b.role), CW);
  if (role.length > 2) { rs = 68; setFont(ctx, 700, rs, -0.035); role = wrap(ctx, clean(b.role), CW, 2); }
  const rlh = rs * 1.18;
  add(role.length * rlh, (yy) => role.forEach((l, i) => text(ctx, l, PX, yy + i * rlh, rlh, 700, rs, C.ink, -0.035)));

  const meta = [b.where, b.employment_type, b.experience].map(clean).filter(Boolean).join(' · ');
  if (meta) { y += 20; setFont(ctx, 500, 34); const m = ellipsize(ctx, meta, CW); add(normalLH(34), (yy) => text(ctx, m, PX, yy, normalLH(34), 500, 34, C.sub)); }

  const pay = clean(b.pay), unit = clean(b.pay_unit);
  if (pay) {
    y += 38;
    if (isRealPay(pay, unit)) {
      const ps = fitSize(ctx, pay, 700, 62, 44, -0.03, CW - 110);
      add(normalLH(62), (yy) => drawSegs(ctx, [
        { t: pay, w: 700, size: ps, ls: -0.03, color: C.green },
        { t: unit, w: 500, size: 34, color: C.green, gap: 16 },
      ], PX, baseline(yy, normalLH(62), 62)));
    } else add(normalLH(46), (yy) => text(ctx, pay, PX, yy, normalLH(46), 600, 46, C.sub));
  }
  const visa = clean(b.visa);
  if (visa) { y += 10; setFont(ctx, 600, 34); const v = ellipsize(ctx, visa, CW); add(normalLH(34), (yy) => text(ctx, v, PX, yy, normalLH(34), 600, 34, C.green)); }

  y += 40; add(1, (yy) => { ctx.fillStyle = C.line; ctx.fillRect(PX, yy, CW, 1); }); y += 36;

  const accent = axisOf(b.axis).accent;
  const block = (label, items) => {
    if (!items.length) return;
    add(normalLH(28) + 14, (yy) => text(ctx, label, PX, yy, normalLH(28), 600, 28, C.gray));
    const LH = 37 * 1.45;
    items.forEach((it, idx) => {
      setFont(ctx, 500, 37);
      const lines = wrap(ctx, it, CW - 30, maxLines);
      add(lines.length * LH + 8, (yy) => {
        ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(PX + 4.5, yy + 0.6 * 37 + 4.5, 4.5, 0, Math.PI * 2); ctx.fill();
        lines.forEach((l, i) => text(ctx, l, PX + 30, yy + i * LH, LH, 500, 37, C.ink));
      });
    });
    y += 32;
  };
  block(clean(b.tasks_label || '하는 일'), arr(b.tasks).slice(0, maxTasks));
  block(clean(b.needs_label || '필요한 것'), arr(b.needs).slice(0, maxNeeds));

  const extra = clean(b.extra);
  if (extra && level < 1) { setFont(ctx, 500, 32); const e = ellipsize(ctx, extra, CW); add(normalLH(32), (yy) => text(ctx, e, PX, yy, normalLH(32), 500, 32, C.sub)); }
  return { ops, end: y };
}
async function drawJob(ctx, b) {
  ctx.fillStyle = C.white; ctx.fillRect(0, 0, W, H);
  const img = await fetchLogo(b.logo_url);
  drawTile(ctx, PX, PT, img, b.company, true);
  if (b.index && b.total) {
    drawSegs(ctx, [
      { t: String(b.index).padStart(2, '0'), w: 700, size: 30, color: C.ink },
      { t: ' / ' + String(b.total).padStart(2, '0'), w: 500, size: 30, color: C.gray },
    ], W - PX, baseline(PT + (84 - normalLH(30)) / 2, normalLH(30), 30), 'right');
  }
  const footTop = H - PB - normalLH(30);
  let plan;
  for (let level = 0; level <= 3; level++) { plan = planJob(ctx, b, level); if (plan.end <= footTop - 20) break; }
  plan.ops.forEach((o) => o.fn(o.y));

  const dl = clean(b.deadline);
  if (dl) text(ctx, dl, PX, footTop, normalLH(30), 600, 30, C.gray);
  const tag = [clean(b.date), clean(b.theme)].filter(Boolean).join(' · ');
  if (tag) { setFont(ctx, 600, 30); ctx.fillStyle = C.gray; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(tag, W - PX, baseline(footTop, normalLH(30), 30)); ctx.textAlign = 'left'; }
}

// ── 목록 장 ──
// 상세 카드로 쓰기엔 원문이 짧은 업종(식당, 네일, 병원 사무 등)용. 한 장에 5곳까지, 공고의 등록 칸 값만 싣는다.
function drawList(ctx, b) {
  const ax = axisOf(b.axis);
  ctx.fillStyle = C.white; ctx.fillRect(0, 0, W, H);
  text(ctx, clean(b.theme), PX, PT, normalLH(52), 700, 52, ax.accent, -0.035);
  if (b.page && b.pages) {
    drawSegs(ctx, [
      { t: String(b.page).padStart(2, '0'), w: 700, size: 30, color: C.ink },
      { t: ' / ' + String(b.pages).padStart(2, '0'), w: 500, size: 30, color: C.gray },
    ], W - PX, baseline(PT + (normalLH(52) - normalLH(30)) / 2, normalLH(30), 30), 'right');
  }
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 5);
  const top = 206, rowH = 200, start = Number(b.start_index) || 1, tx = PX + 76;
  items.forEach((it, i) => {
    const y = top + i * rowH;
    if (i > 0) { ctx.fillStyle = C.line; ctx.fillRect(PX, y, CW, 1); }
    text(ctx, String(start + i).padStart(2, '0'), PX, y + 44, 62, 700, 30, ax.accent);
    const role = clean(it.role);
    const rs = fitSize(ctx, role, 700, 52, 38, -0.035, W - PX - tx);
    text(ctx, role, tx, y + 34, 62, 700, rs, C.ink, -0.035);
    const dl = clean(it.deadline);
    drawSegs(ctx, [
      { t: clean(it.pay), w: 700, size: 38, ls: -0.03, color: C.green },
      { t: clean(it.pay_unit), w: 500, size: 30, color: C.green, gap: 12 },
      { t: dl ? '  ·  ' + dl : '', w: 500, size: 30, color: C.gray },
    ], tx, baseline(y + 100, 46, 38));
    setFont(ctx, 500, 30);
    const sub = ellipsize(ctx, [clean(it.company), clean(it.city)].filter(Boolean).join(' · '), W - PX - tx);
    text(ctx, sub, tx, y + 150, normalLH(30), 500, 30, C.gray);
  });
  const footTop = H - PB - normalLH(30);
  text(ctx, clean(b.brand || '헤이코리안 구인구직'), PX, footTop, normalLH(30), 600, 30, C.gray);
  const tag = clean(b.date);
  if (tag) { setFont(ctx, 600, 30); ctx.fillStyle = C.gray; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(tag + ' 기준', W - PX, baseline(footTop, normalLH(30), 30)); ctx.textAlign = 'left'; }
}

// ── 마지막 장 ──
function drawCta(ctx, b) {
  const ax = axisOf(b.axis);
  ctx.fillStyle = ax.tint; ctx.fillRect(0, 0, W, H);
  drawDateRow(ctx, b.date, b.day, clean(b.label || ax.label), ax.accent);
  const LH = 118 * 1.22, top = 449;
  const hasTotal = b.open_total != null && b.open_total !== '';
  const custom = b.headline_pre || b.headline_num || b.headline_post;
  const num = clean(b.headline_num || (hasTotal ? `${Number(b.open_total).toLocaleString('en-US')}건` : ''));
  const pre = clean(b.headline_pre || (hasTotal || custom ? '지금' : '다른 공고도'));
  const post = clean(b.headline_post || (hasTotal || custom ? '열려 있어요' : '더 있어요'));
  drawSegs(ctx, [
    { t: pre + (num ? ' ' : ''), w: 700, size: 118, ls: -0.04, color: C.ink },
    { t: num, w: 700, size: 118, ls: -0.04, color: ax.accent },
  ], PX, baseline(top, LH, 118));
  text(ctx, post, PX, top + LH, LH, 700, 118, C.ink, -0.04);
  const tail = ['지역과 직군으로 걸러서 보려면', '프로필 링크로 가면 돼요.'];
  const body = arr(b.body && b.body.length ? b.body : (hasTotal && b.count ? [`${b.count}곳은 그중 일부예요.`, ...tail] : tail)).slice(0, 3);
  body.forEach((l, i) => text(ctx, l, PX, top + LH * 2 + 40 + i * 64, 64, 500, 40, C.sub));
  const footTop = H - PB - normalLH(30);
  const dd = String(b.data_date || '').split('.');
  const asOf = dd.length === 2 ? `${Number(dd[0])}월 ${Number(dd[1])}일` : '게시일';
  const note = clean(b.note == null ? `공고 내용은 ${asOf} 기준이에요. 지원 전에 회사에 확인하세요.` : b.note);
  if (note) { setFont(ctx, 500, 30); text(ctx, ellipsize(ctx, note, CW), PX, footTop - 48, normalLH(30), 500, 30, C.gray); }
  text(ctx, clean(b.foot || '저장해두고 관심 있는 공고에 지원하세요'), PX, footTop, normalLH(30), 600, 30, C.gray);
}

// 카드에 싣지 않는 표현. 성별·나이 조건은 미국 고용 차별 금지 규정에 걸릴 수 있고,
// 신분 무관·현금 지급은 계정이 불법 고용을 알선하는 것처럼 보이게 한다.
const BLOCKED = [
  { re: /(여성|남성|여자|남자)\s*(분|직원|만|우대|환영|구함|모집)|[0-9]{2}\s*(세|살)\s*(이하|미만|까지)|[2-6]0\s*대|미혼|기혼|용모\s*단정|외모/, why: '성별, 나이, 결혼 여부, 외모 조건이 들어 있어요. 이런 조건이 있는 공고는 쓰지 않아요.' },
  { re: /신분\s*(무관|불문|상관\s*없|안\s*봄)|캐[시쉬]\s*(지급|페이)|현금\s*지급|세금\s*보고\s*(안|없)/, why: '신분 무관, 현금 지급 같은 표현이 들어 있어요. 이런 조건이 있는 공고는 쓰지 않아요.' },
];

// ── 검수 ──
// 잘라서 버티는 건 마지막 안전장치다. 기준에 못 미치거나 넘치는 카드는 그리지 않고 사유를 돌려준다.
const koLen = (t) => String(t).replace(/\s/g, '').length;
function checkCard(b) {
  b = b || {};
  const ctx = createCanvas(10, 10).getContext('2d');
  const issues = [];
  const px = (t, w, size, ls) => { setFont(ctx, w, size, ls); return ctx.measureText(clean(t)).width; };
  const over = (field, t, w, size, ls, max, what) => {
    const width = px(t, w, size, ls);
    if (width > max) {
      const per = px('가나다라마바사아자차', w, size, ls) / 10;
      issues.push({ field, problem: 'too_long', text: clean(t), detail: `${what} 한 줄을 넘어요. 한글 기준 약 ${Math.ceil((width - max) / per)}자 줄여야 해요.` });
    }
  };
  const need = (field, ok, detail) => { if (!ok) issues.push({ field, problem: 'missing', detail }); };

  if (b.type === 'job') {
    const tasks = arr(b.tasks), needs = arr(b.needs);
    need('role', clean(b.role), '직무명이 없어요.');
    need('company', clean(b.company), '회사명이 없어요.');
    need('where', clean(b.where), '근무지가 없어요.');
    const state = clean(b.state).toUpperCase();
    need('state', /^[A-Z]{2}$/.test(state), '근무지의 주 코드(state)가 없어요. 예: NY');
    const pi = payInfo(b.pay, b.pay_unit);
    need('pay', pi.kind !== 'none', '급여가 없어요. 금액이 없으면 "면접 후 협의"로 적어요.');
    if (pi.bad) issues.push({ field: 'pay', problem: 'invalid_pay', detail: pi.bad + ' 이 공고는 쓰지 않아요.' });
    if (pi.kind !== 'amount' && PAY_REQUIRED_STATES.has(state)) issues.push({ field: 'pay', problem: 'pay_required', detail: `${state}는 급여 공개가 의무인 주예요. 급여 금액이 없는 공고는 쓰지 않아요.` });
    need('tasks', tasks.length >= 2, `하는 일이 ${tasks.length}개예요. 최소 2개가 필요해요.`);
    need('tasks', tasks.length < 2 || koLen(tasks.join('')) >= 14, '하는 일이 너무 짧아요. 무슨 일을 하는지 알 수 있을 만큼 적어요.');
    need('needs', needs.length >= 1, '필요한 것이 없어요. 최소 1개가 필요해요.');
    if (tasks.length > 3) issues.push({ field: 'tasks', problem: 'too_many', detail: `하는 일이 ${tasks.length}개예요. 3개까지만 들어가요.` });
    if (needs.length > 2) issues.push({ field: 'needs', problem: 'too_many', detail: `필요한 것이 ${needs.length}개예요. 2개까지만 들어가요.` });
    if (clean(b.role)) over('role', b.role, 700, 82, -0.035, CW, '직무명이');
    if (clean(b.company)) over('company', b.company, 500, 34, -0.02, CW, '회사명이');
    const meta = [b.where, b.employment_type, b.experience].map(clean).filter(Boolean).join(' · ');
    if (meta) over('meta', meta, 500, 34, -0.02, CW, '지역·고용형태·경력 줄이');
    if (clean(b.pay) && isRealPay(b.pay, b.pay_unit)) over('pay', b.pay, 700, 62, -0.03, CW - 110, '급여가');
    if (clean(b.visa)) over('visa', b.visa, 600, 34, -0.02, CW, '비자 줄이');
    tasks.forEach((t, i) => over(`tasks[${i}]`, t, 500, 37, -0.02, CW - 30, '하는 일 항목이'));
    needs.forEach((t, i) => over(`needs[${i}]`, t, 500, 37, -0.02, CW - 30, '필요한 것 항목이'));
    if (clean(b.extra)) over('extra', b.extra, 500, 32, -0.02, CW, '부가 설명이');
    const cardText = [b.role, b.extra, ...tasks, ...needs].map(clean).join(' / ');
    const hit = BLOCKED.find((r) => r.re.test(cardText));
    if (hit) issues.push({ field: 'card', problem: 'not_allowed', detail: hit.why });
    if (!issues.length) {
      const plan = planJob(ctx, b, 0);
      if (plan.end > H - PB - normalLH(30) - 20) issues.push({ field: 'card', problem: 'overflow', detail: '내용이 카드 높이를 넘어요. 항목을 줄여요.' });
    }
  } else if (b.type === 'list') {
    const items = Array.isArray(b.items) ? b.items : [];
    need('theme', clean(b.theme), '주제가 없어요.');
    need('items', items.length >= 1 && items.length <= 5, `목록 한 장에는 1~5곳이 들어가요. 지금 ${items.length}곳이에요.`);
    items.forEach((it, i) => {
      const f = `items[${i}]`;
      need(f, clean(it.role) && clean(it.company) && clean(it.city), '직무, 회사, 근무 도시가 모두 있어야 해요.');
      const pi = payInfo(it.pay, it.pay_unit);
      // 목록 장은 급여를 나란히 놓고 보는 형식이라 금액이 있는 공고만 싣는다
      if (pi.kind !== 'amount') issues.push({ field: f, problem: 'pay_required', detail: '목록 형식에는 급여 금액이 있는 공고만 실어요.' });
      else if (pi.bad) issues.push({ field: f, problem: 'invalid_pay', detail: pi.bad + ' 이 공고는 쓰지 않아요.' });
      if (clean(it.role)) over(f + '.role', it.role, 700, 38, -0.035, CW - 76, '직무명이');
      const hit = BLOCKED.find((r) => r.re.test(clean(it.role)));
      if (hit) issues.push({ field: f, problem: 'not_allowed', detail: hit.why });
    });
  } else if (b.type === 'cover') {
    need('date', clean(b.date), '날짜가 없어요.');
    need('theme', clean(b.theme), '주제가 없어요.');
    const logos = Array.isArray(b.logos) ? b.logos : [];
    const count = b.count != null ? Number(b.count) : 5;
    need('logos', logos.length === count, `로고가 ${logos.length}개인데 공고는 ${count}곳이에요. 수가 같아야 해요.`);
    const sub = b.sub || (b.open_total != null ? `지금 열려 있는 ${Number(b.open_total).toLocaleString('en-US')}건에서 골랐어요` : '');
    if (sub) over('sub', sub, 500, 40, -0.02, CW, '커버 설명 줄이');
  } else if (b.type === 'cta') {
    need('date', clean(b.date), '날짜가 없어요.');
    arr(b.body).forEach((t, i) => over(`body[${i}]`, t, 500, 40, -0.02, CW, '본문 줄이'));
  } else {
    issues.push({ field: 'type', problem: 'missing', detail: 'type 은 cover | job | list | cta 중 하나예요.' });
  }
  return { ok: issues.length === 0, issues };
}

// ── 묶음 검수 ──
// 공고 후보를 받아 규칙을 통과한 것만으로 한 묶음(커버 + 내지 + 마지막 장)을 짠다.
// 커버의 "N곳"이 실제 카드 수와 어긋나지 않도록, 그리기 전에 반드시 이걸 거친다.
function planBundle(b) {
  b = b || {};
  const issues = [], rejected = [];
  const meta = { axis: b.axis, date: b.date, day: b.day, theme: b.theme };
  if (!clean(b.date) || !clean(b.theme)) issues.push({ field: 'bundle', problem: 'missing', detail: '날짜와 주제가 필요해요.' });
  if (b.format === 'list') return planList(b, meta, issues);
  const max = Math.min(Number(b.max) || 5, 5), min = Number(b.min) || 3;
  const seen = new Set(), perCat = {}, picked = [];
  for (const j of Array.isArray(b.jobs) ? b.jobs : []) {
    const card = { ...j, ...meta, type: 'job' };
    const name = clean(j.company);
    const key = name.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
    const res = checkCard(card);
    let why = res.ok ? null : res.issues.map((i) => i.detail).join(' ');
    if (!why && seen.has(key)) why = '같은 회사가 이미 묶음에 있어요.';
    const cat = clean(j.category);
    if (!why && cat && (perCat[cat] || 0) >= 2) why = '같은 직군이 이미 2곳 있어요.';
    if (!why && picked.length >= max) why = `묶음은 ${max}곳까지예요.`;
    if (why) { rejected.push({ company: name, role: clean(j.role), source_url: j.source_url, reason: why }); continue; }
    seen.add(key); if (cat) perCat[cat] = (perCat[cat] || 0) + 1; picked.push(card);
  }
  if (picked.length < min) issues.push({ field: 'bundle', problem: 'too_few', detail: `기준을 통과한 공고가 ${picked.length}곳이에요. ${min}곳이 안 되면 이 주제는 건너뛰어요.` });
  const withPay = picked.filter((c) => isRealPay(c.pay, c.pay_unit)).length;
  if (picked.length && withPay * 2 < picked.length) issues.push({ field: 'bundle', problem: 'pay_ratio', detail: `급여 금액이 있는 공고가 ${picked.length}곳 중 ${withPay}곳이에요. 절반 이상이어야 해요.` });
  const ok = issues.length === 0;
  const cards = !ok ? [] : [
    { ...meta, type: 'cover', count: picked.length, open_total: b.open_total, logos: picked.map((c) => ({ url: c.logo_url, name: c.company })) },
    ...picked.map((c, i) => ({ ...c, index: i + 1, total: picked.length })),
    { ...meta, type: 'cta', open_total: b.open_total, count: picked.length, data_date: b.data_date },
  ];
  return { ok, count: picked.length, issues, rejected, cards };
}

// 목록형 묶음: 원문이 짧은 업종. 5~15곳, 한 장에 5곳까지, 장은 고르게 나눈다.
function planList(b, meta, issues) {
  const rejected = [], picked = [], seen = new Set();
  const max = Math.min(Number(b.max) || 15, 15), min = Math.max(Number(b.min) || 5, 5);
  for (const j of Array.isArray(b.jobs) ? b.jobs : []) {
    const item = { role: j.role, company: j.company, city: j.where, pay: j.pay, pay_unit: j.pay_unit, deadline: j.deadline, source_url: j.source_url };
    const name = clean(j.company);
    const key = name.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
    const res = checkCard({ type: 'list', theme: meta.theme, items: [item] });
    let why = res.ok ? null : res.issues.map((i) => i.detail).join(' ');
    if (!why && seen.has(key)) why = '같은 회사가 이미 묶음에 있어요.';
    if (!why && picked.length >= max) why = `목록형은 ${max}곳까지예요.`;
    if (why) { rejected.push({ company: name, role: clean(j.role), source_url: j.source_url, reason: why }); continue; }
    seen.add(key); picked.push({ ...item, logo_url: j.logo_url });
  }
  if (picked.length < min) issues.push({ field: 'bundle', problem: 'too_few', detail: `기준을 통과한 공고가 ${picked.length}곳이에요. 목록형은 ${min}곳이 안 되면 이 주제는 건너뛰어요.` });
  const ok = issues.length === 0;
  if (!ok) return { ok, count: picked.length, issues, rejected, cards: [] };
  const pages = Math.ceil(picked.length / 5), base = Math.floor(picked.length / pages), extra = picked.length % pages;
  const lists = []; let at = 0;
  for (let p = 0; p < pages; p++) {
    const n = base + (p < extra ? 1 : 0);
    lists.push({ ...meta, type: 'list', page: p + 1, pages, start_index: at + 1, items: picked.slice(at, at + n).map(({ logo_url, ...it }) => it) });
    at += n;
  }
  const cards = [
    { ...meta, type: 'cover', count: picked.length, open_total: b.open_total, logos: picked.slice(0, 5).map((c) => ({ url: c.logo_url, name: c.company })) },
    ...lists,
    { ...meta, type: 'cta', open_total: b.open_total, count: picked.length, data_date: b.data_date },
  ];
  return { ok, count: picked.length, issues, rejected, cards };
}

// ── 진입점 ──
async function renderV2(b) {
  b = b || {};
  if (!['cover', 'job', 'list', 'cta'].includes(b.type)) throw Object.assign(new Error('type 은 cover | job | list | cta 중 하나'), { status: 400 });
  // strict 가 기본. 기준 미달·넘침이 있으면 그리지 않는다. 시험용으로만 "strict": false 를 쓴다.
  if (b.strict !== false) {
    const res = checkCard(b);
    if (!res.ok) throw Object.assign(new Error('카드 기준에 맞지 않아 그리지 않았어요'), { status: 422, issues: res.issues });
  }
  const canvas = createCanvas(W, H); const ctx = canvas.getContext('2d');
  if (b.type === 'cover') await drawCover(ctx, b);
  else if (b.type === 'job') await drawJob(ctx, b);
  else if (b.type === 'list') drawList(ctx, b);
  else drawCta(ctx, b);
  return canvas.toBuffer('image/png');
}

module.exports = function attach(app) {
  app.post('/render/v2', async (req, res) => {
    try {
      const out = await renderV2(req.body);
      res.set('Content-Type', 'image/png'); res.set('Content-Length', out.length); res.send(out);
    } catch (err) {
      if (!err.status) console.error('Render v2 error:', err);
      res.status(err.status || 500).json({ error: err.message, issues: err.issues });
    }
  });
  // 공고 후보 목록을 받아 한 묶음을 짠다. cards 를 순서대로 /render/v2 에 넣으면 된다.
  app.post('/render/v2/bundle', (req, res) => {
    try { res.json(planBundle(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
  });
  // 그리지 않고 검수만 한다. 항상 200 으로 { ok, issues } 를 돌려준다.
  app.post('/render/v2/check', (req, res) => {
    try { res.json(checkCard(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
  });
};
module.exports.renderV2 = renderV2;
module.exports.checkCard = checkCard;
module.exports.planBundle = planBundle;
module.exports.payInfo = payInfo;
module.exports.PAY_REQUIRED_STATES = PAY_REQUIRED_STATES;
