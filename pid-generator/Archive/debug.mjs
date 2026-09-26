import { readFileSync } from 'node:fs';
const SYMS = readFileSync('pid-svg-library/bundle/symbols.js', 'utf8');
const GEN = readFileSync('P&IDGenerator.js', 'utf8');
const SPIKE = readFileSync('pid-spike.html', 'utf8');
const demo = SPIKE.match(/const pidSource = `([\s\S]*?)`;/)[1];
const noop = () => {};
function fakeEl() {
  return { _h: '', setAttribute: noop, appendChild: noop, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, get outerHTML() { return this._h; }, querySelectorAll: () => [], getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }), style: {} };
}
globalThis.window = globalThis; globalThis.innerWidth = 1200; globalThis.innerHeight = 800;
globalThis.document = { createElementNS: () => fakeEl(), getElementById: () => fakeEl() };
eval(SYMS); eval(GEN);
const segs = (pts) => { const o = []; for (let i = 1; i < pts.length; i++) o.push([pts[i - 1], pts[i]]); return o; };
const findOv = (geoms) => {
  const out = [];
  for (let i = 0; i < geoms.length; i++) {
    if (geoms[i].pts.length < 2) continue;
    for (let j = i + 1; j < geoms.length; j++) {
      if (geoms[j].pts.length < 2) continue;
      for (const si of segs(geoms[i].pts)) for (const sj of segs(geoms[j].pts)) {
        const h1 = Math.abs(si[0].y - si[1].y) < 0.5, h2 = Math.abs(sj[0].y - sj[1].y) < 0.5;
        let ol = 0;
        if (h1 && h2 && Math.abs(si[0].y - sj[0].y) < 1) ol = Math.min(Math.max(si[0].x, si[1].x), Math.max(sj[0].x, sj[1].x)) - Math.max(Math.min(si[0].x, si[1].x), Math.min(sj[0].x, sj[1].x));
        else if (!h1 && !h2 && Math.abs(si[0].x - sj[0].x) < 1) ol = Math.min(Math.max(si[0].y, si[1].y), Math.max(sj[0].y, sj[1].y)) - Math.max(Math.min(si[0].y, si[1].y), Math.min(sj[0].y, sj[1].y));
        if (ol > 3) out.push({ i, j, len: Math.round(ol), a: geoms[i].p.from + '->' + geoms[i].p.to, b: geoms[j].p.from + '->' + geoms[j].p.to });
      }
    }
  }
  return out;
};
globalThis.__DBG = (o) => console.log('DBG', JSON.stringify(o));
globalThis.__CAP = (geoms) => {
  const ov = findOv(geoms);
  console.log('OVERLAPS after Phase2 pass:', ov.length);
  for (const o of ov) {
    console.log(`  ${o.a} & ${o.b}  ${o.len}mm`);
    console.log('   A pts:', JSON.stringify(geoms[o.i].pts.map(p => [Math.round(p.x), Math.round(p.y)])));
    console.log('   B pts:', JSON.stringify(geoms[o.j].pts.map(p => [Math.round(p.x), Math.round(p.y)])));
    console.log('   A dirs pA:', JSON.stringify(geoms[o.i].pA.dir), 'pB:', JSON.stringify(geoms[o.i].pB.dir));
    console.log('   B dirs pA:', JSON.stringify(geoms[o.j].pA.dir), 'pB:', JSON.stringify(geoms[o.j].pB.dir));
  }
};
const res = window.PIDGenerator.renderPid(demo, 'graphDiv');
console.log('final overlaps:', res.score.lines.overlaps, 'errors:', res.errors.length);
