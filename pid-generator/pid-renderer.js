// P&ID Renderer — SVG rendering, annotations, public API.
// Loaded fifth (after pid-parser.js, pid-router.js, pid-validator.js).
// ponytail: model-side text boxes — every <text> the renderer emits is measured
// from its markup (same factors as audit-svg), so label-collision counts agree
// in node and browser. (Browser getBBox measures real glyphs; parity of the
// *metric* matters more than sub-pixel accuracy. See plan §External references.)
function pidTextBoxes(svgHtml) {
  const out = [];
  for (const m of svgHtml.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
    const a = m[1];
    // ponytail: decode entities before measuring — &quot; is 1 glyph, not 6
    // chars (phantom 10mm was flagging collisions that don't render)
    const content = m[2].trim().replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    if (!content) continue;
    const xm = a.match(/x="(-?[\d.]+)"/), ym = a.match(/y="(-?[\d.]+)"/), fm = a.match(/font-size="(-?[\d.]+)"/);
    if (!xm || !ym) continue;
    const fs = fm ? +fm[1] : 3, x = +xm[1], y = +ym[1];
    const vert = /rotate\(90/.test(a);
    const w0 = content.length * fs * 0.55, h0 = fs * 1.15;
    const w = vert ? h0 : w0, h = vert ? w0 : h0;
    const mid = /text-anchor="middle"/.test(a);
    out.push({ x0: mid ? x - w / 2 : x, x1: mid ? x + w / 2 : x + w, y0: y - h, y1: y });
  }
  return out;
}
// ponytail: Phase 4 — per-stage routing invariants (plan §Phase 4). Off unless
// globalThis.PID_DEBUG is truthy (node: --debug flag; browser: window.PID_DEBUG=true).
// Failures land in data.errors as PID-DBG-* (LOUD: harness exit 1, regress red,
// guilty stage named with pipe + coordinates) — never throw, one bad pipe must
// not hide the rest.
function pidDebugGate(data) {
  if (!globalThis.PID_DEBUG) return null;
  const at = (p) => `(${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10})`;
  const fail = (stage, pipe, msg, pt) => {
    data.errors.push({ code: 'PID-DBG-' + stage, entity: pipe, message: `debug[${stage}] ${pipe}: ${msg}${pt ? ' at ' + at(pt) : ''}` });
  };
  return {
    // (re)takes the gate-3 snapshot from current pts — call after every
    // accepted routeOne assignment (push, refine-keep, phase2-fix, 2.7-keep).
    // Only true lead-ins are pinned (pts[1]/pts[len-2] with _lead tag +
    // _leadIn flag); on stub-less spans those are ordinary corners, fair game.
    snap(g) {
      const o = g.pts;
      g._dbgLead = o.length >= 2 ? {
        a0: { x: o[0].x, y: o[0].y },
        a1: (o[1]._lead && g.pA && g.pA._leadIn) ? { x: o[1].x, y: o[1].y } : null,
        b1: (o[o.length - 2]._lead && g.pB && g.pB._leadIn) ? { x: o[o.length - 2].x, y: o[o.length - 2].y } : null,
        b0: { x: o[o.length - 1].x, y: o[o.length - 1].y },
      } : null;
    },
    // gate 1 — post-routeOne stubs: full length, axis-aligned, endpoints exact
    stubs(orth, p, pA, pB, effStubA, effStubB) {
      const id = `${p.from} -> ${p.to}`;
      if (orth[0].x !== pA.x || orth[0].y !== pA.y) fail('routeOne', id, 'start moved off port tip', orth[0]);
      const last = orth[orth.length - 1];
      if (last.x !== pB.x || last.y !== pB.y) fail('routeOne', id, 'goal moved off port tip', last);
      for (const [end, eff] of [[pA, effStubA], [pB, effStubB]]) {
        if (!(eff > 0 && end.dir && (end.dir.x || end.dir.y))) continue;
        const lx = end.x + end.dir.x * eff, ly = end.y + end.dir.y * eff;
        // epsilon 0.5 inclusive, matching gate 2's `same` and the codebase
        // convention (grid float dust through snap/A*). Strict `<` failed on the
        // boundary: a lead-in landing exactly 0.5mm off (stub->nozzle fractional
        // elevation) reported a missing stub that was in fact present.
        const hit = orth.some(q => Math.abs(q.x - lx) <= 0.5 && Math.abs(q.y - ly) <= 0.5);
        if (!hit) fail('routeOne', id, `lead-in stub missing (want ${at({ x: lx, y: ly })})`, end);
      }
    },
    // gate 2 — post-A*: start/goal are the pinned endpoints; process lines
    // must also be diagonal-free (their output feeds refinement scoring, and
    // no repair runs between A* and scoring). Signals may carry a transient
    // diagonal to fractional bubble edges — the guarantee is their sanctioned
    // repair and gate 4 re-verifies orthogonality at emission.
    astar(pts, p, pA, pB) {
      const id = `${p.from} -> ${p.to}`;
      // ponytail: codebase epsilons — endpoints within 0.5 (grid float dust
      // through A*/snap ops), diagonals above 1.0 (cleanPoly deliberately
      // preserves <1mm perpendicular micro-stubs; collapsing them diagonals).
      const same = (q, r) => Math.abs(q.x - r.x) <= 0.5 && Math.abs(q.y - r.y) <= 0.5;
      if (!same(pts[0], pA)) fail('astar', id, 'start not the pinned endpoint', pts[0]);
      const last = pts[pts.length - 1];
      if (!same(last, pB)) fail('astar', id, 'goal not the pinned endpoint', last);
      if (p.kind === 'signal') return;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (Math.abs(b.x - a.x) > 1.0 && Math.abs(b.y - a.y) > 1.0) fail('astar', id, 'diagonal segment survived', b);
      }
    },
    // gate 3 — post-mutation: lead-in endpoints byte-identical to routeOne output
    leads(g) {
      const id = `${g.p.from} -> ${g.p.to}`, s = g._dbgLead;
      if (!s) return;
      const ends = [[g.pts[0], s.a0, 'start'], [g.pts[1], s.a1, 'lead-A'], [g.pts[g.pts.length - 2], s.b1, 'lead-B'], [g.pts[g.pts.length - 1], s.b0, 'goal']];
      for (const [now, was, which] of ends) {
        if (!was) continue;
        if (now.x !== was.x || now.y !== was.y) fail('leads', id, `${which} endpoint mutated (${at(was)} -> ${at(now)})`, now);
      }
    },
    // gate 4 — post-routing: routing must not push tips out (a tip exactly on
    // its resolved port is placement's choice — the validator reports the
    // sheet exit as PID-SHT-001) + every polyline orthogonal
    routed(geometries) {
      const sb = PIDEngine.sheetBounds(data.view.sheetW, data.view.sheetH);
      for (const g of geometries) {
        const id = `${g.p.from} -> ${g.p.to}`;
        const ends = [[g.pts[0], g.pA], [g.pts[g.pts.length - 1], g.pB]];
        for (const [t, port] of ends) {
          const onPort = port && t.x === port.x && t.y === port.y;
          if (!onPort && (t.x < sb.x0 || t.x > sb.x1 || t.y < sb.y0 || t.y > sb.y1))
            fail('routed', id, 'tip pushed off-sheet by routing', t);
        }
        for (let i = 1; i < g.pts.length; i++) {
          const a = g.pts[i - 1], b = g.pts[i];
          if (Math.abs(b.x - a.x) > 0.5 && Math.abs(b.y - a.y) > 0.5) fail('routed', id, 'diagonal reaches post-routing', b);
        }
      }
    },
    // gate 5 — pre-emit: every real crossing has a break; every break keeps
    // ≥2mm straight shoulders (else the gap cutter silently skips it downstream)
    gaps(geometries, breaks) {
      // ponytail: match the ungappedList threshold — crossings where neither line
      // has enough straight run to place a gap are honest floors (PID-GEO-003),
      // not debug-gate defects.
      const GAP = ruleParam('routing.gapBreak', 4);
      const MIN_RUN = ruleParam('routing.gapMinRun', 8);
      const need = GAP + MIN_RUN + 0.5;
      const runOf = (lineIdx, x) => {
        const pts = geometries[lineIdx].pts;
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1], b = pts[k];
          const horiz = Math.abs(a.y - b.y) < 0.5;
          const onSeg = horiz
            ? (Math.abs(x.y - a.y) < 1 && x.x > Math.min(a.x, b.x) + 0.5 && x.x < Math.max(a.x, b.x) - 0.5)
            : (Math.abs(x.x - a.x) < 1 && x.y > Math.min(a.y, b.y) + 0.5 && x.y < Math.max(a.y, b.y) - 0.5);
          if (!onSeg) continue;
          const d1 = horiz ? Math.abs(x.x - a.x) : Math.abs(x.y - a.y);
          const d2 = horiz ? Math.abs(x.x - b.x) : Math.abs(x.y - b.y);
          return Math.min(d1, d2);
        }
        return 0;
      };
      for (let i = 0; i < geometries.length; i++) for (let j = i + 1; j < geometries.length; j++) {
        for (const si of PIDEngine.segs(geometries[i].pts)) for (const sj of PIDEngine.segs(geometries[j].pts)) {
          const x = PIDEngine.crossing(si, sj);
          if (!x || !PIDEngine.isRealCrossing(si, sj)) continue;
          const id = `${geometries[i].p.from} -> ${geometries[i].p.to} X ${geometries[j].p.from} -> ${geometries[j].p.to}`;
          const near = (gi) => (breaks[gi] || []).some(b => Math.abs(b.x - x.x) + Math.abs(b.y - x.y) < 5);
          if (!near(i) && !near(j)) {
            if (runOf(i, x) >= need || runOf(j, x) >= need)
              fail('gaps', id, 'real crossing has no assigned break', x);
            continue;
          }
          for (const gi of [i, j]) for (const b of (breaks[gi] || [])) {
            if (Math.abs(b.x - x.x) + Math.abs(b.y - x.y) > 5) continue;
            const pts = geometries[gi].pts;
            let shoulder = 0;
            for (let k = 1; k < pts.length; k++) {
              const a = pts[k - 1], q = pts[k], horiz = Math.abs(a.y - q.y) < 0.5;
              const on = horiz ? (Math.abs(b.y - a.y) < 1 && b.x > Math.min(a.x, q.x) && b.x < Math.max(a.x, q.x))
                : (Math.abs(b.x - a.x) < 1 && b.y > Math.min(a.y, q.y) && b.y < Math.max(a.y, q.y));
              if (!on) continue;
              const d1 = horiz ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
              const d2 = horiz ? Math.abs(b.x - q.x) : Math.abs(b.y - q.y);
              shoulder = Math.min(d1, d2);
            }
            if (shoulder < 2) fail('gaps', `${geometries[gi].p.from} -> ${geometries[gi].p.to}`, `break shoulder only ${Math.round(shoulder * 10) / 10}mm (<2mm)`, b);
          }
        }
      }
    },
  };
}
// ponytail: shared polyline cleaner — drop only points whose removal keeps the
// path orthogonal: exact duplicates, collinear same-direction redundancy.
// Fold-back removal runs separately post-routing via removeFoldBacks().
function cleanPoly(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  for (let i = 1; i < out.length - 1; i++) {
    // ponytail: never merge away a lead-in end — it IS the nozzle straight-run
    if (out[i]._lead) continue;
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const abx = b.x - a.x, aby = b.y - a.y, bcx = c.x - b.x, bcy = c.y - b.y;
    const cross = Math.abs(abx * bcy - aby * bcx);
    const scale = Math.abs(abx) + Math.abs(aby) + Math.abs(bcx) + Math.abs(bcy) || 1;
    const parallel = cross / (scale * scale) < 1e-9;
    const orthoResult = Math.abs(a.x - c.x) < 0.5 || Math.abs(a.y - c.y) < 0.5;
    if (parallel && orthoResult) { out.splice(i, 1); i--; }
  }
  for (let i = 1; i < out.length; i++) {
    const p = out[i], q = out[i - 1];
    if (Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5) { out.splice(i, 1); i--; }
  }
  return out;
}
function renderInto(svg, data, themeName) {
  renderInto._placedLabels = [];
  renderInto._tapLanes = [];
  const { equipment, valves, instruments, junctions, pipes, view } = data;
  // Drafting theme (D4). `print` is the default because it is the deliverable;
  // `cad` is the black model-space authoring view. Resolve the NAME (not just the
  // tokens) so `data-theme` is always a real theme id — setting it from the raw
  // argument wrote the literal "null" on every default render.
  const themeKey = (themeName || view.theme) === 'cad' ? 'cad' : 'print';
  const T = pidTheme(themeKey);

  const byId = PIDEngine.buildById(equipment, valves, junctions, instruments);

  const isJunction = (id) => junctions.some(j => j.id === id);
  PIDEngine._isInst = (e) => instruments.some(i => i.tag === (e.tag || e.id));
  const isInstrument = PIDEngine._isInst;
  const shown = (e, kind) => view.show === 'all' || view.show === kind;

  const glyphKeyOf = (e) => isInstrument(e) ? (BUBBLE_KEYS[e.bubble] || BUBBLE_KEYS.field) : (e.symbol || SYMBOL_KEYS[e.type] || SYMBOL_KEYS.vessel);
  // content scale: symbols and text shrink together (real P&IDs: ~12mm bubbles on
  // a 24x36in sheet = ~1.3% of width; we render ~2-3% with fit-page)
  const SC = view.symbolScale || 1;
  const textScale = Math.max(0.85, SC);
  // ponytail: type scale + floor from registry (annotation.typeScale/typeFloor)
  //
  // PID-TXT-001. Every annotation run in the drawing goes through this one function,
  // so recording what it produces here is exhaustive and cannot miss a role — no
  // per-call-site instrumentation, which would rot the moment someone adds a label.
  // Title-block, legend and north-arrow text does NOT come through here (it is
  // authored with literal sizes in its own unit space), which is exactly the scope
  // we want: this is a check on annotation type, not on sheet furniture.
  const typeSizes = new Map();          // mm -> how many runs used it
  const fs = (n) => {
    const v = Math.max(Math.round(n * textScale * ruleParam('annotation.typeScale', 1.4) * 10) / 10, ruleParam('annotation.typeFloor', 3.5));
    typeSizes.set(v, (typeSizes.get(v) || 0) + 1);
    return v;
  };
  // Runs the check once the annotations are laid out. Reported AGGREGATED, one
  // warning per offending size, not one per run: at the current typeScale almost
  // every run is over the band, and 265 identical warnings would be noise that
  // trains the reader to ignore the check.
  const checkTypeBand = () => {
    const lo = ruleParam('annotation.sizeMin', 2.6), hi = ruleParam('annotation.sizeMax', 3.5);
    const minRuns = ruleParam('annotation.sizeScopeMin', 0);
    const under = [], over = [];
    for (const [mm, n] of [...typeSizes.entries()].sort((a, b) => a[0] - b[0])) {
      if (n < minRuns) continue;
      if (mm < lo - 1e-9) under.push([mm, n]);
      else if (mm > hi + 1e-9) over.push([mm, n]);
    }
    const fmt = (rows, word, bound) => rows.map(([mm, n]) => `${n} run(s) at ${mm.toFixed(1)}mm`).join(', ')
      + ` — ${word} the ${bound.toFixed(1)}mm print limit`;
    if (under.length) {
      data.warnings.push(`[PID-TXT-001] annotation type UNDER: ${fmt(under, 'below', lo)}. Raise annotation.typeScale or lower annotation.typeFloor, or accept if this sheet is screen-only.`);
    }
    if (over.length) {
      const worst = over[over.length - 1];
      data.warnings.push(`[PID-TXT-001] annotation type OVER: ${fmt(over, 'above', hi)}; largest ${worst[0].toFixed(1)}mm. annotation.typeScale is ${ruleParam('annotation.typeScale', 1.4)} and annotation.typeFloor is ${ruleParam('annotation.typeFloor', 3.5)}mm — note the floor BINDS for every base size at or below ${(ruleParam('annotation.typeFloor', 3.5) / ruleParam('annotation.typeScale', 1.4) / textScale).toFixed(2)}mm, so those roles are all flattened to exactly ${ruleParam('annotation.typeFloor', 3.5)}mm and their individual sizes are no longer distinguishable.`);
    }
  };
  const sizeOf = (e) => {
    let s = isInstrument(e) ? symbolSize(glyphKeyOf(e)) : glyphSizeOf(e);
    if (e.scale) s *= e.scale;
    return s * SC;
  };

  // canvas: content-sized, or full page when `fit page`
  const dbg = pidDebugGate(data); // ponytail: Phase 4 — null unless PID_DEBUG
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of [...equipment, ...valves, ...instruments, ...junctions]) {
    const s = sizeOf(e);
    minX = Math.min(minX, e.x - s / 2); minY = Math.min(minY, e.y - s / 2);
    maxX = Math.max(maxX, e.x + s / 2); maxY = Math.max(maxY, e.y + s / 2);
  }
  minX = Math.min(minX, 0); minY = Math.min(minY, 0);
  // include room for tags/labels that extend beyond the symbol boxes
  minX -= 10; minY -= 12; maxX += 10; maxY += 14;

    let W, H, wrap = '';
    if (view.fitPage) {
      // the sheet is a fixed 22x34in (559x864mm) drawing; content is laid out
      // inside it, and the whole sheet maps to the window
      W = view.sheetW || 864; H = view.sheetH || 559;
      const pad = 10;
      const cw = Math.max(maxX - minX, 1), ch = Math.max(maxY - minY, 1);
      if (cw > W - 2 * pad || ch > H - 2 * pad) {
        data.warnings.push(`[PID-LAY-001] content (${Math.round(cw)}x${Math.round(ch)}mm) exceeds sheet (${W}x${H}mm) — reduce scale or layout`);
      }
      const k = Math.min(1, Math.min((W - 2 * pad) / cw, (H - 2 * pad) / ch));
      wrap = `<g transform="translate(${pad - minX * k} ${pad - minY * k}) scale(${k})">`;
    } else {
      W = maxX + 20; H = maxY + 20;
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    // ponytail: singular scale — 1 unit = 1mm = 1px, every sheet forever.
    // (Per-sheet window stretch + zoom-to-fill made identical symbols render
    // at different sizes; only overflow shrinks, via k above, and warns.)
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));

  // ponytail: connWorld merged into PIDEngine
  const connWorld = (e, conn, size) => PIDEngine.connWorld(e, conn, size);

    let body = '';
    // ---- drafting theme (D4): colour-per-layer + monochrome print plot style --
    // Injected as raw MARKUP, not a DOM <style> element: the node harness's fake
    // element never serialises `style.textContent`, so a DOM-built stylesheet
    // silently vanished from every node-side SVG export (the pre-existing `chips`
    // stylesheet has the same latent bug). Raw markup survives both the browser
    // and the harness, so an exported SVG is themed wherever it is opened. CSS
    // beats SVG presentation attributes, so the emission sites keep their existing
    // literals — that is why this was four small edits, not ~36. Presentation
    // only: nothing below touches a coordinate.
    body += `<style data-pid-theme="${themeKey}">${themeCss(T)}</style>`;
    // A real background rect, not merely a CSS `background`, so the sheet colour
    // survives rasterisers and print paths that ignore root-element CSS.
    body += `<rect class="pid-sheet-bg" x="0" y="0" width="${W}" height="${H}" fill="${T.bg}" stroke="none"/>`;

    // ———— pipes: pass 1 — route geometry for every pipe ————
    const geometries = [];
    const labeledLines = new Set();
    const routed = []; // polylines already placed â€” the router pays to cross/avoid them

    // ponytail: segs/crossing moved to PIDEngine

    // route one pipe (stubs + via + orthogonalize + A*) against the routed pool.
    // hardLines (optional): polylines whose cells are BLOCKED â€” the route cannot
    // touch them (used by refinement to forbid overlaps)
    const routeOne = (p, pA, pB, routedPool, hardLines) => {
      const a = byId[p.from], b = byId[p.to];
      // Phase 3: a port lead-in must stay straight for at least MIN_PORT_RUN
      // before any bend. When the pipe is too short to afford lead-in + bend on
      // both axes, drop the stub entirely: the route becomes a pure L/straight
      // whose single corner sits mid-span instead of 3mm off the port.
      // Exception: junction endpoints keep a stub even on tight spans — it is
      // what separates multiple pipes fanning out of the same free node.
      const MIN_PORT_RUN = ruleParam('routing.minPortRun', 14);
      const spanX = Math.abs(pB.x - pA.x), spanY = Math.abs(pB.y - pA.y);
      const roomy = spanX >= MIN_PORT_RUN * 2 && spanY >= MIN_PORT_RUN * 2;
      const jEnds = !!(pA.junction || pB.junction);
      const hasNozzle = !!(pA.nozzle || pB.nozzle);
      const stub = view.stubLength || 0;
      let effStub;
      if (roomy) effStub = Math.max(stub, MIN_PORT_RUN);
      else if (jEnds) effStub = Math.max(ruleParam('routing.junctionStubMin', 6), Math.min(MIN_PORT_RUN, spanX / 3 || Infinity, spanY / 3 || Infinity));
      else if (hasNozzle) effStub = MIN_PORT_RUN; // nozzle connections always get a stub for alignment
      else effStub = 0;
      // shrink each stub to stop before any obstacle box: a stub poking into a
      // neighbor forces relax off-axis, and the tip connector then draws through it.
      // ponytail: nozzle ends always keep a full run — the shared rule above lets
      // a junction on the far end shrink them to fan-out length (the E-103 defect)
      let effStubA = stubClearance(pA, pA.dir, effStub, data, { a, b });
      let effStubB = stubClearance(pB, pB.dir, effStub, data, { a, b });
      if (pA.nozzle && effStubA < MIN_PORT_RUN) effStubA = stubClearance(pA, pA.dir, MIN_PORT_RUN, data, { a, b });
      if (pB.nozzle && effStubB < MIN_PORT_RUN) effStubB = stubClearance(pB, pB.dir, MIN_PORT_RUN, data, { a, b });
      pA._leadIn = effStubA > 0; pB._leadIn = effStubB > 0;
      const pts = [{ x: pA.x, y: pA.y }];
      // ponytail: tagged lead-ins — downstream passes (cleanPoly/shiftFor) must
      // never merge or translate them; they ARE the nozzle straight-run
      if (effStubA > 0 && pA.dir) pts.push({ x: pA.x + pA.dir.x * effStubA, y: pA.y + pA.dir.y * effStubA, _lead: true });
      for (const wp of (p.via || [])) pts.push(wp);
      if (effStubB > 0 && pB.dir) pts.push({ x: pB.x + pB.dir.x * effStubB, y: pB.y + pB.dir.y * effStubB, _lead: true });
      pts.push({ x: pB.x, y: pB.y });
      // orthogonalize: each consecutive pair routes L-shaped (H then V, or V then H),
      // horizontal precedence unless the vertical span clearly dominates (>1.5x).
      // ponytail: pushU — axis-aligned pairs otherwise emit the shared endpoint
      // twice, and the dup makes nearEnd() skip the lead-in downstream
      const orth = [];
      const pushU = (p) => {
        const l = orth[orth.length - 1];
        if (!l || Math.abs(l.x - p.x) > 0.5 || Math.abs(l.y - p.y) > 0.5) orth.push(p);
      };
      pushU({ x: pts[0].x, y: pts[0].y });
      for (let i = 1; i < pts.length; i++) {
        const a2 = pts[i - 1], b2 = pts[i];
        if (Math.abs(b2.x - a2.x) * 1.5 >= Math.abs(b2.y - a2.y)) {
          pushU({ x: b2.x, y: a2.y }); pushU({ x: b2.x, y: b2.y });
        } else {
          pushU({ x: a2.x, y: b2.y }); pushU({ x: b2.x, y: b2.y });
        }
      }
      // ponytail: the tip is exact port geometry — pushU's 0.5 dedup may
      // swallow it when the final corner lands on top of it (FIC-103: route
      // ended 0.2mm off the tip). Re-assert it; the nub is a port stub.
      const oLast = orth[orth.length - 1], pBTip = pts[pts.length - 1];
      if (oLast.x !== pBTip.x || oLast.y !== pBTip.y) orth.push({ x: pBTip.x, y: pBTip.y });
      // grid-align interior bend points (ports stay exact); Rule 71/72
      // the two lead-in stub points (index 1 and last-1) are NOT snapped — snapping
      // them to the grid would collapse the minimum port run that Phase 3 requires.
      // ponytail: snap per axis, keeping orthogonality — blind x/y rounding turns
      // clean L-corners into diagonals (the (104,271)->(105,270) vandalism)
      // `view.grid` defaults to 5 (pid-parser.js:285) and is never absent, so the
      // old `|| 20` was dead code naming a DIFFERENT pitch from the drawn grid.
      const g2 = view.grid || 5;
      for (let k = 1; k < orth.length - 1; k++) {
        if (k === 1 || k === orth.length - 2) continue;
        const p = orth[k], a = orth[k - 1], c = orth[k + 1];
        const abH = Math.abs(a.y - p.y) < 0.5, bcH = Math.abs(c.y - p.y) < 0.5;
        const abV = Math.abs(a.x - p.x) < 0.5, bcV = Math.abs(c.x - p.x) < 0.5;
        const nx = Math.round(p.x / g2) * g2, ny = Math.round(p.y / g2) * g2;
        if ((abH || Math.abs(a.x - nx) < 0.5) && (bcH || Math.abs(c.x - nx) < 0.5)) p.x = nx;
        if ((abV || Math.abs(a.y - ny) < 0.5) && (bcV || Math.abs(c.y - ny) < 0.5)) p.y = ny;
      }
      // ponytail: re-tag lead-in ends by coordinate — orth construction above
      // rebuilds every point (tags from pts don't survive); without the tag,
      // cleanPoly/shiftFor eat the nozzle straight-run downstream.
      // ponytail: nearest-to-tip match — a corner can share the lead's
      // coordinates (E-103: corner (5,286) vs lead (5,271)); first-match
      // tagging protected the corner and left the lead to be merged.
      const tagLead = (lx, ly, tx, ty) => {
        let best = null, bd = Infinity;
        for (const q of orth) {
          if (Math.abs(q.x - lx) > 0.5 || Math.abs(q.y - ly) > 0.5) continue;
          const d = Math.abs(q.x - tx) + Math.abs(q.y - ty);
          if (d < bd) { bd = d; best = q; }
        }
        if (best) best._lead = true;
      };
      if (effStubA > 0 && pA.dir) tagLead(pA.x + pA.dir.x * effStubA, pA.y + pA.dir.y * effStubA, pA.x, pA.y);
      if (effStubB > 0 && pB.dir) tagLead(pB.x + pB.dir.x * effStubB, pB.y + pB.dir.y * effStubB, pB.x, pB.y);
      if (dbg) dbg.stubs(orth, p, pA, pB, effStubA, effStubB); // gate 1
      // obstacle-aware routing: detour around component bodies + costed against existing lines
      if (view.route !== 'direct') {
        for (let k = 0; k < orth.length; k++) {
          // ponytail: keep _lead — cleanPoly/shiftFor/slide guards below are
          // dead without it (Phase 4 gate 3 named the grid-slide eating stubs)
          orth[k] = { x: orth[k].x, y: orth[k].y, _lead: orth[k]._lead };
        }
        // note: avoidObstacles may return `orth` itself (direct-route early return)
        // never empty it in place and re-push from itself, that aliases to []
        orth._jEnds = !!(pA.junction || pB.junction);
        // tag the polyline so the A* give-up fallback in pid-router can name the
        // pipe it gave up on (see ASTAR_GIVEUP there) — `pts` is otherwise anonymous
        orth._who = (p.from || '?') + '->' + (p.to || '?');
        const routed = cleanPoly(avoidObstacles(orth, data, { a, b, dest: pB }, g2, routedPool, hardLines, p.kind === 'signal'));
        // enforce nozzle alignment: last segment must be collinear with nozzle direction
        if (routed.length >= 3) {
          const nzDir = pB.dir || pA.dir;
          if (nzDir && (nzDir.x || nzDir.y)) {
            const tip = routed[routed.length - 1];
            const prev = routed[routed.length - 2];
            const dx = tip.x - prev.x, dy = tip.y - prev.y;
            const isHoriz = Math.abs(dy) < 0.5;
            const isVert = Math.abs(dx) < 0.5;
            const wantHoriz = nzDir.y === 0;
            // ponytail: only align when the approach shares an axis with the nozzle —
            // a perpendicular approach cannot be corrected without creating a diagonal.
            const approachOk = wantHoriz ? isHoriz : isVert;
            if (((wantHoriz && !isHoriz) || (!wantHoriz && !isVert)) && approachOk) {
              // build a 3-point L-bend: prev -> corner -> leadIn -> tip
              const leadIn = wantHoriz
                ? { x: tip.x + nzDir.x * MIN_PORT_RUN, y: tip.y }
                : { x: tip.x, y: tip.y + nzDir.y * MIN_PORT_RUN };
              const corner = wantHoriz
                ? { x: leadIn.x, y: prev.y }
                : { x: prev.x, y: leadIn.y };
              routed.splice(routed.length - 2, 2, corner, leadIn, tip);
            }
          }
        }
        if (dbg) dbg.astar(routed, p, pA, pB); // gate 2
        return routed;
      }
      const direct = cleanPoly(orth);
      if (dbg) dbg.astar(direct, p, pA, pB); // gate 2 (direct path)
      return direct;
    };

    // process pipes route first (they form the skeleton); signals weave around them
    const routingOrder = pipes.filter(q => q.kind !== 'tap').slice().sort((x, y) => (x.kind === 'signal' ? 1 : 0) - (y.kind === 'signal' ? 1 : 0));
    // pipes leaving the same junction may not share the sibling's lead-out
    // corridor: each earlier-routed sibling's stub segment becomes a hard block
    const siblingStubs = (p) => {
      const blocks = [];
      for (const endId of [p.from, p.to]) {
        for (const inc of (data.junctionGraph[endId] || [])) {
          if (inc.pipe === p) continue;
          const g = geometries.find(gg => gg.p === inc.pipe);
          if (!g || g.pts.length < 2) continue;
          blocks.push(inc.end === 'a' ? [g.pts[0], g.pts[1]] : [g.pts[g.pts.length - 1], g.pts[g.pts.length - 2]]);
        }
      }
      return blocks;
    };
    for (const p of routingOrder) {
      if (p.kind === 'tap') continue; // explicit taps are drawn at instrument render time
      // topology was resolved authoritatively in resolveTopology(); the renderer never guesses
      const pA = p._from, pB = p._to;
      if (!pA || !pB) continue; // invalid topology: refused at model stage, no geometry

      const orth = routeOne(p, pA, pB, routed, siblingStubs(p));
      routed.push({ poly: orth });

      const signal = p.kind === 'signal';
      const style = signal
        ? (p.signalType === 'pneumatic' ? { dash: '', double: true }
          : p.signalType === 'hydraulic' ? { dash: '8 5', double: true }
          : p.signalType === 'capillary' ? { dash: '12 4 2 4' }
          : p.signalType === 'digital' ? { dash: '1 4' }
          : { dash: '8 5' })   // electrical default
        : { dash: '' };

      geometries.push({
        p, pts: orth, signal, style,
        stroke: signal ? '#444' : (p.stroke || '#1E90FF'),
        width: signal ? 0.4 : 0.6,
        label: p.label && !view.hideLabels ? p.label : null,
        labelOnce: p.line && labeledLines.has(p.line),
        pA, pB,
        // ponytail: Phase 4 gate 3 — snapshot taken below via dbg.snap
        _dbgLead: null,
      });
      if (dbg) dbg.snap(geometries[geometries.length - 1]);
      if (p.line) labeledLines.add(p.line);
    }

    // ---- refinement: rip-up & re-route the worst process lines a few times ----
    // Removes order dependence (the greedy one-shot routes in DSL order) and lets
    // badly placed lines get a second chance once their neighbors are in place.
    // a real crossing must be well inside both segments â€” junction/port meetings
    // (shared endpoints) are not crossings
    // ponytail: isRealCrossing moved to PIDEngine
      const refineRoutes = () => {
      const segListOf = (geoms) => geoms.map(g => g.pts.length < 2 ? [] : PIDEngine.segs(g.pts));
      const countPer = (geoms, segList) => {
        const per = geoms.map(() => 0);
        const kinds = { pp: 0, ps: 0, ss: 0 };
        for (let i = 0; i < geoms.length; i++) {
          if (!segList[i].length) continue;
          for (let j = i + 1; j < geoms.length; j++) {
            if (!segList[j].length) continue;
            for (const si of segList[i]) for (const sj of segList[j]) {
              if (PIDEngine.isRealCrossing(si, sj)) {
                per[i]++; per[j]++;
                const a = geoms[i].signal, b = geoms[j].signal;
                if (a && b) kinds.ss++; else if (a || b) kinds.ps++; else kinds.pp++;
              }
            }
          }
        }
        return { per, kinds };
      };
      // collinear overlaps between line pairs (segments on the same corridor).
      // stub-zone sharing at a common endpoint needs no rip-up below 20mm.
      const overlapPairs = (geoms, segList) => {
        const pairs = [];
        const shared = (a, b) => [a.p.from, a.p.to].some(e => e === b.p.from || e === b.p.to);
        for (let i = 0; i < geoms.length; i++) {
          if (!segList[i].length) continue;
          for (let j = i + 1; j < geoms.length; j++) {
            if (!segList[j].length) continue;
            const minOl = shared(geoms[i], geoms[j]) ? 20 : 3;
            for (const si of segList[i]) for (const sj of segList[j]) {
              const h1 = Math.abs(si[0].y - si[1].y) < 0.5, h2 = Math.abs(sj[0].y - sj[1].y) < 0.5;
              let ol = 0;
              if (h1 && h2 && Math.abs(si[0].y - sj[0].y) < 1) {
                ol = Math.min(Math.max(si[0].x, si[1].x), Math.max(sj[0].x, sj[1].x)) - Math.max(Math.min(si[0].x, si[1].x), Math.min(sj[0].x, sj[1].x));
              } else if (!h1 && !h2 && Math.abs(si[0].x - sj[0].x) < 1) {
                ol = Math.min(Math.max(si[0].y, si[1].y), Math.max(sj[0].y, sj[1].y)) - Math.max(Math.min(si[0].y, si[1].y), Math.min(sj[0].y, sj[1].y));
              }
              if (ol > minOl) pairs.push({ i, j, len: ol });
            }
          }
        }
        return pairs;
      };
      // full objective: same weights as the unified score where comparable
      // (plan Phase 2 — one currency). Overlaps priced by length here (finer
      // than the final pair-count); labels/taps/warnings don't move during
      // reroutes and are priced at selection time instead.
      const objective = (geoms) => {
        const segList = segListOf(geoms);
        const { per, kinds } = countPer(geoms, segList);
        const ovl = overlapPairs(geoms, segList);
        const SH = PIDEngine.sheetBounds(data.view.sheetW, data.view.sheetH);
        let bends = 0, length = 0, nonOrtho = 0, offSheet = 0;
        for (const g of geoms) {
          const pts = g.pts;
          for (let k = 1; k < pts.length; k++) {
            length += Math.abs(pts[k].x - pts[k - 1].x) + Math.abs(pts[k].y - pts[k - 1].y);
            const dx = Math.abs(pts[k].x - pts[k - 1].x), dy = Math.abs(pts[k].y - pts[k - 1].y);
            if (dx > 0.5 && dy > 0.5) nonOrtho++;
            const a = pts[k - 1], b = pts[k];
            if (a.x < SH.x0 || a.x > SH.x1 || a.y < SH.y0 || a.y > SH.y1 ||
                b.x < SH.x0 || b.x > SH.x1 || b.y < SH.y0 || b.y > SH.y1) offSheet++;
          }
          for (let k = 1; k < pts.length - 1; k++) {
            const p0 = pts[k - 1], p1 = pts[k], p2 = pts[k + 1];
            if (Math.abs((p1.x - p0.x) * (p2.x - p1.x) + (p1.y - p0.y) * (p2.y - p1.y)) < 0.5) bends++;
          }
        }
        const overlaps = ovl.reduce((a, p) => a + p.len, 0);
        const OW = PID_RULES.weights;
        return { per, kinds, overlaps, bends, length,
          score: OW.pp * kinds.pp + OW.ps * kinds.ps + OW.ss * kinds.ss + OW.overlapLen * overlaps +
            OW.bend * bends + OW.len * length + OW.nonOrtho * nonOrtho + OW.sheet * offSheet };
      };
      let best = objective(geometries);
      let stall = 0;
      for (let iter = 0; iter < 15 && stall < 2; iter++) {
        const segList = segListOf(geometries);
        const { per } = countPer(geometries, segList);
        const ovl = overlapPairs(geometries, segList);
        const ovlPer = geometries.map(() => 0);
        for (const p of ovl) { ovlPer[p.i] += p.len; ovlPer[p.j] += p.len; }
        // worst offenders among all lines (weighted: overlaps >> crossings).
        // Signal lines are included but weighted lower than process lines
        // so they only get refined when they are the worst offenders.
        // ponytail: pre-shuffle so ties break by seed (stable sort keeps the
        // shuffled order among equals; legacy order untouched when seed null)
        const worst = pidShuffle(geometries.map((g, i) => ({ i, c: per[i] * 20 + ovlPer[i] * 500 * (g.signal ? 0.3 : 1), g })), 1)
          .filter(x => x.c > 0)
          .sort((a, b) => b.c - a.c).slice(0, 3);
        if (!worst.length) break;
        const worstIdx = new Set(worst.map(w => w.i));
        const pool = geometries.map((g, i) => ({ poly: g.pts })).filter((_, i) => !worstIdx.has(i));
        let changed = false;
        for (const w of worst) {
          const g = w.g;
          const old = g.pts;
          // lines this one overlaps become HARD blockers on re-route (no new overlap possible)
          const partners = ovl.filter(p => p.i === w.i || p.j === w.i).map(p => geometries[p.i === w.i ? p.j : p.i].pts);
          const before = objective(geometries).score;
          g.pts = routeOne(g.p, g.pA, g.pB, pool, [...(partners.length ? partners : []), ...siblingStubs(g.p)]);
          if (objective(geometries).score < before) { changed = true; best = objective(geometries); if (dbg) dbg.snap(g); }
          else g.pts = old;
        }
        if (!changed) { stall++; } else { stall = 0; }
      }
    };
    refineRoutes();

    // ---- Phase 2: collinear-overlap elimination ----
    // After routing, any two lines sharing a corridor are re-routed: the later-drawn
    // line is re-routed over the rest with the overlapping partner hard-blocked, so it
    // cannot occupy the same corridor. The earlier line is tried if the later can't.
    // A pass is accepted only when that specific overlap is gone; total overlap count is
    // monotonically reduced, so the loop converges. Unresolvable overlaps surface as
    // errors from the line audit below.
    const findOverlapPairs = (geoms) => {
      const sl = geoms.map(g => g.pts.length < 2 ? [] : PIDEngine.segs(g.pts));
      const pairs = [];
      const shared = (a, b) => [a.p.from, a.p.to].some(e => e === b.p.from || e === b.p.to);
      for (let i = 0; i < geoms.length; i++) {
        if (!sl[i].length) continue;
        for (let j = i + 1; j < geoms.length; j++) {
          if (!sl[j].length) continue;
          const minOl = shared(geoms[i], geoms[j]) ? 20 : 3;
          for (const si of sl[i]) for (const sj of sl[j]) {
            const h1 = Math.abs(si[0].y - si[1].y) < 0.5, h2 = Math.abs(sj[0].y - sj[1].y) < 0.5;
            let ol = 0;
            if (h1 && h2 && Math.abs(si[0].y - sj[0].y) < 1) {
              ol = Math.min(Math.max(si[0].x, si[1].x), Math.max(sj[0].x, sj[1].x)) - Math.max(Math.min(si[0].x, si[1].x), Math.min(sj[0].x, sj[1].x));
            } else if (!h1 && !h2 && Math.abs(si[0].x - sj[0].x) < 1) {
              ol = Math.min(Math.max(si[0].y, si[1].y), Math.max(sj[0].y, sj[1].y)) - Math.max(Math.min(si[0].y, si[1].y), Math.min(sj[0].y, sj[1].y));
            }
            if (ol > minOl) pairs.push({ i, j, len: ol });
          }
        }
      }
      return pairs;
    };
    // One unresolvable pair must not abort the whole pass: skip it and keep
    // fixing the rest, looping until a full sweep makes no progress.
    let progress = true;
    for (let pass = 0; pass < 40 && progress; pass++) {
      const ovl = findOverlapPairs(geometries);
      if (!ovl.length) break;
      ovl.sort((a, b) => b.len - a.len);
      progress = false;
      const tried = new Set();
      for (const { i, j } of ovl) {
        const key = i + '-' + j;
        if (tried.has(key)) continue;
        tried.add(key);
        const later = i < j ? j : i, earlier = i < j ? i : j;
        let fixed = false;
        for (const target of [later, earlier]) {
          const partner = geometries[target === later ? earlier : later];
          const pool = geometries.map(g => ({ poly: g.pts })).filter((_, k) => k !== target);
          const before = geometries[target].pts;
          geometries[target].pts = routeOne(geometries[target].p, geometries[target].pA, geometries[target].pB, pool, [partner.pts, ...siblingStubs(geometries[target].p)]);
          if (findOverlapPairs([geometries[target], partner]).length === 0) { fixed = true; if (dbg) dbg.snap(geometries[target]); break; }
          geometries[target].pts = before;
        }
        if (fixed) progress = true;
      }
    }

    // ———— pipes: pass 2 — find crossings; the later-drawn (upper) pipe breaks ————
    const crossings = [];
    for (let i = 0; i < geometries.length; i++) {
      for (let j = i + 1; j < geometries.length; j++) {
        for (const si of PIDEngine.segs(geometries[i].pts)) {
          for (const sj of PIDEngine.segs(geometries[j].pts)) {
            const x = PIDEngine.crossing(si, sj);
            if (x) crossings.push({ x, li: i, lj: j });
          }
        }
      }
    }
    let breaks = geometries.map(() => []);
    let tapGeos = []; // filled by the tap pre-pass below (renderInto scope)

    // ---- pipes: pass 2.5 - bend-shift: every crossing must sit >= GAP+MIN_RUN from
    // a bend so pass 3 can cut a gap there. Crossings that land too close to a bend
    // get the bend pushed along its adjacent segment (slack permitting), keeping the
    // polyline orthogonal. Iterates to convergence (one fix can shorten a neighbor). --
