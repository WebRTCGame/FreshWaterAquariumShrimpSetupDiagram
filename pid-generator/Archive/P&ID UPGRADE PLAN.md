# P&ID Upgrade Plan

Status: planning — no code changes yet.

## 1. Current State

- **Mermaid version: 11.16.1** (`lib/mermaid.min.js`, upgraded 2026-08-16 from 11.6.0; previous bundle kept at `lib/mermaid-11.6.0.min.js` as fallback). Bundled deps: KaTeX, dayjs 3.4.0.
- Upgrade notes (11.6.0 → 11.16.1):
  - Node group ids changed from `flowchart-<ID>-<N>` to `<diagramId>-flowchart-<ID>-<N>` — fixed in `componentForSvgId` (tooltips.js) and `findNodeElement` (sidebar.js), both now version-agnostic substring matches.
  - Focus centering needed a convergent measure/pan/measure loop: svg-pan-zoom applies CTM changes on the next animation frame, and 11.16+ defers the initial fit flush. All `verify.mjs` checks pass (tooltips 168 bindings, focus offX/offY = 0/0 at 6× zoom).
- The External Diagram API (`registerDiagram` / `registerExternalDiagrams`) is present in the 11.16.1 bundle.
- App pipeline: `diagram.js` (hand-written 744-line mermaid flowchart) → `mermaid.render()` → SVG → svg-pan-zoom + tooltips + sidebar.
- `build-data.ps1` currently **derives the component manifest from diagram.js** (diagram is source of truth; JSONs are generated). This is inverted for the P&ID future and must be addressed.
- Verification tooling: `verify.mjs` (Playwright + Firefox, `node verify.mjs`), `validate.js` (schema validation of component JSONs).

## 2. Goal

Replace (or augment) the flowchart with a custom **P&ID diagram type** that understands engineering entities — equipment, valves, instruments, lines, nozzles, signals — with a semantic model underneath the drawing, enabling validation and analysis beyond what a flowchart can express.

## 3. Target Architecture

```
                    ┌─────────────────┐
                    │    P&ID DSL     │  (authoring format)
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │   P&ID Parser   │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │ P&ID Data Model │  (semantic model)
                    └───────┬─┬───────┘
                            │ │
               ┌────────────┘ └────────────┐
               ↓                           ↓
       ┌───────────────┐           ┌───────────────┐
       │ Renderer      │           │ Validation    │
       │ (SVG output)  │           │ / Analysis    │
       └───────────────┘           └───────────────┘
```

DSL sketch (from discussion):

```
pidDiagram

equipment P-101 pump
equipment V-101 vessel
valve XV-101 ball
instrument PT-101 pressure

pipe N2-001 {
    V-101 -> XV-101 -> P-101
}

signal PT-101 -> PIC-101 -> XV-101
```

Renderer would map: `PUMP` → pump symbol, `BALL` → ball valve, `PT` → transmitter bubble, `DN50` → line annotation, arrows → flow direction, signal connections → dashed instrument lines.

## 4. Decision Axes (nothing forced by technical constraints — preferences only)

### Axis A: Authoring format / source of truth
- **Option 1: DSL text** — author diagrams in a `.pid` file. Good for code-like authoring, git diffing, generative workflows.
- **Option 2: JSON (existing)** — the 161 component JSONs + manifest are *already* a semantic model with schema validation. Good for tool-driven editing / future editor UI.
- **Risk to avoid:** two representations of the same diagram that can drift. Pick one as the single source of truth and derive everything else.
- Current state is inverted (diagram.js → manifest). Regardless of choice, the dependency must flip: model → rendering.

### Axis B: Renderer approach — ✅ RESOLVED: standalone generator (2026-08-16)
- The custom mermaid diagram type (option 1) was built and worked, but the spike proved the mermaid wrapper adds friction without value: we use none of mermaid's internals (no dagre/themes/sanitize), and its host ceremony cost us the `lazyLoad:false` gotcha, the undocumented `draw()` contract, the `securityLevel` iframe fight, a single-shared-db race, and version-upgrade risk.
- **Extracted to `P&IDGenerator.js`** — self-contained: DSL text → semantic model → validated, orthogonal SVG. Public API: `PIDGenerator.parse(source)` and `PIDGenerator.renderPid(source, containerId)`. No mermaid dependency on the P&ID path.
- Mermaid 11.16.1 stays in the app for the existing aquarium flowchart (tooltips/sidebar/node-id lookups depend on it).
- `pid.js` (mermaid registration) deleted; `pid-spike.html` uses the standalone generator.

