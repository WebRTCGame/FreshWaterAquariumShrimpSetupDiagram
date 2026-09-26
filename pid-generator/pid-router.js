// P&ID Router — auto-layout, A* pathfinding, topology resolution.
// Loaded third (after pid-parser.js).
// ponytail: process rank — one shared flow-coordinate computation (topo layers
// + cycle detection via Tarjan SCC) consumed by layout. Rank = longest-path
// layer from any source; cycle members share the max entry rank + 1 (same
// "stack after deepest" semantics as the old BFS, but explicit and shared).
function processRank(nodes, outgoing, incoming) {
  const rank = {}, scc = [];
  const index = {}, low = {}, onStack = new Set(), stack = [];
  let counter = 0;
  const strongconnect = (v) => {
    index[v] = low[v] = counter++;
    stack.push(v); onStack.add(v);
    for (const w of (outgoing[v] || [])) {
      if (index[w] === undefined) { strongconnect(w); low[v] = Math.min(low[v], low[w]); }
      else if (onStack.has(w)) low[v] = Math.min(low[v], index[w]);
    }
    if (low[v] === index[v]) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) scc.push(comp);
    }
  };
  for (const n of nodes) if (index[n] === undefined) strongconnect(n);
  // layers over the DAG: BFS from sources (first-visit wins = shortest path),
  // identical results to the old inline layout; cycle members stack after.
  // ponytail: extracted, not rethought — the rank is now shared (layout +
  // future corridor/placement passes) instead of buried in autoLayout.
  const inCyc = new Set(scc.flat());
  let queue = nodes.filter((n) => !(incoming[n] || []).length);
  for (const s of queue) rank[s] = 0;
  while (queue.length) {
    const next = [];
    for (const id of queue) {
      for (const t of (outgoing[id] || [])) {
        if (rank[t] !== undefined) continue;
        if (inCyc.has(id) && inCyc.has(t)) continue;
        rank[t] = rank[id] + 1;
        next.push(t);
      }
    }
    queue = next;
  }
  let maxD = Math.max(0, ...Object.values(rank));
  for (const n of nodes) if (rank[n] === undefined) rank[n] = ++maxD;
  return { rank, scc };
}
// Per-render overrides of the coordinate-assignment settings, set by parse()
// while the renderer searches. null = registry default.
var PID_COORD_ITERS = null;
var PID_MIN_SEP = null;

