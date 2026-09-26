import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
// ponytail: regression suite for the split-file stack (Phase 0 of the plan).
// Usage (cwd must be pid-generator/): node regress.mjs [--bless] [case...]
// Cases: regress/<name>.dsl -> renders + audits -> compares with expected.json.
// Fails on: any error, any warning change, score change, any audit count change.
// Title block carries today's date, so SVG bytes are NOT compared — only the
// machine-checked facts (errors/warnings/score/audit).
const CASES = ['spike', 'min', 'dense', 'split'];
const EXPECTED = 'regress/expected.json';

function sh(cmd, args) {
  try {
    return { out: execFileSync('node', [cmd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }), code: 0 };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || ''), code: e.status || 1 };
  }
}

function parseHarness(out) {
  const errors = [], warnings = [];
  let warningsTotal = 0, score = null;
  for (const line of out.split('\n')) {
    let m;
    if ((m = line.match(/^  E (\S*) ?(.*)$/))) errors.push((m[1] ? m[1] + ' ' : '') + m[2].trim());
    else if ((m = line.match(/^  W (.*)$/))) warnings.push(m[1].trim());
    else if ((m = line.match(/^WARNINGS: (\d+)$/))) warningsTotal = +m[1];
    else if ((m = line.match(/^SCORE: (\{.*\})$/))) { try { score = JSON.parse(m[1]); } catch { /* keep null */ } }
  }
  return { errors, warnings, warningsTotal, score };
}

