// probe-shot2.mjs — render one case's CURRENT default output for eyeballing.
//
// The project's own gate: "a layout change is not done until the sheet has been
// looked at" (P&ID-VISUAL-QUALITY.md §9.11). probe-fire.mjs --shot does the
// before/after pair; this renders whatever the registry defaults now produce,
// which is what ships.
//
// Usage (cwd must be pid-generator/):
//   node probe-shot2.mjs [case]          # case = spike|dense|min|split|manifold|_pv/demo
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CASE = process.argv[2] || '_pv/demo';
const OUT = mkdtempSync(join(tmpdir(), 'look-'));
const svgPath = join(OUT, 'cur.svg');
execFileSync('node', ['harness2.mjs', svgPath, `--src=regress/${CASE}.dsl`], { encoding: 'utf8', stdio: 'pipe' });
const svg = readFileSync(svgPath, 'utf8');
const vb = svg.match(/viewBox="([^"]+)"/)[1].split(/[\s,]+/).map(Number);
const W = 2200;
const H = Math.round((W * vb[3]) / vb[2]);
// Chrome renders a bare .svg file as XML TEXT; wrap it in a page with a forced
// size, exactly as visual-regress.mjs does
const forced = svg.replace(/<svg([^>]*?)>/, (all, at) => {
  const a = at.replace(/\s*width="[^"]*"/, '').replace(/\s*height="[^"]*"/, '');
  return `<svg${a} width="${W}" height="${H}">`;
});
const page = join(OUT, 'cur.html');
writeFileSync(page, `<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#fff;overflow:hidden}svg{display:block}</style>${forced}`);
execFileSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--screenshot=${join(OUT, 'cur.png')}`, `--window-size=${W},${H}`,
  '--default-background-color=ffffff', '--force-device-scale-factor=1',
  '--virtual-time-budget=5000', 'file:///' + page.replace(/\\/g, '/'),
], { stdio: 'pipe' });
console.log(join(OUT, 'cur.png'));