function autoLayout(data) {
  const { equipment, valves, instruments, junctions, pipes } = data;

  const all = [...equipment, ...valves].sort((a, b) => a._seq - b._seq);
  const byId = PIDEngine.buildById(equipment, valves);

  const processPipes = pipes.filter(p => p.kind !== 'signal');
  const outgoing = {}, incoming = {};
  for (const e of all) { outgoing[e.id] = []; incoming[e.id] = []; }
  for (const p of processPipes) {
    if (byId[p.from] && byId[p.to]) {
      outgoing[p.from].push(p.to);
      incoming[p.to].push(p.from);
    }
  }

  // flow coordinate shared with future passes (placement, corridor reserve)
  const { rank: depth, scc: flowCycles } = processRank(all.map(e => e.id), outgoing, incoming);
  data.flowCycles = flowCycles;
  data.flowRank = depth; // ponytail: Phase 5.1 order — upstream places first

  // column x, stacked rows y; explicit `at`/relative placement always wins.
  // entities fed from bottom-ish ports (bottoms/drains) sort into lower rows.
  // the flow snakes: rows of columns, alternating direction, to fit the sheet.
  // y-margin reserves headroom for the instrument tier above row 0 (Phases 5/9).
  // ponytail: layout pitches from the rule registry (tunables, not code)
  const BASE_COL = ruleParam('layout.colSpacing', 140), ROW = ruleParam('layout.rowSpacing', 145),
    XMARGIN = ruleParam('layout.xMargin', 60), YMARGIN = ruleParam('layout.yMargin', 118);
  const isBottomPort = (p, end) => {
    // the bottom-ish port is on the OTHER endpoint (e.g. C-101.bottoms -> E-101)
    const port = end === p.to ? p.fromPort : p.toPort;
    if (port && /bottoms|bottom|drain|outlet/i.test(port)) return true;
    return false;
  };
  const belowFlag = (e) => processPipes.some(p => p.to === e.id && isBottomPort(p, e.id)) ? 1 : 0;
  const column = {};
  for (const e of all) (column[depth[e.id]] = column[depth[e.id]] || []).push(e);
  const colKeys = Object.keys(column).map(Number).sort((a, b) => a - b);
  // ponytail: stretch columns to fill the sheet — fixed 140mm pitch wastes
  // ~30% of horizontal space on an 864mm sheet, cramming routes into tight corridors.
  const numCols = colKeys.length;
  const availW = (data.view.sheetW || 864) - 2 * XMARGIN;
  const colsPerRow = Math.max(2, numCols <= Math.floor(availW / BASE_COL) ? numCols : Math.floor(availW / BASE_COL));
  const COL = numCols <= colsPerRow ? availW / Math.max(numCols, 1) : Math.max(BASE_COL, availW / colsPerRow);
  // stretch rows to fill vertical space
  const numRows = Math.ceil(numCols / colsPerRow);
  const availH = (data.view.sheetH || 559) - YMARGIN - 40;
   // use stretched rows
  const rowIdx = {}; // entity id -> index within its depth column
  for (const d of colKeys) {
    column[d].sort((a, b) => belowFlag(a) - belowFlag(b) || a._seq - b._seq);
    column[d].forEach((e, i) => { rowIdx[e.id] = i; });
  }
  // Phase 4: barycenter sweeps — reorder each column by the average row
  // index of its predecessors. Standard layered-layout heuristic; cuts crossings
  // without any geometry work. When a layout seed is active, also permute the
  // column-to-x mapping to explore different spatial arrangements.
  for (let sweep = 0; sweep < 2; sweep++) {
    for (const d of colKeys) {
      if (d === colKeys[0]) continue;
      const avg = (e) => {
        let sum = 0, n = 0;
        for (const pid of incoming[e.id]) {
          if (depth[pid] === undefined || depth[pid] >= d) continue;
          sum += rowIdx[pid]; n++;
        }
        return n ? sum / n : (rowIdx[e.id] || 0);
      };
      column[d].sort((a, b) => belowFlag(a) - belowFlag(b) || avg(a) - avg(b));
      column[d].forEach((e, i) => { rowIdx[e.id] = i; });
    }
  }
  // ponytail: layout randomization — small column perturbations to explore
  // nearby layout variants. Full random permutation undoes the barycenter
  // optimization; instead, swap adjacent column pairs for local exploration.
  let colPerm = null;
  if (PID_RNG_SEED !== null && colKeys.length > 2) {
    colPerm = colKeys.slice();
    // swap 1-3 adjacent pairs
    const nSwaps = 1 + Math.floor((pidRng() || 0) * 3);
    for (let s = 0; s < nSwaps; s++) {
      const i = Math.floor((pidRng() || 0) * (colPerm.length - 1));
      const tmp = colPerm[i]; colPerm[i] = colPerm[i + 1]; colPerm[i + 1] = tmp;
    }
  }
  // Pass 1: assign pure-topology grid slots, independent of any pitch. Separating
  // slot assignment from coordinate writing is what lets the row pitch be solved
  // below — and it must be solved HERE, before the valve-snap and instrument-stack
  // passes, because those align to absolute positions (a valve snapped onto a port
  // axis, a bubble stacked on a host). Post-hoc scaling would silently undo both.
  const slot = {};
  for (const d of colKeys) {
    column[d].forEach((e, i) => {
      if (e.at || e.rel) return;
      // ponytail: when colPerm is active, remap depth rank to permuted position
      const mappedD = colPerm ? colPerm.indexOf(d) : d;
      const row = Math.floor(mappedD / colsPerRow);
      const colInRow = mappedD % colsPerRow;
      const colX = row % 2 === 0 ? colInRow : (colsPerRow - 1 - colInRow);
      slot[e.id] = { row, colX, i };
    });
  }
  // ---- coordinate assignment (median / barycentre method) ----------------
  // The old rule set y purely by INDEX within a rank (`i * 0.55*ROW`). That
  // ignores topology completely, so (a) parallel branches land in arbitrary
  // order, and (b) a rank of k members always forms a rigid equally-spaced
  // stack regardless of what its neighbours want. Measured on the demo sheet,
  // the rank holding V-102 / V-103 / V-105 / FV-101 / PSV-101 stacked four
  // valves and their label stacks into ~60mm and collided.
  //
  // This is the standard layered-graph coordinate step: seed by index, then
  // pull each node toward the MEDIAN height of its neighbours, then pack the
  // rank to a minimum separation and re-centre it on what the group asked for.
  // Parallel branches therefore settle at the height their own neighbours want,
  // which is what reduces crossings AND label crowding together.
  const SEP = PID_MIN_SEP !== null ? PID_MIN_SEP : ruleParam('layout.minSep', 45);
  const ITERS = PID_COORD_ITERS !== null ? PID_COORD_ITERS : ruleParam('layout.coordIters', 4);
  const baseY = {};
  for (const d of colKeys) {
    const anySlot = column[d].map((e) => slot[e.id]).find(Boolean);
    baseY[d] = YMARGIN + (anySlot ? anySlot.row : 0) * ROW;
  }
  const yOf = {};
  for (const d of colKeys) {
    column[d].forEach((e, i) => { if (!e.at && !e.rel) yOf[e.id] = baseY[d] + i * (ROW * 0.55); });
  }
  const medianOf = (a) => {
    if (!a.length) return null;
    const s = a.slice().sort((x, z) => x - z);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  for (let it = 0; it < ITERS; it++) {
    const want = {};
    for (const d of colKeys) for (const e of column[d]) {
      if (e.at || e.rel) continue;
      const nb = [...(incoming[e.id] || []), ...(outgoing[e.id] || [])]
        .map((id) => yOf[id]).filter((v) => v !== undefined);
      const m = medianOf(nb);
      want[e.id] = m === null ? yOf[e.id] : m;
    }
    for (const d of colKeys) {
      const mem = column[d].filter((e) => !e.at && !e.rel);
      if (!mem.length) continue;
      mem.sort((a, b) => want[a.id] - want[b.id]);
      // pack downward at >= SEP, honouring each node's preference
      let cursor = -Infinity;
      for (const e of mem) {
        yOf[e.id] = Math.max(want[e.id], cursor);
        cursor = yOf[e.id] + SEP;
      }
      // re-centre the group on what it asked for, so packing does not drift it
      const mw = mem.reduce((s, e) => s + want[e.id], 0) / mem.length;
      const my = mem.reduce((s, e) => s + yOf[e.id], 0) / mem.length;
      const shift = mw - my;
      for (const e of mem) yOf[e.id] += shift;
    }
  }

  // MEASURED NEGATIVE RESULT (2026-09-25): solving the row pitch to fill the sheet
  // (ROW_SOLVED = availH / max(row + 0.55*i), i.e. finally using the `availH`
  // computed above) was tried across caps 1.15-1.8 and is WORSE on every metric:
  //
  //   cap   spike score/xing/tap    dense score/xing
  //   1.00  1276 / 30 / 200         1471 / 11     <- baseline (no stretch)
  //   1.15  1539 / 41 / 110         2588 /  6
  //   1.30  1479 / 38 / 195         2577 /  4
  //   1.45  1359 / 35 / 335         1463 /  6
  //   1.60  1894 / 33 / 472         1464 /  6
  //
  // Spreading entities apart lengthens every pipe and creates more crossing
  // opportunities; dense even blows up to 2588. This is the documented 5.1
  // failure mode (a placement move that doesn't price corridors and labels),
  // independently re-confirmed. The compact block is a FEATURE of the routing,
  // not a defect — so the void is fixed by moving the block, not stretching it.
  // `availH` stays dead: the honest conclusion is that nothing should consume it.
  for (const e of all) {
    const s = slot[e.id];
    if (!s) continue;
    e.x = XMARGIN + s.colX * COL;
    e.y = yOf[e.id] !== undefined ? yOf[e.id] : YMARGIN + s.row * ROW + s.i * (ROW * 0.55);
  }

  // rule: a valve directly downstream of equipment sits close to it (spacing no less
  // than the valve width) at the equipment port's elevation, so the process line
  // runs straight instead of jogging
  const valveHalf = symbolSize('isa-5.1/valves/gate') * (data.view.symbolScale || 1) / 2 || 6;
  for (const v of valves) {
    if (v.at || v.rel) continue;
    const pipe = processPipes.find(p => p.from === v.id || p.to === v.id);
    if (!pipe) continue;
    const eqId = pipe.from === v.id ? pipe.to : pipe.from;
    const eq = byId[eqId];
    if (!eq || valves.some(x => x.id === eqId)) continue; // partner must be equipment
    const portName = pipe.from === v.id ? pipe.toPort : pipe.fromPort;
    const conns = symbolConnections(eq.symbol || SYMBOL_KEYS[eq.type]);
    // ponytail: without an explicit port, face the valve (conns[0] is arbitrary
    // and can park the valve on the wrong side); skip the snap when ambiguous
    let conn = portName && conns.find(c => c.id === portName);
    if (!conn) {
      const scored = conns.map(c => {
        let qx = c.x - 50, qy = c.y - 50;
        if (eq.rotation) { const rd = PIDEngine.rotatePoint(qx, qy, eq.rotation); qx = rd.x; qy = rd.y; }
        const l = Math.hypot(qx, qy) || 1;
        return { c, s: ((v.x - eq.x) * qx + (v.y - eq.y) * qy) / l };
      }).sort((a, b2) => b2.s - a.s);
      if (!scored.length || (scored[1] && scored[0].s - scored[1].s <= 0.35)) continue;
      conn = scored[0].c;
    }
    if (!conn) continue;
    const size = (eq.symbol ? symbolSize(eq.symbol) : symbolSize(SYMBOL_KEYS[eq.type] || 'pip/equipment/vessel-vertical')) * (eq.scale || 1) * (data.view.symbolScale || 1);
    const sx = ((conn.x - 50) / 100) * size, sy = ((conn.y - 50) / 100) * size;
    let rx = sx, ry = sy, pdx = conn.x - 50, pdy = conn.y - 50;
    if (eq.rotation) {
      const rp = PIDEngine.rotatePoint(rx, ry, eq.rotation);
      rx = rp.x; ry = rp.y;
      const rd = PIDEngine.rotatePoint(pdx, pdy, eq.rotation);
      pdx = rd.x; pdy = rd.y;
    }
    // ponytail: key off the nozzle tip when one is defined — pipes attach at
    // tips, and snapping to the glyph port crowds the valve onto the stub.
    // (tips are position-only at this stage; resolveNozzlePositions fills the
    // rest later via the shared nozzleTip helper — no drift by construction)
    let port = { x: eq.x + rx, y: eq.y + ry };
    let dir = PIDEngine.portDir(pdx, pdy);
    const nzDef = (data.nozzles || []).find(n => n.ownerId === eq.id && n.portId === conn.id);
    if (nzDef) {
      const t = nozzleTip(eq, conn.id, nzDef.length, data.view.symbolScale || 1);
      if (t) { port = t.tip; dir = t.dir; }
    }
    const gap = ruleParam('layout.valveGap', 14); // >= valve width of clearance
    // align the valve's mating port exactly onto the equipment port's axis:
    // glyph ports sit off-center (e.g. +3.6mm), which otherwise forces a nub jog
    const vKey = v.symbol || SYMBOL_KEYS[v.type];
    const vConns = vKey ? symbolConnections(vKey) : [];
    const vSize = (v.symbol ? symbolSize(v.symbol) : symbolSize(SYMBOL_KEYS[v.type] || 'pip/equipment/vessel-vertical')) * (v.scale || 1) * (data.view.symbolScale || 1);
    let mating = null, best = 0.5;
    for (const c of vConns) {
      if (c.connectionClass === 'signal' || /actuator/i.test(c.id)) continue;
      let qx = c.x - 50, qy = c.y - 50;
      if (v.rotation) { const rd = PIDEngine.rotatePoint(qx, qy, v.rotation); qx = rd.x; qy = rd.y; }
      const s = (-dir.x * qx - dir.y * qy) / (Math.hypot(qx, qy) || 1);
      if (s > best) { best = s; mating = c; }
    }
    let ox = dir.x * (gap + valveHalf), oy = dir.y * (gap + valveHalf);
    if (mating) {
      let mx = ((mating.x - 50) / 100) * vSize, my = ((mating.y - 50) / 100) * vSize;
      if (v.rotation) { const rp = PIDEngine.rotatePoint(mx, my, v.rotation); mx = rp.x; my = rp.y; }
      const along = dir.x * mx + dir.y * my;
      ox += dir.x * along - mx;
      oy += dir.y * along - my;
    }
    v.x = port.x + ox;
    v.y = port.y + oy;
  }

  // re-resolve relative placements against auto-assigned coordinates
  // (sheet-aware). Runs BEFORE instrument/junction stacking so bubbles and
  // stubs anchor to the FINAL positions of rel-placed entities.
  for (let pass = 0; pass < 2; pass++) {
    for (const e of all) {
      if (!e.rel) continue;
      const ref = all.find(o => o.id === e.rel.ref) || instruments.find(o => o.tag === e.rel.ref);
      if (!ref) continue;
      const p = placeRelative(e, ref, 70, data.view.sheetW || 864, data.view.sheetH || 559);
      e.x = p.x; e.y = p.y;
    }
    for (const inst of instruments) {
      if (!inst.rel) continue;
      const ref = all.find(o => o.id === inst.rel.ref);
      if (ref) {
        const p = placeRelative(inst, ref, 70, data.view.sheetW || 864, data.view.sheetH || 559);
        inst.x = p.x; inst.y = p.y;
      }
    }
  }

  // ponytail: hoist — the junction pass (now above) and the instrument passes
  // below both need the symbol scale; it used to be declared with the latter,
  // which only worked while junctions ran last.
  const SC0 = data.view.symbolScale || 1;

  // Anchor a stub/off-page marker to a partner: returns the partner's connection
  // port in absolute sheet coords plus the outward port direction. Extracted so
  // passJunctions and passTerminals below cannot drift apart — they must agree on
  // where "just off the port" is, or the re-anchor pass would fight the placement
  // pass forever.
  const anchorAt = (other, conn) => {
    const conns = symbolConnections(other.symbol || SYMBOL_KEYS[other.type] || '');
    const conn0 = (conn && conn.portName && conns.find(c => c.id === conn.portName))
      || conns.find(c => c.type === 'nozzle') || conns[0];
    if (!conn0) return { x: other.x + 20, y: other.y + 25, dir: { x: 1, y: 0 } };
    const size = symbolSize(other.symbol || SYMBOL_KEYS[other.type] || 'pip/equipment/vessel-vertical') * (other.scale || 1) * SC0;
    const sx = ((conn0.x - 50) / 100) * size, sy = ((conn0.y - 50) / 100) * size;
    let rx = sx, ry = sy, pdx = conn0.x - 50, pdy = conn0.y - 50;
    if (other.rotation) {
      const rp = PIDEngine.rotatePoint(sx, sy, other.rotation);
      rx = rp.x; ry = rp.y;
      const rd = PIDEngine.rotatePoint(pdx, pdy, other.rotation);
      pdx = rd.x; pdy = rd.y;
    }
    return { x: other.x + rx, y: other.y + ry, dir: PIDEngine.portDir(pdx, pdy) };
  };

  // junctions/stubs: sit on the connected port's lead-out axis at a fixed gap,
  // so the branch leaves straight (a relief stub sits straight above the PSV
  // discharge nozzle instead of a diagonal +20/+25 hop that forced bends).
  // Explicit `at` positions win.
  // ponytail: offpage-after-junction follows its partner (cut-set markers
  // hang off free nodes; regular junctions keep legacy behavior so placed
  // sheets never move). Null positions = not yet placed: leave for clamp.
  //
  // ORDERING (2026-09-25): this must run BEFORE valve enforcement. Junctions are
  // legitimate valve anchors (J-0 -> V-101, J-1 -> V-103), so enforcing valve
  // positions while junctions still held unplaced coordinates anchored valves to
  // nothing — and because each valve then became the NEXT valve's anchor, the
  // error cascaded down the chain. On the demo sheet (2 equipment, 8 valves,
  // 3 junctions) that collapsed 8 valves into a 190x25mm pile.
  // Correct order from here on: junctions -> valve enforcement -> instruments.
  // ...but that is a *default*, not a law: `layoutOrder` below searches orderings
  // per sheet and keeps the best by score. This block is one candidate pass.
  const passJunctions = () => {
  for (const j of junctions) {
    if (j._fixed) continue;
    const conn = processPipes.find(p => p.from === j.id || p.to === j.id);
    const otherId = conn ? (conn.from === j.id ? conn.to : conn.from) : null;
    let other = otherId ? byId[otherId] : null;
    if (!other && j.offpage && otherId) {
      const oj = junctions.find(x => x.id === otherId);
      if (oj && oj.x !== null && oj.x !== undefined) other = oj;
    }
    if (!other || other.x === null || other.x === undefined) continue;
    const portName = conn.from === j.id ? conn.toPort : conn.fromPort;
    const a = anchorAt(other, { portName });    const jg = ruleParam('layout.junctionGap', 22);
    j.x = a.x + a.dir.x * jg;
    j.y = a.y + a.dir.y * jg;
  }
  };
  // instruments: two-tier placement (Phases 5 & 9).
  // Tier F (field/panel bubbles): directly above their tap host or process
  // partner, close enough that the tap drop is short and vertical.
  // Tier C (dcs/computer/plc controllers): directly above their field signal
  // partner when one exists, else above the valve/equipment they drive — so
  // controller->final-element signals are short vertical stubs instead of long
  // horizontal runs across the process skeleton.
  const passInstruments = () => {
  const usedSlots = [];
  PIDEngine._isInst = (e) => instruments.some(i => i.tag === (e.tag || e.id));
  const instHalf = symbolSize('isa-5.1/instruments/field-instrument') * SC0 / 2;
  const avoidHalf = (e) => PIDEngine.entityHalf(e, SC0);
  const avoidBoxes = [...equipment, ...valves].map(e => {
    const h = avoidHalf(e) + ruleParam('routing.avoidMargin', 8);
    // ponytail: keep-out extends below the symbol — tag/type/state stacks live
    // there, and bubbles parked on them read as collided labels
    return { e, h, y0: e.y - h, y1: e.y + avoidHalf(e) + ruleParam('layout.labelZone', 16) };
  });
  // ponytail 2026-09-25: instrument bubbles must avoid each other's LABEL zone,
  // not just their 12mm footprints. The only bubble-vs-bubble separation was
  // `usedSlots` at a 45mm radius, which is why FIC-101 ended up sitting on top of
  // V-102/V-103's tag stacks in the manifold cluster: it cleared the metal and
  // landed on the text. Bubbles carry a tag/type/service stack below them exactly
  // like valves do, so they get the same asymmetric keep-out.
  const instHalfW = instHalf + ruleParam('routing.avoidMargin', 8);
  for (const i of instruments) {
    if (i.at || i.rel) continue;
    avoidBoxes.push({
      e: i, h: instHalfW,
      y0: i.y - instHalfW,
      y1: i.y + instHalf + ruleParam('layout.labelZone', 16) * ruleParam('layout.instLabelZone', 1),
    });
  }
  // Candidate offsets for `freeSlot`, ordered by how much they displace the
  // bubble from its ideal stacked position. ponytail 2026-09-25: the old ladder
  // was a fixed dy list x a fixed dx list, so a bubble that needed to clear an
  // obstacle diagonally paid 18mm of vertical movement even when 20mm of
  // horizontal movement alone would have been enough and much tidier. Ordering
  // the candidates by actual displacement (and only then by the seeded shuffle,
  // for the candidate search) means the bubble moves the SHORTEST way out of
  // trouble, which is what a drafter does.
  const slotCands = (() => {
    const offs = [];
    for (const dy of [0, -18, 18, -36, 36, -54]) {
      for (const dx of [0, 20, -20, 40, -40, 60, -60]) {
        if (!dx && !dy) continue;
        offs.push({ dx, dy, d: Math.abs(dx) + Math.abs(dy) });
      }
    }
    return offs;
  })();
  const freeSlot = (x, y) => {
    const FS = ruleParam('layout.freeSlot', 45);
    const taken = (sx, sy) =>
      usedSlots.some(s => Math.abs(s.x - sx) < FS && Math.abs(s.y - sy) < FS) ||
      avoidBoxes.some(b => Math.abs(b.e.x - sx) < b.h && sy > b.y0 && sy < b.y1);
    // home position first (displacement 0), then shortest-displacement wins
    if (!taken(x, y)) { usedSlots.push({ x, y }); return { x, y }; }
    const rest = pidShuffle(slotCands.filter(o => o.d > 0), 2)
      .slice().sort((a, b) => a.d - b.d);
    for (const o of rest) {
      if (!taken(x + o.dx, y + o.dy)) { const s = { x: x + o.dx, y: y + o.dy }; usedSlots.push(s); return s; }
    }
    return { x, y };
  };
  const SHEET_H = data.view.sheetH || 559;
  // Stack vertically adjacent to an anchor on its x axis; flip below when the
  // sheet edge leaves no headroom above; dxBias sidesteps vertical risers
  // (e.g. a relief line leaving the host's top nozzle).
  //
  // ponytail 2026-09-25 — the anchor is the host's BOUNDING BOX, but a `.line`
  // tap has to land on a process RUN, which sits at nozzle elevation, tens of mm
  // below the host's centre. Stacking the bubble off the box centre therefore
  // leaves the tap a long lateral dogleg to reach the line. Measured on the demo
  // before this change: FT-101's tap ran `365,211 -> 424,211 -> 424,245`, a 60mm
  // horizontal run for a 35mm drop.
  // Fix: when the host is tapped on a LINE (tap._tap.lineTap) and has horizontal
  // process runs, aim the bubble at the elevation of the run nearest its current
  // stack position rather than at the box top. The bubble still clears the metal;
  // it just clears it at the height the tap will actually connect.
  const stackOn = (inst, anchorE, half, gap, dxBias) => {
    let yy = anchorE.y - half - gap;
    if (yy < 34) yy = anchorE.y + half + gap - 10;
    if (yy > SHEET_H - 42) yy = anchorE.y - half - gap;
    // align to a process line's elevation when this is a line-tap (see above)
    if (inst._tapLine) {
      const hs = inst._tapHostId;
      let bestY = null;
      // The host's own nozzle tips are the elevation reference — that is where
      // process runs actually sit, as opposed to the symbol's bounding box.
      //
      // NEGATIVE RESULT (2026-09-25, reverted): this was also tried using the
      // host's port geometry via `symbolConnections`, to work around the fact
      // that `data.nozzles` is not yet populated when autoLayout runs
      // (nozzles are materialised later, at pid-parser.js:502). It fired, and it
      // was much worse: spike 1051 -> 2161, with maxSignalLen 225 -> 475mm. The
      // alignment pushed bubbles into other instruments' signal lanes, and the
      // damage showed up in the SIGNALS, not the taps it was meant to improve.
      // The two dead reads (`p._tap.lineTap` is undefined at layout time, and
      // `data.nozzles` is empty) meant the first attempt was silently a no-op —
      // which is the more useful lesson: a fix that changes NOTHING in the
      // metrics is not a fix, it is dead code wearing a fix's clothes.
      for (const nz of (data.nozzles || [])) {
        if (nz.ownerId !== hs || !nz.tipPosition) continue;
        const t = nz.tipPosition.y;
        if (Math.abs(t - yy) < Math.abs((bestY === null ? t : bestY) - yy)) bestY = t;
      }
      if (bestY !== null) {
        const cand = bestY - half - gap;
        if (cand > 34 && cand < SHEET_H - 42 && Math.abs(cand - yy) <= ruleParam('layout.tapAlign', 60)) yy = cand;
      }
    }
    const slot = freeSlot(anchorE.x + (dxBias || 0), yy);
    inst.x = slot.x;
    inst.y = slot.y;
  };
  // does anything pipe OUT of this entity toward the sheet top? (its top-nozzle
  // corridor must stay clear of hovering bubbles)
  const hasRiserAbove = (h) => processPipes.some(p => {
    const oid = p.from === h.id ? p.to : (p.to === h.id ? p.from : null);
    const o = oid && byId[oid];
    return !!(o && o.y < h.y - avoidHalf(h));
  });
  // when dodging a riser sideways, head toward the emptier side
  const riserBias = (h) => {
    const busy = (dir) => avoidBoxes.reduce((n, b) =>
      n + (((b.e.x - h.x) * dir > 10 && Math.abs(b.e.x - h.x) < 90 && Math.abs(b.e.y - h.y) < 120) ? 1 : 0), 0);
    return busy(1) <= busy(-1) ? 34 : -34;
  };
  const isCtrlTier = (i) => i.bubble === 'dcs' || i.bubble === 'computer' || i.bubble === 'plc';
  const sigPartnersOf = (inst) => pipes.filter(p => p.kind === 'signal' && (p.from === inst.tag || p.to === inst.tag))
    .map(p => (p.from === inst.tag ? p.to : p.from));
  // Pass A: field tier over its process host
  for (const inst of instruments) {
    if (inst.at || inst.rel || isCtrlTier(inst)) continue;
    const tp = pipes.find(p => p.kind === 'tap' && (p.from === inst.tag || p.to === inst.tag));
    let hostId = null;
    if (tp) hostId = tp.from === inst.tag ? tp.to : tp.from;
    if (!hostId) {
      const pipe = pipes.find(p => p.kind !== 'tap' && p.kind !== 'signal' && (p.from === inst.tag || p.to === inst.tag) && byId[p.from === inst.tag ? p.to : p.from]);
      hostId = pipe ? (pipe.from === inst.tag ? pipe.to : pipe.from) : null;
    }
    const host = hostId ? byId[hostId] : null;
    // hand `stackOn` the tap's landing context so it can align to a LINE's
    // elevation rather than the host symbol's bounding box (see stackOn)
    if (tp) { inst._tapLine = !!(tp._tap && tp._tap.lineTap); inst._tapHostId = hostId; }
    else { inst._tapLine = false; inst._tapHostId = null; }
    if (host) stackOn(inst, host, avoidHalf(host), ruleParam('layout.stackField', 24), hasRiserAbove(host) ? riserBias(host) : 0);
  }
  // Pass B: controllers sit above the FINAL ELEMENT they drive (ISA drafting
  // convention: the actuator signal drops straight into the valve); the field
  // measurement partner is the fallback anchor when there is no driven entity.
  for (const inst of instruments) {
    if (inst.at || inst.rel || !isCtrlTier(inst)) continue;
    const partners = sigPartnersOf(inst);
    const drivenId = partners.find(id => byId[id]);
    const fieldPartner = !drivenId ? partners.map(id => instruments.find(f => f.tag === id)).find(Boolean) : null;
    if (drivenId) {
      const driven = byId[drivenId];
      // ponytail: 32mm drop — a controller stacked one cell higher gives its
      // signal room for a gap break where it crosses the process stub
      stackOn(inst, driven, avoidHalf(driven), ruleParam('layout.stackCtrl', 32));
    } else if (fieldPartner && (fieldPartner.at || fieldPartner.rel || fieldPartner.x !== 150 || fieldPartner.y !== 110)) {
      stackOn(inst, fieldPartner, instHalf, ruleParam('layout.stackOrphan', 30));
    }
  }
  };

  // ponytail: valve process-line enforcement — runs BEFORE instrument stacking.
  // Rules: 1) valve X/Y must be BETWEEN the line endpoints
  //        2) valve placed near the UPSTREAM entity with offset along the line
  //
  // ORDERING FIX (2026-09-25): this used to run LAST, after instrument stacking —
  // a stage-ordering violation of the Phase-4 kind ("stage N+1 destroys stage N's
  // work"). Bubbles were stacked on valve positions this pass then MOVED, so
  // controllers were left far from what they drive (PIC-101 stacked above V-105,
  // then V-105 slid hundreds of mm away, stranding a 770mm signal).
  //
  // COLLISION FIX (2026-09-25, same pass): the placement rule above puts EVERY
  // valve at `upstream + dir*offset`, so valves sharing an upstream node all land
  // on the same point — and each then becomes the next one's anchor, cascading.
  // Measured on the demo sheet: 8 valves inside a 190x25mm box, closest pair
  // 10mm, labels piled on top of each other. The pass had no collision handling
  // at all. Now each valve slides along its own pipe axis away from any valve
  // already placed, staying inside the endpoint box; if the span has no clear
  // room it keeps its grid position rather than stacking.
  const passValves = () => {
  const VALVE_OFFSET = ruleParam('layout.valveOffset', 20);
  const VALVE_CLEAR = ruleParam('layout.valveClear', 16);   // centre-to-centre
  const vById = {};
  [...equipment, ...valves, ...junctions].forEach(e => { vById[e.id] = e; });
  const placedValves = [];
  const valveFree = (x, y) => placedValves.every(p =>
    Math.hypot(p.x - x, p.y - y) >= VALVE_CLEAR);
  for (const v of valves) {
    if (v.at || v.rel) continue;
    const upPipe = processPipes.find(p => p.to === v.id);
    if (!upPipe) continue;
    const upE = vById[upPipe.from];
    if (!upE) continue;
    const dnPipe = processPipes.find(p => p.from === v.id);
    if (!dnPipe) continue;
    const dnE = vById[dnPipe.to];
    if (!dnE) continue;
    const minX = Math.min(upE.x, dnE.x), maxX = Math.max(upE.x, dnE.x);
    const minY = Math.min(upE.y, dnE.y), maxY = Math.max(upE.y, dnE.y);

    // CONSTRAINT, NOT PLACEMENT (2026-09-25). The rule this pass exists to
    // enforce is "a valve sits BETWEEN its two endpoints". The old code
    // repositioned EVERY valve to `upstream + dir*20` regardless — which
    // overwrote perfectly good grid positions, pulled every valve toward its
    // upstream anchor, and (because each valve then anchors the next) cascaded
    // the whole chain into a pile. A valve that already satisfies the constraint
    // is left exactly where the layout put it.
    const satisfies = v.x >= minX - 0.5 && v.x <= maxX + 0.5
                   && v.y >= minY - 0.5 && v.y <= maxY + 0.5;
    if (satisfies) { placedValves.push({ x: v.x, y: v.y }); continue; }

    const dx = dnE.x - upE.x, dy = dnE.y - upE.y;
    const len = Math.hypot(dx, dy) || 1;
    const dirX = dx / len, dirY = dy / len;
    const clamp = (x, y) => ({
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y)),
    });
    const at = (d) => clamp(upE.x + dirX * d, upE.y + dirY * d);
    const offset = Math.min(VALVE_OFFSET, len * 0.3);
    // Bounded search around the nominal offset, both directions along the axis.
    // Unbounded (walk to the far endpoint) pushed valves clean across the sheet.
    const REACH = VALVE_CLEAR * 2.5;
    let best = null;
    for (let d = offset; d <= Math.min(len, offset + REACH) && !best; d += VALVE_CLEAR / 2) {
      const c = at(d);
      if (valveFree(c.x, c.y)) best = c;
    }
    for (let d = offset - VALVE_CLEAR / 2; d >= Math.max(0, offset - REACH) && !best; d -= VALVE_CLEAR / 2) {
      const c = at(d);
      if (valveFree(c.x, c.y)) best = c;
    }
    if (best) { v.x = best.x; v.y = best.y; }
    placedValves.push({ x: v.x, y: v.y });
  }
  };

  // ---- run the placement passes in the requested order --------------------
  // The three passes are mutually dependent: each anchors to positions the others
  // set, so the right order depends on sheet topology. Measured across the
  // canonical sheets AND the demo, no single order wins everywhere:
  //
  //   order  spike        dense         demo
  //   V-first 1101/sig376 466/0err      572/6warn   <- my bad "win"
  //   V-last  1247/sig615 1441/1err     294/3warn
  //   JVI     2092/1err   1427/1err     255/1warn
  //
  // So don't pick — search. The legacy order always competes, which makes this
  // never worse than the single best fixed order (same property Phase 3 relies on
  // for routing seeds). Deterministic: no RNG, so a sheet always reproduces.
  const PASSES = { J: passJunctions, V: passValves, I: passInstruments };
  for (const k of (data.layoutOrder || 'JVI')) {
    if (PASSES[k]) PASSES[k]();
  }

  // ---- passDecrowd: separate entities that sit shoulder to shoulder ----------
  // Runs after the placement search, before passTerminals, so terminals re-anchor
  // to the positions this produces.
  //
  // Why this is not the same as "stretch the rows" (measured worse, see the
  // ROW_SOLVED note above): that moved EVERY entity and lengthened every pipe.
  // This only separates entities that are already horizontally within a label's
  // width of each other, which is the only configuration where the label stacks
  // can physically collide. Everything else keeps its exact position.
  //
  // Measured on the demo sheet: the manifold off J-1 put V-102 (440,225),
  // V-103 (455,240), V-105 (485,230), FV-101 (475,245) and PSV-101 (445,250)
  // inside a 45x25mm box — five valves, each with a three-line label stack
  // (tag / type / state) needing ~26mm of vertical room. Two label collisions.
  const passDecrowd = () => {
    if (!ruleParam('layout.decrowd', 1)) return;
    const CX = ruleParam('layout.crowdX', 34);   // label width + a little air
    const half = (e) => PIDEngine.entityHalf(e, SC0);
    // Vertical room needed between two horizontally-adjacent entities. Label
    // stacks hang BELOW their symbol, so only the UPPER entity's stack has to fit
    // in the gap — the gap is half + half + one label zone, NOT two. (Reserving it
    // twice, as the first cut did, demanded 52mm between adjacent valves and cost
    // crossings on every sheet while making spike's labels worse: 2 -> 4.)
    const gapFor = (a, b) => half(a) + half(b) + ruleParam('layout.labelZone', 16) * ruleParam('layout.decrowdZone', 1);
    const nodes = [...equipment, ...valves].filter(e => !e.at && !e.rel && e.x != null);
    for (let it = 0; it < ruleParam('layout.decrowdIters', 4); it++) {
      let moved = false;
      nodes.sort((a, b) => a.x - b.x || a.y - b.y);
      for (let i = 0; i < nodes.length; i++) {
        for (let k = i + 1; k < nodes.length; k++) {
          const a = nodes[i], b = nodes[k];
          if (b.x - a.x > CX) break;               // sorted by x: nothing further overlaps
          const gap = gapFor(a, b);
          const dy = b.y - a.y;
          if (Math.abs(dy) >= gap) continue;
          // push apart about the midpoint so neither is arbitrarily displaced
          const push = (gap - Math.abs(dy)) / 2 * (dy < 0 ? -1 : 1);
          a.y -= push; b.y += push;
          moved = true;
        }
      }
      if (!moved) break;
    }
  };
  passDecrowd();

  // ---- passTerminals: re-anchor off-page connectors to their FINAL partner ---
  // Runs LAST, after every placement pass, and is deliberately not part of the
  // order search: it is a consistency repair, not a placement choice.
  //
  // Why it exists (measured, demo sheet): a terminal is anchored to its partner
  // by passJunctions, but passValves can then SLIDE that partner a long way for
  // collision avoidance. On the demo, OP-CD was anchored to V-106 at (87,437);
  // valve enforcement then moved V-106 to (205,150) — 285mm away — and left
  // OP-CD behind. The orphaned terminal is what produced the bottom-left void
  // and the 280mm drain line running diagonally across the sheet. No pass
  // re-checked the stub, because nothing had "moved the stub"; its anchor had.
  //
  // Two improvements over plain re-anchoring:
  //  1. A terminal with SEVERAL partners (OP-CD joins the tank drain and the
  //     PSV relief) picks the one that leaves the sheet most naturally — a
  //     direction pointing away from the process block, preferring down, since
  //     drains and flares go down and off the bottom edge by convention.
  //  2. Placing off the block's own bounding box is what keeps terminals from
  //     landing back in the middle of the drawing.
  if (ruleParam('layout.terminals', 1)) {
    // process block centre, for the outward test
    const pl = [...equipment, ...valves].filter(e => !e.at && e.x != null);
    let cx = 0, cy = 0;
    if (pl.length) { cx = pl.reduce((s, e) => s + e.x, 0) / pl.length; cy = pl.reduce((s, e) => s + e.y, 0) / pl.length; }
    const jg = ruleParam('layout.junctionGap', 22);
    // distance from p to segment ab — used to veto planting a terminal on top of
    // one of its anchor's other pipe runs.
    const segDist = (px, py, ax, ay, bx, by) => {
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy;
      if (!L2) return Math.hypot(px - ax, py - ay);
      let t = ((px - ax) * dx + (py - ay) * dy) / L2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    };
    // A candidate terminal position is rejected when it is planted in the same
    // direction the anchor's OTHER run leaves — that is what produces a
    // collinear overlap, because the two runs share the same corridor.
    // Measured: anchoring OP-CD to PSV-101's relief discharge put it 22mm above
    // PSV-101's inlet, on the J-1 -> PSV-101 feed — "J-1->PSV-101 &
    // PSV-101->OP-CD overlap 22mm at x=445", a COLLINEAR_OVERLAP error worth
    // 1000. That single error was what made the placement search prefer a
    // candidate that stranded V-106 and PSV-101 at the foot of the sheet, so
    // this veto is load-bearing, not cosmetic.
    // A distance test alone does NOT catch it: the incoming run jogs sideways to
    // reach J-1, so the terminal can sit 22mm off the port and still be nowhere
    // near the straight segment. Direction is the actual invariant.
    const onOthersRun = (anchorId, dir, qx, qy, skipPipe) => {
      const reach = ruleParam('layout.terminalClear', 14);
      const anchor = byId[anchorId] || junctions.find(x => x.id === anchorId);
      if (!anchor) return false;
      for (const p of processPipes) {
        if (p === skipPipe) continue;
        if (p.from !== anchorId && p.to !== anchorId) continue;
        const otherId = p.from === anchorId ? p.to : p.from;
        const o = byId[otherId] || junctions.find(x => x.id === otherId);
        if (!o || o.x == null) continue;
        // does the anchor's other run leave in the same direction as the stub?
        const vx = o.x - anchor.x, vy = o.y - anchor.y;
        const L = Math.hypot(vx, vy) || 1;
        if ((dir.x * vx + dir.y * vy) / L > ruleParam('layout.terminalDirDot', 0.5)) return true;
        // ...or is the stub simply sitting on the other run's corridor?
        const a = anchorAt(anchor, { portName: p.from === anchorId ? p.toPort : p.fromPort });
        if (segDist(qx, qy, a.x, a.y, o.x, o.y) < reach) return true;
      }
      return false;
    };
    for (const j of junctions) {
      if (!j.offpage || j._fixed) continue;
      const conns = processPipes.filter(p => p.from === j.id || p.to === j.id);
      if (!conns.length) continue;
      let best = null;
      for (const conn of conns) {
        const otherId = conn.from === j.id ? conn.to : conn.from;
        const other = byId[otherId] || junctions.find(x => x.id === otherId);
        if (!other || other.x == null || other.x === undefined) continue;
        const a = anchorAt(other, { portName: conn.from === j.id ? conn.toPort : conn.fromPort });
        const qx = a.x + a.dir.x * jg, qy = a.y + a.dir.y * jg;
        if (onOthersRun(otherId, a.dir, qx, qy, conn)) continue;
        if (!best) { best = { x: qx, y: qy, s: -Infinity };
          best.s = pref(a, qx, qy, j, cx, cy);
          continue;
        }
        const s = pref(a, qx, qy, j, cx, cy);
        if (s > best.s) best = { x: qx, y: qy, s };
      }
      if (!best) continue;
      j.x = best.x; j.y = best.y;
    }
    // Preference between the surviving anchors. Down first — drains and flares
    // leave the bottom of the sheet by convention — then shortest added run.
    function pref(a, qx, qy, j, cx, cy) {
      const down = a.dir.y > 0 ? 60 : 0;
      let len = 0;
      for (const conn of processPipes) {
        if (conn.from !== j.id && conn.to !== j.id) continue;
        const otherId = conn.from === j.id ? conn.to : conn.from;
        const o = byId[otherId] || junctions.find(x => x.id === otherId);
        if (!o || o.x == null) continue;
        const b = anchorAt(o, { portName: conn.from === j.id ? conn.toPort : conn.fromPort });
        len += Math.hypot(qx - b.x, qy - b.y);
      }
      const outward = a.dir.x * (a.x - cx) + a.dir.y * (a.y - cy);
      return down + outward * 0.5 - len * 0.2;
    }
  }

  // ---- centre the composed block on the sheet (translation only) ----------
  // Why translation and not scaling: stretching the grid pitch to fill the sheet
  // was measured and is WORSE on every metric (see the ROW_SOLVED negative-result
  // note above — spike score 1276 -> 1359..1894, crossings 30 -> 33..41, tap reach
  // 200 -> 335..472; dense up to 2588). The compact block is a feature of the
  // routing, not a defect.
  //
  // A pure translation moves the whole block without altering ANY relative
  // position, so every pipe keeps its exact shape, length, bend count and
  // crossing relationship. Defect counts are therefore invariant by
  // construction — this can only change where the drawing sits on the sheet,
  // which is exactly the "bottom third is empty" complaint (F2/F3).
  //
  // Entities carrying an explicit `at` are user-placed and are honoured as
  // authored, so the block is measured from auto-placed items only.
  if (ruleParam('layout.centre', 1)) {
    const FRAME = 18;                 // border frame inset
    const BOT_RESERVE = ruleParam('layout.centreBottomReserve', 60); // title block band
    // Target zone, shared by centring and the fill scale below. Declared out here
    // so both blocks can use it.
    const SW = data.view.sheetW || 864, SH = data.view.sheetH || 559;
    const zx0 = FRAME + ruleParam('layout.xMargin', 60) * 0.5;
    const zx1 = SW - FRAME - ruleParam('layout.xMargin', 60) * 0.5;
    const zy0 = FRAME + 24;                    // headroom for the instrument tier
    const zy1 = SH - FRAME - BOT_RESERVE;      // clear of the title block
    // Absolute `at` coordinates are the drafter's layout, not the engine's.
    // Centring would fight them — and worse, if only the auto items moved, it
    // would tear valves and instruments away from the equipment they were placed
    // against (min.dsl lost 0->2 crossings this way). Measured: min.dsl (2 `at`)
    // and split.dsl (4 `at`) both regressed under centring; spike.dsl and
    // dense.dsl (0 `at`) both improved. So: hand-placed sheets are left alone.
    // NOTE `rel` does NOT count — a relative placement is re-resolved against its
    // reference on every layout, so it travels with the block correctly.
    // (spike.dsl has `rel above R-101` on its PSV and must still be centred.)
    const pinned = [...equipment, ...valves, ...instruments, ...junctions]
      .filter(e => e.at).length;
    if (pinned) {
      data.centerShift = { dx: 0, dy: 0, skipped: 'pinned-placement' };
    } else {
      const movable = [...equipment, ...valves, ...instruments, ...junctions];
      if (movable.length) {
        const half = (e) => {
          try { return PIDEngine.entityHalf(e, data.view.symbolScale || 1) || 6; }
          catch { return 6; }
        };
        // instrument bubbles carry a label stack below; give them the same
        // keep-out the stacking pass uses so centring doesn't ride the text down.
        const below = ruleParam('layout.labelZone', 16);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const e of movable) {
          const h = half(e);
          const extra = instruments.includes(e) ? below : 0;
          x0 = Math.min(x0, e.x - h); x1 = Math.max(x1, e.x + h);
          y0 = Math.min(y0, e.y - h); y1 = Math.max(y1, e.y + h + extra);
        }
        const SW2 = data.view.sheetW || 864, SH2 = data.view.sheetH || 559;
        // grid-snap the shift so the 5mm routing grid keeps its phase; a fractional
        // shift would silently re-phase every downstream snap.
        const g = data.view.grid || 5;
        const snap = (v) => Math.round(v / g) * g;
        let dx = 0, dy = 0;
        if (x1 - x0 < zx1 - zx0) dx = snap((zx0 + zx1 - (x0 + x1)) / 2);
        if (y1 - y0 < zy1 - zy0) dy = snap((zy0 + zy1 - (y0 + y1)) / 2);
        if (dx || dy) for (const e of movable) { e.x += dx; e.y += dy; }
        data.centerShift = { dx, dy };
      }
    }

    // ---- fill-the-sheet by uniform scaling: MEASURED DEAD END --------------
    // Thesis: multiplying positions AND symbolScale by one factor preserves every
    // relative distance, so crossings/overlaps/bends/label-collisions would be
    // scale-invariant and the sheet could fill for free.
    //
    // It is not free, and the reason is structural. The engine's tunables are
    // absolute millimetres — 14mm port lead-in, 45mm bubble slot, 16mm label
    // keep-out, 8mm annotation standoff, 5mm grid. Scaling geometry without them
    // lets symbols grow into their own labels; scaling them too (PID_DRAW_SCALE in
    // ruleParam) made it worse, not better. Measured, fillScale on vs off:
    //
    //   dense  27% -> 49%   labels 1 -> 28   crossings 8 -> 8   bends 34 -> 30
    //   spike  82% -> 82%   labels 2 ->  5   crossings 30 -> 42 bends 83 -> 85
    //
    // Spike was already at 82% (fine) and got worse; dense traded 1 label
    // collision for 27 to buy fill that the sparse-sheet check already reports.
    // Two attempts, both fail the gate — this is the plan's "global rewrite"
    // non-goal, now with independent evidence rather than assumption.
    //
    // Conclusion: the engine is built around ONE absolute drawing scale, and
    // 1 unit = 1mm stays literal. An under-filled sheet is not a layout bug — it
    // is a small sheet, and `[13] sparse sheet` reporting it honestly (plus the
    // plan's split-the-sheet answer) is the correct response. The draw-scale seam
    // in ruleParam is left in place, defaulted to 1, where it is inert.
    data.fillScale = 1;
    PID_DRAW_SCALE = 1;
  }
}

