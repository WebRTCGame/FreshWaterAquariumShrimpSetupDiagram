// fix-symbol-behaviour.mjs — make the port list agree with the behaviour claim.
//
// Two halves of one inconsistency: `behavior.minProcessPorts` asserts a symbol can take N
// process connections while `ports` defines fewer. 27 symbols are in that state.
//
// VALVES (12) get the missing ports. A valve is an inline element: it has an inlet and an
// outlet on its flow axis, and every ISA sibling in the library already declares exactly
// that pair (isa-5.1/valves/gate: left (8.33,60), right (91.67,60)). These 12 are the same
// bowtie drawn in a different viewBox with the pair omitted, so completing them is not
// invention. Position comes from the glyph: the extreme metal on the flow axis, which for
// a bowtie is the midpoint of the body's side edge — the apex height, not the ink-bbox
// centre, because the stem reaches above it.
//
// EQUIPMENT (15) lose the claim. A nozzle position on a vessel is a design decision —
// where the vent goes, where the bottom outlet goes — and guessing one ships a number
// nobody chose. All 15 are also unreachable: nothing in SYMBOL_KEYS maps to them, so the
// claim is an assertion about a symbol no DSL statement can name. Same operation the repo
// already performed for 8 of these.
//
//   node fix-symbol-behaviour.mjs            dry run (default)
//   node fix-symbol-behaviour.mjs --write    apply, then re-verify from the written file
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { vbOf, ink, maxStroke } from './symbol-ink.mjs';

const FILE = 'pid-symbols-bundle.js';
const raw = readFileSync(FILE, 'utf8');
const symbols = JSON.parse(raw.replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, ''));

// reachability: a symbol the DSL cannot name cannot honour a claim about itself
const ROOT = dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis;
const engineSrc = ['geometric_objects.js', 'pid-symbols-bundle.js', 'pid-rules.js', 'pid-textmetrics.js', 'pid-parser.js']
  .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n;\n');
new Function(engineSrc + '\n;return typeof SYMBOL_KEYS !== "undefined" ? SYMBOL_KEYS : null;')();
const reachable = new Set(Object.values(globalThis.SYMBOL_KEYS || {}));

const PORT_SHAPE = (id, role, x, y) => ({
  id, ownerId: '', type: 'pipe', role, direction: null,
  connectionClass: 'process', connectionType: 'process', flowDirection: null,
  cardinality: 1, lead: 14, allowedTypes: null, x, y,
});

// the metal's extreme on the flow axis, for a glyph with no declared flowAxis
function axisExtremes(svg) {
  const g = ink(svg);
  const pts = [];
  for (const [x1, y1, x2, y2] of g.segs) {
    const L = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(L / 0.25));
    for (let k = 0; k <= n; k++) { const t = k / n; pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]); }
  }
  for (const [cx, cy, r] of g.circles) {
    const n = Math.max(8, Math.ceil((2 * Math.PI * r) / 0.25 / 4) * 4);
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  }
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const at = (x) => { const ys = pts.filter((p) => Math.abs(p[0] - x) < 0.5).map((p) => p[1]).sort((a, b) => a - b); return ys.length ? ys[Math.floor(ys.length / 2)] : null; };
  return { lo, hi, yLo: at(lo), yHi: at(hi) };
}

const r3 = (n) => { const v = Math.round(n * 1000) / 1000; return Object.is(v, -0) ? 0 : v; };
const addPorts = [];
const dropClaim = [];

for (const [key, sym] of Object.entries(symbols)) {
  const minP = sym.behavior && sym.behavior.minProcessPorts;
  if (!minP) continue;
  const n = (sym.ports || []).filter((p) => p.connectionClass === 'process').length;
  if (n >= minP) continue;
  const isValve = /valves|valve/.test(key);
  if (isValve && !(sym.ports || []).length) {
    const vb = vbOf(sym.svg);
    const ex = axisExtremes(sym.svg);
    if (!vb || !ex || ex.yLo === null || ex.yHi === null) continue;
    // pct is measured from the viewBox ORIGIN, not from 0 — some glyphs carry one
    const pct = (v, o, d) => r3((100 * (v - o)) / d);
    addPorts.push({
      key,
      ports: [
        PORT_SHAPE('left', 'left', pct(ex.lo, vb.x, vb.w), pct(ex.yLo, vb.y, vb.h)),
        PORT_SHAPE('right', 'right', pct(ex.hi, vb.x, vb.w), pct(ex.yHi, vb.y, vb.h)),
      ],
    });
  } else {
    dropClaim.push({ key, minP, n, reach: reachable.has(key) });
  }
}

