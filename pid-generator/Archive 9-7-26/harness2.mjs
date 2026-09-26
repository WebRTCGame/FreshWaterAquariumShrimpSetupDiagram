import { readFileSync, writeFileSync } from 'node:fs';
// ponytail: node repro for the split-file stack (what the browser runs).
// Usage: node harness2.mjs [out.svg] [--src=file.dsl] — renders pid-spike.html
// source (or the given DSL file), writes SVG, prints errors/warnings/score.
// Exit 1 on errors.
const files = ['pid-rules.js', 'pid-collide.js', 'geometric_objects.js', 'pid-symbols-bundle.js', 'pid-parser.js', 'pid-router.js', 'pid-validator.js', 'pid-renderer.js'];
const GEN = files.map((f) => readFileSync(f, 'utf8')).join('\n;\n');
const srcArg = process.argv.find((a) => a.startsWith('--src='));
const demo = srcArg ? readFileSync(srcArg.slice(6), 'utf8')
  : readFileSync('pid-spike.html', 'utf8').match(/const pidSource = `([\s\S]*?)`;/)[1];

function fakeEl(tag) {
  return {
    tag: tag || 'div',
    attrs: {},
    _h: '',
    children: [],
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(c) { this.children.push(c); },
    set innerHTML(v) { this._h = v; },
    get innerHTML() { return this._h; },
    get outerHTML() {
      const a = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
      const inner = this._h + this.children.map((c) => c.outerHTML || '').join('');
      return `<${this.tag}${a}>${inner}</${this.tag}>`;
    },
    querySelectorAll: () => [],
    style: {},
  };
}
let container = null;
globalThis.window = globalThis;
globalThis.PID_DEBUG = process.argv.includes('--debug') ? 1 : 0; // ponytail: Phase 4 invariants
globalThis.__tapDbg = [];
globalThis.innerWidth = 2560;
globalThis.innerHeight = 1279;
globalThis.document = {
  createElementNS: (_ns, tag) => fakeEl(tag),
  getElementById: (id) => {
    if (id === 'graphDiv') { container = fakeEl('div'); return container; }
    return fakeEl(id);
  },
};

eval(GEN);
const t0 = Date.now();
// --candidates=N --seedbase=S : pick best of legacy + N seeded renders
const candArg = process.argv.find((a) => a.startsWith('--candidates='));
const seedArg = process.argv.find((a) => a.startsWith('--seedbase='));
const res = window.PIDGenerator.renderPid(demo, 'graphDiv', candArg
  ? { candidates: parseInt(candArg.slice(13), 10), seedBase: seedArg ? parseInt(seedArg.slice(11), 10) : 1 }
  : undefined);
const renderMs = Date.now() - t0;
const outFile = process.argv[2] || 'render-out.svg';
writeFileSync(outFile, '<?xml version="1.0" encoding="UTF-8"?>\n' + container.children[0].outerHTML);
console.log('wrote', outFile);
console.log('renderMs:', renderMs);
// --geo FROM,TO : dump routed polyline points for one pipe
const geoArg = process.argv.find((a) => a.startsWith('--geo='));
if (geoArg) {
  const [f, t] = geoArg.slice(6).split(',');
  const g = (globalThis.__pidGeo || []).find((g) => g.from === f && g.to === t);
  console.log('GEO', f + '->' + t, JSON.stringify((g ? g.pts : []).map((p) => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2), lead: !!p._lead }))));
}
// --pos : dump all entity centers (id x y)
if (process.argv.includes('--pos')) {
  const d = res.data;
  for (const e of [...d.equipment, ...d.valves]) console.log('POS', e.id, Math.round(e.x), Math.round(e.y));
  for (const i of d.instruments) console.log('POS', i.tag, Math.round(i.x), Math.round(i.y));
  for (const j of d.junctions) console.log('POS', j.id, Math.round(j.x), Math.round(j.y));
}
// --noz : dump nozzle geometry (id owner port tip orientation)
if (process.argv.includes('--noz')) {
  for (const nz of (res.data.nozzles || [])) {
    const t = nz.tipPosition ? `${Math.round(nz.tipPosition.x)},${Math.round(nz.tipPosition.y)}` : '?';
    const b = nz.position ? `${Math.round(nz.position.x)},${Math.round(nz.position.y)}` : '?';
    console.log('NOZ', nz.id, 'on', nz.ownerId, nz.portId, 'base', b, 'tip', t, 'orient', nz.orientation);
  }
}
console.log('ERRORS:', res.errors.length);
for (const e of res.errors) console.log('  E', e.code || '', e.message);
console.log('WARNINGS:', res.warnings.length);
for (const w of res.warnings.slice(0, 30)) console.log('  W', w);
if (res.warnings.length > 30) console.log(`  ... +${res.warnings.length - 30} more`);
console.log('SCORE:', JSON.stringify(res.score));
console.log('astarFails:', globalThis.__astarFails || 0);
const dbgFails = res.errors.filter((e) => (e.code || '').startsWith('PID-DBG-'));
console.log('DBGFAILURES:', dbgFails.length);
if (globalThis.__tapDbg && globalThis.__tapDbg.length) console.log('TAPS:', JSON.stringify(globalThis.__tapDbg));
if (res.errors.length) process.exitCode = 1;