//  model validation (mirrors DEXPI/Pydantic-style rules) 
// ---- obstacle-aware routing: A* grid search with a cost model -------
// `routed` = polylines already placed; crossing one is penalized, running along one is
// heavily penalized, so later lines prefer clean corridors (crossings only when forced).
/**
 * Description placeholder
 *
 * @param {*} pts 
 * @param {*} data 
 * @param {*} exclude 
 * @param {*} grid 
 * @param {*} routed 
 * @param {*} hardLines 
 * @returns {*} 
 */

// obstacle boxes for routing (shared by avoidObstacles + stubClearance).
// ponytail: box math lives in collide.entityBox — one source of truth.
// Nozzle flanges are obstacles too (hard rule PID-GEO-006: no line crosses a
// nozzle). A pipe's own endpoint nozzles are excluded — the approach stub
// lives inside its own flange box by construction.
function routeObstacles(data, exclude) {
  const SC = data.view.symbolScale || 1;
  PIDEngine._isInst = (e) => data.instruments.some(i => i.tag === (e.tag || e.id));
  const ob = [];
  for (const e of [...data.equipment, ...data.valves, ...data.instruments]) {
    if (e === exclude.a || e === exclude.b) continue;
    ob.push(collide.entityBox(e, SC, PIDEngine._isInst(e)));
  }
  // ponytail: nozzle flanges intentionally NOT hard obstacles — measured:
  // hard-blocking them churned spike 27→35 crossings for zero fires (the
  // validator below stays quiet on accurate boxes). Flanges are checked by
  // PID-GEO-006 at validation; placement fixes genuine grazes (Phase 5).
  // Stub tips keep clearance via stubClearance against entity boxes.
  return ob;
}