### Axis C: Mermaid version upgrade — ✅ DONE (11.6.0 → 11.16.1, 2026-08-16)
- Regression risk was real: node id pattern changed (`flowchart-<ID>-<N>` → `<diagramId>-flowchart-<ID>-<N>`), initial-fit timing changed. Both fixed (see §1), `verify.mjs` all green.
- Old bundle kept at `lib/mermaid-11.6.0.min.js`; rollback = swap the script tag.
- If Axis B option 2 (own renderer) is chosen later, mermaid becomes less critical, but the upgrade stands regardless.

## 5. Analysis Features (model-level, no mermaid dependency)

The examples from the discussion live entirely in the model and can be built today on the JSONs by extending `validate.js`:

- `find equipment P-101` / `show line N2-001` — model queries
- Nozzle compatibility: `N2-001 terminates at P-101 but P-101 has no compatible suction nozzle`
- Instrument loop checks: `XV-101 has no associated instrument loop`, `PT-101 has no tag class`

This is the highest-value, lowest-risk piece and is independent of every other decision.

## 6. Sequencing

1. **Decide Axis A** (DSL vs JSON as source of truth) — independent of rendering ✅ DSL as source of truth for diagram structure; JSON component library keyed by id stays as-is
2. **Decide Axis B** (renderer approach) ✅ Custom mermaid diagram type was built and proven, then **extracted to standalone `P&IDGenerator.js`** (no mermaid dependency on the P&ID path; mermaid stays for the aquarium flowchart). API: `PIDGenerator.parse(source)` / `renderPid(source, containerId)` / `toSource(data)`.
3. **Spike — ✅ DONE (2026-08-16):** toy `pid` diagram type works offline via script tag (`pid.js` + `pid-spike.html`). Verified on Firefox/file://: detection, parse, render (pump circle + vessel rect + piped polyline + labels), error propagation. Key API discoveries for 11.16.1 script-tag builds:
   - `window.mermaid.registerExternalDiagrams([...], { lazyLoad: false })` is REQUIRED — the default lazy path expects a `loader` and silently never registers ("Diagram pid not found")
   - The registration object needs `loader: async () => ({ id, diagram })` even with lazyLoad:false
   - The renderer contract is **`draw(text, id, version, diagram)`** — not the docs' `render(id, text, css)` — and the return value is ignored: the renderer must populate the pre-created DOM `<svg id=...>` itself
   - `securityLevel: 'loose'` avoids the hidden-iframe render, letting draw() reach `document.getElementById(id)` directly (fine for an offline app)
   - Parser errors propagate as normal mermaid errors
4. **✅ DONE (2026-08-16) — generator feature set:**
   - DSL: equipment/valve/instrument/junction, named ports (`A -> B.port`), structured line specs (`line N2-001 size 2 service PG ...`), signal lines (electrical/pneumatic/hydraulic/capillary/digital), rotation, per-entity symbol/scale/stroke/tag overrides, relative placement, waypoints (`via`), bubble types (field/panel/dcs/computer/plc), view directives (`show`, `hide labels`, `stub <N>` lead-ins, `fit page`, `layout auto`)
   - **Auto layout**: BFS depth columns left-to-right by connection order, stacked rows, bottom-port entities (bottoms/drains) sort into lower rows, instruments placed above host entities (dcs above field), rel placements re-resolved after auto-assignment, explicit `at` always wins
   - **Drafting annotations**: double border frame, title block (title/project/sheet/rev), on-sheet legend, north arrow
   - **Model validation** (DEXPI-inspired): duplicate ids/tags/line-specs, unknown types, unknown endpoints, invalid named ports, unknown line specs, signal endpoints (instrument/auto-valve/rotating-equipment only), loop completeness for auto valves, isolated entities, ISA tag letter semantics (variable/function/modifier tables)
   - **Interactive**: entities wrapped in `data-pid-id` groups; spike page supports drag-to-move with live DSL source regeneration (`toSource`)
   - Symbol library: 202 SVGs with connection metadata (ports drive routing/nozzles)
