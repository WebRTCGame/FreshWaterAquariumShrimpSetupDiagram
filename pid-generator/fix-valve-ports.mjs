// fix-valve-ports.mjs — move left/right ports onto the bowtie's flow axis.
//
// THE DEFECT. Symbol ports are stored as a PERCENTAGE of the viewBox. The ISA valve
// viewBox is "0 0 100 83.33" — 83.33 tall, not 100 — so a port authored as pct 50
// resolves to viewBox y = 41.67 while the flow axis is at y = 50. The percentages
// were written as if every viewBox were square. Two distinct errors result:
//   pct 50 where the axis is y=50   -> 0.83mm high  (gate, ball, globe, butterfly,
//                                     needle-valve, three-way)   should be pct 60
//   pct 100 = the bowtie's BOTTOM   -> 1.67mm low  (control-valve,
//   edge, not its waist               motor-operated-gate)        should be pct 80
// On control-valve the pipe ends up 2.5mm below the flow axis once the engine's
// letterbox-blind portOffset is included, which detaches it from the symbol
// entirely — confirmed by eye, not just by arithmetic.
//
// The axis is measured from the drawn geometry: a bowtie is two closed triangles
// whose apex vertices sit on the symbol's horizontal midline, and both apexes must
// agree. See axis.mjs for the five sampling-based approaches that failed first.
//
//   node fix-valve-ports.mjs            dry run (default)
//   node fix-valve-ports.mjs --write    apply, then re-verify from the written file
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'pid-symbols-bundle.js';
const AR = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };
const vbOf = (svg) => { const m = svg.match(/viewBox="([^"]+)"/); if (!m) return null; const p = m[1].split(/[\s,]+/).map(Number); return p.length === 4 ? { x: p[0], y: p[1], w: p[2], h: p[3] } : null; };

function vertices(d) {
  const toks = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const out = []; let i = 0, cmd = null, cx = 0, cy = 0, sx = 0, sy = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (/^[a-zA-Z]$/.test(t)) { cmd = t; i++; if (cmd === 'Z' || cmd === 'z') { cx = sx; cy = sy; } continue; }
    if (!cmd) { i++; continue; }
    const U = cmd.toUpperCase(), rel = cmd !== U, n = AR[U]; if (!n) { i++; continue; }
    const a = toks.slice(i, i + n).map(Number); if (a.length < n) break;
    if (U === 'H') cx = rel ? cx + a[0] : a[0];
    else if (U === 'V') cy = rel ? cy + a[0] : a[0];
    else if (U === 'A') { cx = rel ? cx + a[5] : a[5]; cy = rel ? cy + a[6] : a[6]; }
    else if (U === 'C' || U === 'S' || U === 'Q') { cx = rel ? cx + a[a.length - 2] : a[a.length - 2]; cy = rel ? cy + a[a.length - 1] : a[a.length - 1]; }
    else { cx = rel ? cx + a[0] : a[0]; cy = rel ? cy + a[1] : a[1]; }
    out.push([cx, cy]);
    if (U === 'M') { sx = cx; sy = cy; }
    i += n;
  }
  return out;
}
function extentX(svg) {
  let lo = Infinity, hi = -Infinity;
  const put = (x) => { if (Number.isFinite(x)) { lo = Math.min(lo, x); hi = Math.max(hi, x); } };
  for (const m of svg.matchAll(/<path\b[^>]*>/gi)) { const d = m[0].match(/\bd="([^"]*)"/); if (d) for (const v of vertices(d[1])) put(v[0]); }
  for (const m of svg.matchAll(/<(line|polyline|polygon)\b[^>]*>/gi)) {
    const at = {}; for (const a of m[0].matchAll(/([\w-]+)="([^"]*)"/g)) at[a[1]] = a[2];
    if (at.x1 !== undefined) { put(+at.x1); put(+at.x2); }
    if (at.points) for (const p of at.points.trim().split(/\s+/)) put(+p.split(/[ ,]+/)[0]);
  }
  for (const m of svg.matchAll(/<circle\b[^>]*>/gi)) {
    const g = (n) => { const r = m[0].match(new RegExp(`\\b${n}="([^"]*)"`)); return r ? +r[1] : NaN; };
    const cx = g('cx'), r = g('r'); if (Number.isFinite(cx) && Number.isFinite(r)) { put(cx - r); put(cx + r); }
  }
  return Number.isFinite(lo) ? { lo, hi } : null;
}
function axisY(svg) {
  const ext = extentX(svg); if (!ext) return null;
  const xm = (ext.lo + ext.hi) / 2, tol = (ext.hi - ext.lo) * 0.04;
  const paths = [];
  for (const m of svg.matchAll(/<path\b[^>]*>/gi)) {
    const d = m[0].match(/\bd="([^"]*)"/); if (!d || !/[Zz]/.test(d[1])) continue;
    const vs = vertices(d[1]); if (vs.length < 3) continue;
    const xs = vs.map((v) => v[0]), px0 = Math.min(...xs), px1 = Math.max(...xs);
    if (px1 - px0 < (ext.hi - ext.lo) * 0.25) continue;
    for (const [x, y] of vs) if (Math.abs(x - xm) <= tol) { paths.push({ y, x0: px0, x1: px1 }); break; }
  }
  if (!paths.length) return null;
  const byY = new Map();
  for (const p of paths) { const k = p.y.toFixed(2); if (!byY.has(k)) byY.set(k, []); byY.get(k).push(p); }
  const agreed = [...byY.values()].filter((g) => g.length >= 2 && g.some((p) => p.x1 <= xm + tol) && g.some((p) => p.x0 >= xm - tol));
  if (!agreed.length) return null;
  agreed.sort((a, b) => b.length - a.length);
  return agreed[0][0].y;
}

