/**
 * P&ID Component Schema — base type hierarchy for all P&ID objects.
 *
 * Architecture principle:
 *   A P&ID object is an engineering entity first and a graphic second.
 *   The SVG symbol, coordinates, line routing, text placement, colors, layers,
 *   etc. are a representation of the engineering model, not the model itself.
 *
 * Conceptual hierarchy (not literal JS inheritance):
 *
 *   PidProject
 *    └── PidDrawing (view of the project model)
 *         └── PidModel (parsed semantic model)
 *              ├── DrawableObject
 *              │    ├── Equipment
 *              │    ├── Valve
 *              │    ├── Instrument
 *              │    ├── Pipe
 *              │    ├── Junction
 *              │    ├── Annotation
 *              │    └── Connector
 *              └── EngineeringObject
 *                   ├── Alarm
 *                   ├── Interlock
 *                   ├── ControlLoop
 *                   └── Relationship
 *
 * The immutable `id` is the true identity. `tag` is a mutable engineering
 * property — tags can change, duplicate, or be absent.
 *
 * Three-level property system:
 *   CORE      — universal properties the application understands
 *   DOMAIN    — type-specific engineering attributes (pump.flow, valve.setPressure)
 *   CUSTOM    — arbitrary user-defined key/value pairs
 *
 * Naming conventions:
 *   camelCase for runtime properties
 *   PascalCase for @typedef names
 */

// ---------------------------------------------------------------------------
// Primitives & shared value types
// ---------------------------------------------------------------------------

/** @typedef {{ x: number, y: number }} Point */

/** @typedef {{ x0: number, y0: number, x1: number, y1: number }} BBox */

/** @typedef {{ x: number, y: number }} Anchor */

/**
 * @typedef {{
 *   mark: string,
 *   date: string,
 *   desc: string
 * }} Revision
 */

/**
 * @typedef {{
 *   code: string,
 *   entity?: string,
 *   message: string
 * }} ValidationError
 */

// ---------------------------------------------------------------------------
// Port — first-class connection point (owns connectivity semantics)
// ---------------------------------------------------------------------------

/**
 * A Port is a connection point on an object. Connection characteristics
 * (type, direction, flow) live HERE, not on the parent object, because a
 * single object can have ports of different types:
 *
 *   P-101
 *    ├── suction   → process / in
 *    ├── discharge  → process / out
 *    └── drain      → process / out
 *
 *   FT-101
 *    ├── process    → process / in
 *    └── signal_out → pneumatic / out
 *
 * @typedef {{
 *   // ── Identity ──────────────────────────────────────────────────────
 *   id: string,                          // port identifier (e.g. "suction", "left")
 *   ownerId: string,                     // id of the owning PidObject
 *
 *   // ── Connection semantics ──────────────────────────────────────────
 *   type: 'pipe' | 'nozzle' | 'signal',  // physical connection type
 *   role: string,                        // 'inlet' | 'outlet' | 'top' | 'left' | 'right' | 'actuator' | ...
 *   direction: 'in' | 'out' | null,     // flow/signal direction
 *   connectionClass: 'process' | 'signal', // broad connection category
 *   connectionType: string | null,       // 'process' | 'utility' | 'pneumatic' | 'hydraulic' | 'electrical' | 'digital' | 'mechanical'
 *   flowDirection: 'in' | 'out' | 'bidirectional' | null, // flow through this port
 *   cardinality: number,                 // max connections allowed (usually 1)
 *   allowedTypes: string[] | null,       // restrict what port types can connect here (null = any)
 *
 *   // ── Geometry (symbol-space, 0-100 normalized) ─────────────────────
 *   x: number,                           // 0-100 normalized x in symbol
 *   y: number,                           // 0-100 normalized y in symbol
 *   lead: number,                        // lead-in length in mm
 *
 *   // ── Geometry (world-space, resolved at layout time) ───────────────
 *   position: Point | null,              // world coordinates after entity placement
 *   orientation: Point | null,           // outward-facing unit vector {x,y}
 *
 *   // ── Network ───────────────────────────────────────────────────────
 *   networkId: string | null             // logical process network this port belongs to
 * }} Port */

// ---------------------------------------------------------------------------
// Relationship — engineering connections independent of graphics
// ---------------------------------------------------------------------------

