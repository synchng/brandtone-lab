// Behavior node graph: node type definitions, default graphs (A = 기존, B = 디자인), and per-tick evaluation.
// A graph is plain data { nodes:[{id,type,x,y,p}], links:[{from:[id,sock],to:[id,sock]}] } so it can be edited and saved.

export const SOCK_COLOR = { float: '#A1A1A6', bool: '#FF6FA8', motion: '#30D158', state: '#64D2FF' };
export const CAT_COLOR = { input: '#0A84FF', logic: '#BF5AF2', behavior: '#30D158', signal: '#FF9F0A', output: '#E5E5EA' };

export const STATE_LABEL = {
  IDLE: '대기 위치', CRUISE: '주행', HOME: '복귀', CAUTION: '감속', WAIT: '대기', YIELD: '양보',
  DETOUR: '우회', ARRIVE: '도착 중', SERVE: '서빙', DEPART: '출발',
};

const LED = [['white', '흰색'], ['amber', '호박색'], ['green', '초록'], ['red', '빨강'], ['off', '끔']];
const PATTERN = [['solid', '상시'], ['blink', '천천히 깜빡임'], ['fast', '빠르게 깜빡임']];
const FLOOR = [['none', '없음'], ['path', '진행 경로'], ['stop', '정지선'], ['arrow', '방향 화살표'], ['clear', '길 비켜주기']];
const SOUND = [['none', '없음'], ['chime', '차임 1회'], ['soft', '부드러운 알림'], ['beep', '비프 1회'], ['beepRepeat', '비프 반복'], ['voiceRepeat', '음성 반복']];

const behavior = (title, desc, params, extra) => ({
  title, desc, cat: 'behavior', ins: [['go', '트리거', 'bool']], outs: [['motion', '동작', 'motion'], ['state', '상태', 'state']],
  params, ...extra,
});

