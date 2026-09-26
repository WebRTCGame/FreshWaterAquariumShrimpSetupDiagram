Absolutely. For your P&ID DSL, I would make the rules **much stricter than a conventional drafting guide**. A human drafter can visually infer that something is wrong; a DSL needs explicit topology, cardinality, ownership, attachment, and validation rules.

The rules below are intentionally written so they can eventually become **machine-enforceable constraints** rather than merely drafting advice. They are based on established P&ID practice, with particular alignment to current ISA and PIP guidance. ISA currently lists ANSI/ISA-5.1-2024 as its current instrumentation/control symbol and identification standard, and ISA-TR5.1.04-2026 specifically addresses PFD/P&ID content. ([isa.org][1]) PIP's May 2026 P&ID Documentation Criteria likewise explicitly covers P&ID format/content and now includes hygienic-processing guidance. ([PIP][2])

# Comprehensive P&ID Drafting Rules and Structural Specification

## 1. Purpose

This document defines a comprehensive set of rules for the creation, validation, layout, and representation of Piping and Instrumentation Diagrams (P&IDs).

The rules are intended to serve two purposes:

1. Establish consistent human drafting practices for North American process-industry P&IDs.
2. Provide a sufficiently formal rule system for implementation in a machine-readable P&ID DSL capable of generating and validating P&IDs similarly to how Mermaid or PlantUML generate diagrams.

The fundamental principle is:

> **A P&ID is a semantic model of a process system that happens to have a graphical representation.**

Therefore, graphical appearance must never be the sole source of truth. Components, ports, connections, signals, annotations, tags, and relationships shall exist as structured objects with explicit relationships.

---

# 2. Governing Principles

## 2.1 Semantic correctness takes precedence over graphical appearance

A diagram shall not be considered valid merely because it looks correct.

The underlying model shall contain:

* components
* ports
* connections
* line segments
* instruments
* signals
* annotations
* tags
* equipment relationships
* control relationships
* off-page relationships
* specification attributes

A graphical representation shall be generated from this model.

---

## 2.2 Every physical connection shall have explicit topology

A process connection shall never be inferred solely from graphical proximity.

Two objects that touch visually are not necessarily connected.

A connection shall explicitly identify:

* source object
* source port
* destination object
* destination port
* connection type
* line identity, where applicable
* direction, where applicable

Example:

```text
Pump.P1 -> Valve.P1
```

is valid.

```text
Pump -> Valve
```

is insufficient because the connection ports are undefined.

---

## 2.3 Every port has a defined purpose

Each component shall expose one or more typed ports.

A port shall define:

* unique port ID
* port type
* connection category
* allowable connection types
* cardinality
* direction
* physical/semantic role
* nominal size, where applicable
* connection standard, where applicable

Examples of port types include:

* process inlet
* process outlet
* utility inlet
* utility outlet
* drain
* vent
* instrument process connection
* pneumatic signal
* electrical signal
* digital signal
* hydraulic signal
* control-system connection

---

## 2.4 Invalid connections shall be impossible or explicitly rejected

A component shall not accept an arbitrary connection simply because a line endpoint can be drawn over it.

For example:

A two-port gate valve has exactly two process ports.

It shall not accept:

* a third process connection
* an instrument signal directly into a process port
* a drain connection unless a drain port is explicitly modeled
* a branch connection through the valve body unless the valve symbol/type supports it

This rule is particularly important for a P&ID DSL.

---

# 3. Drawing Hierarchy

A P&ID shall conceptually contain the following hierarchy:

```text
Project
 └── P&ID
      ├── Area / Unit
      │    ├── Equipment
      │    ├── Piping
      │    ├── Valves
      │    ├── Instruments
      │    ├── Control Functions
      │    ├── Signals
      │    ├── Notes
      │    └── References
      └── Sheet metadata
```

The hierarchy shall be independent of physical drawing position.

---

# 4. P&ID Scope

A P&ID shall communicate sufficient information to understand:

* process flow
* equipment relationships
* piping relationships
* valves
* fittings
* instrumentation
* control functions
* process connections
* utility connections
* drains
* vents
* safety devices
* major design intent
* interfaces with other systems
* interfaces with other drawings
* equipment identification
* line identification
* instrument identification
* relevant operating/control relationships

A P&ID is not required to contain every fabrication or construction detail.

---

# 5. Information That Generally Does Not Belong on a P&ID

Unless specifically required by project standards, the P&ID should not attempt to represent:

* exact pipe spool dimensions
* weld maps
* fabrication dimensions
* exact physical coordinates
* support steel geometry
* detailed structural steel
* insulation thickness throughout the system
* exact equipment fabrication geometry
* bolt patterns
* detailed electrical wiring
* complete cable schedules
* detailed PLC programming
* detailed DCS configuration
* detailed instrument wiring
* fabrication-level fitting dimensions

These belong in other engineering documents.

---

# 6. Graphical Representation

## 6.1 Symbols

Every graphical symbol shall correspond to a semantic object.

A symbol shall not exist without an underlying object.

Conversely, every drawable semantic object shall have a defined graphical representation.

---

## 6.2 Symbol identity

A symbol definition shall contain:

* symbol ID
* symbol family
* semantic type
* graphical geometry
* connection points
* port definitions
* rotation behavior
* mirroring behavior
* annotation anchors
* default dimensions
* allowable connection types

---

## 6.3 Symbol orientation

Symbols shall normally be oriented to support readable process flow.

Symbols may be rotated when required by layout.

Rotation shall not alter semantic port identity.

For example:

```text
Valve.P1
Valve.P2
```

remain P1 and P2 regardless of whether the valve is horizontal or vertical.

---

## 6.4 Mirroring

Mirroring shall not silently exchange semantic port identities unless explicitly defined by the symbol.

A mirrored check valve, for example, must not accidentally reverse its flow direction.

---

# 7. Piping Rules

## 7.1 Process lines

Every process line shall have:

* unique line identifier
* nominal size
* piping class/specification
* fluid/service designation
* insulation/heat tracing attributes where applicable
* source
* destination
* flow direction where known
* line segments
* connected components

---

## 7.2 Line continuity

A continuous physical line shall remain topologically continuous unless an explicit component interrupts it.