/**
 * Relationships capture engineering connections that exist regardless of
 * whether the graphical lines touch. A valve controls an instrument's
 * measured variable — that's true even if someone drags the valve symbol
 * away from the pipe.
 *
 * @typedef {{
 *   kind: 'protected_by' | 'discharges_to' | 'controls' | 'measures' |
 *         'mounted_on' | 'belongs_to_loop' | 'associated_with' |
 *         'supplied_by' | 'drains_to' | 'connected_to' | 'feeds' |
 *         'receives_from' | 'part_of' | 'contains',
 *   from: string,                        // source entity id
 *   to: string,                          // target entity id
 *   fromPort: string | null,             // source port id (if port-specific)
 *   toPort: string | null,               // target port id (if port-specific)
 *   metadata: Object<string, any> | null // extensible relationship data
 * }} Relationship */

// ---------------------------------------------------------------------------
// Base object — every P&ID element inherits this
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   // ── Identity ──────────────────────────────────────────────────────
 *   id: string,                          // immutable unique identifier
 *   objectType: string,                  // 'equipment' | 'valve' | 'instrument' | 'pipe' | 'junction' | 'annotation' | 'connector' | 'alarm' | 'interlock'
 *   subType: string,                     // 'pump' | 'vessel' | 'gate' | 'transmitter' | ...
 *   className: string,                   // DSL class: 'equipment', 'valve', 'instrument', etc.
 *
 *   // ── Engineering identity (CORE) ───────────────────────────────────
 *   tag: string | null,                  // human-readable tag (mutable, may be null)
 *   displayName: string | null,          // friendly name independent of tag
 *   description: string | null,          // longer engineering description
 *   service: string | null,              // process service (e.g. "Purified Water")
 *   system: string | null,               // system code (e.g. "PW")
 *   area: string | null,                 // area/unit (e.g. "Utilities")
 *   unit: string | null,                 // process unit
 *   plant: string | null,                // plant/site
 *   discipline: string | null,           // 'process' | 'instrument' | 'electrical' | ...
 *
 *   // ── Organization ──────────────────────────────────────────────────
 *   drawingId: string | null,            // drawing/document containing this object
 *   parentId: string | null,             // parent assembly/package/equipment
 *   layer: string | null,                // logical display layer
 *   pipelineId: string | null,           // associated process line (pipes only)
 *
 *   // ── Graphics ──────────────────────────────────────────────────────
 *   x: number,                           // drawing X coordinate
 *   y: number,                           // drawing Y coordinate
 *   rotation: number,                    // degrees (0 = default orientation)
 *   scale: number,                       // symbol scale factor (1 = native)
 *   boundingBox: BBox | null,            // cached extents for selection/collision
 *   visible: boolean,                    // display toggle
 *   locked: boolean,                     // prevent accidental editing
 *   selectable: boolean,                 // false for backgrounds/generated objects
 *   zOrder: number,                      // draw ordering (higher = on top)
 *   styleId: string | null,              // reference to style definition
 *   symbolId: string | null,             // PID_SYMBOLS key for the glyph
 *
 *   // ── Connectivity ──────────────────────────────────────────────────
 *   ports: Port[],                       // connection points (nozzles/terminals)
 *   connections: string[],               // ids of connected objects (resolved topology)
 *
 *   // ── Relationships ─────────────────────────────────────────────────
 *   relationships: Relationship[],       // non-graphical engineering relationships
 *
 *   // ── Lifecycle / design state ──────────────────────────────────────
 *   lifecycleState: string,              // 'existing' | 'new' | 'modified' | 'relocated' | 'demolished' | 'future' | 'temporary' | 'by_others'
 *   designStatus: string | null,         // 'conceptual' | 'preliminary' | 'ifc' | 'as_built'
 *   revisionStatus: string | null,       // 'added' | 'modified' | 'deleted' | 'unchanged'
 *
 *   // ── Audit ─────────────────────────────────────────────────────────
 *   createdAt: string | null,            // ISO timestamp
 *   createdBy: string | null,
 *   modifiedAt: string | null,
 *   modifiedBy: string | null,
 *
 *   // ── Provenance ────────────────────────────────────────────────────
 *   source: string,                      // 'manual' | 'imported' | 'generated' | 'synchronized'
 *   sourceType: string | null,           // 'plant3d' | 'smartplant' | 'csv' | ...
 *   sourceId: string | null,             // external system identifier
 *   sourceDocument: string | null,       // source file/drawing
 *   sourceRevision: string | null,       // source revision
 *   externalId: string | null,           // link to external system
 *
 *   // ── Validation ────────────────────────────────────────────────────
 *   validationState: string,             // 'valid' | 'warning' | 'error' | 'unchecked'
 *   validationMessages: ValidationError[],
 *   ruleOverrides: string[],             // suppressed rule codes
 *
 *   // ── Properties (three-level system) ───────────────────────────────
 *   // CORE: universal, application-understood (tag, service, size, etc.)
 *   // See derived types for domain-specific core properties.
 *
 *   // DOMAIN: type-specific engineering attributes
 *   attributes: Object<string, any>,     // e.g. pump.flow, valve.setPressure, instrument.variable
 *                                         // distinguished from customProperties so the app can
 *                                         // query: find every valve where attributes.rating >= 300
 *
 *   // CUSTOM: arbitrary user-defined metadata
 *   notes: string,                       // general notes/comments
 *   customProperties: Object<string, any>,  // extensible key/value store
 *
 *   // ── Internal (parser/runtime, not serialized) ─────────────────────
 *   _seq: number,                        // parse order
 *   _fixed: boolean                      // true when placed via 'at' or 'rel'
 * }} PidObject */

