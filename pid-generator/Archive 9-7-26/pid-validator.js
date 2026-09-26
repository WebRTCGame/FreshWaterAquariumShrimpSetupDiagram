// P&ID Validator — geometry audit, semantic model validation, schema enforcement.
// Loaded fourth (after pid-parser.js).
// See pid-schema.js for the full type hierarchy.
function validateGeometry(data, geometries, pipes) {
  const w = data.warnings;
  const SHEET_W = data.view.sheetW || 864, SHEET_H = data.view.sheetH || 559;
  for (const g of geometries) {
    const pts = g.pts;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
      if (dx > 0.5 && dy > 0.5) {
        w.push(`[PID-GEO-001] geometry "${g.p.from} -> ${g.p.to}": non-orthogonal segment (${dx.toFixed(1)}x${dy.toFixed(1)}mm) — lines must run at 0/90/180/270°`);
      }
    }
    if (g.signal) {
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
      if (len > SHEET_W * ruleParam('routing.signalLenWarn', 0.55)) w.push(`[PID-SIG-002] signal "${g.p.from} -> ${g.p.to}": very long run (${Math.round(len)}mm) — instrument pair far apart; consider moving the receiver`);
    }
  }
  // Phase 3: every pipe must keep a straight run of >= MIN_PORT_RUN from each port
  // before its first bend. The router enforces this via the lead-in stub; this flags
  // any residual violation (e.g. a tiny span forced a shorter lead-in).
  // Phase 3: a bend may not sit within MIN_PORT_RUN of a port. Only flag when a
  // real bend exists near the port AND there was geometric room for a full
  // straight run (short L/straight routes are physically exempt).
  const MIN_PORT_RUN = ruleParam('routing.minPortRun', 14);
  const leadIn = (g, pts, pEnd) => {
    if (!pEnd || pEnd.junction || pts.length < 2) return;
    const idxLast = pts.length - 1;
    const isStart = pEnd === g.pA;
    const d0 = PIDEngine.dist(pts[0], pts[1]);
    const dN = PIDEngine.dist(pts[idxLast - 1], pts[idxLast]);
    const d1 = pts.length >= 3 ? PIDEngine.dist(pts[1], pts[2]) : Infinity;
    const dPrev = pts.length >= 3 ? PIDEngine.dist(pts[idxLast - 2], pts[idxLast - 1]) : Infinity;
    const hasBend = pts.length >= 3;
    // jogs under 5mm render as a straight line; flag only visible short lead-ins
    if (isStart && hasBend && d0 >= 5 && d0 < MIN_PORT_RUN - 0.5 && d0 + d1 > MIN_PORT_RUN * 2 + 4) {
      w.push(`[PID-GEO-002] geometry "${g.p.from} -> ${g.p.to}": port lead-in only ${d0.toFixed(1)}mm (< ${MIN_PORT_RUN}mm) — bend too close to the ${g.p.from} port`);
    }
    if (!isStart && hasBend && dN >= 5 && dN < MIN_PORT_RUN - 0.5 && dN + dPrev > MIN_PORT_RUN * 2 + 4) {
      w.push(`[PID-GEO-002] geometry "${g.p.from} -> ${g.p.to}": port lead-in only ${dN.toFixed(1)}mm (< ${MIN_PORT_RUN}mm) — bend too close to the ${g.p.to} port`);
    }
  };
  for (const g of geometries) {
    if (g.p.kind === 'tap') continue;
    leadIn(g, g.pts, g.pA);
    leadIn(g, g.pts, g.pB);
  }

  // taps: the instrument must reach the line â€” a tap shorter than the bubble radius
  // means the bubble is sitting on the pipe
  for (const p of pipes) {
    if (p.kind !== 'tap') continue;
    const hostGeom = collide.tapHostGeom(geometries, p._tap.host, p._tap.port);
    if (!hostGeom) continue;
    const inst = data.instruments.find(i => i.tag === p.from);
    if (!inst) continue;
    const r = 4.5 * (data.view.symbolScale || 1);
    const segs = [];
    const pts = hostGeom.pts;
    for (let k = 0; k < pts.length - 1; k++) {
      const s = pts[k], e2 = pts[k + 1];
      if (Math.abs(s.y - e2.y) < 0.5 && Math.abs(s.x - e2.x) > 5) segs.push({ x1: Math.min(s.x, e2.x), x2: Math.max(s.x, e2.x), y: s.y });
    }
    const seg = segs.filter(s => s.y >= inst.y && inst.x >= s.x1 - 2 && inst.x <= s.x2 + 2).sort((a, b) => a.y - b.y)[0]
      || segs.sort((a, b) => Math.abs(a.y - inst.y) - Math.abs(b.y - inst.y))[0];
    if (seg) {
      const reach = seg.y - (inst.y + r);
      if (Math.abs(reach) < ruleParam('taps.minReach', 3)) w.push(`[PID-INS-004] tap "${p.from} -> ${p._tap.host}": reach only ${Math.abs(reach).toFixed(1)}mm — instrument bubble is sitting on the line; move the instrument up`);
    }
  }

  // ---- line audit: crossings (with gap-status) and collinear overlaps ----
  // ponytail: box-through + off-sheet complete the audit→rule map ([5] and [9]
  // had no rule counterpart). Midpoint-in-central-half matches audit-svg.
  const SC = data.view.symbolScale || 1;
  const boxes = [...data.equipment, ...data.valves].map(e => ({ id: e.id, r: collide.entityBox(e, SC, false) }));
  for (const gg of geometries) {
    let flagged = false;
    for (const sgm of PIDEngine.segs(gg.pts)) {
      const mx = (sgm[0].x + sgm[1].x) / 2, my = (sgm[0].y + sgm[1].y) / 2;
      for (const b of boxes) {
        if (gg.p.from === b.id || gg.p.to === b.id) continue;
        const cx0 = b.r.x0 + (b.r.x1 - b.r.x0) * 0.25, cx1 = b.r.x1 - (b.r.x1 - b.r.x0) * 0.25;
        const cy0 = b.r.y0 + (b.r.y1 - b.r.y0) * 0.25, cy1 = b.r.y1 - (b.r.y1 - b.r.y0) * 0.25;
        if (mx > cx0 && mx < cx1 && my > cy0 && my < cy1) {
          w.push(`[PID-GEO-005] line "${gg.p.from} -> ${gg.p.to}" passes through ${b.id}`);
          flagged = true;
          break;
        }
      }
      if (flagged) break;
    }
  }
  const SB = PIDEngine.sheetBounds(data.view.sheetW, data.view.sheetH);
  // ponytail: L5 — declared edge nozzles excuse their tip AND its lead leg
  // (the full straight run extends past an edge tip by construction; Phase 4
  // gate 4 already exempts port-exact tips at the geometry level). Interior
  // excursions still warn.
  const NL = ruleParam('routing.nozzleLead', 14);
  const edgeNz = new Set((data.nozzles || []).filter(n => n.edge).map(n => n.id));
  const onEdgeLead = (gg, p) => [gg.p._from, gg.p._to].some(end => {
    if (!end || !end.nozzle || !edgeNz.has(end.nozzle) || !end.dir || (!end.dir.x && !end.dir.y)) return false;
    const bx = end.x + end.dir.x * NL, by = end.y + end.dir.y * NL;
    const horiz = Math.abs(end.dir.y) === 0;
    return horiz
      ? (Math.abs(p.y - end.y) < 0.5 && p.x >= Math.min(end.x, bx) - 0.5 && p.x <= Math.max(end.x, bx) + 0.5)
      : (Math.abs(p.x - end.x) < 0.5 && p.y >= Math.min(end.y, by) - 0.5 && p.y <= Math.max(end.y, by) + 0.5);
  });
  for (const gg of geometries) {
    const out = gg.pts.some(p => (p.x < SB.x0 || p.x > SB.x1 || p.y < SB.y0 || p.y > SB.y1) && !onEdgeLead(gg, p));
    if (out) w.push(`[PID-SHT-001] line "${gg.p.from} -> ${gg.p.to}" leaves the sheet`);
  }
  // ponytail: hard rule PID-GEO-006 — no line crosses any part of a nozzle.
  // Midpoint-in-box (same method as GEO-005); pipes terminating AT the nozzle
  // are skipped via their resolved nozzle id, not by endpoint entity (a pipe
  // to another port of the same equipment must still clear this flange).
  const nzBoxes = [];
  for (const nz of (data.nozzles || [])) {
    for (const r of collide.nozzleBoxes(nz, SC)) nzBoxes.push({ nz, r });
  }
  for (const gg of geometries) {
    let flagged = false;
    for (const sgm of PIDEngine.segs(gg.pts)) {
      const mx = (sgm[0].x + sgm[1].x) / 2, my = (sgm[0].y + sgm[1].y) / 2;
      for (const { nz, r } of nzBoxes) {
        if ((gg.p._from && gg.p._from.nozzle === nz.id) || (gg.p._to && gg.p._to.nozzle === nz.id)) continue;
        if (mx > r.x0 && mx < r.x1 && my > r.y0 && my < r.y1) {
          data.errors.push({ code: 'PID-GEO-006', message: `line "${gg.p.from} -> ${gg.p.to}" crosses nozzle ${nz.id}` });
          flagged = true;
          break;
        }
      }
      if (flagged) break;
    }
  }
  const GAP = ruleParam('routing.gapBreak', 4), MIN_RUN = ruleParam('routing.gapMinRun', 8);
  let overlaps = 0, ungapped = 0;
  const overlapList = [], ungappedList = [];
  const segList = geometries.map(g => PIDEngine.segs(g.pts));
  // stub-zone sharing: two lines meeting at a common endpoint necessarily share
  // the node's vicinity — only flag it when the shared run exceeds stub length
  const sharedEnd = (a, b) => [a.p.from, a.p.to].some(e => e === b.p.from || e === b.p.to);
  for (let i = 0; i < geometries.length; i++) {
    const a = geometries[i];
    for (let j = i + 1; j < geometries.length; j++) {
      const b = geometries[j];
      const minOl = sharedEnd(a, b) ? 20 : 3;
      for (const si of segList[i]) {
        for (const sj of segList[j]) {
          const h1 = Math.abs(si[0].y - si[1].y) < 0.5, h2 = Math.abs(sj[0].y - sj[1].y) < 0.5;
          // collinear overlap (two lines running along the same corridor)
          if (h1 && h2 && Math.abs(si[0].y - sj[0].y) < 1) {
            const s1 = Math.max(Math.min(si[0].x, si[1].x), Math.min(sj[0].x, sj[1].x));
            const s2 = Math.min(Math.max(si[0].x, si[1].x), Math.max(sj[0].x, sj[1].x));
            if (s2 - s1 > minOl) { overlaps++; if (overlapList.length < 8) overlapList.push(`${a.p.from}->${a.p.to} & ${b.p.from}->${b.p.to} overlap ${Math.round(s2 - s1)}mm at y=${Math.round(si[0].y)}`); }
          } else if (!h1 && !h2 && Math.abs(si[0].x - sj[0].x) < 1) {
            const s1 = Math.max(Math.min(si[0].y, si[1].y), Math.min(sj[0].y, sj[1].y));
            const s2 = Math.min(Math.max(si[0].y, si[1].y), Math.max(sj[0].y, sj[1].y));
            if (s2 - s1 > minOl) { overlaps++; if (overlapList.length < 8) overlapList.push(`${a.p.from}->${a.p.to} & ${b.p.from}->${b.p.to} overlap ${Math.round(s2 - s1)}mm at x=${Math.round(si[0].x)}`); }
          }
          // crossing whose gap would be cut too close to a bend (pass 3 skips it):
          // needs >= GAP+MIN_RUN of straight run on both sides on at least ONE of
          // the two lines for a FULL gap; the emitter still cuts a narrow gap at
          // ≥6.5mm — only narrower than that is reported here (reads as a join)
          const x = PIDEngine.crossing(si, sj);
          if (x && PIDEngine.isRealCrossing(si, sj)) {
            const run = (s) => {
              const len = Math.abs(s[0].x - s[1].x) + Math.abs(s[0].y - s[1].y);
              if (!len) return 0;
              const t = Math.abs((x.x - s[0].x) + (x.y - s[0].y)) / len;
              return Math.min(t * len, (1 - t) * len);
            };
            if (run(si) < 6.5 && run(sj) < 6.5) {
              ungapped++; if (ungappedList.length < 8) ungappedList.push(`${a.p.from}->${a.p.to} & ${b.p.from}->${b.p.to} at [${Math.round(x.x)},${Math.round(x.y)}]`);
            }
          }
        }
      }
    }
  }
  // Phase 2: a collinear overlap is a hard error (two lines may not share a corridor);
  // the routing pass resolves all resolvable ones, so any that remain are genuine.
  if (overlaps) data.errors.push({ code: 'COLLINEAR_OVERLAP', message: `line audit: ${overlaps} collinear overlap(s) â€” lines sharing a corridor (${overlapList.join('; ')})` });
  if (ungapped) w.push(`[PID-GEO-003] line audit: ${ungapped} crossing(s) without a gap break (too close to a bend; pass 3 skipped) (${ungappedList.join('; ')})`);
  return { overlaps, ungapped };
}

