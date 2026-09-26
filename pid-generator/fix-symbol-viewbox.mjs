// Fix SYM-CLIPPED: widen a symbol's viewBox so all of its content is drawn, and
// recompute each port's percentage so the port stays at the SAME ABSOLUTE position
// in viewBox units. That makes the transform geometry-neutral with respect to
// where the ports are — the only intended change is that the previously-clipped
// ink now renders.
//
// Verified against isa-5.1/valves/relief-safety: viewBox 0 0 100 116.667, content
// y -23.3..96.8, discharge port at pct (50,0) == the very top of the viewBox. The
// spring sat above y=0 and was never drawn — PSV-101 rendered as a bare triangle.
//
// Usage: node fix-symbol-viewbox.mjs          (dry run: reports, writes nothing)
//        node fix-symbol-viewbox.mjs --write  (apply)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// ---- T7.7: pid-symbols-bundle.js is now the SOURCE OF TRUTH for the symbol
// table (the .svg sources are archived, not live), so there is no second copy to
// drift from. The guard that used to live here compared against
// pid-backup-tmp.js — but that file only REFERENCES window.PID_SYMBOLS, it does
// not contain the table, so the comparison was dead code. restore-bundle.mjs has
// been retired with that written down.
//
// The real remaining risk is a future REVIVAL of a bundle-regenerating script. So
// instead of a comparison, this tool just re-verifies its own invariant after
// writing: no symbol may be left clipped, and the fix must be idempotent.
const BUNDLE = 'pid-symbols-bundle.js';
const APPLY = process.argv.includes('--write');
const raw = readFileSync(BUNDLE, 'utf8');
const head = raw.slice(0, raw.indexOf('=') + 1);
const map = JSON.parse(raw.slice(raw.indexOf('{'), raw.replace(/;\s*$/, '').length).trim().replace(/;$/, ''));

// ---- bbox: same extraction as audit-symbols.mjs (kept in sync deliberately) ----
function contentBBox(svg) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const put = (a, b, c, d) => { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); };
  const point = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) put(x, y, x, y); };
  const nums = (s) => (s.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
  for (const m of svg.matchAll(/<rect\b[^>]*>/gi)) {
    const g = (n) => { const r = m[0].match(new RegExp(`\\b${n}="([^"]*)"`)); return r ? parseFloat(r[1]) : NaN; };
    const x = g('x'), y = g('y'), w = g('width'), h = g('height');
    if ([x, y, w, h].every(Number.isFinite)) put(x, y, x + w, y + h);
  }
  for (const m of svg.matchAll(/<circle\b[^>]*>/gi)) {
    const g = (n) => { const r = m[0].match(new RegExp(`\\b${n}="([^"]*)"`)); return r ? parseFloat(r[1]) : NaN; };
    const cx = g('cx'), cy = g('cy'), r = g('r');
    if ([cx, cy, r].every(Number.isFinite)) put(cx - r, cy - r, cx + r, cy + r);
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
    for (let i = 0; i + 1 < v.length; i += 2) point(v[i], v[i + 1]);
  }
  for (const m of svg.matchAll(/<path\b[^>]*>/gi)) {
    const d = m[0].match(/\bd="([^"]*)"/); if (!d) continue;
    const ARITY = { M: 2, L: 2, T: 2, S: 4, Q: 4, C: 6, A: 7, H: 1, V: 1, Z: 0 };
    const toks = d[1].match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    let i = 0, cmd = null, cx = 0, cy = 0;
    while (i < toks.length) {
      const t = toks[i];
      if (/^[a-zA-Z]$/.test(t)) { cmd = t; i++; continue; }
      if (!cmd) { i++; continue; }
      const U = cmd.toUpperCase(), rel = cmd !== U, n = ARITY[U];
      if (!n) { i++; continue; }
      const args = toks.slice(i, i + n).map(Number);
      if (args.length < n) break;
      const at = (x, y) => { if (rel) point(cx + x, cy + y); else point(x, y); };
      if (n === 1) { const v = args[0]; if (U === 'H') { at(v, 0); cx = rel ? cx + v : v; } else { at(0, v); cy = rel ? cy + v : v; } }
      else if (U === 'A') { at(args[5], args[6]); if (rel) { cx += args[5]; cy += args[6]; } else { cx = args[5]; cy = args[6]; } }
      else for (let k = 0; k + 1 < args.length; k += 2) { at(args[k], args[k + 1]); if (rel) { cx += args[k]; cy += args[k + 1]; } else { cx = args[k]; cy = args[k + 1]; } }
      i += n;
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}
const viewBoxOf = (svg) => {
  const m = svg.match(/viewBox="([^"]+)"/); if (!m) return null;
  const p = m[1].split(/[\s,]+/).map(Number);
  return p.length === 4 && p.every(Number.isFinite) ? { x: p[0], y: p[1], w: p[2], h: p[3] } : null;
};