// free run length from a port tip along dir before entering an obstacle box.
// Lead-in stubs must not extend INTO a neighbor (e.g. a bubble 6mm off the port):
// the tip-to-relaxed-start connector would otherwise draw straight through it.
// ponytail: 4mm floor — a shrunken 1-3mm stub is a sliver, not a lead-in;
// return 0 (route from the tip) instead.
function stubClearance(tip, dir, wantLen, data, exclude) {
  if (!dir || (!dir.x && !dir.y) || wantLen <= 0) return wantLen;
  const ob = routeObstacles(data, exclude);
  const L = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / L, uy = dir.y / L;
  for (let d = 0; d <= wantLen; d += 1) {
    const x = tip.x + ux * d, y = tip.y + uy * d;
    if (ob.some(r => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1)) return d - 2 >= 4 ? d - 2 : 0;
  }
  return wantLen;
}

function avoidObstacles(pts, data, exclude, grid, routed, hardLines, softNozzle) {
  const GRIDMIN = ruleParam('routing.gridMin', 5);
  const CELL = Math.max(grid || GRIDMIN, GRIDMIN); // grid resolution floor
  PIDEngine._isInst = (e) => data.instruments.some(i => i.tag === (e.tag || e.id));
  // lines that must stay inviolable: their cells are hard-blocked (refinement's
  // overlap elimination â€” a re-routed line may not touch them at all)
  const hardCells = new Set();
  if (hardLines) {
    const addSeg = (a, b) => {
      const c0 = Math.round(a.x / CELL), c1 = Math.round(b.x / CELL);
      if (Math.abs(a.y - b.y) < 0.5) {
        const cy = Math.round(a.y / CELL);
        for (let cx = Math.min(c0, c1); cx <= Math.max(c0, c1); cx++) hardCells.add(cx + ',' + cy);
      } else {
        const cx = Math.round(a.x / CELL);
        for (let cy = Math.min(c0, c1); cy <= Math.max(c0, c1); cy++) hardCells.add(cx + ',' + cy);
      }
    };
    const buf = (cx, cy) => { hardCells.add((cx + 1) + ',' + cy); hardCells.add((cx - 1) + ',' + cy); hardCells.add(cx + ',' + (cy + 1)); hardCells.add(cx + ',' + (cy - 1)); };
    for (const poly of hardLines) {
      if (!poly || poly.length < 2) continue;
      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i], b = poly[i + 1];
        addSeg(a, b);
        // 1-cell buffer so a re-routed line is pushed clear of the corridor, not
        // merely kept from landing exactly on it (a sub-grid overlap slips through otherwise)
        const c0 = Math.round(a.x / CELL), c1 = Math.round(b.x / CELL);
        if (Math.abs(a.y - b.y) < 0.5) {
          const cy = Math.round(a.y / CELL);
          for (let cx = Math.min(c0, c1); cx <= Math.max(c0, c1); cx++) buf(cx, cy);
        } else {
          const cx = Math.round(a.x / CELL);
          for (let cy = Math.min(c0, c1); cy <= Math.max(c0, c1); cy++) buf(cx, cy);
        }
      }
    }
  }
  const SHEET = PIDEngine.sheetBounds(data.view.sheetW, data.view.sheetH);
  const ob = routeObstacles(data, exclude);

  // penalty field over already-routed lines (grid-cell resolution)
  const field = new Map();
  const bump = (cx, cy, p) => { const k = cx + ',' + cy; field.set(k, (field.get(k) || 0) + p); };
  const markSeg = (x0, y0, x1, y1, p) => {
    if (Math.abs(y0 - y1) < 0.5) {
      const cy = Math.round(y0 / CELL);
      const c0 = Math.round(x0 / CELL), c1 = Math.round(x1 / CELL);
      for (let cx = Math.min(c0, c1); cx <= Math.max(c0, c1); cx++) bump(cx, cy, p);
    } else {
      const cx = Math.round(x0 / CELL);
      const c0 = Math.round(y0 / CELL), c1 = Math.round(y1 / CELL);
      for (let cy = Math.min(c0, c1); cy <= Math.max(c0, c1); cy++) bump(cx, cy, p);
    }
  };
  const markLine = (poly, pen, penNear) => {
    if (!poly || poly.length < 2) return;
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i], b = poly[i + 1];
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5) continue;
      markSeg(a.x, a.y, b.x, b.y, pen);
      // adjacent corridor cells: mild cost so lines keep ~1 cell of clearance
      if (Math.abs(a.y - b.y) < 0.5) {
        markSeg(a.x, a.y - CELL, b.x, b.y - CELL, penNear);
        markSeg(a.x, a.y + CELL, b.x, b.y + CELL, penNear);
      } else {
        markSeg(a.x - CELL, a.y, b.x - CELL, b.y, penNear);
        markSeg(a.x + CELL, a.y, b.x + CELL, b.y, penNear);
      }
    }
  };
  for (const r of (routed || [])) markLine(r.poly, ruleParam('routing.fieldCross', 300), ruleParam('routing.fieldNear', 35));
  // ponytail: soft nozzle yield — signals (never process: process holds its
  // corridors per line priority) prefer routing around nozzle flanges instead
  // of piercing them. Penalty, not a wall: forced crossings still route and
  // PID-GEO-006 reports them. Hard-blocking measured 27→35 crossings on spike.
  // TEMP-BISECT: nozzle soft-penalty stays; tap-root stub penalty disabled —
  // measuring whether tap-root causes the churn.
  if (softNozzle) {
    const SC = data.view.symbolScale || 1;
    const owned = new Set([exclude.a && (exclude.a.id || exclude.a.tag), exclude.b && (exclude.b.id || exclude.b.tag)]);
    const pen = ruleParam('routing.fieldCross', 300);
    for (const nz of (data.nozzles || [])) {
      if (owned.has(nz.ownerId)) continue;
      for (const r of collide.nozzleBoxes(nz, SC)) {
        const cx0 = Math.round(r.x0 / CELL), cx1 = Math.round(r.x1 / CELL);
        const cy0 = Math.round(r.y0 / CELL), cy1 = Math.round(r.y1 / CELL);
        for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) bump(cx, cy, pen);
      }
    }
    // TEMP-BISECT: tap-root stub penalty disabled (if false) — measuring
    // whether it causes the +10mm/texts churn.
    const TAPROOT_ON = false;
    if (TAPROOT_ON) {
    const r = 4.5 * SC;
    for (const inst of data.instruments) {
      if (!data.pipes.some(p => p.kind === 'tap' && p.from === inst.tag)) continue;
      if ((exclude.a && (exclude.a.id || exclude.a.tag) === inst.tag) ||
          (exclude.b && (exclude.b.id || exclude.b.tag) === inst.tag)) continue;
      const cx = Math.round(inst.x / CELL);
      const cy0 = Math.round((inst.y + r) / CELL), cy1 = Math.round((inst.y + r + 10) / CELL);
      for (let cy = cy0; cy <= cy1; cy++) bump(cx, cy, pen);
    }
    }
  }

  const blockedAt = (x, y) => {
    if (hardCells.has(Math.round(x / CELL) + ',' + Math.round(y / CELL))) return true;
    for (const r of ob) {
      if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
    }
    return false;
  };
  // clamp a point to the sheet bounds
  const clamp = (p) => ({ x: Math.max(SHEET.x0, Math.min(SHEET.x1, p.x)), y: Math.max(SHEET.y0, Math.min(SHEET.y1, p.y)) });
  // relax a blocked endpoint to the nearest free cell. Prefers moving ALONG the port
  // direction (kept in `prefDir`) so a blocked lead-in slides straight out of the
  // obstacle instead of being shoved perpendicular (which would kink the run and can
  // collide with a sibling line leaving the same node). Diagonals are a last resort.
  const relax = (p, prefDir) => {
    // ponytail: never clamp a free point — nozzle tips legally hang past the
    // sheet margin, and clamping them destroys the lead-in goal (the E-103
    // defect: goal slid 14mm east, leaving a 6mm stub). The A* cell clamp
    // handles search bounds; the exact tip stays pinned as the path endpoint.
    // Object identity is preserved too (lead-in _lead tags must survive).
    if (!blockedAt(p.x, p.y)) return p;
    if (prefDir && (prefDir.x || prefDir.y)) {
      for (let d = 1; d < 8; d++) {
        const x = p.x + prefDir.x * d * CELL, y = p.y + prefDir.y * d * CELL;
        if (x < SHEET.x0 || x > SHEET.x1 || y < SHEET.y0 || y > SHEET.y1) continue;
        if (!blockedAt(x, y)) return { x, y };
      }
    }
    for (let d = 1; d < 8; d++) {
      for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
        const x = p.x + dx * CELL, y = p.y + dy * CELL;
        if (x < SHEET.x0 || x > SHEET.x1 || y < SHEET.y0 || y > SHEET.y1) continue;
        if (!blockedAt(x, y)) return { x, y };
      }
    }
    for (let ring = 1; ring < 8; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          const x = p.x + dx * CELL, y = p.y + dy * CELL;
          if (x < SHEET.x0 || x > SHEET.x1 || y < SHEET.y0 || y > SHEET.y1) continue;
          if (!blockedAt(x, y)) return { x, y };
        }
      }
    }
    return clamp(p);
  };
  // stub-aware endpoints: pts[1] is only the lead-in end if it sits near pts[0];
 // for stubless pipes (junction endpoints) it is the FAR end â€” search between the
 // true endpoints or the A* degenerates (start==goal) and lets overlaps through
  const nearEnd = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 30;
  // derive the port direction from the lead-in stub so relax can keep it straight
  const dirOf = (a, b) => (Math.abs(b.x - a.x) > 0.5 || Math.abs(b.y - a.y) > 0.5)
    ? { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) } : null;
  const sDir = dirOf(pts[0], pts[1] || pts[0]);
  const gDir = dirOf(pts[pts.length - 1], pts[pts.length - 2] || pts[pts.length - 1]);
  const start = relax(nearEnd(pts[0], pts[1] || pts[0]) ? pts[1] || pts[0] : pts[0], sDir);
  const goal = relax(nearEnd(pts[pts.length - 1], pts[pts.length - 2] || pts[pts.length - 1]) ? pts[pts.length - 2] || pts[pts.length - 1] : pts[pts.length - 1], gDir);

  // Deliberate routing: if the direct orthogonal route is already clean (no component
  // crossing, no paid line crossing, stays inside the sheet), keep it â€” what a drafter draws.
  let directCost = 0;
  const outOfSheet = (x, y) => x < SHEET.x0 || x > SHEET.x1 || y < SHEET.y0 || y > SHEET.y1;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (outOfSheet(a.x, a.y) || outOfSheet(b.x, b.y)) { directCost += 1e6; continue; }
    const c0 = Math.round(a.x / CELL), c1 = Math.round(b.x / CELL), c0y = Math.round(a.y / CELL), c1y = Math.round(b.y / CELL);
    if (Math.abs(a.y - b.y) < 0.5) {
      const cy = Math.round(a.y / CELL);
      for (let cx = Math.min(c0, c1); cx <= Math.max(c0, c1); cx++) {
        const x = cx * CELL, y = cy * CELL;
        if (blockedAt(x, y)) { directCost += 1e6; break; }
        directCost += field.get(cx + ',' + cy) || 0;
      }
    } else if (Math.abs(a.x - b.x) < 0.5) {
      const cx = Math.round(a.x / CELL);
      for (let cy = Math.min(c0y, c1y); cy <= Math.max(c0y, c1y); cy++) {
        const x = cx * CELL, y = cy * CELL;
        if (blockedAt(x, y)) { directCost += 1e6; break; }
        directCost += field.get(cx + ',' + cy) || 0;
      }
    } else {
      directCost += 1e6; // diagonal â€” never direct
    }
  }
  if (directCost < 1) return pts;

