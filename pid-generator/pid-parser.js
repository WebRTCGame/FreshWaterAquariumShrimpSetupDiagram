// P&ID Parser — DSL parser, ISA knowledge, symbol lookup, geometry engine.
// Loaded second (after geometric_objects.js + pid-symbols-bundle.js).
// P&IDGenerator — standalone P&ID generator (no mermaid dependency).
// DSL text -> semantic model -> validated, orthogonal SVG.
// Glyphs from window.PID_SYMBOLS (bundled from pid-svg-library by build-data.ps1).


// ponytail: engine class — consolidates duplicated geometry/entity helpers scattered across the file.
// Methods are static; they reference SYMBOL_KEYS / symbolSize which are defined later in the file
// but only called after full evaluation, so the forward reference is safe.
// Uses geometric_objects.js ({x,y} natively, no per-call conversion).
var PIDEngine = {
  /** Distance between two {x,y} points. */
  dist(a, b) {
    return magnitude({ x: a.x - b.x, y: a.y - b.y });
  },
  /** Segments from polyline: [[pt0,pt1],[pt1,pt2], ...] */
  segs(pts) {
    const o = [];
    for (let i = 1; i < pts.length; i++) o.push([pts[i - 1], pts[i]]);
    return o;
  },

  /** Crossing point of two axis-aligned segments, or null. */
  crossing(s1, s2) {
    const p1 = s1[0], p2 = s1[1], p3 = s2[0], p4 = s2[1];
    // ponytail: epsilon, not === — sub-cell jogs (0.2mm off-axis) are
    // functionally straight, and exact equality made their crossings invisible
    // to gap assignment (lines read as joined with no break ever cut)
    const h1 = Math.abs(p1.y - p2.y) < 0.5, h2 = Math.abs(p3.y - p4.y) < 0.5;
    if (h1 === h2) return null;
    const h = h1 ? s1 : s2, v = h1 ? s2 : s1;
    const hx1 = h[0].x, hx2 = h[1].x, cy = (h[0].y + h[1].y) / 2;
    const vx = (v[0].x + v[1].x) / 2, vy1 = v[0].y, vy2 = v[1].y;
    if (vx < Math.min(hx1, hx2) + 1 || vx > Math.max(hx1, hx2) - 1) return null;
    if (cy < Math.min(vy1, vy2) + 1 || cy > Math.max(vy1, vy2) - 1) return null;
    return { x: vx, y: cy };
  },

  /** True crossing: intersection exists and is not near either segment endpoint. */
  isRealCrossing(si, sj, gap) {
    const x = PIDEngine.crossing(si, sj);
    if (!x) return false;
    const threshold = gap || 4;
    for (const s of [si, sj]) {
      if (magnitude({ x: x.x - s[0].x, y: x.y - s[0].y }) < threshold) return false;
      if (magnitude({ x: x.x - s[1].x, y: x.y - s[1].y }) < threshold) return false;
    }
    return true;
  },

  /** Rotate (sx, sy) around origin by angleDeg. */
  rotatePoint(sx, sy, angleDeg) {
    return pointRotate({ x: sx, y: sy }, angleDeg);
  },

  /** Dominant axis direction from a vector: returns {x,y} with one component in {-1,0,1}. */
  portDir(pdx, pdy) {
    return Math.abs(pdx) >= Math.abs(pdy)
      ? { x: Math.sign(pdx), y: 0 }
      : { x: 0, y: Math.sign(pdy) };
  },

  /** Resolve glyph library key for an entity. */
  glyphKey(e) {
    if (e.symbol) return e.symbol;
    return SYMBOL_KEYS[e.type] || SYMBOL_KEYS.vessel;
  },

  /** Full scaled pixel size of an entity (instrument bubble or equipment glyph). */
  entitySize(e, sc) {
    const s = sc || 1;
    if (PIDEngine._isInst && PIDEngine._isInst(e)) {
      return symbolSize('isa-5.1/instruments/field-instrument') * s;
    }
    return (e.symbol ? symbolSize(e.symbol) : symbolSize(SYMBOL_KEYS[e.type] || 'pip/equipment/vessel-vertical'))
      * (e.scale || 1) * s;
  },

  /** Half scaled pixel size of an entity. */
  entityHalf(e, sc) {
    return PIDEngine.entitySize(e, sc) / 2;
  },

  /** The glyph's own viewBox, as {w, h}, or null if it has none. */
  symbolViewBox(symbolKey) {
    const def = (typeof window !== 'undefined' && window.PID_SYMBOLS && window.PID_SYMBOLS[symbolKey]) || null;
    if (!def || !def.svg) return null;
    const m = def.svg.match(/viewBox="([^"]+)"/);
    if (!m) return null;
    const p = m[1].split(/[\s,]+/).map(Number);
    if (p.length !== 4 || !p.every(Number.isFinite) || p[2] <= 0 || p[3] <= 0) return null;
    return { x: p[0], y: p[1], w: p[2], h: p[3] };
  },

  /** Offset from an entity's centre to one of its ports, in the units of `size`.
   *
   *  ===================================================================
   *  CORRECT MAPPING — MEASURED, AND DELIBERATELY NOT USED. See 9.30.
   *  ===================================================================
   *  Six call sites compute `((conn.x - 50) / 100) * size` in both axes. That
   *  identity is only true when the glyph's viewBox is SQUARE, and 123 of 201
   *  symbols are not: `embedSymbolRaw` nests the glyph's own <svg viewBox>
   *  inside a square width=size height=size box, so the browser applies
   *  preserveAspectRatio and letterboxes it, leaving the drawn content's centre
   *  offset from the box centre.
   *
   *  Worked example, isa-5.1/flow-elements/flow-nozzle (viewBox 160x80, size 100):
   *    s = min(100/160, 100/80) = 0.625; ox = 0; oy = (100 - 50)/2 = 25
   *    port "left" at pct (10,25) -> viewBox (16,20) -> screen (10, 37.5)
   *      -> offset from centre (-40, -12.5)
   *    naive formula gave (-40, -25)  =>  12.50 mm error, matching the
   *    audit-symbols SYM-PORT-DRIFT figure exactly.
   *  The DIRECTION is wrong for the same reason: the on-screen vector is not
   *  parallel to (conn.x-50, conn.y-50) once the content is offset.
   *
   *  For a square viewBox this reduces EXACTLY to the old formula, so square
   *  symbols are bit-identical either way.
   *
   *  WHY IT IS NOT CALLED (measured, 2026-09-25 — do not just switch it on):
   *
   *    configuration              spike  dense  min  split  demo  total
   *    naive (in use)               995    248   58    36   199   1536
   *    all six sites corrected     1051    288   63    38   227   1667
   *    all but nozzleTip position  1569    228   63    36   225   2121
   *
   *  The geometrically correct mapping made every sheet WORSE, and in one
   *  configuration spike jumped 995 -> 1569. The reason is coupling: the naive
   *  formula is wrong about the INK but self-consistent with everything else in
   *  the engine — 5/20 mm grid alignment, cardinal snapping of nozzle directions,
   *  collision margins and the 14 mm lead-in were all calibrated against it.
   *  Correcting one term of a coupled system moves it off its optimum unless the
   *  others are re-tuned in the same change.
   *
   *  The visible cost of leaving it alone is near zero: 18 of the 20 drifting
   *  symbols are under 2 mm on a 10-100 mm body, and the two 12.5 mm offenders
   *  (flow-nozzle, venturi-tube) appear on no sheet in the corpus.
   *
   *  So: adopt this in Stage 1/2 TOGETHER with re-tuning the grid and lead-in
   *  constants, never as an isolated change. `audit-symbols.mjs` reports
   *  SYM-PORT-DRIFT and will tell you when the drift itself is closed.
   */
  portOffset(symbolKey, conn, size) {
    const naive = { x: ((conn.x - 50) / 100) * size, y: ((conn.y - 50) / 100) * size };
    const vb = PIDEngine.symbolViewBox(symbolKey);
    if (!vb) return naive;
    const s = Math.min(size / vb.w, size / vb.h);
    if (!isFinite(s) || s <= 0) return naive;
    const ox = (size - vb.w * s) / 2, oy = (size - vb.h * s) / 2;
    const vx = vb.x + (conn.x / 100) * vb.w, vy = vb.y + (conn.y / 100) * vb.h;
    return { x: ox + vx * s - size / 2, y: oy + vy * s - size / 2 };
  },

  /** Outward unit direction from an entity centre to one of its ports, accounting
   *  for a letterboxed (non-square) viewBox. See portOffset. */
  portDirXY(symbolKey, conn, size) {
    const o = PIDEngine.portOffset(symbolKey, conn, size);
    const L = Math.hypot(o.x, o.y);
    if (!L) return { x: 0, y: -1 };
    return { x: o.x / L, y: o.y / L };
  },

  /** World-space offset from entity center to anchor point.
   *  anchor is in normalized 0-100 glyph coords; offset = (anchor - 50)/100 * scaledSize. */
  anchorOffset(e, size) {
    const sym = e.symbol || (typeof SYMBOL_KEYS !== 'undefined' && SYMBOL_KEYS[e.type]) || '';
    const def = (typeof window !== 'undefined' && window.PID_SYMBOLS && window.PID_SYMBOLS[sym]) || null;
    if (!def || !def.anchor) return { x: 0, y: 0 };
    const sc = (e.scale || 1);
    const s = size || (def.size * sc);
    return PIDEngine.portOffset(sym, def.anchor, s);
  },

  /** Sheet boundary rectangle with rule-registry margin. */
  sheetBounds(sheetW, sheetH) {
    const W = sheetW || 864, H = sheetH || 559;
    const M = (typeof ruleParam === 'function' ? ruleParam('routing.sheetMargin', 26) : 26);
    return { x0: M, x1: W - M, y0: M, y1: H - M };
  },

  /** Build { id: entity } lookup from multiple arrays. */
  buildById() {
    const out = {};
    for (const arr of arguments) {
      for (const e of arr) out[e.id || e.tag] = e;
    }
    return out;
  },

  /** Connection world position: normalised glyph coord -> SVG canvas coord. */
  connWorld(e, conn, size, opts) {
    const noNozzle = opts && opts.noNozzle;
    const sc = (opts && opts.sc) || 1;
    let cx = conn.x, cy = conn.y;
    if (e.rotation) {
      const rp = PIDEngine.rotatePoint(cx - 50, cy - 50, e.rotation);
      cx = rp.x + 50; cy = rp.y + 50;
    }
    const scale = (size / 100) * sc;
    const x = e.x + (cx - 50) * scale;
    const y = e.y + (cy - 50) * scale;
    if (!noNozzle && conn.type === 'nozzle') {
      const dx = cx - 50, dy = cy - 50;
      const len = magnitude({ x: dx, y: dy }) || 1;
      return { x: x + (dx / len) * 14 * scale, y: y + (dy / len) * 14 * scale };
    }
    return { x, y };
  },

  /** Collinear overlap length of two segments on the same axis. Returns 0 if no overlap. */
  overlapLen(s1, s2) {
    const a = s1[0], b = s1[1], c = s2[0], d = s2[1];
    if (a.y === b.y && c.y === d.y) {
      const y = a.y;
      if (Math.abs(y - c.y) > 0.5) return 0;
      const lo = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
      const hi = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
      return Math.max(0, hi - lo);
    }
    if (a.x === b.x && c.x === d.x) {
      const x = a.x;
      if (Math.abs(x - c.x) > 0.5) return 0;
      const lo = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
      const hi = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
      return Math.max(0, hi - lo);
    }
    return 0;
  },

  /** Bounding box around an entity. */
  entityBBox(e, pad, padBottom) {
    const s = PIDEngine.entitySize(e);
    const pb = padBottom != null ? padBottom : pad;
    return { x0: e.x - s / 2 - pad, x1: e.x + s / 2 + pad, y0: e.y - s / 2 - pad, y1: e.y + s / 2 + pb };
  },

  /** Set the instrument-check function (called once after instruments array is available). */
  _isInst: null,
};