Valid:

```text
Equipment -> Valve -> Equipment
```

Invalid:

```text
Equipment -> visually touching line
```

with no semantic connection.

---

## 7.3 Lines shall connect to ports

A process line shall terminate on a valid component port.

A line shall not terminate:

* in free space
* on the middle of a symbol
* on annotation text
* on a dimension
* on another unrelated line
* on the graphical outline of a component without a port

unless the symbol explicitly defines that location as a connection point.

---

## 7.4 Line-to-line connections

A line intersection shall not automatically imply a connection.

The DSL shall distinguish:

```text
crossing
```

from:

```text
junction
```

A junction shall be explicitly represented.

---

## 7.5 Branch connections

A branch shall be represented by an explicit junction or branch node.

A branch connection shall not be inferred merely because three line segments occupy the same coordinates.

---

## 7.6 Junction cardinality

A junction may have:

* two connected segments for simple continuity
* three or more connected segments for branching

The topology shall remain explicit.

---

## 7.7 Crossing lines

Crossing lines without a junction shall remain electrically/process-wise independent.

A crossover may be graphically represented using:

* line interruption
* bridge
* spacing
* other project-approved convention

The selected convention shall be globally consistent.

---

# 8. Flow Direction

## 8.1 Direction

Where process direction is known, it shall be explicitly modeled.

Direction shall not be inferred solely from left-to-right drawing placement.

---

## 8.2 Flow arrows

Flow arrows shall be placed where they improve interpretation.

They should generally appear:

* on long lines
* near branches
* near page boundaries
* where flow direction may be ambiguous
* on utility systems where direction matters

---

## 8.3 Bidirectional flow

Bidirectional systems shall not be represented with a single misleading directional arrow.

They shall use:

* bidirectional indication
* two directional indicators
* or an explicit project-approved convention.

---

# 9. Pipe Segmentation

A continuous line shall be segmented when any meaningful property changes.

Examples:

```text
6"-P-1001
     |
     +-- valve
```

or changes in:

* line number
* size
* specification
* service
* insulation
* heat tracing
* operating condition
* ownership/system
* material
* pressure class

A segment shall inherit properties from its parent line unless explicitly overridden.

---

# 10. Pipe Size Changes

A reducer/expander or other explicit size transition shall be modeled when size changes.

The DSL shall not permit:

```text
6" pipe -> 4" pipe
```

without either:

* a reducer object
* a size-transition object
* or an explicitly modeled implicit transition permitted by project rules.

---

# 11. Piping Components

Every piping component shall define its expected port cardinality.

Examples:

| Component        | Typical process ports |
| ---------------- | --------------------: |
| Gate valve       |                     2 |
| Globe valve      |                     2 |
| Ball valve       |                     2 |
| Butterfly valve  |                     2 |
| Check valve      |                     2 |
| Control valve    |                     2 |
| Reducer          |                     2 |
| Strainer         |                     2 |
| Filter           |                     2 |
| Rupture disk     |                     2 |
| Orifice plate    |                     2 |
| Tee              |                     3 |
| Cross            |                     4 |
| Elbow            |                     2 |
| Blind flange     |                     1 |
| Equipment nozzle |                     1 |
| Pump             |                    2+ |
| Vessel           |                    1+ |
| Heat exchanger   |                    2+ |

The actual port count shall be determined by the semantic object rather than by the graphical symbol.

---

# 12. Valves

## 12.1 Valve identity

Every significant valve shall have:

* valve type
* tag
* line association
* port count
* flow path
* normally-open/closed state where applicable
* actuator information where applicable
* control status where applicable

---

## 12.2 Two-port valves

A standard two-port valve shall have exactly two primary process ports.

No third process connection shall be allowed.

---

## 12.3 Multi-port valves

Three-way, four-way, diverter, mixing, and other multi-port valves shall explicitly define:

* each port
* allowed flow paths
* default state
* alternate states
* actuator/control relationships

---

## 12.4 Valve state

Where relevant, valve state shall be modeled independently of graphical orientation.

Examples:

```text
normal = open
normal = closed
fail = open
fail = closed
fail = last
fail = undefined
```

---

## 12.5 Manual valves

Manual valves shall be distinguishable from automated/control valves.

---

## 12.6 Automated valves

Automated valves shall contain:

* valve body
* actuator
* control relationship
* signal relationship
* fail position where applicable

---

# 13. Control Valves

A control valve shall be modeled as more than a generic valve.

It shall support:

* process inlet
* process outlet
* valve tag
* controlled variable relationship
* controller relationship
* actuator
* signal type
* fail action
* normal position
* interlock relationships where applicable

---

# 14. Equipment

## 14.1 Equipment identity

Equipment shall have:

* equipment type
* equipment tag
* service
* nozzles
* connected lines
* associated instruments
* associated valves
* relevant process attributes

---

## 14.2 Equipment boundaries

Equipment shall have a clear graphical boundary.

Process lines shall connect to defined nozzles or ports.

A line shall not connect to an arbitrary location on the equipment outline.

---

## 14.3 Nozzles

Each nozzle shall have:

* nozzle identifier
* equipment owner
* connection point
* nominal size
* rating/class where applicable
* service
* orientation metadata where relevant

---

## 14.4 Equipment connections

A line connecting to equipment shall connect to a nozzle.

Example:

```text
P-101 discharge nozzle N2
```

rather than merely:

```text
P-101
```

---

# 15. Pumps

A pump shall normally expose:

* suction nozzle
* discharge nozzle
* optional recirculation/flush/seal connections
* associated motor/driver representation where required
* instruments and controls
* isolation valves
* check valve where required by design
* drains/vents where applicable

The P&ID shall not automatically assume a check valve exists unless specified by the design rules.

---

# 16. Vessels

Vessels shall expose explicit nozzles for:

* inlet
* outlet
* vent
* drain
* overflow
* instrument connections
* relief devices
* utility connections

Only applicable connections shall be represented.

---

# 17. Heat Exchangers

Heat exchangers shall explicitly distinguish their fluid sides.

For example:

```text
Shell side:
  inlet
  outlet

Tube side:
  inlet
  outlet
```

Connections shall not cross sides accidentally.

The DSL shall treat each side as a separate flow domain.

---