// ev(get, P, ctx) returns outputs; behaviors also define act(ctx, P) used only when chosen by the output node.
export const TYPES = {
  sensor: {
    title: '사람 감지', desc: '앞쪽 사람과의 거리, 맞은편에서 오는 사람', cat: 'input', ins: [],
    outs: [['dist', '거리', 'float'], ['oncoming', '맞은편 접근', 'bool'], ['standing', '멈춰 선 사람', 'bool']], params: [],
    ev: (get, P, { robot }) => ({ dist: robot.sense.dist, oncoming: robot.sense.oncoming, standing: robot.sense.standing }),
  },
  zone: {
    title: '공간 구역', desc: '좁은 통로 여부, 주변 혼잡도, 목적지까지 거리, 옆에 앉은 손님 수', cat: 'input', ins: [],
    outs: [['narrow', '좁은 통로', 'bool'], ['crowd', '혼잡도', 'float'], ['goal', '목적지까지', 'float'], ['seated', '앉은 손님', 'float']], params: [],
    ev: (get, P, { robot }) => ({ narrow: robot.sense.narrow, crowd: robot.sense.crowd, goal: robot.sense.goal, seated: robot.sense.seated }),
  },
  compare: {
    title: '비교', desc: '값이 기준보다 작거나 큰지', cat: 'logic', ins: [['v', '값', 'float']], outs: [['out', '결과', 'bool']],
    params: [{ k: 'op', label: '조건', type: 'select', options: [['lt', '보다 작음'], ['gt', '보다 큼']] },
             { k: 'ref', label: '기준', type: 'number', step: 0.1, link: true }],
    ev: (get, P) => ({ out: P('op') === 'gt' ? get('v') > P('ref') : get('v') < P('ref') }),
  },
  and: {
    title: '모두 참 (AND)', desc: '연결된 입력이 모두 참일 때', cat: 'logic',
    ins: [['a', 'A', 'bool'], ['b', 'B', 'bool'], ['c', 'C', 'bool']], outs: [['out', '결과', 'bool']], params: [],
    defaults: { a: true, b: true, c: true },
    ev: get => ({ out: !!(get('a') && get('b') && get('c')) }),
  },
  or: {
    title: '하나라도 참 (OR)', desc: '입력 중 하나라도 참일 때', cat: 'logic',
    ins: [['a', 'A', 'bool'], ['b', 'B', 'bool']], outs: [['out', '결과', 'bool']], params: [],
    ev: get => ({ out: !!(get('a') || get('b')) }),
  },
  not: {
    title: '반대 (NOT)', desc: '참/거짓을 뒤집어요', cat: 'logic', ins: [['a', '입력', 'bool']], outs: [['out', '결과', 'bool']], params: [],
    ev: get => ({ out: !get('a') }),
  },
  timer: {
    title: '시간 경과', desc: '조건이 지정한 시간 동안 계속되면 참', cat: 'logic', ins: [['c', '조건', 'bool']], outs: [['out', '결과', 'bool']],
    params: [{ k: 'sec', label: '시간', type: 'number', step: 0.5, unit: 's', link: true }],
    ev: (get, P, { mem, dt }) => { mem.held = get('c') ? (mem.held || 0) + dt : 0; return { out: mem.held >= P('sec') }; },
  },
  slow: {
    title: '감속', desc: '사람에게 가까워질수록 천천히', cat: 'behavior', ins: [['dist', '거리', 'float']],
    outs: [['motion', '동작', 'motion'], ['state', '상태', 'state']],
    params: [{ k: 'from', label: '시작 거리', type: 'number', step: 0.1, unit: 'm', link: true },
             { k: 'to', label: '최소 거리', type: 'number', step: 0.1, unit: 'm', link: true }],
    active: (get, P) => get('dist') < P('from'),
    act: ({ robot, get }, P) => {
      const k = (get('dist') - P('to')) / Math.max(0.05, P('from') - P('to'));
      return { speed: robot.maxSpeed * Math.min(1, Math.max(0.15, k)), label: 'CAUTION' };
    },
  },
  wait: behavior('대기', '멈추고 기다려요', [{ k: 'stop', label: '정지 방식', type: 'select', options: [['smooth', '부드럽게'], ['hard', '즉시']] }], {
    active: get => !!get('go'),
    act: (ctx, P) => ({ speed: 0, hard: P('stop') === 'hard', label: 'WAIT' }),
  }),
  yield: behavior('양보', '좁은 통로 앞에서 비켜서서 먼저 보내요', [{ k: 'delay', label: '재출발 지연', type: 'number', step: 0.5, unit: 's' }], {
    active: (get, P, { robot, sim, mem, dt }) => {
      if (get('go')) { if (!mem.on) { mem.on = true; mem.pocket = sim.pocketFor(robot); } mem.clearT = 0; }
      else if (mem.on && (mem.clearT = (mem.clearT || 0) + dt) >= P('delay')) { mem.on = false; robot.replan = true; }
      return !!mem.on;
    },
    act: ({ robot, mem }) => {
      const [px, py] = mem.pocket;
      const d = Math.hypot(px - robot.x, py - robot.y);
      if (d > 0.12) return { speed: Math.min(robot.maxSpeed, 0.4), goTo: mem.pocket, label: 'YIELD' };
      return { speed: 0, face: robot.lookAhead(1.5), label: 'YIELD' };
    },
  }),
  detour: behavior('우회', '막히면 방향을 먼저 알리고 다른 길로 가요', [{ k: 'notice', label: '출발 예고', type: 'number', step: 0.5, unit: 's' }], {
    active: (get, P, { robot, sim, mem, dt }) => {
      mem.cool = Math.max(0, (mem.cool || 0) - dt);
      if (!mem.on && get('go') && mem.cool <= 0) {
        const alt = sim.detourPath(robot);
        mem.cool = 3;
        if (alt) { mem.on = true; mem.t = 0; mem.alt = alt; }
      }
      if (mem.on && (mem.t += dt) >= P('notice')) { robot.setPath(mem.alt); mem.on = false; mem.cool = 4; }
      return !!mem.on;
    },
    act: ({ mem }) => ({ speed: 0, face: mem.alt[Math.min(3, mem.alt.length - 1)], label: 'DETOUR' }),
  }),
  serve: behavior('테이블 서빙', '도착 → 서빙 → 출발', [
    { k: 'decel', label: '감속 접근', type: 'toggle' },
    { k: 'align', label: '방향 정렬', type: 'toggle' },
    { k: 'notice', label: '출발 예고', type: 'number', step: 0.5, unit: 's' }], {
    active: (get, P, { robot, sim, mem, dt }) => {
      if (!mem.on && get('go') && robot.task === 'toTable') { mem.on = true; mem.phase = 'ARRIVE'; mem.t = 0; }
      if (!mem.on) return false;
      if (mem.phase === 'ARRIVE' && robot.sense.goal < 0.1) { mem.phase = 'SERVE'; mem.t = 0; mem.pick = 3 + sim.rand() * 2; sim.arrived(robot); }
      else if (mem.phase === 'SERVE' && (mem.t += dt) >= mem.pick) { mem.phase = 'DEPART'; mem.t = 0; }
      else if (mem.phase === 'DEPART' && (mem.t += dt) >= P('notice')) { mem.on = false; sim.sendHome(robot); }
      return !!mem.on;
    },
    act: ({ robot, mem }, P) => {
      if (mem.phase === 'ARRIVE') {
        const v = P('decel') ? Math.max(0.12, robot.maxSpeed * Math.min(1, robot.sense.goal / 1.2)) : robot.maxSpeed;
        return { speed: v, hard: !P('decel'), label: 'ARRIVE' };
      }
      if (mem.phase === 'SERVE') return { speed: 0, hard: true, face: P('align') ? robot.tableCenter : null, label: 'SERVE' };
      return { speed: 0, face: robot.homeLook(), label: 'DEPART' };
    },
  }),
  crowd: {
    title: '혼잡 모드', desc: '사람이 많으면 일정한 낮은 속도로', cat: 'behavior', ins: [['go', '트리거', 'bool']],
    outs: [['cap', '속도 상한', 'float'], ['state', '상태', 'state']],
    params: [{ k: 'cap', label: '상한', type: 'number', step: 0.05, unit: 'm/s' }],
    ev: (get, P, { id }) => ({ cap: get('go') ? P('cap') : 99, state: { node: id, active: !!get('go') } }),
  },
  signal: {
    title: '의도 표현', desc: 'LED · 바닥 · 화면 · 소리', cat: 'signal', ins: [['state', '상태', 'state']], outs: [],
    params: [{ k: 'led', label: 'LED', type: 'color', options: LED }, { k: 'pattern', label: '패턴', type: 'select', options: PATTERN },
             { k: 'floor', label: '바닥', type: 'select', options: FLOOR }, { k: 'screen', label: '화면', type: 'text' },
             { k: 'sound', label: '소리', type: 'select', options: SOUND }],
    ev: () => ({}),
  },
  output: {
    title: '로봇 출력', desc: '위에 있는 동작일수록 우선', cat: 'output',
    ins: [['m1', '우선 1', 'motion'], ['m2', '우선 2', 'motion'], ['m3', '우선 3', 'motion'], ['m4', '우선 4', 'motion'], ['m5', '우선 5', 'motion'], ['cap', '속도 상한', 'float']],
    outs: [], params: [{ k: 'cruiseLed', label: '주행 LED', type: 'color', options: LED }, { k: 'cruiseFloor', label: '주행 바닥', type: 'select', options: FLOOR }],
    ev: () => ({}),
  },
};
for (const t of Object.values(TYPES)) if (t.act && !t.ev) {
  t.ev = (get, P, ctx) => { const a = !!t.active(get, P, ctx); return { motion: { node: ctx.id, active: a }, state: { node: ctx.id, active: a } }; };
}