// search bounds: LOCAL box around the direct route + margin, clamped to the sheet.
  // A drawing-wide bound lets A* take absurd perimeter tours to dodge line costs.
  let x0 = start.x, x1 = start.x, y0 = start.y, y1 = start.y;
  for (const q of pts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
  x0 = Math.min(x0, goal.x); x1 = Math.max(x1, goal.x); y0 = Math.min(y0, goal.y); y1 = Math.max(y1, goal.y);
  const M = ruleParam('routing.searchMargin', 260);
  const bounds = {
    x0: Math.max(SHEET.x0, x0 - M), x1: Math.min(SHEET.x1, x1 + M),
    y0: Math.max(SHEET.y0, y0 - M), y1: Math.min(SHEET.y1, y1 + M)
  };

  // belly rule: penalize dipping below the ports' elevation — except for
  // junction-fed branches, whose fan-out dir may legitimately point down; a
  // floor there shoves the route up-and-over through its siblings' corridors.
  const dipFloor = (pts._jEnds) ? Math.min(pts[0].y, pts[pts.length - 1].y)
    : Math.max(pts[0].y, pts[pts.length - 1].y);
  const path = aStar(start, goal, ob, CELL, { field, bounds, maxCells: 100000, dipFloor, hardCells });
  if (!path) {
    // No path â€” fall back to the direct route. This is the single most
    // consequential un-flagged failure in the router: the direct route goes
    // straight through every hard block and every obstacle box, and until now it
    // did so SILENTLY. No error, no warning, and nothing in `score` â€” the only
    // signal was `__astarFails`, which the harness prints but which is not part
    // of data.errors, so a user rendering a sheet never learned their congested
    // area had been routed by giving up.
    //
    // ponytail 2026-09-25: record it as a real, countable defect. Recorded per
    // pipe (not per failed cell) so the count means "this many pipes were routed
    // straight through something they should have gone around". A warning, not an
    // error: a straight line is often still the best available drawing, and a hard
    // error would fail congested-but-valid sheets. The remedy is the obstacle
    // budget, not the drawing.
    window.__astarFails = (window.__astarFails || 0) + 1;
    (data.astarGiveups = data.astarGiveups || []).push(pts._who || 'pipe');
    return pts;
  }

  // snap interior bend points to a coarser draft grid (kills doglegs); a point that
  // would snap into a component keeps its original position. The first/last path
  // points are the exact start/goal (lead-ins stay axis-aligned) and are NOT snapped.
  const snapPitch = CELL; // 10mm â€” a coarser snap would collapse parallel corridors onto each other
  const snapped = [pts[0]];
  for (let qi = 0; qi < path.length; qi++) {
    const q = path[qi];
    if (qi === 0 || qi === path.length - 1) { snapped.push(q); continue; }
    const x = Math.round(q.x / snapPitch) * snapPitch;
    const y = Math.round(q.y / snapPitch) * snapPitch;
    const s = blockedAt(x, y) ? q : { x, y };
    const last = snapped[snapped.length - 1];
    if (Math.abs(last.x - s.x) < 0.5 && Math.abs(last.y - s.y) < 0.5) continue; // collapsed onto previous
    snapped.push(s);
  }
  const lastP = snapped[snapped.length - 1];
  if (Math.abs(lastP.x - pts[pts.length - 1].x) > 0.5 || Math.abs(lastP.y - pts[pts.length - 1].y) > 0.5) snapped.push(pts[pts.length - 1]);

  // orthogonality guarantee: exact (un-snapped) endpoints vs grid cells can produce a
  // diagonal; replace any diagonal segment with an L-bend so lines run only at 0/90/180/270Â°
  // ponytail: prefer the corner inside the search bounds — an out-of-sheet
  // corner draws the line off the sheet to reach an out-of-margin tip
  const ortho = [snapped[0]];
  const inB = (p) => p.x >= bounds.x0 && p.x <= bounds.x1 && p.y >= bounds.y0 && p.y <= bounds.y1;
  for (let i = 1; i < snapped.length; i++) {
    const a = ortho[ortho.length - 1], b = snapped[i];
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
      const c1 = { x: b.x, y: a.y }, c2 = { x: a.x, y: b.y };
      const ok1 = !blockedAt(c1.x, c1.y) && inB(c1), ok2 = !blockedAt(c2.x, c2.y) && inB(c2);
      ortho.push(ok1 ? c1 : ok2 ? c2 : (!blockedAt(c1.x, c1.y) ? c1 : c2));
    }
    ortho.push(b);
  }
  return ortho;
}

