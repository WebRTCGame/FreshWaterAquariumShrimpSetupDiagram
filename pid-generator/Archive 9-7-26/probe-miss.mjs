import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
const B = readFileSync('pid-symbols-bundle.js', 'utf8');
const P = readFileSync('pid-parser.js', 'utf8').split('//  renderer')[0];
const C = JSON.parse(readFileSync('Archive/pid-svg-library-sources/connections.json', 'utf8'));
eval(B + '\n;\n' + P + `
;globalThis.__INV = (() => {
  const out = [];
  const all = {...SYMBOL_KEYS};
  try { Object.assign(all, BUBBLE_KEYS); } catch (e) {}
  for (const [type, key] of Object.entries(all)) {
    const e = window.PID_SYMBOLS[key];
    out.push({ type, key, inBundle: !!e, ports: e && e.ports ? e.ports.length : (e ? 0 : null), inConns: !!(C[key] || C[key] ) });
  }
  // pip-side scan: valves/instruments/vessels with ports?
  const pipValves = Object.keys(window.PID_SYMBOLS).filter(k => k.startsWith('pip/valves/')).map(k => k + ':' + (window.PID_SYMBOLS[k].ports || []).length);
  const pipInst = Object.keys(window.PID_SYMBOLS).filter(k => k.startsWith('pip/instruments/')).map(k => k + ':' + (window.PID_SYMBOLS[k].ports || []).length);
  const pipEq = Object.keys(window.PID_SYMBOLS).filter(k => k.startsWith('pip/equipment/'));
  return { out, pipValves, pipInst, pipEq };
})();`);
const inv = globalThis.__INV;
for (const r of inv.out) console.log((r.inBundle ? 'HAVE ' : 'MISS ') + (r.ports === null ? '-' : r.ports) + ' ' + r.type + ' -> ' + r.key);
console.log('--- pip/valves (key:nPorts) ---');
console.log(inv.pipValves.join(' '));
console.log('--- pip/instruments ---');
console.log(inv.pipInst.join(' '));
console.log('--- pip/equipment ---');
console.log(inv.pipEq.join(' '));
