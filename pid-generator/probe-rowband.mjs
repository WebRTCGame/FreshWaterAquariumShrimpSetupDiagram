// Throwaway probe: does the serpentine row band survive the median coordinate
// assignment?  Forcing colsPerRowMax=2 should put depth 0..1 in band 0 and
// depth 2..3 in band 1.  If the median pass re-centres each group freely, both
// bands collapse onto one and the wrap is decorative.
import { readFileSync } from 'node:fs';
const files = ['pid-rules.js', 'pid-collide.js', 'geometric_objects.js', 'pid-symbols-bundle.js', 'assembly.js', 'pid-parser.js', 'pid-router.js', 'pid-validator.js', 'pid-renderer.js'];
const GEN = files.map((f) => readFileSync(f, 'utf8')).join('\n;\n');
const src = readFileSync(process.argv[3] || 'regress/dense.dsl', 'utf8');
function fakeEl(tag) {
  return { tag: tag || 'div', attrs: {}, _h: '', children: [], style: {},
    setAttribute(k, v) { this.attrs[k] = String(v); }, appendChild(c) { this.children.push(c); },
    set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; },
    get outerHTML() { return `<${this.tag} ${JSON.stringify(this.attrs)}>${this._h + this.children.map((c) => c.outerHTML || '').join('')}</${this.tag}>`; },
    querySelectorAll: () => [] };
}
let container = null;
globalThis.window = globalThis;
globalThis.PID_DEBUG = 0;
globalThis.__tapDbg = [];
globalThis.innerWidth = 2560; globalThis.innerHeight = 1279;
globalThis.document = { createElementNS: (_n, t) => fakeEl(t), getElementById: (id) => (id === 'graphDiv' ? (container = fakeEl('div')) : fakeEl(id)) };
const CAP = +(process.argv[2] || 2);
eval(GEN + `\n;PID_RULES.params.layout.colsPerRowMax.value = ${CAP};`);
const res = window.PIDGenerator.renderPid(src, 'graphDiv', undefined);
const d = res.data;
const rank = d.flowRank || {};
for (const e of [...d.equipment, ...d.valves]) console.log('POS', e.id, 'rank', rank[e.id], 'x', Math.round(e.x), 'y', Math.round(e.y));
console.log('SCORE', res.score.total, 'fill', JSON.stringify(res.score.fill), 'routing', JSON.stringify(res.score.routing));
