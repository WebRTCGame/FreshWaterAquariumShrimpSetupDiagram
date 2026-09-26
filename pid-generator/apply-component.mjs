// Merge an edited component JSON (exported from pid-components.html) back into
// the embedded PID_SYMBOLS block of pid-symbols-bundle.js.
//
//   node apply-component.mjs <component.json> [--file "pid-symbols-bundle.js"]
import fs from 'node:fs';

const args = process.argv.slice(2);
const jsonPath = args[0];
let genFile = 'pid-symbols-bundle.js';
const fi = args.indexOf('--file');
if (fi >= 0 && args[fi + 1]) genFile = args[fi + 1];
if (!jsonPath || !fs.existsSync(jsonPath)) {
  console.error('usage: node apply-component.mjs <component.json> [--file pid-symbols-bundle.js]');
  process.exit(1);
}
if (!fs.existsSync(genFile)) { console.error(`generator not found: ${genFile}`); process.exit(1); }

const comp = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
if (!comp.id) { console.error('component json has no "id"'); process.exit(1); }
for (const req of ['svg', 'size', 'ports']) if (!(req in comp)) { console.error(`missing required field "${req}"`); process.exit(1); }
for (const p of comp.ports || []) {
  for (const k of ['id', 'x', 'y', 'type']) if (!(k in p)) { console.error(`port missing "${k}"`); process.exit(1); }
  for (const k of ['x', 'y']) if (typeof p[k] !== 'number' || p[k] < -50 || p[k] > 150) { console.error(`port ${p.id}.${k} outside sane range`); process.exit(1); }
}

const src = fs.readFileSync(genFile, 'utf8');
function scanEnd(s, from) {
  let i = s.indexOf('{', from), depth = 0, q = false, e = false;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (e) e = false; else if (ch === '\\') e = true; else if (ch === '"') q = false; continue; }
    if (ch === '"') q = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (!depth) return i + 1; }
  }
  throw new Error('embedded block not found or unbalanced');
}
const ASSIGN = 'window.PID_SYMBOLS = ';
const assignStart = src.indexOf(ASSIGN);
if (assignStart < 0) { console.error('PID_SYMBOLS block not found'); process.exit(1); }
const objStart = src.indexOf('{', assignStart);
const objEnd = scanEnd(src, assignStart);
const map = JSON.parse(src.slice(objStart, objEnd));
map[comp.id] = comp;
// write with a trailing newline to match surrounding style
fs.writeFileSync(genFile, src.slice(0, objStart) + JSON.stringify(map) + src.slice(objEnd));
console.log(`applied "${comp.id}" -> ${genFile} (${Object.keys(map).length} components)`);
