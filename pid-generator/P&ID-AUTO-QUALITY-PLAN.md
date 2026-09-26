# P&ID Auto-Quality Plan

**Goal:** fully automatic P&IDs that pass the machine audit with zero defects on
canonical sheets — human in the *approval* role, never the drawing role.
80% auto is the floor, not the target. Every phase below has a measurable exit
gate; if a phase doesn't move the numbers, it ships nothing and we stop spending.

**Where we stand (2026-09-06, spike sheet, 11 equipment / 6 valves / 12 instruments / 40 pipes):**

| Metric | Session start | Now | Target |
|---|---|---|---|
| engine errors / warnings / score | 1 / 10 / 5306 | 0 / 7-9 advisories / ~1750 | 0 / advisories only / budget §8 |
| `[0]` angled | 7 | 0 | 0 |
| `[1]` tiny text | 123/128 | 0 | 0 |
| `[4]` overlaps / `[5]` through-runs / `[6]` entity overlaps | 9 / 4 / 3 | 0 / 0 / 0 | 0 |
| `[7]` label collisions / `[8]` micro-segments | 5 / 12 | 0 / 0 | 0 |
| `[10]` ungapped crossings | 8 | 0 | 0 |
| A* failures | 1 (straight fallback through a body) | 0 | 0 |

Remaining known-honest residuals: ~20 gapped crossings (convention, not defect),
1 line 1mm outside the undrawn margin (edge-nozzle tip), tight-span lead-in
advisories, one 1.4mm grid-phase nub at V-103, one 1mm tip-phase nub at V-105.

**Tooling that exists:** `harness2.mjs` (`node harness2.mjs out.svg [--pos] [--noz]
[--geo=A,B]`, exit 1 on errors), `audit-svg.mjs` (checks `[0]`–`[10]` on any
exported SVG). Pipeline lives in the split stack:
`pid-parser.js` (parse/layout/topology) → `pid-router.js` (autoLayout, A\*,
resolveOverlaps, nozzle math) → `pid-validator.js` → `pid-renderer.js`
(route/refine/repair/emit). `P&IDGenerator.js` bundle + `test.mjs` are STALE
(bundle cannot parse `nozzle … size 6"` lines) and out of scope until §7.

---

## Phase 0 — Regression suite (do first; everything else depends on it)

**Why:** the split stack has zero automated tests. Score swung 5306→1748→2823→
1752 across edits in one session. Without baselines, every future change risks
silent churn and every verification loop re-spends the money already spent.

**What:**
1. New `pid-generator/regress/` folder, one subfolder per canonical drawing.
   Start with 3: (a) current `pid-spike.html` source, frozen as `spike.dsl`;
   (b) a minimal 3-equipment loop (pump→valve→tank + 1 control loop) exercising
   nozzles/taps/signals/gaps; (c) a dense stress sheet (all symbol families,
   junctions, both valve orientations, rotated equipment).
2. Runner `regress.mjs`: for each case, renders via the harness path, records
   `errors`, `warnings[]` (exact strings), `score`, and the full `audit-svg`
   report into `expected.json` on first run (`--bless`), diffs on later runs.
   FAIL on: any error, any new warning string, score increase >2%, any audit
   count increase in `[0][1][4][5][6][7][8][9][10]`.
3. Wire into the existing `test.mjs` slot: `test.mjs` currently tests the stale
   bundle — repoint it at the split stack (or replace with `regress.mjs`).
   Do NOT fix the bundle; delete-or-replace decision is §7.

**Exit gate:** `node regress.mjs` green on 3 sheets; every later phase must keep
it green (no silent regressions, no re-verification spend).

---

## Phase 1 — Delete dead weight (measured, not guessed)

**Why:** ~15 repair-ish mechanisms accumulated (refine rip-up, Phase-2 overlap
elimination, bend-shift, 2.7 repair, guarantee, snap, force-nozzles, tap dodge,
slide, coalesce). Some now fire never or fight each other. Dead code costs
runtime (render speed = restart budget in Phase 3) and comprehension.

