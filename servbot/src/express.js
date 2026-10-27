// Robot face = the BellaBot model's own face texture (kerface, 512×1024), re-composed per frame.
// Expressions only TRANSFORM the original pieces (scale / squash / crop / tilt / flip / move / fade) — nothing new is drawn.
// The texture is a half face mirrored across the centre line (u = distance from centre) and upside down
// (image top = bottom of the screen), so "screen up" = image +y and every change is automatically symmetric.
// Also used by the BrandTone app (src/robot.tsx loads this file at runtime).

// pieces of the original texture (image px), found by connected components
const PART = {
  eye: [72, 246, 356, 734],          // big ring eye
  mouth: [0, 198, 82, 289],          // ∪ smile (sits on the centre line)
  nose: [0, 297, 28, 338],           // small dot above the smile
  cheek: [370, 184, 428, 295],       // two short marks at the outer bottom
  brow: [68, 823, 166, 922],         // blob above the eye
};
const C = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

export const FACE0 = { eyeSize: 1, eyeOpen: 1, eyeSmile: 0, eyeTilt: 0, eyeY: 0, mouth: 1, mouthSize: 1, cheek: 1, brow: 0, browTilt: 0 };
export const FACE_KEYS = [
  ['eyeSize', '눈 크기', 0.6, 1.4, 0.05], ['eyeOpen', '눈 뜨기', 0.1, 1.3, 0.05], ['eyeSmile', '웃는 눈', 0, 1, 0.05],
  ['eyeTilt', '눈 기울기', -25, 25, 1], ['eyeY', '시선 (아래 ↔ 위)', -1, 1, 0.05], ['mouth', '입꼬리', -1, 1.6, 0.05],
  ['mouthSize', '입 크기', 0.5, 1.8, 0.05], ['cheek', '볼 표시', 0, 1, 0.05], ['brow', '이마 표시 위치', -1, 1, 0.05],
  ['browTilt', '이마 표시 기울기', -30, 30, 1],
];
// presets are only combinations of the transforms above, starting from the original face (기본).
// Each one differs from the others in at least two clearly visible ways, so a change of situation reads at a glance.
export const FACE_PRESETS = {
  basic: { label: '기본 (원래 얼굴)' },
  happy: { label: '반가움', eyeSmile: 1, eyeY: 0.1, mouth: 1.45, mouthSize: 1.3, cheek: 1, brow: 0.45 },
  polite: { label: '정중함', eyeSmile: 1, eyeOpen: 0.62, eyeSize: 0.9, eyeY: -0.5, mouth: 0.6, mouthSize: 0.72, cheek: 0.3, brow: -0.3 },
  focus: { label: '집중', eyeSize: 1, eyeOpen: 1.08, eyeY: 0.45, mouth: 0.2, mouthSize: 0.75, cheek: 0.15, brow: 0.6 },
  sorry: { label: '미안함', eyeOpen: 0.5, eyeTilt: -25, eyeY: -0.35, mouth: -0.95, mouthSize: 0.9, cheek: 0, brow: -0.6, browTilt: 25 },
  surprise: { label: '놀람', eyeSize: 1.02, eyeOpen: 1.18, eyeY: 0.55, mouth: 1, mouthSize: 1.7, cheek: 0.4, brow: 1 },
  calm: { label: '차분', eyeOpen: 0.42, eyeY: -0.18, mouth: 0.75, mouthSize: 0.9, cheek: 0.7, brow: -0.15 },
  // edge / negative personalities (까칠 · 나른 · 소심 · 건방 · 시니컬)
  grumpy: { label: '뚱함', eyeOpen: 0.55, eyeTilt: 18, mouth: -0.45, mouthSize: 0.8, cheek: 0, brow: -0.7, browTilt: -20 },
  annoyed: { label: '짜증', eyeOpen: 0.42, eyeTilt: 25, eyeY: 0.1, mouth: -0.85, mouthSize: 1.05, cheek: 0, brow: -0.95, browTilt: -30 },
  bored: { label: '시큰둥', eyeOpen: 0.26, eyeY: -0.2, mouth: 0.1, mouthSize: 0.65, cheek: 0.2, brow: -0.35 },
  smug: { label: '으쓱', eyeSmile: 0.5, eyeOpen: 0.6, eyeTilt: 10, mouth: 1.25, mouthSize: 0.85, cheek: 0.3, brow: 0.35, browTilt: 14 },
  nervous: { label: '쭈뼛', eyeSize: 0.82, eyeOpen: 0.9, eyeTilt: -12, eyeY: -0.65, mouth: -0.3, mouthSize: 0.6, cheek: 1, brow: 0.45, browTilt: 18 },
  sad: { label: '시무룩', eyeOpen: 0.62, eyeTilt: -20, eyeY: -0.55, mouth: -0.6, mouthSize: 0.7, cheek: 0, brow: -0.2, browTilt: 22 },
};
export const presetFace = k => ({ ...FACE0, ...FACE_PRESETS[k], label: undefined });