/**
 * Description placeholder
 *
 * @param {*} data 
 */
function validateModel(data) {
  const w = data.warnings;
  const seen = {};
  const named = [...data.equipment, ...data.valves, ...data.junctions];
  const idSet = new Set(named.map(e => e.id));
  const instSet = new Set(data.instruments.map(i => i.tag));
  const exists = (id) => idSet.has(id) || instSet.has(id);

  for (const e of named) {
    if (seen[e.id]) w.push(`[PID-TAG-001] duplicate id "${e.id}"`);
    seen[e.id] = true;
  }
  for (const i of data.instruments) {
    if (seen[i.tag]) w.push(`[PID-TAG-002] duplicate instrument tag "${i.tag}"`);
    seen[i.tag] = true;
  }
  for (const id of Object.keys(data.lineDefs)) {
    if (seen[id]) w.push(`[PID-TAG-003] duplicate line id "${id}"`);
    seen[id] = true;
  }
  // ponytail: bare sheets are legal sketches — warn once, not per field
  if (!data.view.title && !data.view.sheet && !data.view.rev) w.push(`[SCHEMA-061] sheet missing required metadata (title, sheet, or revision)`);

  for (const e of [...data.equipment, ...data.valves]) {
    if (!SYMBOL_KEYS[e.type] && !e.symbol) w.push(`[PID-SYM-001] "${e.id}": unknown entity type "${e.type}" (falls back to vessel glyph)`);
    // ponytail: custom symbol without legend — non-standard glyphs need a legend entry
    if (e.symbol && !data.view.legend) w.push(`[PID-SYM-002] "${e.id}": custom symbol without legend entry (legend on)`);
    const connected = data.pipes.some(p => p.from === e.id || p.to === e.id);
    if (!connected) w.push(`[PID-EQP-001] "${e.id}" (${e.type}): not connected to any pipe`);
  }

  for (const p of data.pipes) {
    if (!exists(p.from)) w.push(`[PID-REF-001] pipe "${p.from} -> ${p.to}": unknown source "${p.from}"`);
    if (!exists(p.to)) w.push(`[PID-REF-001] pipe "${p.from} -> ${p.to}": unknown target "${p.to}"`);
    for (const [end, port] of [[p.from, p.fromPort], [p.to, p.toPort]]) {
      if (!port) continue;
      const e = named.find(x => x.id === end);
      if (!e) continue;
      const key = e.symbol || SYMBOL_KEYS[e.type];
      if (key && !symbolConnections(key).some(c => c.id === port)) {
        w.push(`[PID-CON-001] pipe "${p.from} -> ${p.to}": port "${port}" does not exist on ${end}`);
      }
    }
    if (p.line && !data.lineDefs[p.line]) w.push(`[PID-REF-002] pipe "${p.from} -> ${p.to}": unknown line spec "${p.line}"`);
    if (p.kind !== 'signal' && p.kind !== 'tap') {
      // Rule 67/104/105: a process pipe must not terminate on an instrument bubble
      for (const end of [p.from, p.to]) {
        if (instSet.has(end)) w.push(`[PID-CON-002] process pipe "${p.from} -> ${p.to}": "${end}" is an instrument — connect through a process tap or junction`);
      }
    }
    if (p.kind === 'signal') {
      for (const end of [p.from, p.to]) {
        const e = data.valves.find(v => v.id === end) || data.equipment.find(q => q.id === end);
        const okAuto = e && (AUTO_VALVES.has(e.type) || /^(pump|compressor|fan|blower|turbine)/.test(e.type));
        if (!instSet.has(end) && !okAuto) w.push(`[PID-SIG-001] signal "${p.from} -> ${p.to}": "${end}" is neither an instrument, auto valve, nor rotating equipment`);
      }
    }
  }

  for (const inst of data.instruments) {
    const hasSignal = data.pipes.some(p => p.kind === 'signal' && (p.from === inst.tag || p.to === inst.tag));
    const hasTap = data.pipes.some(p => p.kind === 'tap' && (p.from === inst.tag || p.to === inst.tag));
    if (inst.bubble === 'dcs') {
      if (!hasSignal) w.push(`[PID-INS-003] DCS instrument "${inst.tag}": no signal connection`);
    } else if (!hasTap) {
      w.push(`[PID-INS-002] field instrument "${inst.tag}": no process tap (declare \`tap ${inst.tag} -> <line entity>\`)`);
    }
  }

  for (const v of data.valves) {
    if (!AUTO_VALVES.has(v.type)) continue;
    const hasSignal = data.pipes.some(p => p.kind === 'signal' && (p.from === v.id || p.to === v.id));
    const hasLoopTag = CONTROL_TAG_RE.test(v.tag || v.id);
    if (!hasSignal && !hasLoopTag) w.push(`[PID-VAL-001] valve "${v.id}" (${v.type}): no instrument loop or control-valve tag`);
    // ponytail: scoped to automated valves only — manual gates have no fail action
    if (!v.fail) w.push(`[PID-VAL-004] control valve "${v.id}" has no defined fail action`);
  }

  // Phase 5: control-valve conventions. A control valve's controller bubble (the
  // instrument it exchanges a signal with) should sit directly above the valve
  // with the actuator up; flag layouts that strand it off to the side.
  for (const v of data.valves) {
    const sig = data.pipes.find(p => p.kind === 'signal' && (p.from === v.id || p.to === v.id));
    if (!sig) continue;
    const ctrlTag = sig.from === v.id ? sig.to : sig.from;
    const ctrl = data.instruments.find(i => i.tag === ctrlTag);
    if (!ctrl || ctrl.at || ctrl.rel) continue;
    const dx = Math.abs(ctrl.x - v.x), dy = ctrl.y - v.y;
    if (!(dy < 0 && dx < 60)) w.push(`[PID-VAL-002] control valve "${v.id}": controller "${ctrlTag}" should sit directly above the valve (actuator up)`);
  }
}

