// Fix level-switch: ports are on the outer circle, should be on the internal flow line.
// The horizontal line is at y=53.57 from x=26.79 to 80.36 in a 107.14-wide viewBox.
// Ports should be at the flow line ends: pct (25, 50) and (75, 50).
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'pid-symbols-bundle.js';
const raw = readFileSync(FILE, 'utf8');
const symbols = JSON.parse(raw.replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, ''));

const key = 'isa-5.1/measurement/level-switch';
const sym = symbols[key];
console.log('before:', JSON.stringify(sym.ports.map(p=>[p.id,p.x,p.y])));
// Fix ports: move from circle to flow line ends
sym.ports[0].x = 25; sym.ports[0].y = 50;
sym.ports[1].x = 75; sym.ports[1].y = 50;

// Also fix stroke="black" -> should be currentColor for consistency
sym.svg = sym.svg.replace(/stroke="black"/g, 'stroke="currentColor"');

console.log('after:', JSON.stringify(sym.ports.map(p=>[p.id,p.x,p.y])));
console.log('svg:', sym.svg.replace(/\s+/g, ' ').trim());

// Write back
const out = raw.replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, '');
const updated = out.replace(
  new RegExp('"' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '":\\{'),
  'PLACEHOLDER'
);
// Use brace-matched surgery like the other fixers
let kStart = raw.indexOf('"' + key + '":{');
let i = raw.indexOf('{', kStart), depth = 0, end = -1;
for (let j = i; j < raw.length; j++) {
  const c = raw[j];
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (!depth) { end = j + 1; break; } }
}
const block = raw.slice(kStart, end);
const newBlock = block
  .replace(/"x":0,"y":46\.667/, '"x":25,"y":50')
  .replace(/"x":93\.333,"y":46\.667/, '"x":75,"y":50')
  .replace('stroke="black"', 'stroke="currentColor"');
const result = raw.slice(0, kStart) + newBlock + raw.slice(end);
writeFileSync(FILE, result);
console.log('written');
// verify
const check = JSON.parse(result.replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, ''));
console.log('verify:', JSON.stringify(check[key].ports.map(p=>[p.id,p.x,p.y])));
console.log('verify svg:', check[key].svg.includes('currentColor') && !check[key].svg.includes('stroke="black"'));
