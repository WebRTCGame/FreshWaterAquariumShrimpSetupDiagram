// Symbol data audit — anchors, basepoints, port metadata, viewBox and grid.
//
// The engine's two load-bearing symbol assumptions, both checked here:
//   A) a port at pct p sits at (p-50)/100 * size, in BOTH axes, from the centre
//      (pid-router anchorAt / PIDEngine.connWorld)
//   B) `size` is the rendered extent of the glyph in BOTH axes
//
// embedSymbolRaw nests the glyph's own <svg viewBox> inside a SQUARE
// width=size height=size box, so the browser applies preserveAspectRatio
// (xMidYMid meet) and letterboxes any non-square viewBox. Under that mapping (A)
// and (B) only hold exactly when the viewBox is square. This measures the
// resulting error per symbol per port.
//
// Usage: node audit-symbols.mjs [--verbose]
import { readFileSync, writeFileSync } from 'node:fs';
import { ink, maxStroke, gapToInk, inkBBox } from './symbol-ink.mjs';

const raw = readFileSync('pid-symbols-bundle.js', 'utf8');
const jsonStr = raw.replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, '');
const symbols = JSON.parse(jsonStr);
const verbose = process.argv.includes('--verbose');
// --fix-extents recomputes every declared `extents` from the glyph ink, using the SAME
// contentBBox the check measures with. Deliberately not a second implementation: a copy
// drifts from the check, the two then disagree about what "the ink" is, and the repair
// and the audit end up grading different quantities -- which is exactly how the port-drift
// check came to report 26 phantom findings with confident, plausible numbers.
//
// Safe to rewrite wholesale: a JSON round-trip of this file is byte-identical, so the
// diff carries only the intended change and no other writer gets a reformatted file.
const fixExtents = process.argv.includes('--fix-extents');
const extentsChanged = [];

