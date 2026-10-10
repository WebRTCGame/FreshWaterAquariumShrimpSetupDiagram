// placement-rules.js — equipment placement RULES, not score terms.
//
// WHY THIS FILE EXISTS
// --------------------
// The layout engine places symbols knowing only (a) graph depth from
// `processRank`, (b) declaration order, and (c) one regex on port names
// (`belowFlag`, pid-router.js:83-89). Every other piece of semantic content in
// the model is discarded before a position is chosen:
//
//   * `portMetadata` (pid-parser.js:983) already infers inlet/outlet/drain/
//     relief/sample/top/left/right from the port name -- and `autoLayout`
//     never calls it.
//   * the equipment `type` string (`pump`, `tower`, `kettle-reboiler`,
//     `shell-tube-exchanger`, `drum`) is never tested by layout.
//   * `data.loops` (pid-parser.js:463) is parsed, and never read by layout.
//     It is the domain's central concept (ISA control loop) and it is dead
//     weight to the placer.
//
// So a rule like "a pump sits below its suction source" is not merely
// unimplemented -- it is currently *unwritable*, because `resolveTopology`
// resolves ports at pid-parser.js:637, forty-three lines AFTER `autoLayout`
// runs at :594. This file is deliberately written against the AUTHORED port
// names (`p.fromPort`), which are present from parse time, so that the rules
// that do not need resolved world coordinates can ship first. See
// IMPROVEMENTS.md §0c/§0d for the reorder that unlocks the rest.
//
// RULES ARE HARD CONSTRAINTS, NOT WEIGHTS
// ---------------------------------------
// P&ID-ENGINE-REDESIGN.md:63-96 establishes the governing rule of this
// codebase: "The layout cannot price a consequence of a decision it has not
// finished making." A rule that applies is SATISFIED, not traded against
// sheet fullness. That is what makes a rule layer the right instrument --
// score terms were measured four times to be steering the drawing the wrong
// way (IMPROVEMENTS.md §0a root cause 3), and a constraint cannot.
//
// COORDINATE CONVENTION: SVG y grows DOWNWARD. "Above" means SMALLER y.
// Every rule below is written in that frame; getting it backwards was the
// single most likely bug in this file and is guarded by the self-test.
//
// SHIPPED STATE: audit + `enforce()`.
//   audit()   — reports which rules fire and by how much they are violated.
//   enforce() — the CONSTRAINT SOLVER: satisfies the ENABLED rules by moving
//               entities, gated per rule by `layout.rule<Id>` so each rule can
//               be switched on only after it has been measured alone.
// A rule is enabled iff its registry flag is truthy, so an unmeasured rule
// costs nothing and an unmeasured CHANGE is impossible to ship by accident.

