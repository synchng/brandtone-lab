// 화면 UI (customer-facing robot screen): layout JSON + UiKit → one list of drawing primitives,
// drawn by a Canvas renderer (robot face / chest display) and an SVG renderer (editor preview, Figma export).
// Both renderers only read the primitive list, so they draw exactly the same thing. Shared by the BrandTone app and the sim.
// The look comes from a design STYLE picked to fit the brand: crisp 'clean', soft game-like 'soft', handwritten 'paper', loud 'bold'.

export const REF = { W: 760, H: 348 };   // the Figma W12-A screen; every size below is in these units, scaled to the target
export const NAMES = { StatusPill: '상태 알약', BigNumberCard: '큰 숫자 카드', ActionButton: '버튼', RobotIllustration: '로봇 그림', MenuCard: '메뉴 카드', Greeting: '인사말' };

/** design styles. Colours / radii / font per style; `accent` is only the default (the kit or an element can override it) */
export const STYLES = {
  clean: { label: '정돈 · 클린', desc: '얇은 선, 단정한 고딕', font: 'Noto Sans KR', w: 700, wBody: 500, card: '#FFFFFF', line: '#E5E5EA', lineW: 1, cardR: 20, accent: '#0A84FF', ink: '#1D1D1F', number: null },
  soft: { label: '말랑 · 게임', desc: '하늘빛 배경, 동글한 카드와 통통한 버튼', font: 'Jua', w: 400, wBody: 400, card: '#FBF6E4', line: null, lineW: 0, cardR: 28, accent: '#F7A61B', ink: '#4A3B2C', number: '#5B4636',
    bg: ['#B6F2E6', '#DDF6BE'], shadow: [0, 6, 'rgba(91,70,54,0.14)'], btnShadow: [0, 5, '#D9890C'] },
  paper: { label: '다이어리 · 스크랩북', desc: '줄노트 종이, 손글씨, 테이프와 스티커', font: 'Gaegu', w: 700, wBody: 700, card: '#FFFDF7', line: '#C9B79A', lineW: 1.5, dash: [6, 5], cardR: 6, accent: '#2A8BD0', ink: '#4B3A2E', number: null,
    bg: '#FBF3E2', tilt: [-1.6, 1.2, -0.8], shadow: [2, 3, 'rgba(75,58,46,0.12)'] },
  bold: { label: '팝 · 볼드', desc: '원색 배경, 굵은 테두리와 그림자', font: 'Do Hyeon', w: 400, wBody: 400, card: '#FFFFFF', line: '#111111', lineW: 3, cardR: 14, accent: '#111111', ink: '#111111', number: '#FF4D2E',
    bg: '#FFE14D', shadow: [6, 6, '#111111'], btnShadow: [5, 5, '#FF4D2E'] },
};
/** load the style fonts (Google Fonts, linked in the page) so canvases draw with them; resolves when ready */
export const FONTS_READY = typeof document !== 'undefined' && document.fonts
  ? Promise.all(['Jua', 'Gaegu', 'Do Hyeon'].map(f => document.fonts.load(`700 20px "${f}"`))).catch(() => {}) : Promise.resolve();