/** white-on-transparent copy of the original texture, so it can be tinted with any brand colour */
export function makeFaceSource(image) {
  const w = image.width, h = image.height, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(image, 0, 0);
  const d = g.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) { const a = Math.max(d.data[i], d.data[i + 1], d.data[i + 2]); d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; d.data[i + 3] = a; }
  g.putImageData(d, 0, 0);
  return { mask: c, tinted: null, tint: null, w, h };
}

function tinted(src, color) {
  if (src.tint === color && src.tinted) return src.tinted;
  const c = src.tinted || document.createElement('canvas'); c.width = src.w; c.height = src.h;
  const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); g.drawImage(src.mask, 0, 0);
  g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = 'source-over';
  src.tinted = c; src.tint = color; return c;
}

/** draw face f (FACE0-shaped) into ctx (same size as the source); color = null keeps the original colour */
export function drawFace(ctx, src, f, color = '#b0f7ff', blink = 0) {
  const img = tinted(src, color), W = src.w, H = src.h;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const piece = (b, [cx, cy], fn, crop = null) => {
    ctx.save(); ctx.translate(cx, cy); fn(); ctx.translate(-cx, -cy);
    const [x0, y0, x1, y1] = crop || b; ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0); ctx.restore();
  };
  // eye: size, open (vertical squash), tilt, smile = keep only the upper half of the ring on screen (∩)
  const e = PART.eye, ec = C(e), open = Math.max(0.04, f.eyeOpen * (1 - blink));
  const keep = 1 - Math.min(1, Math.max(0, f.eyeSmile)) * 0.5;               // fraction of the ring height that stays
  const cut = [e[0], e[3] - (e[3] - e[1]) * keep, e[2], e[3]];               // screen-top part = image bottom part
  piece(e, [ec[0], ec[1] - f.eyeSmile * 40], () => { ctx.translate(0, (f.eyeY || 0) * 170); ctx.rotate(f.eyeTilt * Math.PI / 180); ctx.scale(f.eyeSize, f.eyeSize * open); }, cut);
  // mouth: curve amount (negative flips it = frown), size; nose stays
  const m = PART.mouth, mc = [0, C(m)[1]];
  piece(m, mc, () => ctx.scale(f.mouthSize, f.mouthSize * (Math.abs(f.mouth) < 0.08 ? Math.sign(f.mouth || 1) * 0.08 : f.mouth)));
  piece(PART.nose, C(PART.nose), () => {});
  // cheek marks fade, brow blob moves up/down (screen up = image +y)
  ctx.globalAlpha = Math.max(0, Math.min(1, f.cheek)); piece(PART.cheek, C(PART.cheek), () => {}); ctx.globalAlpha = 1;
  piece(PART.brow, C(PART.brow), () => { ctx.translate(0, f.brow * 60 + (f.eyeY || 0) * 90); ctx.rotate((f.browTilt || 0) * Math.PI / 180); });
}

export const lerpFace = (a, b, k) => { for (const [key] of FACE_KEYS) a[key] += ((b[key] ?? FACE0[key]) - a[key]) * k; return a; };