5. **Remaining:** DEXPI XML export (model → DEXPI interop), app integration (pid view in index.html with tooltips/sidebar/focus), zone/area dividers, label leaders, richer validation (nozzle-size compatibility), multi-sheet match lines.
6. **✅ DONE (2026-08-16) — architectural hardening pass (adversarial review P0/P1):**
   - **Hard port enforcement (P0):** invalid connections no longer render. Port violations → `data.errors`, pipe skipped (no geometry). Explicit-but-wrong port, port already in use, all-ports-in-use → error. Automatic port inference only when unambiguous (direction from symbol center via port position, rotated); multi-port ambiguity → `ERROR: ambiguous connection — specify the port explicitly`. Demo now uses explicit ports on multi-port equipment (`T-101.outlet`, `R-101.left/right/top`, `D-101.inlet/outlet`, `P-102.suction/discharge`, `V-102.left/right`, `E-101.inlet/outlet`, `V-105.left/right`).
   - **No renderer-invented connections (P0):** the implicit "process tap for unconnected field instruments" was removed. Taps must be declared in the DSL: `tap FT-101 -> P-101`. Field instrument with no tap → error; DCS instrument with no signal → error. Tap lines land on the host's routed polyline (horizontal segment scan), not a raw midpoint.
   - **XML escaping (P0):** central `esc()` applied to every user/DSL-derived string entering SVG (tags, type labels, instrument letters/loop, line labels, title/project).
   - **Placement states (P1):** `at` marks `_fixed`; fixed entities are never moved by overlap resolution (reported as a warning instead) and never grid-snapped. Explicit coordinates are now authoritative.
   - **Severity model (P1):** `data.errors[]` / `warnings[]` / `info[]`; render returns all three; spike page shows `ERRORS:` before `WARNINGS:`. Topology violations are errors, style/quality are warnings.
   - **Schema version (P1):** `version 1` DSL directive → `data.schemaVersion`; `toSource` emits it.
   - **Round-trip check (P2):** spike page asserts `parse(toSource(render.data))` entity/pipe counts — currently `round-trip OK` (still lossy for rel-placement; positional `at` round-trips).
   - Result: demo renders `0 errors, 0 warnings, round-trip OK`, 40 connections, 6 explicit taps.
7. **✅ DONE (2026-08-16) — topology engine pass (reviewer v2; renderer is now a dumb consumer):**
   - **`resolveTopology(data)`** is the authoritative topology stage, called at end of parse (post-layout, pre-render). It assigns every pipe's endpoints to specific ports, enforces cardinality (per-port `cardinality`, default 1, read from symbol metadata), and refuses connections that violate it. The renderer only reads `p._from`/`p._to`; the old render-time `endpointPort` selection logic (including the "guess a connection" fallback) was deleted.
   - **Zero silent topology guessing:** a symbol with no connection metadata → hard `NO_PORT_DEFINITION` error, connection refused. (Previously it guessed a side port.)
   - **Junction topology:** `data.junctionGraph` records every junction's incident pipes/ends. Junctions are free-form nodes (no ports, unlimited connections); a junction with 0 connections → `ISOLATED_JUNCTION`, with exactly 1 → `DENDRITE_JUNCTION` error unless declared a `stub` (new DSL keyword for legitimate single-ended off-page/utility endpoints; demo uses `stub UTIL-1/UTIL-2/FLARE-1`). Signal endpoints attach at the actuator/top nozzle (never consuming a process port) and carry their `conn`.
   - **Taps are real topology:** `tap TAG -> ENTITY` is resolved at the model stage (`p._tap.host`), with source/host/not-an-instrument checks; the renderer draws the geometry from the validated tap object.
   - Verification: demo → `0 errors, 0 warnings, round-trip OK`; all 34 non-tap pipes resolved; junction graph `J-4:3, J-3:3` (tees) + 3 stubs; 11 signals attach at actuator/top without consuming process ports.
