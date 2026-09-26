# P&ID Visual Quality — Findings & Implementation Options

**Status:** review complete, nothing implemented. Decisions open.
**Date:** 2026-09-25
**Companion docs:** `P&ID-AUTO-QUALITY-PLAN.md` (defect quality), `PID Drafting Rules.md` (spec)

> **Revision 2026-09-25 — sheet standard confirmed.** Target print media is **ARCH D
> (24×36 in / 609.6×914.4 mm) or ANSI D (22×34 in / 558.8×863.6 mm)**. The sheet size is
> therefore **fixed by the deliverable, not a free variable** — which eliminates Option B
> from D1 and makes the reader's zoom/pan a first-class deliverable in its own right.
> Sections revised: **F5**, **F6**, **D1**, **D2**, **D4**, **D5**, plus new **D7**
> (viewer), **F9** (no viewer) and the **theme/layer system** in D4.
> Read those before acting on the original recommendations.

---

## 1. Summary

The layout/routing engine is in genuinely good shape. `regress` is green, the audit
reports 0 overlaps, 0 ungapped crossings, 0 label collisions on the canonical sheets,
and the repair passes are evidence-backed. **That work should be preserved.**

The drawings nonetheless do not look professional. The reason is structural, and it is
not a bug in any one pass:

> Every quality gate in this project measures **geometry defects**.
> None of them measure **whether the sheet looks like a drawing**.

`spike.dsl` scores 1276 with zero errors and audit counts of 0 in every severity tier
except the accepted advisories. It also renders as a small cluster of symbols marooned
in the top-left of an oversized sheet, with text too small to read. Both facts are true
simultaneously because nothing in `audit-svg.mjs`, `PID_RULES.weights`, or the phase
exit gates ever asks *"does this fill the sheet"* or *"is this legible."*

The single highest-value change is therefore not a new routing pass. It is **adding two
missing quality dimensions to the audit**, then letting the existing machinery respond
to them.

---

## 2. How this was verified

All findings below are machine-verified, not impressionistic.

| Method | Detail |
|---|---|
| Node harness | `node harness2.mjs <out.svg> --src=regress/<case>.dsl` — the split stack the browser runs |
| Rasterized view | headless Chrome, SVG scaled to fill viewport |
| **Real page load** | `pid-spike.html` loaded in headless Chrome at 1800×1150 — **the ground truth** |
| Ink-coverage scan | per-band pixel density over the rendered PNG, to locate voids objectively |
| SVG forensics | tag/attribute census, font-size histogram, stroke-color census, per-signal path length |

A note on method, because it changed the conclusion: an early screenshot harness of
mine failed to scale the SVG, which made the sheet look *worse* than it is and briefly
pointed at phantom "debug geometry." Loading the actual page disproved that — the
dashed grey boxes are real routed signal lines (F4), not leaked overlays. The
perception of "debug output" is itself a symptom worth noting.

---

## 3. Findings

### F1 — `fit page` is mathematically incapable of zooming in · **severity: critical**

`pid-renderer.js:242`

```js
const k = Math.min(1, Math.min((W - 2*pad)/cw, (H - 2*pad)/ch));
```

The `Math.min(1, …)` clamps scale to ≤ 1, so the only legal transform is *shrink on
overflow*. A drawing smaller than the sheet is **never enlarged**.

Consequence: the sheet is fixed at 864×559 mm (22×34 in) and most content is far
smaller, so every sheet is a small drawing adrift in white space. This is the dominant
cause of the unprofessional appearance and it is a one-line cause with sheet-wide
effect.

Provenance: `P&ID-AUTO-QUALITY-PLAN.md` → "Scale decision (2026-09-06 — singular,
forever)", which states `fit page` never zooms in (`k = min(1, …)`) because per-sheet
window stretching made identical symbols render at different sizes. **That diagnosis
was correct; the remedy was applied at the wrong level** (see §5, Decision D1).

### F2 — Layout stretches columns but not rows; bottom third always empty · **high**

`pid-router.js`

- Line 92: columns are stretched to fill available width — good.
- Line 75: rows use a **fixed** pitch, `ROW = 145`.
- Line 95: `availH` is computed — and then **never referenced again**. Dead code.

So content hugs the top margin and the lower third of every sheet is empty. Confirmed
on both `spike.dsl` and the `pid-spike.html` demo.

### F3 — `fit page` never centers · **medium**

`pid-renderer.js:243`

```js
wrap = `<g transform="translate(${pad - minX * k} ${pad - minY * k}) scale(${k})">`;
```

Pins content to the top-left origin. Even in the overflow case where scaling *does*
engage, the result is shoved into a corner rather than centered on the sheet.

### F4 — Signal lines route as full-sheet rectangle detours · **high**

Measured from rendered `spike.dsl` output:

| signal | length | points |
|---|---|---|
| PIC-101 → V-105 | **770 mm** | 21 |
| PT-101 → PIC-101 | **639 mm** | 8 |
| LT-102 → LIC-102 | **526 mm** | 7 |
| LT-101 → LIC-101 | 395 mm | 16 |

`PT-101 → PIC-101` literally traces `L 515 45 L 120 45 L 120 170 L 50 170` — a
rectangle framing empty space across the entire sheet. Three of eleven signals exceed
500 mm; `dense.dsl` adds a 700 mm case.

Visually these render as large dashed grey boxes around nothing, which is why the
output reads as a debug overlay rather than a drawing.

`PID-SIG-002` detects this and then declines to act ("consider moving the receiver").
The signal router has no term penalising a perimeter tour, so it takes one. Note the
score weight `sig: 0.2` is per-mm and cannot outvote a short path through congestion.

### F5 — Process lines are web blue, not drafting ink · **high** → *now D4 (theme system)*

> **Superseded.** Originally proposed as "recolour to near-black." Now reframed as the
> AutoCAD-style theme + layer system in D4, which subsumes it: print mode *is*
> near-black drafting ink, and CAD mode adds per-category legibility on top. The
> finding stands as motivation; the fix is larger and better than first proposed.

`pid-renderer.js:440` — `p.stroke || '#1E90FF'` (dodger blue).
`pid-renderer.js:1743` — junction dots, same blue, filled.

Stroke census on `spike.dsl`: 23 × `#1E90FF`, 11 × `#444`, 6 × `#0D47A1`, 15 × `#333`/`#111`.

Drafting convention is dark ink on white. A saturated blue process line reads as a
highlighted selection layer or a debug overlay — a large part of why the sheets don't
look professional, independent of any geometry issue. Under D4 this becomes a token
(`process`) rather than a literal.

### F6 — Text is small on screen; print size is correct · **high (screen) / resolved (print)**

> **Revised.** My original framing conflated two different questions. With a **fixed
> ARCH/ANSI D print target**, 3.5 mm body text and 2.6 mm line designations are
> **print-correct** and should not be inflated. The defect is not in the drawing — it is
> that **no viewer exists to read it at 1:1**. See D7 and F9.

Font-size histogram, 138 text elements on `spike.dsl`:

| size (mm) | count |
|---|---|
| 3.5 | 69 |
| 3.6 | 18 |
| 3.9 | 17 |
| 4.2 | 6 |
| 4.5 | 23 |
| 5 / 6 / 8 | 5 |

Line designations render at 2.6 mm. Against a 914 mm-wide ARCH D sheet these are
correct drafting practice — ISA/PIP text minimums are satisfied and the audit's
`[1] tiny text` check correctly passes.

The real problem: the demo is consumed **on a monitor**, where a 22×34 in sheet
displayed to fit a ~900 px viewport puts 3.5 mm text at roughly 3 px. Unreadable. In the
page screenshot the labels are smudges.

**So the fix is a viewer, not a bigger font.** F1 compounds the perception — the
drawing is both under-filled *and* viewed at ~30% scale, which is exactly the
combination that makes output look unfinished. Zoom/pan (D7) resolves legibility
without touching a single drawing coordinate, and without spending any of the
collision-budget that inflating text would cost on dense sheets.

### F7 — Legend and north arrow never render · **medium**

`view.legend` and `view.northArrow` both default `false`
(`pid-parser.js:208`). No DSL in the repo enables them — verified across all
`regress/*.dsl`. The 6-entry legend block already written at
`pid-renderer.js:1917-1941` is therefore **unreachable code**. A professional P&ID
carries a legend.

### F8 — The demo is the engine's worst case, not its best · **medium**

`pid-spike.html` ships 2 equipment / 8 valves / 4 instruments → score 335, sheet
~80% empty. Whatever the engine's ceiling is, the default first impression is its
sparsest output.

### F9 — No viewer: the sheet can only be seen shrunken · **high**

Identified in revision. The page embeds the SVG at its natural size
(`width="864" height="559"`, `pid-renderer.js:251-252`) with no zoom or pan. On a
~900 px viewport that is a ~30% view of a 22×34 in sheet, which is why the demo reads
as an unfinished fragment.

This is the **screen-side twin of F1/F6**: the drawing is correct for print, but the
only way anyone can see it is a postage-stamp view. Fixed by D7.

> Worth naming plainly: F1, F6 and F9 compound. Under-filled drawing + print-correct
> small text + no zoom = the "doesn't look professional" impression. **No single fix
> resolves that; D1a + D7 together do.**

---

## 4. The meta-problem (worth fixing before any individual item)

The plan's exit gates are all defect counts. A sheet can therefore be fully *green*
while being unusable. That is precisely how F1–F9 persisted: every check passed.

**Proposal — new audit dimensions**, implemented in `audit-svg.mjs` (which already
does pixel/geometry work on exported SVG and is the right home for this):

- **`[11] sheet utilisation`** — content bbox vs drawable area. Fail when fill ratio
  falls below a floor (suggest 55%). Directly catches F1/F2/F3.
- **`[13] sparse sheet`** — a *distinction* within low utilisation: distinguishes
  "layout left a void" (fixable, action 1) from "this sheet is genuinely too small for
  ARCH D" (engineering signal, consider a split per §111). Reporting both as one number
  would generate noise that gets ignored.

> **Rev 1 proposed a `[12] effective legibility` check here. Withdrawn.** Rev 1 assumed
> the text floor was mis-tuned; the fixed ARCH/ANSI D target established that 3.5 mm is
> print-correct. A legibility audit would have fired on correct output. Screen
> legibility is now D7's (viewer's) responsibility, where it belongs.

Both are cheap, deterministic, and node/browser-parity-safe. Once they exist, the
existing score/objective machinery can be made to optimise against them, and the
void/tiny-type class of defect can never silently return.

> This is the change with the best ratio of value to risk. Do it first, even though it
> changes no geometry — it is what makes the layout items verifiable rather than
> opinion-based.

---

## 5. Implementation options — decisions to make

### D1 — How should sheet fill be fixed? · **the central decision**

> **Revised.** Sheet media is fixed by the deliverable: **ARCH D 609.6×914.4 mm** or
> **ANSI D 558.8×863.6 mm**. The current default `864×559` is ANSI D rounded — so the
> sheet is *already* the right size. **The void is not a sizing error; it is a layout
> error.** That reframes the whole decision: we are not choosing a sheet, we are
> making the drawing occupy the sheet we were always given.
>
> **Option B (adaptive sheet selection) is withdrawn** — there is nothing to select.
> ISO A1 (594×841) doesn't even fit the ANSI D footprint, so an A-series ladder is
> irrelevant to this deliverable.

The real question splits into two independent parts:

#### D1a — Does the drawing scale up, or does the layout spread out?

**Option A — scale content up to fill (remove the `Math.min(1, …)` clamp)**
- **Pro:** smallest change; `fit page` means what it says.
- **Con:** symbol size then varies per sheet — a 6-entity sheet and a 40-pipe sheet
  both print on ARCH D, so the same valve prints at two different sizes. This is
  precisely what the 2026-09-06 decision correctly identified. On a *fixed* print
  medium this is worse than before, not better, because the inconsistency is now
  visible between sheets of the same project.

**Option C — spread the layout to fill the fixed sheet (recommended)**
- Fix F2 (use the already-computed `availH` for row pitch) and center the block (F3).
- **Pro:** **1 unit = 1 mm stays absolutely true.** Every symbol is the same physical
  size on every sheet, which is what makes a multi-sheet ARCH D set consistent —
  the actual drafting requirement. No scale policy change at all.
- **Con:** only helps sheets with enough content to spread. A genuinely small drawing
  (the 2-equipment demo) still won't fill ARCH D — and *shouldn't*: real practice is
  that a small P&ID on a large sheet is legitimate, it just shouldn't be a ragged
  top-left cluster.

**Recommendation: C.** Not because A is wrong in the abstract, but because the fixed
print medium makes cross-sheet symbol consistency non-negotiable, and C is the only
option that delivers it. The clamp stays. This reverses my original recommendation of
B — correctly, since B rested on a premise you've now ruled out.

#### D1b — What about sheets that genuinely under-fill?

