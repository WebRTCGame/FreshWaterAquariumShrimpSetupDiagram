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

### 9.50 `PID-TXT-001` — annotation type outside the print-legibility band

Requested: a runtime warning for any component/line text that is under- or
over-size. Added, and it immediately reports a standing finding on all five sheets.

#### The mechanism it hooks

Every annotation run in the drawing goes through **one** function, so the check is
exhaustive without touching a single call site (which would rot the moment someone
adds a label):

```js
fs(n) = max(round(n * textScale * typeScale, 1dp), typeFloor)
textScale = max(0.85, symbolScale)     typeScale = 1.4     typeFloor = 3.5
```

Base sizes in use: 1.8 / 2.2 / 2.3 / 2.6 / 2.8 / 3.0 / 3.2. Title-block, legend and
north-arrow text does **not** come through `fs` — it is authored with literal sizes in
its own unit space — so the scope is annotation type and not sheet furniture, with no
filter needed.

#### What it found

| | emitted sizes | count |
|---|---|---|
| annotation type | **3.5, 3.6, 3.9, 4.2, 4.5 mm** | 290 runs over 5 sheets |
| title block etc. | 5, 6, 8, 11 mm | out of scope, correctly |

The project's stated print-correct sizes are **3.5 mm body, 2.6 mm line tags**. Every
size the engine actually emits is **at or above the top of that band**. So the check
does not pass today — it reports, once per sheet:

> `[PID-TXT-001] annotation type OVER: 24 run(s) at 3.6mm, 34 run(s) at 3.9mm, 12 run(s)
> at 4.2mm, 34 run(s) at 4.5mm — above the 3.5mm print limit; largest 4.5mm.`

**This is a real design tension, not a bug I should quietly fix.** `typeScale 1.4`
inflates the base sizes — a 2.6 mm line tag becomes 3.6 mm — and the requirement says
explicitly *do not inflate them*. Either the base sizes are the print-correct ones and
`typeScale` is screen-legibility that should not ship, or the band is stale. That is a
decision for the drafter, so the check reports it rather than resolving it. The
defaults were deliberately **not** widened to match current behaviour: a check that
blesses the gap it exists to report is not a check.

#### A second finding the message carries

`typeFloor = 3.5` **binds** for every base at or below 3.5/1.4 = **2.50 mm**, so
`fs(1.8)`, `fs(2.2)` and `fs(2.3)` all render at *exactly* 3.5 mm. Three distinct roles
are flattened onto one size and are no longer individually distinguishable — the
nozzle size, the line-spec text and the valve state text are the same size by
accident, not by design. The warning says so, because a reader seeing "3.5 mm" has no
way to know three roles collapsed into it.

#### Reported aggregated, on purpose

One warning per offending **size**, not per run. At `typeScale 1.4` roughly 265 of 290
runs are over the band; 265 identical warnings would be noise that trains the reader
to ignore the check. The message carries the run counts and the worst case instead.

#### Non-vacuous in both directions

A check that can only report OVER is half a check, and one that fires unconditionally
is worse than none. Both proven by driving the registry in memory and re-rendering:

| | result |
|---|---|
| defaults, band 2.6–3.5 | fires **OVER** |
| `typeFloor` 1.5 (text can drop below 2.6) | fires **UNDER** as well |
| band widened to 1.0–9.0 (fits reality) | **silent** — it measures, it does not always warn |
| `typeScale` 3 (huge type) | fires **OVER** |

Third row is the one that matters: a check that goes quiet when the band is satisfied
is measuring something real.

#### Cost

One warning per sheet, +5 score each (spike 988→993, dense 294→299, min 63→68,
split 40→45). That is the check working, not a regression — the score is paying for a
true finding. Re-blessed. Geometry unchanged.

New registry params: `annotation.sizeMin` 2.6, `annotation.sizeMax` 3.5,
`annotation.sizeScopeMin` 0 (suppress a size with fewer runs than this).

### 9.52 "Too squished" — two hypotheses killed, and the real defect is at junctions

Reported: the demo sheet is "definitely too squished", with a suggestion to use
"every other lane" for routing. The suggestion was directionally right and
mechanically wrong, and two rounds of measurement were needed to find out which.

#### It is not crowding, and it is not the pipe work

Clearance between parallel runs of different lines, whole corpus:

| sheet | co-linear pairs | median gap | p90 | ≤6 mm |
|---|---|---|---|---|
| `demo` | 50 | 19 mm | 34 mm | 8 (16%) |
| `spike` | 152 | 24.5 mm | 35 mm | 12 (8%) |
| `dense` | 55 | 25 mm | 35 mm | 2 (4%) |
| `min` | 8 | 35 mm | 38 mm | 0 |
| `split` | 0 | — | — | — |

Median clearance is 19–35 mm. The corpus is not tight. The gaps cluster at
10/15/25/30/35 mm — grid-locked to the 5 mm A* cell, which is what the "lanes" idea
is really seeing, but 25 mm apart does not read as squished.

#### The demo is under-ALLOCATED, not over-packed

| sheet | entities | content bbox | of drawable | entity centre spread |
|---|---|---|---|---|
| **`demo`** | 14 | 533×180 mm | **64% W × 39% H** | **170 of 463 mm** |
| `spike` | 28 | 735×383 mm | 89% W × 83% H | 318 mm |
| `dense` | 11 | 440×178 mm | 53% W × 38% H | 110 mm |
| `min` | 5 | 345×73 mm | 42% W × 16% H | 35 mm |

**`spike` is well-allocated.** The demo uses 39% of usable height. Content aspect is
**2.96:1** against a drawable **1.79:1** — it is far too wide to be tall, so it *cannot*
fill the height without first being made narrower. Widening the crowded part (the
"every other lane" plan) pushes the content further from the sheet's shape, not closer.

The honest reading is that a 14-entity chain topology simply does not fill a 24×36 in
sheet, and the response is a **richer demo** (already item 8), not a layout change.

#### `layout.minSep` does nothing — measured, not assumed

Swept 45 → 55 → 65 → 80 → 95 mm in memory:

| minSep | `demo` score | `demo` %W×H | `demo` tightest |
|---|---|---|---|
| 45 / 55 / 65 / 80 / 95 | **235 at every value** | **64% × 39%** | **0.0 mm** |

The demo is *byte-identical* across the whole range. `minSep` is the vertical
separation for entities **sharing a depth**, and the demo's entities mostly do not
share one — the rank structure already separates them diagonally. The knob that looks
like it controls vertical spread does not, for this topology.

`spike` moved only at 55 mm, and **worse** (83%×75% against 89%×83%).

#### The real defect: lines that MEET at a junction run coincident

Tightest clearance on `demo` is **0.0 mm** — two runs at the same coordinate, and
invariant to every parameter swept above:

```
gap 0.0mm over 8mm at x=470   V-102 -> J-1   and   J-1 -> PSV-101
gap 0.0mm over 6mm at x=445   J-1  -> PSV-101 and  PSV-101 -> OP-CD
```

Two lines meeting at a junction should diverge at once. These run on top of each other
for 6–8 mm, which is exactly what reads as a thick line and gives the "squished"
impression. Everything else on the sheet has 19–35 mm of air.

**Not a lane-penalty problem.** `markLine` already penalises the corridor at 300 and
the adjacent cells at `routing.fieldNear` (35). Swept 35 → 80 → 150 → 250 → 290: the
demo's zero-gap count stays at **2 at every value**. Raising the penalty does nothing.

**Why.** `minPortRun` (14 mm) requires every line to run straight before its first
bend, so a line leaving a junction must continue in a straight line — and "straight
from J-1" is along the corridor the arriving line used. The 8 mm of overlap is the
lead-in. The overlap is a *consequence* of the lead-in rule, not a pressure problem, so
no penalty weight can remove it.

The spike column in that sweep is a **trap worth recording**: 250 scored 885 while 150
scored 972 and 290 scored 919. Non-monotonic across a smooth parameter is search
noise, not a signal — with six candidates per render, a single good value is a
lottery win. Not shipped.

#### What the fix actually is

Not more space — **junction fan-out**: when several lines meet at one node, their
departure directions must differ. That is a new constraint, not a tuning knob, and it
belongs with the T2 constraints registry rather than as a weight tweak. Filed as T3.4.

### 9.54 Overlay checkboxes, and the geometry they were showing

Reported: the demo page's overlay checkboxes "illustrate locations that aren't on the
final layout that I can see, it really makes them useless". Correct, and there were
**two independent bugs**, either of which alone would have made the pipes overlay lie.

#### Bug 1 - coordinate space

The drawing lives inside a content group carrying a margin translate; the overlay
layer is appended as a direct child of the root `<svg>`. So overlays reading entity
coordinates - bbox, ports, labels, and (once checked) pipes and crossings - were drawn
in **content** space and landed offset by the entire margin, while grid and sheet-bounds
were already correct in **sheet** space. The two families disagreed, which is exactly
the symptom reported.