/**
 * Description placeholder

 *
 * @type {{ parse: (text: any) => { equipment: {}; valves: {}; instruments: {}; junctions: {}; pipes: {}; lineDefs: {}; loops: {}; alarms: {}; interlocks: {}; relationships: {}; pipelines: {}; graphs: {}; view: { show: string; ... 11 more ...; sheetH: number; }; ... 4 more ...; _seq: number; }; }}
 */
// ponytail: schema defaults — adds base PidObject properties to every created object.
// See pid-schema.js for the full type hierarchy.
function schemaDefaults(className, objectType, id) {
  return {
    // identity
    id: id || null,
    objectType,
    className,
    // engineering identity
    displayName: null, description: null, service: null, system: null,
    area: null, unit: null, plant: null, discipline: null,
    // organization
    drawingId: null, parentId: null, layer: null, pipelineId: null,
    // graphics defaults
    rotation: 0, scale: 1, boundingBox: null,
    visible: true, locked: false, selectable: true, zOrder: 0,
    styleId: null, symbolId: null,
    // connectivity
    connections: [],
    // relationships
    relationships: [],
    // lifecycle
    lifecycleState: 'new', designStatus: null, revisionStatus: null,
    // audit
    createdAt: null, createdBy: null, modifiedAt: null, modifiedBy: null,
    // provenance
    source: 'manual', sourceType: null, sourceId: null,
    sourceDocument: null, sourceRevision: null, externalId: null,
    // validation
    validationState: 'unchecked', validationMessages: [], ruleOverrides: [],
    // properties
    attributes: {}, notes: '', customProperties: {},
  };
};
// Phase 7: Built-in assembly catalog — loaded from assembly.js before this file.
// Resolution order: DSL-defined assemblies first, then BUILTIN_ASSEMBLIES.