// ---------------------------------------------------------------------------
// Derived types — domain-specific specializations
//
// Each derived type adds CORE properties that the application understands
// natively (e.g. Equipment.size, Valve.normal, Instrument.loop). These are
// NOT in `attributes` — they're first-class typed properties.
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   & PidObject,
 *   objectType: 'equipment',
 *   subType: 'pump' | 'vessel' | 'tank' | 'heat_exchanger' | 'compressor' |
 *            'filter' | 'mixer' | 'furnace' | 'tower' | 'boiler' | 'dryer' |
 *            'conveyor' | 'crusher' | 'separator' | 'silencer' | 'fan' |
 *            'blower' | 'turbine' | 'ejector' | 'agitator' | 'drum',
 *   // ── Equipment-specific CORE ───────────────────────────────────────
 *   normal: string | null,               // 'open' | 'closed' | 'flowing' | 'blocked'
 *   fail: string | null,                 // 'open' | 'closed' | 'last'
 *   size: string | null,                 // equipment size rating
 *   rating: string | null,               // pressure rating
 *   spec: string | null,                 // specification reference
 *   // ── Equipment DOMAIN attributes ───────────────────────────────────
 *   // pump: { flow, head, motorPower, npsh, impeller, efficiency }
 *   // vessel: { volume, designPressure, designTemperature, jacketed }
 *   // heat_exchanger: { area, uValue, tDuty, shellSide, tubeSide }
 *   // compressor: { power, stages, surgeControl }
 * }} Equipment */

/**
 * @typedef {{
 *   & PidObject,
 *   objectType: 'valve',
 *   subType: 'gate' | 'globe' | 'ball' | 'butterfly' | 'check' | 'check_swing' |
 *            'check_lift' | 'needle' | 'control' | 'relief' | 'safety' |
 *            'vacuum_relief' | 'three_way' | 'four_way' | 'angle' |
 *            'rupture_disc' | 'motor_gate',
 *   // ── Valve-specific CORE ───────────────────────────────────────────
 *   normal: string | null,               // 'open' | 'closed'
 *   fail: string | null,                 // 'open' | 'closed' | 'last'
 *   mode: string | null,                 // 'auto' | 'manual' | 'cascade' | 'remote' | 'local'
 *   size: string | null,                 // valve size (e.g. "2")
 *   rating: string | null,               // pressure class (e.g. "150")
 *   spec: string | null,                 // body spec (e.g. "A216-WCB")
 *   actuated: boolean,                   // has actuator (control/motor-operated)
 *   failAction: string | null,           // 'fail_open' | 'fail_closed' | 'fail_last'
 *   // ── Valve DOMAIN attributes ───────────────────────────────────────
 *   // relief: { setPressure, accumulation, blowdown, orifice, capacity }
 *   // control: { cv, characteristic, positioner, iPosition }
 * }} Valve */