Fixed by reading the content group's own `transform` off the DOM and re-using it.
Deliberately **not** hardcoded: a second copy of the margin constant is what let the
two drift apart in the first place, and it would drift again the moment the margin
changed or the content overflowed and `wrap` took over with a scale-bearing transform.
I also classified the overlays wrong on the first pass - `tog-pipes` and
`tog-crossings` read `__pidGeo[].pts` and are content-space, not sheet-space; only
`tog-grid` and `tog-sheet` are genuinely sheet-space.

#### Bug 2 - stale geometry, the one that made "pipe routes" useless

`window.__pidGeo` is written inside `renderInto`, and **every candidate is a complete
render** ("the lowest `score.total` wins"). So it was written once per candidate and the
last write survived - the last candidate *tried*, not the one that *won*.

| | `__pidGeo` extent | extent actually drawn |
|---|---|---|
| `demo` | y **72..542** | y **222..372** |
| `spike` | y 62..432 | y 87..408 |
| `dense` | y 172..362 | y 182..351 |

Fixed by snapshotting the geometry alongside each candidate and restoring the winner's
on selection. Verified afterwards: `__pidGeo` matches the drawn path extent **exactly**
on demo, spike and dense.

This is the same shared-mutable-state-across-a-search hazard already recorded for the
module globals, reached from a different direction. Worth noting that the earlier
instance was *assumed* to be a bug and turned out to be fine (`__pidGeo` is reassigned,
not pushed, so it does not accumulate) - the check was still worth running, because
the second half of the guess was the one that was wrong.

#### Also in this pass

**All annotation type uppercase**, applied as a **CSS presentation rule**
(`svg[data-theme] text{text-transform:uppercase}`) rather than by mutating the data,
so `toSource()` still round-trips the authored case, the validator still matches the
original strings, and nothing that compares text is affected. Only the drawing changes.

**Known gap this introduces:** the label-collision metric measures the *authored*
strings, and capitals are wider, so a collision visible only after uppercasing is
invisible to it. `REGRESS OK` after the change is expected - and also means the metric
can now under-report. Filed as T4.4.

### 9.56 Is the 3-order search still earning its cost? No - and the proof is why

Asked whether the layout pass sequence should be played with. Before changing it, worth
knowing whether the *existing* search over orders is still pulling its weight - because
the orders were chosen when routing behaved differently, and since then 26 valve ports
moved onto their axis, `crossesLine` was wired in, all type went uppercase, and the A*
started rejecting crossing shortcuts. Any of those could have made one order dominate.

Measured by forcing each order alone (source transformed in memory, engine file never
touched; the substitution is verified and aborts rather than silently measuring the full
search three times):

```
  sheet        JIV      JVI      VJI    winner
  demo         335      235      394    JVI
  spike       1265      993      996    JVI
  dense        438      345      299    VJI
  min           72       68       68    JVI
  split         45       45       45    JIV

  wins: JVI 3   VJI 1   JIV 1
```

**Three distinct winners across five sheets.** No single order is right, so the search is
not redundant and cannot be collapsed to one. The spread is also large - 235 vs 394 on the
demo is 68% - so this is a load-bearing dimension, not a tiebreak.

That is the answer to "should we play with the sequence": the orders already disagree
sheet by sheet, which is the *symptom* of the passes being coupled through each other's
leftovers. Shuffling would not fix that and would need re-shuffling. The cure stays T2 -
declare the constraints so the passes stop depending on sequence at all.

One incidental find: `min` and `split` score identically under all three orders (68/68/68
and 45/45/45). Small sheets do not care about pass order, so the order dimension could be
skipped for them. That is a micro-optimisation, not a correctness issue.

### 9.58 T3.6 equipment tag list, one row across the top

Clones each equipment's own annotation -- the bold underlined tag plus the grey
`TYPE_LABELS[type]` line, honouring the same `noTypeLabel` rule -- into a single row
along the top edge, left to right, sorted naturally by tag. The strings and the rule
are the *same ones the drawing uses*, not a parallel description, so the row cannot
drift from the drawing.

Three design points worth recording, each of which replaced something that looked fine
and was not:

**The band is RESERVED, not drawn into leftover space.** `autoLayout` adds
`equipList.height` to the centring target's `zy0`. Drawing into whatever space happened
to be left would put the list on top of the drawing the moment a sheet filled its sheet,
which is the normal case rather than an edge case. On spike this is visible as the whole
drawing sitting lower, with the content bbox top at y=65 rather than y=42.

**The reserved height is a CONSTANT, deliberately not a per-item pitch.** An earlier
version had the router compute a row count from a per-item pitch. That cannot work:
`fs` is a closure over `textScale` and `annotation.typeScale` inside the renderer, so
the router cannot know the drawn type widths. A row count computed in the router could
disagree with the rows actually drawn, and the list would land on the drawing -- exactly
the failure the reservation exists to prevent. A fixed one-row height cannot disagree:
the renderer packs as many items as fit and prints `+N MORE` for the rest.

**Type sizes are published, not recomputed.** `data.typeMm = {eqTag: fs(3.2),
eqType: fs(2.8)}` comes off the single `fs()` choke point, and `annotationsSvg` reads
it. A third copy of the formula over in the furniture layer is how the overlay
coordinate spaces drifted apart in the first place.

Measured: all 11 items on spike fit in one row (x 28 -> 464 of an 834mm right edge), so
the `+N MORE` path is not exercised by the corpus -- it is verified by reading the emitted
markup, not by a rendered case.

CORRECTION (written in 9.59): the claim that the tag list left the scores unchanged
was **wrong**, and I made the mistake of reading a truncated regression diff. The
`993` I took for the new value was the OLD expected value sitting on the left of the
`->`; the new value was past the truncation. The list actually cost **+307 on spike**
(993 -> 1300), entirely from 12 label collisions.

The cause is in 9.59 and it is worth the whole detour: at 3.6mm between the tag line
and the type line, with `textBox` height 1.15em, the two boxes overlap by 0.9mm, so
**every item in the list collided with itself**. The equipment annotation this list
clones uses 5.5mm for the identical pair of sizes; I had hardcoded 3.6 from stale
numbers, so the clone was drawn tighter than its source. Fixed to 5.5mm the list
scores 967 - better than having no list at all.

Two lessons, both about the same thing. A number read off the end of a truncated diff
line is not a measurement. And a collision count with no names attached is an
unactionable total: the totals said only "worse", while the audit names said
`"C-101" & "column" @(28,30)`, which is a self-collision and names its own cause.

Obituary for the first attempt: a three-column TAG/DESCRIPTION/SERVICE table with a
header rule. It rendered, and it was wrong in a way only looking could catch --
`CIRCULATES PROCESS FLUID THROUGH REACTOR LOOP` ran straight through the SERVICE column
and out past the rule, because the column offsets were hardcoded and the text was not.
Fitting columns to content would have fixed that and still have been the wrong feature.
### 9.59 Valve size from the process line, and the 12 collisions hiding in plain sight

**T7.13 was recorded on a wrong premise.** I had filed it as "pipes do not record
which port they connect to", from a probe that printed `Object.keys(pipe)` and saw
no port field. But that probe read the PRE-resolution record. Pipes carry
`fromPort`/`toPort` when the DSL states them, and the router resolves the rest into
`p._from` / `p._to`, each carrying `conn.id`, `conn.role`, `direction` and the
resolved `nozzle` id. All 16 valve ends on the demo resolve to a port name. The
binding was there the whole time; the probe looked in the wrong place.

The real gap is narrower and stranger: **every nozzle that carries a size has an
EMPTY `portId`**. `NZ-TK-O` is TK-101's 4" outlet, and its `portName` is `''`. So
the composite key `ownerId|portId` - the obvious way to find it - matches nothing, and
a probe using it reports "this model has no size data". It has. The only reliable
link is the resolved `nozzle` id the router already puts on each pipe end.

Getting that wrong twice was instructive, because both times the symptom was
"the data is not there" and the cause was an accessor reading the wrong end of the
pipe:

- first I matched the far entity against the **current** end's port name, so
  `P-101` was looked up as `P-101|right` instead of `P-101|suction`;
- then, inside the walk, I read `p._from` when standing on the `from` end, when the
  far end's state is `_to`.

**The rule that works: nearest equipment wins, and only if unambiguous.** The junction
network is looped, so an unbounded walk wanders round the whole drawing - it returned
`4"x3"` with three sources for a SINGLE valve end, at hop 8. Neither number nor walk
was wrong; the question was. So:

- walk each end through junctions to the NEAREST equipment carrying a sized nozzle
  (`annotation.valveSizeMaxHop`, default 4, and the looped network is why it is capped);
- if the nearest equipment is reached with two different sizes, the end is genuinely
  ambiguous and **nothing is printed** - a guessed valve size is worse than none;
- both ends known and equal prints one size; differing prints the pair `4"x3`, which
  is a reducer. This is the isoconfig `End1`/`End2` idiom: the property belongs to the
  PAIR of ends, so a difference is reported, not resolved by picking a side;
- `v.sizeEvidence` keeps the hop count and the source equipment on the record, so any
  wrong size can be traced back to the nozzle it came from.

Yield: 18/18 valves labelled on spike, dense, min and split, 7/8 on the demo (FV-101's
ends reach nothing sized). **Every printed size was checked to exist on a real
nozzle** - a derived size that cannot be traced to a nozzle is a guess wearing a
number.

