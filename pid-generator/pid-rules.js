// P&ID Rule Registry — single source of truth for rule identity, severity,
// scoring weights, line priorities, and tunable thresholds.
// Loaded FIRST (no dependencies): pure data + tiny accessors.
// See P&ID-AUTO-QUALITY-PLAN.md Phase 2.
//
// ---------------------------------------------------------------------------
// DRAFTING THEMES (P&ID-VISUAL-QUALITY.md D4)
//
// Two modes over one token set, borrowed from AutoCAD: colour-per-layer plus a
// monochrome plot style for printing. `cad` is the authoring/review view (black
// model space, layer colours). `print` is the ARCH/ANSI D deliverable — dark ink
// on white, which is what a P&ID actually is; category is carried by lineweight
// and dash pattern, not by hue.
//
// CRITICAL: `halo` is not cosmetic. 17 labels use the paint-order halo trick
// (paint a background-coloured outline behind text so it reads over a crossing
// line). A literal white halo is invisible on paper and a GLOWING WHITE OUTLINE
// on a black background. It must be a token that resolves to the background, or
// CAD mode renders every label ringed in white.
//
// Theme is presentation ONLY. It must never change a coordinate: both modes emit
// byte-identical geometry, differing only in colour attributes. The renderer
// injects these as CSS, which overrides SVG presentation attributes — so the
// emission sites keep their existing literals and print mode needs no edits.
// ---------------------------------------------------------------------------
// Candidate placement-pass orders, tried in order and scored (see autoLayout).
// The legacy/original order is FIRST so it always competes — the search can
// therefore never be worse than that single fixed order.
const PID_LAYOUT_ORDERS = ['JIV', 'JVI', 'VJI'];

const PID_THEMES = {
  // AutoCAD ACI-flavoured: 7 white, 3 green, 6 magenta, 4 cyan, 2 yellow, 1 red.
  cad: {
    bg: '#000000',
    frame: '#808080',
    process: '#00ff00',     // ACI 3
    signal: '#ff00ff',      // ACI 6
    utility: '#00ffff',     // ACI 4
    equipment: '#ffffff',   // ACI 7
    valve: '#ffff00',       // ACI 2
    instrument: '#ff8c40',  // ACI 30
    nozzle: '#bfbfbf',
    junction: '#ff4040',    // ACI 1
    text: '#ffffff',
    text2: '#bfbfbf',
    text3: '#808080',
    lineTag: '#00ffff',
    halo: '#000000',        // == bg; see the note above
  },
  // The print deliverable: dark ink on white. Process/signal stay
  // distinguishable by weight + dash, per normal P&ID practice.
  print: {
    bg: '#ffffff',
    frame: '#333333',
    process: '#1a1a1a',
    signal: '#1a1a1a',
    utility: '#1a1a1a',
    equipment: '#000000',
    valve: '#000000',
    instrument: '#000000',
    nozzle: '#000000',
    junction: '#000000',
    text: '#111111',
    text2: '#555555',
    text3: '#888888',
    lineTag: '#0d47a1',
    halo: '#ffffff',
  },
};
const PID_THEME_NAMES = Object.keys(PID_THEMES);

/**
 * Resolve a theme by name, defaulting to `print` (the deliverable).
 * @param {*} name
 * @returns {*} theme token set
 */
function pidTheme(name) {
  return PID_THEMES[name] || PID_THEMES.print;
}