/**
 * @typedef {{
 *   & PidObject,
 *   objectType: 'instrument',
 *   subType: 'transmitter' | 'indicator' | 'controller' | 'switch' | 'recorder' |
 *            'gauge' | 'element' | 'sensor' | 'analyzer' | 'computer' |
 *            'plc' | 'shared_display',
 *   // ── Instrument-specific CORE ──────────────────────────────────────
 *   bubble: string,                      // 'field' | 'panel' | 'dcs' | 'computer' | 'plc'
 *   variable: string | null,             // ISA variable letter(s) (e.g. "PT")
 *   functions: string | null,            // ISA function letter(s) (e.g. "IC")
 *   loop: string | null,                 // loop number
 *   tagClass: string,                    // variable + functions concatenated
 *   // ── Instrument DOMAIN attributes ──────────────────────────────────
 *   // transmitter: { range, span, output, processConnection }
 *   // switch: { setpoint, differential }
 *   // analyzer: { parameter, method, range }
 * }} Instrument */

/**
 * Pipe separates TOPOLOGY (what it connects) from GRAPHICS (how it routes).
 *
 * Topology: from, to, fromPort, toPort, signalType, line*
 * Graphics: via, _from, _to, _tap, geometry (planned)
 *
 * This separation means you can change the routing/layout without changing
 * the engineering model, and you can validate connectivity without knowing
 * where the lines are drawn.
 *
 * @typedef {{
 *   & PidObject,
 *   objectType: 'pipe',
 *   subType: 'process' | 'signal' | 'tap',
 *
 *   // ── Topology (engineering model) ──────────────────────────────────
 *   from: string,                        // source entity id
 *   fromPort: string | null,             // source port name
 *   to: string,                          // destination entity id
 *   toPort: string | null,               // destination port name
 *   signalType: string | null,           // 'pneumatic' | 'hydraulic' | 'electrical' | 'digital' | ...
 *
 *   // ── Line definition (engineering data) ────────────────────────────
 *   line: string | null,                 // line definition id (from DSL 'line' statement)
 *   label: string | null,                // formatted pipeline label
 *   lineSpec: string | null,             // line specification
 *   lineSize: string | null,             // line size
 *   lineService: string | null,          // line service
 *   linePhase: string | null,            // phase
 *   linePressure: string | null,         // design pressure
 *   lineTemperature: string | null,      // design temperature
 *   lineMaterial: string | null,         // piping material
 *   lineInsulation: string | null,       // insulation type
 *   lineTracing: string | null,          // trace heating
 *
 *   // ── Routing geometry (graphics representation) ────────────────────
 *   via: Array<Point>,                   // intermediate routing points
 *   // Resolved at routing time — not part of the engineering model:
 *   _from: { x: number, y: number, dir: Point, junction?: boolean, signal?: boolean } | null,
 *   _to: { x: number, y: number, dir: Point, junction?: boolean, signal?: boolean } | null,
 *   _tap: { host: string } | null,       // tap connection (tap pipes only)
 *   // geometry: Array<Point> | null,    // (planned) final rendered polyline
 * }} Pipe */

/**
 * @typedef {{
 *   & PidObject,
 *   objectType: 'junction',
 *   subType: 'tee' | 'cross' | 'off_page' | 'stub',
 *   stub: boolean,                       // true for off-page stubs
 *   ref: string | null,                  // cross-reference (e.g. "S2.J5")
 * }} Junction */

