// Fix symbols where ports sit on an outer circle instead of the flow line.
//
// Some ISA measurement symbols draw a circle (the instrument body) with a short
// horizontal stub inside it (the flow path), and the port was authored on the circle
// circumference rather than the stub's end. The pipe then meets the circle and the stub
// dangles inside the symbol — a gap that reads as a break.
//
// Rule: for a port that is on a circle but NOT on any line segment, move it to the
// nearest endpoint of the nearest line segment along its arrival direction.
import { readFileSync, writeFileSync } from 'node:fs';
import { vbOf, ink, inkBBox, gapToInk } from './symbol-ink.mjs';
const maxStroke = (g) => { let m = 1; for (const [, , , , s] of g.segs) if (Number.isFinite(s) && s > m) m = s; return m; };

const FILE = 'pid-symbols-bundle.js';
const raw = readFileSync(FILE, 'utf8');
const symbols = JSON.parse(raw.replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, ''));

const r3 = (n) => { const v = Math.round(n * 1000) / 1000; return Object.is(v, -0) ? 0 : v; };

const fixes = [];
for (const [key, sym] of Object.entries(symbols)) {
  const svg = sym.svg || '';
  const vb = vbOf(svg);
  const g = ink(svg);
  if (!vb || !g.segs.length || !g.circles.length) continue;

  // line segments only (not circle chords)
  const lines = g.segs.filter((s) => {
    // a segment is "a line" if it's an actual <line> element; we approximate by checking
    // it's not part of a rect/circle. Simpler: use all segs, but prefer non-circular endpoints.
    return true;
  });

  for (const p of (sym.ports || [])) {
    const X = vb.x + (p.x / 100) * vb.w, Y = vb.y + (p.y / 100) * vb.h;
    // is the port on a circle?
    let onCircle = false, circleGap = Infinity;
    for (const [cx, cy, r] of g.circles) {
      const d = Math.abs(Math.hypot(X - cx, Y - cy) - r);
      if (d < circleGap) circleGap = d;
      if (d <= Math.max(0.5, r * 0.02)) onCircle = true;
    }
    // is it on a line segment?
    let lineGap = Infinity, nearestLineEnd = null;
    for (const [x1, y1, x2, y2] of lines) {
      const L = Math.hypot(x2 - x1, y2 - y1);
      const dx = x2 - x1, dy = y2 - y1;
      let t = L ? ((X - x1) * dx + (Y - y1) * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(X - (x1 + t * dx), Y - (y1 + t * dy));
      if (d < lineGap) {
        lineGap = d;
        // nearest endpoint of this segment
        const d1 = Math.hypot(X - x1, Y - y1), d2 = Math.hypot(X - x2, Y - y2);
        nearestLineEnd = d1 < d2 ? [x1, y1] : [x2, y2];
      }
    }

    // port on circle but NOT on a line → move to nearest line endpoint
    if (onCircle && lineGap > Math.max(0.5, maxStroke(g) / 2) && nearestLineEnd) {
      const nx = nearestLineEnd[0], ny = nearestLineEnd[1];
      const pctX = ((nx - vb.x) / vb.w) * 100, pctY = ((ny - vb.y) / vb.h) * 100;
      fixes.push({ key, id: p.id, from: [p.x, p.y], to: [pctX, pctY], fromU: [X, Y], toU: [nx, ny], lineGap, circleGap });
    }
  }
}

console.log('circle-on-line fixes:', fixes.length);
for (const f of fixes) console.log('  ' + f.key.padEnd(46) + ' ' + String(f.id).padEnd(12) + ' pct (' + f.from[0] + ',' + f.from[1] + ') -> (' + r3(f.to[0]) + ',' + r3(f.to[1]) + ')  units (' + f.fromU[0].toFixed(1) + ',' + f.fromU[1].toFixed(1) + ') -> (' + f.toU[0].toFixed(1) + ',' + f.toU[1].toFixed(1) + ')');

if (!process.argv.includes('--write')) { console.log('\ndry run — pass --write to apply'); process.exit(0); }

// apply
let out = raw;
for (const f of fixes) {
  const kStart = out.indexOf('"' + f.key + '":{');
  if (kStart < 0) throw new Error('symbol not found: ' + f.key);
  let i = out.indexOf('{', kStart), depth = 0, end = -1;
  for (let j = i; j < out.length; j++) {
    const c = out[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) { end = j + 1; break; } }
  }
  if (end < 0) throw new Error('unbalanced JSON for ' + f.key);
  let block = out.slice(kStart, end);
  const pid = '"id":"' + f.id + '"';
  const pAt = block.indexOf(pid);
  if (pAt < 0) throw new Error('port ' + f.id + ' not found in ' + f.key);
  let oStart = block.lastIndexOf('{', pAt), od = 0, oEnd = -1;
  for (let j = oStart; j < block.length; j++) {
    const c = block[j];
    if (c === '{') od++;
    else if (c === '}') { od--; if (!od) { oEnd = j + 1; break; } }
  }
  if (oEnd < 0) throw new Error('unbalanced port object for ' + f.key + '/' + f.id);
  const portObj = block.slice(oStart, oEnd);
  const next = portObj.replace(/"x":\s*-?[\d.]+/, '"x":' + r3(f.to[0])).replace(/"y":\s*-?[\d.]+/, '"y":' + r3(f.to[1]));
  if (next === portObj) throw new Error('could not rewrite x/y for ' + f.key + '/' + f.id);
  block = block.slice(0, oStart) + next + block.slice(oEnd);
  out = out.slice(0, kStart) + block + out.slice(end);
}
writeFileSync(FILE, out);
console.log('\n[WRITE] ' + fixes.length + ' port(s) moved from circle to flow line.');
process.exit(0);
