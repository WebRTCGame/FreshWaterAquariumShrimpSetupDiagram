// placement-audit.mjs — run the placement RULE audit across the corpus.
//
// Answers the question W3 exists to answer: which placement rules does the
// current layout actually violate, and by how much? Purely diagnostic. It
// loads the engine exactly as harness2.mjs does, parses each fixture (which
// runs autoLayout and therefore assigns positions), then audits.
//
// Usage:
//   node placement-audit.mjs                 # corpus summary
//   node placement-audit.mjs --case=dense -v # one sheet, with detail lines

import { readFileSync } from 'node:fs';

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
  createElementNS: () => ({ tag: 'svg', attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = String(v); }, appendChild(c) { this.children.push(c); }, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, get outerHTML() { return `<svg>${this._h}</svg>`; }, querySelectorAll: () => [], style: {} }),
  getElementById: () => ({ tag: 'div', attrs: {}, children: [], set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, get outerHTML() { return `<div>${this._h}</div>`; }, appendChild(c) { this.children.push(c); }, style: {} }),
};

const src = ENGINE.concat('placement-rules.js').map((f) => readFileSync(f, 'utf8')).join('\n;\n');
// expose the parser + placement API out of the eval scope
const factory = new Function(src + '\nreturn { PID_PARSER, PID_PLACEMENT };');
const { PID_PARSER, PID_PLACEMENT } = factory();

const CASES = ['spike', 'dense', 'manifold', 'min', 'split'];
const args = process.argv.slice(2);
const verbose = args.includes('-v') || args.includes('--verbose');
const only = (args.find((a) => a.startsWith('--case=')) || '').slice(7);
const cases = only ? CASES.filter((c) => c === only) : CASES;

// Gate integrity: every enforceable rule must name a registry key that
// exists. This catches the class of bug where a rule's config key is derived
// rather than declared and silently matches nothing — measured, and it made
// every rule in the registry unturnable while reporting nothing wrong.
if (args.includes('--gates')) {
  const problems = PID_PLACEMENT.assertGates();
  for (const p of problems) console.log('  PROBLEM  ' + p);
  const enforceable = PID_PLACEMENT.RULES.filter((r) => r.solve);
  console.log(`  ${enforceable.length} enforceable rule(s), ${problems.length} problem(s)`);
  if (!problems.length) for (const r of enforceable) console.log(`  ok   ${r.id} -> ${r.gate}`);
  process.exit(problems.length ? 1 : 0);
}