// ---- 모션: Figma-prototype style easing for expression changes (cubic-bezier + duration) ----
export const EASINGS = {
  linear: ['Linear', [0, 0, 1, 1]], 'ease-in': ['Ease in', [0.42, 0, 1, 1]], 'ease-out': ['Ease out', [0, 0, 0.58, 1]],
  'ease-in-out': ['Ease in and out', [0.42, 0, 0.58, 1]], 'ease-in-back': ['Ease in back', [0.3, -0.05, 0.7, -0.5]],
  'ease-out-back': ['Ease out back', [0.45, 1.45, 0.8, 1]], 'ease-in-out-back': ['Ease in and out back', [0.7, -0.4, 0.4, 1.4]],
  gentle: ['Gentle', [0.25, 0.1, 0.25, 1]], quick: ['Quick', [0.2, 0.9, 0.3, 1]], bouncy: ['Bouncy', [0.34, 1.56, 0.64, 1]],
  slow: ['Slow', [0.6, 0, 0.2, 1]], custom: ['Custom bezier', null],
};
export const MOTION0 = { anim: 'blink', easing: 'ease-out', bezier: [0, 0, 0.58, 1], duration: 300 };
/** CSS-style cubic-bezier(x1, y1, x2, y2) as a function of progress x (x1, x2 kept in 0..1 so x(t) is monotonic) */
export function cubicBezier([x1, y1, x2, y2]) {
  const c = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return x => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 24; i++) { t = (lo + hi) / 2; if (c(x1, x2, t) < x) lo = t; else hi = t; }
    return c(y1, y2, t);
  };
}
// ---- 상태창: the guide / status UI drawn ON the robot's face screen (a thin display layer fitted to the screen) ----
export const GUIDE0 = { shape: 'pill', tone: 'glass', state: true, dot: true, enter: 'fade' };
const inkOn = c => { const n = parseInt(c.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255 > 0.6 ? '#1d1d1f' : '#fff'; };
/** centre, normal and size of the face screen in `root` space (the face texture is mirrored, so text can't go into it) */
export function screenFrame(THREE, mesh, root) {
  root.updateMatrixWorld(true);
  const m = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld), nm = new THREE.Matrix3().getNormalMatrix(m);
  const P = mesh.geometry.attributes.position, N = mesh.geometry.attributes.normal, v = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), pts = [];
  for (let i = 0; i < P.count; i++) { pts.push(v.fromBufferAttribute(P, i).applyMatrix4(m).clone()); c.add(pts[i]); if (N) n.add(v.fromBufferAttribute(N, i).applyMatrix3(nm)); }
  c.divideScalar(P.count); n.normalize();
  if (n.dot(new THREE.Vector3(c.x, 0, c.z)) < 0) n.negate(); // point away from the robot's axis
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize(), right = new THREE.Vector3().crossVectors(up, n);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const q of pts) { const d = q.sub(c); x0 = Math.min(x0, d.dot(right)); x1 = Math.max(x1, d.dot(right)); y0 = Math.min(y0, d.dot(up)); y1 = Math.max(y1, d.dot(up)); z1 = Math.max(z1, d.dot(n)); }
  return { c, n, up, right, x0, x1, y0, y1, z1 };
}
/** a transparent canvas layer laid onto the robot: 'face' = over the whole face screen (화면 동세),
 *  'chest' = the dark slot on the body just under the head (상태창 display). Returns { mesh, ctx, tex } — add mesh to `root` */