var PID_PARSER = {
  parse: (text, opts) => {
    const data = { equipment: [], valves: [], instruments: [], junctions: [], nozzles: [], pipes: [], lineDefs: {}, loops: [], alarms: [], interlocks: [], relationships: [], pipelines: [], graphs: {}, view: { show: 'all', hideLabels: false, stubLength: 8, layout: 'manual', fitPage: false, legend: false, northArrow: false, grid: 5, laneGrid: 5, chips: false, route: 'avoid', symbolScale: 1, sheetW: 864, sheetH: 559, theme: 'print' }, warnings: [], errors: [], info: [], schemaVersion: 1, _seq: 0, assemblies: {} };

    // Phase 7: Assembly definitions — expand to flat with provenance
    const assemblyRegistry = {};
    let inAssembly = false, assemblyName = null, assemblyParams = [], assemblyBody = [];

    // First pass: collect assembly definitions
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('%%')) continue;
      let m;
      if (inAssembly) {
        if ((m = line.match(/^end\s+(\w+)$/))) {
          if (m[1] !== assemblyName) throw new Error(`pid parser: assembly end name mismatch (${m[1]} != ${assemblyName})`);
          assemblyRegistry[assemblyName] = { params: assemblyParams, body: assemblyBody.join('\n') };
          inAssembly = false;
          assemblyName = null;
          assemblyParams = [];
          assemblyBody = [];
        } else {
          assemblyBody.push(rawLine);
        }
        continue;
      }
      if ((m = line.match(/^assembly\s+(\w+)(?:\s*\(([^)]*)\))?$/))) {
        assemblyName = m[1];
        assemblyParams = m[2] ? m[2].split(',').map(s => s.trim()).filter(Boolean) : [];
        inAssembly = true;
        continue;
      }
    }

    // Second pass: parse with assembly expansion
    const expandLine = (line, args) => {
      let out = line;
      // positional $1, $2...
      for (let i = 0; i < args.positional.length; i++) {
        out = out.replace(new RegExp(`\\$${i + 1}`, 'g'), args.positional[i]);
      }
      // named $name
      for (const [k, v] of Object.entries(args.named)) {
        out = out.replace(new RegExp(`\\$${k}\\b`, 'g'), v);
      }
      return out;
    };

    const parseWithExpansion = (text, data, provenance) => {
      for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith('%%')) continue;
        let m;

        if (line === 'pid' || line === 'pidDiagram') continue;

        if ((m = line.match(/^show\s+(all|equipment|valves|instruments)$/))) { data.view.show = m[1]; continue; }
        if ((m = line.match(/^(hide|show)\s+labels$/))) { data.view.hideLabels = m[1] === 'hide'; continue; }
        if ((m = line.match(/^stub\s+([\d.]+)$/))) { data.view.stubLength = parseFloat(m[1]); continue; }
        if ((m = line.match(/^grid\s+([\d.]+)$/))) { data.view.grid = parseFloat(m[1]); continue; }
        if ((m = line.match(/^seed\s+(\d+)$/))) { data.view.seed = parseInt(m[1], 10); continue; }
        // D4 drafting theme: presentation only, never geometry
        if ((m = line.match(/^theme\s+(cad|print)$/))) { data.view.theme = m[1]; continue; }
        if ((m = line.match(/^scale\s+([\d.]+)$/))) { data.view.symbolScale = parseFloat(m[1]); continue; }
        if ((m = line.match(/^chips\s+(on|off)$/))) { data.view.chips = m[1] === 'on'; continue; }
        if ((m = line.match(/^route\s+(avoid|direct)$/))) { data.view.route = m[1]; continue; }
        if ((m = line.match(/^fit\s+page$/))) { data.view.fitPage = true; continue; }
        if ((m = line.match(/^layout\s+(auto|manual)$/))) { data.view.layout = m[1]; continue; }
        if ((m = line.match(/^title\s+"([^"]+)"/))) { data.view.title = m[1]; continue; }
        if ((m = line.match(/^project\s+"([^"]+)"/))) { data.view.project = m[1]; continue; }
        if ((m = line.match(/^sheet\s+(\d+)(?:\s+of\s+(\d+))?$/))) { data.view.sheet = m[1]; data.view.sheetTotal = m[2] || m[1]; continue; }
        if ((m = line.match(/^rev\s+"([^"]+)"\s+"([^"]+)"(?:\s+"([^"]*)")?$/))) { data.view.rev = { mark: m[1], date: m[2], desc: m[3] || '' }; continue; }
        if ((m = line.match(/^(legend|north-arrow)\s+(on|off)$/))) { data.view[m[1] === 'legend' ? 'legend' : 'northArrow'] = m[2] === 'on'; continue; }
        if ((m = line.match(/^status\s+(preliminary|design|review|construction|as-built|superseded)$/))) { data.view.status = m[1]; continue; }
        if ((m = line.match(/^units\s+"([^"]+)"/))) { data.view.units = m[1]; continue; }

        if ((m = line.match(/^line\s+([A-Za-z0-9_\-]+)(.*)$/))) {
          const def = {};
          let rem = m[2].trim();
          while (rem) {
            rem = rem.trim();
             const f = rem.match(/^(size|service|number|spec|ins|thick|trace|fluid|phase|pressure|temperature|material|insulation|tracing)\s+(\S+)/);
            if (!f) throw new Error(`pid parser: bad line spec field in "${line}"`);
            def[f[1]] = f[2];
            rem = rem.slice(f[0].length);
          }
          data.lineDefs[m[1]] = def;
          continue;
        }

        if ((m = line.match(/^version\s+(\d+)$/))) {
          data.schemaVersion = parseInt(m[1], 10);
          continue;
        }

        if ((m = line.match(/^use\s+([\w-]+)(?:\s*\(([^)]*)\))?$/))) {
          const asmName = m[1];
          let asm = assemblyRegistry[asmName];
          if (!asm) asm = BUILTIN_ASSEMBLIES[asmName];
          if (!asm) throw new Error(`pid parser: unknown assembly "${asmName}"`);
          const args = { positional: [], named: {} };
          if (m[2]) {
            for (const arg of m[2].split(',')) {
              const am = arg.trim().match(/^(\w+)=(.+)$/);
              if (am) args.named[am[1]] = am[2].replace(/^"|"$/g, '');
              else args.positional.push(arg.trim().replace(/^"|"$/g, ''));
            }
          }
          // Build substitution map from assembly params
          const subArgs = { positional: [], named: {} };
          for (let i = 0; i < asm.params.length; i++) {
            const p = asm.params[i];
            const eq = p.indexOf('=');
            const pname = eq >= 0 ? p.slice(0, eq) : p;
            const pdefault = eq >= 0 ? p.slice(eq + 1).replace(/^"|"$/g, '') : '';
            if (args.named[pname] !== undefined) subArgs.named[pname] = args.named[pname];
            else if (eq >= 0) subArgs.named[pname] = pdefault; // named param with default
            else if (i < args.positional.length) subArgs.positional.push(args.positional[i]);
            else subArgs.positional.push(pdefault);
          }
          for (const [k, v] of Object.entries(args.named)) {
            if (!asm.params.some(p => (p.indexOf('=') >= 0 ? p.slice(0, p.indexOf('=')) : p) === k)) {
              subArgs.named[k] = v;
            }
          }
          const expanded = asm.body.split('\n').map(l => expandLine(l, subArgs)).join('\n');
          // Recursively parse expanded body with provenance
          const childProv = { source: 'assembly', sourceId: asmName, externalId: provenance ? `${provenance.externalId}>${asmName}` : asmName };
          parseWithExpansion(expanded, data, childProv);
          continue;
        }

        if ((m = line.match(/^(equipment|valve)\s+([A-Za-z0-9_\-]+)\s+([a-z0-9_\-]+)(.*)$/))) {
          const kind = m[1];
          const e = { ...schemaDefaults(kind, kind === 'equipment' ? 'equipment' : 'valve', m[2]), id: m[2], type: m[3], _seq: data._seq++ };
          if (provenance) { e.source = provenance.source; e.sourceId = provenance.sourceId; e.externalId = provenance.externalId; }
          parseModifiers(m[4], e);
          (kind === 'equipment' ? data.equipment : data.valves).push(e);
          continue;
        }

        if ((m = line.match(/^loop\s+([A-Za-z0-9_\-]+)\s+measure\s+([A-Za-z0-9_\-]+)\s+controller\s+([A-Za-z0-9_\-]+)\s+manipulate\s+([A-Za-z0-9_\-]+)$/))) {
          data.loops.push({ id: m[1], measure: m[2], controller: m[3], manipulate: m[4], explicit: true });
          continue;
        }

        if ((m = line.match(/^(protects|discharges)\s+([A-Za-z0-9_\-]+)\s*->\s*([A-Za-z0-9_\-]+)$/))) {
          data.relationships.push({ kind: m[1] === 'protects' ? 'protected_by' : 'discharges_to', from: m[2], to: m[3], fromPort: null, toPort: null, metadata: null });
          continue;
        }

        if ((m = line.match(/^alarm\s+([A-Za-z0-9_\-]+)\s+from\s+([A-Za-z0-9_\-]+)\s+condition\s+(high|low|high-high|low-low)(?:\s+priority\s+(low|medium|high|critical))?$/))) {
          data.alarms.push({ ...schemaDefaults('alarm', 'alarm', m[1]), id: m[1], source: m[2], condition: m[3], priority: m[4] || 'medium' });
          continue;
        }

        if ((m = line.match(/^interlock\s+([A-Za-z0-9_\-]+)\s+when\s+([A-Za-z0-9_\-]+)\s+action\s+([A-Za-z0-9_\-]+)$/))) {
          data.interlocks.push({ ...schemaDefaults('interlock', 'interlock', m[1]), id: m[1], trigger: m[2], action: m[3] });
          continue;
        }

        if ((m = line.match(/^instrument\s+([A-Za-z0-9_\-]+)(.*)$/))) {
          const inst = { ...schemaDefaults('instrument', 'instrument', m[1]), tag: m[1] };
          if (provenance) { inst.source = provenance.source; inst.sourceId = provenance.sourceId; inst.externalId = provenance.externalId; }
          parseModifiers(m[2], inst);
          // ponytail 2026-09-25 (T6.5): validateTag DERIVES `loop` from the tag's
          // digits, and Object.assign was applied AFTER parseModifiers, so it
          // silently overwrote an explicit `loop` modifier. `instrument LT-1 field
          // "level" loop FC-101` produced loop === "1". An author's explicit loop
          // must win over a value inferred from the tag name — the whole point of
          // writing it is that the tag does not encode the loop.
          const derived = validateTag(m[1], data.warnings) || {};
          const explicitLoop = inst.loop;
          Object.assign(inst, derived);
          if (explicitLoop !== undefined) inst.loop = explicitLoop;
          data.instruments.push(inst);
          continue;
        }

        if ((m = line.match(/^junction\s+([A-Za-z0-9_\-]+)(?:\s+at\s+(-?[\d.]+)\s*,\s*(-?[\d.]+))?$/))) {
          data.junctions.push({ ...schemaDefaults('junction', 'junction', m[1]), id: m[1], x: m[2] ? parseFloat(m[2]) : null, y: m[3] ? parseFloat(m[3]) : null, _fixed: !!m[2] });
          continue;
        }

        if ((m = line.match(/^stub\s+([A-Za-z0-9_\-]+)(?:\s+at\s+(-?[\d.]+)\s*,\s*(-?[\d.]+))?$/))) {
          data.junctions.push({ ...schemaDefaults('junction', 'junction', m[1]), id: m[1], x: m[2] ? parseFloat(m[2]) : null, y: m[3] ? parseFloat(m[3]) : null, stub: true, _fixed: !!m[2] });
          continue;
        }

        // ponytail: L3 — off-page connector: a stub with a sheet reference.
        // Cut-set terminator for sheet splits (engineering judgment, not auto
        // partitioning): pipes end here legally, the marker shows where.
        if ((m = line.match(/^offpage\s+([A-Za-z0-9_\-]+)(?:\s+at\s+(-?[\d.]+)\s*,\s*(-?[\d.]+))?(?:\s+ref\s+"([^"]+)")?\s*$/))) {
          data.junctions.push({ ...schemaDefaults('junction', 'junction', m[1]), id: m[1], x: m[2] ? parseFloat(m[2]) : null, y: m[3] ? parseFloat(m[3]) : null, stub: true, offpage: true, ref: m[4] || null, _fixed: !!m[2] });
          continue;
        }

        if ((m = line.match(/^nozzle\s+([A-Za-z0-9_\-]+)\s+on\s+([A-Za-z0-9_\-]+)\s+port\s+([A-Za-z0-9_\-]+)(.*)$/))) {
          const nz = { ...schemaDefaults('nozzle', 'nozzle', m[1]), subType: 'weld_neck', ownerId: m[2], portId: m[3], size: null, rating: null, spec: null, facing: null, schedule: null, length: 14, orientation: 0, position: null, tipPosition: null, connected: false };
          parseNozzleModifiers(m[4], nz);
          data.nozzles.push(nz);
          continue;
        }

        if ((m = line.match(/^signal\s+([A-Za-z0-9_\-]+)(?:\.(\w+))?\s*->\s*([A-Za-z0-9_\-]+)(?:\.(\w+))?\s*(\w+)$/))) {
          data.pipes.push({ ...schemaDefaults('pipe', 'pipe', `sig-${m[1]}-${m[3]}`), from: m[1], fromPort: m[2] || null, to: m[3], toPort: m[4] || null, kind: 'signal', signalType: m[5] });
          continue;
        }

        // explicit process tap: instrument taps the named nozzle of an entity
        // (tap TAG -> HOST.port), or the line at that port (tap TAG ->
        // HOST.port.line — flow elements live in lines, never consume the
        // nozzle slot). Bare taps are refused (TAP_PORT).
        if ((m = line.match(/^tap\s+([A-Za-z0-9_\-]+)\s*->\s*([A-Za-z0-9_\-]+)(?:\.([A-Za-z0-9_\-]+))?(\.line)?(.*)$/))) {
          const p = { ...schemaDefaults('pipe', 'pipe', `tap-${m[1]}-${m[2]}`), from: m[1], to: m[2], toPort: m[3] || null, lineTap: !!m[4], kind: 'tap' };
          parseModifiers(m[5], p);
          data.pipes.push(p);
          continue;
        }

        if ((m = line.match(/^([A-Za-z0-9_\-]+)(?:\.(\w+))?\s*->\s*([A-Za-z0-9_\-]+)(?:\.(\w+))?(.*)$/))) {
          const p = { ...schemaDefaults('pipe', 'pipe', `pipe-${m[1]}-${m[3]}`), from: m[1], fromPort: m[2] || null, to: m[3], toPort: m[4] || null, kind: 'process' };
          parseModifiers(m[5], p);
          data.pipes.push(p);
          continue;
        }

throw new Error(`pid parser: unrecognized line "${line}"`);
      }
    };

    parseWithExpansion(text, data, null);

    // resolve relative placement + auto-layout
    const all = [...data.equipment, ...data.valves].sort((a, b) => a._seq - b._seq);
    const resolve = (e) => {
      if (e.at) { e.x = e.at.x; e.y = e.at.y; e._fixed = true; return; }
      if (e.rel) {
        const ref = all.find(o => o.id === e.rel.ref) || data.instruments.find(o => o.tag === e.rel.ref);
        if (!ref) { e.x = 90; e.y = 220; return; }
        const p = placeRelative(e, ref, 70, data.view.sheetW || 864, data.view.sheetH || 559);
        e.x = p.x; e.y = p.y;
        return;
      }
      e.x = 90; e.y = 220;
    };
    for (let pass = 0; pass < 2; pass++) for (const e of all) resolve(e);
    for (const inst of data.instruments) {
      if (inst.at) { inst.x = inst.at.x; inst.y = inst.at.y; inst._fixed = true; }
      else if (inst.rel) {
        const ref = all.find(o => o.id === inst.rel.ref);
        if (ref) { const p = placeRelative(inst, ref, 70, data.view.sheetW || 864, data.view.sheetH || 559); inst.x = p.x; inst.y = p.y; }
        else { inst.x = 150; inst.y = 110; }
      } else { inst.x = 150; inst.y = 110; }
    }
    for (const j of data.junctions) {
      if (j.x === null) { j.x = 100; j.y = 100; }
    }

    // ponytail: placement-pass ORDER is a search dimension, not a fixed law — the
    // three passes are mutually dependent and the right order varies by sheet (see
    // autoLayout's order table). parse() takes it as an optional argument so the
    // renderer can try several orders and keep the best by score; omitted, the
    // default order applies and behaviour is unchanged.
    if (data.view.layout === 'auto') {
      if (opts && opts.layoutOrder) data.layoutOrder = opts.layoutOrder;
      if (opts && opts.coordIters !== undefined) PID_COORD_ITERS = opts.coordIters;
      if (opts && opts.minSep !== undefined) PID_MIN_SEP = opts.minSep;
      autoLayout(data);
      PID_COORD_ITERS = null;
      PID_MIN_SEP = null;
    }
    // sheet clamp: nothing may sit outside the drawn border (runs after autoLayout,
    // which re-resolves relative placements)
    const SH = data.view.sheetH || 559, SW = data.view.sheetW || 864;
    for (const e of [...data.equipment, ...data.valves, ...data.junctions]) {
      e.y = Math.max(40, Math.min(SH - 60, e.y));
      e.x = Math.max(40, Math.min(SW - 60, e.x));
    }
    for (const i of data.instruments) {
      i.y = Math.max(32, Math.min(SH - 45, i.y));
      i.x = Math.max(32, Math.min(SW - 45, i.x));
    }
    resolveOverlaps(data);
    // grid-align all entity centers (Rule 71/72: explicit snapping); fixed `at` is honored exactly.
    // overlap resolution runs AGAIN after snapping — the snap can push separated
    // neighbors back together by up to half a cell.
    // `view.grid` is initialised to 5 at pid-parser.js:285, so it is never absent
    // and this fallback is dead. It said 20, which is a different pitch from the one
    // the grid overlay draws — had it ever fired, the parser would have snapped to
    // 20mm while the overlay drew 5mm, i.e. produced exactly the "nothing is
    // aligned" symptom from a different cause. Default now matches the schema.
    const grid = data.view.grid || 5;
    for (const e of [...data.equipment, ...data.valves, ...data.instruments, ...data.junctions]) {
      if (e._fixed) continue;
      e.x = Math.round(e.x / grid) * grid;
      e.y = Math.round(e.y / grid) * grid;
    }
    resolveOverlaps(data);

    // pipes referencing line specs get their formatted label
    for (const p of data.pipes) {
      if (p.line && data.lineDefs[p.line]) {
        const d = data.lineDefs[p.line];
        p.label = `${d.size || ''}${d.size ? '"' : ''}-${d.service || ''}-${d.number || ''}-${d.spec || ''}-${d.ins || ''}-${d.ins ? 'INS-' : ''}${d.thick || ''}-${d.trace || ''}`.replace(/-+/g, '-').replace(/^-|-$/g, '');
      }
    }

    validateModel(data);
    resolveTopology(data); // authoritative: assign ports, enforce cardinality, build junction/tap graph
    materializeNozzles(data); // bare used equipment ports become real (auto) nozzles
    resolveNozzlePositions(data); // compute nozzle geometry, update pipe endpoints to nozzle tips
    validateSemanticModel(data);
    validateSchema(data);
    return data;
  }
};
//  modifiers 
// relative placement that stays inside the sheet: if the requested side runs off an
// edge, flip to the opposite side of the reference
/**
 * Description placeholder
 *
 * @param {*} e 
 * @param {*} ref 
 * @param {*} step 
 * @param {*} SW 
 * @param {*} SH 
 * @returns {{ x: any; y: any; }} 
 */

function placeRelative(e, ref, step, SW, SH) {
  const MX = 40, MY = 40;
  const place = (dir) => {
    if (dir === 'right') return { x: ref.x + step + e.rel.dx, y: ref.y + e.rel.dy };
    if (dir === 'left') return { x: ref.x - step + e.rel.dx, y: ref.y + e.rel.dy };
    if (dir === 'above') return { x: ref.x + e.rel.dx, y: ref.y - step + e.rel.dy };
    return { x: ref.x + e.rel.dx, y: ref.y + step + e.rel.dy };
  };
  let p = place(e.rel.dir);
  if (p.y < MY && e.rel.dir === 'above') { const f = place('below'); p = f.y >= MY ? f : { ...p, y: MY }; }
  if (p.y > SH - MY && e.rel.dir === 'below') { const f = place('above'); p = f.y <= SH - MY ? f : { ...p, y: SH - MY }; }
  if (p.x < MX && e.rel.dir === 'left') { const f = place('right'); p = f.x >= MX ? f : { ...p, x: MX }; }
  if (p.x > SW - MX && e.rel.dir === 'right') { const f = place('left'); p = f.x <= SW - MX ? f : { ...p, x: SW - MX }; }
  return p;
}

/**
 * Description placeholder
 *
 * @param {*} rem 
 * @param {*} target 
 */

function parseModifiers(rem, target) {
  while (rem && rem.trim()) {
    rem = rem.trim();
    let m;
    if ((m = rem.match(/^at\s+(-?[\d.]+)\s*,\s*(-?[\d.]+)/))) { target.at = { x: parseFloat(m[1]), y: parseFloat(m[2]) }; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^(right|left|above|below)\s+(?:of\s+)?([A-Za-z0-9_\-]+)(?:\s+offset\s+(-?[\d.]+)\s*,\s*(-?[\d.]+))?/))) {
      target.rel = { dir: m[1], ref: m[2], dx: m[3] ? parseFloat(m[3]) : 0, dy: m[4] ? parseFloat(m[4]) : 0 };
      rem = rem.slice(m[0].length);
    }
    else if ((m = rem.match(/^rotated\s+([\d.]+)/))) { target.rotation = parseFloat(m[1]); rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^symbol\s+"([^"]+)"/))) { target.symbol = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^scale\s+([\d.]+)/))) { target.scale = parseFloat(m[1]); rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^stroke\s+"([^"]+)"/))) { target.stroke = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^tag\s+"([^"]+)"/))) { target.tag = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^tag-above/))) { target.tagAbove = true; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^no-type-label/))) { target.noTypeLabel = true; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^normal\s+(open|closed|flowing|blocked)/))) { target.normal = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^fail\s+(open|closed|last)/))) { target.fail = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^mode\s+(auto|manual|cascade|remote|local)/))) { target.mode = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^set-pressure\s+(\S+)/))) { target.setPressure = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^(size|rating|spec)\s+(\S+)/))) { target[m[1]] = m[2]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^bubble\s+(field|panel|dcs|computer|plc)/))) { target.bubble = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^(field|panel|dcs|computer|plc)\b/))) { target.bubble = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^via\s+(-?[\d.]+)\s*,\s*(-?[\d.]+)/))) { (target.via = target.via || []).push({ x: parseFloat(m[1]), y: parseFloat(m[2]) }); rem = rem.slice(m[0].length); }
        else if ((m = rem.match(/^line\s+([A-Za-z0-9_\-]+)/))) { target.line = m[1]; rem = rem.slice(m[0].length); }
    // ── v2 schema modifiers ──────────────────────────────────
    else if ((m = rem.match(/^name\s+"([^"]+)"/))) { target.displayName = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^service\s+(?:"([^"]+)"|(\S+))/))) { target.service = m[1] || m[2]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^system\s+(?:"([^"]+)"|(\S+))/))) { target.system = m[1] || m[2]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^area\s+(?:"([^"]+)"|(\S+))/))) { target.area = m[1] || m[2]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^unit\s+(?:"([^"]+)"|(\S+))/))) { target.unit = m[1] || m[2]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^plant\s+(?:"([^"]+)"|(\S+))/))) { target.plant = m[1] || m[2]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^discipline\s+(?:"([^"]+)"|(\S+))/))) { target.discipline = m[1] || m[2]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^status\s+(new|existing|modified|relocated|demolished|future|temporary|by-others)/))) { target.lifecycleState = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^design\s+(conceptual|preliminary|ifc|as-built)/))) { target.designStatus = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^loop\s+(\S+)/))) { target.loop = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^notes\s+"([^"]+)"/))) { target.notes = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^attribute\s+([A-Za-z][A-Za-z0-9_-]*)\s+(?:"([^"]+)"|(\S+))/))) { target.attributes = target.attributes || {}; target.attributes[m[1]] = m[2] || m[3]; rem = rem.slice(m[0].length); }
    // flow direction on pipes: flow forward (from→to) or flow reverse (to→from)
    else if ((m = rem.match(/^flow\s+(forward|reverse)/))) { target.flowDirection = m[1]; rem = rem.slice(m[0].length); }
    // bare quoted string = description (must be last quoted-string matcher)
    else if ((m = rem.match(/^"((?:[^"\\]|\\.)*)"/))) {
      const val = m[1].replace(/\\"/g, '"');
      if (target.label) { target.description = val; } else { target.label = val; }
      rem = rem.slice(m[0].length);
    }
    else throw new Error(`pid parser: unrecognized modifier "${rem.split(/\s/)[0]}" in "${rem}"`);
  }
}