# 18. Instrumentation

Instrumentation shall follow a consistent identification and graphical system.

ANSI/ISA-5.1-2024 is the current ISA standard for instrumentation and control symbols and identification. ISA describes its purpose as establishing a uniform means of designating instruments and instrumentation systems, including symbols and identification codes. ([isa.org][1])

---

# 19. Instrument Tags

Instrument tags shall be modeled as structured data rather than arbitrary text.

A tag shall support:

* function letters
* loop number
* optional suffix
* optional prefix
* associated equipment
* associated line
* measurement variable
* control function

Example:

```text
PT-101
PIC-101
FT-202
FIC-202
LT-301
LIC-301
```

---

# 20. Instrument Functional Identity

The instrument identifier shall communicate its functional purpose.

The tag shall not be chosen merely from the physical device type.

For example, a transmitter measuring pressure should be identified according to its measurement/control function rather than merely being labeled "transmitter."

ISA specifically describes its identification system as being intended to designate instruments and functions used for measurement, monitoring, and control. ([isa.org][1])

---

# 21. Instrument Location

The graphical representation shall distinguish, where required:

* field instruments
* panel/control-room instruments
* software/system functions
* shared displays
* local indicators
* remote instruments

The exact symbol conventions shall come from the project symbol library.

---

# 22. Instrument Process Connections

A field instrument connected to a process shall have an explicit process connection.

The connection shall identify:

```text
process object
     ↓
process connection
     ↓
instrument
```

The instrument shall not appear merely adjacent to the pipe and be assumed connected.

---

# 23. Instrument Signals

Signals shall be modeled independently of process piping.

Examples:

* pneumatic
* electrical
* electronic
* analog
* digital
* discrete
* wireless
* network/data
* hydraulic

A signal line shall never be interpreted as a process line.

---

# 24. Signal Connections

A signal shall explicitly identify:

* source
* destination
* signal type
* direction
* function

Example:

```text
PT-101
   |
   | process measurement
   v
PIC-101
   |
   | control output
   v
FV-101
```

---

# 25. Control Loops

A control loop shall be represented as a semantic relationship.

A typical loop may contain:

```text
Process
   ↓
Sensor
   ↓
Transmitter
   ↓
Controller
   ↓
Output signal
   ↓
Final control element
   ↓
Process
```

The graphical arrangement shall not be the source of loop identity.

---

# 26. Control Relationships

The DSL shall allow explicit relationships such as:

```text
PIC-101 controls FV-101
LIC-201 controls LV-201
FIC-301 controls FCV-301
```

This shall be distinct from merely drawing a signal line.

---

# 27. Interlocks

Interlocks shall be represented as logical relationships rather than ordinary process piping.

The DSL should support:

```text
IF condition
THEN action
```

relationships.

Example:

```text
LSHH-101 -> shutdown -> P-101
```

---

# 28. Safety Instrumented Functions

Safety-related functions shall be distinguishable from ordinary process control.

Where applicable, the model should identify:

* initiating device
* logic function
* final element
* trip action
* reset behavior
* associated equipment

The P&ID should not imply a safety integrity claim merely because a shutdown function is drawn.

---

# 29. Alarms

Alarms shall be represented separately from measurement.

For example:

```text
PT -> PIC
PT -> PAH
```

shall represent two different functional relationships.

An alarm shall not be inferred merely from a transmitter tag.

---

# 30. Shutdown Functions

Emergency shutdowns, trips, permissives, and interlocks shall be represented distinctly.

The DSL should support classifications such as:

* alarm
* permissive
* interlock
* trip
* shutdown
* start command
* stop command
* reset
* sequence control

---

# 31. Safety Devices

Safety devices include, where applicable:

* pressure relief valves
* safety valves
* rupture disks
* vacuum breakers
* emergency vents
* flame arrestors
* relief headers
* flare connections

Each shall have explicit process connectivity.

---

# 32. Relief Devices

A relief device shall identify:

* protected equipment/system
* inlet connection
* discharge connection
* destination
* set-pressure metadata where appropriate
* relief service
* discharge system

A relief valve shall not simply terminate in free space unless the project explicitly permits that representation.

---

# 33. Drains

Drains shall be represented explicitly.

A drain connection shall identify:

* source
* drain valve, where applicable
* destination
* drain system/service

A drain shall not be represented merely by a line disappearing from a pipe.

---

# 34. Vents

Vents shall be represented explicitly.

The destination shall be identified where required:

* atmosphere
* vent header
* scrubber
* recovery system
* flare
* other destination

---

# 35. Utility Connections

Utilities shall be modeled as distinct services.

Examples:

* plant air
* instrument air
* nitrogen
* steam
* condensate
* cooling water
* chilled water
* hot water
* glycol
* potable/service water
* vacuum
* chemical supply
* CIP
* SIP

A utility line shall not be confused with the process line it serves.

---

# 36. Utility Tie-ins

A utility connection shall explicitly identify:

```text
utility system
      ↓
connection point
      ↓
consumer
```

The graphical proximity of a utility line to equipment shall not imply a connection.

---

# 37. Hygienic Processing

Where applicable, pharmaceutical, food, and beverage P&IDs shall incorporate additional hygienic-processing requirements.

PIP's current P&ID documentation practice explicitly includes supplementary hygienic-processing guidance for pharmaceutical, food, and beverage applications. ([PIP][2])

The DSL should therefore support attributes for:

* hygienic service
* cleanability
* CIP
* SIP
* drainability
* dead-leg constraints
* sanitary valve types
* sanitary fittings
* orbital-welded connections
* aseptic boundaries
* sterile barriers
* product-contact/non-product-contact classification

---

# 38. CIP

CIP systems shall explicitly identify:

* CIP supply
* CIP return
* cleaning flow path
* valves
* equipment being cleaned
* drain path
* spray devices
* control relationships

The DSL should permit validation that the intended CIP path is actually connected.

---

# 39. SIP

SIP systems shall explicitly identify:

* steam source
* steam path
* condensate path
* vents
* drains
* sterile boundaries
* control valves
* temperature/pressure instrumentation

---

# 40. Dead Legs

Where hygienic design is applicable, the model should permit explicit dead-leg analysis.

