// P&ID Built-in Assembly Catalog (Phase 7 — correctness by construction)
// Pure data: { name, params, body } — no logic, no runtime dependencies.
// Bodies use $name placeholders expanded by expandLine in pid-parser.js.
// Resolution: DSL-defined assemblies first, then these built-ins.
var BUILTIN_ASSEMBLIES = {

  // ── Control Valve Manifold (§6.1) ─────────────────────────────────────
  // block–CV–block + bypass; 4 valves, 4 pipes. User connects external
  // lines to BV1 (entry) and BV2 (exit).
  'control-valve-manifold': {
    params: ['tag', 'type=control', 'line', 'service="Process"'],
    body: `
      valve $tag-BV1 gate "Block valve upstream" normal open line $line service $service
      valve $tag $type "Control valve" normal open fail closed mode auto line $line service $service
      valve $tag-BV2 gate "Block valve downstream" normal open line $line service $service
      valve $tag-BP gate "Bypass valve" normal closed line $line service $service
      $tag-BV1 -> $tag
      $tag -> $tag-BV2
      $tag-BV1 -> $tag-BP
      $tag-BP -> $tag-BV2
    `
  },

  // ── Control Valve with Bypass (simpler variant) ────────────────────────
  // Same topology as manifold but with configurable fail position.
  'control-valve-bypass': {
    params: ['tag', 'type=control', 'line', 'service="Process"', 'fail=closed'],
    body: `
      valve $tag-BV1 gate "Block valve upstream" normal open line $line service $service
      valve $tag $type "Control valve" normal open fail $fail mode auto line $line service $service
      valve $tag-BV2 gate "Block valve downstream" normal open line $line service $service
      valve $tag-BP gate "Bypass valve" normal closed line $line service $service
      $tag-BV1 -> $tag
      $tag -> $tag-BV2
      $tag-BV1 -> $tag-BP
      $tag-BP -> $tag-BV2
    `
  },

  // ── PI/PT Shared Tap (§1.1) ──────────────────────────────────────────
  // Root valve + 3-way manifold + local PI + field PT. Taps on manifold
  // ports (right=line side, top=instrument side).
  'pi-pt-tap': {
    params: ['tag', 'line', 'service="Process"', 'root=gate', 'manifold=3way'],
    body: `
      valve $tag-ROOT $root "Root isolation" normal open line $line service $service
      valve $tag-MAN $manifold "Gauge manifold" normal open line $line service $service
      instrument PI-$tag panel "Local pressure indicator" line $line service $service
      instrument PT-$tag field "Pressure transmitter" line $line service $service
      $tag-ROOT -> $tag-MAN.left
      tap PI-$tag -> $tag-MAN.right.line
      tap PT-$tag -> $tag-MAN.top.line
    `
  },

  // ── PSV Relief (§1.2) ────────────────────────────────────────────────
  // Inlet block valve + PSV + flare/discharge + protects/discharges
  // relations.  Set pressure and flare destination configurable.
  'psv-relief': {
    params: ['tag', 'equip', 'line', 'setPressure="150psi"', 'flare="FLARE"'],
    body: `
      valve $tag-BLK gate "PSV inlet block (car-sealed open)" normal open line $line service "Relief"
      valve $tag relief "Pressure safety valve" set-pressure $setPressure line $line service "Relief"
      $tag-BLK -> $tag
      $tag -> $flare
      protects $tag -> $equip
      discharges $tag -> $flare
    `
  },

  // ── Pump Suction/Discharge (§7.1) ────────────────────────────────────
  // Pump + suction block + discharge check + discharge block.  Suction
  // vessel connection and discharge destination are user-supplied.
  'pump-suction-discharge': {
    params: ['tag', 'type=pump', 'suctionLine', 'dischargeLine', 'service="Process"', 'check=check'],
    body: `
      equipment $tag $type "Pump" service $service
      valve $tag-SV gate "Suction block" normal open line $suctionLine service $service
      valve $tag-CH $check "Discharge check" line $dischargeLine service $service
      valve $tag-DV gate "Discharge block" normal open line $dischargeLine service $service
      $tag-SV -> $tag.suction
      $tag.discharge -> $tag-CH
      $tag-CH -> $tag-DV
    `
  },

  // ── Thermowell (§2.1) ────────────────────────────────────────────────
  // Thermowell nozzle + TE + TT + tap + signal.  Host equipment must
  // already exist; the nozzle is declared on it.
  'thermowell': {
    params: ['tag', 'host', 'line', 'service="Process"', 'element=RTD', 'transmitter=head'],
    body: `
      nozzle $tag-TW on $host port thermowell size 1" rating 300
      instrument TE-$tag $element "Temperature element"
      instrument TT-$tag $transmitter "Temperature transmitter"
      tap TE-$tag -> $tag-TW
      signal TE-$tag -> TT-$tag electrical
    `
  },

  // ── Temperature Control Loop (§2.2) ──────────────────────────────────
  // TT → TIC → TCV with signal lines and loop declaration.
  'temp-control-loop': {
    params: ['tag', 'sensor', 'controller', 'valve'],
    body: `
      instrument $sensor field "Temperature transmitter"
      instrument $controller dcs "Temperature controller"
      valve $valve control "Temperature control valve" normal open fail open mode auto
      signal $sensor -> $controller electrical
      signal $controller -> $valve electrical
      loop $tag measure $sensor controller $controller manipulate $valve
    `
  },

  // ── Orifice Flow (§3.1) ──────────────────────────────────────────────
  // Orifice plate + DP transmitter + FI + taps + signal.
  'orifice-flow': {
    params: ['tag', 'line', 'size', 'service="Process"'],
    body: `
      equipment FE-$tag orifice "Orifice plate" size $size line $line service $service
      instrument FT-$tag field "DP flow transmitter" line $line service $service
      instrument FI-$tag panel "Flow indicator" line $line service $service
      tap FT-$tag -> FE-$tag.high.line
      tap FT-$tag -> FE-$tag.low.line
      signal FT-$tag -> FI-$tag electrical
    `
  },

  // ── DP Level (§4.3) ──────────────────────────────────────────────────
  // High/low nozzles on vessel + DP level transmitter + taps.
  'dp-level': {
    params: ['tag', 'vessel', 'line', 'service="Process"'],
    body: `
      nozzle $tag-HI on $vessel port high size 1" rating 150
      nozzle $tag-LO on $vessel port low size 1" rating 150
      instrument LT-$tag field "DP level transmitter" line $line service $service
      tap LT-$tag -> $tag-HI
      tap LT-$tag -> $tag-LO
    `
  },

  // ── Level Gauge (§4.1) ───────────────────────────────────────────────
  // Top/bottom nozzles + block valves + drain + LG.
  'level-gauge': {
    params: ['tag', 'vessel', 'service="Process"'],
    body: `
      nozzle $tag-TOP on $vessel port top size 1" rating 150
      nozzle $tag-BOT on $vessel port bottom size 1" rating 150
      valve $tag-TV gate "Top block" normal open line $vessel-LG service $service
      valve $tag-BV gate "Bottom block" normal open line $vessel-LG service $service
      valve $tag-DV gate "Drain" normal closed line $vessel-LG service $service
      instrument LG-$tag panel "Level gauge" line $vessel-LG service $service
      $tag-TV -> LG-$tag.top
      $tag-BOT -> $tag-BV
      $tag-BV -> LG-$tag.bottom
      LG-$tag.drain -> $tag-DV
    `
  },

  // ── On/Off Valve (§6.2) ──────────────────────────────────────────────
  // Valve + limit switches (ZSH/ZSL) + signals.
  'onoff-valve': {
    params: ['tag', 'type=ball', 'line', 'service="Process"', 'fail=closed'],
    body: `
      valve $tag $type "On/Off valve" normal open fail $fail mode auto line $line service $service
      instrument ZSH-$tag panel "Open limit switch" line $line service $service
      instrument ZSL-$tag panel "Closed limit switch" line $line service $service
      signal ZSH-$tag -> $tag electrical
      signal ZSL-$tag -> $tag electrical
    `
  }
};
