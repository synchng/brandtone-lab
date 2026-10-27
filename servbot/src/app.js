// Servbot Lab — three.js viewport + glass UI + modes (simulate / user test / exhibition).
// BrandTone version: the robot's route (behavior graph) is fixed; what you edit is the 표현 그래프 —
// which face (a transform of the model's own face texture) and which brand line the design robot B shows in each situation.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Grid, Sim, SPACES, DT, defaultParams, runHeadless, rng } from './sim.js?v=7';
import { baselineGraph, designedGraph, STATE_LABEL, LED_COLOR } from './graph.js?v=7';
import { createEditor } from './editor.js?v=7';
import { layoutScreen, drawScreen, FONTS_READY } from './screenui.js';
import { FIGMA, waitPack, packState, drawPack, tableOf } from './figmapack.js';
import { makeFaceSource, drawFace, drawPreview, tweenFace, MOTION0, screenLayer, drawStatus, drawFx, evalClip, applyClipFace, cubicBezier, FACE0, FACE_PRESETS, EXPR_TYPES, EXPR_CAT, EXPR_CAT_NAME, defaultExprGraph, validExprGraph, reactionFor, sayOf, DEFAULT_LINES } from './express.js?v=1';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem('servbot.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('servbot.' + k, JSON.stringify(v)); } catch { /* private mode: keep in memory */ } },
};
const NUM = ['①', '②', '③', '④'];
// the space comes from ?space=…; without it the space picker is shown first
const SPACE_ID = new URLSearchParams(location.search).get('space');
const SPACE = SPACES[SPACE_ID] || SPACES.shinsa;
const SCENARIOS = SPACE.scenarios;
const FOCUS = SCENARIOS.map(s => s.focus);
const SEED = 7;

// ---- state ------------------------------------------------------------------------------------
const params = defaultParams();
const graphs = { A: baselineGraph(), B: designedGraph() }; // movement is not edited any more
// brand from the BrandTone app (same origin): lines in the brand's register, glow + body colour
// (embedded in the Figma plugin: the screens come from Figma instead — see figmapack.js — so the app's brand is not mixed in)
const BRAND = FIGMA ? null : (() => { try { return JSON.parse(localStorage.getItem('brandtone.sim')); } catch { return null; } })();
let PACK = null; // screens made in Figma, when servbot runs inside the BrandTone plugin
// faces tuned on the 표정 tab become presets here too (same transforms of the original face)
for (const [k, v] of Object.entries(BRAND?.customFaces || {})) FACE_PRESETS[k] = { label: v.label, ...v.p };
// each brand + its 로봇 만들기 face picks keeps its own 표현 그래프
const EXPR_KEY = 'expr3.' + (BRAND?.brand || 'default') + '.' + Object.values(BRAND?.faces || {}).join('') + JSON.stringify(BRAND?.customFaces || {});
const xgraph = validExprGraph(store.get(EXPR_KEY)) ? store.get(EXPR_KEY) : defaultExprGraph(BRAND?.register, BRAND?.faces);
const LINES = { ...DEFAULT_LINES, ...BRAND?.lines };
const FACE_COLOR = BRAND?.glow || '#b0f7ff'; // the texture's own cyan when there is no brand
let faceSrc = null;
// 모션 · 안내 from the 로봇 만들기 page: the face moves along the brand's easing curve, gestures play on the face screen, the chest display shows the 상태창
const MOTION = { ...MOTION0, ...BRAND?.motion }, GUIDE = BRAND?.guide;
// 화면 UI + 모션 timeline from the 2단계 tabs: which screen each situation shows, where (chest strip / whole face), and the clip
const UI_KIT = BRAND?.ui?.kit, SCREENS = BRAND?.ui?.screens, CLIP = BRAND?.clip;
const SCREEN_OF = { IDLE: 'idle', HOME: 'idle', NEAR: 'order', CRUISE: 'serving', CAUTION: 'serving', DETOUR: 'serving', YIELD: 'serving', WAIT: 'serving', ARRIVE: 'arrived', SERVE: 'done', DEPART: 'done' };
const FACE_UI = ['order', 'arrived', 'done']; // over the whole face only at the moments a guest reads it; the rest of the time the face shows
let uiFonts = 0; FONTS_READY.then(() => uiFonts++);
// 표정 폭 from the 로봇 만들기 page: push every expression further from / closer to the original face
const scaleFace = p => { const k = BRAND?.faceScale ?? 1; if (k === 1) return p; const o = {}; for (const key in FACE0) o[key] = FACE0[key] + ((p[key] ?? FACE0[key]) - FACE0[key]) * k; return o; };
let grid, sims = {}, scIdx = 1, view = 'B', playing = true, speed = 1, acc = 0, mode = 'sim', muted = false;
let selected = null, editK = 'B', hudOpen = false, inspectorMode = null, lastInput = performance.now(), exReturn = false;

// ---- three ------------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0; // keeps the .blend's colours closer than ACES
renderer.localClippingEnabled = true;
$('#stage').append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e7e4df');
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; // soft studio light like Blender's viewport
scene.environmentIntensity = 0.8;
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
camera.position.set(12, 22, -14);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(16, 0, 7); controls.enableDamping = true; controls.screenSpacePanning = false;
controls.maxPolarAngle = 1.3; controls.minDistance = 4; controls.maxDistance = 70;
scene.add(new THREE.HemisphereLight(0xffffff, 0xd6cfc4, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(6, 22, -4); sun.target.position.set(15, 0, 8); sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 14, bottom: -14, near: 1, far: 60 });
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.intensity = 0.55;
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#dcd8d1', roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(15, -0.16, 8); ground.receiveShadow = true; scene.add(ground);
const wallClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.35); // optional dollhouse cut (W): walls stop at 1.35 m
const cutMats = [];
let cutaway = store.get('cutaway', false);
function setCutaway(on) {
  cutaway = on; store.set('cutaway', on);
  for (const m of cutMats) { m.clippingPlanes = on ? [wallClip] : []; m.needsUpdate = true; }
  $$('#toolbar [data-act=cut]').forEach(b => b.classList.toggle('on', on));
}

function loadSpace() { // the .blend as exported: original geometry and materials
  return new Promise((res, rej) => new GLTFLoader().load(SPACE.glb, gltf => {
    gltf.scene.position.set(...SPACE.offset); // line the model up with the sim grid (x shift, floor to y = 0)
    const tall = /Wall|Column|Col_|Pilaster|Lintel|Door|Locker|Room|Staff|Elec|KitBack|Hall_|RightStore|StairCore|StairFence|Storage|ThinPartition|Hood|Outer_|Restroom|Kitchen_West|Pendant|Art_|DID|Banquette_Back|Lamp/;
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      let p = o, name = ''; while (p && p !== gltf.scene) { name = p.name + ' ' + name; p = p.parent; }
      if (tall.test(name)) { // own material copy so the cutaway never touches furniture sharing it
        const one = m => { const c = m.clone(); cutMats.push(c); return c; };
        o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
      }
    });
    scene.add(gltf.scene); setCutaway(cutaway); res();
  }, undefined, rej));
}

// BellaBot model (assets/robot.glb), normalized once: 1.29 m tall, centered, face pointing local +x (sim heading 0)
let robotTemplate = null;
function loadRobot() {
  return new Promise((res, rej) => new GLTFLoader().load('assets/robot.glb', gltf => {
    const inner = gltf.scene, holder = new THREE.Group(); holder.add(inner);
    const box = new THREE.Box3().setFromObject(holder), c = box.getCenter(new THREE.Vector3());
    const face = inner.getObjectByName('face_1') || inner.getObjectByName('face');
    if (face) { const fc = new THREE.Box3().setFromObject(face).getCenter(new THREE.Vector3()); inner.rotation.y = Math.atan2(fc.z - c.z, fc.x - c.x); }
    holder.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(holder), size = b2.getSize(new THREE.Vector3()), c2 = b2.getCenter(new THREE.Vector3());
    const k = 1.29 / size.y;
    holder.scale.setScalar(k); holder.position.set(-c2.x * k, -b2.min.y * k, -c2.z * k);
    inner.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.material.name === 'kerface' && o.material.map?.image) faceSrc = makeFaceSource(o.material.map.image); } });
    robotTemplate = holder; res();
  }, undefined, rej));
}

// ---- agent visuals ----------------------------------------------------------------------------
const M = {
  person: new THREE.MeshStandardMaterial({ color: '#4a4744', roughness: 0.8 }),
  seated: new THREE.MeshStandardMaterial({ color: '#6b6762', roughness: 0.8 }),
  sel: new THREE.MeshBasicMaterial({ color: '#0a84ff', transparent: true, opacity: 0.9, depthWrite: false }),
};
const G = {
  body2: new THREE.CapsuleGeometry(0.17, 0.85, 4, 12), headS: new THREE.SphereGeometry(0.11, 16, 12),
  sit: new THREE.CapsuleGeometry(0.17, 0.45, 4, 12), ring: new THREE.RingGeometry(0.38, 0.43, 48),
};
function canvasTex(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return { c, ctx: c.getContext('2d'), t }; }