A dead leg shall be identifiable from topology rather than from graphical inspection.

---

# 41. Off-Page Connections

Every off-page connection shall have an explicit identity.

A connection shall include:

* connection ID
* source sheet
* source location
* destination sheet
* destination location
* line/service identity

---

# 42. Continuation Symbols

Continuation symbols shall represent actual topology.

They shall not merely mean:

```text
"this line probably continues elsewhere"
```

A continuation shall resolve to another connection or line segment.

---

# 43. Drawing Boundaries

Lines crossing the drawing boundary shall have explicit continuation semantics.

A line shall not terminate at the sheet border without:

* continuation symbol
* destination reference
* or an approved termination convention.

---

# 44. Tie-ins

Tie-ins shall be explicitly identified.

A tie-in shall include:

* existing/new status
* tie-in identifier
* source system
* destination system
* line information
* applicable construction information

---

# 45. Existing vs New

Where required, the model shall distinguish:

* existing
* new
* demolished
* relocated
* future
* temporary

Graphical representation shall follow project conventions.

---

# 46. Annotation

Annotations shall be semantic objects.

Examples:

* equipment tags
* line numbers
* valve tags
* instrument tags
* notes
* specifications
* references
* operating conditions
* design conditions

---

# 47. Annotation Attachment

An annotation should have an explicit owner.

Examples:

```text
annotation.owner = valve.V101
annotation.owner = line.L1001
annotation.owner = equipment.P101
```

Floating text without an owner should be prohibited unless explicitly defined as a general note.

---

# 48. Annotation Placement

Annotations shall not obscure:

* process lines
* symbols
* connection points
* flow arrows
* instrument signals
* tags

The layout engine should automatically seek clear locations.

---

# 49. Tag Placement

Tags should be placed consistently relative to their object.

The DSL should support preferred anchor locations:

```text
top
bottom
left
right
upper-left
upper-right
lower-left
lower-right
```

The renderer may select an alternate anchor if the preferred location causes a collision.

---

# 50. Leader Lines

A leader shall have:

* source annotation
* target object
* target anchor
* leader geometry

A leader shall not terminate ambiguously in open space.

---

# 51. Notes

General notes shall be distinguishable from object-specific notes.

Object-specific notes should be attached to the relevant object.

---

# 52. Line Numbering

Line numbers shall uniquely identify piping systems according to project conventions.

A line number should be modeled as structured fields rather than an opaque string.

Potential fields:

```text
size
service
sequence
area
specification
insulation
tracing
revision
```

---

# 53. Line Identity

Two graphical segments belonging to the same physical line shall share a common line identity.

A line crossing multiple sheets shall retain its identity unless the engineering system explicitly defines otherwise.

---

# 54. Specification

Piping specification/class shall be a property of the line or line segment.

The DSL shall support validation against allowed component specifications.

For example:

```text
line.spec = CS150
valve.spec = SS150
```

may be flagged if the project specification disallows that combination.

---

# 55. Material Compatibility

Where material information exists, components shall support compatibility validation.

Examples:

* pipe material
* valve material
* gasket
* fitting
* equipment nozzle
* instrument wetted material

---

# 56. Connection Compatibility

Connections shall validate:

* nominal size
* pressure class
* connection type
* material
* service compatibility

For example:

```text
6" 150# RF
```

shall not automatically connect to:

```text
4" 300# SW
```

without an appropriate transition.

---

# 57. Fittings

Fittings shall have explicit ports.

Examples:

* elbow = 2
* tee = 3
* cross = 4
* reducer = 2
* cap = 1
* blind = 1

A fitting's geometry shall not determine its semantic connectivity.

---

# 58. Branch Fittings

A branch shall be represented by a tee, cross, nozzle, or explicit branch connection as appropriate.

A branch shall not be created by simply attaching a line to the middle of another line.

---

# 59. Instrument Taps

Instrument taps shall be explicit connection objects where appropriate.

The model should distinguish:

```text
main process line
    ↓
root valve
    ↓
instrument connection
```

from a generic line crossing.

---

# 60. Primary Elements

Primary measurement elements shall have explicit relationships to their measurement instruments.

Examples:

* orifice plate
* venturi
* flow nozzle
* magnetic flowmeter
* Coriolis meter
* vortex meter
* thermal meter

The relationship between primary element and transmitter shall be semantic.

---

# 61. Process Analyzers

Analyzers shall support:

* sample source
* sample transport
* analyzer
* return/disposal
* associated instruments
* analyzer shelters/panels where applicable

---

# 62. Equipment Packages

Packaged equipment shall be represented as a logical boundary.

The package should contain:

```text
Package
 ├── equipment
 ├── valves
 ├── instruments
 ├── internal piping
 └── interfaces
```

Only required package interfaces need to be exposed on the primary P&ID.

---

# 63. Vendor Package Interfaces

Vendor package interfaces shall explicitly identify:

* package boundary
* incoming connections
* outgoing connections
* utilities
* signals
* ownership/responsibility

---

# 64. Battery Limits

Battery limits shall be explicitly represented.

A battery-limit connection shall identify the system boundary being crossed.

---

# 65. Process Flow

The layout should generally support intuitive flow:

```text
upstream → downstream
```

but process semantics shall not depend upon page orientation.

---

# 66. Layout Rules

The layout engine should optimize for:

1. topology clarity
2. connectivity
3. flow direction
4. equipment relationships
5. control-loop readability
6. annotation readability
7. minimal crossings
8. minimal line length
9. consistent spacing
10. visual hierarchy

---

# 67. Grid

Objects should be placed on a consistent logical grid.

The grid shall support:

* symbol alignment
* line routing
* annotation alignment
* consistent spacing
* orthogonal routing

---

# 68. Orthogonal Routing

Process piping should generally use:

* horizontal
* vertical

segments.

Diagonal process lines should be avoided unless required by the project convention.

---

# 69. Line Bends

Unnecessary bends shall be eliminated.

A line should use the shortest clear path consistent with:

* readability
* equipment grouping
* control-loop clarity
* avoidance of crossings

---

# 70. Equipment Placement

Equipment should generally be positioned to reflect process relationships rather than actual physical plant coordinates.

A P&ID is a schematic, not a plot plan.

---

# 71. Equipment Grouping

