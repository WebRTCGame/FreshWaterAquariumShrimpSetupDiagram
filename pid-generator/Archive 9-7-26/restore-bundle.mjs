import { readFileSync, writeFileSync } from 'node:fs';
// one-shot restore: extract window.PID_SYMBOLS from git's P&IDGenerator.js
// and rewrite pid-symbols-bundle.js. Verifies key namespaces before writing.
const src = readFileSync('pid-backup-tmp.js', 'utf8');
const marker = 'window.PID_SYMBOLS = ';
const i = src.indexOf(marker);
if (i < 0) { console.error('no PID_SYMBOLS block found'); process.exit(1); }
// brace-match from the opening {
let j = src.indexOf('{', i), depth = 0, instr = false, esc = false, end = -1;
for (let k = j; k < src.length; k++) {
  const ch = src[k];
  if (instr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') instr = false; continue; }
  if (ch === '"') instr = true;
  else if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (!depth) { end = k + 1; break; } }
}
if (end < 0) { console.error('unbalanced'); process.exit(1); }
const map = JSON.parse(src.slice(j, end));
const keys = Object.keys(map);
const has = (p) => keys.some((k) => k.startsWith(p));
console.log('total:', keys.length);
console.log('isa-5.1:', has('isa-5.1/'), 'y32:', has('y32.11-1961/'), 'pip/:', has('pip/'));
for (const need of ['isa-5.1/valves/gate', 'isa-5.1/valves/control-valve', 'y32.11-1961/vessels/reactor-stirred', 'y32.11-1961/vessels/drum', 'pip/equipment/pump-centrifugal', 'pip/equipment/tank-cone-roof', 'nozzle/weld-neck-flange']) {
  console.log((map[need] ? 'OK  ' : 'MISS') + ' ' + need);
}
if (!map['isa-5.1/valves/gate'] || !map['y32.11-1961/vessels/drum']) { console.error('REFUSING: incomplete table'); process.exit(1); }
writeFileSync('pid-symbols-bundle.js', 'window.PID_SYMBOLS = ' + JSON.stringify(map) + ';\n');
console.log('wrote pid-symbols-bundle.js');