8. **✅ DONE (2026-08-16) — cost-modeled router (reviewer v2 deferred item; "random-looking" lines fixed):**
   - **Line-cost field:** `avoidObstacles` builds a grid penalty field from every already-routed polyline (on-line cells +150, adjacent corridor +25) and A* pays it per cell — crossing existing lines is expensive, running along them is heavily penalized, so lines form corridors and only cross when forced.
   - **Sequential routing:** pipes route one at a time, accumulating into the field; **process pipes route before signals** so the skeleton lays down first and signals weave around it.
   - **Deliberate L-routes:** if the direct orthogonal route is already clean (no component crossing, no paid line crossing), it is kept unchanged — a drafter's choice, not a search artifact. A* only engages when something actually blocks.
   - **Draft-grid snapping:** A* bend points snap to a 20 mm pitch (rejecting snaps that land in a component), collapsing 1-cell doglegs into right angles.
   - **Search bounds + guardrails:** A* is bounded to the drawing extent + margin (can't wander) with a `maxCells` cap; binary heap replaces the linear-scan open set.
   - **Bug fix:** the goal cell could be sealed by grid quantization (relaxed point free, its cell center inside a neighbor's box) → A* exhausted the grid; the goal cell is now exempt from the block test. Zero A* fallbacks remain.
   - Result: crossings **16 → 5** (proc-proc 4, proc-sig 1, sig-sig 0), bends **269 → 117** (~4/line), 0 A* failures, all 6 taps verified landing on pipe segments, 0 errors/warnings, round-trip OK. Visual verdict: "random" → "organized/clean drafting".
9. **✅ DONE (2026-08-16) — sheet containment (lines were running outside the border):**
   - **Root cause 1 — off-sheet entities:** the auto-layout placed instruments at `host.y − 110/200` (first-row hosts pushed them to y≈−140, DCS stacked higher) and rel placements (`above R-101` put PSV-101 at y≈−18). Fixed: instrument placement clamps into the sheet (flips below the host when too close to the top); rel placement flips to the opposite side when a side runs off an edge (`placeRelative`, shared by the parser and autoLayout's re-resolve); a final clamp pass after autoLayout keeps all entity centers inside the frame.
   - **Root cause 2 — router ignored the drawn border:** the router bounded the search to the viewBox (0–864 × 0–559) but the frame is inset (outer 18–846 × 18–541, inner 24–840 × 24–535), so lines sat between the frame and the edge. Fixed: router `SHEET` = inner drawing area; `relax()` clamps to it; the direct-route check treats out-of-sheet as blocked.
   - **Root cause 3 — A* perimeter tours:** with high line-crossing penalties the A* preferred absurd full-perimeter detours (e.g. a P-103 line hugging the right edge down to y=540) over crossing a couple of lines. Fixed: A* search is bounded to a **local box** around the direct route (±260 mm, clamped to the sheet) so it can't reach the perimeter; crossing penalty moderated (150→60, near 25→12).
   - **Root cause 4 — corrupted crossing-break emission:** pass 3 emitted stale `M`-jumps when a segment had multiple crossing breaks (phantom full-width segments like `M 840 540 L 160 540`), and dropped each path's first point. Rewritten to cut clean, ordered gaps per segment.
   - Verified (zero-tolerance DOM, authoritative over the unreliable vision model): no `.pid-line` point or symbol center outside the inner frame (24–840 × 24–535); no points in the margin band; 0 errors/warnings, 0 A* fails, round-trip OK, 6 taps landing on pipes.
10. **✅ DONE (2026-08-16) — drafting rules (parallel spacing, H-before-V, gap lead, orthogonality, line lengths):**
   - **Parallel-line separation:** the router's line-cost field marks the corridor 1 cell (10 mm) either side of every routed line (+22/cell), so lines keep ≥ ~10 mm clearance and don't run on top of each other. Soft penalty, not a hard minimum.
   - **Horizontal-before-vertical precedence:** orthogonalization prefers H-then-V unless the vertical span clearly dominates (>1.5×), so main runs are horizontal with vertical drops — the drafting norm.
   - **No bend right after a crossing gap:** a crossing gap is only cut when there is ≥ 8 mm of straight line on both sides (`MIN_RUN`), so lines never turn immediately at a gap.
   - **Orthogonality enforced (0/90/180/270°):** `validateGeometry()` scans every routed segment post-routing and warns on any diagonal. Root causes fixed: angled nozzle lead-ins now orthogonalize to the dominant axis in `resolveTopology`; `relax()` prefers axis-aligned free cells; the A* path pins exact start/goal; a final L-bend pass (`ortho`) guarantees no diagonal remains even from un-snapped endpoints. Tap lines to instruments are now emitted orthogonally (V-H-V) instead of diagonally.
   - **Min/max line lengths:** `validateGeometry()` flags a tap whose reach off the bubble is < 3 mm (instrument sitting on the line) and a signal run longer than 55% of the sheet width (instrument pair too far apart).
   - Result: zero non-orthogonal warnings, all 6 taps render, 0 errors/0 A* fails, round-trip OK; the only warnings now are the (correct) long-signal-run flags.
11. **✅ DONE (2026-08-16) — fitness meter + bounded refinement (scorer first, then the small loop):**
   - **`score` (the fitness meter):** every `renderPid` returns a grouped score — `routing {pp/ps/ss crossings, bends, length, nonOrtho}`, `sheet {offSheet}`, `annotations {labelCollisions}` (measured on real rendered text bboxes), `instruments {tapReachTotal, maxSignalLen}` — plus one weighted `total`. Shown in the spike status line. Crossings exclude junction/port meetings (shared endpoints are not crossings).
   - **Rip-up & re-route refinement:** after the one-shot routing, the worst 2 process lines (most crossings) are re-routed over the rest (3 iterations max, accept-only-if-better). Removes the DSL-order dependence of the greedy router.
   - **The scorer immediately caught a real layout bug:** FT-103/FIC-103 collided with R-101 (instrument placed above P-103 landed inside the reactor's box), stacking the pair, degenerating its signal (unrendered path), and producing an off-sheet point + 2 label collisions. Fixes: instrument partner lookup prefers the process/tap host over a signal partner; DCS stacks ABOVE its field partner (pair shifts down together when there's no room at the top); `freeSlot` now avoids equipment/valve boxes with a y-offset search; signal endpoints attach at the bubble edge *toward* the target; instrument clamp floor 32 (frame is at 24).
   - Result: score 2392 → **1835**, offSheet 1 → **0**, labelCollisions 2 → **0**, length 12060 → **10160 mm**, all 34 pipes rendered (was 33), 0 A* fails, round-trip OK. Only warnings: the legitimate long-signal-run flags.
12. **✅ DONE (2026-08-16) — three drafting rules (valve straight runs, valve adjacency, no bellies):**
   - **Rule 1 — straight run at valve ports in body orientation:** the port lead-in direction is now rotated with the entity before taking its dominant axis (a 90°-rotated valve gets vertical lead-ins — was a bug: it used symbol-space direction). Valve ports get a minimum straight run of 14 mm (≥ the valve body) in the port orientation before any bend is allowed.
   - **Rule 2 — valve adjacent to downstream equipment:** in autoLayout, a valve directly connected to equipment (its `from`-side partner) is placed at the equipment port's elevation, offset by nozzle + gap (≥ valve width ≈ 14 mm) + half-valve, so the process line runs straight out of the equipment into the valve (no jog). V-101 now sits at T-101's outlet elevation; FV-101/V-102/V-103 at their pumps'/vessels' port elevations.
   - **Rule 3 — no unnecessary bellies:** the A* pays +35/cell for every cell below the lower of the two port elevations (`dipFloor`), so lines stop dipping below the destination port and rising again unless forced. Residual dips are ≤16 mm (grid quantization) except one 56 mm forced detour around a congested equipment row.
   - Result: score 1835 → **1700**, total line length 10160 → **8803 mm** (−13%), labels 0, offSheet 0, 0 errors / 0 A* fails / round-trip OK; crossings slightly up (38→36 scored) as a trade-off of the shortened routes.
10. **Deferred (larger refactor — do not mix with feature work):** pipeline separation (Lexer/Parser/SemanticBuilder/Validator/Layout/Router/Renderer), port metadata enrichment in the library (`role`, `direction`, `connectionClass`, `required`; currently `id/x/y/type` + `cardinality` honored), trunk-line/channel routing for dense sheets, junction min-3 vs stub policy refinement, post-route geometry validation pass, lossless `toSource` (preserve rel placement), label placement engine (collision scoring/leaders), line-designation formatter decoupled from DSL, configurable ISA tag schemas, connection splitting (pipe → split → junction → branch).

### 7a. **✅ DONE (2026-08-22) — review-driven semantic foundation**

- Port metadata is enriched at runtime with role, direction, connection class, and cardinality derived from the symbol library.
- Required process ports are enforced for pumps/compressors and two-process-port valves; known inlet/outlet direction mistakes are errors.
- Optional `size`, `rating`, and `spec` entity metadata is checked against referenced line definitions; size/spec conflicts are errors.
- The parsed model now exposes separate process, signal, and tap graphs, logical line groups (`pipelines`), ISA-derived instrument loop identity, and process reachability analysis.
- V1 semantic declarations are supported for explicit control loops, valve normal/failure state, alarms, interlocks, and relief protection/discharge relationships. They validate before rendering and round-trip through `toSource`.
- Deliberately deferred: hierarchy, package internals, multi-sheet portals, process-condition calculations, reusable assembly expansion, and a separate machine-readable rules package. No current renderer or application feature consumes those abstractions.

## 7. Open Questions

- [ ] DSL text or JSON as source of truth? (Axis A)
- [ ] Must `mermaid.render()` be the entry point, or is a standalone render function acceptable? (Axis B)
- [ ] Is the existing 161-component aquarium diagram (a) a P&ID-like target to migrate, or (b) a separate diagram that stays a flowchart while the P&ID DSL is for future diagrams?
- [ ] Should the existing flowchart diagram.js itself be generated from the model as part of this work (Axis B option 3), or only new diagrams?

## 8. Visual Quality & Drafting Rules Plan (2026-08-22)

Status: planning. Current render (demo, score 5154): 57 crossings, 36 ungapped, 4 collinear overlaps, 125 bends, 0 line labels, one 581mm signal run, lopsided sheet. The engine is fine; the drafting intelligence is not. All items below target the demo reaching **0 errors / 0 overlaps / 0 ungapped crossings** as the gate.

### Phase 1 — Every crossing gets a gap break ✅ DONE (2026-08-22)
- **Problem:** 36/57 crossings got no gap because pass 3 refused to cut a gap within `MIN_RUN` of a bend — it skipped instead.
- **Fixes (all in `P&IDGenerator.js`):**
  1. **Sign bug fixed (root cause):** pass 3 and the line audit computed the gap position with *signed* distance from the segment start, so segments running right-to-left / bottom-to-top never got gaps cut. Absolute distance now.
  2. **Polyline cleanup (`cleanPoly`):** routed polylines carried sub-mm jitter points, collinear redundancy, and micro fold-backs from A* + fractional ports — these acted as fake "bends" and gave the shift pass zero slack. Cleanup drops duplicates, collinear same-direction points, and fold-backs, preserving orthogonality (perpendicular micro-stubs are kept — collapsing them creates diagonals).
  3. **Bend-shift pass (2.5):** crossings within `GAP+MIN_RUN` of a bend are fixed by translating the perpendicular segment (both corner points) along the containing segment's axis — a single-corner move diagonals the polyline. Iterates to convergence, recomputing crossings each iteration (shifts create new crossings).
  4. **Break-line selection (2.6):** a gap is cut on whichever of the two lines has ≥ `GAP+MIN_RUN` straight run on both sides (prefer the later/upper line) — crossings just below sheet-edge bends can't carry their own gap but the other line can.
  5. `MIN_RUN` harmonised to 8 (was 6 in pass 3 vs 8 in the audit).
- **Result:** ungapped **36 → 3** (audit gate); score 5154 → 2531 (bends 125 → 117); zero non-orthogonal segments. The 3 residuals are all crossings within 5–10mm of a **port** (J-3 junction approach, PSV-101 inlet, FIC-101 bubble) on both lines — gap placement can't fix them; they are Phase 2 (junction fan-out) and Phase 9 (instrument pairing) work.
- **Note:** gap convention is currently "gap on the later-drawn line"; the passing-line convention (gap on the crossing line, full line continues) is a candidate tweak with the gap size bump.

### Phase 2 — Zero collinear overlaps (dedicated pass) ✅ DONE (2026-08-22)
- Overlap repair pass iterates to fixed point (≤40 passes, skips unresolvable pairs instead of breaking); `hardCells` widened to a 1-cell buffer; collinear overlaps promoted to `data.errors` in the severity model; `createsCollinear` guard added in `shiftFor`. Gate green: `line audit: 0 collinear overlap(s)`.
- **Regression to watch:** the Phase 1 "0 ungapped" result has slipped to **1 ungapped crossing** (`C-101->E-101` & `FT-101->FIC-101` at [300,98]) — likely caused by the fixed-point overlap pass shifting lines. Needs a re-run of the gap pass after overlap repair.
- **Problem:** 4 overlaps (5–15mm shared corridors). Two causes: (a) multiple pipes leaving the same port share the same lead-in cells before splitting; (b) soft penalties let a late line run along an early one when crossing is marginally cheaper.
- **Fix:**
  1. **Shared lead-in rule:** pipes from the same port fan out — the first grid cell after the port is reserved per-pipe; a second pipe must exit on a distinct cell (junction lead-ins included).
  2. **Overlap repair pass (new):** after routing, find every collinear overlap (existing audit logic), rip up the later line, re-route it with the shared cells **hard-blocked**, iterate until 0. Failure to resolve → error, not warning.
- **Verify:** `line audit: N collinear overlap(s)` must be **0**; overlaps become errors in the severity model.

### Phase 3 — Minimum straight run at every port ✅ DONE (2026-08-22, revised)
- **Root cause of the old 25+ warnings:** `effStub = min(14, span/3)` created tiny 1–12mm stubs that then got flagged by the validator; short pipes physically cannot afford lead-in + bend.
- **Fix:** stub policy is now all-or-nothing — full `MIN_PORT_RUN` (14mm) when both spans ≥ 28mm ("roomy"), otherwise the stub is dropped entirely so the route is a pure L/straight whose single corner sits mid-span. Junction endpoints keep a stub even on tight spans (it separates fan-out corridors). The validator only flags *visible* bends within the run window on multi-bend routes (jogs < 5mm render straight; L/straight routes are exempt).
- **Result:** 25+ warnings → 5 honest flags (8.8–10mm) on genuinely tight spans.

### Phase 4 — Balanced layout ✅ DONE (2026-08-22, core heuristic)
- Two barycenter sweeps reorder each depth column by the average row index of its predecessors (standard layered-layout crossing reduction). Separate x/y margins: y-margin reserves an instrument band above row 0.

### Phase 5 — Control valve conventions ✅ DONE (2026-08-22)
- Controllers (`dcs/computer/plc`) anchor directly above their driven valve/equipment (ISA convention: actuator signal drops into the valve); field partner is the fallback when there is no driven entity. All four demo controller-placement warnings gone; controller→valve signals are short vertical drops.
- Requires the rel re-resolve pass running BEFORE instrument stacking (bubbles must anchor to final rel positions).

### Phase 9 — Instrument pairing ⚠ MOSTLY DONE (2026-08-22)
- Two-tier placement: field/panel bubbles stack tightly over their tap host or process partner (~24mm), controllers over their valve. Signal runs collapsed from 580mm+ to ≤336mm max segment.
- Remaining: one legitimate "very long run" (`PT-101 -> PIC-101`, 521mm) — the loop genuinely spans the sheet (sensor at D-101, final element V-105 at far left); needs column re-ordering or a relay bubble to shorten, not a placement tweak.

### Phase 10 — Routing engine correctness fixes ✅ DONE (2026-08-22)
Findings from the visual-quality push, in the order they were root-caused:

1. **A* ignored hard blocks entirely (long-standing bug):** `hardLines` cells were used by `relax()` and the direct-route check but were never passed into `aStar` — the search could walk straight through "hard-blocked" corridors, so overlap repair passes silently failed. Fixed: `ctx.hardCells` is now enforced inside `aStar`'s `blockedAt` (endpoint cells exempt for grid quantization), which automatically also covers smoothing shortcuts via `segClear`.
2. **Junction fan-out enforcement:** sibling lead-out stubs at a shared junction are hard-blocked for every later pipe — during initial routing *and* every re-route pass (refinement, Phase-2 overlap repair, pass 2.7). Fan-out dirs are now real corridors, not suggestions.
3. **Pass 2.7 — final repair:** after bend-shift, remaining ungapped crossings get one participant re-routed with the conflict cell hard-blocked (±buffer); overlaps get pairwise rip-up. Acceptance is pairwise ("this pair resolved"), not global, so chains of conflicts unwind instead of stalling.
4. **Bend-shift frame fix:** pass 2.5's clearance frame allowed y≥24 while the drawn sheet starts at 26 — shifts pushed a line 1mm off-sheet. FRAME now equals the router SHEET.
5. **Geometry-aware signal attachment (`resolveTopology`):** instrument bubbles attach signals on the side *facing* the other endpoint (stacked pairs connect bottom-to-top head-on) instead of blind fan-out that shared one corridor with every line in the area.
6. **Stub junctions on the port axis:** `stub FLARE-1` sits straight out along the connected nozzle's lead direction (+22mm) instead of a diagonal +20/+25 hop; explicit `at` positions win (`_fixed`).
7. **Instrument two-tier placement** replaces the old flat partner search (see Phase 5/9); field tier anchors to tap hosts, controller tier to driven valves; riser-dodge bias moves bubbles sideways off hosts whose top nozzles feed vertical pipes, toward the emptier side.

Demo after all of the above: **score 2374 → 1250, crossings 54 → 26, bends 84 → 61, warnings 35 → 6**, gates green: `errors 0 / overlaps 0 / ungapped 0 / offSheet 0 / signal-signal crossings 0`.

### Phase 6 — Anchor line labels to their polylines ✅ DONE (2026-08-22)
- Label engine rewritten: each pipe uses its longest straight segment as the label home; label sits on a short leader offset above/below the segment, rotated with the segment, no-leader fallback near the downstream port. Demo now renders 7 line labels (one per line id via `labelOnce`).
- **Problem:** 0 labels rendered on lines; the line-spec text (e.g. `2"PW-103-1E1H-A05-S0-T`) floats unanchored in whitespace.
- **Fix:** label placement engine (deferred item, promoted): each pipe gets its longest straight segment chosen as the label home; label sits on a short leader offset above/below the segment (never on the line), rotated with the segment; collision-scored against other labels/bubbles (scorer already measures `labelCollisions`); no leader possible → place near the downstream port.
- **Verify:** `labels 0` becomes N labels in the score line; 0 label collisions.

### Phase 7 — Turn on the furniture ✅ DONE (2026-08-22)
- Arrowhead marker `pid-arrow` scaled up (`markerWidth/Height` 3→6, process blue). Found + fixed a **pre-existing parser bug**: the `legend`/`north-arrow` rule used a non-capturing group for the keyword, so `legend on` always fell through to the `northArrow` branch with an undefined `on/off` → both flags stayed false. Now `^(legend|north-arrow)\s+(on|off)$` and the flags propagate correctly (`annotationsSvg` already renders legend/north arrow/title block gated on `view.fitPage`).
- Note: the demo currently has `legend on` / `north-arrow on` **disabled** (user request 2026-08-22) — the directives work, they are just not enabled in the spike source.
- **Fix:** demo enables `legend on`, `north-arrow on`; flow arrows get visible arrowheads (marker scaled up, process blue); tee/junction connection dots at every junction branch.
- **Verify:** legend + north arrow + title block present in the demo screenshot; arrowheads visible on all process pipes.

### Phase 8 — DSL: pipe branches and ordered branch sequences (new feature)
- **Problem:** no way to branch a new pipe off an existing pipe run; branching is only expressible as an explicit `junction` in the pipe chain. Designers need: *"take a branch off this pipe"* and *"these branches come off in this order"*.
- **DSL sketch (to refine):**
  ```
  branch N2-010 from N2-001          # tee off an existing line; N2-010 continues to its own endpoint(s)
  branch N2-011 from N2-001 order 2  # ordered along the host line: order 1 first, order 2 next, ...
  branch N2-012 from N2-010          # branch off a branch — sequence chains
  ```
- **Model:** `branch` compiles to a junction inserted on the host line's routed polyline (tap-like resolution at the model stage, `p._branch.host` + `order`); host line is **segmented** at the branch point (each segment keeps the line id, consistent with the pipe-segmentation rule in PID Rules.md §9). `order` positions branches along the host in sequence (first branch closest to the upstream end unless a waypoint/`at` overrides). Validation: branch target must be a process line, not a signal; branches on a branch form an ordered chain; a branch must connect onward to something (no dead-end branch unless `stub`).
- **Render:** junction dot + gap breaks at the branch point; ordered branches get evenly spaced junctions along the host segment.
- **Open questions:** how `order` interacts with `at`/waypoints on the host line; whether a branch can carry a different line spec (yes — its own `line` def); whether `branch` should accept a pipe-relative distance (`at 40%`).
- **Verify:** demo uses 2–3 branches including an ordered sequence; round-trip OK; 0 errors.

### Phase 9 — Instrument pairing (short signals) ⚠ PARTIAL (2026-08-22)
- `maxSignalLen` reduced from ~580mm to ~285mm (under the 300mm goal) for the common controller→valve pairs via the placement fixes in Phase 5/11 of the base plan.
- Not fully done: two "very long run" warnings persist on the demo — `LT-101→LIC-101` (494mm) and `PT-101→PIC-101` (514mm) — because their field/controller bubbles are not yet co-located over the tap host. Needs the full pairing-over-tap-host placement from the Phase 9 fix (left undone to protect the overlap gate).
- **Problem:** PT-101↔PIC-101 signal run 581mm; bubbles orphaned from their sensing points.
- **Fix:** extend instrument placement so the DCS/controller partner sits directly above its field partner **and** the pair is placed over the tap host when possible (field above tap point, DCS above field); placement already clamps/flips at sheet edges. Validation warning when a signal exceeds ~55% of sheet width (already warned — keep).
- **Verify:** max signal run in demo < ~300mm; 0 "very long run" warnings.