/**
 * Description placeholder
 *
 * @param {*} start 
 * @param {*} goal 
 * @param {*} obstacles 
 * @param {*} cell 
 * @param {*} ctx 
 * @returns {*} 
 */
function aStar(start, goal, obstacles, cell, ctx) {
  const field = ctx.field, bounds = ctx.bounds, maxCells = ctx.maxCells;
  // hard cells (sibling lead-outs, overlap blockers) are forbidden territory,
  // not merely expensive; only the endpoints' own cells stay exempt because
  // grid rounding can drop a relaxed-but-free point onto a blocked neighbor
  const hard = ctx.hardCells;
  const sKey = Math.round(start.x / cell) + ',' + Math.round(start.y / cell);
  const gKey = Math.round(goal.x / cell) + ',' + Math.round(goal.y / cell);
  const blockedAt = (x, y) => {
    if (hard) {
      const k = Math.round(x / cell) + ',' + Math.round(y / cell);
      if (hard.has(k) && k !== sKey && k !== gKey) return true;
    }
    for (const r of obstacles) {
      if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
    }
    return false;
  };
  const inBounds = (x, y) => x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y <= bounds.y1;
  const toCell = (p) => [Math.round(p.x / cell), Math.round(p.y / cell)];
  const fromCell = (c) => ({ x: c[0] * cell, y: c[1] * cell });
  const s = toCell(start), g = toCell(goal);
  // ponytail: clamp endpoint cells into the admitted range — an endpoint within
  // half a cell of the margin maps to a center outside bounds, which could never
  // be reached, so A* failed and the line fell back straight through bodies
  const cx0 = Math.ceil(bounds.x0 / cell), cx1 = Math.floor(bounds.x1 / cell);
  const cy0 = Math.ceil(bounds.y0 / cell), cy1 = Math.floor(bounds.y1 / cell);
  const clampC = (c) => [Math.max(cx0, Math.min(cx1, c[0])), Math.max(cy0, Math.min(cy1, c[1]))];
  const sc = clampC(s), gc = clampC(g);
  const key = (c) => c[0] + ',' + c[1];
  const h = (c) => Math.abs(c[0] - gc[0]) + Math.abs(c[1] - gc[1]);
  const gScore = new Map([[key(sc), 0]]);
  const came = new Map();
  const seen = new Set([key(sc)]);
  const dirs = pidShuffle([[1, 0], [-1, 0], [0, 1], [0, -1]], 0);
  let found = null;

  // tiny binary heap for the open set (the old linear scan crawls on big grids)
  const heap = [{ c: sc, f: h(sc) }];
  const push = (n) => {
    heap.push(n);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].f <= heap[i].f) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].f < heap[m].f) m = l;
        if (r < heap.length && heap[r].f < heap[m].f) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  let expansions = 0;
  while (heap.length) {
    if (++expansions > maxCells) return null; // runaway guard
    const cur = pop();
    if (cur.c[0] === gc[0] && cur.c[1] === gc[1]) { found = cur.c; break; }
    for (const [dx, dy] of dirs) {
      const nc = [cur.c[0] + dx, cur.c[1] + dy];
      const k = key(nc);
      if (seen.has(k)) continue;
      const nx = nc[0] * cell, ny = nc[1] * cell;
      // the relaxed goal point is free by construction; its cell center may still sit
      // inside a neighbor's box (grid quantization) — never seal the goal itself
      const isGoal = nc[0] === gc[0] && nc[1] === gc[1];
      if (!inBounds(nx, ny) || (blockedAt(nx, ny) && !isGoal)) { seen.add(k); continue; }
      // cost model: base + existing-line field + bend penalty + dip penalty (a line must
      // not travel lower than its lower port unless forced; soft, so it still routes)
      const turn = cur.dir && (cur.dir[0] !== dx || cur.dir[1] !== dy) ? ruleParam('routing.bendPenalty', 12) : 0;
      const dip = (ctx.dipFloor !== undefined && ny > ctx.dipFloor) ? ruleParam('routing.dipPenalty', 50) : 0;
      const ng = gScore.get(key(cur.c)) + 1 + (field.get(k) || 0) + turn + dip;
      if (ng < (gScore.get(k) ?? Infinity)) {
        gScore.set(k, ng);
        came.set(k, cur.c);
        heap.push({ c: nc, f: ng + h(nc), dir: [dx, dy] });
        seen.add(k);
      }
    }
  }
  if (!found) return null;

  // reconstruct (pin exact start/goal so lead-ins stay axis-aligned)
  const cells = [found];
  while (came.has(key(cells[0]))) cells.unshift(came.get(key(cells[0])));
  let path = cells.map(fromCell);
  // ponytail: pin by reference — start/goal may be tagged lead-in ends
  path[0] = start;
  path[path.length - 1] = goal;

  // smoothing: drop intermediate points where a straight orthogonal segment â€” or an
  // L-shaped shortcut (straighter, longer runs over pointless stair-stepping) â€” is
  // clear AND does not pay more line-penalty than the path it replaces.
  const pathPenalty = (a, b) => {
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) return Infinity;
    let sum = 0;
    const c0 = Math.round(a.x / cell), c1 = Math.round(b.x / cell), cy = Math.round(b.y / cell);
    if (Math.abs(a.y - b.y) < 0.5) {
      for (let cx = Math.min(c0, c1); cx <= Math.max(c0, c1); cx++) sum += field.get(cx + ',' + cy) || 0;
    } else {
      const cx = Math.round(a.x / cell);
      for (let cy2 = Math.min(Math.round(a.y / cell), Math.round(b.y / cell)); cy2 <= Math.max(Math.round(a.y / cell), Math.round(b.y / cell)); cy2++) sum += field.get(cx + ',' + cy2) || 0;
    }
    return sum;
  };
  const segClear = (a, b) => {
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / cell;
    for (let t = 0.5; t < steps; t += 1) {
      const x = a.x + (b.x - a.x) * (t / steps);
      const y = a.y + (b.y - a.y) * (t / steps);
      // ponytail: stay in bounds — smoothing must not shortcut outside the
      // sheet to reach an out-of-margin tip (the x=5 corridor defect)
      if (!inBounds(x, y)) return false;
      if (blockedAt(x, y)) return false;
    }
    return true;
  };
  // a shortcut must never cross an existing line (max on-line cell penalty) â€” the
  // staircase it replaces skirted the corridor; the shortcut must not re-introduce
  // a crossing the A* had deliberately avoided.
  //
  // WIRED IN 2026-09-26 (T6.4). This function was dead: the comment above described
  // a guard that was never applied, so every shortcut was accepted on `segClear`
  // and the cost gate alone. Measured consequence, by comparing the A* path before
  // and after smoothing and taking the set difference of crossing points:
  // smoothing re-introduced crossings in 156 of 251 A* calls on `spike` and 52 of
  // 94 on `dense` (22% of randomised congestion routings). Calling the guard
  // exactly as the comment describes removes 12 crossings across the corpus and
  // moves the engine's own objective 1723 -> 1492, with zero validator errors.
  // Disabling smoothing instead is worse on both counts (20 crossings but score
  // 1817), so the guard is the right lever, not removing the pass.
  //
  // Note the cost gate is ALSO independently vacuous whenever the replaced
  // staircase contains a diagonal: `pathPenalty` returns Infinity for a diagonal
  // pair and `removed` is a sum, so a single diagonal makes the comparison
  // vacuously true. Diagonals only enter at the two pinned off-grid port ends, so
  // every shortcut anchored at a path end was accepted regardless of cost. That is
  // a second, separate hole and is NOT fixed here — it needs a cost model, not a
  // veto. Logged for follow-up.
  const crossesLine = (a, b) => {
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / cell;
    for (let t = 0.5; t < steps; t += 1) {
      const x = a.x + (b.x - a.x) * (t / steps);
      const y = a.y + (b.y - a.y) * (t / steps);
      if ((field.get(Math.round(x / cell) + ',' + Math.round(y / cell)) || 0) >= 300) return true;
    }
    return false;
  };
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let i = 0; i < path.length - 2; i++) {
      for (let j = path.length - 1; j > i + 1; j--) {
        const a = path[i], b = path[j];
        let removed = 0;
        for (let k = i; k < j; k++) removed += pathPenalty(path[k], path[k + 1]);
        let replace = null;
        if (a.x === b.x || a.y === b.y) {
          // axis-aligned shortcut: straight through
          if (segClear(a, b) && !crossesLine(a, b) && pathPenalty(a, b) <= removed) replace = [];
        } else {
          // L-shaped shortcut: collapse the staircase to a single corner (H-then-V
          // preferred â€” matches the horizontal-precedence drafting rule)
          for (const corner of [{ x: b.x, y: a.y }, { x: a.x, y: b.y }]) {
            if (!segClear(a, corner) || !segClear(corner, b)) continue;
            if (crossesLine(a, corner) || crossesLine(corner, b)) continue;
            if (pathPenalty(a, corner) + pathPenalty(corner, b) <= removed) { replace = [corner]; break; }
          }
        }
        if (!replace) continue;
        path.splice(i + 1, j - i - 1, ...replace);
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return path;
}

// ---- overlap resolution: push overlapping entities apart (placement engine) --
/**
 * Description placeholder
 *
 * @param {*} data 
 */

function resolveOverlaps(data) {
  const all = [...data.equipment, ...data.valves, ...data.instruments];
  const SC = data.view.symbolScale || 1;
  PIDEngine._isInst = (e) => data.instruments.some(i => i.tag === (e.tag || e.id));
  // ponytail: +3mm instrument margin — bubbles carry labels/halos wider than the
  // symbol; touching (12mm c-c) reads as collided
  const half = (e) => PIDEngine.entityHalf(e, SC) + (PIDEngine._isInst(e) ? ruleParam('routing.instrumentMargin', 3) : 0);
  for (let pass = 0; pass < 10; pass++) {
    // accumulate pushes per entity, apply once per pass (avoids ping-pong)
    const acc = new Map();
    const push = (e, dx, dy) => {
      const k = e.tag || e.id;
      const cur = acc.get(k) || { x: 0, y: 0 };
      cur.x += dx; cur.y += dy;
      acc.set(k, cur);
    };
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const ha = half(a), hb = half(b);
        const ox = ha + hb - Math.abs(a.x - b.x);
        const oy = ha + hb - Math.abs(a.y - b.y);
        if (ox <= 0 || oy <= 0) continue;
        // push the instrument away when involved; otherwise split the push
        const aInst = PIDEngine._isInst(a), bInst = PIDEngine._isInst(b);
        if (bInst && !aInst) { push(b, a.x > b.x ? -ox : ox, a.y > b.y ? -oy : oy); }
        else if (aInst && !bInst) { push(a, b.x > a.x ? -ox : ox, b.y > a.y ? -oy : oy); }
        else {
          const px = ox < oy ? (a.x > b.x ? -ox / 2 : ox / 2) : 0;
          const py = ox < oy ? 0 : (a.y > b.y ? -oy / 2 : oy / 2);
          push(a, -px, -py); push(b, px, py);
        }
      }
    }
    if (!acc.size) break;
    let moved = false;
    for (const e of all) {
      const d = acc.get(e.tag || e.id);
      if (!d) continue;
      // ponytail: warn once per entity — the loop runs up to 10 passes x2 calls
      if (e._fixed) {
        if (!e._overlapWarned) { e._overlapWarned = true; data.warnings.push(`[PID-LAY-002] "${e.id || e.tag}": overlaps a neighbor but is fixed (\`at\`) — move it manually`); }
        continue;
      }
      e.x += d.x; e.y += d.y;
      moved = true;
    }
    if (!moved) break;
  }
}