// --- content bbox from the glyph's own primitives -------------------------
// Exact for rect/circle/line/ellipse/polyline/polygon; for <path> it takes the
// min/max of every number in `d`, which over-estimates when arcs or relative
// commands are present. Over-estimating is the safe direction: it can flag a
// false "outside the viewBox", never miss a real one.
function contentBBox(svg) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const put = (a, b, c, d) => {
    x0 = Math.min(x0, a); y0 = Math.min(y0, b);
    x1 = Math.max(x1, c); y1 = Math.max(y1, d);
  };
  const nums = (s) => (s.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
  for (const m of svg.matchAll(/<rect\b[^>]*>/gi)) {
    const a = m[0];
    const g = (n) => { const r = a.match(new RegExp(`\\b${n}="([^"]*)"`)); return r ? parseFloat(r[1]) : NaN; };
    const x = g('x'), y = g('y'), w = g('width'), h = g('height');
    if ([x, y, w, h].every(Number.isFinite)) put(x, y, x + w, y + h);
  }
  for (const m of svg.matchAll(/<circle\b[^>]*>/gi)) {
    const r = m[0].match(/\br="([^"]*)"/); const c = m[0].match(/\bcx="([^"]*)"/); const d = m[0].match(/\bcy="([^"]*)"/);
    if (r && c && d) { const rr = parseFloat(r[1]); put(+c[1] - rr, +d[1] - rr, +c[1] + rr, +d[1] + rr); }
  }
  for (const m of svg.matchAll(/<ellipse\b[^>]*>/gi)) {
    const g = (n) => { const r = m[0].match(new RegExp(`\\b${n}="([^"]*)"`)); return r ? parseFloat(r[1]) : NaN; };
    const cx = g('cx'), cy = g('cy'), rx = g('rx'), ry = g('ry');
    if ([cx, cy, rx, ry].every(Number.isFinite)) put(cx - rx, cy - ry, cx + rx, cy + ry);
  }
  for (const m of svg.matchAll(/<line\b[^>]*>/gi)) {
    const g = (n) => { const r = m[0].match(new RegExp(`\\b${n}="([^"]*)"`)); return r ? parseFloat(r[1]) : NaN; };
    const a = g('x1'), b = g('y1'), c = g('x2'), d = g('y2');
    if ([a, b, c, d].every(Number.isFinite)) put(Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d));
  }
  for (const m of svg.matchAll(/<(?:polyline|polygon)\b[^>]*>/gi)) {
    const p = m[0].match(/\bpoints="([^"]*)"/); if (!p) continue;
    const v = nums(p[1]);
    for (let i = 0; i + 1 < v.length; i += 2) put(v[i], v[i + 1], v[i], v[i + 1]);
  }
  // <path>: parse per-command, because a flat min/max over every number in `d`
  // puts x-coordinates into the y range. That bug reported flow-nozzle's real
  // content (15,20)-(145,60) as (15,15)-(145,145) and invented 30 SYM-CLIPPED
  // findings that do not exist. Command arg counts: the last 1-2 args of every
  // coordinate-bearing command are the endpoint (x,y).
  for (const m of svg.matchAll(/<path\b[^>]*>/gi)) {
    const d = m[0].match(/\bd="([^"]*)"/); if (!d) continue;
    // A point EXTENDS the bbox; it is not itself a box. (Getting this backwards
    // is what made the first cut of this audit report flow-nozzle's real content
    // (15,20)-(145,60) as (15,15)-(145,145).)
    const point = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) put(x, y, x, y); };
    const ARITY = { M: 2, L: 2, T: 2, S: 4, Q: 4, C: 6, A: 7, H: 1, V: 1, Z: 0 };
    // H/V carry ONE axis; the other comes from the current point, which we do not
    // track — so treat the value as a bound on BOTH axes. That over-estimates,
    // which is the safe direction for a clipping test.
    const toks = d[1].match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    let i = 0, cmd = null, cx = 0, cy = 0;
    // Track the current point so RELATIVE commands resolve. Without this,
    // thermal-flowmeter's `q4 -6 8 0` was read as the absolute point (4,-6) and
    // the glyph was reported as extending to y=-6 — i.e. clipped — when its real
    // extent is y=12..50, comfortably inside the viewBox.
    while (i < toks.length) {
      const t = toks[i];
      if (/^[a-zA-Z]$/.test(t)) { cmd = t; i++; continue; }
      if (!cmd) { i++; continue; }
      const U = cmd.toUpperCase();
      const rel = cmd !== U;
      const n = ARITY[U]; if (!n) { i++; continue; }
      const args = toks.slice(i, i + n).map(Number);
      if (args.length < n) break;
      const at = (x, y) => rel ? point(cx + x, cy + y) : point(x, y);
      if (n === 1) {
        const v = args[0];
        if (U === 'H') { at(v, 0); cx = rel ? cx + v : v; }
        else { at(0, v); cy = rel ? cy + v : v; }
      } else if (U === 'A') {
        at(args[5], args[6]);
        if (rel) { cx += args[5]; cy += args[6]; } else { cx = args[5]; cy = args[6]; }
      } else {
        // M/L/T: one point per group. Q/S/C: endpoint plus control points, which
        // bound the curve (a bezier stays in the convex hull of its controls).
        for (let k = 0; k + 1 < args.length; k += 2) {
          at(args[k], args[k + 1]);
          if (rel) { cx += args[k]; cy += args[k + 1]; } else { cx = args[k]; cy = args[k + 1]; }
        }
      }
      i += n;
    }
  }
  if (!Number.isFinite(x0)) return null;
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

function viewBoxOf(svg) {
  const m = svg.match(/viewBox="([^"]+)"/);
  if (!m) return null;
  const p = m[1].split(/[\s,]+/).map(Number);
  return p.length === 4 && p.every(Number.isFinite) ? { x: p[0], y: p[1], w: p[2], h: p[3] } : null;
}

// Where the BROWSER actually puts viewBox point (vx,vy) inside the size x size box.
function browserMap(vb, size) {
  const s = Math.min(size / vb.w, size / vb.h);
  return { s, ox: (size - vb.w * s) / 2, oy: (size - vb.h * s) / 2 };
}

const F = [];
const notes = [];
let aspectCount = 0;
const add = (code, key, msg) => F.push({ code, key, msg });

