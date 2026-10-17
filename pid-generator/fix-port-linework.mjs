// fix-port-linework.mjs — move every symbol port onto the drawn linework.
//
// THE DEFECT (drafting, not cosmetic). A P&ID symbol is drawn ON the process line: the
// symbol's own linework IS the pipe run, and the pipe is continuous through it. A port
// that does not terminate on that linework leaves a gap between the pipe end and the
// metal. A break in a run is meaningful on a P&ID — it marks a SPEC BREAK, and it is
// always labelled (AVEVA P&ID distinguishes "label breaks at the ends of pipes" from
// "inline/spec breaks within a pipe run"; AutoCAD Plant 3D draws a spec-breaker symbol
// carrying both specs). An UNLABELLED break reads as "not connected" to every reader,
// including the layout engine, which routes the pipe to the port and stops there.
//
// Two shapes of the same defect, both fixed by the same operation:
//   GAP      port is off the ink entirely             (check-valve left: pct x 0 vs ink 8.33)
//   OVERLAP  port is on the ink but short of its end  (flange base: pct 15 vs line start 10.71)
//            — the pipe then runs co-linear back over metal it already reached
//
// THE RULE. A port terminates at the end of the drawn linework on the side the pipe
// arrives from: among ink points that lie ON the cardinal arrival axis AND on the port's
// own side of the ink centre, take the one furthest along that axis. Cardinal because
// pipe runs are orthogonal — the raw centre->port vector is diagonal on any symbol whose
// ink is not symmetric about that port's axis (control-valve's body sits low, its ports
// sit high), and a diagonal axis then picks linework off to one side of the flow line.
// The side guard is what stops a bogus axis selecting the far end of the glyph:
// flow-nozzle and venturi-tube draw only the two converging pipe walls, with no
// centreline, so their ports meet no ink on their own side and fall through to the
// nearest metal, which still closes the gap.
//
// A glyph that draws an explicit lead-in stub is left alone by construction: the stub IS
// ink, so its outer end is the furthest point along the axis and the port is already
// there. angle-valve is the library's example of that, and it moves 0 mm.
//
// ANCHOR is repaired in the same pass. anchor is PERCENT of the viewBox
// (PIDEngine.anchorOffset), so the value that lands on the ink centre is
// (100*(cx-vb.x)/vb.w, 100*(cy-vb.y)/vb.h). The shipped audit-symbols.mjs grades anchor
// in viewBox UNITS instead, so it scores the 50/50 placeholders as correct and misses
// every real one; 70 of the 123 non-square symbols are authored under the percent
// reading, which is the one the engine uses.
//
//   node fix-port-linework.mjs            dry run (default)
//   node fix-port-linework.mjs --write    apply, then re-verify from the written file
import { readFileSync, writeFileSync } from 'node:fs';
import { vbOf, ink, inkBBox, inkPoints, gapToInk, maxStroke, dPointSeg } from './symbol-ink.mjs';

const FILE = 'pid-symbols-bundle.js';
const attrOf = (s, n) => { const m = (s || '').match(new RegExp(`\\b${n}="([^"]*)"`)); return m ? parseFloat(m[1]) : NaN; };
const raw = readFileSync(FILE, 'utf8');
const symbols = JSON.parse(raw.replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, ''));

// Role -> arrival direction, used only when a port sits ON the ink centre and so carries
// no geometric direction of its own.
const INBOUND = {
  left: [-1, 0], inlet: [-1, 0], suction: [-1, 0], base: [-1, 0], feed: [-1, 0], feedwater: [-1, 0],
  right: [1, 0], outlet: [1, 0], discharge: [1, 0], tip: [1, 0], product: [1, 0],
  top: [0, -1], vent: [0, -1], gas_out: [0, -1], overhead: [0, -1],
  bottom: [0, 1], liquid_out: [0, 1], bottoms: [0, 1], drain: [0, 1], condensate: [0, 1],
  motive: [0, -1], fuel: [0, -1], burner: [0, -1],
};

const repairs = [];   // {key, field:'ports'|'anchor', id, from, to, why}
const review = [];
let alreadyPorts = 0, alreadyAnchors = 0;

