// probe-fire.mjs — does an in-solve rule actually DO anything, and what does
// it do to the score object?
//
// WHY THIS EXISTS. The W4 post-mortem's core lesson: a rule that is silently
// dead looks exactly like a rule that fired and changed nothing. `moves: 0` is
// not an error, it is a plausible reading of a working system. So a rule
// measurement needs a cross-check that can DISAGREE with the score table —
// this is that cross-check. It answers, per sheet:
//
//   1. did the target/affinity phase run at all?  (data.ruleTargets / ruleAffinity)
//   2. which entities actually moved?             (position diff, rules off vs on)
//   3. how did the SCORE OBJECT change, term by term? (flat diff, not the table)
//
// Usage (cwd must be pid-generator/):
//   node probe-fire.mjs <case-or-x> <layout.key>[,<layout.key>...]
//     e.g. node probe-fire.mjs dense layout.affinityRehome
//          node probe-fire.mjs x layout.placementRules,layout.ruleSuctionSourceAbove
//          node probe-fire.mjs spike layout.ruleSuctionSourceAbove --shot
//
// `x` = every regress case. `--shot` renders before/after PNGs through Chrome,
// which is the project's own rule for a layout change: it is not done until
// the sheet has been LOOKED at.
//
// NOTE on "off": the off/on pair is CURRENT SHIPPED DEFAULT vs DEFAULT + the
// named keys. Since affinityRehome shipped at 1 (2026-10-10, below), "off"
// already includes it — that is the point: a future measurement is always
// against what ships, not against a remembered past.
//
// Measured example of why the score-object diff matters: the W4 in-solve
// baseline of suction-source-above read "+5 on four sheets", which the
// PID-LAY-003 false positive (fixed 2026-10-10) inflated by exactly one warn
// per sheet with byte-identical geometry. The flat diff below shows that in
// one line: `issues.warnings: 3 -> 4` and nothing else.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENGINE = [
  'pid-textmetrics.js', 'pid-rules.js', 'pid-collide.js', 'geometric_objects.js',
  'pid-symbols-bundle.js', 'assembly.js', 'placement-rules.js', 'pid-parser.js',
  'pid-router.js', 'pid-validator.js', 'pid-renderer.js'
];
globalThis.window = globalThis;
globalThis.PID_DEBUG = 0;
globalThis.innerWidth = 2560;
globalThis.innerHeight = 1279;
globalThis.document = {
  createElementNS: () => ({ tag: 'svg', attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = String(v); }, appendChild(c) { this.children.push(c); }, set innerHTML(v) { this._h = v; }, get innerHTML() { return `<svg>${this._h}</svg>`; }, querySelectorAll: () => [], style: {} }),
  getElementById: () => ({ tag: 'div', attrs: {}, children: [], set innerHTML(v) { this._h = v; }, get innerHTML() { return `<div>${this._h}</div>`; }, appendChild(c) { this.children.push(c); }, style: {} })
};
const base = ENGINE.map((f) => readFileSync(f, 'utf8')).join('\n;\n');
const argv = process.argv.slice(2);
const KEYS = (argv[1] || '').split(',').filter(Boolean);
const SHOT = argv.includes('--shot');

// The same override shape measure.mjs uses, applied inside the eval scope so
// the registry is rewritten in memory only and the tree is never touched.
const mk = (inj) => {
  new Function((inj ? base + '\n;\n' + inj : base) + '\nreturn { PIDGenerator };')();
  return globalThis.PIDGenerator;
};
const G_OFF = mk(null);
const inj = `;(() => { for (const [k, v] of ${JSON.stringify([['layout.placementRules', 1], ...KEYS.map((k) => [k, 1])])}) { const p = k.split('.'); let n = PID_RULES.params; for (let i = 0; i < p.length - 1; i++) n = n[p[i]]; n[p[p.length - 1]] = { value: v }; } })();`;
const G_ON = mk(inj);