Related equipment should be visually grouped.

Examples:

```text
Tank
  ↓
Pump
  ↓
Filter
  ↓
Heat exchanger
```

should generally read as a coherent process system.

---

# 72. Parallel Equipment

Parallel equipment should be aligned.

Examples:

```text
Pump A
Pump B
Pump C
```

should use consistent geometry and spacing.

---

# 73. Redundant Equipment

Redundant equipment shall have explicit relationships where relevant.

Examples:

* duty/standby
* lead/lag
* operating/backup
* N+1

---

# 74. Control Loop Placement

Control loops should be laid out so signal relationships are visually obvious.

Signal lines should avoid crossing unrelated process lines wherever possible.

---

# 75. Signal Routing

Signal routing should prioritize:

1. source/destination clarity
2. minimum crossing
3. consistent direction
4. readable labels

---

# 76. Avoiding Ambiguity

No graphical configuration should allow a reasonable reader to interpret one connection as two different possible connections.

If ambiguity exists, the layout engine shall:

* reroute
* add a junction indicator
* add a continuation marker
* move annotation
* or report a validation error.

---

# 77. Collision Avoidance

Objects shall not overlap unless explicitly permitted.

Collision detection should include:

* symbols
* lines
* text
* tags
* leaders
* arrows
* continuation symbols
* sheet boundaries

---

# 78. Text Collision

Text shall not overlap:

* another text object
* process line
* symbol
* signal line
* dimension
* sheet border

unless the project standard explicitly permits it.

---

# 79. Line Crossing Score

A renderer should calculate a line-crossing metric.

Prefer layouts with fewer:

* process/process crossings
* process/signal crossings
* signal/signal crossings
* annotation crossings

---

# 80. Visual Hierarchy

The drawing should visually distinguish:

1. major process flow
2. equipment
3. valves
4. instrumentation
5. control signals
6. annotations
7. references

Line weights and graphical emphasis should be consistent.

---

# 81. Symbols and Legends

Every non-standard symbol shall be defined in a legend.

Project-specific symbols shall have:

* name
* graphical representation
* semantic definition
* connection definition
* abbreviation
* applicable notes

---

# 82. Standard Symbols

Standard symbols should be used whenever an appropriate standard symbol exists.

Custom symbols should not be created merely because the renderer cannot easily represent an existing standard symbol.

ISA-5.1 exists specifically to establish uniform instrumentation/control symbols and identification. ([isa.org][1])

---

# 83. Symbol Libraries

The DSL should maintain a versioned symbol library.

Example:

```text
symbols/
  valves/
  equipment/
  instruments/
  fittings/
  piping/
  signals/
  safety/
  hygienic/
```

Each symbol should have a stable semantic ID.

---

# 84. Tag Uniqueness

Within a defined project scope:

* equipment tags shall be unique
* valve tags shall be unique where tagged
* instrument tags shall be unique
* line numbers shall be unique according to project rules
* connection IDs shall be unique

---

# 85. Referential Integrity

Every reference shall resolve.

Invalid:

```text
controls(FV-101)
```

when `FV-101` does not exist.

Invalid:

```text
connect(P-101, N3)
```

when P-101 has no N3.

---

# 86. Orphan Objects

The validator shall identify:

* unconnected equipment
* unconnected ports
* orphan instruments
* orphan signals
* orphan annotations
* orphan continuation references
* unresolved tags

Some orphan objects may be intentionally valid; they shall require explicit declaration.

---

# 87. Required Connections

Objects may define mandatory ports.

Example:

```text
pump:
  required:
    - suction
    - discharge
```

A pump with neither connection shall fail validation.

---

# 88. Optional Connections

Objects may define optional ports.

Example:

```text
vessel:
  optional:
    - vent
    - drain
    - overflow
```

Unused optional ports shall not generate errors.

---

# 89. Port Cardinality

Each port shall define its allowed number of connections.

Examples:

```text
single_port:
  max_connections = 1

junction:
  max_connections = unlimited

instrument_tap:
  max_connections = 1
```

---

# 90. Connection Type Validation

Connections shall validate endpoint types.

For example:

```text
process_port ↔ process_port
signal_port ↔ signal_port
```

shall be valid.

```text
process_port ↔ electrical_signal_port
```

shall be invalid.

---

# 91. Direction Validation

Where direction is defined, the DSL shall validate that the connection follows the component's allowable direction.

This is especially important for:

* check valves
* flowmeters
* ejectors
* pumps
* compressors
* control valves
* filters
* directional fittings

---

# 92. Impossible Topology

The validator shall detect:

* dead-ended process lines
* impossible valve connectivity
* disconnected equipment
* loops where none are intended
* accidental short circuits
* branches without branch fittings
* instruments connected directly into process flow incorrectly
* relief devices with no protected system
* control valves with no control relationship where required

---

# 93. Dead-End Analysis

A process line terminating without an explicit valid endpoint should be reported.

Valid endpoints include:

* equipment nozzle
* valve
* blind
* cap
* vent
* drain
* continuation
* battery limit
* explicit termination

---

# 94. Loop Detection

The validator should identify closed process loops.

Closed loops may be valid or invalid depending on system type.

Examples of intentionally valid loops:

* circulation loops
* cooling-water loops
* recirculation loops
* CIP loops

The DSL should support explicit declarations:

```text
loop allowed
loop required
loop forbidden
```

---

# 95. Flow Path Analysis

The DSL should support graph traversal.

Example query:

```text
find_path(
    source = TK-101,
    destination = HX-201
)
```

The system should be able to determine whether a valid connected process path exists.

---

# 96. Valve Isolation Analysis

The graph should permit queries such as:

```text
Which valves isolate equipment P-101?
```

or:

```text
Can P-101 be isolated from TK-101?
```

This makes the P&ID useful as an engineering data model rather than merely a picture.

---

# 97. Equipment Isolation

The DSL should support identification of isolation boundaries.

An equipment object should be able to identify:

* upstream isolation valve
* downstream isolation valve
* drain
* vent
* relief protection

where applicable.

---

# 98. Instrument Isolation

Instruments should support identification of:

* root valve
* isolation valve
* manifold
* impulse/sample connection
* drain/vent

where applicable.

---

# 99. Revision Control

