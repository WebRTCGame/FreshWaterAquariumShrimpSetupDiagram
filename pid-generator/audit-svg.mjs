import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// The text metric is IMPORTED, not reimplemented. This file used to carry its own
// `content.length * fs * 0.55`, which is how the audit and the engine ended up
// disagreeing about what "wide" means -- and an audit that measures differently
// from the thing it audits reports confidently on a model that does not exist.
// That is the whole of the 9.64 `[1] TINY TEXT` false-positive storm, which the
// log blamed on a coordinate space and which was really a third copy of a number.
const require_ = createRequire(import.meta.url);
const PIDText = require_('./pid-textmetrics.js');
// ponytail: SVG-only layout audit — parses an exported pid SVG (no DOM, no render)
// so an LLM can "see" geometry as ranked text. Usage: node audit-svg.mjs <file.svg>
const file = process.argv[2] || 'pid-spike-export(1).svg';
const s = readFileSync(file, 'utf8');
// sheet size from the root viewBox (1 unit = 1mm by the engine's scale decision)
const _vb = s.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
const sheetW = _vb ? +_vb[1] : 864;
const sheetH = _vb ? +_vb[2] : 559;
const R = (re, str) => [...str.matchAll(re)];
const num = (m, k, dflt = 0) => (m && m[k] !== undefined ? parseFloat(m[k]) : dflt);