const CASES = argv[0] === 'x' ? ['spike', 'dense', 'manifold', 'min', 'split'] : [argv[0]];
// the demo's DSL is the browser page's own source, frozen under regress/_pv/;
// there is deliberately no regress/demo.dsl to drift from it
const DSL = (c) => c === 'demo' ? 'regress/_pv/demo.dsl' : `regress/${c}.dsl`;
const OUT = SHOT ? mkdtempSync(join(tmpdir(), 'rule-')) : null;

for (const c of CASES) {
  const text = readFileSync(DSL(c), 'utf8');
  const ra = G_OFF.renderPid(text, 'graphDiv');
  const rb = G_ON.renderPid(text, 'graphDiv');
  const pos = (r) => {
    const m = {};
    for (const e of [...(r.data ? r.data.equipment : []), ...(r.data ? r.data.valves : [])]) m[e.id] = `${e.x},${e.y}`;
    return m;
  };
  const pOff = pos(ra), pOn = pos(rb);
  const moved = Object.keys(pOff).filter((k) => pOff[k] !== pOn[k]);
  console.log(`\n=== ${c} ===`);
  console.log(`  ruleTargets=${JSON.stringify(rb.data.ruleTargets || null)} ruleAffinity=${JSON.stringify(rb.data.ruleAffinity || null)}`);
  console.log(`  moved (${moved.length}): ${moved.join(' ')}`);

  // flat score-object diff — the cross-check that can disagree with the table
  const flat = (o, pre = '') => Object.entries(o || {}).flatMap(([k, v]) =>
    (v && typeof v === 'object' && !Array.isArray(v)) ? flat(v, pre + k + '.') : [[pre + k, v]]);
  const fa = new Map(flat(ra.score)), fb = new Map(flat(rb.score));
  const keys = [...new Set([...fa.keys(), ...fb.keys()])].sort();
  for (const k of keys) {
    const va = JSON.stringify(fa.get(k)), vb = JSON.stringify(fb.get(k));
    if (va !== vb) console.log(`  score ${k}: ${va} -> ${vb}`);
  }
  const wa = (ra.data.warnings || []).length, wb = (rb.data.warnings || []).length;
  console.log(`  total: ${ra.score.total} -> ${rb.score.total} (warnings ${wa} -> ${wb})`);
  const newWarn = (rb.data.warnings || []).filter((w) => !(ra.data.warnings || []).includes(w));
  for (const w of newWarn) console.log(`  NEW WARNING: ${w.slice(0, 140)}`);

  if (SHOT) {
    for (const [tag, G] of [['off', G_OFF], ['on', G_ON]]) {
      const svgPath = join(OUT, `${c}-${tag}.svg`);
      execFileSync('node', ['harness2.mjs', svgPath, `--src=regress/${c}.dsl`], {
        encoding: 'utf8', stdio: 'pipe',
        env: tag === 'on' ? { ...process.env, PID_RULE_INJECT: inj } : (() => { const e = { ...process.env }; delete e.PID_RULE_INJECT; return e; })(),
      });
      const svg = readFileSync(svgPath, 'utf8');
      const vb2 = svg.match(/viewBox="([^"]+)"/)[1].split(/[\s,]+/).map(Number);
      const H = Math.round((1600 * vb2[3]) / vb2[2]);
      const forced = svg.replace(/<svg([^>]*?)>/, (all, at) => {
        const a = at.replace(/\s*width="[^"]*"/, '').replace(/\s*height="[^"]*"/, '');
        return `<svg${a} width="1600" height="${H}">`;
      });
      const page = join(OUT, `${c}-${tag}.html`);
      writeFileSync(page, `<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#fff;overflow:hidden}svg{display:block}</style>${forced}`);
      execFileSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
        '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        `--screenshot=${join(OUT, `${c}-${tag}.png`)}`, `--window-size=1600,${H}`,
        '--default-background-color=ffffff', '--force-device-scale-factor=1',
        '--virtual-time-budget=4000', 'file:///' + page.replace(/\\/g, '/'),
      ], { stdio: 'pipe' });
    }
    console.log(`  PNGs: ${OUT}\\${c}-off.png  ${OUT}\\${c}-on.png`);
  }
}
if (OUT) console.log(OUT);