function makeRobot(k) {
  const g = new THREE.Group();
  const model = robotTemplate.clone(true);
  const neon = []; // the model's glowing strips act as the LED; each robot gets its own copy to tint
  const brand = k === 'B';
  let face = null, faceMesh = null;
  model.traverse(o => {
    if (!o.isMesh) return;
    const swap = m => {
      if (m.name === 'Neon') { const c = m.clone(); neon.push(c); return c; }
      if (brand && BRAND?.body && (m.name === 'White' || m.name === 'AO_BAKED')) { const c = m.clone(); c.color.set(BRAND.body); return c; }
      if (brand && faceSrc && m.name === 'kerface') {
        const cv = document.createElement('canvas'); cv.width = faceSrc.w; cv.height = faceSrc.h;
        const t = new THREE.CanvasTexture(cv); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
        const c = m.clone(); c.map = t; faceMesh = o; face = { ctx: cv.getContext('2d'), t, f: { ...FACE0 }, blink: 0, next: 2 + Math.random() * 3 }; return c;
      }
      return m;
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  g.add(model);
  // on the robot itself: 화면 동세 over the face screen, the 상태창 (guide UI) on the chest display under the head
  const status = face && GUIDE ? screenLayer(THREE, faceMesh, g, 'chest') : null; if (status) { g.add(status.mesh); status.s = { enter: '', key: '', t0: 0, anim: false }; }
  const fx = face && BRAND?.fx ? screenLayer(THREE, faceMesh, g, 'face') : null; if (fx) { g.add(fx.mesh); fx.s = { id: 'none', t: 0, on: false }; }
  const ui = face && (UI_KIT?.where === 'face' || PACK) ? screenLayer(THREE, faceMesh, g, 'face') : null; if (ui) { ui.mesh.renderOrder = 3; g.add(ui.mesh); ui.s = { key: '', k: 0, show: false, L: null }; }
  const fl = canvasTex(512, 512);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ map: fl.t, transparent: true, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(1, 0.015, 0); g.add(floor);
  const ring = new THREE.Mesh(G.ring, M.sel); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; ring.visible = false; g.add(ring);
  g.userData = { neon, neonBase: neon.map(m => brand && BRAND?.glow ? new THREE.Color(BRAND.glow) : m.emissive.clone()), fl, floor, ring, floorKey: null, floorT: 0, face, status, fx, ui, clipT: null };
  return g;
}
// Bunny people (assets/bunny.glb, rigged by tools/rig_bunny.py): 6 bones driven procedurally — walk, idle, sit
const BUNNY_H = 1.35, HIP = 0.27 / 1.476; // model height in m; hip height as a fraction of the original
let bunnyTemplate = null, bunnyAxis = {};
function loadBunny() {
  return new Promise((res, rej) => new GLTFLoader().load('assets/bunny.glb', gltf => {
    const inner = gltf.scene;
    inner.updateMatrixWorld(true);
    // swing axis = the bunny's left-right axis, expressed in each bone's own frame (computed in rest pose)
    const q = new THREE.Quaternion();
    inner.traverse(o => { if (o.isBone) { o.getWorldQuaternion(q); bunnyAxis[o.name] = new THREE.Vector3(1, 0, 0).applyQuaternion(q.invert()).normalize(); } });
    inner.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    const box = new THREE.Box3().setFromObject(inner), k = BUNNY_H / (box.max.y - box.min.y);
    inner.rotation.y = Math.PI / 2; // model faces +Z; sim heading 0 is +X
    const holder = new THREE.Group(); inner.scale.setScalar(k); inner.position.y = -box.min.y * k; holder.add(inner);
    bunnyTemplate = holder; res();
  }, undefined, rej));
}
const swing = new THREE.Quaternion();
function poseBunny(ud, legs, arms, head = 0) {
  for (const [n, a] of [['legL', legs], ['legR', -legs], ['armL', arms], ['armR', -arms], ['head', head]]) {
    const b = ud.bones[n]; if (!b) continue;
    b.bone.quaternion.copy(b.rest).multiply(swing.setFromAxisAngle(bunnyAxis[n], a));
  }
}
function makeHuman(seated) {
  const g = new THREE.Group();
  if (!bunnyTemplate) { // fallback if the glb failed
    const b = new THREE.Mesh(seated ? G.sit : G.body2, M.person); b.position.y = 0.6; g.add(b); g.userData = { bones: {}, phase: 0 }; return g;
  }
  const m = SkeletonUtils.clone(bunnyTemplate); g.add(m);
  const bones = {};
  for (const n of ['legL', 'legR', 'armL', 'armR', 'head', 'hips']) { const b = m.getObjectByName(n); if (b) bones[n] = { bone: b, rest: b.quaternion.clone() }; }
  g.userData = { bones, phase: Math.random() * 6, model: m };
  if (seated) { poseBunny(g.userData, -1.45, -0.55); m.position.y = 0.47 - HIP * BUNNY_H; } // thighs forward, hands on lap, hips on the seat
  return g;
}
function animateHuman(g, h, dt, t) {
  const ud = g.userData, sp = Math.hypot(h.vx, h.vy), a = Math.min(1, sp / 1.0);
  if (h.scale && g.scale.x !== h.scale) g.scale.setScalar(h.scale);
  if (h.seated) { poseBunny(ud, -1.45, -0.55); if (ud.model) ud.model.position.y = 0.47 - HIP * BUNNY_H; return; }
  ud.phase += sp * dt * Math.PI * 2 / 0.55; // ~0.55 m per stride for short bunny legs
  const sw = Math.sin(ud.phase);
  if (a > 0.05) poseBunny(ud, -sw * 0.6 * a, sw * 0.5 * a, Math.sin(ud.phase * 2) * 0.03 * a);
  else poseBunny(ud, 0, Math.sin(t * 1.6) * 0.05, 0); // idle: breathing arms
  if (ud.model) ud.model.position.y = Math.abs(Math.cos(ud.phase)) * 0.03 * a;
}

const visuals = { A: null, B: null };
const seatedGroup = new THREE.Group(); scene.add(seatedGroup);
function buildVisuals(k) {
  if (visuals[k]) scene.remove(visuals[k].group);
  const s = sims[k]; if (!s) { visuals[k] = null; return; }
  const group = new THREE.Group();
  const robots = s.robots.map(() => { const m = makeRobot(k); group.add(m); return m; });
  const humans = s.humans.map(() => { const m = makeHuman(false); group.add(m); return m; });
  scene.add(group);
  visuals[k] = { group, robots, humans };
  seatedGroup.clear();
  const tables = grid.obstacles.filter(o => /^Table_(?!Rail)/.test(o.name)).map(o => [(o.minX + o.maxX) / 2, (o.minY + o.maxY) / 2]);
  for (const [x, y] of s.seated) {
    const m = makeHuman(true); m.position.set(x, 0, y);
    const t = tables.reduce((b, c) => Math.hypot(c[0] - x, c[1] - y) < Math.hypot(b[0] - x, b[1] - y) ? c : b, tables[0]);
    if (t) m.rotation.y = -Math.atan2(t[1] - y, t[0] - x);
    seatedGroup.add(m);
  }
}

function drawFloor(r, u, now) {
  const kind = r.signal.floor || 'none';
  u.floor.visible = kind !== 'none';
  if (kind === 'none') return;
  if (kind === u.floorKey && now - u.floorT < 100) return;
  u.floorKey = kind; u.floorT = now;
  const { ctx, t } = u.fl, S = 512 / 3, ox = 0.5 * S, oy = 256;
  const local = ([x, y]) => { const dx = x - r.x, dy = y - r.y, c = Math.cos(-r.heading), s = Math.sin(-r.heading); return [ox + (dx * c - dy * s) * S, oy + (dx * s + dy * c) * S]; };
  ctx.clearRect(0, 0, 512, 512);
  const chevrons = (ang, color, n, from) => {
    ctx.save(); ctx.translate(ox, oy); ctx.rotate(ang); ctx.strokeStyle = color; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < n; i++) { const x = (from + i * 0.4) * S; ctx.beginPath(); ctx.moveTo(x - 18, -22); ctx.lineTo(x, 0); ctx.lineTo(x - 18, 22); ctx.stroke(); }
    ctx.restore();
  };
  if (kind === 'path') {
    ctx.fillStyle = 'rgba(10,132,255,.55)';
    const pts = r.samples.slice(r.si, r.si + 22);
    for (let i = 0; i < pts.length; i += 3) { const [px, py] = local(pts[i]); ctx.beginPath(); ctx.arc(px, py, 7, 0, 7); ctx.fill(); }
  } else if (kind === 'stop') {
    ctx.fillStyle = 'rgba(255,159,10,.95)'; ctx.fillRect(ox + 0.5 * S, oy - 0.36 * S, 12, 0.72 * S);
  } else if (kind === 'arrow') {
    const tgt = r.act?.face || r.lookAhead(1.2); const [px, py] = local(tgt);
    chevrons(Math.atan2(py - oy, px - ox), 'rgba(255,159,10,.95)', 3, 0.45);
  } else if (kind === 'clear') {
    const [px, py] = local(r.lookAhead(1.5)); const ang = Math.atan2(py - oy, px - ox);
    ctx.save(); ctx.translate(ox, oy); ctx.rotate(ang); ctx.fillStyle = 'rgba(52,199,89,.22)'; ctx.fillRect(0.35 * S, -0.4 * S, 2 * S, 0.8 * S); ctx.restore();
    chevrons(ang + Math.PI, 'rgba(52,199,89,.85)', 0, 0);
    ctx.save(); ctx.translate(ox, oy); ctx.rotate(ang); ctx.strokeStyle = 'rgba(52,199,89,.9)'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) { const x = (0.6 + i * 0.45) * S; ctx.beginPath(); ctx.moveTo(x + 18, -22); ctx.lineTo(x, 0); ctx.lineTo(x + 18, 22); ctx.stroke(); }
    ctx.restore();
  }
  t.needsUpdate = true;
}

let frameDt = 0;
function syncVisuals(now) {
  for (const k of ['A', 'B']) {
    const v = visuals[k], s = sims[k]; if (!v || !s) continue;
    s.robots.forEach((r, i) => {
      const m = v.robots[i], u = m.userData;
      m.position.set(r.x, 0, r.y); m.rotation.y = -r.heading;
      const led = r.signal.led || 'white', pat = r.signal.pattern;
      const on = pat === 'blink' ? Math.sin(now / 160) > 0 : pat === 'fast' ? Math.sin(now / 60) > 0 : true;
      // white = the model's own neon colour; other states tint it
      u.neon.forEach((m, j) => { if (led === 'white') m.emissive.copy(u.neonBase[j]); else m.emissive.set(LED_COLOR[led]); m.emissiveIntensity = led === 'off' ? 0 : on ? 1.6 : 0.15; });
      u.ring.visible = selected?.k === k && selected.id === r.id;
      drawFloor(r, u, now);
      // a guest close by while driving counts as its own situation (손님이 가까이)
      const near = ['CRUISE', 'CAUTION', 'HOME'].includes(r.label) && (r.sense?.dist < 2.2 || r.sense?.seated >= 1) && xgraph.nodes.some(n => n.p.state === 'NEAR');
      r.reaction = k === 'B' ? reactionFor(xgraph, near ? 'NEAR' : r.label) : null;
      if (u.face) { // move to the reaction's face along the brand curve (blink first when the motion says so), blink every 3–6 s
        const F = u.face, dt = frameDt;
        if (tweenFace(F.tw ??= { f: F.f }, r.reaction ? scaleFace(r.reaction.node.p) : FACE0, r.reaction?.node.id ?? 'none', dt, MOTION)) {
          if (MOTION.anim === 'blink') F.blink = 1;
          if (u.fx) Object.assign(u.fx.s, { id: BRAND.fx[near ? 'NEAR' : r.label] || 'none', t: 0, on: true }); // 화면 동세 comes in with the expression
          if (CLIP) u.clipT = 0; // the 모션 timeline plays once with each new expression
        }
        const cv = u.clipT != null ? evalClip(CLIP, u.clipT) : null; if (cv && (u.clipT += dt) > CLIP.duration) u.clipT = null; u.cv = cv;
        if (u.fx?.s.on) { u.fx.s.t += dt; u.fx.s.on = drawFx(u.fx.ctx, u.fx.s.id, u.fx.s.t, FACE_COLOR); u.fx.tex.needsUpdate = true; }
        if ((F.next -= dt) < 0) { F.blink = 1; F.next = 3 + Math.random() * 3; }
        F.blink = Math.max(0, F.blink - dt / 0.16);
        drawFace(F.ctx, faceSrc, u.cv ? applyClipFace(F.f, u.cv) : F.f, FACE_COLOR, Math.sin(F.blink * Math.PI)); F.t.needsUpdate = true;
      }
      const sid = SCREENS && SCREEN_OF[near ? 'NEAR' : r.label], vars = { table: (r.table || '').replace('Table_', '').replace(/^0/, '') || '-' };
      if (PACK && u.ui) { // the Figma screen for this State, its Motion keyframes playing from when the State came up
        const U = u.ui.s, id = packState(PACK, r, near); if (id !== U.pid) { U.pid = id; U.pt = 0; } U.pt += frameDt;
        drawPack(u.ui.ctx, PACK, PACK.screens[id], tableOf(r), U.pt); u.ui.tex.needsUpdate = true;
      } else if (u.ui && sid) { // 화면 UI over the whole face: crossfade + slight scale on the brand's motion curve (the timeline can drive it)
        const U = u.ui.s, show = FACE_UI.includes(sid), key = sid + vars.table + uiFonts, c = u.ui.ctx, W = c.canvas.width, H = c.canvas.height;
        if (key !== U.key) { U.key = key; if (show) U.L = layoutScreen(SCREENS[sid], UI_KIT, W, H, vars); U.redraw = true; }
        const k0 = U.k; U.k = Math.min(1, Math.max(0, U.k + (show ? 1 : -1) * frameDt / Math.max(0.05, MOTION.duration / 1000)));
        const cv = u.cv, clipUi = cv && (cv.faceUi.on || cv.uiElement.on) && show;
        if (U.k !== k0 || U.redraw || clipUi) {
          const e = cubicBezier(MOTION.bezier)(U.k), a = clipUi && cv.faceUi.on ? cv.faceUi.opacity : e; c.clearRect(0, 0, W, H); U.redraw = false;
          if (U.L && a > 0.001) drawScreen(c, U.L, { alpha: Math.min(1, a), scale: (clipUi ? cv.faceUi.scale * cv.uiElement.scale : 0.94 + 0.06 * e), dx: clipUi ? cv.uiElement.x * W * 0.3 : 0, dy: clipUi ? -cv.uiElement.y * H * 0.3 : 0, content: clipUi ? cv.uiElement.opacity : 1 });
          u.ui.tex.needsUpdate = true;
        }
      }
      if (u.status && UI_KIT?.where === 'chest' && sid) { // the chest display shows the screen state in its one-row form
        const S = u.status.s, key = 'ui' + sid + vars.table + uiFonts, c = u.status.ctx;
        if (key !== S.key) { S.key = key; c.clearRect(0, 0, c.canvas.width, c.canvas.height); drawScreen(c, layoutScreen(SCREENS[sid], UI_KIT, c.canvas.width, c.canvas.height, vars)); u.status.tex.needsUpdate = true; }
      } else if (u.status) { // 상태창: what the robot says now (or its state), styled + animated like the brand's guide UI
        const quiet = ['CRUISE', 'IDLE', 'HOME'].includes(r.label) && !(selected?.k === k && selected.id === r.id);
        const say = r.reaction ? sayOf(r.reaction.node, LINES).replace('{table}', (r.table || '').replace('Table_', '').replace(/^0/, '')) : '';
        const st = { text: quiet ? '' : say || STATE_LABEL[r.label], label: say ? STATE_LABEL[r.label] : '' }, S = u.status.s, t = performance.now();
        const enter = st.text + st.label, key = enter + (r.signal.led || '');
        if (enter !== S.enter) { S.enter = enter; S.t0 = t; S.anim = true; }
        if (key !== S.key) { S.key = key; S.anim = true; }
        if (S.anim) { S.anim = drawStatus(u.status.ctx, { ...st, on: !!say, guide: GUIDE, color: FACE_COLOR, t0: S.t0 }, t); u.status.tex.needsUpdate = true; }
      }
    });
    s.humans.forEach((h, i) => { const m = v.humans[i]; m.visible = !h.gone; m.position.set(h.x, 0, h.y); m.rotation.y = -h.heading; animateHuman(m, h, frameDt * (playing ? speed : 0), now / 1000); });
  }
}

// ---- sims -------------------------------------------------------------------------------------
const curScenario = () => SCENARIOS[scIdx];
function makeSims(keys = ['B']) { // only the designed robot B in the simulation (A stays for test / exhibition)
  sims = {};
  for (const k of keys) sims[k] = new Sim({ grid, scenario: curScenario(), params, graph: graphs[k], seed: SEED });
  buildVisuals('A'); buildVisuals('B');
  acc = 0; selected = selected && sims[selected.k] ? selected : null;
  refreshTime(); renderInspector();
  resetPovYaw(); renderPovInfo();
}
function loadScenario(i, { focus = true } = {}) {
  scIdx = i;
  $('#scenarioBtn').firstChild.textContent = `${NUM[i]} ${SCENARIOS[i].name} `;
  makeSims(mode === 'test' ? Object.keys(sims) : ['B']);
  if (focus) focusOn(FOCUS[i][0], FOCUS[i][1], 22);
  playing = true; refreshPlay();
}
const visibleKeys = () => view === 'AB' ? ['A', 'B'].filter(k => sims[k]) : [view].filter(k => sims[k]);
const mainSim = () => sims[view === 'AB' ? 'B' : view] || Object.values(sims)[0];

// ---- sound (WebAudio, generated) --------------------------------------------------------------
let audio = null;
function sound(kind) {
  if (muted) return;
  try {
    audio = audio || new AudioContext();
    const t0 = audio.currentTime;
    const tone = (f, at, dur, type = 'sine', vol = 0.07) => {
      const o = audio.createOscillator(), g = audio.createGain(); o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + at); g.gain.linearRampToValueAtTime(vol, t0 + at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      o.connect(g).connect(audio.destination); o.start(t0 + at); o.stop(t0 + at + dur + 0.02);
    };
    if (kind === 'chime') { tone(880, 0, 0.35); tone(1318, 0.12, 0.5); }
    else if (kind === 'soft') tone(660, 0, 0.4, 'sine', 0.05);
    else if (kind === 'beep' || kind === 'beepRepeat') tone(1000, 0, 0.14, 'square', 0.035);
    else if (kind === 'voiceRepeat') { tone(392, 0, 0.18, 'triangle'); tone(440, 0.2, 0.18, 'triangle'); tone(349, 0.4, 0.3, 'triangle'); }
  } catch { /* audio blocked until first gesture */ }
}

// ---- voice: the browser's built-in speech synthesis (free, offline on most OSes) ---------------
// brand voice (rate/pitch from BrandTone) × the 반응 node's own 말 빠르기 / 목소리 높이
const tts = window.speechSynthesis || null;
let koVoice = null, voiceOk = false;
const pickVoice = () => { koVoice = tts?.getVoices().find(v => /^ko/i.test(v.lang)) || null; };
if (tts) { pickVoice(); tts.onvoiceschanged = pickVoice; }
function speak(text, node) {
  if (!tts || muted || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR'; if (koVoice) u.voice = koVoice;
  u.rate = Math.min(2, (BRAND?.voice?.rate || 1) * (node?.p.rate || 1) * Math.min(speed, 1.6));
  u.pitch = Math.min(2, (BRAND?.voice?.pitch || 1) * (node?.p.pitch || 1));
  u.onstart = () => { voiceOk = true; };
  tts.cancel(); tts.speak(u);
}
// browsers only allow speech after the user has touched the page once
addEventListener('pointerdown', () => { if (tts && !voiceOk) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; tts.speak(u); voiceOk = true; } }, { once: true, capture: true });
function voiceTick() { // say the line once when the watched robot enters a situation that has one
  const s = sims.B; if (!s || mode !== 'sim' || !playing) return;
  const r = s.robots[selected?.k === 'B' ? selected.id : 0]; if (!r?.reaction) return;
  const key = r.label + ':' + r.reaction.node.id;
  if (key === r.spoken) return;
  r.spoken = key;
  const line = sayOf(r.reaction.node, LINES).replace('{table}', (r.table || '').replace('Table_', '').replace(/^0/, ''));
  if (line && !['CRUISE', 'IDLE', 'HOME'].includes(r.label)) speak(line, r.reaction.node);
}

// ---- main loop --------------------------------------------------------------------------------
let last = performance.now(), uiT = 0, focusAnim = null;
function stepAll() {
  for (const s of Object.values(sims)) s.step();
  const hear = mode === 'test' ? Object.values(sims)[0] : view === 'A' ? sims.A : sims.B;
  for (const s of Object.values(sims)) { if (s === hear) for (const e of s.sounds) sound(e.kind); s.sounds.length = 0; }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now; frameDt = dt;
  if (playing && grid) {
    acc += dt * speed; let n = 0;
    while (acc >= DT && n++ < 80) { stepAll(); acc -= DT; onStep(); if (!playing) { acc = 0; break; } }
    if (mode === 'sim' && Object.values(sims).every(s => s.done)) { playing = false; refreshPlay(); toast('상황이 끝났어요 · ▶ 다시 재생'); }
  }
  if (focusAnim) {
    const k = Math.min(1, (now - focusAnim.t0) / 600), e = 1 - (1 - k) ** 3;
    controls.target.lerpVectors(focusAnim.ft, focusAnim.tt, e); camera.position.lerpVectors(focusAnim.fp, focusAnim.tp, e);
    if (k >= 1) focusAnim = null;
  }
  if (pov === 'free') controls.update();
  updatePov();
  syncVisuals(now);
  voiceTick();
  render();
  if (now - uiT > 150) { uiT = now; refreshTime(); renderHud(); updateInspectorLive(); editor?.update(liveExpr()); updateLabels(); exTick(); idleCheck(now); const ps = $('#povState'); const pa = povAgent(view === 'AB' ? 'B' : view); if (ps && pa) ps.textContent = STATE_LABEL[pa.a.label]; }
  else updateLabels();
}
function render() {
  const w = innerWidth, h = innerHeight;
  const keys = visibleKeys();
  for (const k of ['A', 'B']) if (visuals[k]) visuals[k].group.visible = false;
  const draw = (k, x, vw) => {
    const cam = camFor(k, vw / h);
    if (visuals[k]) visuals[k].group.visible = true;
    const hidden = povBody(k); if (hidden) hidden.visible = false;
    renderer.setViewport(x, 0, vw, h); renderer.setScissor(x, 0, vw, h); renderer.render(scene, cam);
    if (hidden) hidden.visible = true;
    if (visuals[k]) visuals[k].group.visible = false;
  };
  if (keys.length === 2) { renderer.setScissorTest(true); keys.forEach((k, i) => draw(k, i * w / 2, w / 2)); renderer.setScissorTest(false); }
  else if (keys[0]) draw(keys[0], 0, w);
  else { camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setViewport(0, 0, w, h); renderer.render(scene, camera); }
}

// ---- point of view: 전체 / 로봇 시점 / 사람 시점 ------------------------------------------------
let pov = 'free', povHuman = 0, lookYaw = 0, lookPitch = 0;
const povPitch = {};
const povCam = new THREE.PerspectiveCamera(64, 1, 0.05, 200);
const povYaw = {}; // smoothed heading per sim
const resetPovYaw = () => { for (const k in povYaw) delete povYaw[k]; for (const k in povPitch) delete povPitch[k]; };
function povAgent(k) {
  const s = sims[k]; if (!s || pov === 'free') return null;
  if (pov === 'robot') { const i = Math.min(selected ? selected.id : 0, s.robots.length - 1); return { kind: 'robot', i, a: s.robots[i] }; }
  if (!s.humans.length) return null;
  const i = povHuman % s.humans.length; return { kind: 'human', i, a: s.humans[i] };
}
function updatePov() { // once per frame: ease the view heading so walking feels steady
  for (const k of ['A', 'B']) {
    const ag = povAgent(k); if (!ag) { delete povYaw[k]; continue; }
    let t = ag.a.heading, pt = -0.3;
    if (ag.kind === 'human') { // watch the nearest robot while walking
      const r = sims[k].robots.reduce((b, c) => Math.hypot(c.x - ag.a.x, c.y - ag.a.y) < Math.hypot(b.x - ag.a.x, b.y - ag.a.y) ? c : b);
      const d = Math.hypot(r.x - ag.a.x, r.y - ag.a.y);
      if (d < 14) { t = Math.atan2(r.y - ag.a.y, r.x - ag.a.x); pt = Math.atan2(0.8 - 1.5, Math.max(0.6, d)); } else pt = -0.15;
    }
    if (povYaw[k] === undefined) { povYaw[k] = t; povPitch[k] = pt; }
    const kk = 1 - Math.exp(-frameDt / 0.18); // time-based, so the view keeps up at any frame rate
    povYaw[k] += Math.atan2(Math.sin(t - povYaw[k]), Math.cos(t - povYaw[k])) * kk;
    povPitch[k] += (pt - povPitch[k]) * kk;
  }
}
function camFor(k, aspect) {
  const ag = povAgent(k);
  if (!ag) { camera.aspect = aspect; camera.updateProjectionMatrix(); return camera; }
  const a = ag.a, yaw = (povYaw[k] ?? a.heading) + lookYaw;
  povCam.aspect = aspect; povCam.updateProjectionMatrix();
  if (ag.kind === 'robot') { // face camera: ~1.5 m in front of the robot, a little to the side, eye level with its screen; drag to orbit
    const d = 2.3, ang = yaw + 0.15, hgt = Math.max(0.7, Math.min(2.4, 1.42 - lookPitch * 1.5));
    povCam.fov = 38; povCam.near = 0.3; povCam.updateProjectionMatrix();
    povCam.position.set(a.x + Math.cos(ang) * d, hgt, a.y + Math.sin(ang) * d);
    povCam.lookAt(a.x, 0.98, a.y);
  } else {
    povCam.fov = 64; povCam.near = 0.05; povCam.updateProjectionMatrix();
    const eye = ag.kind === 'robot' ? 1.12 : 1.5, pitch = (povPitch[k] ?? -0.2) + lookPitch;
    const fwd = ag.kind === 'robot' ? 0.3 : 0.12; // just in front of the face so the body never fills the view
    povCam.position.set(a.x + Math.cos(a.heading) * fwd, eye, a.y + Math.sin(a.heading) * fwd);
    povCam.lookAt(povCam.position.x + Math.cos(yaw) * Math.cos(pitch), eye + Math.sin(pitch), povCam.position.z + Math.sin(yaw) * Math.cos(pitch));
  }
  povCam.updateMatrixWorld();
  return povCam;
}
function povBody(k) { // the agent we look through: hide its body (a robot keeps its floor projection)
  const ag = povAgent(k), v = visuals[k]; if (!ag || !v) return null;
  if (ag.kind === 'robot') return null; // the face camera looks AT the robot
  return v.humans[ag.i];
}
function setPov(p) {
  pov = p; lookYaw = 0; lookPitch = 0;
  resetPovYaw();
  controls.enabled = p === 'free';
  $$('#povBar button').forEach(b => b.classList.toggle('on', b.dataset.pov === p));
  renderPovInfo();
}
function renderPovInfo() {
  const el = $('#povInfo');
  el.hidden = pov === 'free' || mode !== 'sim';
  if (el.hidden) return;
  const s = mainSim(), ag = s && povAgent(view === 'AB' ? 'B' : view);
  if (pov === 'robot') el.innerHTML = `<b>Robot-0${(ag?.i ?? 0) + 1}</b><span class="dim" id="povState">${ag ? STATE_LABEL[ag.a.label] : ''}</span><span class="dim small">드래그로 돌려 보기</span>`;
  else el.innerHTML = s?.humans.length
    ? `<button class="ghost" id="povPrev" aria-label="이전 사람">‹</button><b>사람 ${(povHuman % s.humans.length) + 1} / ${s.humans.length}</b><button class="ghost" id="povNext" aria-label="다음 사람">›</button><span class="dim small">로봇을 바라보며 걸어요</span>`
    : '<span class="dim">이 상황에는 걷는 사람이 없어요</span>';
  if ($('#povPrev')) $('#povPrev').onclick = () => { povHuman = (povHuman - 1 + s.humans.length) % s.humans.length; resetPovYaw(); renderPovInfo(); };
  if ($('#povNext')) $('#povNext').onclick = () => { povHuman = (povHuman + 1) % s.humans.length; resetPovYaw(); renderPovInfo(); };
}
$('#povBar').onclick = e => { const b = e.target.closest('button'); if (b) setPov(b.dataset.pov); };

addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight));
renderer.setSize(innerWidth, innerHeight);

