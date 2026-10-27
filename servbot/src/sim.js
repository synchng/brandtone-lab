// Deterministic simulation core (no three.js, runs in browser and node).
// Sim coords: x = Blender X, y = -Blender Y (= three.js z). Meters, seconds.
import { evaluate } from './graph.js?v=7';

export const DT = 0.05;
const RES = 0.1;
const NARROW = 0.745;          // clearance (half aisle width) below this counts as a narrow aisle
export const ROBOT_R = 0.28;
export const HUMAN_R = 0.25;
const NEAR_GAP = 0.15;       // surface gap counted as one near-collision

export const PARAM_META = [
  { k: 'robotSpeed', label: '로봇 속도', min: 0.2, max: 1.2, step: 0.05, unit: 'm/s' },
  { k: 'yieldDistance', label: '양보 거리', min: 0.8, max: 3, step: 0.1, unit: 'm' },
  { k: 'waitingTime', label: '대기 시간', min: 0.5, max: 8, step: 0.5, unit: 's' },
  { k: 'personalDistance', label: '개인 거리', min: 0.3, max: 1.5, step: 0.05, unit: 'm' },
  { k: 'humanCount', label: '보행자 수', min: 0, max: 20, step: 1, unit: '명' },
  { k: 'robotCount', label: '로봇 수', min: 1, max: 3, step: 1, unit: '대' },
];
export const defaultParams = () => ({ robotSpeed: 0.6, yieldDistance: 1.5, waitingTime: 3, personalDistance: 0.8, humanCount: 6, robotCount: 1 });

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// ---- spaces --------------------------------------------------------------------------------------
// Each space = one exported .blend: walkable floors, named spots (POI), where the robot stands to serve each table,
// robot docks, which chairs have seated guests, built-in scenarios and templates for the user-problem flow.
const SHINSA_SCENARIOS = [
  {
    id: 1, name: '앞을 막음', title: '사람이 앞을 막았을 때', duration: 48, focus: [14.5, 6.5],
    caption: '디자인한 로봇은 멀리서부터 속도를 줄이고, 기다려도 길이 안 열리면 방향을 먼저 알린 뒤 돌아가요.',
    principle: ['원칙 01', '멈추기 전에 먼저 느려진다', '갑자기 서는 대신 거리에 맞춰 감속하면, 사람이 로봇의 다음 행동을 미리 알아차려요.'],
    tables: [['Table_05', 'Table_03'], ['Table_07', 'Table_08'], ['Table_03', 'Table_01']],
    humans: [{ at: [13.77, 6.2], steps: [{ stand: 24 }, { to: 'entrance' }] }], bgPOI: ['lounge', 'lounge2', 'restroom'],
  },
  {
    id: 2, name: '좁은 통로', title: '좁은 통로에서 마주쳤을 때', duration: 40, focus: [22.8, 6],
    caption: '디자인한 로봇은 통로에 들어가기 전에 먼저 비켜서서 사람을 보내요.',
    principle: ['원칙 03', '양보는 공간으로 표현한다', '말이나 소리보다, 로봇이 먼저 물러서는 위치 변화가 의도를 가장 빠르게 전달해요.'],
    tables: [['Table_14', 'Table_11'], ['Table_11', 'Table_10'], ['Table_03', 'Table_05']],
    humans: [{ at: [23.94, 0.8], steps: [{ stand: 4 }, { to: [23.94, 9.0] }, { to: 'entrance' }] }], bgPOI: ['lounge', 'lounge2', 'restroom', 'top10', 'bot10', 'top13', 'bot13'],
  },
  {
    id: 3, name: '혼잡', title: '여러 사람이 동시에 움직일 때', duration: 45, focus: [20.2, 7],
    caption: '디자인한 로봇은 혼잡할수록 낮고 일정한 속도로, 멈췄다 섰다를 반복하지 않아요.',
    principle: ['원칙 05', '혼잡할수록 단순하고 일정하게 움직인다', '자주 멈추는 로봇보다 느리지만 일정한 로봇이 더 예측하기 쉬워요.'],
    tables: [['Table_11', 'Table_08'], ['Table_08', 'Table_07'], ['Table_05', 'Table_03']],
    humans: [], crowd: 8, crowdPOI: ['top20', 'bot20', 'top17', 'bot17', 'bot24', 'desk', 'entrance', 'bot13'],
  },
];

const SHINSA_ARRIVAL = {
    id: 'arrival', name: '테이블 도착', title: '테이블에 도착했을 때', duration: 36, focus: [17.6, 5.5],
    caption: '디자인한 로봇은 천천히 다가가 트레이를 손님 쪽으로 돌리고, 출발 1초 전에 방향을 바닥에 보여줘요.',
    principle: ['원칙 04', '방향을 바꾸기 전에 먼저 예고한다', '출발 1초 전 바닥 화살표만으로도 주변 사람이 미리 비켜설 수 있어요.'],
    tables: [['Table_07', 'Table_05'], ['Table_10', 'Table_11'], ['Table_01', 'Table_03']],
    humans: [{ at: [17.2, 9.3], steps: [{ stand: 17 }, { to: [17.2, 3.05] }, { pause: 3 }, { to: 'restroom' }] }], bgPOI: ['lounge', 'lounge2', 'restroom', 'top10', 'bot10', 'top13'],
  };