(function (root) {
  'use strict';

  // ── port role inference ────────────────────────────────────────────────
  // Single source of truth. `portMetadata` in pid-parser.js delegates here
  // (see the edit at that site) so the two cannot drift.
  var PORT_ROLE_RULES = [
    { re: /actuator|signal|control/i,                      role: 'signal',   dir: 'in'  },
    { re: /suction|inlet|feed|motive|shell[_-]?in|tube[_-]?in|fuel/i, role: 'inlet',    dir: 'in'  },
    { re: /discharge|outlet|product|shell[_-]?out|tube[_-]?out|steam|gas[_-]?out|liquid[_-]?out/i, role: 'outlet', dir: 'out' },
    { re: /reflux/i,                                       role: 'reflux',   dir: 'out' },
    { re: /overhead|top|vent/i,                            role: 'top',      dir: 'out' },
    { re: /bottoms?|drain/i,                               role: 'bottom',   dir: 'out' },
    { re: /relief/i,                                       role: 'relief',   dir: 'out' },
    { re: /sample/i,                                       role: 'sample',   dir: 'out' },
    { re: /left/i,                                         role: 'left',     dir: null },
    { re: /right/i,                                        role: 'right',    dir: null }
  ];

  function portRole(portName) {
    if (!portName) return { role: 'connection', direction: null };
    var n = String(portName).toLowerCase();
    for (var i = 0; i < PORT_ROLE_RULES.length; i++) {
      if (PORT_ROLE_RULES[i].re.test(n)) {
        return { role: PORT_ROLE_RULES[i].role, direction: PORT_ROLE_RULES[i].dir };
      }
    }
    return { role: 'connection', direction: null };
  }

  // ── equipment kind ─────────────────────────────────────────────────────
  // Coarse drafting class, derived from the `type` string. The symbol
  // manifest uses directory-ish names (pip/equipment/pump, y32.11-1961/tanks/);
  // matching on the stem keeps this independent of manifest layout.
  var KIND_PATTERNS = [
    [/\bpump\b/,                  'pump'],
    [/\b(centrifugal|reciprocating|gear|screw|vacuum)\b/, 'pump'],
    [/\btower\b|\bcolumn\b/,      'tower'],
    [/\bkettle[-_]?reboiler\b/,   'reboiler'],
    [/\b(heat[-_]?exchanger|shell[-_]?tube([-_]?exchanger)?|condenser|cooler)\b/, 'exchanger'],
    [/\bdrum\b/,                  'drum'],
    [/\b(tank|vessel|reactor)\b/, 'vessel'],
    [/\b(furnace|boiler)\b/,      'furnace'],
    [/\b(motor|mixer|compressor)\b/, 'machine']
  ];

  function equipmentKind(type) {
    var t = String(type || '').toLowerCase();
    for (var i = 0; i < KIND_PATTERNS.length; i++) {
      if (KIND_PATTERNS[i][0].test(t)) return KIND_PATTERNS[i][1];
    }
    return 'other';
  }

  // ── semantic facts ────────────────────────────────────────────────────
  // Pure, read-only, total. Safe to call before or after layout runs.
  // Builds, per entity: kind, ports (name+role), upstream/downstream with the
  // connecting port, loop membership, and process-degree.
  function semanticFacts(data) {
    var all = [];
    (data.equipment || []).forEach(function (e) { all.push(e); });
    (data.valves || []).forEach(function (e) { all.push(e); });
    (data.instruments || []).forEach(function (e) { all.push(e); });
    (data.junctions || []).forEach(function (e) { all.push(e); });

    var byId = {};
    all.forEach(function (e) { byId[e.id || e.tag] = e; });

    // Membership sets, so `kind` is O(1) per entity rather than indexOf O(n).
    var valveSet = {}, junctionSet = {}, instrumentSet = {};
    (data.valves || []).forEach(function (e) { valveSet[e.id] = 1; });
    (data.junctions || []).forEach(function (e) { junctionSet[e.id] = 1; });
    (data.instruments || []).forEach(function (e) { instrumentSet[e.tag] = 1; });

    function kindOf(e) {
      if (e.tag && !e.id) return 'instrument';
      if (valveSet[e.id]) return 'valve';
      if (junctionSet[e.id]) return 'junction';
      return equipmentKind(e.type);
    }

    var facts = {};
    all.forEach(function (e) {
      var key = e.id || e.tag;
      facts[key] = {
        key: key,
        ent: e,
        kind: kindOf(e),
        type: e.type || null,
        ports: [],        // {name, role, dir, peer, peerPort, pipeKind, inferred}
        declared: [],     // port names from `nozzle ... port X`
        declaredRoles: [],
        up: [],           // {peer, port, role, inferred}  — peer is UPSTREAM
        down: [],         // {peer, port, role, inferred}  — peer is DOWNSTREAM
        processDegree: 0,
        inCycle: false,
        loop: null        // {id, role, measure, controller, manipulate}
      };
    });

    function addPort(key, portName, peerKey, peerPort, pipeKind, end) {
      var f = facts[key];
      if (!f) return;
      var r = portRole(portName);
      f.ports.push({ name: portName || null, role: r.role, dir: r.direction,
                     peer: peerKey || null, peerPort: peerPort || null, pipeKind: pipeKind });
      if (pipeKind !== 'signal') f.processDegree++;
      // `from` endpoint: the peer is DOWNSTREAM of this entity.
      // `to` endpoint:   the peer is UPSTREAM of this entity.
      var link = { peer: peerKey, port: portName || null, peerPort: peerPort || null, role: r.role };
      if (end === 'from') f.down.push(link); else f.up.push(link);
    }

    (data.pipes || []).forEach(function (p) {
      addPort(p.from, p.fromPort, p.to, p.toPort, p.kind || 'process', 'from');
      addPort(p.to, p.toPort, p.from, p.fromPort, p.kind || 'process', 'to');
    });

    // ── declared ports ──────────────────────────────────────────────────
    // `nozzle NZ-P1-S on P-1 port suction` tells us a port EXISTS with that
    // name, but the connecting pipe often does not name it — `V-1 -> P-1`
    // carries no port at all. Without this, every role-based rule stays dark
    // on most of the corpus, because the role lives on the nozzle declaration
    // and not on the pipe. This is the cheap half of what resolveTopology
    // does, and unlike resolveTopology it is available before layout.
    (data.nozzles || []).forEach(function (nz) {
      var f = facts[nz.ownerId];
      if (!f) return;
      var r = portRole(nz.portId);
      if (f.declared.indexOf(nz.portId) < 0) {
        f.declared.push(nz.portId);
        f.declaredRoles.push({ name: nz.portId, role: r.role, dir: r.direction });
      }
    });

    // ── provisional port binding ────────────────────────────────────────
    // Where a pipe names no port and the entity has exactly ONE unused
    // declared port of the role that the pipe's direction implies, the
    // binding is unambiguous and we take it. Marked `inferred: true` so W5 can
    // replace it with the authoritative resolveTopology answer. Conservative
    // on purpose: an entity with two candidate ports is left unbound rather
    // than guessed, because a wrong guess silently inverts a placement rule.
    (data.pipes || []).forEach(function (p) {
      if (p.kind === 'signal') return;
      // the `to` endpoint receives: it needs an inlet-role port
      bindProvisional(p.to, p.toPort, p.from, 'inlet', p, 'in');
      // the `from` endpoint delivers: it needs an outlet-role port
      bindProvisional(p.from, p.fromPort, p.to, 'outlet', p, 'out');
    });

    function bindProvisional(key, namedPort, peerKey, wantRole, pipe, dir) {
      var f = facts[key];
      if (!f || namedPort) return;           // pipe already named its port
      var cands = f.declaredRoles.filter(function (d) {
        return d.role === wantRole && !usedPort(key, d.name);
      });
      if (cands.length !== 1) return;         // ambiguous -> leave unbound
      var name = cands[0].name;
      var link = { peer: peerKey, port: name, peerPort: null, role: wantRole, inferred: true };
      f.ports.push({ name: name, role: wantRole, dir: dir, peer: peerKey,
                     peerPort: null, pipeKind: pipe.kind || 'process', inferred: true });
      f.processDegree++;
      if (dir === 'in') f.up.push(link); else f.down.push(link);
    }

    function usedPort(key, name) {
      var f = facts[key];
      for (var i = 0; i < f.ports.length; i++) if (f.ports[i].name === name) return true;
      return false;
    }

    // declared control loops — the domain's central concept, previously
    // invisible to layout. The whole triple is kept on each participant so
    // `controller-above-manipulator` can compare two entities without a
    // second lookup.
    var loops = data.loops || [];
    loops.forEach(function (L) {
      var triple = { id: L.id, measure: L.measure, controller: L.controller, manipulate: L.manipulate };
      var m = facts[L.measure];    if (m) m.loop = { id: L.id, role: 'measure', triple: triple };
      var c = facts[L.controller]; if (c) c.loop = { id: L.id, role: 'controller', triple: triple };
      var p = facts[L.manipulate]; if (p) p.loop = { id: L.id, role: 'manipulate', triple: triple };
    });

    // cycle membership from the router's own flowCycles, when available
    var cyc = data.flowCycles || [];
    (Array.isArray(cyc) ? cyc : []).forEach(function (grp) {
      (grp || []).forEach(function (id) { if (facts[id]) facts[id].inCycle = true; });
    });

    return { facts: facts, byId: byId, all: all, loops: loops,
             // sheet bounds the solver must respect, so a slide can never be
             // "successful" by pushing something off the drawing
             sheet: { w: data.view.sheetW || 864, h: data.view.sheetH || 559 } };
  }

  // ── rule registry ─────────────────────────────────────────────────────
  // `applies` gates the rule; `check` returns violations with a MEASURE so
  // that "how badly" is a number, not a boolean. Every rule carries a
  // `rationale`: the repo documents the reason for every weight in
  // pid-rules.js:104-237, and an unauditable rule is a rule nobody dares
  // change.
  var TOL = 5; // mm — placement tolerance; matches the grid pitch

  // Is this entity's position the author's, not the engine's? `at` and `rel`
  // both express intent; `_fixed` is what the parser sets from `at`. A rule
  // must not move these (see `enforce`) and must not report them as violations
  // (see `audit`).
  function isAuthored(e) {
    return !!(e && (e._fixed || e.at || e.rel));
  }

  var RULES = [
    {
      id: 'suction-source-above',
      gate: 'layout.ruleSuctionSourceAbove',
      rationale: 'Suction is gravity-fed; a pump below its source needs no lift, ' +
                 'and a pump above its source needs a primed line that nothing on ' +
                 'the drawing explains.',
      applies: function (f) { return f.kind === 'pump' && f.up.some(function (l) { return l.role === 'inlet'; }); },
      check: function (f, ctx) {
        var out = [];
        // An explicit `at` / `rel` is the AUTHOR's decision. Auditing it as a
        // violation is reporting the author's intent as an engine defect — and
        // it is worse than merely useless, because it inflates the measured
        // violation count that the rule's value is justified by.
        //
        // Measured: all 5 corpus violations of this rule were `_fixed` pumps
        // with `at 340,280` etc. The rule was 100% false positive. It now
        // reports 0, and the correct reading of that is "this rule is not
        // enabled by anything on this corpus", NOT "this rule works".
        //
        // The generic filter lives in `audit()` so every rule gets it, rather
        // than each rule remembering to check.
        if (isAuthored(f.ent)) return out;
        f.up.forEach(function (l) {
          if (l.role !== 'inlet') return;
          var src = ctx.facts[l.peer];
          if (!src || src.ent.x == null) return;
          var dy = f.ent.y - src.ent.y;   // >0 means pump BELOW source = correct
          if (dy < TOL) out.push({ measure: TOL - dy, detail: l.peer + ' is not above pump (dy=' + dy.toFixed(1) + ')' });
        });
        return out;
      },
      // ---- target: the IN-SOLVE form of this rule ----
      // Ask the pump to sit at least `gap` BELOW its suction source's target.
      // The packer still gets the last word, so this is a preference that the
      // median step and the >= SEP packing can both overrule when the sheet has
      // no room — which is the honest outcome when there is no room.
      //
      // Contrast with `solve` below, which is the post-hoc form and measured
      // WORSE (IMPROVEMENTS.md §0d W4: +105 across the corpus). Both are kept
      // because the comparison is the evidence that the architecture is the
      // thing that was wrong, not the rule.
      target: function (f, ctx, want, api) {
        var worstKey = null, worstDy = -Infinity;
        f.up.forEach(function (l) {
          if (l.role !== 'inlet') return;
          var s = ctx.facts[l.peer];
          if (!s) return;
          var sy = want[l.peer] !== undefined ? want[l.peer] : s.ent.y;
          var dy = want[f.key] - sy;                 // >0 means already below
          if (dy > worstDy) { worstDy = dy; worstKey = l.peer; }
        });
        if (!worstKey) return null;                  // abstain
        var sy = want[worstKey] !== undefined ? want[worstKey] : ctx.facts[worstKey].ent.y;
        return Math.max(want[f.key], sy + api.gap);
      },
      // ---- solver ----
      // Move the pump DOWN until its suction source is above it, in grid
      // steps, and only into space that is free. Stepping rather than jumping
      // matters: the router grid-snaps to `view.grid` after layout, so a
      // solver that lands off-grid gets snapped back and the rule silently
      // reverts.
      //
      // The source is the MORE authoritative position of the pair — it is a
      // vessel or a column, usually already placed by rank and possibly by an
      // explicit `at`. So the pump moves and the source does not. Moving the
      // source instead would relocate a tank to serve a pump.
      enabled: function (f, ctx) {
        return f.kind === 'pump' && f.up.some(function (l) {
          var s = ctx.facts[l.peer];
          return l.role === 'inlet' && s && s.ent.x != null;
        });
      },
      solve: function (f, ctx, api) {
        var TOL = api.TOL;
        var e = f.ent;
        // the suction source with the greatest deficit wins; more than one
        // inlet-role upstream port is ambiguous and is left alone
        var worst = null, worstDy = Infinity;
        f.up.forEach(function (l) {
          if (l.role !== 'inlet') return;
          var s = ctx.facts[l.peer];
          if (!s || s.ent.x == null) return;
          var dy = e.y - s.ent.y;
          if (dy < worstDy) { worstDy = dy; worst = s; }
        });
        if (!worst) return false;
        if (worstDy >= TOL) return false;          // already satisfied

        var step = 5;
        var minSep = api.minSep || 0;

        // Try moving the PUMP down first, then moving the SOURCE up.
        //
        // Both are legitimate a-drafter moves, and the order matters. Measured
        // on dense: P-1 sits 10mm ABOVE its suction source V-1, and every
        // downward pump slot is blocked by V-2 — which is 35mm away and one
        // column over, inside `minSep`. Moving the pump down slides it
        // straight into V-2 and can never clear it. Moving the SOURCE up is
        // free here, because the source is a valve that passValves already
        // treats as a constrained item.
        //
        // So the constraint is "pump BELOW source", and either party may
        // satisfy it. Expressing it as "pump must move" made a satisfiable
        // constraint look unsatisfiable, which is the failure mode that gets a
        // rule layer abandoned.
        var movePump = tryMove(e, worst.ent, 1, step, TOL, ctx, minSep);
        if (movePump) return true;

        if (worst.ent._fixed || worst.ent.at || worst.ent.rel) return false;
        return tryMove(worst.ent, e, -1, step, TOL, ctx, minSep);
      }
    },
    {
      id: 'bottoms-receiver-below',
      rationale: 'A column bottoms draw goes to whatever it heats, and that item ' +
                 'reads as part of the column only when it sits below it.',
      applies: function (f) { return f.down.some(function (l) { return l.role === 'bottom'; }); },
      check: function (f, ctx) {
        var out = [];
        f.down.forEach(function (l) {
          if (l.role !== 'bottom') return;
          var dst = ctx.facts[l.peer];
          if (!dst || dst.ent.x == null) return;
          var dy = dst.ent.y - f.ent.y;  // >0 means receiver BELOW = correct
          if (dy < TOL) out.push({ measure: TOL - dy, detail: l.peer + ' not below bottoms source (dy=' + dy.toFixed(1) + ')' });
        });
        return out;
      }
    },
    {
      id: 'overhead-return-level',
      gate: 'layout.ruleOverheadReturnLevel',
      rationale: 'Vapour and reflux connections are at the top of the vessel. A ' +
                 'reflux line arriving at the side reads as a liquid line and is ' +
                 'misread as such.',
      applies: function (f) { return f.down.some(function (l) { return l.role === 'reflux' || l.role === 'top'; }); },
      check: function (f, ctx) {
        var out = [];
        f.down.forEach(function (l) {
          if (l.role !== 'reflux' && l.role !== 'top') return;
          var dst = ctx.facts[l.peer];
          if (!dst || dst.ent.x == null) return;
          var dy = Math.abs(f.ent.y - dst.ent.y);
          if (dy > 4 * TOL) out.push({ measure: dy - 4 * TOL, detail: 'overhead/reflux level differs by ' + dy.toFixed(1) + 'mm' });
        });
        return out;
      },
      // ---- target: the IN-SOLVE form ----
      // Same shape as `suction-source-above` (single-axis y ordering), and it is
      // the second rule that shape covers: the reflux/top source sits LEVEL
      // with the vessel it returns to, because a reflux line enters the top of
      // the column, not its side. Returning the peer's own target (rather than
      // a signed offset from it) is what "level" means here — |dy| = 0, well
      // inside the 4*TOL band the check allows.
      //
      // The median over peers is deliberate: with two reflux peers, taking the
      // worst-case single peer makes the target oscillate between them as the
      // sweeps re-derive `want`, and a target that moves on every sweep is a
      // solver that never converges. The midpoint is the stable value, and the
      // packer still gets the last word.
      target: function (f, ctx, want, api) {
        var ys = [];
        f.down.forEach(function (l) {
          if (l.role !== 'reflux' && l.role !== 'top') return;
          var p = ctx.facts[l.peer];
          if (!p || p.ent.x == null) return;
          ys.push(want[l.peer] !== undefined ? want[l.peer] : p.ent.y);
        });
        if (!ys.length) return null;                  // abstain
        if (ys.length === 1) return ys[0];
        ys.sort(function (a, b) { return a - b; });
        var m = ys.length >> 1;
        return ys.length % 2 ? ys[m] : (ys[m - 1] + ys[m]) / 2;
      },
      // `constrainTargets` gates on `enabled(f, ctx)`, NOT on `applies`. A
      // rule with a `target` but no `enabled` throws inside the try/catch in
      // constrainTargets, is read as "does not apply right now", and is
      // therefore invisible forever while reporting nothing wrong — the same
      // failure mode as the derived-gate bug documented at `ruleEnabled`. The
      // self-test that found this is the only reason it is not still there.
      enabled: function (f, ctx) {
        return f.down.some(function (l) {
          if (l.role !== 'reflux' && l.role !== 'top') return false;
          var p = ctx.facts[l.peer];
          return !!(p && p.ent.x != null);
        });
      }
    },
    {
      id: 'heater-beside-vessel',
      rationale: 'A reboiler or condenser is one system with the vessel it serves. ' +
                 'Adjacency is what makes the circulation loop readable; separated, ' +
                 'it is two unrelated items and two long pipe runs.',
      applies: function (f) { return f.kind === 'reboiler' || f.kind === 'exchanger'; },
      check: function (f, ctx) {
        var out = [];
        var peers = f.up.concat(f.down).filter(function (l) {
          var p = ctx.facts[l.peer];
          return p && (p.kind === 'tower' || p.kind === 'vessel' || p.kind === 'drum');
        });
        if (!peers.length) return out;
        peers.forEach(function (l) {
          var p = ctx.facts[l.peer];
          var dx = Math.abs(f.ent.x - p.ent.x), dy = Math.abs(f.ent.y - p.ent.y);
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d > 120) out.push({ measure: d - 120, detail: l.peer + ' is ' + d.toFixed(0) + 'mm away' });
        });
        return out;
      }
    },
    {
      id: 'bubble-above-tap',
      rationale: 'The bubble belongs over the point it measures. A field ' +
                 'instrument floating in open space with a dashed run to its host ' +
                 'is the single most common way a reader loses the connection.',
      applies: function (f) { return f.kind === 'instrument' && (f.loop || {}).role === undefined; },
      check: function (f, ctx) {
        var out = [];
        f.ports.forEach(function (p) {
          if (p.pipeKind !== 'tap' || !p.peer) return;
          var host = ctx.facts[p.peer];
          if (!host || host.ent.x == null) return;
          var dy = host.ent.y - f.ent.y;  // >0 means bubble ABOVE host = correct
          if (dy < TOL) out.push({ measure: TOL - dy, detail: 'tap on ' + p.peer + ' but bubble not above (dy=' + dy.toFixed(1) + ')' });
        });
        return out;
      }
    },
    {
      id: 'controller-above-manipulator',
      rationale: 'ISA convention: the controller sits above the final element it ' +
                 'manipulates, so the eye reads the loop as measure → control → act.',
      applies: function (f) { return (f.loop || {}).role === 'controller'; },
      check: function (f, ctx) {
        var out = [];
        var v = ctx.facts[(f.loop || {}).manipulate];
        if (!v || v.ent.x == null || f.ent.x == null) return out;
        // SVG y grows downward: controller above manipulator means SMALLER y.
        var dy = v.ent.y - f.ent.y;
        if (dy < 2 * TOL) {
          out.push({ measure: 2 * TOL - dy,
                     detail: 'controller is not above ' + (f.loop || {}).manipulate + ' (dy=' + dy.toFixed(1) + ')' });
        }
        return out;
      }
    },
    {
      id: 'orphan-co-location',
      rationale: 'An item with no process connection is placed by its instrument ' +
                 'or its host, or the reader cannot find why it is on the sheet. ' +
                 'Parked in the margin it at least reads as intentional.',
      applies: function (f) { return f.kind !== 'instrument' && f.processDegree === 0; },
      check: function (f, ctx) {
        var out = [];
        // nearest non-orphan item; report distance
        var best = Infinity, bestKey = null;
        ctx.all.forEach(function (o) {
          var k = o.id || o.tag;
          if (k === f.key || !ctx.facts[k]) return;
          var g = ctx.facts[k];
          if (g.processDegree === 0 && g.kind !== 'instrument') return;
          if (o.x == null || o.y == null) return;
          var d = Math.hypot(o.x - f.ent.x, o.y - f.ent.y);
          if (d < best) { best = d; bestKey = k; }
        });
        if (bestKey && best > 200) {
          out.push({ measure: best - 200, detail: 'no process connection; nearest neighbour ' + bestKey + ' is ' + best.toFixed(0) + 'mm away' });
        }
        return out;
      }
    },
    {
      id: 'flow-direction-consistent',
      rationale: 'Left-to-right flow reads as one pass. A reversal mid-sheet forces ' +
                 'the reader to re-read the whole drawing.',
      applies: function (f) { return f.kind !== 'instrument'; },
      check: function (f, ctx) {
        var out = [];
        f.down.forEach(function (l) {
          var d = ctx.facts[l.peer];
          if (!d || d.ent.x == null) return;
          var dx = d.ent.x - f.ent.x;
          if (dx < -TOL) out.push({ measure: -dx - TOL, detail: 'downstream ' + l.peer + ' is ' + Math.abs(dx).toFixed(0) + 'mm to the LEFT' });
        });
        return out;
      },
      // NO SOLVER, DELIBERATELY. This is the largest violation count in the
      // corpus (2775mm) and it is the one rule I believe is WRONG.
      //
      // `dense.dsl` legitimately runs V-2 -> C-1.reflux: the reflux returns to
      // the top of the column it came from, which is upstream of nothing and
      // left of nothing in particular. Left-to-right flow is a drafting
      // PREFERENCE, not a correctness property, and enforcing it would force
      // the reflux loop to double back across the sheet to satisfy a rule
      // about reading direction — making the drawing worse.
      //
      // It stays in the registry as an audit-only rule because the audit is
      // how this was noticed, and an audit-only rule is honest. Converting it
      // to a hard constraint is the kind of change that has to be argued from
      // a drawing, not from a metric.
      solve: null
    }
  ];

  // ── column affinity: the 2-D half of the rule layer ────────────────────
  //
  // `constrainTargets` edits a TARGET Y, and that architecture is right for a
  // 1-D ordering ("the pump sits BELOW its source"). But `heater-beside-vessel`
  // is a PROXIMITY rule, and on this engine proximity is not a coordinate the
  // placer controls: x is rigid per depth-column (`e.x = XMARGIN + colX * COL`,
  // pid-router.js:304 — every entity in a rank shares one x), and a reboiler's
  // rank is always its vessel's rank + 1, so it lands one full column pitch to
  // the RIGHT of the vessel it serves. Measured on dense: E-1 is 210mm from
  // C-1 (dx=185, dy=100) — a horizontal separation no y-target can close,
  // because closing it would need 185mm of vertical room that does not exist.
  //
  // A drafter solves this by putting the reboiler IN the column of the vessel,
  // below it: the bottoms draw drops straight down, the return comes back up,
  // and the circulation loop reads as one system. That is a COLUMN choice, not
  // a coordinate choice — so the mechanism has to be the one thing the placer
  // is free to change before coordinates exist: which rank-column an entity is
  // rostered in.
  //
  // Hence `affinityPlan`: the rule layer supplies POLICY (which entity wants
  // to share a column with which), returning moves the ROUTER applies as a
  // roster change before the barycentre sweeps. The sweeps then do the
  // drafting work for free: `belowFlag` already sorts "fed from bottom-ish
  // ports" (bottoms, drain, outlet) into the lower rows of their column
  // (pid-router.js:83-89), so a bottoms-fed heater re-homed into the vessel's
  // column lands below it with no new ordering code.
  //
  // Conservative by construction, and every condition is a decision to NOT move
  // something: an ambiguous peer set abstains, a peer with an authored position
  // abstains, and a target column already at the cap abstains. A re-home that
  // empties the source column is allowed — the alternative (a keep-one-member
  // guard) would make the rule abstain on the one sheet whose defect it exists
  // to fix.
  var AFFINITY_SPECS = [
    {
      id: 'heater-beside-vessel',
      self: ['reboiler', 'exchanger'],           // kinds that want to be co-columnar
      peer: ['tower', 'vessel', 'drum'],         // the vessel it serves
      colCap: 3                                  // never merge into a taller column
    }
  ];

  // Pure planning: no mutation, no coordinates. `geom` is the router's
  // { column, colKeys, depth } at the point after rowIdx is first built and
  // before the barycentre sweeps — the only moment the roster is free to
  // change. Returns { moves: [{id, fromDepth, toDepth, peer}] }.
  function affinityPlan(data, geom) {
    var ctx = semanticFacts(data);
    var moves = [];
    ctx.all.forEach(function (e) {
      var f = ctx.facts[e.id || e.tag];
      if (!f) return;                                  // instrument keyed by tag
      if (isAuthored(e)) return;                       // `at`/`rel` outranks everything
      var spec = null;
      for (var s = 0; s < AFFINITY_SPECS.length; s++) {
        if (AFFINITY_SPECS[s].self.indexOf(f.kind) >= 0) { spec = AFFINITY_SPECS[s]; break; }
      }
      if (!spec) return;

      // Candidate peers: directly connected by a PROCESS pipe (a signal or tap
      // link is not a co-location relationship — a bubble over a tank does not
      // pull an exchanger anywhere), of an eligible kind, and not authored.
      var peerDepths = [];
      var peerIds = [];
      f.up.concat(f.down).forEach(function (l) {
        var p = ctx.facts[l.peer];
        if (!p || isAuthored(p.ent)) return;
        if (spec.peer.indexOf(p.kind) < 0) return;
        if (peerIds.indexOf(l.peer) < 0) peerIds.push(l.peer);
        var dp = geom.depth[l.peer];
        if (dp !== undefined && peerDepths.indexOf(dp) < 0) peerDepths.push(dp);
      });
      if (!peerIds.length) return;
      // More than one candidate COLUMN is ambiguous: the heater has two homes
      // and picking one invents a priority the drawing did not state. Abstain.
      if (peerDepths.length !== 1) return;

      var from = geom.depth[e.id];
      var to = peerDepths[0];
      if (from === to) return;                         // already co-columnar
      var roster = geom.column[to] || [];
      if (roster.length >= spec.colCap) return;        // target column is full
      moves.push({ id: e.id, fromDepth: from, toDepth: to, peer: peerIds[0], spec: spec.id });
    });
    return { moves: moves };
  }

  // ── audit ─────────────────────────────────────────────────────────────
  // Reports, per rule: how many entities it applies to, and the total
  // violation. Read-only; changes no positions.
  function audit(data) {
    var ctx = semanticFacts(data);
    var out = { rules: [], fired: 0, violations: 0, totalMeasure: 0 };

    RULES.forEach(function (rule) {
      var applies = 0, v = 0, meas = 0, detail = [];
      ctx.all.forEach(function (e) {
        var f = ctx.facts[e.id || e.tag];
        if (!f) return;
        // An authored position is not a layout defect. Skipping it here is
        // what keeps `audit()` honest about what the ENGINE got wrong, which
        // is the only thing the audit is for. See `isAuthored`.
        if (isAuthored(e)) return;
        var a = false;
        try { a = rule.applies(f, ctx); } catch (err) { a = false; }
        if (!a) return;
        applies++;
        var res = [];
        try { res = rule.check(f, ctx) || []; } catch (e) { res = []; }
        res.forEach(function (r) {
          v++; meas += r.measure || 0;
          if (detail.length < 3) detail.push(f.key + ': ' + r.detail);
        });
      });
      if (applies) out.fired++;
      out.violations += v;
      out.totalMeasure += meas;
      out.rules.push({
        id: rule.id, rationale: rule.rationale, applies: applies,
        violations: v, measure: Math.round(meas), detail: detail
      });
    });
    return out;
  }

  // ── constrainTargets: rules INSIDE the coordinate solve ───────────────
  // This is the corrected architecture, and the reason it exists is a measured
  // failure of `enforce()` above.
  //
  // `enforce()` moves an entity AFTER the coordinate solve has finished. That
  // is a regression across the corpus (+105) even though the rule it enforces
  // is correct and it does reduce crossings where it applies. The cause is
  // structural: by then the nozzle runs, the tap host, the label stacks and
  // the instrument bubbles have all been placed relative to that entity, so
  // moving it drags four other decisions the rule cannot see and the score
  // cannot attribute.
  //
  // `constrainTargets` instead edits the TARGET the median/barycentre step
  // computed, before packing. A rule supplies a preferred y for one entity;
  // the median heuristic, the >= SEP packing and the re-centring all still run
  // afterwards and still resolve conflicts. Consequences and decision are the
  // same decision.
  //
  // Contract: a rule's `target(f, ctx, want, api)` returns a preferred y, or
  // null to abstain. Returning a number is a PREFERENCE, not an order — the
  // packer can still override it, which is the point. This is the difference
  // between a constraint and a post-hoc edit.
  //
  // `want` is keyed by entity id and may be sparse; fall back to the entity's
  // current y so a rule never has to know how the caller built it.
  function constrainTargets(data, want, opts) {
    opts = opts || {};
    var ctx = semanticFacts(data);
    var gap = opts.minGap || 20;
    var report = { adjusted: 0, byRule: {}, abstained: 0 };

    ctx.all.forEach(function (e) {
      var f = ctx.facts[e.id || e.tag];
      if (!f || isAuthored(e)) return;
      if (want[f.key] === undefined && !opts.includeUnplaced) return;
      if (want[f.key] === undefined) want[f.key] = e.y;

      for (var i = 0; i < RULES.length; i++) {
        var rule = RULES[i];
        if (!rule.target) continue;
        if (!ruleEnabled(rule, opts)) continue;
        var appliesNow = false;
        try { appliesNow = rule.enabled(f, ctx); } catch (err) { appliesNow = false; }
        if (!appliesNow) continue;

        var before = want[f.key];
        var proposed = null;
        try { proposed = rule.target(f, ctx, want, { gap: gap, TOL: TOL }); }
        catch (err2) { proposed = null; }
        if (proposed === null || proposed === undefined || isNaN(proposed)) {
          report.abstained++;
          continue;
        }
        // clamp to the sheet so a rule cannot aim a target off the drawing
        var h = ctx.sheet ? ctx.sheet.h : 559;
        proposed = Math.max(0, Math.min(h, proposed));
        if (proposed !== before) {
          want[f.key] = proposed;
          report.adjusted++;
          report.byRule[rule.id] = (report.byRule[rule.id] || 0) + 1;
        }
      }
    });
    return report;
  }

  // ── enforce ───────────────────────────────────────────────────────────
  // The constraint solver. A rule that applies is SATISFIED, not traded
  // against sheet fullness — that is the whole argument for a rule layer
  // (P&ID-ENGINE-REDESIGN.md:63-96: the layout cannot price a consequence of a
  // decision it has not finished making).
  //
  // Ordering, and it matters:
  //   enforce() runs AFTER every placement pass and AFTER passDecrowd.
  //   passDecrowd is a collision solver: if a rule moves an entity into a
  //   neighbour, decrowd must be allowed to resolve it. Running rules first
  //   would have decrowd undo the rule on the next iteration and the two
  //   would oscillate. So rules have the last word on ORDER, decrowd has the
  //   last word on PROXIMITY, and a rule that cannot be satisfied without
  //   colliding is reported rather than forced.
  //
  // Each rule declares:
  //   enabled(f, ctx) — does this rule apply to this entity, right now
  //   solve(f, ctx, api) — move `f.ent` to satisfy it; return true if moved
  //                     return false if IMPOSSIBLE (reported, not forced)
  // Solving is iterative because rules interact: satisfying one can violate
  // another, so the pass loops to a fixed point with a hard iteration cap and
  // reports whatever remains unsatisfied at the cap. An uncapped fixpoint loop
  // on a layout pass is how you hang a renderer.
  function enforce(data, opts) {
    opts = opts || {};
    var ctx = semanticFacts(data);
    var iters = opts.maxIters || 6;
    // separation the solver must respect when it moves something; supplied by
    // the router so this file does not need the renderer's size model
    var solverOpts = { TOL: TOL, minSep: opts.minSep || 0, entHalf: opts.entHalf || null };
    // the 1-D clearance test wants real glyph sizes when the router can
    // supply them; without this it falls back to a 15mm half-width
    api.entHalf = opts.entHalf || null;
    var report = { passes: 0, moves: 0, satisfied: 0, unsatisfied: [], byRule: {} };

    // stable order: equipment before valves, so an entity a rule moves has its
    // neighbours already final where possible
    var order = ctx.all.slice().sort(function (a, b) {
      var ra = a._pinned ? 1 : 0, rb = b._pinned ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return (a._seq || 0) - (b._seq || 0);
    });

    for (var it = 0; it < iters; it++) {
      var movedThisPass = 0;
      report.passes++;

      for (var i = 0; i < order.length; i++) {
        var e = order[i];
        var f = ctx.facts[e.id || e.tag];
        if (!f) continue;
        // Authored positions outrank every rule, and so does any position the
        // solver has already committed this pass — otherwise a rule and the
        // entity it just moved chase each other around the sheet.
        if (e.__ruleMoved) continue;
        // explicit `at` / `rel` is the author's decision and outranks any rule
        if (isAuthored(e)) continue;
        if (e.x == null || e.y == null) continue;

        for (var r = 0; r < RULES.length; r++) {
          var rule = RULES[r];
          if (!rule.solve) continue;                     // audit-only rule
          if (!ruleEnabled(rule, opts)) continue;        // per-rule gate
          var appliesNow = false;
          try { appliesNow = rule.enabled(f, ctx); } catch (err) { appliesNow = false; }
          if (!appliesNow) continue;

          var before = { x: e.x, y: e.y };
          var did = false, possible = true;
          try { did = !!rule.solve(f, ctx, solverOpts); }
          catch (err2) { did = false; possible = false; }

          if (did && (e.x !== before.x || e.y !== before.y)) {
            movedThisPass++;
            report.moves++;
            report.byRule[rule.id] = (report.byRule[rule.id] || 0) + 1;
            // Mark it settled for the rest of THIS pass. The loop already
            // re-runs all entities on the next pass if anything else moved,
            // so a rule that moved something is not given a second chance to
            // move it again immediately — which is how a two-rule pair
            // oscillates and a layout hangs at the iteration cap with every
            // entity displaced.
            e.__ruleMoved = true;
          }
          if (!possible) {
            var key = rule.id + ':' + f.key;
            if (report.unsatisfied.indexOf(key) < 0) report.unsatisfied.push(key);
          }
        }
      }

      // Clear the per-pass settled marks, so the next pass can move anything
      // again if a later rule disturbed the neighbourhood it was placed in.
      for (var q = 0; q < order.length; q++) order[q].__ruleMoved = false;

      if (!movedThisPass) break;   // fixed point reached
    }

    // Post-condition, and this is the number that matters: what is STILL
    // violated after the solver stopped. A rule that reports 0 here is
    // satisfied; a rule that reports non-zero was either unsatisfiable or
    // fighting another rule, and both are visible rather than silent.
    var after = audit(data);
    report.post = after;
    after.rules.forEach(function (rr) {
      if (rr.violations) report.unsatisfiedRule = (report.unsatisfiedRule || []).concat([rr.id]);
    });
    return report;
  }

  // Per-rule gate. Reads `layout.rule<Id>` from the rules registry, so a rule is
  // enabled the same way every other tunable is, and an unknown key reads as
  // disabled — the safe default.
  //
  // The key comes from the rule's own `gate` field, NEVER derived from the id
  // by string munging. Measured cost of deriving it: `-([a-z])` does not
  // capitalise the FIRST letter, so `suction-source-above` produced
  // `layout.rulesuctionSourceAbove`, which matches no registered key. Every
  // rule therefore read as disabled, silently — the solver reported zero
  // moves and no error, and the only way to notice was to compare a direct
  // call to `rule.solve()` (which worked) against `enforce()` (which did
  // nothing). A derived config key that can silently mismatch the registry is
  // worse than no key: it makes the rule unmeasurable AND unturnable.
  //
  // `assertGates()` below exists to stop that recurring.
  function ruleEnabled(rule, opts) {
    if (opts && opts.rules && Object.prototype.hasOwnProperty.call(opts.rules, rule.id)) {
      return !!opts.rules[rule.id];
    }
    if (rule.gate && typeof ruleParam === 'function') return !!ruleParam(rule.gate, 0);
    if (typeof ruleParam === 'function') {
      // a solver with no declared gate would silently never run; treat that as
      // a bug worth surfacing rather than as "disabled"
      return !!(opts && opts.strictGates);
    }
    return !!rule._defaultEnabled;
  }

  // Every enforceable rule must declare a gate that exists in the registry.
  // Returns the list of problems; empty means healthy.
  function assertGates() {
    var problems = [];
    RULES.forEach(function (rule) {
      // A rule with NEITHER solver form cannot be enabled at all, so it names
      // no gate and there is nothing to check. Covering `target` here matters
      // for exactly the reason the `gate` field exists: a target-only rule is
      // enabled through the same registry read, and an undeclared key reads as
      // disabled — silently, which is the failure mode this function guards.
      if (!rule.solve && !rule.target) return;
      if (!rule.gate) { problems.push(rule.id + ': no gate declared'); return; }
      if (typeof ruleParam !== 'function') return;
      var raw = ruleParam(rule.gate, undefined);
      if (raw === undefined) problems.push(rule.id + ': gate "' + rule.gate + '" is not in the registry');
    });
    return problems;
  }

  // `tryMove` slides `ent` along y in `step` increments until it is at least
  // `tol` BELOW `other` (sign +1) or ABOVE it (sign -1), accepting only spots
  // that are clear of every other entity by `minSep`. Returns true on the
  // first acceptable move; false if there is none.
  //
  // `minSep` MUST be evaluated on the axis the move happens on, not
  // Euclidean distance. Measured: with `Math.hypot`, spike's P-103 could not
  // move DOWN at all — P-102 sits 30mm away and 30mm up, so every downward
  // step was rejected — but P-102 is not in the way of a vertical slide, and
  // the entity the pump was actually colliding with (V-103, 185mm away in x)
  // was irrelevant. A 1-D slide only needs 1-D clearance: two entities block
  // it if they are within `minSep` in Y *and* overlapping in X.
  //
  // It mutates `ent.y` only on success, so a failed attempt leaves the sheet
  // exactly as it found it. Returning false rather than forcing a best-effort
  // overlap is deliberate: a forced move hides the real cause, and the caller
  // reports it.
  function tryMove(ent, other, sign, step, tol, ctx, minSep) {
    var startY = ent.y;
    // bounded: a slide further than the sheet is tall cannot help
    var maxSteps = Math.ceil(400 / step);
    var halfW = api.entHalf ? api.entHalf(ent) : 15;
    for (var i = 1; i <= maxSteps; i++) {
      var ny = startY + sign * i * step;
      // Whether the PROSPECTIVE position clears `other`. This must test ny,
      // not the current y: measuring the current position accepts a step that
      // has not gone far enough yet and rejects one that has, which is a
      // solver that never moves anything and reports nothing wrong.
      var dy = (ny - other.y) * sign;      // >0 means `ent` is past `other`
      if (dy < tol) continue;              // not yet far enough
      if (ny < 0 || (ctx.sheet && ny > ctx.sheet.h)) return false;  // off the sheet
      ent.y = ny;
      if (isClear(ent, ent.x, ny, ctx.all, minSep, halfW)) return true;
      ent.y = startY;                     // roll back and keep looking
    }
    return false;
  }

  // module-scope handle for the entity-size function the router injects, so
  // the 1-D clearance test above can use real glyph sizes when they are
  // available and a sane default when this file is used standalone
  var api = {};

  // ── shared solver helpers ─────────────────────────────────────────────
  // `clear` is an occupancy predicate supplied by the router (it knows the real
  // entity sizes); here we only need "is this spot already taken", so a coarse
  // box test against placed entities is enough and keeps this file free of a
  // dependency on the renderer's size model.
  // Clearance for a move along ONE axis. Two entities obstruct a vertical
  // slide only if they overlap in X and are within `minSep` in Y — a purely
  // vertical move cannot collide with something 185mm away in x, and treating
  // it as blocking makes satisfiable constraints look unsatisfiable.
  //
  // `minSep` of 0 disables the test entirely, which the caller uses when the
  // router has already run passDecrowd and wants the rule to have the last
  // word.
  function isClear(e, x, y, all, minSep, halfW) {
    if (!minSep) return true;
    var hw = halfW || 15;
    for (var i = 0; i < all.length; i++) {
      var o = all[i];
      if (o === e || o.x == null || o.y == null) continue;
      if (Math.abs(o.x - x) >= hw) continue;          // not in the same column
      if (Math.abs(o.y - y) < minSep) return false;   // would overlap
    }
    return true;
  }

  // Rules with a solver, and the gate that enables each. DERIVED from RULES
  // rather than hand-maintained: a hardcoded list is how a rule ends up
  // reported as "still violated" when it was never enabled (fixed 2026-10-10
  // at the router emission site, where the derived list is consumed).
  var ENFORCEABLE = RULES.filter(function (r) { return r.solve; })
    .map(function (r) { return { id: r.id, gate: r.gate, why: r.rationale }; });

  var API = {
    portRole: portRole,
    equipmentKind: equipmentKind,
    semanticFacts: semanticFacts,
    RULES: RULES,
    audit: audit,
    enforce: enforce,
    constrainTargets: constrainTargets,
    affinityPlan: affinityPlan,
    AFFINITY_SPECS: AFFINITY_SPECS,
    isClear: isClear,
    ENFORCEABLE: ENFORCEABLE,
    assertGates: assertGates,
    TOL: TOL
  };

  root.PID_PLACEMENT = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);