function focusOn(x, z, dist = 10) {
  const dir = camera.position.clone().sub(controls.target).normalize();
  const tt = new THREE.Vector3(x, 0, z);
  focusAnim = { t0: performance.now(), ft: controls.target.clone(), fp: camera.position.clone(), tt, tp: tt.clone().add(dir.multiplyScalar(dist)) };
}

// ---- labels over robots -----------------------------------------------------------------------
const labelPool = [];
function updateLabels() {
  const box = $('#labels'), w = innerWidth, h = innerHeight, keys = visibleKeys();
  let n = 0;
  const show = mode !== 'test';
  const v = new THREE.Vector3();
  if (show) keys.forEach((k, half) => {
    const s = sims[k]; if (!s) return;
    const ox = keys.length === 2 ? half * w / 2 : 0, vw = keys.length === 2 ? w / 2 : w;
    const cam = camFor(k, vw / h), me = povAgent(k);
    for (const r of s.robots) {
      const isSel = selected?.k === k && selected.id === r.id;
      if (!isSel && ['CRUISE', 'IDLE', 'HOME'].includes(r.label)) continue; // only speak up when something happens
      const onScreen = !!visuals[k]?.robots[r.id]?.userData.status; // brand robots show their status on their own face screen
      v.set(r.x, 1.45, r.y).project(cam);
      if (v.z > 1 || v.z < -1) continue;
      const x = ox + (v.x + 1) / 2 * vw, y = (1 - v.y) / 2 * h;
      if (!onScreen) {
      const el = labelPool[n] || (labelPool[n] = box.appendChild(document.createElement('div')));
      if (el.className !== 'intent') { el.className = 'intent'; el.dataset.t = ''; }
      const led = r.signal.led || 'white';
      const say = r.reaction ? sayOf(r.reaction.node, LINES).replace('{table}', (r.table || '').replace('Table_', '').replace(/^0/, '')) : r.signal.screen;
      const text = STATE_LABEL[r.label] + (say ? ' · ' + say : '');
      if (el.dataset.t !== text + led) { el.dataset.t = text + led; el.innerHTML = `<i style="background:${led === 'white' ? '#0a84ff' : led === 'off' ? '#8e8e93' : LED_COLOR[led]}"></i>${text}`; }
      el.style.left = x + 'px'; el.style.top = (y - 8) + 'px'; el.style.display = '';
      n++;
      }
      if (isSel) {
        v.set(r.x, 0, r.y).project(cam);
        const tg = labelPool[n] || (labelPool[n] = box.appendChild(document.createElement('div')));
        tg.className = 'sel-tag'; tg.textContent = 'Robot-0' + (r.id + 1);
        tg.style.left = (ox + (v.x + 1) / 2 * vw) + 'px'; tg.style.top = ((1 - v.y) / 2 * h + 18) + 'px'; tg.style.display = ''; n++;
      }
    }
  });
  for (let i = n; i < labelPool.length; i++) labelPool[i].style.display = 'none';
}