//  symbol catalog 
/**
 * Description placeholder
 *
 * @param {*} data 
 */

function validateSemanticModel(data) {
  const all = [...data.equipment, ...data.valves, ...data.instruments, ...data.junctions];
  const byId = PIDEngine.buildById(data.equipment, data.valves, data.instruments, data.junctions);
  const process = data.pipes.filter(p => p.kind === 'process' && p._from && p._to);
  const signal = data.pipes.filter(p => p.kind === 'signal');
  const tap = data.pipes.filter(p => p.kind === 'tap');
  const edge = (p) => ({ from: p.from, to: p.to, fromPort: p.fromPort, toPort: p.toPort, line: p.line || null, pipelineId: p.line || null, kind: p.kind });

  // Keep the overlapping graphs separate; layout still consumes the original pipe list.
  data.graphs = {
    process: { nodes: all.map(e => e.id || e.tag), edges: process.map(edge) },
    signal: { nodes: all.map(e => e.id || e.tag), edges: signal.map(edge) },
    taps: { nodes: all.map(e => e.id || e.tag), edges: tap.map(edge) }
  };
  data.pipelines = Object.entries(data.lineDefs).map(([id, def]) => ({
    id, ...def, segments: process.filter(p => p.line === id).map(edge)
  }));
  for (const p of data.pipes) if (p.line) p.pipelineId = p.line;

  for (const e of data.equipment) {
    e.ports = symbolConnections(e.symbol || SYMBOL_KEYS[e.type] || '');
    e.semantic = { class: 'equipment', subtype: e.type, capabilities: /^pump|^compressor/.test(e.type) ? ['inlet', 'outlet', 'rotating'] : [] };
  }
  for (const v of data.valves) {
    v.ports = symbolConnections(v.symbol || SYMBOL_KEYS[v.type] || '');
    v.semantic = { class: 'valve', subtype: v.type, capabilities: ['inline', 'isolate'] };
    if (/^check/.test(v.type)) v.semantic.capabilities.push('directional', 'prevents_reverse_flow');
    if (AUTO_VALVES.has(v.type)) v.semantic.capabilities.push('actuated', 'control_signal');
  }
  for (const inst of data.instruments) {
    inst.semantic = { class: 'instrument', function: inst.functions || null, variable: inst.variable || null, location: inst.bubble || 'field' };
  }

  // Instrument loop identity comes from ISA tags, while an explicit loop records
  // the intended measurement/controller/final-element relationship.
  const loops = new Map();
  for (const inst of data.instruments) if (inst.loop) {
    const loop = loops.get(inst.loop) || { id: inst.loop, instruments: [], signals: [] };
    loop.instruments.push(inst.tag);
    loops.set(inst.loop, loop);
  }
  for (const p of signal) {
    const a = byId[p.from], b = byId[p.to];
    if (a && b && a.loop && a.loop === b.loop) {
      const loop = loops.get(a.loop) || { id: a.loop, instruments: [], signals: [] };
      loop.signals.push(edge(p));
      loops.set(a.loop, loop);
    }
  }
  for (const declared of data.loops) {
    const id = (declared.id.match(/(\d+)$/) || [null, declared.id])[1];
    const loop = loops.get(id) || { id, instruments: [], signals: [] };
    Object.assign(loop, declared, { id, loopTag: declared.id });
    loops.set(id, loop);
  }
  data.loops = [...loops.values()];

  const used = (e) => new Set((data.usedPorts[e.id || e.tag] || []).map(c => c.id));
  const processPortCount = (e) => (data.usedPorts[e.id] || []).filter(c => c.connectionClass === 'process').length;

  // Required-port checks are limited to unambiguous equipment classes. Generic
  // vessels and fittings have project-specific nozzle requirements.
  for (const e of [...data.equipment, ...data.valves]) {
    const t = e.type || '';
    if (/^pump(?:-|$)|^compressor(?:-|$)/.test(t)) {
      const ports = symbolConnections(e.symbol || SYMBOL_KEYS[e.type] || '');
      const inPort = ports.find(c => c.direction === 'in' && /suction|inlet/.test(c.id));
      const outPort = ports.find(c => c.direction === 'out' && /discharge|outlet/.test(c.id));
      if (inPort && !used(e).has(inPort.id)) data.errors.push({ code: 'REQUIRED_PORT', entity: `${e.id}.${inPort.id}`, message: `${e.id}: required suction/inlet port "${inPort.id}" is not connected` });
      if (outPort && !used(e).has(outPort.id)) data.errors.push({ code: 'REQUIRED_PORT', entity: `${e.id}.${outPort.id}`, message: `${e.id}: required discharge/outlet port "${outPort.id}" is not connected` });
    } else if (data.valves.includes(e) && processPortCount(e) < 2) {
      data.errors.push({ code: 'REQUIRED_PORT', entity: e.id, message: `${e.id}: valve requires two process connections` });
    }
  }

  for (const p of process) {
    const line = p.line && data.lineDefs[p.line];
    for (const endpoint of [p.from, p.to]) {
      const e = byId[endpoint];
      if (!e || !line) continue;
      if (line.size && e.size && Number.parseFloat(line.size) !== Number.parseFloat(e.size)) data.errors.push({ code: 'SIZE_MISMATCH', entity: `${p.from} -> ${p.to}`, message: `line "${p.line}" is size ${line.size}, but ${endpoint} is size ${e.size}; add a reducer or correct the size` });
      if (line.spec && e.spec && line.spec !== e.spec) data.errors.push({ code: 'SPEC_MISMATCH', entity: `${p.from} -> ${p.to}`, message: `line "${p.line}" uses spec ${line.spec}, but ${endpoint} uses spec ${e.spec}` });
    }
    if (p._from.conn && p._from.conn.direction === 'in' && !byId[p.from].stub) {
      data.errors.push({ code: 'PORT_DIRECTION', entity: `${p.from}.${p.fromPort || p._from.conn.id}`, message: `${p.from}: process flow starts at an inlet port` });
    }
    if (p._to.conn && p._to.conn.direction === 'out' && !byId[p.to].stub) {
      data.errors.push({ code: 'PORT_DIRECTION', entity: `${p.to}.${p.toPort || p._to.conn.id}`, message: `${p.to}: process flow terminates at an outlet port` });
    }
  }

  for (const v of data.valves.filter(v => /^check/.test(v.type))) {
    const incoming = process.filter(p => p.to === v.id), outgoing = process.filter(p => p.from === v.id);
    if (!incoming.length || !outgoing.length) data.warnings.push(`[PID-VAL-003] check valve "${v.id}": flow direction is not fully defined (needs upstream and downstream process connections)`);
  }

  const hasSignalEdge = (from, to) => signal.some(p => p.from === from && p.to === to);
  for (const loop of data.loops.filter(l => l.explicit)) {
    for (const key of ['measure', 'controller', 'manipulate']) {
      if (!byId[loop[key]]) data.errors.push({ code: 'LOOP_ENDPOINT', entity: loop.id, message: `loop "${loop.id}": unknown ${key} endpoint "${loop[key]}"` });
    }
    if (byId[loop.measure] && byId[loop.controller] && !hasSignalEdge(loop.measure, loop.controller)) data.errors.push({ code: 'LOOP_MEASUREMENT', entity: loop.id, message: `loop "${loop.id}": no signal from ${loop.measure} to ${loop.controller}` });
    if (byId[loop.controller] && byId[loop.manipulate] && !hasSignalEdge(loop.controller, loop.manipulate)) data.errors.push({ code: 'LOOP_OUTPUT', entity: loop.id, message: `loop "${loop.id}": no signal from ${loop.controller} to ${loop.manipulate}` });
  }

  for (const r of data.relationships) {
    if (!byId[r.from]) data.errors.push({ code: 'RELATIONSHIP_ENDPOINT', entity: r.from, message: `${r.kind || 'relationship'} "${r.from}": unknown source` });
    if (!byId[r.to]) data.errors.push({ code: 'RELATIONSHIP_ENDPOINT', entity: r.to, message: `${r.kind || 'relationship'} "${r.from}": unknown target "${r.to}"` });
  }
  for (const a of data.alarms) if (!byId[a.source]) data.errors.push({ code: 'ALARM_SOURCE', entity: a.id, message: `alarm "${a.id}": unknown source "${a.source}"` });
  for (const i of data.interlocks) {
    if (!byId[i.trigger] && !data.alarms.some(a => a.id === i.trigger)) data.errors.push({ code: 'INTERLOCK_TRIGGER', entity: i.id, message: `interlock "${i.id}": unknown trigger "${i.trigger}"` });
    if (!byId[i.action]) data.errors.push({ code: 'INTERLOCK_ACTION', entity: i.id, message: `interlock "${i.id}": unknown action "${i.action}"` });
  }
  for (const r of data.relationships) {
    if (r.kind === 'protected_by' && byId[r.from] && !data.valves.some(v => v.id === r.from && /^(relief|vacuum-relief|rupture)$/.test(v.type))) data.errors.push({ code: 'SAFETY_SOURCE', entity: r.from, message: `protects relationship must start at a relief device: "${r.from}"` });
    if (r.kind === 'discharges_to' && byId[r.from] && !data.valves.some(v => v.id === r.from && /^(relief|vacuum-relief|rupture)$/.test(v.type))) data.errors.push({ code: 'SAFETY_SOURCE', entity: r.from, message: `discharges relationship must start at a relief device: "${r.from}"` });
  }
  for (const v of data.valves.filter(v => /^(relief|vacuum-relief|rupture)$/.test(v.type))) {
    if (!data.relationships.some(r => r.kind === 'protected_by' && r.from === v.id)) data.warnings.push(`[PID-SAF-001] relief device "${v.id}": no protected equipment relationship`);
    if (!data.relationships.some(r => r.kind === 'discharges_to' && r.from === v.id)) data.warnings.push(`[PID-SAF-002] relief device "${v.id}": no discharge destination relationship`);
  }

  const processNodes = [...data.equipment, ...data.valves, ...data.junctions];
  const adjacency = Object.fromEntries(processNodes.map(e => [e.id, []]));
  for (const p of process) adjacency[p.from].push(p.to);
  const sources = Object.keys(adjacency).filter(id => !process.some(p => p.to === id));
  const sinks = Object.keys(adjacency).filter(id => !adjacency[id].length);
  const reachable = new Set(sources), queue = [...sources];
  while (queue.length) for (const next of adjacency[queue.shift()]) if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
  data.pathAnalysis = { sources, sinks, unreachable: Object.keys(adjacency).filter(id => !reachable.has(id)) };
  for (const id of data.pathAnalysis.unreachable) data.warnings.push(`[PID-TOP-001] process entity "${id}": unreachable from any directed process source`);
}