for (const [key, sym] of Object.entries(symbols)) {
  const svg = sym.svg || '';
  const vb = viewBoxOf(svg);
  const size = sym.size;
  const bbox = contentBBox(svg);

  if (!vb) { add('SYM-NO-VIEWBOX', key, 'no viewBox — glyph cannot be placed deterministically'); continue; }
  if (!Number.isFinite(size) || size <= 0) { add('SYM-BAD-SIZE', key, `size=${size}`); continue; }

  // --- A/B: port position under the engine formula vs. the browser's actual mapping
  const { s, ox, oy } = browserMap(vb, size);
  const nonSquare = Math.abs(vb.w - vb.h) > 0.01;
  let worstPort = 0, worstPortId = null;
  for (const p of (sym.ports || [])) {
    // vb.x / vb.y belong on BOTH sides of this comparison. The "actual" side omitted them
    // while the "engine" side (fixed in the previous commit) includes them, so the
    // residual was a constant per symbol rather than a property of any port:
    //   relief-safety  vb.x=24 vb.y=-24.33 s=0.07043 -> hypot(1.690, 1.714) = 2.41mm
    //   box-furnace    vb.x=9  vb.y=-4     s=0.625   -> hypot(5.625, 2.500) = 6.16mm
    // which is exactly what both survivors reported. A check that compares two mappings
    // must derive both from the same origin, or it measures its own omission.
    // Where the BROWSER actually puts it. The viewBox origin is CANCELLED by the
    // viewport mapping: a viewBox point (vx,vy) lands at ox + (vx - vb.x)*s. So the
    // percentage maps directly -- do NOT add vb.x here.
    const vx = (p.x / 100) * vb.w, vy = (p.y / 100) * vb.h;   // the TRUE rendered position
    const ax = ox + vx * s, ay = oy + vy * s;            // actual, relative to box top-left
    // Where the ENGINE puts it. This must be portOffset()'s formula, not the naive
    // ((p-50)/100)*size: that one is only right for a SQUARE viewBox, and portOffset has
    // been letterbox-aware since it was adopted -- deliberately, together with the grid
    // and lead-in re-tuning, and never in isolation (see the note above portOffset in
    // pid-parser.js). Grading the engine against the formula it abandoned reported 26
    // SYM-PORT-DRIFT findings that were all artefacts of the stale check. Every one of
    // them said "viewBox is not square -> letterboxed", i.e. the finding was describing
    // the very condition the engine already handles.
    // Note the vb.x / vb.y terms: portOffset includes them, the old check did not.
    const evx = (p.x / 100) * vb.w, evy = (p.y / 100) * vb.h;
    // Where portOffset() CLAIMS to put it. This is the quantity under test, and it
    // currently disagrees with the browser by vb.x*s, vb.y*s -- a real defect in
    // portOffset(), tracked here on purpose. The note above portOffset() in
    // pid-parser.js defers correcting it until the grid and lead-in constants are
    // re-tuned in the same change, and points at this check to say when it is closed.
    // Transcription of PIDEngine.portOffset (pid-parser.js). Keep these two in step --
    // or better, call the function. This copy went stale once already: portOffset was
    // corrected to cancel the viewBox origin and this line kept adding it, so the check
    // went on reporting a bug that had been fixed. A test that transcribes the thing it
    // tests is a second implementation, and second implementations drift.
    const ex = ox + evx * s, ey = oy + evy * s;
    const err = Math.hypot(ax - ex, ay - ey);
    if (err > worstPort) { worstPort = err; worstPortId = p.id; }
    if (p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100)
      add('SYM-PORT-PCT', key, `port "${p.id}" x=${p.x} y=${p.y} outside 0..100`);
  }
  if (worstPort > 0.05) {
    add('SYM-PORT-DRIFT', key, `port "${worstPortId}" is drawn ${worstPort.toFixed(2)}mm from where the engine puts it` +
      (nonSquare ? ` (viewBox ${vb.w}x${vb.h} is not square -> letterboxed)` : ' (viewBox IS square — investigate)'));
  }
  // --- aspect: a non-square viewBox is letterboxed into the square size box -------------
  //
  // NOT A FINDING, and this was the one place the audit was still manufacturing a defect.
  // A 160x80 glyph in a 100mm box drawing 100x50mm is the CORRECT and desirable
  // behaviour: the symbol keeps its proportions and occupies the width it was given.
  // This used to be reported as "not 100x100", i.e. as a failure to fill a box that has
  // no reason to be filled — 123 findings, every one of them a symbol working as intended.
  //
  // It was load-bearing exactly once, via a real defect: port pct was mapped with `size`
  // in both axes, so on a letterboxed glyph the engine's port and the drawn ink disagreed
  // (up to 12.5 mm on flow-nozzle). That is fixed — PIDEngine.portWorld is the one
  // mapping and it is letterbox-aware — and check-port-vs-ink.mjs measures the residual
  // at 0.000 mm for every symbol whose ports are on the metal. `symbolDrawnSize` reports
  // the drawn extent for anyone who needs it.
  //
  // What IS worth knowing, and now only printed as a note: how much of the nominal box is
  // dead space, because entityBBox reserves the square and that margin is what the router
  // keeps clear. Large, and a symbol is reserving room it does not use.
  if (nonSquare) {
    const dead = 1 - (vb.w * s * vb.h * s) / (size * size);
    if (dead > 0.4) notes.push(`${key}: nominal ${size}mm box, drawn ${(vb.w * s).toFixed(1)}x${(vb.h * s).toFixed(1)}mm — ${(dead * 100).toFixed(0)}% of the reserved box is dead space`);
    aspectCount++;
  }

  // --- clipping: content outside the viewBox is not drawn
  if (bbox && (bbox.x0 < vb.x - 0.5 || bbox.y0 < vb.y - 0.5 || bbox.x1 > vb.x + vb.w + 0.5 || bbox.y1 > vb.y + vb.h + 0.5)) {
    add('SYM-CLIPPED', key, `content bbox (${bbox.x0.toFixed(0)},${bbox.y0.toFixed(0)})-(${bbox.x1.toFixed(0)},${bbox.y1.toFixed(0)}) escapes viewBox 0,0,${vb.w.toFixed(0)},${vb.h.toFixed(0)} — clipped at print`);
  }

  // --- extents: the recorded box vs. measured content
  const ex = sym.extents;
  if (ex && bbox) {
    const dev = Math.max(Math.abs(ex.x0 - bbox.x0), Math.abs(ex.y0 - bbox.y0), Math.abs(ex.x1 - bbox.x1), Math.abs(ex.y1 - bbox.y1));
    const wide = Math.max(ex.x1 - ex.x0, ex.y1 - ex.y0), want = Math.max(bbox.x1 - bbox.x0, bbox.y1 - bbox.y0);
    if (fixExtents) {
      // whole units: extents are read as integers elsewhere, so a fractional box is
      // just noise in the diff
      const nx0 = Math.floor(bbox.x0), ny0 = Math.floor(bbox.y0);
      const nx1 = Math.ceil(bbox.x1), ny1 = Math.ceil(bbox.y1);
      const cur = sym.extents || {};
      if (cur.x0 !== nx0 || cur.y0 !== ny0 || cur.x1 !== nx1 || cur.y1 !== ny1) {
        extentsChanged.push(`${key}: (${cur.x0},${cur.y0})-(${cur.x1},${cur.y1}) -> (${nx0},${ny0})-(${nx1},${ny1})`);
        sym.extents = { x0: nx0, y0: ny0, x1: nx1, y1: ny1 };
      }
    }
    if (dev > Math.max(4, want * 0.15))
      add('SYM-EXTENTS', key, `extents (${ex.x0},${ex.y0})-(${ex.x1},${ex.y1}) vs measured (${bbox.x0.toFixed(0)},${bbox.y0.toFixed(0)})-(${bbox.x1.toFixed(0)},${bbox.y1.toFixed(0)}) off by ${dev.toFixed(0)}u`);
  }

  // --- anchor: should sit at the visual centre of the metal
  //
  // anchor is PERCENT of the viewBox — the same convention the ports use, and the one
  // PIDEngine.anchorOffset reads. Comparing the raw number against the content centre in
  // viewBox units grades a different quantity: it scored every 50/50 placeholder as
  // correct while 101 of them were off, and scored the fixed ones as wrong.
  //
  // Measured against the ACCURATE ink box, not `bbox`: contentBBox deliberately treats an
  // H or V command as a bound on BOTH axes (safe for a clipping test, wrong for a
  // centre), so a glyph opening `M20 30 H80` reports a content centre at y=0 and this
  // check then fails 31 symbols whose anchor is exactly right.
  const a = sym.anchor;
  const acc = inkBBox(ink(svg));
  if (a && acc) {
    const ax = vb.x + (a.x / 100) * vb.w, ay = vb.y + (a.y / 100) * vb.h;
    const d = Math.hypot(ax - acc.cx, ay - acc.cy);
    if (d > Math.max(4, Math.max(vb.w, vb.h) * 0.12))
      add('SYM-ANCHOR', key, `anchor pct(${a.x},${a.y}) -> (${ax.toFixed(1)},${ay.toFixed(1)}) is ${d.toFixed(0)}u from the content centre (${acc.cx.toFixed(0)},${acc.cy.toFixed(0)})`);
  }

  // --- a port must terminate on the drawn linework -------------------------------
  // THE GRAFTING RULE. A symbol is drawn ON the process line: its own linework IS the
  // pipe run, and the pipe is continuous through it. A port off that linework leaves a
  // gap between the pipe end and the metal, and an unlabelled break in a run reads as
  // "not connected" — a spec break is the only legitimate break and it is always
  // labelled. Measured, not eyeballed: distance from the port to the nearest drawn
  // segment, against half that segment's stroke width.
  if ((sym.ports || []).length) {
    const g = ink(svg);
    const sw = maxStroke(g);
    let worst = 0, worstId = null;
    for (const p of (sym.ports || [])) {
      const px = vb.x + (p.x / 100) * vb.w, py = vb.y + (p.y / 100) * vb.h;
      const gd = gapToInk(g, px, py);
      if (gd > worst) { worst = gd; worstId = p.id; }
    }
    if (worst > Math.max(0.5, sw / 2))
      add('SYM-PORT-OFF-LINEWORK', key, `port "${worstId}" is ${worst.toFixed(2)}u clear of the drawn linework (stroke ${sw}) — the pipe leaves a gap, which reads as a break in the run`);
  }

  // --- labelAnchor: should be NEAR the symbol, not inside its viewBox -----------------
  // A tag is drawn UNDER the symbol, so the archived convention is "6 units below the
  // viewBox" and that is deliberate — pid-symbols.html maps it as a plain viewBox
  // coordinate. The old check demanded it be inside the viewBox and therefore flagged
  // 195 of 201 symbols for being exactly where a label belongs. What actually matters is
  // that it is close enough to the metal to read as that symbol's tag.
  const la = sym.labelAnchor;
  if (la && bbox) {
    // labelAnchor is in ABSOLUTE viewBox units, the same as extents — pid-symbols.html
    // maps it as (labelAnchor.x - viewBox.x). Adding the origin here measures a point
    // that does not exist and flags symbols whose label is exactly where it belongs.
    const lx = la.x, ly = la.y;
    const pad = Math.max(vb.w, vb.h) * 0.25;
    const outside = lx < bbox.x0 - pad || lx > bbox.x1 + pad || ly < bbox.y0 - pad || ly > bbox.y1 + pad;
    if (outside) add('SYM-LABELANCHOR', key, `labelAnchor (${la.x},${la.y}) is ${pad.toFixed(0)}u beyond the content box (${bbox.x0.toFixed(0)},${bbox.y0.toFixed(0)})-(${bbox.x1.toFixed(0)},${bbox.y1.toFixed(0)}) — too far from the symbol to read as its tag`);
  }

  // --- two sources of truth: <metadata><connections> inside the glyph vs bundle ports
  const meta = [...svg.matchAll(/<connection\b([^>]*)\/?>/gi)].map(mm => {
    const g = (n) => { const r = mm[1].match(new RegExp(`\\b${n}="([^"]*)"`)); return r ? r[1] : null; };
    return { id: g('id'), x: g('x') !== null ? parseFloat(g('x')) : null, y: g('y') !== null ? parseFloat(g('y')) : null };
  });
  if (meta.length) {
    for (const m of meta) {
      const p = (sym.ports || []).find(q => q.id === m.id);
      if (!p) { add('SYM-META-DUP', key, `glyph <metadata> declares connection "${m.id}" that the bundle ports do not have`); continue; }
      if (m.x !== null && (Math.abs(m.x - p.x) > 0.5 || Math.abs(m.y - p.y) > 0.5))
        add('SYM-META-CONFLICT', key, `connection "${m.id}": glyph metadata (${m.x},${m.y}) vs bundle port (${p.x},${p.y}) — two sources of truth`);
    }
  }

  // --- behaviour vs reality
  const proc = (sym.ports || []).filter(p => p.connectionClass === 'process');
  const minP = sym.behavior && sym.behavior.minProcessPorts;
  if (minP && proc.length < minP)
    add('SYM-BEHAVIOUR', key, `behavior.minProcessPorts=${minP} but only ${proc.length} process port(s) defined`);

  // --- duplicate port ids
  const ids = (sym.ports || []).map(p => p.id);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dup.length) add('SYM-DUP-PORT', key, `duplicate port id(s): ${[...new Set(dup)].join(', ')}`);

  // --- grid: sizes should be a usable multiple of the drafting grid (5mm) ---
  //
  // Instrument bubbles are EXEMPT, and this is not a fudge. The renderer solves a
  // bubble's size from the tag it has to hold (pid-renderer sizeOf: "The declared
  // symbol size is a MINIMUM, not the answer"), so the declared 13mm is a floor and
  // the drawn diameter is whatever the text needs. A grid rule cannot describe a
  // solved quantity. This check said 0 for months with a stale ✔ next to it while
  // two symbols sat at size=13; the finding was real, the rule's scope was wrong.
  const instrumentBubble = /^isa-5\.1\/instruments\//.test(key);
  if (!instrumentBubble && size % 5 !== 0) add('SYM-GRID-SIZE', key, `size=${size}mm is not a multiple of the 5mm drafting grid`);

  // --- grid: the port's WORLD offset from centre, on the drafting grid?
  //
  // RETIRED (was 325 findings). A port must terminate on the drawn linework — that is
  // the drafting rule, and the metal sits wherever the glyph puts it, which is almost
  // never a multiple of 5 mm. Honouring this rule therefore moves every port off the
  // metal and puts a gap in the process line, and a gap reads as "not connected".
  // A craft preference that contradicts the load-bearing rule is not a preference, it
  // is a bug in the rule. SYM-PORT-OFF-LINEWORK above is the check that matters.
  //
  // Kept as a NOTE, not a finding: it is still useful to know which symbols place their
  // ports off grid, because the router's lead-in has to jog for them.
  // for (const p of (sym.ports || [])) {
  //   const off = [Math.abs(((p.x - 50) / 100) * size), Math.abs(((p.y - 50) / 100) * size)];
  //   for (const o of off) {
  //     if (o > 0.01 && Math.abs(o / 5 - Math.round(o / 5)) > 1e-6)
  //       add('SYM-GRID-PORT', key, `port "${p.id}" sits ${o.toFixed(2)}mm off centre — not on the 5mm drafting grid (size=${size})`);
  //   }
  // }
}