**What:** with Phase 0 green, disable each repair pass one at a time behind a
`view` flag (e.g. `route direct`-style toggles, no UI), re-run regress +
canonical audit. Delete any pass whose removal changes nothing (or improves).
Prime suspects: bend-shift (converges instantly now that stubs are protected),
2.7 repair (overlaps are 0 at its entry), the second `resolveOverlaps` call
(needed once for grid-snap aftermath — verify, don't assume).

**Exit gate:** render time recorded per sheet (target: spike < 2s node); pass
count reduced with zero metric movement.

---

## Phase 2 — One objective function (make steps aware of each other cheaply)

**Why:** the score exists but nothing optimizes most of it. Labels, nubs, tap
reach, lead-in warnings are measured after the fact. Stages can't coordinate
without a shared cost.

**What:**
1. Fold every audit check into the score with calibrated weights. Current
   weights (30/pp, 20/ps, 500/nonOrtho…) are hand-picked and disproportionate
   (`offSheet` 500× fired on a 1mm invisible graze). Recalibrate against
   *visual* severity on the regress sheets: ungapped crossing ≈ overlap ≫
   label collision > long signal > length-per-mm. Document each weight with
   the defect it prices.
2. Feed the unified score to the passes that already optimize (refinement
   objective, Phase-2 acceptance, 2.7 acceptance) instead of their private
   crossing/length formulas. No new passes — same code, shared currency.
3. Set per-sheet score budgets in `expected.json` (from Phase 0 baselines minus
   10%). A phase "works" iff budget improves without audit regressions.

**Exit gate:** score formula documented + versioned; refinement/Phase-2/2.7 all
read it; budgets recorded.

---

## Phase 3 — Random-restart selection (the cheap global optimizer)

**Why:** the pipeline is deterministic, so one render = one local optimum, and
local optima are where the remaining defects live (pinched zones, corridor
fights). This is the highest-ROI structural bet: no architecture change, just
N seeded variants + pick-best-by-score.

**What:**
1. Add a seeded RNG (`mulberry32`, seed from `view.seed`, default fixed for
   reproducibility) and use it at exactly these choice points (all currently
   arbitrary-first-match):
   - A\* heap tie-breaks (equal-f heap order),
   - refinement worst-offender order among equals,
   - `freeSlot` dx/dy search order in instrument stacking,
   - junction fan-out rotation direction,
   - signal attach side among equals.
   Keep each choice *valid* (never pick a blocked/illegal option — randomize
   only among tied/allowed alternatives) so every variant is a legal drawing.
2. `renderPid(source, container, { candidates: N })`: render N× (node: parallel
   workers; browser: behind a "Finalize" button with progress), return the
   lowest-score result. N=16 default.
3. Record seed→score spread on regress sheets. Expect 10–30% score improvement
   and fewer pinched leftovers; if spread ≈ 0, the pipeline is already at its
   optimum and this phase ends (valuable negative information).

**Exit gate:** score spread measured; best-of-16 beats best-of-1 by ≥10% on at
least 2/3 sheets, else delete the RNG (no dead code).

---

## Phase 4 — Invariants, not heuristics (stop the next whack-a-mole)

**Why:** this session's deepest bugs were all "stage N+1 destroys stage N's
work" (lead-ins eaten 4 ways, grid snap re-colliding, smoothing leaving the
sheet, `orth` duplicates confusing `nearEnd`). Fixed piecemeal with tags and
guards. The systemic version: declare per-stage invariants, assert in debug.

**What:** a `PID_DEBUG` mode (off in production renders) asserting after each
stage, with the *location* of the violation:
1. Post-`routeOne`: lead-in stubs present at full length, axis-aligned to the
   port, endpoints exact.