// ---- top-left menus ---------------------------------------------------------------------------
function popup(menu, anchor) {
  const open = menu.hidden;
  $$('.menu').forEach(m => m.hidden = true);
  if (!open) return;
  const r = anchor.getBoundingClientRect(); menu.style.left = r.left + 'px'; menu.style.top = (r.bottom + 8) + 'px'; menu.hidden = false;
}
function renderScenarioMenu() {
  $('#scenarioMenu').innerHTML = SCENARIOS.map((s, i) => `<button data-i="${i}" class="${i === scIdx ? 'on' : ''}"><b>${NUM[i]} ${s.name}</b><small>${s.title}</small></button>`).join('');

}
$('#scenarioBtn').onclick = e => { e.stopPropagation(); renderScenarioMenu(); popup($('#scenarioMenu'), $('#scenarioBtn')); };
$('#modeBtn').onclick = e => { e.stopPropagation(); popup($('#modeMenu'), $('#modeBtn')); };
$('#scenarioMenu').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  $('#scenarioMenu').hidden = true;
  loadScenario(+b.dataset.i);
};
$('#modeMenu').onclick = e => { const b = e.target.closest('button'); if (!b) return; $('#modeMenu').hidden = true; if (b.dataset.mode === 'space') { location.search = ''; return; } if (b.dataset.mode === 'test') openTestStart(); if (b.dataset.mode === 'ex') enterEx(); };
addEventListener('pointerdown', e => { if (!e.target.closest('.menu') && !e.target.closest('#project')) $$('.menu').forEach(m => m.hidden = true); });