function parseNozzleModifiers(rem, target) {
  while (rem && rem.trim()) {
    rem = rem.trim();
    let m;
    if ((m = rem.match(/^size\s+(\S+)/))) { target.size = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^rating\s+(\S+)/))) { target.rating = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^spec\s+(\S+)/))) { target.spec = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^facing\s+(RF|FF|RTJ|ring-type-joint)/))) { target.facing = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^schedule\s+(\S+)/))) { target.schedule = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^type\s+(weld_neck|slip_on|socket_weld|threaded|lap_joint|blind)/))) { target.subType = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^length\s+([\d.]+)/))) { target.length = parseFloat(m[1]); rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^edge\b/))) { target.edge = true; rem = rem.slice(m[0].length); }
    else throw new Error(`pid parser: unrecognized nozzle modifier "${rem.split(/\s/)[0]}" in "${rem}"`);
  }
}

// ¬
/**
 * Description placeholder
 *
 * @type {{ P: string; T: string; F: string; L: string; A: string; D: string; G: string; V: string; S: string; W: string; Q: string; Z: string; U: string; X: string; Y: string; }}
 */

var ISA_VARIABLES = { P: 'pressure', T: 'temperature', F: 'flow', L: 'level', A: 'analysis', D: 'density', G: 'gauge', V: 'vibration', S: 'speed', W: 'weight', Q: 'quantity', Z: 'position', U: 'multivariable', X: 'unclassified', Y: 'event/state' };
/**
 * Description placeholder
 *
 * @type {{ I: string; C: string; T: string; A: string; R: string; S: string; G: string; E: string; V: string; Y: string; H: string; L: string; Z: string; U: string; K: string; }}
 */
