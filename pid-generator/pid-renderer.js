// P&ID Renderer — SVG rendering, annotations, public API.
// Loaded fifth (after pid-parser.js, pid-router.js, pid-validator.js).
// ponytail: model-side text boxes — every <text> the renderer emits is measured
// from its markup, so label-collision counts agree in node and browser. The
// measurement itself is `PIDText`, the same table the router reserves space
// with; that sharing is load-bearing (see pid-textmetrics.js). (Browser getBBox
// measures real glyphs; parity of the *metric* matters more than sub-pixel
// accuracy. See plan §External references.)
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
    // real advance for the real string, and the real vertical extent: caps run
    // cap-top to baseline, not 1.15em
    const w0 = PIDText.widthMm(content, fs, /font-weight="bold"/.test(a));
    const ex = PIDText.extentEm(content);
    const h0 = (ex.y1 - ex.y0) * fs;
    const w = vert ? h0 : w0, h = vert ? w0 : h0;
    const mid = /text-anchor="middle"/.test(a);
    // `data-pid-inst` marks a run that lives INSIDE its own instrument bubble. The
    // score substitutes the bubble box for these (see the label-collision term in
    // renderInto, T6.16): re-centring the text in the bubble cannot move the
    // bubble, so it must not be able to re-roll which layout wins either.
    const im = a.match(/data-pid-inst="([^"]*)"/);
    out.push({ t: content, x0: mid ? x - w / 2 : x, x1: mid ? x + w / 2 : x + w, y0: y + ex.y0 * fs, y1: y + ex.y1 * fs, inst: im ? im[1] : null });
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

