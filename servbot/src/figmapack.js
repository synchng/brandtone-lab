// Screens designed in Figma (BrandTone plugin) on servbot's robot. Only active as ?figma=1, i.e. embedded in the plugin panel:
// the plugin hands over each State's layers (background, content PNG, face PNG + box, Motion keyframes); servbot plays them
// on the design robot's face screen. A table number the plugin has not rendered yet is asked for once and drawn when it arrives.
export const FIGMA = new URLSearchParams(location.search).has('figma');
const toParent = m => { try { parent.postMessage(m, '*'); } catch { /* not embedded */ } };
const bitmap = async u8 => u8 ? createImageBitmap(new Blob([u8], { type: 'image/png' })) : null;

/** wait for the plugin's pack (null after `ms`: servbot then runs with its own screens and says so) */
export function waitPack(ms = 15000) {
  return new Promise(res => {
    const done = p => { removeEventListener('message', on); clearTimeout(to); clearInterval(ping); res(p); };
    const on = async e => {
      if (e.data?.type !== 'brandtone.pack') return;
      const p = e.data.pack, screens = {};
      for (const s of p.screens) screens[s.stateId] = { bg: s.bg, faceBox: s.faceBox, tracks: s.tracks, loop: s.loop, tabled: s.tabled, face: await bitmap(s.face), content: { [p.table]: await bitmap(s.content) } };
      const pack = { brand: p.brand, table: p.table, display: p.display, screens, asked: new Set([p.table]) };
      addEventListener('message', async e2 => { // later: a table number rendered on request
        if (e2.data?.type !== 'brandtone.table') return;
        for (const [id, u8] of Object.entries(e2.data.contents)) if (pack.screens[id]) pack.screens[id].content[e2.data.table] = await bitmap(u8);
      });
      toParent({ type: 'brandtone.packOk', screens: Object.keys(screens).length });
      done(pack);
    };
    addEventListener('message', on);
    const ping = setInterval(() => toParent({ type: 'brandtone.ready' }), 500); toParent({ type: 'brandtone.ready' });
    const to = setTimeout(() => done(null), ms);
  });
}

/** which designed State the robot is in (first that has a screen) */
const ORDER = {
  IDLE: ['idle'], HOME: ['returning', 'moving'], CRUISE: ['moving'], NEAR: ['moving'], DETOUR: ['moving'],
  CAUTION: ['excuse', 'moving'], YIELD: ['excuse', 'moving'], WAIT: ['excuse', 'moving'],
  ARRIVE: ['arrived'], SERVE: ['arrived'], DEPART: ['done', 'returning'],
};
export function packState(pack, r, near) {
  const has = id => !!pack.screens[id];
  if (r.stall > 4 && has('error')) return 'error';
  if (r.task === 'toTable' && r.label === 'CRUISE' && (r.stateT ?? 9) < 1.5 && has('ready')) return 'ready'; // just dispatched: 출발 준비
  return (ORDER[near ? 'NEAR' : r.label] ?? ['moving']).find(has) ?? Object.keys(pack.screens)[0];
}
export const tableOf = r => (r.table || '').replace('Table_', '').replace(/^0/, '');

// ---- Figma Motion keyframes (same rules as the plugin's bridge.ts; ponytail: copied, the two run in different places) ----
function bezier(x1, y1, x2, y2) {
  const f = (a, b, t) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t * t + t ** 3;
  return x => { let lo = 0, hi = 1; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (f(x1, x2, m) < x) lo = m; else hi = m; } return f(y1, y2, (lo + hi) / 2); };
}
const CURVES = { LINEAR: x => x, EASE_IN: bezier(0.42, 0, 1, 1), EASE_OUT: bezier(0, 0, 0.58, 1), EASE_IN_AND_OUT: bezier(0.42, 0, 0.58, 1), EASE_OUT_BACK: bezier(0.34, 1.56, 0.64, 1) };
const ease = e => !e ? CURVES.EASE_OUT : e.type === 'HOLD' ? x => (x < 1 ? 0 : 1) : e.type === 'CUSTOM_CUBIC_BEZIER' && e.easingFunctionCubicBezier ? bezier(...['x1', 'y1', 'x2', 'y2'].map(k => e.easingFunctionCubicBezier[k]))
  : e.type === 'CUSTOM_SPRING' ? (b => x => x >= 1 ? 1 : 1 - Math.exp(-x * (10 - 7 * b)) * Math.cos(x * Math.PI * (1 + 3 * b)))(e.easingFunctionSpring?.bounce ?? 0.3) : CURVES[e.type] ?? CURVES.EASE_OUT;
function valueAt(tr, t) {
  const k = tr.keys; if (t <= k[0].t) return k[0].v;
  for (let i = 1; i < k.length; i++) if (t <= k[i].t) { const a = k[i - 1], b = k[i]; return a.v + (b.v - a.v) * ease(b.ease)((t - a.t) / Math.max(1e-6, b.t - a.t)); }
  return k[k.length - 1].v;
}
function pose(ts, t) {
  const g = (f, d) => { const tr = ts.find(x => x.field === f && x.keys.length); return tr ? valueAt(tr, t) : d; }, s = g('SCALE_XY', 1);
  return { x: g('TRANSLATION_X', 0), y: g('TRANSLATION_Y', 0), rot: g('ROTATION', 0), sx: s * g('SCALE_X', 1), sy: s * g('SCALE_Y', 1), o: g('OPACITY', 1) };
}
const end = ts => Math.max(0, ...ts.flatMap(t => t.keys.map(k => k.t)));

/** draw one State's screen at time t since it came up. Returns the table it still needs (or null). */
export function drawPack(ctx, pack, scr, table, t) {
  const W = ctx.canvas.width, H = ctx.canvas.height, k = W / pack.display.w;
  let need = null, img = scr.content[table];
  if (!img) { if (scr.tabled && table && !pack.asked.has(table)) { pack.asked.add(table); need = table; } img = scr.content[pack.table]; }
  const e = Math.max(end(scr.tracks.face), end(scr.tracks.info)), tm = scr.loop && e > 0 ? t % (e + 0.8) : t;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = scr.bg; ctx.fillRect(0, 0, W, H);
  const i = pose(scr.tracks.info, tm);
  if (img) { ctx.globalAlpha = Math.min(1, Math.max(0, i.o)); ctx.drawImage(img, i.x * k, i.y * k, W, H); ctx.globalAlpha = 1; }
  if (scr.face && scr.faceBox) {
    const f = pose(scr.tracks.face, tm), b = scr.faceBox;
    ctx.save(); ctx.translate((b.x + b.w / 2 + f.x) * k, (b.y + b.h / 2 + f.y) * k); ctx.rotate(-f.rot * Math.PI / 180); ctx.scale(f.sx, f.sy); ctx.globalAlpha = Math.min(1, Math.max(0, f.o));
    ctx.drawImage(scr.face, -b.w * k / 2, -b.h * k / 2, b.w * k, b.h * k); ctx.restore();
  }
  if (need) toParent({ type: 'brandtone.needTable', table: need });
  return need;
}