/**
 * Nozzle — a real engineering component attached to equipment.
 *
 * Nozzles sit between equipment ports and pipes. A pipe connects to a nozzle's
 * flange tip, not directly to the equipment body. The nozzle has its own tag,
 * size, rating, and material spec — just like a real P&ID nozzle.
 *
 * Nozzle orientation is derived from the equipment port direction: the nozzle
 * extends outward from the equipment body along the port's normal vector.
 *
 * @typedef {{
 *   & PidObject,
 *   objectType: 'nozzle',
 *   subType: 'weld_neck' | 'slip_on' | 'socket_weld' | 'threaded' | 'lap_joint' | 'blind',
 *
 *   // ── Equipment attachment ──────────────────────────────────────────
 *   ownerId: string,                     // equipment id this nozzle is on
 *   portId: string,                      // equipment port id this nozzle attaches to
 *
 *   // ── Engineering properties ────────────────────────────────────────
 *   size: string,                        // nozzle size (e.g. "4" for 4-inch)
 *   rating: string | null,               // pressure class (e.g. "150", "300")
 *   spec: string | null,                 // material spec (e.g. "A105", "A182-316L")
 *   facing: string | null,               // flange facing (e.g. "RF", "FF", "RTJ")
 *   schedule: string | null,             // wall thickness (e.g. "Sch 40", "Sch 80")
 *
 *   // ── Geometry ──────────────────────────────────────────────────────
 *   length: number,                      // nozzle projection from equipment body (mm)
 *   orientation: number,                 // rotation angle (degrees, derived from port direction)
 *   position: Point | null,              // world position of nozzle base (at equipment body)
 *   tipPosition: Point | null,           // world position of flange tip (where pipe connects)
 *
 *   // ── Connectivity ──────────────────────────────────────────────────
 *   connected: boolean                   // true if a pipe is connected to this nozzle
 * }} Nozzle */

/**
 * Engineering objects — not directly drawable but participate in the model.
 * These represent Alarm, Interlock, ControlLoop, Relationship as first-class
 * entities in the project graph, not just properties on drawable objects.
 *
 * @typedef {{
 *   & PidObject,
 *   objectType: 'alarm',
 *   subType: string,
 *   source: string,                      // entity id that triggers the alarm
 *   condition: 'high' | 'low' | 'high_high' | 'low_low',
 *   priority: 'low' | 'medium' | 'high' | 'critical',
 * }} Alarm */

/**
 * @typedef {{
 *   & PidObject,
 *   objectType: 'interlock',
 *   subType: string,
 *   trigger: string,                     // entity or alarm id
 *   action: string,                      // entity id to actuate
 * }} Interlock */

/**
 * @typedef {{
 *   id: string,
 *   instruments: string[],               // instrument tags in this loop
 *   signals: Pipe[],                     // signal edges between loop instruments
 *   loopTag: string | null,              // declared loop tag (if explicit)
 *   measure: string | null,              // measuring instrument id
 *   controller: string | null,           // controller instrument id
 *   manipulate: string | null,           // final element id
 *   explicit: boolean                    // true if declared via DSL 'loop' statement
 * }} ControlLoop */

// ---------------------------------------------------------------------------
// Drawing-level metadata
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   show: 'all' | 'equipment' | 'valves' | 'instruments',
 *   hideLabels: boolean,
 *   stubLength: number,
 *   layout: 'auto' | 'manual',
 *   fitPage: boolean,
 *   legend: boolean,
 *   northArrow: boolean,
 *   grid: number,
 *   chips: boolean,
 *   route: 'avoid' | 'direct',
 *   symbolScale: number,
 *   sheetW: number,
 *   sheetH: number,
 *   title: string | null,
 *   project: string | null,
 *   sheet: string | null,
 *   sheetTotal: string | null,
 *   rev: Revision | null,
 *   status: 'preliminary' | 'design' | 'review' | 'construction' | 'as_built' | 'superseded' | null,
 *   units: string | null
 * }} DrawingView */

// ---------------------------------------------------------------------------
// Complete parsed model (one drawing)
// ---------------------------------------------------------------------------

/**
 * PidModel represents the parsed semantic model of a single P&ID drawing.
 * It is a VIEW of the project model — the project may contain equipment,
 * lines, and instruments that span multiple drawings.
 *
 * @typedef {{
 *   equipment: Equipment[],
 *   valves: Valve[],
 *   instruments: Instrument[],
 *   junctions: Junction[],
 *   nozzles: Nozzle[],
 *   pipes: Pipe[],
 *   lineDefs: Object<string, Object<string, string>>,
 *   loops: ControlLoop[],
 *   alarms: Alarm[],
 *   interlocks: Interlock[],
 *   relationships: Relationship[],
 *   pipelines: Array<{ id: string, segments: Pipe[], [key: string]: any }>,
 *   graphs: {
 *     process: { nodes: string[], edges: Pipe[] },
 *     signal: { nodes: string[], edges: Pipe[] },
 *     taps: { nodes: string[], edges: Pipe[] }
 *   },
 *   view: DrawingView,
 *   warnings: string[],
 *   errors: ValidationError[],
 *   info: any[],
 *   schemaVersion: number,
 *   // runtime / internal:
 *   pathAnalysis: { sources: string[], sinks: string[], unreachable: string[] } | null,
 *   usedConns: Map<string, Map<string, number>> | null,
 *   usedPorts: Map<string, Port[]> | null,
 *   junctionGraph: Map<string, Array<{ pipe: string, end: string }>> | null
 * }} PidModel */