// ---- view mode / playback ---------------------------------------------------------------------
function setView(v) {
  view = v;
  $$('#viewMode button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $('#divider').hidden = $('#abLabels').hidden = v !== 'AB' || mode === 'test';
  if (selected && !visibleKeys().includes(selected.k)) selected = null;
  if (v !== 'AB') setEditGraph(v);
  renderInspector();
}
function refreshPlay() { $('#playBtn').classList.toggle('on', playing); }
function refreshTime() {
  const s = mainSim(); if (!s) return;
  const f = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  $('#time').innerHTML = `<b>${f(s.t)}</b> / ${f(s.sc.duration)}`;
}
$('#playBtn').onclick = () => { if (Object.values(sims).every(s => s.done)) makeSims(); playing = !playing; refreshPlay(); };
$('#resetBtn').onclick = () => { makeSims(); playing = true; refreshPlay(); };
$('#speedBtn').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; $('#speedBtn').textContent = speed + '×'; };

// ---- toolbar ----------------------------------------------------------------------------------
let tool = 'cursor';
function setTool(t) {
  tool = t; $$('#toolbar [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  controls.mouseButtons = t === 'orbit'
    ? { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    : { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }; // left = grab-drag (below)
  renderer.domElement.style.cursor = t === 'orbit' ? 'move' : 'grab';
}
setTool('cursor');
$$('[data-tip]').forEach(b => b.setAttribute('aria-label', `${b.dataset.tip} (${b.dataset.key})`));
function focusRobot() {
  if (pov !== 'free') return;
  const s = selected ? sims[selected.k] : mainSim(); const r = s?.robots[selected ? selected.id : 0];
  if (r) focusOn(r.x, r.y, 8);
}
$('#toolbar').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.tool) setTool(b.dataset.tool);
  if (b.dataset.act === 'focus') focusRobot();
  if (b.dataset.act === 'cut') setCutaway(!cutaway);
  if (b.dataset.panel === 'nodes') toggleSheet();
  if (b.dataset.panel === 'results') openResults();
};
$('#toolbar').addEventListener('pointerover', e => {
  const b = e.target.closest('button[data-tip]'); const tip = $('#tooltip');
  if (!b) return;
  tip.innerHTML = `${b.dataset.tip}<kbd>${b.dataset.key}</kbd>`; tip.hidden = false;
  const r = b.getBoundingClientRect(); tip.style.left = (r.left + r.width / 2 - tip.offsetWidth / 2) + 'px'; tip.style.top = (r.top - tip.offsetHeight - 8) + 'px';
});
$('#toolbar').addEventListener('pointerout', () => $('#tooltip').hidden = true);

// ---- picking ----------------------------------------------------------------------------------
let downAt = null;
// grab-drag: the floor point under the cursor stays under the cursor (map-style), left button in the select tool
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function floorAt(cx, cy) {
  const keys = visibleKeys(), w = innerWidth, h = innerHeight, vw = keys.length === 2 ? w / 2 : w, half = keys.length === 2 && cx > w / 2 ? 1 : 0;
  camera.aspect = vw / h; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(((cx - half * vw) / vw) * 2 - 1, -(cy / h) * 2 + 1), camera);
  return ray.ray.intersectPlane(floorPlane, new THREE.Vector3());
}
let grab = null;
renderer.domElement.addEventListener('pointerdown', e => {
  downAt = [e.clientX, e.clientY];
  if (e.button !== 0) return;
  if (pov !== 'free') { grab = { look: [e.clientX, e.clientY, lookYaw, lookPitch] }; renderer.domElement.style.cursor = 'grabbing'; return; }
  if (tool === 'orbit') return;
  const p = floorAt(e.clientX, e.clientY); if (!p) return;
  grab = { p, id: e.pointerId }; focusAnim = null; renderer.domElement.style.cursor = 'grabbing';
});
addEventListener('pointermove', e => {
  if (!grab) return;
  if (grab.look) { const [x0, y0, yw, pt] = grab.look; lookYaw = yw - (e.clientX - x0) * 0.005; lookPitch = Math.max(-0.6, Math.min(0.5, pt - (e.clientY - y0) * 0.004)); return; }
  const q = floorAt(e.clientX, e.clientY); if (!q) return;
  const d = grab.p.clone().sub(q); d.y = 0;
  camera.position.add(d); controls.target.add(d);
});
addEventListener('pointerup', () => { grab = null; renderer.domElement.style.cursor = tool === 'orbit' ? 'move' : 'grab'; });
renderer.domElement.addEventListener('dblclick', () => { if (pov !== 'free') { lookYaw = 0; lookPitch = 0; } });

// wheel / touchpad (Figma-style): two-finger scroll = pan, pinch (ctrl+wheel) = zoom at cursor,
// shift/alt + two-finger = rotate, mouse wheel = zoom at cursor. Replaces OrbitControls' own wheel zoom.
let padUntil = 0; // once a touchpad gesture is seen, keep treating wheel events as touchpad for a moment
function zoomAt(cx, cy, f) {
  const t = controls.target, p = floorAt(cx, cy) || t.clone(), dist = camera.position.distanceTo(t);
  const s = Math.min(controls.maxDistance, Math.max(controls.minDistance, dist * f)) / dist;
  camera.position.sub(p).multiplyScalar(s).add(p); t.sub(p).multiplyScalar(s).add(p); t.y = 0;
}
function orbitBy(dx, dy) {
  const off = camera.position.clone().sub(controls.target), sph = new THREE.Spherical().setFromVector3(off);
  sph.theta -= dx * 0.005; sph.phi = Math.min(controls.maxPolarAngle, Math.max(0.15, sph.phi - dy * 0.005));
  camera.position.copy(controls.target).add(off.setFromSpherical(sph));
}
addEventListener('wheel', e => {
  if (e.target !== renderer.domElement) return;
  e.preventDefault(); e.stopPropagation(); // keep OrbitControls from also zooming
  const px = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? innerHeight : 1, dx = e.deltaX * px, dy = e.deltaY * px;
  // ponytail: touchpad vs mouse wheel is a heuristic (mouse = whole notches, vertical only)
  if (e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40)) padUntil = performance.now() + 400;
  const pad = performance.now() < padUntil;
  focusAnim = null; lastInput = performance.now();
  if (pov !== 'free') { lookYaw -= dx * 0.004; lookPitch = Math.max(-1.2, Math.min(0.5, lookPitch - dy * 0.003)); return; }
  if (e.ctrlKey) return zoomAt(e.clientX, e.clientY, Math.exp(dy * 0.012)); // pinch
  if (pad && (e.shiftKey || e.altKey)) return orbitBy(dx, dy);
  if (!pad) return zoomAt(e.clientX, e.clientY, Math.exp(dy * 0.0015));
  const a = floorAt(e.clientX, e.clientY), b = floorAt(e.clientX - dx, e.clientY - dy); if (!a || !b) return;
  const d = a.sub(b); d.y = 0; camera.position.add(d); controls.target.add(d);
}, { capture: true, passive: false });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || mode !== 'sim' || e.button !== 0) return;
  pickAt(e.clientX, e.clientY);
});
function pickAt(cx, cy) {
  const keys = visibleKeys(), w = innerWidth, h = innerHeight;
  const half = keys.length === 2 && cx > w / 2 ? 1 : 0, k = keys[half], vw = keys.length === 2 ? w / 2 : w;
  const ndc = new THREE.Vector2(((cx - half * vw) / vw) * 2 - 1, -(cy / h) * 2 + 1);
  const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camFor(k, vw / h));
  const vis = visuals[k]; if (!vis) return null;
  // nearest robot to the ray (a forgiving 0.6 m pick radius beats exact mesh hits on small robots)
  let best = -1, bestD = 0.6;
  sims[k].robots.forEach((r, i) => { const d = ray.ray.distanceToPoint(new THREE.Vector3(r.x, 0.5, r.y)); if (d < bestD) { bestD = d; best = i; } });
  if (best >= 0) { selected = { k, id: best }; inspectorMode = 'robot'; resetPovYaw(); }
  else { selected = null; if (inspectorMode === 'robot') inspectorMode = null; }
  renderInspector(); renderPovInfo();
  return selected;
}

// ---- inspector --------------------------------------------------------------------------------
function renderInspector() {
  const ip = $('#inspector');
  const show = mode === 'sim' && !!selected;
  ip.hidden = !show;
  if (!show) return;
  {
    ip.innerHTML = `<div class="head"><span id="ipDot" class="dot" style="width:10px;height:10px;border-radius:50%;background:var(--grn)"></span><b>Robot-0${selected.id + 1} <span class="dim" style="font-weight:400;font-size:13px">· ${selected.k === 'A' ? '기존 A' : '디자인 B' + (BRAND?.brand ? ' · ' + BRAND.brand : '')}</span></b><button class="x" id="ipClose">✕</button></div>
      <span class="state-chip" id="ipState"></span>
      ${selected.k === 'B' ? `<canvas id="ipFace" width="280" height="140" class="face-prev"></canvas><div class="label" id="ipReact"></div>
      <button class="btn primary block" id="ipNodes">표정·말 노드 편집 <kbd class="k">N</kbd></button>` : '<p class="dim small">기존 로봇은 원래 얼굴과 기본 안내 문구를 그대로 써요.</p>'}`;
  }
  $('#ipClose').onclick = () => { selected = null; inspectorMode = null; renderInspector(); };
  $('#ipNodes') && ($('#ipNodes').onclick = () => openSheet());
  updateInspectorLive();
}
function updateInspectorLive() {
  if (!selected || $('#inspector').hidden) return;
  const r = sims[selected.k]?.robots[selected.id]; if (!r) return;
  const chip = $('#ipState'); if (!chip) return;
  const led = r.signal.led || 'white';
  chip.textContent = `${STATE_LABEL[r.label]}  ${r.stateT.toFixed(1)}s`;
  const c = led === 'white' ? '#0a84ff' : led === 'off' ? '#8e8e93' : LED_COLOR[led];
  chip.style.background = c + '22'; chip.style.color = led === 'amber' ? '#a35f00' : led === 'green' ? '#1e7b34' : '#1d1d1f';
  $('#ipDot').style.background = c;
  const cv = $('#ipFace'), u = visuals[selected.k]?.robots[selected.id]?.userData;
  if (cv && u?.face) {
    drawPreview(cv, faceSrc, u.face.f, FACE_COLOR);
    const re = r.reaction; $('#ipReact').textContent = re ? `${FACE_PRESETS[re.node.p.preset]?.label || '직접 조정'} · ${sayOf(re.node, LINES) || '말 없음'}` : '';
  }
}

