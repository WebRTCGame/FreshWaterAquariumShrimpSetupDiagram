import { readFileSync } from 'node:fs';
// ponytail: SVG-only layout audit — parses an exported pid SVG (no DOM, no render)
// so an LLM can "see" geometry as ranked text. Usage: node audit-svg.mjs <file.svg>
const file = process.argv[2] || 'pid-spike-export(1).svg';
const s = readFileSync(file, 'utf8');
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
  pipes.push({ from, to, cls, subs, label: cls === 'nozzle' ? `nozzle@${Math.round(subs[0][0].x)},${Math.round(subs[0][0].y)}` : cls === 'tap' ? `${from.replace(/^tap-/, '')}~tap->` : `${from}->${to}` });
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
for (const m of R(/<g data-pid-id="([^"]+)">(.*?)<\/g>/gs, s)) {
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
const texts = [];
for (const m of R(/<text\b([^>]*)>([^<]*)<\/text>/g, s)) {
  const a = m[1];
  // ponytail: decode entities before measuring (see pidTextBoxes)
  const content = m[2].trim().replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  if (!content) continue;
  const xm = a.match(/x="(-?[\d.]+)"/), ym = a.match(/y="(-?[\d.]+)"/), fm = a.match(/font-size="(-?[\d.]+)"/);
  if (!xm || !ym) continue;
  const fs = fm ? +fm[1] : 3, x = +xm[1], y = +ym[1];
  // ponytail: rotate(90) labels run vertically — swap the approx box axes or
  // every vertical designation flags phantom collisions
  const vert = /rotate\(90/.test(a);
  const w0 = content.length * fs * 0.55, h0 = fs * 1.15;
  const w = vert ? h0 : w0, h = vert ? w0 : h0;
  const mid = /text-anchor="middle"/.test(a);
  texts.push({ t: content.slice(0, 28), x, y, fs, x0: mid ? x - w / 2 : x, x1: mid ? x + w / 2 : x + w, y0: y - h, y1: y });
}
const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

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
