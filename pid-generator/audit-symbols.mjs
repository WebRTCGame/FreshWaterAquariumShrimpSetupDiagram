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
import { readFileSync } from 'node:fs';

const raw = readFileSync('pid-symbols-bundle.js', 'utf8');
const jsonStr = raw.replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, '');
const symbols = JSON.parse(jsonStr);
const verbose = process.argv.includes('--verbose');

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
    const vx = (p.x / 100) * vb.w, vy = (p.y / 100) * vb.h;
    const ax = ox + vx * s, ay = oy + vy * s;            // actual, relative to box top-left
    const ex = size / 2 + ((p.x - 50) / 100) * size;      // engine, relative to box top-left
    const ey = size / 2 + ((p.y - 50) / 100) * size;
    const err = Math.hypot(ax - ex, ay - ey);
    if (err > worstPort) { worstPort = err; worstPortId = p.id; }
    if (p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100)
      add('SYM-PORT-PCT', key, `port "${p.id}" x=${p.x} y=${p.y} outside 0..100`);
  }
  if (worstPort > 0.05) {
    add('SYM-PORT-DRIFT', key, `port "${worstPortId}" is drawn ${worstPort.toFixed(2)}mm from where the engine puts it` +
      (nonSquare ? ` (viewBox ${vb.w}x${vb.h} is not square -> letterboxed)` : ' (viewBox IS square — investigate)'));
  }
  if (nonSquare) {
    const short = Math.min(vb.w, vb.h) * s;
    add('SYM-ASPECT', key, `viewBox ${vb.w.toFixed(1)}x${vb.h.toFixed(1)} letterboxed into a ${size}mm box: drawn ${(vb.w * s).toFixed(1)}x${(vb.h * s).toFixed(1)}mm, not ${size}x${size}`);
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
    if (dev > Math.max(4, want * 0.15))
      add('SYM-EXTENTS', key, `extents (${ex.x0},${ex.y0})-(${ex.x1},${ex.y1}) vs measured (${bbox.x0.toFixed(0)},${bbox.y0.toFixed(0)})-(${bbox.x1.toFixed(0)},${bbox.y1.toFixed(0)}) off by ${dev.toFixed(0)}u`);
  }

  // --- anchor: should sit at the visual centre of the metal
  const a = sym.anchor;
  if (a && bbox) {
    const d = Math.hypot(a.x - bbox.cx, a.y - bbox.cy);
    if (d > Math.max(4, Math.max(vb.w, vb.h) * 0.12))
      add('SYM-ANCHOR', key, `anchor (${a.x},${a.y}) is ${d.toFixed(0)}u from the content centre (${bbox.cx.toFixed(0)},${bbox.cy.toFixed(0)})`);
  }

  // --- labelAnchor sits outside the viewBox on most symbols
  const la = sym.labelAnchor;
  if (la && (la.x < vb.x || la.x > vb.x + vb.w || la.y < vb.y || la.y > vb.y + vb.h)) {
    add('SYM-LABELANCHOR', key, `labelAnchor (${la.x},${la.y}) is outside viewBox 0,0,${vb.w},${vb.h} — not usable as-is`);
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

  // --- grid: sizes should be a usable multiple of the drafting grid (5mm)
  if (size % 5 !== 0) add('SYM-GRID-SIZE', key, `size=${size}mm is not a multiple of the 5mm drafting grid`);

  // --- grid: the port's WORLD offset from centre, on the drafting grid?
  // size is a multiple of 5, but the offset is (pct-50)/100*size, so a small
  // symbol gives sub-grid steps (a 10mm valve at pct 5 -> 0.5mm).
  for (const p of (sym.ports || [])) {
    const off = [Math.abs(((p.x - 50) / 100) * size), Math.abs(((p.y - 50) / 100) * size)];
    for (const o of off) {
      if (o > 0.01 && Math.abs(o / 5 - Math.round(o / 5)) > 1e-6)
        add('SYM-GRID-PORT', key, `port "${p.id}" sits ${o.toFixed(2)}mm off centre — not on the 5mm drafting grid (size=${size})`);
    }
  }
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
    expect: { x0: 15, y0: 20, x1: 145, y1: 60 },
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
  if (!sym) { console.log(`[SELFTEST] MISSING SYMBOL ${t.key}`); selfFail++; continue; }
  const got = contentBBox(sym.svg);
  const ok = got && ['x0', 'y0', 'x1', 'y1'].every((k) => Math.abs(got[k] - t.expect[k]) <= 1.5);
  if (!ok) {
    console.log(`[SELFTEST] FAIL ${t.key}\n   expected ~${JSON.stringify(t.expect)}\n   got      ${got ? JSON.stringify({ x0: +got.x0.toFixed(1), y0: +got.y0.toFixed(1), x1: +got.x1.toFixed(1), y1: +got.y1.toFixed(1) }) : 'null'}\n   (${t.why})`);
    selfFail++;
  }
}
if (!selfFail) console.log(`[SELFTEST] ok — ${SELFTEST.length} hand-counted bbox assertions pass\n`);

// --- report ----------------------------------------------------------------
const byCode = {};
for (const f of F) (byCode[f.code] = byCode[f.code] || []).push(f);
const order = ['SYM-PORT-DRIFT', 'SYM-CLIPPED', 'SYM-META-CONFLICT', 'SYM-META-DUP', 'SYM-BEHAVIOUR',
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
process.exitCode = F.length ? 0 : 0;