// ---- paths ----
const pipes = [];
for (const m of R(/<path\b[^>]*>/g, s)) {
  const tag = m[0];
  if (!/pid-(process|signal)/.test(tag) && !/data-pid-id="tap-/.test(tag) && !/stroke-width="2\.5"/.test(tag)) continue;
  const d = (tag.match(/d="([^"]+)"/) || [])[1];
  if (!d) continue;
  const cls = /pid-signal/.test(tag) ? 'signal' : /tap-/.test(tag) ? 'tap' : /stroke-width="2\.5"/.test(tag) ? 'nozzle' : 'process';
  const from = (tag.match(/data-from="([^"]+)"/) || [])[1] || (tag.match(/data-pid-id="(tap-[^"]+)"/) || [])[1] || '?';
  const to = (tag.match(/data-to="([^"]+)"/) || [])[1] || '';
  // split d into subpaths at each M (gap breaks don't connect)
  const subs = [];
  let cur = null;
  for (const t of R(/([ML])\s*(-?[\d.]+)\s*(-?[\d.]+)/g, d)) {
    const cmd = t[1], x = +t[2], y = +t[3];
    if (cmd === 'M') { cur = [{ x, y }]; subs.push(cur); }
    else if (cur) cur.push({ x, y });
  }
  pipes.push({ from, to, cls, subs, sw: +((tag.match(/stroke-width="([\d.]+)"/) || [])[1] || 0), label: cls === 'nozzle' ? `nozzle@${Math.round(subs[0][0].x)},${Math.round(subs[0][0].y)}` : cls === 'tap' ? `${from.replace(/^tap-/, '')}~tap->` : `${from}->${to}` });
}
const segsOf = (p) => p.subs.flatMap((sp) => sp.slice(1).map((pt, i) => [sp[i], pt]));
const lenOf = (p) => segsOf(p).reduce((a, [u, v]) => a + Math.abs(v.x - u.x) + Math.abs(v.y - u.y), 0);
const bendsOf = (p) => p.subs.reduce((n, sp) => {
  for (let i = 1; i < sp.length - 1; i++) {
    const a = sp[i - 1], b = sp[i], c = sp[i + 1];
    if (Math.abs((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) < 0.5) n++;
  }
  return n;
}, 0);
const crossing = (s1, s2) => {
  const [p1, p2] = s1, [p3, p4] = s2;
  const h1 = Math.abs(p1.y - p2.y) < 0.5, h2 = Math.abs(p3.y - p4.y) < 0.5;
  if (h1 === h2) return null;
  const h = h1 ? s1 : s2, v = h1 ? s2 : s1;
  const cy = h[0].y, vx = v[0].x;
  if (vx < Math.min(h[0].x, h[1].x) + 1 || vx > Math.max(h[0].x, h[1].x) - 1) return null;
  if (cy < Math.min(v[0].y, v[1].y) + 1 || cy > Math.max(v[0].y, v[1].y) - 1) return null;
  return { x: vx, y: cy };
};
const nearEnd = (x, sg, t = 4) => Math.hypot(x.x - sg[0].x, x.y - sg[0].y) < t || Math.hypot(x.x - sg[1].x, x.y - sg[1].y) < t;

// ---- entities (symbol boxes) ----
const boxes = [];
// `[^>]*` after the id tolerates extra attributes (e.g. the D4 layer class).
// The previous form required data-pid-id to be the LAST attribute on the <g>,
// so adding `class="ly-equipment"` silently dropped every entity box.
for (const m of R(/<g data-pid-id="([^"]+)"[^>]*>(.*?)<\/g>/gs, s)) {
  const id = m[1], inner = m[2];
  const sm = inner.match(/<svg[^>]*x="(-?[\d.]+)"[^>]*y="(-?[\d.]+)"[^>]*width="(-?[\d.]+)"[^>]*height="(-?[\d.]+)"/);
  if (sm) {
    const x = +sm[1], y = +sm[2], w = +sm[3], h = +sm[4];
    boxes.push({ id, x0: x, x1: x + w, y0: y, y1: y + h, cx: x + w / 2, cy: y + h / 2 });
    continue;
  }
  const tm = inner.match(/transform="translate\((-?[\d.]+)\s+(-?[\d.]+)\)/);
  if (tm) boxes.push({ id, x0: +tm[1], x1: +tm[1] + 12, y0: +tm[2], y1: +tm[2] + 12, cx: +tm[1] + 6, cy: +tm[2] + 6 });
}
for (const m of R(/<circle[^>]*cx="(-?[\d.]+)"[^>]*cy="(-?[\d.]+)"[^>]*data-pid-id="([^"]+)"/g, s))
  boxes.push({ id: m[3], x0: +m[1] - 3.5, x1: +m[1] + 3.5, y0: +m[2] - 3.5, y1: +m[2] + 3.5, cx: +m[1], cy: +m[2] });
for (const m of R(/<circle[^>]*data-pid-id="([^"]+)"[^>]*cx="(-?[\d.]+)"[^>]*cy="(-?[\d.]+)"/g, s))
  boxes.push({ id: m[1], x0: +m[2] - 3.5, x1: +m[2] + 3.5, y0: +m[3] - 3.5, y1: +m[3] + 3.5, cx: +m[2], cy: +m[3] });

// ---- texts (approx boxes) ----
//
// Measured with `PIDText`, the same per-character table the engine reserves space
// with, and SCALED BY THE WRAPPER before comparing against a millimetre floor.
//
// The scale is the part 9.67 got wrong and never fixed. `fit page` wraps the
// drawing in `<g transform="translate(...) scale(k)">` and `denormaliseText()`
// divides every text `font-size` back down by `k` so the TYPE renders at nominal
// millimetres while the GEOMETRY scales. Comparing the raw attribute against a
// 3.5mm floor therefore reads nominal-3.5mm text as 3.5/k and flags it: the audit
// reported 28 of 61 runs on the demo as "tiny" when not one was. A guard that
// cries wolf on every run of type is a guard nobody reads, and that is exactly
// what happened — item [1] was disarmed for two commits.
//
// `scale(k)` is read from the emitted transform, so this is the scale the browser
// will actually apply, not a re-derivation of it.
const WRAP_SCALE = (() => {
  const g = /<g[^>]*transform="translate\([^)]*\)\s*scale\(([\d.]+)\)"/.exec(s);
  return g ? +g[1] : 1;
})();
const texts = [];
for (const m of R(/<text\b([^>]*)>([^<]*)<\/text>/g, s)) {
  const a = m[1];
  // ponytail: decode entities before measuring (see pidTextBoxes)
  const content = m[2].trim().replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  if (!content) continue;
  const xm = a.match(/x="(-?[\d.]+)"/), ym = a.match(/y="(-?[\d.]+)"/), fm = a.match(/font-size="(-?[\d.]+)"/);
  if (!xm || !ym) continue;
  const fsRaw = fm ? +fm[1] : 3;
  // text inside a symbol's own <svg> viewport is NOT denormalised -- it must scale
  // with its symbol, or every glyph in every symbol would shrink by 1/k. Detected
  // by counting open/close tags ahead of this match rather than by pattern-matching
  // the preceding markup, which cannot tell "inside a symbol" from "after a
  // transform on some unrelated group".
  const ahead = s.slice(0, m.index);
  const inSymbol = (ahead.match(/<svg[\s>]/g) || []).length > (ahead.match(/<\/svg>/g) || []).length;
  const fs = inSymbol ? fsRaw : fsRaw * WRAP_SCALE;
  const x = +xm[1], y = +ym[1];
  // ponytail: rotate(90) labels run vertically -- swap the approx box axes or
  // every vertical designation flags phantom collisions
  const vert = /rotate\(90/.test(a);
  const ex = PIDText.extentEm(content);
  const w0 = PIDText.widthMm(content, fs, /font-weight="bold"/.test(a));
  const h0 = (ex.y1 - ex.y0) * fs;
  const w = vert ? h0 : w0, h = vert ? w0 : h0;
  const mid = /text-anchor="middle"/.test(a);
  texts.push({ t: content.slice(0, 28), x, y, fs: fsRaw, fsEff: fs, x0: mid ? x - w / 2 : x, x1: mid ? x + w / 2 : x + w, y0: y + ex.y0 * fs, y1: y + ex.y1 * fs });
}
const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
// Segment vs axis-aligned box, shrunk by `pad`. Local on purpose: this file is the
// INDEPENDENT check, and the one thing it must not do is call the engine's own
// collision code — a check that shares an implementation with the thing it checks
// cannot disagree with it, and disagreement is the whole value here.
const segHitsRect = (sg, r, pad) => {
  const p = pad || 0;
  const x0 = r.x0 + p, x1 = r.x1 - p, y0 = r.y0 + p, y1 = r.y1 - p;
  if (x1 <= x0 || y1 <= y0) return false;
  const [a, b] = sg;
  // every segment here is orthogonal, so a slab test in each axis is exact
  if (Math.abs(a.x - b.x) < 0.01) return a.x > x0 && a.x < x1 && Math.max(a.y, b.y) > y0 && Math.min(a.y, b.y) < y1;
  if (Math.abs(a.y - b.y) < 0.01) return a.y > y0 && a.y < y1 && Math.max(a.x, b.x) > x0 && Math.min(a.x, b.x) < x1;
  // a diagonal: sample it, which is what [0] exists to tell us should not happen
  const steps = Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (x > x0 && x < x1 && y > y0 && y < y1) return true;
  }
  return false;
};
// Every routed segment, in content coordinates, for the linework checks below.
// NOZZLE leaders are excluded: a nozzle tag is SUPPOSED to sit on its own nozzle
// stub, and counting the leader would report every correctly-placed nozzle tag in
// the drawing. The engine's placer makes the same exclusion, for the same reason.
const segsAll = pipes.filter((p) => p.cls !== 'nozzle').flatMap(segsOf);

// ---- report ----
console.log(`== SVG layout audit: ${file} ==`);
console.log(`paths: ${pipes.filter((p) => p.cls === 'process').length} process, ${pipes.filter((p) => p.cls === 'signal').length} signal, ${pipes.filter((p) => p.cls === 'tap').length} taps | entities: ${boxes.length} | texts: ${texts.length}`);

// 0. angled (must be 0: every segment runs at 0/90/180/270)
// ponytail: MINLEN floor — sub-2mm off-axis noise is rounding, not a drafting error
const angled = [];
let angledSkipped = 0;
const MINLEN = 5;
pipes.map(segsOf).forEach((segs, i) => {
  for (const [a, b] of segs) {
    const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
    if (dx > 0.5 && dy > 0.5) {
      if (dx + dy < MINLEN) { angledSkipped++; continue; }
      angled.push({ pipe: pipes[i].label, dx: +dx.toFixed(1), dy: +dy.toFixed(1), at: `(${Math.round(a.x)},${Math.round(a.y)})->(${Math.round(b.x)},${Math.round(b.y)})` }); break;
    }
  }
});
console.log(`\n[0] ANGLED SEGMENTS (must be 0; sub-${MINLEN}mm ignored: ${angledSkipped}): ${angled.length}`);
for (const g of angled.slice(0, 15)) console.log(`  ${g.pipe} ${g.dx}x${g.dy}mm ${g.at}`);

// 1. tiny text (renderer floor is 3.5mm)
const tiny = texts.filter((t) => t.fs < 3.5);
console.log(`\n[1] TINY TEXT fs<3.5: ${tiny.length}/${texts.length} (viewBox mm units; renderer floor is 3.5mm)`);
for (const t of tiny.slice(0, 12)) console.log(`  fs=${t.fs} "${t.t}" @(${Math.round(t.x)},${Math.round(t.y)})`);

// 2. longest / bendiest runs
const ranked = [...pipes].sort((a, b) => lenOf(b) - lenOf(a));
console.log('\n[2] LONGEST RUNS (length mm | bends | kind | pipe)');
for (const p of ranked.slice(0, 10)) console.log(`  ${Math.round(lenOf(p))}mm bends=${bendsOf(p)} ${p.cls} ${p.label}`);

// 3. crossings
const xings = [];
const segCache = pipes.map(segsOf);
for (let i = 0; i < pipes.length; i++) for (let j = i + 1; j < pipes.length; j++) {
  for (const a of segCache[i]) for (const b of segCache[j]) {
    const x = crossing(a, b);
    if (x && !nearEnd(x, a) && !nearEnd(x, b)) { xings.push({ a: pipes[i].label, b: pipes[j].label, x: Math.round(x.x), y: Math.round(x.y) }); break; }
  }
}
console.log(`\n[3] LINE CROSSINGS (pipe-pair, first point): ${xings.length}`);
for (const c of xings.slice(0, 15)) console.log(`  ${c.a} X ${c.b} @(${c.x},${c.y})`);

// 4. overlaps (shared corridors; stub-zone sharing <20mm at a common endpoint exempt)
let overlaps = [];
const sharedEnd = (a, b) => {
  const norm = (l) => l.replace(/~tap/g, '').split('->').filter(Boolean);
  const an = norm(a), bn = norm(b);
  return an.some((e) => bn.includes(e));
};
for (let i = 0; i < pipes.length; i++) for (let j = i + 1; j < pipes.length; j++) {
  if (pipes[i].cls === 'nozzle' || pipes[j].cls === 'nozzle') continue; // glyph dressing, not routing
  const minOl = sharedEnd(pipes[i].label, pipes[j].label) ? 20 : 3;
  for (const a of segCache[i]) for (const b of segCache[j]) {
    const ha = Math.abs(a[0].y - a[1].y) < 0.5, hb = Math.abs(b[0].y - b[1].y) < 0.5;
    let ol = 0, at = '';
    if (ha && hb && Math.abs(a[0].y - b[0].y) < 1) {
      ol = Math.min(Math.max(a[0].x, a[1].x), Math.max(b[0].x, b[1].x)) - Math.max(Math.min(a[0].x, a[1].x), Math.min(b[0].x, b[1].x));
      at = `y=${Math.round(a[0].y)}`;
    } else if (!ha && !hb && Math.abs(a[0].x - b[0].x) < 1) {
      ol = Math.min(Math.max(a[0].y, a[1].y), Math.max(b[0].y, b[1].y)) - Math.max(Math.min(a[0].y, a[1].y), Math.min(b[0].y, b[1].y));
      at = `x=${Math.round(a[0].x)}`;
    }
    if (ol > minOl) { overlaps.push({ a: pipes[i].label, b: pipes[j].label, ol: Math.round(ol), at }); break; }
  }
}
console.log(`\n[4] COLLINEAR OVERLAPS (shared corridor = hard error): ${overlaps.length}`);
for (const o of overlaps.slice(0, 10)) console.log(`  ${o.a} & ${o.b} overlap ${o.ol}mm at ${o.at}`);

// 5. lines through symbol boxes (midpoint in the CENTRAL half — corner grazes
// under the text halo are cosmetic, full crossings are not)
const thru = [];
for (const p of pipes) {
  if (p.cls === 'nozzle') continue; // stubs start at the symbol body by construction
  for (const sg of segsOf(p)) {
    for (const bx of boxes) {
      if (p.label.startsWith(bx.id + '->') || p.label.endsWith('->' + bx.id) || p.label.startsWith(bx.id + '~tap')) continue;
      const mid = { x: (sg[0].x + sg[1].x) / 2, y: (sg[0].y + sg[1].y) / 2 };
      const cx0 = bx.x0 + (bx.x1 - bx.x0) * 0.25, cx1 = bx.x1 - (bx.x1 - bx.x0) * 0.25;
      const cy0 = bx.y0 + (bx.y1 - bx.y0) * 0.25, cy1 = bx.y1 - (bx.y1 - bx.y0) * 0.25;
      if (mid.x > cx0 && mid.x < cx1 && mid.y > cy0 && mid.y < cy1) { thru.push({ pipe: p.label, box: bx.id }); break; }
    }
  }
}
console.log(`\n[5] LINES THROUGH SYMBOL BOXES (midpoint-in-box): ${thru.length}`);
for (const t of thru.slice(0, 12)) console.log(`  ${t.pipe} through ${t.box}`);

// 6. entity overlaps
const eov = [];
for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
  if (hit(boxes[i], boxes[j])) eov.push(`${boxes[i].id} & ${boxes[j].id}`);
}
console.log(`\n[6] ENTITY BOX OVERLAPS: ${eov.length}`);
for (const e of eov.slice(0, 10)) console.log(`  ${e}`);

// 7. label collisions
const lcol = [];
for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
  if (hit(texts[i], texts[j])) lcol.push(`"${texts[i].t}" & "${texts[j].t}" @(${Math.round(texts[i].x)},${Math.round(texts[i].y)})`);
}
console.log(`\n[7] LABEL COLLISIONS (approx boxes): ${lcol.length}`);
for (const l of lcol.slice(0, 12)) console.log(`  ${l}`);

