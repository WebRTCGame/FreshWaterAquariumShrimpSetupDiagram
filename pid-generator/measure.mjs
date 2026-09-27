// measure.mjs — one table of every machine-checked fact, for every sheet.
//
// Why this exists. `regress.mjs` answers "did anything change?" as a DIFF, which is
// the right question for a gate and the wrong question for a design session: a diff
// tells you a number moved, not which direction is better, and it only covers the
// cases someone remembered to bless. Every layout change in this project has been
// argued from a measurement, and most of them needed a measurement of all six sheets
// at once. This is that command.
//
//   node measure.mjs                  # every case + the demo
//   node measure.mjs demo dense       # a subset
//   node measure.mjs --json           # machine-readable
//   node measure.mjs --set=path:v,... # override a rule for the whole run, e.g.
//                                     #   --set=layout.colsPerRowMax:3
//                                     # (the override is applied to the in-memory
//                                     #  registry only; the tree is never written)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CASES = [
  { name: 'demo', dsl: null },                      // pid-spike.html's embedded source
  { name: 'spike', dsl: 'regress/spike.dsl' },
  { name: 'dense', dsl: 'regress/dense.dsl' },
  { name: 'min', dsl: 'regress/min.dsl' },
  { name: 'split', dsl: 'regress/split.dsl' },
  { name: 'manifold', dsl: 'regress/manifold.dsl' },
];

// The demo's DSL lives inside the browser demo page; harness2.mjs knows how to
// pull it out, so "no --src" already means the demo. Nothing extra to do.
const argv = process.argv.slice(2);
const json = argv.includes('--json');
const keep = argv.filter((a) => !a.startsWith('--'));
const setArg = (argv.find((a) => a.startsWith('--set=')) || '').slice(6);
const overrides = setArg ? setArg.split(',').map((s) => {
  const i = s.lastIndexOf(':');
  return [s.slice(0, i), s.slice(i + 1)];
}) : [];

// Build the override as real JS evaluated inside the same scope as the rules
// registry, so nothing is written to disk and no file is left mutated.
function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !isNaN(Number(v))) return Number(v);
  return v;
}
function injectFor(ov) {
  if (!ov.length) return '';
  const body = ov.map(([k, v]) => {
    const p = k.split('.');
    const leaf = p.pop();
    return `n[${JSON.stringify(leaf)}] = { value: ${JSON.stringify(coerce(v))} };`;
  }).join(' ');
  return `\n;(() => { const OV = ${JSON.stringify(ov)};` +
    ` for (const [k, v] of OV) { const p = k.split('.'); let n = PID_RULES.params;` +
    ` for (let i = 0; i < p.length - 1; i++) n = n[p[i]]; ${body} } })();`;
}

function sh(script, args) {
  try {
    return { out: execFileSync('node', [script, ...args], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, env: { ...process.env, PID_RULE_INJECT: injectFor(overrides) } }), code: 0 };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || ''), code: e.status || 1 };
  }
}

function parseHarness(out) {
  const r = { errors: [], warnings: [], warningsTotal: 0, score: null, renderMs: 0 };
  for (const line of out.split('\n')) {
    let m;
    if ((m = line.match(/^  E (\S*) ?(.*)$/))) r.errors.push((m[1] ? m[1] + ' ' : '') + m[2].trim());
    else if ((m = line.match(/^  W (.*)$/))) r.warnings.push(m[1].trim());
    else if ((m = line.match(/^WARNINGS: (\d+)$/))) r.warningsTotal = +m[1];
    else if ((m = line.match(/^renderMs: (\d+)$/))) r.renderMs = +m[1];
    else if ((m = line.match(/^SCORE: (\{.*\})$/))) { try { r.score = JSON.parse(m[1]); } catch { /* truncated */ } }
  }
  return r;
}
function parseAudit(out) {
  const res = { counts: {} };
  let cur = null;
  for (const line of out.split('\n')) {
    let m;
    if ((m = line.match(/^\[(\d+)\] .*?: (\d+)\s*(\(|$)/))) {
      cur = m[1] === '2' ? null : m[1];
      if (cur) res.counts[cur] = +m[2];
    } else if (/^\[\d+\]/.test(line)) cur = null;
    else if (/^== /.test(line) || /^paths: /.test(line)) cur = null;
  }
  return res;
}

const cases = keep.length ? CASES.filter((c) => keep.includes(c.name)) : CASES;
const rows = [];
for (const c of cases) {
  const svg = `regress/_m-${c.name}.svg`;
  const args = c.dsl ? [svg, `--src=${c.dsl}`] : [svg];
  const h = sh('harness2.mjs', args);
  const a = sh('audit-svg.mjs', [svg]);
  const H = parseHarness(h.out), A = parseAudit(a.out);
  rows.push({ name: c.name, H, A, ms: H.renderMs });
}

if (json) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }

const pad = (s, n, right) => (right ? String(s).padStart(n) : String(s).padEnd(n));
const F = (v, n = 5) => pad(v === undefined ? '-' : v, n, true);
const head = ['case', 'total', 'util%', 'fill%', 'xings', 'bends', 'len', 'lblCol', 'overlap', 'offSh', 'tapRun', 'sigMax', 'err', 'warn', 'ms'];
console.log(head.map((h, i) => pad(h, i === 0 ? 9 : 6, i > 0)).join(' '));
console.log('-'.repeat(head.reduce((s, h, i) => s + (i === 0 ? 9 : 7), 0)));
for (const r of rows) {
  const s = r.H.score;
  console.log([
    pad(r.name, 9),
    F(s && s.total), F(s && s.fill.util), F(s && s.fill.w + '/' + s.fill.h),
    F(s && s.routing.crossings), F(s && s.routing.bends), F(s && s.routing.length),
    F(s && s.annotations.labelCollisions), F(s && s.lines.overlaps), F(s && s.sheet.offSheet),
    F(s && s.instruments.tapReachTotal), F(s && s.instruments.maxSignalLen),
    F(r.H.errors.length), F(r.H.warningsTotal), F(r.ms),
  ].join(' '));
}
const aud = ['0', '1', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'];
const have = aud.filter((k) => rows.some((r) => r.A.counts[k] !== undefined));
if (have.length) {
  console.log('\naudit'.padEnd(9) + have.map((k) => pad(k, 6, true)).join(' '));
  for (const r of rows) console.log(pad(r.name, 9) + have.map((k) => F(r.A.counts[k], 6)).join(' '));
}
const tot = rows.reduce((s, r) => s + (r.H.score ? r.H.score.total : 0), 0);
console.log('\nsum of totals:', tot);
if (overrides.length) console.log('overrides:', overrides.map(([k, v]) => k + '=' + v).join(' '));
