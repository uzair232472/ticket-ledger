/**
 * Workflow explorer engine (ported from flow.html). Renders the flowcharts into an SVG and wires the
 * controls found inside `root` by their data-fc attributes. It has no dependencies, so the same file is used
 * by the React page (WorkflowExplorer.jsx) and inlined into the standalone flow2.html.
 *
 * Shapes: terminal = ellipse, process = rectangle, input/output = parallelogram, decision = diamond.
 * Interactions: overall flow first; module nodes open their flow; Back / breadcrumbs / dropdown; play, pause,
 * next step, replay; zoom buttons, Fit, wheel zoom, drag to pan, two-finger pinch; reduced motion stops play.
 *
 * mountWorkflow(root, data) -> destroy()
 */
export function mountWorkflow(root, data) {
  const q = (name) => root.querySelector(`[data-fc="${name}"]`);
  const { flows, graphs, names, flowMap, layouts = {}, lanes, overallDescription } = data;

  const svg = q('svg');
  const select = q('select');
  const back = q('back');
  const play = q('play');
  const next = q('step');
  const crumbs = q('crumbs');
  const ns = 'http://www.w3.org/2000/svg';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const states = new Map(flows.map((f) => [f.id, { cursor: 0, phase: 0, playing: false, finished: false }]));
  const history = [];
  const cleanups = [];
  const on = (el, type, fn, opts) => {
    if (!el) return;
    el.addEventListener(type, fn, opts);
    cleanups.push(() => el.removeEventListener(type, fn, opts));
  };

  let selected = 'overall';
  let positions = new Map();
  let nodeEls = new Map();
  let edgeEls = [];
  let packet;
  let halo;
  let last = 0;
  let raf = 0;
  let destroyed = false;
  let bounds = { x: 0, y: 0, w: 1260, h: 620 };
  let camera = { ...bounds };
  let zoom = 1;
  let drag = null;
  let inspection = null;
  const pointers = new Map();
  let pinch = null;
  const dwell = 1500;
  const travel = 850;

  const current = () => states.get(selected);
  const graph = () => graphs.get(selected);
  const count = () => (selected === 'overall' ? graph().edges.length : graph().trace.length);
  const activeNode = () => (selected === 'overall' ? graph().edges[current().cursor].from : graph().trace[current().cursor]);
  const activeEdge = () =>
    selected === 'overall'
      ? graph().edges[current().cursor]
      : graph().edges.find((e) => e.from === activeNode() && e.to === graph().trace[current().cursor + 1]);
  const make = (tag, attrs = {}) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  };
  const textEl = (label, attrs = {}) => {
    const el = make('text', attrs);
    el.textContent = label;
    return el;
  };

  // Dropdown: overall first, then one group per module area
  select.replaceChildren();
  const groups = new Map();
  for (const flow of flows) {
    let group = select;
    if (flow.id !== 'overall') {
      if (!groups.has(flow.group)) {
        const opt = document.createElement('optgroup');
        opt.label = flow.group;
        select.append(opt);
        groups.set(flow.group, opt);
      }
      group = groups.get(flow.group);
    }
    const opt = document.createElement('option');
    opt.value = flow.id;
    opt.textContent = flow.label + (flow.status ? ` (${flow.status})` : '');
    group.append(opt);
  }

  function renderCrumbs() {
    crumbs.replaceChildren();
    const entries = history.filter((e, i) => e.id !== 'overall' || i === 0);
    if (selected === 'overall') {
      const label = document.createElement('span');
      label.textContent = 'Overall flow';
      label.className = 'crumb-current';
      label.setAttribute('aria-current', 'page');
      crumbs.append(label);
      return;
    }
    const home = document.createElement('button');
    home.type = 'button';
    home.textContent = 'Overall';
    home.addEventListener('click', () => goHome());
    crumbs.append(home);
    const start = Math.max(0, entries.length - 2);
    entries.forEach((entry, i) => {
      if (entry.id === 'overall' || i < start) return;
      const sep = document.createElement('span');
      sep.textContent = '›';
      sep.className = 'crumb-ancestor';
      sep.setAttribute('aria-hidden', 'true');
      crumbs.append(sep);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'crumb-ancestor';
      btn.textContent = names[entry.id];
      btn.addEventListener('click', () => restoreAncestor(history.indexOf(entry)));
      crumbs.append(btn);
    });
    const sep = document.createElement('span');
    sep.textContent = '›';
    sep.setAttribute('aria-hidden', 'true');
    crumbs.append(sep);
    const label = document.createElement('span');
    label.className = 'crumb-current';
    label.textContent = names[selected];
    label.setAttribute('aria-current', 'page');
    crumbs.append(label);
  }

  function refreshNavigation() {
    const flow = flowMap.get(selected);
    select.value = selected;
    q('title').textContent = names[selected];
    q('basis').textContent = flow.basis;
    q('basis').title = flow.basis;
    const status = q('status');
    if (status) {
      status.textContent = flow.status || '';
      status.hidden = !flow.status;
    }
    back.disabled = selected === 'overall' && !history.length;
    back.title = history.length ? 'Back to ' + names[history[history.length - 1].id] : 'Back to overall flow';
    back.setAttribute('aria-label', back.title);
    q('branch-legend').textContent = selected === 'overall' ? '┄ Related / optional' : 'Yes / No = decision';
    renderCrumbs();
  }

  function openFlow(id, opts = {}) {
    if (!flowMap.has(id)) return;
    current().playing = false;
    if (opts.root) history.length = 0;
    else if (id !== selected) history.push({ id: selected, focusNode: opts.fromNode || null, camera: { ...camera }, zoom });
    selected = id;
    last = 0;
    inspection = null;
    current().playing = !reduced.matches && !current().finished;
    refreshNavigation();
    draw();
    update(true);
    if (opts.focus) q('title').focus({ preventScroll: true });
  }
  function goHome() {
    openFlow('overall', { root: true, focus: true });
  }
  function restoreAncestor(index) {
    if (index < 0 || index >= history.length) return;
    current().playing = false;
    const entry = history[index];
    history.splice(index);
    selected = entry.id;
    last = 0;
    inspection = null;
    current().playing = false;
    refreshNavigation();
    draw();
    if (entry.camera) {
      camera = { ...entry.camera };
      zoom = entry.zoom;
      applyCamera();
    }
    update(true);
    (nodeEls.get(entry.focusNode) || q('title')).focus({ preventScroll: true });
  }
  function goBack() {
    if (history.length) restoreAncestor(history.length - 1);
    else if (selected !== 'overall') goHome();
  }

  function update(announce = false) {
    const st = current();
    const g = graph();
    const id = activeNode();
    const node = g.nodes.find((n) => n.id === id);
    const edge = activeEdge();
    q('position').textContent = st.finished ? 'Complete' : (selected === 'overall' ? 'Connection ' : 'Step ') + (st.cursor + 1) + ' / ' + count();
    q('current').textContent = inspection ? inspection.label : selected === 'overall' ? names[edge.from] + ' → ' + names[edge.to] : node.label;
    q('detail').textContent = inspection ? inspection.detail : selected === 'overall' ? edge.detail : node.detail;
    q('detail').title = q('detail').textContent;
    play.textContent = st.finished ? 'Replay' : st.playing ? 'Pause' : 'Play';
    play.setAttribute('aria-label', st.finished ? 'Replay this flow' : st.playing ? 'Pause animation' : 'Play animation');
    next.textContent = st.cursor === count() - 1 ? 'Finish' : 'Next step →';
    next.disabled = st.finished;
    const visited = new Set(
      selected === 'overall'
        ? g.edges.slice(0, st.finished ? g.edges.length : st.cursor).flatMap((e) => [e.from, e.to])
        : st.finished
          ? g.trace
          : g.trace.slice(0, st.cursor),
    );
    for (const n of g.nodes) {
      const el = nodeEls.get(n.id);
      if (!el) continue;
      el.setAttribute(
        'class',
        'fc-node ' + n.kind + (n.status ? ' is-progress' : '') + (visited.has(n.id) ? ' visited' : '') +
          (!st.finished && (n.id === id || (selected === 'overall' && n.id === edge.to)) ? ' current' : ''),
      );
      if (!st.finished && n.id === id) el.setAttribute('aria-current', 'step');
      else el.removeAttribute('aria-current');
    }
    edgeEls.forEach(({ edge: e, path }) => {
      const at = selected === 'overall' ? g.edges.indexOf(e) : g.trace.indexOf(e.from);
      const follow = selected === 'overall' || (at >= 0 && g.trace[at + 1] === e.to);
      path.setAttribute('class', 'fc-edge' + (e.related ? ' related' : '') + (follow && (st.finished || at < st.cursor) ? ' visited' : '') + (!st.finished && e === edge ? ' active' : ''));
    });
    if (announce) q('live').textContent = names[selected] + '. ' + q('position').textContent + '. ' + q('current').textContent;
    movePacket();
  }

  function dimensions(n) {
    const size = selected === 'overall' ? { w: 178, h: 60 } : n.kind === 'terminal' ? { w: 156, h: 56 } : n.kind === 'decision' ? { w: 208, h: 108 } : { w: 194, h: n.target ? 84 : 78 };
    return { ...size, kind: n.kind };
  }

  function layout() {
    const g = graph();
    positions = new Map();
    if (selected === 'overall') {
      for (const n of g.nodes) positions.set(n.id, { x: n.x, y: n.y, ...dimensions(n) });
      return;
    }
    const fixed = layouts[selected];
    if (fixed) {
      for (const n of g.nodes) positions.set(n.id, { x: fixed[n.id][0], y: fixed[n.id][1], ...dimensions(n) });
      return;
    }
    g.trace.forEach((id, i) => {
      const row = Math.floor(i / 5);
      const col = row % 2 ? 4 - (i % 5) : i % 5;
      const n = g.nodes.find((m) => m.id === id);
      positions.set(id, { x: 130 + col * 250, y: 100 + row * 280, row, col, ...dimensions(n) });
    });
    for (const n of g.nodes) {
      if (positions.has(n.id)) continue;
      const edge = g.edges.find((e) => e.to === n.id && positions.has(e.from)) || g.edges.find((e) => e.from === n.id && positions.has(e.to));
      const anchor = positions.get(edge.to === n.id ? edge.from : edge.to);
      positions.set(n.id, { x: anchor.x, y: anchor.y + 132, row: anchor.row, col: anchor.col, ...dimensions(n) });
    }
  }

  function port(p, side) {
    if (side === 'top') return { x: p.x, y: p.y - p.h / 2 };
    if (side === 'bottom') return { x: p.x, y: p.y + p.h / 2 };
    const inset = p.kind === 'input' ? 6.5 : 0;
    if (side === 'left') return { x: p.x - p.w / 2 + inset, y: p.y };
    return { x: p.x + p.w / 2 - inset, y: p.y };
  }

  function edgeRoute(e, index) {
    const a = positions.get(e.from);
    const b = positions.get(e.to);
    const g = graph();
    let points;
    const P = (x, y) => ({ x, y });
    if (e.fromSide) {
      points = [port(a, e.fromSide), ...(e.via || []).map((v) => P(...v)), port(b, e.toSide)];
    } else if (selected === 'authentication' && e.route === 'return-left') {
      if (e.from === 'refresh-question') points = [port(a, 'right'), P(1286, a.y), P(1286, b.y), port(b, 'right')];
      else points = [port(a, 'top'), P(a.x, 418), P(1258, 418), P(1258, b.y), port(b, 'right')];
    } else if (e.route === 'return-right') {
      const bottom = a.y + a.h / 2 + 24 + (index % 3) * 7;
      const roof = b.y - b.h / 2 - 24;
      points = [port(a, 'bottom'), P(a.x, bottom), P(12 + (index % 3) * 8, bottom), P(12 + (index % 3) * 8, roof), P(b.x, roof), port(b, 'top')];
    } else if (g.trace.indexOf(e.to) === g.trace.indexOf(e.from) + 1 && g.trace.includes(e.from) && a.y !== b.y) {
      const rail = Math.max(a.x + a.w / 2, b.x + b.w / 2) + 32;
      points = [port(a, 'right'), P(rail, a.y), P(rail, b.y), port(b, 'right')];
    } else if (Math.abs(a.y - b.y) < 1) {
      const right = b.x > a.x;
      points = [port(a, right ? 'right' : 'left'), port(b, right ? 'left' : 'right')];
    } else if (Math.abs(a.x - b.x) < 1) {
      const down = b.y > a.y;
      points = [port(a, down ? 'bottom' : 'top'), port(b, down ? 'top' : 'bottom')];
    } else {
      const down = b.y > a.y;
      const p1 = port(a, down ? 'bottom' : 'top');
      const p2 = port(b, down ? 'top' : 'bottom');
      const mid = (p1.y + p2.y) / 2;
      points = [p1, P(p1.x, mid), P(p2.x, mid), p2];
    }
    // Remove zero-length legs; keep arrowheads and animation paths deterministic.
    points = points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
    let best = [points[0], points[1]];
    let length = -1;
    for (let i = 1; i < points.length; i++) {
      const n = Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
      if (n > length) {
        length = n;
        best = [points[i - 1], points[i]];
      }
    }
    const horizontal = best[0].y === best[1].y;
    let label = { x: (best[0].x + best[1].x) / 2 + (horizontal ? 0 : 9), y: (best[0].y + best[1].y) / 2 + (horizontal ? -7 : 4), anchor: horizontal ? 'middle' : 'start' };
    if (e.label === 'Yes' || e.label === 'No') {
      const p = points[0];
      const p2 = points[1];
      label = { x: p.x + (p.x === p2.x ? 10 : p2.x > p.x ? 18 : -18), y: p.y + (p.x === p2.x ? (p2.y > p.y ? 19 : -15) : -9), anchor: p.x === p2.x ? 'start' : 'middle' };
    }
    if (e.labelPos) label = e.labelPos;
    return { points, label, d: points.map((p, i) => (i ? 'L ' : 'M ') + p.x + ' ' + p.y).join(' ') };
  }

  const measure = document.createElement('canvas').getContext('2d');
  function wrapText(text, width, size) {
    if (measure) measure.font = '600 ' + size + "px 'Plus Jakarta Sans', system-ui, sans-serif";
    const measureWidth = (s) => (measure ? measure.measureText(s).width : s.length * size * 0.54);
    const lines = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
      const candidate = line ? line + ' ' + word : word;
      if (line && measureWidth(candidate) > width) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    return lines;
  }

  function draw() {
    const g = graph();
    layout();
    nodeEls = new Map();
    edgeEls = [];
    svg.replaceChildren();
    const title = make('title');
    title.textContent = flowMap.get(selected).label;
    svg.append(title);
    const desc = make('desc');
    desc.textContent = selected === 'overall' ? overallDescription : 'Animated flowchart. Yes and No label decision branches. Nodes marked Open flow open their own module. Use Back to return.';
    svg.append(desc);
    const defs = make('defs');
    const marker = make('marker', { id: 'fc-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto' });
    marker.append(make('path', { d: 'M 1 1 L 9 5 L 1 9 Z', class: 'fc-arrowhead' }));
    const glow = make('filter', { id: 'fc-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' });
    glow.append(make('feGaussianBlur', { stdDeviation: 6 }));
    defs.append(marker, glow);
    svg.append(defs);
    if (selected === 'overall' && lanes) {
      for (const [label, y] of lanes.labels) svg.append(textEl(label, { x: 21, y, class: 'lane-label' }));
      const [x1, y1, x2, y2] = lanes.line;
      svg.append(make('line', { x1, y1, x2, y2, class: 'lane-line' }));
    }
    const points = [];
    g.edges.forEach((e, i) => {
      const route = edgeRoute(e, i);
      const path = make('path', { d: route.d, class: 'fc-edge', 'marker-end': 'url(#fc-arrow)' });
      svg.append(path);
      edgeEls.push({ edge: e, path, points: route.points });
      points.push(...route.points);
      if (e.label) svg.append(textEl(e.label, { x: route.label.x, y: route.label.y, 'text-anchor': route.label.anchor, class: 'fc-edge-label' }));
    });
    for (const n of g.nodes) {
      const p = positions.get(n.id);
      const x = p.x - p.w / 2;
      const y = p.y - p.h / 2;
      points.push({ x: x - 16, y: y - 16 }, { x: x + p.w + 16, y: y + p.h + 16 });
      const el = make('g', {
        class: 'fc-node ' + n.kind,
        'data-node': n.id,
        role: n.target ? 'button' : 'group',
        'aria-label': n.target ? 'Open ' + flowMap.get(n.target).label + ' workflow' : n.label,
      });
      const tip = make('title');
      tip.textContent = n.label + (n.target ? ' — Open flow' : '') + '. ' + n.detail;
      el.append(tip);
      let shape;
      if (n.kind === 'terminal') shape = make('ellipse', { cx: p.x, cy: p.y, rx: p.w / 2, ry: p.h / 2 });
      else if (n.kind === 'decision') shape = make('polygon', { points: p.x + ',' + y + ' ' + (x + p.w) + ',' + p.y + ' ' + p.x + ',' + (y + p.h) + ' ' + x + ',' + p.y });
      else if (n.kind === 'input') shape = make('polygon', { points: x + 13 + ',' + y + ' ' + (x + p.w) + ',' + y + ' ' + (x + p.w - 13) + ',' + (y + p.h) + ' ' + x + ',' + (y + p.h) });
      else shape = make('rect', { x, y, width: p.w, height: p.h, rx: 2 });
      shape.setAttribute('class', 'shape');
      el.append(shape);
      const innerW = p.w * (n.kind === 'decision' ? 0.6 : n.kind === 'terminal' ? 0.8 : 0.87);
      const size = 15;
      const lines = wrapText(n.label, innerW, size);
      const lineHeight = 17;
      const offset = n.target ? 7 : 0;
      const label = make('text', { x: p.x, y: p.y - ((lines.length - 1) * lineHeight) / 2 - offset, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'node-label' });
      lines.forEach((line, i) => {
        const span = make('tspan', { x: p.x, dy: i ? lineHeight : 0 });
        span.textContent = line;
        label.append(span);
      });
      el.append(label);
      const targetStatus = n.target && flowMap.get(n.target)?.status;
      if (n.target) {
        el.setAttribute('tabindex', '0');
        el.setAttribute('data-target', n.target);
        el.append(textEl(targetStatus ? targetStatus + ' · Open ↗' : 'Open flow ↗', { x: p.x, y: p.y + ((lines.length - 1) * lineHeight) / 2 + 15, 'text-anchor': 'middle', class: 'node-open' + (targetStatus ? ' is-progress' : '') }));
        el.addEventListener('click', () => openFlow(n.target, { fromNode: n.id, focus: true }));
        el.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openFlow(n.target, { fromNode: n.id, focus: true });
          }
        });
      } else {
        el.addEventListener('click', () => {
          inspection = n;
          current().playing = false;
          update(true);
        });
      }
      svg.append(el);
      nodeEls.set(n.id, el);
    }
    halo = make('circle', { r: 11, class: 'fc-halo', 'aria-hidden': 'true', filter: 'url(#fc-glow)' });
    packet = make('circle', { r: 4.5, class: 'fc-packet', 'aria-hidden': 'true' });
    svg.append(halo, packet);
    const minX = Math.min(...points.map((pt) => pt.x)) - 16;
    const maxX = Math.max(...points.map((pt) => pt.x)) + 16;
    const minY = selected === 'overall' ? -4 : Math.min(...points.map((pt) => pt.y)) - 16;
    const maxY = Math.max(...points.map((pt) => pt.y)) + 30;
    bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    fit();
    update();
  }

  function applyCamera() {
    svg.setAttribute('viewBox', [camera.x, camera.y, camera.w, camera.h].join(' '));
    q('zoom-level').textContent = Math.round(zoom * 100) + '%';
    q('zoom-out').disabled = zoom <= 0.61;
    q('zoom-in').disabled = zoom >= 4.99;
  }
  function fit() {
    camera = { ...bounds };
    zoom = 1;
    applyCamera();
  }
  function zoomBy(factor, client) {
    const value = Math.max(0.6, Math.min(5, zoom * factor));
    const ratio = zoom / value;
    const center = client ? clientToDiagram(client.x, client.y) : { x: camera.x + camera.w / 2, y: camera.y + camera.h / 2 };
    camera = { x: center.x + (camera.x - center.x) * ratio, y: center.y + (camera.y - center.y) * ratio, w: camera.w * ratio, h: camera.h * ratio };
    zoom = value;
    applyCamera();
  }
  function clientToDiagram(x, y) {
    const r = svg.getBoundingClientRect();
    const scale = Math.min(r.width / camera.w, r.height / camera.h);
    return { x: camera.x + (x - r.left - (r.width - camera.w * scale) / 2) / scale, y: camera.y + (y - r.top - (r.height - camera.h * scale) / 2) / scale };
  }

  function movePacket() {
    if (!packet) return;
    const st = current();
    const id = activeNode();
    const p = positions.get(id);
    const edge = activeEdge();
    if (!p) return;
    let x = p.x;
    let y = p.y - p.h / 2;
    if (!reduced.matches && st.phase > dwell && edge) {
      const item = edgeEls.find((v) => v.edge === edge);
      if (item) {
        const t = Math.min(1, (st.phase - dwell) / travel);
        const ease = t * t * (3 - 2 * t);
        const point = item.path.getPointAtLength(item.path.getTotalLength() * ease);
        x = point.x;
        y = point.y;
      }
    }
    for (const el of [packet, halo]) {
      el.setAttribute('cx', x);
      el.setAttribute('cy', y);
      el.style.display = st.finished ? 'none' : '';
    }
  }
  function advance(announce = false) {
    const st = current();
    inspection = null;
    if (st.cursor < count() - 1) {
      st.cursor++;
      st.phase = 0;
    } else {
      st.finished = true;
      st.playing = false;
      st.phase = 0;
    }
    update(announce);
  }
  function tick(time) {
    if (destroyed) return;
    const dt = last ? Math.min(80, time - last) : 0;
    last = time;
    if (current().playing && !current().finished && !document.hidden) {
      const st = current();
      st.phase += dt;
      if (st.phase >= (activeEdge() ? dwell + travel : dwell)) advance();
      movePacket();
    }
    raf = requestAnimationFrame(tick);
  }

  // ---------- Controls ----------
  on(back, 'click', goBack);
  on(q('home'), 'click', goHome);
  on(select, 'change', () => {
    if (select.value === 'overall') goHome();
    else if (select.value !== selected) openFlow(select.value, { focus: true });
  });
  on(play, 'click', () => {
    const st = current();
    inspection = null;
    if (st.finished) {
      st.cursor = 0;
      st.phase = 0;
      st.finished = false;
    }
    st.playing = !st.playing;
    last = 0;
    update(true);
  });
  on(next, 'click', () => {
    current().playing = false;
    advance(true);
  });
  on(q('zoom-in'), 'click', () => zoomBy(1.25));
  on(q('zoom-out'), 'click', () => zoomBy(0.8));
  on(q('fit'), 'click', fit);

  // Drag to pan (mouse, pen or one finger); two fingers pinch to zoom
  on(svg, 'pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.fc-node')) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    svg.setPointerCapture(event.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      drag = null;
      return;
    }
    const r = svg.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, camera: { ...camera }, scale: Math.min(r.width / camera.w, r.height / camera.h) };
    svg.classList.add('is-dragging');
  });
  on(svg, 'pointermove', (event) => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.dist > 0) zoomBy((pinch.zoom * (dist / pinch.dist)) / zoom, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      return;
    }
    if (!drag || event.pointerId !== drag.id) return;
    camera.x = drag.camera.x - (event.clientX - drag.x) / drag.scale;
    camera.y = drag.camera.y - (event.clientY - drag.y) / drag.scale;
    applyCamera();
  });
  const endDrag = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    drag = null;
    svg.classList.remove('is-dragging');
  };
  on(svg, 'pointerup', endDrag);
  on(svg, 'pointercancel', endDrag);
  on(svg, 'lostpointercapture', endDrag);
  on(svg, 'wheel', (event) => {
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, { x: event.clientX, y: event.clientY });
  }, { passive: false });
  const onReduced = () => {
    if (reduced.matches) {
      current().playing = false;
      update();
    }
  };
  reduced.addEventListener?.('change', onReduced);
  cleanups.push(() => reduced.removeEventListener?.('change', onReduced));
  on(document, 'visibilitychange', () => {
    last = 0;
  });

  openFlow('overall', { root: true });
  raf = requestAnimationFrame(tick);

  return function destroy() {
    destroyed = true;
    cancelAnimationFrame(raf);
    cleanups.forEach((fn) => fn());
  };
}