// ---- schema validation: enforces pid-schema.js constraints on every object ----

var VALID_OBJECT_TYPES = new Set(['equipment', 'valve', 'instrument', 'pipe', 'junction', 'nozzle', 'alarm', 'interlock', 'annotation', 'connector']);
var VALID_LIFECYCLE = new Set(['new', 'existing', 'modified', 'relocated', 'demolished', 'future', 'temporary', 'by-others']);
var VALID_DESIGN = new Set(['conceptual', 'preliminary', 'ifc', 'as-built']);
var VALID_BUBBLE = new Set(['field', 'panel', 'dcs', 'computer', 'plc']);

/**
 * Validate schema constraints on a single PidObject.
 * Returns an array of { code, message } errors/warnings.
 * @param {object} e - PidObject
 * @param {string} context - human-readable context for error messages
 * @returns {Array<{code: string, message: string, severity: string}>}
 */
function validateSchemaObject(e, context) {
  var msgs = [];
  var prefix = context || (e.id || e.tag || '?');

  // required fields
  if (!e.id && !e.tag) msgs.push({ code: 'SCHEMA-001', message: `${prefix}: missing required "id" or "tag"`, severity: 'error' });
  if (e.id !== undefined && typeof e.id !== 'string') msgs.push({ code: 'SCHEMA-002', message: `${prefix}: "id" must be a string`, severity: 'error' });

  // objectType enum
  if (e.objectType && !VALID_OBJECT_TYPES.has(e.objectType)) msgs.push({ code: 'SCHEMA-003', message: `${prefix}: invalid objectType "${e.objectType}"`, severity: 'error' });

  // lifecycleState enum
  if (e.lifecycleState !== undefined && e.lifecycleState !== null && !VALID_LIFECYCLE.has(e.lifecycleState)) msgs.push({ code: 'SCHEMA-004', message: `${prefix}: invalid lifecycleState "${e.lifecycleState}"`, severity: 'warning' });

  // designStatus enum
  if (e.designStatus !== undefined && e.designStatus !== null && !VALID_DESIGN.has(e.designStatus)) msgs.push({ code: 'SCHEMA-005', message: `${prefix}: invalid designStatus "${e.designStatus}"`, severity: 'warning' });

  // numeric fields
  if (e.x !== undefined && typeof e.x !== 'number') msgs.push({ code: 'SCHEMA-006', message: `${prefix}: "x" must be a number`, severity: 'error' });
  if (e.y !== undefined && typeof e.y !== 'number') msgs.push({ code: 'SCHEMA-007', message: `${prefix}: "y" must be a number`, severity: 'error' });
  if (e.rotation !== undefined && typeof e.rotation !== 'number') msgs.push({ code: 'SCHEMA-008', message: `${prefix}: "rotation" must be a number`, severity: 'error' });
  if (e.scale !== undefined && (typeof e.scale !== 'number' || e.scale <= 0)) msgs.push({ code: 'SCHEMA-009', message: `${prefix}: "scale" must be a positive number`, severity: 'warning' });

  // ports (equipment, valve, instrument)
  if (e.ports !== undefined && !Array.isArray(e.ports)) msgs.push({ code: 'SCHEMA-010', message: `${prefix}: "ports" must be an array`, severity: 'error' });

  // attributes
  if (e.attributes !== undefined && typeof e.attributes !== 'object') msgs.push({ code: 'SCHEMA-011', message: `${prefix}: "attributes" must be an object`, severity: 'warning' });

  // customProperties
  if (e.customProperties !== undefined && typeof e.customProperties !== 'object') msgs.push({ code: 'SCHEMA-012', message: `${prefix}: "customProperties" must be an object`, severity: 'warning' });

  // instrument-specific
  if (e.objectType === 'instrument') {
    if (e.bubble && !VALID_BUBBLE.has(e.bubble)) msgs.push({ code: 'SCHEMA-020', message: `${prefix}: invalid bubble "${e.bubble}"`, severity: 'warning' });
    if (!e.tag) msgs.push({ code: 'SCHEMA-021', message: `${prefix}: instrument missing required "tag"`, severity: 'error' });
  }

  // pipe-specific
  if (e.objectType === 'pipe') {
    if (!e.from) msgs.push({ code: 'SCHEMA-030', message: `${prefix}: pipe missing required "from"`, severity: 'error' });
    if (!e.to) msgs.push({ code: 'SCHEMA-031', message: `${prefix}: pipe missing required "to"`, severity: 'error' });
    if (!e.kind) msgs.push({ code: 'SCHEMA-032', message: `${prefix}: pipe missing required "kind"`, severity: 'error' });
  }

  // nozzle-specific
  if (e.objectType === 'nozzle') {
    if (!e.ownerId) msgs.push({ code: 'SCHEMA-050', message: `${prefix}: nozzle missing required "ownerId" (equipment)`, severity: 'error' });
    if (!e.portId) msgs.push({ code: 'SCHEMA-051', message: `${prefix}: nozzle missing required "portId"`, severity: 'error' });
    if (!e.size) msgs.push({ code: 'SCHEMA-052', message: `${prefix}: nozzle missing required "size"`, severity: 'error' });
  }

  // port validation
  if (Array.isArray(e.ports)) {
    for (const p of e.ports) {
      if (!p.id) msgs.push({ code: 'SCHEMA-040', message: `${prefix}: port missing required "id"`, severity: 'error' });
      if (typeof p.x !== 'number' || typeof p.y !== 'number') msgs.push({ code: 'SCHEMA-041', message: `${prefix}.${p.id}: port x/y must be numbers`, severity: 'error' });
      if (p.cardinality !== undefined && (typeof p.cardinality !== 'number' || p.cardinality < 1)) msgs.push({ code: 'SCHEMA-042', message: `${prefix}.${p.id}: cardinality must be >= 1`, severity: 'warning' });
    }
  }

  return msgs;
}