// Text drawn inside the scaled group renders at k * fontSize. Divide the type back
// to the millimetre size the layout actually asked for, so filling the sheet does
// not inflate the lettering.
//
// Applied as ONE pass over the assembled body rather than at ~40 emission sites,
// and deliberately SKIPPING any <text> nested inside a <svg> element: those live in
// a symbol's own viewport and must scale WITH their symbol, or every glyph inside
// every symbol would shrink by 1/k.
//
// Also normalises the white halo stroke-width, which is a pen width and must keep
// its proportion to the glyphs rather than to the sheet.
function denormaliseText(body, k) {
  if (!k || Math.abs(k - 1) < 1e-9) return { body, n: 0, skipped: 0 };
  let out = '', i = 0, n = 0, skipped = 0, depth = 0;
  while (i < body.length) {
    const lt = body.indexOf('<', i);
    if (lt < 0) { out += body.slice(i); break; }
    out += body.slice(i, lt);
    // track nested <svg> viewports: their contents are symbol-local
    if (body.startsWith('<svg', lt) && !body.startsWith('<svgx', lt)) depth++;
    if (body.startsWith('</svg>', lt)) depth--;
    const gt = body.indexOf('>', lt);
    if (gt < 0) { out += body.slice(lt); break; }
    let tag = body.slice(lt, gt + 1);
    if (depth === 0 && body.startsWith('<text', lt)) {
      const before = tag;
      tag = tag.replace(/font-size="(-?[\d.]+)"/, (m, v) => {
        const scaled = +v / k;
        n++;
        return 'font-size="' + (Math.round(scaled * 100) / 100) + '"';
      });
      if (!/font-size=/.test(tag)) skipped++;   // inherits, and would scale
      tag = tag.replace(/stroke-width="(-?[\d.]+)"(?=[^>]*stroke="white")/,
        (m, v) => 'stroke-width="' + (Math.round((+v / k) * 100) / 100) + '"');
      if (tag === before && skipped === 0) skipped = -1;  // unreachable, keeps lint quiet
    } else if (depth > 0 && body.startsWith('<text', lt)) {
      skipped++;
    }
    out += tag;
    i = gt + 1;
  }
  return { body: out, n, skipped: Math.max(0, skipped) };
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
  // The formula lives in PID_RULES (`annotationTypeMm`) because the ROUTER needs it
  // too — it has to know how big the instrument letters will be in order to reserve
  // the room, and it cannot reach into this closure. One formula, two consumers.
  const fs = (n) => {
    const v = annotationTypeMm(n, SC);
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
  // ---- instrument bubble: sized from the tag it has to hold (T6.15/T6.17) ----
  //
  // The declared symbol size is a MINIMUM, not the answer. A bubble is a circle
  // drawn around text, and a circle that cannot hold its text is wrong at any
  // size — the number only decides how wrong.
  //
  // This was measured twice before and rejected twice (9.67: spike 997 -> 1274;
  // 9.72 re-attributed that to the tag CENTRING, which was correct), and it can
  // work now for two reasons. The size is solved in ONE place that both the
  // drawing and the layout call — growing a bubble in the drawing alone is exactly
  // what made 9.67's number, because the router went on reserving the old radius
  // through `PIDEngine.entitySize` -> `entityHalf`. And the width model is right,
  // so the required radius is right: the old "3-letter tags need 4.93mm" was a
  // 4.4mm problem inflated 15% by a flat 0.68em factor that over-reserves any tag
  // of narrow capitals ("FIC" is 0.537em/char, not 0.68).
  //
  // The LOOP-NUMBER line, not the letters, is what sets the height: a two-line tag
  // needs CAP*fL + gap + DESC*fN of vertical room, and that is the whole of it.
  const sizeOf = (e) => {
    let s = isInstrument(e) ? symbolSize(glyphKeyOf(e)) : glyphSizeOf(e);
    if (e.scale) s *= e.scale;
    s *= SC;
    if (isInstrument(e)) {
      const need = instrumentBubbleSize(e, SC);
      if (need && need > s) s = need;
    }
    return s;
  };

  // canvas: content-sized, or full page when `fit page`
  const dbg = pidDebugGate(data); // ponytail: Phase 4 - null unless PID_DEBUG
  // Extent of the SYMBOLS. The full extent — including routed linework — is not
  // known until routing has run, so for `fit page` the scale is solved at the end
  // (see `solveFit`, below) against the real drawn extent. This pass is still
  // needed for the content-sized path and for the sheet background.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of [...equipment, ...valves, ...instruments, ...junctions]) {
    const s = sizeOf(e);
    minX = Math.min(minX, e.x - s / 2); minY = Math.min(minY, e.y - s / 2);
    maxX = Math.max(maxX, e.x + s / 2); maxY = Math.max(maxY, e.y + s / 2);
  }
  // room for the tag/type stacks that hang BELOW a symbol and the leaders that reach
  // sideways. The old flat `-10 / -12 / +10 / +14` was a guess; the stacks are three
  // rows at published millimetre sizes, so the margin is derived from them.
  const STACK_MARGIN = { left: 6, right: 6, top: 6, bottom: annotationTypeMm(3.2, SC) * 0.72 * 3 + ruleParam('layout.labelZone', 16) };
  minX -= STACK_MARGIN.left; minY -= STACK_MARGIN.top;
  maxX += STACK_MARGIN.right; maxY += STACK_MARGIN.bottom;
  // The ORIGIN belongs in the box ONLY when the sheet is sized to the content, where
  // the viewBox starts at 0 and the drawing has to start at 0 too.
  //
  // Under `fit page` it is pure waste, and it was the largest single reason every
  // fitted sheet looked small. `Math.min(minX, 0)` forced the content box to span
  // from the origin even though the layout never draws near it: on dense the
  // entities run x 220..645 and the box was measured as 0..655, so 220mm of dead
  // width — a third of the box — was being fitted to the sheet, and the scale came
  // out 1.19 where the drawing's own extent gives 1.80. A uniform scale is a
  // similarity transform and cannot affect layout quality, so every one of those
  // millimetres was handed straight back as blank margin.
  if (!view.fitPage) { minX = Math.min(minX, 0); minY = Math.min(minY, 0); }

    let W, H, wrap = '';
    // Hoisted out of the fitPage block: the text pass at the end of this function
    // needs the same k the geometry was scaled with, and a block-scoped const was
    // invisible there. 1 means "no scaling", which is the correct default for the
    // non-fitPage path where the sheet is sized to the content anyway.
    let k = 1;
    // The fit is a FUNCTION OF THE EXTENT, and the extent is only final once routing
    // has run, so it is a function and it is called at the end with the drawn
    // geometry in hand. Solving it inline measured only the symbol boxes and left the
    // routed linework outside the box entirely -- a line runs a hundred millimetres
    // past the last nozzle it serves, and on a `fit page` sheet that overflow is
    // invisible right up until it crosses the frame line.
    let fitWarned = false;
    const solveFit = (x0, y0, x1, y1) => {
      // The DRAWABLE RECTANGLE, not the whole frame. `autoLayout` publishes
      // `data.drawZone` — frame inset, the equipment schedule's band at the top, the
      // title block's band at the bottom, the sheet margins at the sides — and the
      // centring pass already works inside it. The fit used to re-centre across the
      // whole frame instead, which is a second, different answer to the same
      // question: it scaled a correctly-placed drawing and then pushed line labels
      // up into the equipment schedule and the right-hand edge down into the title
      // block. Measured on dense: the topmost run label printed inside the
      // "P-1 CENTRIFUGAL PUMP" row of the schedule.
      //
      // Falls back to the frame if the zone is absent (a sheet that skipped
      // `autoLayout` entirely), so this can never be the reason a sheet is empty.
      const pad = 18;                    // == annotationsSvg frame inset
      const Z = data.drawZone;
      const rx0 = Z ? Z.x0 : pad, ry0 = Z ? Z.y0 : pad;
      const rx1 = Z ? Z.x1 : W - pad, ry1 = Z ? Z.y1 : H - pad;
      const dw = Math.max(rx1 - rx0, 1), dh = Math.max(ry1 - ry0, 1);
      const cw = Math.max(x1 - x0, 1), ch = Math.max(y1 - y0, 1);
      // One warning per render, and it names the dimension that is over. A sheet that
      // is 4mm past a soft target and a sheet that is 200mm past the frame are not
      // the same event and must not print the same sentence.
      if (!fitWarned && (cw > dw || ch > dh)) {
        fitWarned = true;
        const over = [];
        if (cw > dw) over.push(`width ${Math.round(cw)} > ${Math.round(dw)}`);
        if (ch > dh) over.push(`height ${Math.round(ch)} > ${Math.round(dh)}`);
        data.warnings.push(`[PID-LAY-001] drawing exceeds the drawable zone (${over.join(', ')}mm) — the zone is a centring target, not a bound; this one is now drawn to the frame instead`);
      }
      // Fill the zone in BOTH directions. The old `Math.min(1, ...)` meant a small
      // drawing was never scaled up, so it sat at 63% W x 38% H forever while the
      // sheet stayed blank around it -- every small sheet was under-filled by
      // construction. Only overflow ever shrank, so `k <= 1` was the rule.
      //
      // Uniform scale is a SIMILARITY transform: it cannot create a collision or a
      // crossing, only scale existing ones, so filling costs nothing in layout
      // quality. Measured: unclamping moves the score by 0 on all six corpus cases.
      //
      // The clamp existed to stop TYPE inflating past its print size, and that
      // concern is real -- but drawing scale and text height are independent in P&ID
      // practice (ISO 5457: a 1:2 drawing with 2.5mm text is normal). So the geometry
      // scales and `denormaliseText` below puts the type back to its nominal
      // millimetres, which satisfies the print-size rule rather than trading it away.
      //
      // Sheet furniture is NOT affected: annotationsSvg() is emitted OUTSIDE this
      // group (see the assembly), so the frame, title block, north arrow, legend and
      // the equipment tag list all stay at 1:1 as intended.
      //
      // The two bounds are NOT the same rectangle, and that asymmetry is deliberate.
      // VERTICALLY the zone is hard: the equipment schedule is a band across the top
      // of the sheet and the title block a band along the bottom, and a drawing that
      // runs under either is unreadable. HORIZONTALLY the zone is a preference and
      // the frame is the bound: the extra 30mm a side is air, so a drawing too wide
      // for the zone is better drawn 7% larger and centred into the side margins
      // than shrunk to fit a target that is only a target. (9.61 already settled that
      // the zone is a soft target for centring and not a hard bound; `manifold` is
      // 836mm of content against a 768mm zone and shrinking it to fit cost a label
      // collision for nothing.)
      k = Math.min((W - 2 * pad) / cw, dh / ch);
      // Centre the scaled content in the zone, do not anchor its top-left.
      //
      // This was throwing away the slack in one direction. `pad - minX*k` puts the
      // content's minimum at the frame corner, so any drawing shorter than the sheet
      // sat hard against the TOP with every spare millimetre dumped below it -- the
      // demo had ~158mm of dead space along the bottom edge and a completely empty
      // lower-left quadrant. It also silently discarded the centring `autoLayout`
      // had already done, since that works in layout coordinates and the wrap
      // re-anchors afterwards.
      //
      // Centring splits the slack evenly, which is what a drafter does by eye.
      const tx = rx0 + (dw - cw * k) / 2 - x0 * k;
      const ty = ry0 + (dh - ch * k) / 2 - y0 * k;
      return `<g transform="translate(${tx} ${ty}) scale(${k})">`;
    };
    if (view.fitPage) {
      // the sheet is a fixed 22x34in (559x864mm) drawing; content is laid out
      // inside it, and the whole sheet maps to the window
      W = view.sheetW || 864; H = view.sheetH || 559;
      // provisional, so anything that needs `k` before routing finishes has a value;
      // the post-routing call below overwrites it with the real one
      wrap = solveFit(minX, minY, maxX, maxY);
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
      const jEnds = !!(pA.junction || pB.junction);
      const stub = view.stubLength || 0;
      // Room for a full lead-in is a question about the PORT'S OWN DIRECTION, and
      // the test was about both axes at once:
      //
      //   const roomy = spanX >= MIN_PORT_RUN * 2 && spanY >= MIN_PORT_RUN * 2;
      //
      // so a 300mm horizontal pipe between two items sitting on the same line was
      // judged "not roomy" — spanY is a few millimetres — and was granted a 6mm stub
      // instead of 14mm. That is a bend six millimetres after the nozzle, and it is
      // six of the eight PID-GEO-002 findings in the corpus. A lead-in runs ALONG the
      // port, so the room it needs is the room in the port's direction and nothing
      // else. Per end, because the two ports can face different ways.
      const roomFor = (p) => !!(p.dir && (Math.abs(p.dir.x) > 0.5 ? spanX : spanY) >= MIN_PORT_RUN * 2);
      const stubFor = (p) => {
        if (roomFor(p) || p.nozzle) return MIN_PORT_RUN;
        if (jEnds) return Math.max(ruleParam('routing.junctionStubMin', 6), Math.min(MIN_PORT_RUN, spanX / 3 || Infinity, spanY / 3 || Infinity));
        return 0;
      };
      const effStub = Math.max(stubFor(pA), stubFor(pB), stub);
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
        // From the rules. This was a hardcoded 0.6mm, i.e. a hairline: every process
        // pipe on the demo measured 0.6mm while the equipment boxes were 70x45mm. It is
        // the root of two filed rendering defects -- a 3mm flow arrow and a 5mm junction
        // disc both read as oversized because the pipe UNDER them was too thin, not
        // because they were.
        width: signal ? ruleParam('routing.signalWidth', 0.35) : ruleParam('routing.processWidth', 1.4),
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
          // Sized FROM the pipe, not as a constant. The fixed 1.5mm half-width put a
          // 3mm arrow on pipes measuring 0.4mm to 3.2mm -- 7.5x the thinnest and 1.9x
          // the widest -- which is why the demo reads as a scatter of blue wedges
          // rather than as flow direction along a line.
          const AW = Math.max(0.45, g.width * ruleParam('annotation.arrowFrac', 0.8) * 0.5);
          const AL = AW * 2 * ruleParam('annotation.arrowRatio', 2.4);
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
  //
  // WIDTH MODEL (T4.4, closed). This used to be
  //   `str.length * fontSize * WIDTH_EM[role]`, with WIDTH_EM = {0.55, 0.58, 0.68}.
  // Three attempts to improve it at the string level all failed for the same
  // reason, and the reason is the finding:
  //   * uppercasing before counting characters is a no-op -- `toUpperCase()` does
  //     not change `.length`, so the metric moved 0 on all four corpus sheets;
  //   * splitting by role fixed BOLD (0.55 -> 0.68) and left `regular` at a
  //     MIXED-CASE average -- for text that is drawn entirely in caps, because
  //     `svg[data-theme] text { text-transform: uppercase }` does the transform,
  //     not the emitter. The bold fix removed the demo's visible label pile-up
  //     (9.70) and the grey type lines were still ~20% narrow;
  //   * `getComputedTextLength()` is exact and unusable: the score runs for every
  //     candidate while the SVG is detached, so there is no layout to query.
  //
  // So the model is per-character and comes from `PIDText` (Helvetica Core
  // metrics, the metric model of the CSS generic this drawing uses). Two
  // consequences, both intended:
  //   * boxes get WIDER, because uppercase averages 0.678em against mixed case's
  //     ~0.50em. Every grey type line on every sheet was under-measured;
  //   * boxes get SHORTER, because an all-caps line runs cap-top to baseline
  //     (0.718em), not the flat 1.15em that claimed 0.43em of empty space below
  //     the baseline.
  // Net: boxes are now the size of the ink. A collision count going up is the
  // metric correcting itself, not the layout getting worse -- a count blind to a
  // pile-up the eye can see is exactly why the layout had no reason to avoid it.
  const widthEm = (str, fnt, bold) => PIDText.widthMm(str, fnt, !!bold);
  const textBox = (x, y, str, fnt, mid = true, bold) => {
      const w = widthEm(str, fnt, bold);
      const ex = PIDText.extentEm(str);
      const y0 = y + ex.y0 * fnt, y1 = y + ex.y1 * fnt;
      return mid ? { x0: x - w / 2, x1: x + w / 2, y0, y1 } : { x0: x, x1: x + w, y0, y1 };
    };
    // ponytail: L6 — nozzle tags pick the clear side (default normal, else
    // flipped) BEFORE line labels place; zones + emission share these coords
    // so nothing drifts. Own-nozzle stubs may graze (offset clears them).
    //
    // `nozzleTagOnLine` joins the two lists below it. All three were unread: each
    // placer computed "I could not find a clear spot", wrote the fact into an array,
    // and nothing read the array. That is NOT a hole in the reporting —
    // `PID-ANN-001` below measures the same defect from the emitted ink and warns on
    // it — it is a loss of ATTRIBUTION. The aggregate says how many labels are on
    // linework; these say which of the three placers put them there, which is the
    // only thing that tells you whether the fix is a wider offset or a denser sheet.
    const nozzleTagOnLine = [];
    const tagLineSegs = [];
    for (const gg of geometries) for (const sgm of PIDEngine.segs(gg.pts)) tagLineSegs.push({ sgm, gg });
    for (const t of tapGeos) for (const sgm of PIDEngine.segs(t.pts)) tagLineSegs.push({ sgm });
    // Boxes for the line designations this pass just placed, so the equipment-tag
    // placer below can avoid them, and the dashed leaders so the label-over-linework
    // check can exempt them. Both are empty until the loop above has run.
    const lineLabelBoxes = [];
    const leaderSegs = [];
    for (const nz of (data.nozzles || [])) {
      if (!nz.tipPosition) continue;
      const orient = nz.orientation || 0;
      const nx = -Math.sin(orient * Math.PI / 180), ny = Math.cos(orient * Math.PI / 180);
      const rad = orient * Math.PI / 180, dx = Math.cos(rad), dy = Math.sin(rad);
      const along = dy === 1 ? 10 : dx === 0 ? 0 : -4;
      // ponytail: the perpendicular offset must clear the tag's OWN WIDTH.
      //
      // It used to be a constant 4mm (6mm for a declared nozzle), which is narrower
      // than half of every nozzle tag on the sheet — "NZ-R101-B" is ~12mm wide at
      // 2.2mm type, so a 4mm offset centres the text ON the run it labels. That was
      // invisible to the placer because `hit()` exempts the nozzle's own line
      // (the run it is labelling), and it was invisible to the objective because
      // nothing in the score compares text with linework. It was only ever caught by
      // the audit's `[15] LABEL OVER LINEWORK`, which is 45 findings across the six
      // canonical sheets and 9 of spike's 24 are nozzle tags.
      //
      // `n` is perpendicular to the nozzle axis and the run leaves along the axis, so
      // clearing half the tag width + 2.5mm puts the ink wholly to one side of the
      // pipe. The own-line exemption can stay: a callout is SUPPOSED to sit beside
      // the nozzle it names, and the geometry is now what enforces that.
      const idFs = fs(2.2);
      const halfW = Math.max(widthEm(nz.id, idFs) / 2, nz.size ? widthEm(nz.size, fs(1.8)) / 2 : 0);
      const clear = halfW + 2.5;
      const near = nz.auto ? 4 : 6;
      const place = (flip, off, ax) => {
        const s = flip ? -1 : 1;
        return {
          x: nz.tipPosition.x + nx * s * off + dx * ax,
          y: nz.tipPosition.y + ny * s * off + dy * ax,
        };
      };
      // drafter's order, legacy FIRST (see `hit`): the two positions the engine has
      // always used, then the width-cleared pair that fixes a straddling tag, then
      // each of those pushed further out. So the worst case degrades to today's
      // behaviour rather than to something new.
      const ax = nz.auto ? 8 : along;
      const cands0 = [
        place(false, near, ax), place(true, near, ax),
        place(false, clear, ax), place(true, clear, ax),
        place(false, clear + 5, ax), place(true, clear + 5, ax),
      ];
      // id box UNION the size sub-line 4.5mm below (emitted at :1937) — the size
      // text was never collision-tested, so it could land on a run the id cleared.
      const boxOf = (p) => {
        const b = textBox(p.x, p.y, nz.id, idFs);
        if (!nz.size) return b;
        const s = textBox(p.x, p.y + 4.5, nz.size, fs(1.8));
        return { x0: Math.min(b.x0, s.x0), x1: Math.max(b.x1, s.x1), y0: Math.min(b.y0, s.y0), y1: Math.max(b.y1, s.y1) };
      };
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
          // The nozzle's OWN line used to be exempt outright ("a callout belongs on
          // its own nozzle"). That exemption is what printed the tag ACROSS the run:
          // the legacy 4mm perpendicular offset is narrower than half of every nozzle
          // tag on the sheet, so the ink always straddled the pipe and nothing could
          // ever object. A callout does belong beside its nozzle — but "beside" is a
          // geometric claim, and a negative pad makes the placer actually test it:
          // the run must intrude more than 1.5mm into the box before it counts. A
          // tag at the width-cleared offset is wholly to one side and passes; a tag
          // at the legacy offset straddles and fails.
          const own = gg && ((gg.p._from && gg.p._from.nozzle === nz.id) || (gg.p._to && gg.p._to.nozzle === nz.id));
          return collide.segHitsRect(sgm, b, own ? -1.5 : 1);
        });
      };
      // ponytail: L6 candidates in a drafter's order, and the LEGACY pair first so
      // an uncluttered sheet is byte-identical. That stability is the whole point:
      // an earlier version of this fix led with the width-cleared offset and it
      // moved tags that were fine, which fed different boxes into the annotation
      // pass, which changed which layout candidate the search preferred — the demo
      // went 319 -> 344 and its utilisation 44% -> 37% for a defect that only 7
      // nozzle tags actually had. Only the straddling tags should move.
      const cands = cands0.slice();
      for (const flip of [false, true]) {
        const s = flip ? -1 : 1, ex = 8;
        cands.push({
          x: nz.tipPosition.x + nx * s * (nz.auto ? 4 : 6) + dx * ((nz.auto ? 8 : along) + ex),
          y: nz.tipPosition.y + ny * s * (nz.auto ? 4 : 6) + dy * ((nz.auto ? 8 : along) + ex),
        });
      }
      let tp = cands[0], tpHits = Infinity;
      for (const c of cands) { const h = hit(c) ? 1 : 0; if (h < tpHits) { tpHits = h; tp = c; } if (h === 0) break; }
      nz.tagX = tp.x; nz.tagY = tp.y;
      if (tpHits > 0) nozzleTagOnLine.push(nz.id);
    }
    for (const g of geometries) {
      if (!g.label || g.labelOnce) continue;
      const pts = g.pts;
      // How long a designation is, and therefore how much RUN it needs. A line
      // designation follows the line it belongs to — that is the convention, and it
      // is why the emitter rotates by 90 on a vertical segment — but a rotated
      // designation is as long as the text, so a 30mm riser cannot hold a 40mm
      // string. The candidate filter used a flat `len >= 12` for both orientations,
      // which let a 12mm riser carry a designation that then ran 28mm past both ends
      // of it, straight across the process. Measured on the demo before this:
      // `4"-PG-101-2C2-R10-52-N` standing vertically through P-101 and its suction
      // run, and a second vertical `4"` beside V-106.
      //
      // A vertical run must therefore be at least as long as the text; a horizontal
      // one is placed at a fraction along the run with a leader, so length is not
      // what constrains it and 12mm stands.
      const lblW = PIDText.widthMm(g.label, fs(2.6), false);
      const cands = [];
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k];
        const horiz = Math.abs(a.y - b.y) < 0.5;
        const len = horiz ? Math.abs(a.x - b.x) : Math.abs(a.y - b.y);
        if (len < 12) continue;
        // rotated: the text runs ALONG the segment, so the segment must hold it
        if (!horiz && len < lblW + ruleParam('annotation.labelRunClear', 4)) continue;
        cands.push({ a, b, horiz, len });
      }
      cands.sort((p, q) => q.len - p.len);
      if (!cands.length) {
        // No segment long enough to hold the designation along its own direction.
        // Better a horizontal designation on a short riser — with a leader, which is
        // what the emitter draws for any non-rotated placement — than a rotated one
        // that overhangs its run. Fall back to the longest segment regardless.
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1], b = pts[k];
          const horiz = Math.abs(a.y - b.y) < 0.5;
          const len = horiz ? Math.abs(a.x - b.x) : Math.abs(a.y - b.y);
          if (len >= 12) cands.push({ a, b, horiz: true, len });
        }
        cands.sort((p, q) => q.len - p.len);
        if (!cands.length) continue;
      }
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
      const hw = PIDText.widthMm(g.label, fs(2.6), false) / 2;
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
      // Recorded so equipment-tag placement below can see it. The line designation
      // is drawn in this pass, before equipment, and a tag that lands on top of one
      // is a collision the equipment placer would otherwise walk into blindly —
      // measured on manifold, where P-1's "CENTRIFUGAL PUMP" ended up on the `4"`
      // of the supply header.
      lineLabelBoxes.push(ang
        ? { x0: anchor.x - fs(2.6) * 0.718, x1: anchor.x + fs(2.6) * 0.718, y0: anchor.y - PIDText.widthMm(g.label, fs(2.6), false) / 2, y1: anchor.y + PIDText.widthMm(g.label, fs(2.6), false) / 2 }
        : textBox(anchor.x, anchor.y, g.label, fs(2.6)));
      const lead = (Math.abs(anchor.x - lm.x) > 1 || Math.abs(anchor.y - lm.y) > 1)
        ? `<line x1="${lm.x}" y1="${lm.y}" x2="${anchor.x}" y2="${anchor.y}" stroke="#0D47A1" stroke-width="0.3" stroke-dasharray="2 2"/>` : '';
      if (lead) leaderSegs.push({ x1: lm.x, y1: lm.y, x2: anchor.x, y2: anchor.y });
      pipesSvg += lead + `<text x="${anchor.x}" y="${anchor.y}" text-anchor="middle" font-size="${fs(2.6)}" font-style="italic" fill="#0D47A1" paint-order="stroke" stroke="white" stroke-width="3"${ang ? ` transform="rotate(${ang} ${anchor.x} ${anchor.y})"` : ''}>${esc(g.label)}</text>`;
    }

    // entity groups (chips optional; pipes are drawn above everything)
    // ponytail: L2+L6 - nozzle boxes collected at emission (final tag coords),
    // consumed by valve-stack flip below
    const nozzleBoxes = [];
    const eqBoxes = [];
    // Nozzle tag boxes are needed BEFORE the equipment loop, because equipment
    // placement tests its candidates against them (see `boxClutter`). The emission
    // loop below fills the same array from the same expression, so the two cannot
    // disagree — the coordinates come from the pre-pass that already ran
    // (`nz.tagX` / `nz.tagY`), and this only records where the ink will land.
    for (const nz of (data.nozzles || [])) {
      if (view.hideLabels || !nz.id || !nz.tipPosition) continue;
      const tagX = nz.tagX !== undefined ? nz.tagX : nz.tipPosition.x;
      const tagY = nz.tagY !== undefined ? nz.tagY : nz.tipPosition.y;
      nozzleBoxes.push(textBox(tagX, tagY, nz.id, fs(2.2)));
      if (nz.size) nozzleBoxes.push(textBox(tagX, tagY + 4.5, nz.size, fs(1.8)));
    }
    const NOZZEL_BOXES_PRE = nozzleBoxes.length;
    // ---- equipment annotation placement (new) -------------------------------
    //
    // The equipment tag used to be pinned at `e.y + s/2 + 3.5` — always directly
    // under the symbol, always centred. That is exactly where a process line leaving
    // a BOTTOM nozzle goes, so the tag was printed straight through the pipe. It is
    // visible on the dense sheet at C-1 (the vertical run off the reboiler passes
    // vertically through "C-1 / COLUMN"), and NOTHING reported it: the collision
    // metric compares text with text, and the audit's line checks compare lines with
    // symbol boxes. Label-over-linework had no check and no term, so the layout had
    // no reason to avoid it and the drawing had no way to say so.
    //
    // Five candidate placements, in a drafter's order of preference, and the first
    // one whose two text boxes are clear of every routed segment. Below is still
    // first, so a sheet with no vertical run under a vessel is unchanged; what
    // changes is that the tag now goes ABOVE or BESIDE the symbol instead of on top
    // of the pipe. `hits` is the number of segments crossing a box, so a candidate
    // that is nearly clear loses to one that is completely clear, and if nothing is
    // clear the least-bad placement wins rather than an arbitrary one.
    const lineSegs = [];
    for (const gg of geometries) for (const sg of PIDEngine.segs(gg.pts)) lineSegs.push(sg);
    for (const t of tapGeos) for (const sg of PIDEngine.segs(t.pts)) lineSegs.push(sg);
    const boxLineHits = (b) => {
      let n = 0;
      for (const sg of lineSegs) {
        // a hair of tolerance: a line that stops exactly on the box edge is a
        // leader arriving at the label, not a line drawn through it
        if (collide.segHitsRect(sg, b, -0.75)) n++;
      }
      return n;
    };
    // Clutter = linework PLUS the labels already placed PLUS the annotation ZONES of
    // everything placed later. Testing only what has been emitted is not enough and
    // the order of emission is arbitrary: the valve label stacks are drawn after the
    // equipment tags, so an equipment tag has no way to see them, and measured on
    // manifold, P-1's "CENTRIFUGAL PUMP" landed on the derived valve size `4"` of
    // V-4, 1.8mm away. So the zones are declared up front — a valve's keep-out is its
    // symbol plus the label stack that hangs below it, which is the same rule
    // `passDecrowd` and `passInstruments` already use in the router. Order-independent
    // beats order-correct, and this is the third time in this project that a pass
    // discovered the previous pass's work and could not see it.
    const LABEL_ZONE = ruleParam('layout.labelZone', 16);
    const zones = [];
    for (const v of valves) {
      if (v.x == null) continue;
      // the drawn metal, not the nominal box: a 100x83.33 valve glyph draws 10x8.33mm
      const { w, h } = PIDEngine.entityExtent(v, SC);
      zones.push({ x0: v.x - w / 2, x1: v.x + w / 2, y0: v.y - h / 2, y1: v.y + h / 2 + LABEL_ZONE });
    }
    for (const i2 of instruments) {
      if (i2.x == null) continue;
      const h = sizeOf(i2) / 2;
      zones.push({ x0: i2.x - h, x1: i2.x + h, y0: i2.y - h, y1: i2.y + h + LABEL_ZONE * ruleParam('layout.instLabelZone', 1) });
    }
    const boxClutter = (b) => {
      let n = boxLineHits(b);
      for (let i = 0; i < NOZZEL_BOXES_PRE; i++) if (collide.rectsHit(b, nozzleBoxes[i])) n++;
      for (const q of eqBoxes) if (collide.rectsHit(b, q)) n++;
      for (const q of lineLabelBoxes) if (collide.rectsHit(b, q)) n++;
      for (const z of zones) if (collide.rectsHit(b, z)) n++;
      return n;
    };
    const EQ_ANNOT = [
      { side: 'below' }, { side: 'above' }, { side: 'left' }, { side: 'right' },
      { side: 'below', far: true },
    ];
    const equipTagOnLine = [];
    const valveStackOnLine = [];
    for (const e of equipment) {
      if (!shown(e, 'equipment')) continue;
      const s = sizeOf(e);
      let g = '';
      if (view.chips) g += chip(e.x, e.y, s, e.id);
      g += embedSymbol(glyphKeyOf(e), e.x, e.y, s, e.rotation);
      if (!view.hideLabels) {
        const tag = e.tag || e.id;
        const typeStr = e.noTypeLabel ? '' : (TYPE_LABELS[e.type] || e.type);
        const fTag = fs(3.2), fType = fs(2.8);
        const TYPE_OFF = 5.5;
        // Every candidate returns `ty` = the TAG baseline and the two boxes, so the
        // emission below is identical for all of them and only the placement varies.
        const place = (c) => {
          let cx = e.x, ty;
          if (c.side === 'below') {
            ty = e.y + s / 2 + 3.5 + (c.far ? ruleParam('layout.equipTagFar', 26) : 0);
          } else if (c.side === 'above') {
            // the TYPE line is the one nearest the symbol when the block hangs above
            ty = e.y - s / 2 - 3.5 - (typeStr ? TYPE_OFF : 0);
          } else {
            const halfTag = tag ? textBox(0, 0, tag, fTag, true, true).x1 : 0;
            const halfType = typeStr ? textBox(0, 0, typeStr, fType, true).x1 : 0;
            const off = s / 2 + Math.max(halfTag, halfType) + 4;
            cx = c.side === 'left' ? e.x - off : e.x + off;
            ty = e.y - (typeStr ? TYPE_OFF / 2 : 0);
          }
          return {
            cx, ty,
            tag: textBox(cx, ty, tag, fTag, true, true),
            type: typeStr ? textBox(cx, ty + TYPE_OFF, typeStr, fType) : null,
          };
        };
        let best = null, bestHits = Infinity;
        for (const c of EQ_ANNOT) {
          const p = place(c);
          const hits = boxClutter(p.tag) + (p.type ? boxClutter(p.type) : 0);
          if (hits < bestHits) { bestHits = hits; best = p; }
          if (hits === 0) break;             // preference order wins ties
        }
        const ty = best.ty, cx = best.cx;
        g += `<text x="${cx}" y="${ty}" text-anchor="middle" font-size="${fTag}" font-weight="bold" fill="#111" text-decoration="underline" paint-order="stroke" stroke="white" stroke-width="3">${esc(tag)}</text>`;
        eqBoxes.push(best.tag);
        if (typeStr) g += `<text x="${cx}" y="${ty + TYPE_OFF}" text-anchor="middle" font-size="${fType}" fill="#666" paint-order="stroke" stroke="white" stroke-width="3">${esc(typeStr)}</text>`;
        if (best.type) eqBoxes.push(best.type);
        // counted, not just avoided: a sheet where nothing fits is worth saying out loud
        if (bestHits > 0) {
          equipTagOnLine.push(`${e.id} (${bestHits})`);
        }
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
          // boxes already recorded in the pre-pass above (equipment placement needs
          // them before this loop runs); pushing again would double them and make
          // every nozzle box "clutter" for the next tag
          if (nz.size) body += `<text x="${tagX}" y="${tagY + 4.5}" text-anchor="middle" font-size="${fs(1.8)}" fill="#888" paint-order="stroke" stroke="white" stroke-width="2">${esc(nz.size)}</text>`;
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
        // [string, size, offset, width-em-role] -- the role travels with the row so the
        const rows = [[tag, fs(3.0), 0, true]];
        if (!v.noTypeLabel) rows.push([typeLabel, fs(2.8), 5.5]);
        if (state) rows.push([state, fs(2.3), 10.5, false]); // emission-fixed offsets
        // Derived line size (T7.12). Added as a ROW of the existing stack rather than
        // drawn independently, so it inherits the above/below flip and the collision
        // test at 1734. A separately positioned size would have to re-implement both.
        // Blue like the line designations, because that is what it is: a property of
        // the pipe, not of the valve.
        const sizeLabel = v.sizeLabel || '';
        if (sizeLabel) rows.push([sizeLabel, fs(2.3), 15.5, false]);
        const stackBoxes = (fx, fy, mid, dir) => rows.map(([str, fnt, off, role]) => {
          // the `role` was being dropped here: the tag row is drawn bold but was
          // measured as regular, so the widest row of every valve stack reserved
          // the least. A stack has to be measured the way it is emitted.
          const b = textBox(fx, fy + dir * off, str, fnt, true, role);
          if (mid) return b;
          const w = b.x1 - b.x0;
          return dir < 0
            ? { x0: fx - w, x1: fx, y0: b.y0, y1: b.y1 }
            : { x0: fx, x1: fx + w, y0: b.y0, y1: b.y1 };
        });
        // A valve stack competes for the same paper as everything else, and for a
        // long time it only competed with NOZZLE and EQUIPMENT boxes — never with
        // linework. So a valve on a riser printed "CONTROL VALVE" straight through
        // the process line it sits on, and the flip had nothing to flip away from:
        // measured on dense, FV-1's stack runs down the P-1 discharge riser.
        // Linework is in the test now.
        //
        // Four candidates rather than two, in a drafter's order — the legacy
        // position FIRST, so an uncluttered sheet is byte-identical — and the first
        // with ZERO hits wins. Two positions were never enough: a valve below a
        // valve and a valve above a valve can both be blocked while left and right
        // are free, and the old code had no way to say so.
        //
        // The sideways pair is a LAST resort and it is not free. Measured on the
        // demo: letting a stack move sideways cleared enough label collisions for a
        // much emptier layout (util 48% -> 28%) to win the search, because the fill
        // term buys sheet area with crossings and this removed the crossings that
        // were paying for it. So it is a rule, and the rule is off by default:
        // `annotation.valveStackSides`. Turn it on for a sheet where two labels
        // genuinely cannot stack, and the log's own argument applies — the score
        // will trade the fill it should have had for labels it should not have had.
        //
        // One emitter for all candidates. There were four near-identical copies of
        // this block, and they had already drifted: the vertical "flip" case computed
        // its collision boxes with the rows going UP (`dir: -1`) and then DREW them
        // going down (`ty + 5.5`), so the flip was chosen against a box the text
        // never occupied. `dir` now means the same thing to the box and the emitter.
        const stackZones = [...nozzleBoxes, ...eqBoxes, ...lineLabelBoxes, ...zones];
        const stackHits = (boxes) => {
          let n = 0;
          for (const b of boxes) {
            n += boxLineHits(b);
            for (const z of stackZones) if (collide.rectsHit(b, z)) n++;
          }
          return n;
        };
        // Only the two legacy positions. A third "push it 8mm further out on the
        // same side" tier was implemented and measured, and it is NOT here because
        // it lost. [15] LABEL OVER LINEWORK is 40 findings across the six canonical
        // sheets and 19 of them are valve stacks blocked in both positions, so two
        // positions is plainly not enough — but adding a tier is not free, and the
        // reason is the coupling documented at `weights.annOnLine`. The placers run
        // inside the scored pass, so a stack that moves changes the annotation boxes,
        // which changes which layout candidate the search prefers.
        //
        // As a plain fourth preference position: corpus 1827 -> 1863. spike improved
        // by 30 and lost its last label collision, but demo went +36 and manifold
        // +30 AND GAINED a label collision it did not have. Confined to "both near
        // positions are blocked and this one is completely clear" it stopped costing
        // spike and manifold, and still cost the demo 25 points and 7 points of sheet
        // use (util 44% -> 37%) — one sheet traded its arrangement for its labels.
        // `annotation.valveStackSides` is the same lever and is gated off for the
        // same family of reasons; this is the same failure one tier in.
        const cands = vertical
          ? [{ fx: v.x + s / 2 + 3, fy: v.y + 1, mid: false, dir: 1 },
             { fx: v.x - s / 2 - 3, fy: v.y + 1, mid: false, dir: -1 }]
          : (ruleParam('annotation.valveStackSides', 1)
            ? [{ fx: v.x, fy: v.y + s / 2 + 3.5, mid: true, dir: 1 },
               { fx: v.x, fy: v.y - s / 2 - 3.5, mid: true, dir: -1 },
               { fx: v.x + s / 2 + 3, fy: v.y, mid: false, dir: 1 },
               { fx: v.x - s / 2 - 3, fy: v.y, mid: false, dir: -1 }]
            : [{ fx: v.x, fy: v.y + s / 2 + 3.5, mid: true, dir: 1 },
               { fx: v.x, fy: v.y - s / 2 - 3.5, mid: true, dir: -1 }]);
        let chosen = cands[0], chosenHits = Infinity;
        for (const c of cands) {
          const h = stackHits(stackBoxes(c.fx, c.fy, c.mid, c.dir));
          if (h < chosenHits) { chosenHits = h; chosen = c; }
          if (h === 0) break;
        }
        if (chosenHits > 0) valveStackOnLine.push(`${v.id} (${chosenHits})`);
        // ONE emitter, driven by the same (fx, fy, mid, dir) the boxes were built
        // from, so the tested box and the drawn text cannot disagree.
        {
          const { fx, fy, mid, dir } = chosen;
          const anchor = mid ? ' text-anchor="middle"' : ' text-anchor="end"';
          const row = (o, str, size, fill) => str
            ? `<text x="${fx}" y="${(fy + dir * o).toFixed(2)}"${anchor} font-size="${size}"${fill === 'b' ? ' font-weight="bold"' : ''} fill="${fill === 'b' ? '#111' : fill === 's' ? '#555' : fill === 'z' ? '#0D47A1' : '#666'}" paint-order="stroke" stroke="white" stroke-width="3">${esc(str)}</text>`
            : '';
          g += row(0, tag, fs(3.0), 'b');
          if (!v.noTypeLabel) g += row(5.5, typeLabel, fs(2.8), 'g');
          if (state) g += row(10.5, state, fs(2.3), 's');
          if (sizeLabel) g += row(15.5, sizeLabel, fs(2.3), 'z');
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
      // Full tag inside the bubble: letters + loop number (ISA convention).
      //
      // The offsets were a hardcoded +0.5 / +5.5, which is NOT the centre of the ink they
      // produce. Measured on the demo at typeScale 1.3: "LT" is fs(3.2)=4.16mm, so its cap
      // top sits at 0.5 - 0.72*4.16 = -2.5, while the loop baseline at +5.5 puts its
      // descenders at +6.17. The block spans -2.5..+6.17 -- 8.7mm tall, centred at +1.84,
      // i.e. sitting 1.84mm LOW inside a bubble of radius 0.4*size.
      //
      // Consequence, and it is on every instrument on every sheet: the loop number hangs
      // about 1.5mm out of the BOTTOM of the circle, so the sheet reads "LT  -101" with
      // the number outside the bubble. The bubble SIZE was never wrong -- the block was
      // simply not centred in it.
      //
      // Deriving the shift from the metrics also makes it correct at any typeScale. fs() and
      // sizeOf() both scale, but not by a guaranteed common factor, and a fixed offset
      // only happened to land near-centre at one setting.
      // The vertical block metrics come from the same table as the widths, so the
      // centring below is derived rather than guessed (T6.16's cousin: a fixed
      // offset only lands near-centre at one typeScale). CAP 0.72 / DESC 0.20 were
      // hand-rounded; PIDText carries 0.718 / 0.207.
      const CAP = PIDText.CAP / 1000, DESC = PIDText.DESC / 1000;
      const fL = fs(3.2), fN = fs(2.6);
      const tagLines = [[letters, fL, true, 0.5]];
      if (loop) tagLines.push([loop, fN, false, 5.5]);
      let bTop = Infinity, bBot = -Infinity;
      for (const [, f, , off] of tagLines) {
        bTop = Math.min(bTop, off - CAP * f);
        bBot = Math.max(bBot, off + DESC * f);
      }
      const shift = -(bTop + bBot) / 2;   // centre the ink block on inst.y
      // Radius the block actually needs: the worst corner of any line, measured against the
      // drawn bubble (0.4 * size, since the glyph is circle r=40 in a 100-unit viewBox).
      let need = 0;
      for (const [str, f, em, off] of tagLines) {
        const y = off + shift;
        need = Math.max(need, Math.hypot(widthEm(str, f, em) / 2, y - (CAP - DESC) * f / 2));
      }
      for (const [str, f, em, off] of tagLines) {
        // `data-pid-inst` marks this run as living INSIDE its own bubble. The
        // candidate score replaces every such run with the bubble box (see the
        // label-collision term in renderInto): the bubble does not move when the
        // text inside it is re-centred, so the score must not either. 9.72 measured
        // what happens when it does — centring the block moved the text 1.8mm, the
        // near-tied candidates re-rolled, and spike landed on a worse layout
        // (crossings 9 -> 10, two new collinear tap/pipe overlaps) for a change
        // that could not physically have moved a pipe, a bubble or a tap leader.
        g += `<text x="${inst.x}" y="${(inst.y + off + shift).toFixed(2)}" text-anchor="middle" font-size="${f}" font-weight="${em ? 'bold' : 'normal'}" data-pid-inst="${esc(inst.tag)}" fill="#111" paint-order="stroke" stroke="white" stroke-width="3">${esc(str)}</text>`;
      }
      // A tag that still will not fit is a layout bug, not something to paper over. Record
      // it so it is countable instead of the sheet quietly showing a number outside its
      // bubble.
      // 0.25mm is the conventional CAD plotting tolerance, so an overshoot below that is
      // not a defect worth a warning. Matching audit [14] matters: a validator and an
      // audit that disagree on a threshold are worse than either one alone.
      const TAG_TOL = 0.25;
      const rDrawn = 0.4 * sizeOf(inst);
      if (need > rDrawn + TAG_TOL) {
        (data.warnings || (data.warnings = [])).push(
          `[PID-INS-020] tag "${inst.tag}" needs a ${need.toFixed(1)}mm bubble but has ${rDrawn.toFixed(1)}mm: the tag will not fit inside`);
      }
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
    // Diameter from the rule, and NO fill attribute: the stylesheet
    // circle.pid-junction-dot{fill:<theme>} beats a presentation attribute, so the old
    // fill="#1E90FF" never took effect and the dot rendered theme-black. A dead
    // attribute is worse than no attribute -- it reads as intent and audits as a
    // colour that is not on the sheet. The theme is the single owner of colour.
    const jd = ruleParam('annotation.junctionDot', 2.5) / 2;
    body += `<circle class="pid-junction-dot" cx="${j.x}" cy="${j.y}" r="${jd}" data-pid-id="${j.id}"/>`;
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

  // Re-solve the fit now that the ROUTES and the ANNOTATIONS exist. `solveFit` is
  // called a second time here, against the union of the symbol extent, every routed
  // vertex and every annotation box, and the wrap is replaced.
  //
  // This is the difference between "the symbols fit" and "the drawing fits". A line
  // leaves the last nozzle on the sheet and runs to a partner; a tap leader reaches
  // sideways to find a bubble; a line designation stands 14mm off its run. None of
  // that is inside a symbol box, and on `fit page` the old inline solve never saw any
  // of it, so the sheet was scaled to the symbols and everything else was allowed to
  // walk out — in one measured case a line designation printed inside the equipment
  // schedule along the top edge, because the fit had no idea the annotation existed.
  //
  // The routes and the boxes are in content coordinates, unscaled, so this is the
  // same space the provisional solve used. Re-solving is exact, not iterative: `k`
  // is a similarity and uniform scaling does not change which points are extreme.
  if (view.fitPage) {
    let rx0 = minX, ry0 = minY, rx1 = maxX, ry1 = maxY;
    const eat = (x, y) => {
      if (x == null || y == null) return;
      if (x < rx0) rx0 = x; if (x > rx1) rx1 = x;
      if (y < ry0) ry0 = y; if (y > ry1) ry1 = y;
    };
    const eatBox = (b) => { if (b) { eat(b.x0, b.y0); eat(b.x1, b.y1); } };
    for (const g of geometries) for (const q of (g.pts || [])) eat(q.x, q.y);
    for (const t of tapGeos) for (const q of (t.pts || [])) eat(q.x, q.y);
    for (const b of lineLabelBoxes) eatBox(b);
    for (const b of nozzleBoxes) eatBox(b);
    for (const b of eqBoxes) eatBox(b);
    // a pipe stroke is 1.4mm and a leader 2.5mm; half of the widest, so the ink is
    // inside the box rather than its centreline
    const hw = ruleParam('routing.processWidth', 1.4) / 2;
    wrap = solveFit(rx0 - hw, ry0 - hw, rx1 + hw, ry1 + hw);
  }
  // put the type back to nominal size now that the geometry has been scaled to fill
  const dn = denormaliseText(body, k);
  body = dn.body;
  if (dn.n || dn.skipped) {
    data.textNormalised = { scaled: dn.n, inherited: dn.skipped, k: Math.round(k * 1000) / 1000 };
  }
  // annotationsSvg ONCE. It used to be called twice — once for `svg.innerHTML` and
  // again, identically, to build `__LAST_SVG` — which doubled the furniture work on
  // every candidate and, worse, pushed any furniture warning TWICE into
  // `data.warnings`. It stayed invisible while the furniture was pure markup; the
  // moment the title block started reporting (PID-TBL-001/002, T3.8) every title
  // finding appeared twice and the score carried 5 phantom points per duplicate.
  const furniture = annotationsSvg(data, W, H);
  svg.innerHTML = wrap + body + (wrap ? '</g>' : '') + furniture;
  globalThis.__LAST_SVG = (wrap ? wrap : '') + body + (wrap ? '</g>' : '') + furniture;
  // must run after every fs() call above, and before finalizeValidation, which is
  // where the score is priced from the warning list
  checkTypeBand();
  // Resolve the type sizes ONCE and publish them, so annotationsSvg (sheet
  // furniture) draws the equipment schedule at exactly the same sizes the
  // annotation layer uses. Recomputing the formula over there would be a third
  // copy of a constant that has already drifted once.
  data.typeMm = { eqTag: fs(3.2), eqType: fs(2.8) };
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
  // Annotation collisions: overlap between any two rendered label text boxes.
  //
  // Instrument TAGS are scored as their BUBBLE, not as the text inside it (T6.16).
  // This is not a detail, it is the difference between a search that reacts to the
  // drawing and one that reacts to the draughtsman. 9.72 measured it: centring a
  // tag block in its bubble moved the text 1.8mm, could not have moved a pipe, a
  // bubble or a tap leader — and DID re-roll which of two near-tied candidates won,
  // landing spike on a worse layout (crossings 9 -> 10, two new collinear tap/pipe
  // overlaps). The score was reading a quantity that has no effect on the drawing.
  // So: drop the in-bubble runs, add one box per instrument at the bubble's real
  // drawn extent. The bubble is what occupies space, and it is placed by a
  // mechanism (`passInstruments`'s keep-out) that already knows about labels.
  let labelCollisions = 0;
  // Every text box on the finished sheet, kept for the fill term's ink estimate
  // below. Declared here rather than inside the block because the two consumers are
  // fifty lines apart and re-parsing the markup for a second purpose would be the
  // kind of second answer this project keeps having to unpick.
  let textBoxes = [];
  {
    const raw = pidTextBoxes(svg.innerHTML || '');
    textBoxes = raw;
    const seenBubble = new Set();
    const boxes = [];
    for (const b of raw) {
      if (b.inst) { if (!seenBubble.has(b.inst)) { seenBubble.add(b.inst); boxes.push({ instBox: true, ...b }); } continue; }
      boxes.push(b);
    }
    // replace each in-bubble run with the bubble's own square
    for (let i = 0; i < boxes.length; i++) {
      if (!boxes[i].instBox) continue;
      const inst = instruments.find(q => q.tag === boxes[i].inst);
      if (!inst || inst.x == null) continue;
      const s = sizeOf(inst) / 2;
      boxes[i] = { x0: inst.x - s, x1: inst.x + s, y0: inst.y - s, y1: inst.y + s };
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) labelCollisions++;
      }
    }
    // published so a probe can see WHICH pairs collide. A count with no names
    // attached is an unactionable total -- the audit learned that the hard way when
    // a collision count went up and only the audit's names said "each list item
    // collided with itself".
    data.labelPairs = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) {
        data.labelPairs.push([Math.round((a.x0 + a.x1) / 2), Math.round((a.y0 + a.y1) / 2)]);
      }
    }
  }
  // instrument placement: tap reaches and signal runs (already warned on; quantified here)
  //
  // `tapReachTotal` SUMS over every tap and `maxSignalLen` took only the MAXIMUM
  // single segment of the worst signal run, which is not a like-for-like pair of
  // numbers and was leaving most of the signal tier unpriced. On `spike` — six
  // instruments, six signal runs — the drawing shows the consequence: the dashed runs
  // out to FIC-101 and LIC-101 go round the right-hand side in big RECTANGLES, one
  // ~500mm each, and the objective was paying for the worst one only.
  //
  // Both are kept, and the sum is priced. The max is a "worst offender" reading that
  // names the single ugliest run; the total is what the reader sees, because five
  // 200mm detours cost the drawing exactly as much attention as one 500mm one.
  // `instruments.signalRuns` is published so the per-run average is available without
  // dividing by hand.
  let tapReachTotal = 0, maxSignalLen = 0, signalLenTotal = 0, signalRuns = 0;
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
      if (g) {
        let run = 0;
        for (let k = 1; k < g.pts.length; k++) {
          const L = Math.abs(g.pts[k].x - g.pts[k - 1].x) + Math.abs(g.pts[k].y - g.pts[k - 1].y);
          maxSignalLen = Math.max(maxSignalLen, L);
          run += L;
        }
        signalLenTotal += run;
        signalRuns++;
      }
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
  // ---- sheet-shape term (9.68) ------------------------------------------------
  // The reverted `util` term had two failure causes and BOTH are fixed here, which is
  // why this is a resurrection rather than a repeat:
  //   * it measured PIPE geometry only, reading the demo at 32% useH where the
  //     entity-aware audit reads 38-61%. Most of what makes a drawing big is symbols
  //     and their label stacks, and those are not in `geometries`.
  //   * it had no lever, so it could only add cost -- and it charged min.dsl (two
  //     valves) 113 points for the crime of being small. `layout.rowSpacing` IS the
  //     lever, measured at demo util 38% -> 61%, and it is now a search dimension, so
  //     a drawing can buy fill instead of merely being taxed for lacking it.
  //
  // Prices ASPECT MISMATCH, not absolute area. The render-time fit scale already
  // handles size; it cannot fix shape, because uniform scale preserves aspect.
  let fillW = 0, fillH = 0, fillInk = 0;
  {
    const ents = [...equipment, ...valves, ...instruments].filter((e) => e.x != null);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const eat = (x, y) => {
      if (x == null || y == null) return;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    };
    // INK, not bounding box — and this is a DIAGNOSTIC, not a target. The bbox of a
    // drawing can be the right SHAPE and still be almost empty, and 9.70 recorded
    // that as the reason the demo looked sparse: an L-shaped drawing fills its
    // bounding box by definition and reads as a third of a sheet. So the third
    // number here is the area the drawing actually OCCUPIES — symbol boxes, label
    // boxes and pipe ink — as a fraction of the zone.
    //
    // MEASURED AND NOT USED AS A PENALTY. Ink coverage is 2-16% on the corpus, an
    // order of magnitude below `fillTarget`, so a penalty on it is a large near-
    // constant that swamps every preference term: the search chases a number nothing
    // can move, and the corpus went 2019 -> 2589. What the number is FOR is that it
    // ranks candidates completely differently from the bounding box —
    //
    //   case      bbox      ink
    //   dense       19%      6%
    //   manifold    86%      6%
    //   spike       73%     16%
    //
    // — i.e. it is the difference between a drawing that FILLS its box and a drawing
    // that is a ring or an L, and a reader cannot get that from the bbox. Published
    // in `score.fill.ink` and reported by audit [11].
    let ink = 0;
    for (const e of ents) {
      const s = sizeOf(e);
      ink += s * s;
      eat(e.x - s / 2, e.y - s / 2); eat(e.x + s / 2, e.y + s / 2);
    }
    const pw = ruleParam('routing.processWidth', 1.4), sw = ruleParam('routing.signalWidth', 0.35);
    for (const g of geometries) {
      let len = 0;
      for (let i = 1; i < g.pts.length; i++) len += Math.abs(g.pts[i].x - g.pts[i - 1].x) + Math.abs(g.pts[i].y - g.pts[i - 1].y);
      ink += len * (g.signal ? sw : pw);
      for (const q of (g.pts || [])) eat(q.x, q.y);
    }
    for (const b of textBoxes) ink += (b.x1 - b.x0) * (b.y1 - b.y0) * 0.6;   // caps are ~60% of the em box
    // The zone, not the sheet. `(sheetW - 36) x (sheetH - 36)` is the FRAME, and
    // the drawing does not live there: the equipment schedule owns a band across the
    // top and the title block a band along the bottom, which is exactly what
    // `data.drawZone` already encodes for the centring pass and the fit. Measuring
    // sheet use against a rectangle the drawing is not allowed to use understated it
    // by 12% of area on every sheet, and a term that is uniformly 12% off is a term
    // that never reaches its target. Both numbers are reported so the ratio is
    // visible rather than implied.
    const Z = data.drawZone;
    const FW = Z ? Z.x1 - Z.x0 : (view.sheetW || 864) - 36;
    const FH = Z ? Z.y1 - Z.y0 : (view.sheetH || 559) - 36;
    if (x1 > x0 && y1 > y0) {
      fillW = Math.min(1, (x1 - x0) / FW);
      fillH = Math.min(1, (y1 - y0) / FH);
      fillInk = Math.min(0.95, ink / (FW * FH));
    }
  }
  // UTILISATION, not bounding-box aspect. The first attempt used aspect mismatch and
  // was wrong: the demo bbox is 1.75:1 against a 1.58:1 sheet, only 11% off, so the
  // term read 0 and the search never moved -- while the thing being complained about is
  // that the sheet is 40% used with a sparse middle. A bbox can be the right SHAPE and
  // still be mostly empty; area fraction is what a reader sees.
  //
  // The guard is the whole reason this is not the reverted `util` term. That one charged
  // min.dsl -- two valves -- 113 points for the crime of being small, because it had no
  // way to tell a small process from a badly spread large one. Here the penalty only
  // applies once the drawing has enough items to fill a sheet with, so a genuinely small
  // process is free and a sparse large one is not.
  const FILL_ENT_MIN = ruleParam('annotation.fillEntityMin', 8);
  const FILL_TARGET = ruleParam('annotation.fillTarget', 0.62);
  const utilArea = fillW * fillH;
  const entCount = equipment.length + valves.length + instruments.length;
  const fillGap = entCount >= FILL_ENT_MIN
    ? Math.max(0, FILL_TARGET - utilArea) : 0;
  const fill = Math.round(fillGap * 100) / 100;
  // ---- label-over-linework: the check that was missing entirely -------------
  //
  // An equipment tag, a valve label stack, a nozzle tag or a line designation
  // printed straight through a process line is one of the most obvious things a
  // P&ID can get wrong, and this project had no metric and no check for it: the
  // collision term compares text with TEXT, and the audit's line checks compare
  // lines with SYMBOL BOXES. Nothing looked at text against linework, so the drawing
  // could do it silently and the score could not see it. Measured on the dense
  // sheet before this pass: C-1's tag sat on the vertical run off the reboiler and
  // FV-1's "CONTROL VALVE" stack ran down the P-1 discharge riser.
  //
  // Counted over EVERY text run in the finished sheet, not just the two placers that
  // were taught to avoid it, because the two numbers disagreed and the honest answer
  // is the larger one: the audit's independent item [15] found 23 on spike where the
  // placers reported 1. A guard that only knows about the cases it was written for
  // is not a guard, and the difference between 1 and 23 is exactly the size of that
  // blind spot.
  //
  // Measured once, from the same boxes the collision term uses, so the engine and the
  // audit answer the same question. `audit [15]` is the independent check and
  // excludes nozzle leaders (a nozzle tag belongs on its own nozzle).
  let labelOnLine = 0;
  {
    const all = pidTextBoxes(svg.innerHTML || '');
    // A run with a LEADER is exempt, and that is what makes this a check rather than
    // a complaint. A line designation is supposed to sit beside its line and point
    // at it, and the emitter draws a dashed leader whenever the label is offset.
    // Without the exemption this counted 8 of spike's 27 findings as correct
    // drafting — and a check that reports correct drafting is worse than no check,
    // because the real findings get read as noise. Same exemption as audit [15].
    const leadered = (b) => leaderSegs.some((L) =>
      Math.min(Math.max(L.x1, L.x2), b.x1) > Math.max(Math.min(L.x1, L.x2), b.x0) - 1 &&
      Math.min(Math.max(L.y1, L.y2), b.y1) > Math.max(Math.min(L.y1, L.y2), b.y0) - 1);
    const hits = [];
    for (const b of all) {
      if (leadered(b)) continue;
      let n = 0;
      for (const sg of lineSegs) if (collide.segHitsRect(sg, b, -ruleParam('annotation.labelOnLineTol', 0.75))) n++;
      if (n) hits.push(`${b.t} x${n}`);
    }
    data.labelOnLine = hits.length;
    labelOnLine = hits.length;    if (hits.length) {
      data.warnings.push(
        `[PID-ANN-001] ${hits.length} label(s) are drawn over process linework: ${hits.slice(0, 6).join(', ')}${hits.length > 6 ? `, +${hits.length - 6} more` : ''}. A label on a pipe is unreadable; audit item [15] names all of them.`);
    }
  }

  // ---- breach tier ------------------------------------------------------
  // Violations the validator reports were invisible to the objective: a warning
  // cost `SW.warn` (5), which is less than a fifth of a 24-point fill preference,
  // so the search would keep a line with a 5.5mm port lead-in in preference to a
  // slightly fuller sheet. `validateGeometry` now reports each layout-fixable
  // breach with the distance it is short by, priced proportionally and capped so
  // it can never dominate a preference. See the long note in PID_RULES.weights.
  const breachList = lineIssues.breach || [];
  const breachMm = breachList.reduce((s, b) => s + b.mm, 0);
  const breach = Math.min(SW.breachCap, breachMm * SW.breachPerMm);
  const score = {
    total: Math.round(
      SW.err * nErr +
      SW.nonOrtho * nonOrtho + SW.overlap * Math.min(lineIssues.overlaps, 5) +
      SW.ungapped * lineIssues.ungapped +
      SW.pp * pp + SW.ps * ps + SW.ss * ss + SW.label * labelCollisions + SW.sheet * offSheet +
      SW.bend * bends + SW.len * length + SW.tap * tapReachTotal + SW.sig * maxSignalLen + SW.sigTotal * signalLenTotal +
      SW.warn * nWarn + SW.annOnLine * labelOnLine + SW.fill * fill + breach),
    weights: SW,
    fill: { w: Math.round(fillW * 100), h: Math.round(fillH * 100), util: Math.round(utilArea * 100), ink: Math.round(fillInk * 100), gap: fill, entities: entCount },
    // `k` is published so the relationship with `length` is visible rather than
    // implied. `length` is deliberately NOT multiplied by it, and 9.75.1 has the
    // measurement: `length` in layout units is pipe length measured in SYMBOL-WIDTHS,
    // which is scale-invariant and therefore the only reading in which "this process
    // has twice as much pipe per unit of equipment as that one" means anything. `k`
    // scales the symbols by the same factor, so `length * k` is absolute ink on paper
    // and charges a small well-proportioned drawing for being drawn large — measured
    // 1827 -> 1904, with the whole loss on the high-`k` sheets (split 45 -> 69, min
    // 65 -> 82). Every other term in this score is in layout units too.
    routing: { crossings: pp + ps + ss, pp, ps, ss, bends, length: Math.round(length), k: Math.round(k * 1000) / 1000, nonOrtho },
    sheet: { offSheet },
    annotations: { labelCollisions, labelOnLine, nozzleTagsOnLine: nozzleTagOnLine.length, equipTagsOnLine: equipTagOnLine.length, valveStacksOnLine: valveStackOnLine.length },
    lines: { overlaps: lineIssues.overlaps, ungapped: lineIssues.ungapped, astarGiveups, breach: Math.round(breach), breachMm: Math.round(breachMm * 10) / 10, leadInShort: lineIssues.leadInShort || 0 },
    instruments: { tapReachTotal: Math.round(tapReachTotal), maxSignalLen: Math.round(maxSignalLen), signalLenTotal: Math.round(signalLenTotal), signalRuns },
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

  // ---- equipment tag list, one row across the top (T3.6) ----------------
  // Clones of the equipment annotations, in the one-row band autoLayout reserved.
  // Same text and same sizes as the drawing: data.typeMm is published from the one
  // fs() choke point rather than recomputed, so the clone cannot drift.
  const el = data.equipList;
  if (el && el.rows.length) {
    const tm = data.typeMm || { eqTag: 4.5, eqType: 4.0 };
    const lx = pad + 10;
    const ty = pad + 12;                     // tag baseline; type line 3.6 below
    // The north arrow starts at y = pad + 28, BELOW this row, so the row may use
    // the full width rather than stopping short of the arrow.
    const right = W - pad - 12;
    // Same 5.5mm the equipment annotation uses between its tag and type lines.

    // Anything tighter overlaps. With the real metric an all-caps line is 0.718em
    // tall, so 5.5mm of baseline separation at 4.0mm type leaves 2.6mm of clear
    // air. The old note here ("textBox height is 1.15em, so 3.6mm collides by
    // 0.9mm") was a consequence of the flat height guess, not of the geometry.

    const TYPE_OFF = 5.5;

    const GUT = 7;                           // gutter between items
    // Real advance, from the same table the drawing is measured with, tag bold and
    // type regular. Replaces `length * f * 0.62` ("uppercase serif advance averages
    // ~0.62em, over-estimate slightly") -- an average that is 9% narrow on regular
    // caps and was tuned by feel. A list that overflows the frame is a defect, so
    // the error has to land on the safe side; with a real table that is a property
    // of the table rather than of a fudge factor.
    const adv = (s2, f, bold) => PIDText.widthMm(s2, f, !!bold);
    let x = lx, fit = 0;
    for (const row of el.rows) {
      const w = Math.max(adv(row.tag, tm.eqTag, true), adv(row.type, tm.eqType, false));
      // Never start an item that cannot finish inside the frame.
      if (x > lx && x + w > right) break;
      s += `<text x="${x}" y="${ty}" font-size="${tm.eqTag}" font-weight="bold" fill="#111" text-decoration="underline">${esc(row.tag)}</text>`;
      if (row.type) s += `<text x="${x}" y="${ty + TYPE_OFF}" font-size="${tm.eqType}" fill="#666">${esc(row.type)}</text>`;
      x += w + GUT;
      fit++;
    }
    // Never drop items silently -- a reader has to be able to tell the row is
    // partial, or the list reads as a complete equipment take-off.
    if (fit < el.rows.length) {
      const n = el.rows.length - fit;
      s += `<text x="${right}" y="${ty}" font-size="${tm.eqTag}" text-anchor="end" fill="#666">+${n} MORE</text>`;
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

  // Title block, bottom-right inside the frame.
  //
  // Every line here is fitted to the block (T3.8). The block used to be 160mm wide
  // and the strings were emitted at literal sizes with no measurement of any kind,
  // so a long title simply ran out through the block and off the sheet edge: found
  // 2026-09-26 on a fixture titled "Three-branch manifold with return header", and
  // the audit does not look at the title block, so nothing reported it. The
  // sequence is the one a CAD title block uses and the one the item asked for:
  //
  //   1. if it fits at the nominal size, use the nominal size;
  //   2. otherwise shrink toward a floor, because a slightly small title is legible
  //      and a clipped one is not;
  //   3. if it still does not fit at the floor, truncate with an ellipsis AND say
  //      so in the validator, because silently losing the end of a project name is
  //      the failure mode a drawing tool must not have.
  //
  // Measured with `PIDText` — the same table the rest of the drawing uses, so a
  // title cannot be "measured" one way and drawn another.
  if (v.title) {
    const bx = W - pad - 160, by = H - pad - 60, bw = 160, bh = 60;
    const INSET = 8, AVAIL = bw - 2 * INSET;
    const TITLE_MIN = 5.0;                 // below this a title is not a title
    s += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="white" stroke="#333" stroke-width="1.5"/>`;
    s += `<line x1="${bx}" y1="${by + 17}" x2="${bx + bw}" y2="${by + 17}" stroke="#333" stroke-width="1"/>`;
    const fit = (str, nominal, bold, min) => {
      const txt = String(str);
      if (PIDText.widthMm(txt, nominal, bold) <= AVAIL) return { text: txt, size: nominal };
      for (let f = nominal - 0.25; f >= min; f -= 0.25) {
        if (PIDText.widthMm(txt, f, bold) <= AVAIL) return { text: txt, size: f };
      }
      for (let n = txt.length - 1; n > 1; n--) {
        const t = txt.slice(0, n).replace(/[\s,;:.\-]+$/, '') + '...';
        if (PIDText.widthMm(t, min, bold) <= AVAIL) return { text: t, size: min, truncated: true };
      }
      return { text: '...', size: min, truncated: true };
    };
    const title = fit(v.title, 8, true, TITLE_MIN);
    s += `<text x="${bx + INSET}" y="${by + 12}" font-size="${title.size.toFixed(2)}" font-weight="bold" fill="#111">${esc(title.text)}</text>`;
    if (title.truncated) {
      (data.warnings || (data.warnings = [])).push(
        `[PID-TBL-001] title "${v.title}" is longer than the title block (${AVAIL.toFixed(0)}mm at ${TITLE_MIN}mm type) and has been truncated to "${title.text}". Shorten the title, or widen the block.`);
    } else if (title.size < 8) {
      (data.warnings || (data.warnings = [])).push(
        `[PID-TBL-002] title "${v.title}" needed ${title.size.toFixed(2)}mm type to fit the title block (nominal 8mm).`);
    }
    // The three metadata rows keep their own baselines; only their TYPE is fitted.
    // (Collapsing them onto one baseline was the first cut here and produced three
    // label collisions on every sheet with a title block — the collision metric
    // caught a change I had not looked at, which is the metric working.)
    const line2 = (str, y) => {
      const f = fit(str, 6, false, 4.5);
      return `<text x="${bx + INSET}" y="${by + y}" font-size="${f.size.toFixed(2)}" fill="#333">${esc(f.text)}</text>`;
    };
    if (v.project) s += line2('Project: ' + v.project, 26);
    if (v.sheet) s += line2(`Sheet ${v.sheet}${v.sheetTotal !== v.sheet ? ' of ' + v.sheetTotal : ''}`, 35);
    if (v.rev) s += line2(`Rev ${v.rev.mark} (${v.rev.date})${v.rev.desc ? ' - ' + v.rev.desc : ''}`, 44);
    s += `<text x="${bx + INSET}" y="${by + 54}" font-size="5" fill="#666">P&amp;ID Gen ${new Date().toISOString().slice(0, 10)}</text>`;
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
        // The two pitch axes too, for the reason at the placement search: this path
        // scores candidates from the same space the default path does, or the gate in
        // regress.mjs is comparing a search against a subset of itself.
        rowSpacing: placement ? placement.rs : undefined,
        colMax: placement ? placement.cm : undefined,
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
      // Row pitch as a search dimension (9.68). Measured per sheet there is no single
      // best value -- demo and dense want 260mm (util 38% -> 61%), spike and manifold
      // want 145mm -- so let the engine choose per sheet instead of hardcoding one.
      // Row pitch as a search dimension (9.68). Measured per sheet there is no single
      // best value -- demo and dense want 260mm (util 40% -> 61%), spike and manifold
      // want 145mm -- so the engine tries several and scores them.
      //
      // Three candidates, not two, and that is not padding. With only two the search
      // became SEED-SENSITIVE once the fill term existed: the default seed found dense
      // at 462 and `--seedbase=1` found 473, which regress.mjs reports as "candidates
      // winner worse than blessed". A fill term rewards one specific arrangement, so a
      // two-point row search can miss it depending on where the other dimensions
      // happen to land. Three pitches cover the knee of the curve measured in 9.66
      // (flat below 180, rising to 220, past its peak by 300) and take the dependence out.
      //
      // THE THIRD PITCH IS NOT PADDING, and I nearly deleted it on a bad experiment.
      // Pinning the axis to {rs, 300} for each rs in turn:
      //
      //   axis      demo  spike  dense  min  split  manifold   sum
      //   {145,300} 319    789    384    65     45       225     1827
      //   {145,220} 344    789    400    65     45       225     1868
      //   {220,300} 319    949    384    65     45       328     1967
      //   {300}     319    949    384    65     45       328     1967
      //
      // 220 and 300 tie as a PAIR (rows 3 and 4), which reads at a glance like "300 is
      // dominated by 220" and is exactly backwards: the third candidate is what carries
      // the demo and dense, and {145, 220} loses 41 points to {145, 300}. A pair test
      // cannot see a candidate's value, only its tie, and the earlier version of this
      // comment confidently concluded the wrong thing from one.
      //
      // The cost is real and stated: four column pitches x three row pitches is the
      // difference between spike rendering in 13.4s and 28.7s. T3.1/T3.2 -- a
      // layout-only fitness so the cheap dimensions can be searched without paying for
      // a route -- is the documented remedy and it is now worth more than it was, because
      // the column-pitch axis went from two values to four and that is where the search
      // wanted to grow.
      const rowsBase = ruleParam('layout.rowSpacing', 145);
      const rowsAlt = ruleParam('layout.rowSpacingAlt', 220);
      const rowsAlt2 = ruleParam('layout.rowSpacingAlt2', 300);
      // Row pitches. 220 is dropped: measured free on all five sheets.
      // `layout.searchWide` restores it.
      const rowSeps = ruleParam('layout.searchWide', 0)
        ? [...new Set([rowsBase, rowsAlt, rowsAlt2])].sort((a, b) => a - b)
        : [...new Set([rowsBase, rowsAlt2])].sort((a, b) => a - b);
      // Column-pitch cap as a fourth search dimension. `COL = availW/numCols`
      // always spreads the chain across the full sheet, so the drawing is as WIDE as
      // the sheet allows and as SHORT as the topology allows -- the aspect is a
      // property of the process, not a choice. Capping the pitch trades width for
      // height and lets the fit scale enlarge the result, which is how a drafter
      // uses a big sheet: draw bigger, not stretch.
      //
      // It was refuted once (9.68) and the refutation was correct AT THE TIME: with
      // the fit broken, a capped chain came out smaller overall rather than larger.
      // The fit no longer includes the origin in the content box and solves against
      // the routed geometry, so "smaller" and "larger" now mean what they say. It is
      // a CANDIDATE and not a new score term, for the reason 9.66 established: the
      // corpus genuinely splits on it (spike 943 -> 838 at 110mm, manifold
      // 324 -> 373; at 90mm the reverse), and no single value is right for both.
      //
      // TWO values were not enough, and the sweep says so unambiguously. Holding
      // everything else fixed and moving only the second value:
      //
      //   alt     demo   spike   dense   manifold   sum
      //   110      344     789     384       264     1891   <- 0/110, current
      //   150      344     904     384       225     1967
      //   200      319     904     384       264     1981
      //   240      331     904     384       264     1988
      //
      // spike needs 110 and refuses anything wider (789 -> 904, crossings 7 -> 16:
      // a longer pitch gives the router more room to make detours and it takes them).
      // manifold wants 150 (264 -> 225, crossings 1 -> 0). The demo wants 200
      // (344 -> 319, and its shape goes from 78%x48% to 65%x68%, which is the ink/bbox
      // ratio [13] complains about). A two-element axis has to pick ONE and the other
      // two sheets pay for it. Three options is the smallest set that lets each sheet
      // take its own, and it is still a candidate list — the score decides, not a rule.
      // Column-pitch cap candidates. Reduced from four values to two
      // (IMPROVEMENTS.md §0d W1), and the reduction is NOT the middle two.
      //
      // The original four-value set and the measurement behind it are
      // preserved in the comment block above. What was removed is 110 and
      // 200 — 150 is KEPT, and keeping it is load-bearing: `manifold` scores
      // 225 at colMax 150 and 264 at 0/110/200, because that sheet needs a
      // mid-range pitch and a two-element axis of {0, 200} cannot express it.
      // An earlier attempt dropped 150 and `regress.mjs` caught it
      // immediately (REGRESS FAIL on manifold, 225 -> 264, plus a genuine
      // determinism flag). So the rule learned here is the narrow one:
      //
      //     The values that never win are NOT contiguous.
      //
      // Which is precisely why the candidate sets are explicit and measured
      // per sheet rather than reasoned about in the abstract — and why
      // `layout.searchWide` restores the full four.
      //
      // Measured across all five regression sheets with {0,150} and {145,300}:
      // every score digit unchanged (spike still util 73 / crossings 7 /
      // bends 88 / length 6474), spike render 31168ms -> 20809ms. The order
      // axis (worth 132 on dense) and the coord sweep (worth 87) pay, and are
      // both kept.
      const colBase = ruleParam('layout.colMax', 0);
      const colWide = ruleParam('layout.searchWide', 0)
        ? [...new Set([colBase, ruleParam('layout.colMaxAlt', 110), ruleParam('layout.colMaxAlt2', 150), ruleParam('layout.colMaxAlt3', 200)])]
        : [...new Set([colBase, ruleParam('layout.colMaxAlt', 110), ruleParam('layout.colMaxAlt2', 150)])];
      const colCaps = doCoord ? [...new Set(colWide)] : [colBase];

      const orders = ruleParam('layout.orderSearch', 1)
        ? PID_LAYOUT_ORDERS.slice(0, Math.max(1, ruleParam('layout.orderCandidates', 3)))
        : [PID_LAYOUT_ORDERS[0]];
      let bestOrder = null;
      for (const ord of orders) {
        for (const sw of sweeps) {
          for (const sep of seps) {
            for (const rs of rowSeps) {
            for (const cm of colCaps) {
            const data = PID_PARSER.parse(source, { layoutOrder: ord, coordIters: sw, minSep: sep, rowSpacing: rs, colMax: cm });
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('id', containerId + '-svg');
            svg.setAttribute('role', 'img');
            const score = renderInto(svg, data, themeOpt);
            // snapshot the debug geometry WITH the candidate, so the winner's can be
            // restored below (see the note at the restore site)
            const geo = window.__pidGeo;
            if (!bestOrder || score.total < bestOrder.score.total) {
              bestOrder = { ord, sw, sep, rs, cm, svg, data, score, geo };
            }
            }
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
        coordIters: bestOrder.sw, minSep: bestOrder.sep, rowSpacing: bestOrder.rs,
      };
    }
    // ponytail: multi-start — try N random layouts, each with optional M routing
    // candidates. Layout seeds activate barycenter noise in autoLayout; routing
    // seeds activate A*/refinement tie-breaks. Total renders = nLayouts * (n + 1).
    //
    // Placement (order + coordinate sweeps + min separation + row pitch + column
    // pitch cap) is resolved ONCE here, on the legacy seed, and then held fixed for
    // every routing candidate. It is deterministic and independent of the routing
    // seed, so re-searching it per candidate would multiply cost for nothing — and
    // NOT searching it at all left this path scoring worse than the default path
    // (regress caught it: "candidates winner 1317 worse than blessed 1065").
    //
    // It searches the SAME five axes the default path does, and that is not tidiness.
    // It used to search three of them — order, coordinate sweeps and min separation —
    // and never the row pitch or the column-pitch cap, so the two paths were scoring
    // candidates from different spaces and `regress.mjs` could not compare them. It
    // only became visible when the column-pitch axis grew to four values: manifold
    // needs 150mm and the default path found it (225) while this path, which could
    // not ask for 150mm, topped out at 264 — a 39-point gap against a 34-point
    // tolerance, and REGRESS FAIL rather than a warning. A gate that compares two
    // searches is only meaningful if they searched the same thing, and the honest
    // reading of the failure is that the gate had been comparing a search against a
    // subset of itself.
    const placement = (() => {
      if (!ruleParam('layout.orderSearch', 1) && !ruleParam('layout.coordSearch', 1)) return { ord: null, sw: null, sep: null };
      const doCoord = ruleParam('layout.coordSearch', 1);
      const sweeps = doCoord ? [0, ruleParam('layout.coordSweeps', 8)] : [0];
      const sepBase = ruleParam('layout.minSep', 45), sepAlt = ruleParam('layout.minSepAlt', 45);
      const seps = doCoord && sepAlt > sepBase ? [sepBase, sepAlt] : [sepBase];
      const ords = PID_LAYOUT_ORDERS.slice(0, Math.max(1, ruleParam('layout.orderCandidates', 3)));
      const rowsBase = ruleParam('layout.rowSpacing', 145);
      const rowSeps = [...new Set([rowsBase, ruleParam('layout.rowSpacingAlt', 220), ruleParam('layout.rowSpacingAlt2', 300)])].sort((a, b) => a - b);
      const colBase = ruleParam('layout.colMax', 0);
      const colCaps = doCoord ? [...new Set([colBase, ruleParam('layout.colMaxAlt', 110), ruleParam('layout.colMaxAlt2', 150), ruleParam('layout.colMaxAlt3', 200)])] : [colBase];
      let bp = null;
      for (const ord of ords) {
        for (const sw of sweeps) {
          for (const sep of seps) {
            for (const rs of rowSeps) {
              for (const cm of colCaps) {
                pidSeed(null);
                const d = PID_PARSER.parse(source, { layoutOrder: ord, coordIters: sw, minSep: sep, rowSpacing: rs, colMax: cm });
                const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                s.setAttribute('id', containerId + '-svg');
                const sc = renderInto(s, d, themeOpt);
                if (!bp || sc.total < bp.total) bp = { ord, sw, sep, rs, cm, total: sc.total };
              }
            }
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
  },

    // ---- symbol test surface ------------------------------------------------
    // Exposes the geometry the SHEET RENDERER actually uses, so a test page can draw
    // symbols through the real path instead of re-implementing it.
    //
    // This exists because of a specific failure. audit-symbols.mjs re-derived the port
    // mapping by hand, used a formula valid only for a square viewBox, and reported 26
    // confident phantom findings -- and separately omitted the viewBox origin on both
    // sides of a comparison. Two copies of the geometry, two wrong answers. A test page
    // with its own drawing code would have been a third copy, and it would have graded
    // itself. So the page asks the renderer what it does rather than guessing.
    //
    // Returns the drawn markup plus every derived position IN RENDER UNITS (1 unit =
    // 1mm), centred on (0,0) so the caller can place it wherever it likes. Overlays --
    // extents, labelAnchor, the 5mm grid -- are deliberately NOT drawn here: those are
    // the test page's business, and mixing them in here would make this a second audit.
    symbolGeometry(key, size) {
      const sym = (typeof window !== 'undefined' && window.PID_SYMBOLS && window.PID_SYMBOLS[key]) || {};
      const vb = PIDEngine.symbolViewBox(key);
      // No SC here: sizeOf() closed over it from inside the render function, so it is
      // not visible at module level. Default to the NOMINAL size and let the caller
      // pass the scale it wants.
      const s = size || sym.size;
      const off = (conn) => {
        const o = PIDEngine.portOffset(key, conn, s);
        return { x: o.x, y: o.y };
      };
      const glyph = typeof glyphSvg === 'function' ? glyphSvg(key) : '';
      return {
        key,
        size: s,
        viewBox: vb || null,
        markup: glyph ? embedSymbolRaw(glyph, 0, 0, s, 0) : '',
        // dx/dy are the offset in RENDER mm from the placed centre; pctX/pctY are the
        // declared percentage in the glyph. Deliberately NOT merged: they are different
        // quantities, and overwriting one with the other loses the declaration entirely.
        ports: (sym.ports || []).map((p) => {
          const o = off(p);
          return Object.assign({}, p, { pctX: p.x, pctY: p.y, dx: o.x, dy: o.y });
        }),
        anchor: sym.anchor ? (() => {
          const o = off(sym.anchor);
          return { pctX: sym.anchor.x, pctY: sym.anchor.y, dx: o.x, dy: o.y };
        })() : null,
        extents: sym.extents || null,
        labelAnchor: sym.labelAnchor || null,
        flowAxis: sym.flowAxis == null ? null : sym.flowAxis,
        behavior: sym.behavior || null,
        standard: sym.standard || null,
      };
    },

    // Drawn size of a glyph once the uniform scale and letterbox centring are applied.
    // SYM-ASPECT is really a question about this number: a non-square viewBox is not
    // distorted, it just does not fill its nominal box.
    symbolDrawnSize(key, size) {
      const sym = (typeof window !== 'undefined' && window.PID_SYMBOLS && window.PID_SYMBOLS[key]) || {};
      const vb = PIDEngine.symbolViewBox(key);
      // No SC here: sizeOf() closed over it from inside the render function, so it is
      // not visible at module level. Default to the NOMINAL size and let the caller
      // pass the scale it wants.
      const s = size || sym.size;
      if (!vb) return { w: s, h: s, fill: 1, letterboxed: false };
      const k = Math.min(s / vb.w, s / vb.h);
      const w = vb.w * k, h = vb.h * k;
      return {
        w, h,
        fill: (w * h) / (s * s),
        letterboxed: Math.abs(vb.w - vb.h) > 0.01,
      };
    },
};