const GAP = ruleParam('routing.gapBreak', 4);          // visual gap cut at a crossing
    const MIN_RUN = ruleParam('routing.gapMinRun', 8);      // min straight run each side of a gap (matches the line audit)
    {
      const need = GAP + MIN_RUN + 0.5;
      // shifts must keep every point inside the drawn sheet (same bounds as the router)
      const _sb = PIDEngine.sheetBounds(data.view.sheetW, data.view.sheetH);
      const FRAME = { x1: _sb.x0, x2: _sb.x1, y1: _sb.y0, y2: _sb.y1 };
      const clearPt = (x, y) => {
        if (x < FRAME.x1 || x > FRAME.x2 || y < FRAME.y1 || y > FRAME.y2) return false;
        for (const e of [...equipment, ...valves]) {
          const s = sizeOf(e);
          if (x > e.x - s / 2 - 4 && x < e.x + s / 2 + 4 && y > e.y - s / 2 - 4 && y < e.y + s / 2 + 4) return false;
        }
        if (junctions.some(j => Math.abs(j.x - x) < 6 && Math.abs(j.y - y) < 6)) return false;
        if (instruments.some(i => magnitude({ x: i.x - x, y: i.y - y }) < 14)) return false;
        return true;
      };
const shiftFor = (lineIdx, x) => {
        const pts = geometries[lineIdx].pts;
        if (pts.length < 3) return false;
        // ponytail: lead-in ends are the nozzle straight-run — never translate
        // them (a shifted lead-in reads as wrong-direction entry downstream)
        const gLead = geometries[lineIdx];
        const leadA = !!(gLead.pA && gLead.pA._leadIn), leadB = !!(gLead.pB && gLead.pB._leadIn);
        const lastLead = pts.length - 2;
        // would the segment a-b, once moved to these coords, collinearly overlap
        // another line's corridor? (bend-shift slides segments along their own axis;
        // that can drop a horizontal run onto another horizontal line -> overlap)
        const createsCollinear = (a, b) => {
          const h = Math.abs(a.y - b.y) < 0.5;
          for (let gi = 0; gi < geometries.length; gi++) {
            if (gi === lineIdx) continue;
            for (const s of PIDEngine.segs(geometries[gi].pts)) {
              const sh = Math.abs(s[0].y - s[1].y) < 0.5;
              if (h && sh && Math.abs(s[0].y - a.y) < 1.5) {
                const ov = Math.min(Math.max(a.x, b.x), Math.max(s[0].x, s[1].x)) - Math.max(Math.min(a.x, b.x), Math.min(s[0].x, s[1].x));
                if (ov > 3) return true;
              } else if (!h && !sh && Math.abs(s[0].x - a.x) < 1.5) {
                const ov = Math.min(Math.max(a.y, b.y), Math.max(s[0].y, s[1].y)) - Math.max(Math.min(a.y, b.y), Math.min(s[0].y, s[1].y));
                if (ov > 3) return true;
              }
            }
          }
          return false;
        };
        let moved = false;
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1], b = pts[k];
          const horiz = a.y === b.y;
          const onSeg = horiz
            ? (Math.abs(x.y - a.y) < 1 && x.x > Math.min(a.x, b.x) + 0.5 && x.x < Math.max(a.x, b.x) - 0.5)
            : (Math.abs(x.x - a.x) < 1 && x.y > Math.min(a.y, b.y) + 0.5 && x.y < Math.max(a.y, b.y) - 0.5);
          if (!onSeg) continue;
          const d1 = horiz ? Math.abs(x.x - a.x) : Math.abs(x.y - a.y);
          const d2 = horiz ? Math.abs(x.x - b.x) : Math.abs(x.y - b.y);
          const dir = horiz ? Math.sign(b.x - a.x) : Math.sign(b.y - a.y);
          // bend at segment end (pts[k]): translate the perpendicular segment (pts[k],
          // pts[k+1]) along segment k's axis away from x - a single corner move would
          // diagonal the polyline. pts[k+1] must be a bend, not a port; the segment
          // beyond it (k+2, parallel to k) absorbs the shift.
          if (d2 < need && k + 1 < pts.length - 1) {
            if ((k === 1 && leadA) || (k === pts.length - 3 && leadB)) {
              // translating b or its partner would move a lead-in end — skip,
              // the 2.7 rip-up (which rebuilds lead-ins) handles it instead
            } else {
            const delta = need - d2;
            const nk = { x: horiz ? b.x + dir * delta : b.x, y: horiz ? b.y : b.y + dir * delta };
            const nk1 = { x: horiz ? pts[k + 1].x + dir * delta : pts[k + 1].x, y: horiz ? pts[k + 1].y : pts[k + 1].y + dir * delta };
            const slack = horiz ? Math.abs(pts[k + 2].x - pts[k + 1].x) : Math.abs(pts[k + 2].y - pts[k + 1].y);
            const midX = (nk.x + nk1.x) / 2, midY = (nk.y + nk1.y) / 2;
            if (slack >= delta + 1 && clearPt(nk.x, nk.y) && clearPt(nk1.x, nk1.y) && clearPt(midX, midY) && !createsCollinear(nk, nk1)) {
              b.x = nk.x; b.y = nk.y; pts[k + 1].x = nk1.x; pts[k + 1].y = nk1.y; moved = true;
            }
            }
          }
          // bend at segment start (pts[k-1]): translate the perpendicular segment
          // (pts[k-2], pts[k-1]) along segment k's axis away from x; pts[k-2] must
          // be a bend, not a port; the segment before it (k-2, parallel to k) absorbs
          if (d1 < need && k - 2 >= 1) {
            if ((k === 3 && leadA) || (k - 1 === lastLead && leadB)) {
              // translating a or its partner would move a lead-in end — skip
            } else {
            const delta = need - d1;
            const na = { x: horiz ? a.x - dir * delta : a.x, y: horiz ? a.y : a.y - dir * delta };
            const na2 = { x: horiz ? pts[k - 2].x - dir * delta : pts[k - 2].x, y: horiz ? pts[k - 2].y : pts[k - 2].y - dir * delta };
            const slack = horiz ? Math.abs(pts[k - 3].x - pts[k - 2].x) : Math.abs(pts[k - 3].y - pts[k - 2].y);
            const midX = (na.x + na2.x) / 2, midY = (na.y + na2.y) / 2;
            if (slack >= delta + 1 && clearPt(na.x, na.y) && clearPt(na2.x, na2.y) && clearPt(midX, midY) && !createsCollinear(na2, na)) {
              a.x = na.x; a.y = na.y; pts[k - 2].x = na2.x; pts[k - 2].y = na2.y; moved = true;
            }
            }
          }
        }
        return moved;
      };