var ISA_FUNCTIONS = { I: 'indicator', C: 'controller', T: 'transmitter', A: 'alarm', R: 'recorder', S: 'switch', G: 'gauge', E: 'element', V: 'valve', Y: 'relay/compute', H: 'high', L: 'low', Z: 'position', U: 'multivariable', K: 'time/rate' };
/**
 * Description placeholder
 *
 * @type {{ D: string; R: string; Q: string; }}
 */
var ISA_MODIFIERS = { D: 'differential', R: 'ratio', Q: 'sum' };

/**
 * Description placeholder
 *
 * @param {*} tag 
 * @returns {{ variable: any; functions: any; loop: any; tagClass: any; }} 
 */
function tagSemantics(tag) {
  const m = tag.match(/^([A-Za-z])([A-Za-z])([A-Za-z]{0,2})(?:[- ]?(\d+.*))?$/);
  if (!m) return null;
  let variable = m[1].toUpperCase();
  let functions = m[2].toUpperCase() + (m[3] || '').toUpperCase();
  if (ISA_MODIFIERS[m[2].toUpperCase()]) { variable += m[2].toUpperCase(); functions = (m[3] || '').toUpperCase(); }
  return { variable, functions, loop: m[4] ? m[4].replace(/^[^A-Za-z0-9]+/, '') : null, tagClass: variable + functions };
}