// 8. short segments (stair-step jogs are tiny ORTHOGONAL segments — invisible to [0])// ponytail: MINLEN = one grid cell; segments within a port lead-in run (16mm)
// of either pipe end are legitimate elevation jogs, not artifacts
const shorts = [];
pipes.forEach((p, i) => {
  p.subs.forEach((sp) => {
    const cum = [0];
    for (let k = 1; k < sp.length; k++) cum.push(cum[k - 1] + Math.abs(sp[k].x - sp[k - 1].x) + Math.abs(sp[k].y - sp[k - 1].y));
    const total = cum[cum.length - 1];
    for (let k = 1; k < sp.length; k++) {
      const a = sp[k - 1], b = sp[k];
      const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      if (len < MINLEN && Math.min(cum[k - 1], total - cum[k]) > 16)
        shorts.push({ pipe: p.label, len: +len.toFixed(1), at: `(${Math.round(a.x)},${Math.round(a.y)})->(${Math.round(b.x)},${Math.round(b.y)})` });
    }
  });
});
console.log(`\n[8] SHORT MID-RUN SEGMENTS (<${MINLEN}mm, excl. port stubs): ${shorts.length}`);
for (const g of shorts.slice(0, 20)) console.log(`  ${g.pipe} ${g.len}mm ${g.at}`);