// ---- HUD --------------------------------------------------------------------------------------
$('#hud').onclick = () => { hudOpen = !hudOpen; renderHud(); };
function renderHud() {
  const keys = visibleKeys(); if (!keys.length) return;
  const ms = Object.fromEntries(keys.map(k => [k, sims[k].metrics()]));
  const main = ms[keys[keys.length - 1]];
  const head = keys.length === 2
    ? `<div class="row"><span class="dot"></span>정체 <b>${ms.A.stall.toFixed(1)}s → ${ms.B.stall.toFixed(1)}s</b> 충돌 <b>${ms.A.near} → ${ms.B.near}</b> <span class="dim">${hudOpen ? '⌄' : '⌃'}</span></div>`
    : `<div class="row"><span class="dot" style="background:${keys[0] === 'A' ? 'var(--org)' : 'var(--grn)'}"></span>정체 <b>${main.stall.toFixed(1)}s</b> 충돌 <b>${main.near}</b> <span class="dim">${hudOpen ? '⌄' : '⌃'}</span></div>`;
  let body = '';
  if (hudOpen) {
    const rows = [['이동 시간', m => m.travel.toFixed(1) + 's'], ['정체 시간', m => m.stall.toFixed(1) + 's'], ['근접 충돌', m => m.near + '회'], ['경로 변경', m => m.changes + '회']];
    body = `<table><tr><th></th>${keys.map(k => `<th>${k === 'A' ? '기존 A' : '디자인 B'}</th>`).join('')}</tr>${rows.map(([l, f]) => `<tr><td class="k">${l}</td>${keys.map(k => `<td><b>${f(ms[k])}</b></td>`).join('')}</tr>`).join('')}</table>`;
  }
  $('#hud').innerHTML = head + body;
}

// ---- node sheet -------------------------------------------------------------------------------
let editor = null;
function setEditGraph(k) { editK = k; } // the 표현 그래프 belongs to design robot B
function openSheet() { $('#sheet').hidden = false; applySheetSize(); editor.setGraph(xgraph); requestAnimationFrame(() => editor.fit()); }
function closeSheet() { $('#sheet').hidden = true; editor.closeAdd(); setSheetFull(false); layoutForSheet(); }

// sheet size: drag the grip / header up-down, double-click or the button for full screen; height is remembered
let sheetH = store.get('sheetH', null), sheetFull = false;
const clampSheetH = h => Math.max(240, Math.min(innerHeight - 32, h));
const FULL_ICON = '<svg viewBox="0 0 20 20"><path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5"/></svg>';
const EXIT_ICON = '<svg viewBox="0 0 20 20"><path d="M8 3v5H3M17 8h-5V3M12 17v-5h5M3 12h5v5"/></svg>';
function applySheetSize() {
  const sh = $('#sheet');
  sh.classList.toggle('full', sheetFull);
  document.body.classList.toggle('sheet-full', sheetFull && !sh.hidden);
  sh.style.height = sheetFull || !sheetH ? '' : clampSheetH(sheetH) + 'px';
  const b = $('#fullSheet'); b.innerHTML = sheetFull ? EXIT_ICON : FULL_ICON;
  b.title = sheetFull ? '전체화면 끝내기' : '전체화면'; b.setAttribute('aria-label', '노드 창 ' + b.title);
  layoutForSheet(); editor?.drawWires();
}
function setSheetFull(on) { const was = sheetFull; sheetFull = on; applySheetSize(); if (was !== on && !$('#sheet').hidden) requestAnimationFrame(() => editor.fit()); }
$('#fullSheet').onclick = () => setSheetFull(!sheetFull);
function startSheetResize(e) {
  if (e.button !== 0 || e.target.closest('button, .seg, input, select')) return;
  const sh = $('#sheet');
  const y0 = e.clientY, h0 = sh.offsetHeight;
  if (sheetFull) { sheetFull = false; sheetH = h0; applySheetSize(); }
  sh.classList.add('resizing'); e.preventDefault();
  const mv = ev => { sheetH = clampSheetH(h0 + (y0 - ev.clientY)); sh.style.height = sheetH + 'px'; layoutForSheet(); };
  const up = () => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up); sh.classList.remove('resizing');
    if (sheetH >= innerHeight - 56) { sheetH = Math.round(innerHeight * 0.46); setSheetFull(true); } // dragged to the top → snap full
    else store.set('sheetH', sheetH);
    editor.drawWires();
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
$('#sheetGrip').addEventListener('pointerdown', startSheetResize);
$('.sheet-head').addEventListener('pointerdown', startSheetResize);
for (const el of [$('#sheetGrip'), $('.sheet-head')]) el.addEventListener('dblclick', e => { if (!e.target.closest('button, .seg')) setSheetFull(!sheetFull); });
addEventListener('resize', () => { if (!$('#sheet').hidden) applySheetSize(); });
function toggleSheet() { $('#sheet').hidden ? openSheet() : closeSheet(); }
function layoutForSheet() {
  const open = !$('#sheet').hidden;
  $('#toolbar').style.bottom = open ? ($('#sheet').offsetHeight + 28) + 'px' : '20px';
  $('#povBar').style.bottom = open ? $('#toolbar').style.bottom : ''; $('#povInfo').style.bottom = open ? ($('#sheet').offsetHeight + 76) + 'px' : '';
  $('#hud').hidden = open;
  $$('#toolbar [data-panel=nodes]').forEach(b => b.classList.toggle('on', open));
}
$('#closeSheet').onclick = closeSheet;
$('#addNodeBtn').onclick = () => editor.openAdd();
$('#resetGraphBtn').onclick = () => {
  const d = defaultExprGraph(BRAND?.register, BRAND?.faces); xgraph.nodes = d.nodes; xgraph.links = d.links; store.set(EXPR_KEY, xgraph);
  editor.setGraph(xgraph); editor.fit(); noteGraph(); toast('기본 표현 그래프로 되돌렸어요');
};
const noteGraph = () => { $('#graphNote').textContent = `상황 ${xgraph.nodes.filter(n => n.type === 'situation').length}개 · 반응 ${xgraph.nodes.filter(n => n.type === 'reaction').length}개`; };
const liveExpr = () => { const r = sims.B?.robots[selected?.k === 'B' ? selected.id : 0]; return r?.reaction ? { chosen: { node: r.reaction.node.id }, sigNode: r.reaction.sit.id, values: { [r.reaction.sit.id + '.on']: true } } : null; };
let saveT = null;

// ---- results (batch) --------------------------------------------------------------------------
let batch = null, showDetail = false;
function openResults() { $('#dim').hidden = $('#results').hidden = false; renderResults(); }
function closeResults() { $('#dim').hidden = $('#results').hidden = true; }
$('#dim').onclick = () => { if (!$('#results').hidden) closeResults(); };
function renderResults() {
  const el = $('#results');
  const head = `<div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h2>배치 결과</h2><div class="dim">디자인 B vs 기존 A · 상황 ${SCENARIOS.length}개 · 현재 파라미터와 노드 그래프 기준</div></div><button class="x" id="rsClose" style="width:28px;height:28px;color:var(--t2)">✕</button></div>`;
  if (!batch || batch.running) {
    const p = batch ? batch.done / batch.total : 0;
    el.innerHTML = head + `<div style="margin:24px 0 8px">${batch ? `실행 중… ${batch.done} / ${batch.total}` : '각 상황을 시드별로 렌더링 없이 빠르게 돌려 평균을 비교해요.'}</div>
      <div class="progress"><i style="width:${p * 100}%"></i></div>
      <div class="row"><label style="flex-direction:row;align-items:center;margin:0;gap:8px" class="grow">시드 수 <input id="seedN" type="number" min="1" max="30" value="${batch?.seeds || 10}" style="width:70px;padding:6px 8px"></label>
      <button class="btn primary" id="rsRun" ${batch ? 'disabled' : ''}>배치 실행</button></div>`;
  } else {
    const agg = batch.agg, keys = [['정체 시간', 'stall', 's'], ['근접 충돌', 'near', '회'], ['경로 변경', 'changes', '회'], ['이동 시간', 'travel', 's']];
    const tot = (c, k) => SCENARIOS.reduce((a, _, i) => a + agg[i][c][k], 0) / SCENARIOS.length;
    const tile = ([l, k, u]) => {
      const a = tot('A', k), b = tot('B', k), d = a ? (b - a) / a * 100 : 0;
      return `<div class="tile"><small>${l}</small><div class="d ${d < -0.5 ? 'good' : d > 0.5 ? 'bad' : ''}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(0)}%</div><small>${a.toFixed(1)} → ${b.toFixed(1)}${u}</small></div>`;
    };
    const maxS = Math.max(...agg.map(x => Math.max(x.A.stall, x.B.stall)), 1);
    el.innerHTML = head + `<div class="tiles">${keys.map(tile).join('')}</div>
      <div style="display:flex;justify-content:space-between"><b>상황별 정체 시간</b><span class="dim small">● 기존 A &nbsp; <span style="color:var(--grn)">●</span> 디자인 B</span></div>
      <div class="bars">${agg.map((x, i) => `<span>${NUM[i]} ${SCENARIOS[i].name}</span><div><div style="display:flex;align-items:center"><div class="b" style="width:${x.A.stall / maxS * 70}%"></div><span class="t">${x.A.stall.toFixed(1)} → ${x.B.stall.toFixed(1)}s</span></div><div class="b g" style="width:${Math.max(0.5, x.B.stall / maxS * 70)}%"></div></div>`).join('')}</div>
      ${showDetail ? `<table class="detail"><tr><th>상황</th><th>조건</th><th>이동 시간</th><th>정체 시간</th><th>근접 충돌</th><th>경로 변경</th></tr>${agg.map((x, i) => ['A', 'B'].map(c => `<tr><td>${NUM[i]} ${SCENARIOS[i].name}</td><td>${c === 'A' ? '기존' : '디자인'}</td><td>${x[c].travel.toFixed(1)}s</td><td>${x[c].stall.toFixed(1)}s</td><td>${x[c].near.toFixed(1)}</td><td>${x[c].changes.toFixed(1)}</td></tr>`).join('')).join('')}</table>` : ''}
      <div class="row"><span class="dim small grow">시드 ${batch.seeds}개 평균 · 시뮬레이션 속 사람 반응은 단순화한 모델이에요</span><button class="btn" id="rsAgain">다시 실행</button><button class="btn" id="rsCsv">CSV 내보내기</button><button class="btn primary" id="rsDetail">${showDetail ? '간단히' : '상세 보기'}</button></div>`;
  }
  $('#rsClose').onclick = closeResults;
  $('#rsRun') && ($('#rsRun').onclick = () => runBatch(Math.max(1, Math.min(30, +$('#seedN').value || 10))));
  $('#rsAgain') && ($('#rsAgain').onclick = () => { batch = null; renderResults(); });
  $('#rsCsv') && ($('#rsCsv').onclick = () => download('servbot_batch.csv', ['scenario,seed,condition,travel_s,stall_s,near,path_changes', ...batch.rows.map(r => r.join(','))].join('\n')));
  $('#rsDetail') && ($('#rsDetail').onclick = () => { showDetail = !showDetail; renderResults(); });
}
function runBatch(seeds) {
  const g = { A: structuredClone(graphs.A), B: structuredClone(graphs.B) }, p = { ...params };
  const jobs = []; SCENARIOS.forEach((sc, i) => { for (let s = 1; s <= seeds; s++) for (const c of ['A', 'B']) jobs.push([i, s, c]); });
  batch = { running: true, done: 0, total: jobs.length, seeds, rows: [] };
  renderResults();
  const next = () => {
    if (!batch?.running) return;
    const [i, s, c] = jobs[batch.done];
    const m = runHeadless({ grid, scenario: SCENARIOS[i], params: p, graph: structuredClone(g[c]), seed: s * 101 }).metrics();
    batch.rows.push([SCENARIOS[i].name, s, c, m.travel.toFixed(2), m.stall.toFixed(2), m.near, m.changes]);
    batch.done++;
    if (batch.done < batch.total) { if (!$('#results').hidden) renderResults(); setTimeout(next, 0); }
    else {
      batch.running = false;
      batch.agg = SCENARIOS.map(sc => Object.fromEntries(['A', 'B'].map(c => {
        const rs = batch.rows.filter(r => r[0] === sc.name && r[2] === c);
        const avg = j => rs.reduce((a, r) => a + +r[j], 0) / rs.length;
        return [c, { travel: avg(3), stall: avg(4), near: avg(5), changes: avg(6) }];
      })));
      renderResults(); toast('배치 실행이 끝났어요');
    }
  };
  setTimeout(next, 30);
}
function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