/**
 * Validate schema constraints on all objects in the model.
 * Sets validationState and validationMessages on each object.
 * @param {PidModel} data
 */
function validateSchema(data) {
  var all = [].concat(data.equipment, data.valves, data.instruments, data.pipes, data.junctions, data.nozzles || [], data.alarms, data.interlocks);
  var totalErrors = 0, totalWarnings = 0;

  // cross-reference sets
  var eqIds = new Set(data.equipment.map(e => e.id));
  var valveIds = new Set(data.valves.map(v => v.id));
  var allIds = new Set([...eqIds, ...valveIds, ...data.instruments.map(i => i.tag), ...data.junctions.map(j => j.id)]);

  for (const e of all) {
    if (!e) continue;
    var context = e.id || e.tag || '(unknown)';
    var msgs = validateSchemaObject(e, context);

    // nozzle cross-references
    if (e.objectType === 'nozzle') {
      if (e.ownerId && !eqIds.has(e.ownerId)) msgs.push({ code: 'SCHEMA-053', message: `${context}: ownerId "${e.ownerId}" references unknown equipment`, severity: 'error' });
      if (e.ownerId && e.portId) {
        var owner = data.equipment.find(eq => eq.id === e.ownerId);
        if (owner && owner.ports && !owner.ports.some(p => p.id === e.portId)) msgs.push({ code: 'SCHEMA-054', message: `${context}: portId "${e.portId}" does not exist on ${e.ownerId}`, severity: 'warning' });
      }
      // check nozzle size matches connected pipe
      if (e.size) {
        var connectedPipe = data.pipes.find(p => p.from === e.id || p.to === e.id);
        if (connectedPipe && connectedPipe.line && data.lineDefs[connectedPipe.line]) {
          var lineSize = data.lineDefs[connectedPipe.line].size;
          if (lineSize && e.size !== lineSize) msgs.push({ code: 'SCHEMA-055', message: `${context}: nozzle size ${e.size} does not match connected line size ${lineSize}`, severity: 'warning' });
        }
      }
    }

    e.validationMessages = msgs;
    var hasError = msgs.some(m => m.severity === 'error');
    var hasWarning = msgs.some(m => m.severity === 'warning');
    e.validationState = hasError ? 'error' : hasWarning ? 'warning' : 'valid';
    totalErrors += msgs.filter(m => m.severity === 'error').length;
    totalWarnings += msgs.filter(m => m.severity === 'warning').length;
  }

  data.schemaErrors = totalErrors;
  data.schemaWarnings = totalWarnings;
}

/**
 * Run all validation passes and wire results to objects.
 * Call this after validateGeometry, validateModel, validateSemanticModel.
 * @param {PidModel} data
 */
function finalizeValidation(data) {
  // wire data-level warnings/errors to each object
  var all = [].concat(data.equipment, data.valves, data.instruments, data.pipes, data.junctions, data.alarms, data.interlocks);
  for (const e of all) {
    if (!e) continue;
    // if not yet set by schema validation, default to unchecked
    if (!e.validationState) e.validationState = 'unchecked';
    if (!e.validationMessages) e.validationMessages = [];
  }

  // set data-level summary
  data.validationState = data.errors.length ? 'error' : data.warnings.length ? 'warning' : 'valid';
}