// ---------------------------------------------------------------------------
// Project — the top-level model above individual drawings
// ---------------------------------------------------------------------------

/**
 * PidProject is the top-level model. A drawing is a VIEW of the project.
 * This enables:
 *   - Equipment lists, line lists, instrument indexes across all drawings
 *   - Cross-drawing connectivity (equipment on P&ID-001 connects to lines on P&ID-002)
 *   - Project-wide validation (duplicate tags, orphan instruments)
 *   - Multiple output formats from the same model
 *
 * @typedef {{
 *   // ── Identity ──────────────────────────────────────────────────────
 *   id: string,
 *   name: string,
 *   description: string | null,
 *
 *   // ── Organization ──────────────────────────────────────────────────
 *   plant: string | null,
 *   area: string | null,
 *   client: string | null,
 *   contractor: string | null,
 *   documentNumber: string | null,
 *
 *   // ── Drawings (views of this model) ────────────────────────────────
 *   drawings: Array<{
 *     id: string,
 *     number: string,                    // drawing number (e.g. "P&ID-001")
 *     title: string,
 *     revision: Revision | null,
 *     status: string | null,
 *     model: PidModel                    // parsed model for this drawing
 *   }>,
 *
 *   // ── Cross-drawing indexes (derived, rebuilt from drawings) ─────────
 *   equipmentIndex: Equipment[],         // all equipment across all drawings
 *   instrumentIndex: Instrument[],       // all instruments
 *   lineList: Pipe[],                    // all process pipes (deduplicated by line id)
 *   valveList: Valve[],                  // all valves
 *   loopList: ControlLoop[],            // all control loops
 *
 *   // ── Project-wide relationships ────────────────────────────────────
 *   relationships: Relationship[],       // cross-drawing relationships
 *
 *   // ── Validation ────────────────────────────────────────────────────
 *   validationState: string,
 *   validationMessages: ValidationError[],
 *
 *   // ── Metadata ──────────────────────────────────────────────────────
 *   createdAt: string | null,
 *   modifiedAt: string | null,
 *   schemaVersion: number
 * }} PidProject */

// ---------------------------------------------------------------------------
// Symbol definition (entries in window.PID_SYMBOLS)
// ---------------------------------------------------------------------------

/**
 * SymbolDefinition is the template for a glyph. It is NOT a PidObject —
 * it defines the visual representation that PidObjects reference via symbolId.
 *
 * @typedef {{
 *   svg: string,                         // raw SVG markup
 *   size: number,                        // nominal size in mm
 *   ports: Port[],                       // connection point definitions (template)
 *   extents: BBox,                       // bounding box in 0-100 logical space
 *   anchor: Anchor,                      // insertion point
 *   labelAnchor: Anchor | null,          // label placement point
 *   flowAxis: 'h' | 'v' | null,         // primary flow axis
 *   autoRotate: boolean,                 // rotate to match pipe flow direction
 *   rotatable: boolean,                  // manual rotation allowed
 *   standard: string | null,             // governing standard (ISA-5.1, etc.)
 *   version: number,                     // definition version
 *   behavior: {
 *     isolation?: boolean,               // can isolate flow
 *     throttling?: boolean,              // can throttle/regulate
 *     directional?: boolean,             // has flow direction
 *     actuated?: boolean,                // has actuator
 *     requiresControl?: boolean,         // needs a controller instrument
 *     safety?: boolean,                  // safety-critical function
 *     minProcessPorts?: number           // minimum process connections required
 *   } | null
 * }} SymbolDefinition */