The size joins the existing valve label stack as a fourth row at 15.5mm rather than
being positioned independently, so it inherits the above/below flip and the collision
test for free. Consequence worth stating: the user asked for it *above* the valve, and
it renders *below*, because the stack is below-by-default and flips only on collision.
That is the right trade - a fourth free-floating label would have had to reimplement
the flip - but it is a deviation, not compliance.

**What it cost, measured by ablation** (toggle the rule, same process, restore
verified byte-identical by hash):

```
  config                        total   labelCollisions
  both off (pre-feature)          993        1
  tag list on, valve size off     967        2      <- the LIST, fixed
  valve size on, list off        1023        2
  both on (shipped)               997        3
```

So both features together cost **+4 on spike and nothing on dense, min or split**
(997/299/68/45 against the 993/299/68/45 of 9.56). The list is now *better* than no
list. The valve size costs one label collision on the densest sheet in the corpus,
which is an honest trade for a requested feature and is not hidden by the baseline.

The reason the list was ever expensive is the better story. At 3.6mm between the tag
line and the type line, and `textBox` height `1.15em`, the two boxes overlap by 0.9mm:
**each list item collided with itself**, 11 items, 12 collisions, +307 points. The
equipment annotation this list clones uses 5.5mm for the identical pair of sizes. I
had hardcoded 3.6 from stale numbers instead of copying the drawing, so the clone was
drawn tighter than its source. Reading the audit names - `"C-101" & "column" @(28,30)`
- is what identified it; the totals alone said only "worse".
### 9.60 T4.4 attempted, measured, reverted — the width model is not case-sensitive

**Obituary. The fix was correct, addressed a real defect, and was still dead code,
so it is not in the tree.**

T4.4 reads "label-collision metric measures the authored strings, not the drawn ones",
and the justification looked airtight: all drawing type is uppercased by CSS
(`svg[data-theme] text{text-transform:uppercase}`, ~2211), so an estimate made from the
authored string measures a shape that is never rendered, and uppercase is wider, so the
metric under-reports.

I routed all four width estimators through one `drawnWidth(str, fnt)` that uppercases
first, then measured the corpus with and without it:

```
  case                with drawnWidth   without        delta
  spike              997/3            997/3          same
  dense              299/0            299/0          same
  min                 68/0             68/0          same
  split               45/0             45/0          same
```

**Nothing moved**, so it came out. The reason is the part I should have seen first:
the metric does not measure glyphs, it counts **characters** — `str.length * fnt *
0.55` — and `toUpperCase()` does not change `.length` for ordinary text.
"Centrifugal Pump" and "CENTRIFUGAL PUMP" are both 16 characters, both 30.80mm.
The old metric was *right by luck*.

So the real diagnosis is different from the filed one. The defect is **not** that the
metric reads the authored string; it is that a flat 0.55em average advance **cannot
express case at all**. Real uppercase is wider than mixed case at equal character
count — `M W L C G Q` against `i l t I` — and a single average factor discards exactly
that. Uppercasing the string before counting characters is the wrong operation; the
width model has to be per-character, or measured.

The self-test earned its place by failing. Of four cases, the one designed to prove the
check "fires" reported 0 collisions: I had mis-set the gap, and the honest output was
"this does not fire", which is what a vacuous check looks like from the inside. The
other three passed, and would have passed with the fix absent — which is the tell.

Two things a real fix needs, neither cheap:

1. **Measure, do not estimate.** The project already drives headless Chrome for visual
   regression, so `getComputedTextLength()` on the live text node gives the true advance
   for the real font, for the real string, after the CSS transform. That makes the
   metric exact *and* case-correct for free, and it also retires the 0.55em fudge and
   the `1.15em` height guess. This is the fix worth doing.
2. **Or a per-character advance table**, calibrated against the actual drawing face.
   The font is a CSS stack, so the table is only valid for the resolved face — which is
   an argument for (1) rather than against it.

Kept from the attempt: the knowledge that the metric counts characters, and therefore
that **no amount of string-level cleverness will make it case-sensitive**. Anyone who
picks this up again should start at the width model, not at the string.
### 9.61 T3.7 closed — the premise was false, and so was the fix I built for it

T3.7 claimed routing escaped its margins: "measured: `spike` lines reach x 830, past
the 816 entity limit, and `spike` entities themselves reach 820, 4mm outside their own
zone", and wanted a check that tests the zone rather than the sheet.

**The claim is false, and it was a coordinate-space error.** Content sits inside
`<g transform="translate(20 22)">`, so SVG/pre-margin coordinates are 20 less than
sheet coordinates. 830 − 20 = 810, which is inside 816; 820 − 20 = 800, likewise. Both
numbers were pre-margin values read as sheet values. This is the **fourth** time this
trap has produced a false claim in this project, and the third time it was a number I
had already written down.

Measured properly, against every bound that matters:

```
  sheet 0..864 0..559     frame 18..846 / 18..541
  SHEET (routing.sheetMargin 26) 26..838 / 26..533   <- what A* and PID-SHT-001 use
  drawing zone (centring target) 48..816 / 42..481

  case    verts  outSHEET  outFRAME  outZONE
  demo     96         0          0         0
  spike   192         0          0         2      <- 0.5mm on one line
  dense    77         0          0         0
  min      23         0          0         1      <- 8mm, a feed line from off-sheet
  split    19         0          0         0
```

Nothing escapes SHEET anywhere. The 2 zone overshoots are 0.5mm and 8mm, the 8mm being
`FEED-1 -> P-1` on the smallest sheet — a supply arriving from outside the battery
limit, which *should* reach further left than the centring target, because the zone is
a soft target for centring and not a hard bound.

**There are four constants here and all of them are called "margin":**

```
  sheet edge                      0
  border frame (printed)         18
  SHEET / routing bound          26   <- A* bounds and PID-SHT-001
  drawing zone (centring target) 48   <- layout.xMargin 60, halved
```

T3.7 exists because I read SHEET as the sheet edge and the zone as the same thing.
That conflation is the whole defect, and it is a documentation defect rather than a
code one.

#### The check I built for it, and why it came out

I added `PID-SHT-002`, asserting geometry stays inside the printed **frame** (18) rather
than merely inside the sheet — reasoning that the safety was *coincidental*, holding only
while `sheetMargin < 18`, so it should be asserted rather than inherited.

**That reasoning was wrong in a way worth spelling out: 002 is strictly weaker than
001.** Outside-SHEET (26) is a strict subset of outside-FRAME (18), so 002 can never
fire on geometry 001 has not already reported. It is not a weaker check, it is a
redundant one. Removed.

It was also caught by a self-test that could not do its job. I tried to demonstrate the
gap by loosening `sheetMargin` to 5, expecting 001 silent and 002 firing. Instead both
went silent — because loosening the bound changes the layout, and the routes changed
enough that nothing violated anything. **A self-test whose failure mode is "the thing
under test stopped happening" is not a self-test of that thing.** The honest signal was
in the impossibility argument above, which was available before I wrote any code.

#### A probe that lied, and what it cost

Midway through, a probe reported **21 `PID-SHT-001` warnings on spike** at the shipped
default, and a `__pidGeo` scan reported **0 vertices outside SHEET**. Both cannot be
true, and I spent real effort on it.

Resolution: the probe was running with `PID-SHT-002` still in the tree. With the shipped
code, `PID-SHT-001` fires **0 times, deterministic across 5 identical runs**, and 0
vertices escape SHEET. The 21 is **not reproducible with shipped code and I could not
explain it**, so I am recording it as unexplained rather than building on it. It is the
one loose end here.

Two process notes. First, the count itself was briefly wrong: I counted occurrences of
the bare string `PID-SHT-001` in harness output, which matches a diagnostic list of
every check code the validator knows about, and reported 21 "warnings" on a sheet that
emits none. Count the message, not the code. Second, the toggle-a-rule-on-disk probe is
genuinely dangerous: `harness2.mjs` exits non-zero when it emits warnings — which is
exactly the outcome under test — and the throw skipped the restore, leaving
`sheetMargin: 5` in the working tree. `spawnSync` plus `try/finally` is the only safe
shape for that pattern, and the restore must be hash-verified.

#### What T3.7 actually leaves behind

No code change; the tree is byte-identical to the last commit. The deliverable is the
four-constant table above, which should be the first thing anyone reads before touching
margins again. `T3.7` is closed as **not a defect**.
### 9.62 T3.4 — symptom confirmed, cause refuted, remedy not justified

The filed item had three claims. Two did not survive measurement.

**1. The symptom is real, and rarer than stated.** Exactly **one** coincident run
exists in the whole corpus, matching the filed description:

```
  case    junctions  fan-out pairs  <2mm apart  sharing >=3mm
  demo        5            7             7                1     <- 8.3mm at x=470
  spike       5            4             4                0
  dense       2            2             2                0
  min         1            0             0                0
  split       2            0             0                0
```

The many `0.00mm` readings are **not** the defect: every one of them is two lines
touching **at the junction node**, which is what lines meeting at a node are supposed
to do. Measuring point-to-point distance without excluding the shared node makes a
correct drawing look broken. Only the *collinear overlap away from the node* counts,
and there is one of those.