const SHINSA = {
  id: 'shinsa', name: '메인 홀 식당', desc: '긴 테이블이 줄지어 있고, 오른쪽 끝에 폭 1.24 m 좁은 통로가 있는 넓은 식당이에요.',
  stats: '약 30 × 17 m · 테이블 16개 · 의자 64개', glb: 'assets/restaurant.glb', data: 'assets/obstacles.json', thumb: 'assets/thumb_shinsa.jpg',
  offset: [0, 0, 0], cam: [-5, 16, -15],
  floors: [[0, 0, 30.46, 10], [0, 10, 28.14, 16.89]], // Floor_Upper_01 / Floor_Lower_01
  POI: {
    entrance: [29.3, 8.4], restroom: [5.1, 9.6], lounge: [3, 3], lounge2: [3, 8.4], desk: [26.9, 8.6],
    top10: [10.3, 3.05], top13: [13.77, 3.05], top17: [17.2, 3.05], top20: [20.65, 3.05],
    bot10: [10.3, 8.6], bot13: [13.77, 8.6], bot17: [17.2, 8.6], bot20: [20.65, 8.6], bot24: [23.94, 8.6],
  },
  SERVE: {
    Table_01: [9.86, 4.3], Table_03: [10.8, 4.3], Table_05: [14.22, 4.3], Table_07: [17.66, 4.3], Table_08: [17.66, 6.5],
    Table_10: [21.1, 3.2], Table_11: [21.1, 4.8], Table_14: [24.0, 2.85],
  },
  HOMES: [[19.8, 9.85], [18.9, 9.85], [20.7, 9.85]],
  SEATED: ['Chair_03', 'Chair_04', 'Chair_13', 'Chair_16', 'Chair_23', 'Chair_26', 'Chair_31', 'Chair_33', 'Chair_34',
    'Chair_37', 'Chair_43', 'Chair_46', 'Chair_49', 'Chair_52', 'Chair_58', 'Chair_59', 'Chair_62', 'Chair_09', 'Chair_20'],
  scenarios: SHINSA_SCENARIOS, arrival: SHINSA_ARRIVAL,
  problems: {
    behind: {
      duration: 40, focus: [15.5, 8.4], tables: [['Table_03', 'Table_01'], ['Table_07', 'Table_08'], ['Table_10', 'Table_11']],
      humans: [{ at: [18.6, 8.7], speed: 0.55, steps: [{ stand: 1.4 }, { to: [9.6, 8.7] }, { to: 'lounge2' }] }],
      bgPOI: ['lounge', 'top17', 'top20', 'desk'],
    },
    standup: {
      duration: 36, focus: [20.4, 5.8], tables: [['Table_10', 'Table_11'], ['Table_07', 'Table_08'], ['Table_03', 'Table_05']],
      humans: [{ at: [19.6, 5.72], sit: true, heading: Math.PI, steps: [{ stand: 7.6 }, { to: [20.6, 5.6] }, { to: 'restroom' }] }],
      bgPOI: ['lounge', 'lounge2', 'restroom', 'top10'],
    },
    kids: {
      duration: 40, focus: [18, 7.6], tables: [['Table_08', 'Table_05'], ['Table_07', 'Table_11'], ['Table_03', 'Table_01']],
      humans: [], crowd: 3, kids: 3, crowdPOI: ['bot17', 'top17', 'bot20', 'bot13', 'top20'],
      bgPOI: ['lounge', 'lounge2', 'restroom'],
    },
  },
};