Every P&ID should support:

* revision
* revision description
* revision date
* author
* checker
* approver
* revision cloud/reference if required

---

# 100. Revision Semantics

A revision shall describe a change to the semantic model.

The system should be capable of identifying:

* added equipment
* deleted equipment
* modified equipment
* added line
* deleted line
* changed valve
* changed instrument
* changed connection
* changed annotation

---

# 101. Drawing Metadata

Each sheet should contain:

* drawing number
* title
* project
* client
* unit/area
* revision
* status
* scale where applicable
* sheet number
* total sheets
* applicable standards
* legend/reference information

---

# 102. Drawing Status

Status should be explicit where applicable:

* preliminary
* design
* issued for review
* issued for construction
* issued for use
* as-built
* superseded

---

# 103. Units

Units shall be explicitly defined at the project level.

The model should not depend upon the reader guessing whether a value is:

* psi
* kPa
* °F
* °C
* gpm
* m³/h
* lb/h
* kg/h

---

# 104. Operating and Design Conditions

Where shown, process conditions should identify:

* operating pressure
* design pressure
* operating temperature
* design temperature
* flow
* density
* viscosity
* phase

These should be data attributes rather than arbitrary text wherever practical.

---

# 105. Data vs Graphics

The DSL should distinguish:

```text
semantic data
```

from:

```text
presentation data
```

For example:

```text
valve:
    type = gate
    tag = XV-101
    normal = open
```

is semantic.

```text
x = 125
y = 300
rotation = 90
```

is presentation.

The semantic model should survive complete re-layout.

---

# 106. Automatic Layout

The renderer should be capable of generating a layout from topology.

The author should ideally be able to specify:

```text
Tank -> Pump -> Filter -> HX -> Vessel
```

without manually specifying every coordinate.

The renderer should then determine:

* symbol positions
* routing
* labels
* annotation locations
* sheet breaks

---

# 107. Layout Constraints

The DSL should support explicit layout constraints.

Examples:

```text
place TK-101 left-of P-101
place P-101 below TK-101
align P-101 with P-102
keep HX-101 right-of P-101
group P-101 P-102
```

These should constrain layout without becoming the underlying topology.

---

# 108. Relative Placement

Relative placement should be preferred over absolute coordinates.

Preferred:

```text
P-101 right-of TK-101
```

over:

```text
P-101 x=431.2 y=812.4
```

Absolute coordinates should be a renderer output or optional override.

---

# 109. Layout Zones

The DSL may support semantic zones:

```text
process_area
utility_area
control_area
equipment_group
package_boundary
```

This allows large diagrams to be automatically organized.

---

# 110. Sheet Partitioning

Large diagrams should be partitionable by:

* process area
* equipment group
* line system
* unit
* logical subsystem

The partitioning algorithm must preserve topology through continuation references.

---

# 111. Sheet Overflow

A renderer shall never silently clip objects.

If the generated drawing exceeds the usable sheet area, it shall:

1. re-layout,
2. split the drawing,
3. change scale where allowed,
4. or report an error.

---

# 112. Annotation Scaling

Text must remain readable at the final output scale.

A technically complete P&ID that cannot be read is invalid.

---

# 113. Drawing Density

The renderer should monitor drawing density.

High-density areas should trigger:

* automatic expansion
* alternate routing
* sheet splitting
* annotation relocation
* or warning generation.

---

# 114. Graphical Validation

The final rendered P&ID should be checked for:

* symbol collisions
* text collisions
* line crossings
* disconnected endpoints
* ambiguous junctions
* unreadable text
* clipped objects
* overlapping leaders
* off-sheet geometry
* unresolved references

---

# 115. Semantic Validation

The semantic model should be checked independently of rendering.

Semantic checks include:

* invalid port connections
* duplicate tags
* missing tags
* invalid line specifications
* impossible topology
* invalid signal relationships
* missing equipment connections
* invalid valve configurations
* unresolved references
* illegal component combinations

---

# 116. Drafting Validation Severity

Validation errors should have severity levels.

Recommended:

```text
FATAL
ERROR
WARNING
INFO
```

Examples:

```text
FATAL:
Valve has 3 process connections but supports only 2.

ERROR:
Line terminates without valid endpoint.

WARNING:
Control valve has no fail position.

INFO:
Flow direction not specified.
```

---

# 117. P&ID Linting

The DSL should have a linter analogous to a programming-language linter.

Example:

```text
PID001  ERROR   Line L-1001 terminates in free space.
PID002  ERROR   Valve XV-101 has invalid third process connection.
PID003  WARNING Pump P-101 has no discharge check valve.
PID004  WARNING Instrument PT-101 has no process connection.
PID005  INFO    Flow direction not specified for L-1002.
```

---

# 118. Automatic Repair

Where safe, the system may automatically repair purely graphical errors.

Examples:

* move text
* reroute line
* remove unnecessary bend
* align symbols
* move annotations
* resolve minor collisions

Semantic errors should generally not be automatically repaired without explicit rules.

---

# 119. Rule Precedence

When rules conflict, use the following precedence:

1. Applicable law/regulation
2. Project specifications
3. Client standards
4. Industry standards
5. Company drafting standards
6. P&ID DSL rules
7. Default renderer behavior

---

# 120. Standard Conformance

The DSL shall not claim that a generated P&ID is "ISA compliant" or "PIP compliant" merely because standard symbols are used.

Conformance depends upon the applicable edition, project requirements, symbol usage, identification, content, and application.

ISA explicitly provides separate guidance for instrumentation identification, graphic symbols, and PFD/P&ID content. ([isa.org][3])

PIP similarly describes its P&ID practice as establishing requirements for both P&ID format and content. ([PIP][2])

---

# 121. DSL Object Model

A useful minimum object model is:

```text
Project
P&ID
Sheet
Area
System
Equipment
Nozzle
Pipe
Line
Valve
Fitting
Instrument
ControlFunction
Signal
SafetyDevice
ReliefDevice
Junction
Connection
Continuation
Annotation
Note
Reference
Package
BatteryLimit
```

---

# 122. Minimum Object Contract

Every drawable object should support:

```text
id
type
tag
position
rotation
layer
style
ports
attributes
annotations
```