export function screenLayer(THREE, faceMesh, root, where = 'face') {
  const f = screenFrame(THREE, faceMesh, root), sw = f.x1 - f.x0, sh = f.y1 - f.y0;
  const [w, h] = where === 'face' ? [sw, sh] : [sw * 0.66, sh * 0.26];
  const at = new THREE.Vector3().copy(f.c).addScaledVector(f.right, (f.x0 + f.x1) / 2);
  if (where === 'face') at.addScaledVector(f.up, (f.y0 + f.y1) / 2).addScaledVector(f.n, f.z1 + 0.003);
  else { // find the body surface under the screen with a ray from the front
    at.addScaledVector(f.up, f.y0 - sh * 0.3);
    const meshes = []; root.traverse(o => { if (o.isMesh && o !== faceMesh) meshes.push(o); });
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), w0 = at.clone().applyMatrix4(root.matrixWorld);
    const nW = f.n.clone().transformDirection(root.matrixWorld), ray = new THREE.Raycaster(w0.clone().addScaledVector(nW, 1), nW.clone().negate());
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit) at.copy(hit.point.applyMatrix4(inv)).addScaledVector(f.n, 0.004); else at.addScaledVector(f.n, f.z1);
  }
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = Math.round(512 * h / w);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  mesh.position.copy(at); mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.right, f.up, f.n)); mesh.renderOrder = 2;
  return { mesh, ctx: cv.getContext('2d'), tex };
}
/** draw the 상태창 on the chest display: shape / colour / dot / state label from the guide, its own short entry. true = still animating */
const STATUS_IN = 280, STATUS_EASE = [0, 0, 0.58, 1];
export function drawStatus(ctx, s, now) {
  const W = ctx.canvas.width, H = ctx.canvas.height, g = s.guide || GUIDE0;
  ctx.clearRect(0, 0, W, H);
  const text = s.text ? (g.state && s.label ? s.label + ' · ' + s.text : s.text) : '';
  if (!text) return false;
  const k = cubicBezier(STATUS_EASE)(Math.min(1, (now - s.t0) / STATUS_IN));
  ctx.save(); ctx.globalAlpha = k;
  if (g.enter === 'pop') { const z = 0.7 + 0.3 * k; ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2); }
  if (g.enter === 'slide') ctx.translate(0, (1 - k) * H * 0.5);
  const bh = H * 0.9, pad = bh * 0.32, dot = g.dot ? bh * 0.4 : 0, t = text; let fs = bh * 0.46;
  const font = () => (ctx.font = `700 ${fs}px "Noto Sans KR", system-ui, sans-serif`);
  font(); while (ctx.measureText(t).width > W - pad * 2 - dot && fs > bh * 0.36) { fs -= 1; font(); }
  const x = W * 0.02, y = (H - bh) / 2, bw = W * 0.96; // the display fills the slot; the shape decides its corners
  const [bg, fg] = g.tone === 'brand' ? [s.color, inkOn(s.color)] : g.tone === 'dark' ? ['#1c1c1f', '#fff'] : ['rgba(255,255,255,.94)', '#1d1d1f'];
  ctx.beginPath(); ctx.roundRect(x, y, bw, bh, { pill: bh / 2, round: bh * 0.28, square: bh * 0.08 }[g.shape]); ctx.fillStyle = bg; ctx.fill();
  if (g.tone === 'dark') { ctx.strokeStyle = s.color; ctx.globalAlpha = k * 0.6; ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = k; }
  const tw = ctx.measureText(t).width, room = W - pad * 2 - dot, scroll = tw > room; // too long for the slot → ticker
  const x0 = scroll ? x + pad : W / 2 - (tw + dot) / 2;
  if (dot) { ctx.beginPath(); ctx.arc(x0 + dot * 0.3, H / 2, dot * 0.3, 0, Math.PI * 2); ctx.fillStyle = s.on ? '#34c759' : '#0a84ff'; ctx.fill(); }
  ctx.fillStyle = fg; ctx.textBaseline = 'middle';
  if (scroll) { // wait 0.8 s, then scroll at 60 px/s with a gap, clipped to the display
    const gap = fs * 2, off = Math.max(0, (now - s.t0) / 1000 - 0.8) * 60 % (tw + gap);
    ctx.beginPath(); ctx.rect(x0 + dot, 0, room, H); ctx.clip();
    ctx.fillText(t, x0 + dot - off, H / 2 + fs * 0.04); ctx.fillText(t, x0 + dot - off + tw + gap, H / 2 + fs * 0.04);
  } else ctx.fillText(t, x0 + dot, H / 2 + fs * 0.04);
  ctx.restore();
  return k < 1 || scroll;
}

// ---- 화면 동세: little animations ON the face screen that go with an expression (a hand pops up and waves, hearts, Zzz …) ----
export const FX = { none: ['없음', 0], wave: ['손 흔들기', 2.6], heart: ['하트', 2.4], sparkle: ['반짝', 2.0], note: ['음표', 2.4], question: ['갸웃 ?', 2.2],
  sweat: ['땀방울', 2.4], tear: ['눈물', 2.6], anger: ['빠직', 2.0], zzz: ['졸음 Zzz', 3.0] };