// ---- user test --------------------------------------------------------------------------------
const OPTIONS = ['계속 진행', '멈춤', '비켜서기', '돌아가기', '출발'];
const ANSWER = { WAIT: 1, YIELD: 2, DETOUR: 3, DEPART: 4 };
const DID = { '계속 진행': '계속 갔어요', '멈춤': '멈췄어요', '비켜서기': '비켜섰어요', '돌아가기': '돌아서 갔어요', '출발': '출발했어요' };
let test = null;
function openTestStart() { $('#dim').hidden = $('#testStart').hidden = false; $('#pid').focus(); }
$('#testCancel').onclick = () => { $('#dim').hidden = $('#testStart').hidden = true; document.activeElement?.blur(); };
$('#pid').addEventListener('keydown', e => { if (e.key === 'Enter') $('#testGo').click(); });
$('#testGo').onclick = () => {
  const pid = $('#pid').value.trim() || 'P01';
  let h = 0; for (const ch of pid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const r = rng(h + 1), trials = [];
  SCENARIOS.forEach((_, i) => ['A', 'B'].forEach(c => trials.push({ sc: i, cond: c })));
  for (let i = trials.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [trials[i], trials[j]] = [trials[j], trials[i]]; }
  test = { pid, trials, i: 0, rows: [] };
  $('#dim').hidden = $('#testStart').hidden = true; document.activeElement?.blur(); // so number keys answer instead of typing
  setMode('test'); runTrial();
};
function runTrial() {
  const tr = test.trials[test.i];
  const pre = runHeadless({ grid, scenario: SCENARIOS[tr.sc], params, graph: structuredClone(graphs[tr.cond]), seed: 11 });
  const ev = pre.firstEvent;
  tr.pauseAt = ev ? ev.t : SCENARIOS[tr.sc].duration * 0.5; tr.answer = ev ? ANSWER[ev.label] : 0;
  scIdx = tr.sc;
  sims = { [tr.cond]: new Sim({ grid, scenario: SCENARIOS[tr.sc], params, graph: structuredClone(graphs[tr.cond]), seed: 11 }) };
  view = tr.cond; buildVisuals('A'); buildVisuals('B');
  focusOn(FOCUS[tr.sc][0], FOCUS[tr.sc][1], 17);
  test.phase = 'watch'; playing = true; speed = 1; acc = 0;
  $('#testPid').textContent = test.pid;
  $('#testProg').innerHTML = `<b>클립 ${test.i + 1} / ${test.trials.length}</b>` + test.trials.map((_, i) => `<i class="${i < test.i ? 'done' : i === test.i ? 'cur' : ''}"></i>`).join('');
  ['#testPaused', '#testQ', '#testReveal', '#testRate'].forEach(s => $(s).hidden = true);
}
function onStep() {
  if (mode !== 'test' || !test) return;
  const s = Object.values(sims)[0], tr = test.trials[test.i];
  if (test.phase === 'watch' && s.t >= tr.pauseAt) {
    playing = false; test.phase = 'ask'; test.askT = performance.now();
    $('#testPaused').hidden = $('#testQ').hidden = false;
  } else if (test.phase === 'reveal' && s.t >= tr.pauseAt + 3) { playing = false; showRating(); }
}
$('#testQ .opts').innerHTML = OPTIONS.map((o, i) => `<button data-a="${i}"><small>${i + 1}</small>${o}</button>`).join('');
$('#testQ .opts').onclick = e => { const b = e.target.closest('button'); if (b) answer(+b.dataset.a); };
function answer(a) {
  if (test?.phase !== 'ask') return;
  const tr = test.trials[test.i];
  test.cur = { pid: test.pid, trial: test.i + 1, scenario: SCENARIOS[tr.sc].name, condition: tr.cond, answer: OPTIONS[a], correct_answer: OPTIONS[tr.answer], correct: a === tr.answer ? 1 : 0, rt_ms: Math.round(performance.now() - test.askT) };
  $('#testPaused').hidden = $('#testQ').hidden = true;
  test.phase = 'reveal'; playing = true;
}
function showRating() {
  test.phase = 'rate';
  const c = test.cur;
  $('#testReveal').innerHTML = `<span class="dim small">정답</span><b>로봇은 ${DID[c.correct_answer]}</b><span class="${c.correct ? 'ok' : 'no'}">${c.correct ? '내 답과 같아요 ✓' : '내 답: ' + c.answer}</span>`;
  const qs = ['다음 행동을 예측하기 쉬웠다', '옆에 있어도 편안했다', '나를 배려한다고 느꼈다'];
  $('#testRate').innerHTML = `<h2>방금 본 로봇은 어땠나요?</h2>${qs.map((q, j) => `<div class="likert" data-q="${j}"><div class="q">${q}</div><div class="s">${[1, 2, 3, 4, 5, 6, 7].map(n => `<button data-n="${n}">${n}</button>`).join('')}</div><div class="ends"><span>전혀 아니다</span><span>매우 그렇다</span></div></div>`).join('')}
    <div><div class="q" style="font-size:15px;font-weight:500">도움이 된 신호 (여러 개)</div><div class="chips">${['LED', '바닥 표시', '화면', '소리', '움직임'].map(s => `<button>${s}</button>`).join('')}</div></div>
    <button class="btn dark block" id="nextClip" style="padding:13px">${test.i + 1 < test.trials.length ? '다음 클립' : '마치기'}</button>`;
  $('#testReveal').hidden = $('#testRate').hidden = false;
  $('#testRate').querySelectorAll('.likert .s').forEach(s => s.onclick = e => { const b = e.target.closest('button'); if (!b) return; s.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
  $('#testRate').querySelectorAll('.chips button').forEach(b => b.onclick = () => b.classList.toggle('on'));
  $('#nextClip').onclick = () => {
    const lk = [...$('#testRate').querySelectorAll('.likert')].map(l => +(l.querySelector('.on')?.dataset.n || 0));
    if (lk.some(v => !v)) { toast('세 문항 모두 골라 주세요'); return; }
    Object.assign(c, { predictable: lk[0], comfort: lk[1], considerate: lk[2], helpful_signals: [...$('#testRate').querySelectorAll('.chips .on')].map(b => b.textContent).join('|') });
    test.rows.push(c);
    if (++test.i < test.trials.length) runTrial(); else finishTest();
  };
}
function finishTest() {
  ['#testPaused', '#testQ', '#testReveal', '#testRate'].forEach(s => $(s).hidden = true);
  const all = store.get('testResults', []); all.push(...test.rows); store.set('testResults', all);
  const by = c => test.rows.filter(r => r.condition === c), avg = (rs, k) => rs.length ? rs.reduce((a, r) => a + r[k], 0) / rs.length : 0;
  const row = (l, k, f) => `<tr><td>${l}</td><td>${f(avg(by('A'), k))}</td><td><b>${f(avg(by('B'), k))}</b></td></tr>`;
  $('#testDone').innerHTML = `<h2>테스트를 마쳤어요</h2><div class="dim">${test.pid} · 클립 ${test.rows.length}개 · 이 브라우저에 누적 ${all.length}개 응답</div>
    <table class="detail"><tr><th></th><th>기존 A</th><th>디자인 B</th></tr>
    ${row('예측 정답률', 'correct', v => Math.round(v * 100) + '%')}${row('평균 응답 시간', 'rt_ms', v => (v / 1000).toFixed(1) + 's')}
    ${row('예측 가능성 (7점)', 'predictable', v => v.toFixed(1))}${row('편안함 (7점)', 'comfort', v => v.toFixed(1))}${row('배려 (7점)', 'considerate', v => v.toFixed(1))}</table>
    <div class="row"><button class="btn" id="tdAll">전체 응답 CSV</button><button class="btn" id="tdCsv">이번 참가자 CSV</button><button class="btn primary" id="tdExit">시뮬레이션으로</button></div>`;
  $('#dim').hidden = $('#testDone').hidden = false;
  const csv = rows => { const k = Object.keys(rows[0] || { pid: '' }); return [k.join(','), ...rows.map(r => k.map(x => r[x]).join(','))].join('\n'); };
  $('#tdCsv').onclick = () => download(`servbot_test_${test.pid}.csv`, csv(test.rows));
  $('#tdAll').onclick = () => download('servbot_test_all.csv', csv(store.get('testResults', [])));
  $('#tdExit').onclick = () => { $('#dim').hidden = $('#testDone').hidden = true; setMode('sim'); };
}

// ---- exhibition -------------------------------------------------------------------------------
let ex = null;
function enterEx() { exReturn = true; setMode('ex'); ex = { i: 0 }; startExScenario(0); }
function startExScenario(i) {
  ex.i = i; ex.t0 = performance.now();
  scIdx = i; makeSims(['A', 'B']); focusOn(FOCUS[i][0], FOCUS[i][1], 15); playing = true; speed = 1;
  const sc = SCENARIOS[i];
  $('#exCaption').innerHTML = `<small>상황 ${i + 1} / ${SCENARIOS.length}</small><h1>${sc.title}</h1><p>${sc.caption}</p>`;
  $('#exPrinciple').innerHTML = `<small>${sc.principle[0]}</small><h2>${sc.principle[1]}</h2><p>${sc.principle[2]}</p>`;
}
function exTick() {
  if (mode !== 'ex' || !ex) return;
  const s = sims.B, lim = Math.min(s.sc.duration, 34);
  $('#exProg').innerHTML = SCENARIOS.map((_, i) => `<i><b style="width:${i < ex.i ? 100 : i === ex.i ? Math.min(100, s.t / lim * 100) : 0}%"></b></i>`).join('');
  const stat = (k, label, color, acc) => { const m = sims[k].metrics(); return `<div class="h"><i style="background:${color}"></i>${label}</div><div class="nums"><div><small>정체</small><b style="color:${acc}">${m.stall.toFixed(1)}s</b></div><div><small>충돌</small><b style="color:${acc}">${m.near}회</b></div></div>`; };
  $('#exStatA').innerHTML = stat('A', '기존 로봇', 'var(--org)', 'var(--t1)');
  $('#exStatB').innerHTML = stat('B', '디자인한 로봇', 'var(--grn)', '#1e9e45');
  if (s.t >= lim) startExScenario((ex.i + 1) % SCENARIOS.length);
}
function exitEx() { if (mode !== 'ex') return; setMode('sim'); setView('B'); toast('직접 조작할 수 있어요 · 30초 동안 입력이 없으면 전시 화면으로 돌아가요'); }
function idleCheck(now) { if (mode === 'sim' && exReturn && now - lastInput > 30000) enterEx(); }

// ---- modes ------------------------------------------------------------------------------------
function setMode(m) {
  mode = m;
  if (m !== 'sim' && pov !== 'free') setPov('free');
  $$('.ui-sim').forEach(e => e.hidden = m !== 'sim');
  if (m === 'sim') { $('#inspector').hidden = true; $('#sheet').hidden = true; renderInspector(); layoutForSheet(); }
  $('#testTop').hidden = m !== 'test';
  $('#ex').hidden = m !== 'ex';
  if (m !== 'test') ['#testPaused', '#testQ', '#testReveal', '#testRate'].forEach(s => $(s).hidden = true);
  if (m === 'ex') { view = 'AB'; selected = null; }
  if (m === 'sim') { if (test) { test = null; } loadScenario(scIdx, { focus: false }); setView('B'); }
  $('#divider').hidden = $('#abLabels').hidden = !(view === 'AB' && m !== 'test');
}

// ---- keyboard ---------------------------------------------------------------------------------
addEventListener('pointerdown', () => { lastInput = performance.now(); if (mode === 'ex') exitEx(); }, true);
addEventListener('keydown', e => {
  lastInput = performance.now();
  if (mode === 'ex') { exitEx(); return; }
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
  if (typing) return;
  if (mode === 'test') {
    if (test?.phase === 'ask' && e.key >= '1' && e.key <= '5') answer(+e.key - 1);
    if (e.key === 'Escape' && confirm('테스트를 그만둘까요? 지금까지 응답은 저장되지 않아요.')) setMode('sim');
    return;
  }
  const sheetOpen = !$('#sheet').hidden;
  if (e.code === 'Space') { e.preventDefault(); if (sheetOpen) editor.setSpace(true); else $('#playBtn').click(); return; }
  if (sheetOpen && (e.key === 'Delete' || e.key === 'Backspace')) { if (editor.deleteSelected()) e.preventDefault(); return; }
  if (sheetOpen && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); editor.openAdd(); return; }
  const k = e.key.toLowerCase();
  if (k === 'escape') { if (editor.addOpen) editor.closeAdd(); else if (!$('#results').hidden) closeResults(); else if (sheetOpen && sheetFull) setSheetFull(false); else if (sheetOpen) closeSheet(); else { selected = null; inspectorMode = null; renderInspector(); } }
  else if (k === 'w') setCutaway(!cutaway);
  else if (k === 'c') setPov(pov === 'free' ? 'robot' : pov === 'robot' ? 'human' : 'free');
  else if (k === 'v') setTool('cursor'); else if (k === 'o') setTool('orbit'); else if (k === 'f') focusRobot();
  else if (k === 'n') toggleSheet(); else if (k === 'b') openResults();
  else if (k === 'r') $('#resetBtn').click(); else if (k === 'm') { muted = !muted; if (muted) tts?.cancel(); toast(muted ? '소리·목소리 끔' : '소리·목소리 켬'); }
  else if (k >= '1' && k <= String(SCENARIOS.length)) loadScenario(+k - 1);
});
addEventListener('keyup', e => { if (e.code === 'Space') editor?.setSpace(false); });

let toastT = null;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }

// ---- springy close: these panels play a short exit animation before really hiding ------------------
// `el.hidden` keeps its normal meaning everywhere: it reads true as soon as a close starts.
(function springClose() {
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  for (const el of $$('.menu, #addNode, #povInfo, #inspector, #sheet, #dim, .modal, #toast, .sheet-q, .sheet-r, .card-sm')) {
    Object.defineProperty(el, 'hidden', {
      configurable: true,
      get() { return el.classList.contains('closing') || desc.get.call(el); },
      set(v) {
        if (!v) { el.classList.remove('closing'); desc.set.call(el, false); return; }
        if (desc.get.call(el) || el.classList.contains('closing')) return;
        if (reduced.matches) { desc.set.call(el, true); return; }
        el.classList.add('closing');
        const done = () => { if (!el.classList.contains('closing')) return; el.classList.remove('closing'); desc.set.call(el, true); };
        el.addEventListener('animationend', done, { once: true });
        setTimeout(done, 280); // safety net if no animation runs
      },
    });
  }
})();

// ---- boot -------------------------------------------------------------------------------------
// ---- space picker (shown before any simulation) -------------------------------------------------
function showSpacePicker() {
  const el = $('#spacePicker'), last = store.get('space', null);
  el.innerHTML = `<div class="sp-wrap">
    <header><span class="logo"><i></i></span><b>Servbot Lab</b></header>
    <h1>어떤 공간에서 시뮬레이션할까요?</h1>
    <p class="dim">Blender로 만든 식당을 그대로 불러와요. 공간마다 통로 폭과 테이블 배치가 달라서 같은 로봇 행동도 결과가 달라져요.</p>
    <div class="sp-grid">${Object.values(SPACES).map(sp => `
      <article class="sp-card glass ${sp.id === last ? 'last' : ''}" data-id="${sp.id}" tabindex="0" role="button" aria-label="${sp.name}에서 시작">
        <div class="sp-thumb"><img src="${sp.thumb}" alt="" onerror="this.parentNode.classList.add('noimg')"><span>${sp.name}</span></div>
        <div class="sp-body">
          <div class="sp-title"><b>${sp.name}</b>${sp.id === last ? '<span class="sp-badge">최근</span>' : ''}</div>
          <p>${sp.desc}</p>
          <div class="sp-meta"><span>${sp.stats}</span></div>
          <div class="sp-scen">${sp.scenarios.map((s, i) => `<span>${NUM[i]} ${s.name}</span>`).join('')}</div>
          <button class="btn primary block">이 공간에서 시작</button>
        </div>
      </article>`).join('')}</div>
    <p class="dim small">시작한 뒤에도 왼쪽 위 로고 메뉴에서 공간을 바꿀 수 있어요</p></div>`;
  const go = id => { store.set('space', id); location.search = '?space=' + id; };
  el.querySelectorAll('.sp-card').forEach(c => { c.onclick = () => go(c.dataset.id); c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') go(c.dataset.id); }; });
  el.hidden = false; $('#loading').hidden = true;
}

(async () => {
  if (!SPACES[SPACE_ID]) { showSpacePicker(); return; }
  $('#spaceName').textContent = SPACE.name;
  const data = await (await fetch(SPACE.data)).json();
  grid = new Grid(data, SPACE);
  editor = createEditor({
    view: $('#graphView'), canvas: $('#graphCanvas'), wires: $('#wires'), addBox: $('#addNode'), addSearch: $('#addSearch'), addList: $('#addList'), zoomBtn: $('#zoomBtn'),
    types: EXPR_TYPES, catColor: EXPR_CAT, catName: EXPR_CAT_NAME,
    preview: (cv, n) => { if (faceSrc) drawPreview(cv, faceSrc, n.p, FACE_COLOR); },
    onAction: (n, k) => { if (k !== 'listen') return; const line = sayOf(n, LINES); if (!line) { toast('말이 없는 반응이에요 · 문장을 고르거나 직접 써 주세요'); return; } if (muted) { muted = false; toast('소리를 켰어요'); } speak(line, n); },
    onChange: g => { clearTimeout(saveT); saveT = setTimeout(() => store.set(EXPR_KEY, g), 300); noteGraph(); },
  });
  editor.toast = toast;
  editor.setGraph(xgraph); noteGraph();
  if (FIGMA) { const L = $('#loading .pill'), t0 = L.textContent; L.textContent = 'Figma 화면을 받는 중…'; PACK = await waitPack(); L.textContent = t0; }
  try { await Promise.all([loadSpace(), loadRobot(), loadBunny()]); } catch (err) { console.error(err); toast('glb를 불러오지 못했어요'); }
  if (FIGMA) toast(PACK ? `Figma 화면 ${Object.keys(PACK.screens).length}개를 디자인 로봇(B)에 올렸어요` : 'Figma 화면을 받지 못해 기본 화면으로 보여요');
  editor.redrawPreviews();
  $('#loading').hidden = true;
  loadScenario(1, { focus: false });
  const [cx, cy, cz] = SPACE.cam; camera.position.set(FOCUS[1][0] + cx, cy, FOCUS[1][1] + cz); controls.target.set(FOCUS[1][0], 0, FOCUS[1][1]); // from the hall side, kitchen behind
  setView('B'); refreshPlay(); setPov('robot'); // start looking at the robot's face
  if (tts) toast('화면을 한 번 클릭하면 로봇 목소리가 켜져요 · M으로 끄기');
  requestAnimationFrame(frame);
})();

// handy for debugging in the console
window.servbot = { get sims() { return sims; }, controls, camera, povCam, get povYaw() { return povYaw; }, get visuals() { return visuals; }, graphs, params, get mode() { return mode; }, get test() { return test; },
  pickAt: (x, y) => pickAt(x, y),
  robotScreen(k = 'B', id = 0) { const r = sims[k].robots[id], v = new THREE.Vector3(r.x, 0.5, r.y); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); v.project(camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; },
  step(n = 1) { for (let i = 0; i < n && playing; i++) { stepAll(); onStep(); } exTick(); } };