The geometry, printed rather than described:

```
  V-102->J-1     (470,261) (470,250)                    arrives UP from below
  J-1->PSV-101   (470,250) (470,258) (470,260) (465,260) (465,274)
```

So a line **departing** the junction doubles back down the arriving line's corridor
for 8.3mm, then turns away. Two coincident segments are drawn twice, so the line is
locally thicker there. Real, visible, and one instance.

**2. The cause is NOT `minPortRun`.** The item blames "the overlap being forced by
`minPortRun` (14mm), which requires a line leaving a junction to run straight".
Swept 4 / 8 / 14 / 20 / 28mm:

```
  minPortRun 14mm -> coincident 8.3mm   (A 4 pts, B 7 pts)
  minPortRun  8mm -> coincident 8.3mm   (A 4 pts, B 7 pts)
  minPortRun  4mm -> coincident 8.3mm   (A 4 pts, B 7 pts)
  minPortRun 20mm -> coincident 8.3mm   (A 4 pts, B 7 pts)
  minPortRun 28mm -> coincident 8.3mm   (A 4 pts, B 7 pts)
```

**Byte-identical across a 7x range of the rule.** The attribution is not merely
unsupported, it is refuted. Note the shape of the result: a smooth parameter with a
completely flat response is *evidence of absence*, not a null result — it says the
rule is not in the causal path at all. Contrast §9.52, where `fieldNear` moved
non-monotonically and was rejected as search noise.

**3. The proposed remedy is not justified by the evidence.** The item asks for "a new
constraint, not a weight: departure directions at a shared node must differ", to be
added to the T2 constraints registry. One occurrence in fourteen fan-out pairs, from
a mechanism the sweep rules out, does not justify new registry infrastructure — that
would be building a general mechanism for a single data point, and T2 is already the
item I flagged as too large to start blind.

**Re-scoped T3.4** is a *narrow local* question, not a registry one: why does a line
leaving J-1 take a departure direction that retraces the arriving corridor? The three
collinear vertices `(470,250) (470,258) (470,260)` are the hint — a shared-polyline
cleaner should collapse collinear runs, so either these come from different sources
(a junction lead-in stub plus a route that agrees with it) or the cleaner is skipping
them because the endpoints differ. That is a lead-in-direction question, answerable in
one place, and it is the right next step **if** anyone wants this instance fixed.

What this needs before it can be worked on properly is a **corpus that exercises
junctions**: `min` and `split` have zero fan-out pairs, and 14 pairs across five
sheets is too small a sample to design a constraint against. That is a fixture gap,
and it is the honest blocker — not the constraint registry.
### 9.63 `manifold.dsl` — the fixture T3.4 was missing, and what it immediately exposed

9.62 ended with the honest conclusion that T3.4 cannot be worked on: one occurrence in
fourteen fan-out pairs, `min` and `split` producing **zero** fan-out pairs, and a cause
the sweep refuted. The blocker named was a **fixture gap**, not the constraint registry —
so that is what got built. A fixture is the one thing here that is pure addition: it
cannot break a layout, and it makes an unmeasurable item measurable.