// 9. off-sheet points (sheet bounds 26,26–838,533; engine only counts these)
const off = [];
pipes.forEach((p) => {
  for (const sp of p.subs) for (const pt of sp) {
    if (pt.x < 26 || pt.x > 838 || pt.y < 26 || pt.y > 533) { off.push({ pipe: p.label, at: `(${Math.round(pt.x)},${Math.round(pt.y)})` }); break; }
  }
});
console.log(`\n[9] OFF-SHEET PIPES: ${off.length}`);
for (const g of off.slice(0, 12)) console.log(`  ${g.pipe} ${g.at}`);

// 10. gap coverage: every crossing should show a break (M-jump) within GAP+2
// on at least one of the two lines — else the lines read as joined
const GAPW = 4;
const subStarts = new Map(); // pipe idx -> list of subpath start points (= break ends)
pipes.forEach((p, i) => {
  const list = [];
  for (const sp of p.subs) if (sp.length) list.push(sp[0]);
  subStarts.set(i, list);
});
const gaps = [];
for (let i = 0; i < pipes.length; i++) {
  for (const st of subStarts.get(i)) {
    // a subpath start that is NOT the pipe's first point is a gap end
    const first = pipes[i].subs[0][0];
    if (Math.abs(st.x - first.x) < 0.5 && Math.abs(st.y - first.y) < 0.5) continue;
    gaps.push({ i, x: st.x, y: st.y });
  }
}
const uncovered = [];
const xingSeen = new Set();
for (let i = 0; i < pipes.length; i++) for (let j = i + 1; j < pipes.length; j++) {
  for (const a of segCache[i]) for (const b of segCache[j]) {
    const x = crossing(a, b);
    if (!x || nearEnd(x, a) || nearEnd(x, b)) continue;
    const key = `${Math.round(x.x)},${Math.round(x.y)}`;
    if (xingSeen.has(key)) continue;
    xingSeen.add(key);
    const covered = gaps.some((gp) => Math.abs(gp.x - x.x) + Math.abs(gp.y - x.y) < GAPW + 2 + 4);
    if (!covered) uncovered.push({ a: pipes[i].label, b: pipes[j].label, x: Math.round(x.x), y: Math.round(x.y) });
  }
}
console.log(`\n[10] CROSSINGS WITHOUT A GAP BREAK: ${uncovered.length}`);
for (const c of uncovered.slice(0, 20)) console.log(`  ${c.a} X ${c.b} @(${c.x},${c.y})`);