/** text width estimate shared by both renderers (Hangul ≈ 1 em), so wrapping / fitting decisions are identical */
export function textWidth(s, px) {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᇿ㄰-㆏가-힣]/.test(ch) ? 1 : /[A-Z0-9#₩%]/.test(ch) ? 0.62 : ch === ' ' ? 0.3 : 0.55;
  return w * px;
}
const fit = (s, px, maxW, min) => { while (textWidth(s, px) > maxW && px > min) px -= 1; return px; };
const hex = c => /^#[0-9a-f]{6}/i.test(c) ? c : '#ffffff';
const lum = c => { const n = parseInt(hex(c).slice(1, 7), 16), f = v => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; return 0.2126 * f(n >> 16) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255); };
/** WCAG contrast ratio of two #rrggbb colours */
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(1); };
const ink = c => (lum(c) > 0.35 ? '#1D1D1F' : '#FFFFFF');
const star = (cx, cy, r) => { let d = ''; for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.45 : r, a = -Math.PI / 2 + i * Math.PI / 5; d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`; } return d + 'Z'; };

/** the layout JSON → { W, H, bg, deco, groups: [{ id, kind, name, box, rot, prims }] } for a W × H screen. vars fill '{table}' etc. */
export function layoutScreen(layout, kit, W, H, vars = {}) {
  const S = STYLES[kit.style] ?? STYLES.clean, clean = S === STYLES.clean;
  const fill = s => (s ?? '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  const els = layout.elements, has = slot => els.some(e => e.slot === slot);
  const chest = W / H >= 3, u = chest ? H / 100 : H / REF.H, fs = kit.font || 1;
  // clean follows the kit's own background (white / dark / brand colour); the other styles bring their own scene
  const bg = layout.bg ?? (clean ? kit.bg : S.bg), bgMid = Array.isArray(bg) ? bg[1] : bg;
  const dark = clean && lum(kit.bg) < 0.2, card = dark ? '#2C2C30' : S.card, line = dark ? '#3A3A3E' : S.line, inkC = dark ? '#FFFFFF' : S.ink;
  const pillR = h => clean ? ({ pill: h / 2, round: Math.min(h / 2, 12 * u), square: 4 * u })[kit.shape] ?? 12 * u : S === STYLES.paper ? 6 * u : S === STYLES.bold ? 12 * u : h / 2;
  const groups = [], deco = [];
  const text = (s, x, y, px, color, weight = S.w, anchor = 'middle', on = card) => ({ t: 'text', s, x, y, px, fill: color, weight, anchor, on, font: S.font });
  // a card = optional hard shadow + the body (+ dashed outline on paper, washi tape on top)
  const cardPrims = (b, r, fillC = card, tape = false) => [
    ...(S.shadow ? [{ t: 'rect', x: b.x + S.shadow[0] * u, y: b.y + S.shadow[1] * u, w: b.w, h: b.h, r, fill: S.shadow[2] }] : []),
    { t: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, r, fill: fillC, ...(line ? { stroke: line, sw: S.lineW * u, ...(S.dash ? { dash: S.dash.map(v => v * u) } : {}) } : {}) },
    ...(tape && S === STYLES.paper ? [{ t: 'rect', x: b.x + b.w / 2 - 34 * u, y: b.y - 9 * u, w: 68 * u, h: 18 * u, r: 2 * u, fill: 'rgba(132,199,232,0.55)' }] : []),
  ];
  let gi = 0;
  // what was changed in Figma wins over the style: fill of the element's body, text colour / font / size, rotation
  const figma = (e, box, prims) => {
    const body = prims.find(p => p.t === 'rect' && p.x === box.x && p.y === box.y && p.w === box.w && p.h === box.h), texts = e.kind === 'RobotIllustration' ? [] : prims.filter(p => p.t === 'text');
    if (body) body.role = 'body';
    if (e.fill && body) { body.fill = e.fill; texts.forEach(p => (p.on = e.fill)); }
    for (const p of texts) { p.role = 'text'; if (e.ink) p.fill = e.ink; if (e.font) p.font = e.font; if (e.weight) p.weight = e.weight; if (e.fontPx) p.px = e.fontPx * u; }
    return prims;
  };
  const put = (e, box, prims) => { const a = e.rot ?? (S.tilt ? S.tilt[gi % S.tilt.length] : 0); gi++; prims = figma(e, box, prims); groups.push({ id: e.id, kind: e.kind, name: NAMES[e.kind] || e.kind, box, rot: a ? { a, cx: box.x + box.w / 2, cy: box.y + box.h / 2 } : null, prims }); };

  // scene decoration behind the content
  if (S === STYLES.soft && !chest) deco.push({ t: 'ellipse', cx: W * 0.18, cy: H * 1.02, rx: W * 0.42, ry: H * 0.22, fill: 'rgba(160,210,120,0.45)' }, { t: 'ellipse', cx: W * 0.86, cy: H * 1.05, rx: W * 0.38, ry: H * 0.2, fill: 'rgba(140,200,110,0.4)' });
  if (S === STYLES.paper) { for (let y = 30 * u; y < H; y += 30 * u) deco.push({ t: 'rect', x: 0, y, w: W, h: Math.max(1, u), r: 0, fill: '#EBDDC4' }); if (!chest) deco.push({ t: 'path', d: star(W - 34 * u, 30 * u, 13 * u), fill: '#3BA7E5' }, { t: 'path', d: star(W - 60 * u, 52 * u, 7 * u), fill: '#F2B33D' }); }

  // boxes: fixed slots. Face / preview: left column + content column; chest (≈4:1): one row, left → right
  let box;
  if (chest) {
    const order = ['top', 'center', 'bottom'].filter(has), n = order.length || 1, gap = 3 * u, w0 = (W - gap * (n + 1)) / n;
    box = slot => { const i = order.indexOf(slot); return { x: gap + i * (w0 + gap), y: 10 * u, w: w0 - (S.shadow ? S.shadow[0] * u : 0), h: H - 22 * u }; };
  } else {
    const cx = has('left') ? 250 / REF.W * W : 0.08 * W, cw = (has('left') ? 710 / REF.W * W : 0.92 * W) - cx, R = H / REF.H;
    const top = [24 * R, 44 * R], bottom = [282 * R, 56 * R];
    const c0 = has('top') ? 84 * R : 24 * R, c1 = has('bottom') ? 264 * R : H - 24 * R;
    box = slot => slot === 'left' ? { x: 36 / REF.W * W, y: 40 * R, w: 130 / REF.W * W, h: 270 * R }
      : slot === 'top' ? { x: cx, y: top[0], w: cw, h: top[1] } : slot === 'bottom' ? { x: cx, y: bottom[0], w: cw, h: bottom[1] } : { x: cx, y: c0, w: cw, h: c1 - c0 };
  }

  for (const e of els) {
    if (chest && e.kind === 'RobotIllustration') continue; // no room on the chest strip
    // a box moved / resized in Figma (760 × 348 units) replaces the slot on the face; the chest strip keeps its one-row layout
    const b = e.box && !chest ? { x: e.box.x * W / REF.W, y: e.box.y * H / REF.H, w: e.box.w * W / REF.W, h: e.box.h * H / REF.H } : box(e.slot), s = fill(e.text), size = (e.size ?? 1) * fs, mx = b.x + b.w / 2, my = b.y + b.h / 2;
    const accent = e.color || kit.accent || S.accent, r0 = e.radius != null ? e.radius * u : null;
    if (e.kind === 'StatusPill') {
      const r = r0 ?? pillR(b.h), iconR = e.icon ? b.h * 0.23 : 0, px = fit(s, 15 * u * size * (clean ? 1 : 1.15), b.w - 30 * u - iconR * 2, 8 * u);
      const pillFill = S === STYLES.soft ? '#FFFFFF' : card, prims = cardPrims(b, r, pillFill);
      if (e.icon) prims.push({ t: 'circle', cx: b.x + 15 * u + iconR, cy: my, r: iconR, fill: 'none', stroke: '#34C759', sw: 1.6 * u },
        { t: 'path', d: `M${b.x + 15 * u + iconR * 0.5} ${my}l${iconR * 0.35} ${iconR * 0.38}l${iconR * 0.65} ${-iconR * 0.75}`, fill: 'none', stroke: '#34C759', sw: 1.8 * u });
      prims.push(text(s, b.x + (e.icon ? 22 * u + iconR * 2 : 16 * u), my, px, e.color || inkC, S.wBody, 'start', pillFill));
      put(e, b, prims);
    } else if (e.kind === 'BigNumberCard') {
      const r = r0 ?? S.cardR * u, px = fit(s, (chest ? 70 : 96) * u * size, b.w - 24 * u, 12 * u);
      put(e, b, [...cardPrims(b, r, card, true), text(s, mx, my, Math.min(px, b.h * 0.8), e.color || S.number || accent)]);
    } else if (e.kind === 'ActionButton') {
      const r = r0 ?? pillR(b.h), px = fit(s, 20 * u * size * (clean ? 1 : 1.1), b.w - 24 * u, 8 * u);
      put(e, b, [...(S.btnShadow ? [{ t: 'rect', x: b.x + S.btnShadow[0] * u, y: b.y + S.btnShadow[1] * u, w: b.w, h: b.h, r, fill: S.btnShadow[2] }] : []),
        { t: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, r, fill: accent, ...(S === STYLES.bold ? { stroke: '#111111', sw: S.lineW * u } : {}) },
        text(s, mx, my, Math.min(px, b.h * 0.6), S === STYLES.bold && accent === '#111111' ? '#FFE14D' : ink(accent), S.w, 'middle', accent)]);
    } else if (e.kind === 'RobotIllustration') { // the W12-A robot sketch, in the style's colours
      const k = b.w / 130, sx = b.x + 12 * k, sy = b.y + 18 * k, body = clean || S === STYLES.bold ? '#1D1D1F' : S.ink, scr = S === STYLES.paper ? '#FFFDF7' : '#FFFFFF';
      put(e, b, [...(S.shadow ? [{ t: 'rect', x: b.x + S.shadow[0] * u, y: b.y + S.shadow[1] * u, w: b.w, h: b.h, r: 20 * k, fill: S.shadow[2] }] : []),
        { t: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, r: (S === STYLES.soft ? 34 : 20) * k, fill: body }, { t: 'rect', x: sx, y: sy, w: 106 * k, h: b.h - 64 * k, r: (S === STYLES.soft ? 18 : 8) * k, fill: scr },
        { t: 'rect', x: sx + 18 * k, y: sy + 24 * k, w: 70 * k, h: 26 * k, r: 4 * k, fill: accent }, text(fill(vars.table ?? ''), sx + 53 * k, sy + 37 * k, 13 * k, ink(accent), S.w, 'middle', accent),
        { t: 'rect', x: sx + 18 * k, y: sy + 70 * k, w: 70 * k, h: 26 * k, r: 4 * k, fill: '#E5E5EA' }, { t: 'rect', x: sx + 18 * k, y: sy + 110 * k, w: 70 * k, h: 26 * k, r: 4 * k, fill: '#E5E5EA' }]);
    } else if (e.kind === 'MenuCard') {
      const r = r0 ?? S.cardR * u, px = fit(s, 22 * u * size, b.w - 48 * u, 8 * u), bar = line ?? 'rgba(91,70,54,0.15)';
      put(e, b, [...cardPrims(b, r, card, true),
        text(s, b.x + 24 * u, b.y + b.h * 0.3, px, inkC, S.w, 'start'),
        { t: 'rect', x: b.x + 24 * u, y: b.y + b.h * 0.5, w: b.w * 0.55, h: 12 * u, r: 6 * u, fill: bar }, { t: 'rect', x: b.x + 24 * u, y: b.y + b.h * 0.5 + 22 * u, w: b.w * 0.35, h: 12 * u, r: 6 * u, fill: bar },
        { t: 'rect', x: b.x + b.w - 24 * u - b.h * 0.42, y: my - b.h * 0.21, w: b.h * 0.42, h: b.h * 0.42, r: (S === STYLES.soft ? 20 : 10) * u, fill: accent }]);
    } else if (e.kind === 'Greeting') { // up to two lines, split at the middle space
      const color = e.color || inkC, max = b.w - 16 * u;
      let px = 30 * u * size * (clean ? 1 : 1.12), lines = [s];
      if (textWidth(s, px) > max) { const sp = [...s.matchAll(/ /g)].map(m => m.index), mid = sp.sort((a, c) => Math.abs(a - s.length / 2) - Math.abs(c - s.length / 2))[0]; if (mid != null) lines = [s.slice(0, mid), s.slice(mid + 1)]; }
      px = Math.min(...lines.map(l => fit(l, px, max, 10 * u)), b.h / (lines.length * 1.4));
      put(e, b, lines.map((l, i) => text(l, mx, my + (i - (lines.length - 1) / 2) * px * 1.35, px, color, S.w, 'middle', bgMid)));
    }
  }
  return { W, H, bg, deco, style: kit.style ?? 'clean', groups };
}

/** warnings only (never blocks): text contrast below 4.5:1 (3:1 for large text), buttons smaller than a finger on the real screen.
 *  physicalH = the screen's real height in m (face 0.173, chest strip 0.045) */
export const SCREEN_M = { face: 0.173, chest: 0.045 };
export function guardrails(L, physicalH = SCREEN_M.face) {
  const out = [];
  for (const g of L.groups) {
    if (g.kind !== 'RobotIllustration') for (const p of g.prims) if (p.t === 'text' && /^#/.test(p.on || '') && /^#/.test(p.fill)) {
      // WCAG: 4.5:1 for body text, 3:1 for large text (≥ 24 px, or ≥ 18.7 px bold — measured on the 760 × 348 reference)
      const px = p.px / L.H * REF.H, large = px >= 24 || (px >= 18.7 && p.weight >= 700), min = large ? 3 : 4.5, c = contrast(p.fill, p.on);
      if (c < min) out.push({ id: g.id, kind: 'contrast', ok: false, msg: `${g.name} 글자 대비 ${c}:1 (${min}:1 미만)` });
    }
    if (g.kind === 'ActionButton') {
      const mm = Math.round(g.box.h / L.H * physicalH * 1000);
      if (mm < 9) out.push({ id: g.id, kind: 'touch', ok: false, msg: `${g.name} 높이 ${mm}mm — 손가락으로 누르기엔 작아요 (9mm 이상 권장)` });
      else out.push({ id: g.id, kind: 'touch', ok: true, msg: `터치 영역 ${mm}mm 통과` });
    }
  }
  return out;
}

// ---- renderer 1: Canvas 2D (the robot's screens) ----------------------------------------------------------------------
const family = f => `"${f}", "Noto Sans KR", system-ui, sans-serif`;
export function drawScreen(ctx, L, { alpha = 1, scale = 1, dx = 0, dy = 0, content = 1 } = {}) { // dx/dy/content: the UI 요소 motion track (content only)
  const { W, H } = L, R = Math.min(W, H) * 0.04;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(W / 2, H / 2); ctx.scale(scale, scale); ctx.translate(-W / 2, -H / 2);
  ctx.beginPath(); ctx.roundRect(0, 0, W, H, R);
  if (Array.isArray(L.bg)) { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, L.bg[0]); g.addColorStop(1, L.bg[1]); ctx.fillStyle = g; } else ctx.fillStyle = L.bg;
  ctx.fill(); ctx.clip();
  const draw = p => {
    if (p.t === 'rect') { ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, p.h, Math.min(p.r || 0, p.h / 2, p.w / 2)); if (p.fill !== 'none') { ctx.fillStyle = p.fill; ctx.fill(); } if (p.stroke) { ctx.setLineDash(p.dash || []); ctx.strokeStyle = p.stroke; ctx.lineWidth = p.sw || 1; ctx.stroke(); ctx.setLineDash([]); } }
    else if (p.t === 'ellipse') { ctx.beginPath(); ctx.ellipse(p.cx, p.cy, p.rx, p.ry, 0, 0, Math.PI * 2); ctx.fillStyle = p.fill; ctx.fill(); }
    else if (p.t === 'circle') { ctx.beginPath(); ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2); if (p.fill !== 'none') { ctx.fillStyle = p.fill; ctx.fill(); } if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.sw || 1; ctx.stroke(); } }
    else if (p.t === 'path') { const path = new Path2D(p.d); if (p.fill && p.fill !== 'none') { ctx.fillStyle = p.fill; ctx.fill(path); } if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.sw || 1; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(path); } }
    else if (p.t === 'text') { ctx.fillStyle = p.fill; ctx.font = `${p.weight} ${p.px}px ${family(p.font)}`; ctx.textAlign = p.anchor === 'start' ? 'left' : 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.s, p.x, p.y); }
  };
  for (const p of L.deco || []) draw(p);
  ctx.translate(dx, dy); ctx.globalAlpha = alpha * content;
  for (const g of L.groups) { ctx.save(); if (g.rot) { ctx.translate(g.rot.cx, g.rot.cy); ctx.rotate(g.rot.a * Math.PI / 180); ctx.translate(-g.rot.cx, -g.rot.cy); } g.prims.forEach(draw); ctx.restore(); }
  ctx.restore();
}

// ---- renderer 2: SVG (editor preview + Figma export: named layers, real <text>, fills written out) -----------------------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = v => +(+v).toFixed(2);
const svgPrim = p =>
  p.t === 'rect' ? `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="${n(Math.min(p.r || 0, p.h / 2, p.w / 2))}" fill="${p.fill}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${n(p.sw || 1)}"${p.dash ? ` stroke-dasharray="${p.dash.map(n).join(' ')}"` : ''}` : ''}/>`
  : p.t === 'ellipse' ? `<ellipse cx="${n(p.cx)}" cy="${n(p.cy)}" rx="${n(p.rx)}" ry="${n(p.ry)}" fill="${p.fill}"/>`
  : p.t === 'circle' ? `<circle cx="${n(p.cx)}" cy="${n(p.cy)}" r="${n(p.r)}" fill="${p.fill}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${n(p.sw || 1)}"` : ''}/>`
  : p.t === 'path' ? `<path d="${p.d}" fill="${p.fill || 'none'}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${n(p.sw || 1)}" stroke-linecap="round" stroke-linejoin="round"` : ''}/>`
  : `<text x="${n(p.x)}" y="${n(p.y)}" font-family="${esc(p.font || 'Noto Sans KR')}" font-size="${n(p.px)}" font-weight="${p.weight}" fill="${p.fill}" text-anchor="${p.anchor}" dominant-baseline="central">${esc(p.s)}</text>`;