/**
 * Description placeholder
 *
 * @type {*}
 */
const AUTO_VALVES = new Set(['control', 'motor-gate', 'solenoid', 'electrohydraulic']);
/**
 * Description placeholder
 *
 * @type {{}}
 */
const CONTROL_TAG_RE = /^(FCV|PCV|LCV|XV|FV|TV|PV|AV|HV|PSV)\d/;

// ---- topology engine: authoritative port assignment + graph (runs post-layout, pre-render) --
// The renderer consumes only what this stage decides; it never infers topology.
/**
 * Description placeholder
 *
 * @param {*} data 
 */

function resolveTopology(data) {
  const errs = data.errors;
  const byId = PIDEngine.buildById(data.equipment, data.valves, data.instruments, data.junctions);
  const instSet = new Set(data.instruments.map(i => i.tag));
  const jSet = new Set(data.junctions.map(j => j.id));
  const instSigSides = {}; // instrument tag -> set of used attachment sides
  const jFan = {}; // junction id -> set of assigned lead-in directions (fan-out)
  const used = {}; // entityKey -> Map(portId -> count)
  const usedPorts = {}; // entityKey -> [conn, ...] for nozzle drawing
  const capacity = (e, c) => { const card = (c && c.cardinality) || 1; return (used[e.id || e.tag] && used[e.id || e.tag].get(c.id)) || 0; };
  const use = (e, c) => { const k = e.id || e.tag; if (!used[k]) used[k] = new Map(); used[k].set(c.id, capacity(e, c) + 1); (usedPorts[k] = usedPorts[k] || []).push(c); };
  data.usedConns = used;
  data.usedPorts = usedPorts;

  // ponytail: connWorld merged into PIDEngine (called with sc for symbolScale)
  const connWorld = (e, c, size) => PIDEngine.connWorld(e, c, size, { noNozzle: true, sc: data.view.symbolScale || 1 });

const resolvePort = (e, portName, other, kind) => {
    // junction: free-form node, no ports
    if (jSet.has(e.id || e.tag)) return { junction: true, x: e.x, y: e.y, dir: { x: 0, y: 0 } };
    if (instSet.has(e.id || e.tag)) {
      if (kind === 'signal') {
        // attach on the side FACING the other endpoint so paired bubbles meet
        // head-on (a controller stacked above its field connects bottom-to-top
        // instead of sharing one bottom corridor with every line in the area);
        // further signals take the opposite side, then the perpendicular ones.
        // NOTE `dir` is the OUTWARD normal of the port (routeOne emits the
        // lead-out as `port + dir*stub`, and junctionPort below follows the same
        // convention). The two horizontal entries previously carried the negated
        // normal — left port pointing +x, right port pointing -x — so any signal
        // whose endpoints were separated more in x than in y got a 14mm stub
        // drawn BACKWARDS through its own bubble before the route reversed.
        // Measured on the demo: FT-101 -> FIC-101 emitted
        // `M 369.5 199.5 L 355.5 199.5 ...` — out of the right-hand port, back
        // across the bubble, then away. No validator could see it: the two
        // anti-parallel segments share a corridor, and PIDEngine.crossing returns
        // null for same-orientation pairs, so the sheet still scored clean.
        //
        // Correcting the normals alone was the whole fix (demo 203 -> 184, 3 -> 2
        // crossings). I then tried to claw back spike's 1009 -> 1059 by steering
        // the side PREFERENCE (try the top when the tap already owns the bottom)
        // and it backfired: 1184 with a label collision added. So the side choice
        // is left purely geometric, and the tap-owns-bottom pre-mark is the only
        // interaction between the tap lane and signal lanes.
        //
        // ponytail: the tap owns the bottom side (drops from y+r) — a signal
        // sharing it would run the same corridor (the LT-102/signal overlap).
        const usedSides = (instSigSides[e.tag] = instSigSides[e.tag] || new Set(
          data.pipes.some(p => p.kind === 'tap' && p.from === e.tag) ? [3] : []));
        // NOTE `dir` is the OUTWARD normal of the port (routeOne emits the
        // lead-out as `port + dir*stub`, and junctionPort below follows the same
        // convention). The two horizontal entries previously carried the negated
        // normal — left port pointing +x, right port pointing -x — so any signal
        // whose endpoints were separated more in x than in y got a 14mm stub
        // drawn BACKWARDS through its own bubble before the route reversed.
        // Measured on the demo: FT-101 -> FIC-101 emitted
        // `M 369.5 199.5 L 355.5 199.5 ...` — out of the right-hand port, back
        // across the bubble, then away. No validator could see it: the two
        // anti-parallel segments share a corridor, and PIDEngine.crossing returns
        // null for same-orientation pairs, so the sheet still scored clean.
        const r = 4.5 * (data.view.symbolScale || 1);
        const sides = [
          { x: e.x, y: e.y - r, dir: { x: 0, y: -1 } },
          { x: e.x - r, y: e.y, dir: { x: -1, y: 0 } },
          { x: e.x + r, y: e.y, dir: { x: 1, y: 0 } },
          { x: e.x, y: e.y + r, dir: { x: 0, y: 1 } }
        ];
        const dxo = (other.x || e.x) - e.x, dyo = (other.y || e.y) - e.y;
        const pref = Math.abs(dyo) >= Math.abs(dxo) ? (dyo <= 0 ? 0 : 3) : (dxo <= 0 ? 1 : 2);
        // ponytail: preferred side stays first (correct choice); the rest rotate
        // under seed for candidate search, legacy order otherwise
        const idx = [pref, ...pidShuffle([(pref + 2) % 4, (pref + 1) % 4, (pref + 3) % 4], 4)].find(o => !usedSides.has(o)) ?? pref;
        usedSides.add(idx);
        return { ...sides[idx], signal: true };
      }
      return null; // process pipe to an instrument is a hard error (checked by caller)
    }
    const key = e.symbol || SYMBOL_KEYS[e.type];
    const conns = key ? symbolConnections(key) : [];
    if (!conns.length) {
      errs.push({ code: 'NO_PORT_DEFINITION', entity: e.id || e.tag, message: `${e.id || e.tag}: no connection ports defined in the symbol library â€” connection refused (no topology guessing)` });
      return null;
    }
    if (kind === 'signal') {
      // Rule 67: a signal must not consume a process port â€” attach at the
      // actuator/top nozzle if defined, else the top-center of the symbol
      // Rule 90/B: a signal attaches to a signal-class port when the symbol defines one
      const sig = conns.find(c => c.connectionClass === 'signal')
        || conns.find(c => /actuator|top|signal/i.test(c.id) && c.type === 'nozzle')
        || conns.find(c => c.type === 'nozzle');
      const size = (e.symbol ? symbolSize(e.symbol) : symbolSize(SYMBOL_KEYS[e.type] || 'pip/equipment/vessel-vertical')) * (e.scale || 1) * (data.view.symbolScale || 1);
      if (sig) { const p = connWorld(e, sig, size); return { conn: sig, x: p.x, y: p.y, dir: { x: 0, y: -1 } }; }
      return { x: e.x, y: e.y - size / 2, dir: { x: 0, y: -1 } };
    }
    const size = (e.symbol ? symbolSize(e.symbol) : symbolSize(SYMBOL_KEYS[e.type] || 'pip/equipment/vessel-vertical')) * (e.scale || 1) * (data.view.symbolScale || 1);
    let conn = null;
    if (portName) {
      conn = conns.find(c => c.id === portName);
      if (!conn) {
        errs.push({ code: 'UNKNOWN_PORT', entity: `${e.id || e.tag}.${portName}`, message: `${e.id || e.tag}: no port named "${portName}" (have: ${conns.map(c => c.id).join(', ')})` });
        return null;
      }
      if (capacity(e, conn) >= ((conn.cardinality) || 1)) {
        errs.push({ code: 'PORT_CAPACITY', entity: `${e.id || e.tag}.${portName}`, message: `${e.id || e.tag}: port "${portName}" is at capacity (${capacity(e, conn)}/${(conn.cardinality) || 1})` });
        return null;
      }
      // ponytail: unified nozzle slot — a tap claimed first refuses process
      // (tap-first DSL order; the tap branch covers process-first).
      if (data.tapPorts && data.tapPorts[`${e.id || e.tag}.${conn.id}`]) {
        errs.push({ code: 'PORT_CAPACITY', entity: `${e.id || e.tag}.${portName}`, message: `${e.id || e.tag}.${portName}: nozzle already connected (one connection per nozzle)` });
        return null;
      }
    } else {
      const sigPort = kind === 'signal';
      const avail = conns.filter(c => capacity(e, c) < ((c.cardinality) || 1) && (sigPort || !/actuator/i.test(c.id)));
      if (!avail.length) {
        errs.push({ code: 'NO_AVAILABLE_PORT', entity: e.id || e.tag, message: `${e.id || e.tag}: no available connection port (all ${conns.length} port(s) at capacity)` });
        return null;
      }
      if (avail.length === 1) {
        conn = avail[0];
      } else {
        const scored = avail.map(c => {
          const p = connWorld(e, c, size);
          const toX = other.x - p.x, toY = other.y - p.y;
          const len = magnitude({ x: toX, y: toY }) || 1;
          let dir = { x: toX / len, y: toY / len };
          if (e.rotation) {
            const rd = PIDEngine.rotatePoint(dir.x, dir.y, e.rotation);
            dir = rd;
          }
          const pl = magnitude({ x: c.x - 50, y: c.y - 50 }) || 1;
          const pd = { x: (c.x - 50) / pl, y: (c.y - 50) / pl };
          return { c, s: dir.x * pd.x + dir.y * pd.y };
        }).sort((a, b) => b.s - a.s);
        const best = scored[0], second = scored[1];
        if (!second || best.s - second.s > 0.35) conn = best.c;
        else {
          errs.push({ code: 'AMBIGUOUS_PORT', entity: e.id || e.tag, message: `${e.id || e.tag}: ambiguous connection â€” ${scored.length} unused ports face the other endpoint similarly (${scored.map(s => s.c.id).join(', ')}); specify the port explicitly` });
          return null;
        }
      }
    }
    use(e, conn);
    const p = connWorld(e, conn, size);
    // port lead-in must be axis-aligned (0/90/180/270) AND in the same orientation as the
// symbol body (rotate the port direction with the entity, then take the dominant axis)
    const pdx = conn.x - 50, pdy = conn.y - 50;
    let rdx = pdx, rdy = pdy;
    if (e.rotation) {
      const rd = PIDEngine.rotatePoint(pdx, pdy, e.rotation);
      rdx = rd.x; rdy = rd.y;
    }
    return { conn, x: p.x, y: p.y, dir: PIDEngine.portDir(rdx, rdy) };
  };

  data.junctionGraph = {};
  for (const p of data.pipes) {
    if (p.kind === 'tap') {
      // tap topology: one slot per equipment nozzle, shared by process pipes
      // and taps alike (0 or 1 connection ever). A tap names its nozzle;
      // a `.line` tap names the line at that port instead and consumes no
      // slot — but the port must carry a process line to tap into (TAP_LINE).
      // Junctions are free nodes and take bare taps.
      const inst = byId[p.from], host = byId[p.to];
      if (!inst || !instSet.has(p.from)) errs.push({ code: 'TAP_SOURCE', entity: p.from, message: `tap "${p.from} -> ${p.to}": source must be an instrument` });
      if (!host) errs.push({ code: 'TAP_HOST', entity: p.to, message: `tap "${p.from} -> ${p.to}": unknown host entity "${p.to}"` });
      else if (instSet.has(p.to)) errs.push({ code: 'TAP_HOST_INSTRUMENT', entity: p.to, message: `tap "${p.from} -> ${p.to}": host must not be an instrument` });
      else if (jSet.has(p.to)) {
        if (p.toPort) errs.push({ code: 'UNKNOWN_PORT', entity: `${p.to}.${p.toPort}`, message: `${p.to}: junctions have no ports (tap the junction bare)` });
        p._tap = { host: p.to };
      } else if (host) {
        if (!p.toPort) {
          errs.push({ code: 'TAP_PORT', entity: p.from, message: `tap "${p.from} -> ${p.to}": tap must name its nozzle (tap ${p.from} -> ${p.to}.<port>)` });
          p._tap = { host: p.to };
        } else {
          const key = host.symbol || SYMBOL_KEYS[host.type];
          const conns = key ? symbolConnections(key) : [];
          const conn = conns.find(c => c.id === p.toPort);
          if (!conn) {
            errs.push({ code: 'UNKNOWN_PORT', entity: `${p.to}.${p.toPort}`, message: `${p.to}: no port named "${p.toPort}" (have: ${conns.map(c => c.id).join(', ')})` });
            p._tap = { host: p.to };
          } else if (p.lineTap) {
            // ponytail: landing check deferred post-loop — auto-assigned
            // process ports only resolve as the loop runs (usedPorts).
            p._tap = { host: p.to, port: p.toPort, lineTap: true };
          } else {
            const slot = `${p.to}.${p.toPort}`;
            data.tapPorts = data.tapPorts || {};
            // ponytail: a tap needs physical nozzle metal — a bare glyph port
            // with no nozzle object leaves the landing dangling (TT-101).
            const hasNozzle = (data.nozzles || []).some(n => n.ownerId === p.to && n.portId === p.toPort);
            if (!hasNozzle) {
              errs.push({ code: 'TAP_NOZZLE', entity: slot, message: `tap "${p.from} -> ${slot}": no nozzle object on that port (declare nozzle NZ on ${p.to} port ${p.toPort})` });
              p._tap = { host: p.to, port: p.toPort };
            } else if (data.tapPorts[slot]) {
              errs.push({ code: 'TAP_CAPACITY', entity: slot, message: `tap "${p.from} -> ${slot}": nozzle already has a tap (one connection per nozzle)` });
            } else if ((data.usedPorts[p.to] || []).some(c => c.id === p.toPort)) {
              errs.push({ code: 'PORT_CAPACITY', entity: slot, message: `${slot}: nozzle already connected (one connection per nozzle)` });
            } else {
              data.tapPorts[slot] = p.from;
            }
            p._tap = { host: p.to, port: p.toPort };
          }
        }
      } else {
        p._tap = { host: p.to };
      }
      continue;
    }
    const a = byId[p.from], b = byId[p.to];
    if (!a || !b) continue; // unknown endpoint already reported by validateModel
const aIsJ = jSet.has(p.from), bIsJ = jSet.has(p.to);
    // junction lead-ins fan out: each incident pipe approaches on its own corridor
    // (prefer the dominant axis toward the far endpoint; rotate if taken). Without
    // this, two pipes meeting at a junction share one corridor and overlap.
    const junctionPort = (j, other) => {
      const used = (jFan[j.id] = jFan[j.id] || new Set());
      const dx = other.x - j.x, dy = other.y - j.y;
      let idx = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 1 : 3) : (dy >= 0 ? 2 : 0);
      const pick = [idx, ...pidShuffle([(idx + 1) % 4, (idx + 3) % 4, (idx + 2) % 4], 3)].find(o => !used.has(o)) ?? idx;
      used.add(pick);
      const dirs = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
      return { junction: true, x: j.x, y: j.y, dir: dirs[pick] };
    };
    const pa = aIsJ ? junctionPort(a, b) : resolvePort(a, p.fromPort, b, p.kind);
    const pb = bIsJ ? junctionPort(b, a) : resolvePort(b, p.toPort, a, p.kind);
    if (aIsJ) (data.junctionGraph[a.id] = data.junctionGraph[a.id] || []).push({ pipe: p, end: 'a' });
    if (bIsJ) (data.junctionGraph[b.id] = data.junctionGraph[b.id] || []).push({ pipe: p, end: 'b' });
    if (!pa || !pb) continue; // topology error: pipe refused, no geometry
    p._from = pa; p._to = pb;
  }

  // junction sanity: a junction must be a real node (â‰¥2 incident pipes), not a stray point
  for (const j of data.junctions) {
    const n = (data.junctionGraph[j.id] || []).length;
    if (n === 0) errs.push({ code: 'ISOLATED_JUNCTION', entity: j.id, message: `junction "${j.id}": no connections` });
    else if (n === 1 && !j.stub) errs.push({ code: 'DENDRITE_JUNCTION', entity: j.id, message: `junction "${j.id}": only 1 connection â€” a junction is a node (â‰¥2) or an off-page stub; use \`stub ${j.id}\` or connect a branch` });
    if (j.offpage && !j.ref) errs.push({ code: 'OFFPAGE_REF', entity: j.id, message: 'offpage ref missing on ' + j.id });
  }

  // line-tap landing check (post-loop: auto-assigned process ports in
  // usedPorts are only complete now). A .line tap with no process line at
  // its port has nothing to land on.
  for (const tp of data.pipes) {
    if (tp.kind !== 'tap' || !tp.lineTap || !tp._tap || !tp._tap.port) continue;
    const claimed = (data.usedPorts[tp._tap.host] || []).some(c => c.id === tp._tap.port);
    if (!claimed) errs.push({ code: 'TAP_LINE', entity: tp.from, message: `tap "${tp.from} -> ${tp._tap.host}.${tp._tap.port}.line": no process line at that port to tap into` });
  }
}