let fixed = 0;
for (const [key, sym] of Object.entries(map)) {
  const vb = viewBoxOf(sym.svg || ''); if (!vb) continue;
  const bb = contentBBox(sym.svg); if (!bb) continue;
  // Only act on GENUINE clipping. Content that merely touches the viewBox edge is
  // not clipped, and padding by a unit would flag all 67 of them — the dry run of
  // the first cut did exactly that, and also squeezed steam-trap's viewBox to the
  // metal so its ports (which sit OUTSIDE the body by design, to give lead-in
  // room) fell outside it at pct -46 / +146.
  const ESC = 0.5;
  const escaped = bb.x0 < vb.x - ESC || bb.y0 < vb.y - ESC || bb.x1 > vb.x + vb.w + ESC || bb.y1 > vb.y + vb.h + ESC;
  if (!escaped) continue;

  // The viewBox must contain the content AND every port. Record each port's
  // ABSOLUTE viewBox position first, so it can be restored afterwards.
  const before = (sym.ports || []).map(p => ({ p, ax: vb.x + (p.x / 100) * vb.w, ay: vb.y + (p.y / 100) * vb.h }));
  const need = { x0: bb.x0 - 1, y0: bb.y0 - 1, x1: bb.x1 + 1, y1: bb.y1 + 1 };
  for (const b of before) {
    need.x0 = Math.min(need.x0, b.ax - 1); need.x1 = Math.max(need.x1, b.ax + 1);
    need.y0 = Math.min(need.y0, b.ay - 1); need.y1 = Math.max(need.y1, b.ay + 1);
  }

  const nw = need.x1 - need.x0, nh = need.y1 - need.y0;
  for (const b of before) { b.p.x = +(((b.ax - need.x0) / nw) * 100).toFixed(4); b.p.y = +(((b.ay - need.y0) / nh) * 100).toFixed(4); }

  sym.svg = sym.svg.replace(/viewBox="[^"]+"/, `viewBox="${need.x0.toFixed(3)} ${need.y0.toFixed(3)} ${nw.toFixed(3)} ${nh.toFixed(3)}"`);
  if (sym.extents) sym.extents = { x0: +bb.x0.toFixed(1), y0: +bb.y0.toFixed(1), x1: +bb.x1.toFixed(1), y1: +bb.y1.toFixed(1) };
  fixed++;
  console.log(`${APPLY ? 'FIX ' : 'would fix'} ${key}`);
  console.log(`      viewBox 0 0 ${vb.w.toFixed(2)} ${vb.h.toFixed(2)}  ->  ${need.x0.toFixed(2)} ${need.y0.toFixed(2)} ${nw.toFixed(2)} ${nh.toFixed(2)}`);
  console.log(`      content (${bb.x0.toFixed(1)},${bb.y0.toFixed(1)})-(${bb.x1.toFixed(1)},${bb.y1.toFixed(1)})`);
  console.log(`      ports kept at absolute: ` + before.map(b => `${b.p.id} (${b.ax.toFixed(1)},${b.ay.toFixed(1)}) -> pct(${b.p.x},${b.p.y})`).join('  '));
}

// ---- T7.5: sync each glyph's embedded <metadata><connections> to the bundle ----
// Two symbols carry their own connection list inside the SVG, and those
// coordinates DISAGREE with the bundle's `ports` (which is what the engine
// actually reads). Inert at runtime, but it is a second answer to the same
// question, and a maintainer reading the glyph gets a different answer than the
// engine does. The bundle is authoritative, so sync the embedded copy to it.
let metaFixed = 0;
for (const [key, sym] of Object.entries(map)) {
  if (!/<connection\b/i.test(sym.svg || '')) continue;
  const before = (sym.svg.match(/<connection\b[^>]*\/?>/gi) || []).map(s => s.match(/id="([^"]*)"/)?.[1]);
  let svg = sym.svg;
  for (const p of (sym.ports || [])) {
    const re = new RegExp(`(<connection\\b[^>]*\\bid="${p.id}"[^>]*?\\bx=")([^"]*)("[^>]*?\\by=")([^"]*)(")`, 'i');
    if (!re.test(svg)) continue;
    svg = svg.replace(re, (all, a, ox, b, oy, c) => {
      const nx = p.x.toFixed(2), ny = p.y.toFixed(2);
      return (ox === nx && oy === ny) ? all : (a + nx + b + ny + c);
    });
  }
  if (svg !== sym.svg) { sym.svg = svg; metaFixed++; console.log(`${APPLY ? 'FIX ' : 'would fix'} ${key}: embedded <metadata> connections synced to bundle ports`); }
  void before;
}

console.log(`\n${fixed} symbol(s) ${APPLY ? 'fixed' : 'need fixing'}${APPLY ? '' : ' — rerun with --write'}`);
console.log(`${metaFixed} symbol(s) with embedded connection metadata ${APPLY ? 'synced' : 'need syncing'}`);
if (APPLY && (fixed || metaFixed)) {
  writeFileSync(BUNDLE, head + JSON.stringify(map) + ';\n');
  console.log('wrote ' + BUNDLE);
  // re-verify from the file just written, not from the in-memory map
  const after = JSON.parse((() => { const t = readFileSync(BUNDLE, 'utf8'); return t.slice(t.indexOf('{'), t.replace(/;\s*$/, '').length).trim().replace(/;$/, ''); })());
  let stillClipped = 0;
  for (const [k, v] of Object.entries(after)) {
    const vb = viewBoxOf(v.svg || ''); if (!vb) continue;
    const bb = contentBBox(v.svg); if (!bb) continue;
    if (bb.x0 < vb.x - 0.5 || bb.y0 < vb.y - 0.5 || bb.x1 > vb.x + vb.w + 0.5 || bb.y1 > vb.y + vb.h + 0.5) { stillClipped++; console.log(`   STILL CLIPPED: ${k}`); }
  }
  console.log(stillClipped ? `\nWARNING: ${stillClipped} symbol(s) still clipped — re-run and inspect.` : '\nverified: 0 symbols remain clipped.');
  console.log('NOTE: this bundle is the symbol source of truth. Do not introduce a script that');
  console.log('      regenerates it from elsewhere without mirroring these fixes (see the retired');
  console.log('      restore-bundle.mjs and T7.7).');
}
