import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
eval(readFileSync('pid-symbols-bundle.js', 'utf8'));
const keys = Object.keys(window.PID_SYMBOLS);
const ns = {};
for (const k of keys) {
  const top = k.split('/').slice(0, 2).join('/');
  ns[top] = (ns[top] || 0) + 1;
}
console.log(JSON.stringify(ns, null, 1));
console.log('total:', keys.length);