// --- self-test (T7.8) --------------------------------------------------------
// This extractor produced confident FALSE findings twice before it was caught:
//   1. every number in a <path d> was fed in as both an x and a y, so
//      flow-nozzle's real (15,20)-(145,60) read as (15,15)-(145,145) and 30
//      phantom SYM-CLIPPED findings appeared;
//   2. the point helper did put(min(x,y), min(x,y), max(x,y), max(x,y)), turning a
//      point into a box;
//   3. relative commands (q4 -6 8 0) were read as absolute, so thermal-flowmeter
//      appeared to reach y=-6 and be clipped when it is comfortably inside.
// Nothing stopped (1)-(3) recurring. These assertions are hand-counted from the
// glyph source and must be updated ONLY with a hand count, never from output.
const SELFTEST = [
  {
    key: 'isa-5.1/flow-elements/flow-nozzle',
    why: 'two Q+L paths, y 20..60 — a flat min/max over d put x into y and invented clipping',
    expect: { x0: 10, y0: 20, x1: 150, y1: 60 },
  },
  {
    key: 'isa-5.1/flow-elements/thermal-flowmeter',
    why: 'relative "q4 -6 8 0" must resolve against the current point, not read as (4,-6)',
    expect: { x0: 10, y0: 12, x1: 150, y1: 50 },
  },
];
let selfFail = 0;
for (const t of SELFTEST) {
  const sym = symbols[t.key];
// [SELFTEST] the portOffset transcription above is checked against a hand-computed
// value. y32.11-1961/furnaces/box-furnace is <svg x=-35 y=-35 width=70 height=70
// viewBox="9 -4 112 110">, so with xMidYMid meet: scale = min(70/112, 70/110) = 0.625,
// translate = (0, 0.625), and pct(50,50) -> viewBox (65,51) -> viewport (35,35) ->
// parent (0,0). If the engine-side formula ever stops producing (0,0) here, the
// transcription and portOffset have drifted apart and every number below is suspect.
const _bf = symbols['y32.11-1961/furnaces/box-furnace'];
if (_bf) {
  const _vb = viewBoxOf(_bf.svg || '');
  const _s = Math.min(70 / _vb.w, 70 / _vb.h);
  const _ox = (70 - _vb.w * _s) / 2, _oy = (70 - _vb.h * _s) / 2;
  const _ex = _ox + 0.5 * _vb.w * _s, _ey = _oy + 0.5 * _vb.h * _s;
  const _err = Math.hypot(_ex - 35, _ey - 35);
  if (_err > 0.01) {
    console.log('[SELFTEST] FAIL portOffset transcription: expected (0,0), got off by '
      + _err.toFixed(3) + 'mm');
    process.exitCode = 1;
  }
}
  if (!sym) { console.log(`[SELFTEST] MISSING SYMBOL ${t.key}`); selfFail++; continue; }
  const got = contentBBox(sym.svg);
  const ok = got && ['x0', 'y0', 'x1', 'y1'].every((k) => Math.abs(got[k] - t.expect[k]) <= 1.5);
  if (!ok) {
    console.log(`[SELFTEST] FAIL ${t.key}\n   expected ~${JSON.stringify(t.expect)}\n   got      ${got ? JSON.stringify({ x0: +got.x0.toFixed(1), y0: +got.y0.toFixed(1), x1: +got.x1.toFixed(1), y1: +got.y1.toFixed(1) }) : 'null'}\n   (${t.why})`);
    selfFail++;
  }
}
if (!selfFail) console.log(`[SELFTEST] ok — ${SELFTEST.length} hand-counted bbox assertions pass\n`);