for (const [key, sym] of Object.entries(symbols)) {
  const svg = sym.svg || '';
  const vb = vbOf(svg);
  const g = ink(svg);
  const bb = inkBBox(g);
  if (!vb || !bb || (!g.segs.length && !g.circles.length)) continue;
  const P = inkPoints(g, 0.25);
  // "on the arrival axis". Loose on purpose: the axis is drawn through the port's OWN
  // position, so a port that was mis-authored a little high must still be able to see the
  // line it belongs to. Too tight and the sweep picks linework off to one side — the
  // sight-glass's port sits 5.4u above its own pipe line and a 2.8u tolerance sent it to
  // the lens instead, leaving the line dangling.
  const AXIS_TOL = Math.max(3, Math.max(vb.w, vb.h) * 0.06);
  const halfStroke = maxStroke(g) / 2;

  for (const p of (sym.ports || [])) {
    const X = vb.x + (p.x / 100) * vb.w, Y = vb.y + (p.y / 100) * vb.h;
    const gap = gapToInk(g, X, Y);

    // Arrival direction = the cardinal axis the port is ON, relative to the ink box.
    // Outside the box on one axis -> that axis (the pipe is coming from beyond the metal).
    // Inside on both -> the larger normalised offset from the centre. Snapping the raw
    // centre->port vector instead goes diagonal whenever a port is not symmetric about
    // the centre (compressor's discharge sits near the top-right corner of its trapezoid,
    // and a diagonal axis then drags the port along a face instead of to its end).
    let ax = 0, ay = 0;
    const eps = 1e-6;
    const outL = X < bb.x0 - eps, outR = X > bb.x1 + eps, outT = Y < bb.y0 - eps, outB = Y > bb.y1 + eps;
    if (outL !== outR) ax = outL ? -1 : 1;
    if (outT !== outB) ay = outT ? -1 : 1;
    if (!ax && !ay) {
      const nx = (X - bb.cx) / (bb.x1 - bb.cx || 1), ny = (Y - bb.cy) / (bb.y1 - bb.cy || 1);
      if (Math.abs(nx) >= Math.abs(ny)) ax = Math.sign(nx) || 1; else ay = Math.sign(ny) || 1;
    }
    if (!ax && !ay) {
      const role = INBOUND[String(p.id || '').toLowerCase()];
      if (!role) { review.push({ key, field: 'port', id: p.id, why: `sits on the ink centre (${X.toFixed(1)},${Y.toFixed(1)}); role "${p.id}" gives no arrival direction` }); continue; }
      [ax, ay] = role;
    }
    const dx = ax, dy = ay;
    const onAxis = (x, y) => Math.abs(-dx * (y - Y) + dy * (x - X));
    const proj = (x, y) => x * dx + y * dy;
    const centreProj = proj(bb.cx, bb.cy);
    const portSide = Math.sign(proj(X, Y) - centreProj) || 1;

    // A port already ON the ink only moves if it is short of the end of a segment that
    // runs PARALLEL to the arrival axis — that is the co-linear overlap, where the pipe
    // runs back over metal it already reached. A port sitting on linework that meets the
    // pipe head-on (a vessel wall, a bubble, a vertical face the pipe arrives at) is
    // already right wherever along it the pipe lands, and dragging it to an end is a
    // defect, not a repair.
    const onInk = gap <= halfStroke;
    if (onInk) {
      let parallel = false;
      for (const [x1, y1, x2, y2] of g.segs) {
        if (dPointSeg(X, Y, x1, y1, x2, y2) > halfStroke) continue;
        const L = Math.hypot(x2 - x1, y2 - y1) || 1;
        const cos = Math.abs(((x2 - x1) / L) * dx + ((y2 - y1) / L) * dy);
        if (cos >= 0.7) { parallel = true; break; }
      }
      if (!parallel) { alreadyPorts++; continue; }
    }

    let target = null, best = -Infinity, bestPerp = Infinity;
    for (const [x, y] of P) {
      const a = onAxis(x, y);
      if (a > AXIS_TOL) continue;
      const pr = proj(x, y);
      if (Math.sign(pr - centreProj) !== portSide) continue;
      if (pr > best + 1e-9 || (Math.abs(pr - best) <= 1e-9 && a < bestPerp)) { best = pr; bestPerp = a; target = [x, y]; }
    }
    if (!target) {
      let bestD = Infinity;
      for (const [x, y] of P) { const d = Math.hypot(x - X, y - Y); if (d < bestD) { bestD = d; target = [x, y]; } }
    }
    if (!target) continue;
    const moved = Math.hypot(target[0] - X, target[1] - Y);
    if (moved <= Math.max(0.05, halfStroke)) { alreadyPorts++; continue; }
    const nx = Math.min(vb.x + vb.w, Math.max(vb.x, target[0]));
    const ny = Math.min(vb.y + vb.h, Math.max(vb.y, target[1]));
    repairs.push({
      key, field: 'ports', id: p.id, from: [p.x, p.y],
      to: [((nx - vb.x) / vb.w) * 100, ((ny - vb.y) / vb.h) * 100],
      fromU: [X, Y], toU: [nx, ny], gap,
      why: gap > halfStroke ? 'off the linework' : 'short of the linework end',
    });
  }

  // ---- a third copy of the ports lives inside three glyphs as <connection> tags ----
  // symbolConnections reads entry.ports FIRST, so these are dead weight that can only
  // drift -- and drifting is exactly what the audit reports as SYM-META-CONFLICT. Keep
  // them truthful rather than leaving two numbers for one port in one file. Compared
  // against the POST-repair port positions, or the sweep passes the old numbers by.
  const movedHere = repairs.filter((r) => r.key === key && r.field === 'ports');
  for (const m of svg.matchAll(/<connection\b([^>]*?)\/?>/gi)) {
    const id = (m[1].match(/\bid="([^"]*)"/) || [])[1];
    const mv = movedHere.find((r) => r.id === id);
    const p = (sym.ports || []).find((q) => q.id === id);
    if (!p) continue;
    const px = mv ? mv.to[0] : p.x, py = mv ? mv.to[1] : p.y;
    const ux = vb.x + (px / 100) * vb.w, uy = vb.y + (py / 100) * vb.h;
    const mx = attrOf(m[0], 'x'), my = attrOf(m[0], 'y');
    if (Math.abs(mx - ux) < 0.05 && Math.abs(my - uy) < 0.05) continue;
    repairs.push({ key, field: 'metaconn', id, from: [mx, my], to: [ux, uy] });
  }

  // ---- labelAnchor: one rule for all 201, instead of "6 below whatever box" --------
  // The tag belongs under the METAL, so: centred on the ink, six units below its bottom
  // edge. Written in viewBox units, which is the unit pid-symbols.html reads it in — the
  // same field that was averaging "vb.h + 6" across symbols whose ink filled anywhere from
  // 30% to 100% of the box, which put most tags nowhere near their symbol.
  const la = sym.labelAnchor;
  if (la) {
    const want = [bb.cx, bb.y1 + 6];
    if (Math.abs(la.x - want[0]) > 0.05 || Math.abs(la.y - want[1]) > 0.05)
      repairs.push({ key, field: 'label', from: [la.x, la.y], to: want });
  }

  // ---- anchor: land it on the ink centre, in the percent convention the engine reads ----
  const a = sym.anchor;
  if (a) {
    const want = [(100 * (bb.cx - vb.x)) / vb.w, (100 * (bb.cy - vb.y)) / vb.h];
    const off = Math.hypot(
      (vb.x + (a.x / 100) * vb.w) - bb.cx,
      (vb.y + (a.y / 100) * vb.h) - bb.cy);
    if (off <= 0.05) alreadyAnchors++;
    else repairs.push({ key, field: 'anchor', from: [a.x, a.y], to: want, off });
  }
}