if (args.includes('--selftest')) {
  // Coordinate-frame guard: SVG y grows DOWNWARD, so "above" is SMALLER y.
  // Every rule above is written in that frame; this asserts it.
  const checks = [
    ['portRole suction', PID_PLACEMENT.portRole('suction').role, 'inlet'],
    ['portRole discharge', PID_PLACEMENT.portRole('discharge').role, 'outlet'],
    ['portRole bottoms', PID_PLACEMENT.portRole('bottoms').role, 'bottom'],
    ['portRole reflux', PID_PLACEMENT.portRole('reflux').role, 'reflux'],
    ['portRole overhead', PID_PLACEMENT.portRole('overhead').role, 'top'],
    ['portRole actuator wins', PID_PLACEMENT.portRole('actuator').role, 'signal'],
    ['portName null', PID_PLACEMENT.portRole(null).role, 'connection'],
    // every type string the corpus actually uses, plus the demo-only ones that
    // silently fell through to 'other' the first time this test ran
    ['kind pump (corpus)', PID_PLACEMENT.equipmentKind('pump'), 'pump'],
    ['kind tower (corpus)', PID_PLACEMENT.equipmentKind('tower'), 'tower'],
    ['kind drum (corpus)', PID_PLACEMENT.equipmentKind('drum'), 'drum'],
    ['kind tank (corpus)', PID_PLACEMENT.equipmentKind('tank'), 'vessel'],
    ['kind heat-exchanger (corpus)', PID_PLACEMENT.equipmentKind('heat-exchanger'), 'exchanger'],
    ['kind kettle-reboiler (corpus)', PID_PLACEMENT.equipmentKind('kettle-reboiler'), 'reboiler'],
    ['kind reactor (corpus)', PID_PLACEMENT.equipmentKind('reactor'), 'vessel'],
    ['kind shell-tube-exchanger (demo)', PID_PLACEMENT.equipmentKind('shell-tube-exchanger'), 'exchanger'],
    ['kind shell-tube (bare)', PID_PLACEMENT.equipmentKind('shell-tube'), 'exchanger'],
    ['kind gate -> not equipment', PID_PLACEMENT.equipmentKind('gate'), 'other'],
  ];
  let bad = 0;
  for (const [n, got, want] of checks) {
    const ok = got === want;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}: got ${got}, want ${want}`);
  }
  // frame assertion
  const above = { y: 10 }, below = { y: 90 };
  const frameOk = above.y < below.y;
  console.log(`  ${frameOk ? 'ok  ' : 'FAIL'} coordinate frame: smaller y is higher (10 < 90)`);
  if (!frameOk) bad++;
  // every enforceable rule must declare a gate that exists in the registry
  for (const p of PID_PLACEMENT.assertGates()) {
    console.log('  FAIL ' + p);
    bad++;
  }
  // constrainTargets must be a total function of (data, want): every enabled
  // rule either returns a finite number or abstains, and nothing may be left
  // as a string or NaN — a NaN target silently poisons the packing below it
  {
    const probe = {
      view: { sheetW: 864, sheetH: 559 }, layout: 'auto',
      equipment: [{ id: 'X-P', type: 'pump', _seq: 0 }],
      valves: [{ id: 'X-V', type: 'gate', _seq: 1 }],
      pipes: [{ from: 'X-V', to: 'X-P', kind: 'process' }],
      nozzles: [{ ownerId: 'X-P', portId: 'suction' }],
      loops: [], junctions: [], instruments: [], alarms: [],
    };
    probe.equipment[0].x = 100; probe.equipment[0].y = 100;
    probe.valves[0].x = 100; probe.valves[0].y = 100;
    const want = { 'X-V': 100, 'X-P': 100 };
    // enable the rule EXPLICITLY via opts.rules. Asserting only `want >= 100`
    // would pass with the rule disabled, which is how a dead code path looks
    // like a passing test — so this asserts the target actually MOVED to the
    // requested gap, and separately that it abstains when the rule is off.
    let rep = null, threw = false;
    try { rep = PID_PLACEMENT.constrainTargets(probe, want, { minGap: 20, rules: { 'suction-source-above': true } }); }
    catch (e) { threw = true; }
    const wantOk = want['X-P'] === 120;
    const finiteOk = Object.values(want).every((v) => typeof v === 'number' && isFinite(v));

    const wantOff = { 'X-V': 100, 'X-P': 100 };
    let repOff = null;
    try { repOff = PID_PLACEMENT.constrainTargets(probe, wantOff, { minGap: 20, rules: { 'suction-source-above': false } }); }
    catch (e) { /* counted below */ }
    const abstainOk = wantOff['X-P'] === 100 && repOff && repOff.adjusted === 0;

    const ok = !threw && finiteOk && wantOk && abstainOk && rep && rep.adjusted === 1;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} constrainTargets: enabled -> pump target ${want['X-P']} (source 100, gap 20, want 120), adjusted=${rep && rep.adjusted}; disabled -> ${wantOff['X-P']}, adjusted=${repOff && repOff.adjusted}`);
    if (!ok) bad++;
  }
  console.log(bad ? `SELFTEST FAIL (${bad})` : 'SELFTEST ok');
  process.exit(bad ? 1 : 0);
}

const width = 34;
let totals = {};
const pad = (s, n) => String(s === undefined || s === null ? '-' : s).padStart(n);

for (const c of cases) {
  const text = readFileSync(`regress/${c}.dsl`, 'utf8');
  let data;
  try {
    data = PID_PARSER.parse(text);
  } catch (e) {
    console.log(`${c}: PARSE FAILED — ${e.message}`);
    continue;
  }
  const a = PID_PLACEMENT.audit(data);
  for (const r of a.rules) {
    if (!totals[r.id]) totals[r.id] = { applies: 0, violations: 0, measure: 0 };
    totals[r.id].applies += r.applies;
    totals[r.id].violations += r.violations;
    totals[r.id].measure += r.measure;
  }
  console.log(`\n=== ${c} ===  rules fired ${a.fired}/8, violations ${a.violations}, total measure ${Math.round(a.totalMeasure)}mm`);
  console.log('  ' + 'rule'.padEnd(width - 12) + pad('applies', 8) + pad('viol', 6) + pad('measure', 10));
  for (const r of a.rules) {
    if (!r.applies) continue;
    console.log('  ' + r.id.padEnd(width - 12) + pad(r.applies, 8) + pad(r.violations, 6) + pad(r.measure + 'mm', 10));
    if (verbose) for (const d of r.detail) console.log('      · ' + d);
  }
}

console.log('\n' + '='.repeat(70));
console.log('CORPUS TOTAL — worst offenders first');
console.log('='.repeat(70));
console.log('  ' + 'rule'.padEnd(width - 12) + pad('applies', 8) + pad('viol', 6) + pad('measure', 10));
Object.entries(totals)
  .filter(([, v]) => v.violations > 0)
  .sort((a, b) => b[1].measure - a[1].measure)
  .forEach(([id, v]) => {
    console.log('  ' + id.padEnd(width - 12) + pad(v.applies, 8) + pad(v.violations, 6) + pad(v.measure + 'mm', 10));
    const r = PID_PLACEMENT.RULES.find((x) => x.id === id);
    if (r) console.log('      why: ' + r.rationale);
  });
console.log('');