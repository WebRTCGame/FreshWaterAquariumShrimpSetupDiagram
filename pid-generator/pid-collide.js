// P&ID Collision module — bounding geometry + cheap broadphase + exact tests.
// Loaded after pid-rules.js (uses ruleParam for pads), no other dependencies.
//
// Pipeline per the request: every object → bounding geometry → spatial index
// → candidate collisions → exact intersection test. At our scale (dozens of
// entities, dozens of pipes) the "index" is a uniform grid rebuilt per query
// set — O(n) build, O(1) cell lookup — with brute-force fallback for tiny
// sets. No external lib (see verdict in plan): RBush/R-tree pays off past
// ~1k objects with insert/delete churn; we rebuild from scratch per render.
//
// Shapes: rect {x0,y0,x1,y1}, circle {cx,cy,r}, seg {ax,ay,bx,by}.
// API:
//   collide.indexOf(rects) -> { query(rect) }           grid broadphase
//   collide.rectsHit(a, b)                              exact rect-rect
//   collide.segHitsRect(sg, r, pad)                     exact seg-rect (with pad)
//   collide.nearby(items, x, y, r, getRect)             "within R of point"
//   collide.entityBox(e, SC, opts)                      entity → padded rect
function collideRectsHit(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}
// exact: does axis-aligned segment come within pad of rect?
function collideSegHitsRect(sg, r, pad) {
  const p = pad || 0;
  const ax = sg[0].x !== undefined ? sg[0].x : sg.ax, ay = sg[0].y !== undefined ? sg[0].y : sg.ay;
  const bx = sg[1].x !== undefined ? sg[1].x : sg.bx, by = sg[1].y !== undefined ? sg[1].y : sg.by;
  const x0 = r.x0 - p, x1 = r.x1 + p, y0 = r.y0 - p, y1 = r.y1 + p;
  // endpoint inside
  if ((ax > x0 && ax < x1 && ay > y0 && ay < y1) || (bx > x0 && bx < x1 && by > y0 && by < y1)) return true;
  // axis-aligned crossing test
  if (Math.abs(ay - by) < 0.5) {
    if (ay < y0 || ay > y1) return false;
    return Math.min(ax, bx) < x1 && Math.max(ax, bx) > x0;
  }
  if (Math.abs(ax - bx) < 0.5) {
    if (ax < x0 || ax > x1) return false;
    return Math.min(ay, by) < y1 && Math.max(ay, by) > y0;
  }
  return false; // non-axis segments never occur in routing; refuse, don't guess
}
// uniform-grid index over static rects. cell = routing grid (5mm default).
function collideIndexOf(rects, cell) {
  const cs = cell || 20;
  const grid = new Map();
  const key = (cx, cy) => cx + ',' + cy;
  rects.forEach((r, i) => {
    for (let cx = Math.floor(r.x0 / cs); cx <= Math.floor(r.x1 / cs); cx++) {
      for (let cy = Math.floor(r.y0 / cs); cy <= Math.floor(r.y1 / cs); cy++) {
        const k = key(cx, cy);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
    }
  });
  return {
    query(q) {
      const seen = new Set(), out = [];
      for (let cx = Math.floor(q.x0 / cs); cx <= Math.floor(q.x1 / cs); cx++) {
        for (let cy = Math.floor(q.y0 / cs); cy <= Math.floor(q.y1 / cs); cy++) {
          for (const i of (grid.get(key(cx, cy)) || [])) {
            if (!seen.has(i) && collideRectsHit(q, rects[i])) { seen.add(i); out.push(rects[i]); }
          }
        }
      }
      return out;
    },
  };
}
// "what is within R of this valve?" — point query over items with rects.
function collideNearby(items, x, y, r, getRect) {
  const q = { x0: x - r, x1: x + r, y0: y - r, y1: y + r };
  return items.filter((it) => collideRectsHit(q, getRect(it)));
}
// entity → padded obstacle rect (same pads as routeObstacles: single source
// of truth for "what counts as colliding").
function collideEntityBox(e, SC, isInst) {
  const s = PIDEngine.entitySize(e, SC || 1);
  const PAD = (typeof ruleParam === 'function' ? ruleParam('routing.obstaclePad', 4) : 4);
  const padB = isInst
    ? (typeof ruleParam === 'function' ? ruleParam('routing.instrumentMargin', 3) : 3)
    : (typeof ruleParam === 'function' ? ruleParam('routing.labelPadBottom', 14) : 14);
  return { x0: e.x - s / 2 - PAD, x1: e.x + s / 2 + PAD, y0: e.y - s / 2 - PAD, y1: e.y + s / 2 + padB };
}
// nozzle flange → obstacle rects (array: tube + flange bar separately).
// A single fat box overstates the metal and warps routing (measured: +7
// crossings on spike). Tube: base→tip ±2mm. Flange bar: last 4mm at the tip,
// ±5.5mm across (50 glyph units tall). Unresolved (null) nozzles yield [].
function collideNozzleBoxes(nz, SC) {
  if (!nz || !nz.position || !nz.tipPosition) return [];
  const s = SC || 1;
  const ax = nz.tipPosition.x - nz.position.x, ay = nz.tipPosition.y - nz.position.y;
  const L = Math.hypot(ax, ay);
  if (L < 0.5) return [];
  const ux = ax / L, uy = ay / L, px = -uy, py = ux;
  const at = (d, o) => ({ x: nz.position.x + ux * d + px * o, y: nz.position.y + uy * d + py * o });
  const rect = (p, q) => ({ x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y) });
  const T = 2 * s, FH = 5.5 * s, FL = Math.min(4 * s, L);
  const tube = rect(at(0, -T), at(L, T));
  const flange = rect(at(L - FL, -FH), at(L, FH));
  return [tube, flange];
}
function collideNozzleBox(nz, SC) {
  const rs = collideNozzleBoxes(nz, SC);
  if (!rs.length) return null;
  return {
    x0: Math.min(rs[0].x0, rs[1].x0), x1: Math.max(rs[0].x1, rs[1].x1),
    y0: Math.min(rs[0].y0, rs[1].y0), y1: Math.max(rs[0].y1, rs[1].y1),
  };
}
// tap host geometry: the routed pipe a tap lands on. A port-named tap lands
// on its own nozzle's pipe (never a neighbor run); bare/errored taps fall
// back to first-touch (validator already reported them).
function collideTapHostGeom(geometries, hostId, portId) {
  const touching = geometries.filter(gg => gg.p.from === hostId || gg.p.to === hostId);
  if (!portId) return touching[0];
  const viaPort = touching.find(gg =>
    (gg.p.from === hostId && gg.p._from && gg.p._from.conn && gg.p._from.conn.id === portId) ||
    (gg.p.to === hostId && gg.p._to && gg.p._to.conn && gg.p._to.conn.id === portId));
  return viaPort || touching[0];
}
var collide = {
  rectsHit: collideRectsHit, segHitsRect: collideSegHitsRect,
  indexOf: collideIndexOf, nearby: collideNearby, entityBox: collideEntityBox,
  nozzleBox: collideNozzleBox, nozzleBoxes: collideNozzleBoxes,
  tapHostGeom: collideTapHostGeom,
};