const easeOut = x => 1 - (1 - x) ** 3, fade = (t, d, a = 0.25) => Math.min(1, t / a, (d - t) / a);
function hand(ctx, x, y, s, rot, color) { // palm toward the guest, wrist at (x, y)
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = color;
  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x * s, y * s, w * s, h * s, r * s); ctx.fill(); };
  rr(-0.32, -0.62, 0.64, 0.66, 0.24);
  [[-0.31, -1.0], [-0.15, -1.1], [0.01, -1.06], [0.17, -0.94]].forEach(([fx, fy]) => rr(fx, fy, 0.14, -0.4 - fy, 0.07));
  ctx.translate(0.3 * s, -0.3 * s); ctx.rotate(0.75); rr(-0.07, -0.38, 0.15, 0.42, 0.075);
  ctx.restore();
}
function heart(ctx, x, y, s) { ctx.beginPath(); ctx.moveTo(x, y + s * 0.35); ctx.bezierCurveTo(x - s, y - s * 0.3, x - s * 0.4, y - s, x, y - s * 0.42); ctx.bezierCurveTo(x + s * 0.4, y - s, x + s, y - s * 0.3, x, y + s * 0.35); ctx.fill(); }
function drop(ctx, x, y, s) { ctx.beginPath(); ctx.moveTo(x, y - s); ctx.bezierCurveTo(x + s * 0.65, y - s * 0.1, x + s * 0.55, y + s * 0.6, x, y + s * 0.6); ctx.bezierCurveTo(x - s * 0.55, y + s * 0.6, x - s * 0.65, y - s * 0.1, x, y - s); ctx.fill(); }
function star(ctx, x, y, s) { ctx.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? s * 0.28 : s, a = i * Math.PI / 4 - Math.PI / 2; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); ctx.fill(); }
/** draw effect `id` at time t (s) since it started; canvas = the face screen (or a preview of it). true = still playing */
export function drawFx(ctx, id, t, color, clear = true) {
  const W = ctx.canvas.width, H = ctx.canvas.height, d = FX[id]?.[1] ?? 0;
  if (clear) ctx.clearRect(0, 0, W, H);
  if (!d || t > d) return false;
  ctx.save(); ctx.globalAlpha = Math.max(0, fade(t, d)); ctx.fillStyle = ctx.strokeStyle = color; ctx.lineCap = 'round';
  if (id === 'wave') { // a hand rises from the bottom-right corner, waves, and sinks back
    const up = easeOut(Math.min(1, t / 0.35)) * (t > d - 0.4 ? easeOut((d - t) / 0.4) : 1);
    ctx.globalAlpha = 1; hand(ctx, W * 0.82, H * (1.12 - 0.42 * up), H * 0.4, Math.sin(t * 13) * 0.38 * Math.min(1, t / 0.4), color);
  } else if (id === 'heart') [[0.18, 0.72, 0], [0.84, 0.66, 0.25], [0.5, 0.86, 0.5]].forEach(([x, y, t0]) => {
    const u = Math.max(0, t - t0); if (!u) return; ctx.fillStyle = '#FF6B8B';
    heart(ctx, W * x, H * (y - u * 0.18), H * 0.16 * Math.min(1, u / 0.25) * (1 + 0.08 * Math.sin(u * 9)));
  });
  else if (id === 'sparkle') [[0.12, 0.25, 0], [0.88, 0.2, 0.3], [0.8, 0.78, 0.6], [0.2, 0.8, 0.9]].forEach(([x, y, t0]) => {
    const u = Math.max(0, t - t0); star(ctx, W * x, H * y, H * 0.09 * Math.abs(Math.sin(u * 4)));
  });
  else if (id === 'note') [[0.16, 0.7, 0], [0.84, 0.65, 0.5]].forEach(([x, y, t0]) => {
    const u = Math.max(0, t - t0); if (!u) return; ctx.font = `700 ${H * 0.24}px system-ui, sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(u % 1 < 0.5 ? '♪' : '♫', W * x + Math.sin(u * 5) * H * 0.04, H * (y - u * 0.15));
  });
  else if (id === 'question') { ctx.font = `800 ${H * 0.34}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.translate(W * 0.86, H * 0.32 + Math.sin(t * 5) * H * 0.03); ctx.rotate(Math.sin(t * 3) * 0.15); ctx.fillText('?', 0, 0); }
  else if (id === 'sweat') { ctx.fillStyle = '#7FD3FF'; drop(ctx, W * 0.88, H * (0.18 + easeOut(Math.min(1, t / d)) * 0.25), H * 0.09); }
  else if (id === 'tear') { ctx.fillStyle = '#7FD3FF'; [0.27, 0.73].forEach((x, i) => { const u = (t * 0.8 + i * 0.4) % 1; drop(ctx, W * x, H * (0.62 + u * 0.3), H * 0.05 * (1 - u * 0.4)); }); }
  else if (id === 'anger') { // 💢 four curved strokes, pulsing
    ctx.strokeStyle = '#FF453A'; ctx.lineWidth = H * 0.045; const s = H * 0.13 * (1 + 0.15 * Math.sin(t * 12)); ctx.translate(W * 0.86, H * 0.22);
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.arc(s * 0.62, s * 0.62, s * 0.5, Math.PI, Math.PI * 1.5); ctx.stroke(); }
  } else if (id === 'zzz') [0, 0.6, 1.2].forEach((t0, i) => {
    const u = Math.max(0, t - t0); if (!u) return; ctx.globalAlpha = Math.max(0, Math.min(1, u / 0.3, (d - t) / 0.4)) * (1 - u / d * 0.5);
    ctx.font = `800 ${H * (0.12 + i * 0.05)}px system-ui, sans-serif`; ctx.fillText('Z', W * (0.72 + u * 0.06), H * (0.42 - u * 0.12));
  });
  ctx.restore();
  return true;
}