const r3 = (n) => { const v = Math.round(n * 1000) / 1000; return Object.is(v, -0) ? 0 : v; };
const fmt = (f) => `pct (${f.from[0]},${f.from[1]}) -> (${r3(f.to[0])},${r3(f.to[1])})`
  + (f.fromU ? `   units (${f.fromU[0].toFixed(1)},${f.fromU[1].toFixed(1)}) -> (${f.toU[0].toFixed(1)},${f.toU[1].toFixed(1)})   was ${f.gap.toFixed(2)}u ${f.why}` : `   was ${f.off.toFixed(2)}u off the ink centre`);

const ports = repairs.filter((r) => r.field === 'ports');
const anchors = repairs.filter((r) => r.field === 'anchor');
const metas = repairs.filter((r) => r.field === 'metaconn');
const labels = repairs.filter((r) => r.field === 'label');
console.log(`fix-port-linework — ${ports.length} port(s) in ${new Set(ports.map((p) => p.key)).size} symbol(s); ${alreadyPorts} already on the linework`);
console.log(`                     ${anchors.length} anchor(s) to recentre; ${alreadyAnchors} already centred`);
console.log(`                     ${labels.length} labelAnchor(s) to normalise`);
console.log(`                     ${metas.length} glyph <connection> tag(s) carrying a stale port position`);
console.log(`                     ${review.length} need review\n`);
for (const f of ports) console.log(`  ${f.key.padEnd(46)} ${String(f.id).padEnd(12)} ${fmt(f)}`);
for (const f of anchors) console.log(`  ${f.key.padEnd(46)} ${'anchor'.padEnd(12)} ${fmt(f)}`);
for (const f of labels) console.log(`  ${f.key.padEnd(46)} ${'labelAnchor'.padEnd(12)} (${f.from[0]},${f.from[1]}) -> (${r3(f.to[0])},${r3(f.to[1])})`);
for (const f of metas) console.log(`  ${f.key.padEnd(46)} ${String(f.id).padEnd(12)} meta (${f.from[0]},${f.from[1]}) -> (${r3(f.to[0])},${r3(f.to[1])})`);
if (review.length) {
  console.log(`\nREVIEW — left untouched:`);
  for (const r of review) console.log(`  ${r.key.padEnd(46)} ${String(r.id).padEnd(12)} ${r.why}`);
}