// restaurant_hall_cgt_decor.blend, exported with x + 1 m and its floor (z 1.1 m) moved to 0 — see tools/export_space.py
const HALL = {
  id: 'hall', name: '레스토랑 홀', desc: '벽면 부스석과 화분 띠로 나뉜 테이블 줄이 있는 아늑한 홀이에요. 주방 앞 통로가 0.8 m로 아주 좁아요.',
  stats: '약 20 × 10 m · 테이블 20개 · 의자 62개', glb: 'assets/hall.glb', data: 'assets/hall.json', thumb: 'assets/thumb_hall.jpg',
  offset: [1, -1.116, 0], cam: [-4, 15, 14],
  POI: {
    entrance: [20.1, 8.3], laneW: [8.4, 8.6], laneMid: [13.5, 8.6], laneE: [19.4, 8.6],
    topW: [9.6, 4.8], topMid: [13.5, 4.8], topE: [19.4, 4.9], eastEnd: [19.5, 6.5], westMid: [8.4, 6.5],
    boothN: [3.37, 2.0], boothS: [3.37, 9.0], centerTop: [5.7, 4.98], centerBot: [5.7, 8.25], centerBotW: [4.2, 8.3],
  },
  SERVE: {
    Table_Mid_S1: [10.3, 8.58], Table_Mid_S2: [12.86, 8.58], Table_Mid_S3: [15.39, 8.58], Table_Mid_S4: [17.95, 8.58],
    Table_Mid_N2: [12.86, 4.78], Table_Mid_N3: [15.39, 4.78], Table_Mid_N4: [17.95, 4.78],
    Table_Bottom_1: [5.2, 8.35], Table_Bottom_2: [9.98, 8.62], Table_Bottom_3: [12.84, 8.62],
    Table_Booth_T2: [3.37, 4.9], Table_Booth_T3: [3.37, 7.1], Table_Center_2: [8.0, 6.5],
  },
  HOMES: [[9.1, 3.45], [8.55, 3.0], [9.2, 2.4]], // inside the service room, out through the 1.15 m pass door
  SEATED: ['Chair_Mid_S1_L1', 'Chair_Mid_S2_R1', 'Chair_Mid_N2_L2', 'Chair_Mid_N3_R1', 'Chair_Bottom_2_L1', 'Chair_Bottom_3_R2',
    'Chair_Bottom_4_L1', 'Chair_Booth_T1_2', 'Chair_Booth_T3_1', 'Chair_Mid_N4_L1', 'Chair_Bottom_5_R1', 'Chair_Mid_S3_L2',
    'Chair_Booth_T4_1', 'Chair_Mid_N1_R2'],
  scenarios: [
    {
      id: 1, name: '앞을 막음', title: '사람이 앞을 막았을 때', duration: 60, focus: [14, 7.6],
      caption: '디자인한 로봇은 멀리서부터 속도를 줄이고, 기다려도 길이 안 열리면 방향을 먼저 알린 뒤 돌아가요.',
      principle: ['원칙 01', '멈추기 전에 먼저 느려진다', '갑자기 서는 대신 거리에 맞춰 감속하면, 사람이 로봇의 다음 행동을 미리 알아차려요.'],
      tables: [['Table_Mid_S4', 'Table_Mid_S3'], ['Table_Mid_N2', 'Table_Bottom_2'], ['Table_Booth_T3', 'Table_Center_2']],
      humans: [{ at: [11.6, 8.6], steps: [{ stand: 32 }, { to: 'entrance' }, { exit: true }] }], bgPOI: ['boothN', 'boothS', 'centerTop', 'westMid'],
    },
    {
      id: 2, name: '좁은 통로', title: '주방 앞 좁은 통로에서 마주쳤을 때', duration: 40, focus: [13.5, 5.4],
      caption: '디자인한 로봇은 0.8 m 통로에 들어가기 전에 먼저 비켜서서 손님을 보내요.',
      principle: ['원칙 03', '양보는 공간으로 표현한다', '말이나 소리보다, 로봇이 먼저 물러서는 위치 변화가 의도를 가장 빠르게 전달해요.'],
      tables: [['Table_Mid_N3', 'Table_Mid_N2'], ['Table_Mid_S2', 'Table_Bottom_2'], ['Table_Booth_T2', 'Table_Center_2']],
      humans: [{ at: [19.4, 4.9], steps: [{ stand: 4 }, { to: 'topW' }, { to: 'boothN' }] }], bgPOI: ['boothN', 'boothS', 'centerBot', 'laneW'],
    },
    {
      id: 3, name: '혼잡', title: '여러 사람이 동시에 움직일 때', duration: 50, focus: [6.6, 7.4],
      caption: '디자인한 로봇은 혼잡할수록 낮고 일정한 속도로, 멈췄다 섰다를 반복하지 않아요.',
      principle: ['원칙 05', '혼잡할수록 단순하고 일정하게 움직인다', '자주 멈추는 로봇보다 느리지만 일정한 로봇이 더 예측하기 쉬워요.'],
      tables: [['Table_Bottom_1', 'Table_Center_2'], ['Table_Mid_S3', 'Table_Mid_S1'], ['Table_Booth_T3', 'Table_Mid_S2']],
      humans: [], crowd: 7, crowdPOI: ['centerBot', 'centerBotW', 'westMid', 'boothS', 'laneW'], bgPOI: ['boothN', 'laneMid', 'laneE', 'eastEnd'],
    },
  ],
  arrival: {
    id: 'arrival', name: '테이블 도착', title: '테이블에 도착했을 때', duration: 36, focus: [13, 7.8],
    caption: '디자인한 로봇은 천천히 다가가 트레이를 손님 쪽으로 돌리고, 출발 1초 전에 방향을 바닥에 보여줘요.',
    tables: [['Table_Mid_S2', 'Table_Mid_S3'], ['Table_Mid_N2', 'Table_Mid_N3'], ['Table_Booth_T3', 'Table_Bottom_1']],
    humans: [{ at: [19.4, 8.6], steps: [{ stand: 18 }, { to: 'laneW' }, { to: 'boothS' }] }], bgPOI: ['boothN', 'boothS', 'centerTop', 'topW'],
  },
  problems: {
    behind: {
      duration: 40, focus: [13.5, 8.2], tables: [['Table_Mid_S4', 'Table_Mid_S3'], ['Table_Mid_N2', 'Table_Mid_N3'], ['Table_Booth_T3', 'Table_Bottom_1']],
      humans: [{ at: [8.6, 8.6], speed: 0.55, steps: [{ stand: 12.5 }, { to: 'laneE' }, { to: 'entrance' }, { exit: true }] }],
      bgPOI: ['boothN', 'boothS', 'centerTop', 'topE'],
    },
    standup: {
      duration: 40, focus: [14, 7.8], tables: [['Table_Mid_S4', 'Table_Mid_S3'], ['Table_Mid_N2', 'Table_Mid_N3'], ['Table_Booth_T3', 'Table_Bottom_1']],
      humans: [{ at: [13.56, 7.75], sit: true, heading: Math.PI, steps: [{ stand: 17.9 }, { to: [13.6, 8.6] }, { to: 'entrance' }, { exit: true }] }],
      bgPOI: ['boothN', 'boothS', 'centerTop', 'topW'],
    },
    kids: {
      duration: 40, focus: [12, 7.8], tables: [['Table_Bottom_3', 'Table_Mid_S2'], ['Table_Mid_N2', 'Table_Mid_N3'], ['Table_Booth_T3', 'Table_Bottom_1']],
      humans: [], crowd: 3, kids: 3, crowdPOI: ['laneW', 'laneMid', 'laneE', 'westMid', 'centerBot'],
      bgPOI: ['boothN', 'boothS', 'topE'],
    },
  },
};

export const SPACES = { shinsa: SHINSA, hall: HALL };
// the first space's lists stay exported under their old names
export const SCENARIOS = SHINSA.scenarios;
export const ARRIVAL_SCENARIO = SHINSA.arrival;