// converge: shift bends away from crossings until no more moves are possible.
      // crossings are recomputed after every iteration because a shift moves lines
      // and can create new crossings; the loop only stops when nothing moved
      const findCrossings = () => {
        const out = [];
        for (let i = 0; i < geometries.length; i++) {
          for (let j = i + 1; j < geometries.length; j++) {
            for (const si of PIDEngine.segs(geometries[i].pts)) {
              for (const sj of PIDEngine.segs(geometries[j].pts)) {
                const x = PIDEngine.crossing(si, sj);
                if (x) out.push({ x, li: i, lj: j });
              }
            }
          }
        }
        return out;
      };
      // pass 2.6 - assign each crossing's gap to a line with >= GAP+MIN_RUN of
      // straight run on both sides; prefer the later (upper-drawn) line
      // ponytail: epsilon axis test — exact === misclassified sub-cell jogs,
      // returning 0 room for segments that clearly contain the crossing
      const runOf = (lineIdx, x) => {
        const pts = geometries[lineIdx].pts;
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1], b = pts[k];
          const horiz = Math.abs(a.y - b.y) < 0.5;
          const onSeg = horiz
            ? (Math.abs(x.y - a.y) < 1 && x.x > Math.min(a.x, b.x) + 0.5 && x.x < Math.max(a.x, b.x) - 0.5)
            : (Math.abs(x.x - a.x) < 1 && x.y > Math.min(a.y, b.y) + 0.5 && x.y < Math.max(a.y, b.y) - 0.5);
          if (!onSeg) continue;
          const d1 = horiz ? Math.abs(x.x - a.x) : Math.abs(x.y - a.y);
          const d2 = horiz ? Math.abs(x.x - b.x) : Math.abs(x.y - b.y);
          return Math.min(d1, d2);
        }
        return 0;
      };
      let current = findCrossings();
      for (let iter = 0; iter < 12; iter++) {
        let moved = false;
        for (const c of current) {
          if (shiftFor(c.lj, c.x)) moved = true;
          if (shiftFor(c.li, c.x)) moved = true;
        }
        if (!moved) break;
        current = findCrossings();
      }

      // pass 2.7 - final repair: crossings that still lack gap room (and rare
      // overlaps recreated by shifting) get one participant ripped up and
      // re-routed with the conflict geometry hard-blocked, forcing a jog that
      // restores gap space or removes the shared corridor. Only strict wins are
      // kept (fewer ungapped crossings AND no new overlaps), so this converges.
      const overlapsCount = () => findOverlapPairs(geometries).length;
      const ungappedList = () => {
        const out = [];
        for (let i = 0; i < geometries.length; i++) {
          for (let j = i + 1; j < geometries.length; j++) {
            for (const si of PIDEngine.segs(geometries[i].pts)) {
              for (const sj of PIDEngine.segs(geometries[j].pts)) {
                const x = PIDEngine.crossing(si, sj);
                if (!x || !PIDEngine.isRealCrossing(si, sj)) continue;
                if (runOf(i, x) >= need || runOf(j, x) >= need) continue;
                out.push({ i, j, x });
              }
            }
          }
        }
        return out;
      };
      const rerouteIdx = (li, blockers) => {
        const pool = geometries.map((gg, k) => ({ poly: k === li ? [] : gg.pts }));
        geometries[li].pts = routeOne(geometries[li].p, geometries[li].pA, geometries[li].pB, pool, [...blockers, ...siblingStubs(geometries[li].p)]);
      };
      const pairsOf = (li) => findOverlapPairs(geometries).filter(p => p.i === li || p.j === li);
      for (let guard = 0; guard < 12; guard++) {
        const bad = ungappedList();
        const ovl = findOverlapPairs(geometries);
        if (!bad.length && !ovl.length) break;
        let progressed = false;
        // overlaps first (they are errors): re-route either partner until THIS
        // pair resolves; accept partial progress so chains of pairs unwind
        for (const { i, j } of ovl) {
          for (const li of [j, i]) {
            const before = geometries[li].pts;
            const had = pairsOf(li).length;
            rerouteIdx(li, [geometries[li === i ? j : i].pts]);
            const now = pairsOf(li).length;
            if (now < had || (now === 0 && ungappedList().length <= bad.length)) { progressed = true; if (dbg) dbg.snap(geometries[li]); break; }
            geometries[li].pts = before;
          }
          if (progressed) break;
        }
        if (progressed) continue;
        for (const u of bad) {
          const order = geometries[u.i].p.kind === 'signal' ? [u.i, u.j] : [u.j, u.i];
          for (const li of order) {
            const otherIdx = li === u.i ? u.j : u.i;
            const before = geometries[li].pts;
            rerouteIdx(li, [
              geometries[otherIdx].pts,
              [{ x: u.x - 1, y: u.y }, { x: u.x + 1, y: u.y }] // block the conflict cell ±buffer
            ]);
            if (ungappedList().length < bad.length && pairsOf(li).length === 0) { progressed = true; if (dbg) dbg.snap(geometries[li]); break; }
            geometries[li].pts = before;
          }
          if (progressed) break;
        }
        if (!progressed) break;
      }

      breaks = geometries.map(() => []);
      // final guarantee (Rule 68): no diagonal may survive to the emitter.
      // Whichever stage leaked it, replace it with an L-bend here — corner choice
      // prefers H-then-V (drafting precedence) unless it lands in a component box.
      {
        const inBoxOf = (g, x, y) => {
          // ponytail: sheet bounds count as blocked — a corner outside the
          // sheet draws the line off the drawing to reach an out-of-margin tip
          const sb = PIDEngine.sheetBounds(data.view.sheetW, data.view.sheetH);
          if (x < sb.x0 || x > sb.x1 || y < sb.y0 || y > sb.y1) return true;
          for (const e of [...equipment, ...valves]) {
            // own endpoints are excluded from routing obstacles — a bend over
            // them is no worse than the line already crossing them
            if (e.id === g.p.from || e.id === g.p.to) continue;
            const s = sizeOf(e);
            if (x > e.x - s / 2 - 4 && x < e.x + s / 2 + 4 && y > e.y - s / 2 - 4 && y < e.y + s / 2 + 4) return true;
          }
          if (junctions.some(j => Math.abs(j.x - x) < 6 && Math.abs(j.y - y) < 6)) return true;
          if (instruments.some(i => Math.abs(i.x - x) < 14 && Math.abs(i.y - y) < 14)) return true;
          return false;
        };
        for (const g of geometries) {
          const pts = g.pts;
          const inBox = (x, y) => inBoxOf(g, x, y);
          let i = 1;
          while (i < pts.length) {
            const a = pts[i - 1], b = pts[i];
            if (Math.abs(b.x - a.x) > 0.5 && Math.abs(b.y - a.y) > 0.5) {
              const c1 = { x: b.x, y: a.y }, c2 = { x: a.x, y: b.y };
              const c = !inBox(c1.x, c1.y) ? c1 : !inBox(c2.x, c2.y) ? c2 : null;
              if (c && (Math.abs(c.x - a.x) > 0.5 || Math.abs(c.y - a.y) > 0.5)) {
                pts.splice(i, 0, c);
                i += 2;
              } else {
                data.warnings.push(`[PID-GEO-004] geometry "${g.p.from} -> ${g.p.to}": diagonal has no clear corner — kept`);
                i++;
              }
            } else i++;
          }
        }
        // the guarantee can strand redundant collinear points (an L-corner on an
        // existing straight) — merge them back (ponytail: cleanPoly is the shared helper)
        for (const g of geometries) g.pts = cleanPoly(g.pts);
        // snap sub-half-cell interior corridors onto the grid: exact lead-in
        // elevations (218 vs grid 220) otherwise drag nub jogs mid-run.
        // Slides whole RUNS (both ends), never single corners (that relocates
        // the nub). Endpoints are exact port geometry — never touched.
        {
          const CELL = Math.max(data.view.laneGrid || data.view.grid || 5, 5);
          const hitsCorridor = (gi, p, q) => {
            const horiz = Math.abs(p.y - q.y) < 0.5;
            for (let gj = 0; gj < geometries.length; gj++) {
              if (gj === gi) continue;
              for (const sgm of PIDEngine.segs(geometries[gj].pts)) {
                const sh = Math.abs(sgm[0].y - sgm[1].y) < 0.5;
                if (sh !== horiz) continue;
                if (horiz && Math.abs(sgm[0].y - p.y) < 1.5) {
                  if (Math.min(p.x, q.x) < Math.max(sgm[0].x, sgm[1].x) + 2 && Math.max(p.x, q.x) > Math.min(sgm[0].x, sgm[1].x) - 2) return true;
                } else if (!horiz && Math.abs(sgm[0].x - p.x) < 1.5) {
                  if (Math.min(p.y, q.y) < Math.max(sgm[0].y, sgm[1].y) + 2 && Math.max(p.y, q.y) > Math.min(sgm[0].y, sgm[1].y) - 2) return true;
                }
              }
            }
            return false;
          };
          for (let gi = 0; gi < geometries.length; gi++) {
            const pts = geometries[gi].pts;
            for (let i = 1; i < pts.length - 1; i++) {
              if (i - 1 === 0 || i === pts.length - 1) continue; // exact port ends
              const a = pts[i - 1], b = pts[i];
              if (a._lead || b._lead) continue; // Phase 4 gate 3: lead-in tips are exact, never slid
              const horiz = Math.abs(a.y - b.y) < 0.5;
              const vert = Math.abs(a.x - b.x) < 0.5;
              if (!horiz && !vert) continue;
              const len = horiz ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
              if (len < CELL) continue;
              const cur = horiz ? a.y : a.x;
              const tgt = Math.round(cur / CELL) * CELL;
              if (Math.abs(tgt - cur) <= 0.5 || Math.abs(tgt - cur) > 2.5) continue;
              const na = horiz ? { x: a.x, y: tgt } : { x: tgt, y: a.y };
              const nb = horiz ? { x: b.x, y: tgt } : { x: tgt, y: b.y };
              const prev = pts[i - 2], next = pts[i + 1];
              // legs beyond the run must stay axis-aligned after the slide
              if (prev && !(Math.abs(prev.x - na.x) < 0.5 || Math.abs(prev.y - na.y) < 0.5)) continue;
              if (next && !(Math.abs(next.x - nb.x) < 0.5 || Math.abs(next.y - nb.y) < 0.5)) continue;
              if (inBoxOf(geometries[gi], na.x, na.y) || inBoxOf(geometries[gi], nb.x, nb.y)) continue;
              if (hitsCorridor(gi, na, nb)) continue;
              a.x = na.x; a.y = na.y; b.x = nb.x; b.y = nb.y;
            }
          }
          for (const g of geometries) g.pts = cleanPoly(g.pts);
        }
        // ponytail: force nozzle straight-runs on finished geometry. Whatever
        // upstream passes did to lead-ins, every nozzle tip ends with a full
        // axial run (or as much as the span allows). Nothing downstream of this
        // point mutates process polylines, so the guarantee holds to emission.
        // ponytail: Phase 4 gate 3a — leads byte-identical through cleanPoly /
        // shift / guarantee / slide (force-nozzle below is the authorized rewriter)
        if (dbg) for (const g of geometries) dbg.leads(g);
        for (const g of geometries) {
          const ends = [
            { p: g.pA, tipIdx: 0, back: 1 },
            { p: g.pB, tipIdx: g.pts.length - 1, back: -1 },
          ];
          for (const end of ends) {
            if (!end.p || !end.p.nozzle || !end.p.dir || (!end.p.dir.x && !end.p.dir.y)) continue;
            const pts = g.pts;
            const tip = pts[end.tipIdx];
            if (!tip) continue;
            const dir = end.p.dir;
            // ponytail: lead into a junction node extends to the node's axis —
            // a 9mm span can't host a 14mm stub; a full-span axial run beats a nub
            const NL = ruleParam('routing.nozzleLead', 14);
            let wantLen = NL;
            const farId = end.tipIdx === 0 ? g.p.to : g.p.from;
            const farJ = junctions.find(j => j.id === farId);
            const farTip = end.tipIdx === 0 ? pts[pts.length - 1] : pts[0];
            if (farJ) {
              const ax = dir.x !== 0 ? Math.abs(farJ.x - tip.x) : Math.abs(farJ.y - tip.y);
              if (ax > 1) wantLen = Math.min(NL, ax);
            }
            if (wantLen < 4) continue;
            // lead extends OUTWARD from the tip (same convention as routeOne
            // stubs): the final leg runs inward onto the nozzle
            const axial = (q) => dir.x !== 0 ? (Math.abs(q.y - tip.y) < 0.5) : (Math.abs(q.x - tip.x) < 0.5);
            const distT = (q) => Math.abs(q.x - tip.x) + Math.abs(q.y - tip.y);
            let total = 0;
            for (let k = 1; k < pts.length; k++) total += Math.abs(pts[k].x - pts[k - 1].x) + Math.abs(pts[k].y - pts[k - 1].y);
            if (total < wantLen) continue; // span shorter than a stub: keep honest
            let j = end.tipIdx, maxD = 0;
            while (j + end.back >= 0 && j + end.back < pts.length) {
              const q = pts[j + end.back];
              if (!axial(q) || distT(q) > wantLen + 2) break;
              j += end.back;
              if (distT(q) > maxD) maxD = distT(q);
            }
            if (maxD >= wantLen) continue; // already straight enough
            const lead = { x: tip.x + dir.x * wantLen, y: tip.y + dir.y * wantLen, _lead: true };
            const keptIdx = j + end.back;
            if (keptIdx < 0 || keptIdx >= pts.length) continue; // no room for a corner
            const kept = pts[keptIdx];
            const c1 = { x: lead.x, y: kept.y }, c2 = { x: kept.x, y: lead.y };
            // ponytail: distinct from both ends (either axis) + clear — an
            // L-corner shares one axis with each by definition.
            // ponytail: corner must sit at/past the lead along the run axis —
            // anything short of it folds back over the stub (worse than leaving it)
            const distinct = (p, q) => Math.abs(p.x - q.x) > 0.5 || Math.abs(p.y - q.y) > 0.5;
            const beyond = (c) => (c.x - tip.x) * dir.x + (c.y - tip.y) * dir.y >= wantLen - 0.5;
            // ponytail: landing next to the far junction node is legitimate
            // (its keep-out would otherwise veto every corner in a short span)
            const nearFar = (c) => Math.abs(c.x - farTip.x) < 2.5 && Math.abs(c.y - farTip.y) < 2.5;
            const ok = (c) => distinct(c, lead) && distinct(c, kept) && beyond(c) && (!inBoxOf(g, c.x, c.y) || nearFar(c));
            // prefer H-then-V drafting precedence; never diagonalize
            const corner = ok(c1) ? c1 : ok(c2) ? c2 : null;
            if (!corner) continue;
            if (end.tipIdx === 0) g.pts = [tip, lead, corner, ...pts.slice(keptIdx + 1)];
            else g.pts = [...pts.slice(0, keptIdx), corner, lead, tip];
          }
        }
        for (const g of geometries) g.pts = cleanPoly(g.pts);
        // ponytail: fold-back removal — remove zigzag patterns where three
        // consecutive same-axis segments reverse direction. Only removes when
        // the fold segment is shorter than both neighbors (safe: merged segment
        // stays axis-aligned). Runs after all routing/gap passes.
        for (const g of geometries) {
          const pts = g.pts;
          let changed = true;
          while (changed) {
            changed = false;
            for (let i = 1; i < pts.length - 1; i++) {
              const a = pts[i - 1], b = pts[i], c = pts[i + 1];
              // fold-back: consecutive segments a->b and b->c reverse on the same axis
              const horizFold = Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5
                && Math.sign(b.x - a.x) === -Math.sign(c.x - b.x) && Math.sign(b.x - a.x) !== 0;
              const vertFold = Math.abs(a.x - b.x) < 0.5 && Math.abs(c.x - b.x) < 0.5
                && Math.sign(b.y - a.y) === -Math.sign(c.y - b.y) && Math.sign(b.y - a.y) !== 0;
              if (horizFold || vertFold) {
                const foldLen = horizFold ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
                // remove b — merging a and c creates the merged segment
                // check merged segment is axis-aligned (a and c must share an axis)
                const mergedOk = horizFold ? (Math.abs(a.y - c.y) < 0.5) : (Math.abs(a.x - c.x) < 0.5);
                if (mergedOk) { pts.splice(i, 1); changed = true; break; }
              }
            }
          }
        }
      }
      // ponytail: Phase 4 — re-snap after the authorized force-nozzle rewrite;
      // gates 3+4 below cover everything downstream to emission
      if (dbg) for (const g of geometries) dbg.snap(g);
      if (dbg) { for (const g of geometries) dbg.leads(g); dbg.routed(geometries); }
      // ---- taps: precomputed min-length landings, taps always break ----
      // Taps draw last and outrank nothing: they land on the shortest reachable
      // host run (any of the host's pipes, plus its nozzle stubs) and take the
      // gap at every crossing. Process/signal lines never break for taps.
      tapGeos = [];
      {
        // ponytail: a tap with a named port lands on that port's pipe (or its
        // nozzle stub) — never a neighboring run. Unfiltered fallback keeps
        // errored taps drawable (validator already reported them).
        const hostRuns = (hostId, portId, lineOnly) => {
          const out = [];
          const portPipe = (gg) => !portId ||
            ((gg.p.from === hostId && gg.p._from && gg.p._from.conn && gg.p._from.conn.id === portId) ||
             (gg.p.to === hostId && gg.p._to && gg.p._to.conn && gg.p._to.conn.id === portId));
          for (const hg of geometries.filter(gg => (gg.p.from === hostId || gg.p.to === hostId) && portPipe(gg))) {
            for (const sgm of PIDEngine.segs(hg.pts)) {
              const a = sgm[0], b = sgm[1];
              if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 3)
                out.push({ x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), y: a.y, horiz: true });
              else if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 3)
                out.push({ y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y), x: a.x, horiz: false });
            }
          }
          // ponytail: line-taps land mid-run (flow elements live in lines),
          // never on the stub — stub landings read as direct nozzle mounts.
          if (lineOnly) return out;
          for (const nz of (data.nozzles || []).filter(n => n.ownerId === hostId && (!portId || n.portId === portId) && n.position && n.tipPosition)) {
            const a = nz.position, b = nz.tipPosition;
            if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 3)
              out.push({ x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), y: a.y, horiz: true });
            else if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 3)
              out.push({ y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y), x: a.x, horiz: false });
          }
          return out;
        };
        const laneTaken = (x, y0, y1, skipTag) => {
          const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
          for (const gg of geometries) {
            for (const sgm of PIDEngine.segs(gg.pts)) {
              if (Math.abs(sgm[0].x - sgm[1].x) > 0.5) continue;
              if (Math.abs(sgm[0].x - x) > 1.5) continue;
              if (Math.min(Math.max(sgm[0].y, sgm[1].y), hi) - Math.max(Math.min(sgm[0].y, sgm[1].y), lo) > 3) return true;
            }
          }
          for (const t of renderInto._tapLanes) {
            if (t.tag === skipTag || Math.abs(t.x - x) > 2.5) continue;
            if (Math.min(t.hi, hi) - Math.max(t.lo, lo) > 3) return true;
          }
          return false;
        };
        const r = 4.5 * (data.view.symbolScale || 1);
        for (const inst of instruments) {
          if (inst.bubble === 'dcs') continue;
          // ponytail 2026-09-25 (T6.6): was `pipes.find(...)`, so an instrument
          // with TWO taps had the second one silently dropped — no geometry, no
          // warning, nothing. Verified: two taps on PI-1 both reached the model and
          // only the first was ever drawn. Iterate all of them instead; the
          // `laneTaken` dodge already exists precisely to keep multiple drops off
          // the same vertical.
          const tapList = pipes.filter(p => p.kind === 'tap' && (p.from === inst.tag || p.to === inst.tag));
          for (const tap of tapList) {
          const hostId = tap._tap ? tap._tap.host : (tap.from === inst.tag ? tap.to : tap.from);
          if (!hostId) continue;
          const sx = inst.x, sy = inst.y + r;
          const options = [];
          // ponytail: port-named taps land on their own nozzle's runs; fall
          // back to all-host runs only when the port filter finds nothing
          let runs = hostRuns(hostId, tap._tap && tap._tap.port, !!(tap._tap && tap._tap.lineTap));
          if (!runs.length && tap._tap && tap._tap.port) runs = hostRuns(hostId, null, !!(tap._tap && tap._tap.lineTap));
          for (const sg of runs) {
            if (sg.horiz) {
              if (sx >= sg.x1 - 2 && sx <= sg.x2 + 2) {
                // plain vertical drop straight onto this run — the ideal tap shape
                options.push({ kind: 'drop', tx: sx, seg: sg, vertical: true, len: Math.abs(sg.y - sy) });
              } else {
                const tx = Math.max(sg.x1, Math.min(sg.x2, sx));
                const DS = ruleParam('taps.dropSep', 2);
                const dropY = sg.y >= sy ? Math.min(sg.y - DS, sy + DS) : Math.max(sg.y + DS, sy - DS);
                options.push({
                  kind: 'L', tx, dropY, seg: sg, vertical: false,
                  len: Math.abs(dropY - sy) + Math.abs(tx - sx) + Math.abs(sg.y - dropY),
                });
              }
            } else {
              const landY = Math.min(Math.max(sy + 2, sg.y1 + 2), sg.y2 - 2);
              if (landY <= sg.y1 || landY >= sg.y2) continue;
              // the landing must be BELOW the bubble's attach point, or the first
              // leg runs backwards into the bubble
              if (landY < sy + 1) continue;
              options.push({
                kind: 'side', tx: sg.x, dropY: landY, seg: sg, vertical: false,
                len: Math.abs(landY - sy) + Math.abs(sg.x - sx),
              });
            }
          }
          if (!options.length) continue;
          // ponytail 2026-09-25: the ranking used to be pure length, and length is
          // the wrong currency for a tap. Two defects came out of it:
          //  1. A 'side' candidate whose landY clamps INTO the host's run wins on
          //     length but its first leg goes UP from the bubble's bottom edge,
          //     into the bubble's own body, before turning. Same reversal class
          //     as the signal-port defect in resolvePort.
          //  2. A 'drop' straight down onto a process line directly beneath the
          //     bubble is the shortest option and always won, even when the run it
          //     landed on belonged to a DIFFERENT service than the tap's host
          //     port. Measured on the demo: FT-101 and PI-101 both dropped onto
          //     P-101's discharge run and ran as a 60mm horizontal dogleg,
          //     because 'side' candidates onto the same run were longer.
          // Ranking: a landing point that keeps the tap's own vertical lane wins
          // over a dogleg, and a dogleg wins over a reversed-'side' candidate.
          options.sort((a, b) => (b.vertical ? 1 : 0) - (a.vertical ? 1 : 0) || a.len - b.len);
          const best = options[0];
          if (window.__tapDbg && inst.tag === 'PT-101') {
            window.__tapDbg.push(['opts', options.map(o => o.kind + ':' + o.len.toFixed(0) + '@' + JSON.stringify(o.seg)).join(' | ')]);
          }
          // dodge a taken drop lane by shifting x within the host run
          const dodgeX = (tx, y0, y1, sg) => {
            const lo = sg.horiz ? sg.x1 - 2 : -1e9, hi = sg.horiz ? sg.x2 + 2 : 1e9;
            if (!laneTaken(tx, y0, y1, inst.tag)) return tx;
            const mid = sg.horiz ? (sg.x1 + sg.x2) / 2 : tx;
            const LS = ruleParam('taps.laneShift', 5);
            for (const d of [(mid >= tx ? LS : -LS), (mid >= tx ? -LS : LS)]) {
              if (tx + d < lo || tx + d > hi || laneTaken(tx + d, y0, y1, inst.tag)) continue;
              return tx + d;
            }
            return tx;
          };
          let pts;
          if (best.kind === 'drop') {
            const nx = dodgeX(best.tx, sy, best.seg.y, best.seg);
            pts = nx === sx ? [{ x: sx, y: sy }, { x: sx, y: best.seg.y }]
              : [{ x: sx, y: sy }, { x: nx, y: sy }, { x: nx, y: best.seg.y }];
          } else if (best.kind === 'side') {
            pts = [{ x: sx, y: sy }, { x: sx, y: best.dropY }, { x: best.tx, y: best.dropY }];
          } else {
            const nx = dodgeX(best.tx, best.dropY, best.seg.y, best.seg);
            pts = [{ x: sx, y: sy }, { x: sx, y: best.dropY }, { x: nx, y: best.dropY }, { x: nx, y: best.seg.y }];
          }
          // ponytail: a drop through the host's own body (bubble above, bottom
          // nozzle below) is never acceptable — jog around the body edge and
          // come back in. A leg ENDING at the nozzle on the outline is the
          // intended landing, not a crossing: the last leg only jogs on a
          // through-passage (both ends outside). Zero-length legs never count.
          // Only the host body triggers this (other boxes are A* territory).
          const hostE = byId[hostId];
          const hostIsJunc = junctions.some(j => j.id === hostId);
          if (hostE && !hostIsJunc) {
            const hs = sizeOf(hostE);
            const hb = { x0: hostE.x - hs / 2 - 4, x1: hostE.x + hs / 2 + 4, y0: hostE.y - hs / 2 - 4, y1: hostE.y + hs / 2 + 4 };
            // ponytail: trigger on METAL (±1), not keep-out pad — a landing
            // at the nozzle base lives inside the pad by design, and jogging
            // on pad-graze routes through the body to get back (the PT vent).
            const mt = { x0: hostE.x - hs / 2 - 1, x1: hostE.x + hs / 2 + 1, y0: hostE.y - hs / 2 - 1, y1: hostE.y + hs / 2 + 1 };
            const outOf = (q, b) => q.x <= b.x0 || q.x >= b.x1 || q.y <= b.y0 || q.y >= b.y1;
            const hitsBody = pts.some((pt, k) => {
              if (k === 0) return false;
              const a = pts[k - 1];
              if (Math.abs(a.x - pt.x) < 0.5 && Math.abs(a.y - pt.y) < 0.5) return false;
              if (!collide.segHitsRect([a, pt], mt, 0)) return false;
              if (k === pts.length - 1) return outOf(a, mt) && outOf(pt, mt);
              return true;
            });
            if (hitsBody) {
              const landY = pts[pts.length - 1].y, landX = pts[pts.length - 1].x;
              // ponytail: nearer landing edge first, but never outside the
              // sheet (dense D-1 sits near the west margin — the jog escaped).
              const SB = PIDEngine.sheetBounds(data.view.sheetW, data.view.sheetH);
              const edges = [hb.x0 - 4, hb.x1 + 4]
                .filter(x => x > SB.x0 + 2 && x < SB.x1 - 2)
                .sort((a, b) =>
                  (Math.abs(a - landX) - Math.abs(b - landX)) || (Math.abs(a - sx) - Math.abs(b - sx)));
              // (dense D-1 sits near the west margin — the jog escaped). With
              // no in-sheet edge the straight drop stands and the validator
              // reports it honestly.
              if (edges.length) {
                // ponytail: consult full lane occupancy (process/signal
                // verticals too, not just taps) — the west edge shared x=582
                // with D-101->P-102's run and neither check saw the other.
                // First free edge wins; all-taken keeps nearest (validator
                // reports it honestly).
                let nx = edges[0];
                for (const cand of edges) {
                  if (!laneTaken(cand, sy, landY, inst.tag)) { nx = cand; break; }
                }
                pts = [{ x: sx, y: sy }, { x: nx, y: sy }, { x: nx, y: landY }, { x: landX, y: landY }];
                // ponytail: landing opposite the drop edge puts the return leg
                // through the body — dip below it and rise at the landing x.
                // The rise itself must clear metal: dipping below only to rise
                // back through the body trades one crossing for another, so
                // the dip is skipped then (validator reports the residual).
                const ret = [pts[2], pts[3]];
                if (collide.segHitsRect(ret, mt, 0)) {
                  const uy = hb.y1 + 4;
                  const rise = [{ x: landX, y: uy }, { x: landX, y: landY }];
                  if (!collide.segHitsRect(rise, mt, 0)) {
                    pts = [{ x: sx, y: sy }, { x: nx, y: sy }, { x: nx, y: uy }, { x: landX, y: uy }, { x: landX, y: landY }];
                  }
                }
              }
            }
          }
          // ponytail: 2mm wire spacing — a tap vertical sharing a process
          // corridor reads as one line (LT-101/J-1→V-103, 33mm). Shift middle
          // verticals ±2mm to the free side; shared corners move rigidly so
          // horizontals stretch and the landing holds. Bubble start and final
          // landing never move (unshiftable residuals warn in the score pass).
          for (let k = 2; k < pts.length - 1; k++) {
            const a = pts[k - 1], b = pts[k];
            if (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) < 10) continue;
            const clash = geometries.some(gg => PIDEngine.segs(gg.pts).some(s =>
              Math.abs(s[0].x - s[1].x) < 0.5 && Math.abs(s[0].x - a.x) < 1.5 &&
              Math.min(Math.max(s[0].y, s[1].y), Math.max(a.y, b.y)) - Math.max(Math.min(s[0].y, s[1].y), Math.min(a.y, b.y)) > 10));
            if (!clash) continue;
            for (const d of [2, -2]) {
              const nx = a.x + d;
              if (laneTaken(nx, a.y, b.y, inst.tag)) continue;
              a.x = nx; b.x = nx;
              break;
            }
          }
          // register the long vertical for later taps
          for (let k = 1; k < pts.length; k++) {
            const a = pts[k - 1], b = pts[k];
            if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 4)
              renderInto._tapLanes.push({ tag: inst.tag, x: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
          }
          tapGeos.push({ tag: inst.tag, pts, host: hostId });
          }   // end of per-tap loop (T6.6: was a single `pipes.find`)
        }
        // cut taps at crossings with process/signal lines and other taps
        for (const t of tapGeos) {
          const cuts = [];
          const consider = (segs) => {
            for (const sgm of segs) {
              for (const ts of PIDEngine.segs(t.pts)) {
                const x = PIDEngine.crossing(ts, sgm);
                if (!x || !PIDEngine.isRealCrossing(ts, sgm)) continue;
                cuts.push(x);
              }
            }
          };
          for (const gg of geometries) consider(PIDEngine.segs(gg.pts));
          for (const o of tapGeos) if (o !== t) consider(PIDEngine.segs(o.pts));
          t.cuts = cuts;
        }
      }
      current = findCrossings();
      // ponytail: lower-priority line breaks — process stays solid, then taps
      // (cut separately below), then signals. Ties keep the old later-drawn rule.
      // Priority order lives in PID_RULES.linePriority (registry, not code).
      const rank = (g) => lineRank(g.p.kind);
      for (const c of current) {
        const ri = rank(geometries[c.li]), rj = rank(geometries[c.lj]);
        const first = rj < ri ? c.lj : rj > ri ? c.li : c.lj;
        const second = first === c.lj ? c.li : c.lj;
        if (runOf(first, c.x) >= need) breaks[first].push(c.x);
        else if (runOf(second, c.x) >= need) breaks[second].push(c.x);
        // ponytail: tight shoulders still take a (narrower) gap — an ungapped
        // crossing reads as a join. Assign to whichever side has ≥6.5mm.
        else {
          const rf = runOf(first, c.x), rs = runOf(second, c.x);
          if (rf >= 6.5 || rs >= 6.5) (rf >= rs ? breaks[first] : breaks[second]).push(c.x);
        }
      }
      if (dbg) dbg.gaps(geometries, breaks); // gate 5 — pre-emit
      window.__pidGeo = geometries.map(g => ({ from: g.p.from, to: g.p.to, pts: g.pts }));
      // ponytail: taps queryable too (tap TAG->HOST), same --geo channel
      for (const t of tapGeos) window.__pidGeo.push({ from: t.tag, to: t.host, pts: t.pts, tap: true });
    }

    // ———— pipes: pass 3 — emit paths with gap breaks at crossings ————
    let pipesSvg = '';
    for (let i = 0; i < geometries.length; i++) {
      const g = geometries[i];
      const pts = g.pts;
      const bks = breaks[i];
      // emit segment-by-segment, cutting clean gaps at crossing points in order along
      // each segment (multiple breaks per segment must not create stale M-jumps).
      // A gap is only cut when there is >= MIN_RUN of straight line on both sides,
      // so the line never turns immediately after a crossing. The path ALWAYS starts
      // at the true segment start (a gap cut must not drop the leading run).
      let d = '';
      for (let k = 1; k < pts.length; k++) {
        const prev = pts[k - 1], cur = pts[k];
        // ponytail: epsilon axis test — exact === stranded breaks on sub-cell runs
        const horiz = Math.abs(prev.y - cur.y) < 0.5;
        const len = horiz ? Math.abs(cur.x - prev.x) : Math.abs(cur.y - prev.y);
        const cutsFor = (run) => bks
          .filter(b => horiz ? (Math.abs(b.y - prev.y) < 1 && b.x > Math.min(prev.x, cur.x) && b.x < Math.max(prev.x, cur.x))
                              : (Math.abs(b.x - prev.x) < 1 && b.y > Math.min(prev.y, cur.y) && b.y < Math.max(prev.y, cur.y)))
          .map(b => (horiz ? Math.abs(b.x - prev.x) : Math.abs(b.y - prev.y)) / len)
          .filter(t => t > (GAP + run) / len && t < 1 - (GAP + run) / len)
          .sort((a, b) => a - b);
        // ponytail: a tight gap still reads as a break; an ungapped crossing
        // reads as a join — always worse. Fall back to 2mm shoulders.
        // ponytail: union, not either-or — relaxed-only breaks must not be
        // dropped just because a sibling qualified for full shoulders
        let cuts = cutsFor(MIN_RUN);
        for (const t of cutsFor(2)) {
          if (!cuts.some(u => Math.abs(u - t) * len < 2 * GAP + 4)) cuts.push(t);
        }
        cuts.sort((a, b) => a - b);
        if (!d) d = `M ${prev.x} ${prev.y}`;
        if (!cuts.length) {
          d += ` L ${cur.x} ${cur.y}`;
          continue;
        }
        // ponytail: coalesce breaks closer than 3*GAP into one wider gap —
        // separate cuts leave sliver fragments between them. Center-based
        // (direction-agnostic): the old signed test merged entire runs.
        const spans = [];
        for (const t of cuts) {
          const c = horiz ? prev.x + (cur.x - prev.x) * t : prev.y + (cur.y - prev.y) * t;
          const last = spans[spans.length - 1];
          if (last && Math.abs(c - last.c) < 2 * GAP + 4) {
            last.s = Math.min(last.s, c - GAP);
            last.e = Math.max(last.e, c + GAP);
            last.c = (last.s + last.e) / 2;
          } else spans.push({ s: c - GAP, e: c + GAP, c });
        }
        for (const m of spans) {
          const p0 = horiz ? { x: m.s, y: prev.y } : { x: prev.x, y: m.s };
          const p1 = horiz ? { x: m.e, y: prev.y } : { x: prev.x, y: m.e };
          d += ` L ${p0.x} ${p0.y}`;
          d += ` M ${p1.x} ${p1.y}`;
        }
        d += ` L ${cur.x} ${cur.y}`;
      }
      if (!d) continue;
      // ponytail: no arrowhead markers — they pile onto equipment vertices
      // as doubled blobs (V-101 inlet); real sheets show direction in
      // topology, not stamped triangles. Marker was SVG-only (zero metric).
      const cls = g.signal ? 'pid-line pid-signal' : 'pid-line pid-process';
      const ends = ` data-from="${g.p.from}" data-to="${g.p.to}"`;
      if (g.style.double) {
        pipesSvg += `<path d="${d}" class="${cls}"${ends} fill="none" stroke="${g.stroke}" stroke-width="${g.width}" stroke-dasharray="${g.style.dash}" transform="translate(0 -4)"/>`;
        pipesSvg += `<path d="${d}" class="${cls}"${ends} fill="none" stroke="${g.stroke}" stroke-width="${g.width}" stroke-dasharray="${g.style.dash}" transform="translate(0 4)"/>`;
      } else {
        pipesSvg += `<path d="${d}" class="${cls}"${ends} fill="none" stroke="${g.stroke}" stroke-width="${g.width}" stroke-dasharray="${g.style.dash}"/>`;
      }
      // flow direction arrow: small filled triangle at the midpoint of the
      // longest straight segment, pointing in the flow direction
      if (g.p.flowDirection && g.pts && g.pts.length >= 2) {
        const fwd = g.p.flowDirection === 'forward';
        // find longest segment
        let bestLen = 0, bestI = 0;
        for (let i = 0; i < g.pts.length - 1; i++) {
          const a = g.pts[i], b = g.pts[i + 1];
          const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
          if (len > bestLen) { bestLen = len; bestI = i; }
        }
        if (bestLen > 8) { // only draw if segment is long enough
          const a = g.pts[bestI], b = g.pts[bestI + 1];
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const dx = b.x - a.x, dy = b.y - a.y;
          const dir = fwd ? 1 : -1; // forward = a→b, reverse = b→a
          // arrow triangle: 3mm long, 1.5mm half-width
          const AL = 3, AW = 1.5;
          if (Math.abs(dx) > Math.abs(dy)) {
            // horizontal segment — arrow points left or right
            const sx = dir * Math.sign(dx);
            pipesSvg += `<polygon points="${mx - sx * AL},${my - AW} ${mx + sx * AL},${my} ${mx - sx * AL},${my + AW}" fill="${g.stroke}" opacity="0.7"/>`;
          } else {
            // vertical segment — arrow points up or down
            const sy = dir * Math.sign(dy);
            pipesSvg += `<polygon points="${mx - AW},${my - sy * AL} ${mx},${my + sy * AL} ${mx + AW},${my - sy * AL}" fill="${g.stroke}" opacity="0.7"/>`;
          }
        }
      }
    }
    // labels after all paths so they sit on top. Phase 6: anchor each label to the
    // pipe's longest straight segment, on a short leader offset off the line (never
    // on it), rotated with the segment. Collision-scored against boxes/bubbles.
    // ponytail: text box in pidTextBoxes math (audit agrees by construction)
    const textBox = (x, y, str, fnt, mid = true) => {
      const w = String(str).length * fnt * 0.55, h = fnt * 1.15;
      return mid ? { x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y } : { x0: x, x1: x + w, y0: y - h, y1: y };
    };
    // ponytail: L6 — nozzle tags pick the clear side (default normal, else
    // flipped) BEFORE line labels place; zones + emission share these coords
    // so nothing drifts. Own-nozzle stubs may graze (offset clears them).
    const tagLineSegs = [];
    for (const gg of geometries) for (const sgm of PIDEngine.segs(gg.pts)) tagLineSegs.push({ sgm, gg });
    for (const t of tapGeos) for (const sgm of PIDEngine.segs(t.pts)) tagLineSegs.push({ sgm });
    for (const nz of (data.nozzles || [])) {
      if (!nz.tipPosition) continue;
      const orient = nz.orientation || 0;
      const nx = -Math.sin(orient * Math.PI / 180), ny = Math.cos(orient * Math.PI / 180);
      const rad = orient * Math.PI / 180, dx = Math.cos(rad), dy = Math.sin(rad);
      const along = dy === 1 ? 10 : dx === 0 ? 0 : -4;
      const place = (flip) => {
        const s = flip ? -1 : 1;
        return {
          x: nz.tipPosition.x + nx * s * (nz.auto ? 4 : 6) + dx * (nz.auto ? 8 : along),
          y: nz.tipPosition.y + ny * s * (nz.auto ? 4 : 6) + dy * (nz.auto ? 8 : along),
        };
      };
      const boxOf = (p) => textBox(p.x, p.y, nz.id, fs(2.2));
      // ponytail: L6 — symbol boxes too (pushing along must not trade a
      // line graze for a stack collision); bubbles included, own owner
      // excluded (the tag lives beside its own metal by design)
      const solidBoxes = [...equipment, ...valves]
        .filter(e => e.id !== nz.ownerId)
        .map(e => { const s = sizeOf(e); return { x0: e.x - s / 2 - 2, x1: e.x + s / 2 + 2, y0: e.y - s / 2 - 2, y1: e.y + s / 2 + 2 }; });
      for (const i of instruments) {
        const s = sizeOf(i);
        solidBoxes.push({ x0: i.x - s / 2 - 2, x1: i.x + s / 2 + 2, y0: i.y - s / 2 - 2, y1: i.y + s / 2 + 2 });
      }
      const hit = (p) => {
        const b = boxOf(p);
        if (solidBoxes.some(r => collide.rectsHit(b, r))) return true;
        return tagLineSegs.some(({ sgm, gg }) => {
          if (gg && ((gg.p._from && gg.p._from.nozzle === nz.id) || (gg.p._to && gg.p._to.nozzle === nz.id))) return false;
          return collide.segHitsRect(sgm, b, 1);
        });
      };
      // ponytail: L6 candidates in order — default, flipped normal, then
      // +8mm along variants; first clear wins (legacy stable on ties)
      const cands = [place(false), place(true)];
      for (const flip of [false, true]) {
        const s = flip ? -1 : 1, ex = 8;
        cands.push({
          x: nz.tipPosition.x + nx * s * (nz.auto ? 4 : 6) + dx * ((nz.auto ? 8 : along) + ex),
          y: nz.tipPosition.y + ny * s * (nz.auto ? 4 : 6) + dy * ((nz.auto ? 8 : along) + ex),
        });
      }
      let tp = cands[0];
      for (const c of cands) { if (!hit(c)) { tp = c; break; } }
      nz.tagX = tp.x; nz.tagY = tp.y;
    }
    for (const g of geometries) {
      if (!g.label || g.labelOnce) continue;
      const pts = g.pts;
      // ponytail: longest-first segment candidates — a pinched longest run
      // shouldn't force a collision when a shorter run sits in the clear
      const cands = [];
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k];
        const horiz = Math.abs(a.y - b.y) < 0.5;
        const len = horiz ? Math.abs(a.x - b.x) : Math.abs(a.y - b.y);
        if (len >= 12) cands.push({ a, b, horiz, len });
      }
      cands.sort((p, q) => q.len - p.len);
      if (!cands.length) continue;
      const minY = Math.min(g.pA.y, g.pB.y);
      // entity tag stacks live below symbols — keep line labels out of them.
      // ponytail: nozzle tags reserved too (same tip+offset math as emission) —
      // the line-avoid preference kept dodging into NZ-C101-2's tag otherwise.
      const tagZones = [...equipment, ...valves].map(e => {
        const s = sizeOf(e);
        const ty = e.y + s / 2 + 3.5;
        return { x: e.x, y0: ty - 7, y1: ty + 12 };
      });
      for (const nz of (data.nozzles || [])) {
        if (nz.tagX === undefined) continue; // ponytail: L6 shared coords
        tagZones.push({ x: nz.tagX, y0: nz.tagY - 7, y1: nz.tagY + (nz.size ? 9 : 4) });
      }
      // ponytail: L3 — off-page ref texts reserve their zone like nozzle tags
      for (const jn of junctions) {
        if (jn.offpage && jn.ref) tagZones.push({ x: jn.x, y0: jn.y + 14, y1: jn.y + 30 });
      }
      const placedLabels = renderInto._placedLabels || (renderInto._placedLabels = []);
      // ponytail: annotation pass runs on final geometry — line labels avoid
      // routed lines too (3mm corridor), not just boxes/tags. Uses collide
      // exact test; own line excluded by construction (anchor is off-line).
      // ponytail: line-avoid is a preference pass, not a veto — a short span
      // can have no line-clear slot; falling back to line-adjacent (status quo)
      // beats dodging into an unprotected nozzle tag.
      const lineSegs = [];
      for (const gg of geometries) {
        if (gg === g) continue;
        for (const sgm of PIDEngine.segs(gg.pts)) lineSegs.push(sgm);
      }
      const hitsLine = (x, y) => {
        for (const sgm of lineSegs) {
          if (collide.segHitsRect(sgm, { x0: x - 8, x1: x + 8, y0: y - 3, y1: y + 1 }, 2)) return true;
        }
        return false;
      };
      const clear = (x, y, hw, horiz) => {
        // ponytail: L2 — tail-aware: a wide designation centered on a clear
        // anchor still tail-grazes neighboring text; test the full span box.
        const hw0 = hw || 0, hz = horiz !== false;
        if ([...equipment, ...valves].some(e => {
          const s = sizeOf(e);
          return x + (hz ? hw0 : 0) > e.x - s / 2 - 6 && x - (hz ? hw0 : 0) < e.x + s / 2 + 6 &&
            y + (hz ? 0 : hw0) > e.y - s / 2 - 6 && y - (hz ? 0 : hw0) < e.y + s / 2 + 6;
        })) return false;
        if (junctions.some(j => Math.abs(j.x - x) < 8 + (hz ? hw0 : 0) && y > Math.min(j.y, minY) - 8 - (hz ? 0 : hw0) && y < Math.max(j.y, minY) + 8 + (hz ? 0 : hw0))) return false;
        if (instruments.some(i => Math.abs(i.x - x) < 22 + (hz ? hw0 : 0) && Math.abs(i.y - y) < 30 + (hz ? 0 : hw0))) return false;
        if (tagZones.some(t => Math.abs(t.x - x) < 20 + (hz ? hw0 : 0) && y > t.y0 - (hz ? 0 : hw0) && y < t.y1 + (hz ? 0 : hw0))) return false;
        if (placedLabels.some(t => Math.abs(t.x - x) < 24 + (hz ? hw0 : 0) && Math.abs(t.y - y) < 8 + (hz ? 0 : hw0))) return false;
        return true;
      };
      const off = ruleParam('annotation.labelOffset', 14);
      let anchor = null, ang = 0, lm = null, anchorLineFree = false;
      // ponytail: L2 tail span — test the full designation width, not the anchor
      const hw = String(g.label || '').length * fs(2.6) * 0.55 / 2;
      // ponytail: slide along the run (30/70%) as well as across it — a wide
      // designation centered mid-run can tail-graze text the anchor itself clears
      // Two sweeps: line-clear anchors first, any clear anchor second.
      for (const wantLineFree of [true, false]) {
        for (const best of cands) {
          const at = (f) => ({ x: best.a.x + (best.b.x - best.a.x) * f, y: best.a.y + (best.b.y - best.a.y) * f });
          const sidesFor = (o) => best.horiz ? [{ dx: 0, dy: -o }, { dx: 0, dy: o }] : [{ dx: -o, dy: 0 }, { dx: o, dy: 0 }];
          // ponytail: try wider standoffs before giving up into a collision
          for (const f of [0.5, 0.3, 0.7]) {
            const m = at(f);
            for (const o of [off, ruleParam('annotation.labelOffsetWide', 28)]) {
              for (const s of sidesFor(o)) {
                if (!clear(m.x + s.dx, m.y + s.dy, hw, best.horiz)) continue;
                if (wantLineFree && hitsLine(m.x + s.dx, m.y + s.dy)) continue;
                anchor = { x: m.x + s.dx, y: m.y + s.dy }; lm = m;
                anchorLineFree = wantLineFree;
                break;
              }
              if (anchor) break;
            }
            if (anchor) break;
          }
          if (anchor) { ang = best.horiz ? 0 : 90; break; }
        }
        if (anchor) break;
      }
      if (!anchor) {
        // ponytail: fallback also honors clear() — unguarded default was the
        // leak (every guarded candidate failing landed here and collided).
        // Try both sides at both standoffs before accepting a collision.
        const best = cands[0];
        lm = { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 };
        ang = best.horiz ? 0 : 90;
        const wide = ruleParam('annotation.labelOffsetWide', 28);
        anchor = null;
        for (const [dx, dy] of [[0, -off], [0, off], [0, -wide], [0, wide]]) {
          const cand = { x: lm.x + dx, y: lm.y + dy };
          if (clear(cand.x, cand.y, hw, best.horiz)) { anchor = cand; break; }
        }
        if (!anchor) anchor = { x: lm.x, y: lm.y - off }; // crowded span: audit reports it
      }
      placedLabels.push(anchor);
      const lead = (Math.abs(anchor.x - lm.x) > 1 || Math.abs(anchor.y - lm.y) > 1)
        ? `<line x1="${lm.x}" y1="${lm.y}" x2="${anchor.x}" y2="${anchor.y}" stroke="#0D47A1" stroke-width="0.3" stroke-dasharray="2 2"/>` : '';
      pipesSvg += lead + `<text x="${anchor.x}" y="${anchor.y}" text-anchor="middle" font-size="${fs(2.6)}" font-style="italic" fill="#0D47A1" paint-order="stroke" stroke="white" stroke-width="3"${ang ? ` transform="rotate(${ang} ${anchor.x} ${anchor.y})"` : ''}>${esc(g.label)}</text>`;
    }

    // entity groups (chips optional; pipes are drawn above everything)
    // ponytail: L2+L6 — nozzle boxes collected at emission (final tag coords),
    // consumed by valve-stack flip below
    const nozzleBoxes = [];
    const eqBoxes = [];
    for (const e of equipment) {
      if (!shown(e, 'equipment')) continue;
      const s = sizeOf(e);
      let g = '';
      if (view.chips) g += chip(e.x, e.y, s, e.id);
      g += embedSymbol(glyphKeyOf(e), e.x, e.y, s, e.rotation);
      if (!view.hideLabels) {
        const tag = e.tag || e.id;
        // tag below the equipment, close to the symbol
        const ty = e.y + s / 2 + 3.5;
        g += `<text x="${e.x}" y="${ty}" text-anchor="middle" font-size="${fs(3.2)}" font-weight="bold" fill="#111" text-decoration="underline" paint-order="stroke" stroke="white" stroke-width="3">${esc(tag)}</text>`;
        eqBoxes.push(textBox(e.x, ty, tag, fs(3.2)));
        if (!e.noTypeLabel) g += `<text x="${e.x}" y="${ty + 5.5}" text-anchor="middle" font-size="${fs(2.8)}" fill="#666" paint-order="stroke" stroke="white" stroke-width="3">${esc(TYPE_LABELS[e.type] || e.type)}</text>`;
        if (!e.noTypeLabel) eqBoxes.push(textBox(e.x, ty + 5.5, TYPE_LABELS[e.type] || e.type, fs(2.8)));
      }
      body += `<g data-pid-id="${e.id}" class="ly-equipment">${g}</g>`;
    }

    // nozzle rendering — weld neck flanges on connected equipment ports
    if (data.nozzles && data.nozzles.length) {
      const nozzleKey = 'nozzle/weld-neck-flange';
      for (const nz of data.nozzles) {
        if (!nz.position || !nz.tipPosition) continue;
        // nozzle glyph: "base" port at x=10, "tip" port at x=75
        // glyph length in viewBox: 75 - 10 = 65 units
        // nozzle length in mm: nz.length || 14
        const nzLen = (nz.length || 14) * (SC || 1);
        const glyphLen = 65; // glyph units from base to tip
        const nzSize = nzLen * 100 / glyphLen; // scale glyph to match nozzle length
        // embedSymbolRaw positions glyph at (cx - size/2, cy - size/2)
        // glyph tip is at x=75 in viewBox, which maps to cx + 0.25*size from center
        // we want tip to align with nz.tipPosition, so offset cx
        const tipOffset = 0.25 * nzSize; // glyph tip offset from center
        const baseOffset = 0.4 * nzSize; // glyph base offset from center (x=10 -> 10/100*size - size/2 = -0.4*size)
        const orient = nz.orientation || 0;
        const rad = orient * Math.PI / 180;
        const dirX = Math.cos(rad), dirY = Math.sin(rad);
        // position glyph so tip aligns with nz.tipPosition
        const cx = nz.tipPosition.x - dirX * tipOffset;
        const cy = nz.tipPosition.y - dirY * tipOffset;
        body += embedSymbol(nozzleKey, cx, cy, nzSize, orient);
        // nozzle tag
        if (!view.hideLabels && nz.id) {
          const nx = -Math.sin(orient * Math.PI / 180);
          const ny = Math.cos(orient * Math.PI / 180);
          // ponytail: L6 — tag coords shared with the pre-pass above (clear
          // side); standoff notes live there. North needs nothing.
          const tagX = nz.tagX !== undefined ? nz.tagX : nz.tipPosition.x;
          const tagY = nz.tagY !== undefined ? nz.tagY : nz.tipPosition.y;
          body += `<text x="${tagX}" y="${tagY}" text-anchor="middle" font-size="${fs(2.2)}" fill="#444" paint-order="stroke" stroke="white" stroke-width="2">${esc(nz.id)}</text>`;
          nozzleBoxes.push(textBox(tagX, tagY, nz.id, fs(2.2)));
          if (nz.size) body += `<text x="${tagX}" y="${tagY + 4.5}" text-anchor="middle" font-size="${fs(1.8)}" fill="#888" paint-order="stroke" stroke="white" stroke-width="2">${esc(nz.size)}</text>`;
          if (nz.size) nozzleBoxes.push(textBox(tagX, tagY + 4.5, nz.size, fs(1.8)));
        }
      }
    }

    for (const v of valves) {
      if (!shown(v, 'valves')) continue;
      const s = sizeOf(v);
      let g = '';
      if (view.chips) g += chip(v.x, v.y, s, v.id);
      g += embedSymbol(glyphKeyOf(v), v.x, v.y, s, v.rotation);
      if (!view.hideLabels) {
        const tag = v.tag || v.id;
        const vertical = ((v.rotation || 0) % 180) !== 0;
        const state = [v.normal && `N/${v.normal === 'open' ? 'O' : v.normal === 'closed' ? 'C' : v.normal.toUpperCase()}`,
          v.fail && `F/${v.fail === 'open' ? 'O' : v.fail === 'closed' ? 'C' : v.fail.toUpperCase()}`].filter(Boolean).join(' ');
        // tag below for horizontal valves, to the right for vertical (rotated) valves — close to the symbol.
        // ponytail: L2 — flip the stack when it lands on a nozzle tag (the
        // relief-cluster pile): above for horizontal, left for vertical.
        const tx = vertical ? v.x + s / 2 + 3 : v.x;
        const ty = vertical ? v.y + 1 : v.y + s / 2 + 3.5;
        const typeLabel = TYPE_LABELS[v.type] || v.type;
        const rows = [[tag, fs(3.0), 0]];
        if (!v.noTypeLabel) rows.push([typeLabel, fs(2.8), 5.5]);
        if (state) rows.push([state, fs(2.3), 10.5]); // emission-fixed offsets
        const stackBoxes = (fx, fy, mid, dir) => rows.map(([str, fnt, off]) => mid
          ? textBox(fx, fy + dir * off, str, fnt)
          : { x0: fx - (dir < 0 ? String(str).length * fnt * 0.55 : 0), x1: fx + (dir < 0 ? 0 : String(str).length * fnt * 0.55), y0: fy - fnt * 1.15, y1: fy });
        const zones = [...nozzleBoxes, ...eqBoxes];
        const hits = (boxes) => boxes.reduce((n, b) => n + zones.filter(z => collide.rectsHit(b, z)).length, 0);
        // ponytail: L2 — flip only into something clearer (below is legacy;
        // above must strictly win, else the flip just moves the pile)
        let flip = false;
        if (!vertical) {
          const ty2 = v.y - s / 2 - 3.5;
          flip = hits(stackBoxes(tx, ty, true, 1)) > 0 && hits(stackBoxes(tx, ty2, true, -1)) < hits(stackBoxes(tx, ty, true, 1));
        } else {
          const tx2 = v.x - s / 2 - 3;
          flip = hits(stackBoxes(tx, ty, false, 1)) > 0 && hits(stackBoxes(tx2, ty, false, -1)) < hits(stackBoxes(tx, ty, false, 1));
        }
        if (!vertical && flip) {
          const ty2 = v.y - s / 2 - 3.5;
          g += `<text x="${tx}" y="${ty2}" text-anchor="middle" font-size="${fs(3.0)}" font-weight="bold" fill="#111" paint-order="stroke" stroke="white" stroke-width="3">${esc(tag)}</text>`;
          if (!v.noTypeLabel) g += `<text x="${tx}" y="${ty2 - 5.5}" text-anchor="middle" font-size="${fs(2.8)}" fill="#666" paint-order="stroke" stroke="white" stroke-width="3">${esc(typeLabel)}</text>`;
          if (state) g += `<text x="${tx}" y="${ty2 - 10.5}" text-anchor="middle" font-size="${fs(2.3)}" fill="#555" paint-order="stroke" stroke="white" stroke-width="3">${esc(state)}</text>`;
        } else if (vertical && flip) {
          const tx2 = v.x - s / 2 - 3;
          g += `<text x="${tx2}" y="${ty}" text-anchor="end" font-size="${fs(3.0)}" font-weight="bold" fill="#111" paint-order="stroke" stroke="white" stroke-width="3">${esc(tag)}</text>`;
          if (!v.noTypeLabel) g += `<text x="${tx2}" y="${ty + 5.5}" text-anchor="end" font-size="${fs(2.8)}" fill="#666" paint-order="stroke" stroke="white" stroke-width="3">${esc(typeLabel)}</text>`;
          if (state) g += `<text x="${tx2}" y="${ty + 10.5}" text-anchor="end" font-size="${fs(2.3)}" fill="#555" paint-order="stroke" stroke="white" stroke-width="3">${esc(state)}</text>`;
        } else {
          g += `<text x="${tx}" y="${ty}" ${vertical ? '' : 'text-anchor="middle"'} font-size="${fs(3.0)}" font-weight="bold" fill="#111" paint-order="stroke" stroke="white" stroke-width="3">${esc(tag)}</text>`;
          if (!v.noTypeLabel) g += `<text x="${tx}" y="${ty + 5.5}" ${vertical ? '' : 'text-anchor="middle"'} font-size="${fs(2.8)}" fill="#666" paint-order="stroke" stroke="white" stroke-width="3">${esc(typeLabel)}</text>`;
          if (state) g += `<text x="${tx}" y="${ty + 10.5}" ${vertical ? '' : 'text-anchor="middle"'} font-size="${fs(2.3)}" fill="#555" paint-order="stroke" stroke="white" stroke-width="3">${esc(state)}</text>`;
        }
      }
      body += `<g data-pid-id="${v.id}" class="ly-valve">${g}</g>`;
    }
  for (const inst of instruments) {
    if (!shown(inst, 'instruments')) continue;
    let glyph = glyphSvg(glyphKeyOf(inst));
    const m = inst.tag.match(/^([A-Za-z]{2,})(.*)$/);
    const letters = m ? m[1] : inst.tag;
    const loop = m ? m[2].replace(/^[^A-Za-z0-9]+/, '') : '';
    let g = '';
    if (view.chips) g += chip(inst.x, inst.y, sizeOf(inst), inst.tag);
    g += embedSymbolRaw(glyph, inst.x, inst.y, sizeOf(inst), inst.rotation);
    if (!view.hideLabels) {
      // full tag inside the bubble: letters + loop number (ISA convention)
      g += `<text x="${inst.x}" y="${inst.y + 0.5}" text-anchor="middle" font-size="${fs(3.2)}" font-weight="bold" fill="#111" paint-order="stroke" stroke="white" stroke-width="3">${esc(letters)}</text>`;
      if (loop) g += `<text x="${inst.x}" y="${inst.y + 5.5}" text-anchor="middle" font-size="${fs(2.6)}" fill="#111" paint-order="stroke" stroke="white" stroke-width="3">${esc(loop)}</text>`;
    }
    // explicit process tap: precomputed in the tap pass (min-length landing,
    // tap always breaks). Only the gap-cut emission happens here.
    // ponytail 2026-09-25 (T6.6): was `tapGeos.find(t => t.tag === inst.tag)` —
    // the FIRST tap only. The pre-pass was fixed to build geometry for every tap
    // on an instrument, but this emitter still discarded all but one, so the fix
    // appeared to do nothing (verified: two taps on PI-1 still produced one
    // leader). Iterate all of them, and disambiguate data-pid-id so two taps on
    // one tag are still separately addressable.
    const tgAll = tapGeos.filter(t => t.tag === inst.tag);
    for (let ti = 0; ti < tgAll.length; ti++) {
    const tg = tgAll[ti];
    if (tg && inst.bubble !== 'dcs') {
      // emit the tap polyline, cutting a break at each recorded crossing
      const GAP_T = ruleParam('routing.gapBreak', 4);
      let td = '';
      const cutsAt = (a, b) => tg.cuts
        .filter(c => Math.abs(a.y - b.y) < 0.5
          ? (Math.abs(c.y - a.y) < 1 && c.x > Math.min(a.x, b.x) + GAP_T + 2 && c.x < Math.max(a.x, b.x) - GAP_T - 2)
          : (Math.abs(c.x - a.x) < 1 && c.y > Math.min(a.y, b.y) + GAP_T + 2 && c.y < Math.max(a.y, b.y) - GAP_T - 2))
        .map(c => (Math.abs(a.y - b.y) < 0.5 ? c.x : c.y))
        .sort((p, q) => (Math.abs(a.y - b.y) < 0.5 ? (a.x <= b.x ? p - q : q - p) : (a.y <= b.y ? p - q : q - p)));
      for (let k = 1; k < tg.pts.length; k++) {
        const a = tg.pts[k - 1], b = tg.pts[k];
        const horiz = Math.abs(a.y - b.y) < 0.5;
        if (!td) td = `M ${a.x} ${a.y}`;
        const cuts = cutsAt(a, b);
        if (!cuts.length) { td += ` L ${b.x} ${b.y}`; continue; }
        for (const c of cuts) {
          // keep break direction of travel (path may run either way)
          const fwd = horiz ? (b.x >= a.x ? 1 : -1) : (b.y >= a.y ? 1 : -1);
          const q0 = horiz ? { x: c - GAP_T * fwd, y: a.y } : { x: a.x, y: c - GAP_T * fwd };
          const q1 = horiz ? { x: c + GAP_T * fwd, y: a.y } : { x: a.x, y: c + GAP_T * fwd };
          td += ` L ${q0.x} ${q0.y}`;
          td += ` M ${q1.x} ${q1.y}`;
        }
        td += ` L ${b.x} ${b.y}`;
      }
      if (td) g += `<path d="${td}" class="pid-tap-leader" stroke="black" stroke-width="1" fill="none" data-pid-id="tap-${inst.tag}${tgAll.length > 1 ? '-' + (ti + 1) : ''}"/>`;
    }
    }   // end of per-tap emission loop (T6.6)
    body += `<g data-pid-id="${inst.tag}" class="ly-instrument">${g}</g>`;
  }
  body += pipesSvg;
  for (const j of junctions) {
    // ponytail: r=2.5 branch dot (was 3.5 blob); SVG-only, unmeasured
    if (j.offpage) {
      // ponytail: L3 — off-page connector marker, arrow pointing at the
      // continuation partner (glyph native direction is east)
      const inc = (data.junctionGraph[j.id] || [])[0];
      let rot = 0;
      if (inc) {
        const otherId = inc.pipe.from === j.id ? inc.pipe.to : inc.pipe.from;
        const o = byId[otherId];
        if (o) {
          const dx = (o.x || 0) - j.x, dy = (o.y || 0) - j.y;
          rot = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 180) : (dy >= 0 ? 90 : 270);
        }
      }
      body += `<g data-pid-id="${j.id}" class="ly-junction">${embedSymbol('isa-5.1/layout/off-page-connector', j.x, j.y, 24, rot)}`;
      if (j.ref && !view.hideLabels) body += `<text x="${j.x}" y="${j.y + 22}" text-anchor="middle" font-size="${fs(2.6)}" font-style="italic" fill="#444" paint-order="stroke" stroke="white" stroke-width="2">${esc(j.ref)}</text>`;
      body += `</g>`;
      continue;
    }
    body += `<circle class="pid-junction-dot" cx="${j.x}" cy="${j.y}" r="2.5" fill="#1E90FF" data-pid-id="${j.id}"/>`;
  }

  // nozzles on used connections
  for (const e of [...equipment, ...valves]) {
    if (!shown(e, e.type ? 'equipment' : 'valves')) continue;
    const key = glyphKeyOf(e);
    const size = sizeOf(e);
    const used = data.usedPorts[e.id] || [];
    for (const conn of used) {
      if (conn.type !== 'nozzle') continue;
      // ponytail: prefer the cardinal nozzle tip the pipe actually lands on
      // (resolveNozzlePositions); else snap the fractional glyph dir to an axis
      const nz = (data.nozzles || []).find(n => n.ownerId === e.id && n.portId === conn.id);
      let at, tip;
      if (nz && nz.position && nz.tipPosition) {
        at = nz.position; tip = nz.tipPosition;
      } else {
        at = PIDEngine.connWorld(e, conn, size, { noNozzle: true });
        tip = connWorld(e, conn, size);
        const dx = tip.x - at.x, dy = tip.y - at.y, len = Math.hypot(dx, dy);
        if (len > 0.5) tip = Math.abs(dx) >= Math.abs(dy)
          ? { x: at.x + Math.sign(dx) * len, y: at.y }
          : { x: at.x, y: at.y + Math.sign(dy) * len };
      }
      body += `<path class="pid-nozzle-leader" d="M ${at.x} ${at.y} L ${tip.x} ${tip.y}" stroke="black" stroke-width="2.5" fill="none"/>`;
    }
  }

  svg.innerHTML = wrap + body + (wrap ? '</g>' : '') + annotationsSvg(data, W, H);
  globalThis.__LAST_SVG = (wrap ? wrap : '') + body + (wrap ? '</g>' : '') + annotationsSvg(data, W, H);
  // must run after every fs() call above, and before finalizeValidation, which is
  // where the score is priced from the warning list
  checkTypeBand();
  const lineIssues = validateGeometry(data, geometries, pipes, tapGeos);
  finalizeValidation(data);

  // transparency mode: neutralize white glyph fills so overlaps are visible
  if (!view.chips) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = '.sym-fill, .sym-fill-light { fill: none; }';
    svg.appendChild(style);
  }

  // ---- drafting theme identity on the root (stylesheet itself is in `body`,
  // emitted as raw markup at the top so it also survives node-side export) ----
  svg.setAttribute('data-theme', themeKey);
  svg.setAttribute('color', T.equipment);       // 430 currentColor glyph strokes

  // ---- drawing fitness: grouped terms, one comparable total (the fitness meter) ----
  const SHEET = PIDEngine.sheetBounds(data.view.sheetW, data.view.sheetH);
  // NEGATIVE RESULT (2026-09-25, reverted) — there is deliberately NO sheet-use
  // term here, even though every other term rewards compactness and so the meter
  // is blind to the void. I added one (weight 140, on min(useW,useH)) and it was
  // wrong twice over:
  //   1. It measured only pipe geometry, so it read the demo at 32% useH where
  //      the entity-aware audit `[11]` reads 56% — a 2x under-measure that made
  //      the term mostly noise.
  //   2. Having no lever, it just added cost: min 58 -> 186 and split 36 -> 135
  //      with NO layout change at all. It punished legitimately small drawings
  //      hardest, which is the opposite of useful.
  // See P&ID-VISUAL-QUALITY.md 9.20 for the full sweep, including the measured
  // fact that `useW` is pinned at 65% for EVERY candidate on the demo sheet.
  let pp = 0, ps = 0, ss = 0, bends = 0, length = 0, nonOrtho = 0, offSheet = 0;
  const segList = geometries.map(g => g.pts.length < 2 ? [] : PIDEngine.segs(g.pts));
  for (let i = 0; i < geometries.length; i++) {
    if (!segList[i].length) continue;
    for (let j = i + 1; j < geometries.length; j++) {
      if (!segList[j].length) continue;
      for (const si of segList[i]) for (const sj of segList[j]) {
        if (!PIDEngine.isRealCrossing(si, sj)) continue;
        if (geometries[i].signal && geometries[j].signal) ss++;
        else if (geometries[i].signal || geometries[j].signal) ps++;
        else pp++;
      }
    }
  }
  for (const g of geometries) {
    const pts = g.pts;
    let out = false;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      length += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
      if (dx > 0.5 && dy > 0.5) nonOrtho++;
      // ponytail: per-pipe, not per-segment — one excursion is one defect,
      // not N (the old count tripled a single 1mm margin graze)
      if (!out && (a.x < SHEET.x0 || a.x > SHEET.x1 || a.y < SHEET.y0 || a.y > SHEET.y1 ||
          b.x < SHEET.x0 || b.x > SHEET.x1 || b.y < SHEET.y0 || b.y > SHEET.y1)) { offSheet++; out = true; }
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      const dot = (p1.x - p0.x) * (p2.x - p1.x) + (p1.y - p0.y) * (p2.y - p1.y);
      if (Math.abs(dot) < 0.5) bends++;
    }
  }
  // annotation collisions: overlap between any two rendered label text boxes
  // (model-side boxes — identical in node and browser, see pidTextBoxes)
  let labelCollisions = 0;
  const textBoxes = pidTextBoxes(svg.innerHTML || '');
  for (let i = 0; i < textBoxes.length; i++) {
    for (let j = i + 1; j < textBoxes.length; j++) {
      const a = textBoxes[i], b = textBoxes[j];
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) labelCollisions++;
    }
  }
  // instrument placement: tap reaches and signal runs (already warned on; quantified here)
  let tapReachTotal = 0, maxSignalLen = 0;
  const r = 4.5 * (data.view.symbolScale || 1);
  // ponytail: tap-corridor residuals — a tap vertical sharing ≥10mm with a
  // process vertical survived wire-spacing (pinned start or blocked sides);
  // approval must see it (was silent: unscored, unwarned)
  for (const t of tapGeos) {
    let shared = 0;
    for (const ts of PIDEngine.segs(t.pts)) {
      if (Math.abs(ts[0].x - ts[1].x) > 0.5) continue;
      for (const gg of geometries) {
        for (const sgm of PIDEngine.segs(gg.pts)) {
          if (Math.abs(sgm[0].x - sgm[1].x) > 0.5 || Math.abs(sgm[0].x - ts[0].x) > 1.5) continue;
          shared = Math.max(shared, Math.min(Math.max(sgm[0].y, sgm[1].y), Math.max(ts[0].y, ts[1].y)) - Math.max(Math.min(sgm[0].y, sgm[1].y), Math.min(ts[0].y, ts[1].y)));
        }
      }
    }
    if (shared >= 10) data.warnings.push(`[PID-INS-005] tap "${t.tag}": shares ${Math.round(shared)}mm of process corridor (reads as one line) — move the bubble or add a via`);
  }  for (const p of pipes) {
    if (p.kind === 'tap') {
      const inst = data.instruments.find(i => i.tag === p.from);
      if (!inst) continue;
      const hostGeom = collide.tapHostGeom(geometries, p._tap.host, p._tap.port);
      if (!hostGeom) continue;
      const pts = hostGeom.pts;
      let best = Infinity;
      for (let k = 0; k < pts.length - 1; k++) {
        const s = pts[k], e2 = pts[k + 1];
        if (Math.abs(s.y - e2.y) < 0.5 && inst.x >= Math.min(s.x, e2.x) - 2 && inst.x <= Math.max(s.x, e2.x) + 2 && s.y >= inst.y) best = Math.min(best, s.y);
      }
      if (best < Infinity) tapReachTotal += Math.max(0, best - (inst.y + r));
    } else if (p.kind === 'signal') {
      const g = geometries.find(gg => gg.p === p);
      if (g) for (let k = 1; k < g.pts.length; k++) maxSignalLen = Math.max(maxSignalLen, Math.abs(g.pts[k].x - g.pts[k - 1].x) + Math.abs(g.pts[k].y - g.pts[k - 1].y));
    }
  }
  // ponytail: unified severity tiers (see PID_RULES.weights — single currency).
  const SW = PID_RULES.weights;
  const nErr = data.errors.length, nWarn = data.warnings.length;
  // A* give-ups are REPORTED but not scored. See the note on `weights` in
  // pid-rules.js: a flat cost cannot tell a benign sibling-stub overlap from a
  // line driven through a symbol, and pricing it made the search swap a visible
  // label collision for an invisible one. The count is the diagnostic; the fix
  // for a high count is the obstacle budget, not the meter.
  const astarGiveups = (data.astarGiveups || []).length;
  const score = {
    total: Math.round(
      SW.err * nErr + SW.nonOrtho * nonOrtho + SW.overlap * Math.min(lineIssues.overlaps, 5) +
      SW.ungapped * lineIssues.ungapped +
      SW.pp * pp + SW.ps * ps + SW.ss * ss + SW.label * labelCollisions + SW.sheet * offSheet +
      SW.bend * bends + SW.len * length + SW.tap * tapReachTotal + SW.sig * maxSignalLen +
      SW.warn * nWarn),
    weights: SW,
    routing: { crossings: pp + ps + ss, pp, ps, ss, bends, length: Math.round(length), nonOrtho },
    sheet: { offSheet },
    annotations: { labelCollisions },
    lines: { overlaps: lineIssues.overlaps, ungapped: lineIssues.ungapped, astarGiveups },
    instruments: { tapReachTotal: Math.round(tapReachTotal), maxSignalLen: Math.round(maxSignalLen) },
    issues: { errors: nErr, warnings: nWarn }
  };
  svg.__pidScore = score;
  return score;
}