/**
 * Description placeholder
 *
 * @param {*} tag 
 * @param {*} warnings 
 * @returns {{ variable: any; functions: any; loop: any; tagClass: any; }} 
 */

function validateTag(tag, warnings) {
  const info = tagSemantics(tag);
  if (!info) { warnings.push(`[PID-TAG-004] tag "${tag}": not a valid ISA tag (expects VARIABLE-FUNCTION-LOOP)`); return null; }
  const { variable, functions } = info;
  for (const ch of variable) if (!ISA_VARIABLES[ch]) warnings.push(`[PID-TAG-005] tag "${tag}": unknown measured variable "${ch}"`);
  for (const ch of functions) if (!ISA_FUNCTIONS[ch]) warnings.push(`[PID-TAG-006] tag "${tag}": unknown function letter "${ch}"`);
  return info;
}

// auto layout: flow-based placement by connection order 
/**
 * Description placeholder
 *
 * @param {*} data 
 */

// ---- symbol lookup (SYMBOL_KEYS, BUBBLE_KEYS, glyphSvg, symbolSize, symbolConnections) ----
var SYMBOL_KEYS = {
  pump: 'pip/equipment/pump-centrifugal',
  'pump-vertical': 'y32.11-1961/pumps/centrifugal-pump',
  'pump-gear': 'y32.11-1961/pumps/gear-pump',
  'pump-pd': 'y32.11-1961/pumps/reciprocating-pump',
  'pump-vacuum': 'y32.11-1961/pumps/vacuum-pump',
  'pump-screw': 'y32.11-1961/pumps/pump-screw',
  'pump-vertical-turbine': 'y32.11-1961/pumps/pump-vertical-turbine',
  vessel: 'pip/equipment/vessel-vertical',
  'vessel-horizontal': 'pip/equipment/vessel-horizontal',
  drum: 'y32.11-1961/vessels/drum',
  'knockout-drum': 'y32.11-1961/vessels/knockout-drum',
  reactor: 'y32.11-1961/vessels/reactor-stirred',
  'reactor-jacketed': 'y32.11-1961/vessels/reactor-jacketed',
  tank: 'pip/equipment/tank-cone-roof',
  'tank-dome-roof': 'y32.11-1961/tanks/tank-dome-roof',
  'tank-internal-floating-roof': 'y32.11-1961/tanks/tank-internal-floating-roof',
  'heat-exchanger': 'pip/equipment/heat-exchanger-shell-tube',
  'kettle-reboiler': 'y32.11-1961/heat-exchangers/kettle-reboiler',
  compressor: 'pip/equipment/compressor',
  'compressor-liquid-ring': 'y32.11-1961/compressors/compressor-liquid-ring',
  filter: 'pip/equipment/filter',
  mixer: 'pip/equipment/agitator',
  furnace: 'y32.11-1961/furnaces/box-furnace',
  'fired-heater': 'y32.11-1961/furnaces/fired-heater',
  'electric-heater': 'y32.11-1961/furnaces/electric-heater',
  boiler: 'y32.11-1961/furnaces/boiler',
  tower: 'pip/equipment/column-tower',
  silencer: 'y32.11-1961/miscellaneous/silencer',
  fan: 'y32.11-1961/miscellaneous/fan',
  blower: 'y32.11-1961/miscellaneous/blower',
  turbine: 'y32.11-1961/miscellaneous/turbine',
  ejector: 'y32.11-1961/miscellaneous/ejector',
  conveyor: 'y32.11-1961/miscellaneous/conveyor',
  crusher: 'y32.11-1961/miscellaneous/crusher',
  'ball-mill': 'y32.11-1961/miscellaneous/ball-mill',
  dryer: 'y32.11-1961/miscellaneous/dryer',
  'steam-trap': 'y32.11-1961/miscellaneous/steam-trap',
  'gas-cylinder': 'y32.11-1961/miscellaneous/gas-cylinder',
  'gravity-separator': 'y32.11-1961/separators/gravity-separator',
  gate: 'isa-5.1/valves/gate',
  globe: 'isa-5.1/valves/globe',
  ball: 'isa-5.1/valves/ball',
  check: 'isa-5.1/valves/check-valve',
  'check-swing': 'isa-5.1/valves/check-valve-swing',
  'check-lift': 'isa-5.1/valves/check-valve-lift',
  butterfly: 'isa-5.1/valves/butterfly',
  needle: 'isa-5.1/valves/needle-valve',
  control: 'isa-5.1/valves/control-valve',
  relief: 'isa-5.1/valves/relief-safety',
  'vacuum-relief': 'isa-5.1/valves/vacuum-relief-valve',
  '3way': 'isa-5.1/valves/three-way',
  '4way': 'isa-5.1/valves/four-way-valve',
  angle: 'isa-5.1/valves/angle-valve',
  rupture: 'isa-5.1/valves/rupture-disc',
  'motor-gate': 'isa-5.1/valves/motor-operated-gate'
};
/**
 * Description placeholder
 *
 * @type {{ field: string; panel: string; dcs: string; computer: string; plc: string; }}
 */