// ---- grid + A* ---------------------------------------------------------------------------------
export class Grid {
  // data: an obstacle list (first space) or { floors, obstacles } from tools/export_space.py
  constructor(data, space = SHINSA) {
    const obstacles = Array.isArray(data) ? data : data.obstacles;
    this.obstacles = obstacles; this.space = space;
    this.w = Math.ceil(30.6 / RES); this.h = Math.ceil(17 / RES);
    const block = new Uint8Array(this.w * this.h).fill(1);
    for (const [x0, y0, x1, y1] of (data.floors || space.floors)) this.fill(block, x0, y0, x1, y1, 0);
    for (const o of obstacles) this.fill(block, o.minX, o.minY, o.maxX, o.maxY, 1);
    this.clear = this.chamfer(block);
    // narrow = the widest spot within ~0.6 m is still tight, so walking close to a wall in a wide aisle doesn't count
    const R = 5, { w, h } = this, rowMax = new Float32Array(w * h), wide = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let m = 0; for (let d = -R; d <= R; d++) { const ii = i + d; if (ii >= 0 && ii < w) m = Math.max(m, this.clear[j * w + ii]); } rowMax[j * w + i] = m; }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let m = 0; for (let d = -R; d <= R; d++) { const jj = j + d; if (jj >= 0 && jj < h) m = Math.max(m, rowMax[jj * w + i]); } wide[j * w + i] = m; }
    this.wide = wide;
    this.memo = new Map();
  }
  fill(a, x0, y0, x1, y1, v) {
    const i0 = Math.max(0, Math.ceil(x0 / RES - 0.5)), i1 = Math.min(this.w - 1, Math.floor(x1 / RES - 0.5));
    const j0 = Math.max(0, Math.ceil(y0 / RES - 0.5)), j1 = Math.min(this.h - 1, Math.floor(y1 / RES - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) a[j * this.w + i] = v;
  }
  chamfer(block) { // distance (m) from each cell to the nearest blocked cell
    const { w, h } = this, d = new Float32Array(w * h), S = Math.SQRT2;
    for (let k = 0; k < d.length; k++) d[k] = block[k] ? 0 : 1e9;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i; let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) { v = Math.min(v, d[k - w] + 1); if (i > 0) v = Math.min(v, d[k - w - 1] + S); if (i < w - 1) v = Math.min(v, d[k - w + 1] + S); }
      d[k] = v;
    }
    for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i; let v = d[k];
      if (i < w - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < h - 1) { v = Math.min(v, d[k + w] + 1); if (i < w - 1) v = Math.min(v, d[k + w + 1] + S); if (i > 0) v = Math.min(v, d[k + w - 1] + S); }
      d[k] = v;
    }
    for (let k = 0; k < d.length; k++) d[k] = Math.max(0, d[k] * RES - RES / 2);
    return d;
  }
  k(x, y) { return Math.min(this.h - 1, Math.max(0, Math.floor(y / RES))) * this.w + Math.min(this.w - 1, Math.max(0, Math.floor(x / RES))); }
  clearAt(x, y) { return this.clear[this.k(x, y)]; }
  walkable(x, y, r) { return this.clearAt(x, y) >= r; }
  narrow(x, y) { const k = this.k(x, y); return this.clear[k] > 0.2 && this.wide[k] < NARROW; }
  lineClear(ax, ay, bx, by, r, block = null) {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.05);
    for (let s = 0; s <= n; s++) {
      const t = n ? s / n : 0, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      if (!this.walkable(x, y, r) || (block && Math.hypot(x - ax, y - ay) > 0.45 && block(x, y))) return false;
    }
    return true;
  }
  nearestWalkable(x, y, r) {
    if (this.walkable(x, y, r)) return [x, y];
    for (let rad = RES; rad < 3; rad += RES) for (let a = 0; a < 16; a++) {
      const px = x + Math.cos(a * Math.PI / 8) * rad, py = y + Math.sin(a * Math.PI / 8) * rad;
      if (this.walkable(px, py, r)) return [px, py];
    }
    return [x, y];
  }
  // block(x,y) → true marks extra temporary obstacles (other agents); such queries skip the memo.
  path(ax, ay, bx, by, r, block = null) {
    [ax, ay] = this.nearestWalkable(ax, ay, r); [bx, by] = this.nearestWalkable(bx, by, r);
    const { w, h, clear } = this, s = this.k(ax, ay), g = this.k(bx, by);
    const key = block ? null : s + ',' + g + ',' + r;
    if (key && this.memo.has(key)) return this.memo.get(key)?.map(p => p.slice()) ?? null;
    const n = w * h, G = new Float32Array(n).fill(Infinity), came = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
    const heap = [], gx = g % w, gy = (g / w) | 0;
    const hf = k => { const dx = Math.abs(k % w - gx), dy = Math.abs(((k / w) | 0) - gy); return (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)); };
    const push = (f, k) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, rr = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const ok = k => {
      if (clear[k] < r) return false;
      if (!block) return true;
      const x = ((k % w) + 0.5) * RES, y = (((k / w) | 0) + 0.5) * RES;
      return Math.hypot(x - ax, y - ay) < 0.45 || !block(x, y); // let the agent leave its own spot
    };
    G[s] = 0; push(hf(s), s);
    const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    let found = false;
    while (heap.length) {
      const [, k] = pop();
      if (closed[k]) continue; closed[k] = 1;
      if (k === g) { found = true; break; }
      const i = k % w, j = (k / w) | 0;
      for (const [di, dj, c] of N8) {
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const nk = nj * w + ni; if (closed[nk] || !ok(nk)) continue;
        if (di && dj && (!ok(j * w + ni) || !ok(nj * w + i))) continue;
        const ng = G[k] + c * (1 + 3 * Math.max(0, 0.75 - clear[nk])); if (ng < G[nk]) { G[nk] = ng; came[nk] = k; push(ng + hf(nk), nk); }
      }
    }
    if (!found) { if (key) this.memo.set(key, null); return null; }
    const raw = []; for (let k = g; k !== -1; k = came[k]) raw.push([((k % w) + 0.5) * RES, (((k / w) | 0) + 0.5) * RES]);
    raw.reverse(); raw[0] = [ax, ay]; raw[raw.length - 1] = [bx, by];
    const out = [raw[0]]; let i = 0;  // string-pulling against clearance
    while (i < raw.length - 1) {
      let j = raw.length - 1;
      while (j > i + 1 && !this.lineClear(raw[i][0], raw[i][1], raw[j][0], raw[j][1], r + 0.15, block)) j--;
      out.push(raw[j]); i = j;
    }
    if (key) this.memo.set(key, out.map(p => p.slice()));
    return out;
  }
  center(name) { const o = this.obstacles.find(o => o.name === name); return o ? [(o.minX + o.maxX) / 2, (o.minY + o.maxY) / 2] : null; }
}