/** move s.f toward tgt along the motion curve; the tween restarts when `key` (the chosen expression) changes. true = it just switched */
export function tweenFace(s, tgt, key, dt, m = MOTION0) {
  let switched = false;
  if (key !== s.key) { switched = s.key !== undefined; s.key = key; s.from = { ...s.f }; s.el = 0; }
  s.el += dt;
  const dur = m.anim === 'instant' ? 0 : m.duration / 1000, k = dur > 0 ? cubicBezier(m.bezier)(Math.min(1, s.el / dur)) : 1;
  for (const [n] of FACE_KEYS) s.f[n] = s.from[n] + ((tgt[n] ?? FACE0[n]) - s.from[n]) * k;
  return switched;
}

/** small mirrored preview of a face (for node cards / panels) */
export function drawPreview(canvas, src, f, color, bg = '#000') { // bg null = transparent (PNG export)
  const tmp = drawPreview.tmp || (drawPreview.tmp = document.createElement('canvas'));
  tmp.width = src.w; tmp.height = src.h; drawFace(tmp.getContext('2d'), src, f, color);
  const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); } else g.clearRect(0, 0, w, h);
  // rebuild the screen view: right half = texture rotated 180° (upside down), left half = its mirror
  const sx = w / 2 / src.w, sy = h / src.h;
  g.save(); g.translate(w / 2, h); g.scale(sx, -sy); g.drawImage(tmp, 0, 0); g.restore();
  g.save(); g.translate(w / 2, h); g.scale(-sx, -sy); g.drawImage(tmp, 0, 0); g.restore();
}

// ---- 표현 그래프: 상황 → 반응(표정 + 말). The robot's route is fixed; only how it looks and talks is edited. ----
export const SITUATIONS = [['NEAR', '손님이 가까이'], ['ARRIVE', '테이블 도착'], ['SERVE', '서빙 중'], ['DEPART', '출발'], ['YIELD', '양보'], ['WAIT', '대기'],
  ['DETOUR', '우회'], ['CAUTION', '감속'], ['CRUISE', '주행'], ['ANY', '그 외 모든 상황']];
export const LINES = [['serve', '서빙'], ['greet', '인사'], ['bye', '배웅'], ['yield', '양보'], ['wait', '대기'], ['detour', '우회'],
  ['caution', '감속'], ['sorry', '사과'], ['none', '말 없음']];
export const DEFAULT_LINES = { greet: '어서 오세요!', serve: '주문하신 메뉴 나왔어요.', bye: '맛있게 드세요!', yield: '먼저 지나가세요.',
  wait: '잠시만 기다릴게요.', detour: '돌아서 갈게요.', caution: '천천히 지나갈게요.', sorry: '죄송해요.' };
export const EXPR_CAT = { input: '#0A84FF', face: '#FF9F0A' };
export const EXPR_CAT_NAME = { input: '상황', face: '반응' };

const reactionInit = (preset = 'basic', line = 'none') => ({ preset, ...presetFace(preset), line, say: '', style: 'brand', rate: 1, pitch: 1, more: false });