Not every property needs to be populated for every object.

---

# 123. Minimum Port Contract

Every port should support:

```text
id
owner
type
direction
position
allowed_connections
max_connections
attributes
```

---

# 124. Minimum Connection Contract

Every connection should support:

```text
id
source
source_port
destination
destination_port
connection_type
direction
attributes
```

---

# 125. Line Contract

A pipe line should support:

```text
id
line_number
service
size
spec
segments
flow_direction
insulation
tracing
connections
```

---

# 126. Instrument Contract

An instrument should support:

```text
id
tag
function
variable
location
process_connection
signal_connections
control_relationships
alarm_functions
attributes
```

---

# 127. Control Function Contract

A control function should support:

```text
id
tag
input
output
setpoint
mode
controlled_variable
final_element
alarms
interlocks
```

---

# 128. Symbol Contract

A symbol should support:

```text
id
semantic_type
geometry
ports
anchors
text_anchors
rotations
mirrors
style
```

---

# 129. Explicit vs Implicit Objects

The DSL should distinguish:

```text
explicit object
```

from:

```text
derived object
```

For example, a rendered pipe segment may be derived from:

```text
Pipe
Connection
Layout
```

rather than manually defined.

This prevents graphical artifacts from becoming authoritative engineering data.

---

# 130. Graph Database Mental Model

The entire P&ID should be treated as a graph:

```text
Nodes:
    equipment
    valves
    instruments
    fittings
    junctions

Edges:
    process connections
    signals
    controls
    references
```

This makes graph queries possible.

---

# 131. Example Graph Queries

The DSL should eventually support queries such as:

```text
find upstream(P-101)
find downstream(P-101)
find isolation(P-101)
find relief_protection(V-101)
find instruments_on(L-1001)
find controls(FV-101)
find connected_equipment(TK-101)
find flow_path(TK-101, HX-201)
find dead_legs(system="CIP")
```

---

# 132. P&ID Connectivity Invariants

The following should be hard validation rules.

### Rule A

Every process connection must terminate on a valid process port.

### Rule B

Every signal connection must terminate on a valid signal port.

### Rule C

Every equipment connection must terminate on a defined nozzle/port.

### Rule D

A port may not exceed its defined connection cardinality.

### Rule E

A line intersection is not a connection unless explicitly declared.

### Rule F

A branch must have explicit topology.

### Rule G

A line cannot silently change size.

### Rule H

A line cannot silently change specification.

### Rule I

A directional component cannot have flow opposite its defined direction.

### Rule J

Every continuation must resolve.

### Rule K

Every referenced object must exist.

### Rule L

Every required port must be satisfied.

### Rule M

Tags must be unique within their defined namespace.

### Rule N

No graphical object may obscure a required connection.

### Rule O

No object may extend outside the drawable sheet boundary.

---

# 133. Higher-Level Engineering Validation

The DSL should eventually support higher-level checks such as:

* equipment without isolation
* vessels without appropriate relief protection
* pumps without suction/discharge connectivity
* control valves without control relationships
* instruments without process connections
* control loops without final elements
* relief devices without destinations
* drains without destinations
* vents without destinations
* lines with incompatible components
* unreachable equipment
* impossible flow paths
* unintended dead legs
* redundant/parallel equipment inconsistencies

These are engineering checks rather than purely drafting checks and should be kept separate from basic graphical validation.

---

# 134. Rule Categories

For implementation, rules should be divided into categories:

```text
SYMBOL
GEOMETRY
CONNECTIVITY
TOPOLOGY
PIPING
EQUIPMENT
VALVE
INSTRUMENT
CONTROL
SAFETY
RELIEF
UTILITY
HYGIENIC
ANNOTATION
TAGGING
LAYOUT
SHEET
REFERENCE
DATA
ENGINEERING
```

---

# 135. Rule IDs

Every machine-enforceable rule should have a stable identifier.

Example:

```text
PID-CON-001
PID-CON-002
PID-PIP-001
PID-VAL-001
PID-INS-001
PID-LAY-001
PID-TAG-001
```

This permits:

* automated validation
* suppression
* rule configuration
* project-specific overrides
* regression testing

---

# 136. Configurable Rules

Rules should be configurable by project.

Example:

```yaml
rules:
  PID-CON-001:
    severity: error

  PID-LAY-004:
    severity: warning

  PID-HYG-001:
    enabled: true
```

---

# 137. Rule Overrides

Overrides shall be explicit and auditable.

Never silently disable a rule.

Example:

```text
override PID-VAL-003
reason = "Vendor package uses proprietary valve representation"
approved_by = "Engineering"
```

---

# 138. Drafting Templates

The DSL should support templates for common systems.

Examples:

```text
pump_station
tank_system
heat_exchanger
control_loop
filter_skid
CIP_system
SIP_system
compressed_air
cooling_water
steam_condensate
```

Templates should instantiate semantic structures, not merely graphical blocks.

---

# 139. Reusable Subsystems

A subsystem should be encapsulatable.

Example:

```text
pump_package("P-100")
```

could generate:

```text
pump
suction isolation
discharge isolation
check valve
pressure indication
drain
vent
motor
control relationships
```

Only rules explicitly enabled by the project should be automatically added.

---

# 140. Generated vs User-Defined Content

Every object should optionally identify its origin:

```text
user
template
library
generated
imported
vendor
```

This allows the system to preserve user intent during regeneration.

---

# 141. Deterministic Generation

Given the same:

* DSL
* symbol library
* ruleset
* renderer version
* configuration

the generated P&ID should be deterministic.

Identical source should produce identical topology and preferably identical layout.

---

# 142. Source of Truth

The DSL source shall be authoritative.

The generated:

* SVG
* DWG
* PDF
* image
* Plant 3D representation

shall be derived artifacts.

Manual modifications to generated graphics should either:

1. be rejected,
2. be imported back into the semantic model,
3. or be explicitly marked as non-authoritative presentation overrides.

---

# 143. Rendering Targets

The semantic model should be capable of rendering to multiple targets:

```text
SVG
HTML
PDF
DWG
AutoCAD
Plant 3D
PNG
interactive web viewer
```

The same semantic P&ID should drive all representations.

---

# 144. Interactive Representation