const pathLen = p => { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; };

// ---- agents ------------------------------------------------------------------------------------
class Human {
  constructor(id, x, y, speed, steps) {
    Object.assign(this, { id, x, y, speed, steps, si: 0, r: HUMAN_R, vx: 0, vy: 0, heading: 0, path: null, pi: 0, pauseT: 0, blocked: 0, avoid: new Map(), standing: false });
  }
}

class Robot {
  constructor(id, sim, home, tables) {
    Object.assign(this, { id, sim, x: home[0], y: home[1], home, tables, ti: 0, heading: -Math.PI / 2, v: 0, r: ROBOT_R,
      task: 'idle', idleT: 1.5, path: null, samples: [], si: 0, goTo: null, mem: {}, label: 'IDLE', signal: { led: 'white', floor: 'none', screen: '', sound: 'none' },
      sense: { dist: 99, oncoming: false, standing: false, narrow: false, crowd: 0, goal: 99, seated: 0 }, trail: [], stall: 0, travel: [], dispatchT: 0, stateT: 0,
      table: null, tableCenter: null, replan: false, soundT: 0, values: {}, chosen: null, sigNode: null });
  }
  get maxSpeed() { return this.sim.params.robotSpeed; }
  setPath(p) {
    this.path = p; this.samples = []; this.si = 0;
    if (!p) return;
    let s = 0;
    for (let i = 1; i < p.length; i++) {
      const [ax, ay] = p[i - 1], [bx, by] = p[i], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 0.1));
      for (let k = 0; k < n; k++) { const t = k / n; const x = ax + (bx - ax) * t, y = ay + (by - ay) * t; this.samples.push([x, y, s + L * t, this.sim.grid.narrow(x, y)]); }
      s += L;
    }
    const [lx, ly] = p[p.length - 1]; this.samples.push([lx, ly, s, this.sim.grid.narrow(lx, ly)]);
  }
  lookAhead(d) {
    if (!this.samples.length) return [this.x + Math.cos(this.heading), this.y + Math.sin(this.heading)];
    const s0 = this.samples[this.si][2];
    for (let i = this.si; i < this.samples.length; i++) if (this.samples[i][2] - s0 >= d) return this.samples[i];
    return this.samples[this.samples.length - 1];
  }
  remaining() {
    if (!this.samples.length) return 0;
    const last = this.samples[this.samples.length - 1], cur = this.samples[this.si];
    return last[2] - cur[2] + Math.hypot(cur[0] - this.x, cur[1] - this.y);
  }
  homeLook() { const p = this.sim.grid.path(this.x, this.y, this.home[0], this.home[1], ROBOT_R); return p && p.length > 1 ? p[1] : this.home; }
}

// ---- simulation --------------------------------------------------------------------------------
export class Sim {
  constructor({ grid, scenario, params, graph, seed = 1 }) {
    Object.assign(this, { grid, sc: scenario, params, graph, rand: rng(seed), t: 0, dt: DT, humans: [], robots: [], near: 0, changes: 0,
      nearSet: new Set(), sounds: [], soundCount: 0, done: false, firstEvent: null });
    let hid = 0;
    const { POI, HOMES, SEATED } = grid.space;
    const speed = () => 1.05 + this.rand() * 0.3;
    for (const h of scenario.humans) {
      const sp = speed(); // always draw, so optional overrides don't shift the random sequence
      const hu = new Human(hid++, h.at[0], h.at[1], h.speed ?? sp, h.steps.map(s => ({ ...s })));
      hu.seated = !!h.sit; hu.scale = h.scale || 1; if (h.heading !== undefined) hu.heading = h.heading;
      this.humans.push(hu);
    }
    const wander = (n, pois) => {
      for (let i = 0; i < n; i++) {
        const start = POI[pois[(this.rand() * pois.length) | 0]];
        const [x, y] = grid.nearestWalkable(start[0] + (this.rand() - 0.5), start[1] + (this.rand() - 0.5) * 0.4, HUMAN_R);
        this.humans.push(new Human(hid++, x, y, speed(), [{ wander: pois, pause: 0.5 + this.rand() * 2 }]));
      }
    };
    wander(scenario.bgCount ?? params.humanCount, scenario.bgPOI || Object.keys(POI)); // background walkers stay off the scenario's key spot
    if (scenario.crowd) wander(scenario.crowd, scenario.crowdPOI);
    if (scenario.kids) for (const k of this.humans.slice(-scenario.kids)) { k.speed = 1.8; k.scale = 0.72; } // last wanderers become running kids
    for (let i = 0; i < params.robotCount; i++) {
      const [hx, hy] = grid.nearestWalkable(...HOMES[i], ROBOT_R);
      this.robots.push(new Robot(i, this, [hx, hy], scenario.tables[i]));
    }
    this.seated = SEATED.map(n => grid.center(n)).filter(Boolean);
  }