export const SOCK_DEFAULT = { float: 99, bool: false, motion: null, state: null };

export const LED_COLOR = { white: '#ffffff', amber: '#FF9F0A', green: '#34C759', red: '#FF453A', off: '#3a3a3c' };

// ---- default graphs ---------------------------------------------------------------------------
function build(nodes, links) {
  return { nodes: nodes.map(([id, type, x, y, p = {}]) => ({ id, type, x, y, p })), links: links.map(([a, b]) => ({ from: a.split('.'), to: b.split('.') })) };
}

export function designedGraph() {
  return build([
    ['sensor', 'sensor', 40, 40], ['zone', 'zone', 40, 300],
    ['narrowAnd', 'and', 320, 20], ['near', 'compare', 320, 200, { op: 'lt', ref: { param: 'personalDistance' } }],
    ['atTable', 'compare', 320, 400, { op: 'lt', ref: 1.2 }], ['busy', 'compare', 320, 580, { op: 'gt', ref: 2 }],
    ['held', 'timer', 580, 200, { sec: { param: 'waitingTime' } }],
    ['nearCalm', 'and', 580, 380], ['calm', 'not', 580, 580],
    ['yield', 'yield', 840, 0, { delay: 1 }], ['detour', 'detour', 840, 190, { notice: 1 }],
    ['wait', 'wait', 840, 380, { stop: 'smooth' }], ['serve', 'serve', 840, 540, { decel: true, align: true, notice: 1 }],
    ['slow', 'slow', 840, 760, { from: { param: 'yieldDistance' }, to: { param: 'personalDistance' } }],
    ['crowd', 'crowd', 840, 940, { cap: 0.35 }],
    ['sigYield', 'signal', 1120, 0, { led: 'green', pattern: 'solid', floor: 'clear', screen: '먼저 지나가세요', sound: 'chime' }],
    ['sigDetour', 'signal', 1120, 250, { led: 'amber', pattern: 'solid', floor: 'arrow', screen: '돌아서 갈게요', sound: 'soft' }],
    ['sigWait', 'signal', 1120, 500, { led: 'amber', pattern: 'blink', floor: 'stop', screen: '잠시 기다릴게요', sound: 'soft' }],
    ['sigServe', 'signal', 1120, 750, { led: 'green', pattern: 'solid', floor: 'arrow', screen: '{table}번 테이블 · 트레이를 가져가 주세요', sound: 'chime' }],
    ['sigSlow', 'signal', 1120, 1000, { led: 'amber', pattern: 'solid', floor: 'path', screen: '', sound: 'none' }],
    ['out', 'output', 1420, 380, { cruiseLed: 'white', cruiseFloor: 'path' }],
  ], [
    ['zone.narrow', 'narrowAnd.a'], ['sensor.oncoming', 'narrowAnd.b'], ['narrowAnd.out', 'yield.go'],
    ['sensor.dist', 'near.v'], ['near.out', 'held.c'], ['held.out', 'detour.go'],
    ['near.out', 'nearCalm.a'], ['busy.out', 'calm.a'], ['calm.out', 'nearCalm.b'], ['nearCalm.out', 'wait.go'], // crowded → keep creeping instead of stop-go
    ['zone.goal', 'atTable.v'], ['atTable.out', 'serve.go'], ['zone.crowd', 'busy.v'], ['busy.out', 'crowd.go'],
    ['sensor.dist', 'slow.dist'],
    ['serve.motion', 'out.m1'], ['yield.motion', 'out.m2'], ['detour.motion', 'out.m3'], ['wait.motion', 'out.m4'], ['slow.motion', 'out.m5'],
    ['crowd.cap', 'out.cap'],
    ['yield.state', 'sigYield.state'], ['detour.state', 'sigDetour.state'], ['wait.state', 'sigWait.state'],
    ['serve.state', 'sigServe.state'], ['slow.state', 'sigSlow.state'],
  ]);
}

