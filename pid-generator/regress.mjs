import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
// ponytail: regression suite for the split-file stack (Phase 0 of the plan).
// Usage (cwd must be pid-generator/): node regress.mjs [--bless] [case...]
// Cases: regress/<name>.dsl -> renders + audits -> compares with expected.json.
// Fails on: any error, any warning change, score change, any audit count change.
// Title block carries today's date, so SVG bytes are NOT compared — only the
// machine-checked facts (errors/warnings/score/audit).
const CASES = ['spike', 'min', 'dense', 'split', 'manifold'];
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
// blessed single-render total, and must introduce no errors or warnings.
//
// T0.3: this used to assert `<= blessed`, which is not a property any layout engine
// can have. `--candidates=8` turns on the LAYOUT SEED, so every candidate is a
// *noise-perturbed* re-render (`pid-renderer.js`: `layoutSeed = !nLayouts ? null :
// seedBase + L*1000`), while the blessed path is the noise-FREE single search.
// Noise can only move a search away from an optimum, never closer, so the strict
// form asserts that a perturbed multi-start beats a noise-free search. It passed
// only while the default search was weak enough for the noisy run to tie it; the
// moment `rowSpacing` was added as a search dimension the default got stronger
// (dense 462 -> 445) and the gap opened. The diagnosis is confirmed by the fact
// that widening the row search improved dense and still did not close it.
//
// So the gate is now: no new ERRORS, the PREFERENCE part of the total not worse by
// more than NOISE_TOLERANCE, and the search deterministic. The measured deltas —
// including the warning count — are printed every run, because a tolerance gate
// hides a steadily-widening gap unless someone is looking.
//
// The comparison is on `total - lines.breach`, not on `total`. The breach term is a
// property of the DRAWING as much as of the arrangement (min.dsl is two valves and
// every one of its candidates carries the same 8.5mm short lead-in), so including
// it puts a constant on both sides and makes the relative tolerance meaningless on
// exactly the small sheets where the constant dominates.
//
// Warnings are a DIAGNOSTIC here, not a gate. They are already inside the total at
// 5 each, and a separate "same warning count" assertion misfires in the direction
// that matters: an assertion the search must not add warnings is an assertion that
// punishes it for finding a better layout. On spike it did exactly that — the
// perturbed search returned 919 against the blessed 938, with 9 warnings against 11
// and half the lead-in breach — and the suite reported a regression.
const NOISE_TOLERANCE = 0.15;
// Determinism is the property this check can assert exactly, so it is asserted
// exactly: a second run of the same command must produce the same score. The
// engine is documented as "no RNG, so a sheet always reproduces" and nothing was
// checking it.
function checkCandidates(name, exp, problems) {
  const args = [`regress/_cand-${name}.svg`, `--src=regress/${name}.dsl`, '--candidates=8', '--seedbase=1'];
  const c = sh('harness2.mjs', args);
  const H = parseHarness(c.out);
  if (H.errors.length) problems.push(`${name}: candidates introduced errors ${JSON.stringify(H.errors)}`);
  const E = exp.harness;
  let delta = null;
  const pref = (s) => s.total - ((s.lines && s.lines.breach) || 0);
  if (H.score && E.score) {
    const pE = pref(E.score), pH = pref(H.score);
    delta = pH - pE;
    const cap = Math.ceil(pE * NOISE_TOLERANCE);
    if (delta > cap) problems.push(`${name}: candidates preference score ${pH} worse than blessed ${pE} by ${delta} (tolerance ${cap})`);
    const again = parseHarness(sh('harness2.mjs', args).out);
    if (again.score && H.score && again.score.total !== H.score.total)
      problems.push(`${name}: candidates search is NOT deterministic (${H.score.total} then ${again.score.total})`);
  }
  return { delta, blessed: { score: E.score, warningsTotal: E.warningsTotal }, cand: { score: H.score, warningsTotal: H.warningsTotal } };
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
const deltas = [];

// The text metric is the INPUT to every clearance in the engine — the router
// reserves space with it and the renderer draws into it — so its self-test runs as
// part of the suite rather than as something a developer remembers to poke.
{
  const { default: PIDText } = await import('./pid-textmetrics.js');
  const f = PIDText.selfTest();
  if (f.length) problems.push(`pid-textmetrics: ${f.length} self-test failure(s) ${JSON.stringify(f.slice(0, 4))}`);
}
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
  const d = checkCandidates(name, expected[name], problems);
  if (d) deltas.push([name, d.blessed, d.cand, d.delta]);
  checkDebug(name, problems);
}
if (deltas.length) {
  console.log('candidates vs blessed (perturbed multi-start vs noise-free default; breach term shown separately, see T0.3):');
  for (const [n, b, a, d] of deltas) {
    const br = (h) => (h.score && h.score.lines && h.score.lines.breach) || 0;
    const sc = (h) => (h.score ? h.score.total : 0);
    console.log(`  ${n.padEnd(9)} ${String(sc(b)).padStart(5)} (pref ${String(sc(b) - br(b)).padStart(5)}, breach ${String(br(b)).padStart(3)}, warn ${b.warningsTotal})` +
      ` -> ${String(sc(a)).padStart(5)} (pref ${String(sc(a) - br(a)).padStart(5)}, breach ${String(br(a)).padStart(3)}, warn ${a.warningsTotal})   pref ${d >= 0 ? '+' : ''}${d}`);
  }
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