// ---------------------------------------------------------------------------
  // [12] MARKER SCALE -- do the node dot and the flow arrow belong to the pipe they are
  // drawn on? Both were fixed constants that ignored it: the dot was r=2.5, a 5mm disc,
  // carrying a fill attribute the stylesheet silently overrode, and the arrow a fixed 3mm
  // wide on pipes measuring 0.4mm to 3.2mm. Neither showed up in any score term, and an
  // audit that never looks at them cannot notice them being wrong again.
  //
  // A junction dot is legitimately a little wider than its pipe -- it has to read as a
  // node rather than as a thickness -- so the floor is generous. The point is to catch a
  // dot that has become a blob, which is exactly what 5mm on a 1.4mm pipe was.
  const DOT_MAX = 2.0, ARROW_MAX = 1.5;
  const distToSeg = (px, py, [a, b]) => {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    let u = L2 ? ((px - a.x) * dx + (py - a.y) * dy) / L2 : 0;
    u = Math.max(0, Math.min(1, u));
    return Math.hypot(px - (a.x + u * dx), py - (a.y + u * dy));
  };
  const markers = [];
  for (const m of R(/<circle class="pid-junction-dot" cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="([\d.]+)"/g, s)) {
    const cx = +m[1], cy = +m[2], rad = +m[3];
    let best = null, bd = Infinity;
    for (const p of pipes) {
      if (!p.sw) continue;
      for (const sg of segsOf(p)) {
        const d = distToSeg(cx, cy, sg);
        if (d < bd) { bd = d; best = p; }
      }
    }
    if (!best || bd > rad + 1.5) continue;          // not actually sitting on a pipe
    const ratio = (2 * rad) / best.sw;
    if (ratio > DOT_MAX) markers.push(`junction dot ${(2 * rad).toFixed(1)}mm on a ${best.sw}mm pipe = ${ratio.toFixed(1)}x (> ${DOT_MAX}x)`);
  }
  for (const m of R(/<polygon points="([^"]+)" fill="[^"]+" opacity="0.7" data-pipe-w="([\d.]+)"\/>/g, s)) {
    const pw = +m[2];
    const pts = m[1].split(' ').map((p) => p.split(',').map(Number));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const w = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const ratio = w / pw;
    if (ratio > ARROW_MAX) markers.push(`flow arrow ${w.toFixed(1)}mm wide on a ${pw}mm pipe = ${ratio.toFixed(1)}x (> ${ARROW_MAX}x)`);
  }
  console.log(`
[12] MARKER SCALE (dot <= ${DOT_MAX}x pipe, arrow <= ${ARROW_MAX}x pipe): ${markers.length}`);
  for (const mk of markers) console.log(`  ${mk}`);

  // [14] TAG INSIDE BUBBLE -- does the instrument tag actually FIT its circle?
  //
  // The emitter used hardcoded baselines of +0.5 and +5.5, which is not the centre of the
  // ink they produce. At typeScale 1.3 the block spans -2.5..+6.17 about the bubble centre,
  // so the loop number hung about 1.5mm out of the BOTTOM of the circle and every
  // instrument on every sheet read as "LT  -101" with the number outside the bubble.
  //
  // The bubble glyph is a nested <svg x y width height> holding circle r=40 in a 100-unit
  // viewBox, so drawn radius = 0.4 * width and centre = (x + w/2, y + h/2). Containment is
  // scale-invariant, so the wrapper transform does not need undoing here.
  const CAP = 0.72, DESC = 0.20;
  // Print tolerance, not a fudge: 0.25mm is the conventional CAD plotting tolerance,
  // and without it a 0.02mm overshoot from float noise is reported as a defect. On
  // spike that was 12 of 18 hits, which is how a guard trains its reader to ignore
  // it. The check still fires on every genuine overshoot (6x on spike, 1x on demo).
  const TAG_TOL = 0.25;
  const spills = [];
  for (const g of R(/<g data-pid-id="([^"]+)" class="ly-instrument">([\s\S]*?)<\/g>/g, s)) {
    const body = g[2];
    const sv = /<svg x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(body);
    if (!sv) continue;
    const cx = +sv[1] + +sv[3] / 2, cy = +sv[2] + +sv[4] / 2, r = 0.4 * +sv[3];
    for (const m of R(/<text x="(-?[\d.]+)" y="(-?[\d.]+)" text-anchor="middle" font-size="([\d.]+)"(?: font-weight="(\w+)")?[^>]*>([^<]*)<\/text>/g, body)) {
      const x = +m[1], y = +m[2], f = +m[3], str = m[5];
      // real advance, from the same table the engine draws and reserves with
      const em = m[4] === 'bold';
      const vcen = (y - CAP * f + y + DESC * f) / 2 - cy;
      const corner = Math.hypot(PIDText.widthMm(str, f, em) / 2, vcen);
      if (corner > r + TAG_TOL) spills.push(`${g[1]} "${str}" needs ${corner.toFixed(2)}mm but the bubble radius is ${r.toFixed(2)}mm (${((corner / r - 1) * 100).toFixed(0)}% over)`);
    }
  }
  console.log(`
[14] TAG INSIDE BUBBLE (tag ink within its circle): ${spills.length}`);
  for (const sp3 of spills) console.log(`  ${sp3}`);