A three-branch manifold with a return header: two junctions with **four lines each**
(1 in / 3 out, and 3 in / 1 out), and **a different size per branch** (2", 3", 4").
Those two choices are deliberate and each covers something the corpus did not.

```
  case      junctions  fan-out pairs   <- before: min 0, split 0
  manifold      4            6
```

Corpus fan-out pairs 14 -> 20, and more importantly now *designed* rather than
accidental.

#### It exercised the valve-size ambiguity guard on a real sheet

The guard added in 9.59 — print nothing when the nearest equipment is reached with two
different sizes — had only ever been proven by construction, never by a rendered case.
The manifold proves it, because a header with heterogeneous branches is exactly the
ambiguous case:

```
  V-1   label=2"   from=2"@0 via T-1   to=AMBIG(4"/3")
  V-2   label=3"   from=3"@0 via T-2   to=AMBIG(4"/2")
  V-3   label=4"   from=4"@0 via T-3   to=AMBIG(4"/2"/3")
  V-4   label=4"   from=AMBIG(2"/3"/4")  to=4"@0 via P-1
```

On the header side of every valve the walk reaches vessels of two or three different
sizes, so it reports `AMBIG` and **falls back to the one end it can resolve**. That is
the designed behaviour and it is now demonstrated rather than asserted: a valve on a
header genuinely has no single line size on the header side, and the honest answer is
the branch size. Note what did **not** happen — no `4"/3"` was printed, which is what
the unbounded walk of 9.59 would have produced.

#### It made a layout weakness visible

Looking at the sheet: the supply header, pump and all four valves are crammed into the
top-left ~25% while the three vessels stack down the middle-right, leaving large empty
regions top-right and bottom-left. Score 282, 1 crossing, 1 label collision, 0 off-sheet,
0 errors — the numbers are respectable, and they are **hiding** the problem. Nothing in
the score penalises a lopsided aspect ratio, because the score has no term for it.

This is the concrete argument for T2 that 9.56 only made abstract: pass order decides
where a header lands, no term in the objective notices, and the result is a drawing that
is technically clean and visually unbalanced. A fixture that shows it is worth more
than another paragraph arguing for it.

#### One real defect found on the way, and one question

- **Title overflow (real, unfixed, filed as T3.8).** The first version was titled
  "Three-branch manifold with return header" and it was **clipped at the sheet edge** —
  longer than the title block is wide, with no truncation, no wrap and no warning. Any
  project with a long name hits this. I shortened the fixture title rather than bless a
  baseline with a known clipping defect in it, which is the right call for a fixture but
  is not a fix.
- **A DSL description is ignored in favour of the type label.** The fixture declares
  `T-1 tank "Branch 1 vessel"` and both the drawing and the tag list read
  `CONE ROOF TANK`, from `TYPE_LABELS`. If an explicit description is meant to win, it
  currently does not. Unverified either way — recorded as an open question, not a
  finding, because I have not established which behaviour is intended.

Net: `REGRESS OK (spike, min, dense, split, manifold)`, five cases, manifold baseline
blessed at 282 with 0 errors.
### 9.64 Filling the sheet — the `min(1, ·)` clamp, and a wrong answer I gave the user

Asked whether any todo item would spread out the demo page, I answered "no — the honest
answer is more content, not a layout change", citing T3.5 and the aspect ratio. That was a
bad answer to give someone using this for professional work, and the reasoning behind it
was too quick. Two errors, both mine:

1. **It treated a layout-capability gap as a user problem.** A process engineer who draws
   8 valves and 2 vessels should get a well-proportioned sheet, not a note about their
   process being small.
2. **It generalised from one rejected mechanism.** Row-pitch stretching had been measured
   bad, and I concluded "don't try". Those are different claims. Spreading *proportionally*
   does make the aspect mismatch worse; scaling *uniformly* does not touch aspect at all.

#### What was actually wrong

```
  const k = Math.min(1, Math.min((W - 2*pad) / cw, (H - 2*pad) / ch));
```

**Only overflow ever shrank.** With `k <= 1` enforced, a drawing smaller than the sheet
was never scaled up, so every small sheet was **under-filled by construction** and no
amount of layout work could change it:

```
  case      content      aspect   k unclamped   -> filled      was
  demo      606 x 191mm  3.18:1   1.394         100% x 49%    72% x 35%
  dense     459 x 169mm  2.72:1   1.839         100% x 58%    54% x 31%
  min       387 x  45mm  8.64:1   2.184         100% x 18%    46% x  8%
  split     360 x 150mm  2.40:1   2.344         100% x 65%    43% x 28%
```

#### Why filling is nearly free, and why nothing noticed

`k` is a **similarity transform**. Uniform scale cannot create a collision or a crossing —
it only scales existing ones. So the cost of filling is not layout quality.

**And the objective is structurally blind to it.** Unclamping moved the score by exactly
**0 on all six cases** — not because scaling is harmless, but because `k` is applied at
*render* time, after scoring. There is no term for fill (`util` was rejected on evidence
in 9.x). This is the real reason "just spread it out" kept failing across this project:
the thing being asked for is invisible to everything that decides layout, so no amount of
tuning could ever produce it.

#### The change

Dropped the clamp, and added `denormaliseText()`: text inside the scaled group renders at
`k * fontSize`, so every `<text>` font-size is divided back to the millimetre the layout
asked for. Drawing scale and text height are **independent in P&ID practice** (ISO 5457 —
a 1:2 drawing with 2.5mm text is normal), so this satisfies the project's print-size rule
rather than trading it away.

Applied as one pass over the assembled body, not at ~40 emission sites, and deliberately
**skipping `<text>` nested inside `<svg>`** — those live in a symbol's own viewport and
must scale *with* their symbol, or every glyph in every symbol would shrink by `1/k`.
Verified against the count the pass publishes on `data.textNormalised`:

```
  case       k      type runs adjusted   inherited (no font-size)
  demo     1.082                     52                          0
  spike    1.010                    139                          0
  dense    1.191                     54                          0
  min      1.545                     21                          0
  split    1.093                     20                          0
  manifold 0.970                     49                          0
```

`inherited` is 0 everywhere: every `<text>` in the scaled group carries an explicit size,
so there is no text silently scaling with the geometry.

**Furniture is untouched, by construction rather than by care.** `annotationsSvg()` — the
frame, title block, north arrow, legend *and the equipment tag list* — is emitted AFTER
the wrapper `</g>`, outside the scale. Verified in the assembly:
`svg.innerHTML = wrap + body + '</g>' + annotationsSvg(data, W, H)`.

#### A defect I introduced, caught only by looking

`fitPage` fitted to `pad = 10` while `annotationsSvg` draws the border at `pad = 18`.
Harmless while `k <= 1`, because the layout already held geometry inside SHEET (26), well
clear of the frame. With `k > 1` the content stretched out to 10mm from the sheet edge —
*inside* the frame line — and annotations ran into the border. Visible immediately in the
spike render (`FIC` clipped at the right edge) and reported by **no check at all**.
Fixed by fitting to the frame inset, 18. The lesson is the oldest one in this log: two
constants with the same name and different values, and only a rendered image finds it.

#### Result, and one honest consequence

`spike` **improved 997 -> 967** (one label collision removed by the extra room). Every
other case unchanged. `manifold` now sits at `k = 0.97` and genuinely fits, where it
previously overflowed the sheet and warned. `REGRESS OK (spike, min, dense, split,
manifold)`.

The consequence worth stating: symbols now grow by `k` while text does not, so the
**text-to-symbol ratio changes** and the clearance the engine reserved around a symbol is
`1/k` tighter in device space than it computed. On `min`, `k = 1.545`, so that is a real
1.5x tightening. It did not bite on the corpus — `spike` lost a collision rather than
gaining one — but it is a real coupling, and a future change that increases annotation
density could expose it. The principled fix is to lay out at the final scale rather than
scaling afterwards; that is a larger change and is not attempted here.

#### T3.5 is wrong as written

It says the fix for an under-filled sheet is "a richer demo, not a layout change". Half of
that survives — a 14-entity chain still cannot fill the height of an ARCH D sheet, because
3.18:1 content on a 1.57:1 sheet is a geometry problem, not a bug. But the claim that
nothing would fill the sheet was wrong, and the reason it was wrong is the clamp.
### 9.65 `at` already exists — the gap was silence, not mechanism

Asked whether we need a way to place equipment on the page and pin its location. We do,
and it has existed the whole time. Before building anything, measure what is actually
there:

- `at x,y` is accepted on **equipment, valves, instruments, junctions, stubs and
  off-page** connections. It sets `_fixed`, and **every** layout pass skips pinned items
  (barycentre, slots, coords, decrowd, terminals, centring) — `pid-router.js` has ten
  separate `if (e.at || e.rel) continue` guards.
- `rel <ref>` places an item relative to another at a 70mm offset.
- Pins land **exactly**. Sweeping one tank across the zone:

```
  pin x      rendered x    delta
   100          100          0     honoured
   300          300          0     honoured
   500          500          0     honoured
   700          700          0     honoured
   810          804         -6     MOVED
   816          804        -12     MOVED
   860          804        -56     MOVED
```

So the mechanism is sound and the honest answer to "do we need this" is *no, you have
it*. Three real gaps remain, and only the first is a bug.

#### 1. An out-of-zone pin is relocated SILENTLY — fixed as PID-LAY-002

The zone is `x 48..816 / y 42..481`. A pin beyond it is clamped, and the only feedback
was **downstream and about something else**:

```
  E COLLINEAR_OVERLAP  lines sharing a corridor (T-2->J-R & T-3->J-R ...)
  W [PID-SHT-001]     line "T-1 -> J-R" leaves the sheet
```

Nothing said *"your pin was moved"*. The user is told their drawing is wrong without
being told their instruction was not obeyed — which is the worst kind of silence in a
drafting tool, because it makes the engine look **unreliable** rather than
**constrained**. Those need very different responses: one is a bug report, the other is
a note about where you put it.

`PID-LAY-002` reports the adjustment with both coordinates and which way:

```
  W [PID-LAY-002] "T-1" pinned at 860,200 was placed at 804,200 (56.0mm left)
        -- outside the placement zone x 48..816 / y 42..481
```

Proven in **both** directions: fires on the out-of-zone pin above, and is **silent
across the whole corpus** — including `min.dsl`, which *does* pin `at 160,280` and is
correctly left alone. A check that only knows how to fire is not a check.

#### 2. Pinning costs layout quality, and nothing says so

```
  manifold, all four vessels pinned:  score 282 -> 449   (+167)
    crossings      1 -> 5
    bends         31 -> 41
    labelColl      1 -> 2
    offSheet       0 -> 0
```

That is the price of manual control and it is legitimate — the user traded
auto-optimal for intent. But it is **invisible**: nothing reports that pinning cost five
crossings. A drafter who pins things and gets a worse drawing has no way to learn
whether the tool or their constraint is at fault. Worth reporting, ideally as a
"pins moved N crossings" advisory rather than a warning, since the user chose it.

#### 3. No documentation, no UI

A search of every `.md` for the syntax finds **two incidental lines**, both in
historical review files. There is no user-facing documentation of `at` or `rel` anywhere,
and no drag-to-place in the page — placement is hand-edited DSL text. So the capability
is invisible to exactly the person who would want it.

The cheapest honest improvement is not a new mechanism, it is a page that says
`equipment T-1 tank at 420,200` exists and what the zone is. **A drawing tool whose
manual placement is undocumented is a drawing tool that makes people fight the
auto-layout.**
### 9.66 What can actually improve the layout — and the two levers that do not exist

Asked, a third time and more directly, what would greatly improve the layout. The previous
two answers were "add more content" (wrong, and I was told so) and "add a composition score
term" (untested). Both are now settled by measurement.

#### The score is not the problem. It is correctly refusing a bad trade.

All six candidates the search already renders were measured for composition. The demo:

```
  order sweep   score   extent      useW  useH  aspect  |log mismatch|
  JVI    0      235   606x 210mm    73%   40%  2.88   0.600   <- score winner
  JIV    0      335   606x 210mm    73%   40%  2.88   0.600
  JVI    1      250   606x 190mm    73%   36%  3.19   0.700
  VJI    1      471   608x 485mm    73%   93%  1.25   0.234   <- best composed
  VJI    0      399   343x 505mm    41%   97%  0.68   0.848
```

So the engine **does** produce a 93%-height drawing and **throws it away** for a 40%-height
one. That looked like free headroom for a composition term, and it is not. The 236 points
between them are:

```
  routing.crossings     2 -> 8      (+6)
  routing.bends        39 -> 59    (+20)
  routing.length     1607 -> 4104   (2.5x the line)
```

**The height is bought with 2.5x the total line length and 4x the crossings.** A 93%-height
drawing needing 4104mm of pipe where 1607mm will do is not better, only taller. The score
is right to refuse it, and a composition term strong enough to override that would be
reproducing the `util` failure exactly. **Do not add a fill or composition term.**

#### The real reason `util` failed, restated: there was no lever

`util` was rejected for measuring pipes instead of symbols, and for having nothing to act on.
The second reason is the deeper one, and checking it properly changes the plan. Of the three
composition levers in the registry, **two do not exist**:

**`layout.colSpacing` is DEAD.** Swept 140 -> 40mm, a 3.5x range, and produced
**byte-identical** output on both sheets — same total, same height, same length, same
crossings:

```
    140mm  demo  235  40%  len 1607   40mm  demo  235  40%  len 1607
     70mm  demo  235  40%  len 1607    45mm  demo  235  40%  len 1607
```

The mechanism, `pid-router.js:96-97`:

```js
const colsPerRow = Math.max(2, numCols <= Math.floor(availW / BASE_COL) ? numCols : ...);
const COL = numCols <= colsPerRow ? availW / Math.max(numCols, 1) : ...;
```

When everything fits on one row — which is the demo, dense and split — `COL = availW/numCols`
and `BASE_COL` is **bypassed entirely**. It is a wrap *threshold*, not a column pitch, and
nothing in the corpus wraps. A registered layout parameter described as "auto-layout column
pitch" that cannot move the layout is worse than no parameter: it invites tuning that does
nothing. Same family as the dead `view.grid || 20` fallbacks.

**`layout.minSep` is inert where it was expected to act.** 9.52 already found it
byte-identical on the demo across 45-95mm; re-confirmed here.

#### The lever that IS live: `layout.rowSpacing`

`ROW` is what actually sets tier height, and it moves the drawing:

```
  row    case   total   useH    len     dLen  cross
  145    demo    235    40%    1607      +0     2     <- default
  200    demo    245    46%    1550     -57     3
  260    demo    288    62%    1996    +389     4
  340    demo    309    60%    2019    +412     4
  200   dense    314    38%    2924    +215     5
  260   dense    326    52%    3152    +443     3
```

This is a **real trade, not a free win**, and the curve has a knee:

- `145 -> 200` buys the demo **+6% height for +10 score**, and line length actually
  *falls* by 57mm. Cheap.
- `145 -> 260` buys **+22% height for +53 score** and +2 crossings. Expensive.
- `340` is worse than `260` on height and better on nothing — the curve turns over.

Note this is **not** the `ROW_SOLVED` experiment. That stretched the *solved* row pitch and
was catastrophic (spike 1276 -> 1359..1894). This changes the *base* `rowSpacing`, which is a
different parameter behaving far more mildly. Recording the distinction so the old negative
result is not misread as covering this.

#### The recommendation, and why it is not mine to make

Do **not** hardcode a new `rowSpacing`. Raising it to 260 makes the numbers look better on
the demo and costs crossings on every sheet — that is re-blessing a baseline to make
something pass, with extra steps. Where to sit on that curve is a drafting judgement: a
62%-height sheet with 4 crossings may beat a 40%-height sheet with 2, and that is not a
technical question.

**Add `rowSpacing` to the search as a dimension**, alongside the three pass orders. The
search already renders 3 orders x 2 sweeps and keeps the lowest score; adding row pitch
makes it try each point on the curve per sheet and lets the score — which 9.66 shows is
trustworthy about exactly this trade — pick. That is the same architecture that made the
order search work in 9.56, and it is the opposite of a new score term: **add a candidate,
not a term.**

What is left is genuinely not a layout problem and should stop being presented as one: a
wide flat chain cannot fill a tall sheet without either more process or a different process.
The demo is 2.88:1 against a 1.58:1 sheet. `min.dsl` is two valves. Those are drawings of
small processes, and the honest lever for them is content.
### 9.67 The instrument tag overflows its bubble — real defect, fix reverted, not shipped

Told the demo "hasn't improved at all", which was fair. Stopped theorising, audited that
specific page, then zoomed into the ugliest region. Four rendering defects are visible
there, and one of them is unambiguous. **The fix is measured, and it is not shipped.**

#### The objective defect list for the demo

```
  [0]  angled segments        0        [6]  entity box overlaps    0
  [3]  crossings              0        [9]  off-sheet pipes       0
  [5]  lines through symbols  0        [10] crossings w/o gap     0
  [7]  label collisions       0        [11] UTILISATION          40%
  [4]  COLLINEAR OVERLAP      1   <- the T3.4 junction case
  [1]  TINY TEXT           28/61   <- I broke this, see below
```

#### I broke the audit in 9.64, and did not notice for two commits

`[1]` reports 28 of 61 text runs below the 3.5mm floor, at `fs=3.23`. That is a false
positive storm I created. `denormaliseText` divides `font-size` by `k` so the type renders
at nominal size, but `audit-svg.mjs` compares the raw attribute against 3.5mm **without
accounting for the wrapper `scale(k)`** — so nominal-3.5mm text reads as 3.23 and gets
flagged. Nominal 3.5 x 1.082 = 3.79, above the floor, exactly as intended.

**This is the coordinate-space trap for the fifth time, and the worst instance yet, because
it disarmed a guard.** 9.63 produced clean audits and I did not query why the numbers moved.
The audit must multiply font-size by the wrapper scale, or read the effective size some
other way. Until then treat every `[1]` count in this log as inflated by 1/k.

#### The real defect: `FIC` / `101` does not fit its bubble

The instrument tag is emitted at `inst.y + 0.5` and `inst.y + 5.5` while the bubble radius
is ~4.5mm. **The loop number's baseline alone is 5.5mm below centre, so "101" is drawn
entirely OUTSIDE the circle**, under "FIC", on every instrument on the sheet. Two further
faults compound it:

- **A circle is not a box.** Text on a line at offset `dy` only has the chord
  `2*sqrt(r^2 - dy^2)`, so even a centred block overflows unless the radius is solved for.
- **The width factor is wrong for the case.** `0.55em` is the mixed-case average used
  elsewhere; the letters line is **bold uppercase**, nearer `0.68em`. The circle was
  therefore solved too small and the glyphs touched the ring.

And the symbol itself is not what it appears: the demo declares `FIC-101 dcs`, so
`BUBBLE_KEYS.dcs` resolves to `shared-display`, whose body contains **both** a rect and a
circle. The rect is 90% of the viewBox and the circle 80%, so the **circle is the binding
constraint** — a shape test that picks the rect under-sizes. `bubbleRadiusFor()` was
written to solve exactly this (chord-aware for circles, half-width for rects, per-shape
width factors) and is correct as a piece of geometry.

#### Why it is not shipped

Two attempts, both measured, both rejected:

```
  grow the bubble to fit the text   ->  spike 997 -> 1274, dense 299 -> 419
  centre the block, keep the size   ->  spike 997 -> 1327, labelCollisions 3 -> 14
```

The second is the informative one: **merely moving the instrument text by ~2.75mm adds
eleven label collisions on the dense sheet.** The routing terms are untouched (crossings 15
to 15, bends 82 to 82) — only annotation placement changed. So on `spike` there is no room
for the corrected position, and shipping it would trade a visible overflow for eleven
invisible collisions while the score got worse.

**The root cause is a size decision, not a geometry bug.** `fs(3.2)` yields 4.5mm letters,
which is too large for a standard ISA bubble — real ones are ~12mm across with 2.5-3mm
type. So the fix belongs in the **letters**, bringing them down to about `fs(2.4)`, not in
the bubble. That is a legibility judgement and it is not mine to make silently, and the
project already has an unresolved `typeScale` / `typeFloor` tension (T6.14) sitting in the
same area. Filed as **T6.15** rather than guessed at.

#### The other three defects, unfixed and unmeasured

Visible in the same zoom, listed so they are not lost:

1. **The junction dot is a heavy solid black blob**, visually much larger than the 2.5mm
   blue `pid-junction-dot` the renderer emits — so either something else draws it or the
   node style is wrong. Not chased; the demo has 5 junctions and this is the ugliest thing
   on the sheet.
2. **Flow arrows are oversized.** The blue triangles are wider than the pipe and read as
   the primary mark rather than as direction. No metric covers them.
3. **Valve label stacks crowd each other** — 4-line stacks (tag / type / state / size) sit
   close enough to read as one block, and `GATE VALVE` sits on a line. The score counts
   label collisions as 3 on spike and these are not among them, so the boxes are too
   generous or the stacks are placed without regard to each other.

None of these is a layout problem. They are symbol and annotation rendering, which is where
the remaining ugliness actually lives — 9.66 spent its whole budget on composition levers
and the sheet still looks cheap because of things no score term measures.
### 9.68 Spreading the drawing out — the fill term returns, with a lever and a guard

Told the demo "hasn't improved at all" and to stop going down rabbit holes. Fair. Four
things had been found in 9.66 and none of them had been acted on, and the arithmetic that
would have settled it in one line had not been done. So: done here.

#### The actual cause, which was in a file I had already read

`pid-router.js:96-97`, quoted in 9.66 and not acted on:

```js
const colsPerRow = Math.max(2, numCols <= Math.floor(availW / BASE_COL) ? numCols : ...);
const COL = numCols <= colsPerRow ? availW / numCols : ...;
```

`COL = availW / numCols` — the columns **always spread to the full sheet width**, so
`colsPerRow` was always `numCols` and the tier grid was **always one row**. The tiering
machinery existed and could never engage. Every sheet came out as one flat horizontal
band with the bottom of the sheet empty, and that is not a tuning problem, it is a
missing feature that looked present.

That is also why `layout.colSpacing` was a **dead rule** (9.66, byte-identical over a
140->40mm sweep): `BASE_COL` was only ever a floor for the wrapped case, never the pitch.
A dead lever and a missing feature, wearing the same coat.

#### Two attempts that were wrong, measured

**1. Wrapping the tier grid** (`layout.colsPerRowMax`, auto aspect fit). It engaged, and
it was **harmful**: demo 235 -> 377, spike 921 -> 1127. Rendered it and it was worse —
a void in the middle and V-104 jammed into the title block. Default is now 99 (no wrap);
the rule is kept because forcing 2 is occasionally useful.

**2. Capping the column pitch** (`layout.colMax`) on the theory that a narrower chain
would let `k` scale it up. **Refuted**: utilisation fell on every sheet (demo 38% -> 22% at
110mm). The mechanism did what I predicted — the content became taller and narrower
(401x317 -> 250x367) — but *smaller overall*, because the same items pack into less
space. Kept at 0 (off), documented, because the refutation is the useful part.

#### What actually worked: the fill term, with the two things `util` lacked

The reverted `util` term died for two reasons (9.31). Both are now fixable, which makes
this a resurrection rather than a repeat:

- **It had no lever.** `layout.rowSpacing` **is** the lever, and it is large: measured at
  demo utilisation **40% -> 61%**. It is now the **third search dimension** alongside the
  three pass orders and the two coordinate sweeps, plumbed through the parse options on
  `var PID_ROW_SPACING` exactly as `minSep` already was. Per sheet there is no single
  best value — demo and dense want 260mm, spike and manifold want 145mm — so the engine
  tries both and scores them.
- **It measured pipes, not drawings** (32% useH against the entity-aware 38-61%). The
  term now measures entities *and* linework.
- **It punished small drawings** (min.dsl, two valves, 113 points for being small).
  `annotation.fillEntityMin` (8) is the guard: below 8 placed items the term does not
  apply at all. `min` scores **68 with gap 0 at every weight tested** — a small process
  is free, a sparse large drawing is not.

One intermediate attempt worth recording because it was **inert and looked right**: the
first version priced **aspect mismatch**, and reported `aspectErr: 0` on the very sheet
that was complained about. The demo bbox is 1.75:1 against a 1.58:1 sheet — only 11% off —
so the term saw nothing wrong. **A bounding box can be the right shape and still be
mostly empty.** Area fraction is what a reader sees, and that is what it prices now.

#### Weight 400 is a measured threshold, not a preference

```
  weight  sheet      util%   cross
     60  demo        40%      2      <- inert: identical layout through 250
    150  demo        40%      2
    250  demo        40%      2
    400  demo        61%      4      <- threshold
    400  dense       41%      3      <- was 29% util / 6 crossings: MORE fill, FEWER crossings
    400  spike       82%     18      untouched
    400  min         11%      0      untouched, and unpenalised by design
    400  manifold    83%      1      untouched
```

So the term is inert below 400 and does real work at 400: two sheets improve, three are
untouched, and the small-drawing trap is closed. Cost on the demo is +2 crossings and
+24% line length, which is the trade being made deliberately and visibly.

#### Honest verdict

The demo is better spread and I can point at the number: **40% -> 61% sheet utilisation**.
It is **not** transformed. The drawing is still left-heavy with a sparse lower-left, and
that is the next thing to attack — the fill term rewards *area used*, and a drawing can
use area badly, which is a limit of the metric rather than of the layout. 9.67's three
unmeasured rendering defects (junction blob, oversized flow arrows, crowded valve label
stacks) are untouched and are what now makes the sheet look cheap rather than empty.

`REGRESS OK (spike, min, dense, split, manifold)`. Final: spike 941, dense 462, min 68,
split 45, manifold 282.
### 9.69 The `candidates` check is mis-specified, and this work opened the gap

**One REGRESS line is red and it is not a regression in the layout. Recording it rather
than suppressing it, because the honest description is that a guard is comparing two
incomparable things.**

```
  - dense: candidates winner 473 worse than blessed 445
```

`regress.mjs:68` `checkCandidates` runs a **different configuration** and asserts it is
not worse than the blessed default:

```js
const c = sh('harness2.mjs', [`regress/_cand-${name}.svg`, `--src=...`, '--candidates=8', '--seedbase=1']);
if (H.score.total > exp.harness.score.total) problems.push(`candidates winner ... worse than blessed ...`);
```

Those are not the same search. `pid-renderer.js:2546`:

```js
const layoutSeed = !nLayouts ? null : (L === 0 ? seedBase : seedBase + L * 1000);
```

The **default** path passes no `layouts`, so `layoutSeed` is `null` — the comment calls it
"the legacy path (no layout noise)". The **`--candidates=8`** path passes layouts, so every
candidate is a **noise-perturbed** re-render. The check therefore asserts that a
*perturbed* multi-start beats a *noise-free* single search, which is not a property any
layout engine can have: noise can only move you away from an optimum, never closer.

It passed before because the default search was weak enough that the noisy run could
match it. Adding `rowSpacing` as a search dimension widened the default search (3 orders x
2 sweeps x 3 pitches) and it found dense at **445** where it used to find 462. The noisy
run is stuck at 473 because it is not exploring the new dimension systematically, only
through perturbation. The gap opened because the *default* got better.

Widening the row search from two pitches to three (145/220/300) was tried as a fix on the
assumption that the search was under-seeded. It genuinely improved dense (462 -> 445) but
did **not** close the check, which is what confirmed the diagnosis: the problem is the
noise, not the coverage.

The right fix is to the check, not the layout: compare like with like, or drop the
assertion and report the multi-start score as a diagnostic alongside the default rather
than as a pass/fail gate. Filed as **T0.3**. Until then this line is expected to be red
and is left visible.
### 9.70 Centre the drawing, and stop lying about tag widths

Two more defects, both found by looking at a render rather than at a score.

#### 1. The fit wrap threw all the slack in one direction

```js
wrap = `<g transform="translate(${pad - minX * k} ${pad - minY * k}) scale(${k})">`;
```

That anchors the content's **top-left** to the frame corner, so any drawing shorter than
the sheet sat hard against the top with every spare millimetre dumped below it. On the
demo that was ~158mm of dead space along the bottom edge plus an entirely empty lower-left
quadrant — and the content looked "pushed up" rather than merely small.

It also **silently discarded the centring `autoLayout` had already done**, because that
works in layout coordinates and the wrap re-anchors afterwards. Two passes, one invisible:
the same class of bug as 9.65's overlay coordinates and 9.64's audit.

Now centred: `translate(pad + (dw - cw*k)/2 - minX*k, ...)`. The slack splits evenly, which
is what a drafter does by eye.

#### 2. The collision metric was measuring bold caps as if they were mixed case

`textBox` used `0.55em` for everything. That is the **mixed-case** average, and the
equipment tags and valve tags are **bold uppercase**, nearer `0.68em`. Every bold tag box
was therefore about 20% too narrow.

That is not a rounding detail, it is why the demo reported **`labelCollisions: 0`** while
`V-103 GATE VALVE` visibly sits on top of `FV-101 CONTROL VALVE` and `PSV-101` overlaps
the pair. The metric could not see the pile-up, so **the layout had no reason to avoid it**
— to the engine there was nothing there to avoid. Same root cause as T4.4 and as the
reverted `drawnWidth` in 9.60: a flat average cannot express the difference.

Added `WIDTH_EM = { regular: 0.55, medium: 0.58, bold: 0.68 }` and carried a **role**
through the valve label stack (`[string, size, offset, role]`) so each row is measured with
the factor that matches how it is actually drawn. The tag line is bold; the type and state
lines are not.

#### Effect

```
                    before    after
  demo util          40%       66%
  demo score        360       356
  spike labelColl     3         2
```

Utilisation on the demo is now **66%**, up from 40% before this pass and from the 61% the
fill term alone bought. The score is marginally better too, so the wider boxes are finding
placements that were already fine rather than forcing churn.

#### What is still wrong, named precisely

The drawing is still an **L**: a long horizontal run to V-104 in the bottom-right, and
an empty lower-left quadrant. Utilisation reads 66% because it measures the bounding-box
**area**, and an L-shaped bbox is mostly empty. **A drawing can use area badly and still
score well on area** — that is a limit of the metric, not of the layout.

The cause is the layered assignment: every depth level gets a full-width column, so the
last element of a long chain is stranded a whole row away from everything else. Fixing it
means the constraint-declaring rewrite (T2) — per-level width proportional to its own
occupancy — not another score term. The valve cluster in the middle is the other visible
problem and it is now at least *measurable*, which it was not before.
### 9.71 Valves had no minimum separation at all

The ugliest thing on the demo was five valves piled in the middle with their label
stacks on top of each other. Measured, not guessed:

```
  FV-101  V-105     18.0mm   <-- tighter than one symbol: OVERLAPPING
  FV-101  PSV-101   25.0mm   <-- overlapping
  V-103   V-105     28.3mm   <-- overlapping
  V-101   V-106     29.2mm   <-- overlapping
  3 valves inside a 60x60mm box
```

**Why nothing stopped it.** `layout.minSep` (45mm) is documented as "min vertical
separation between entities" and 9.66 measured it **inert on the demo across 45-95mm**. Now
it is explicable: `SEP` is used in exactly **one** place, `pid-router.js:242`,
`cursor = yOf[e.id] + SEP` — the **column packing** loop. Valves are placed by
`passValves`, which never sees it. So the rule exists, is named as though it governs
this, and governs something else entirely.

`passDecrowd` *does* include valves (`[...equipment, ...valves]`) but only pushes in **Y**,
4 iterations, with no floor. A dense cluster cannot converge under that.

#### The fix, and the part that was wrong first

Added a hard minimum centre distance, displacing along whichever axis needs the smaller
move. First version used `entityHalf` (the glyph) for both axes and only moved the worst
pair from 18.0mm to **25.0mm**, leaving three still overlapping. That was wrong for a
reason worth stating: **side by side, what collides is the LABEL STACK, not the glyph.**
A gate-valve bowtie is ~16mm of ink; its stack reads `V-105 / GATE VALVE / N/C / 4"` and
the type line alone is ~28mm at 3.9mm type. A floor set from the glyph half is a floor the
labels walk straight through.

So the floor is **role-aware**: `needY` keeps the glyph + label-zone rule (labels hang
below, so a sideways shove can put one on top of a neighbour — the original reason the
pass is vertical), and `needX` uses the widest line of the two stacks at 0.62em.

```
  tight pairs   4  ->  3  ->  1     (18.0mm -> 25.0mm -> 28.3mm worst pair)
```

Raising the iteration count from 3x to 12x changed **nothing**, so it is back at 3x:
converged, and the extra passes were pure cost.

#### What it cost, stated plainly

Demo utilisation **66% -> 44%**. Separating the valves grew the bounding box, which shrank
`k`, which rendered the drawing smaller. That is a genuine trade and the score agrees it
is roughly neutral (**356 -> 354**). I took it: overlapping labels look broken, and 44%
with clean labels reads better than 66% with a pile. **Legibility beat the fill number.**

It also revealed that the fill term is measuring the wrong moment: it scores the layout
**before** `passDecrowd` repairs it, so it rewards a candidate that the repair then undoes.
Noted, not fixed — the fix is to score after the repair, which means moving scoring later
in the pipeline and is not a small change.

`spike` gained substantially: **941 -> 879**, crossings **18 -> 11**, label collisions
2 -> 1, utilisation 57% -> 73%, and audit `[4]` collinear overlap 1 -> 0.

Final: spike 879, dense 445, min 68, split 45, manifold 282.
### 9.72 The pipe was a hairline, and the tag was never centred in its bubble

Two of the three rendering defects filed in 9.67 turned out to share one cause, and the
third was arithmetic that had never been done.

#### The root: process pipes were 0.6mm

```js
// pid-renderer.js:588 -- the whole of it
width: signal ? 0.4 : 0.6,
```

Measured from the emitted markup, **all 16 process pipes on the demo were 0.6mm** while
the equipment boxes were 70x45mm. At 1:1 that is a hairline, not a pipe.

This reframes both other defects. They were not oversized in absolute terms -- a 3mm flow
arrow and a 5mm junction disc are both reasonable marks. They were absurd *relative to a
0.6mm pipe*:

```
  arrow   3.0mm wide  on pipes 0.4mm .. 3.21mm   ->  1.9x the widest, 7.5x the thinnest
  dot     5.0mm disc   on a 0.6mm pipe            ->  8.3x
```

The junction probe settled it: every dot sits at distance **0.00mm** from a 0.6mm process
pipe. It was never sitting on a signal line -- my first reading of the audit output was
wrong, and the probe corrected it.

Now `routing.processWidth` (1.4mm) and `routing.signalWidth` (0.35mm). **Measured free**:
rendering the demo at 0.6 and at 1.4 produced identical `[3] [4] [6] [7] [8] [11]` -- the
same layout, byte for byte. Nothing in the search reads stroke width.

The arrow and the dot were also made proportional to the pipe they sit on
(`annotation.arrowFrac` 0.8, `annotation.arrowRatio` 2.4, `annotation.junctionDot` 2.5mm
diameter) rather than left as constants, so the relationship is now explicit and
rule-driven instead of accidental. The junction dot also **lost its `fill="#1E90FF"`**:
`circle.pid-junction-dot{fill:#000000}` beats a presentation attribute, so the attribute
never took effect. A dead attribute is worse than none -- it reads as intent and audits as
a colour that is not on the sheet.

#### The arithmetic that had never been done: the tag is not centred in its bubble

```js
g += `<text ... y="${inst.y + 0.5}" font-size="${fs(3.2)}" ...>${letters}</text>`;
g += `<text ... y="${inst.y + 5.5}" font-size="${fs(2.6)}" ...>${loop}</text>`;
```

At typeScale 1.3: `LT` is fs(3.2) = 4.16mm, so its cap top is at `0.5 - 0.72*4.16` = -2.5.
The loop baseline at +5.5 puts descenders at +6.17. The block spans **-2.5..+6.17** --
8.7mm tall, centred at **+1.84**, i.e. sitting 1.84mm LOW in a bubble of radius
`0.4 * size` = 4.00mm.

So the loop number hung about **1.5mm out of the bottom of the circle**, on every
instrument on every sheet. The bubble SIZE was never wrong. The block was simply not
centred in it.

The shift is now derived from the metrics (cap top to descender bottom, halved), which
also makes it correct at any typeScale -- `fs()` and `sizeOf()` both scale but not by a
guaranteed common factor, and a fixed offset only landed near-centre at one setting.

```
                     before    after
  demo  [14] tag lines outside   5        1
  spike [14] tag lines outside  18        6
  spike worst overshoot        35%   ->  23%  (3-letter tags, see below)
  spike loop-number overshoot  35%   ->   0.5% (4.02mm vs 4.00mm)
```

#### Two new checks, and what they cost

`[12] MARKER SCALE` -- is the dot/arrow proportionate to its pipe? Proven both ways by
construction, since pipe width is the variable: **3 hits at 0.6mm, 0 at 1.4mm**, with
every other audit item identical.

`[14] TAG INSIDE BUBBLE` -- does the tag ink fit its circle? It initially reported 18 on
spike, of which **12 were 0.02mm over** -- float noise, and 12 false positives out of 18 is
exactly how a guard trains its reader to ignore it (the failure mode that disarmed audit
item `[1]` in 9.64). Now carries a **0.25mm print tolerance**, the conventional CAD
plotting tolerance, and reports 6 on spike and 1 on the demo -- every genuine overshoot,
and silent on the noise. The tolerance was chosen as the print tolerance and then verified
to still fire; it was not chosen to make a number pass. `PID-INS-020` in the renderer uses
the same 0.25mm, because a validator and an audit that disagree on a threshold are worse
than either alone.

**This made the scores worse, and the reason is worth more than the fix.**

```
            before    after
  spike        879     914
  dense        445     455
  min           68      73
  split         45      45
  manifold     282     287
```

Attribution, by single-variable probe with hash-verified restore:

- `processWidth` **refuted** -- 0.6 and 1.4 give identical `[3]=10 [4]=2 [7]=0` on spike.
- `decrowdAir` cannot be it either: the floor kept the same value (14) under its new name.
- The tag centring **is** it: forcing `shift = 0` restores `[3]=9 [4]=0 [7]=1`.

And the mechanism is the finding. Moving the tag text by 1.8mm cannot move a pipe, a
bubble or a tap leader -- yet the layout changed, because **the candidate score is computed
from the annotation boxes, so a cosmetic text move re-rolls which layout wins.** The two
spike candidates are near-tied and a 1.8mm shift breaks the tie arbitrarily, landing on a
worse one: 2 new collinear tap/pipe overlaps, crossings 9->10, labels 1->0.

So the search, not the fix, is what is fragile. Filed:

- **T6.16** -- the candidate score must not depend on where a tag sits *inside its own
  bubble*. The bubble does not move; the text inside it does. Score the bubble.
- **T6.17** -- 3-letter tags (`FIC` `TIC` `LIC`) need a 4.93mm bubble and have 4.00mm.
  The remedy is the symbol-bundle bubble size, because `symbolSize()` feeds BOTH
  `entityHalf()` in the router and `sizeOf()` in the renderer. Growing it in the renderer
  alone is what regressed before (spike 997 -> 1274), because the layout then reserves less
  room than the drawing occupies. This is T6.15 in new clothes and it is still a legibility
  call: bigger bubbles, or smaller letters.
- **T6.18** -- spike's 2 new collinear tap/pipe overlaps. The engine's `lines.overlaps`
  does not count a tap leader against a process pipe, so the search cannot see them.

The centring is kept. It fixes a defect that is on every instrument on every sheet, and the
cost is a fragile search re-rolling a near-tie -- which is now measured and filed rather
than latent.
### 9.57 Still outstanding after this pass
- **Pipes record no port binding** (`T7.13`) — a pipe is `{from, to}` with no port

- **Annotation type is 1.0-1.9 mm over the stated print band on every sheet**, and
  `typeFloor` flattens three roles onto 3.5 mm. Both are decisions rather than defects,
  and `PID-TXT-001` now reports both on every run. See 9.50.
- **Ports do not touch their metal.** 60 of 259 ports sit >1 mm clear of the drawn
  content. The valve family is now *correctly placed on its axis* but still short of
  the body by 0.83-1.67 mm, because ports are authored at the bounding-box edge and
  the bodies are inset. A per-family lead-in stub decision, not an auto-fix. See 9.44.
- **Pipe routes sit 1-2.5 mm off the drawn grid, at their ports only.** Entity centres
  are on the 5 mm grid (19/19, 33/34, 14/14, 6/6, 6/6) and interior bends are snapped;
  the residual is the port endpoints, which are pinned to exact attachment by
  `(pct-50)/100*size`. The lever is port offsets, not placement code. See 9.48.
- **`portOffset` still ignores the letterbox** (T7.2). Residual 0.167 mm on the
  `vb.h=83.33` valves, 0.5 mm on the control-valve group. The 9.22 revert of this was
  measured against broken port data and should be re-run.
- **The router is now tuned against stale anchors.** Correcting the valve ports moved
  every pipe terminus and pushed all four corpus scores up (9.44). The valves are right
  and the scores are worse; closing that gap is the re-tuning T3 asks for, now with a
  measured reason.
- **`angle-valve` is now fixed** (inlet 50->75, outlet 50->8.33) and verified by a render.
- **Instrument tier reads as disconnected.** LT / FT / PI / FIC float well above their
  hosts on long dashed runs; LT's bubble in particular sits far left with a line that
  reaches nothing. This is the most visible remaining defect and is the natural next
  target.
- Untouched: legend (F7), text-size consolidation (see 9.50), signal pricing (F4),
  sheet constants (item 7), richer demo (item 8), symbol conformance (D8).
