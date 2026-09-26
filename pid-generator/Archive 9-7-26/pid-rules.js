// P&ID Rule Registry — single source of truth for rule identity, severity,
// scoring weights, line priorities, and tunable thresholds.
// Loaded FIRST (no dependencies): pure data + tiny accessors.
// See P&ID-AUTO-QUALITY-PLAN.md Phase 2.
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
    bend: 2, len: 0.05, tap: 0.2, sig: 0.2, warn: 5,
    overlapLen: 12,
  },

  // ---- line priority: which line breaks at a crossing (low breaks first) ----
  linePriority: { process: 2, tap: 1, signal: 0 },

  // ---- tunable thresholds with built-in constraints ----
  params: {
    routing: {
      minPortRun:   { value: 14, min: 4, max: null, unit: 'mm', desc: 'straight run kept at every port before the first bend' },
      gridMin:      { value: 5, min: 1, max: null, unit: 'mm', desc: 'routing grid floor (CELL = max(grid, gridMin))' },
      obstaclePad:  { value: 4, min: 0, max: null, unit: 'mm', desc: 'symmetric obstacle padding around symbols' },
      labelPadBottom: { value: 14, min: 0, max: null, unit: 'mm', desc: 'extra obstacle room below equipment/valves (label stacks)' },
      avoidMargin:  { value: 8, min: 0, max: null, unit: 'mm', desc: 'instrument keep-out around equipment/valves in freeSlot' },
      instrumentMargin: { value: 3, min: 0, max: null, unit: 'mm', desc: 'extra separation for bubbles (labels/halos wider than symbol)' },
      gapBreak:     { value: 4, min: 1, max: null, unit: 'mm', desc: 'half-width of a crossing gap cut' },
      gapMinRun:    { value: 8, min: 2, max: null, unit: 'mm', desc: 'straight run required each side of a full gap' },
      nozzleLead:   { value: 14, min: 4, max: null, unit: 'mm', desc: 'axial straight run forced at every nozzle tip' },
      junctionStubMin: { value: 6, min: 2, max: null, unit: 'mm', desc: 'minimum fan-out stub at junction nodes' },
      sheetMargin:  { value: 26, min: 0, max: null, unit: 'mm', desc: 'sheet bounds inset (routing/search/placement)' },
      searchMargin: { value: 260, min: 50, max: null, unit: 'mm', desc: 'A* local search box around the direct route' },
      bendPenalty:  { value: 12, min: 0, max: null, unit: 'cost', desc: 'A* turn cost' },
      dipPenalty:   { value: 50, min: 0, max: null, unit: 'cost', desc: 'A* per-cell cost below the ports elevation' },
      fieldCross:   { value: 300, min: 0, max: null, unit: 'cost', desc: 'penalty for crossing an already-routed line' },
      fieldNear:    { value: 35, min: 0, max: null, unit: 'cost', desc: 'penalty for running adjacent to a routed line' },
      signalLenWarn: { value: 0.55, min: 0, max: 1, unit: 'fraction', desc: 'signal run warning threshold (× sheet width)' },
    },
    layout: {
      colSpacing:   { value: 140, min: 40, max: null, unit: 'mm', desc: 'auto-layout column pitch' },
      rowSpacing:   { value: 145, min: 40, max: null, unit: 'mm', desc: 'auto-layout row pitch' },
      xMargin:      { value: 60, min: 0, max: null, unit: 'mm', desc: 'auto-layout sheet x margin' },
      yMargin:      { value: 118, min: 0, max: null, unit: 'mm', desc: 'auto-layout sheet y margin (instrument tier headroom)' },
      stackField:   { value: 24, min: 8, max: null, unit: 'mm', desc: 'field bubble stack gap above tap host' },
      stackCtrl:    { value: 32, min: 8, max: null, unit: 'mm', desc: 'controller stack gap above driven element (gap-break room)' },
      stackOrphan:  { value: 30, min: 8, max: null, unit: 'mm', desc: 'orphan controller gap above field partner' },
      freeSlot:     { value: 45, min: 20, max: null, unit: 'mm', desc: 'instrument slot exclusion radius' },
      labelZone:    { value: 16, min: 0, max: null, unit: 'mm', desc: 'label keep-out below equipment/valves in stacking' },
      valveGap:     { value: 14, min: 6, max: null, unit: 'mm', desc: 'valve-to-equipment-port clearance in snapping' },
      junctionGap:  { value: 22, min: 6, max: null, unit: 'mm', desc: 'junction sit-out distance on port lead-out axis' },
    },
    annotation: {
      typeScale:    { value: 1.4, min: 1, max: 3, unit: 'factor', desc: 'type size multiplier over base sizes' },
      typeFloor:    { value: 3.5, min: 2, max: null, unit: 'mm', desc: 'minimum rendered text size' },
      labelOffset:  { value: 14, min: 4, max: null, unit: 'mm', desc: 'line-label leader standoff' },
      labelOffsetWide: { value: 28, min: 8, max: null, unit: 'mm', desc: 'line-label fallback standoff' },
    },
    taps: {
      dropSep:      { value: 2, min: 0, max: null, unit: 'mm', desc: 'tap drop separation from bubble and landing' },
      laneShift:    { value: 5, min: 1, max: null, unit: 'mm', desc: 'tap lane dodge step' },
      minReach:     { value: 3, min: 0, max: null, unit: 'mm', desc: 'tap bubble-on-line reach threshold' },
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
    // ---- tracked future rules (enabled:false — the model has no entity or
    // syntax to enforce them against yet; IDs reserved so future DSL additions
    // don't collide. See plan for the per-rule trigger.) ----
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
function ruleEnabled(id) {
  const r = ruleOf(id);
  return r ? r.enabled !== false : true;
}
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
function ruleParam(path, fb) {
  const parts = String(path).split('.');
  let node = PID_RULES.params;
  for (const p of parts) {
    if (!node || typeof node !== 'object' || !(p in node)) return fb;
    node = node[p];
  }
  return (node && typeof node === 'object' && 'value' in node) ? node.value : node;
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