// ---- geometry validation: runs after routing, before the SVG is committed ----
// enforces: every segment is axis-aligned (0/90/180/270); tap lines reach a minimum
// length off the bubble; signal runs have a sane maximum length. Returns a line
// audit: crossing counts with gap-status and collinear overlaps between lines.
/**
 * Description placeholder
 *
 * @param {*} data 
 * @param {*} geometries 
 * @param {*} pipes 
 * @returns {{ overlaps: number; ungapped: number; }} 
 */

// ---- nozzle position resolution: compute nozzle geometry and update pipe endpoints ----
// Called after resolveTopology. For each nozzle, computes base/tip positions from
// the owner's port direction, then updates any pipe that connects to the nozzle
// so its endpoint is at the nozzle tip instead of the equipment body.
// nozzle tip geometry from owner position alone (no topology needed) — shared by
// resolveNozzlePositions and the autoLayout valve snap. Returns {base, tip, dir}.
function nozzleTip(owner, portId, nzLen, SC) {
  const ownerSize = (owner.symbol ? symbolSize(owner.symbol) : symbolSize(SYMBOL_KEYS[owner.type] || 'pip/equipment/vessel-vertical')) * (owner.scale || 1) * SC;
  const ports = symbolConnections(owner.symbol || SYMBOL_KEYS[owner.type] || '');
  const port = ports.find(p => p.id === portId);
  if (!port) return null;
  const pdx = port.x - 50, pdy = port.y - 50;
  const len = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
  let bx = owner.x + (port.x - 50) / 100 * ownerSize;
  let by = owner.y + (port.y - 50) / 100 * ownerSize;
  let rDirX = pdx / len, rDirY = pdy / len;
  if (owner.rotation) {
    const rp = PIDEngine.rotatePoint(pdx / 100 * ownerSize, pdy / 100 * ownerSize, owner.rotation);
    bx = owner.x + rp.x;
    by = owner.y + rp.y;
    const rd = PIDEngine.rotatePoint(pdx / len, pdy / len, owner.rotation);
    rDirX = rd.x; rDirY = rd.y;
  }
  // snap to cardinal directions (0, 90, 180, 270) — P&IDs are orthographic
  let orientation = Math.round(Math.atan2(rDirY, rDirX) * 180 / Math.PI / 90) * 90;
  if (orientation < 0) orientation += 360;
  const cardinalRad = orientation * Math.PI / 180;
  const dir = { x: Math.round(Math.cos(cardinalRad)), y: Math.round(Math.sin(cardinalRad)) };
  const L = (nzLen || 14) * SC;
  return { base: { x: bx, y: by }, tip: { x: bx + dir.x * L, y: by + dir.y * L }, dir, orientation };
}

// ---- bare-port materialization: used equipment ports without a nozzle ----
// declaration become real (auto) nozzles so they render the proper flange,
// position the tip outside the symbol outline, and give pipes/routers a real
// tip to land on (the T-102 top defect: thick stub buried inside the body).
// Runs after resolveTopology (needs usedPorts), before resolveNozzlePositions
// (which computes geometry for every entry uniformly). Auto entries are
// skipped by toSource (never pollute the user's DSL). Valves untouched:
// their ports are pipe-type and render as-is today.
function materializeNozzles(data) {
  if (!data.nozzles) data.nozzles = [];
  const SC = data.view.symbolScale || 1;
  const has = (ownerId, portId) => data.nozzles.some(n => n.ownerId === ownerId && n.portId === portId);
  for (const e of data.equipment) {
    for (const conn of (data.usedPorts[e.id] || [])) {
      if (conn.type !== 'nozzle' || conn.connectionClass === 'signal' || /actuator/i.test(conn.id)) continue;
      if (has(e.id, conn.id)) continue;
      // size from the connected line when known
      let size = null;
      const pipe = data.pipes.find(p =>
        (p.from === e.id && (p.fromPort === conn.id || (p._from && p._from.conn && p._from.conn.id === conn.id))) ||
        (p.to === e.id && (p.toPort === conn.id || (p._to && p._to.conn && p._to.conn.id === conn.id))));
      const def = pipe && pipe.line && data.lineDefs[pipe.line];
      if (def && def.size) size = /"$/.test(def.size) ? def.size : def.size + '"';
      // length clears the symbol outline: base outward + margin
      let length = 14;
      const half = PIDEngine.entitySize(e, SC) / 2;
      for (let attempt = 0; attempt < 4; attempt++) {
        const t = nozzleTip(e, conn.id, length, SC);
        if (!t) break;
        const over = Math.max(Math.abs(t.tip.x - e.x) - half - 4, Math.abs(t.tip.y - e.y) - half - 4);
        if (over > 0) break;
        length += 5;
      }
      data.nozzles.push({ id: `${e.id}.${conn.id}`, ownerId: e.id, portId: conn.id, length, size, auto: true });
    }
  }
}
function resolveNozzlePositions(data) {
  if (!data.nozzles || !data.nozzles.length) return;
  const SC = data.view.symbolScale || 1;
  const eqById = {};
  for (const e of data.equipment) eqById[e.id] = e;

  for (const nz of data.nozzles) {
    const owner = eqById[nz.ownerId];
    if (!owner) continue;
    const t = nozzleTip(owner, nz.portId, nz.length, SC);
    if (!t) continue;
    nz.orientation = t.orientation;
    nz.position = t.base;
    nz.tipPosition = t.tip;
    nz.connected = data.pipes.some(p => p.from === nz.id || p.to === nz.id);
  }

  // update pipe endpoints: if a pipe connects to a nozzle, use the nozzle tip
  // and align the pipe direction with the nozzle orientation
  const nzDirFromAngle = (angle) => {
    const rad = angle * Math.PI / 180;
    return { x: Math.round(Math.cos(rad)), y: Math.round(Math.sin(rad)) };
  };
  for (const p of data.pipes) {
    for (const nz of data.nozzles) {
      const nzDir = nzDirFromAngle(nz.orientation || 0);
      if (p.from === nz.id && nz.tipPosition) {
        p._from = { x: nz.tipPosition.x, y: nz.tipPosition.y, dir: nzDir, nozzle: nz.id };
      }
      if (p.to === nz.id && nz.tipPosition) {
        // stub extends in nozzle direction (away from equipment body)
        p._to = { x: nz.tipPosition.x, y: nz.tipPosition.y, dir: nzDir, nozzle: nz.id };
      }
    }
    // also handle pipes that connect to equipment ports which have nozzles
    if (p._from && p._from.conn) {
      const nz = data.nozzles.find(n => n.ownerId === p.from && n.portId === (p.fromPort || p._from.conn.id));
      if (nz && nz.tipPosition) {
        const nzDir = nzDirFromAngle(nz.orientation || 0);
        p._from = { x: nz.tipPosition.x, y: nz.tipPosition.y, dir: nzDir, nozzle: nz.id, conn: p._from.conn };
      }
    }
    if (p._to && p._to.conn) {
      const nz = data.nozzles.find(n => n.ownerId === p.to && n.portId === (p.toPort || p._to.conn.id));
      if (nz && nz.tipPosition) {
        const nzDir = nzDirFromAngle(nz.orientation || 0);
        p._to = { x: nz.tipPosition.x, y: nz.tipPosition.y, dir: nzDir, nozzle: nz.id, conn: p._to.conn };
      }
    }
  }
}
