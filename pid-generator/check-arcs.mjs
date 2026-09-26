// check-arcs.mjs — find malformed elliptical-arc arguments in the symbol bundle.
//
// WHY THIS EXISTS. Five glyphs carry a sweep flag that is not 0 or 1. SVG requires a
// boolean there. Chrome does NOT reject the path — it recovers, and the recovery
// DROPS THE REMAINDER OF THE PATH. That is what destroys the glyphs: `silencer`
// renders as a stray dome plus one line with the body gone, which is why its ports
// were undecidable in the off-metal audit. The bow direction usually recovers by
// luck; the truncation is the real damage.
//
// Arc argument order is fixed:  A rx ry rot large-arc sweep x y
// so the sweep flag is the FIFTH number. The sweep/large-arc slots are routinely
// confused — an earlier regex-based attempt put the value in the large-arc slot,
// matched nothing, and would have shipped five no-ops if the precondition check had
// not caught it.
//
// This tokenises properly rather than pattern-matching, so argument POSITION is
// authoritative. --write repairs the sweep flags; the correct value must be supplied
// per glyph, because it is a geometric question, not a string question. An earlier
// pass derived the fix by string comparison, recommended 0 for all five, and was
// wrong on all five.
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'pid-symbols-bundle.js';
const ARITY = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };

// SELF-TEST. Hand-read from raw path data before this checker was written.
const SELFTEST = [
  // A16.67 16.67 0 0 0.83 66.67 8.33 -> rx,ry,rot,large=0, sweep=0.83 BAD
  { d: 'M33.33 8.33 A16.67 16.67 0 0 0.83 66.67 8.33 L66.67 25 Z', arcs: 1, badSweep: ['0.83'] },
  // A20 20 0 0 1 80 8 -> well-formed twin of the above (control-valve-globe)
  { d: 'M20 20 A20 20 0 0 1 80 8', arcs: 1, badSweep: [] },
  // sweep 0 is legal and must NOT be flagged
  { d: 'M10 10 A5 5 0 0 0 20 20', arcs: 1, badSweep: [] },
  // large-arc 1 is legal too
  { d: 'M10 10 A5 5 0 1 1 20 20', arcs: 1, badSweep: [] },
  { d: 'M0 0 L10 10', arcs: 0, badSweep: [] },
];

function scan(d) {
  const toks = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const out = [];
  let i = 0, cmd = null;
  while (i < toks.length) {
    const t = toks[i];
    if (/^[a-zA-Z]$/.test(t)) { cmd = t; i++; continue; }
    if (!cmd) { i++; continue; }
    const U = cmd.toUpperCase(), n = ARITY[U];
    if (!n) { i++; continue; }
    const a = toks.slice(i, i + n);
    if (a.length < n) { i++; continue; }
    if (U === 'A') {
      const nums = a.map(Number);
      const large = nums[3], sweep = nums[4];
      out.push({
        ok7: true,
        largeOk: large === 0 || large === 1,
        sweepOk: sweep === 0 || sweep === 1,
        large: nums[3], sweep: nums[4], raw: `A${a.join(' ')}`,
        sweepText: a[4],
      });
    }
    i += n;
  }
  return out;
}