  dispatch(r) {
    const name = r.tables[r.ti % r.tables.length]; r.ti++;
    const goal = this.grid.space.SERVE[name] || this.grid.center(name);
    r.table = name; r.tableCenter = this.grid.center(name); r.task = 'toTable'; r.dispatchT = this.t; r.mem = {};
    r.goal = goal; r.setPath(this.grid.path(r.x, r.y, goal[0], goal[1], ROBOT_R));
  }
  arrived(r) { r.travel.push(this.t - r.dispatchT); }
  sendHome(r) { r.task = 'home'; r.goal = r.home; r.setPath(this.grid.path(r.x, r.y, r.home[0], r.home[1], ROBOT_R)); }

  pocketFor(r) { // where to step aside before the upcoming narrow segment
    // corridor axis = first narrow sample → 1 m further in; pocket = beside the mouth, clear of that axis line
    const g = this.grid;
    let k = r.samples.findIndex((s, i) => i >= r.si && s[3]);
    let mouth, inner;
    if (k >= 0 && !g.narrow(r.x, r.y)) { mouth = r.samples[k]; inner = r.samples[Math.min(r.samples.length - 1, k + 10)]; }
    else { // already inside: walk back along the trail to the mouth
      const i = r.trail.findLastIndex(p => !g.narrow(...p));
      mouth = i >= 0 ? r.trail[i] : [r.x, r.y]; inner = [r.x, r.y];
    }
    let ax = inner[0] - mouth[0], ay = inner[1] - mouth[1]; const L = Math.hypot(ax, ay) || 1; ax /= L; ay /= L;
    let best = null, bestScore = -1;
    for (const back of [0.9, 1.2, 1.5]) for (const side of [1, -1]) for (let o = 0.6; o <= 1.6; o += 0.1) {
      const x = mouth[0] - ax * back - ay * o * side, y = mouth[1] - ay * back + ax * o * side;
      if (!g.walkable(x, y, ROBOT_R + 0.05)) continue;
      const score = o - back * 0.3 - Math.hypot(x - r.x, y - r.y) * 0.1;
      if (score > bestScore) { bestScore = score; best = [x, y]; }
    }
    return best || [mouth[0] - ax * 1.2, mouth[1] - ay * 1.2];
  }

  detourPath(r) {
    const h = this.blockerOf(r);
    if (!h || !r.goal) return null;
    const alt = this.grid.path(r.x, r.y, r.goal[0], r.goal[1], ROBOT_R, (x, y) => Math.hypot(x - h.x, y - h.y) < 0.9);
    if (!alt || pathLen(alt) > r.remaining() + 18) return null;
    return alt;
  }
  blockerOf(r) { return r.sense.agent || null; }

  agentsFor(r) { return [...this.humans.filter(h => !h.seated), ...this.robots.filter(o => o !== r)]; }

  senseRobot(r) {
    const s = r.sense, g = this.grid;
    const a = r.lookAhead(0.6), ux0 = a[0] - r.x, uy0 = a[1] - r.y, L = Math.hypot(ux0, uy0);
    const ux = L > 0.01 ? ux0 / L : Math.cos(r.heading), uy = L > 0.01 ? uy0 / L : Math.sin(r.heading);
    const ahead = r.samples.slice(r.si, r.si + 40); // next ~4 m of path
    s.dist = 99; s.agent = null; s.standing = false; s.crowd = 0; s.oncoming = false;
    for (const o of this.agentsFor(r)) {
      const dx = o.x - r.x, dy = o.y - r.y, d = Math.hypot(dx, dy), gap = d - r.r - o.r;
      if (d < 2 && o instanceof Human) s.crowd++;
      if (d > 6) continue;
      const fwd = dx * ux + dy * uy, lat = Math.abs(-dx * uy + dy * ux);
      let inPath = fwd > 0 && lat < r.r + o.r + 0.2;
      if (!inPath && fwd > -0.2) for (const p of ahead) if (Math.hypot(p[0] - o.x, p[1] - o.y) < r.r + o.r + 0.1) { inPath = true; break; }
      if (inPath && gap < s.dist) { s.dist = Math.max(0, gap); s.agent = o; s.standing = Math.hypot(o.vx, o.vy) < 0.1; }
    }
    // narrow: inside, or entering within 2 m along the path
    const narrowIdx = r.samples.findIndex((p, i) => i >= r.si && p[3]);
    s.narrow = g.narrow(r.x, r.y) || (narrowIdx >= 0 && r.samples[narrowIdx][2] - (r.samples[r.si]?.[2] || 0) < 2);
    if (narrowIdx >= 0) { // someone walking toward us inside that narrow segment
      const seg = r.samples.slice(Math.max(r.si, narrowIdx), narrowIdx + 80).filter(p => p[3]);
      for (const h of this.humans) {
        if (!g.narrow(h.x, h.y) && Math.hypot(h.x - r.x, h.y - r.y) > 2.5) continue;
        const toR = [r.x - h.x, r.y - h.y], dd = Math.hypot(...toR) || 1;
        if ((h.vx * toR[0] + h.vy * toR[1]) / dd < 0.3) continue;
        if (seg.some(p => Math.hypot(p[0] - h.x, p[1] - h.y) < 0.6)) { s.oncoming = true; break; }
      }
    }
    s.goal = r.task === 'toTable' ? r.remaining() : 99;
    // guests sitting within 1.7 m (about one aisle away; table seats + seated scenario guests): someone may stand up into the aisle
    s.seated = this.seated.filter(([x, y]) => Math.hypot(x - r.x, y - r.y) < 1.7).length + this.humans.filter(h => h.seated && Math.hypot(h.x - r.x, h.y - r.y) < 1.7).length;
  }

