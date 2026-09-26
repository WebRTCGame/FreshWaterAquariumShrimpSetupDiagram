// fix-symbol-defects.mjs — move the remaining off-axis symbol ports onto their flow
// axis. Dry-run by default; --write applies and then re-verifies from the file it
// just wrote.
//
// SCOPE NOTE. This script originally also repaired the five non-boolean arc sweep
// flags. That work now lives in `check-arcs.mjs`, which did it and re-verified
// ("malformed arc flags: 0"). When it was done, this script REFUSED to run because
// the arcs' precondition no longer held. That is the precondition guard working, not
// a bug: two writers on the same data is how five no-ops would have shipped.
//
// Every value below was hand-counted from raw path data by an independent worker
// running a self-test, and the evidence is recorded beside each entry.
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'pid-symbols-bundle.js';

const PORTS = [
  // angle-valve: the inlet stub is DRAWN at y=75 but the port said pct 50 = y 50.
  // Both triangles share exactly one vertex, (50,75) — the apex — and the non-apex
  // edge (8.33,58.33)-(8.33,91.67) has midpoint y=75.00, which corroborates.
  // 2.5mm out at size 10; confirmed by a render in which the pipe has to jog.
  ['isa-5.1/valves/angle-valve', 'inlet',  50, 75],
  // ...and its outlet was parked ON the bowtie apex, so the outlet pipe left
  // horizontally straight through the valve body. The stem is drawn upward
  // (flowAxis "v"), so the outlet belongs at the stem's free end.
  ['isa-5.1/valves/angle-valve', 'outlet', 50, 8.33],
  // Three ISA check valves: the flow run is drawn at viewBox y=50, but the viewBoxes
  // are 83.33 and 75 tall, so pct 50 does not land on it. Same class as the valve
  // family fixed by fix-valve-ports.mjs.
  ['isa-5.1/valves/check-valve',       'left',  50, 60],
  ['isa-5.1/valves/check-valve',       'right', 50, 60],
  ['isa-5.1/valves/check-valve-lift',  'left',  50, 66.67],
  ['isa-5.1/valves/check-valve-lift',  'right', 50, 66.67],
  ['isa-5.1/valves/check-valve-swing', 'left',  50, 66.67],
  ['isa-5.1/valves/check-valve-swing', 'right', 50, 66.67],
  // circle and stubs sit at y=52.73 in a 90.91-tall viewBox
  ['y32.11-1961/pumps/pump-vertical-turbine', 'inlet',  50, 58],
  ['y32.11-1961/pumps/pump-vertical-turbine', 'outlet', 50, 58],
];

// `pip/equipment/compressor` is deliberately EXCLUDED. The worker that found it
// flagged it lower-confidence: "the x-gaps make the whole port scheme questionable;
// wants a human". Shipping a guess is worse than leaving a known defect visible.

const raw = readFileSync(FILE, 'utf8');
const S = JSON.parse(raw.replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, ''));

const plan = [];
for (const [key, id, from, to] of PORTS) {
  const sym = S[key];
  if (!sym) { console.log(`  MISSING SYMBOL ${key}`); process.exit(1); }
  const p = (sym.ports || []).find((q) => q.id === id);
  if (!p) { console.log(`  MISSING PORT ${key}/${id}`); process.exit(1); }
  plan.push({ key, id, from, to, actual: p.y });
}
const stale = plan.filter((p) => p.actual !== p.from);
console.log(`fix-symbol-defects — ${plan.length} port(s)\n`);
for (const p of plan) {
  const ok = p.actual === p.from;
  console.log(`  ${ok ? '   ' : '!! '}${p.key.padEnd(38)} ${p.id.padEnd(7)} pct ${String(p.from).padStart(5)} -> ${String(p.to).padEnd(5)}${ok ? '' : `  currently ${p.actual}`}`);
}
if (stale.length) {
  console.log(`\n${stale.length} port(s) do not match the stated precondition — refusing to apply. Re-derive from the path data first.`);
  process.exit(1);
}
if (!process.argv.includes('--write')) { console.log('\ndry run — pass --write to apply'); process.exit(0); }

// ---- apply by brace-matched text surgery, so untouched symbols stay identical ----
let out = raw;
for (const p of plan) {
  const s = out.indexOf(`"${p.key}":{`);
  if (s < 0) throw new Error(`symbol not found: ${p.key}`);
  let i = out.indexOf('{', s), depth = 0, end = -1;
  for (let j = i; j < out.length; j++) {
    const c = out[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) { end = j + 1; break; } }
  }
  if (end < 0) throw new Error(`unbalanced JSON for ${p.key}`);
  let block = out.slice(s, end);
  const at = block.indexOf(`"id":"${p.id}"`);
  if (at < 0) throw new Error(`port ${p.id} not found in ${p.key}`);
  const yAt = block.indexOf(`"y":${p.from}`, at);
  if (yAt < 0 || yAt > at + 1400) throw new Error(`port y not found for ${p.key}/${p.id}`);
  block = block.slice(0, yAt) + `"y":${p.to}` + block.slice(yAt + `"y":${p.from}`.length);
  out = out.slice(0, s) + block + out.slice(end);
}
writeFileSync(FILE, out);

// ---- re-verify from the file we just wrote, not from memory ----
const S2 = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, ''));
let fail = 0;
for (const p of plan) {
  const got = S2[p.key].ports.find((q) => q.id === p.id).y;
  const ok = got === p.to;
  if (!ok) fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${p.key.padEnd(38)} ${p.id.padEnd(7)} now ${got}`);
}
console.log(fail ? `\nVERIFY FAILED for ${fail}` : '\nverified from the written file');
process.exit(fail ? 1 : 0);