If C is done and a sheet is still 40% empty, the remaining causes are *content*, not
scale. Per `PID Drafting Rules.md` §111 the sanctioned responses are, in order:
re-layout → split → change scale → report an error. Practical proposals:
- **Density floor:** if fill ratio < ~55% after C, emit a new audit warning
  (`[13] sparse sheet`) naming the sheet and suggesting a split. Honest, actionable,
  and converts a silent cosmetic flaw into a visible engineering prompt ("this sheet
  should probably be two sheets" — which is frequently true).
- **Do not** pad with whitespace-filling geometry (see §7 non-goals).
- Note this interacts with the plan's L3 finding: 21 crossings on a 40-pipe sheet was
  already diagnosed as a *splitting* problem, not a routing problem. Sparse-sheet
  detection is the same insight pointed the other way.

**Real scale goal (do not get this wrong):** on ARCH D, 1 unit = 1 mm means the SVG is
909 units wide. A 1080p monitor at typical viewing distance shows ~1400 px ≈ 370 mm.
**At 100% zoom, ARCH D is ~2.5 screens wide.** No monitor can show it at 1:1. So the
default view must be "fit" (whole sheet, ~30%), and zoom exists precisely to *stop*
being able to see everything at once. That is the correct, intended behaviour of a
sheet viewer — not a defect to be engineered away.

`viewBox` is already emitted correctly (`pid-renderer.js:247`), and
`pid-components.html:384` already parses a `viewBox` out of an SVG. A `viewBox`-based
zoom needs **no coordinate maths at all** — just rewrite four numbers. Cheap.

> **Refactor hazard found while verifying item 7.** The `864`/`559` defaults are
> **hardcoded in 8 places across 5 live files** — `pid-parser.js` (5×),
> `pid-renderer.js`, `pid-router.js` (5×), `pid-validator.js`, plus
> `sheetBounds()` at `pid-parser.js:98`. Changing the sheet size means finding all of
> them, and a missed one silently reverts to 864×559. **Introduce named constants
> (`SHEET.ANSI_D`, `SHEET.ARCH_D`) in `pid-rules.js` and replace every literal before
> attempting any sheet change.** This is a prerequisite for item 7, not part of it.

### D2 — Where does the fill computation live?
Layout needs sheet dimensions; sheet dimensions are now **constants** (ARCH D / ANSI D).
**The circularity I flagged in Rev 1 disappears** — no iteration needed. Layout reads
`view.sheetW/sheetH`, derives pitches, centers the result. Straightforward, one pass.
(Finding F1's `k` clamp stays as the overflow guard for genuine overfill, per §111.)

### D3 — Signal routing: price it, or restructure it?
- **D3-a** Raise the `sig` weight / add a length budget to the objective. Cheap, but
  F4's cause is that a short path is *blocked*, so pure weighting may just find a
  different ugly detour.
- **D3-b** Reserve signal corridors (like the failed 5.3 process-corridor attempt —
  note that failure: wide corridors squeezed details and regressed spike).
- **D3-c** Accept long signals as the honest cost of congestion, and instead *style*
  them so they read as signal lines (F5) rather than as stray boxes.
- **Recommendation:** D3-a + D3-c. The long run is often structural — the plan already
  records (Phase 5 closing) that `PT-101 → PIC-101` is structural and that full
  pair-as-unit rework failed cost/benefit. Do not re-litigate a 5.3-style corridor
  attempt. Make the long line *look* intentional.

### D4 — Colour: adopt an AutoCAD-style layer/theme system · **revised, scope now larger**

> **Revised.** Originally a one-line colour swap. The proposal is now a proper
> **theme + layer system** with two modes:
> - **CAD mode** — black background, each item category on its own colour, AutoCAD
>   layer colours.
> - **Print preview** — the same drawing in black-on-white, monochrome, as it will
>   print on ARCH/ANSI D.
>
> This supersedes D4-a/D4-b and is a **prerequisite refactor**, not a cosmetic pass.
> Measured blast radius below.

#### Verified blast radius — smaller than feared, with one catch

| Area | Finding |
|---|---|
| Hardcoded hex in live stack | **8 distinct, 36 occurrences, all in `pid-renderer.js`** |
| Other stack files | **zero** hardcoded hex (`pid-rules.js`, `pid-router.js`, `pid-validator.js`, `pid-parser.js`, `pid-collide.js` all clean) |
| Symbol glyphs | `pid-symbols-bundle.js` uses **`stroke="currentColor"` ×430** — already theme-ready |
| Colour inheritance | **nothing sets `color` on the root SVG** — so `currentColor` currently resolves to the default (black) |

So the refactor is genuinely contained: one file, 8 colours, and the 430 glyph strokes
inherit automatically from a single `color` property on the root `<svg>`.

Current literals and their category:

| literal | count | category |
|---|---|---|
| `#333` | 10 | frame / title block / border |
| `#111` | 8 | primary text (tags, titles) |
| `#666` | 5 | secondary text (type labels) |
| `#444` | 4 | signal lines, junction refs |
| `#555` | 3 | tertiary text (valve state) |
| `#0D47A1` | 3 | line designation text |
| `#1E90FF` | 2 | **process lines, junction dots** |
| `#888` | 1 | tertiary text (nozzle size) |

#### The catch: 17 white halos

`paint-order="stroke" stroke="white"` appears **17 times** — the legibility halo
technique, which paints a white outline behind text so it reads over crossing lines.

**This is the one thing that will break on a black background**, and it is why this
must be a theme refactor rather than a find-and-replace:

- On white paper, halo = white = background. Invisible, correct.
- On black CAD background, halo = white = **a glowing white outline around every
  label.** Actively worse than no halo.
- The halo colour must become `currentColor`'s *opposite* — i.e. a theme token
  (`halo`), not a literal.

Any approach that swaps hex values without introducing a `halo` token will produce a
black-background render that looks broken. Worth stating explicitly because it's the
failure mode a naive implementation hits.

#### Proposed layer/token model

Two themes over one token set. Categories mirror AutoCAD layers, which is a good fit —
AutoCAD already solves exactly this problem (colour-per-layer + a monochrome plot style
for printing), and its **monochrome plot style is the direct precedent for the print
preview toggle**.

| Token / layer | CAD mode (AutoCAD-ish) | Print mode |
|---|---|---|
| `bg` | `#000` | `#fff` |
| `frame` | dim grey | `#000` |
| `process` | AutoCAD green/yellow | `#000` |
| `signal` | AutoCAD cyan/magenta, dashed | `#000` dashed |
| `utility` | distinct hue | `#000` |
| `equipment` | white / light | `#000` |
| `valve` | green | `#000` |
| `instrument` | yellow | `#000` |
| `nozzle` | grey | `#000` |
| `text` / `textDim` / `textFaint` | white / grey / dim | `#000` / `#333` / `#666` |
| `lineTag` | cyan | `#000` |
| `junction` | AutoCAD yellow | `#000` |
| **`halo`** | **`bg`** | **`#fff`** |

Implementation shape:
- `PID_RULES` already exists as a token/param registry (the plan's "rule registry live"
  work) — the theme belongs there, not in a new file. It already owns `weights` and
  `ruleParam`, so this is consistent with the established pattern.
- Emit `color="<process token>"` on the root `<svg>`; the 430 `currentColor` glyph
  strokes follow for free.
- Theme chosen at render time (`renderPid(src, el, { theme: 'cad' | 'print' })`), so
  **one model renders both modes** — no duplicate geometry, no divergence risk.

#### Toggle semantics
- **CAD mode** = on-screen authoring/review. Default for the demo pages.
- **Print preview** = what ARCH/ANSI D output will look like. Toggle in the UI; also
  the default for **SVG export**, since export is the print deliverable.
- Theme must be a pure presentation concern — **no geometry may change between modes**,
  or exports stop being 1:1 and the guarantees in D7/§7 break. This is assertable: a
  regression check that both themes produce byte-identical geometry (paths only,
  ignoring colour attributes).

#### Trade-off, stated honestly
This is a **net-new feature** (theming + a mode toggle), not a defect fix. It does not
make any drawing more correct. Its value is that CAD mode makes the *category structure*
of a drawing legible at a glance — which is a real drafting benefit and a genuine
usability win — but it is scope beyond the original review, and it should be scheduled
as such rather than smuggled in as a colour fix.

### D8 — Symbol library: industry-standard conformance review · **deferred, flagged by user**

The symbol library is based on **industry-standard P&ID symbols (ISA-5.1 / PIP)**, with
recognised wiggle room, and a significant amount of the underlying **data is expected
to need correction**. Recorded here as a known future workstream; **not** in the current
critical path, and deliberately not started — the layout work is independent of it.

Scale: **141 glyphs** in `pid-symbols-bundle.js` — 91 `isa-5.1/*`, 50 `pip/*`.

#### Why this is bigger than it looks — the ports are load-bearing

The bundle is a JSON blob (`window.PID_SYMBOLS`) where each entry carries
`svg`, `size`, `viewBox`, `anchor`, `extents`, and **`ports[]`** (id, type, x, y).

Those `ports[]` coordinates are **not cosmetic**. They are the single source of truth
for:

- nozzle tip positions (`nozzleTip()`) — where every pipe actually terminates
- port direction and axis (`portDir()`) — which way lead-in stubs point
- valve-to-equipment snapping (`autoLayout`, the `mating` port search)
- port capacity / cardinality validation
- collision boxes and routing keep-outs (`entityHalf`)

**So "correcting symbol data" changes geometry on every sheet that uses the symbol** —
it is not a cosmetic pass, and it will move regress baselines. It also interacts with
the layout fix (item 1): a port moved 2mm changes the port-elevation match that
snapping depends on.

#### Suggested approach when this is picked up

1. **Audit, don't bulk-edit.** `analyze-symbols.mjs` already exists and reports
   per-symbol port counts, port coordinates, anchors, extents, and viewBox — the raw
   material for a conformance pass. Use it as the entry point rather than hand-editing
   210 KB of JSON.
2. **Separate the two classes of change:**
   - *Geometry corrections* (a port is in the wrong place on the glyph) — moves
     geometry, needs re-blessing, do one symbol at a time with a rendered check.
   - *Metadata corrections* (port ids/classes, `connectionClass`, sizes) — mostly
     validation-visible, often no geometry impact.
3. **Verify against the standard, with the wiggle room respected.** PIP/ISA-5.1
   conventions have latitude in areas (exact glyph proportions, label placement); the
   goal is recognisable-correct, not pixel-exact. Note the plan already recorded one
   known instance: **bundle/source divergence on the motor triangle**.
4. **Instrument-size sanity is separate.** From the render, equipment glyphs range
   25–75 mm on one sheet (T-101 65 mm, E-102 70 mm, D-101 60 mm, pumps 25 mm,
   valves 10 mm). Whether that spread is *correct* depends on the convention chosen —
   worth deciding explicitly rather than inheriting.
5. **Sequence last.** Do it after items 1–8, and re-bless deliberately per symbol.


With ARCH/ANSI D fixed, current text sizes are print-correct and the audit's `[1]` floor
is right. **Do not raise it.** Screen legibility is D7's job, and D7 solves it without
spending collision budget on dense sheets.

The one real text question is *consistency*: 3.5 / 3.6 / 3.9 / 4.2 / 4.5 mm is five
distinct sizes. A tighter scale (fewer steps) reads as more deliberate. Cheap, SVG-only,
worth doing alongside the colour pass.

### D6 — Legend
Enable by default, or add `legend on` to every demo/regress sheet? Default-on is more
professional but changes every baseline. Recommend: implement the flag properly
(unreachable code today), enable on the demo, leave regress sheets unchanged to avoid
baseline churn.

Note: the legend is also a **print-media** artifact — on ARCH D it belongs on the sheet,
not in the UI.

### D7 — Viewer zoom/pan · **new in this revision; now a required deliverable**

Because the printed sheet is a fixed ARCH/ANSI D, the demo *must* present that sheet
1:1 and let the reader move around it. Without this, every drawing is judged at ~30%
scale and looks broken no matter how well the geometry is.

**Good news: the pattern already exists in this repo.** `pid-components.html`
implements wheel-zoom-at-cursor, drag-to-pan, zoom buttons, a `fit` reset, and
`view.k` clamping (lines ~706–720, ~757–759). This is a **port**, not new design —
reuse it so the two pages behave identically.

Scope for `pid-spike.html` (and ideally shared with `pid-assemblies.html`):

| Feature | Notes |
|---|---|
| Wheel zoom at cursor | port from `pid-components.html`; clamp k to ~0.15–10 |
| Drag empty space to pan | page currently reserves drag for entity moves — need a modifier or empty-space target |
| `fit` / 100% buttons | 100% = true 1:1 mm, which is the print-truth view |
| Zoom % readout | users need to know when they're at 1:1 |
| Scroll-container sizing | sheet must not be clipped by the viewport |

**Interaction hazard to design around:** `pid-spike.html` already implements
drag-to-move + `toSource` round-trip (`enableDrag()`, lines 123–171) on
`pointerdown`/`pointermove`/`pointerup`. Panning must not steal those events.
Suggested split: drag on a symbol = move it; drag on empty space = pan; wheel = zoom;
middle-drag = pan always. Needs a decision (see §8).

**Explicitly out of scope for the zoom layer:** it must not alter drawing
coordinates. Zoom is a *view* transform on the SVG `viewBox`, never baked into
geometry — otherwise exports stop being 1:1 and every other guarantee in this document
silently breaks.

---

## 6. Suggested order of work

Each item states its risk to the regression baselines so re-blessing is a deliberate
act, not a surprise.

| # | Item | Fixes | Baseline impact | Risk |
|---|---|---|---|---|
| 0 | Add audit `[11]` utilisation + `[13]` sparse sheet | meta-problem | none (new checks) | very low |
| 1 | Row pitch from `availH`; center block | F2, F3 | geometry moves → **re-bless** | low |
| 2 | **Viewer zoom/pan (port from `pid-components.html`)** | F9, F6-screen | none (UI only) | very low |
| 3 | **Theme/layer tokens + CAD & print modes** | F5, D4 | SVG-only; **assert geometry identical across modes** | low |
| 4 | Legend flag made reachable | F7 | SVG-only if defaulted off | very low |
| 5 | Consolidate text size scale | F5-adjacent | SVG-only | very low |
| 6 | Signal pricing + styling | F4 | routing changes → **re-bless** | medium |
| 7 | Sheet constants refactor + `sheet` DSL option | D1 | sheet size changes → **re-bless** | low |
| 8 | Richer demo sheet | F8 | none | very low |

**Revised ordering rationale.** Item 2 (viewer) moved up sharply. It is UI-only, so it
costs no baselines, and it changes how *every other item is judged* — reviewing layout
at true ARCH D scale on a calibrated monitor is a far better feedback loop than
squinting at a 30% thumbnail. Do it early, before tuning geometry.

**Item 3 (theme) is sequenced before the colour-adjacent items 4 and 5** because both
touch the same literals; doing them together avoids editing `pid-renderer.js`'s colour
sites twice. It carries one hard requirement (§D4): the 17 white halos must become a
`halo` token or black mode renders glowing white outlines.

Items 0, 2, 3, 4, 5 are metric-neutral or SVG-only and can ship without re-blessing.

Note item 7 is now a small, well-defined change (a constant plus an optional DSL
directive), not the adaptive-sizing machinery Rev 1 proposed.

### On re-blessing
Every geometry-affecting item forces `expected.json` updates. Two guards, given the
plan's own history (scores swinging 5306→1748→2823 across edits):
- Re-bless **only** the sheet whose baseline you intended to change, and diff the
  others to prove they're untouched.
- Screenshot review is mandatory after each re-bless. A green regress plus a worse
  drawing is exactly the failure mode this document exists to prevent.

---

## 7. Explicit non-goals

Carried over from the plan's discipline — do not spend here:

- **Do not resurrect the corridor-reservation approach** for signals (D3-b). 5.3
  already failed its gate with an obituary; the reasoning still holds.
- **Do not rewrite the router or add repair passes.** The routing and repair machinery
  is the part that works; items 0–8 do not require touching it.
- **Do not remove the `Math.min(1, …)` clamp.** With a fixed ARCH/ANSI D print medium,
  it is what keeps symbol size identical across every sheet in a set. It is load-bearing.
- **Do not inflate text sizes to fix screen legibility.** Print sizes are correct; the
  viewer is the answer (D7). Raising the floor would spend collision budget for nothing.
- **Do not bake zoom into geometry.** Viewer zoom is a `viewBox` transform only;
  exports must stay 1:1.
- **Do not bake the theme into geometry either.** CAD and print modes must produce
  byte-identical geometry; only colour attributes may differ. Otherwise the two modes
  become two drawings that drift apart, and exports stop being trustworthy.
- **Do not chase the void with content padding** (inflating boxes to fill space). That
  is the metric-gaming the plan already ruled out ("fix the metric or accept, never
  contort geometry").

---

## 8. Open questions for the user

1. **ARCH D or ANSI D as the default?** Both are in scope. Current `864×559` is ANSI D
   rounded; true ARCH D is `914.4×609.6`. Should the DSL expose `sheet arch-d` /
   `sheet ansi-d`, and which is the default? (Item 7, and the only remaining sizing
   question. Note the 8-literal refactor hazard above — sequence it first.)
2. **Panning vs drag-to-move in `pid-spike.html`.** Drag-to-move + `toSource`
   round-trip already exists. Should panning be: empty-space drag, middle-drag, or
   space/middle-drag with symbols reserved for move? Needs a call before D7 is built.
3. **Should the zoom/pan viewer be shared code** extracted from `pid-components.html`
   into a small module used by `pid-spike.html` and `pid-assemblies.html` — or
   duplicated per page? Recommend shared.
4. **CAD theme palette.** Should the layer colours follow real AutoCAD ACI numbers
   (7=white, 3=green, 5=blue, 1=red…) or be chosen for on-screen contrast? ACI is
   self-documenting for anyone who knows AutoCAD; contrast-optimised is easier on a
   monitor. Recommend ACI — it matches the mental model the feature is borrowing.
5. **Default mode.** CAD (black) or print (white) as the page default? Recommend **CAD
   for the demo pages, print for SVG export.**
6. **Should the regression suite gain a visual baseline** (ink-coverage assertion)?
   Ink coverage is stable and cheap and would catch the void class automatically; PNG
   hashes are brittle across Chrome/font changes. Recommend ink-coverage only.
   Note: the ink scan must be run in **print mode** — a black-background render
   inverts every density assumption.

## 9. Implementation log

### 9.1 Item 0 groundwork — pre-existing baseline failure fixed

`regress.mjs` was **already red** before any change: gate 1 (`routeOne` lead-in stubs)
failed on `UTIL-1 -> E-102` and `E-102 -> UTIL-2`.

Root cause: the lead-in **was** present, at `(307.5, 130)`; the gate wanted
`(307.5, 130.5)` — exactly 0.5 mm of grid dust. Gate 1 used a strict `< 0.5` while
gate 2's `same()` correctly used `<= 0.5`. **A gate epsilon bug, not a geometry defect.**
Fixed gate 1 to `<= 0.5` for consistency. `REGRESS OK` restored.

### 9.2 Item 1 — layout void. Stretching REJECTED, centring ADOPTED

**Attempt 1 (rejected, with data).** The obvious reading of the dead `availH` was
"solve the row pitch to fill the sheet." Measured across caps 1.15–1.8:

| cap | spike score / xing / tap | dense score / xing |
|---|---|---|
| 1.00 (no stretch) | 1276 / 30 / 200 | 1471 / 11 |
| 1.15 | 1539 / 41 / 110 | 2588 / 6 |
| 1.30 | 1479 / 38 / 195 | 2577 / 4 |
| 1.45 | 1359 / 35 / 335 | 1463 / 6 |
| 1.60 | 1894 / 33 / 472 | 1464 / 6 |

Worse on essentially every metric. Spreading entities apart lengthens every pipe and
creates more crossing opportunities; dense blows up to 2588. **This independently
re-confirms the documented Phase 5.1 failure mode** (a placement move that doesn't
price corridors and labels). The compact block is a *feature* of the routing.

**Conclusion recorded in-code:** `availH` stays dead. Nothing should consume it, and
the reason is now written down so the next reader doesn't "fix" it again.

**Attempt 2 (adopted).** Translate the composed block to centre it on the sheet.
Translation cannot change any *relative* position, so pipe shapes, lengths, bends and
crossing relationships are preserved by construction.

Implementation notes:
- Slot assignment split from coordinate writing, so the pitch question is answerable
  (and the answer recorded) without churning the placement loop.
- The shift is **grid-snapped to 5 mm** so the routing grid keeps its phase; a
  fractional shift would silently re-phase every downstream snap.
- Centring is **skipped when any entity carries an absolute `at`**. This was a real
  bug found in my own first cut: I measured the bbox from auto-placed items only and
  then moved only those, which flung `min.dsl`'s valves 315 mm away from their
  user-placed pump. The correlation was exact — `min.dsl` (2 `at`) and `split.dsl`
  (4 `at`) regressed; `spike.dsl` and `dense.dsl` (0 `at`) improved.
- `rel` deliberately does **not** count: a relative placement re-resolves against its
  reference every layout, so it travels with the block. `spike.dsl` has
  `rel above R-101` on its PSV and must still be centred — an earlier version of the
  guard got this wrong and silently disabled centring on `spike`.
- New rule-registry params: `layout.centre`, `layout.centreBottomReserve`.

**Result (re-blessed, `spike` + `dense` only):**

| metric | spike | dense |
|---|---|---|
| score | 1276 → **1247** | 1471 → **1441** |
| warnings | 17 → **13** | 8 → **7** |
| `[9]` off-sheet | 1 → **0** | 0 → 0 |
| `[8]` short segments | 3 → **2** | 0 → 0 |
| `[5]` through-symbol | 1 → 1 | 1 → **0** |
| `[3]` crossings | 13 → 13 | 12 → **11** |
| `[7]` label collisions | 1 → **2** | 1 → 1 |
| `[10]` ungapped | 1 → **2** | 0 → 0 |

Net positive (score, warnings and four audit counts better; two counts slightly worse),
and visually decisive — the bottom void is gone. `min` and `split` baselines verified
**byte-identical**, proving the guard works.

`dense` previously wasted **58%** of its vertical space (y 75–240 on a 519 mm
drawable); it is now y 170–335, centred.

### 9.3 Harness bug found — partial `--bless` deleted baselines

`--bless spike dense` **rewrote `expected.json` containing only those two cases**,
dropping `min` and `split`, which then failed as "no baseline". Cause: `regress.mjs`
initialised `expected = {}` and skipped loading the file whenever `--bless` was
present. A partial re-bless is a routine operation, so this would have destroyed
baselines at the worst moment. Fixed to always load and merge.

### 9.5 Item 0 — audit `[11]` sheet utilisation + `[13]` sparse sheet

The §4 proposal, implemented in `audit-svg.mjs` and gated by `regress.mjs`.

- `[11]` reports content bbox vs the drawable area as an integer area-%, emitted
  **last on the header line** so `regress`'s existing count regex captures it like
  every other check (a free-form ratio line was silently skipped).
- `[13]` is the actionable one, on a permissive 45% fill floor.

**One design flaw found and fixed mid-implementation:** the first version counted
*everything*, including the title block and legend. Those are chrome pinned to the
bottom of every sheet, so they anchored the bbox to the bottom edge and a stranded
drawing measured ~100% tall — the check would have reported "fine" on exactly the
defect it was written to catch. Fixed by measuring **only what lands inside the
drawable zone**; content outside is either chrome or an off-sheet excursion, and
`[9]` already owns the latter.

Validated by A/B (centring off = the old void): spike area 70% → **82%**.

Current readings — and note these are **true positives**, not noise:

| sheet | `[11]` area | `[13]` | reading |
|---|---|---|---|
| spike | 82% | 0 | fills the sheet |
| dense | 27% | **1** | 14 entities on ARCH D — genuinely small |
| min | 11% | **1** | 3-equipment toy, `at`-pinned |
| split | 27% | 0 | 55% W x 49% H, just over the floor |

`dense` and `min` being flagged is the check working: those sheets really are too
small for ARCH D, and the honest answer is "split it", not contort the geometry.
Re-blessed all four for the new keys; `REGRESS OK`.

### 9.6 Item 2 — sheet viewer (zoom / pan / 1:1)

`pid-spike.html` now presents the fixed ARCH/ANSI D sheet in a bounded viewport with
wheel-zoom-at-cursor, drag-to-pan, `Fit sheet`, `1:1`, zoom buttons, a percentage
readout, and `F` / `0` / `+` / `-` keys. Ported from the working pattern in
`pid-components.html` (lines ~706-720, ~757-759) so the two pages behave alike.

Pan/drag collision with the existing drag-to-move round-trip is resolved by target:
**a pointerdown on a symbol moves it; on empty space it pans** (middle-drag and
shift-drag always pan). This was §8 Q2, now decided.

Zoom is a **viewBox transform only** — verified, not assumed. A headless-Chrome probe
clicked the real buttons and fingerprinted all 4,647 `path`/`text`/`circle` elements:

- geometry hash **identical** at fit and at 1:1 -> view-only, PASS
- element counts unchanged (43 paths, 49 texts) across every zoom level
- `Fit sheet` idempotent; `1:1` genuinely zooms in (133%); zoom in/out responsive
- `width`/`height` attributes preserved (864x559) through all of it

**A feedback bug found by the test, not by reading.** `sheetSize()` originally read
the live `viewBox` to learn the sheet size — but `applyView()` *rewrites* that
viewBox, so the function was feeding the zoomed window back in as if it were the
sheet. Symptom: clicking `Fit sheet` after any zoom produced a corrupt
`viewBox="0 0 275.3 178.1"`. `exportSVG()` had **the identical flaw**, which was
worse: exporting while zoomed would have written a *cropped* file and called it a
sheet. Both now read the authoritative `data.view.sheetW/sheetH` from the model.
Export is verified to emit `0 0 864 559` even from a 133% zoomed state.

**Payoff confirmed visually:** at 143% the same drawing that was unreadable at fit
now shows `TK-101 / cone roof tank`, `V-101 / gate valve / N/O`, `NZ-TK-D 4"`,
`P-101 / centrifugal pump` cleanly. This is the D5/D7 thesis settled empirically —
the 3.5 mm text was always print-correct and never needed inflating; the *viewer*
was the missing piece.

### 9.8 Item 3 — theme / layer system (D4)

AutoCAD-style colour-per-layer plus a monochrome plot style, as two modes over one
token set held in `PID_THEMES` (`pid-rules.js` — the registry, not a new file).

- `cad` — black model space; process green (ACI 3), signal magenta (6), utility
  cyan (4), equipment white (7), valve yellow (2), instrument orange (30),
  junction red (1), cyan line tags.
- `print` — the ARCH/ANSI D deliverable: dark ink on white, category carried by
  lineweight and dash rather than hue. This is also the F5 fix: the old dodger-blue
  process line is gone from the print output.
- `renderPid(src, el, { theme })` plus a `theme cad|print` DSL directive with
  `toSource` round-trip. `print` is the default because it is the deliverable.

**Why this was cheap, and the one trap.** The stylesheet is injected as raw markup
and keyed partly on *attribute selectors over the existing literals*
(`text[fill="#111"]{…}`). CSS beats SVG presentation attributes, so the ~36
emission sites keep their colours and print mode needed no edits there — four small
edits (layer classes on the entity groups) plus a few class hooks, not 36.
The trap is `halo`: 44 elements carry `stroke="white"` for the label legibility
halo, which is invisible on paper and a **glowing white outline** on black. It is a
token now, and verified by computed style, not by attribute presence.

**Two real bugs found while building it:**

1. *Node-side export lost the theme entirely.* The first attempt built the
   stylesheet as a DOM `<style>` element and set `textContent`. The node harness's
   fake element never serialises that, so **every SVG exported from node came out
   unthemed** with an empty `<style>`. (The pre-existing `chips` stylesheet has the
   same latent bug.) Fixed by emitting the stylesheet as raw markup, plus a real
   background `<rect>` so the sheet colour survives rasterisers that ignore
   root-element CSS.
2. *`data-theme` was the literal string `"null"`* on every default render, because
   the attribute was set from the raw (absent) argument rather than the resolved
   theme name. Caught by the browser test, not by reading.

**Also fixed a latent audit bug.** `audit-svg.mjs` matched
`<g data-pid-id="([^"]+)">`, requiring `data-pid-id` to be the *last* attribute — so
adding `class="ly-equipment"` silently dropped **every entity box** (`entities: 6
-> 1`, and `[6]`/`[5]` would have gone blind). Relaxed to `<g data-pid-id="([^"]+)"[^>]*>`;
attribute order is an implementation detail, not a contract.

**Verification (16 checks in a real browser + a node-side invariance sweep):**

| assertion | result |
|---|---|
| geometry byte-identical across themes (all 4 sheets) | PASS |
| element fingerprint identical (4,647 nodes) | PASS — same hash `1928727289` |
| score / errors / warnings identical across themes | PASS |
| `data-theme`, stylesheet, background per mode | PASS |
| no halo *renders* white in CAD (computed style) | PASS — 44 attrs, 0 painted white |
| zoom survives the theme re-render | PASS |
| export from CAD mode is still **print**, full sheet | PASS — `0 0 864 559` |

`REGRESS OK` **with no re-bless** — audit metrics are byte-identical, which is the
strongest available evidence that the theme is purely presentational.

Note: a viewer with no CSS support would fall back to the inline literals. Every
mainstream SVG renderer applies CSS in `<style>`, and print mode's literals are
already correct, so the deliverable is safe either way.

### 9.10 Layout focus — two results: one dead end, one real bug

#### 9.10.1 Uniform fill scale — MEASURED DEAD END (reverted)

With `[11]`/`[13]` in place, `dense` (27%) and `min` (11%) were flagged sparse, and
centering cannot fix them because their content is genuinely small. The obvious
lever: multiply positions **and** `symbolScale` by one factor. Every relative
distance is preserved, so crossings/bends/label-collisions should be scale-invariant
and the sheet fills for free.

**It is not free, and the reason is structural.** The engine's tunables are absolute
millimetres — 14mm port lead-in, 45mm bubble slot, 16mm label keep-out, 8mm
annotation standoff, 5mm grid. Scaling geometry alone lets symbols grow into their
own labels. So the second attempt scaled the mm tunables too, via a `PID_DRAW_SCALE`
seam in `ruleParam` (honouring the registry's existing `unit: 'mm'`, with
`noScale: true` for sheet-relative margins). Measured, on vs off:

| sheet | fill | labels | crossings | bends |
|---|---|---|---|---|
| dense | 27% → 49% | 1 → **28** | 8 → 8 | 34 → 30 |
| spike | 82% → 82% | 2 → 5 | 30 → **42** | 83 → 85 |

Scaling the constants made it *worse*, not better. Spike was already fine at 82% and
degraded; dense bought fill it already gets reported, at the price of 27 label
collisions. Two attempts, both fail the gate — this is the plan's "global rewrite"
non-goal, now with independent evidence rather than assumption.

**Conclusion:** the engine is built around one absolute drawing scale and
`1 unit = 1mm` stays literal. An under-filled sheet is not a layout bug — it is a
small sheet. `[13] sparse sheet` reporting it honestly (plus the plan's
split-the-sheet answer) is the correct response. The `PID_DRAW_SCALE` seam is left in
`ruleParam` defaulted to 1, where it is inert. Reverted; `REGRESS OK`.

#### 9.10.2 Stage-ordering bug — valve enforcement ran AFTER instrument stacking

**The real find, and the biggest layout win so far.**

`autoLayout` ran the *valve process-line enforcement* pass **last**, after instrument
stacking. That pass MOVES valves (to sit between their upstream/downstream entities,
`valveOffset` from the upstream). So instrument bubbles were stacked on valve
positions that were subsequently invalidated — a stage-ordering violation of exactly
the kind Phase 4 warns about ("stage N+1 destroys stage N's work").

Instrumentation proved it: for `PIC-101`, `drivenId` resolved **correctly** to
`V-105`, yet the bubble ended up 600mm away. The placement logic was right; the
anchor it used was stale.

**Fix:** run valve enforcement *before* instrument stacking, so bubbles anchor to
final valve positions. One block move, no logic change.

| metric | spike | dense |
|---|---|---|
| errors | 0 → 0 | **1 → 0** |
| warnings | 13 → **7** | 7 → **3** |
| score | 1247 → **1101** | 1441 → **466** (−68%) |
| max signal length | 615mm → **376mm** | 431mm → **115mm** (−73%) |
| `[5]` through-symbol | 1 → **0** | 0 → 0 |
| `[10]` ungapped | 2 → **0** | 0 → 1 |
| `[3]` crossings | 13 → 19 | 11 → **3** |
| `[7]` label collisions | 2 → 4 | 1 → 1 |
| `[13]` sparse | 0 → 0 | 1 → **0** |

`PID-VAL-002` ("controller should sit directly above the valve") went to **zero on
every sheet** — independent confirmation the anchors are now correct. Both 770mm and
639mm signals disappeared; only one `PID-SIG-002` remains anywhere.

Costs, stated plainly: spike crossings +6 and label collisions +2, dense one new
ungapped crossing. Re-blessed; `REGRESS OK`.

This is the same class of defect the plan logged repeatedly in Phase 5 ("elevations
greed pulls entities into shared corridors", "grid-slide ate nozzle stubs") — the
recurring lesson being that **stage order matters more than stage quality**. Worth
promoting to a Phase-4 invariant: assert that no pass moves an entity after something
has been positioned relative to it.

### 9.11 CORRECTION — the 9.10 reorder shipped a regression on the demo sheet

**9.10.2's "big win" was overstated and I shipped it without checking the demo
page.** The user reloaded `pid-spike.html` and it was visibly worse: 8 valves
collapsed into a 190x25mm box with labels stacked on each other. Verified, not
argued — 9 entities inside a 55x25mm region.

A/B of the reorder with collision handling in place:

| order | spike | dense | **demo** |
|---|---|---|---|
| valve enforcement BEFORE stacking (shipped) | 1101, sig 376mm | 466, 0 err | **572**, 6 warn |
| valve enforcement AFTER stacking (original) | 1247, sig 615mm | 1441, 1 err | **294**, 3 warn |
| junctions → valves → instruments | 2092, 1 err | 1427, 1 err | **255**, 1 warn |

Every ordering wins somewhere and loses elsewhere. There is no single correct pass
order for this engine — the passes are mutually dependent and the right order depends
on sheet topology. My 9.10 claim of a "biggest win so far" was true for the synthetic
fixtures and false for the sheet a human actually looks at.

**What was actually wrong, underneath both symptoms:** the valve-enforcement pass
repositioned *every* valve to `upstream + dir*20mm`, unconditionally. That is a
*placement*, not the *constraint* the pass exists to enforce ("a valve sits between
its endpoints"). It overwrote good grid positions, pulled every valve toward its
upstream anchor, and — since each valve then anchors the next — cascaded the chain
into a pile.

**Kept (real fixes):**
- **Collision avoidance** — a valve sliding to a legal spot now checks clearance
  against already-placed valves (`layout.valveClear`, 16mm), with a bounded search
  (±2.5 clearances along its own pipe axis; unbounded walked valves across the
  sheet, which was worse than the pile).
- **Constraint, not placement** — a valve already between its endpoints is left
  exactly where the layout put it.
- **Junctions before instrument stacking** — bubbles now avoid real junction
  positions instead of pre-placement ones.

**Reverted:** the valve-enforcement reorder.

Net vs the pre-reorder state: spike score 1247 → 1176 and label collisions 2 → 0,
but warnings 13 → 16 and max signal 615 → 640mm — i.e. **a wash on spike, honestly**.
The demo improves 335 → 278 and the pile is gone. `REGRESS OK`.

**The lesson, which is the real deliverable here:** I measured four regression
fixtures and reported a win without rendering the one page the user looks at. The
fixtures were *synthetic*; the demo is *pathological* (2 equipment, 8 valves, 3
junctions — the worst case for "pull every valve toward its anchor"). Optimising
against fixtures and calling it a layout win was the error. **A layout change is not
done until the demo sheet has been looked at.**

### 9.12 THE LAYOUT FIX — stop picking a pass order, search it

The 9.11 A/B table is the finding: **no fixed ordering of the three placement passes
is correct.** They are mutually dependent — each anchors to positions the others set —
and the right order depends on sheet topology. Choosing one is choosing which sheets to
sacrifice.

So don't choose. The engine already has candidate selection (plan Phase 3, for routing
seeds); **pass order is now a search dimension of the same kind.**

- The three passes are extracted as `passJunctions` / `passValves` / `passInstruments`
  and run by a dispatcher over `data.layoutOrder`.
- `PID_LAYOUT_ORDERS = ['JIV', 'JVI', 'VJI']` — the **legacy order is first**, so the
  search can never be worse than the old single-order behaviour.
- `parse(source, { layoutOrder })` carries it; `renderPid`'s default path renders each
  order and keeps the lowest `score.total`, exactly like the routing candidate search.
- Deterministic (no RNG), so a sheet always reproduces. `layout.orderSearch:0` /
  `layout.orderCandidates:N` in the registry to disable or narrow it.

**All three orders win somewhere** — which is the whole justification:

| sheet | winning order | before search | after search |
|---|---|---|---|
| spike | JIV | 1176 | 1176 |
| dense | **VJI** | 1441, **1 error** | **466, 0 errors** |
| min | JVI | 62 | **58** |
| split | JIV | 36 | 36 |
| **demo** | JVI | 278 | **239** |

Demo sheet overall: score 335 (session start) → **239**, crossings 3 → 1, warnings
2 → 1, sheet fill 27% → **70%** (92% of drawable height), `[13] sparse` clear.
Render cost 63–761 ms per sheet (was 63–286 ms); acceptable at this size.

`REGRESS OK` after a deliberate re-bless.

### 9.13 What is still wrong with the layout — honest status

Better, and the architecture is now sound, but the demo is **not yet professional
grade**. Remaining, in order of visual cost:

1. **The drain branch owns a third of the sheet.** `J-0 -> V-106 -> OP-CD` and the PSV
   discharge route down to the bottom-left, leaving a large void mid-sheet while the
   process train crowds the top. This is a *routing/terminal placement* problem
   (where off-page connectors sit), not the column grid.
2. **Parallel manifold branches crowd.** V-102 / V-103 / V-105 / FV-101 are parallel
   branches off J-1, so they share a depth rank and land within ~60 mm. Defensible in
   principle, but the intra-column pitch (`0.55 x rowSpacing`) is tighter than the
   column pitch, so stacks crowd horizontally-spaced columns.
3. **`spike` did not improve** from the search (JIV won, same as before). Its long
   signals and 27 crossings are the Phase-5 residuals the plan already documented as
   structural.

Nothing here is fixed by another pass reorder — the next real step is (1) terminal /
off-page placement, then (2) the intra-column pitch. Both are layout, not routing.

### 9.14 Still outstanding

Items 3-8 untouched: theme/layers (D4), legend (F7), text-size consolidation,
signal pricing (F4), sheet constants, richer demo, symbol conformance (D8).

### 9.15 Coordinate assignment — the y-within-a-rank rule was ignoring topology

**Diagnosis.** Pass 2 set `y` purely by *index* within a depth rank
(`y = base + i * 0.55*ROW`). Topology played no part in it. Two consequences:
parallel branches landed in arbitrary order, and a rank of k members always
formed a rigid equally-spaced stack regardless of what its neighbours wanted.

**Change.** Replaced it with the standard layered-graph coordinate step: seed by
index, then pull each node toward the **median** height of its neighbours, then
pack the rank to a minimum separation (`layout.minSep`) and re-centre the group on
what it asked for.

**First measurement was a trap.** A 20-point sweep over `minSep` x `coordIters`
gave a *chaotic* surface, not a smooth one:

| minSep / iters | spike | dense | demo |
|---|---|---|---|
| 45 / 0 (legacy) | 1176 | 466 | 239 |
| 70 / 2 | 1952 **(1 err)** | 1458 **(1 err)** | 238 |
| 100 / 2 | 1093 | 361 | 341 |
| 45 / 8 | 1065 | 309 | 242 |

Adjacent parameter values swing `spike` 1093↔1952 and flip errors on and off. A
small coordinate change cascades — it moves a valve, which changes port snapping,
which re-stacks instruments, which re-routes. **This is not a landscape to
hand-tune.** It is a landscape to *search*, which is exactly what the pass-order
search already established. So coordinate sweeps became a second search
dimension (`layout.coordSearch`, `layout.coordSweeps`), and the legacy
configuration always competes, so the result can never be worse than before.

Verification that the refactor was sound: `coordIters: 0` reproduced the old
numbers exactly (1975 total, byte-identical).

`coordIters: 0` is *not* the best single fixed setting, so the default is now the
search, not a constant.

### 9.16 Off-page terminals — an orphaned-stub bug, and why the score was hiding it

**Symptom.** `OP-CD` (closed drain header) rendered at (185,435) on the demo sheet
while *both* of its partners sat at the top (V-106 at 205,150; PSV-101 at 455,145).
That is the bottom-left void, and the 280 mm drain line crossing the sheet.

**Trace** (a write-trace proxy on the junction object, printing a stack per
mutation — much faster than reading `passJunctions` and guessing):

```
OP-CD initial (100,100)
   SET x 100 -> 87    <- passJunctions
   SET y 100 -> 437   <- passJunctions
   SET x  87 -> 187   <- autoLayout        (block centring)
```

`passJunctions` **did** place it, 22 mm off V-106's port — at (87,437). Then
valve enforcement **slid V-106 to (205,150), 285 mm away**, and nothing re-checked
the stub. Not because the stub was moved, but because *its anchor* was. Classic
derived-position staleness.

**Fix.** `passTerminals` — a finaliser that runs after every placement pass and
re-anchors each off-page connector to its partner's **final** position. It is
deliberately not part of the order search: it is a consistency repair, not a
placement choice. The anchor math is shared with `passJunctions` via a new
`anchorAt` helper so the two cannot drift apart.

**The instructive part — this fix made the score pick a *worse drawing*.**
Demo went 239 → 470, crossings 1 → 7. The reason is the best evidence in this
document for why a score is a proxy and not a goal:

| candidate | score | err | V-106 | PSV-101 | picture |
|---|---|---|---|---|---|
| JVI 0 | 1424 | **1** | (195,255) | (445,250) | compact, correct |
| VJI 8 | **470** | 0 | (285,**425**) | (285,**500**) | 60 % empty, valves at the foot of the sheet |

The compact layouts each carried **one hard error worth 1000 points**, and the
search was right to reject them on the score — the score was reading a genuine
defect, just not the one I expected. The error was *caused by my own fix*:

```
COLLINEAR_OVERLAP: J-1->PSV-101 & PSV-101->OP-CD overlap 22mm at x=445
```

My first anchor heuristic ("prefer the port facing away from the block") chose
PSV-101's relief discharge and planted OP-CD **22 mm above PSV-101's inlet** —
i.e. directly on the J-1 → PSV-101 feed. The terminal was sitting on its own
anchor's other pipe.

**The fix that actually worked is directional, not metric.** A terminal must not
be planted in the direction its anchor's *other* run leaves
(`layout.terminalDirDot`, cosine > 0.5 → veto). Distance alone does **not** catch
it — the incoming run jogs sideways to reach J-1, so the terminal can sit 22 mm
off the port and still be nowhere near the straight segment. I wrote the distance
version first; it did not fire. Direction is the actual invariant.

After it: demo 1424 → **197**, 0 errors, OP-CD at (225,255) beside V-106.

**Generalisable lesson.** A bug fix can *raise* a score, and the score can still
be right — the fix exposed a second, larger defect that was previously being
masked. The correct response was to fix the second defect, not to relax the score
or disable the fix. Disabling the veto would have "restored" 239 while leaving a
collinear-overlap error in the deliverable.

### 9.17 De-crowding — separating label stacks without stretching the sheet

Addresses outstanding item (2) from 9.13: the manifold off J-1 put V-102 (440,225),
V-103 (455,240), V-105 (485,230), FV-101 (475,245) and PSV-101 (445,250) inside a
**45 x 25 mm box** — five valves, each with a three-line label stack (tag / type /
state) needing ~26 mm of vertical room. Two label collisions.

`passDecrowd` separates entities that are already horizontally within a label's
width of each other, by exactly the vertical room their label stacks need. This is
**not** the rejected "stretch the rows" move (9.2 / ROW_SOLVED): that relocated
*every* entity and lengthened every pipe. This only touches pairs that can
physically collide; everything else keeps its exact position.

**One bug found by measuring, not reading.** First cut reserved the label zone
*twice* (once per entity), demanding 52 mm between adjacent valves. Correct
reasoning: label stacks hang *below* their symbol, so only the **upper** entity's
stack has to fit in the gap. Fixed to `half(a) + half(b) + one label zone`.

**Second bug: it fought back.** With the corrected maths, dense 309 → 347 and
spike 1065 → 1169, spike's labels going 2 → 4. So I swept the two knobs rather
than argue about them (18 combinations x 5 sheets):

| crowdX | zone | spike | dense | demo | total | **label collisions** |
|---|---|---|---|---|---|---|
| — (off) | — | 1065 (2) | 309 (1) | 197 (2) | 1578 | **5** |
| 18 | 0.5 | 978 (2) | 309 (1) | 169 (1) | 1550 | 4 |
| 22 | 0.5 | 1009 (0) | 327 (0) | 162 (1) | 1592 | 1 |
| **34** | **0.5** | **1009 (0)** | **327 (0)** | 203 (0) | 1633 | **0** |
| 34 | 1.0 | 1169 (4) | 347 (0) | 180 (0) | 1790 | 4 |

Chose `crowdX: 34, decrowdZone: 0.5` — the only setting with **zero label
collisions on every sheet**, and it *also* improves spike (1065 → 1009). It is
**not** the lowest total (22/0.5 is 1592): the score prices a label collision at
30, which under-prices a visible defect. Trading 41 score points for the last
collision on the sheet the user actually looks at is the right trade. Recorded
here so it is a decision, not an accident.

### 9.18 Final measured state

`REGRESS OK (spike,min,dense,split)`. **0 errors and 0 label collisions on all
five sheets.**

| sheet | score | vs session start | errors | crossings | labels | fill |
|---|---|---|---|---|---|---|
| spike | 1009 | 1276 → **1009** (−21 %) | 0 | 22 | 0 | 85 % |
| dense | 327 | 1441 → **327** (−77 %) | 0 | 7 | 0 | 28 % |
| min | 58 | 62 → **58** | 0 | 0 | 0 | 11 % |
| split | 36 | 36 → 36 | 0 | 0 | 0 | 27 % |
| **demo** | **203** | 335 → **203** (−39 %) | 0 | 3 | **0** | 27 % → 44 % |

Re-blessed `spike` and `dense` only. `min` and `split` are byte-identical
(verified) — untouched by every change here. Both re-blesses are deliberate:
spike 1065 → 1009 is a genuine improvement, dense 309 → 327 trades two crossings
for a label collision and is a real, if small, regression.

The demo sheet now reads as a single clean process line (TK-101 → V-101 → P-101 →
manifold → V-104 → OP-101) with the drain and the relief both leaving the sheet
correctly, instead of a cluster with a 280 mm diagonal across it.

### 9.20 NEGATIVE RESULT — a sheet-utilisation term in the fitness meter

**The observation that started this.** The meter is structurally blind to the
void, and worse, it is *biased toward* it. Every term in it rewards compactness —
shorter runs (`len`), fewer bends (`bend`), shorter signals (`sig`), closer taps
(`tap`), fewer crossings. Not one term asks how much of the sheet the drawing
occupies. So the placement search has had no reason ever to prefer a fuller sheet,
and across 9.12–9.17 it reliably took the most cramped candidate available.

That is a real defect in the objective, not a cosmetic complaint. A P&ID that
leaves 44 % of the sheet empty is a worse deliverable, and the meter was scoring
it as better.

**What I did.** Added a `util` weight (140) on `max(0, 1 - min(useW, useH))`, and
gave the search a lever to act on it by adding `minSep` as a third search
dimension (`minSepAlt`), since minimum separation is the only thing that trades
vertical extent against run length.

**It was wrong, and measurement said so twice.**

1. **It was a bad proxy.** It measured only pipe geometry, so it read the demo
   at **32 % useH** where the entity-aware audit `[11]` reads **56 %** — a 2x
   under-measure. Most of what makes a drawing tall is symbols and label stacks,
   which are not in `geometries`.

2. **Having no lever, it only added cost.** Scores rose with **no layout change
   at all** on the sheets that could not possibly improve, and it punished
   exactly the wrong cases:

| sheet | before | with `util` | layout changed? |
|---|---|---|---|
| spike | 1009 | 1061 | no (already 94 %×90 %) |
| dense | 327 | 392 | marginally |
| **min** | **58** | **186** | **no** |
| **split** | **36** | **135** | **no** |
| demo | 203 | 299 | no (still 79 %W / 56 %H) |

`min.dsl` is two valves. It is *supposed* to be a small drawing, and `[13] sparse
sheet` already reports that honestly instead of distorting it. The term charged
it 113 points for the crime of being small, and changed nothing about it.

**Reverted.** The weight key is removed entirely (not set to 0 — that changed the
serialised weights and broke the byte comparison in regress, which is a useful
canary). `minSep` is kept as a working, documented third search dimension but
**deduped against `minSep`**, so the default still renders the same 6 candidates
at the same 410 ms. Enabling it is a deliberate act, not a silent 2x slowdown.

**Why the void is structural — the measurement that settles it.** Sweeping all
18 candidates (3 orders x 2 sweep counts x 3 separations), with a per-candidate
extent measurement:

| order | sweeps | minSep | score | crossings | useW | useH |
|---|---|---|---|---|---|---|
| JVI | 0 | 45/75/110 | 307 | 2 | **65 %** | 30 % |
| JVI | 8 | 45 | 299 | 3 | **65 %** | 32 % |
| JVI | 8 | 75 | 357 | 5 | **65 %** | 35 % |
| JVI | 8 | 110 | 361 | 7 | **65 %** | 50 % |
| VJI | 0 | any | 642 | 9 | 39 % | 91 % |

**`useW` is pinned at 65 % for every single candidate.** Nothing the engine can do
changes it, because the demo is one long horizontal process run and the sheet is
1.55:1. Height can be bought (`minSep` 110: 30 % → 50 % useH) but only with
crossings, and the only candidates with tall extents are the `VJI` ones that strand
valves at the foot of the sheet (9.16) — tall because they are *wrong*, not
because they are well-spread.

**Row stretching re-tested and the old negative result HOLDS.** Since 9.2's
`ROW_SOLVED` was measured on the pre-median-assignment algorithm, it was re-run on
the current one, scoring and extent together:

| rowSpacing | total score | total fill | note |
|---|---|---|---|
| 145 (current) | 1633 | 195 | |
| 160 | 1755 | 204 | |
| **175** | **2634** | 196 | 1 error appears |
| 190 | 1891 | 200 | |
| 205 | 1828 | 202 | |

Note the third column: **stretching does not increase sheet use at all** (195 →
204, i.e. nothing). `[11]`'s area-% cannot distinguish "compact in the middle"
from "spread across the sheet" — spreading moves boxes without adding area. The
extent measure is the honest one, and it does not improve either.

**The actual conclusion.** At the locked decision `1 unit = 1 mm` (the 2026-09-06
scale decision) on a fixed ARCH/ANSI **D** sheet, this content genuinely occupies
a small area, and the whitespace is *correct*. A human drafter with this process
on a 24x36 sheet would either accept the margin or move to a smaller sheet — they
would not stretch the geometry, because 3.5 mm text is 3.5 mm on paper and
enlarging it would make the text wrong. **The sheet is oversized for the content,
not the layout wrong.** The right responses are the ones already in the plan:
`[13] sparse sheet` reporting it honestly, split-the-sheet, or a richer demo
(item 8) — none of which is a layout-engine fix.

**What I got wrong in the framing.** I opened this investigation by calling the
void a layout bug. It is not. I should have checked the aspect-ratio arithmetic
(one horizontal run, 1.55:1 sheet) before proposing a score change, which would
have saved the whole detour.

### 9.21 Full-engine evaluation (2026-09-25)

Two independent subsystem audits (instrumentation; routing) plus a symbols/validator
sweep. Ranked by measured impact, not by how easy they were to fix.

**Fixed this pass**

| # | Defect | Where | Effect |
|---|---|---|---|
| 1 | Instrument signal ports emitted the lead-out on the **wrong side** | `pid-router.js:1450-1455` | demo 203 → **184** |
| 2 | Instrument bubbles ignored each other's **label zone** | `passInstruments` avoidBoxes | dense 327 → **248** |
| 3 | `freeSlot` searched a fixed dy×dx ladder, not by displacement | `passInstruments` | part of #2 |
| 4 | A\* give-up was **completely silent** | `pid-router.js` A\* fallback | now reported |

**#1 is the one both audits found independently, and it is the exact backtrack I
had already measured but mis-attributed.** `sides[]` mixed *port positions* with
*outward normals*; the two horizontal entries carried the negated normal, so any
signal separated more in x than y drew a 14mm stub **backwards through its own
bubble**. The lead was baked in before A\* was consulted, the `directCost < 1`
early return skipped the orthogonality repair, `removeFoldBacks` needs three
same-axis points so it cannot see a two-point reversal, and `PIDEngine.crossing`
returns `null` for same-orientation pairs so **no validator could ever see it**.
The sheet scored clean while drawing a line through itself.

**#2** was FIC-101 sitting on V-102/V-103's tag stacks. Bubbles were excluded from
the keep-out set entirely; the only bubble-vs-bubble separation was a 45mm radius
on footprint centres, which clears the 12mm metal and lands on the text.

**Not fixed, with reasons**

- **A\* failure fallback** (`pid-router.js:1166`) returns the direct route through
  every hard block, un-warned. Now *counted* (`score.lines.astarGiveups`) but
  deliberately **not scored** — see 9.23.
- **`crossesLine` never called** (`pid-router.js:1271`): the A\* smoothing pass can
  reintroduce a crossing the search avoided, contradicting the comment above it.
  Not touched: it needs a correctness argument about shortcut cost, not a patch.
- **`collideSegHitsRect` refuses sub-0.5mm diagonals** as "never occur in routing"
  (`pid-collide.js:38`) — but the grid snap at `pid-renderer.js:361` manufactures
  exactly-0.5mm jogs, so it does occur. Silent false negatives in the tap
  host-body check. Real, needs the snap fixed first.
- **Tier C's `fieldPartner` is structurally unreachable** — it is computed under
  `!drivenId`, and `byId` excludes instruments, so a controller with a signal to a
  valve never considers its field partner. The outer comment (`:396-399`) claims
  the opposite of what `:464-480` does. **A comment lying about behaviour is worse
  than a bug**, because it stops the next reader looking.
- **`loop` modifier is silently clobbered** (`pid-parser.js:370-371`):
  `Object.assign(inst, validateTag(...))` overwrites `inst.loop` set by
  `parseModifiers`. `loop FC-101` becomes `101`.
- **Only the first tap per instrument is honoured** (`pipes.find(...)` at
  `pid-renderer.js:1116`) — a second `tap` line is silently dropped.
- **Taps are invisible to the whole geometry audit** — they are not in
  `geometries`, so `PID-GEO-001/002/003/005/006`, `PID-SHT-001` and
  `COLLINEAR_OVERLAP` structurally cannot see one.
- **`PID-INS-004` can only detect a bubble sitting ON the line**, never an
  over-long drop — the exact defect being chased. There is no check anywhere for
  "instrument too far from its host"; `tapReachTotal` is a score term only.
- **ISA-5.1 letterforms not implemented** — `glyphKeyOf` keys on `bubble` only, so
  an FT transmitter and an FIC controller both get a generic circle. `data.loops`
  is built and never rendered: no loop callout, no loop ID on lines.
- **Dead code**: `crossesLine`, `overlapsCount`, `collide.indexOf`,
  `collide.nearby`, `collide.nozzleBox`, `PIDEngine.glyphKey`,
  `PIDEngine.anchorOffset`, the `TAPROOT_ON` bisect block, `isRealCrossing`'s
  `gap` param, `exclude.dest`, `data.flowRank`/`flowCycles`, `availH`, and two
  orphaned JSDoc blocks. Six further comment/code mismatches catalogued.

### 9.22 Two more negative results

**Line-tap elevation alignment — reverted, twice.** The bubble is stacked off the
host's *bounding box*, but a `.line` tap must land on a process *run* at nozzle
elevation, tens of mm lower, which is what produced the 60mm lateral doglegs in
the taps. Aligning the bubble to the run's elevation is the right idea and it
failed twice:

1. First attempt read `p._tap.lineTap` and `data.nozzles`. Both are populated
   *after* `autoLayout` runs (`resolveTopology` and `materializeNozzles` are later
   in `parse`), so the code was **silently dead** — every metric was byte-identical.
2. Rewired to the host's port geometry, it fired: **spike 1051 → 2161**, with
   `maxSignalLen` 225 → 475mm. It pushed bubbles into other instruments' signal
   lanes; the damage landed in the *signals*, not the taps it was meant to help.

Kept as a documented, inert seam. **The transferable lesson is the first attempt,
not the second: a change that moves no metric is not a null result, it is dead
code wearing a fix's clothes.** The tell was available for free — I'd just spent
effort re-running the suite and seen nothing change.

**Give-up weight sweep.** See 9.23.

### 9.23 NEGATIVE RESULT — pricing the A\* give-up

`dense` was found to contain one genuine give-up, and `dense` scored 248 while the
demo's winning candidate had **five**. A silent capability failure that the meter
could not see looked like exactly the class of defect worth pricing, so I swept
the weight:

| weight | spike | dense | demo | total | labels | give-ups |
|---|---|---|---|---|---|---|
| **0** | 1051 (1 lbl) | 248 (1g) | **199 (0 lbl)** | **1592** | **1** | 6 |
| 10 | 1051 (1 lbl) | 258 (1g) | 212 (**1 lbl**) | 1615 | 2 | 1 |
| 20 | 1051 (1 lbl) | 268 (1g) | 212 (1 lbl) | 1625 | 2 | 1 |
| 45 | 1051 (1 lbl) | 293 (1g) | 212 (1 lbl) | 1650 | 2 | 1 |
| 90 | 1051 (1 lbl) | 338 (1g) | 212 (1 lbl) | 1695 | 2 | 1 |

Any weight ≥ 10 clears the demo's give-ups (5 → 0) and **introduces a label
collision** (0 → 1). The search is not mispricing randomness here — it is
correctly trading. A flat cost cannot distinguish a benign overlap with a sibling
stub (invisible) from a line driven straight through a pump symbol (very visible),
and with one number for both, the cheapest way to satisfy the meter is to move a
visible defect out of the way. **The demo at weight 0 is the version I rendered
and looked at, and it is the better drawing.**

So: the count is **reported** (`score.lines.astarGiveups`) and **not scored**.
The remedy for a high count is the obstacle budget and the sub-0.5mm-diagonal
defects, not the meter. This is the second time in this document that adding a
term to the fitness function made the output worse — the first was sheet
utilisation (9.20). **Pattern worth keeping: before adding a score term, check
whether the engine has a lever that can act on it, and whether one number can
distinguish the cases the term is meant to separate.**

### 9.24 Final measured state

`REGRESS OK (spike,min,dense,split)`. Demo render 355ms, 0 errors, 0 label
collisions, 0 ungapped crossings, 0 debug-gate failures.

| sheet | score | errors | crossings | labels | give-ups | extent |
|---|---|---|---|---|---|---|
| spike | 1051 | 0 | 21 | 1 | 0 | 96%W × 94%H |
| dense | **248** | 0 | 4 | 0 | 1 | 61%W × 45%H |
| min | 58 | 0 | 0 | 0 | 0 | 58%W × 19%H |
| split | 36 | 0 | 0 | 0 | 0 | 55%W × 49%H |
| **demo** | **199** | 0 | **2** | **0** | 5 | 79%W × 56%H |

Session total across the four regression sheets: 3150 → **1393**. Demo: 335 →
**199** (−41%), crossings 3 → 2, label collisions 0, fill 27% → 44%.

Re-blessed `spike` and `dense` after the instrumentation fixes, then **all four**
once more when `astarGiveups` was added to the score object — a new diagnostic
field changes the serialised weights/geometry hash by construction, so that
re-bless is bookkeeping, not a quality move. Both are deliberate and recorded.

`spike` carries 1 label collision and `dense` 1 give-up. Neither is hidden; both
are in the table above and both are in the "not fixed" list of 9.21.

### 9.26 Architectural assessment — what is actually wrong with the engine

Everything above is a *local* defect. This section is the structural read, because
the local defects are not independent: they share causes, and the causes are
bigger than any of them.

**The parts are better than the architecture.** The ISA-5.1/PIP symbol library with
real connection points, the validator's rule vocabulary, the theme system, the
determinism of the default path, the sheet viewer, the DSL round-trip — all good,
all worth keeping. What is missing is a *model*: there is no single description
of what the drawing must satisfy, and no way to tell whether the output improved.

#### D1 The pipeline order is a hidden, load-bearing invariant that contradicts the data dependencies

`parse()` runs, in order: `autoLayout` (pid-parser.js:465) → sheet clamp (471) →
`resolveOverlaps` (480) → grid-align (484) → `resolveOverlaps` (490) →
`validateModel` (500) → `resolveTopology` (501) → `materializeNozzles` (502) →
`resolveNozzlePositions` (503).

So **layout runs before topology resolution and before nozzles exist.** Anything
in layout that needs a resolved port, a nozzle tip, or a validated tap is reading
`undefined`. I hit this twice in one afternoon (§9.22) and both attempts were
*silent no-ops* — the metrics did not move, which is the only reason I noticed.

There are **11 separate sites** that write entity `x`/`y`. `resolveOverlaps` runs
twice with grid-align between, and its own comment concedes the snap "can push
separated neighbors back together" — so final positions can be off-grid, breaking
an invariant the engine asserts elsewhere. `passJunctions` must precede
`passValves` (the comment cites a cascade bug). `passDecrowd` and `passTerminals`
run after everything. Then `resolveOverlaps` moves hosts *again*, after their
instrument bubbles were stacked on them.

#### D2 Constraints are expressed as pass order, not as constraints

Every layout defect in this document has the same shape: *pass X moved something
pass Y had already placed.* The fixes were all additive — a repair pass, a veto, or
a search over orderings. That is the signature of a system with no way to
*declare* what must be true.

There is no list anywhere of what must be on-sheet, what must not overlap, what
must stay attached to what, and what merely prefers to be near what. Valve
enforcement is a constraint. De-crowding is a constraint. Terminal anchoring is a
constraint. The instrument tier is a *preference*. These are different kinds of
statement and they are all just code, in sequence.

Consequence: satisfiability cannot be reasoned about, every fix is local, and so
the failures are global.

#### D3 The objective is a proxy, and the search is exploiting the gaps in it

Three times in this document the score chose a worse drawing: the sheet-use term
(§9.20), the give-up weight (§9.23), and my own override of the label weight
(§9.17). The search maximises that scalar hard — 6 placement candidates plus
routing seeds — so a mismatch between "what the score measures" and "what a good
P&ID looks like" does not average out. **A search is an amplifier: it finds the
best point of whatever function you hand it, including the holes in that
function.**

And there is no ground truth to check against. Every judgement call in this
session was "render a PNG and look at it" — roughly six times, and twice I shipped
something I then had to revert. That is a habit, not a process.

#### D4 Layout and evaluation are entangled, and that is the ceiling on quality

Measured this session:

| sheet | 1 render (no search) | 6-candidate search | implied per-candidate |
|---|---|---|---|
| spike | 462 ms | 1802 ms | ~300 ms |
| dense | 133 ms | 495 ms | ~82 ms |
| demo | 97 ms | 355 ms | ~59 ms |

`autoLayout` itself is ~0.03 ms. **Roughly 99 % of the search's cost is routing and
validation, not layout.** A layout cannot be scored without being fully routed.

That single fact explains three things at once: the search is capped at six
candidates; the landscape is chaotic (a 1 mm position change re-routes everything
downstream, and A\* is discrete); and the order/sweep/minSep "search" is a
hand-picked lottery rather than a search. A layout optimiser wants thousands of
cheap evaluations. This one can afford six expensive ones.

#### D5 The domain model is missing its central concept

A P&ID is a document about **instrument loops**. ISA-5.1 loop identification is the
organising principle: a measurement point, a transmitter, an indication, a control
function, a final element, and the signal edges joining them.

This engine thinks in *pipes and instruments*. `data.loops` is built by the
validator and consumed by nothing (§9.21). There is no loop callout and no loop ID
on lines. So instrumentation is bolted on: bubbles are placed by heuristics
against *equipment*, not as members of a loop; and there are **three separate
routers** — process lines (A\* + four repair passes), signals (A\*), and taps
(shortest-of-N plus a lane dodge, no router at all) — with three different obstacle
models.

#### D6 Geometry is authored in three places that disagree

`autoLayout` places entities, `renderInto` routes and emits, `pid-validator.js`
audits. The validator tests a subtly different model than the router produces.
`collideSegHitsRect` refuses sub-0.5 mm diagonals on the stated premise that
"non-axis segments never occur in routing" — and the grid snap at
pid-renderer.js:361 manufactures exactly-0.5 mm jogs, so it does occur, and the
checker silently reports "no hit" for them. `PID-GEO-005` samples only segment
midpoints.

#### D7 Small surface, large blast radius, no visual ground truth

The DSL surface is small, which is good, but each rule touches every sheet.
`regress` catches scalar regressions well and cannot see "the demo looks worse".
No visual baseline exists anywhere in the repo.

#### The uncomfortable summary

Every defect in this document is a **sequencing or grounding** problem, not an
algorithmic one: an inverted normal, a wrong tier, an orphaned anchor, an
assumption about which stage has data, a sub-0.5 mm assumption, a comment that
contradicts its code. Not one is "the algorithm is too slow" or "the heuristic is
not clever enough".

That pattern — high-quality components, defects that are all about *order and
grounding* — is the signature of a system that grew by accretion without an
explicit model. The remedy is not better algorithms. It is a model, a declared
constraint set, and a way to tell whether the output got better.

The forward plan that follows from this is `P&ID-ENGINE-REDESIGN.md`.
`P&ID-AUTO-QUALITY-PLAN.md` is deliberately left intact: it is an append-only
record with obituaries for every reverted attempt, and that record is the most
valuable artefact in the repo. Rewriting it would destroy the evidence.

### 9.28 Symbol audit — anchors, basepoints, metadata, grid

New tool: **`audit-symbols.mjs`** (201 symbols, 15 checks). It parses each glyph's
own primitives to measure its content bbox, then tests it against the metadata the
engine actually relies on. **Two bugs in the audit itself were found and fixed
before any of its output was believed** — both would have produced confident
false findings:

1. Every number in a `<path d="...">` was fed in as *both* an x and a y. So
   `flow-nozzle`'s real content `(15,20)-(145,60)` was reported as
   `(15,15)-(145,145)`, inventing 30 `SYM-CLIPPED` findings that did not exist.
2. Then the *point* helper itself was wrong — `put(min(x,y), min(x,y), max(x,y),
   max(x,y))` turns a point into a box. Corrected to `put(x, y, x, y)`, and
   `SYM-CLIPPED` fell 30 → 6.
3. Relative path commands (`q4 -6 8 0`) were read as absolute, so
   `thermal-flowmeter` appeared to reach `y=-6` and be clipped when its true
   extent is `y=12..50`, well inside. Fixed by tracking the current point;
   `SYM-CLIPPED` 10 → 6.

Both audit and fix script are now hand-validated: `flow-nozzle` correctly leaves
the clipped list, and `thermal-flowmeter`'s reported content centre `(80,31)`
matches a hand count of `x 10..150, y 12..50`.

#### The headline: most of the metadata is wrong AND unused

Measured consumption across the five live engine files:

| field | read by engine |
|---|---|
| `size`, `svg`, `ports[].{id,type,x,y}` | **yes** |
| `ports[].cardinality` | yes (5 sites) |
| `ports[].flowDirection` | yes (3 sites) |
| `anchor` | **no** — only via `PIDEngine.anchorOffset`, which has zero call sites |
| `extents` | **no** — 0 sites |
| `labelAnchor` | **no** — 0 sites |
| `flowAxis`, `autoRotate`, `rotatable` | **no** — 0 sites |
| `behavior` (incl. `minProcessPorts`, `safety`) | **no** — 0 sites |
| `standard`, `allowedTypes`, `connectionType` | **no** — 0 sites |
| `ports[].lead` (14 on every port) | **no** — the engine uses `routing.minPortRun` = 14 instead, so the per-port value is decorative |

So of **631 findings, ~25 are load-bearing.** The rest is documentation that is
frequently wrong (100 wrong `anchor`s, 56 wrong `extents`, 195 `labelAnchor`s
outside their viewBox, 35 `behavior.minProcessPorts` promises with no ports
behind them) — and wrong documentation is its own hazard, because it is what the
next maintainer will trust.

#### The load-bearing defect: ports are placed by a formula the browser does not use

`embedSymbolRaw` nests the glyph's own `<svg viewBox>` inside a **square**
`width=size height=size` box, so the browser applies `preserveAspectRatio` and
**letterboxes any non-square viewBox**. But ports are computed as
`(pct-50)/100 * size` in **both** axes (`anchorAt`, `PIDEngine.connWorld`). That
identity is exact only when the viewBox is square.

**123 of 201 symbols have a non-square viewBox. 20 have a port drawn measurably
away from where the engine puts it** — 0.38 mm to **12.50 mm**. Worst offenders:

| symbol | viewBox | drift |
|---|---|---|
| `isa-5.1/flow-elements/flow-nozzle` | 160×80 | **12.50 mm** |
| `isa-5.1/flow-elements/venturi-tube` | 160×80 | **12.50 mm** |
| `isa-5.1/flow-elements/rotameter` | 120×110 | 3.33 mm |
| `isa-5.1/valves/control-valve` | 100×83.33 | 0.83 mm |
| `isa-5.1/valves/ball`, `globe`, `three-way`, `motor-operated-gate` | 100×83.33 | 0.83 mm |
| `pip/equipment/vessel-vertical`, `vessel-horizontal`, `tank-cone-roof`, `column-tower`, `compressor`, `filter`, `heat-exchanger-shell-tube` | 130×120 | 0.38–1.85 mm |

Not fixed here, deliberately: correcting it changes geometry on 123 symbols, and
the only gate available is a scalar score with no visual baseline (Stage 0 of the
redesign plan). This belongs after that baseline exists.

#### The clipping defect: PSV-101 was never drawn with its spring — FIXED

`isa-5.1/valves/relief-safety` has `<rect y="-4.17">` and a path at
`M43.33 -23.3` — **the spring sits 23 units above `y=0`**, outside its
`viewBox="0 0 100 116.67"`, and the `discharge` port is at `(50,0)`, the very top
of the viewBox. So the entire spring — the visual signature of a pressure safety
valve — was clipped away and **PSV-101 rendered as a bare triangle** on the demo
sheet.

Telling detail: the recorded `extents.y0` is `-24.3`. The metadata author *knew*
the glyph reached above zero, recorded it, and never widened the viewBox.

**Fix:** `fix-symbol-viewbox.mjs` widens the viewBox to contain the content **and
every port**, recomputing each port's percentage so it stays at the same
*absolute* viewBox position. Geometry-neutral apart from the recovered ink.

The dry run caught two bugs in the fix itself before it was applied:
- Padding by 1 unit flagged **67** symbols instead of 6, because content merely
  *touching* the viewBox edge is not clipped.
- Squeezing the viewBox to the metal alone put `steam-trap`'s ports — which sit
  *outside* the body by design, to give lead-in room — at pct **−46 / +146**,
  outside the new viewBox. Hence the union with port positions.

Six symbols fixed: `isa-5.1/valves/relief-safety`, `pip/fittings/elbow-90`,
`pip/valves/relief-valve`, `y32.11-1961/furnaces/box-furnace`,
`.../shell-and-tube-exchanger`, `.../tanks/spherical-tank`.

**It improved the metrics, which is a good sign it was a real defect:**
`spike` 1051 → **995**, crossings 21 → **19**, ungapped 2 → **1**. Only `spike`
needed a re-bless. Verified visually: PSV-101 now renders as body + spring + stub.

**Hazard recorded:** `restore-bundle.mjs` regenerates `pid-symbols-bundle.js` from
`pid-backup-tmp.js` and would silently revert this. The same change must be
applied there, or that script retired.

#### Grid alignment

- `SYM-GRID-SIZE`: **0 findings** — every `size` is a multiple of 5 mm. Good.
- `SYM-GRID-PORT`: **97 findings** — port world offsets are not on the 5 mm
  drafting grid. The offset is `(pct-50)/100*size`, so a 10 mm valve at pct 90
  lands 4.00 mm off centre, and a 15 mm level gauge lands 5.25 mm off. Sub-grid
  steps come from small `size` values, not from the port percentages.

#### Two sources of truth inside a single glyph

`gravity-separator` and `knockout-drum` embed their own
`<metadata><connections>` in the SVG, and those coordinates **disagree with the
bundle's `ports`** (4 conflicts, e.g. `gas_out` at `y=30` vs `y=35`). Inert at
runtime — the engine reads the bundle — but a maintainer reading the glyph gets a
different answer than the engine gets.

### 9.30 NEGATIVE RESULT — the aspect-aware port fix is correct and was still reverted

§9.28 found the one remaining load-bearing symbol defect: ports are placed by
`(pct-50)/100*size` in both axes, which is only true for a square viewBox, and 123
of 201 symbols are not square. With the visual baseline (Stage 0) now in place,
this became safe to attempt, so I implemented it properly.

**Implementation.** One shared helper, `PIDEngine.portOffset(symbolKey, conn, size)`,
computing what the browser actually does — uniform scale `min(size/vw, size/vh)`
plus the letterbox offset — and `portDirXY` for the direction, which is wrong for
the same reason. All six open-coded sites routed through it: `connWorld`,
`anchorAt`, the valve/equipment port snap, the valve mating offset, `nozzleTip`,
and the dead `anchorOffset`.

Verified the safety invariant first: for a square viewBox the helper reduces
**exactly** to the naive formula — 175/175 square ports identical to 0.000000 mm —
so it could only ever affect non-square symbols.

**And it made every sheet worse.**

| configuration | spike | dense | min | split | demo | total |
|---|---|---|---|---|---|---|
| **naive (kept)** | **995** | 248 | **58** | **36** | **199** | **1536** |
| all six sites corrected | 1051 | 288 | 63 | 38 | 227 | 1667 |
| all but `nozzleTip` position | 1569 | 228 | 63 | 36 | 225 | 2121 |

I isolated it rather than shrugging: correcting only the direction changed
nothing (identical scores), and excluding the nozzle *position* moved spike
995 → **1569**. So the nozzle base position is the load-bearing piece.

**Why.** The naive formula is wrong about the *ink* but **self-consistent with
everything else in the engine**: the 5/20 mm grid alignment, the cardinal snapping
of nozzle directions, the collision margins and the 14 mm lead-in were all
calibrated against it. Correcting one term of a coupled system moves it off its
optimum unless the others are re-tuned in the same change. This is the same lesson
as the score terms (§9.20, §9.23) arriving from the opposite direction: there,
adding a term to the objective made it worse; here, correcting a value *outside*
the objective made it worse.

**The visible cost of leaving it is near zero.** 18 of the 20 drifting symbols are
under 2 mm on a 10–100 mm body — invisible at print scale — and the two 12.50 mm
offenders (`flow-nozzle`, `venturi-tube`) appear on **no sheet in the corpus**.

**Decision: reverted.** `portOffset`/`portDirXY` are kept in `PIDEngine`,
documented with this table and the reason, so Stage 1/2 can adopt them *together
with* re-tuning the grid and lead-in constants rather than re-running this
experiment. `audit-symbols.mjs` reports `SYM-PORT-DRIFT` and will show when the
drift itself is finally closed. Revert verified pixel-identical: all five sheets
0.000% against the visual baseline, and `REGRESS OK` with no re-bless.

### 9.32 Three correctness defects fixed (T6.5, T6.6, T6.12, T7.5)

All verified before and after; `REGRESS OK` and all five sheets pixel-identical.

**T6.5 — the explicit `loop` modifier was silently clobbered.** `parseModifiers` set
`inst.loop`, then `Object.assign(inst, validateTag(...))` overwrote it with a value
*derived from the tag's digits*. Verified: `instrument LT-1 field "level" loop
FC-101` produced `loop === "1"`. An author's explicit loop must beat a value
inferred from the tag — writing it is precisely because the tag doesn't encode the
loop. Fixed by capturing the explicit value and restoring it after the assign.

**T6.6 — a second tap on the same instrument was silently dropped.** This was worse
than the audit described. The model keeps both taps, the geometry pre-pass used
`pipes.find(...)` so only the first got geometry, the **emitter** then used
`tapGeos.find(t => t.tag === inst.tag)` and drew only the first, and **zero
warnings** were emitted. Fixed at both levels: the pre-pass iterates all taps, and
the emitter emits each with a disambiguated `data-pid-id` (`tap-TAG-2`). The
existing `laneTaken` dodge already existed to keep multiple drops off one vertical,
so the machinery was there and unused.

Proven with a new fixture (`regress/_twotap.dsl`, two `.line` taps on one
instrument): 1 leader before, **2** after, 0 errors. Worth noting the fixture took
three attempts to get valid — a nozzle takes one connection, so tapping the same
nozzle twice is *correctly* refused, and a `.line` tap is the pattern that doesn't
consume the nozzle slot. The engine was right and my first two fixtures were wrong.

**T6.12 — `ruleEnabled()` deleted, and the 12 `enabled: false` rules relabelled.**
`ruleEnabled` was never called, and all 12 disabled rules are referenced zero times
in the validator/renderer/router/parser, so the `enabled` flag could not filter
anything — a switch that did nothing, which reads as working. Deleted rather than
wired up, and the block is now explicitly labelled *specified, not implemented*.
A filter that silently passes everything would hide that state; a caller that
cannot find the function gets a loud error instead.

**T7.5 — the two-sources-of-truth conflict resolved.** Three symbols embed their own
`<metadata><connections>` in the SVG with coordinates that disagreed with the
bundle's `ports`. Synced the embedded copy to the bundle, which is authoritative.
`SYM-META-CONFLICT` 4 → 0 (631 → 627 findings).

### 9.33 T1 reassessed — and why it was not attempted

The plan's Stage 1 was "move topology resolution before `autoLayout`". Checked
before attempting, and **it does not hold as stated**: `resolveTopology` reads
entity positions 31 times. It derives `p._from` / `p._to` world coordinates, so it
is genuinely position-dependent and cannot simply be moved earlier. Doing it
properly means **splitting** it into a position-free assignment pass and a
position-dependent geometry pass — a ~300-line refactor.

Its headline payoff had also already evaporated: the one thing it would unlock,
tap-elevation alignment, measured *worse* when attempted via port geometry (§9.22).

So Stage 1 is re-scoped from "reorder" to **"split `resolveTopology`"**, and it
belongs after the visual gate has gated something real. Recorded rather than
half-started, because a pipeline reorder that cannot be finished and verified is
the exact failure mode this document keeps running into.

### 9.35 `preview.mjs` — looking at the output without a screenshot round-trip

Every layout judgement in this document was made by rendering a sheet and looking
at it. That had been done with throwaway scripts in `%TEMP%`, which is not a
process. **`preview.mjs`** makes it one command, in the repo:

```
node preview.mjs                                contact sheet of all cases
node preview.mjs --case=demo                    one full-size sheet
node preview.mjs --case=demo --zoom=400,190,170,120   magnified crop, mm
node preview.mjs --theme=cad                    CAD (black) theme
node preview.mjs --out=regress/preview --width=2400
```

Writes `<out>/<case>.png` and, for the multi-case run, `<out>/_contact.png` — a
labelled grid of the whole corpus, so it can be reviewed in one look. A fresh
`--user-data-dir` per run, because Chrome caches `file://` scripts by URL and that
staleness produced a convincing but wrong screenshot earlier in this project.

`--zoom` takes **sheet millimetres**, the only coordinate system anyone reading a
P&ID has, and rebuilds the root viewBox. It failed on the first run and rendered
the whole sheet: the captured attribute string still contained the original
`viewBox`, and a duplicate attribute resolves first-wins, so the crop was silently
ignored. Stripped it, and it now errors rather than silently returning the full
sheet if the rewrite does not take.

**What it immediately showed, that the numbers had not:**

1. **The §9.20 utilisation finding, visually.** The contact sheet makes it plain —
   `spike` fills its sheet, while `dense`, `demo` and `split` are mostly white.
   One image, no measurement. This is the tool paying for itself.
2. **A phantom I nearly reported — the ~90 mm rectangle.** At high magnification
   the manifold cluster appears to sit inside a large box. There is no such rect
   anywhere in the SVG; it is PI-101's tap and FT-101's signal routing forming an
   open rectangle. Caught by grepping the geometry.
3. **A second phantom, which I DID report and then had to retract.** I claimed the
   line-number tag `3"-HC-102-1C1-H-INS-25` collided with FIC-101's loop number
   and that `audit-svg [7]` missed it. Recomputing both boxes with
   `pidTextBoxes`' own maths: the spec runs x **409.22–452.78**, FIC-101's `101`
   starts at x **462.03** — a **9.25 mm gap**, and 0.36 mm vertically. Recomputing
   all 50 text boxes from scratch gives **0 collisions**, agreeing with the engine.
   The error was mine: I estimated the tag's width by eye as "~60 mm" when it is
   43.6 mm, and eyeballed a text extent on a zoomed raster when the exact geometry
   was sitting in the file. **T6.2b was struck from the plan.**

**The lesson, and it is the same one three times over this document:** a magnified
picture is good for *deciding to measure* and bad for *concluding*. Both phantoms
here died the moment the numbers were read instead of the pixels. The tool is worth
having precisely because it is also geometry you can grep — a screenshot is not.

**What the tool is actually good for:** noticing that something *looks* wrong and
getting a coordinate to measure. The utilisation difference in item 1 is a real
finding that no number in the harness flagged, and it took one look. The two false
positives took one grep each. That is a good trade and the reason the tool belongs
next to the harness rather than in a temp folder — but the discipline has to be
"look, then measure", not "look, then report".

### 9.37 `PID-INS-006` added — the check that was missing entirely (T6.1)

`PID-INS-004` tests `|reach| < taps.minReach` (3 mm) — it can only ever see a
bubble **sitting on** the line. It is structurally blind to the opposite and far
more common failure: a bubble **stranded far** from the point it measures, reached
by a long lateral dogleg. That was the defect chased by eye in §9.21, and there
was no rule for it anywhere in the validator.

**Threshold from the corpus, not a guess.** Measured bubble-to-host distance for
all 12 taps across the five sheets: **min 35, median 55, p75 60, max 96.6 mm**.
`taps.maxReach = 75` separates the genuine outliers from the 35–60 mm band, and is
registry-driven so it can be tuned rather than edited.

It fires on three real cases — the two I had already spotted by eye, plus one I
had not:

| sheet | tap | distance |
|---|---|---|
| demo | `PI-101 -> P-101` | **101.2 mm** |
| spike | `LT-102 -> D-101` | **110.0 mm** |
| spike | `TT-101 -> R-101` | 93.0 mm |

`spike` and `dense` re-blessed (2 and 1 new warnings respectively; `dense` gained
the count through the score's `warn` weight). Geometry is unchanged — the visual
baseline is 0.000% on all five sheets, and the score movement is exactly the
warning cost.

**Honest limitation, stated in the code:** this measures bubble-to-**host-centre**,
not along the tap polyline, because the polyline is built in the renderer and this
validator cannot see it — which is T6.2. So it is a proxy and will read high when a
tap takes a detour. T6.2 would make it exact. It is a warning, not an error, for
that reason.

### 9.38 Correction to §9.35 — the label "collision" was a phantom

§9.35 reported that the line-number tag `3"-HC-102-1C1-H-INS-25` collides with
FIC-101's loop number and that `audit-svg [7]` misses it. **It does not collide,
and the audit was right.**

Recomputing both boxes with `pidTextBoxes`' own arithmetic: the tag runs
x **409.22 – 452.78**, y 226.86 – 231.00. FIC-101's `101` starts at x **462.03**.
That is a **9.25 mm horizontal gap** and 0.36 mm vertically. Recomputing all 50
text boxes from scratch gives **0 collisions**, agreeing with the engine.

The error was mine: I estimated the tag's width by eye as "~60 mm" when it is
43.6 mm. **T6.2b is struck from the plan.**

Two phantoms in a row from the same tool, both killed by reading the geometry
instead of the picture. The lesson is not "the tool is bad" — it is **"look, then
measure"**. The tool is genuinely good at the first half: the §9.20 utilisation
difference is a real finding no number in the harness flagged, and it took one
look. Both false positives cost one grep each. Worth keeping, provided the
discipline holds.

### 9.39 A real routing defect the zoom surfaced: a 26 mm hop routed 325 mm

While chasing the phantom rectangle (§9.40) the geometry turned up something
genuine. Pipe **`J-1 -> V-103`** is routed:

```
M 470 245 L 470 190 L 350 190 L 350 220 L 440 220 L 440 250
```

`J-1` is at (470,245) and `V-103` is at (445,250) — **26 mm apart**. The route goes
55 mm up, **120 mm left**, 30 mm down, **90 mm right**, 30 mm down: five segments,
**~325 mm of pipe for a 26 mm hop**, and it is the single largest contributor to
the demo's `routing.length`.

This is a genuine defect and it was invisible to every number in the harness,
because it is not a *crossing*, not an *overlap*, not *off-sheet* and not *non-ortho*
— it is perfectly legal, perfectly orthogonal, and just absurdly long for what it
connects. The score's `len` term (0.05/mm) charges it ~16 points, which is
noise against a total of 199.

It is almost certainly congestion: `V-102`, `V-103`, `V-105` and `J-1` sit in a
45×25 mm cluster, sibling stubs become hard-blocked cells, and A\* takes the wide
way round rather than give up. That is the correct trade *given the alternatives*,
but 325 mm for 26 mm is not a trade a drafter would accept, and it is the strongest
argument yet for the manifold fan-out that has been outstanding since §9.13.

**Candidate fix for later, not attempted here:** charge excess length *relative to
the straight-line distance* rather than absolute length. A pipe 10× its own
straight-line span is worth flagging even when nothing collides. That is a new score
term, and per §9.20/§9.23 **no new score term ships before the visual baseline can
check it** — so this is recorded, not built.

### 9.40 Correction to §9.38 — and to my own correction. There is no stray rectangle

I have now made this claim three times and been wrong twice, so let me settle it
with geometry rather than by looking:

- **First claim (§9.35):** "the manifold cluster sits inside a ~90 mm rectangle."
  Wrong — and my check was too narrow: I grepped `x > 380` and the feature starts
  at ~370, so I excluded it and concluded no such element existed.
- **Second claim (this session):** "there *is* a 120×30 mm rect, I was wrong to
  dismiss it." Also wrong. There is **no `<rect>`, no `<line>`, no `<polygon>` and
  no stray path** anywhere in that region.
- **What it actually is:** the routed pipe above. `J-1 -> V-103` runs
  `(470,245)→(470,190)→(350,190)→(350,220)→(440,220)→(440,250)`, and that staple,
  seen next to FT-101's dashed signal and PI-101's tap, reads as a box at high
  magnification.

**The lesson, which is the real content of this section.** I twice asserted a
conclusion from a magnified raster, and twice the pixels were a lie of omission —
the first time I filtered the search too narrowly, the second time I trusted the
image over the geometry I had already been given. The zoom is good at *deciding to
measure*; it is bad at *concluding*. Every phantom in this document died the moment
a number was read, and every real finding (§9.20 utilisation, §9.37 tap reach,
§9.39 the 325 mm staple) came from measuring something a picture pointed at.

**Process change, made because of this:** `preview.mjs` should print the
coordinates of whatever region it is showing, so the eye has something to check
against instead of guessing. Adding that.

### 9.41 Taps join the in-engine geometry audit (T6.2) — and a correction

**Correction first, because the original claim was too broad.** I previously wrote
that taps were "invisible to the entire geometry audit". That is wrong:
`audit-svg.mjs` explicitly matches `data-pid-id="tap-`, counts them, and feeds
them into its crossing check — so `regress`'s audit diffs have always seen tap
crossings. The real and much narrower gap was that the **in-engine**
`validateGeometry` was only ever handed `geometries`, while taps live in a separate
`tapGeos` array, so `PID-GEO-001/005` and `PID-SHT-001` could not see them.

`validateGeometry` now takes `tapGeos` and runs three checks over taps:

| check | why a tap can fail it |
|---|---|
| `PID-GEO-001` non-orthogonal leg | taps are built from H/V candidates, so this is an invariant, not a guess |
| `PID-GEO-005` passes through a symbol | a tap driven across a pump body |
| `PID-SHT-001` leaves the sheet | a tap running off the border |

**Deliberately excluded, to avoid double-reporting** — and this is the part that
matters: crossings (audit-svg already counts them, and tap crossings are cut
separately via `t.cuts`, so counting here too would double), `COLLINEAR_OVERLAP`
(`PID-INS-005` already reports a tap sharing a process corridor), and lead-in
(a tap attaches to a bubble, which has no nozzle lead).

**The corpus is clean**: `REGRESS OK` with no re-bless, so no existing tap violates
any of the three.

**All three proven non-vacuous.** A check that cannot fire is worse than no check
— the same failure mode `visual-regress.mjs` had on its first cut. Each was
verified by deliberately breaking it:

| mutation | fires |
|---|---|
| unmodified | — (clean) |
| one tap point nudged 3 mm off-axis | `PID-GEO-001` ×3 |
| one tap point driven to y = −200 | `+ PID-SHT-001` ×3 |
| a horizontal tap leg straddling TK-101 | `+ PID-GEO-005` ×2 |

The third mutation needed two attempts: moving a single point made the leg
non-orthogonal, so `GEO-001` fired first and `GEO-005` was never reached. `GEO-005`
tests the segment **midpoint** against the symbol's central 50%, so the whole leg
has to straddle the symbol. Worth knowing before anyone tries to reproduce this.

### 9.42 `PID-INS-006` recalibrated — the metric took three attempts

T6.2 made the tap polyline visible to the validator, which turned `PID-INS-006`
from a proxy into a measurement — and immediately showed the proxy was measuring
the wrong thing. Three versions:

| # | metric | fires | verdict |
|---|---|---|---|
| 1 | bubble → host **centre** | 3 | wrong quantity: charges for how big the host is, not how far the tap travels |
| 2 | total **run** length | 6 | worse: a tap is *supposed* to travel vertically from bubble to line, so run length charges for correct behaviour. 3 of the 6 were false alarms |
| 3 | **sideways (lateral) travel** | 7 | correct |

What the rule is actually about is the *lateral dogleg* — the sideways travel
needed because the bubble does not sit above its landing point. Measured across
all 12 taps in the corpus, lateral travel is:

```
0 x5   11   24  |  38   55   66   81   mm
^ perfectly straight   ^ clean break   ^ real defects
```

`taps.maxLateral = 30` separates them with nothing marginal. The worst case is
instructive: demo `LT-101` runs **114.5 mm to reach a point 33.5 mm away — 81 mm
of it sideways.**

Seven genuine findings (spike 4, demo 3): every tap in the corpus with a real
dogleg. Five of the twelve taps are perfectly straight drops; the rest either have
a small dogleg (11–24 mm, tolerated) or a real one (38–81 mm, flagged).

`spike` and `dense` re-blessed. Geometry unchanged, visual baseline 0.000% on all
five sheets; the score movement is the warning cost only.

**A measurement trap worth recording.** My first corpus survey used
`globalThis.__pidGeo` to recover the tap polylines. That global **accumulates
across all six candidates in the placement search**, so it reported `spike FT-101`
as having 0 mm of lateral travel when the winning candidate has 59 mm. The rule
reads the authoritative per-render `tapGeos` and is right; the survey was wrong.
A module-level debug global is not a reliable source once a search runs more than
one candidate through it.

### 9.44 The control valve: ports were not on the flow axis at all

Reported from the demo sheet: "something about the control valve's base or anchor
points seems very off." It was much worse than an anchor being off.

#### The defect

Ports are stored as a **percentage of the viewBox**. The ISA valve viewBox is
`0 0 100 83.33` — **83.33 tall, not 100** — but the percentages were authored as if
every viewBox were square. So `pct 50` resolves to viewBox `y = 41.67`, while the
bowtie's flow axis is at `y = 50`. There are two distinct errors:

| symbols | axis is at | port says | resolves to | error |
|---|---|---|---|---|
| `gate` `ball` `globe` `butterfly` `needle-valve` `three-way` | y 50 | pct 50 | y 41.67 | **0.83 mm high** |
| `control-valve` `motor-operated-gate` | y 66.67 | pct 100 | y 83.33 | **1.67 mm low** |

The second is worse in kind: pct 100 is the bowtie's **bottom edge**, not its waist.
Correct value is pct 80.

**A second, independent error stacks on top.** The engine's port offset is
`(pct - 50) / 100 * size`, which ignores the letterbox padding a non-square viewBox
gets. For `control-valve` the drawn port and the engine's belief differ by a further
0.83 mm, so the pipe lands **2.5 mm below the flow axis** — past the bowtie's bottom
corner, with a visible air gap. The valve is not connected to its process line at all.

#### Verified three ways, not one

1. **By hand** off the raw path data: `M16.67 50 L16.67 83.33 L50 66.67 Z` — the two
   triangles meet at `(50, 66.67)`. That is the flow axis. pct 100 is not it.
2. **Geometrically**, by a tool with a self-test (§9.45).
3. **By eye.** Rendered before and after. Before: the pipe runs *underneath* the
   valve, tangent to nothing. After: the pipe arrives exactly at the waist. Also
   checked `V-102` on `spike` and the gate valve on the probe sheet — both now pass
   through the waist.

#### The fix

`fix-valve-ports.mjs` (new) — dry-run by default, `--write` to apply, re-verifies
from the file it just wrote. It edits only the 8 affected symbols' text by brace-
matched surgery, so the other 193 stay byte-identical. 16 ports moved; all 16
re-verified on axis. Idempotent: a second run reports 0.

#### The honest cost: the corpus score got WORSE

| case | before | after |
|---|---|---|
| `spike` | 995 | 1185 |
| `dense` | 248 | 293 |
| `min` | 58 | 63 |
| `split` | 36 | 40 |

**All four regressed.** Cause: the ports moved, so every pipe now terminates at a
different coordinate, and the router's grid alignment, cardinal snapping and 14 mm
lead-in were all tuned against the *wrong* anchors. `bends` rose (micro-bends
appear where a pipe now has to jog); crossings and ungapped crossings fell on
`spike`.

This is §9.22 again, and it is the fourth time: **a geometrically correct change can
score worse because the rest of the system was tuned around the bug.** The score is
a proxy. The sheets were rendered and looked at, the valves are right, and the fix
stands. What it bought is a concrete, measured motivation for the router re-tuning
that T3 was already asking for.

Not re-blessing the visual baseline would have been the wrong call too — but note
that re-blessing makes `visual-regress` report 0.000% trivially (baseline vs itself).
It proves determinism, not correctness. The correctness claim here rests on the
before/after renders, not on that number.

#### Three things this did NOT fix

- **The letterbox error in `portOffset` remains.** With correct data the residual is
  0.167 mm for the `vb.h=83.33` group and 0.5 mm for the control-valve group. This
  is T7.2 / aspect-aware port mapping, reverted in §9.22 — but that revert was
  measured against *broken* port data, so the conclusion no longer holds and it
  should be re-run on the corrected library.
- **Ports sit at the symbol's bounding-box edge, not at the metal.** `control-valve`'s
  bowtie starts at viewBox x 16.67 while its port is at x 0, leaving a 1.67 mm gap;
  the gate valves leave 0.83 mm. 60 of 259 ports are >1 mm clear of the drawn metal.
  This is a *separate* class (the axis fix moved ports along y, not x) and needs a
  per-family decision about lead-in stubs — `angle-valve` draws an explicit stub,
  `control-valve` does not. Not auto-fixed.
- **`angle-valve` is reported as NOT CHECKABLE, not as fixed.** It has a stub line
  running to x=0, which drags the symbol's x-extent to 0..66.67 and puts the derived
  midline at 33.33 instead of 50. Its two triangles disagree, so the corroboration
  test rejects it. It looks genuinely wrong — its inlet stub is drawn at y=75 while
  the port says pct 50 = y 50 — but that needs a human, not a rule that guesses.

### 9.45 Obituary: five attempts at detecting the flow axis, all wrong

The axis has to be found from the drawn geometry rather than hand-listed, so it
scales. Five sampling-based approaches were tried. **Every one was wrong in a
different way, and every one was caught by the self-test — none by reading the
code.** The tally, since the failures are the useful part:

| # | approach | how it failed |
|---|---|---|
| 1 | narrowest horizontal band | a bowtie's outer edges are parallel, so width is *constant*; picked the stem on all 74 symbols |
| 2 | narrowest band, `M` fixed | same — and `M` was drawing a phantom segment from the origin, corrupting the bbox |
| 3 | minimum gap between left and right ink | the apex sits exactly on the split line, so the gap never reached zero; minimum landed a band low |
| 4 | gap + per-side sample count | at 200 bands the densified paths put ~1 sample per band, so the count test rejected everything — **65 findings collapsed to 0** |
| 5 | gap + shortest zero-gap run | finer sampling put single points on the midline, creating spurious 1-band "pinches" |

Attempt 4 is the one worth remembering: **a tool going from 65 findings to 0 is not
a result, it is a symptom.** The same instinct that caught three phantoms off a
magnified raster (§9.35, §9.38, §9.40) is what caught this — a sudden clean
report is a reason to check the tool, not to celebrate.

Two real parser bugs surfaced on the way and are worth keeping regardless:

- **`M` was treated as a drawing command**, so every path left phantom ink from the
  origin to its first point, corrupting every derived extent.
- **A trailing `Z` was silently dropped.** The tokenizer consumes `Z` as a command
  letter and the loop then exits without acting on it. Every ISA valve triangle ends
  that way, so the third edge — the one forming the inner boundary at the apex — was
  missing from every symbol in the library.

#### What finally worked

The rule that survived is trivial and has nothing to sample:

> A bowtie is drawn as `M x0 y0 L x1 y1 L xA yA Z`. The apex `(xA, yA)` is a **path
> vertex** on the symbol's horizontal midline, and **both** triangles must put their
> apex at the same y.

No densification, no bands, no curve flattening, nothing to get wrong — and a
human can confirm it in one second. The two-triangle-agreement requirement is what
kills the false positives. Self-test against three hand-read values
(`gate` 50, `control-valve` 66.67, `ball` 50) passes, and it is the thing that caught
all five failures above.

Lesson worth keeping: **when a geometric invariant is hard to detect, it is usually
because the right formulation is a structural fact about the data, not a measurement
of the rendered ink.** Five rounds of measuring ink to recover something one vertex
lookup gives exactly.

### 9.46 Two tooling notes from this pass

- **`preview.mjs` gained `--src=<file>`** so ad-hoc symbol and geometry probes can be
  rendered and looked at, not just the blessed corpus. Every phantom in this project
  came from concluding without looking, and a throwaway fixture is exactly the thing
  you most want to look at.
- **The SVG's `x=`/`y=` attributes are NOT sheet coordinates.** Content sits inside
  `<g transform="translate(20 22)">`, so positions read out of the SVG are 20 mm left
  and 22 mm above where they appear on the sheet. This cost three wrong `--zoom`
  regions and one entirely blank crop. `preview.mjs --zoom` takes *sheet* mm, which
  is the only coordinate system a person reading a P&ID has. Worth remembering before
  trusting any position read out of the file.

### 9.48 "Nothing is on the grid" — the observation is real, my first two explanations were wrong

Reported from the demo page: "turned on the grid, zoomed in, not a single thing is
snapped/aligned." The observation is correct. **Both of my explanations for it were
wrong**, and the second survived a good deal of confident arithmetic before a control
run killed it. Kept in full, because the failures are the useful part.

#### What is actually true

Measured against **entity centres** and **route vertices**, with `view.grid` = 5 mm:

| | entities on the 5 mm grid | route vertices on 5 mm | worst-axis offset from grid |
|---|---|---|---|
| `demo` | 19/19 | 26/87 | median 1.00 mm, max 2.00 |
| `spike` | 33/34 | 53/240 | median 1.00 mm, max 2.50 |
| `dense` | 14/14 | 18/80 | median 1.00 mm, max 2.50 |
| `min` | 6/6 | 4/21 | median 1.00 mm, max 2.50 |
| `split` | 6/6 | 2/19 | median 1.00 mm, max 2.50 |

**Entity placement is on the grid.** The parser snaps every centre at
`pid-parser.js:571`, and it survives `autoLayout` — 33/34 on `spike` with no fix of
any kind. The thing that is *not* on the grid is the **pipe work**, and it misses by
1–2.5 mm.

**Why the pipes miss, and why that is deliberate.** A pipe must start *exactly* at
its port, and a port offset is `(pct - 50) / 100 * size`. With symbol sizes
10/15/20/40 mm and pct values like 60 or 80, that yields 1.0, 1.5, 2.0 and 2.5 mm
offsets. Interior bends *are* snapped; the endpoints cannot be, because snapping
them would lift the pipe off its port. The code already says so at
`pid-renderer.js:350` — "grid-align interior bend points (**ports stay exact**)".
So a route is on-grid everywhere it is free to be, and off-grid only where exact
attachment wins. The residual is 1–2.5 mm at the ends: invisible at working zoom,
obvious at the zoom the user was at. That is the honest answer to the report.

#### Wrong explanation #1: "the grid is 20 mm"

My first probe read the pitch from the rendered SVG with `grid="([\d.]+)"`. The
rendered SVG carries no such attribute, the regex missed, and the probe fell through
to **its own `|| 20` fallback**. The number was manufactured by the tool's error
path; `view.grid` is initialised to `5` at `pid-parser.js:285`. A silent fallback in
a measurement script is indistinguishable from a measurement.

Related, also disproved: `pid-renderer.js:2374` omits the `grid` directive when
`v.grid === 5` while the parser defaults to 20, which looks like a silent 5-to-20
corruption on round-trip. Tested — `grid 5` in, `toSource` emits nothing, re-parse
yields **5**. Correct, because 5 *is* the default. No bug.

#### Wrong explanation #2: "entities sit on a 2.5 mm half-cell"

The second probe read `<svg x= y=>` from each symbol group and reported a striking
histogram: coordinates mod 5 mm landing on exactly two values, `0.00` and `2.50`, in
a fixed ratio. That is a textbook emergent-lattice signature, and I wrote it up as a
real half-cell lattice — a by-product of the 5 mm A* cell, declared nowhere.

It was an **artefact of measuring the wrong point**. `<svg x y>` is the symbol's box
**corner**, i.e. `centre - halfSize`. A 10 mm symbol has halfSize 5, so an on-grid
centre gives an on-grid corner. A **15 mm** symbol has halfSize 7.5, so a perfectly
aligned centre still yields a corner 2.5 mm off — and instruments are 15 mm. The
`0.00 / 2.50` split was simply even-sized symbols versus odd-sized symbols.

Caught by building the fix and then **running the control**: with the new
`gridAlign` pass disabled, centres were *already* 33/34 on the grid. A change cannot
be justified by the state it was written against, so the state was wrong. Probing
the "before" state properly — rather than trusting the first number that looked
plausible — is the only reason this was caught at all.

The `gridAlign` pass was then **reverted**. It fired 34 times on `spike` and 17 on
`demo`, fixed exactly **one** further aligned entity, and moved the `spike` score by
43. It was solving a problem that did not exist, and it did not touch the pipes,
which is what was actually wrong.

#### One real bug found and fixed

Five sites read `view.grid || 20`. `view.grid` is **always** defined, so all five
were dead — and `pid-parser.js:571` is the *snapping* pitch. Had it ever fired, the
parser would have snapped to 20 mm while the overlay drew 5 mm: the identical
symptom from a different cause, and silently. All five now read `|| 5`, matching the
schema, and `REGRESS OK` came back with no re-bless — which is the proof they were
inert and the fix is free.

#### What is left

Nothing in the engine is mis-snapping. If grid-aligned routing matters visually, the
lever is **port offsets** — making `(pct-50)/100*size` land on whole millimetres for
the common symbol sizes — not the placement code. That is a symbol-data change with
layout consequences, so it needs the visual baseline and is not attempted here.

### 9.49 Still outstanding after this pass

- **Pipe routes sit 1–2.5 mm off the drawn grid, at their ports only.** Entity
  centres are on the 5 mm grid (19/19, 33/34, 14/14, 6/6, 6/6) and interior bends are
  snapped; the residual is the port endpoints, which are pinned to exact attachment
  by `(pct-50)/100*size`. The lever is port offsets, not placement code. §9.48.
- **Ports do not touch their metal.** 60 of 259 ports sit >1 mm clear of the drawn
  content. The valve family is now *correctly placed on its axis* but still short of
  the body by 0.83–1.67 mm, because ports are authored at the bounding-box edge and
  the bodies are inset. A per-family lead-in stub decision, not an auto-fix (§9.44).
- **`portOffset` still ignores the letterbox** (T7.2). Residual 0.167 mm on the
  `vb.h=83.33` valves, 0.5 mm on the control-valve group. The §9.22 revert of this
  was measured against broken port data and should be re-run.
- **The router is now tuned against stale anchors.** Correcting the valve ports moved
  every pipe terminus and pushed all four corpus scores up (§9.44). The valves are
  right and the scores are worse; closing that gap is the same re-tuning T3 asks for,
  now with a measured reason.
- **`angle-valve` is unchecked**, not fixed — see §9.44.
- **Instrument tier reads as disconnected.** LT / FT / PI / FIC float well above
  their hosts on long dashed runs; LT's bubble in particular sits far left with
  a line that reaches nothing. This is the most visible remaining defect and is
  the natural next target.
- **Parallel manifold branches still share a narrow band.** Labels no longer
  collide, but V-102 / V-103 / V-105 / FV-101 remain within ~45 mm of x. A true
  fan-out (not a stack) is the structural answer and is untouched.
- **Demo fill is 44 %** — up from 27 %, but the sheet is still sparse. `[13]`
  reports it honestly; the structural answer is a richer demo sheet (item 8).
- `spike`'s 22 crossings and 12 warnings are the Phase-5 residuals the plan
  already documents as structural. Not chased here.
- Untouched: legend (F7), text-size consolidation, signal pricing (F4), sheet
  constants (item 7), richer demo (item 8), symbol conformance (D8).

### 9.4 Still outstanding (unchanged by this work)

The demo sheet remains sparse — centring cannot manufacture content, and stretching
was rejected on evidence. That is precisely the case for the **`[13] sparse sheet`**
check from §4: the honest response to an under-filled sheet is to say so, not to
contort the geometry.

Remaining items 2–8 are untouched and still sequenced as in §6.

### Resolved since Rev 1
- ~~Is the target print or screen?~~ → **Print, fixed ARCH/ANSI D.** Screen legibility
  is a viewer's concern (D7), not a geometry concern.
- ~~Should sheets vary in size?~~ → **No.** Fixed media; Option B withdrawn.
- ~~Raise the text floor?~~ → **No.** Sizes are print-correct; see D5.
- ~~Is process-line colour free to change?~~ → **Yes**, and it is now a theme system
  (D4) rather than a recolour. §8 Q4 above is now a palette-choice question, not a
  permission question.