  stepRobot(r) {
    const dt = this.dt;
    if (r.task === 'idle') { r.label = 'IDLE'; if ((r.idleT -= dt) <= 0) this.dispatch(r); else { r.v = 0; this.emitSignal(r, null); return; } }
    if (r.replan && r.goal) { r.setPath(this.grid.path(r.x, r.y, r.goal[0], r.goal[1], ROBOT_R)); r.replan = false; }
    // advance progress along path
    for (let i = r.si; i < Math.min(r.samples.length, r.si + 30); i++) if (Math.hypot(r.samples[i][0] - r.x, r.samples[i][1] - r.y) < Math.hypot(r.samples[r.si][0] - r.x, r.samples[r.si][1] - r.y)) r.si = i;
    this.senseRobot(r);
    const ev = evaluate(this.graph, r, this);
    r.values = ev.values; r.chosen = ev.chosen; r.sigNode = ev.sigNode;
    const act = r.act = ev.act || {};
    let label = act.label || (r.task === 'home' ? 'HOME' : 'CRUISE');
    let speed = act.speed ?? r.maxSpeed;
    speed = Math.min(speed, ev.cap ?? 99, r.maxSpeed);
    if (r.task === 'home' && r.remaining() < 0.1) { r.task = 'idle'; r.idleT = 2; r.v = 0; label = 'IDLE'; }
    if (r.task === 'toTable' && r.remaining() < 0.08 && !(r.chosen?.type === 'serve')) { // graph without a serve node: plain stop & go
      r.mem._fb = r.mem._fb || { t: 0 }; if ((r.mem._fb.t += dt) === dt) this.arrived(r);
      speed = 0; label = 'SERVE'; if (r.mem._fb.t > 4) { r.mem._fb = null; this.sendHome(r); }
    }
    // target point
    let target = act.goTo || r.lookAhead(0.4);
    if (act.face) target = act.face;
    // bumper: never drive into someone
    if (r.sense.dist < 0.06 && !act.goTo) speed = 0;
    if (act.face) speed = 0;
    const want = Math.atan2(target[1] - r.y, target[0] - r.x);
    let diff = Math.atan2(Math.sin(want - r.heading), Math.cos(want - r.heading));
    if (Math.hypot(target[0] - r.x, target[1] - r.y) > 0.05) r.heading += Math.max(-2.5 * dt, Math.min(2.5 * dt, diff));
    if (Math.abs(diff) > 0.9) speed = Math.min(speed, 0.08);
    if (speed < r.v) r.v = act.hard ? speed : Math.max(speed, r.v - 1.0 * dt);
    else r.v = Math.min(speed, r.v + 0.6 * dt);
    const nx = r.x + Math.cos(r.heading) * r.v * dt, ny = r.y + Math.sin(r.heading) * r.v * dt;
    if (this.grid.walkable(nx, ny, ROBOT_R - 0.08)) { r.x = nx; r.y = ny; } else r.v = 0;
    const lt = r.trail[r.trail.length - 1];
    if (!lt || Math.hypot(lt[0] - r.x, lt[1] - r.y) > 0.2) { r.trail.push([r.x, r.y]); if (r.trail.length > 200) r.trail.shift(); }
    if (r.task !== 'idle' && label !== 'SERVE' && r.v < 0.05) r.stall += dt;
    if (label !== r.label) { r.label = label; r.stateT = 0; if (!this.firstEvent && r.id === 0 && ['WAIT', 'YIELD', 'DETOUR', 'DEPART'].includes(label) && this.t > 2) this.firstEvent = { t: this.t, label }; }
    else r.stateT += dt;
    this.emitSignal(r, ev.signal);
  }

  emitSignal(r, sig) {
    sig = sig || { led: 'white', pattern: 'solid', floor: 'none', screen: '', sound: 'none', key: 'idle' };
    if (sig.screen) sig.screen = sig.screen.replace('{table}', (r.table || '').replace('Table_', '').replace(/^0/, ''));
    const changed = sig.key !== r.signal.key;
    r.signal = sig;
    if (changed) { r.soundT = 0; if (sig.sound !== 'none') { this.sounds.push({ robot: r.id, kind: sig.sound }); this.soundCount++; } }
    else if ((sig.sound === 'beepRepeat' && (r.soundT += this.dt) >= 2) || (sig.sound === 'voiceRepeat' && (r.soundT += this.dt) >= 3)) { r.soundT = 0; this.sounds.push({ robot: r.id, kind: sig.sound }); this.soundCount++; }
  }