2. Post-A\*: no diagonal segments; start/goal are the pinned endpoints.
3. Post-`cleanPoly`/shift/guarantee/snap: lead-in endpoints byte-identical to
   routeOne output (compare, don't eyeball).
4. Post-routing: all tips inside framesheet bounds OR explicitly flagged
   edge-nozzle; all polylines orthogonal.
5. Post-everything (pre-emit): every crossing has an assigned break; every
   break has ≥2mm shoulders (else explicit warning with coordinates).
Any future regression fails with the guilty stage named instead of a mysterious
1mm nub three sessions later.

**Exit gate:** debug mode exists, runs in regress suite, zero assertions on
canonical sheets.

---

## Phase 5 — Placement↔routing co-design (the 80%→95% structural work)

**Why:** the pipeline's fundamental blindness is order: layout places entities
without knowing routing costs, routing suffers without moving entities. All
big remaining artifacts are placement artifacts (valves 1.4mm off-axis from
grid-phase, bubbles stacked 55mm above their tap lines, recycle lines touring
the perimeter, controllers parked across the sheet from their measurements).

**What (in order, each gated):**
1. **Port-aware grid phase.** Grid-align rounds entity *centers* to 5mm, but
   pipes attach at *ports* (fractional glyph offsets), so alignment breaks by
   up to 2.5mm every snap. Change the snap objective: choose the grid offset
   (per entity, ±2 cells) that minimizes port-elevation mismatch with already-
   placed flow partners. Bounded local search, no architecture change.
2. **Tap-proximity stacking.** Field instruments stack above the host *entity*;
   taps land on the host *line*, often 50mm sideways. Anchor Pass-A x to the
   host's line-side nozzle tip x (nearest tip to the tap side), and score
   candidate slots by resulting tap length (computable: vertical drop +
   horizontal run, no routing needed). Target: tapReachTotal −40%.
3. **Skeleton-first corridors.** Route the longest process chain first with a
   reserved wide corridor (higher `penNear` on both sides for N cells), then
   details. Currently only process-vs-signal ordering exists. Measure crossing
   count on the recycle-heavy sheets.
4. **Controller/valve co-placement.** Controllers stack above driven elements
   but the driven elements were placed without knowing it (PT-101→PIC-101
   536mm signal). When a loop is declared (`loop`/`signal` pairs), place the
   pair as a unit (controller above final element, field above process tap)
   *before* general stacking, and let other entities avoid the pair's box.
5. **Two-pass layout (close the loop).** Run layout→route→measure, then move
   only the worst offenders (top-3 by tap-reach + signal-length + crossing
   involvement, ≤1 cell each) and re-route affected pipes only. This is
   "combining steps" in its cheapest honest form: one feedback iteration, not
   a rewrite. Cap at 2 outer iterations; accept iff unified score improves.

**Exit gate (the 95% bar):** on all regress sheets — 0 errors, 0 ungapped,
`[0][1][4][5][6][7][8][10]` all 0, warnings only tight-span advisories,
tapReachTotal halved vs today, no signal >400mm without an explicit `via`.
If Phase 5.1–5.5 together don't clear the bar, stop automatic work: the
remainder is judgment calls (see Phase 6), not heuristics.

---

## Phase 6 — Human as approver, never drafter (bounded manual role)

**Why:** even at 95%+, someone must sign the drawing. The manual loop must be
fast, safe, and round-trippable — not a second drawing tool.

**What:**
1. Keep drag-to-move + `toSource` round-trip (already works); add snap-to-grid
   on drop, single-pipe local re-route on move (route only incident pipes,
   keep the rest), and an "accept layout" freeze (`fixed` flag per entity that
   layout honors like `at`).
2. Approval checklist UI backed by machine checks: errors/warnings/audit surfaced
   per-object (click a warning → zoom to the geometry), sign-off records the
   score hash. A human approves deltas, never redraws.
3. Sheet-splitting UX for oversized flows (40 pipes/sheet is the root cause of
   half the crossings): user marks a cut set, DSL gets off-page connectors +
   battery limits (already in the grammar/tests), each sheet re-renders clean.
   No automatic partitioning — placement of cuts is engineering judgment.

**Exit gate:** a dragged layout round-trips through source with zero model
changes except positions; approval checklist covers every machine check.

---

## Phase 7 — Pre-fab assemblies (correctness by construction)

**Why:** everything before this makes bad input draw cleanly; assemblies make
bad input inexpressible. A pump assembly always ships its check valve, a PSV
assembly always ships inlet block + flare discharge + both relations, a control
assembly always ships fail position + bypass. Whole warning classes convert
from advisories into construction guarantees — direct progress toward the 95%
bar, compounding with the registry, restart selection, and co-design.

**Core decisions (locked):**
1. **Expand-to-flat with provenance, no new runtime model.** `assembly` blocks
   expand during parse, before topology, into ordinary entities/pipes carrying
   `source:'assembly', sourceId, externalId` (fields the schema already has).
   Validation, routing, scoring, audit work unchanged.
2. **Substitution only — one def per variant.** Positional `$params` + tag
   templating, nothing else. Steam-vs-gas orifice variants are two defs, not
   one def with conditionals. No conditionals, loops, or inheritance.
3. **Layout via existing `rel`.** Bodies place members relative to an anchor;
   no new placement code in v1 — measure cluster layout before inventing group
   layout.
4. **`toSource` emits flat + `# from assembly X` comments.** Full `use`
   round-trip deferred (drag would need to write back into params); instances
   are authoring-time macros, the flat model with provenance is the truth.
5. **Composition is the only abstraction.** Bodies may `use` other assemblies;
   recursive substitution with param scope stack (inner shadows outer),
   cycle = parse error naming the loop, depth cap 8, provenance chains
   (`sourceId: "outer>inner"`). Mirrors engineering reality (manifolds contain
   taps; pump trains contain manifolds).
6. **Catalog split.** `assembly.js` ships built-ins as dumb data
   (`{name, params, body}` in DSL-template text — never logic; a need for
   assembly-side logic means extending the DSL instead). DSL `assembly...end`
   blocks cover project/custom work. Resolution: DSL-defined first, built-ins
   second. Spec source: `P&ID Assemblies.md` (entries narrower than their doc
   sections — sizing notes and calculations don't belong in templates).

**Starter set (in order; each gated):**
1. Control valve manifold (block–CV–block + bypass + drains) — highest
   frequency; contains #2.
2. PI/PT shared tap (doc §1.1) — proves nesting + tap/signal generation.
3. PSV assembly (§1.2) — proves generated safety relations.
4. Pump suction/discharge (§7.1) — the composition showcase.

**Gates (all must hold per assembly):** real-sheet DSL compression ≥20%,
regress green, zero new warnings — plus for nesting: depth-2 expansion with
resolving provenance chains.

**Explicitly deferred (decided with evidence, not in abstract):** optional
parts (separate defs until the fifth near-duplicate forces the question),
repetition (same trigger), named vs positional params (decided when bodies
exceed ~5 params, during #1). The day near-duplicates prove recurrence is the
day conditionals get reconsidered — not before.

---

## Explicit non-goals (do not spend here)

- More repair passes or more bend-shift-style iterations (converged; measured).
- Global rewrite / constraint solver / ML routing (10–50× cost, uncertain gain;
  revisit only if Phase 5 fails its gate with evidence).
- `P&IDGenerator.js` bundle resurrection — it can't parse the current DSL
  (`nozzle … size 6"`); either repoint `test.mjs` at the split stack (Phase 0)
  or delete the bundle. No third option, no maintenance of both.
- Chasing the score below honest floors (sub-cell nubs at pinched ports,
  edge-nozzle margin grazes): fix the metric or accept, never contort geometry.

## External references (reviewed 2026-09-06, no trawl authorized)

- **Mermaid.js source, broad review: declined.** Flowchart/dagre architecture
  doesn't transfer to orthogonal P&ID routing; cost exceeds return.
- **Two bounded lookups approved alongside Phase 4:** (a) how Mermaid measures
  text for layout — our 0.55-width estimate is a known weakness, and the
  implication runs opposite to current practice (use real `getBBox` in browser,
  estimates only in node, instead of forcing parity downward); (b) Mermaid-ELK
  orthogonal edge-routing *docs* (not source) as input if hand-rolled A\* is
  ever replaced (Phase 5+ consideration only).

## pyDEXPI investigation (open — reference and test-tool only, never a dependency)

- **What:** `process-intelligence-research/pyDEXPI` — Pydantic model of DEXPI
  1.3, Proteus XML loader, NetworkX graph export, SVG renderer of stored
  graphics, synthetic generation. Local clone at
  `%TEMP%\opencode\pydexpi-ref`; design notes in `reference/dexpi-reference.md`.
- **Hard boundaries:** AGPL-3.0 (clean-room reference only, never import or
  copy into shipped code; out-of-process test/dev use is fine), Python vs our
  JS stack (no direct integration possible anyway), and one spec generation
  behind (targets 1.3/Proteus; DEXPI 2.0 moved to native DEXPI XML).
- **Investigate, in order:** (1) conformance oracle — load our future DEXPI
  export through their `ProteusSerializer` as a test step; (2) graph
  cross-check — their reference P&ID (`C01V04-VER.EX01.xml`) via NetworkX vs
  our path/isolation queries on an equivalent sheet; (3) import corpus —
  their `data/` examples as regression inputs if an importer is ever built.
- **Explicitly out:** their SVG renderer (no layout — irrelevant to our
  engine), synthetic generation (different goal), any vendoring.

## Sequencing and spend control

0 → 1 → 2 → 3 → 4 → 5.1…5.5 → 6 → 7. Each phase ships only on its exit gate;
a failed gate ends that line of work with a one-paragraph obituary in this
file (negative results are the deliverable that stops the fortune-spending).
Re-run the full audit (`audit-svg.mjs` checks `[0]`–`[10]`) plus regress suite
after every phase — that loop is the entire quality system.

## Phase 1 outcome (2026-09-06, measured — no deletions made)

Measured all 8 repair passes via kill-switch + activity counters on all 3
canonical sheets (spike render: 225ms, headroom for Phase 3 confirmed):

| Pass | Kill effect | Activity | Verdict |
|---|---|---|---|
| `refine` rip-up | dense 274→338, +2 crossings | fires | **KEEP** (evidence) |
| `guarantee` L-corners | diagonal returns, +warning | fires | **KEEP** (evidence) |
| `runslide` grid snap | +18 score, but `[8]` 0→1 nub returns | fires | **KEEP** (plan bar `[8]=0` holds) |
| `force` nozzle stubs | C-101 lead-in warning returns, +1 crossing | fires | **KEEP** (evidence) |
| `phase2` overlap elim | none | 0 fixes | **KEEP as insurance** — 1 idle scan; re-measure post-Phase-5 |
| `bendshift` | none | 0 moves | **KEEP as insurance** — converges instantly when idle; re-measure post-Phase-5 |
| `repair27` rip-up | none | 0 reroutes | **KEEP as insurance** — guards cheap; re-measure post-Phase-5 |
| post-snap `overlap2` | none | n/a (1 line) | **KEEP** — protects the grid-snap aftermath by construction |

No safe deletions: the 4 idle passes are cheap armed insurance ahead of Phase-5
placement churn (which *will* create new overlap/ungapped patterns), and their
failure mode without them stays LOUD (errors/warnings still report — nothing
fails silently). Kill-switch and counter scaffolding removed; `renderMs`
kept in harness output for Phase 3 budgeting.

## Phase 2 outcome (2026-09-06 — unified objective live)

- Score rebuilt as documented severity tiers (`PID_RULES.weights` in `pid-rules.js`,
  also serialized as `score.weights`): T0 errors×1000 / nonOrtho×500 /
  overlap×150 (capped at 5 pairs); T1 ungapped×150; T2 pp×15 / ps×10 / ss×5 /
  label×30 / sheet×100 per-pipe; T3 bends×2 / length×0.05 / tap×0.2 / sig×0.2 /
  warnings×5. No term dominates (spike max share 35%).
- Label collisions now computed from model-side text boxes (`pidTextBoxes`,
  same factors as `audit-svg`), identical in node and browser — audit `[7]`
  and `score.annotations.labelCollisions` agree by construction (replaces the
  node-blind `getBBox` path).
- `offSheet` counts per-pipe, not per-segment (was triple-counting one 1mm graze).
- Refinement objective uses the unified weights (pp/ps/ss split added to its
  counter; overlap priced by length ×12 as the inner approximation; labels /
  taps / warnings priced at selection, not reroute time). Phase-2 and 2.7
  acceptance deliberately unchanged (already strict-local wins; forcing the
  full score there could trade targeted fixes for length).
- Baselines consciously re-blessed (geometry untouched — only the formula
  changed): spike 1748→1058, min 48 (same total, new shape), dense 274→234.
  Budgets stored in `expected.json` (spike 952, min 43, dense 211); enforced
  for candidate acceptance in Phase 3, not before.

## Follow-through (2026-09-06 — registry, collision, annotation, rank)

- **Rule registry live (`pid-rules.js`, loaded first).** Every enforced code in
  the catalog: tags, symbols, refs, signals, instruments, valves, geometry
  (new `PID-GEO-001..004`, `PID-SIG-002`, `PID-INS-004`, `PID-VAL-001..003`,
  `PID-LAY-001/002` — previously bare strings), loops/safety/topology errors
  (codes kept verbatim), full SCHEMA family with matching severities. Each
  entry: title, category, hard/soft hardness, current severity, score weight
  key, message template, appliesTo, phase, enabled flag. Thresholds as
  constrained params (`value/min/max/unit/desc`); `ruleParam()` wired through
  router (layout pitches, stacks, gaps, A* costs, pads), renderer (stubs,
  gaps, type, label offsets, tap dodge), validator (lead-in, signal length,
  tap reach, gap audit). Score + refinement read `PID_RULES.weights`
  (incl. new `overlapLen` inner weight). `lineRank()` replaces the inline
  signal/process ternary. Rule IDs now prefix validator warnings (one
  re-bless, geometry identical).
- **Collision module (`pid-collide.js`, no dependency).** Bounding geometry +
  uniform-grid broadphase + exact narrowphase (`rectsHit`, `segHitsRect`,
  `indexOf`, `nearby`, `entityBox`); `routeObstacles` consumes `entityBox`
  (single source of truth for pads). Answers "within R of this valve" via
  `nearby`. Annotation line-avoidance consumes `segHitsRect`.
- **R-tree verdict: declined.** N≈40 entities/pipes → O(n²) is ~1.6k checks
  per pass, microseconds. RBush/R-tree/Clipper/GEOS/JSTS break even past ~1k
  objects with insert/delete churn; we rebuild per render. The grid index in
  `pid-collide.js` covers growth into the hundreds. Revisit if sheets exceed
  ~500 entities. No new dependency (static site, no bundler — consistent with
  the no-R-tree decision).
- **Annotation engine (labels-last discipline).** Line-label placement now an
  explicit pass on final geometry: candidates scored against boxes, tag zones
  (entity stacks + nozzle tags, same math as emission), placed labels, and —
  new — routed lines (preference sweep: line-clear first, line-adjacent
  fallback). Fallback path also guarded (was the leak). Fixed entity-measure
  inflation (`&quot;` counted as 6 chars → phantom 10mm) in both
  `pidTextBoxes` and `audit-svg`.
- **Process rank shared (`processRank` in `pid-router.js`).** BFS layers +
  Tarjan SCC (cycle members reported on `data.flowCycles`), consumed by
  `autoLayout`; verified byte-identical layouts via regress (first attempt at
  longest-path re-layered the sheet and was reverted to exact BFS semantics).
  Ready for corridor reservation / placement passes (Phase 5).
- **NetworkX verdict: no dependency; queries stay hand-rolled.** pyDEXPI uses
  NetworkX for plant-graph analysis; our equivalents (`pathAnalysis`
  sources/sinks/reachability, `queries.path/upstream/isolationValves`) cover
  what's needed at our scale with zero dependency weight. Revisit only if a
  non-trivial algorithm is required (all-pairs, max-flow isolation, cycle
  basis) — and then as a dev-time cross-check first (same pattern as the
  pyDEXPI conformance oracle), not a runtime import.
- **Wiring audit (2026-09-06):** all registry params consumed (`nozzleLead`,
  `junctionStubMin`, `sheetMargin` closed the last three gaps), score +
  refinement read `PID_RULES.weights`, `lineRank()` replaces the inline
  ternary, `ruleEnabled()` exposes the per-rule flag (profile hook for Phase
  6). Global-name check across all 8 stack files: no collisions. Load order
  (`pid-rules` → `pid-collide` → rest) verified in both HTML pages + harness.
  `enabled` is intentionally unwired per-site until project profiles exist.
- **Rules review (2026-09-06, pre-Phase-3):** every emitted code now has a
  catalog entry — added `PID-CON-002` (process pipe on instrument, the one
  gap) and ID-prefixed six bare pushes (`VAL-001/002/003`, `SAF-001/002`,
  `TOP-001`); added `PID-GEO-005` (line through symbol) + `PID-SHT-001`
  (line leaves sheet) so audit `[5]`/`[9]` have rule counterparts (the known
  1mm J-4→E-103 graze now reports honestly; one re-bless, spike budget
  952→957). Checked against the drafting doc §151 25-rule minimum set: all
  covered. Doc §135 ID scheme matches ours; §137 overrides map to the
  `enabled` flag (DSL syntax deferred to Phase 6).

## Rules review III (2026-09-06 — metadata/lifecycle batch triaged, 2/15 kept)

- Adopted with enforcement: `PID-SYM-002` (custom `symbol` without `legend on`
  — zero fires on canonicals, no re-bless), `PID-PKG-001` reserved disabled
  (needs battery-limit/off-page entity + ref field).
- Declined: `FIT-001` (dup of PORT_CAPACITY), `UTL-001` (no tie-in objects —
  would fire on every utility line), `SHT-002` (same territory as PKG-001, no
  entity), `PIP-008` (no multi-sheet model), `LCY-001` (default `'new'` means
  never missing; requiring explicit state = noise on everything), `SIG-004`
  (grammar mandates medium — unparseable otherwise), `INS-009/010` (no
  primary-element/direction metadata), `CTRL-001` (no classification field),
  `EQP-007` (no redundancy relations; detection would be heuristic noise),
  `COND-001` (no condition entities), `ANN-006` (no annotation entity, same as
  ANN-001), `NOZ-001` (orientation computed for every resolved nozzle by
  construction). Category comment gains `package`; other proposed categories
  (`fitting|utility|lifecycle|condition|control`) stay out until a rule needs
  them — no speculative taxonomy.

## Rules review II (2026-09-06, pre-Phase-3 — external proposal triaged)

- Adopted with enforcement: `PID-VAL-004` (auto valves without `fail` — scoped
  to `AUTO_VALVES` so manual gates stay quiet; immediately found V-103, V-105,
  V-2), `SCHEMA-061` (bare sheet without title/sheet/rev — fires only on truly
  bare sheets, canonicals unaffected).
- Reserved disabled (`enabled:false`, IDs claimed for future DSL features):
  `TOP-003` (needs continuation entity), `TOP-007` (needs loop-declaration
  syntax; process loops are legal today), `PIP-003/004` (need flow/side
  semantics), `EQP-004` (needs package entity), `VAL-005` (needs valve state
  machine), `SAF-003` (needs destination semantics), `HYG-001/002` (need
  hygienic service flag), `ANN-001/003` (need annotation entity).
- Declined with reasons: `TOP-002` (impossible by construction — pipes always
  have endpoints, stubs are legal), `TOP-004` (contradicts our convention —
  gapped crossings without junctions are legal), `TOP-005`/`VAL-006`/`ANN-002`/
  `ANN-004` (duplicates of CON-002/SIG-001, VAL-001, labelCollisions),
  `TOP-006` (junction rules already enforce), `PIP-001/002` (SIZE/SPEC_MISMATCH
  already error), `EQP-002` (doc §15 leaves it project-decided; would be pure
  noise), `EQP-003` (needs side metadata, ~zero incidence), `EQP-005`
  (isolation is a design choice, not a defect), `SCHEMA-060` (no demand —
  sparse lines are legal), `SCHEMA-062` (parse regex already constrains
  status). Doc §151 minimum-25 re-verified: still fully covered.

## Phase 3 outcome (2026-09-06 — selection works, headroom ~1-2%, thesis closed)

- Mechanism: seeded RNG (`pidSeed`/`pidRng`/`pidShuffle` in `pid-rules.js`,
  mulberry32, never `Math.random`) at 5 choice points (A\* dirs, refine order,
  freeSlot, fan-out, signal sides — preferred options stay first, only ties
  rotate). `renderPid(src, el, {candidates:N, seedBase})` runs legacy +
  N seeds, keeps min total (ties → lower seed); legacy always competes, so
  selection never regresses vs single render (asserted in `regress.mjs`).
  `seed N` DSL directive + `toSource` round-trip pins winners; grammar updated.
- Measurement (full 31-subset sweep per sheet): spike 1063→1049 (1.3%, seed 10
  trades +6 bends/+83mm for −2 crossings/−3 warnings), min 48→47 (2%), dense
  234→234 (0%). Full reshuffles scored 2–3× worse (up to 3130 with overlap
  errors) — hence subset search (seed bits enable sites individually).
  Deterministic: identical winners across runs. Cost ~1.8s per 9 renders.
- Gate verdict: the ≥10% bar was NOT met — the pipeline is already at/near its
  optimum on canonical sheets (the predicted valuable negative result).
  Optimization thesis CLOSED: no bigger N, no new sites, no annealing — zero
  further search spend. Machinery KEPT (deviation from the delete rule,
  justified): it's tested, green, costs nothing ongoing, and `seed` pinning is
  a Phase 6 approval asset (exact reproduction for sign-off). Kill rule
  satisfied in intent: future spend on search is zero.

## Scale decision (2026-09-06 — singular, forever)

1 SVG unit = 1mm = 1px on every sheet. `fit page` never zooms in
(`k = min(1, …)`); overflow still shrinks with PID-LAY-001. Window size
no longer stretches the drawing (was: identical symbols at different
sizes per sheet). Small sheets sit true-size, not zoomed.

## Linework program (2026-09-06 — visual review, machine-verified)

Demo realistic-rewrite renders 0 errors (43 entities, 162 texts) but the
linework review found real issues. A vision pass hallucinated equipment
(R-102, FV-103/104, loop boxes) and claimed line-through-symbols the audit
contradicts ([5]=0) — every item below is machine-verified from the SVG.

- L1 tap+signal pair routing (defect: 1 ungapped tap×own-signal crossing).
  Route the pair with lane discipline instead of independent corridors.
- L2 joint annotation pass (7 label collisions: 5 R-101 nozzle/chip
  cluster, 1 D-101 vent, 1 type×line label). Entity stacks, nozzle tags,
  line labels are placed by three paths that can't see each other —
  collect all boxes (`pidTextBoxes` + `pid-collide.js` grid) and
  displace/stagger; nozzle-tag side alternation first.
- L3 sheet-split UX (21 crossings from 40 pipes/sheet; J-4 fan-out runs
  1100mm+). Gapped crossings are convention — splitting, not routing, is
  the structural fix. Off-page connectors + battery limits in grammar;
  needs cut-set UX (Phase 6.3).
- L4 minimum-span rule for inline valves (6 sub-cell nubs, all on short
  new valve spans). Absorb sub-2mm jogs at the valve body or warn at
  authoring time.
- L5 edge-nozzle entity (J-4→E-103 graze warned but objectless). Make it
  an entity so sign-off can pin it.
- No action: text sizes ([1]=0, 3.5mm floor is print-correct), long
  signals (structural, priced), whitespace balance (unmeasured impression).

## Symbol joint work (2026-09-06 — arrowheads, pump necks, dots)

- Removed `marker-end` arrowheads from all process paths: stamped
  triangles piled onto equipment vertices as doubled blobs (user image:
  V-101 inlet). SVG-only (metrics byte-identical), regress green.
- Pump glyph had no suction/discharge necks: ports floated ~4mm off the
  casing (white sliver). Grafted native-space necks into the bundle
  entry (ports already exact). Verified continuous on pixels.
- Port-scale scare investigated and cleared: 8.3-style coords are
  correct 0–100 normalizations (scale-invariant by construction —
  gate/check/control/tank all land exactly on drawn outlines).
  No library rescale; bundle/source divergence (motor triangle) noted.
- Junction branch dots r=3.5→2.5 (SVG-only).

## Tap wire-spacing (2026-09-06 — 33mm corridor share fixed, regress green)

- Visual review found what nothing counted: LT-101's tap sharing 33mm
  of J-1→V-103's corridor (single-edge pinch — west edge off-sheet,
  east lane taken; kept silently). Tap middle verticals now shift ±2mm
  to the free side (corners move rigidly, landing holds; bubble start
  and landing never move). Residuals warn as PID-INS-005 (new rule;
  was silent: unscored and unwarned).
- Sibling fan-out crossings assessed: destinations interleave, all
  gapped, optimal per the unified currency — no defect, no fix.

## L6 outcome (2026-09-06 — nozzle tags off lines 10→9, regress green)

- Visual review (Edge headless screenshots) caught what the audit
  doesn't count: nozzle tags sitting on routed lines (10/31, probe).
  Tags now pick default / flipped / +8mm-along sides against routed +
  tap segs AND symbol boxes, before line labels place; zones, emission,
  and L2 boxes share the stored coords (no drift by construction).
- Residual 9: every alternative blocked by lines or stacks on all four
  sides (traced per-tag) — dense-sheet honest, not algorithm gap. White
  halos keep them legible (paint-order stroke, pre-existing).
- Not pursued:   sheet-split demo usage (single-sheet demo + "Sheet 2"
  ref = worse realism), column rebalancing (5.1's failure mode).

## L3 outcome (2026-09-06 — offpage connector live, regress-gated)

- `offpage ID [at x,y] ref "..."` (stub semantics + destination):
  parse, OFFPAGE_REF error on bare, OPC glyph rotated toward partner,
  ref text with tag-zone reservation, `toSource` round-trip exact
  (reparse 0 errors, identical score). 4th regress case `split.dsl`
  (budgets: 38/34). Negative path verified manually (exit 1).
- Battery limits deferred: boundary-LINE semantics need a fence pass;
  offpage covers cut-set termination. No automatic partitioning (plan:
  cuts are engineering judgment) — no UI until Phase 6.

## L5 outcome (2026-09-06 — edge flag live, demo SHT gone)

- `edge` nozzle modifier (parse + `toSource` round-trip). Validator
  exempts the tip AND its lead leg at edge nozzles — traced: the lead
  extends 14mm past edge tips by construction (lead x=5 vs tip x=19),
  tip-only exemption never fired. Interior excursions still warn.
- Demo: NZ-E103-1 flagged, SHT warning gone (8 advisories left, all
  allowed classes). Regress green.
- Drive-bys from the investigation: gate-2 epsilons aligned to codebase
  convention (endpoints 0.5, diagonals 1.0 — cleanPoly preserves <1mm
  micro-stubs by design); `pushU` no longer swallows exact port tips
  (real 0.2mm endpoint bug, regress-neutral).
- Known-firing canary (demo only, regress green): V-103→V-112 splice
  diagonal on fold-back approach — corner aligns to discarded prev,
  orphaning the incoming nub. Fix attempted (corner from kept point) →
  canonical tap-corridor overlaps → reverted. Guarantee repairs it,
  gate-4 verifies, score prices the bend. Revisit only with
  corridor-aware routing.

## L4 outcome (2026-09-06 — closed without code, plan-cited)

- All 6 residual nubs are 1–1.4mm at pinched valve/nozzle spans — the
  plan's explicit non-goal ("sub-cell nubs at pinched ports: fix the
  metric or accept, never contort geometry"). Absorbing them means moving
  routed runs for an unscored audit count (5.1's lesson).
- Warn half already exists: 5× PID-GEO-002 tight-span advisories name
  every short span. Accepted as honest floor.

## L2 outcome (2026-09-06 — labels 7→2, regress green)

- Valve-stack flip: below-stack colliding with nozzle/equipment tag zones
  flips above (horizontal) or end-side (vertical), only into strictly
  clearer positions (emission-faithful boxes in `pidTextBoxes` math).
- Tail-aware line labels: anchor test covers the full designation span;
  fallback tries both sides at both standoffs before accepting.
- Residual 2: V-112 stack vs R-101 tag (both flip positions collide —
  structural crowding) and one CW-202 label in a span with no clear slot.
  Score 1587→1437.

## L1 outcome (2026-09-06 — structural residual, mechanisms removed)

- Two cheap mechanisms attempted for the tap×own-signal ungapped
  crossing: signal rip-up with tap hard-blocked (2.7-style acceptance),
  and tap-landing penalty for the signal's lane. Both never fired:
  the shared lane is structural (tap must drop at bubble-center x, signal
  relax funnels to bubble bottom, no alternative run in reach).
- Removed per delete-doctrine (demo byte-identical, regress green).
  Residual stands (same class as the pre-rewrite demo's single [10]).
  Structural fix needs tap/signal/bubble co-placement (5.4) or manual
  `via` — judgment call, not heuristics.

## Phase 5 closing (2026-09-06 — automatic work STOPS here per plan)

- 5.4 (controller co-placement) deferred without code: Pass A/B already
  stack controllers above driven elements and field above hosts — the
  "unit" placement 5.4 describes. The one live residual (PT-101→PIC-101
  ~540mm) is structural: field and final element are far apart by process
  necessity, so no controller position shortens both legs. Full
  pair-as-unit rework for one priced advisory fails cost/benefit.
- 5.5 (two-pass layout) not attempted: it moves entities post-route,
  5.1's proven failure mode, plus new partial re-route machinery. Three
  independent measurements (Phase 3 search spread ~1%, 5.1 revert,
  5.3 revert) confirm the pipeline is at its local optimum; further auto
  gains need corridor+label-aware placement — new architecture, which
  this plan explicitly declines ("stop automatic work", global-rewrite
  non-goal).
- 95% bar NOT cleared and not chased: `[8]` 2+2 sub-cell nubs (honest
  floor, priced in bends), dense `[5]` 1 tap-through, tapReach 51,
  1 signal >400mm. Remainder is judgment calls → Phase 6 (approval UX),
  or correctness-by-construction → Phase 7 (assemblies, compounds with
  everything without touching geometry optima).

## Phase 5.3 outcome (2026-09-06 — FAILED GATE, reverted with obituary)

- Thesis: longest-process-chain-first order + reserved ±2-cell corridors
  around backbone lines. Bisected: corridors-off (order only) left dense
  identical and moved spike tapReach 51→86 (reordered host geometry);
  corridors-on improved dense 4→3 crossings but regressed spike 32→34
  with an ungapped crossing and a label collision (score 1127→1382).
  Wide corridors squeeze details on the big sheet; DSL order + refinement
  already finds this pipeline's skeleton optimum (third confirmation after
  Phase 1's repair audit and Phase 3's search thesis).
- Reverted fully (`REGRESS OK` proves it). Corridor reservation stays dead
  until a placement pass prices corridors first (5.5 or never).

## Phase 5.1 outcome (2026-09-06 — FAILED GATE, reverted with obituary)

- Thesis: per-entity ±2-cell search minimizing port-elevation mismatch with
  placed partners. Mismatch improved (spike 397.6→330.1mm, −17%, 16 moved;
  dense −9%) — but the drawing regressed: spike gained a COLLINEAR_OVERLAP
  error + 2 label collisions (score 1127→2211), min/dense gained label
  collisions. Elevation greed pulls entities into shared corridors and
  breaks label packing; routing/labels are not in the objective, so the
  search trades a placement number for routing defects.
- Verdict: the cheap version of co-design doesn't co-design. Reverted
  fully (`REGRESS OK` on blessed baselines proves it); no code retained
  except `data.flowRank` (still the order key for real co-design later).
  Lesson for 5.3/5.5: any placement move must price corridors + labels,
  not just elevation.

## Phase 5.2 outcome (2026-09-06 — target already met, ships nothing)

- Target was tapReachTotal −40% vs plan-writing "today" (86). The tap-nozzle
  rule already took it 86→51 (−41%, 6 taps ≈ 8.5mm avg). Remainder is
  honest floor (bubble radius + keep-outs — parking closer trips
  PID-INS-004 "bubble sitting on the line"). No stacking change could move
  it without fighting the keep-outs that 5.1 just proved load-bearing.
  Closed without code.

## Phase 4 outcome (2026-09-06 — debug mode live, one real bug fixed)

- Mechanism: `pidDebugGate(data)` in `pid-renderer.js` (null unless
  `globalThis.PID_DEBUG`; node: `harness2.mjs --debug`, browser:
  `window.PID_DEBUG=true`). Five gates, failures as `PID-DBG-*` errors
  (LOUD: harness exit 1, regress red, guilty stage + pipe + coords named),
  never throw. Gate 1 post-routeOne stubs; gate 2 post-A\* (pinned
  endpoints for all, no-diagonal for process — signals' transient
  fractional-bubble diagonals are the guarantee's sanctioned repair, gate 4
  re-verifies); gate 3 lead endpoints byte-identical through
  cleanPoly/shift/guarantee/slide (snapshot re-taken after each accepted
  rip-up; force-nozzle is the authorized rewriter — checked before it,
  re-snapped after); gate 4 tips not pushed off-sheet by routing (port-exact
  edge tips are placement's, validator reports PID-SHT-001) + orthogonal;
  gate 5 every real crossing has a break with ≥2mm shoulders.
- Real find: `routeOne` stripped `_lead` tags before A\* (`{x,y}` copy),
  deadening every downstream lead guard — grid-slide ate nozzle stubs by
  1–2mm on ~17 pipes. One-line fix (preserve the tag); slide additionally
  skips `_lead` runs. Honest price: stubs stand exact, spike crossings
  27→32 (all gapped, `[10]=0`), `[8]` 0→2 micro-nubs, score 1061→1127.
- Exit gate met: `regress.mjs` runs `--debug` per sheet (`checkDebug`,
  zero `PID-DBG-*` tolerated); baselines re-blessed (spike 1127/budget
   1014, min 49/44, dense 287/258); `REGRESS OK` with candidates gate green.

## Tap-nozzle rule (2026-09-06 — one tap slot per nozzle, taps name ports)

- Taps bypassed port cardinality (named host entities, never nozzles), so no
  rule could fire on NZ-D101-1 carrying process + PT-101 + LT-102. Strict
  1-connection-per-nozzle is unsatisfiable (pumps have 2 ports, both consumed;
  C-101 zero free) — enforced version: taps must name their nozzle
  (`tap TAG -> HOST.port`, bare = `TAP_PORT` error except to junctions), each
  nozzle takes ≤1 tap alongside its process slot (second tap = `TAP_CAPACITY`
  error, verified by negative test). Existing `PORT_CAPACITY` untouched.
- Taps land on their own nozzle's pipe via `collide.tapHostGeom` (score and
  validator use the same lookup — previously all three used first-touch,
  which stranded taps on neighbor runs). `toSource` emits tap ports (also
  fixes taps re-parsing as process pipes — latent round-trip bug).
- Side effects, all honest: tapReachTotal 86→51 (correct nearer landings);
  tap drops jog around the host body edge (landing-side, lane-aware, dipped
  under when landing opposite) instead of through it; instrument tap reserves
  the bubble-bottom side so signals take another (kills tap/signal corridor
  sharing). Canonicals re-ported (PT-101→inlet, LT-102→outlet, etc. —
  review assignments); spike budget held 963, dense 223→226.
- Follow-up: TT-101→R-101.bottom named a glyph port with no nozzle object
  (fallback landing dangled mid-air) — declared NZ-R101-B thermowell nozzle
  instead of weakening the rule. Edge-jog now consults full lane occupancy
  (a shared x=582 with D-101→P-102 slipped past the taps-only check).