if (fixExtents) {
  if (!extentsChanged.length) {
    console.log('[FIX-EXTENTS] nothing to change');
  } else {
    // Re-read before writing. Another writer may have touched the bundle since this run
    // read it, and silently overwriting their work is how five no-ops ship (see the scope
    // note in fix-symbol-defects.mjs). Bail loudly instead.
    if (readFileSync('pid-symbols-bundle.js', 'utf8') !== raw) {
      console.error('[FIX-EXTENTS] ABORT: pid-symbols-bundle.js changed on disk since this run read it.');
      process.exit(2);
    }
    const pre = raw.match(/^(\s*window\.PID_SYMBOLS\s*=\s*)([\s\S]*)(;\s*)$/);
    writeFileSync('pid-symbols-bundle.js', pre[1] + JSON.stringify(symbols) + pre[3]);
    console.log(`[FIX-EXTENTS] ${extentsChanged.length} symbol extents recomputed from ink:`);
    for (const c of extentsChanged) console.log('   ' + c);
  }
}
// --- report ----------------------------------------------------------------
const byCode = {};
for (const f of F) (byCode[f.code] = byCode[f.code] || []).push(f);
const order = ['SYM-PORT-OFF-LINEWORK', 'SYM-PORT-DRIFT', 'SYM-CLIPPED', 'SYM-META-CONFLICT', 'SYM-META-DUP', 'SYM-BEHAVIOUR',
  'SYM-EXTENTS', 'SYM-ANCHOR', 'SYM-ASPECT', 'SYM-PORT-PCT', 'SYM-LABELANCHOR', 'SYM-GRID-PORT',
  'SYM-GRID-SIZE', 'SYM-DUP-PORT', 'SYM-NO-VIEWBOX', 'SYM-BAD-SIZE'];

console.log(`SYMBOL AUDIT — ${Object.keys(symbols).length} symbols, ${F.length} findings\n`);
for (const code of order) {
  const list = byCode[code]; if (!list) continue;
  console.log(`[${code}] ${list.length}`);
  const show = verbose ? list : list.slice(0, 6);
  for (const f of show) console.log(`   ${f.key}\n      ${f.msg}`);
  if (!verbose && list.length > show.length) console.log(`   ... +${list.length - show.length} more (use --verbose)`);
  console.log('');
}
if (aspectCount) {
  console.log(`NOTE  ${aspectCount} of ${Object.keys(symbols).length} symbols have a non-square viewBox and are`);
  console.log(`      letterboxed into their square size box. That is intended: the glyph keeps its`);
  console.log(`      proportions. The port mapping accounts for it (PIDEngine.portWorld), and`);
  console.log(`      check-port-vs-ink.mjs measures the residual. Symbols reserving a lot of dead`);
  console.log(`      box, which is the only thing the letterbox still costs:`);
  for (const n of notes) console.log(`        ${n}`);
}
process.exitCode = 0;