// ---- 말투 수정: rule-based ending changes on the brand line (해요체 ↔ 합쇼체), shorter, brighter ----
export const STYLES = [['brand', '브랜드 그대로'], ['polite', '공손하게 (~습니다)'], ['soft', '부드럽게 (~요)'], ['short', '짧게'], ['bright', '밝게 (!)']];
const H0 = 0xAC00, JONG_L = 8, JONG_SS = 20;
const jong = ch => { const c = ch.charCodeAt(0) - H0; return c >= 0 && c < 11172 ? c % 28 : -1; };
const withJong = (ch, j) => { const c = ch.charCodeAt(0) - H0; return String.fromCharCode(H0 + c - (c % 28) + j); };
export function styleLine(t, style) {
  if (!t || style === 'brand' || !style) return t;
  if (style === 'polite') return t
    .replace(/(\S)게요/g, (m, p) => jong(p) === JONG_L ? withJong(p, 0) + '겠습니다' : m)   // 기다릴게요 → 기다리겠습니다
    .replace(/(\S)어요/g, (m, p) => jong(p) === JONG_SS ? p + '습니다' : m)                 // 나왔어요 → 나왔습니다
    .replace(/해요/g, '합니다').replace(/세요/g, '십시오').replace(/(이에요|예요)/g, '입니다');
  if (style === 'soft') return t
    .replace(/(\S)겠습니다/g, (m, p) => jong(p) === 0 ? withJong(p, JONG_L) + '게요' : m)  // 모시겠습니다 → 모실게요
    .replace(/(\S)습니다/g, (m, p) => jong(p) === JONG_SS ? p + '어요' : m)                // 나왔습니다 → 나왔어요
    .replace(/합니다/g, '해요').replace(/십시오/g, '세요').replace(/입니다/g, '이에요');
  if (style === 'short') return (t.match(/^[^.!?~]*[.!?~]?/) || [t])[0].trim();
  if (style === 'bright') return t.replace(/[.~]+(?=\s|$)/g, '!').replace(/([^!?.~])$/, '$1!');
  return t;
}
export const EXPR_TYPES = {
  situation: {
    title: '상황', desc: '로봇이 이 상태가 되면', cat: 'input', ins: [], outs: [['on', '이때', 'bool']],
    params: [{ k: 'state', label: '상황', type: 'select', options: SITUATIONS }],
    init: () => ({ state: 'WAIT' }),
  },
  reaction: {
    title: '반응', desc: '표정(원래 얼굴을 변형)과 말', cat: 'face', ins: [['on', '상황', 'bool']], outs: [], preview: true,
    params: [
      { k: 'preset', label: '표정', type: 'select', options: [...Object.entries(FACE_PRESETS).map(([k, v]) => [k, v.label]), ['custom', '직접 조정']] },
      { k: 'more', label: '세부 조정', type: 'toggle' },
      ...FACE_KEYS.map(([k, label, min, max, step]) => ({ k, label, type: 'range', min, max, step, when: p => p.more })),
      { k: 'line', label: '말 (브랜드 말투)', type: 'select', options: LINES },
      { k: 'style', label: '말투 수정', type: 'select', options: STYLES },
      { k: 'say', label: '직접 쓰기', type: 'text' },
      { k: 'rate', label: '말 빠르기', type: 'range', min: 0.6, max: 1.6, step: 0.05 },
      { k: 'pitch', label: '목소리 높이', type: 'range', min: 0.5, max: 1.8, step: 0.05 },
      { k: 'listen', label: '목소리', type: 'button', text: '▶ 들어보기' },
    ],
    init: () => reactionInit(),
    onParam(n, k) {
      if (k === 'preset' && n.p.preset !== 'custom') { Object.assign(n.p, presetFace(n.p.preset)); return true; }
      if (FACE_KEYS.some(x => x[0] === k) && n.p.preset !== 'custom') { n.p.preset = 'custom'; return false; }
      return k === 'more';
    },
  },
};

const DEFAULT_REACT = { // state → [face preset, line]
  friendly: { NEAR: ['happy', 'none'], ARRIVE: ['happy', 'serve'], SERVE: ['happy', 'serve'], DEPART: ['happy', 'bye'], YIELD: ['sorry', 'yield'],
    WAIT: ['calm', 'wait'], DETOUR: ['focus', 'detour'], CAUTION: ['focus', 'caution'], ANY: ['basic', 'none'] },
  formal: { NEAR: ['polite', 'none'], ARRIVE: ['polite', 'serve'], SERVE: ['polite', 'serve'], DEPART: ['polite', 'bye'], YIELD: ['polite', 'yield'],
    WAIT: ['calm', 'wait'], DETOUR: ['focus', 'detour'], CAUTION: ['calm', 'caution'], ANY: ['basic', 'none'] },
  lively: { NEAR: ['surprise', 'none'], ARRIVE: ['happy', 'serve'], SERVE: ['happy', 'serve'], DEPART: ['happy', 'bye'], YIELD: ['sorry', 'yield'],
    WAIT: ['focus', 'wait'], DETOUR: ['surprise', 'detour'], CAUTION: ['focus', 'caution'], ANY: ['basic', 'none'] },
};
DEFAULT_REACT.plain = DEFAULT_REACT.friendly;
export function defaultExprGraph(register = 'friendly', faces = {}) {
  const map = Object.fromEntries(Object.entries(DEFAULT_REACT[register] || DEFAULT_REACT.friendly).map(([st, [pre, line]]) => [st, [faces[st] || pre, line]]));
  const nodes = [], links = [], rid = {};
  Object.entries(map).forEach(([state, [preset, line]], i) => {
    const key = preset + ':' + line;
    if (!rid[key]) { const n = Object.keys(rid).length; rid[key] = 'r' + (n + 1); nodes.push({ id: rid[key], type: 'reaction', x: 400 + (n % 3) * 290, y: Math.floor(n / 3) * 560, p: reactionInit(preset, line) }); }
    nodes.push({ id: 's' + i, type: 'situation', x: 40, y: i * 112, p: { state } });
    links.push({ from: ['s' + i, 'on'], to: [rid[key], 'on'] });
  });
  return { nodes, links };
}
export const validExprGraph = g => g && Array.isArray(g.nodes) && Array.isArray(g.links) && g.nodes.every(n => EXPR_TYPES[n.type]);

