# Improvement list — layout engine & DSL

Assessment date: 2026-10-02. Baseline: commit `154ba67`, corpus scores
`min 65 · split 45 · dense 384 · manifold 225 · spike 789 · demo ~319`.

Every item below is marked **VERIFIED** (I ran it or read the exact line),
**READ** (read the code, high confidence), or **PROPOSED** (a design
suggestion with no code behind it yet).

---

---

## 0a. RE-RANKING — measured 2026-10-02 after looking at the output

The list below was written before I looked at a rendered sheet. On looking at
it, **most of that list would not change a single pixel.** This section records
the measurements that corrected it, and moves the layout fixes to the front.

### The search is not buying what it costs

`renderPid` runs 72 full parse+route+score cycles. Measured on
`dense · split · min · manifold` via `measure.mjs --set`:

| configuration | candidates | sum of totals |
|---|---|---|
| baseline (3 orders × 2 sweeps × 3 row pitches × 4 col caps) | 72 | **719** |
| 3 row pitches → 2, 4 col caps → 2 | 24 | **719** |
| …and drop the coord-sweep axis too | 12 | **719** |

**Byte-identical.** Six times fewer renders for zero measured cost. The third
row pitch and the third/fourth column pitches — the axes the comments defend at
`renderer:3232-3252` as "not padding" — buy nothing on these four sheets. The
order axis *does* buy something (`orderSearch:0` → 851, worse by 132) and the
coord sweep does too (`coordSearch:0` → 806).

So: shrink the search, keep two axes, spend the saved 24 s on actual layout work.

### Root cause 1 — `fill` is priced but not steerable

```
dense, fillTarget: 0.62 (default)  ->  384  util 45  xings 5  bends 35  len 3079  fill 61/73
dense, fillTarget: 0.95            ->  516  util 45  xings 5  bends 35  len 3079  fill 61/73
```

Demand a much fuller sheet and **the geometry does not change at all** — only
the penalty grows by 132. The placement engine has no mechanism that responds to
the fill signal. It is a score term with no actuator. This is the single
clearest structural defect in the layout engine, and it is invisible in the
code because the score block looks like it is driving something.

### Root cause 2 — the void is created by ranking, and nothing compensates

`dense.dsl` is a **path**: `T-1 → V-1 → P-1 → FV-1 → C-1 → E-1 → J-1 → V-2`,
plus a reflux edge back to `C-1` (a cycle) and a stub `OUT-1`. `processRank`
assigns depth 0…7, so the layout is inherently a 1-D horizontal chain on a
1.58:1 landscape sheet. Result: everything in a thin band across the top, 40%
void below.

The only 2-D lever is wrapping the chain across rows (`colsPerRow`), and it is
crippled twice over:
- `layout.colsPerRowMax: 99` (VERIFIED `pid-rules.js:277`) skips the
  aspect-matching search entirely
- the `colMax` search cap forces `COL` small, which fights the wrap

Measured:

```
colsPerRowMax:2  ->  util 33, xings 0, bends 28, len 2141   total 3345 (3 errors)
colsPerRowMax:3  ->  util 49, xings 3, bends 39, len 3467   total  392
colsPerRowMax:4  ->  util 45, xings 5, bends 35, len 3079   total  384  (default behaviour)
```

`3` gives a **taller, fuller, lower-crossing** drawing. The score says it is
worse. See root cause 3.

### Root cause 3 — the score and the eye disagree, and the score wins