//
// A rule entry answers everything downstream needs to apply it:
//   id         stable code (existing codes kept verbatim; never rename)
//   title      human label (UI, approval checklist)
//   category   tag|schema|topology|geometry|placement|annotation|signal|loop|safety|valve|instrument|piping|equipment|hygienic|package
//   hardness   hard = must hold (constraint); soft = advisory (guideline)
//   severity   how violations report today (error|warning). Hardness is the
//              principle, severity the current practice; they differ where a
//              hard rule is still reported softly (queued for escalation).
//   weight     score currency: key into weights{} or literal override number
//   message    template with {placeholders} (validators may still build their
//              own strings; the id prefix is what must match)
//   appliesTo  entity kinds the rule constrains
//   phase      validate|route|render|layout (where it is enforced)
//   enabled    per-rule kill-switch (project profiles can flip these later)
//
// Params carry built-in constraints: { value, min, max, unit, desc }.
// ruleParam() returns .value; min/max are enforced by future config UI and
// document the sane envelope (a tuned value outside min..max is a bug smell).
const PID_RULES = {
  version: 1,

  // ---- score currency (unified objective, plan Phase 2) ----
  weights: {
    err: 1000, nonOrtho: 500, overlap: 150, ungapped: 150,
    pp: 15, ps: 10, ss: 5, label: 30, sheet: 100,
    bend: 2, len: 0.05, tap: 0.2, sig: 0.2,
    // `annOnLine` prices a label drawn across a process pipe, and it is the one
    // annotation term that gets its OWN weight rather than riding the generic `warn`.
    //
    // The reason it needs one is a measured coupling, and it is the same story three
    // times over. Two independent attempts to fix the defect — a width-aware nozzle
    // tag offset, and a third "push it further out" tier for a valve stack whose two
    // positions are both blocked — each removed real label-over-linework and each
    // made the corpus WORSE, because the placers run before the score, so changing
    // where a label lands changes the annotation boxes, which changes which layout
    // candidate the search prefers. The fix bought a clean label and sold a sparser
    // sheet, and at 5 points per warning the objective could not tell the trade was
    // bad. demo 319 -> 344 and utilisation 44% -> 37% for one sheet's worth of
    // labels; as a plain fourth preference position the valve tier cost 36 across the
    // corpus and added a NEW label collision on manifold.
    //
    // This term is NOT one of the four the redesign plan's "one rule" disqualifies.
    // Those all measure a consequence decided AFTER the search has chosen — tap
    // reach, signal length, per-jog bends, lead-in. This one measures work the
    // renderer finished doing before the score was summed: the placers have run, the
    // ink is on the page, and the number is read off it. The decision is complete
    // when the term is evaluated, so pricing it is not a lookahead.
    //
    // 20 was the measured number and it is WRONG, which is the point. Pricing a label
    // on a pipe at 20 took the corpus 1827 -> 2120 (spike +180, dense +36, demo +57,
    // manifold +20) and dropped sheet utilisation on three sheets. The search bought
    // label clearance with sheet area, exactly as the `util` term did before it.
    //
    // This is therefore the FIFTH independent measurement of the rule the redesign
    // plan states — after `astarGiveups`, the lead-in term, per-jog bends and
    // `sigTotal` — and the first one on a term that is NOT a downstream consequence.
    // The plan's disqualification does not apply here: the placers have finished and
    // the ink is on the page before this number is read. And it still fails, for a
    // reason the plan does not anticipate. It is not that the layout is being asked
    // to price an unfinished decision. It is that **label placement and layout
    // selection are coupled**: the placers run inside the scored pass, so moving a
    // label changes the annotation boxes, which changes which candidate wins, and
    // the objective cannot express "this sheet is better because the labels are on
    // it". Every annotation-placement fix therefore trades a defect for an
    // arrangement, and no weight settles it.
    //
    // The decoupling already exists for one of the three placers and it is the only
    // placement change in this project that has ever been free: the width-aware
    // nozzle tag offset (see `pid-renderer.js`, the `clear` candidate) took audit
    // [15] from 45 to 40 across the six sheets at a byte-identical score, because it
    // leads with the LEGACY position and only moves a tag that actually straddles
    // its run. A fix that cannot change which candidate wins cannot cost anything.
    // That is the shape to write more of, and it is Stage 3 work, not a weight.
    annOnLine: 0,
    // `sig` prices the WORST single signal segment; `sigTotal` prices EVERY millimetre
    // of EVERY signal run, and it is ZERO — which is the fourth measurement of the
    // same answer, not a copy of the third.
    //
    // The gap is real and worth naming: `tapReachTotal` sums while `maxSignalLen` took
    // a maximum, so on `spike` — 11 signal runs totalling **1467mm**, which is 23% of
    // its 6474mm of process pipe, with the dashed runs going round the right-hand side
    // in ~500mm rectangles — five of the six detours were free.
    //
    // Pricing them at 0.05/mm, the same rate as process length, costs **+122** across
    // the corpus (spike 789 -> 862, dense 384 -> 409, min 65 -> 71, manifold
    // 225 -> 237). The drawing gets worse, not better. The count stays in
    // `instruments.signalLenTotal` / `.signalRuns` so the 1467 is visible, and §9.76
    // has the synthesis: tap reach and signal length are consequences of bubble
    // placement, and the layout cannot price a consequence of a decision it has not
    // finished making.
    sigTotal: 0, warn: 5,
    overlapLen: 12,
    fill: 400,
    // 400 is the measured THRESHOLD, not a guess. Below it the term is inert on every
    // sheet (demo stays at 40% util through weight 250); at 400 the engine takes the
    // trade where it is worth taking: demo 40%->61% util, dense 29%->41% util with
    // crossings 6->3, and spike / min / manifold unchanged. min.dsl (two valves, 11%
    // util) is untouched at every weight, which is what `fillEntityMin` is for.
    // Sheet-shape penalty (9.68). The reverted `util` term had two failure causes and
    // both are fixed here: it measured PIPE geometry only (reading the demo at 32% useH
    // where the entity-aware audit says 38-61%), and it had no lever, so it only added
    // cost -- charging min.dsl, which is two valves, 113 points for being small. The lever
    // is `layout.rowSpacing`, now a search dimension, so a drawing can BUY fill instead
    // of being taxed for lacking it. Prices aspect mismatch, not absolute area: the
    // render-time fit scale already handles size and cannot change shape.
    // NOTE: there is deliberately NO a-star-giveup weight. The count IS reported
    // (score.lines.astarGiveups) because it is a real capability metric, but
    // pricing it was measured and reverted — see P&ID-VISUAL-QUALITY.md 9.23.
    // Short version: a flat cost cannot distinguish a benign overlap with a
    // sibling stub from a line run straight through a pump symbol, and the
    // search responds by trading a real, visible defect (a label collision) for
    // an invisible one. Demo at any weight >= 10: give-ups 5 -> 0 but label
    // collisions 0 -> 1, i.e. strictly worse to look at. The key is absent
    // rather than zero so the serialised weights stay byte-comparable.
    // NOTE: there is deliberately NO sheet-utilisation weight. One was tried at
    // 140 and reverted — see P&ID-VISUAL-QUALITY.md 9.20 and the negative-result
    // note in renderInto. Short version: it measured only pipe geometry (reading
    // the demo at 32% useH where the entity-aware audit reads 56%), and having
    // no lever to act on it, it only added cost — min 58 -> 186 and split
    // 36 -> 135 with no layout change, punishing small sheets hardest. The key
    // is absent rather than zero so the serialised weights stay byte-comparable.
    // ---- breach tier: drafting-rule violations the objective can SEE ---------
    //
    // The problem this fixes, measured: the search chose a layout carrying a
    // `PID-GEO-002` (port lead-in 5.5mm against a 14mm rule) over one 6% better on
    // every preference term, because a warning cost `warn: 5` — less than 24
    // points of fill. The objective was structurally blind to a breach the
    // validator reports, so "no drafting-rule violation" was not a thing the
    // search was optimising for.
    //
    // It is priced PROPORTIONALLY and CAPPED, not as a lexicographic cliff, and
    // the shape is the point. A cliff was built first (`hardWarn: 500`, one point
    // per violation) and measured: it swung the demo from a 359 layout with 2
    // crossings and 0 label collisions to a 732 layout with 8 crossings and 6
    // label collisions — i.e. it bought a subtle tight bend at a nozzle with six
    // glaring overlaps. A candidate's rank must not flip because of a quantity
    // unrelated to how bad the violation is; that is the same near-tie fragility
    // the log records for a cosmetic text move re-rolling a layout.
    //
    //   breachPerMm  6      8.5mm short of the lead-in rule = 51 points, which is
    //                      more than one label collision (30) and far less than
    //                      six of them (180). The trade the objective should make
    //                      is in that neighbourhood and nowhere near a cliff.
    //   breachCap  200      bounded, so a pathological sheet cannot make the term
    //                      dominate: at the cap it still loses to `fill` (400),
    //                      which is a preference.
    //
    // Only breaches a different ARRANGEMENT can fix are recorded, each with the
    // distance it is short by (`validateGeometry`'s `breach` array — warnings are
    // prose and the score cannot price prose). `PID-INS-020` (tag wider than its
    // bubble, 6 findings on spike) is deliberately absent: the remedy is a
    // symbol-bundle size and a type-scale decision (T6.15/T6.17), so no layout
    // can earn it back and pricing it would only add a constant.
    breachPerMm: 6,
    breachCap: 200,
  },

  // ---- line priority: which line breaks at a crossing (low breaks first) ----
  linePriority: { process: 2, tap: 1, signal: 0 },

  // ---- tunable thresholds with built-in constraints ----
  params: {
    routing: {
      minPortRun:   { value: 14, min: 4, max: null, unit: 'mm', desc: 'straight run kept at every port before the first bend' },
      gridMin:      { value: 5, min: 1, max: null, unit: 'mm', desc: 'routing grid floor (CELL = max(grid, gridMin))' },
      obstaclePad:  { value: 6, min: 0, max: null, unit: 'mm', desc: 'symmetric obstacle padding around symbols' },
      labelPadBottom: { value: 14, min: 0, max: null, unit: 'mm', desc: 'extra obstacle room below equipment/valves (label stacks)' },
      avoidMargin:  { value: 8, min: 0, max: null, unit: 'mm', desc: 'instrument keep-out around equipment/valves in freeSlot' },
      instrumentMargin: { value: 3, min: 0, max: null, unit: 'mm', desc: 'extra separation for bubbles (labels/halos wider than symbol)' },
      gapBreak:     { value: 4, min: 1, max: null, unit: 'mm', desc: 'half-width of a crossing gap cut' },
      gapMinRun:    { value: 8, min: 2, max: null, unit: 'mm', desc: 'straight run required each side of a full gap' },
      nozzleLead:   { value: 14, min: 4, max: null, unit: 'mm', desc: 'axial straight run forced at every nozzle tip' },
      junctionStubMin: { value: 6, min: 2, max: null, unit: 'mm', desc: 'minimum fan-out stub at junction nodes' },
      // Line WEIGHTS at 1:1. These were hardcoded in the renderer as
      // `width: signal ? 0.4 : 0.6`, so all 16 process pipes on the demo were 0.6mm
      // -- a hairline. That one constant is why the flow arrows read as oversized
      // (a 3mm arrow on a 0.6mm pipe) and why the junction dot read as a blob (a 5mm
      // disc on a 0.6mm pipe). Neither the arrow nor the dot was wrong in absolute
      // terms; they were wrong RELATIVE to a pipe too thin to carry them.
      processWidth: { value: 1.4, min: 0.1, max: 6, unit: 'mm', noScale: true, desc: 'process pipe stroke weight at 1:1. 0.6 was a hairline; ISO 5457 drawing practice wants a line heavy enough to read as a pipe' },
      signalWidth:  { value: 0.35, min: 0.05, max: 4, unit: 'mm', noScale: true, desc: 'instrument/signal line stroke weight at 1:1' },
      sheetMargin:  { value: 26, min: 0, max: null, unit: 'mm', desc: 'sheet bounds inset (routing/search/placement)' },
      searchMargin: { value: 160, min: 50, max: null, unit: 'mm', desc: 'A* local search box around the direct route' },
      bendPenalty:  { value: 20, min: 0, max: null, unit: 'cost', desc: 'A* turn cost' },
      dipPenalty:   { value: 30, min: 0, max: null, unit: 'cost', desc: 'A* per-cell cost below the ports elevation' },
      fieldCross:   { value: 300, min: 0, max: null, unit: 'cost', desc: 'penalty for crossing an already-routed line' },
      fieldNear:    { value: 45, min: 0, max: null, unit: 'cost', desc: 'penalty for running adjacent to a routed line' },
      signalLenWarn: { value: 0.55, min: 0, max: 1, unit: 'fraction', desc: 'signal run warning threshold (× sheet width)' },
    },
    layout: {
            // Cap the columns-per-row so the tier grid WRAPS instead of always spanning the
      // full sheet width. 0 = auto, which picks the count whose grid aspect best matches
      // the drawable area. Before this the cap did not exist and COL was always
      // availW/numCols, so colsPerRow was always numCols and every drawing came out as
      // one flat horizontal band with the bottom of the sheet empty.
      colsPerRowMax: { value: 99, min: 0, max: null, unit: 'count', desc: 'max columns per tier row; 0 = auto-fit to the sheet aspect. 2 gives a vertical column layout that fills the height', noScale: true },
      colSpacing:   { value: 140, min: 40, max: null, unit: 'mm', desc: 'auto-layout column pitch' },
      colMax:       { value: 0, min: 0, max: null, unit: 'mm', desc: 'cap the column pitch so the chain stays COMPACT and the fit scale enlarges it, instead of stretching it across the full sheet width. 0 = uncapped' },
      colMaxAlt:    { value: 110, min: 0, max: null, unit: 'mm', noScale: true, desc: 'second column-pitch candidate for the layout search. Capping the pitch is a real per-sheet trade and the corpus splits on it: at 110 spike goes 943 -> 838 (crossings 18 -> 10, label collisions 1 -> 0, 620mm less pipe) while manifold goes 324 -> 373; at 90 the reverse. No single value is right for both, so the engine tries both and scores them -- a candidate, not a score term (9.68)' },
      colMaxAlt2:   { value: 150, min: 0, max: null, unit: 'mm', noScale: true, desc: 'third column-pitch candidate. Two values were not enough: spike refuses anything wider than 110 (789 -> 904, crossings 7 -> 16) because a longer pitch gives the router more room to make detours and it takes them, while manifold wants 150 (264 -> 225, crossings 1 -> 0). A two-element axis has to pick one and the other sheets pay for it: 0/110 sums 1891, 0/150 sums 1967, 0/200 sums 1981' },
      colMaxAlt3:   { value: 200, min: 0, max: null, unit: 'mm', noScale: true, desc: 'fourth column-pitch candidate, wanted by the demo and nobody else: 344 -> 319 and its shape goes from 78%Wx48%H to 65%Wx68%H, which is the ink-to-bbox ratio audit [13] complains about. With 0/110/150/200 each sheet takes its own (demo 319, spike 789, dense 384, manifold 225) and the corpus sums 1827. Costs one more routed candidate per sheet, which is the render-time bill T3.1/T3.2 exists to stop paying' },
      rowSpacing:   { value: 145, min: 40, max: null, unit: 'mm', desc: 'auto-layout row pitch' },
      rowSpacingAlt: { value: 220, min: 40, max: null, unit: 'mm', noScale: true, desc: 'second row-pitch candidate for the layout search. There is no single best value across sheets: demo and dense want 260mm (util 38% -> 61%), spike and manifold want 145mm, so the engine tries both and scores them (9.68)' },
      rowSpacingAlt2: { value: 300, min: 40, max: null, unit: 'mm', noScale: true, desc: 'third row-pitch search candidate, and it is load-bearing: {145,300} sums 1827 across the corpus where {145,220} sums 1868, because the demo and dense need the wide pitch and 220 does not reach. It looks redundant because 220 and 300 tie as a PAIR ({220,300} and {300} both sum 1967) -- a pair test can only see a tie, never a candidate value, and reading that tie as dominance cost one edit cycle' },
      xMargin:      { value: 60, min: 0, max: null, unit: 'mm', noScale: true, desc: 'auto-layout sheet x margin' },
      yMargin:      { value: 118, min: 0, max: null, unit: 'mm', noScale: true, desc: 'auto-layout sheet y margin (instrument tier headroom)' },
      stackField:   { value: 24, min: 8, max: null, unit: 'mm', desc: 'field bubble stack gap above tap host' },
      stackCtrl:    { value: 32, min: 8, max: null, unit: 'mm', desc: 'controller stack gap above driven element (gap-break room)' },
      stackOrphan:  { value: 30, min: 8, max: null, unit: 'mm', desc: 'orphan controller gap above field partner' },
      freeSlot:     { value: 45, min: 20, max: null, unit: 'mm', desc: 'instrument slot exclusion radius' },
      labelZone:    { value: 16, min: 0, max: null, unit: 'mm', desc: 'label keep-out below equipment/valves in stacking' },
      valveGap:     { value: 14, min: 6, max: null, unit: 'mm', desc: 'valve-to-equipment-port clearance in snapping' },
      decrowdAir:   { value: 14, min: 0, max: null, unit: 'mm', desc: 'clear air passDecrowd enforces between two symbol EDGES once the label-zone gap is already satisfied. Separate from layout.valveGap, which is port-snapping clearance and must not double as de-crowding' },
      valveClear:   { value: 16, min: 6, max: null, unit: 'mm', desc: 'min centre-to-centre spacing between valves on a shared span' },
      minSep:       { value: 45, min: 20, max: null, unit: 'mm', desc: 'min vertical separation between entities sharing a depth rank' },
      decrowd:      { value: 1, min: 0, max: 1, unit: 'bool', desc: 'separate entities whose label stacks would overlap' },
      crowdX:       { value: 34, min: 0, max: 200, unit: 'mm', desc: 'horizontal proximity within which two entities must be de-crowded vertically' },
      decrowdZone:  { value: 0.5, min: 0, max: 4, unit: 'ratio', desc: 'multiple of the label zone reserved per entity when de-crowding' },
      instLabelZone:{ value: 1, min: 0, max: 4, unit: 'ratio', desc: 'multiple of the label zone kept clear below an instrument bubble' },
      tapAlign:     { value: 60, min: 0, max: 200, unit: 'mm', desc: 'max vertical travel allowed when aligning a bubble to its line-tap elevation' },
      decrowdIters: { value: 4, min: 1, max: 20, unit: 'count', desc: 'de-crowding relaxation sweeps' },
      terminals:    { value: 1, min: 0, max: 1, unit: 'bool', desc: 're-anchor off-page connectors to their partner after all placement passes' },
      terminalClear:{ value: 14, min: 0, max: 60, unit: 'mm', desc: 'min clearance between a terminal and its anchor\'s other pipe runs' },
      terminalDirDot:{ value: 0.5, min: -1, max: 1, unit: 'ratio', desc: 'veto a terminal planted within this cosine of its anchor\'s other run direction' },
      coordIters:   { value: 4, min: 0, max: 12, unit: 'count', desc: 'median coordinate-assignment sweeps (0 = index seed only)' },
      coordSearch:  { value: 1, min: 0, max: 1, unit: 'bool', desc: 'search coordinate-assignment sweep counts and keep the best' },
      coordSweeps:  { value: 8, min: 0, max: 12, unit: 'count', desc: 'sweep count tried by the coordinate search' },
      minSepAlt:    { value: 45, min: 20, max: null, unit: 'mm', desc: 'second minimum separation tried by the placement search; set > minSep to enable the dimension (doubles render count)' },
      junctionGap:  { value: 22, min: 6, max: null, unit: 'mm', desc: 'junction sit-out distance on port lead-out axis' },
      centre:       { value: 1, min: 0, max: 1, unit: 'bool', desc: 'translate the composed block to centre it on the sheet' },
      orderSearch:  { value: 1, min: 0, max: 1, unit: 'bool', desc: 'search placement-pass orders and keep the best by score' },
      // ---- placement RULES (IMPROVEMENTS.md §0c/§0d W4) ----
      // Unlike every `layout.*` key above, these are CONSTRAINTS, not
      // weights. A rule that applies is satisfied, not traded against sheet
      // fullness or pipe length — see P&ID-ENGINE-REDESIGN.md:63-96. Each
      // ships 0 until it has been measured on its own; `placement-audit.mjs`
      // reports the violations a rule would fix, and `enforce()` reports what
      // is STILL violated after the solver ran.
      ruleSuctionSourceAbove: { value: 0, min: 0, max: 1, unit: 'bool', desc: 'a pump sits below its suction source. MEASURED AND REVERTED, TWICE — the post-hoc form cost the corpus +105 (IMPROVEMENTS.md §0d W4), the in-solve form +20 on the old baseline, and +73 re-measured on the 2026-10-10 baseline (dense 369->339 with the rule\'s own targets fully satisfied, but demo +46 emptying the sheet to util 25% and spike +58). The rule is correct; the corpus pays for it. The blocker is the instrument-tier coupling (W6), not the rule' },
      // In-solve form of `overhead-return-level` (IMPROVEMENTS.md §0d W4):
      // the reflux/top source sits LEVEL with the vessel it returns to. A
      // single-axis y target, the same shape as suction-source-above's, which
      // is why it can ship as soon as it is measured. DEFAULT 0.
      ruleOverheadReturnLevel: { value: 0, min: 0, max: 1, unit: 'bool', desc: 'a reflux/overhead connection sits level with the vessel it returns to, applied as a y TARGET inside the coordinate solve. MEASURED 2026-10-10 AND SCORE-NEUTRAL: the target fires on spike (8 adjustments) but lands at a byte-identical score, so the corpus says the preference is already satisfied where it applies. DEFAULT 0 — a rule that ships enabled needs a corpus row proving it, and this row says "no change". See IMPROVEMENTS.md §0d' },
      // The 2-D capability: re-home a heater/exchanger into the rank-column of
      // the vessel it serves, below it (bottoms draw drops straight down, the
      // return comes back up, the loop reads as one system). This is a COLUMN
      // decision, because x is rigid per rank — a y-target cannot express it.
      // Measured context: dense E-1 lands 210mm from C-1 (dx=185) without it.
      //
      // MEASURED AND SHIPPED 2026-10-10 (IMPROVEMENTS.md §0d W5): dense 384 ->
      // 369 with fill.util 45 -> 63 and fill.gap 0.17 -> 0, which is the FIRST
      // mechanism in this project to fill the dense sheet's vertical void
      // (§0a root cause 2); spike 789 -> 787 with maxSignalLen 220 -> 130mm,
      // signalLenTotal -275mm, leadInShort 30 -> 9 and warnings 15 -> 8, paid
      // for by crossings 7 -> 14 and bends +18; demo / min / split / manifold
      // byte-identical. Both changed sheets were looked at before blessing.
      //
      // Gated on THIS KEY ALONE, not on `layout.placementRules`: the master
      // switch means "run the post-hoc enforce() solver", and a roster change
      // that runs before coordinates exist is a different mechanism with a
      // different failure mode. Measured equivalence: `placementRules:1` alone
      // reproduces the baseline byte-for-byte, so the two keys are independent.
      affinityRehome: { value: 1, min: 0, max: 1, unit: 'bool', desc: 'co-locate a reboiler/exchanger with the tower/vessel/drum it serves by moving it into that vessel\'s rank-column BEFORE the barycentre sweeps. SHIPPED 2026-10-10 on the measurement in the comment above; set 0 to measure the engine without it' },
      ruleSolverIters: { value: 6, min: 1, max: 20, unit: 'count', noScale: true, desc: 'max fixed-point iterations of the placement rule solver. Capped on purpose: an uncapped fixpoint loop in a layout pass is how a renderer hangs' },
      ruleMinSep: { value: 0, min: 0, max: 200, unit: 'mm', noScale: true, desc: 'clearance the rule solver must leave around a moved entity, measured in the axis it moves. 0 = rely on passDecrowd, which has already run; a positive value makes the solver refuse moves a drafter would make' },
      ruleMinGap: { value: 20, min: 0, max: 120, unit: 'mm', desc: 'minimum y separation a placement rule asks for between two entities, applied as a TARGET inside the coordinate solve (not as a post-hoc move). This is what makes the ordering visible on the drawing rather than a 5mm token' },
      placementRules: { value: 0, min: 0, max: 1, unit: 'bool', desc: 'run the placement rule constraint solver (pid-router.js, after passDecrowd). Master switch for every layout.rule* key. DEFAULT 0 — the solver works and the rules are correct, but a constraint applied AFTER layout cannot pay for its own knock-on effects (measured: +105 across the corpus). Ship order is inside the coordinate solve, not after it' },
      orderCandidates: { value: 3, min: 1, max: 3, unit: 'count', desc: 'how many pass orders to try' },
      // Search WIDTH, not a layout parameter: 0 = the reduced candidate sets
      // that measured free across the corpus (24 full renders per sheet,
      // spike 31.2s -> 20.8s, every score digit unchanged). 1 = the original
      // wide sets (72 renders), kept because the reduction is a property of
      // THESE five sheets and not a proof about a new corpus. See
      // IMPROVEMENTS.md §0d W1.
      searchWide: { value: 0, min: 0, max: 1, unit: 'bool', desc: 'search the full row-pitch and column-cap axes (72 renders) instead of the reduced sets (24 renders) that measured free' },
      centreBottomReserve: { value: 60, min: 0, max: null, unit: 'mm', noScale: true, desc: 'bottom band reserved for the title block when centring' },
    },
    annotation: {
      typeScale:    { value: 1.4, min: 1, max: 3, unit: 'factor', desc: 'type size multiplier over base sizes' },
      typeFloor:    { value: 3.5, min: 2, max: null, unit: 'mm', desc: 'minimum rendered text size' },
      junctionDot:  { value: 2.5, min: 0.5, max: null, unit: 'mm', noScale: true, desc: 'DIAMETER of a junction node dot. Was a hardcoded r=2.5, i.e. a 5mm solid disc 1.5-5x the width of the pipe it sits on, which read as a blob rather than a node' },
      arrowFrac:    { value: 0.8, min: 0.1, max: 2, unit: 'fraction', noScale: true, desc: 'flow-direction arrow half-width as a fraction of the PIPE stroke width it sits on. Was a fixed 1.5mm, so a 3mm-wide arrow landed on pipes from 0.4mm to 3.2mm wide' },
      arrowRatio:   { value: 2.4, min: 1, max: 6, unit: 'ratio', noScale: true, desc: 'flow-direction arrow length as a multiple of its own width' },
      // Print-legibility band for component and line text, checked by PID-TXT-001.
      // Defaults are the project's stated print-correct sizes: 3.5mm body, 2.6mm
      // line tags. Deliberately NOT widened to match what the engine currently
      // emits — the whole point of the check is to report the gap, not to bless it.
      // Title-block, legend and north-arrow text are excluded: they are authored in a
      // different unit space and are not annotation type.
      sizeMin:      { value: 2.6, min: 0.5, max: null, unit: 'mm', desc: 'smallest print-legible annotation size; below this PID-TXT-001 warns UNDER' },
      sizeMax:      { value: 3.5, min: 1, max: null, unit: 'mm', desc: 'largest print-legible annotation size; above this PID-TXT-001 warns OVER' },
      sizeScopeMin: { value: 0, min: 0, max: null, unit: 'count', desc: 'do not warn on annotation type if fewer than this many runs are affected (0 = warn always)' },
      // Equipment schedule along the top edge, as on a real P&ID. The band is RESERVED
      // by autoLayout (the centring target's zy0 moves down by its height) rather than
      // drawn into whatever space happens to be left, so it can never land on the
      // drawing. Max rows is capped because the band is reserved from the top margin:
      // an unbounded list would push the drawing off the sheet.
            // Valve size, derived from the process line when the DSL does not state it
      // (T7.12). The resolver walks each end of the valve to the NEAREST equipment
      // carrying a sized nozzle, through junctions, and prints nothing when that is
      // ambiguous or unknown - a guessed size is worse than none.
      valveSize:    { value: 1, min: 0, max: 1, unit: 'bool', desc: 'show the derived line size above each valve' },
      valveSizeMaxHop: { value: 4, min: 1, max: 12, unit: 'count', desc: 'how far to walk through junctions looking for sized equipment. The junction network is looped, so a larger value reaches unrelated equipment across the drawing' },
      // Sheet-utilisation term (9.68). `fillEntityMin` is the guard that makes this
      // different from the reverted `util` weight: below this many placed items a
      // drawing is not penalised for being small, because a small process cannot fill a
      // sheet and charging it for that is charging the user for their process. Above it,
      // a sparse drawing is a layout defect and is priced as one.
      fillEntityMin: { value: 8, min: 0, max: null, unit: 'count', desc: 'placed items below which the utilisation term does not apply, so a genuinely small process is not penalised' },
      fillTarget:    { value: 0.62, min: 0, max: 1, unit: 'fraction', desc: 'sheet-area fraction the layout aims for. 0 disables the term' },
      equipList:    { value: 1, min: 0, max: 1, unit: 'bool', desc: 'clone each equipment annotation into one row along the top edge of the sheet' },
            equipListRowH: { value: 12, min: 8, max: null, unit: 'mm', desc: 'height of one tag-list item: a bold tag line plus a grey type line under it, which sits 5.5mm below the tag (the same offset the equipment annotation uses)' },
equipListPad:  { value: 4, min: 0, max: null, unit: 'mm', desc: 'clear space between the tag list and the drawing below it' },
      labelOffset:  { value: 14, min: 4, max: null, unit: 'mm', desc: 'line-label leader standoff' },
      labelOffsetWide: { value: 28, min: 8, max: null, unit: 'mm', desc: 'line-label fallback standoff' },
      // Annotation PLACEMENT. Both of these exist because a label printed on top of
      // a process line was invisible to the score and to the audit alike: the
      // collision term compares text with text, and the line checks compare lines
      // with symbol boxes. Nothing looked at text against linework.
      equipTagFar: { value: 26, min: 8, max: null, unit: 'mm', desc: 'how far below the symbol the LAST-RESORT equipment tag sits, after below / above / left / right have all been tried' },
      valveStackSides: { value: 1, min: 0, max: 1, unit: 'bool', noScale: true, desc: 'let a valve label stack move BESIDE the valve as well as above or below it. Measured: on takes the corpus from 2 label collisions to 0 and costs the demo 43 points of score and 20 points of sheet use (48% -> 28%), because a cleaner label set makes a more compact layout win the search. Taken on the same grounds as 9.71: overlapping labels look broken, an empty sheet does not. Off restores the two-position flip exactly.' },
    },
    taps: {
      dropSep:      { value: 2, min: 0, max: null, unit: 'mm', desc: 'tap drop separation from bubble and landing' },
      laneShift:    { value: 5, min: 1, max: null, unit: 'mm', desc: 'tap lane dodge step' },
      minReach:     { value: 3, min: 0, max: null, unit: 'mm', desc: 'tap bubble-on-line reach threshold' },
      maxLateral:   { value: 30, min: 0, max: 300, unit: 'mm', desc: 'max sideways travel in a tap run before PID-INS-006 fires (corpus: 0x5, 11, 24, 38, 55, 66, 81)' },
    },
  },

  // ---- rule catalog (all enforced codes; severities match current behavior) ----
  rules: {
    // tags
    'PID-TAG-001': { title: 'Duplicate id', category: 'tag', hardness: 'hard', severity: 'warning', weight: 0, message: 'duplicate id "{id}"', appliesTo: ['equipment', 'valve', 'junction'], phase: 'validate', enabled: true },
    'PID-TAG-002': { title: 'Duplicate instrument tag', category: 'tag', hardness: 'hard', severity: 'warning', weight: 0, message: 'duplicate instrument tag "{tag}"', appliesTo: ['instrument'], phase: 'validate', enabled: true },
    'PID-TAG-003': { title: 'Duplicate line id', category: 'tag', hardness: 'hard', severity: 'warning', weight: 0, message: 'duplicate line id "{id}"', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'PID-TAG-004': { title: 'Invalid ISA tag', category: 'tag', hardness: 'soft', severity: 'warning', weight: 0, message: 'tag "{tag}": not a valid ISA tag', appliesTo: ['instrument'], phase: 'validate', enabled: true },
    'PID-TAG-005': { title: 'Unknown measured variable', category: 'tag', hardness: 'soft', severity: 'warning', weight: 0, message: 'tag "{tag}": unknown measured variable', appliesTo: ['instrument'], phase: 'validate', enabled: true },
    'PID-TAG-006': { title: 'Unknown function letter', category: 'tag', hardness: 'soft', severity: 'warning', weight: 0, message: 'tag "{tag}": unknown function letter', appliesTo: ['instrument'], phase: 'validate', enabled: true },
    // symbols / equipment / refs
    'PID-SYM-001': { title: 'Unknown entity type', category: 'schema', hardness: 'soft', severity: 'warning', weight: 0, message: '"{id}": unknown entity type "{type}"', appliesTo: ['equipment', 'valve'], phase: 'validate', enabled: true },
    'PID-SYM-002': { title: 'Non-standard symbol missing legend', category: 'schema', hardness: 'soft', severity: 'warning', weight: 0, message: '"{id}": custom symbol without legend entry (legend on)', appliesTo: ['equipment', 'valve', 'instrument'], phase: 'validate', enabled: true },
    'PID-EQP-001': { title: 'Unconnected equipment', category: 'topology', hardness: 'soft', severity: 'warning', weight: 0, message: '"{id}" ({type}): not connected to any pipe', appliesTo: ['equipment', 'valve'], phase: 'validate', enabled: true },
    'PID-REF-001': { title: 'Unknown pipe endpoint', category: 'topology', hardness: 'hard', severity: 'warning', weight: 0, message: 'pipe "{from} -> {to}": unknown endpoint', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'PID-REF-002': { title: 'Unknown line spec', category: 'topology', hardness: 'hard', severity: 'warning', weight: 0, message: 'pipe "{from} -> {to}": unknown line spec "{line}"', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'PID-CON-001': { title: 'Unknown port', category: 'topology', hardness: 'hard', severity: 'warning', weight: 0, message: 'port "{port}" does not exist on {id}', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'PID-CON-002': { title: 'Process pipe on instrument', category: 'topology', hardness: 'hard', severity: 'warning', weight: 0, message: 'process pipe "{from} -> {to}": "{id}" is an instrument — connect through a process tap or junction', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    // signals / instruments
    'PID-SIG-001': { title: 'Signal endpoint not instrumented', category: 'signal', hardness: 'soft', severity: 'warning', weight: 0, message: 'signal "{from} -> {to}": endpoint is not instrument/auto-valve/rotating', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'PID-SIG-002': { title: 'Signal run too long', category: 'signal', hardness: 'soft', severity: 'warning', weight: 'sig', message: 'signal "{from} -> {to}": very long run ({len}mm)', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'PID-INS-002': { title: 'Field instrument without tap', category: 'instrument', hardness: 'soft', severity: 'warning', weight: 0, message: 'field instrument "{tag}": no process tap', appliesTo: ['instrument'], phase: 'validate', enabled: true },
    'PID-INS-003': { title: 'DCS instrument without signal', category: 'instrument', hardness: 'soft', severity: 'warning', weight: 0, message: 'DCS instrument "{tag}": no signal connection', appliesTo: ['instrument'], phase: 'validate', enabled: true },
    'PID-INS-004': { title: 'Tap bubble on line', category: 'instrument', hardness: 'soft', severity: 'warning', weight: 0, message: 'tap "{from} -> {host}": bubble is sitting on the line', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'PID-INS-005': { title: 'Tap shares process corridor', category: 'instrument', hardness: 'soft', severity: 'warning', weight: 0, message: 'tap "{tag}": shares a process corridor (reads as one line)', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'PID-INS-006': { title: 'Tap bubble too far from host', category: 'instrument', hardness: 'soft', severity: 'warning', weight: 0, message: 'tap "{from} -> {host}": bubble is too far from its host, so the tap runs a long way', appliesTo: ['pipe', 'instrument'], phase: 'validate', enabled: true },
    // valves / control
    'PID-VAL-001': { title: 'Automated valve without loop', category: 'valve', hardness: 'soft', severity: 'warning', weight: 0, message: 'valve "{id}" ({type}): no instrument loop or control-valve tag', appliesTo: ['valve'], phase: 'validate', enabled: true },
    'PID-VAL-002': { title: 'Controller not above valve', category: 'valve', hardness: 'soft', severity: 'warning', weight: 0, message: 'control valve "{id}": controller should sit directly above', appliesTo: ['valve'], phase: 'validate', enabled: true },
    'PID-VAL-003': { title: 'Check valve direction undefined', category: 'valve', hardness: 'soft', severity: 'warning', weight: 0, message: 'check valve "{id}": flow direction not fully defined', appliesTo: ['valve'], phase: 'validate', enabled: true },
    'PID-VAL-004': { title: 'Control valve missing fail position', category: 'valve', hardness: 'soft', severity: 'warning', weight: 0, message: 'control valve "{id}" has no defined fail action', appliesTo: ['valve'], phase: 'validate', enabled: true },
    // geometry (orthogonal drafting — hard constraints, still reported softly)
    'PID-GEO-001': { title: 'Non-orthogonal segment', category: 'geometry', hardness: 'hard', severity: 'warning', weight: 'nonOrtho', message: 'geometry "{from} -> {to}": non-orthogonal segment', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'PID-GEO-002': { title: 'Bend too close to port', category: 'geometry', hardness: 'hard', severity: 'warning', weight: 0, message: 'geometry "{from} -> {to}": port lead-in only {len}mm', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'PID-GEO-003': { title: 'Crossing without gap break', category: 'geometry', hardness: 'hard', severity: 'warning', weight: 'ungapped', message: 'line audit: crossing(s) without a gap break', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'PID-GEO-004': { title: 'Diagonal without clear corner', category: 'geometry', hardness: 'hard', severity: 'warning', weight: 0, message: 'geometry "{from} -> {to}": diagonal has no clear corner', appliesTo: ['pipe'], phase: 'route', enabled: true },
    'PID-GEO-005': { title: 'Line through symbol', category: 'geometry', hardness: 'hard', severity: 'warning', weight: 0, message: 'line "{from} -> {to}" passes through {id}', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'PID-GEO-006': { title: 'Line crosses nozzle', category: 'geometry', hardness: 'hard', severity: 'error', weight: 'err', message: 'line "{from} -> {to}" crosses nozzle {id}', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'PID-SHT-001': { title: 'Line leaves sheet', category: 'placement', hardness: 'soft', severity: 'warning', weight: 'sheet', message: 'line "{from} -> {to}" leaves the sheet', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    // layout / sheet
    'PID-LAY-001': { title: 'Content exceeds sheet', category: 'placement', hardness: 'soft', severity: 'warning', weight: 0, message: 'content exceeds sheet — reduce scale or layout', appliesTo: ['equipment', 'valve', 'instrument'], phase: 'render', enabled: true },
    'PID-LAY-002': { title: 'Fixed entity overlaps neighbor', category: 'placement', hardness: 'soft', severity: 'warning', weight: 0, message: '"{id}": overlaps a neighbor but is fixed — move it manually', appliesTo: ['equipment', 'valve', 'instrument'], phase: 'layout', enabled: true },
    // loops / safety / topology errors (all hard)
    'LOOP_MEASUREMENT': { title: 'Loop missing measurement signal', category: 'loop', hardness: 'hard', severity: 'error', weight: 'err', message: 'loop "{id}": no signal from measure to controller', appliesTo: ['instrument'], phase: 'validate', enabled: true },
    'LOOP_OUTPUT': { title: 'Loop missing output signal', category: 'loop', hardness: 'hard', severity: 'error', weight: 'err', message: 'loop "{id}": no signal from controller to final element', appliesTo: ['instrument', 'valve'], phase: 'validate', enabled: true },
    'PID-SAF-001': { title: 'Relief device without protection', category: 'safety', hardness: 'soft', severity: 'warning', weight: 0, message: 'relief device "{id}": no protected equipment relationship', appliesTo: ['valve'], phase: 'validate', enabled: true },
    'PID-SAF-002': { title: 'Relief device without discharge', category: 'safety', hardness: 'soft', severity: 'warning', weight: 0, message: 'relief device "{id}": no discharge destination relationship', appliesTo: ['valve'], phase: 'validate', enabled: true },
    'PID-TOP-001': { title: 'Unreachable process entity', category: 'topology', hardness: 'soft', severity: 'warning', weight: 0, message: 'process entity "{id}": unreachable from any directed process source', appliesTo: ['equipment', 'valve', 'junction'], phase: 'validate', enabled: true },
    'COLLINEAR_OVERLAP': { title: 'Shared line corridor', category: 'geometry', hardness: 'hard', severity: 'error', weight: 'overlap', message: 'line audit: collinear overlap(s)', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'REQUIRED_PORT': { title: 'Required port unconnected', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: '{entity}: required port is not connected', appliesTo: ['equipment', 'valve'], phase: 'validate', enabled: true },
    'SIZE_MISMATCH': { title: 'Line/equipment size mismatch', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: 'line "{line}" size differs from endpoint size', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'SPEC_MISMATCH': { title: 'Line/equipment spec mismatch', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: 'line "{line}" spec differs from endpoint spec', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'PORT_DIRECTION': { title: 'Flow against port direction', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: '{entity}: flow against port direction', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'LOOP_ENDPOINT': { title: 'Unknown loop endpoint', category: 'loop', hardness: 'hard', severity: 'error', weight: 'err', message: 'loop "{id}": unknown endpoint', appliesTo: ['instrument'], phase: 'validate', enabled: true },
    'LOOP_MEASUREMENT': { title: 'Loop missing measurement signal', category: 'loop', hardness: 'hard', severity: 'error', weight: 'err', message: 'loop "{id}": no signal from measure to controller', appliesTo: ['instrument'], phase: 'validate', enabled: true },
    'LOOP_OUTPUT': { title: 'Loop missing output signal', category: 'loop', hardness: 'hard', severity: 'error', weight: 'err', message: 'loop "{id}": no signal from controller to final element', appliesTo: ['instrument'], phase: 'validate', enabled: true },
    'RELATIONSHIP_ENDPOINT': { title: 'Unknown relationship endpoint', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: 'relationship "{id}": unknown endpoint', appliesTo: ['equipment', 'valve'], phase: 'validate', enabled: true },
    'ALARM_SOURCE': { title: 'Unknown alarm source', category: 'loop', hardness: 'hard', severity: 'error', weight: 'err', message: 'alarm "{id}": unknown source', appliesTo: ['instrument'], phase: 'validate', enabled: true },
    'INTERLOCK_TRIGGER': { title: 'Unknown interlock trigger', category: 'loop', hardness: 'hard', severity: 'error', weight: 'err', message: 'interlock "{id}": unknown trigger', appliesTo: ['instrument'], phase: 'validate', enabled: true },
    'INTERLOCK_ACTION': { title: 'Unknown interlock action', category: 'loop', hardness: 'hard', severity: 'error', weight: 'err', message: 'interlock "{id}": unknown action', appliesTo: ['instrument'], phase: 'validate', enabled: true },
    'SAFETY_SOURCE': { title: 'Non-relief safety source', category: 'safety', hardness: 'hard', severity: 'error', weight: 'err', message: 'safety relationship must start at a relief device', appliesTo: ['valve'], phase: 'validate', enabled: true },
    'NO_PORT_DEFINITION': { title: 'No port definition', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: '{id}: no connection ports defined in the symbol library', appliesTo: ['equipment', 'valve'], phase: 'validate', enabled: true },
    'UNKNOWN_PORT': { title: 'Unknown port name', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: '{id}: no port named "{port}"', appliesTo: ['equipment', 'valve'], phase: 'validate', enabled: true },
    'PORT_CAPACITY': { title: 'Port at capacity', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: '{id}: port "{port}" is at capacity', appliesTo: ['equipment', 'valve'], phase: 'validate', enabled: true },
    'NO_AVAILABLE_PORT': { title: 'No available port', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: '{id}: no available connection port', appliesTo: ['equipment', 'valve'], phase: 'validate', enabled: true },
    'AMBIGUOUS_PORT': { title: 'Ambiguous connection', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: '{id}: ambiguous connection — specify the port explicitly', appliesTo: ['equipment', 'valve'], phase: 'validate', enabled: true },
    'TAP_SOURCE': { title: 'Tap source not instrument', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: 'tap source must be an instrument', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'TAP_HOST': { title: 'Unknown tap host', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: 'tap: unknown host entity', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'TAP_HOST_INSTRUMENT': { title: 'Tap host is instrument', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: 'tap: host must not be an instrument', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'TAP_PORT': { title: 'Tap without nozzle port', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: 'tap must name its nozzle (tap TAG -> HOST.<port>)', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'TAP_CAPACITY': { title: 'Nozzle tap slot taken', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: 'nozzle already has a tap (one connection per nozzle)', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'TAP_LINE': { title: 'Line-tap without process line', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: 'line-tap names a port with no process line to tap into', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'TAP_NOZZLE': { title: 'Tap without nozzle object', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: 'tap names a port with no declared nozzle object', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'ISOLATED_JUNCTION': { title: 'Isolated junction', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: 'junction "{id}": no connections', appliesTo: ['junction'], phase: 'validate', enabled: true },
    'DENDRITE_JUNCTION': { title: 'Dangling junction', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: 'junction "{id}": only 1 connection', appliesTo: ['junction'], phase: 'validate', enabled: true },
    // schema family (severities match validateSchemaObject today; hard = breaks
    // the model, soft = advisory metadata mismatch)
    'SCHEMA-001': { title: 'Missing id or tag', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: 'missing required "id" or "tag"', appliesTo: ['equipment', 'valve', 'instrument', 'pipe', 'junction'], phase: 'validate', enabled: true },
    'SCHEMA-002': { title: 'Non-string id', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: '"id" must be a string', appliesTo: ['equipment', 'valve', 'instrument', 'pipe', 'junction'], phase: 'validate', enabled: true },
    'SCHEMA-003': { title: 'Invalid objectType', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: 'invalid objectType', appliesTo: ['equipment', 'valve', 'instrument', 'pipe', 'junction'], phase: 'validate', enabled: true },
    'SCHEMA-004': { title: 'Invalid lifecycleState', category: 'schema', hardness: 'soft', severity: 'warning', weight: 0, message: 'invalid lifecycleState', appliesTo: ['equipment', 'valve', 'instrument', 'pipe', 'junction'], phase: 'validate', enabled: true },
    'SCHEMA-005': { title: 'Invalid designStatus', category: 'schema', hardness: 'soft', severity: 'warning', weight: 0, message: 'invalid designStatus', appliesTo: ['equipment', 'valve', 'instrument', 'pipe', 'junction'], phase: 'validate', enabled: true },
    'SCHEMA-006': { title: 'Non-numeric x', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: '"x" must be a number', appliesTo: ['equipment', 'valve', 'instrument', 'pipe', 'junction'], phase: 'validate', enabled: true },
    'SCHEMA-007': { title: 'Non-numeric y', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: '"y" must be a number', appliesTo: ['equipment', 'valve', 'instrument', 'pipe', 'junction'], phase: 'validate', enabled: true },
    'SCHEMA-008': { title: 'Non-numeric rotation', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: '"rotation" must be a number', appliesTo: ['equipment', 'valve', 'instrument'], phase: 'validate', enabled: true },
    'SCHEMA-009': { title: 'Non-positive scale', category: 'schema', hardness: 'soft', severity: 'warning', weight: 0, message: '"scale" must be a positive number', appliesTo: ['equipment', 'valve', 'instrument'], phase: 'validate', enabled: true },
    'SCHEMA-010': { title: 'Non-array ports', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: '"ports" must be an array', appliesTo: ['equipment', 'valve', 'instrument'], phase: 'validate', enabled: true },
    'SCHEMA-011': { title: 'Non-object attributes', category: 'schema', hardness: 'soft', severity: 'warning', weight: 0, message: '"attributes" must be an object', appliesTo: ['equipment', 'valve', 'instrument', 'pipe', 'junction'], phase: 'validate', enabled: true },
    'SCHEMA-012': { title: 'Non-object customProperties', category: 'schema', hardness: 'soft', severity: 'warning', weight: 0, message: '"customProperties" must be an object', appliesTo: ['equipment', 'valve', 'instrument', 'pipe', 'junction'], phase: 'validate', enabled: true },
    'SCHEMA-020': { title: 'Invalid bubble', category: 'schema', hardness: 'soft', severity: 'warning', weight: 0, message: 'invalid bubble', appliesTo: ['instrument'], phase: 'validate', enabled: true },
    'SCHEMA-021': { title: 'Instrument without tag', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: 'instrument missing required "tag"', appliesTo: ['instrument'], phase: 'validate', enabled: true },
    'SCHEMA-030': { title: 'Pipe without from', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: 'pipe missing required "from"', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'SCHEMA-031': { title: 'Pipe without to', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: 'pipe missing required "to"', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'SCHEMA-032': { title: 'Pipe without kind', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: 'pipe missing required "kind"', appliesTo: ['pipe'], phase: 'validate', enabled: true },
    'SCHEMA-040': { title: 'Port without id', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: 'port missing required "id"', appliesTo: ['equipment', 'valve', 'instrument'], phase: 'validate', enabled: true },
    'SCHEMA-041': { title: 'Port with non-numeric x/y', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: 'port x/y must be numbers', appliesTo: ['equipment', 'valve', 'instrument'], phase: 'validate', enabled: true },
    'SCHEMA-042': { title: 'Port cardinality below 1', category: 'schema', hardness: 'soft', severity: 'warning', weight: 0, message: 'port cardinality must be >= 1', appliesTo: ['equipment', 'valve', 'instrument'], phase: 'validate', enabled: true },
    'SCHEMA-050': { title: 'Nozzle without owner', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: 'nozzle missing required "ownerId"', appliesTo: ['nozzle'], phase: 'validate', enabled: true },
    'SCHEMA-051': { title: 'Nozzle without port', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: 'nozzle missing required "portId"', appliesTo: ['nozzle'], phase: 'validate', enabled: true },
    'SCHEMA-052': { title: 'Nozzle without size', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: 'nozzle missing required "size"', appliesTo: ['nozzle'], phase: 'validate', enabled: true },
    'SCHEMA-053': { title: 'Nozzle owner unknown', category: 'schema', hardness: 'hard', severity: 'error', weight: 0, message: 'ownerId references unknown equipment', appliesTo: ['nozzle'], phase: 'validate', enabled: true },
    'SCHEMA-054': { title: 'Nozzle port unknown', category: 'schema', hardness: 'soft', severity: 'warning', weight: 0, message: 'portId does not exist on owner', appliesTo: ['nozzle'], phase: 'validate', enabled: true },
    'SCHEMA-055': { title: 'Nozzle/line size mismatch', category: 'schema', hardness: 'soft', severity: 'warning', weight: 0, message: 'nozzle size does not match connected line size', appliesTo: ['nozzle'], phase: 'validate', enabled: true },
    'SCHEMA-061': { title: 'Missing sheet metadata', category: 'schema', hardness: 'soft', severity: 'warning', weight: 0, message: 'sheet missing required metadata (title, sheet, or revision)', appliesTo: ['sheet'], phase: 'validate', enabled: true },
    // ---- TRACKED, NOT WIRED (2026-09-25, T6.12) --------------------------
    // Everything below this line is INTENTIONAL SPECIFICATION, not live code.
    // Measured: all 12 of these ids are referenced ZERO times in
    // pid-validator / pid-renderer / pid-router / pid-parser, so none of them can
    // ever fire — flipping `enabled` would change nothing. They are the drafting
    // rules we have specified and not yet implemented (topology loops, pipe
    // routing constraints, equipment/package boundaries, multi-port valve paths,
    // drain/vent destinations, hygienic dead legs, CIP/SIP, floating
    // annotations, battery limits). IDs are reserved so future DSL additions
    // don't collide.
    //
    // `ruleEnabled()` was the accessor that would have filtered them. It was
    // itself never called, so the `enabled` flag was inert — a switch that did
    // nothing, which is worse than no switch because it reads as working. It has
    // been DELETED rather than wired up: the honest state is "specified, not
    // implemented", and a filter that silently passes everything would hide that.
    //
    // When one of these is implemented: give it an emitter, flip enabled to true,
    // and expect a regress re-bless — a new emitter is a new finding by
    // definition.
    'PID-TOP-003': { title: 'Unresolved continuation', category: 'topology', hardness: 'hard', severity: 'error', weight: 'err', message: 'continuation "{id}" does not resolve to a destination', appliesTo: ['continuation'], phase: 'validate', enabled: false },
    'PID-TOP-007': { title: 'Unintended closed loop', category: 'topology', hardness: 'soft', severity: 'warning', weight: 'warn', message: 'process loop detected without explicit loop declaration', appliesTo: ['pipe', 'junction'], phase: 'validate', enabled: false },
    'PID-PIP-003': { title: 'Bidirectional flow ambiguity', category: 'piping', hardness: 'soft', severity: 'warning', weight: 'warn', message: 'bidirectional line "{id}" has ambiguous or missing flow indication', appliesTo: ['pipe'], phase: 'validate', enabled: false },
    'PID-PIP-004': { title: 'Utility/process line confusion', category: 'piping', hardness: 'soft', severity: 'warning', weight: 'warn', message: 'utility line "{id}" connected directly without explicit tie-in', appliesTo: ['pipe'], phase: 'validate', enabled: false },
    'PID-EQP-004': { title: 'Package boundary violation', category: 'equipment', hardness: 'hard', severity: 'error', weight: 'err', message: 'internal package component connected outside defined battery limits', appliesTo: ['equipment', 'pipe'], phase: 'validate', enabled: false },
    'PID-VAL-005': { title: 'Multi-port valve invalid path', category: 'valve', hardness: 'hard', severity: 'error', weight: 'err', message: 'valve "{id}" flow path is not valid for its current state', appliesTo: ['valve'], phase: 'validate', enabled: false },
    'PID-SAF-003': { title: 'Drain/vent missing destination', category: 'safety', hardness: 'soft', severity: 'warning', weight: 'warn', message: 'drain/vent "{id}" terminates without a destination system', appliesTo: ['valve', 'pipe'], phase: 'validate', enabled: false },
    'PID-HYG-001': { title: 'Hygienic dead leg', category: 'hygienic', hardness: 'hard', severity: 'error', weight: 'err', message: 'dead leg detected in hygienic system at "{id}"', appliesTo: ['pipe', 'junction'], phase: 'validate', enabled: false },
    'PID-HYG-002': { title: 'Incomplete CIP/SIP path', category: 'hygienic', hardness: 'soft', severity: 'warning', weight: 'warn', message: 'CIP/SIP system "{id}" lacks supply, return, or drain path', appliesTo: ['pipe', 'equipment'], phase: 'validate', enabled: false },
    'PID-ANN-001': { title: 'Floating annotation', category: 'annotation', hardness: 'soft', severity: 'warning', weight: 'warn', message: 'annotation "{id}" has no owner and is not a general note', appliesTo: ['annotation'], phase: 'validate', enabled: false },
    'PID-ANN-003': { title: 'Ambiguous leader line', category: 'annotation', hardness: 'soft', severity: 'warning', weight: 'warn', message: 'leader for "{id}" terminates in open space', appliesTo: ['annotation'], phase: 'render', enabled: false },
    'PID-PKG-001': { title: 'Battery limit missing boundary', category: 'package', hardness: 'soft', severity: 'warning', weight: 0, message: 'battery limit connection "{id}" missing boundary definition', appliesTo: ['pipe', 'continuation'], phase: 'validate', enabled: false },
  },
};

// ---- accessors (single lookup points; fallbacks keep unmigrated code safe) ----
function ruleOf(id) { return (id && PID_RULES.rules[id]) || null; }
// ruleEnabled() DELETED 2026-09-25 (T6.12). It was never called, and because the
// 12 `enabled: false` rules have no emitters either, it could not have filtered
// anything — the flag was inert. See the block comment above those rules.
function ruleSeverity(id, fb) {
  const r = ruleOf(id);
  return r ? r.severity : (fb || 'warning');
}
function ruleWeight(id, fb) {
  const r = ruleOf(id);
  if (!r) return fb || 0;
  if (typeof r.weight === 'number') return r.weight;
  return (r.weight && PID_RULES.weights[r.weight] !== undefined) ? PID_RULES.weights[r.weight] : (fb || 0);
}
// Global drawing scale, set by autoLayout when it uniformly scales a sparse
// sheet to fill it (see P&ID-VISUAL-QUALITY.md 9.10). 1 = the historical fixed
// scale, where every mm constant below means exactly what it says.
//
// Why this exists: the engine's tunables are absolute millimetres (14mm port
// lead-in, 45mm bubble slot, 16mm label keep-out, 8mm annotation standoff). If
// the drawing is scaled up but those are not, symbols grow while their keep-outs
// stay put and labels crowd their own symbols — measured, not assumed: filling
// dense.dsl from 27% to 45% took label collisions 1 -> 14. Scaling the mm
// tunables with the drawing preserves the sheet's proportions, which is what
// makes the fill scale genuinely scale-invariant.
var PID_DRAW_SCALE = 1;

function ruleParam(path, fb) {
  const parts = String(path).split('.');
  let node = PID_RULES.params;
  for (const p of parts) {
    if (!node || typeof node !== 'object' || !(p in node)) return fb;
    node = node[p];
  }
  if (node && typeof node === 'object' && 'value' in node) {
    const v = node.value;
    // Sheet-relative margins must NOT scale — they describe the sheet, not the
    // drawing. Everything else denominated in mm scales with the drawing.
    if (typeof v === 'number' && PID_DRAW_SCALE !== 1 && node.unit === 'mm' && !node.noScale) {
      return v * PID_DRAW_SCALE;
    }
    return v;
  }
  return node;
}
// ---- the ONE annotation type-size formula ----------------------------------
//
// `annotation.typeScale` inflates, `annotation.typeFloor` clamps, and the result is
// rounded to 0.1mm. This used to live only inside the renderer's `fs()` closure.
//
// It was duplicated for the first time when the instrument bubble grew to fit its
// tag: the ROUTER also needs to know how big the letters will be, because it
// reserves the room, and it cannot reach into a renderer's closure. The obvious
// move — copy the four lines into the parser — is the exact mistake this file's
// neighbours have already made twice (the `|| 20` grid fallbacks, and the overlay
// coordinate space that drifted by the whole margin). So the formula is here, in the
// rules module, and both consumers call it.
//
// The renderer's `fs()` adds one thing this does not: it RECORDS each size for
// PID-TXT-001. That is a side effect of drawing, not of sizing, and it must not
// fire for a size computed during layout or every run would be counted twice.
// pid-textmetrics.js is loaded BEFORE this file and has no dependencies of its own,
// so `PIDText` is already a lexical binding here. The dependency is load order,
// and load order is a real coupling — it is stated in the file header and in
// harness2.mjs's `files` list rather than left to be discovered.

function annotationTypeMm(n, sc) {
  const textScale = Math.max(0.85, sc || 1);
  const v = n * textScale * ruleParam('annotation.typeScale', 1.4);
  return Math.max(Math.round(v * 10) / 10, ruleParam('annotation.typeFloor', 3.5));
}

// ---- instrument bubble geometry (T6.15 / T6.17) ----------------------------
//
// Solved here rather than in the renderer because BOTH the layout (which reserves
// the space, via `PIDEngine.entitySize` -> `entityHalf`) and the drawing (which
// strokes the circle) must agree on the answer. 9.67 grew the bubble in the
// renderer alone and spike went 997 -> 1274, because the layout went on reserving
// the old radius and the drawing overflowed it. One function, two consumers.
//
// The declared symbol size is a MINIMUM. A bubble is a circle drawn around text;
// if the text does not fit, the bubble is wrong at whatever size it happens to be.
// The solve is chord-aware (the available chord at vertical offset `dy` is
// 2*sqrt(r^2 - dy^2), so a row's half-width and its vertical offset combine as a
// corner distance) and uses the real advance table, so a tag of narrow capitals is
// not over-reserved the way a flat 0.68em factor over-reserved "FIC" by 15%.
//
// Returns the required SIDE of the square the glyph is letterboxed into.
function instrumentBubbleSize(inst, sc) {
  const letters = String((inst && inst.tag) || '').replace(/[^A-Za-z]/g, '');
  if (!letters || typeof symbolSize !== 'function') return 0;
  const s = sc || 1;
  const fL = annotationTypeMm(3.2, s);
  const fN = annotationTypeMm(2.6, s);
  const CAP = PIDText.CAP / 1000, DESC = PIDText.DESC / 1000;
  const rows = [[letters, fL, true, 0.5]];
  if (inst.loop) rows.push([String(inst.loop), fN, false, 5.5]);
  let top = Infinity, bot = -Infinity;
  for (const [, f, , off] of rows) { top = Math.min(top, off - CAP * f); bot = Math.max(bot, off + DESC * f); }
  const shift = -(top + bot) / 2;              // centre the ink block
  let need = 0;
  for (const [str, f, bold, off] of rows) {
    const hw = PIDText.widthMm(str, f, bold) / 2;
    const dy = (off + shift) - (CAP - DESC) * f / 2;   // ink centre off the bubble centre
    need = Math.max(need, Math.hypot(hw, dy));
  }
  // the glyph draws its circle at r = 0.4 * size, and its rect at 0.45 * size, so
  // the circle is the binding constraint for every bubble in the library
  return need / 0.4;
}

function lineRank(kind) {
  if (kind === 'signal') return PID_RULES.linePriority.signal;
  if (kind === 'tap') return PID_RULES.linePriority.tap;
  return PID_RULES.linePriority.process;
}

// ---- deterministic RNG for candidate search (plan Phase 3) ----
// mulberry32. PID_RNG_SEED null = legacy path (original fixed orders,
// bit-identical output). Non-null = shuffle tied choices deterministically.
// Never Math.random: every variant must reproduce from its seed.
var PID_RNG_SEED = null;
var __pidRngState = 0;
function pidSeed(s) {
  PID_RNG_SEED = (s === null || s === undefined) ? null : (s >>> 0);
  __pidRngState = PID_RNG_SEED === null ? 0 : PID_RNG_SEED;
}
function pidRng() {
  // null seed = legacy: callers must keep original order (no shuffle)
  if (PID_RNG_SEED === null) return null;
  __pidRngState = (__pidRngState + 0x6D2B79F5) >>> 0;
  let t = __pidRngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
// shuffle a copy among tied/allowed alternatives; legacy order when seed null
// or when this site is not enabled for the seed. Sites (bit k of the seed):
// 0 = A* dirs, 1 = refine order, 2 = freeSlot, 3 = fan-out, 4 = signal sides.
// ponytail: subset search, not full reshuffle — each candidate is legacy plus
// a few perturbed tie-breaks (coordinate neighborhood), because perturbing
// every tie at once jumps far from an already-good optimum (measured: all
// full-shuffle seeds scored worse than baseline on spike).
function pidSiteActive(site) {
  if (PID_RNG_SEED === null) return false;
  return ((PID_RNG_SEED >>> site) & 1) === 1;
}
function pidShuffle(arr, site) {
  const out = arr.slice();
  if (PID_RNG_SEED === null) return out;
  if (site !== undefined && !pidSiteActive(site)) return out;
  for (let i = out.length - 1; i > 0; i--) {
    const k = Math.floor(pidRng() * (i + 1));
    const tmp = out[i]; out[i] = out[k]; out[k] = tmp;
  }
  return out;
}
