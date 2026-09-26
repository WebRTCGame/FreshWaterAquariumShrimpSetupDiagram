import { readFileSync, writeFileSync } from 'node:fs';
const h = readFileSync(process.argv[2], 'utf8');
const m = h.match(/const pidSource = `([\s\S]*?)`;/);
if (!m) { console.error('no pidSource found'); process.exit(1); }
writeFileSync(process.argv[3], m[1]);
console.log('wrote', process.argv[3], 'lines:', m[1].split('\n').length);
