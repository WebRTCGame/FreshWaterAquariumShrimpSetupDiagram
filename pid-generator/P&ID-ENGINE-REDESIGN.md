# P&ID Engine Redesign — forward plan

**Status:** active. Supersedes the forward-looking parts of `P&ID-AUTO-QUALITY-PLAN.md`
(which is retained as an append-only historical record — see "Why the old plan is
not being rewritten" at the end).

**Evidence base:** `P&ID-VISUAL-QUALITY.md` §9.26 (D1–D7) is the architectural
assessment this plan answers. Every item below traces to a numbered defect or a
measured negative result. Nothing here is speculative.

**Rule for this document:** an item ships when it is *measured*, and a reverted
attempt gets an obituary in `P&ID-VISUAL-QUALITY.md`, not a deletion. Two of the
three score terms I tried this session made output *worse*; that fact is the
reason for Stage 0.

---

## The shape of the problem, in one paragraph

The engine's components are good and its architecture is not. Every defect found
this session was a **sequencing or grounding** problem — an inverted normal, a
wrong tier, an orphaned anchor, an assumption about which pipeline stage has
populated its data — rather than an algorithmic one. Layout is a sequence of
mutating passes whose required *order* is undocumented and whose output is scored
only by fully routing it. There is no declared constraint set, and no ground truth
for "better". Fixing that foundation is worth more than any further heuristic
tuning, and it is cheaper than the tuning has been.

---

## Stage 0 — Visual regression baseline  ·  *do this first*

**Why first:** every judgement call in this session was made by rendering a PNG and
looking at it — about six times, and twice I shipped something I then reverted.
That habit is the bottleneck on all remaining work and the reason two score terms
had to be reverted on aesthetic grounds. "Does this look better" must become a
measurement before anything risky is attempted.

**Do:**
- Render each canonical sheet (`spike`, `dense`, `min`, `split`) **and** the demo
  to PNG at a fixed size and a fixed `--user-data-dir` (Chrome caches `file://`
  scripts by URL; the `?v=` query strings in the pages permit stale renders).
- Store baselines in `regress/`.
- Diff with three independent measures, because each catches what the others miss:
  1. **perceptual pixel diff** at a stated threshold,
  2. **ink coverage** (total drawn length / sheet area) — catches a sheet going
     empty or a linework explosion,
  3. **entity + label box overlay** — catches collisions and crowding that a pixel
     diff at print scale will not resolve.
- Gate in `regress.mjs` as a **reporting** check first (prints, does not fail) for
  one week, then promote to failing.

**Definition of done:** `node regress.mjs --visual` prints a per-sheet verdict and a
diff image path for any sheet that moved.

**Explicit non-goal:** do not attempt perceptual tuning of the threshold to make
current output "pass". Set it, then let it tell the truth.

**Cost:** small. **Payoff:** makes every later stage safe to attempt.

---

## Stage 1 — Split `parse` into *resolve* then *layout*  ·  *prerequisite for all*

**Answers D1.** Layout currently runs before topology resolution and before
nozzles exist (`autoLayout` at pid-parser.js:465 vs `resolveTopology` at 501 and
`materializeNozzles` at 502). Anything in layout needing a resolved port, a nozzle
tip or a validated tap reads `undefined` — which is why the line-tap elevation fix
was a silent no-op on its first attempt (§9.22).

**Do:**
- Move port resolution, topology validation, nozzle materialisation and nozzle
  geometry to **before** `autoLayout`.
- Make the resolved result **immutable**: `resolveTopology` should return a frozen
  resolved graph that `autoLayout` consumes, not mutate `data` in place. Today
  `resolveNozzlePositions` *replaces* `p._from` wholesale, discarding the
  `.junction` and `.signal` fields that earlier code set — a latent bug.
- Collapse the double `resolveOverlaps` + grid-align + `resolveOverlaps` sandwich
  into a single snap-then-resolve, and make "final positions are grid-aligned" a
  checked invariant rather than an aspiration (its own comment admits it can be
  violated).
- Keep `data.nozzles` / `data.pipes` shapes byte-compatible so `regress` baselines
  stay meaningful.

**Definition of done:** no code reachable from `autoLayout` reads a field that is
written after line 465 of pid-parser.js. A grep-level assertion in `regress.mjs`
would enforce it.

**Cost:** mechanical, medium. **Payoff:** makes the entire "silent dead code"
failure mode structurally impossible, and promotes taps/signals/nozzles to
first-class citizens *for layout* — which is what the tap-elevation work needed
and could not have.

---

## Stage 2 — Declare the layout constraints; stop adding passes  ·  *the big one*

**Answers D2.** Today, constraints are expressed as *pass order*. Every layout
defect in the findings doc has the shape "pass X moved something pass Y had
already placed", and every fix was additive.

**Do:**
- Introduce a `CONSTRAINTS` registry with an explicit kind, so the four different
  statements stop being indistinguishable:
  - **hard** — on-sheet, no symbol overlap, port alignment, terminal on a sheet
    edge, entity inside the drawable zone,
  - **soft** — weighted preferences: short runs, few crossings, bubbles near their
    host, sheet utilisation, tag above type.
- Solve, rather than patch: layered-graph ordering (the barycentre sweep already
  present) followed by **coordinate assignment** (the median method added in §9.15
  is one rung of this), then a relaxation pass for soft constraints.
- Migrate one existing pass at a time — start with `passTerminals` and
  `passDecrowd`, which are already constraint-shaped — and delete the pass as each
  constraint lands.
- **A new requirement must become a new row, not a new pass.** That is the test of
  whether this stage succeeded.

**Definition of done:** the renderer no longer searches pass order; `PID_LAYOUT_ORDERS`
and the `layoutOrder` DSL plumbing are deleted; adding "terminals go on the sheet
edge" required no new pass.

**Cost:** high. **Payoff:** the three remaining order-dependence bugs disappear by
construction, and satisfiability becomes reason-able about for the first time.

---

## Stage 3 — Decouple layout from evaluation  ·  *unlocks real search*

**Answers D4.** Measured: 1 render = 462 ms (spike) / 97 ms (demo); 6-candidate
search = 1802 ms / 355 ms. `autoLayout` is ~0.03 ms, so **~99 % of the search cost
is routing and validation.** A layout cannot be scored without being fully routed.

**Do:**
- Add a **layout-only fitness** that needs no routing: bounding extent, symbol
  overlap count, rank-crossing estimate (from the ordered graph, before
  coordinates), bubble-to-host distance. Must run in low single-digit ms.
- Search on the cheap fitness; **route only the finalists** (top 2–3).
- Expected: 6 × 300 ms → 6 × ~1 ms + 3 × 300 ms, i.e. roughly 3× faster *and*
  orders of magnitude more candidates affordable.
- Only then promote `minSep` from a two-point lottery to a real search dimension,
  and let it be continuous.

**Definition of done:** the placement search evaluates > 50 candidates in less wall
time than today's 6, and the winning layout is no worse on the Stage 0 visual gate.

**Cost:** medium. **Payoff:** this is the ceiling on layout quality. Nothing above
it is reachable without this.

---

## Stage 4 — One objective, validated against ground truth  ·  *only after Stage 0*

**Answers D3.** Three score terms were tried this session and **two made the output
worse** (§9.20 sheet utilisation, §9.23 give-up weight). Both were reverted. The
common cause: the search exploits the holes in whatever function it is given, and
there was no ground truth to catch it.

**Do:**
- With Stage 0 in place, **fit** the objective rather than guess it: across the
  sheet corpus, regress candidate score terms against the visual-diff and ink
  metrics. Drop terms that do not predict; keep those that do.
- Report the **vector**, not just `total`, so "better" is legible to a human
  reading a result. A single scalar is what made every one of these calls opaque.
- Rule going forward: **no new score term before Stages 0 and 4 exist.** If a term
  cannot be validated against a visual baseline, it does not ship.
- Keep the give-up count *reported but unscored* until a visual baseline can tell
  a benign sibling-stub overlap from a line through a symbol.

**Definition of done:** every live weight has a measured correlation with a Stage 0
metric, recorded in the findings doc.

**Cost:** medium. **Payoff:** the objective stops being the thing that has to be
second-guessed after every change.

---

## Stage 5 — Loops as the primary model  ·  *the domain fix*

**Answers D5.** A P&ID is a document about instrument loops. This engine thinks in
pipes and instruments; `data.loops` is built by the validator and consumed by
nothing. There is no loop callout and no loop ID on lines, so instrumentation is
bolted on and there are three separate routers with three obstacle models.

**Do:**
- Build `data.loops` properly and make it first-class: measurement point,
  transmitter, indication, control function, final element, signal edges.
- **Place a loop as a unit**, not bubbles independently. This subsumes the current
  two-tier heuristic, and it is the principled version of the "FIC-101 crammed into
  the manifold" fix that §9.21 fixed only symptomatically.
- Emit loop identification per ISA-5.1 §8: loop callout and loop ID on the line.
- Unify routing: one router, one obstacle field, for process lines, signals and
  taps. Taps currently have no router at all (shortest-of-N plus a lane dodge).
- Implement ISA-5.1 §8.4 letterforms — `glyphKeyOf` keys on `bubble` alone today, so
  an `FT` transmitter and an `FIC` controller get the same generic circle.

**Definition of done:** `data.loops` is consumed by a renderer; every tap and signal
is routed by the same code path as a process line.

**Cost:** high. **Payoff:** correct domain model; removes the bolted-on quality of
instrumentation permanently.

---

## Stage 6 — Cleanup  ·  *low value, do opportunistically*

- **Dead code** (all catalogued in §9.21): `crossesLine`, `overlapsCount`,
  `collide.indexOf`, `collide.nearby`, `collide.nozzleBox`, `PIDEngine.glyphKey`,
  `PIDEngine.anchorOffset`, the `TAPROOT_ON` bisect block, `isRealCrossing`'s `gap`
  parameter, `exclude.dest`, `data.flowRank` / `flowCycles`, `availH`, and two
  orphaned JSDoc blocks.
- **Comments that contradict their code** — treat as defects, not typos. Highest
  priority in this stage, because a lying comment stops the next reader looking:
  the Tier-C `fieldPartner` claim (`:396-399` vs `:464-480`), the nozzle-obstacle
  claim (`:845-847` vs `:856-861`), the `relax` identity claim (`:1004`),
  `snapPitch // 10mm` (`:1093`), `PID-GEO-003` "pass 3 skipped", the
  `removeFoldBacks` length claim, and the `crossesLine` invariant at `:1268-1270`.
- **Sheet constants** — the `864`/`559` literals are hardcoded in 8 places across 5
  live files. Extract once Stage 1 has settled the parse pipeline.
- **`ruleEnabled()` is dead**, so the 12 `enabled: false` rules are inert rather
  than filtered. Decide: wire it up or delete it.
- **`loop` modifier is silently clobbered** (pid-parser.js:370-371):
  `Object.assign(inst, validateTag(...))` overwrites the `loop` that
  `parseModifiers` just set, so `loop FC-101` becomes `101`.
- **Only the first tap per instrument is honoured** (`pipes.find(...)`) — a second
  `tap` line is silently dropped.
- **Taps are invisible to the whole geometry audit** — they are not in
  `geometries`, so `PID-GEO-001/002/003/005/006`, `PID-SHT-001` and
  `COLLINEAR_OVERLAP` structurally cannot see one.
- **`collideSegHitsRect` sub-0.5 mm false negatives** — fix the grid snap in
  Stage 1/2, then the assumption becomes true.
- **`crossesLine` never called** — the A\* smoothing pass can reintroduce a crossing
  the search deliberately avoided. Needs a cost argument, not a patch.

---

## Explicitly NOT doing

| Item | Why not |
|---|---|
| **Router rewrite** | The router works and is careful. Its audited problems are *localised* — one inverted normal, one silent fallback, one stale comment. A rewrite is high-risk and low-reward against Stages 0–3. |
| **Symbol-library conformance (D8)** | The library is fine. The engine's *use* of it is the issue, and that is Stage 5. |
| **Chasing `spike`'s crossings** | Already documented as structural (Phase 5.4). 21 crossings on a deliberately pathological sheet is not the win. |
| **Enlarging text or scale** | Locked and correct. 3.5 mm body text is 3.5 mm on paper. The apparent emptiness is a **D-sheet-for-small-content** mismatch, not a layout defect — see §9.20. |
| **Filling the sheet** | Measured and settled: `useW` is pinned at 65 % for *every* candidate. At 1 unit = 1 mm on fixed ARCH/ANSI D, the whitespace is correct. Answer is `[13] sparse sheet` reporting honestly, or split-the-sheet. |
| **More score terms before Stage 0** | Two of three attempted this session made output worse. See §9.20, §9.23. |
| **Rewriting `P&ID-AUTO-QUALITY-PLAN.md`** | See below. |

---

## Rewritten TODO list

Ordered by dependency, not by appeal. **Blocking** means later items are unsafe
or unaffordable without it.

### Foundation
- [x] **T0.1** Visual baseline: `visual-regress.mjs` — 3-way diff (pixels / ink coverage /
  16x16 block luma), fixed raster, fresh `--user-data-dir` per run. Verified
  deterministic (0.000% across 5 sheets) AND sensitive (a 14% `typeScale` bump →
  all 5 CHANGED, demo 1.337% pixels, worst block 93.21). Two harness bugs found and
  fixed on the way: it first wrote "current" over the baseline path, so every
  comparison was baseline-vs-itself and always reported `same`.
- [x] **T0.2** Runs in `regress.mjs` as **reporting only**; promote to failing once it
  has been clean for a week. Gate on `SYM-CLIPPED` / `SYM-PORT-DRIFT` /
  `SYM-PORT-PCT` only.
- [ ] **T1.1** ~~Move topology resolution before `autoLayout`~~ → **re-scoped to
  "split `resolveTopology`"** (see 9.33). It reads entity positions 31 times, so it
  cannot be reordered; it must be divided into a position-free assignment pass and a
  position-dependent geometry pass. ~300 lines. Do it after the visual gate has
  gated something real.
- [ ] **T1.2** Make the resolved graph immutable; stop `resolveNozzlePositions` discarding `.junction`/`.signal` *(Stage 1)*
- [ ] **T1.3** Collapse the `resolveOverlaps`/grid-align/`resolveOverlaps` sandwich; make grid-alignment a checked invariant *(Stage 1)*
- [ ] **T1.4** Add a grep-level assertion: nothing reachable from `autoLayout` reads a post-465 field *(Stage 1)* — **note:** several legitimate reads exist today because of the ordering; this assertion is only meaningful once T1.1 lands

### Structure
- [ ] **T2.1** `CONSTRAINTS` registry with hard/soft kinds *(Stage 2)*
- [ ] **T2.2** Migrate `passTerminals` → constraint; delete the pass *(Stage 2)*
- [ ] **T2.3** Migrate `passDecrowd` → constraint; delete the pass *(Stage 2)*
- [ ] **T2.6** **Add `layout.rowSpacing` to the layout search as a dimension.**
  Found 2026-09-26 (log 9.66). The search renders 3 orders x 2 sweeps and keeps the
  lowest score; adding row pitch makes it evaluate the height/length trade *per sheet*.

  - **Do NOT add a fill or composition score term.** Measured: the demo has a 93%-height
    candidate that the score rejects, and it is right to — that candidate costs **2.5x the
    line length and 4x the crossings**. A term strong enough to override that reproduces
    the reverted `util` term.
  - **`layout.colSpacing` is dead** (byte-identical 140->40mm). `pid-router.js:96-97` uses
    it only as a wrap threshold, and nothing in the corpus wraps, so it cannot move the
    layout. Either give it a real effect or delete it — a parameter advertised as
    "auto-layout column pitch" that does nothing invites tuning that achieves nothing.
  - `layout.minSep` is inert on the demo across 45-95mm (9.52, re-confirmed 9.66).
  - `layout.rowSpacing` **is** live, with a knee: 145->200 gives the demo +6% height for
    +10 score with line length *falling*; 145->260 gives +22% height for +53 score and
    +2 crossings; 340 is worse than 260 on everything. This is **not** the `ROW_SOLVED`
    experiment, which stretched the *solved* pitch and was catastrophic.

  Left deliberately un-hardcoded: where to sit on that curve is a drafting judgement, and
  picking a single value is re-blessing a baseline with extra steps. Let the search decide
  per sheet. **Add a candidate, not a score term.**
- [ ] **T2.4** Layered ordering + coordinate assignment solver; replace the in-place slot/median code *(Stage 2)*
- [ ] **T2.5** Delete `PID_LAYOUT_ORDERS`, `layoutOrder` DSL plumbing and the order-search dimension *(Stage 2)*

### Performance / search
- [ ] **T3.1** Layout-only fitness (extent, overlap, rank crossings, bubble-host distance) with no routing *(Stage 3)*
- [ ] **T3.2** Route only the finalists; measure the speedup *(Stage 3)*
- [ ] **T3.3** Promote `minSep` to a real, continuous search dimension *(Stage 3)*

### Objective
- [ ] **T4.1** Fit score weights against Stage 0 metrics across the corpus; drop non-predictive terms *(Stage 4)*
- [ ] **T4.2** Report the score **vector**, not just `total` *(Stage 4)*
- [ ] **T4.3** Revisit the give-up weight once a visual baseline can distinguish the two cases *(Stage 4)*

### Domain
- [ ] **T5.1** First-class `data.loops` (measurement → transmitter → indication → control → final element → edges) *(Stage 5)*
- [ ] **T5.2** Place a loop as a unit; retire the two-tier bubble heuristic *(Stage 5)*
- [ ] **T5.3** Loop callout + loop ID on lines, per ISA-5.1 §8 *(Stage 5)*
- [ ] **T5.4** One router, one obstacle field, for process + signal + tap *(Stage 5)*
- [ ] **T5.5** ISA-5.1 §8.4 letterforms; stop keying glyphs on `bubble` alone *(Stage 5)*

### Symbols  ·  *added 2026-09-25; full evidence in P&ID-VISUAL-QUALITY.md §9.28*

Tooling now in the repo: **`audit-symbols.mjs`** (201 symbols, 15 checks) and
**`fix-symbol-viewbox.mjs`** (dry-run by default, `--write` to apply).

**Finding census — 631 findings, but only ~25 are load-bearing.** Measured
consumption across the five live engine files: of the symbol metadata, only
`size`, `svg`, `ports[].{id,type,x,y}`, `ports[].cardinality` and
`ports[].flowDirection` are ever read. `anchor` is read *only* by
`PIDEngine.anchorOffset`, which has zero call sites.

| code | count | load-bearing? | meaning |
|---|---|---|---|
| `SYM-ASPECT` | 123 | **yes** (root cause) | non-square viewBox letterboxed into a square box |
| `SYM-LABELANCHOR` | 195 | no | `labelAnchor` outside its own viewBox |
| `SYM-ANCHOR` | 101 | no | `anchor` far from the content centre |
| `SYM-GRID-PORT` | 97 | no (craft) | port world offset not on the 5 mm grid |
| `SYM-EXTENTS` | 56 | no | `extents` disagrees with measured content |
| `SYM-BEHAVIOUR` | 35 | no | `behavior.minProcessPorts=2` with 0 ports defined |
| **`SYM-PORT-DRIFT`** | **20** | **YES** | port drawn 0.38–12.50 mm from where the engine puts it |
| `SYM-META-CONFLICT` | 4 | no (trap) | glyph `<metadata>` disagrees with bundle `ports` |
| `SYM-CLIPPED` | 0 | was **YES** | **FIXED this pass — see below** |
| `SYM-GRID-SIZE` | 0 | — | all `size` values are multiples of 5 mm ✔ |
| `SYM-PORT-PCT`, `SYM-DUP-PORT`, `SYM-NO-VIEWBOX`, `SYM-BAD-SIZE` | 0 | — | clean ✔ |

#### Done this pass
- [x] **T7.0** **SYM-CLIPPED fixed.** `isa-5.1/valves/relief-safety` had its spring
  23 units above `y=0`, outside `viewBox="0 0 100 116.67"`, with the `discharge`
  port at `(50,0)` — so **PSV-101 rendered as a bare triangle on the demo sheet**.
  Also fixed: `pip/fittings/elbow-90`, `pip/valves/relief-valve`,
  `y32.11-1961/furnaces/box-furnace`, `.../shell-and-tube-exchanger`,
  `.../tanks/spherical-tank`. ViewBox widened to contain content **and every port**,
  percentages recomputed so each port keeps its absolute position.
  **It improved the metrics** — spike 1051 → **995**, crossings 21 → **19**,
  ungapped 2 → **1** — and was verified visually (body + spring + stub now draw).
  Only `spike` needed a re-bless.
- [x] **T7.8** **Bbox extractor self-test added.** Two hand-counted assertions
  (`flow-nozzle` content `(15,20)-(145,60)`; `thermal-flowmeter` centre `(80,31)`).
  Verified it **fails** when the original point-as-box bug is deliberately
  reintroduced.
- [x] **T7.7** **Resolved — and the hazard was smaller than claimed.**
  `restore-bundle.mjs` looked dangerous (it regenerates the bundle wholesale) but
  was already dead: the marker it greps for is not in `pid-backup-tmp.js`, so it
  exits 1 with "no PID_SYMBOLS block found". The bundle is the source of truth. The
  script is now a documented retired stub, and `fix-symbol-viewbox.mjs` re-verifies
  its own invariant from the file it just wrote instead of comparing to a phantom
  second copy. **I over-stated this risk; see §9.28.**

#### Open — load-bearing (these change output)
- [x] **T7.1** `audit-symbols.mjs` runs in `regress.mjs` — **reporting only**.
  Promote to failing once it has been clean for a week. Gate on `SYM-CLIPPED`,
  `SYM-PORT-DRIFT` and `SYM-PORT-PCT` only; the dead-metadata codes must not
  become a build gate or nobody will ever get to zero.
- [ ] **T7.2** **Aspect-aware port mapping — ATTEMPTED AND REVERTED.** Implemented
  properly as `PIDEngine.portOffset` / `portDirXY` across all six open-coded sites,
  with the safety invariant verified (175/175 square-viewBox ports bit-identical).
  **It made every sheet worse**: total 1536 → 1667, and excluding the nozzle
  position spiked `spike` 995 → 1569. The naive formula is wrong about the ink but
  self-consistent with the grid alignment, cardinal snapping, collision margins and
  lead-in that were all calibrated against it. Visible cost of leaving it: 18 of 20
  are <2 mm on a 10–100 mm body, and the two 12.50 mm offenders appear on no sheet
  in the corpus. **Adopt in Stage 1/2 together with re-tuning those constants,
  never as an isolated change.** Full table and mechanism in §9.30.
- [ ] **T7.3** Decide the viewBox contract and write it into the symbol schema:
  either every viewBox is square, or the schema records the aspect and the port
  formula applies it. Right now it is neither, implicitly. **Coupled to T7.2** —
  deciding this without re-tuning the grid is what made the fix regress.

#### Open — dead metadata (no output effect, high trap value)
- [ ] **T7.4** Delete or wire up the 10 unread fields: `anchor`, `extents`,
  `labelAnchor`, `flowAxis`, `autoRotate`, `rotatable`, `behavior`, `standard`,
  `ports[].lead`, `ports[].allowedTypes`. 101 of the `anchor`s and 56 of the
  `extents` are measurably wrong, and `ports[].lead`=14 is decorative because the
  engine uses `routing.minPortRun`=14 regardless. Decide per field: fix it, or
  delete it — do not leave a field that looks authoritative and is not.
- [x] **T7.5** Duplicate connection source — **resolved.** Three symbols embed their
  own `<metadata><connections>` in the SVG with coordinates that disagree with the
  bundle's `ports`. `fix-symbol-viewbox.mjs` now syncs the embedded copy to the
  bundle, which is authoritative. `SYM-META-CONFLICT` 4 → 0 (631 → 627 findings).
- [ ] **T7.6** Put the 97 off-grid port offsets on the 5 mm drafting grid, or state
  explicitly that ports are grid-exempt. They come from small `size` values, not
  from the port percentages (a 10 mm valve at pct 90 lands 4.00 mm off centre).

#### Open — tooling integrity
- [ ] **T7.7** **Apply the SYM-CLIPPED fix to `pid-backup-tmp.js` as well, or retire
  `restore-bundle.mjs`.** That script regenerates `pid-symbols-bundle.js` wholesale
  and would silently revert all six symbol fixes. Highest-risk item in this block:
  a destructive one-shot script sitting next to the runtime source of truth.
- [ ] **T7.8** Add a **self-test for the bbox extractor** in `audit-symbols.mjs`.
  It produced confident false findings twice before it was caught: every number in
  a `<path d>` was fed in as both x and y (inventing 30 `SYM-CLIPPED` findings),
  and the point helper turned points into boxes. Lock in the two hand-checked
  regressions: `flow-nozzle` content is `(15,20)-(145,60)` and is **not** clipped;
  `thermal-flowmeter` content is `x 10..150, y 12..50`, centre `(80,31)`, and is
  **not** clipped. Also assert relative commands resolve — `q4 -6 8 0` is not the
  absolute point `(4,-6)`.
- [ ] **T7.9** Make symbol metadata *derived* — measure `extents` and `anchor` from
  the glyph instead of hand-authoring them. Hand-maintained derived data drifts,
  and §9.28 is entirely a catalogue of that drift. This is the item that would
  have prevented the whole class.

### Correctness defects (independent of the stages above; do any time)
- [ ] **T6.1** `PID-INS-004` cannot detect an over-long drop — add a "bubble too far from host" check *(answers the defect §9.21 could not see)*
- [x] **T6.2** Taps in the in-engine geometry audit — **done, with a correction.**
  The original claim ("invisible to the entire geometry audit") was **too broad**:
  `audit-svg.mjs` does match `data-pid-id="tap-` and has always fed taps into its
  crossing check, so regress's audit diffs saw them. The real gap was narrower —
  `validateGeometry` was only handed `geometries`, so `PID-GEO-001/005` and
  `PID-SHT-001` could not see taps. Now they do. Crossings, collinear overlap and
  lead-in are **deliberately excluded** to avoid double-reporting (§9.41). All three
  new checks proven non-vacuous by deliberately breaking each.
- [ ] ~~**T6.2b** Line-spec text not covered by the label audit~~ — **STRUCK, it was
  a phantom.** Reported from a zoomed raster, then disproved by recomputing both
  boxes with `pidTextBoxes`' own maths: 9.25 mm apart horizontally, 0.36 mm
  vertically, 0 collisions across all 50 text elements. I had estimated the tag's
  width by eye as ~60 mm when it is 43.6 mm. See §9.35, §9.38.
- [x] **T7.9** ISA valve ports were **not on the symbol's flow axis**. Ports are
  stored as a % of the viewBox, but the valve viewBox is `100 × 83.33`, not square,
  so the percentages were wrong by construction. Two errors: the `pct 50` group
  (gate/ball/globe/butterfly/needle/three-way) sat 0.83 mm high, and
  `control-valve`/`motor-operated-gate` used `pct 100` — the bowtie's *bottom edge*
  rather than its waist — sitting 1.67 mm low. With the engine's letterbox-blind
  `portOffset` on top, the control valve's pipe landed **2.5 mm below the axis and
  detached from the symbol entirely**; confirmed by eye, not just by arithmetic.
  Fixed via `fix-valve-ports.mjs` (16 ports, 8 symbols, re-verified from the written
  file, idempotent). **All four corpus scores went UP** (spike 995→1185, dense
  248→293, min 58→63, split 36→40) because the router was tuned against the wrong
  anchors. Kept: the geometry is right and the renders confirm it. See §9.44.
- [x] **T6.13** `PID-TXT-001` — runtime warning for annotation type outside the
  print-legibility band (`annotation.sizeMin` 2.6 / `sizeMax` 3.5). Hooks the single
  `fs()` choke point in `pid-renderer.js` so it is exhaustive without touching a
  call site, and scopes itself to annotation type by construction (title-block and
  legend text uses literal sizes, so it never enters `fs`). Reported **aggregated**,
  one warning per offending size, because at `typeScale 1.4` roughly 265 of 290 runs
  are over the band and per-run reporting would be noise. Proven non-vacuous in both
  directions: fires OVER at defaults, fires UNDER when `typeFloor` is lowered, and
  goes **silent** when the band is widened to fit — the row that shows it measures
  rather than always warning. Reports a standing finding on all five sheets. See
  §9.50.
- [ ] **T6.15** **Instrument tag type is too large for its bubble — decide the size.**
  Found 2026-09-26 (log 9.67). The tag is emitted at `y+0.5` / `y+5.5` with a ~4.5mm
  bubble, so the loop number is drawn **outside** the circle on every instrument. Tried
  and rejected, both measured: growing the bubble took spike 997 -> 1274; centring the
  block took spike 997 -> **1327 with labelCollisions 3 -> 14** (routing untouched —
  crossings 15, bends 82 — so it is purely annotation placement, and the dense sheet
  has no room for the corrected position).

  The cause is a **size** decision, not a geometry bug: `fs(3.2)` gives 4.5mm letters,
  too large for a standard ISA bubble (real ones are ~12mm with 2.5-3mm type). Fix belongs
  in the letters (~`fs(2.4)`), not the bubble. Belongs with **T6.14** — both are the same
  `typeScale` / `typeFloor` tension, and neither should be decided silently.

  `bubbleRadiusFor()` (chord-aware for circles, half-width for rects, 0.68/0.58 width
  factors for bold caps) is written and correct, and is the thing to call once the size
  is settled. Note the demo FIC is a `dcs` instrument, so the binding constraint is the
  **circle** (80% of viewBox), not the rect (90%) that a naive shape test picks.
- [ ] **T6.14** Decide the `annotation.typeScale` / `typeFloor` tension the new check
  exposes. `typeScale 1.4` inflates a 2.6mm line tag to 3.6mm, against a stated
  print target of 3.5mm body / 2.6mm tags and an explicit "do not inflate" rule. The
  floor additionally binds for every base ≤2.50mm, flattening three roles onto
  exactly 3.5mm so they are no longer individually distinguishable. This is a drafter's
  decision — screen legibility vs print fidelity — not a bug to fix unilaterally.
- [ ] **T3.4** **Junction fan-out — symptom confirmed, cause REFUTED, re-scoped.**
  Measured 2026-09-26 (log 9.62). **Still open, but no longer a T2 item.**

  *Symptom: confirmed, and rarer than this entry claimed.* Exactly **one** coincident
  run in the corpus — `V-102->J-1` / `J-1->PSV-101`, 8.3mm at x=470 — in fourteen
  fan-out pairs across five sheets. The numerous `0.00mm` readings are lines touching
  **at the junction node**, which is correct behaviour; only collinear overlap *away*
  from the node counts. Any future measurement here must exclude the shared node or it
  will report a correct drawing as broken.

  *Cause: this entry blamed `minPortRun` (14mm). That is refuted.* Swept 4/8/14/20/28mm,
  the coincidence is **8.3mm at every value** — byte-identical across a 7x range. A
  smooth parameter with a flat response is evidence of absence, not a null result.

  *Remedy: withdrawn.* "A new constraint in the T2 registry" is not justified by one
  occurrence whose cause the sweep rules out. That would be general infrastructure for a
  single data point, in the one item already flagged as too large to start blind.

  **Re-scoped to a narrow local question:** why does a line leaving J-1 take a departure
  direction that retraces the arriving corridor? The vertices `(470,250) (470,258)
  (470,260)` are collinear, and a shared-polyline cleaner should have collapsed them —
  so either a junction lead-in stub and the route agree on a bad direction, or the
  cleaner skips collinear points whose endpoints differ. One place to look.

  **The real blocker was a fixture gap, not the registry** — and it is now HALF closed:
  `regress/manifold.dsl` (9.63) is a three-branch manifold with two four-line junctions and a
  different size per branch, taking corpus fan-out pairs from 14 to 20 and giving `min` and
  `split` company. It also exercises the valve-size ambiguity guard on a real sheet for the
  first time. One junction-heavy sheet is enough to *see* the problem; designing a
  constraint against it still wants a few more. `min` and `split` have zero
  fan-out pairs, which is why they were not the sample.
- [ ] **T3.8** **A long title is clipped at the sheet edge, silently.** Found 2026-09-26
  while building the manifold fixture (9.63). A title of "Three-branch manifold with
  return header" overran the title block and was cut off by the sheet boundary: no
  truncation, no wrap, no warning, and the audit does not look at the title block. Any
  project with a long name hits this. Needs a width-aware fit (shrink, then ellipsis,
  then warn) — and the same treatment for the other title-block lines, which are
  currently literal font sizes with no measurement at all.

- [ ] **T3.9** **Does an explicit DSL description beat `TYPE_LABELS`?** Open question,
  not a finding. `equipment T-1 tank "Branch 1 vessel"` renders as `CONE ROOF TANK` in
  both the drawing and the tag list, so the type label wins over the authored
  description. That may well be intended (a consistent type vocabulary is a reasonable
  P&ID convention) but it is currently undocumented and unverified either way. Deciding
  it also decides what the equipment schedule is allowed to print.
- [x] **T3.5** **Under-allocation — FIXED by removing the `min(1, ·)` clamp (9.64).**
  The entry previously read "the fix is a richer demo, not a layout change", and it was
  **wrong** — I gave a user that answer and it was a bad one. Two errors: it treated a
  layout-capability gap as a user problem, and it generalised from one rejected mechanism
  (row-pitch stretching measured bad) to "don't try". Spreading *proportionally* does
  worsen the aspect mismatch; scaling *uniformly* does not touch aspect at all.

  The cause was one character of policy: `k = Math.min(1, ...)` meant **only overflow ever
  shrank**, so every small sheet was under-filled by construction and no layout work could
  change it. demo 72% x 35% -> 100% x 49%, dense 54% x 31% -> 100% x 58%, min 46% x 8%
  -> 100% x 18%.

  Uniform scale is a similarity transform: it cannot create a collision or a crossing, and
  the score moved by **0 on all six cases**. Nothing noticed because the objective is
  *structurally* blind to fill — `k` is applied at render time, after scoring. That, not a
  tuning failure, is why "spread it out" never worked in this project.

  Text is divided back to nominal millimetres (`denormaliseText`), since drawing scale and
  text height are independent in P&ID practice (ISO 5457). Sheet furniture is outside the
  scaled group and stays at 1:1. `spike` improved 997 -> 967; everything else unchanged.

  *Still true:* a 3.18:1 chain cannot fill the height of a 1.57:1 sheet. That is geometry,
  not a bug, and only more content or a re-shaped process fixes it. The height gap is not
  a defect; the *width* gap was, and is closed.
- [ ] **T7.10** Ports sit at the symbol **bounding-box edge**, not at the metal —
  60 of 259 are >1 mm clear of the drawn content (worst 9.75 mm). Needs a per-family
  lead-in-stub decision, not an auto-fix. Distinct from T7.9, which moved ports along
  y; this is the x direction. §9.44.
- [ ] **T7.11** `isa-5.1/valves/angle-valve` is **not checkable** by the flow-axis
  rule: a stub line reaching x=0 drags the symbol's x-extent to 0..66.67 and puts
  the derived midline at 33.33 instead of 50, and its two triangles disagree so the
  corroboration test rejects it. It looks genuinely wrong (inlet stub drawn at y=75,
  port says pct 50 = y 50) but needs a human. §9.44.
- [x] **T6.1** `PID-INS-004` could only see a bubble *sitting on* a line. Added
  `PID-INS-006` for the opposite and far more common failure — a tap that has to
  travel a long way *sideways* to reach its landing point. Metric took three
  attempts (host-centre → total run → lateral travel); the first two measured the
  wrong quantity and the second fired 3 false alarms. Corpus lateral travel is
  `0 x5, 11, 24 | 38, 55, 66, 81` mm, so `taps.maxLateral = 30` splits it with
  nothing marginal. 7 real findings (spike 4, demo 3). Worst: demo `LT-101` runs
  114.5 mm to reach a point 33.5 mm away. See §9.42.
- [ ] **T6.3** `collideSegHitsRect` sub-0.5 mm false negatives *(after T1.3)*
- [ ] **T6.4** `crossesLine` never called — A\* smoothing can reintroduce a crossing
- [x] **T6.5** `loop` modifier silently clobbered — **fixed.** `Object.assign(inst, validateTag(...))` ran AFTER `parseModifiers` and overwrote `inst.loop` with a value derived from the tag's digits. Verified `instrument LT-1 field "x" loop FC-101` gave `loop === "1"` before, `"FC-101"` after.
- [x] **T6.6** Only the first tap per instrument is honoured — **fixed at BOTH
  levels, and the first attempt silently did nothing.** The geometry pre-pass used
  `pipes.find(...)`; fixing that changed no output because the *emitter* separately
  used `tapGeos.find(t => t.tag === inst.tag)`. Both now iterate, and
  `data-pid-id` is disambiguated (`tap-TAG-2`) so two taps on one tag stay
  separately addressable. Proven with `regress/_twotap.dsl`: **1 leader → 2**,
  0 errors. **Zero warnings** were emitted before the fix — the drop was entirely
  silent. (Fixture note: a nozzle takes one connection, so tapping the same nozzle
  twice is *correctly* refused; a `.line` tap is the pattern that doesn't consume
  the nozzle slot. Two of my three fixture drafts were wrong, not the engine.)
- [ ] **T6.7** Tier C `fieldPartner` structurally unreachable — fix or delete the branch *and the comment*
- [ ] **T6.8** Grid snap manufactures exactly-0.5 mm diagonals; the orthogonality repair is skipped on the `directCost < 1` path

### Cleanup
- [ ] **T6.9** Delete the 13 catalogued dead symbols
- [ ] **T6.10** Fix the 7 comments that contradict their code — **highest priority in cleanup**
- [ ] **T6.11** Extract the `864`/`559` sheet constants (8 sites, 5 files) — after T1
- [x] **T6.12** `ruleEnabled()` — **deleted, not wired up.** It was never called, and
  all 12 `enabled: false` rules are referenced **zero** times in
  validator/renderer/router/parser, so the flag could not have filtered anything —
  a switch that does nothing, which is worse than no switch because it reads as
  working. The block is now labelled *specified, not implemented*. A filter that
  silently passes everything would hide that state; a caller that cannot find the
  function gets a loud error instead.

---

### Deferred by request, 2026-09-26

One item raised in review is still **not** done (T3.4, below). T3.6, T7.12 and T7.13
have since been closed — see their entries for what they turned out to be. Recorded here so they are not lost,
each with the open question that has to be answered before implementation — not just a
title. T3.6 is now closed and its six open questions are answered in place.

- [x] **T7.13** **Pipe port binding — ALREADY IMPLEMENTED; the finding was wrong.**
  Closed 2026-09-26 (log 9.59) with no code change. The premise was false: pipes DO
  record their port binding. A `fromPort`/`toPort` when the DSL states it, and
  otherwise the router resolves it into `p._from` / `p._to`, each carrying `conn.id`,
  `conn.role`, `direction` and the resolved `nozzle` id. All 16 valve ends on the demo
  resolve to a port name. The probe that filed this read `Object.keys(pipe)` on the
  **pre-resolution** record and saw no port field.

  The gap that is real, and it is a nastier one: **every nozzle carrying a size has an
  EMPTY `portId`.** `NZ-TK-O` is TK-101's 4" outlet and its `portName` is `''`. The
  obvious lookup, `ownerId|portId`, therefore matches nothing and reports "this model
  has no size data" — it does. Only the router-resolved `nozzle` id finds it.
  *Consequence for the validator suggestion below:* the proposed benefit of checking
  "declared rather than inferred bindings" is **not available**, because for sized
  nozzles there is no declared binding to check against. Port capacity and lead-in can
  still be validated, but against the inferred binding, as now.
- [x] **T3.6** **Equipment tag list, one row across the top edge.** DONE 2026-09-26
  (`ff2d6cf`, log 9.58). All five open questions below were answered by the work
  itself, and the answers are worth keeping because the first design got three of
  them wrong:
  - *Which fields?* **None chosen - it is a clone.** The row reuses the equipment
    annotation's own two strings (bold underlined tag, grey `TYPE_LABELS[type]`) and
    the same `noTypeLabel` rule (`pid-renderer.js:1663-1666`). A parallel set of
    columns was the first attempt and it drifted: hardcoded column offsets let a long
    description run through the SERVICE column and out past the rule. Cloning cannot
    drift, because there is nothing to keep in sync.
  - *Per-sheet or whole-drawing?* **Per-sheet**, so the row never lists equipment
    that is not on the sheet.
  - *Does it consume the top margin?* **Yes, reserved not leftover.** `autoLayout`
    adds `equipList.height` to the centring target's `zy0`. Drawing into leftover
    space would put the list on the drawing once a sheet fills its sheet - the normal
    case, not an edge case.
  - *Wrap or truncate?* **Neither - one row, `+N MORE`.** All 11 spike items fit
    (x 28 -> 464 of an 834mm edge), so the `+N MORE` path is not exercised by the
    corpus and is verified by reading the emitted markup, not by a rendered case.
  - *Interaction with `legend`?* **None observed**, but untested: no corpus sheet sets
    both, and the legend is bottom-left while the row is top-left, so they do not
    currently contend for the same space.

  The load-bearing constraint: the reserved height is a **constant**, not a per-item
  pitch, because `fs` is a closure over `textScale` and `annotation.typeScale` inside
  the renderer. A router-computed row count therefore cannot know the drawn widths and
  can disagree with the rows actually drawn - producing precisely the overlap the
  reservation exists to prevent. A fixed one-row height cannot disagree. Type sizes
  are published off the one `fs()` choke point as `data.typeMm`, never recomputed.
- [x] **T7.12** **Valve size above the valve, derived from the process line.** DONE
  2026-09-26 (log 9.59, `annotation.valveSize`). The ambiguity recorded here — what the
  size is when the two ends differ — was answered by the isoconfig `End1`/`End2` idiom:
  the property belongs to the **pair** of ends, so differing ends are reported as a
  pair (`4"x3`, a reducer) rather than resolved by picking a side.

  The rule, both halves earned by measurement:
  - walk each end through junctions to the **nearest** equipment carrying a sized
    nozzle. The junction network is looped, so an unbounded walk returned three
    sources and a nonsense `4"x3"` for a single end at hop 8; `valveSizeMaxHop` (4)
    bounds it.
  - print **nothing** when the nearest equipment is reached with two different sizes,
    or when neither end resolves. A guessed valve size is worse than no valve size.

  `v.sizeEvidence` keeps the hop count and source equipment on each valve so a wrong
  size is traceable to its nozzle. Yield 18/18 valves on spike/dense/min/split, 7/8 on
  the demo, and every printed size verified to exist on a real nozzle.

  Cost, by ablation: **+1 label collision on spike, zero on dense/min/split.**
  *Deviation:* it renders **below** the valve, not above as asked — it is a fourth row
  of the existing label stack, so it inherits the above/below flip and the collision
  test instead of reimplementing them. Flagged rather than quietly claimed as done.
- [ ] **T4.4** **The label-collision metric counts characters, so it cannot be
  case-sensitive.** Re-diagnosed 2026-09-26 (log 9.60); the original wording was wrong.
  It did NOT measure "the authored string" in any meaningful sense — it counts
  `str.length * fnt * 0.55`, and `toUpperCase()` does not change `.length` for ordinary
  text, so uppercasing before counting is a no-op. Measured: routing all four width
  estimators through an uppercasing helper moved **nothing** on any of the four corpus
  sheets, so that fix was reverted as dead code.

  The real defect: a flat 0.55em average advance **cannot express case**, because real
  uppercase is wider than mixed case at equal character count (`M W L C` vs `i l t`).
  *Fix worth doing:* stop estimating. The project already drives headless Chrome, so
  `getComputedTextLength()` on the live text node gives the true advance for the real
  font and the real string after the CSS transform — exact, case-correct, and it also
  retires the 0.55em and 1.15em guesses. A per-character table is the alternative and is
  worse, because the font is a CSS stack and the table would only be valid for the
  resolved face.
- [x] **T3.7** **Routing margins — NOT A DEFECT. Premise and remedy both wrong.**
  Closed 2026-09-26 (log 9.61), **no code change; the tree is byte-identical.**

  The filed measurement was a coordinate-space error. Content sits inside
  `<g transform="translate(20 22)">`, so the quoted x 830 and 820 were pre-margin
  values read as sheet values: 830−20 = 810 and 820−20 = 800, both inside the 816 limit.
  Fourth time this trap has produced a false claim here, third time from a number I had
  already written down.

  Measured against every bound, nothing escapes: 0 vertices outside SHEET on all five
  sheets, 0 outside the frame, 0 off-sheet, 0 in the title-block band. The only zone
  overshoots are 0.5mm (spike) and 8mm (`FEED-1 -> P-1` on min, a supply arriving from
  off-sheet, which *should* exceed the centring target — the zone is a soft target, not
  a hard bound).

  *The deliverable is the four-constant table, which is a documentation defect, not a
  code one — read it before touching margins again:*

  ```
  sheet edge                      0
  border frame (printed)         18
  SHEET / routing bound          26   <- A* bounds and PID-SHT-001 test this
  drawing zone (centring target) 48   <- layout.xMargin 60, halved
  ```

  The requested check (test the zone, or the frame) was rejected on a proof, not a
  measurement: outside-SHEET is a strict subset of outside-FRAME, so a frame check can
  never fire on geometry PID-SHT-001 has not already reported. It is redundant, not
  weaker. Built, caught, removed.

  **One loose end, recorded rather than resolved:** a probe reported 21 PID-SHT-001
  warnings on spike while a `__pidGeo` scan reported 0 escapes. It was running with the
  redundant check still in the tree. With shipped code 001 fires 0 times, deterministic
  over 5 runs. The 21 is **not reproducible and unexplained** — worth a look by whoever
  next touches the validator, since if a 002-like change *can* perturb 001 that is a
  coupling nobody intended.
## Sequenced recommendation

If only three things get done, do these:

1. **T0.1 / T0.2 — the visual baseline.** It is cheap, and it is the thing that
   makes every other risky change safe. Two of my three score experiments this
   session had to be reverted on aesthetic grounds *because there was no way to
   check*. It is also what unblocks **T7.2**, the one remaining symbol defect that
   changes output.
2. **T1.1–T1.4 — resolve before layout.** Mechanical, and it makes a whole class
   of silent bug structurally impossible. I hit two instances in one afternoon.
3. **T3.1 / T3.2 — decouple evaluation from layout.** ~99 % of search cost is
   routing; until that changes, the layout search is a six-ticket lottery and no
   amount of cleverness in Stages 2 or 5 will show up in the output.

Stages 2 and 5 are where the durable quality lives, but both are large, and
attempting either before Stage 0 means flying blind on exactly the judgement calls
that have been hardest this session.

**Two cheap items that are worth doing regardless of stage**, because both are
small and both protect work already done:

- **T7.7** — `restore-bundle.mjs` will silently revert the six symbol fixes.
- **T7.8** — the bbox self-test. That extractor produced two rounds of confident
  false findings, and nothing currently stops it doing so again.

## Completed since this plan was written

Kept here so the todo list is not read as "nothing has shipped":

| item | result |
|---|---|
| Terminal re-anchoring (`passTerminals`) | orphaned-stub bug fixed; demo 197 → 197 with 0 errors (§9.16) |
| Median coordinate assignment + search | spike 1276 → 1009, dense 1441 → 248 (§9.15, §9.17) |
| `passDecrowd` | label collisions 5 → 0 across all five sheets (§9.17) |
| Instrument signal port normals | inverted outward normal fixed; demo 203 → 184 (§9.21) |
| Instrument bubble label keep-out | FIC-101 off the valve tag stacks; dense 327 → 248 (§9.21) |
| A\* give-up reporting | was silent; now `score.lines.astarGiveups` (§9.23) |
| `SYM-CLIPPED` viewBox fix | PSV-101 spring now draws; spike 1051 → 995 (§9.28) |
| Sheet-use and give-up score terms | both tried, both **reverted** (§9.20, §9.23) |
| Aspect-aware port mapping | implemented across 6 sites, measured **worse**, reverted (§9.30) |
| `T6.5` `loop` clobbering | fixed; verified `"1"` → `"FC-101"` |
| `T6.6` second tap dropped | fixed at pre-pass **and** emitter; 1 leader → 2, proven by fixture |
| `T6.12` `ruleEnabled()` | deleted — never called, and all 12 disabled rules have no emitters |
| ISA valve ports off the flow axis | 26 ports moved onto the axis; `control-valve` was **2.5 mm low and fully detached** from its pipe |
| Dead `crossesLine` guard | wired in; smoothing was re-introducing crossings in **156/251 A\* calls** on `spike`; spike 1185 → 988 |
| 5 malformed arc sweep flags | Chrome was silently **dropping the remainder of each path**; `silencer` rendered as nothing |
| `PID-TXT-001` | new runtime warning for annotation type outside the print band; reports on all five sheets |
| Dead `view.grid` fallbacks | five sites said `\|\| 20` where the schema default is 5; one was the *snapping* pitch |
| Overlay coordinate space | overlays drew content-space coordinates into a sheet-space layer, offset by the whole margin |
| `__pidGeo` published per candidate | it held the **last candidate tried**, not the winner; `demo` geometry spanned y 72..542 against a drawing at y 222..372 |
| All annotation type uppercase | CSS presentation rule, so `toSource()` still round-trips the authored case |
| `T7.5` duplicate connection source | synced; `SYM-META-CONFLICT` 4 → 0 |
| `T7.8` bbox extractor self-test | added, and verified it *fails* on the original bug |
| `preview.mjs` | one-command visual review, incl. mm-coordinate zoom (§9.35) |

Session totals: regression sheets **3150 → 1337**, demo **335 → 199**, with
**0 errors and 0 label collisions on all five sheets**.

---

## Why the old plan is not being rewritten

`P&ID-AUTO-QUALITY-PLAN.md` is 733 lines of append-only history: phases 0–7, plus
a dozen dated outcome sections that include **obituaries for reverted attempts**
(Phase 5.1 and 5.3 are FAILED GATEs that were reverted; Phase 3 closed a thesis on
measured headroom; Phase 1 outcome records that nothing was deleted).

That record is the reason this project knows things like "row-pitch stretching is
worse on every metric" and "Phase 3's random-restart has ~1–2 % headroom and the
thesis is closed". Rewriting a plan to look tidy would delete the evidence that
stops the next person re-running those experiments. So: this document carries the
forward plan, and the old one stays as the record.