//  drafting annotations: border, title block, legend, north arrow 
/**
 * Description placeholder
 *
 * @param {*} data 
 * @param {*} W 
 * @param {*} H 
 * @returns {string} 
 */

function annotationsSvg(data, W, H) {
  if (!data.view.fitPage) return '';
  const v = data.view;
  const pad = 18;
  let s = '';

  // border frame (double line)
  s += `<rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}" fill="none" stroke="#333" stroke-width="2"/>`;
  s += `<rect x="${pad + 6}" y="${pad + 6}" width="${W - 2 * pad - 12}" height="${H - 2 * pad - 12}" fill="none" stroke="#333" stroke-width="1"/>`;

  // north arrow, top-right inside the frame
  if (v.northArrow) {
    const na = glyphSvg('pip/layout/north-arrow');
    if (na) {
      s += `<svg x="${W - 92}" y="${pad + 28}" width="46" height="46" xmlns="http://www.w3.org/2000/svg">${na}</svg>`;
      s += `<text x="${W - 69}" y="${pad + 84}" text-anchor="middle" font-size="11" font-weight="bold" fill="#333">N</text>`;
    }
  }

  // legend, bottom-left inside the frame
  if (v.legend) {
    const lx = pad + 24, ly = H - pad - 48;
    const entries = [
      { key: 'isa-5.1/instruments/field-instrument', label: 'Field instrument', size: 30 },
      { key: 'isa-5.1/instruments/shared-display', label: 'DCS function', size: 30 },
      { key: 'isa-5.1/valves/gate', label: 'Gate valve', size: 26 },
      { key: 'pip/equipment/pump-centrifugal', label: 'Pump', size: 30 },
      { key: 'signal', label: 'Signal line', size: 0 },
      { key: 'line', label: 'Line designation', size: 0 }
    ];
    const rowH = 30, colW = 230;
    s += `<rect x="${lx - 12}" y="${ly - 12 - entries.length * rowH - 26}" width="${colW + 24}" height="${entries.length * rowH + 52}" fill="white" stroke="#333" stroke-width="1.5"/>`;
    s += `<text x="${lx}" y="${ly - entries.length * rowH - 4}" font-size="13" font-weight="bold" fill="#111">LEGEND</text>`;
    entries.forEach((en, i) => {
      const ey = ly - (entries.length - 1 - i) * rowH;
      if (en.key === 'signal') {
        s += `<line x1="${lx}" y1="${ey - 3}" x2="${lx + 46}" y2="${ey - 3}" stroke="#444" stroke-width="1.5" stroke-dasharray="8 5"/>`;
      } else if (en.key === 'line') {
        s += `<text x="${lx}" y="${ey}" font-size="9" font-style="italic" fill="#0D47A1">4"-PG-101-1E1</text>`;
      } else {
        const g = glyphSvg(en.key);
        if (g) s += `<svg x="${lx}" y="${ey - en.size}" width="${en.size}" height="${en.size}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
      }
      s += `<text x="${lx + 58}" y="${ey - 5}" font-size="11" fill="#333">${en.label}</text>`;
    });
  }

  // title block, bottom-right inside the frame (compact)
  if (v.title) {
    const bx = W - pad - 160, by = H - pad - 60, bw = 160, bh = 60;
    s += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="white" stroke="#333" stroke-width="1.5"/>`;
    s += `<line x1="${bx}" y1="${by + 17}" x2="${bx + bw}" y2="${by + 17}" stroke="#333" stroke-width="1"/>`;
    s += `<text x="${bx + 8}" y="${by + 12}" font-size="8" font-weight="bold" fill="#111">${esc(v.title)}</text>`;
    if (v.project) s += `<text x="${bx + 8}" y="${by + 26}" font-size="6" fill="#333">Project: ${esc(v.project)}</text>`;
    if (v.sheet) s += `<text x="${bx + 8}" y="${by + 35}" font-size="6" fill="#333">Sheet ${v.sheet}${v.sheetTotal !== v.sheet ? ' of ' + v.sheetTotal : ''}</text>`;
    if (v.rev) s += `<text x="${bx + 8}" y="${by + 44}" font-size="6" fill="#333">Rev ${v.rev.mark} (${v.rev.date})${v.rev.desc ? ' - ' + v.rev.desc : ''}</text>`;
    s += `<text x="${bx + 8}" y="${by + 54}" font-size="5" fill="#666">P&amp;ID Gen ${new Date().toISOString().slice(0, 10)}</text>`;
  }

  return s;
}

/**
 * Description placeholder
 *
 * @param {*} x 
 * @param {*} y 
 * @param {*} size 
 * @param {*} pidId 
 * @returns {string} 
 */
function chip(x, y, size, pidId) {
  const attr = pidId ? ` data-pid-id="${pidId}"` : '';
  return `<rect x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" fill="white"${attr}/>`;
}

/**
 * Description placeholder
 *
 * @param {*} key 
 * @param {*} cx 
 * @param {*} cy 
 * @param {*} size 
 * @param {*} rotation 
 * @returns {string} 
 */

function embedSymbol(key, cx, cy, size, rotation) {
  return embedSymbolRaw(glyphSvg(key), cx, cy, size, rotation);
}

/**
 * Description placeholder
 *
 * @param {*} glyph 
 * @param {*} cx 
 * @param {*} cy 
 * @param {*} size 
 * @param {*} rotation 
 * @returns {string} 
 */

function embedSymbolRaw(glyph, cx, cy, size, rotation) {
  if (!glyph) return '';
  // ponytail: glyphs are pure geometry — strip baked-in <text> (e.g. the MAG
  // label in magnetic-flowmeter). Glyph-local coords poison collision
  // measurement and ignore the type system; all labels are placed by the
  // renderer. Was instrument-only; now covers every symbol.
  glyph = glyph.replace(/<text[\s\S]*?<\/text>/g, '');
  if (rotation) {
    const t = ` transform="translate(${cx - size / 2} ${cy - size / 2}) rotate(${rotation} ${size / 2} ${size / 2})"`;
    // glyph carries its own natural mm viewBox â€” embed at 1:1
    return `<svg${t} width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${glyph}</svg>`;
  }
  return `<svg x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${glyph}</svg>`;
}

/**
 * Build the theme stylesheet for a token set.
 *
 * Selectors deliberately include ATTRIBUTE selectors on the existing literal
 * colours (e.g. `text[fill="#111"]`). CSS beats presentation attributes, so
 * these remap the current emission sites to tokens without touching any of
 * them — which is why adding a theme was four small edits instead of ~36.
 *
 * @param {*} T resolved theme tokens
 * @returns {string} stylesheet text
 */
function themeCss(T) {
  return `
svg[data-theme]{background:${T.bg}}
/* --- all annotation type is uppercase ---
   Applied as a PRESENTATION rule rather than by uppercasing the data. The DSL keeps
   its authored case, so toSource() still round-trips what the user typed, the
   validator still matches the original strings, and nothing that compares text
   (tag lookup, collision keys, the DSL textarea) is affected. Only what is drawn
   changes. */
svg[data-theme] text{text-transform:uppercase}
/* --- layers: entity groups; glyph strokes are currentColor and inherit --- */
.ly-equipment{color:${T.equipment}}
.ly-valve{color:${T.valve}}
.ly-instrument{color:${T.instrument}}
.ly-nozzle{color:${T.nozzle}}
.ly-junction{color:${T.junction}}
/* --- lines --- */
.pid-line.pid-process{stroke:${T.process};fill:none}
.pid-line.pid-signal{stroke:${T.signal};fill:none}
.pid-line.pid-tap{stroke:${T.utility};fill:none}
.pid-tap-leader{stroke:${T.utility}}
circle.pid-junction-dot{fill:${T.junction};stroke:none}
.pid-nozzle-leader{stroke:${T.nozzle};fill:none}
/* --- text, by the role each literal already encoded --- */
text[fill="#111"]{fill:${T.text}}
text[fill="#666"],text[fill="#555"],text[fill="#444"]{fill:${T.text2}}
text[fill="#888"]{fill:${T.text3}}
text[fill="#0D47A1"]{fill:${T.lineTag}}
text[fill="#333"]{fill:${T.frame}}
/* --- the halo: MUST follow the background, or labels glow on black --- */
[stroke="white"]{stroke:${T.halo}}
[stroke="black"]{stroke:${T.equipment}}
rect[stroke="#333"]{stroke:${T.frame}}
rect[fill="white"]{fill:${T.bg}}
line[stroke="#444"]{stroke:${T.signal}}
`;
}

//  public API 

window.PIDGenerator = {
  componentIds() { return Object.keys(window.PID_SYMBOLS); },
  symbolConnections(key) { return symbolConnections(key); },
  parse(source) {
    const data = PID_PARSER.parse(source);
    return { data, warnings: data.warnings, errors: data.errors, info: data.info };
  },
  renderPid(source, containerId, opts) {
    // ponytail: candidates mode (plan Phase 3) — legacy single render plus N
    // seeded variants, winner by score.total (ties → lower seed = earlier).
    // Legacy always competes, so candidates mode never regresses vs single.
    // layouts mode: N different layout orderings (barycenter noise), each with
    // full pipeline. Picks the best layout × routing combination.
    // optimize mode: simulated annealing over valve positions — perturbs valves
    // along their process lines, re-renders, accepts/rejects by SA criterion.
    const n = Math.max(0, (opts && opts.candidates) || 0);
    const nLayouts = Math.max(0, (opts && opts.layouts) || 0);
    const nOptimize = Math.max(0, (opts && opts.optimize) || 0);
    const seedBase = (opts && opts.seedBase !== undefined) ? opts.seedBase : 1;
    // Drafting theme (D4). Option wins over the DSL `theme` directive, which is
    // resolved inside renderInto from the model.
    const themeOpt = (opts && opts.theme) || null;
    const runOnce = (seed) => {
      pidSeed(seed);
      const data = PID_PARSER.parse(source, {
        layoutOrder: placement ? placement.ord : null,
        coordIters: placement ? placement.sw : undefined,
        minSep: placement ? placement.sep : undefined,
      });
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('id', containerId + '-svg');
      svg.setAttribute('role', 'img');
      const score = renderInto(svg, data, themeOpt);
      return { seed, svg, data, score };
    };
    if (!n && !nLayouts && !nOptimize) {
      // ponytail: honor a pinned `seed N` directive (single render reproduces
      // the winning candidate exactly); absent = legacy bit-identical path
      const sm = String(source).match(/^\s*seed\s+(\d+)\s*$/m);
      pidSeed(sm ? parseInt(sm[1], 10) : null);
      const container = document.getElementById(containerId);
      if (!container) throw new Error(`PIDGenerator: container #${containerId} not found`);
      // ponytail: PLACEMENT SEARCH. Two dimensions, both chaotic landscapes that
      // cannot be hand-tuned (measured — see the table in autoLayout and the
      // coord-sweep results: adjacent minSep values swing spike by 2x and flip
      // errors on and off). So search instead of choosing:
      //   1. placement-pass ORDER   (J = junctions, V = valve enforcement, I = instruments)
      //   2. coordinate sweeps      (0 = legacy index seed, N = median assignment)
      //   3. minimum separation     (vertical room between entities sharing a rank)
      // Every candidate is a complete render; the lowest score.total wins. The
      // legacy configuration (first order, 0 sweeps) is always in the list, so
      // this can never be worse than a single fixed choice. Deterministic (no
      // RNG), so a sheet always reproduces.
      //
      // Dimension 3 exists because of the sheet-use term. Until the meter had one
      // it rewarded compactness on every other axis and was blind to the void, so
      // it never chose to spend sheet. `minSep` is the only lever that trades
      // extent against run length, and with it in the search the engine can buy a
      // fuller sheet when the crossings are worth it — and decline to when they
      // are not (which is what it does on min.dsl, which must stay compact).
      const doCoord = ruleParam('layout.coordSearch', 1);
      const sweeps = doCoord ? [0, ruleParam('layout.coordSweeps', 8)] : [0];
      // `minSepAlt` is the third search dimension and the only lever that trades
      // sheet extent against run length. It is DEDUPED against `minSep` so the
      // default config renders the same 6 candidates it always did: enabling it
      // is a deliberate act (set minSepAlt > minSep), not a silent 2x slowdown.
      // Measured: at 75 it buys the demo 30% -> 35% useH for +1 crossing; at
      // 110, 30% -> 50%. It is off by default because nothing in the meter
      // currently values the extent it buys (see the reverted sheet-use term).
      const sepBase = ruleParam('layout.minSep', 45), sepAlt = ruleParam('layout.minSepAlt', 45);
      const seps = doCoord && sepAlt > sepBase ? [sepBase, sepAlt] : [sepBase];
      const orders = ruleParam('layout.orderSearch', 1)
        ? PID_LAYOUT_ORDERS.slice(0, Math.max(1, ruleParam('layout.orderCandidates', 3)))
        : [PID_LAYOUT_ORDERS[0]];
      let bestOrder = null;
      for (const ord of orders) {
        for (const sw of sweeps) {
          for (const sep of seps) {
            const data = PID_PARSER.parse(source, { layoutOrder: ord, coordIters: sw, minSep: sep });
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('id', containerId + '-svg');
            svg.setAttribute('role', 'img');
            const score = renderInto(svg, data, themeOpt);
            // snapshot the debug geometry WITH the candidate, so the winner's can be
            // restored below (see the note at the restore site)
            const geo = window.__pidGeo;
            if (!bestOrder || score.total < bestOrder.score.total) {
              bestOrder = { ord, sw, sep, svg, data, score, geo };
            }
          }
        }
      }
      const { svg, data, score } = bestOrder;
      container.innerHTML = '';
      container.appendChild(svg);
      // Re-publish the debug geometry from the WINNING candidate.
      //
      // `window.__pidGeo` is written inside renderInto, and every candidate is a
      // complete render (see the comment above), so it is written once per candidate
      // and the last write survives — which is the last candidate TRIED, not the one
      // that won. Measured on the demo: __pidGeo spanned y 72..542 while the emitted
      // drawing spanned y 222..372, so the pipe-routes and crossings overlays
      // described a layout that was not on screen. That is what made the overlay
      // checkboxes useless, and it is the same shared-mutable-state-across-a-search
      // hazard as the module globals noted elsewhere.
      //
      // Fixed by snapshotting per candidate and restoring the winner's, rather than
      // re-deriving: renderInto has already done the work and re-running it would
      // cost a full route.
      if (bestOrder.geo) window.__pidGeo = bestOrder.geo;
      return {
        svg: svg.outerHTML, warnings: data.warnings, errors: data.errors,
        info: data.info, score, data, layoutOrder: bestOrder.ord,
        coordIters: bestOrder.sw, minSep: bestOrder.sep,
      };
    }
    // ponytail: multi-start — try N random layouts, each with optional M routing
    // candidates. Layout seeds activate barycenter noise in autoLayout; routing
    // seeds activate A*/refinement tie-breaks. Total renders = nLayouts * (n + 1).
    //
    // Placement (order + coordinate sweeps + min separation) is resolved ONCE
    // here, on the legacy seed, and then held fixed for every routing candidate.
    // It is deterministic and independent of the routing seed, so re-searching it
    // per candidate would multiply cost for nothing — and NOT searching it at all
    // left this path scoring worse than the default path (regress caught it:
    // "candidates winner 1317 worse than blessed 1065").
    const placement = (() => {
      if (!ruleParam('layout.orderSearch', 1) && !ruleParam('layout.coordSearch', 1)) return { ord: null, sw: null, sep: null };
      const doCoord = ruleParam('layout.coordSearch', 1);
      const sweeps = doCoord ? [0, ruleParam('layout.coordSweeps', 8)] : [0];
      const sepBase = ruleParam('layout.minSep', 45), sepAlt = ruleParam('layout.minSepAlt', 45);
      const seps = doCoord && sepAlt > sepBase ? [sepBase, sepAlt] : [sepBase];
      const ords = PID_LAYOUT_ORDERS.slice(0, Math.max(1, ruleParam('layout.orderCandidates', 3)));
      let bp = null;
      for (const ord of ords) {
        for (const sw of sweeps) {
          for (const sep of seps) {
            pidSeed(null);
            const d = PID_PARSER.parse(source, { layoutOrder: ord, coordIters: sw, minSep: sep });
            const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            s.setAttribute('id', containerId + '-svg');
            const sc = renderInto(s, d, themeOpt);
            if (!bp || sc.total < bp.total) bp = { ord, sw, sep, total: sc.total };
          }
        }
      }
      return bp;
    })();
    let best = null;
    let bestLayoutSeed = null; // track which layout seed produced the best result
    const totalLayouts = Math.max(1, nLayouts);
    for (let L = 0; L < totalLayouts; L++) {
      // ponytail: null seed = legacy path (no layout noise). Only activate
      // layout noise when layouts > 0; candidates-only keeps baseline layout.
      const layoutSeed = !nLayouts ? null : (L === 0 ? seedBase : seedBase + L * 1000);
      // each layout gets the baseline render + n routing variants
      const base = runOnce(layoutSeed);
      if (!best || base.score.total < best.score.total) { best = base; bestLayoutSeed = layoutSeed; }
      for (let i = 0; i < n; i++) {
        // routing seeds: offset from layout seed to avoid collision
        const rSeed = layoutSeed !== null ? layoutSeed + (i + 1) * 7 : seedBase + i;
        const cand = runOnce(rSeed);
        if (cand.score.total < best.score.total) { best = cand; bestLayoutSeed = layoutSeed; }
      }
    }
    // ponytail: simulated annealing — optimize valve positions along process lines.
    // Each iteration: pick a random valve, perturb it along its process line,
    // re-render, accept/reject by SA criterion. Finds better valve placements
    // that the static layout can't discover.
    if (nOptimize > 0 && best) {
      const SA_TEMP0 = 30, SA_COOL = 0.95;
      let temp = SA_TEMP0;
      let curScore = best.score.total;
      for (let iter = 0; iter < nOptimize; iter++) {
        // rebuild byId each iteration — entity positions may have changed
        const processPipes = best.data.pipes.filter(p => p.kind !== 'signal');
        const byId = {};
        [...best.data.equipment, ...best.data.valves, ...best.data.junctions].forEach(e => { byId[e.id] = e; });
        const vi = Math.floor(pidRng() * best.data.valves.length);
        const v = best.data.valves[vi];
        if (v.at || v.rel) continue;
        const upPipe = processPipes.find(p => p.to === v.id);
        const dnPipe = processPipes.find(p => p.from === v.id);
        if (!upPipe || !dnPipe) continue;
        const upE = byId[upPipe.from], dnE = byId[dnPipe.to];
        if (!upE || !dnE) continue;
        const oldX = v.x, oldY = v.y;
        const dx = dnE.x - upE.x, dy = dnE.y - upE.y;
        const len = Math.hypot(dx, dy) || 1;
        const dirX = dx / len, dirY = dy / len;
        // bounded perturbation: shift ±temp mm along the line from current position
        const shift = (pidRng() - 0.5) * temp * 2;
        const curOffset = Math.hypot(oldX - upE.x, oldY - upE.y);
        let newOffset = curOffset + shift;
        newOffset = Math.max(5, Math.min(len - 5, newOffset));
        v.x = upE.x + dirX * newOffset;
        v.y = upE.y + dirY * newOffset;
        // re-parse with the SAME layout seed so entity positions match the best layout
        pidSeed(bestLayoutSeed);
        const newData = PID_PARSER.parse(source);
        for (const ov of best.data.valves) {
          const nv = newData.valves.find(x => x.id === ov.id);
          if (nv) { nv.x = ov.x; nv.y = ov.y; }
        }
        const svg2 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg2.setAttribute('id', containerId + '-svg');
        const newScore = renderInto(svg2, newData, themeOpt);
        const delta = newScore.total - curScore;
        if (delta < 0 || pidRng() < Math.exp(-delta / Math.max(temp, 0.01))) {
          curScore = newScore.total;
          for (const nv of newData.valves) {
            const bv = best.data.valves.find(x => x.id === nv.id);
            if (bv) { bv.x = nv.x; bv.y = nv.y; }
          }
          best = { seed: best.seed, svg: svg2, data: best.data, score: newScore };
        } else {
          v.x = oldX; v.y = oldY;
        }
        temp *= SA_COOL;
      }
    }
    pidSeed(null);
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`PIDGenerator: container #${containerId} not found`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', containerId + '-svg');
    svg.setAttribute('role', 'img');
    container.innerHTML = '';
    container.appendChild(svg);
    svg.innerHTML = best.svg.innerHTML;
    // copy viewBox/size the renderer set (works on real DOM and the node fake)
    const attrOf = (el, a) => {
      if (typeof el.getAttribute === 'function') { const v = el.getAttribute(a); if (v !== null && v !== undefined) return v; }
      if (el.attrs && el.attrs[a] !== undefined) return el.attrs[a];
      return null;
    };
    for (const a of ['viewBox', 'width', 'height']) {
      const v = attrOf(best.svg, a);
      if (v !== null) svg.setAttribute(a, v);
    }
    const data = best.data;
    return { svg: svg.outerHTML, warnings: data.warnings, errors: data.errors, info: data.info, score: best.score, data, seed: best.seed, candidates: n + 1, layouts: totalLayouts, optimize: nOptimize };
  },
  // regenerate DSL source from the model (used by drag-to-move export)
  toSource(data) {
    const lines = ['pid'];
    const v = data.view;
    if (data.schemaVersion) lines.push(`version ${data.schemaVersion}`);
    if (v.layout === 'auto') lines.push('layout auto');
    if (v.fitPage) lines.push('fit page');
    if (v.stubLength !== 8) lines.push(`stub ${v.stubLength}`);
    if (v.grid !== 5) lines.push(`grid ${v.grid}`);
    if (v.seed !== undefined && v.seed !== null) lines.push(`seed ${v.seed}`);
    // theme is a view setting, not geometry — emitted so the round-trip keeps it
    if (v.theme && v.theme !== 'print') lines.push(`theme ${v.theme}`);
    if (!v.chips) lines.push('chips off');
    if (v.legend) lines.push('legend on');
    if (v.northArrow) lines.push('north-arrow on');
    if (v.title) lines.push(`title "${v.title}"`);
    if (v.project) lines.push(`project "${v.project}"`);
    if (v.sheet) lines.push(`sheet ${v.sheet}${v.sheetTotal && v.sheetTotal !== v.sheet ? ' of ' + v.sheetTotal : ''}`);
    if (v.rev) lines.push(`rev "${v.rev.mark}" "${v.rev.date}"${v.rev.desc ? ` "${v.rev.desc}"` : ''}`);
    if (v.show !== 'all') lines.push(`show ${v.show}`);
    if (v.hideLabels) lines.push('hide labels');
    for (const [id, d] of Object.entries(data.lineDefs)) {
      const fields = ['size', 'service', 'number', 'spec', 'ins', 'thick', 'trace', 'fluid', 'phase', 'pressure', 'temperature', 'material', 'insulation', 'tracing']
        .filter(k => d[k]).map(k => `${k} ${d[k]}`).join(' ');
      lines.push(`line ${id} ${fields}`);
    }
    const pos = (e) => ` at ${Math.round(e.x)},${Math.round(e.y)}`;
    const modifiers = (e) => {
      let m = '';
      if (e.rotation) m += ` rotated ${e.rotation}`;
      if (e.symbol) m += ` symbol "${e.symbol}"`;
      if (e.scale) m += ` scale ${e.scale}`;
      if (e.stroke) m += ` stroke "${e.stroke}"`;
      if (e.tag) m += ` tag "${e.tag}"`;
      if (e.tagAbove) m += ' tag-above';
      if (e.noTypeLabel) m += ' no-type-label';
      if (e.size) m += ` size ${e.size}`;
      if (e.rating) m += ` rating ${e.rating}`;
      if (e.spec) m += ` spec ${e.spec}`;
      if (e.normal) m += ` normal ${e.normal}`;
      if (e.fail) m += ` fail ${e.fail}`;
      if (e.mode) m += ` mode ${e.mode}`;
      if (e.setPressure) m += ` set-pressure ${e.setPressure}`;
      if (e.bubble) m += ` ${e.bubble}`;
      return m;
    };
    for (const e of data.equipment) lines.push(`equipment ${e.id} ${e.type}${pos(e)}${modifiers(e)}`);
    for (const nz of (data.nozzles || [])) {
      if (nz.auto) continue; // auto-materialized bare ports: never pollute the DSL
      let nzLine = `nozzle ${nz.id} on ${nz.ownerId} port ${nz.portId}`;
      if (nz.size) nzLine += ` size "${nz.size}"`;
      if (nz.rating) nzLine += ` rating ${nz.rating}`;
      if (nz.spec) nzLine += ` spec ${nz.spec}`;
      if (nz.facing) nzLine += ` facing ${nz.facing}`;
      if (nz.schedule) nzLine += ` schedule ${nz.schedule}`;
      if (nz.subType && nz.subType !== 'weld_neck') nzLine += ` type ${nz.subType}`;
      if (nz.length && nz.length !== 14) nzLine += ` length ${nz.length}`;
      if (nz.edge) nzLine += ` edge`;
      lines.push(nzLine);
    }
    for (const vv of data.valves) lines.push(`valve ${vv.id} ${vv.type}${pos(vv)}${modifiers(vv)}`);
    for (const i of data.instruments) lines.push(`instrument ${i.tag}${pos(i)}${modifiers(i)}`);
    for (const j of data.junctions) {
      // ponytail: L3 — offpage round-trips with its ref (cut-set pinning)
      if (j.offpage) lines.push(`offpage ${j.id} at ${Math.round(j.x)},${Math.round(j.y)}${j.ref ? ` ref "${j.ref.replace(/"/g, '\\"')}"` : ''}`);
      else lines.push(`${j.stub ? "stub" : "junction"} ${j.id} at ${Math.round(j.x)},${Math.round(j.y)}`);
    }
    for (const l of data.loops.filter(l => l.explicit)) lines.push(`loop ${l.loopTag || l.id} measure ${l.measure} controller ${l.controller} manipulate ${l.manipulate}`);
    for (const r of data.relationships) lines.push(`${r.kind === 'protected_by' ? 'protects' : 'discharges'} ${r.from} -> ${r.to}`);
    for (const a of data.alarms) lines.push(`alarm ${a.id} from ${a.source} condition ${a.condition}${a.priority !== 'medium' ? ` priority ${a.priority}` : ''}`);
    for (const i of data.interlocks) lines.push(`interlock ${i.id} when ${i.trigger} action ${i.action}`);
    for (const p of data.pipes) {
      const src = p.fromPort ? `${p.from}.${p.fromPort}` : p.from;
      const tgt = p.toPort ? `${p.to}.${p.toPort}` : p.to;
      if (p.kind === 'signal') { lines.push(`signal ${src} -> ${tgt} ${p.signalType}`); continue; }
      if (p.kind === 'tap') { lines.push(`tap ${src} -> ${tgt}${p.lineTap ? '.line' : ''}`); continue; }
      let l = `${src} -> ${tgt}`;
      for (const wp of (p.via || [])) l += ` via ${Math.round(wp.x)},${Math.round(wp.y)}`;
      if (p.line) l += ` line ${p.line}`;
      else if (p.label) l += ` "${p.label.replace(/"/g, '\\"')}"`;
      lines.push(l);
    }
    return lines.join('\n');
  }
};