export function baselineGraph() {
  return build([
    ['sensor', 'sensor', 40, 40], ['zone', 'zone', 40, 300],
    ['near', 'compare', 320, 40, { op: 'lt', ref: 0.3 }], ['atTable', 'compare', 320, 300, { op: 'lt', ref: 0.15 }],
    ['wait', 'wait', 580, 40, { stop: 'hard' }], ['serve', 'serve', 580, 280, { decel: false, align: false, notice: 0 }],
    ['sigWait', 'signal', 860, 0, { led: 'off', pattern: 'solid', floor: 'none', screen: '', sound: 'beepRepeat' }],
    ['sigServe', 'signal', 860, 260, { led: 'white', pattern: 'solid', floor: 'none', screen: '음식이 도착했습니다', sound: 'voiceRepeat' }],
    ['out', 'output', 1140, 120, { cruiseLed: 'white', cruiseFloor: 'none' }],
  ], [
    ['sensor.dist', 'near.v'], ['near.out', 'wait.go'], ['zone.goal', 'atTable.v'], ['atTable.out', 'serve.go'],
    ['serve.motion', 'out.m1'], ['wait.motion', 'out.m2'], ['wait.state', 'sigWait.state'], ['serve.state', 'sigServe.state'],
  ]);
}

// ---- evaluation -------------------------------------------------------------------------------
// Returns { chosen:{node,type}|null, act, cap, signal, values } for one robot at one tick.
export function evaluate(graph, robot, sim) {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const inLink = new Map(graph.links.map(l => [l.to.join('.'), l.from]));
  const outs = new Map();
  const values = {};
  const mems = robot.mem;

  const P = n => k => {
    const v = n.p[k];
    return v && typeof v === 'object' ? sim.params[v.param] : v;
  };
  const getter = n => k => {
    const src = inLink.get(n.id + '.' + k);
    if (!src) { const t = TYPES[n.type]; return t.defaults?.[k] ?? SOCK_DEFAULT[t.ins.find(i => i[0] === k)?.[2]] ?? null; }
    return run(byId.get(src[0]))?.[src[1]] ?? null;
  };
  function run(n) {
    if (!n) return null;
    if (outs.has(n.id)) return outs.get(n.id);
    outs.set(n.id, null); // cycle guard
    const t = TYPES[n.type];
    const mem = mems[n.id] || (mems[n.id] = {});
    const o = t.ev(getter(n), P(n), { robot, sim, mem, dt: sim.dt, id: n.id });
    outs.set(n.id, o);
    for (const [k, v] of Object.entries(o)) values[n.id + '.' + k] = v && typeof v === 'object' ? v.active : v;
    return o;
  }

  const out = graph.nodes.find(n => n.type === 'output');
  let chosen = null, cap = 99;
  if (out) {
    const get = getter(out);
    for (const k of ['m1', 'm2', 'm3', 'm4', 'm5']) { const m = get(k); if (!chosen && m?.active) chosen = m; } // evaluate all: keeps stateful nodes ticking
    cap = get('cap') ?? 99;
  }
  // nodes not reachable from output still tick (e.g. a timer being wired up) — cheap and avoids surprise
  for (const n of graph.nodes) run(n);

  let act = null, sigNode = null;
  if (chosen) {
    const n = byId.get(chosen.node);
    act = TYPES[n.type].act({ robot, sim, mem: mems[n.id], get: getter(n) }, P(n));
  }
  const stateSrc = chosen?.node ?? graph.nodes.find(n => n.type === 'crowd' && outs.get(n.id)?.state?.active)?.id;
  if (stateSrc) {
    const l = graph.links.find(l => l.from[0] === stateSrc && l.from[1] === 'state' && byId.get(l.to[0])?.type === 'signal');
    if (l) sigNode = byId.get(l.to[0]);
  }
  const op = out ? P(out) : () => undefined;
  const signal = sigNode ? { ...sigNode.p } : { led: op('cruiseLed') || 'white', pattern: 'solid', floor: op('cruiseFloor') || 'none', screen: '', sound: 'none' };
  signal.key = (chosen?.node || 'cruise') + ':' + (act?.label || '');
  return { chosen: chosen && { node: chosen.node, type: byId.get(chosen.node).type }, act, cap, signal, values, sigNode: sigNode?.id || null };
}
