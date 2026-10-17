// symbol-ink.mjs — the drawn linework of a glyph, as geometry.
//
// One implementation, shared by every symbol fixer and check. The alternative is a copy
// per script, and copies drift: this project has already shipped three phantom findings
// from exactly that (audit-symbols §9.45, "five attempts at detecting the flow axis").
// If a number here changes, every consumer changes with it, deliberately.
//
// Units are the glyph's own viewBox units. Ports and anchors in the bundle are PERCENT of
// the viewBox (pid-parser connWorld / portOffset), so callers convert at the edges.

export const vbOf = (svg) => {
  const m = (svg || '').match(/viewBox="([^"]+)"/);
  if (!m) return null;
  const p = m[1].split(/[\s,]+/).map(Number);
  return p.length === 4 && p.every(Number.isFinite) && p[2] > 0 && p[3] > 0
    ? { x: p[0], y: p[1], w: p[2], h: p[3] } : null;
};

const attr = (s, n) => { const m = s.match(new RegExp(`\\b${n}="([^"]*)"`)); return m ? parseFloat(m[1]) : NaN; };

// Arc endpoints only. An arc's bulge is not reconstructed, so the ink it contributes is
// its chord — an UNDER-estimate. Every caller uses the ink to decide where metal is, and
// under-estimating can only make a port land slightly inside a curve, never outside it.
const AR = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };

export function ink(svg) {
  const segs = [];    // [x1,y1,x2,y2,strokeWidth]
  const circles = []; // [cx,cy,r]
  const seg = (x1, y1, x2, y2, sw) => { if ([x1, y1, x2, y2].every(Number.isFinite)) segs.push([x1, y1, x2, y2, Number.isFinite(sw) ? sw : 1]); };
  svg = svg || '';
  for (const m of svg.matchAll(/<line\b[^>]*>/gi)) seg(attr(m[0], 'x1'), attr(m[0], 'y1'), attr(m[0], 'x2'), attr(m[0], 'y2'), attr(m[0], 'stroke-width'));
  for (const m of svg.matchAll(/<rect\b[^>]*>/gi)) {
    const x = attr(m[0], 'x'), y = attr(m[0], 'y'), w = attr(m[0], 'width'), h = attr(m[0], 'height'), sw = attr(m[0], 'stroke-width');
    if ([x, y, w, h].every(Number.isFinite)) { seg(x, y, x + w, y, sw); seg(x + w, y, x + w, y + h, sw); seg(x + w, y + h, x, y + h, sw); seg(x, y + h, x, y, sw); }
  }
  for (const m of svg.matchAll(/<circle\b[^>]*>/gi)) {
    const cx = attr(m[0], 'cx'), cy = attr(m[0], 'cy'), r = attr(m[0], 'r');
    if ([cx, cy, r].every(Number.isFinite)) circles.push([cx, cy, r]);
  }
  for (const m of svg.matchAll(/<(?:polyline|polygon)\b[^>]*>/gi)) {
    const p = m[0].match(/\bpoints="([^"]*)"/); if (!p) continue;
    const sw = attr(m[0], 'stroke-width');
    const v = p[1].trim().split(/[\s,]+/).map(Number);
    for (let i = 0; i + 3 < v.length; i += 2) seg(v[i], v[i + 1], v[i + 2], v[i + 3], sw);
    if (/polygon/i.test(m[0]) && v.length >= 4) seg(v[v.length - 2], v[v.length - 1], v[0], v[1], sw);
  }
  for (const m of svg.matchAll(/<path\b[^>]*>/gi)) {
    const d = m[0].match(/\bd="([^"]*)"/); if (!d) continue;
    const sw = attr(m[0], 'stroke-width');
    const toks = d[1].match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    let i = 0, cmd = null, cx = 0, cy = 0, sx = 0, sy = 0, started = false;
    while (i < toks.length) {
      const t = toks[i];
      if (/^[a-zA-Z]$/.test(t)) {
        cmd = t; i++;
        if (/[Zz]/.test(cmd)) { if (started) seg(cx, cy, sx, sy, sw); cx = sx; cy = sy; started = false; }
        continue;
      }
      if (!cmd) { i++; continue; }
      const U = cmd.toUpperCase(), rel = cmd !== U, n = AR[U]; if (!n) { i++; continue; }
      const a = toks.slice(i, i + n).map(Number); if (a.length < n) break;
      let ex, ey;
      if (n === 1) { const v = a[0]; if (U === 'H') { ex = rel ? cx + v : v; ey = cy; } else { ex = cx; ey = rel ? cy + v : v; } }
      else if (U === 'A') { ex = rel ? cx + a[5] : a[5]; ey = rel ? cy + a[6] : a[6]; }
      else { ex = rel ? cx + a[a.length - 2] : a[a.length - 2]; ey = rel ? cy + a[a.length - 1] : a[a.length - 1]; }
      // M MOVES the pen and draws nothing. Emitting a segment from the previous point for
      // an M puts a phantom stroke from (0,0) into every glyph that opens with an absolute
      // move, which drags the ink bbox and with it every derived arrival direction.
      if (started) seg(cx, cy, ex, ey, sw);
      if (U === 'M') { sx = ex; sy = ey; started = true; }
      cx = ex; cy = ey; i += n;
    }
  }
  return { segs, circles };
}

export function contentBBox(svg){return inkBBox(ink(svg));}

export function inkBBox(g) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const put = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const [a, b, c, d] of g.segs) { put(a, b); put(c, d); }
  for (const [cx, cy, r] of g.circles) { put(cx - r, cy - r); put(cx + r, cy + r); }
  return Number.isFinite(x0) ? { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 } : null;
}

export function maxStroke(g) {
  let m = 1;
  for (const [, , , , s] of g.segs) if (Number.isFinite(s) && s > m) m = s;
  return m;
}

export const dPointSeg = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

/** Distance from a point to the ink, in viewBox units. */
export function gapToInk(g, x, y) {
  let d = Infinity;
  for (const [x1, y1, x2, y2] of g.segs) d = Math.min(d, dPointSeg(x, y, x1, y1, x2, y2));
  for (const [cx, cy, r] of g.circles) d = Math.min(d, Math.abs(Math.hypot(x - cx, y - cy) - r));
  return d;
}

/** Dense sample of the ink. Resolution is finer than the smallest stroke in the library. */
export function inkPoints(g, step = 0.25) {
  const P = [];
  for (const [x1, y1, x2, y2] of g.segs) {
    const L = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k <= n; k++) { const t = k / n; P.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]); }
  }
  for (const [cx, cy, r] of g.circles) {
    // a multiple of 4, so the cardinal points are exact samples: the top of a bubble is
    // where its "top" port goes, and a sample 0.1u off it is noise in the diff
    const n = Math.max(8, Math.ceil((2 * Math.PI * r) / step / 4) * 4);
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; P.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  }
  return P;
}