  stepHuman(h) {
    const dt = this.dt, g = this.grid;
    // script
    const step = h.steps[h.si];
    let goal = null;
    if (step) {
      if (step.exit) { h.gone = true; h.x = h.y = -50; h.vx = h.vy = 0; h.si++; return; } // left the restaurant
      if (step.stand !== undefined) { if (this.t >= step.stand) h.si++; }
      else if (step.pause !== undefined && !step.wander) { if ((h.pauseT += dt) >= step.pause) { h.pauseT = 0; h.si++; } }
      else if (step.to || step.wander) {
        h.seated = false; // a seated guest gets up when their first walk starts
        if (!h.path) {
          const POI = g.space.POI;
          const to = step.to ? (typeof step.to === 'string' ? POI[step.to] : step.to) : POI[step.wander[(this.rand() * step.wander.length) | 0]];
          h.path = g.path(h.x, h.y, to[0] + (step.wander ? (this.rand() - 0.5) * 0.6 : 0), to[1], HUMAN_R + 0.03) || g.path(h.x, h.y, to[0], to[1], HUMAN_R - 0.03); h.pi = 1;
          if (!h.path) h.path = [[h.x, h.y]];
        }
        if (h.pi >= h.path.length) {
          if (step.wander) { if ((h.pauseT += dt) >= step.pause) { h.pauseT = 0; h.path = null; } }
          else { h.path = null; h.si++; }
        } else goal = h.path[h.pi];
      }
    }
    if (!goal) { h.vx = h.vy = 0; h.standing = true; return; }
    h.standing = false;
    let dx = goal[0] - h.x, dy = goal[1] - h.y; const d = Math.hypot(dx, dy);
    if (d < 0.15) { h.pi++; return; }
    dx /= d; dy /= d;
    let speed = h.speed, steerX = dx, steerY = dy;
    // react to robots: farther when the robot shows its intent on the floor
    for (const r of this.robots) {
      const rx = r.x - h.x, ry = r.y - h.y, rd = Math.hypot(rx, ry), gap = rd - r.r - h.r;
      const aware = r.signal.floor && r.signal.floor !== 'none' ? 2.0 : 0.9;
      const front = (rx * dx + ry * dy) / (rd || 1);
      const lat = Math.abs(rx * dy - ry * dx);           // robot's offset from my walking line
      const st = h.avoid.get(r.id);
      if (gap < aware && front > 0.2 && lat < r.r + h.r + 0.35) {
        if (!st) {
          const px = -dy, py = dx;
          const side = g.clearAt(h.x + px * 0.6, h.y + py * 0.6) >= g.clearAt(h.x - px * 0.6, h.y - py * 0.6) ? 1 : -1;
          h.avoid.set(r.id, { side }); this.changes++;
        }
        const av = h.avoid.get(r.id);
        if (!g.walkable(h.x - dy * av.side * 0.35, h.y + dx * av.side * 0.35, HUMAN_R - 0.05)) av.side *= -1; // no room: other side
        const sd = av.side, w = Math.min(0.9, (aware - gap) / aware * 1.5 + 0.3);
        steerX = dx + -dy * sd * w; steerY = dy + dx * sd * w;
        if (gap < 0.12 && front > 0.5) {
          // face to face with a robot: after a moment, back off a little to open space
          if ((h.faceT = (h.faceT || 0) + dt / this.robots.length) > 1) { steerX = -rx / rd; steerY = -ry / rd; speed = 0.4; } else speed = 0;
        } else { h.faceT = 0; if (gap < 0.5) speed *= 0.5; }
      } else if (st && gap > aware + 0.8) h.avoid.delete(r.id);
    }
    // keep apart from other people
    for (const o of this.humans) {
      if (o === h) continue;
      const ox = h.x - o.x, oy = h.y - o.y, od = Math.hypot(ox, oy);
      if (od < 0.6 && od > 0.001) { steerX += ox / od * (0.6 - od) * 2; steerY += oy / od * (0.6 - od) * 2; }
    }
    const sl = Math.hypot(steerX, steerY) || 1; steerX /= sl; steerY /= sl;
    let nx = h.x + steerX * speed * dt, ny = h.y + steerY * speed * dt;
    const free = (x, y) => (g.walkable(x, y, HUMAN_R - 0.06) || !g.walkable(h.x, h.y, HUMAN_R - 0.06)) && this.robots.every(r => Math.hypot(r.x - x, r.y - y) > r.r + h.r - 0.02);
    let moved = true;
    if (!free(nx, ny)) {
      if (free(nx, h.y)) ny = h.y; else if (free(h.x, ny)) nx = h.x; else { nx = h.x; ny = h.y; moved = false; }
    }
    h.vx = (nx - h.x) / dt; h.vy = (ny - h.y) / dt; h.x = nx; h.y = ny;
    if (Math.hypot(h.vx, h.vy) > 0.05) h.heading = Math.atan2(h.vy, h.vx);
    // stuck (little progress for 3 s) → take another way around the robots
    if (!h.chk) h.chk = [h.x, h.y];
    h.blocked += dt;
    if (Math.hypot(h.x - h.chk[0], h.y - h.chk[1]) > 0.5) { h.chk = [h.x, h.y]; h.blocked = 0; }
    if (h.blocked > 3) {
      h.chk = [h.x, h.y];
      const end = h.path[h.path.length - 1];
      const alt = g.path(h.x, h.y, end[0], end[1], HUMAN_R, (x, y) => this.robots.some(r => Math.hypot(x - r.x, y - r.y) < r.r + h.r + 0.2));
      if (alt) { h.path = alt; h.pi = 1; this.changes++; }
      h.blocked = 0;
    }
  }

  step() {
    if (this.done) return;
    for (const h of this.humans) this.stepHuman(h);
    for (const r of this.robots) this.stepRobot(r);
    for (const r of this.robots) for (const h of this.humans) {
      if (h.seated) continue;
      const gap = Math.hypot(r.x - h.x, r.y - h.y) - r.r - h.r, key = r.id + ':' + h.id;
      if (gap < NEAR_GAP && !this.nearSet.has(key)) { this.nearSet.add(key); this.near++; }
      else if (gap > NEAR_GAP + 0.2) this.nearSet.delete(key);
    }
    this.t += this.dt;
    if (this.t >= this.sc.duration - 1e-6) this.done = true;
  }

  metrics() {
    const rs = this.robots;
    const travel = rs.reduce((a, r) => a + (r.travel[0] ?? Math.max(0, this.t - r.dispatchT)), 0) / rs.length;
    return { travel, stall: rs.reduce((a, r) => a + r.stall, 0) / rs.length, near: this.near, changes: this.changes, sounds: this.soundCount };
  }
}

// Fast-forward a full run without rendering (batch + test-mode pre-run).
export function runHeadless(opts) { const s = new Sim(opts); while (!s.done) s.step(); return s; }