// [15] LABEL OVER LINEWORK — the class of defect that had NO check at all.
//
// [7] compares text with text. [3]/[5] compare lines with lines and with symbol
// boxes. Nothing compared text with LINEWORK, so a P&ID could print an equipment
// tag or a valve label stack straight through a process line — one of the most
// obvious things a drawing can get wrong — and both the score and this audit would
// report a clean sheet. Measured on dense before the placers learned to test for
// it: C-1's tag sat on the vertical run off the reboiler, and FV-1's "CONTROL
// VALVE" stack ran down the P-1 discharge riser.
//
// The engine's own counter is PID-ANN-001; this is the same question asked of the
// emitted markup by a tool that shares no code with the renderer beyond the text
// metric, which is the point of having it. Only the three annotation roles that
// carry a tag are tested — line designations are meant to sit beside their line
// with a leader, and nozzle tags are meant to sit on their nozzle.
const LBL_TOL = 0.75;   // a leader arriving at a label is not a line drawn through it
const onLine = [];
for (const b of texts) {
  let n = 0;
  for (const seg of segsAll) {
    if (!segHitsRect(seg, b, -LBL_TOL)) continue;
    n++;
  }
  if (n) onLine.push(`"${b.t}" on ${n} segment(s) @(${Math.round(b.x)},${Math.round(b.y)})`);
}
console.log(`
[15] LABEL OVER LINEWORK: ${onLine.length}`);
for (const o of onLine.slice(0, 14)) console.log(`  ${o}`);