// ---- plan ----
const raw = readFileSync(FILE, 'utf8');
const S = JSON.parse(raw.replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, ''));
const plan = [];
for (const [key, sym] of Object.entries(S)) {
  const vb = vbOf(sym.svg || ''); if (!vb) continue;
  const ay = axisY(sym.svg); if (ay === null) continue;
  const need = 100 * (ay - vb.y) / vb.h;
  for (const p of (sym.ports || [])) {
    if (p.x !== 0 && p.x !== 100) continue;
    if (Math.abs(p.y - need) <= 0.5) continue;
    plan.push({ key, id: p.id, from: p.y, to: +need.toFixed(2) });
  }
}
console.log(`fix-valve-ports — ${plan.length} port(s) in ${new Set(plan.map((p) => p.key)).size} symbol(s)\n`);
for (const f of plan) console.log(`  ${f.key.padEnd(34)} ${f.id.padEnd(7)} pct ${String(f.from).padStart(5)} -> ${String(f.to).padStart(5)}`);
if (!plan.length) { console.log('\nnothing to do'); process.exit(0); }

// ---- apply by targeted text surgery, so untouched symbols stay byte-identical ----
if (!process.argv.includes('--write')) { console.log('\ndry run — pass --write to apply'); process.exit(0); }
let out = raw;
for (const f of plan) {
  const kStart = out.indexOf(`"${f.key}":{`);
  if (kStart < 0) throw new Error(`symbol not found in text: ${f.key}`);
  // find this symbol's JSON object extent by brace matching
  let i = out.indexOf('{', kStart), depth = 0, end = -1;
  for (let j = i; j < out.length; j++) {
    const c = out[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) { end = j + 1; break; } }
  }
  if (end < 0) throw new Error(`unbalanced JSON for ${f.key}`);
  let block = out.slice(kStart, end);
  // scope the edit to THIS port object: "id":"<id>" ... "y":<from>
  const pid = `"id":"${f.id}"`;
  const pAt = block.indexOf(pid);
  if (pAt < 0) throw new Error(`port ${f.id} not found in ${f.key}`);
  const yAt = block.indexOf(`"y":${f.from}`, pAt);
  if (yAt < 0 || yAt > pAt + 1200) throw new Error(`port y not found for ${f.key}/${f.id}`);
  block = block.slice(0, yAt) + `"y":${f.to}` + block.slice(yAt + `"y":${f.from}`.length);
  out = out.slice(0, kStart) + block + out.slice(end);
}
writeFileSync(FILE, out);

// ---- re-verify from the file we just wrote, not from memory ----
const S2 = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, ''));
let fail = 0;
for (const f of plan) {
  const sym = S2[f.key], vb = vbOf(sym.svg), ay = axisY(sym.svg);
  const port = sym.ports.find((p) => p.id === f.id);
  const resolved = vb.y + (port.y / 100) * vb.h;
  const ok = ay !== null && Math.abs(resolved - ay) < 0.5;
  if (!ok) fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${f.key.padEnd(34)} ${f.id.padEnd(7)} now pct ${port.y} -> viewBox y ${resolved.toFixed(2)} (axis ${ay === null ? '?' : ay.toFixed(2)})`);
}
console.log(fail ? `\nVERIFY FAILED for ${fail} port(s)` : '\nverified from the written file — all ports on axis');
process.exit(fail ? 1 : 0);