let stFail = 0;
console.log('SELF-TEST (hand-read from raw path data)');
for (const t of SELFTEST) {
  const got = scan(t.d);
  const badSweep = got.filter((g) => !g.sweepOk).map((g) => g.sweepText);
  const ok = got.length === t.arcs && JSON.stringify(badSweep) === JSON.stringify(t.badSweep);
  if (!ok) stFail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  arcs=${got.length} badSweep=[${badSweep}]   ${t.d.slice(0, 46)}`);
}
console.log(stFail ? `\nSELF-TEST FAILED (${stFail}) — the table below is NOT trustworthy\n` : '\nself-test ok\n');
if (stFail) process.exit(1);

const raw = readFileSync(FILE, 'utf8');
const S = JSON.parse(raw.replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, ''));

// Sweep flag is correct iff the arc bulges AWAY from the body. Determined from
// geometry, cross-checked against two independent well-formed siblings that share
// the same y-down convention. `blower` is the trap: its well-formed sibling vane
// bows DOWN with sweep 0, and matching the sibling would give the wrong answer.
const WANT = {
  'isa-5.1/valves/control-valve':      { sweep: '1', why: 'actuator dome must sit on the box; twin of well-formed control-valve-globe "A20 20 0 0 1 80 8"' },
  'isa-5.1/valves/check-valve-swing':   { sweep: '1', why: 'swing envelope must reach the disc tip without crossing the disc' },
  'pip/equipment/agitator':             { sweep: '1', why: 'domed lid; the motor circle spans y 11.11-28.89 and only touches a dome apex at y=31.11' },
  'y32.11-1961/miscellaneous/blower':   { sweep: '1', why: 'mirrors the well-formed LOWER vane which bows down with sweep 0 — matching that sibling would be wrong; 0 is wrong here' },
  'y32.11-1961/miscellaneous/silencer': { sweep: '1', why: 'outlet end-cap must bulge away from the body' },
};

const findings = [];
for (const [key, sym] of Object.entries(S)) {
  for (const m of (sym.svg || '').matchAll(/<path\b[^>]*\bd="([^"]*)"/g)) {
    for (const a of scan(m[1])) {
      if (!a.sweepOk || !a.largeOk) findings.push({ key, ...a });
    }
  }
}
console.log(`malformed arc flags: ${findings.length}\n`);
console.log('  glyph                                          bad     ->  want   sweep   verdict');
let unknown = 0;
for (const f of findings) {
  const w = WANT[f.key];
  if (!w) unknown++;
  console.log(`  ${f.key.padEnd(46)} ${String(f.sweep).padEnd(6)} ->  ${(w ? w.sweep : '?').padEnd(6)} ${(w ? '' : '(NO HAND-COUNTED VALUE — not fixable)')}`);
  if (w) console.log(`         ${w.why}`);
  void f.large;
}
if (!findings.length) { console.log('  none — all arc flags are boolean'); process.exit(0); }
if (unknown) { console.log(`\n${unknown} finding(s) have no adjudicated value. Refusing to apply. Re-derive the bow from geometry first.`); process.exit(1); }

if (!process.argv.includes('--write')) { console.log('\ndry run — pass --write to apply'); process.exit(0); }

let out = raw;
for (const [key, w] of Object.entries(WANT)) {
  const start = out.indexOf(`"${key}":{`);
  if (start < 0) { console.log(`  MISSING ${key}`); continue; }
  let i = out.indexOf('{', start), depth = 0, end = -1;
  for (let j = i; j < out.length; j++) {
    const c = out[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) { end = j + 1; break; } }
  }
  let block = out.slice(start, end);
  let n = 0;
  // NOTE the escaped quotes. This is RAW FILE TEXT, so the svg attribute appears as
  // `d=\"...\"` — a backslash before each quote. A `\bd="` pattern matches nothing
  // here, which is why three earlier attempts set 0 arcs and silently no-opped. The
  // instrumented run (no [dbg] output at all) is what exposed it: the loop body was
  // never entered, so the bug was in the match, not in the rewrite.
  for (const m of block.matchAll(/<path\b[^>]*\bd=\\"([^"]*)\\"/g)) {
    const d = m[1];
    // Replace the path DATA ONLY, keeping the element. The previous version spliced
    // `fixed` (the bare `d` string) in place of the WHOLE match — and the whole match
    // is `<path d="..."/>`, so it deleted the opening tag, the closing quote and the
    // self-closing slash. That silently destroyed the arc in all five glyphs:
    // control-valve and agitator lost their domes, blower lost its vane, and
    // silencer rendered as nothing at all. I read those as "the arc repair failed"
    // when in fact I had broken them. Substitute inside the matched tag instead.
    const fixed = m[0].replace(d, d.replace(/A(\s*[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+)([01])(\s+)([-\d.]+)/g,
      (all, pre, large, sp, sweep) => {
        const v = Number(sweep);
        if (v === 0 || v === 1) return all;      // already legal
        n++;
        return `A${pre}${large}${sp}${w.sweep}`;
      }));
    if (process.env.DBG) console.error(`  [dbg] ${key} ${m[0].slice(0, 40)} -> ${fixed === m[0] ? 'unchanged' : 'CHANGED'}`);
    if (fixed !== m[0]) block = block.slice(0, m.index) + fixed + block.slice(m.index + m[0].length);
  }
  out = out.slice(0, start) + block + out.slice(end);
  console.log(`  ${key}: ${n} arc(s) set to sweep ${w.sweep}`);
}
writeFileSync(FILE, out);

// re-verify from the file we just wrote
const S2 = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, ''));
let left = 0;
for (const [key, sym] of Object.entries(S2)) {
  for (const m of (sym.svg || '').matchAll(/<path\b[^>]*\bd="([^"]*)"/g)) {
    for (const a of scan(m[1])) if (!a.sweepOk || !a.largeOk) { left++; console.log(`  STILL BAD ${key}: ${a.raw}`); }
  }
}
console.log(left ? `\nVERIFY FAILED — ${left} malformed arc(s) remain` : '\nverified from the written file — every arc flag is boolean');
process.exit(left ? 1 : 0);