let uid = 0; // several SVGs live on one page (thumbnails) — their gradient / clip ids must not collide
export function renderSvg(L, title = '화면') {
  const { W, H } = L, R = n(Math.min(W, H) * 0.04), grad = Array.isArray(L.bg), id = `s${uid++}`;
  const defs = grad ? `<defs><linearGradient id="${id}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.bg[0]}"/><stop offset="1" stop-color="${L.bg[1]}"/></linearGradient><clipPath id="${id}clip"><rect width="${n(W)}" height="${n(H)}" rx="${R}"/></clipPath></defs>`
    : `<defs><clipPath id="${id}clip"><rect width="${n(W)}" height="${n(H)}" rx="${R}"/></clipPath></defs>`;
  const deco = (L.deco || []).length ? `<g id="장식">${L.deco.map(svgPrim).join('')}</g>` : '';
  const body = L.groups.map(g => `<g id="${esc(g.name.replace(/ /g, '_'))}" data-el="${esc(g.id)}"${g.rot ? ` transform="rotate(${n(g.rot.a)} ${n(g.rot.cx)} ${n(g.rot.cy)})"` : ''}>${g.prims.map(svgPrim).join('')}</g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(W)}" height="${n(H)}" viewBox="0 0 ${n(W)} ${n(H)}">${defs}<g id="${esc(title.replace(/ /g, '_'))}" clip-path="url(#${id}clip)"><rect id="배경" width="${n(W)}" height="${n(H)}" rx="${R}" fill="${grad ? `url(#${id}bg)` : L.bg}"/>${deco}${body}</g></svg>`;
}
