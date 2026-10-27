// Node editor (Blender/Isaac-style): drag nodes, drag sockets to connect, click a wire + Delete to cut, ⇧A to add.
// Node types are passed in (the 표현 그래프 uses its own small set); defaults to the behavior graph types.
import { TYPES as BEHAVIOR_TYPES, SOCK_COLOR, CAT_COLOR as BEHAVIOR_CAT, LED_COLOR } from './graph.js?v=7';
import { PARAM_META } from './sim.js?v=7';

const BEHAVIOR_CAT_NAME = { input: '입력', logic: '조건', behavior: '행동', signal: '의도 표현' };
const NEW_DEFAULTS = { ref: 1, sec: { param: 'waitingTime' }, delay: 1, notice: 1, cap: 0.35, from: { param: 'yieldDistance' }, to: { param: 'personalDistance' }, decel: true, align: true };

export function createEditor({ view, canvas, wires, addBox, addSearch, addList, zoomBtn, onChange, types: TYPES = BEHAVIOR_TYPES, catColor: CAT_COLOR = BEHAVIOR_CAT, catName: CAT_NAME = BEHAVIOR_CAT_NAME, preview = null, onAction = null }) {
  let graph = null, s = 1, tx = 20, ty = 10, sel = null, selLink = null, spaceDown = false;
  const els = new Map();

  const apply = () => { canvas.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; zoomBtn.textContent = Math.round(s * 100) + '%'; };
  const toCanvas = (cx, cy) => { const r = view.getBoundingClientRect(); return [(cx - r.left - tx) / s, (cy - r.top - ty) / s]; };
  const changed = () => onChange?.(graph);

  function setGraph(g) { graph = g; sel = selLink = null; render(); }

  function render() {
    for (const el of [...canvas.querySelectorAll('.node')]) el.remove();
    els.clear();
    for (const n of graph.nodes) buildNode(n);
    drawWires();
  }

  function buildNode(n) {
    const t = TYPES[n.type];
    const el = document.createElement('div');
    el.className = 'node'; el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
    const cat = CAT_COLOR[t.cat];
    el.innerHTML = `<div class="nh" style="background:${cat}33"><i style="background:${cat}"></i>${t.title}<span class="badge">실행 중</span></div><div class="rows"></div>`;
    const rows = el.querySelector('.rows');
    const socks = new Map(), vals = new Map();
    for (const [k, label, type] of t.ins) {
      const r = row('in', label); const sk = sock(r, n.id, k, 'in', type); socks.set('in.' + k, sk); rows.append(r);
    }
    if (t.preview && preview) { // live face preview at the top of the card
      const cv = document.createElement('canvas'); cv.className = 'preview'; cv.width = 240; cv.height = 120; rows.append(cv); preview(cv, n);
    }
    for (const p of t.params) if (!p.when || p.when(n.p)) rows.append(paramRow(n, p));
    for (const [k, label, type] of t.outs) {
      const r = row('out', ''); const v = document.createElement('span'); v.className = 'val'; r.append(v, Object.assign(document.createElement('span'), { textContent: label }));
      vals.set(k, v); socks.set('out.' + k, sock(r, n.id, k, 'out', type)); rows.append(r);
    }
    el.querySelector('.nh').addEventListener('pointerdown', e => startMove(e, n, el));
    el.addEventListener('pointerdown', e => { if (e.button === 0) select(n.id); });
    canvas.append(el);
    els.set(n.id, { el, socks, vals });
  }
  const row = (dir, text) => { const r = document.createElement('div'); r.className = 'r ' + dir; if (text) r.append(Object.assign(document.createElement('span'), { textContent: text })); return r; };
  function sock(r, id, k, dir, type) {
    const d = document.createElement('span'); d.className = 'sock'; d.style.background = SOCK_COLOR[type];
    Object.assign(d.dataset, { id, k, dir, type });
    d.addEventListener('pointerdown', startLink);
    r.append(d); return d;
  }

  function paramRow(n, p) {
    const r = document.createElement('div'); r.className = 'r';
    r.append(Object.assign(document.createElement('span'), { className: 'k', textContent: p.label + (p.unit ? ` (${p.unit})` : '') }));
    const v = document.createElement('span'); v.className = 'v'; r.append(v);
    const stop = el => { el.addEventListener('pointerdown', e => e.stopPropagation()); el.addEventListener('keydown', e => e.stopPropagation()); return el; };
    const set = val => {
      n.p[p.k] = val; changed();
      if (TYPES[n.type].onParam?.(n, p.k)) return rebuild(n); // e.g. a preset fills the sliders
      const cv = els.get(n.id)?.el.querySelector('canvas.preview'); if (cv && preview) preview(cv, n);
    };
    const val = n.p[p.k];
    if (p.type === 'select') {
      const se = stop(document.createElement('select'));
      se.innerHTML = p.options.map(([k, l]) => `<option value="${k}"${k === val ? ' selected' : ''}>${l}</option>`).join('');
      se.onchange = () => set(se.value); v.append(se);
    } else if (p.type === 'number') {
      if (val && typeof val === 'object') {
        const se = stop(document.createElement('select')); se.className = 'linked';
        se.innerHTML = PARAM_META.map(m => `<option value="${m.k}"${m.k === val.param ? ' selected' : ''}>${m.label}</option>`).join('');
        se.onchange = () => set({ param: se.value }); v.append(se);
      } else {
        const inp = stop(document.createElement('input')); inp.type = 'number'; inp.step = p.step || 0.1; inp.value = val ?? 0;
        inp.oninput = () => set(parseFloat(inp.value) || 0); v.append(inp);
      }
      if (p.link) {
        const lb = stop(document.createElement('button')); lb.className = 'linkbtn' + (typeof val === 'object' ? ' on' : ''); lb.textContent = 'P';
        lb.title = typeof val === 'object' ? '파라미터 연결 끊기' : '파라미터 패널 값과 연결';
        lb.onclick = () => { set(typeof n.p[p.k] === 'object' ? 1 : { param: 'yieldDistance' }); rebuild(n); };
        v.append(lb);
      }
    } else if (p.type === 'range') {
      const inp = stop(document.createElement('input')); Object.assign(inp, { type: 'range', min: p.min, max: p.max, step: p.step, value: val ?? 0 });
      const out = document.createElement('b'); out.className = 'rv'; out.textContent = (+inp.value).toFixed(p.step < 1 ? 2 : 0);
      inp.oninput = () => { out.textContent = (+inp.value).toFixed(p.step < 1 ? 2 : 0); set(+inp.value); }; v.append(inp, out);
    } else if (p.type === 'button') {
      const b = stop(document.createElement('button')); b.className = 'act'; b.textContent = p.text || p.label;
      b.onclick = () => onAction?.(n, p.k); v.append(b);
    } else if (p.type === 'text') {
      const inp = stop(document.createElement('input')); inp.type = 'text'; inp.value = val || ''; inp.placeholder = '없음';
      inp.oninput = () => set(inp.value); v.append(inp);
    } else if (p.type === 'color') {
      const box = document.createElement('span'); box.className = 'colors';
      for (const [k, l] of p.options) {
        const b = stop(document.createElement('button')); b.title = l; b.style.background = LED_COLOR[k]; if (k === val) b.className = 'on';
        b.onclick = () => { set(k); box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
        box.append(b);
      }
      v.append(box);
    } else if (p.type === 'toggle') {
      const b = stop(document.createElement('button')); b.className = 'tog' + (val ? ' on' : '');
      b.onclick = () => { set(!n.p[p.k]); b.classList.toggle('on', !!n.p[p.k]); }; v.append(b);
    }
    return r;
  }
  function rebuild(n) { els.get(n.id).el.remove(); buildNode(n); if (sel === n.id) els.get(n.id).el.classList.add('sel'); drawWires(); }
  function redrawPreviews() { if (!preview) return; for (const n of graph?.nodes || []) { const cv = els.get(n.id)?.el.querySelector('canvas.preview'); if (cv) preview(cv, n); } }

  // ---- wires ----
  function sockPos(id, key) {
    const e = els.get(id)?.socks.get(key); if (!e) return null;
    const r = e.getBoundingClientRect(); return toCanvas(r.left + r.width / 2, r.top + r.height / 2);
  }
  const curve = ([x1, y1], [x2, y2]) => { const dx = Math.max(40, Math.abs(x2 - x1) / 2); return `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`; };
  function drawWires(temp) {
    let html = '';
    graph.links.forEach((l, i) => {
      const a = sockPos(l.from[0], 'out.' + l.from[1]), b = sockPos(l.to[0], 'in.' + l.to[1]); if (!a || !b) return;
      const type = TYPES[graph.nodes.find(n => n.id === l.from[0]).type].outs.find(o => o[0] === l.from[1])[2];
      const d = curve(a, b);
      html += `<path d="${d}" stroke="${SOCK_COLOR[type]}" data-i="${i}" class="w${selLink === i ? ' sel' : ''}" opacity=".5"/><path d="${d}" class="hit" data-i="${i}"/>`;
    });
    if (temp) html += `<path d="${curve(temp[0], temp[1])}" stroke="#fff" stroke-dasharray="5 4" opacity=".8"/>`;
    wires.innerHTML = html;
  }
  wires.addEventListener('pointerdown', e => {
    const i = e.target.dataset.i; if (i === undefined) return;
    e.stopPropagation(); selLink = +i; sel = null; els.forEach(x => x.el.classList.remove('sel')); drawWires();
  });

  // ---- interactions ----
  function select(id) { sel = id; selLink = null; els.forEach((x, k) => x.el.classList.toggle('sel', k === id)); drawWires(); }
  function startMove(e, n, el) {
    if (e.button !== 0 || spaceDown) return;
    e.stopPropagation(); select(n.id);
    const [sx, sy] = toCanvas(e.clientX, e.clientY), ox = n.x, oy = n.y;
    const mv = ev => { const [x, y] = toCanvas(ev.clientX, ev.clientY); n.x = Math.round(ox + x - sx); n.y = Math.round(oy + y - sy); el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; drawWires(); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); changed(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  function startLink(e) {
    e.stopPropagation(); e.preventDefault();
    let { id, k, dir, type } = e.target.dataset;
    if (dir === 'in') { // pull an existing wire off its input, Blender-style
      const i = graph.links.findIndex(l => l.to[0] === id && l.to[1] === k);
      if (i < 0) return;
      const l = graph.links.splice(i, 1)[0]; [id, k] = l.from; dir = 'out'; changed();
    }
    const from = sockPos(id, 'out.' + k);
    const mv = ev => drawWires([from, toCanvas(ev.clientX, ev.clientY)]);
    const up = ev => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      if (t?.classList.contains('sock') && t.dataset.dir === 'in' && t.dataset.id !== id) {
        if (t.dataset.type !== type) toast?.('같은 색 연결점끼리만 연결할 수 있어요');
        else {
          graph.links = graph.links.filter(l => !(l.to[0] === t.dataset.id && l.to[1] === t.dataset.k));
          graph.links.push({ from: [id, k], to: [t.dataset.id, t.dataset.k] }); changed();
        }
      }
      drawWires();
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  view.addEventListener('pointerdown', e => {
    if (e.button === 2) return; // right button = add-node menu, not pan
    if (e.button === 0 && !addBox.hidden) closeAdd();
    if (e.target !== view && e.target !== canvas && e.target !== wires) return;
    if (e.button === 0 && !spaceDown) { sel = selLink = null; els.forEach(x => x.el.classList.remove('sel')); drawWires(); }
    view.classList.add('panning');
    const sx = e.clientX - tx, sy = e.clientY - ty;
    const mv = ev => { tx = ev.clientX - sx; ty = ev.clientY - sy; apply(); };
    const up = () => { view.classList.remove('panning'); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
  view.addEventListener('wheel', e => {
    e.preventDefault();
    const r = view.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const ns = Math.min(1.5, Math.max(0.3, s * Math.exp(-e.deltaY * 0.0015)));
    tx = mx - (mx - tx) * ns / s; ty = my - (my - ty) * ns / s; s = ns; apply(); drawWires();
  }, { passive: false });

  function fit() {
    if (!graph.nodes.length) return;
    const xs = graph.nodes.map(n => n.x), ys = graph.nodes.map(n => n.y);
    const hs = graph.nodes.map(n => els.get(n.id)?.el.offsetHeight || 120);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs) + 220, y1 = Math.max(...ys.map((y, i) => y + hs[i]));
    const vw = view.clientWidth, vh = view.clientHeight;
    s = Math.min(1, (vw - 40) / (x1 - x0), (vh - 30) / (y1 - y0)); s = Math.max(0.3, s);
    tx = (vw - (x1 - x0) * s) / 2 - x0 * s; ty = 12 - y0 * s; apply(); drawWires();
  }
  zoomBtn.onclick = fit;

  function deleteSelected() {
    if (selLink !== null) { graph.links.splice(selLink, 1); selLink = null; changed(); drawWires(); return true; }
    if (sel) {
      const n = graph.nodes.find(n => n.id === sel); if (!n || n.type === 'output') return false;
      graph.nodes = graph.nodes.filter(x => x !== n); graph.links = graph.links.filter(l => l.from[0] !== sel && l.to[0] !== sel);
      els.get(sel).el.remove(); els.delete(sel); sel = null; changed(); drawWires(); return true;
    }
    return false;
  }

  // ---- add-node popover ----
  let addIdx = 0, addItems = [];
  let addAt = null; // canvas point where the new node goes (right-click spot)
  function openAdd(cx, cy) {
    addBox.hidden = false; addSearch.value = ''; addIdx = 0; listAdd();
    const vr = view.getBoundingClientRect(), box = addBox.offsetParent.getBoundingClientRect();
    if (cx === undefined) { cx = vr.left + vr.width / 2 - 100; cy = vr.top + 40; }
    addAt = toCanvas(cx, cy);
    const w = addBox.offsetWidth || 320, h = addBox.offsetHeight || 380;
    addBox.style.left = Math.max(8, Math.min(box.width - w - 8, cx - box.left)) + 'px';
    addBox.style.top = Math.max(8, Math.min(box.height - h - 8, cy - box.top)) + 'px';
    setTimeout(() => addSearch.focus(), 0);
  }
  // right-click on empty canvas → add node right there
  view.addEventListener('contextmenu', e => { e.preventDefault(); if (e.target.closest('.node')) return; openAdd(e.clientX, e.clientY); });
  function listAdd() {
    const q = addSearch.value.trim();
    addItems = Object.entries(TYPES).filter(([k, t]) => k !== 'output' && (!q || t.title.includes(q) || t.desc.includes(q) || k.includes(q.toLowerCase())));
    addIdx = Math.min(addIdx, Math.max(0, addItems.length - 1));
    let html = '', last = '';
    addItems.forEach(([k, t], i) => {
      if (t.cat !== last) { html += `<div class="grp">${CAT_NAME[t.cat]}</div>`; last = t.cat; }
      html += `<button data-k="${k}" class="${i === addIdx ? 'on' : ''}"><i style="background:${CAT_COLOR[t.cat]}"></i><span>${t.title}<small>${t.desc}</small></span></button>`;
    });
    addList.innerHTML = html || '<div class="grp">결과가 없어요</div>';
  }
  function addNode(type) {
    const t = TYPES[type], p = t.init ? t.init() : {};
    if (!t.init) for (const d of t.params) p[d.k] = NEW_DEFAULTS[d.k] ?? (d.type === 'select' ? d.options[0][0] : d.type === 'color' ? 'white' : d.type === 'text' ? '' : d.type === 'toggle' ? true : 1);
    let i = 1; while (graph.nodes.some(n => n.id === type + i)) i++;
    const [cx, cy] = addAt || toCanvas(view.getBoundingClientRect().left + view.clientWidth / 2 - 100, view.getBoundingClientRect().top + 40);
    const n = { id: type + i, type, x: Math.round(cx), y: Math.round(cy), p };
    graph.nodes.push(n); buildNode(n); select(n.id); changed();
    closeAdd();
  }
  addSearch.addEventListener('input', () => { addIdx = 0; listAdd(); });
  addSearch.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { addIdx = Math.min(addItems.length - 1, addIdx + 1); listAdd(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { addIdx = Math.max(0, addIdx - 1); listAdd(); e.preventDefault(); }
    else if (e.key === 'Enter' && addItems[addIdx]) addNode(addItems[addIdx][0]);
    else if (e.key === 'Escape') closeAdd();
  });
  function closeAdd() { addBox.hidden = true; addSearch.blur(); }
  addList.addEventListener('click', e => { const b = e.target.closest('button'); if (b) addNode(b.dataset.k); });

  // ---- live state from the running robot ----
  const fmt = v => typeof v === 'boolean' ? (v ? '참' : '거짓') : typeof v === 'number' ? (v >= 98 ? '—' : v.toFixed(1)) : '';
  function update(robot) {
    if (!graph) return;
    const live = new Set([robot?.chosen?.node, robot?.sigNode].filter(Boolean));
    for (const [id, x] of els) {
      x.el.classList.toggle('live', live.has(id));
      for (const [k, v] of x.vals) v.textContent = fmt(robot?.values?.[id + '.' + k]);
    }
    for (const p of wires.querySelectorAll('path.w')) {
      const l = graph.links[+p.dataset.i]; const v = l && robot?.values?.[l.from.join('.')];
      const hot = v === true || (typeof v === 'number' && v < 98 && false);
      p.setAttribute('opacity', hot ? '1' : '.45'); p.setAttribute('stroke-width', hot ? '3' : '2.2');
    }
  }

  let toast = null;
  apply();
  return {
    setGraph, fit, update, openAdd, deleteSelected, drawWires: () => graph && drawWires(), redrawPreviews,
    set toast(f) { toast = f; },
    setSpace(v) { spaceDown = v; },
    get addOpen() { return !addBox.hidden; }, closeAdd,
  };
}