// [16] EQUIPMENT / VALVE ANNOTATION CLEARANCE — did the placers find room?
//
// Independent of [15]: this asks whether anything at all crossed anything, without
// caring which label it was, and it exists so a regression in the placement ladder
// shows up as a count rather than as a picture somebody had to look at.
const ANN_TOL = 0.25;
const annHit = [];
for (const b of texts) {
  let n = 0;
  for (const o of texts) {
    if (o === b) continue;
    if (b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1) n++;
  }
  if (n) annHit.push(`"${b.t}" x${n}`);
}
console.log(`
[16] LABEL STACKS OVERLAPPING (any text, any other text): ${annHit.length}`);
for (const a of annHit.slice(0, 14)) console.log(`  ${a}`);

// [11] SHEET UTILISATION  +  [13] SPARSE SHEET
//
// These exist because every other check here measures a DEFECT, and a sheet can
// pass all of them while being visually unusable: a small drawing stranded in the
// top-left of a full ARCH/ANSI D sheet is "clean" by every count above and still
// looks unfinished. The void class of problem had no gate at all.
//
// [11] reports the raw number so a regression is visible; [13] is the actionable
// one, and it deliberately separates the two causes a single utilisation number
// would conflate:
//   - low fill because LAYOUT left a void       -> fixable, the engine's problem
//   - low fill because the sheet is genuinely   -> not a defect; the honest
//     too small for ARCH D                          answer is usually "split it"
//                                                   (PID Drafting Rules.md 111)
// Collapsing them into one number would have produced noise that gets ignored.
// ---------------------------------------------------------------------------
const FRAME = 18;         // border frame inset (renderer uses 18)
const BOT_RESERVE = 60;   // title-block band along the bottom
const zx0 = FRAME + 30, zx1 = sheetW - FRAME - 30;
const zy0 = FRAME + 24, zy1 = sheetH - FRAME - BOT_RESERVE;
const zW = Math.max(zx1 - zx0, 1), zH = Math.max(zy1 - zy0, 1);