if (!process.argv.includes('--write')) { console.log('\ndry run — pass --write to apply'); process.exit(0); }

// ---- apply by brace-matched text surgery, so untouched symbols stay byte-identical ----
let out = raw;
for (const f of repairs) {
  const kStart = out.indexOf(`"${f.key}":{`);
  if (kStart < 0) throw new Error(`symbol not found in text: ${f.key}`);
  let i = out.indexOf('{', kStart), depth = 0, end = -1;
  for (let j = i; j < out.length; j++) {
    const c = out[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) { end = j + 1; break; } }
  }
  if (end < 0) throw new Error(`unbalanced JSON for ${f.key}`);
  let block = out.slice(kStart, end);
  if (f.field === 'anchor') {
    const at = block.indexOf('"anchor":{');
    if (at < 0) throw new Error(`no anchor in ${f.key}`);
    const close = block.indexOf('}', at);
    block = block.slice(0, at) + `"anchor":{"x":${r3(f.to[0])},"y":${r3(f.to[1])}}` + block.slice(close + 1);
  } else if (f.field === 'label') {
    const at = block.indexOf('"labelAnchor":{');
    if (at < 0) throw new Error(`no labelAnchor in ${f.key}`);
    const close = block.indexOf('}', at);
    block = block.slice(0, at) + `"labelAnchor":{"x":${r3(f.to[0])},"y":${r3(f.to[1])}}` + block.slice(close + 1);
  } else if (f.field === 'metaconn') {
    // The bundle is one JSON string, so quotes inside a glyph arrive as \". Splicing by
    // index rather than by regex: an escaped quote inside a RegExp literal is a trap that
    // has already cost one wrong write on this file.
    const tag = 'id=\\"' + f.id + '\\"';
    const at = block.indexOf(tag);
    if (at < 0) throw new Error(`<connection ${f.id}> not found in ${f.key}`);
    const limit = block.indexOf('>', at);
    let head = block.slice(0, at), body = block.slice(at, limit), tail = block.slice(limit);
    for (const [k, v] of [['x', f.to[0]], ['y', f.to[1]]]) {
      const marker = k + '=\\"';
      const p = body.indexOf(marker);
      if (p < 0) throw new Error(`<connection ${f.id}> has no ${k} in ${f.key}`);
      const q = body.indexOf('\\"', p + marker.length);
      if (q < 0) throw new Error(`unterminated ${k} on <connection ${f.id}> in ${f.key}`);
      body = body.slice(0, p) + marker + r3(v) + body.slice(q);
    }
    block = head + body + tail;
  } else {
    const pid = `"id":"${f.id}"`;
    const pAt = block.indexOf(pid);
    if (pAt < 0) throw new Error(`port ${f.id} not found in ${f.key}`);
    let oStart = block.lastIndexOf('{', pAt), od = 0, oEnd = -1;
    for (let j = oStart; j < block.length; j++) {
      const c = block[j];
      if (c === '{') od++;
      else if (c === '}') { od--; if (!od) { oEnd = j + 1; break; } }
    }
    if (oEnd < 0) throw new Error(`unbalanced port object for ${f.key}/${f.id}`);
    const portObj = block.slice(oStart, oEnd);
    if (!/"x":/.test(portObj) || !/"y":/.test(portObj)) throw new Error(`port ${f.key}/${f.id} has no x/y`);
    const next = portObj.replace(/"x":\s*-?[\d.]+/, `"x":${r3(f.to[0])}`).replace(/"y":\s*-?[\d.]+/, `"y":${r3(f.to[1])}`);
    if (next === portObj) throw new Error(`could not rewrite x/y for ${f.key}/${f.id}`);
    block = block.slice(0, oStart) + next + block.slice(oEnd);
  }
  out = out.slice(0, kStart) + block + out.slice(end);
}
writeFileSync(FILE, out);
console.log(`\n[WRITE] ${repairs.length} repair(s). Re-verifying from the written file...`);