An interactive viewer should permit selecting an object and displaying:

* tag
* service
* connected objects
* upstream/downstream
* line specification
* instruments
* controls
* alarms
* references
* revision history

---

# 145. Engineering Intelligence

Because the P&ID is represented as a graph, the system should eventually support:

```text
"Show everything connected to TK-101."

"Show every valve required to isolate P-101."

"Show all instruments measuring pressure."

"Find every line entering HX-101."

"Find all control valves controlled by FIC loops."

"Find every open-ended process line."

"Find all unconnected instrument ports."
```

This is one of the primary advantages of a DSL over conventional CAD drafting.

---

# 146. Fundamental Design Rule

The most important rule for the entire system is:

> **Never encode engineering meaning solely in graphics.**

A line's meaning is not its color.

A connection's meaning is not its location.

A valve's identity is not its block name.

An instrument's function is not merely its text.

A branch is not merely three lines touching.

A continuation is not merely a line ending at a border.

All engineering meaning must exist in the semantic model.

---

# 147. Final Validation Gate

A P&ID should not be considered successfully generated until it passes both:

## Semantic validation

```text
✓ topology valid
✓ connections valid
✓ ports valid
✓ tags valid
✓ references valid
✓ required relationships satisfied
✓ engineering rule checks passed
```

## Graphical validation

```text
✓ no unintended overlaps
✓ no ambiguous intersections
✓ no clipped objects
✓ no unresolved annotations
✓ readable text
✓ valid sheet boundaries
✓ clear flow paths
✓ clear control relationships
✓ valid continuation references
```

---

# 148. Recommended DSL Architecture

The strongest architecture is a five-layer system:

```text
                 ┌────────────────────┐
                 │       DSL          │
                 │  Human-readable    │
                 └─────────┬──────────┘
                           ↓
                 ┌────────────────────┐
                 │   Semantic Model   │
                 │ nodes / ports /    │
                 │ edges / attributes │
                 └─────────┬──────────┘
                           ↓
                 ┌────────────────────┐
                 │    Rule Engine     │
                 │ validation/linting │
                 └─────────┬──────────┘
                           ↓
                 ┌────────────────────┐
                 │   Layout Engine    │
                 │ routing/placement  │
                 └─────────┬──────────┘
                           ↓
                 ┌────────────────────┐
                 │     Renderer       │
                 │ SVG/DWG/PDF/etc.   │
                 └────────────────────┘
```

The critical architectural decision is that **layout should operate on the semantic graph, not directly on the DSL text**.

---

# 149. Recommended Validation Pipeline

Generation should follow:

```text
Parse DSL
    ↓
Build semantic graph
    ↓
Resolve references
    ↓
Validate objects
    ↓
Validate ports
    ↓
Validate connections
    ↓
Validate topology
    ↓
Validate engineering rules
    ↓
Generate layout
    ↓
Validate geometry
    ↓
Render
    ↓
Final validation
    ↓
Output
```

---

# 150. Core Philosophy

A conventional P&ID is primarily a drawing.

A P&ID DSL should be:

> **A formal process-system language whose graphical output happens to be a P&ID.**

That distinction is fundamental.

If the DSL is designed correctly, it should be possible to:

* generate a P&ID from text
* regenerate it after modifications
* validate it automatically
* query its topology
* identify engineering errors
* generate alternate layouts
* render it to different formats
* compare revisions semantically
* extract equipment and line data
* generate downstream engineering documents
* integrate it with Plant 3D
* integrate it with databases
* use it as structured RAG/AI knowledge
* programmatically analyze process systems

The graphical P&ID should therefore be treated as the **view** of the engineering model, not the engineering model itself.

---

# 151. Recommended Initial Rule Set for a Production DSL

The first implementation should prioritize these rules before attempting sophisticated automatic drafting:

```text
1. Every object has a unique ID.
2. Every component has explicit ports.
3. Every connection identifies both endpoint ports.
4. Ports enforce connection cardinality.
5. Port types enforce connection compatibility.
6. Line intersections do not imply connections.
7. Branches require explicit topology.
8. Lines cannot terminate ambiguously.
9. Equipment connections require explicit nozzles.
10. Directional components enforce flow direction.
11. Size changes require explicit transitions.
12. Specification changes require explicit transitions.
13. Instrument/process connections are explicit.
14. Signal connections are separate from process connections.
15. Control relationships are explicit.
16. Tags are structured and unique.
17. References resolve.
18. Continuations resolve.
19. Semantic validation is independent of graphical layout.
20. Graphical validation occurs after layout.
21. The DSL remains the source of truth.
22. Layout is derived.
23. Rendering is derived.
24. Project-specific rules override defaults explicitly.
25. Every rule has a stable ID and severity.
```

These 25 rules form the **minimum viable structural foundation**. Everything else can be layered on top of them.

---

## Standards Basis

The rules should be implemented as a project-specific engineering ruleset rather than presented as a verbatim reproduction of any external standard.

The principal external references to align against are:

* ANSI/ISA-5.1-2024 — Instrumentation and Control – Symbols and Identification
* ISA-TR5.1.02-2024 — Identification System Guidelines
* ISA-TR5.1.03-2024 — Graphic Symbol Guidelines
* ISA-TR5.1.04-2026 — Content for PFDs and P&IDs
* PIP P&ID Documentation Criteria — current May 2026 technical revision

ISA identifies ISA-TR5.1.04-2026 specifically as guidance for determining the instrumentation and control content of PFDs and P&IDs. ([isa.org][3]) PIP's current practice explicitly addresses P&ID format and content and notes that project-specific overlays can be developed to add requirements or exceptions. ([PIP][2])

The external standards should therefore serve as the **normative reference layer**, while this ruleset becomes the **machine-enforceable DSL implementation layer**.

[1]: https://www.isa.org/standards-and-publications/isa-standards/isa-standards-committees/isa5-1?utm_source=chatgpt.com "ISA5.1, Instrumentation Symbols and Identification- ISA"
[2]: https://pip.org/practices/?utm_source=chatgpt.com "Practices That Align with Engineering Standards | PIP"
[3]: https://www.isa.org/standards-and-publications/isa-standards/isa-5-standard?utm_source=chatgpt.com "ISA-5 Series of Standards"
