// Does the ENGINE put the pipe where the metal is?
//
// Loads the real engine (pid-parser.js) in Node with a window shim, calls the real
// PIDEngine.connWorld for every port of every symbol, and compares against where the
// browser actually draws that glyph's ink through the same letterbox. This is the number
// that used to be 12.5 mm on flow-nozzle.
//
//   node check-port-vs-ink.mjs
import { readFileSync } from 'node:fs';
import { vbOf, ink, gapToInk } from './symbol-ink.mjs';

// ---- load the engine exactly as the browser does -----------------------------
const ROOT = 'D:/Programming Projects/FreshWaterAquariumShrimpSetupDiagram2/pid-generator/';
const window = {};
globalThis.window = globalThis;
const engineSrc = ['geometric_objects.js', 'pid-symbols-bundle.js', 'pid-rules.js', 'pid-textmetrics.js', 'pid-parser.js']
  .map((f) => readFileSync(ROOT + f, 'utf8')).join('\n;\n');
// PIDEngine is a module-scope `var`, so evaluate the concatenation and return it out of
// the same scope rather than looking for it on `window`.
const PIDEngine = new Function(engineSrc + '\n;return typeof PIDEngine !== "undefined" ? PIDEngine : null;')();
const SYMBOLS = globalThis.PID_SYMBOLS;
if (!PIDEngine) throw new Error('could not load PIDEngine');

let n = 0, dataBad = 0, engBad = 0;
const rows = [];
for (const [key, sym] of Object.entries(SYMBOLS)) {
  const vb = vbOf(sym.svg); if (!vb) continue;
  const size = sym.size;
  const ent = { x: 0, y: 0, symbol: key, rotation: 0, scale: 1 };
  const g = ink(sym.svg);
  for (const p of (sym.ports || [])) {
    const w = PIDEngine.connWorld(ent, p, size, { noNozzle: true, sc: 1 });
    // the same glyph, drawn by the browser: inner viewBox centred in a size x size box
    const s = Math.min(size / vb.w, size / vb.h);
    const ox = (size - vb.w * s) / 2, oy = (size - vb.h * s) / 2;
    const px = ox + (p.x / 100) * vb.w * s, py = oy + (p.y / 100) * vb.h * s;
    const gapData = gapToInk(g, vb.x + (p.x / 100) * vb.w, vb.y + (p.y / 100) * vb.h) * s;
    // the engine's answer, converted back into absolute viewBox coordinates. The origin
    // belongs on both sides of this comparison: omitting it measures a point that does not
    // exist on glyphs like box-furnace (viewBox "9 -4 112 110").
    const vx = vb.x + (w.x + size / 2 - ox) / s, vy = vb.y + (w.y + size / 2 - oy) / s;
    const gapEng = gapToInk(g, vx, vy) * s;
    n++;
    if (gapData > 0.05) dataBad++;
    if (gapEng > 0.05) engBad++;
    rows.push({ key, id: p.id, gapData, gapEng });
  }
}
rows.sort((a, b) => b.gapEng - a.gapEng);
console.log(`${n} port(s) across ${new Set(rows.map((r) => r.key)).size} symbol(s) — measured through the real PIDEngine.connWorld`);
console.log(`  data error  (declared pct vs its own linework) : ${dataBad} over 0.05mm, worst ${Math.max(...rows.map((r) => r.gapData)).toFixed(3)}mm`);
console.log(`  engine error(connWorld vs the drawn ink)       : ${engBad} over 0.05mm, worst ${Math.max(...rows.map((r) => r.gapEng)).toFixed(3)}mm`);
console.log(`\nworst 10 by engine error:`);
for (const r of rows.slice(0, 10))
  console.log(`  ${r.key.padEnd(46)} ${String(r.id).padEnd(12)} data ${r.gapData.toFixed(3)}mm  engine ${r.gapEng.toFixed(3)}mm`);
console.log(dataBad + engBad === 0 ? '\nCLEAN — the engine puts every pipe end on the metal it terminates on' : '');