const check = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, ''));
let fail = 0;
for (const f of repairs) {
  const sym = check[f.key], vb = vbOf(sym.svg), g2 = ink(sym.svg), bb2 = inkBBox(g2);
  let ok, detail;
  if (f.field === 'label') {
    ok = Math.abs(sym.labelAnchor.x - bb2.cx) < 0.05 && Math.abs(sym.labelAnchor.y - (bb2.y1 + 6)) < 0.05;
    detail = `labelAnchor pct (${sym.labelAnchor.x},${sym.labelAnchor.y}) -> (${(vb.x + sym.labelAnchor.x).toFixed(2)},${(vb.y + sym.labelAnchor.y).toFixed(2)}), ink bottom ${bb2.y1.toFixed(2)}`;
  } else if (f.field === 'metaconn') {
    const m = [...sym.svg.matchAll(/<connection\b[^>]*\/?>/gi)].find((q) => attrOf(q[0], 'id') === f.id);
    const ux = attrOf(m[0], 'x'), uy = attrOf(m[0], 'y');
    const pd = sym.ports.find((q) => q.id === f.id);
    const X = vb.x + (pd.x / 100) * vb.w, Y = vb.y + (pd.y / 100) * vb.h;
    ok = Math.abs(ux - X) < 0.05 && Math.abs(uy - Y) < 0.05;
    detail = `meta (${ux},${uy}) vs port pct (${pd.x},${pd.y}) -> (${X.toFixed(2)},${Y.toFixed(2)})`;
  } else if (f.field === 'anchor') {
    const X = vb.x + (sym.anchor.x / 100) * vb.w, Y = vb.y + (sym.anchor.y / 100) * vb.h;
    const off = Math.hypot(X - bb2.cx, Y - bb2.cy);
    ok = off <= maxStroke(g2) / 2;
    detail = `anchor pct (${sym.anchor.x},${sym.anchor.y}) -> (${X.toFixed(2)},${Y.toFixed(2)}), ${off.toFixed(3)}u from the ink centre`;
  } else {
    const p = sym.ports.find((q) => q.id === f.id);
    const X = vb.x + (p.x / 100) * vb.w, Y = vb.y + (p.y / 100) * vb.h;
    const gap = gapToInk(g2, X, Y);
    ok = gap <= 0.05;
    detail = `pct (${p.x},${p.y}) -> (${X.toFixed(2)},${Y.toFixed(2)}), ${gap.toFixed(3)}u from the linework`;
  }
  if (!ok) fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${f.key.padEnd(46)} ${String(f.id || 'anchor').padEnd(12)} ${detail}`);
}
console.log(fail ? `\nVERIFY FAILED for ${fail} repair(s)` : `\nverified from the written file — all ${repairs.length} repairs hold`);
process.exit(fail ? 1 : 0);