// Measure ONLY what lands in the drawable zone. The title block and legend are
// chrome pinned to the bottom-left/bottom-right of every sheet; counting them
// would anchor the bbox to the bottom edge and mask the exact void this check
// exists to catch (a stranded drawing measures ~100% tall purely because the
// title block is down there). Content outside the zone is either chrome or an
// off-sheet excursion, and [9] already owns the latter.
let c0x = Infinity, c0y = Infinity, c1x = -Infinity, c1y = -Infinity;
const grow = (x, y) => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (x < zx0 || x > zx1 || y < zy0 || y > zy1) return;
  c0x = Math.min(c0x, x); c0y = Math.min(c0y, y);
  c1x = Math.max(c1x, x); c1y = Math.max(c1y, y);
};
for (const p of pipes) for (const sp of p.subs) for (const pt of sp) grow(pt.x, pt.y);
for (const b of boxes) { grow(b.x0, b.y0); grow(b.x1, b.y1); }
for (const t of texts) grow(t.x, t.y);

const contentW = Math.max(c1x - c0x, 0), contentH = Math.max(c1y - c0y, 0);
const fillW = contentW / zW, fillH = contentH / zH;
const fillArea = (contentW * contentH) / (zW * zH);
// [11] is emitted with the integer area-% LAST so regress.mjs's count regex
// (`^\[(\d+)\] .*?: (\d+)\s*(\(|$)`) captures it like every other check, and the
// human-readable detail lands on the indented line below as its list entry.
console.log(`\n[11] SHEET UTILISATION (area % of drawable, 0-100): ${Math.round(fillArea * 100)}`);
console.log(`  content ${Math.round(contentW)}x${Math.round(contentH)}mm bbox (${Math.round(c0x)},${Math.round(c0y)})->(${Math.round(c1x)},${Math.round(c1y)}) | ${(100 * fillW).toFixed(0)}% W x ${(100 * fillH).toFixed(0)}% H | drawable ${Math.round(zW)}x${Math.round(zH)}mm | sheet ${sheetW}x${sheetH}mm`);

// [13] a permissive FLOOR on fill — a "look at this sheet" prompt, not a defect.
const FILL_FLOOR = 0.45;
const sparse = [];
if (Number.isFinite(c0x) && Math.min(fillW, fillH) < FILL_FLOOR) {
  const worst = fillH < fillW ? 'height' : 'width';
  sparse.push(`fills only ${(100 * Math.min(fillW, fillH)).toFixed(0)}% of drawable ${worst} (< ${(100 * FILL_FLOOR).toFixed(0)}%) — ` +
    `content is ${(100 * fillW).toFixed(0)}% W x ${(100 * fillH).toFixed(0)}% H; consider splitting the sheet or adding scope`);
}
console.log(`\n[13] SPARSE SHEET (fill floor ${(100 * FILL_FLOOR).toFixed(0)}%): ${sparse.length}`);
for (const sp2 of sparse) console.log(`  ${sp2}`);