`colsPerRowMax:3` improves every human-visible metric (util 45→49, crossings
5→3) and the engine rejects it, because `len` rose 3079→3467 and `sigMax`
92→147, and those are priced while fullness is not steerable. The corpus
recorded this pattern before (`P&ID-VISUAL-QUALITY.md` §9.76: "the search is at
a local optimum over its entire rule space") but did not identify that the
objective itself is the constraint.

This is the thing to fix first. Nothing else in the layout engine can be
evaluated until the fitness function stops steering away from better drawings.

### Root cause 4 — orphaned nodes have nowhere to go

`D-1` (drum) in `dense.dsl` has **no process connection** — only
`tap LT-1 -> D-1.inlet`. It is an orphan, and `LT-1` taps it, so the pair is
dragged into the void on a long dashed signal. Same on `spike` (`LT-5` at top,
`FIC` at far right, connected by long runs across the sheet). A real drafter
puts an orphan adjacent to its instrument or asks the author where it goes.
The engine has no orphan policy at all.

### What actually changes the drawing

Ordered by measured/visible impact:

| # | change | why it matters |
|---|---|---|
| **A** | Make `fill` steerable — add a **2-D aspect objective** to `autoLayout` that balances bbox width vs height against sheet aspect, and price it | root cause 1; nothing else works until this exists |
| **B** | Fix the rank→1-D-chain problem: rank on **flow groups**, not depth, so cycles and parallel branches become 2-D structure | root cause 2; the void is created at `processRank` |
| **C** | Un-cripple `colsPerRowMax` (set 0) and make wrap width a **search axis** | VERIFIED lever; `3` measurably beats `4` on util and crossings |
| **D** | Re-weight against the eye: fold fullness into the objective so better-looking layouts can win | root cause 3 |
| **E** | Orphan placement policy: co-locate with host/instrument, else park at the sheet margin with a short leader | root cause 4 |
| **F** | Instrument tier as a hard constraint on its host's placement (already identified as §3.3 / T2.1) | `tapReachTotal` 226 mm on spike |
| **G** | Real channel allocation for parallel risers (§3.2) | "parallel manifold branches crowd" |
| **H** | Shrink the search 72→24 (VERIFIED free) and spend the time on A–G | buys the budget to do A–G |

Items **A–D are the layout fix.** Everything in Priorities 0, 1, 2, 4 and 5 of
the original list is prerequisite engineering — real, worth doing, and it makes
A–G *possible to measure*, but it will not by itself make a drawing look better.

**→ Superseded by §0c.** All of A–G is score-tuning in pursuit of what a
drafter gets from *rules*. See §0c for the placement rule system that replaces
it, and for the parser-order bug (`resolveTopology` at `parser:637` runs 43
lines *after* `autoLayout` at `parser:594`) that currently makes such rules
unwritable.

---

## 0c. THE ACTUAL FIX: an equipment placement rule system

Everything in 0a is a *reactive* fix — more objectives, more penalties, more
search axes. That is optimising a cost function to decide where a reboiler
goes. A drafter does not do that. A drafter knows that a reboiler goes beside
the column it serves and a pump goes below its suction source, and only falls
back to judgement when the rules don't apply.

**The reason none of those rules exist is that `autoLayout` is not allowed to
know them.** This is the finding that reorganises the whole project.

### The blocker: the placer runs before ports exist

VERIFIED parse order in `pid-parser.js`:

```
:585  if (data.view.layout === 'auto')
:594      autoLayout(data)          <-- PLACEMENT RUNS HERE
:602      sheet clamp
:611      resolveOverlaps
:621      grid snap
:626      resolveOverlaps
:637      resolveTopology(data)     <-- PORTS RESOLVED HERE, 43 lines later
:638      materializeNozzles(data)
:639      resolveNozzlePositions(data)
```

So at the moment the engine decides where the pump goes, **it does not know
which way the pump faces.** `resolveTopology` (`router:1664-1913`) is what
resolves ports, assigns `p._from`/`p._to`, and calls `nozzleTip`. `autoLayout`
runs 43 lines earlier.

This is the same insight as T3.11 in `P&ID-ENGINE-REDESIGN.md:653` — *"The
layout cannot see nozzle annotations, and that blocks the tap placement"* —
recognised for instruments and not generalised. `router:524-532` already
documents the consequence in a comment: reading `data.nozzles` inside
`autoLayout` is **silently a no-op** because the array is still empty.

**Every equipment placement rule anyone would want to write is phrased in terms
of ports.** "Pump below its suction source" needs `suction`. "Reboiler beside
the column it heats" needs the `bottoms` port and the column's feed. "Control
valve with its controller above" needs the actuator port. The placer cannot
write a single one of them today.

### The data to key rules on already exists — it is just not plumbed to layout

| available today | where | reaches `autoLayout`? |
|---|---|---|
| authored port names (`p.fromPort`/`toPort`) | `parser:536-542` | **yes** — unused |
| `portMetadata()` role inference: `suction`→in, `discharge`→out, `bottoms`/`drain`, `relief`, `sample`, `top`, `left`/`right` | `parser:983-999` | **no** — a pure function, trivially callable |
| equipment `type` (`pump`, `tower`, `kettle-reboiler`, `shell-tube-exchanger`, `drum`, `tank`) | `parser:455` | yes — never tested |
| graph topology + SCC cycles | `router:71` | yes |
| declared loops (`loop LC-2 measure … controller … manipulate …`) | `parser:462` | yes — **never read by layout at all** |
| port *world* position + resolved facing | `router:1664+`, **after** layout | **no** |

That last two rows are the whole story. The semantic content that makes a P&ID a
P&ID — which port is which, which instrument manipulates which valve — is either
present and ignored, or resolved after the decision that needed it.

### Design: rules, not penalties

Add a **placement rule layer** between the ranker and the coordinate solver.
Structure, not a scoring tweak:

```js
// placement-rules.js — new file, declarative, data-only
const PLACEMENT_RULES = [
  {
    id: 'pump-below-suction-source',
    when: (n) => n.kind === 'pump' && n.ports.some(p => p.role === 'in'),
    // NOTE: this sketch is illustrative, not the shipped API. The shipped
      // layer is placement-rules.js, whose rules carry `applies` (audit) and
      // `enabled`/`solve` (enforcement) with the same intent.
      assert: (n, m) => m.rel.some(r =>
      r.port === 'in' && r.ref === n.upstream && r.dy > 0),   // source above
    weight: 1.0,
    rationale: 'suction is gravity-fed; a pump below its source needs no lift',
  },
  {
    id: 'reboiler-beside-column',
    when: (n) => /kettle-reboiler/.test(n.type) && n.bottomsPort,
    assert: (n, m) => Math.abs(n.x - m.heatExchangerColumn.x) < COL * 1.5
                  && n.y > m.heatExchangerColumn.y,
    rationale: 'circulation loop reads as one system when adjacent',
  },
  // …heat exchanger beside its furnace; condenser beneath its column;
  //    control valve with its controller directly above (existing §3.3 intent,
  //    promoted from a score term to a hard rule);
  //    V-2 reflux line returns to the column overhead, not its side.
];
```

Three properties make this the right shape:

1. **Hard constraints, not weights.** The project's own governing rule
   (`REDESIGN.md:63-96`) is *"the layout cannot price a consequence of a
   decision it has not finished making."* A rule that applies is **satisfied**,
   not traded. This sidesteps 0a root cause 3 (score steers away from better
   drawings) because there is no trade to make.
2. **Each rule carries a `rationale`.** The repo already documents the *reason*
   for every weight (`pid-rules.js:104-237`). Rules must be auditable the same
   way, or nobody will dare change one.
3. **Rules compose and conflict-report.** `when` returns which rules fired;
   where two conflict, report it as a diagnostic rather than silently picking
   one. A rule engine that lies is worse than no rule engine.

### Required plumbing, in dependency order

1. **Move `resolveTopology` + `materializeNozzles` before `autoLayout`**
   (`parser:637-638` → before `:594`). This is T3.11 generalised, and it is the
   gate on everything else. Expect a large score diff — the placer will
   suddenly see ports and behave differently. That is progress, but it must be
   a deliberate re-bless with the corpus **looked at**, per the lesson in
   `P&ID-VISUAL-QUALITY.md` §9.11 (*"A layout change is not done until the demo
   sheet has been looked at"* — a pass reorder shipped 8 valves into a 190×25mm
   box that way).
2. **Give `autoLayout` port positions**, not just port names — needs
   `resolveNozzlePositions` split so port *directions* are known before
   coordinates are final.
3. ~~**Expose `portMetadata` to layout**~~ — **DONE.** `portMetadata` now
   delegates to `PID_PLACEMENT.portRole`, and `placement-rules.js` loads before
   `pid-parser.js`. One table, and the two drifted copies are gone.
4. **Expose declared loops to layout** — `data.loops` exists from `parser:462`
   and the redesign doc calls it *"the domain's missing central concept"*
   (T5.1). The facts layer now reads it and
   `controller-above-manipulator` is implemented against the triple.
5. ~~**Then** write rules.~~ — **DONE, and measured.** See §0d W4.

### The correction W4 forced

W4 built the rule layer exactly as specified above, and the measured result was
**+105 across the corpus** — a regression. The design above assumed rules would
be satisfied by *moving entities after* the coordinate solve. They cannot be:
the move changes nozzle runs, tap hosts, label stacks and bubbles that were
already positioned relative to the entity, and none of those consequences are
visible to the rule that caused them.

So there is a **sixth** requirement, and it is the real one:

6. **Rules must be terms in the coordinate solve, not corrections applied
   after it.** `autoLayout`'s median/barycentre assignment (`router:208-250`)
   already computes a target for every entity from its neighbours; a rule
   supplies a *constraint on that target* rather than a *delta applied to the
   result*. Consequences and decision become the same decision, which is what
   makes the corpus net positive instead of net negative.

This is T3.1/T2.4 from `P&ID-ENGINE-REDESIGN.md` and it is now the blocking
item for the entire rule layer. It is also the same change that makes `fill`
steerable (§0a root cause 1), so the two are one piece of work, not two.

### What this supersedes

Once rules exist, several items from 0a stop being score-tuning guesses and
become rule definitions instead — the instrument tier (0a **F**), the orphan
policy (0a **E**), the channel allocation (**G**). And 0a **A** (make `fill`
steerable) becomes far less important: a drafter's rules fill the sheet by
construction, whereas `fill` is only a symptom of missing rules. **This is the
highest-value work in the document and it is not on the original list.**

---

## 0d. WORK LOG

Format: `[n] step — result — verdict`. Baseline at start of work:
`REGRESS OK`, `min 65 · split 45 · dense 384 · manifold 225 · spike 789`,
`spike` render 31.1 s.

### Sequencing decision

§0c lists the dependency order as (1) move `resolveTopology` before
`autoLayout`, (2) port positions, (3) `portMetadata`, (4) loops, (5) rules.
Starting at (1) directly is wrong, for two measured reasons:

**a. Step (1) alone does not enable rules.** The blocker I identified is port
*world position*. But a large class of rules keys on **authored** port names,
which are already in the pipe records from parse time (`p.fromPort` = `suction`,
`discharge`, `feed`, `bottoms`, `reflux`). Those are available to `autoLayout`
*right now*. So steps (3) and (4) can be done first, safely, and they unlock
real rules immediately. Step (1) is still required, but it is then a
refinement to a working rule engine rather than a speculative one.

**b. Step (1) will change port selection, not just port visibility.**
`resolveTopology`'s auto-port scorer (`router:1797`) picks a port by
`dir.x * pd.x + dir.y * pd.y` — alignment between the port normal and **the
direction to the far endpoint**. That is position-dependent. Running it before
layout means "far endpoint" is wherever the parser last put it, so the ports
chosen will differ from today's. That is a genuine behavioural change and must
be blessed deliberately, with the sheets looked at, not slipped in.

Revised order:

| step | what | risk |
|---|---|---|
| **W1** | shrink the 72-candidate search to the two axes that measurably pay | zero (measured) |
| **W2** | semantic facts layer: `portMetadata` + equipment role + declared loops, exposed to `autoLayout` as read-only | zero — pure functions, no mutation |
| **W3** | `placement-rules.js`: rule registry + `when`/`assert` + a diagnostics channel for fired/conflicting rules | zero — rules ship **off** |
| **W4** | implement rules one at a time, each measured individually; enable only those that win | the actual work |
| **W5** | move `resolveTopology` before `autoLayout` (T3.11 generalised) | high — deliberate re-bless |
| **W6** | instrument bubble follows the tap **landing point**, not the host centre | **the residual +20 from W4, and the last blocker on enabling any rule** |

The governing principle from W3 onward: **a rule that ships enabled must have
been measured alone.** No bundles.

### W1 — shrink the search

Measurement (0a): on `dense · split · min · manifold`, dropping the third row
pitch and the third/fourth column pitches gives a byte-identical `719`; going
to 12 candidates is also `719`. The order axis pays (`orderSearch:0` → 851)
and the coord sweep pays (`coordSearch:0` → 806). So: keep 3 orders, 2
sweeps, 3 row pitches → 2, 4 col caps → 2 = **24 candidates**.

### W1 RESULT — applied, after two wrong answers

**This step produced three measurements and only the third was right. The wrong
ones are recorded because they are the useful part.**

**Attempt 1 — drop the middle row pitch and the third/fourth column pitches
(72 → 24).** Measured `dense · split · min · manifold` at a byte-identical
`719`, and `spike` at `789` with every sub-metric identical and 31.2 s → 20.8 s.
On that evidence it looked free.

**Attempt 2 — same idea, first form.** Implemented and ran `regress.mjs`:
**REGRESS FAIL**. `manifold` 225 → 264, and a genuine determinism flag
(`225 normally, 264 with --debug`). Direct bisection found the cause:

```
manifold  colMaxAlt3:150 -> 225      colMaxAlt3:110 -> 264
          colMaxAlt3:0   -> 264      colMaxAlt3:200 -> 264
manifold  rowSpacingAlt2:145 -> 225  rowSpacingAlt2:220 -> 225
```

`manifold` needs column pitch **150**, and attempt 2 had dropped exactly that
value. The lesson is narrow and worth stating precisely, because the general
version of it is wrong:

> The values that never win on this corpus are **not contiguous**.
> 110 and 200 are dead; 150 is load-bearing for one sheet and 220 for another.

My four-sheet sweep had already included `manifold` and still missed it,
because I swept `rowSpacingAlt` and `colMaxAlt` but read the result as "the
reduced set is fine" rather than "the reduced set happens to win here". A tie in
a two-point sweep cannot distinguish "this value never wins" from "this value
wins but I already have it".

**Attempt 3 — drop only what measured free: row pitch 220, column cap 200.**
Keeps `{row} {145, 300}` × `{col} {0, 110, 150}` = **36 candidates**.

| sheet | before | after | before | after |
|---|---|---|---|---|
| demo | 344 | **344** | 3371 ms | 3371 ms |
| spike | 789 | **789** | 31168 ms | **16008 ms** |
| dense | 384 | **384** | 5523 ms | 2808 ms |
| min | 65 | **65** | 267 ms | 175 ms |
| split | 45 | **45** | 102 ms | 70 ms |
| manifold | 225 | **225** | 3081 ms | 1543 ms |

`REGRESS OK` on all five, every score digit unchanged, warnings unchanged,
audit counts unchanged. **72 → 36 candidates; spike 31.2 s → 16.0 s (49%
faster), corpus 33.5 s → 24.0 s.** `layout.searchWide = 1` restores the full
four-value column axis.

**Half the win, twice the care.** The honest summary is that the search cut is
worth having and worth roughly 25% of wall-clock across the corpus — but it is
also the *easiest* win in this document and it buys no layout quality at all.
It exists to pay for W4.

### W2/W3 — the placement rule layer

New files: `placement-rules.js` (data + predicates), `placement-audit.mjs`
(corpus runner with a self-test). Both **diagnostic only** — no engine file is
loaded or modified, so the regression suite is untouched by this step.

Three things came out of building it, in order of value:

**1. A rule was silently dark on the whole corpus.** Port roles do not live on
the pipes. `V-1 -> P-1` carries no port at all; `suction` appears only on
`nozzle NZ-P1-S on P-1 port suction`. So a rule keyed on authored pipe ports
sees nothing. The facts layer therefore also reads `data.nozzles` for declared
ports, and adds a **provisional binding**: where a pipe names no port and the
entity has exactly one unused declared port of the implied role, the binding is
unambiguous and is taken — marked `inferred: true` so W5 can replace it with
the authoritative `resolveTopology` answer. Before this, `suction-source-above`
fired **0 times in the entire corpus**. After: 7 applies, **5 violations**.

**2. My own up/down links were swapped**, and the audit was measuring the
reverse edges. Fixing it dropped `flow-direction-consistent` from 50 violations
/ 5544 mm to 18 / 2775 mm. Worth recording because the first number was
confident, plausible, and wrong — which is exactly the failure mode the
project's own §9.67 post-mortem describes ("a probe that lied, and what it
cost"). The lesson generalises: **a measurement harness needs a self-test, not
eyeballs.** `placement-audit.mjs --selftest` now asserts 18 cases including the
coordinate frame (SVG y grows downward, so "above" is smaller y), and it caught
two real bugs on first run.

**3. `controller-above-manipulator` was a stub** returning `[]` — a rule that
can never fail, in a registry whose whole justification is auditability. Now
implemented against the loop triple.

#### Measured baseline — what the current layout actually gets wrong

`node placement-audit.mjs`, corpus total:

| rule | applies | violations | measure | status |
|---|---|---|---|---|
| `flow-direction-consistent` | 75 | 18 | 2775 mm | worst by measure |
| `heater-beside-vessel` | 4 | 4 | 248 mm | matches the visual defect in `dense` |
| `suction-source-above` | 5 | 3 | 225 mm | **newly visible**, and the only rule with a working solver — see W4 |
| `overhead-return-level` | 2 | 2 | 125 mm | the reflux line in `dense` |
| `orphan-co-location` | — | 0 | 0 mm | the *metric* never fires; the visible stranding is real but my 200 mm threshold does not catch it — **threshold is wrong, rule needs rework** |
| `controller-above-manipulator` | — | 0 | 0 mm | clean |

The important column is not the measure, it is **which rules the engine passes
for the wrong reason**. `orphan-co-location` reporting 0 while `D-1` visibly
strands in the void of `dense` means the rule is mis-specified, not satisfied.
That is now a known-bad rule and must not be reported as a pass.

### W4 — rule 1 shipped: `suction-source-above`

The constraint solver (`enforce`) is wired into `autoLayout` after
`passDecrowd`, gated by `layout.placementRules` (master) and one key per rule.
`audit()` stays read-only; `enforce()` satisfies the *enabled* rules and
reports what is **still** violated afterwards, as `PID-LAY-003`.

Ordering is load-bearing and was decided before the code: `passDecrowd` is a
collision solver and rules are an ordering constraint. Rules run last, so they
have the final word on **order** and decrowd on **proximity** — the other
order makes the two oscillate. A rule that cannot be satisfied without a
collision is **reported, never forced**, because a forced move hides the cause.

#### Result: the rule works — and enabling it is a NET REGRESSION

**Ship state: DISABLED.** `layout.ruleSuctionSourceAbove` defaults to 0 and
`layout.placementRules` defaults to 0. The solver and the rule are correct; the
*post-hoc application* is not. Measured with it enabled:

| sheet | off | on | Δ |
|---|---|---|---|
| demo | 344 | 390 | **+46** |
| spike | 789 | 811 | **+22** |
| dense | 384 | 390 | **+6** |
| manifold | 225 | 256 | **+31** |
| min | 65 | 65 | 0 |
| split | 45 | 45 | 0 |
| | | | **+105** |

And the reason is not subtle once the sub-metrics are read. On `dense`, the
rule does exactly what it promises:

| dense | off | on |
|---|---|---|
| crossings | 5 | **2** |
| bends | 35 | 37 |
| length | 3079 | 3179 |
| `PID-LAY-003` (still violated) | — | **none** |

But the same move costs elsewhere, and the cost is in the columns the score
prices: `demo` utilisation 37% → **25%**, `tapReachTotal` 91 → 143, `length`
1590 → 1188; `manifold` `labelCollisions` 0 → 1 and audit `[15]` 6 → 10;
`spike` crossings 7 → 10. The corpus buys three fewer crossings on one sheet
and pays for it with sheet emptiness, label collisions, and more crossings
elsewhere.

**This is the project's own governing rule, arriving from the other
direction.** `REDESIGN.md:63-96` says *"the layout cannot price a consequence
of a decision it has not finished making"* — and the consequence here is that
a constraint applied **after** the coordinate solve cannot pay for its own
knock-on effects. Moving a pump 15mm after placement drags its nozzle runs,
re-positions its tap host, changes which label stacks land on which pipe, and
shifts the bubbles that `passInstruments` placed relative to it *before* the
move. Every one of those is a real cost, and none of them were in the decision
the rule was making.

The conclusion is architectural, and it reorders the remaining work:

> **A placement rule that must run after the coordinate solve is the wrong
> shape.** It has to be *inside* the solve — as a term in the median/barycentre
> assignment — where the consequences and the decision are the same decision.
> That is T3.1/T2.4 territory and it is now the blocking item for the whole
> rule layer, not a nice-to-have.

This is the fourth time in this project's history that a score-shaped fix
measured worse (the others are catalogued in `pid-rules.js:155-219`). The rule
layer is not exempt from that discipline, and shipping it because it *feels*
more principled than a weight would have been exactly the mistake.

#### The correction, measured: rules inside the coordinate solve

`constrainTargets(data, want, opts)` now edits the **target** the median
barycentre step computes (`pid-router.js:225-233`), *before* the `>= SEP`
packing and re-centring, and *inside* the iteration so it re-derives from the
neighbours' current positions each sweep. A rule returns a preferred y; the
packer still gets the last word. Consequences and decision are the same
decision.

Same rule, same gap, two architectures:

| | post-hoc `enforce()` | in-solve `constrainTargets` | rules off |
|---|---|---|---|
| demo | 390 | **349** | 344 |
| spike | 811 | **794** | 789 |
| dense | 390 | **389** | 384 |
| manifold | 256 | **230** | 225 |
| min / split | 65 / 45 | 65 / 45 | 65 / 45 |
| **total Δ** | **+105** | **+20** | — |

**+105 → +20.** The architecture was the problem, and moving the same rule
inside the solve recovered 85% of the cost. That is the evidence for §0c's
correction, and it is why the post-hoc path is kept in the file rather than
deleted: the comparison is the argument.

And on `dense` the rule is now **fully satisfied** — `ruleTargets`
`{"suction-source-above": 2}`, `enforce` moves 0, `postViol 0`, no
`PID-LAY-003` — with crossings 5 → 2, at a cost of one extra warning.

#### The residual +20, and it is a single known coupling

The +5 on each of the four sheets is **one warning**, and it is a legitimate
one:

```
[PID-INS-006] tap "FT-1 -> P-1": 31.0mm of sideways travel for a 40mm run
(limit 30mm) — the bubble is not above its landing point
```

Moving the pump moves its nozzle, which moves its process line, which moves the
tap landing point. `passInstruments` places the bubble over the **host centre**,
so after the move it is no longer over the landing point. This is T3.11 —
*"stack the instrument bubble on the tap's LANDING POINT rather than the host's
centre"* — and it is the one coupling the in-solve form does not fix, because
the landing point does not exist until `renderInto` has routed the line, long
after layout.

So the remaining work is precise and already identified: **make the bubble
follow the landing point.** That is §3.3 / 0a **F** (instrument tier as a hard
constraint on its host), and it is a *later-stage* fix, not a layout one. Until
it lands, the rule is **still shipped disabled** — +20 is a real regression and
the discipline in `pid-rules.js` does not have a "it's only 1%" exception.

#### What is still worth keeping

All of it. The layer ships **inert but complete and tested**:

- the constraint solver, the facts layer, the gate mechanism, the audit, the
  self-test, and the `PID-LAY-003`/`004` diagnostics are all correct
- `regress.mjs` now runs `--gates` and **fails** on a mismatched gate key —
  verified by deliberately misspelling one: `REGRESS FAIL: placement-rules:
  1 gate problem(s)`
- the audit baseline (which rules the current layout violates) is what makes
  the next attempt measurable

The next attempt is not "try harder with the post-hoc solver". It is
`heater-beside-vessel` and `overhead-return-level` implemented **inside the
coordinate solve**, with the 2-D aspect objective from §0a root cause 1 — since
that objective is what finally makes `fill` steerable, and `fill` is what
rewards the solver for not emptying the sheet.

#### Four bugs, and every one of them was silent

This is the real content of the step. None threw; all four had to be found by
comparing a direct `rule.solve()` call against `enforce()`.

**1. The audit was counting the author's intent as engine defect.** All 5
`suction-source-above` "violations" were pumps with an explicit `at`. The
rule's `check` ignored `_fixed`; only the solver's `enabled` respected it. So
the number that justified the rule's existence was 100% false positive. Fixed
in `audit()` for every rule, not per-rule.

**2. The rule was specified as a single-entity move and so was
unsatisfiable.** "Move the pump down" hit V-2 35mm away on every step. The
constraint is *"pump below source"* — **either party may satisfy it**, and
moving the source (a valve) is free where moving the pump is not. Expressing
it as a one-sided move made a satisfiable constraint look impossible, which is
precisely how a rule layer gets abandoned.

**3. Clearance was Euclidean on a one-dimensional move.** A vertical slide was
blocked by entities 185mm away in x, because `Math.hypot` counted them. A 1-D
move needs 1-D clearance: overlapping in x **and** within `minSep` in y.

**4. The step loop tested the current position instead of the prospective
one.** `var dy = (other.y - ent.y) * sign` measured where the entity *was*,
so every candidate step was rejected before it could ever be far enough. The
solver looked correct, returned `false`, and moved nothing. Fixed to measure
`ny`.

And the gate bug that made (1)–(4) invisible:

**5. The per-rule gate was derived by string munging.**
`'layout.rule' + id.replace(/-([a-z])/g, …)` does not capitalise the first
letter, so `suction-source-above` became `layout.rulesuctionSourceAbove`,
which matches no registered key. **Every rule therefore read as disabled,
permanently, silently** — `enforce` reported 0 moves and no error. A derived
config key that can silently miss the registry makes a rule unturnable *and*
unmeasurable. Gates are now declared as a `gate:` field, and
`assertGates()` + `placement-audit.mjs --gates` fails the build if a
solver-capable rule names a key that does not exist.

The general lesson, and it is the same one as §9.67 in the redesign docs
("a probe that lied, and what it cost"): **every one of these produced a
plausible number.** `moves: 0` is not an error, it is a plausible reading of a
system that is working. A measurement needs a cross-check that can disagree
with it — here, calling the solver directly and comparing.

#### Structural additions made for this

- `portMetadata` (`pid-parser.js:983`) now **delegates** to
  `PID_PLACEMENT.portRole`. The two regex chains had already drifted: the
  parser knew `vent`/`drain`/`sample` as distinct roles, the rules layer
  collapses them to `top`/`bottom` because a placement rule does not care
  which. Both are right for their own use, which is exactly why one table
  beats two. `placement-rules.js` loads **before** `pid-parser.js` in
  `harness2.mjs`, `placement-audit.mjs`, and `package.json`'s engine list.
- `placement-audit.mjs --selftest` now asserts 18 cases + gate integrity.
- `placement-audit.mjs --gates` is a standalone gate check.
- New codes `PID-LAY-003` (rule still violated after layout) and `PID-LAY-004`
  (solver threw).

### W4 — remaining rules, ordered

Ordered by (measured violations × certainty that the rule is correctly
specified), not by measure alone:

1. ~~**`suction-source-above`**~~ — **solver complete and measured; SHIPPED
   DISABLED.** It fixes what it targets (`dense` crossings 5 → 2) but the
   corpus total is **+105**. The blocker is architectural: a constraint applied
   after the coordinate solve cannot pay for its knock-on effects. Re-attempt
   inside the solve, not after it.
2. ~~**`heater-beside-vessel`**~~ — **SHIPPED 2026-10-10 via `affinityRehome`
   (W5 §5.2), dense 384 -> 369.** It needed a new shape of target — a
   *proximity* constraint, which the placer could not express because x is
   rigid per rank-column — so it became a roster re-home rather than a y-target.
   4 violations / 248mm -> 3 / 115mm on the audit.
3. **`overhead-return-level`** — 2 violations, 125 mm. Same shape as rule 1
   (single-axis y ordering), so it can be written as a `target` immediately.
4. **`orphan-co-location`** — reports 0 while the `dense` stranding is visibly
   real, so the **rule is mis-specified**. Likely wrong twice: it only considers
   `processDegree === 0` entities, and 200 mm is a guess. Do not implement until
   it reports the stranding honestly. Better shape: measure distance to the
   entity's *instrument or tap host*, not to the nearest anything.
5. **`flow-direction-consistent`** — largest by measure (2775 mm) and
   **probably a bad rule**. `dense` legitimately returns to `C-1` on reflux;
   left-to-right is a drafting preference, not a correctness property.
   Demote to a soft preference or drop. It now carries `solve: null` and a
   comment saying why, so it cannot be enabled by accident.

### The reusable parts, for whoever picks this up

| piece | where | note |
|---|---|---|
| `semanticFacts` | `placement-rules.js` | pure, read-only, total; safe before or after layout |
| `tryMove` | `placement-rules.js` | 1-D slide; `sign` = +1 below / −1 above; rolls back on failure |
| `isClear` | `placement-rules.js` | axis-aware clearance; `minSep` 0 = rely on `passDecrowd` |
| **`constrainTargets`** | `placement-rules.js` | **the in-solve form — use this.** Returns a preferred y per entity; the packer still decides |
| **`affinityPlan`** | `placement-rules.js` | **the 2-D form (W5).** Pure planner returning roster re-homes for proximity rules; the router splices `column[depth]` before the barycentre sweeps |
| `enforce` | `placement-rules.js` | post-hoc form; **measured +105 vs +20 — do not build new rules on this** |
| `assertGates` | `placement-rules.js` | every solver **or target** rule must name a live registry key |
| `--selftest` / `--gates` | `placement-audit.mjs` | run both before trusting any number here |
| **`probe-fire.mjs`** | repo root | **the cross-check.** Fire/move/score-diff per sheet, `--shot` for before/after PNGs. A rule that changed nothing looks like a rule that never ran; this is what tells them apart |

**When adding a rule, in this order:** declare `gate` → write `applies` and
`check` → run `--gates` → measure the audit baseline → only then write
`target` **and `enabled`** → measure it on alone → enable. Three of those steps
exist because skipping them produced silent no-ops: the derived-gate bug (W4),
the missing-`enabled` throw inside constrainTargets (W5), and a rule that
shipped dead with `moves: 0` reading as success.

**Write `target`, not `solve`.** The `solve` form exists only so the +105/+20
comparison stays reproducible. A new rule written against it inherits the
wrong architecture.

Each rule must be measured alone before any is enabled, and a rule that ships
enabled needs a corpus row proving it. `--case=<n> -v` gives per-sheet detail.

Status: W1 landed. W2/W3 landed as diagnostics. W4 shipped the rule layer and
disabled its only enabled rule on measurement. W5 (below) shipped the 2-D
capability and fixed the diagnostic noise that had contaminated every rule
measurement taken with the master switch on.

### W5 — the 2-D capability, a diagnostic bug, and the first shipped rule

2026-10-10. Three results, in the order they were found, and the middle one is
the reason the other two are trustworthy.

#### 5.0 First: a diagnostic that lied, which contaminated every rule measurement

With the master switch `layout.placementRules:1` on and **no rule keys at
all**, the corpus moved:

```
demo 344 -> 349   spike 789 -> 794   dense 384 -> 389   manifold 225 -> 230
```

+5 per sheet, byte-identical geometry on every sub-metric. Cause: `enforce()`'s
post-solve audit (`rep.post = audit(data)`) scores **every rule regardless of
enablement**, and the `PID-LAY-003` emission walked a hardcoded `ENFORCEABLE`
list without consulting the per-rule gate — so `suction-source-above`'s
baseline violation was reported as *"still violated after layout"* on sheets
where the solver was never allowed to touch it. One warn = 5 points, and the
warning was pure fiction.

Fix: gate the emission on `ruleParam(en.gate, 0)` and derive `ENFORCEABLE`
from `RULES` instead of a hand-kept list. After the fix, `placementRules:1`
alone reproduces the baseline **exactly** (344 / 789 / 384 / 65 / 45 / 225).

This is not a cosmetic bug. **Every per-rule measurement ever taken with the
master switch on carried +5/sheet of noise**, including the W4 in-solve row
that shipped `suction-source-above` disabled. The rule's own verdict survives
re-measurement (see 5.3), but any near-threshold measurement made before this
fix was unreadable.

#### 5.1 `heater-beside-vessel` needed a capability the placer does not have

The rule is a PROXIMITY rule, and proximity is not expressible as a y-target:
x is rigid per rank-column (`e.x = XMARGIN + colX * COL`), and a reboiler's
rank is always its vessel's rank + 1, so it lands one full column pitch to the
right. Measured on `dense`: E-1 **210mm from C-1** (dx=185, dy=100) — a
horizontal gap no y-target can close.

The mechanism that fixes it is a **roster decision, not a coordinate
decision**: re-home the heater into the vessel's rank-column before the
barycentre sweeps. `placement-rules.js` gained `affinityPlan()`, a pure planner
returning moves the router applies as a `column[depth]` splice, and the router
pass sits between the rank rosters and the sweeps. The sweeps then do the
drafting work for free: `belowFlag` already sorts bottoms-fed entities into
the lower rows of their column, so a bottoms-fed heater lands **below** its
vessel with no new ordering code.

Conservative by construction — an ambiguous peer set abstains, an authored
peer abstains, a target column at its cap abstains. The self-test asserts
purity (the router hands the planner its live rosters) and the exact pairing
on `dense` (E-1 -> column(C-1)).

#### 5.2 SHIPPED: `layout.affinityRehome` default 1

Measured alone, then both changed sheets looked at (`probe-fire.mjs --shot`):

| sheet | before | after | Δ |
|---|---|---|---|
| demo | 344 | 344 | 0 (no heaters on this sheet) |
| spike | 789 | 787 | **−2** |
| dense | 384 | 369 | **−15** |
| min | 65 | 65 | 0 |
| split | 45 | 45 | 0 |
| manifold | 225 | 225 | 0 |
| **total** | **1852** | **1835** | **−17** |

`dense` is the headline: `fill.util` **45 → 63**, `fill.gap` 0.17 → 0. That is
the first mechanism in this project to fill the vertical void §0a root cause
2 diagnosed — the reboiler drops to one row below its column instead of a
stranded column to its right, and the drawing reaches the bottom of the frame.
`spike` buys maxSignalLen 220 → 130mm, signalLenTotal −275mm, leadInShort
30 → 9 and warnings 15 → 8, paid for by crossings 7 → 14 and bends +18.

Audit after the change: `heater-beside-vessel` 4 violations / 248mm → **3 /
115mm**. The residuals are honest: `dense`'s E-1 is now one row below its
column (135mm) and priced by a 120mm threshold that predates same-column
placement — a known-bad diagnostic, not a defect; `spike`'s E-102 serves **two**
vessels in different columns and the planner abstains on ambiguity by design.

Gated on its own key, **not** on `layout.placementRules`: the master switch
means "run the post-hoc `enforce()` solver", and a pre-coordinate roster
change is a different mechanism with a different failure mode. Master-only is
now certified byte-identical to baseline, so the two keys are independent.

#### 5.3 Re-measured: `suction-source-above` is still a regression, cleanly

The W4 row (+20 in-solve) was taken with the 5.0 noise in the harness, so it
was re-run on the new baseline with the fix in:

| sheet | baseline | + rule | Δ |
|---|---|---|---|
| demo | 344 | 390 | **+46** (util 37 → 25%) |
| spike | 787 | 845 | **+58** |
| dense | 369 | 339 | **−30** (tapReach 24 → 0, maxSignalLen 219 → 110) |
| manifold | 225 | 229 | +4 |
| **total** | | | **+73** |

The pattern is now unmistakable: where the rule applies it satisfies its own
targets completely, and it pays with sheet emptiness on every other sheet —
the instrument-tier coupling of §3.3 / W6, priced by `util`. The verdict
(revert) is unchanged; the row is now clean.

#### 5.4 Measured and neutral: `overhead-return-level` in-solve target

Implemented as the same y-ordering shape as rule 1 (the reflux/top source sits
*level* with the vessel it returns to; median over peers so the target cannot
oscillate between them across sweeps). Writing it caught a **silent no-op of
the same species as 5.0**: `constrainTargets` gates on `rule.enabled()`, and a
rule with a `target` but no `enabled` throws inside a try/catch that reads as
"does not apply" — invisible forever. The self-test that found it now asserts
the target actually moves and abstains when off.

Corpus row: **byte-identical on all six sheets**. The target fires on `spike`
(8 adjustments) and the final layout is unchanged — on this corpus the
preference is already satisfied where it applies. It ships at 0, because a rule
that ships enabled needs a corpus row proving it and this row says "no change".
`assertGates()` was extended to cover target-only rules for the same reason:
an undeclared gate reads as disabled, silently.

#### 5.5 New tool: `probe-fire.mjs`

The W4 lesson — *a measurement needs a cross-check that can disagree with it* —
is now a command. Per sheet: did the target/affinity phase run at all, which
entities moved, the flat score-object diff, and any new warnings.
`--shot` adds before/after PNGs through Chrome, which is the project's own
gate ("a layout change is not done until the demo sheet has been looked at").
`node probe-fire.mjs x layout.ruleSuctionSourceAbove --shot` is the standard
shape for the next rule.

**Next up, unchanged:** W6 (the instrument bubble on the tap *landing point*)
is still the blocker that would let the y-ordering rules pay for themselves.
The 2-D capability is now in place for any future proximity rule; the E-102
ambiguity case (two peers, one home) is the first question it raises.

### W6 — the shape of a sheet is a choice, and the choice was dead code

2026-10-10, second pass, on the demo sheet's complaint that the drawing is a
thin band across the top of a 1.55:1 page with ~55% of the sheet empty.

**The finding.** `layout.colsPerRowMax` shipped at **99**, and the aspect-
matching branch is `else if (numCols > 2)` off a `colsCapRule > 0` guard — so
with the cap above the rank count the entire sheet-aspect search was DEAD CODE
(IMPROVEMENTS.md 0.6, confirmed by instrumenting the read: `colsPerRowMax ->
99`, and by byte-identical renders at caps 3/4/5/6, because every one of them
collapsed to the same `min(colsPerRow, cap, numCols)`). Every sheet wrapped at
`floor(availW / colSpacing)` regardless of its shape.

**The demo's band has a second cause, and it is the interesting one.**
`byId` covers equipment and valves, so every pipe passing THROUGH a junction is
dropped from the flow graph before the ranker sees it. On the demo that dropped
7 of the chain's 10 edges: TK-101 -> J-0 -> V-101 -> P-101 -> V-102 -> J-1 ->
{V-103, V-105, PSV-101} -> J-2 -> OP-101 collapsed from an 11-deep chain to
**THREE ranks**, six of the ten entities in rank 0 with no edge placing them.
Measured: rank 0 held TK-101, V-101, V-103, V-105, V-106 and PSV-101.

Ranking through junctions was tried and **rejected on measurement**: spike went
787 -> 7972 with 5 errors, and the demo's 9-rank chain wrapped into a U that
doubled the discharge back across the sheet (rendered and looked at). The
boustrophedon wrap is a snake, and a snake needs a crossing-aware ordering to
be readable — that is §3.1's Sugiyama work, not a one-line reorder. Filed, with
the numbers, not pursued.

**What shipped instead: the aspect search, with a balance tie-breaker.**
The pure aspect metric is right about block shape and wrong about emptiness —
for dense's 8 ranks it prefers a 6+2 split (error 0.037) over 5+3 (0.146), and
the second row is then 2/6 full: measured, dense util 53% -> 38% and the sheet
+33. So the search now picks among aspect-equivalent candidates (`wrapAspectTol`,
0.2 in log space) the one whose rows are most BALANCED, and the registry default
moved 99 -> 0 to enable it.

| sheet | before (cap 99) | after (aspect, balanced) | Δ |
|---|---|---|---|
| demo | 313 (util 42) | 318 (util **64**) | +5 |
| spike | 885 | 865 | **−20** |
| dense | 360 | 359 | −1 |
| min | 52 | 52 | 0 |
| split | 41 | 41 | 0 |
| manifold | 246 | 246 | 0 |
| **sum** | **1897** | **1881** | **−16** |

Both changed sheets were rendered and looked at before shipping: the demo reads
as the two-row process it is (tank and its level tap at top-left, suction
through P-101 to the manifold, battery limit bottom-right) instead of a band
with the tank stranded at mid-left, and spike fills the sheet instead of
leaving the bottom third empty. `layout.colsPerRowMax:99` reproduces the old
band; `probe-fire.mjs --shot` is how the pair was compared.

The demo's +5 is a real cost and it is worth naming: the aspect wrap buys its
fill with crossings 0 -> 3 (unpriced by the score — see `routing.crossings` in
the objective), one more label collision (30 points), and +88mm of tap reach as
the pump moves away from the taps that land on it. That last one is W6 again,
and it is the third separate line of evidence for it.

**Measurement caveat recorded for whoever reads these numbers next:** the
corpus above was taken while `pid-symbols-bundle.js` was mid-edit by another
work stream (it moved between the two runs — the 326 -> 360 dense shift that is
NOT this change), so `regress.mjs` is red on the blessed baseline from that
edit, not from this one. Verified by stashing this change and re-running: still
red. Re-bless when the symbol work lands.


A P&ID generator: hand-written DSL text → semantic model → orthogonal SVG,
~13.8k lines across ten plain-JS files loaded by concatenation
(`harness2.mjs:6`). No dependencies, no build step, no bundler.

The good news, stated plainly, because it changes what "improvement" means
here:

- **The measurement discipline is genuinely excellent.** `pid-rules.js:104-237`
  documents every score weight with the experiment that chose it, including
  five weights that are deliberately `0` because making them non-zero made
  output *worse*. `P&ID-VISUAL-QUALITY.md` is 4.6k lines of findings with
  ~15 titled negative results and obituaries. Most projects never get here.
- **The visual pipeline is closed and gated**: `regress.mjs` diffs whole score
  objects byte-exactly against `expected.json`, plus an *independent* SVG-only
  auditor (`audit-svg.mjs`, 17 checks), plus pixel diffs.
- **0 errors, 0 label collisions** on all five regression sheets.

The bad news, and it is the whole point of this document:

- **The engine cannot afford its own search.** `renderPid` runs a
  **72-candidate product search** (VERIFIED: `pid-renderer.js:3297-3317` —
  3 orders × 2 coord-sweeps × 1 sep × 3 row pitches × 4 col caps), and each
  candidate is a full parse + full route + full score.
  `spike.dsl` takes **31.1 s** to render (VERIFIED by direct run). `min` 276 ms,
  `dense` 5.5 s.
- **The search does not pay for itself in quality.** `P&ID-VISUAL-QUALITY.md`
  §9.76 measured the whole rule space: *"The search is at a local optimum over
  its entire rule space. Every remaining improvement is a new capability, not a
  new knob value."* 72 renders to gain what one correct pass would gain.
- **The DSL has three disagreeing specifications** and the one that ships
  (the parser) has hard-broken features that the others advertise.

So: the highest-value work is **not new rules**. It is (a) making one render
affordable, (b) making the DSL's three specs agree, and (c) removing the
shared-mutable-state hazards that make everything above untrustworthy.

---

## PRIORITY 0 — correctness defects that make the current output untrustworthy

These are not style issues. Each one either produces a wrong drawing or makes
the measured scores meaningless.

### 0.1 A* never sifts up. The heap invariant is broken. — VERIFIED

`pid-router.js:1430-1439` defines a `push(n)` helper that appends and sifts up.
Line **1481** calls raw `heap.push({...})` instead. The helper is never called
anywhere in the file (VERIFIED: the only `push` calls are 729, 784, 1431,
1481, 1602 — 1431 *is* the helper, 1481 is the one that should have called it).

Consequences:
- `pop()` (1441-1457) assumes a valid min-heap. With a broken invariant it
  returns an arbitrary node, so **A* expands in arbitrary order and its
  `gScore` is not the optimal-cost path**. Routes are valid but not minimal,
  non-deterministically so with respect to insertion order.
- Combined with `seen.add(k)` on *push* (1482) rather than on pop, there is no
  decrease-key, so the search is a best-first search with a corrupted frontier.

Fix: one word — call `push(n)` at 1481. Then **re-bless the corpus and check
whether scores improve or degrade**; a real minimality fix will change route
length and bend counts, and that is a signal, not a regression. Do this first
because every other routing measurement is downstream of it.

### 0.2 Shared mutable globals across a 72-candidate search — VERIFIED

The renderer is not re-entrant and not isolated per candidate:

| Global | Written at | Risk |
|---|---|---|
| `PIDEngine._isInst` | `autoLayout:440`, `routeObstacles:1087`, `avoidObstacles:1121`, `resolveOverlaps:1595`, `renderInto:268` | two renders corrupt each other; `entitySize` reads it |
| `PID_DRAW_SCALE` | `autoLayout:1060` | a layout function writing a rules global |
| `PID_COORD_ITERS/MIN_SEP/ROW_SPACING/COL_MAX` | set `parser:587-593`, reset `595-598` | **if `autoLayout` throws, they are never reset** and poison every later parse |
| `window.__pidGeo` | `renderInto:1566` per candidate | already a documented bug (last candidate ≠ winner), patched by snapshot/restore at `3335` |
| `window.__astarFails` | `router:1340` | never reset; accumulates across all 72 candidates, so the reported number is meaningless |
| `pidRng()` | 5 call sites sharing **one stream** | changing the *number* of consumers re-rolls every downstream decision |
| `_placedLabels`, `_tapLanes` | function-statics, `renderer:255` / `1889` | reset at entry but lazily re-created on read |

The engine already knows this is the failure mode — `renderer:3321-3335` is a
post-mortem of exactly this bug for `__pidGeo`. Generalise the fix.

**Action:** introduce a single `LayoutContext` object threaded through
`parse`/`autoLayout`/`renderInto`, holding `isInst`, `drawScale`,
`coordIters`, `rng`, `astarFails`, `placedLabels`, `tapLanes`. Replace every
module-level `var` in that list. This is the enabler for item 1.1.

### 0.3 Unbounded loop in fold-back removal — VERIFIED

`pid-router.js:1274-1295`: `while (changed) { … splice one fold-back; }` with
no iteration cap. Every other repair loop in the file is capped (12, 15, 40).
One polyline that re-creates a fold each pass hangs the process, with no
diagnostic. **Action:** cap at 20 and emit `PID-GEO-007` when the cap is hit.

### 0.4 A* `maxCells = 100000` hardcoded, not a rule — VERIFIED (`router:1324`)

Not in `PID_RULES.params`, so `measure.mjs --set=` cannot reach it. It is
derived from nothing; on a large sheet a legitimate route can exceed it, and
the failure is a silent straight-through fallback (`router:1325-1343`).

### 0.5 Registry defaults disagree with their call-site fallbacks — VERIFIED

Every one of these pairs disagrees, so `ruleParam` returning the fallback is
indistinguishable from the registry working:

| rule | registry value | call-site fallback | site |
|---|---|---|---|
| `routing.bendPenalty` | 20 | 12 | `router:1475` |
| `routing.dipPenalty` | 30 | 50 | `router:1476` |
| `routing.fieldNear` | 45 | 35 | `router:1188` |
| `routing.searchMargin` | 160 | 260 | `router:1313` |
| `routing.obstaclePad` | 6 | 4 | |
| `layout.decrowdAir` | 14 | 6 | |
| `layout.colsPerRowMax` | 99 | 0 | `router:111` |

Two registry keys are read but **do not exist** (VERIFIED by grep):
`layout.valveOffset` (`router:618`) and `annotation.labelOnLineTol`
(`renderer:2820`). `crossesLine` hardcodes `field >= 300` (`router:1550`)
instead of reading `routing.fieldCross`.

**Action:** a startup assertion that every `ruleParam('x.y', fb)` call site's
`fb` equals the registry value, or a lint rule. This is cheap and it makes the
"single source of truth" claim in `pid-rules.js` actually true.

### 0.6 `layout.colsPerRowMax: 99` makes 11 lines of code dead — VERIFIED

`pid-rules.js:277` sets `colsPerRowMax: 99`. `pid-router.js:113` branches on
`> 0`, so the `else if (numCols > 2)` aspect-matching search at
`router:115-125` **never executes**. The comment at `router:105-110` describes
that search in detail as if it runs. Set it to `0` or delete the branch.

Also dead in the same function: `availH` (`router:139`, documented as dead at
`268`) and `numRows` (`router:138`, never read).

---

## PRIORITY 1 — make one render affordable (unblocks everything else)

`P&ID-ENGINE-REDESIGN.md` already identifies this as **T3.1** and calls it
"the top performance item". Agreed. Here is the concrete decomposition.

### 1.1 Cache the parse across the search — VERIFIED opportunity

The 72-candidate loop calls `PID_PARSER.parse(source, {layoutOrder, coordIters,
minSep, rowSpacing, colMax})` 72 times. `parse` is **pure with respect to
`source`** apart from five search knobs — and of those, `layoutOrder`,
`coordIters`, `minSep`, `rowSpacing`, `colMax` only affect `autoLayout`.

So: split `parse` into `lexModel(source)` (once) and `layoutModel(model, knobs)`
(72 times). The lex/model phase — tokenising, schema defaults, tag validation,
line synthesis — is a substantial fraction of each candidate and is thrown away
71 times. **VERIFIED** the split is clean: `parser:585-599` is the only place
the five knobs are consulted.

This alone should cut per-candidate cost materially and is zero-risk to output.

### 1.2 Split layout from evaluation, then search on a cheap fitness — PROPOSED (T3.1/T3.2)

Do **not** route 72 times. Score placement with a layout-only function that
needs no polylines:

```
layoutFitness(model) = w1·rankCrossings + w2·bboxAspectError
                    + w3·entityOverlapArea  + w4·bubbleHostDistance
                     + w5·labelZoneConflict  + w6·terminalEdgeStrain
```

All six are computable from positions and ports alone. Take the best 3 by this
fitness, **route only those 3**, and pick the winner by the real
`score.total`. Expected: ~72 cheap evaluations + 3 routes instead of 72 routes.
On `spike` that is the difference between 31 s and roughly 2 s.

The docs note T3.3 (`minSep` as a real continuous dimension) is *"blocked on
T3.1"* — this unblocks it.

### 1.3 Incremental crossing/overlap bookkeeping instead of O(n²·s²) rescans — VERIFIED

`findCrossings` (`renderer:1003`), `countPer` (`renderer:721`) and
`findOverlapPairs` (`renderer:836`) are each O(n²·s²) and are recomputed
**inside** loops:

- `objective()` (O(n²s²) ×3) is called at `renderer:819` and `821` × 3 lines ×
  15 refine iterations ≈ **135 full O(n²s²) evaluations per render**
- `findCrossings` runs after **every** bend-shift iteration (`renderer:1044`)
  inside a 12-iteration loop
- the overlap pass loops **40 times** (`renderer:862`), calling `routeOne` up
  to twice per pair — and `routeOne` runs a full A*

Action: build a **uniform spatial hash over segments** once per render, and
make crossing/overlap queries O(1)-ish lookups. This is a pure speedup with
identical output, which makes it the safest large win in the list.

### 1.4 A* smoothing is O(n⁴) — VERIFIED (`router:1554-1581`)

6 outer passes × O(n²) endpoint pairs × O(n) `pathPenalty` sum per shortcut.
Cap the path length that enters smoothing, and skip `pathPenalty` when the
replacement is already shorter than a cheap lower bound.

Related, at `router:1537-1544`: a comment **documents a known hole** — any
diagonal in the replaced staircase makes `removed = Infinity`, so the
cost-improvement gate is vacuous for exactly those cases. Fix it.

### 1.5 `markLine` re-rasterises everything, per call — VERIFIED (`router:1188`)

Every `avoidObstacles` call re-walks **all** already-routed polylines to build
the penalty field. Total O(n²) in cells, called from 135+80+12 re-routes.
Incrementally update the field instead of rebuilding.

### 1.6 Reuse the route when the endpoints have not moved — PROPOSED

Most of the 72 candidates differ only in `rowSpacing`/`colMax`, which move many
endpoints by small amounts. A cheap validity predicate (both endpoints still at
the same port, corridor still clear, field cost still acceptable) would let a
large fraction of candidates skip A* entirely and reuse the previous
polyline. Exact-match caching on the 5-tuple gets most of this for free:

```js
const key = [from, fromPort, to, toPort, kind, view.grid, view.stubLength].join('|');
```

### 1.7 Hoist the `objective()` double-call — VERIFIED (`renderer:819`, `821`)

Two identical `objective()` calls per candidate line, each O(n²s²). Also
`best` is assigned at `renderer:794` and `821` and **never read**.

### 1.8 Add a performance gate to `regress.mjs` — PROPOSED

`harness2.mjs:66` already prints `renderMs`; `measure.mjs` parses it;
**`regress.mjs` throws it away** (VERIFIED: `parseHarness` at `regress.mjs:26`
has no `renderMs` branch). The cost of the 4th column pitch was 13.4 s → 28.7 s
and nothing caught it. Add `renderMs` to `expected.json` with a
`+25%` tolerance. Perf regressions in a layout engine are silent otherwise.

---

## PRIORITY 2 — the DSL has three specifications and they disagree

### 2.1 `assembly … end` is hard-broken and advertised as a feature — VERIFIED BY RUN

I ran it:

```
$ node harness2.mjs out.svg --src=_t.dsl
Error: pid parser: unrecognized line "assembly"
```

`pid-parser.js:347-352` collects the block into `assemblyRegistry` in pass 1,
but `parseWithExpansion` (`parser:369-550`) has **no branch for it**, so the
header line falls through to the `throw` at `parser:548`. The feature is
defined in the grammar (`pid-grammar.peg:68`), implemented in the assembler
HTML (`pid-assemblies.html:180` emits exactly this syntax), and unreachable in
the engine.

**Pick one:** implement it, or delete the grammar rule, the pre-scan, the HTML
emitter, and `regress/assembly-test.dsl`. Half-present and hard-broken is the
worst of the three options. Implementing it is maybe 30 lines — pass 2 just
needs to skip the `assembly` header/`end` lines that pass 1 already consumed.

### 2.2 Positional assembly arguments are dead and silently corrupt — VERIFIED BY RUN

```
use control-valve-bypass("FCV-101", "L1")
  -> THREW: unrecognized line "valve $tag-BV1 gate "Block valve upstream" …"

use control-valve-bypass(tag="FCV-101", line="L1")
  -> OK: FCV-101-BV1, FCV-101, FCV-101-BV2, FCV-101-BP
```

Cause: `subArgs` (`parser:430-440`) routes a param *with* a default to `named`
and one *without* into `positional`, but **no built-in body uses `$1`/`$2`** —
they all use `$tag`/`$line`. So positional arguments never substitute, `$tag`
survives literally, and the body emits `valve -BV1`. Had the ID charset been
stricter this would have created a valve with id `-BV1` instead of throwing.

Fix: map positional args to *param names*, not to `$N`. One line changes, and
positional usage starts working.

Two more latent bugs in `expandLine` (`parser:356-367`):
- values are used as a `String.replace` **replacement**, so `$&`, `` $` ``, `$'`,
  `$$` inside an argument are interpreted → silent corruption
- `new RegExp(`\\$${k}\\b`)` does not escape `k`; a param named `a.b` compiles
  a wrong pattern

Use a replacer *function* and `escapeRegExp` on the key.

### 2.3 The grammar is not load-bearing and has already rotted — VERIFIED

`pid-grammar.peg` is referenced by **nothing** — no script tag, no import, no
parser generator in `package.json`. It is not even valid PEG: no `statement`
alternative consumes a terminator, so `pid = header? statement* EOF` cannot
match any file ending in a newline.

Proven drift, all VERIFIED:

| # | grammar | reality |
|---|---|---|
| D1 | `modifier` has **no `flow`** | `parser:721` implements `flow forward\|reverse`; the flagship corpus `regress/_pv/demo.dsl:41-56` uses it 13 times |
| D2 | `newline` includes `";"` (`:27`) | parser splits on `\n` only — `pid; layout auto` is a parse error |
| D3 | — | `QUOTED_STRING` allows escapes (`:209`); every parser site uses `"([^"]+)"`, so `notes "He said \"hi\""` silently truncates |
| D4 | `mod_description` listed as "bare quoted string = description" (`:178`) | **unreachable** — `mod_label = QUOTED_STRING` (`:163`) is listed first, identical RHS, ordered choice always wins |
| D5 | — | parser's bare-string rule (`parser:723-725`) is **stateful**: 1st string → `label`, 2nd → `description`, 3rd **silently dropped** |
| D6 | `PORT = [A-Za-z][A-Za-z0-9_-]*` (`:203`) | process/signal pipes use `\.(\w+)` (`parser:541`, `:525`), and `\w` excludes `-`. `tap` uses `[A-Za-z0-9_-]+` (`:534`). So `E-1.shell-in -> X` is a **parse error** |
| D7 | `ID` starts with a letter | parser `[A-Za-z0-9_\-]+` accepts `9-valve` |

**Action, in order:**
1. Add `mod_flow` to `modifier`.
2. Delete `mod_description`; move the real (stateful) semantics onto `mod_label`.
3. Widen the port groups at `parser:525` and `:541` to `[A-Za-z0-9_-]+` — one
   character class, matches the grammar, matches `symbolConnections:1015`,
   which already allows `[\w-]+`.
4. Replace `"([^"]+)"` with the escape-aware matcher the bare-string branch
   already has (`parser:723`) — there is a working implementation 300 lines
   above the broken ones.
5. Decide `;`. Then **generate the grammar from the parser, or delete it.** A
   third rotted spec is a liability; two specs that disagree are a bug.

### 2.4 Zero source positions in any diagnostic — VERIFIED

All six parser `throw` sites (`parser:336, 403, 420, 548, 728, 744`) have
**no line, no column, and no diagnostic code**. The parse loop at `parser:370`
discards the line index. Three inconsistent diagnostic channels exist
(`data.warnings: string[]`, `data.errors: {code,…}`, thrown `Error`s) plus a
fourth via `validationMessages`.

**Action:** change the loop to `for (const [ln, rawLine] of text.split('\n').entries())`
and thread `{ line: ln + 1, col }` through every throw. Give each a
`PID-PARSE-NNN` code and register it in `pid-rules.js`. A 12-line change that
transforms "unrecognized line" from useless into actionable — for a project
whose whole premise is a text DSL.

Also: `pid-assemblies.html:1075` consumes diagnostics as opaque strings
(`i.message || 'validator flag'`), so the UI cannot render structure until this
lands.

### 2.5 Unknown entity types parse silently and render as the wrong symbol — VERIFIED

`parser:453` accepts any `[a-z0-9_\-]+` as a type with no check.
`pid-validator.js:411` raises `PID-SYM-001` as a **warning** and continues;
`parser:78/95/167` then fall back to `SYMBOL_KEYS.vessel`. So
`valve V-1 geat` produces a **valve drawn as a tank**, and the only signal is a
warning that the regress gate does not assert. `parser:946` additionally sizes
an unknown glyph to a silent `40`.

**Action:** validate `type` against the symbol manifest **at parse time** and
throw a positioned `PID-PARSE-004 unknown type "geat"; did you mean "gate"?`
with edit-distance suggestion. Cheap, and it catches the single most likely
authoring mistake.

### 2.6 `parseModifiers` silently discards and mis-parses — VERIFIED

- No duplicate detection: `equipment E pump "A" "B" "C"` → `"C"` **silently
  dropped** (`parser:723-725`).
- No positions: `rem` is a bare string; the error names a token, not a column.
- **One shared modifier function serves equipment, valve, instrument, pipe AND
  tap** — so a tap accepts `rotated`, `bubble`, `fail`.
- On a **pipe**, `.label` is pre-seeded from the line spec (`parser:632`), so a
  bare string flips into `description`. The meaning of `"text"` depends on a
  modifier emitted *after* parsing.
- `"([^"]+)"` at `:692,694,695,708,718` truncates on embedded `\"`.
- `\S+` at `:701-702` means `set-pressure 150 psi` silently reads `150`.

**Action:** split the bag into a **schema-driven table** — each statement type
declares its legal modifiers, and the parser validates against it. This gives
positioned errors, kills the cross-type leakage, and makes the grammar
generatable from the table.

### 2.7 `toSource` round-trip is lossy and lives in the wrong file — VERIFIED

`pid-renderer.js:3490-3572` emits only 15 modifiers (`rotated, symbol, scale,
stroke, tag, tag-above, no-type-label, size, rating, spec, normal, fail, mode,
set-pressure, bubble`). **Dropped:** `via`, `line`, `flow`, `service`, `system`,
`area`, `unit`, `plant`, `discipline`, `status`, `design`, `notes`, `attribute`,
`loop`, `name`. Also `toSource` lives in the **renderer**, so nothing keeps it
and the parser in sync — and `pid-assemblies.html:162-174` is a **third**
implementation of the same expansion, missing the positional path entirely.

**Action:** (a) move `toSource` next to the parser, (b) add a **round-trip
property test** — `parse(toSource(parse(x)))` must equal `parse(x)` — for every
corpus file. That single test would have caught 2.2, 2.3-D1, and the assembly
divergence.

### 2.8 Assembly system: no scoping, no recursion guard, no port remapping — VERIFIED

- Expansion is textual into the same flat model (`:446-449`). Two `use` of the
  same assembly with the same `tag` collide; feedback is a **warning**
  (`PID-TAG-001`), not an error.
- `parseWithExpansion` is recursive (`:449`) with **no depth limit and no
  visited set** → an assembly that uses itself hangs or blows the stack.
- Provenance `externalId` appends the assembly *name*, not the instance, so two
  instances share a chain. Provenance is also not applied to pipes, taps,
  junctions, stubs, loops, alarms, or relationships.
- Bodies hard-code port names (`.suction`, `.left`, `.top`). `assembly_arg`
  (`peg:77`) has **no port channel** — no way to remap an instance's ports.
- `assembly-test.dsl` exists but is **not in any runner** (`regress.mjs:9`,
  `visual-regress.mjs:42`, `preview.mjs:37`).

**Action:** add a max-expansion-depth guard (error, not hang), a real instance
namespace with a `prefix=` arg, port remapping in `assembly_arg`, and add
`assembly-test.dsl` to `CASES`.

### 2.9 Schema docs are load-bearing for nobody — VERIFIED

`pid-schema.js` is 571 lines of `@typedef` with **zero executable lines**, and
**no load list references it**. Three files cite it as authoritative
(`pid-parser.js:285`, `pid-validator.js:3,620`) while nothing evaluates it.
Meanwhile `schemaDefaults` (`pid-parser.js:286-317`) is the real spec and it
**disagrees** with the typedefs (e.g. `ports` is added later by the validator,
not by the factory).

**Action:** mark the header "documentation only — not loaded, does not match
`schemaDefaults`", or better: generate the typedefs from `schemaDefaults`.

### 2.10 DSL features that exist in the parser but have no test — VERIFIED

Zero fixtures for: `flow`, `via`, `stub`/off-page terminals, `legend on`,
`north-arrow on`, `show …`, `chips on`, `layout manual`, `route direct`,
`symbol "…"`, `scale`, `stroke`, non-square sheets, `seed N`, or **any error
path at all** (all five baselines have `"errors": []`).

Roughly 20 directives and ~25 modifiers are ungated. **Action:** one fixture per
directive is cheap and turns the DSL surface from "believed" to "verified".

---

## PRIORITY 3 — layout engine quality

### 3.1 There is no global placement optimisation, only a product search — VERIFIED

`autoLayout` (`router:54-1062`) is: Tarjan SCC + BFS layering (`processRank`,
7-48) → 2 barycentre sweeps (150-164) → grid slot assignment with boustrophedon
column order (183-194) → **median coordinate solve**, 4 iterations (208-250) →
3 greedy snap passes (`passJunctions`, `passInstruments`, `passValves`) →
2 relaxation loops (`passDecrowd`, 707-797) → centring. Then 72 brute-force
candidates.

This is a reasonable heuristic pipeline, but it means **crossing count is never
optimised directly**. Every layout metric is a side effect. There is no
objective, no crossing matrix, no median-of-crossings term.

**Action (PIVOT=PROPOSED):** after layering and ordering, build the **bipartite
crossing matrix** between adjacent ranks and add a proper **barycentre/median
heuristic driven by crossings** (the standard Sugiyama objective), iterated to
convergence. Swap it for the current 2 barycentre sweeps (150-164) and the
median-y solve (208-250). This is the single highest-leverage *quality* change
available, and it is the thing a real layout engine has and this one does not.

### 3.2 No real channel allocation — VERIFIED

"Channels" emerge only as a soft rasterised penalty field
(`router:1172-1187`: own cells `300`, neighbours `45`). There is no reserved
lane, no monotonic channel index, no guaranteed parallel-run spacing, so
consecutive vertical risers in the same column have **no minimum separation
guarantee**. This is why `P&ID-VISUAL-QUALITY.md` §9.13 says *"Parallel manifold
branches crowd"* and why 88 bends survive on `spike`.

**Action:** allocate integer channel indices per (column, direction) and give
each channel a fixed x-offset with a minimum pitch. Convert the `fieldNear`
nudge into a hard reservation. Straightforward, and directly attacks the
biggest remaining visual defect class.

### 3.3 Instrument tier is the #1 remaining visual defect — VERIFIED from the docs

`P&ID-VISUAL-QUALITY.md` §9.57: *"Instrument tier reads as disconnected. LT /
FT / PI / FIC float well above their hosts on long dashed runs … This is the
most visible remaining defect and is the natural next target."*
`tapReachTotal` is **226 mm on spike** and is priced at `0.2/mm` = 45 points —
so the meter *sees* it and cannot fix it, because placement and routing are not
coupled.

**Action:** place instruments as a **group with their host**, in the constraint
solver, and price bubble-host distance at selection time (T2.1's `CONSTRAINTS`
registry). Do **not** just raise the weight — the doc's own rule at
`REDESIGN.md:63-96` is *"The layout cannot price a consequence of a decision it
has not finished making."*

### 3.4 Magic constants that belong in the registry — VERIFIED, 20+ sites

Highest-value ones:

| value | site | meaning |
|---|---|---|
| `0.35` | `router:1800` | port-alignment ambiguity threshold — decides whether you get geometry or a hard error |
| `0.5` | `router:329` | valve mating-port score |
| `100000` | `router:1324` | A* expansion cap |
| `300` | `router:1550` | should read `routing.fieldCross` |
| `30` / `0.95` | `renderer:3416` | SA temperature / cooling — and SA is unreachable (see 3.8) |
| `150`, `110` | `router:593` | **sentinel comparison against the parser's default placement** — breaks the moment a default changes |
| `4.5 * SC` | 3 copies | instrument bubble radius, triplicated |
| `14`, `6`, `20`, `10` | `renderer:918,1509,1512` | bend-shift keep-outs |
| `0.6` | `renderer:2747` | text-ink area fraction |
| `PT-101` | `renderer:1413` | **hardcoded instrument tag in shipped code** — `window.__tapDbg` only ever debugs one tag |

### 3.5 Route repair passes mutate shared state — VERIFIED

- `routeOne` writes `pA._leadIn` / `pB._leadIn` (`renderer:547`) onto
  `p._from`/`p._to` — the same objects `resolveTopology` owns.
- `avoidObstacles` writes `orth._jEnds` / `orth._who` **onto an Array**
  (`renderer:622-625`).
- `shiftFor` mutates `geometries[i].pts` in place (`renderer:976, 993`), and the
  `pool` handed to `routeOne` holds references to those same arrays
  (`renderer:812, 876, 1070`).
- `resolveOverlaps` mutates `e.x/e.y` for anything not `_fixed`.

### 3.6 `passDecrowd` and `resolveOverlaps` run twice each, in a sandwich — VERIFIED

`parser:611` `resolveOverlaps` → `parser:621` grid snap → `parser:626`
`resolveOverlaps` again. Both are O(n²) per pass × 10 passes. `T1.1` in the
redesign doc targets exactly this and estimates ~300 lines. Agreed; do it as
part of the context refactor (0.2).

### 3.7 Instruments are placed against pre-placement keep-out boxes — VERIFIED

`router:456-463` pushes instruments into their own avoid-list at `i.y`
**before** any bubble is placed, and `autoLayout:529-532` reads
`_tap.lineTap`/`data.nozzles` which **do not exist yet** on a first parse
(nozzle materialisation is `router:1968`, called from `parser:638` — *after*
layout). That branch is a **documented no-op**. T3.11 proposes moving nozzle
materialisation before `autoLayout`; do it.

### 3.8 `--optimize=N` (simulated annealing) is entirely untested and broken — VERIFIED

`renderer:3415-3466` is reachable only via `opts.optimize`, and **no test
passes it** (VERIFIED — `regress.mjs` passes only `--candidates` and
`--seedbase`). Within it: `pidRng()` returns `null` when unseeded, so
`Math.floor(null * n)` is **always 0** (one valve) and `Math.exp(-delta/…)`
compares against `null`.

Either fix and test it, or delete it. Untested optimisation code that has never
run is worse than no code.

### 3.9 `route` directive is ignored — VERIFIED (READ)

`parser:386` parses `route avoid|direct` into `data.view.route`. Grep finds no
consumer in the router or renderer. The grammar advertises it (`peg:47`) and it
does nothing. Wire it to `avoidObstacles`' direct-route early exit
(`router:1280-1306`) or remove it.

### 3.10 Layered ordering should replace `PID_LAYOUT_ORDERS` — PROPOSED (T2.4/T2.5)

`PID_LAYOUT_ORDERS = ['JIV','JVI','VJI']` is searched as a *discrete axis*
because the three passes (`passJunctions` / `passValves` / `passInstruments`)
are order-dependent — an acknowledged architectural debt. Make the passes
**order-independent** (each consumes a constraint list rather than mutating a
shared placement) and the whole axis disappears: 72 → 24 candidates for free,
and one fewer place for hidden coupling to live.

---

## PRIORITY 4 — observability & the harness's blind spots

### 4.1 `regress.mjs` compares the whole score by `JSON.stringify` — VERIFIED

`regress.mjs:149`. Any weight tweak fails all five cases; `score.routing.k` is
`Math.round(k*1000)/1000` so float formatting is a test failure. The docs
record a case where blessing and verifying in one command produced 838 then 837.

**Action:** compare **named scalars** (errors, warnings count, overlaps,
crossings, offSheet, labelCollisions, total) and report vector **diff** rather
than whole-object equality. Keep exact equality only where it is meaningful.

### 4.2 `budget` in `expected.json` is dead — VERIFIED

Written at `regress.mjs:219`, printed at `:269`, stored in all five baselines
(`expected.json:170, 296, 431, 551, 690`) — and **no code path reads it**. Its
own comment says Phase 3 would enforce it; Phase 3 used a tolerance instead.
Delete it or wire it.

### 4.3 Audit check `[2]` is silently skipped — VERIFIED (`regress.mjs:46`)

`cur = m[1] === '2' ? null : m[1]; // [2] longest-runs: volatile ranking, skip`.
Also `regress.mjs:48`: a `[n]` header with **no trailing count** sets `cur = null`
and is silently not compared. So an audit check that loses its count becomes
invisible rather than failing. **Action:** make an unknown check id a hard error.

### 4.4 Determinism is asserted for 2 of 5 code paths — VERIFIED

Covered: default path (`regress.mjs:82-84`), candidates (`:136-138`).
**Not covered:** `--layouts`, `--optimize`, `measure.mjs`, and byte-stability
of `expected.json` ordering. Given 0.2, this is the single most valuable
missing test: one shared RNG stream across five call sites means any refactor
can silently change every sheet.

### 4.5 No error-path fixtures — VERIFIED

All five baselines are `"errors": []`. ~44 diagnostic codes
(`pid-rules.js:372-503`) have **zero golden coverage**, so a regression that
makes an error vanish is invisible.

**Action:** add `regress/errors/*.dsl` — one file per cluster — with expected
code lists. This also fixes the duplicated-diagnostic problem (`PID-CON-001`
at `validator:427` *and* `UNKNOWN_PORT` at `router:1763` both fire for
`P-1.nosuch`; `SCHEMA-052` at `validator:683` fires against the router's own
auto-generated nozzles).

### 4.6 Twelve declared codes are never emitted — VERIFIED (`pid-rules.js:492-503`)

`PID-TOP-003/007`, `PID-PIP-003/004`, `PID-EQP-004`, `PID-VAL-005`,
`PID-SAF-003`, `PID-HYG-001/002`, `PID-ANN-001/003`, `PID-PKG-001`. The comment
is honest that `ruleEnabled()` was deleted because `enabled` was inert. But
`enabled:false` therefore has **no runtime effect at all**, so a reader cannot
distinguish wired from dead. `PID-ANN-001` is worse: it is declared as
"Floating annotation, `enabled:false`" in the registry *and* emitted at
`renderer:2826` for something else entirely. **Action:** delete the unwired
codes and the `enabled` key.

### 4.7 `pidDebugGate` has 5 gates but no test proves any can fire — VERIFIED

`renderer:42-182`. `regress.mjs:79` asserts the count is zero. If a gate is
broken and can never fire, the suite is green. **Action:** a fault-injection
test that perturbs geometry and asserts each `PID-DBG-*` fires.

### 4.8 `measure.mjs --set=rule:value` is the only tuning lever, and it cannot reach 20+ constants — VERIFIED

Combined with 0.5 and 3.4: the measurement discipline the project prides itself
on is *structurally incapable* of measuring most of the engine's own knobs.

---

## PRIORITY 5 — repo hygiene (cheap, and it removes real hazard)

### 5.1 Dead code — VERIFIED

- **`geometric.js` (2100 lines) is entirely unreferenced.** Grep for it across
  the whole workspace returns zero hits outside itself; every load list uses
  `geometric_objects.js`. Delete it.
- **`geometric_objects.js` uses only 2 of ~2100 functions** — `magnitude` and
  `pointRotate`. Everything expensive is unused, including `polygonBoolean`
  and friends (`661-757`) and `lineIntersection` (`1843`).
- Two of them (`polygonRandom:1488`, `shuffle:1542`) call `Math.random()`
  directly, violating the engine's own *"Never Math.random"* rule
  (`pid-rules.js:628`). Harmless only because nothing calls them — a trap.
- `analyze-symbols.mjs` is **ESM with `require('fs')` at line 1** — cannot run.
- `restore-bundle.mjs` is a retired stub that always `process.exit(1)`.
- `ollama-subagent.mjs` is unrelated to the project.
- `check-arcs.mjs` has a 5-case SELFTEST that is **not wired into any suite**,
  while `audit-symbols.mjs`'s self-test is.
- Dead fields: `data.info` and `data.assemblies` (`parser:323`) are never
  written; `data.view.laneGrid` has no directive; `nz.connected`
  (`router:2011`) is **always false** because pipes never reference a nozzle id.

### 5.2 Committed scratch artifacts

~30 files: `~pid-symbols-bundle.js` (editor temp), `pid-backup-tmp.js`
(1971-line mojibake'd old engine), `tapout.txt` (binary-ish stdout dump with a
stale `score 33138, errors 32`), `regress/_*.svg`, `_m*.json`,
`_sym/*.txt` (not covered by `.gitignore`), and 6 `regress/visual/*.diff.png`
rewritten on **every** visual run. Plus `Archive 9-7-26/` containing a **full
second copy of the live engine** which itself contains another `Archive/` —
recursively. `probe-miss.mjs` reads a JSON from *inside* that archive.

**Action:** delete the scratch set, add `.gitignore` for `regress/_*`,
`*.diff.png`, `render-out.svg`, `tapout.txt`, `~*`; move `Archive 9-7-26/` out
of the repo (git history is the archive).

### 5.3 No README, linter, formatter, editorconfig, or CI — VERIFIED

There is no `README.md` in `pid-generator/` (the workspace-root README documents
the shrimp aquarium site and never mentions the generator), no
`.eslintrc`/`.prettierrc`/`.editorconfig`, no `.github/`, no pre-commit hook,
no lockfile. Chrome is hardcoded at `visual-regress.mjs:31` and `preview.mjs:26`.

Minimum: a README documenting the load order, the golden-file workflow, and
`--bless`; plus one CI job running `node regress.mjs`.

### 5.4 Documentation contradicts shipped code — VERIFIED

Three doc bugs that will mislead the next contributor:
- `REDESIGN.md:53` documents a `--visual` flag that does not exist.
- `REDESIGN.md:72`'s table says the lead-in term is *"reported, not priced"* —
  but `breachPerMm: 6` **is** live (`pid-rules.js:235`, `renderer:2839`).
- `regress.mjs:91-93` claims `--candidates=8` enables the layout seed; without
  `--layouts`, `layoutSeed` is `null`.
- `REDESIGN.md:937-953` still carries the **open** T0.3 entry *below* the
  closed one.

### 5.5 `geometric_objects.js` and `pid-symbols-bundle.js` are opaque blobs

`pid-symbols-bundle.js` is **one line**. Neither has a test that would notice
silent corruption. `~pid-symbols-bundle.js` is a committed editor backup of
it. At minimum: pretty-print the bundle, and add a checksum assertion in
`harness2.mjs`.

---

## Suggested execution order

| Phase | Work | Items | Why first |
|---|---|---|---|
| **1** | Correctness | 0.1, 0.3, 0.4, 0.6 | A* is not finding minimal paths and one loop can hang. Cheap. |
| **2** | Perf | 1.1, 1.7, 1.3, 1.5 | Parse-once + spatial hash + no double-objective. All output-identical, so no re-bless risk. |
| **3** | Observability | 4.4, 4.1, 4.8, 1.8 | Now you can *measure* the rest. |
| **4** | Context refactor | 0.2, 3.5, 3.6 | Unblocks the layout-only fitness in phase 5. |
| **5** | Layout quality | 1.2, 1.6, then **3.1** | With one render affordable, a real crossing-minimising ordering is finally affordable. |
| **6** | DSL | 2.4, 2.5, 2.6, 2.3, 2.1, 2.2, 2.7 | Positions → strict types → schema-driven bag → reconcile specs → fix assemblies → round-trip test. |
| **7** | Cleanup | 5.1, 5.2, 5.3, 5.4, 0.5, 3.4 | Cheap once the above is stable. |

Phase 2 is the highest value-per-risk in the whole list: every change in it is
provably output-identical, so it can be landed and verified against the
existing goldens without a re-bless.

---

## Three things worth protecting

Whatever else changes, these are load-bearing:

1. **The measurement culture.** The negative results in `pid-rules.js` and
   `P&ID-VISUAL-QUALITY.md` are why the output is good. Any proposal that
   "just turn up" a weight without a measurement should be refused, exactly as
   this project already refuses it four times.
2. **`pidDebugGate` + the independent `audit-svg.mjs`.** Two disjoint
   implementations agreeing is the only real external check the engine has.
   Keep them independent; do not refactor them to share code.
3. **Determinism as a contract.** Golden-file equality only works because a
   sheet reproduces byte-for-byte. Item 0.2 threatens it, which is why the
   context refactor is phase 4 rather than "whenever".

## Two things worth questioning

- **Is the 72-candidate search worth keeping at all?** The docs say the rule
  space is exhausted and 9.76 shows knob sweeps are flat. If phase 5's
  crossing-minimising ordering (3.1) lands well, the honest outcome may be a
  *single* render. That would be a 30× speedup and a much more predictable
  engine. Nobody has measured whether the search is still buying anything on
  the current corpus — that measurement is cheap and should be the first thing
  phase 2 produces.
- **Should the grammar stay?** Three specs is worse than one. If the parser is
  normative, generate the grammar from it or delete it; if a PEG is wanted,
  adopt `peggy` and generate the parser, accepting the rework.