/** which 상황 node fires for a robot state, and the 반응 it is wired to */
export function reactionFor(g, state) {
  const sits = g.nodes.filter(n => n.type === 'situation');
  for (const s of [sits.find(n => n.p.state === state), sits.find(n => n.p.state === 'ANY')]) {
    if (!s) continue;
    const l = g.links.find(l => l.from[0] === s.id), r = l && g.nodes.find(n => n.id === l.to[0]);
    if (r) return { sit: s, node: r };
  }
  return null;
}
export const sayOf = (r, lines) => styleLine((r.p.say || '').trim() || (r.p.line === 'none' ? '' : lines[r.p.line] || ''), r.p.style);

// ---- 모션 timeline (tab C): tracks of keyframes {t, v, ease} on 6 targets × scale / x / y / rotate / opacity ----------
export const EASE_ID = { smooth: [0.42, 0, 0.58, 1], fast: [0.2, 0.9, 0.3, 1], bouncy: [0.34, 1.56, 0.64, 1], slow: [0.6, 0, 0.2, 1], linear: [0, 0, 1, 1] };
/** which properties each target can animate (and what they drive) */
export const CLIP_PROPS = { eyes: ['scale', 'y', 'rotate', 'opacity'], mouth: ['scale', 'y', 'opacity'], cheekBrow: ['y', 'rotate', 'opacity'],
  faceUi: ['scale', 'opacity'], uiElement: ['scale', 'x', 'y', 'opacity'], body: ['x', 'y', 'rotate'] };
export const PROP_BASE = { scale: 1, x: 0, y: 0, rotate: 0, opacity: 1 };
/** value of one track at time t: hold the first / last key, ease into each next key with that key's curve */
export function trackAt(tr, t) {
  const k = tr.keyframes; if (!k.length) return PROP_BASE[tr.prop];
  if (t <= k[0].t) return k[0].v; if (t >= k[k.length - 1].t) return k[k.length - 1].v;
  const i = k.findIndex(x => x.t > t), a = k[i - 1], b = k[i], p = (t - a.t) / (b.t - a.t || 1);
  return a.v + (b.v - a.v) * cubicBezier(b.bez ?? EASE_ID[b.ease] ?? EASE_ID.smooth)(p);
}
/** every target's properties at time t (defaults where nothing is animated) + which targets the clip touches */
export function evalClip(clip, t) {
  const out = {}; for (const tg of Object.keys(CLIP_PROPS)) out[tg] = { ...PROP_BASE };
  for (const tr of clip?.tracks ?? []) if (out[tr.target] && tr.keyframes.length) { out[tr.target][tr.prop] = trackAt(tr, t); out[tr.target].on = true; }
  return out;
}
/** the clip on top of the face (still only transforms of the original face) */
export function applyClipFace(f, v) {
  const o = { ...f };
  o.eyeSize *= v.eyes.scale; o.eyeOpen *= v.eyes.opacity; o.eyeY = (o.eyeY || 0) + v.eyes.y; o.eyeTilt = (o.eyeTilt || 0) + v.eyes.rotate;
  o.mouthSize *= v.mouth.scale * v.mouth.opacity; o.mouth += v.mouth.y;
  o.cheek *= v.cheekBrow.opacity; o.brow = (o.brow || 0) + v.cheekBrow.y; o.browTilt = (o.browTilt || 0) + v.cheekBrow.rotate;
  return o;
}
/** guardrail: the most eye closings inside any 1 s window (more than 3 per second is too flashy) */
export function blinkRate(clip) {
  const tr = clip?.tracks?.find(x => x.target === 'eyes' && x.prop === 'opacity'); if (!tr) return 0;
  const shut = []; let was = false;
  for (let t = 0; t <= clip.duration + 1e-6; t += 0.02) { const s = trackAt(tr, t) < 0.4; if (s && !was) shut.push(t); was = s; }
  if (clip.loop && shut.length) for (const t of [...shut]) shut.push(t + clip.duration); // loops repeat
  return Math.max(0, ...shut.map(t0 => shut.filter(t => t >= t0 && t < t0 + 1).length));
}