var BUBBLE_KEYS = {
  field: 'isa-5.1/instruments/field-instrument',
  panel: 'isa-5.1/instruments/panel-instrument',
  dcs: 'isa-5.1/instruments/shared-display',
  computer: 'isa-5.1/instruments/computer-function',
  plc: 'isa-5.1/instruments/plc-function'
};

// symbol sizes come from the bundle metadata (pid-svg-library/sizes.json)

/**
 * Description placeholder
 *
 * @type {{ pump: string; 'pump-vertical': string; 'pump-gear': string; 'pump-pd': string; 'pump-vacuum': string; 'pump-screw': string; 'pump-vertical-turbine': string; vessel: string; 'vessel-horizontal': string; ... 45 more ...; 'motor-gate': string; }}
 */
var TYPE_LABELS = {
  pump: 'centrifugal pump', 'pump-vertical': 'vertical turbine pump', 'pump-gear': 'gear pump',
  'pump-pd': 'positive displacement pump', 'pump-vacuum': 'vacuum pump',
  'pump-screw': 'screw pump', 'pump-vertical-turbine': 'vertical turbine pump',
  vessel: 'vertical vessel', 'vessel-horizontal': 'horizontal vessel', tank: 'cone roof tank',
  drum: 'drum', 'knockout-drum': 'knockout drum', reactor: 'stirred reactor',
  'reactor-jacketed': 'jacketed reactor',
  'tank-dome-roof': 'dome roof tank', 'tank-internal-floating-roof': 'internal floating roof tank',
  'heat-exchanger': 'shell & tube exchanger', 'kettle-reboiler': 'kettle reboiler',
  compressor: 'compressor', 'compressor-liquid-ring': 'liquid ring compressor',
  filter: 'filter', mixer: 'agitator', furnace: 'furnace',
  'fired-heater': 'fired heater', 'electric-heater': 'electric heater', boiler: 'boiler',
  tower: 'column', silencer: 'silencer',
  fan: 'fan', blower: 'blower', turbine: 'turbine', ejector: 'ejector',
  conveyor: 'conveyor', crusher: 'crusher', 'ball-mill': 'ball mill', dryer: 'dryer',
  'steam-trap': 'steam trap', 'gas-cylinder': 'gas cylinder',
  'gravity-separator': 'gravity separator',
  gate: 'gate valve', globe: 'globe valve', ball: 'ball valve', check: 'check valve',
  butterfly: 'butterfly valve', needle: 'needle valve', control: 'control valve',
  relief: 'relief valve', '3way': '3-way valve',
  'check-swing': 'swing check valve', 'check-lift': 'lift check valve',
  'vacuum-relief': 'vacuum relief valve', '4way': '4-way valve', angle: 'angle valve',
  rupture: 'rupture disc', 'motor-gate': 'motor-operated gate'
};