console.log(`fix-symbol-behaviour — ${addPorts.length} valve(s) get their inlet/outlet pair; ${dropClaim.length} symbol(s) lose an unmeetable minProcessPorts\n`);
for (const a of addPorts) console.log(`  ${a.key.padEnd(46)} + ${a.ports.map((p) => `${p.id}(${p.x},${p.y})`).join(' ')}`);
for (const d of dropClaim) console.log(`  ${d.key.padEnd(46)} - minProcessPorts=${d.minP} (has ${d.n}, ${d.reach ? 'REACHABLE' : 'unreachable'})`);

if (!process.argv.includes('--write')) { console.log('\ndry run — pass --write to apply'); process.exit(0); }

// ---- apply by brace-matched text surgery -------------------------------------
let out = raw;
const append = (block, arr) => block.replace(/"ports":\[\s*\]/, `"ports":${JSON.stringify(arr)}`);
const stripClaim = (block) => {
  const at = block.indexOf('"behavior":{');
  if (at < 0) return block;
  let i = block.indexOf('{', at), depth = 0, end = -1;
  for (let j = i; j < block.length; j++) {
    const c = block[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) { end = j + 1; break; } }
  }
  const obj = JSON.parse(block.slice(i, end));
  delete obj.minProcessPorts;
  // `at` points at the KEY, so the replacement has to carry it: writing a bare `null`
  // there yields `...,"version":1,null}` — valid-looking, invalid JSON.
  const next = Object.keys(obj).length ? block.slice(0, at) + '"behavior":' + JSON.stringify(obj) + block.slice(end)
                                       : block.slice(0, at) + '"behavior":null' + block.slice(end);
  return next;
};
const edit = (key, fn) => {
  const kStart = out.indexOf(`"${key}":{`);
  if (kStart < 0) throw new Error(`symbol not found: ${key}`);
  let i = out.indexOf('{', kStart), depth = 0, end = -1;
  for (let j = i; j < out.length; j++) {
    const c = out[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) { end = j + 1; break; } }
  }
  const before = out.slice(kStart, end);
  const after = fn(before);
  if (after === before) throw new Error(`no change applied to ${key}`);
  out = out.slice(0, kStart) + after + out.slice(end);
};
for (const a of addPorts) edit(a.key, (b) => append(b, a.ports));
for (const d of dropClaim) edit(d.key, stripClaim);
writeFileSync(FILE, out);
console.log(`\n[WRITE] ${addPorts.length} port list(s) added, ${dropClaim.length} claim(s) removed. Re-verifying from the written file...`);

// ---- re-verify from the written file -----------------------------------------
const check = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, ''));
let fail = 0;
for (const a of addPorts) {
  const sym = check[a.key], vb = vbOf(sym.svg), g = ink(sym.svg);
  for (const want of a.ports) {
    const p = (sym.ports || []).find((q) => q.id === want.id);
    if (!p) { console.log(`  FAIL ${a.key}/${want.id} missing`); fail++; continue; }
    const X = vb.x + (p.x / 100) * vb.w, Y = vb.y + (p.y / 100) * vb.h;
    let gap = Infinity;
    for (const [x1, y1, x2, y2] of g.segs) {
      const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
      let t = L2 ? ((X - x1) * dx + (Y - y1) * dy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      gap = Math.min(gap, Math.hypot(X - (x1 + t * dx), Y - (y1 + t * dy)));
    }
    for (const [cx, cy, r] of g.circles) gap = Math.min(gap, Math.abs(Math.hypot(X - cx, Y - cy) - r));
    const ok = gap <= Math.max(0.5, maxStroke(g) / 2);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${a.key.padEnd(46)} ${want.id.padEnd(6)} pct (${p.x},${p.y}) ${gap.toFixed(3)}u from the linework`);
  }
}
for (const d of dropClaim) {
  const b = check[d.key].behavior;
  const ok = !b || !('minProcessPorts' in b);
  if (!ok) fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${d.key.padEnd(46)} behavior now ${JSON.stringify(check[d.key].behavior)}`);
}
console.log(fail ? `\nVERIFY FAILED for ${fail}` : `\nverified from the written file — all ports on the linework, no unmeetable claims`);
process.exit(fail ? 1 : 0);