function parseAudit(out) {
  const res = { paths: null, counts: {}, lists: {} };
  let cur = null;
  for (const line of out.split('\n')) {
    let m;
    if ((m = line.match(/^paths: (.*)$/))) { res.paths = m[1].trim(); cur = null; }
    else if ((m = line.match(/^\[(\d+)\] .*?: (\d+)\s*(\(|$)/))) {
      cur = m[1] === '2' ? null : m[1]; // [2] longest-runs: volatile ranking, skip (score.length covers it)
      if (cur) { res.counts[cur] = +m[2]; res.lists[cur] = []; }
    } else if (/^\[\d+\]/.test(line)) cur = null; // header without count: attach nothing
    else if (cur && (m = line.match(/^  (\S.*)$/))) res.lists[cur].push(m[1].trim());
    else if (/^== /.test(line)) cur = null;
  }
  return res;
}

function actual(name) {
  const svg = `regress/${name}.svg`;
  const h = sh('harness2.mjs', [svg, `--src=regress/${name}.dsl`]);
  const a = sh('audit-svg.mjs', [svg]);
  return { harness: parseHarness(h.out), audit: parseAudit(a.out) };
}

// ponytail: Phase 4 gate — PID_DEBUG run must report zero invariant failures
// on every canonical sheet (guilty stage named, LOUD via PID-DBG-* errors).
function checkDebug(name, problems) {
  const d = sh('harness2.mjs', [`regress/_dbg-${name}.svg`, `--src=regress/${name}.dsl`, '--debug']);
  const H = parseHarness(d.out);
  const fails = H.errors.filter((e) => e.startsWith('PID-DBG-'));
  if (fails.length) problems.push(`${name}: PID_DEBUG failures ${JSON.stringify(fails.slice(0, 6))}${fails.length > 6 ? ` +${fails.length - 6} more` : ''}`);
}

// ponytail: Phase 3 gate — best-of(legacy + 8 seeds) must not lose to the
// blessed single-render total and must introduce no errors. Legacy always
// competes, so this asserts the selection property, not a gain.
function checkCandidates(name, exp, problems) {
  const c = sh('harness2.mjs', [`regress/_cand-${name}.svg`, `--src=regress/${name}.dsl`, '--candidates=8', '--seedbase=1']);
  const H = parseHarness(c.out);
  if (H.errors.length) problems.push(`${name}: candidates introduced errors ${JSON.stringify(H.errors)}`);
  if (H.score && exp.harness.score && H.score.total > exp.harness.score.total)
    problems.push(`${name}: candidates winner ${H.score.total} worse than blessed ${exp.harness.score.total}`);
}

function diff(name, exp, got, problems) {
  const H = got.harness, E = exp.harness;
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  if (!eq(H.errors, E.errors)) problems.push(`${name}: errors ${JSON.stringify(E.errors)} -> ${JSON.stringify(H.errors)}`);
  if (!eq(H.warnings, E.warnings) || H.warningsTotal !== E.warningsTotal)
    problems.push(`${name}: warnings ${E.warningsTotal}${JSON.stringify(E.warnings)} -> ${H.warningsTotal}${JSON.stringify(H.warnings)}`);
  if (!eq(H.score, E.score)) problems.push(`${name}: score ${JSON.stringify(E.score)} -> ${JSON.stringify(H.score)}`);
  if (!eq(got.audit, exp.audit)) {
    const keys = new Set([...Object.keys(got.audit.counts), ...Object.keys(exp.audit.counts)]);
    for (const k of keys) {
      if (!eq(got.audit.counts[k], exp.audit.counts[k]) || !eq(got.audit.lists[k], exp.audit.lists[k]))
        problems.push(`${name}: audit[${k}] ${JSON.stringify(exp.audit.counts[k])}/${JSON.stringify((exp.audit.lists[k] || []).slice(0, 4))} -> ${JSON.stringify(got.audit.counts[k])}/${JSON.stringify((got.audit.lists[k] || []).slice(0, 4))}`);
    }
    if (got.audit.paths !== exp.audit.paths) problems.push(`${name}: paths ${exp.audit.paths} -> ${got.audit.paths}`);
  }
}

const args = process.argv.slice(2);
const bless = args.includes('--bless');
const only = args.filter((a) => !a.startsWith('--'));
const cases = only.length ? CASES.filter((c) => only.includes(c)) : CASES;
// Always load the existing baselines, including on --bless. A partial bless
// (`--bless spike dense`) used to start from {} and rewrite the file with ONLY
// the blessed cases, silently deleting every other sheet's baseline — which then
// failed as "no baseline (run --bless once)". Merge instead of replace.
let expected = {};
if (existsSync(EXPECTED)) {
  try { expected = JSON.parse(readFileSync(EXPECTED, 'utf8')); }
  catch (e) { console.error(`warn: ${EXPECTED} unreadable (${e.message}) — starting empty`); expected = {}; }
}

const problems = [];
for (const name of cases) {
  const got = actual(name);
  if (bless) {
    // ponytail: budget = 90% of blessed total. Exact-match already pins the
    // total today; Phase 3 enforces total <= budget for candidate acceptance.
    got.budget = Math.round(got.harness.score.total * 0.9);
    expected[name] = got;
    console.log(`blessed ${name} (budget ${got.budget})`);
    continue;
  }
  if (!expected[name]) { problems.push(`${name}: no baseline (run --bless once)`); continue; }
  diff(name, expected[name], got, problems);
  checkCandidates(name, expected[name], problems);
  checkDebug(name, problems);
}
if (bless) {
  const ordered = {};
  for (const c of CASES) if (expected[c]) ordered[c] = expected[c];
  writeFileSync(EXPECTED, JSON.stringify(ordered, null, 1) + '\n');
  console.log('wrote', EXPECTED);
  // Visual baselines are blessed alongside the scalar ones, or they silently go
  // stale on the first scalar re-bless and then report every sheet as CHANGED.
  try { console.log(sh('visual-regress.mjs', ['--bless']).out.trimEnd()); } catch (e) { console.log('  (visual bless skipped: ' + (e.message || e) + ')'); }
  process.exit(0);
}
if (problems.length) {
  console.log('REGRESS FAIL:');
  for (const p of problems) console.log('  -', p);
  process.exit(1);
}
console.log(`REGRESS OK (${cases.join(',')})`);

// ---- visual gate (redesign T0.2) -------------------------------------------
// REPORTING ONLY, deliberately. A scalar total cannot express "reads like a
// drawing", and twice a change that improved the score had to be reverted
// because the sheet looked worse. But promoting this to a hard failure on day
// one would block every legitimate improvement until someone re-blessed, which
// trains people to re-bless reflexively. It reports; a human decides. Revisit
// after it has been clean for a week (see P&ID-ENGINE-REDESIGN.md T0.2).
if (!process.argv.includes('--no-visual')) {
  try {
    console.log('');
    // visual-regress covers the demo too, so only narrow it when a subset was asked for
    const vArgs = only.length ? ['visual-regress.mjs', ...only.map((c) => '--case=' + c)] : ['visual-regress.mjs'];
    console.log(sh('visual-regress.mjs', vArgs).out.trimEnd());
  } catch (e) { console.log('(visual check unavailable: ' + (e.message || e) + ')'); }
}