//  glyph connection metadata 
/**
 * Description placeholder
 *
 * @param {*} s 
 * @returns {*} 
 */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Description placeholder
 *
 * @type {{}}
 */
const sizeCache = {};
/**
 * Description placeholder
 *
 * @param {*} key 
 * @returns {*} 
 */
// ponytail: extract SVG string from PID_SYMBOLS entry (handles both object and string formats)

function glyphSvg(key) {
  const entry = window.PID_SYMBOLS[key];
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  return entry.svg || '';
}


function symbolSize(key) {
  if (sizeCache[key]) return sizeCache[key];
  const entry = window.PID_SYMBOLS[key];
  if (!entry) { sizeCache[key] = 40; return 40; }
  // Object format: entry.size is the nominal size
  if (typeof entry === 'object' && entry.size) { sizeCache[key] = entry.size; return entry.size; }
  // String format: parse <size> tag or viewBox from SVG string
  const glyph = typeof entry === 'string' ? entry : (entry.svg || '');
  let m = glyph.match(/<size>([\d.]+)<\/size>/);
  if (!m) {
    const vb = glyph.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    m = vb ? [null, vb[1]] : [null, '40'];
  }
  sizeCache[key] = parseFloat(m[1]);
  return sizeCache[key];
}
/**
 * Description placeholder
 *
 * @param {*} e 
 * @returns {*} 
 */
function glyphSizeOf(e) {
  if (e.symbol) return symbolSize(e.symbol);
  return symbolSize(SYMBOL_KEYS[e.type] || 'pip/equipment/vessel-vertical');
}

/**
 * Description placeholder
 *
 * @type {{}}
 */
const connCache = {};
/**
 * Description placeholder
 *
 * @param {*} id 
 * @param {*} type 
 * @returns {{ role: string; direction: string; connectionClass: any; }} 
 */

function portMetadata(id, type) {
  const name = id.toLowerCase();
  const signal = /actuator|signal|control/.test(name);
  let role = 'connection', direction = null;
  if (/suction|inlet|feed|motive|shell[_-]?in|tube[_-]?in|fuel/.test(name)) { role = 'inlet'; direction = 'in'; }
  else if (/discharge|outlet|product|shell[_-]?out|tube[_-]?out|steam|gas[_-]?out|liquid[_-]?out/.test(name)) { role = 'outlet'; direction = 'out'; }
  else if (/vent/.test(name)) { role = 'vent'; direction = 'out'; }
  else if (/drain|bottom/.test(name)) { role = 'drain'; direction = 'out'; }
  else if (/relief/.test(name)) { role = 'relief'; direction = 'out'; }
  else if (/sample/.test(name)) { role = 'sample'; direction = 'out'; }
  else if (/top/.test(name)) role = 'top';
  else if (/left|right/.test(name)) role = name;
  if (signal) { role = 'signal'; direction = 'in'; }
  return { role, direction, connectionClass: signal ? 'signal' : (type === 'nozzle' || type === 'pipe' ? 'process' : type) };
}
/**
 * Description placeholder
 *
 * @param {*} key 
 * @returns {*} 
 */

function symbolConnections(key) {
  if (connCache[key]) return connCache[key];
  const entry = window.PID_SYMBOLS[key];
  if (!entry) { connCache[key] = []; return []; }
  // Object format: entry.ports is the pre-computed port array
  if (typeof entry === 'object' && entry.ports) { connCache[key] = entry.ports; return entry.ports; }
  // String format: parse <connection> tags from SVG string
  const glyph = typeof entry === 'string' ? entry : (entry.svg || '');
  const conns = [];
  const re = /<connection id="([\w-]+)" x="([\d.]+)" y="([\d.]+)" type="(\w+)"/g;
  let m;
  while ((m = re.exec(glyph)) !== null) {
    conns.push({ id: m[1], x: parseFloat(m[2]), y: parseFloat(m[3]), type: m[4], cardinality: 1, ...portMetadata(m[1], m[4]) });
  }
  connCache[key] = conns;
  return conns;
}

// ponytail: ports missing from the symbol library (kettle steam/condensate
// for NZ-E101-1/2). Patch table survives bundle regeneration; shapes mirror
// connection objects. Guarded against double-apply.
const PORT_PATCHES = {
  'y32.11-1961/heat-exchangers/kettle-reboiler': [
    { id: 'steam', x: 30, y: 38, type: 'nozzle', cardinality: 1 },
    { id: 'condensate', x: 30, y: 62, type: 'nozzle', cardinality: 1 },
  ],
};
(function applyPortPatches() {
  for (const [key, patches] of Object.entries(PORT_PATCHES)) {
    const conns = symbolConnections(key);
    for (const p of patches) {
      if (!conns.some(c => c.id === p.id)) conns.push({ ...p, ...portMetadata(p.id, p.type) });
    }
  }
})();

//  renderer 
/**
 * Description placeholder
 *
 * @param {*} svg 
 * @param {*} data 
 * @returns {{ total: any; routing: { crossings: number; pp: number; ps: number; ss: number; bends: number; length: any; nonOrtho: number; }; sheet: { offSheet: number; }; annotations: { labelCollisions: number; }; lines: { ...; }; instruments: { ...; }; }} 
 */