# North American P&ID Structural Drafting Rules Guide

## 1. Purpose and Scope

This guide defines a **rules-based structural methodology for drafting Piping & Instrumentation Diagrams (P&IDs)** used in North American process facilities.

The emphasis is on the **structure and topology of the drawing**:

* where components are placed;
* how components relate to one another;
* how process connections are established;
* how many connections a component may accept;
* how branches are represented;
* how instruments connect to process lines;
* how control loops are represented;
* how annotations are positioned;
* how off-page connections are handled;
* how equipment, valves, instruments, fittings, and piping interact;
* how to prevent structurally invalid P&IDs;
* how a P&ID can be represented as a machine-readable graph.

This is intentionally more rigorous than a conventional "how to draw a P&ID" guide. The objective is to establish **drafting rules that can be validated automatically**.

The guide assumes a conventional North American process-industry P&ID environment using ANSI/ISA conventions for instrumentation and commonly accepted North American process-engineering drafting practices.

### 1.1 Standards basis

The primary instrumentation reference is **ANSI/ISA-5.1-2024, Instrumentation and Control – Symbols and Identification**, which establishes standardized identification and graphic representation of instrumentation and control functions. ISA also identifies **ISA-TR5.1.03-2024** as guidance for applying the graphic symbols and **ISA-TR5.1.04-2026** as guidance specifically concerning PFD/P&ID content. ([isa.org][1])

PIP maintains a dedicated **Piping and Instrumentation Diagram Documentation Criteria** practice covering P&ID format and content, including new P&IDs and packaged-equipment-vendor P&IDs. PIP states that the practice is CAD-system independent. ([PIP][2])

General engineering drawing line and lettering practices are addressed by ASME Y14.2. ([ASME][3])

This guide therefore uses the following hierarchy:

1. **Applicable project/company standards**
2. **Contract/client drafting standards**
3. **Applicable adopted codes and standards**
4. **ANSI/ISA instrumentation conventions**
5. **PIP P&ID documentation practices**
6. **This structural rule set**
7. **Individual drafter preference**

Where a project standard intentionally differs from this guide, the project standard controls.

---

# 2. Fundamental P&ID Model

A P&ID should be treated as a **connected engineering graph**, not merely as a collection of graphical symbols.

Every P&ID consists fundamentally of:

* **nodes** — equipment, valves, instruments, fittings, junctions, connections, etc.;
* **ports** — defined connection points on nodes;
* **edges** — process piping, signal lines, utility connections, or other defined relationships;
* **attributes** — tags, sizes, specifications, descriptions, control information, etc.;
* **annotations** — textual information associated with nodes, edges, or regions;
* **boundaries** — equipment, battery limits, drawing boundaries, package boundaries, etc.

A valid P&ID must therefore satisfy both:

> **Graph validity:** every connection is structurally legitimate.

and

> **Graphic validity:** the graph is presented in an unambiguous and readable manner.

A drawing can be visually attractive and still be structurally invalid.

---

# 3. Core Structural Principle: Every Connection Has a Port

## Rule 3.1 — Connections shall terminate at defined connection points

Every physical or logical connection to a component shall terminate at an explicitly defined connection point, connection port, or connection interface.

A line shall **not merely touch the graphic representation of a component**.

For example:

```text
----[ GATE VALVE ]----
```

is structurally valid only if the line endpoints coincide with the valve's two defined process ports.

The following is invalid:

```text
--------+
        |
    [ GATE VALVE ]
```

if the vertical line merely intersects the valve body without terminating on an actual connection port.

---

# 4. Component Port Model

Every component should have an explicitly defined number and type of ports.

Examples:

| Component                  |         Typical Process Ports |
| -------------------------- | ----------------------------: |
| Gate valve                 |                             2 |
| Globe valve                |                             2 |
| Ball valve                 |                             2 |
| Butterfly valve            |                             2 |
| Check valve                |                             2 |
| Control valve              |                             2 |
| Pipe segment               |                             2 |
| Elbow                      |                             2 |
| Tee                        |                             3 |
| Reducer                    |                             2 |
| Concentric reducer         |                             2 |
| Eccentric reducer          |                             2 |
| Cross                      |                             4 |
| Strainer                   |                             2 |
| Filter                     |                             2 |
| Heat exchanger             |                            ≥4 |
| Vessel nozzle              |                  1 per nozzle |
| Pump suction nozzle        |                             1 |
| Pump discharge nozzle      |                             1 |
| Instrument connection      | normally 1 process connection |
| Analyzer sample connection | normally 1 process connection |
| Rupture disk               |                             2 |
| Spectacle blind            |                             2 |
| Orifice fitting            |                             2 |

The exact port structure shall be defined by the project symbol library.

## Rule 4.1 — Port count is authoritative

The graphical appearance of a symbol shall not determine connectivity.

The **symbol definition** determines:

* number of ports;
* port location;
* port direction;
* port type;
* allowable connection types;
* connection cardinality.

---

# 5. Connection Cardinality

This is one of the most important structural rules.

## Rule 5.1 — A port has a defined connection capacity

Each component port shall define how many connections it may accept.

For the majority of inline components:

> **One port = one physical connection.**

For example, a gate valve has two ports:

```text
PORT A ──[ GATE VALVE ]── PORT B
```

Therefore:

* Port A accepts one connection.
* Port B accepts one connection.
* The valve does not accept a third process connection.

### Invalid

```text
             |
             |
-------------+----[ GATE VALVE ]----
```

if the branch line is connected directly to the valve port.

The branch must instead occur on the piping **before or after the valve**:

```text
             |
             |
-------------+-----------[ GATE VALVE ]----
```

or:

```text
-------------[ GATE VALVE ]----+------------
                               |
                               |
```

### Structural interpretation

A tee is the component that creates additional connectivity.

A valve is **not** a connectivity junction.

---

# 6. Junctions and Branches

## Rule 6.1 — Branching shall occur through a valid pipe junction

A branch from a process line shall be represented by:

* a tee;
* a cross;
* a branch connection;
* a nozzle;
* an explicitly defined piping junction;
* or another project-approved branching representation.

The branch shall not be created simply by drawing intersecting lines unless the drafting convention explicitly defines that intersection as a connected junction.

---

## Rule 6.2 — Line crossing does not inherently mean connection

Two lines crossing each other shall not automatically be interpreted as connected.

A crossing shall be classified as one of:

1. connected;
2. not connected;
3. bridged/crossing;
4. intentionally separated by drafting convention.

The project symbol system should make this distinction unambiguous.

---

# 7. Tee Rules

A tee is fundamentally a **three-port component**.

```text
             Port 3
                |
                |
Port 1 --------+-------- Port 2
```

## Rule 7.1

Each tee port may accept exactly one connection unless the project data model explicitly supports a different connection mechanism.

Thus:

```text
Pipe ─── Tee ─── Pipe
           |
           |
          Pipe
```

is valid.

But:

```text
Pipe ─── Tee ─── Pipe
           |
          / \
       Pipe Pipe
```

is not valid if both branches are attached to the same tee port.

A second branch requires another tee or another explicitly modeled junction.

---

# 8. Pipe Rules

A pipe run is an edge connecting two ports or connection nodes.

A pipe segment normally has:

* one upstream endpoint;
* one downstream endpoint.

A pipe segment should not independently have three or more physical endpoints.

If three lines meet, the topology should contain a junction.

---

# 9. Pipe Segmentation

A pipe should be segmented whenever a meaningful engineering event occurs.

Typical segmentation points include:

* valve;
* fitting;
* reducer;
* branch;
* instrument tap;
* specification change;
* size change;
* line-number change;
* insulation change where represented;
* tracing change;
* service change;
* off-page connection;
* equipment nozzle;
* battery limit;
* tie-in point.

For example:

```text
Equipment
   |
   |
Pipe
   |
Valve
   |
Pipe
   |
Reducer
   |
Pipe
   |
Tee
```

should not be represented as one uninterrupted pipe object if the underlying data model needs to distinguish those components.

---

# 10. Inline Component Placement

## Rule 10.1 — Inline components shall interrupt the process line

An inline component shall be inserted **into** the process topology.

Correct:

```text
──────[ VALVE ]──────
```

Incorrect:

```text
───────────────
       [VALVE]
───────────────
```

where the valve is visually associated with the line but is not actually part of the connection graph.

---

# 11. Valve Placement

Valves shall generally be placed directly on the line they control, isolate, regulate, or otherwise affect.

The valve's two process ports should lie on the process-flow path.

### Basic topology

```text
───────P1 [VALVE] P2───────
```

The valve therefore divides one continuous line into two pipe segments.

### Never:

```text
───────P1────────P2───────
          [VALVE]
```

unless the graphical convention explicitly represents a non-inline association.

---

# 12. Valve Orientation

The valve symbol shall be oriented consistently with the line.

For horizontal process piping:

```text
────────◁▷────────
```

or the project-approved equivalent.

For vertical piping, the valve symbol shall rotate with the pipe orientation where appropriate.

The valve's functional orientation shall not be confused with the physical direction of the piping.

For directional valves such as:

* check valves;
* control valves with directional flow requirements;
* specialty valves;

the symbol shall communicate the intended flow direction where required.

---

# 13. Valve Actuators

Actuators are attributes/components associated with valves.

Examples include:

* handwheel;
* pneumatic actuator;
* electric actuator;
* hydraulic actuator;
* solenoid actuator;
* motor operator.

The actuator shall not accidentally create a process connection.

### Critical rule

An actuator is **not a process port**.

For example:

```text
             actuator
                |
                |
───────[ VALVE ]───────
```

The vertical line above the valve is not process piping.

It is a graphical/control relationship.

---

# 14. Control Valves

A control valve normally has:

* two process ports;
* an actuator/control representation;
* an instrument/control relationship.

The process topology remains:

```text
──────[ CONTROL VALVE ]──────
```

The control signal is a separate relationship:

```text
        - - - - - - - - - -
        |
     [FT]──────>[FIC]
                    |
                    |
              [CONTROL VALVE]
```

The control signal must never be confused with the process line.

---

# 15. Equipment Connections

Equipment should be modeled using explicit nozzles or connection ports.

For example:

```text
        N1
        |
        |
    +--------+
    |        |
N2--| VESSEL |--N3
    |        |
    +--------+
        |
        N4
```

Each nozzle is an independent connection port.

## Rule 15.1

A vessel body is not itself a connection point.

A process line shall connect to a nozzle or explicitly defined equipment port.

---

# 16. Equipment Nozzle Rules

A nozzle normally accepts one process connection.

Therefore:

```text
Pipe ───── Nozzle ───── Vessel
```

is valid.

But:

```text
Pipe ────+
          \
           Nozzle ─ Vessel
          /
Pipe ────+
```

is invalid unless the nozzle is specifically defined as a multi-connection junction.

Branches belong outside the nozzle.

---

# 17. Pumps

A conventional pump has at minimum:

* suction connection;
* discharge connection.

A simplified topology:

```text
──────[ SUCTION ]──[ PUMP ]──[ DISCHARGE ]──────
```

The pump itself should not be treated as a generic pipe junction.

Additional connections such as:

* minimum-flow recycle;
* seal flush;
* drain;
* vent;
* cooling water;

shall be represented through their appropriate dedicated ports or equipment connections.

---

# 18. Compressors

Compressors follow the same principle.

At minimum:

* suction;
* discharge.

Additional connections may include:

* recycle;
* anti-surge;
* seal gas;
* lube oil;
* drains;
* vents;
* cooling systems.

Each connection should terminate at the appropriate compressor nozzle/port.

---

# 19. Heat Exchangers

Heat exchangers frequently have four or more process ports.

For a two-stream exchanger:

```text
Process A IN  ───┐
                 │
                 │ HEAT
                 │ EXCHANGER
                 │
Process A OUT ───┘

Process B IN  ───┐
                 │
Process B OUT ───┘
```

The four nozzles must remain distinct.

The drawing must not imply that the two process streams are connected to one another.

---

# 20. Vessels

Vertical and horizontal vessels should clearly distinguish:

* inlet nozzles;
* outlet nozzles;
* drains;
* vents;
* overflow;
* instrumentation connections;
* relief connections;
* sample connections;
* utility connections.

The vessel body is an equipment boundary, not a generic junction.

---

# 21. Instrument Connections

Instrumentation requires a distinction between:

1. process connection;
2. instrument signal;
3. electrical connection;
4. pneumatic connection;
5. hydraulic connection;
6. digital/control relationship.

A pressure transmitter might be represented conceptually as:

```text
Process Line
────────────●
            |
           [PT]
```

The process tap is a physical process connection.

The transmitter's signal relationship is separate.

---

# 22. Instrument Tap Rules

Instrument taps should originate from the process line at a defined connection point.

They should not appear to connect directly to:

* a valve body;
* a pipe annotation;
* another instrument;
* an unrelated line;
* a line crossing.

The tap must connect to the process topology.

---

# 23. Instrument Process Ports

A process-connected instrument generally has one process port.

Therefore:

```text
Pipe ─────●
          |
         [PT]
```

is structurally valid.

A second unrelated process line should not terminate on the same PT process port.

---

# 24. Instrument Signal Connections

Signal connections shall be modeled independently from process piping.

Typical signal types include:

* pneumatic;
* electrical;
* digital;
* software/data;
* hydraulic;
* capillary.

The graphical convention shall clearly distinguish these from process piping.

---

# 25. Instrument-to-Instrument Relationships

An instrument relationship is not necessarily a physical connection.

For example:

```text
[FT] - - - - > [FIC]
                 |
                 |
              [FV]
```

represents functional/control relationships.

It does **not** imply that the transmitter is physically piped to the controller.

---

# 26. Control Loop Topology

A control loop should generally communicate:

1. measured process variable;
2. measurement device;
3. signal path;
4. controller/function;
5. output signal;
6. final control element;
7. controlled process.

Example:

```text
PROCESS
   │
  [FT]
   │
   └ - - - - - - > [FIC]
                       │
                       └ - - - - - - > [FV]
                                         │
                                         ▼
                                      PROCESS
```

The loop should be understandable without requiring the reader to infer relationships from proximity alone.

---

# 27. Control Valve Placement

A control valve should generally be located directly on the process line being manipulated.

The associated controller and measurement device may be located nearby, but **the control valve should not be moved merely to make the control-loop annotation convenient**.

Process topology takes precedence over graphical convenience.

---

# 28. Relief Devices

Pressure relief devices require special treatment because they are both process components and safety-related devices.

Typical topology:

```text
Vessel
  |
  |
[PSV]
  |
  +──────────── Relief System
```

The relief path should clearly identify:

* source;
* relief device;
* discharge destination.

The PSV's inlet and outlet are separate ports.

---

# 29. Vents and Drains

Vents and drains shall be represented as actual process connections.

A drain should generally branch from the piping at a valid connection point:

```text
───────────────+────────────
               |
             [Valve]
               |
              Drain
```

It should not be represented as a line merely touching the main pipe.

The same principle applies to vents.

---

# 30. Branching Around Valves

A bypass around a valve is a separate process path.

Example:

```text
──────────[ MAIN VALVE ]──────────
     |                         |
     +──────[ BYPASS VALVE ]──+
```

The bypass should connect to the main line at two valid junction points.

The bypass does **not** connect to the valve's ports unless the valve itself is specifically designed with those connections.

---

# 31. Parallel Equipment

Parallel pumps, filters, exchangers, etc. should be represented using actual branch topology.

Example:

```text
             +──[ PUMP A ]──+
             |              |
SUCTION ─────+              +──── DISCHARGE
             |              |
             +──[ PUMP B ]──+
```

The branch points are junctions.

Each pump has independent suction and discharge connections.

---

# 32. Series Equipment

Series equipment shall form a sequential graph.

```text
Equipment A
     |
   Valve
     |
Equipment B
     |
   Filter
     |
Equipment C
```

The physical sequence should be visually apparent.

---

# 33. Flow Direction

Where flow direction is required for interpretation, it should be indicated consistently.

Flow direction may be communicated through:

* arrows;
* directional valve symbols;
* line conventions;
* equipment orientation;
* drawing flow progression.

Flow arrows shall lie on the process line rather than floating adjacent to it.

---

# 34. Piping Line Numbers

A piping line number identifies a defined piping segment/system according to project conventions.

The line-number annotation should be associated with the relevant line.

It should not be placed so far from the line that the association becomes ambiguous.

Where a line changes a defining attribute such as:

* size;
* specification;
* service;
* insulation;
* tracing;
* material class;

the line may require segmentation and/or a new line number according to project rules.

---

# 35. Line Tags Are Annotations, Not Components

A line-number text object must not be interpreted as a process connection.

This is particularly important in automated P&ID systems.

For example:

```text
───────────────
   4"-P-101
───────────────
```

contains:

* one pipe topology;
* one annotation.

The text does not create another node or port.

---

# 36. Annotation Placement Principles

Annotations should satisfy four requirements:

1. **Association**
2. **Readability**
3. **Non-interference**
4. **Consistency**

An annotation must be visually associated with exactly what it describes.

---

# 37. Equipment Tags

Equipment tags should generally be positioned:

* adjacent to the equipment;
* outside the equipment graphic;
* with a clear visual association;
* without obscuring nozzles;
* without crossing process lines.

Example:

```text
          V-101
           |
      +---------+
      |         |
      | VESSEL  |
      |         |
      +---------+
```

---

# 38. Valve Tags

Valve tags should be located close enough to the valve to establish association but should not overlap:

* the valve symbol;
* actuator;
* process line;
* nearby instrument bubbles;
* other valve tags.

A valve tag should not be positioned such that it appears to belong to the adjacent valve.

---

# 39. Instrument Tags

Instrument bubbles and tags should generally be positioned with enough clearance to prevent ambiguity.

Avoid:

```text
[PT101][PT102][TT101]
```

when proximity makes ownership unclear.

Prefer controlled spacing and consistent leader/connection placement.

---

# 40. Leader Lines

A leader should connect an annotation to the object it describes.

The leader should:

* terminate at the correct object;
* not accidentally cross another object;
* not terminate in empty space;
* not terminate on another annotation;
* not look like a process line.

---

# 41. Annotation Attachment Rules

A text annotation may attach to:

* a component;
* a line;
* a region;
* a nozzle;
* a valve;
* an instrument;
* an off-page connection;
* a general drawing area.

The attachment target should be explicit in the underlying data model.

---

# 42. Annotation Collision Rules

Annotations should not:

* overlap symbols;
* obscure process lines;
* obscure connection points;
* obscure valve actuators;
* obscure instrument bubbles;
* obscure arrows;
* overlap other annotations;
* cross through equipment graphics unless specifically intended.

---

# 43. Text Orientation

Text should normally be readable from the bottom or right-hand side of the drawing according to the project drafting convention.

Rotated text should be used sparingly.

Vertical text should not be used merely because it saves space if it substantially reduces readability.

---

# 44. Equipment-to-Equipment Spacing

Components should be separated sufficiently to permit:

* line identification;
* valve identification;
* instrument placement;
* branch placement;
* signal lines;
* annotations;
* flow arrows.

A drawing should not be packed so tightly that the topology becomes ambiguous.

---

# 45. Component Relationship Rules

Every component should have an identifiable relationship with its neighbors.

Examples:

```text
Pump → Valve → Check Valve → Header
```

or:

```text
Vessel → PSV → Relief Header
```

or:

```text
Tank → Pump → Control Valve → Process
```

Relationships should be represented by actual graph connections wherever they represent physical process relationships.

---

# 46. Proximity Is Not Connectivity

This is a critical machine-validation rule.

Two objects being adjacent does not mean they are connected.

Likewise:

```text
[VALVE]
   |
   |     [PT]
   |
──────────────
```

does not automatically connect the PT to the valve.

The connection must terminate on a valid port.

---

# 47. Intersection Rules

Every line intersection should be classified.

### Connected intersection

```text
───────●───────
       |
       |
```

### Non-connected crossing

```text
───────┐
       │
       │
       └──────
```

or another project-approved convention.

The critical point is that the drawing must distinguish the two cases.

---

# 48. No Invisible Connections

A process connection should never rely solely on:

* coincident coordinates;
* touching geometry;
* overlapping lines;
* visual proximity;
* object insertion points;
* text placement.

The underlying topology should explicitly record:

```text
Node A
Port A
    ↓
Connection
    ↓
Node B
Port B
```

---

# 49. Connection Validation

An automated P&ID checker should validate at least:

### Port existence

Every connection references an existing port.

### Port ownership

Every port belongs to exactly one component.

### Port cardinality

A port has not exceeded its allowed number of connections.

### Port compatibility

The connected objects are compatible.

### Connection geometry

The graphical connection terminates at the defined port location.

### Line continuity

A process line has valid endpoints.

### Junction validity

A multi-branch location is represented by an allowed junction.

### No dangling connections

A line cannot terminate arbitrarily in space unless it is an intentional:

* drain;
* vent;
* continuation;
* off-page connection;
* future connection;
* battery-limit connection;
* other explicitly defined endpoint.

---

# 50. Dangling Line Rules

Every line endpoint must be classified as one of:

1. component port;
2. junction;
3. off-page connector;
4. battery limit;
5. continuation;
6. intentional open end;
7. drain;
8. vent;
9. sample point;
10. other approved termination.

An unexplained dangling line is an error.

---

# 51. Off-Page Connections

An off-page connection represents continuation of a process or signal relationship beyond the drawing boundary.

The connection should contain enough information to identify the continuation, typically including:

* line number;
* continuation identifier;
* destination drawing;
* continuation reference;
* service or system information where required.

The connector itself is a **connection object**, not ordinary pipe.

---

# 52. Battery Limits

Battery-limit connections should clearly identify where the depicted facility/system terminates and another facility/system begins.

A battery limit should not be confused with:

* an ordinary drawing boundary;
* an off-page continuation;
* a process equipment boundary.

---

# 53. Drawing Boundaries

The drawing border is not a process boundary.

A pipe crossing the drawing boundary must be explicitly represented as a continuation or off-page connection.

It should never simply disappear at the edge of the sheet.

---

# 54. Utility Connections

Utilities should be connected to equipment and process systems using explicit connections.

Examples:

* steam;
* condensate;
* cooling water;
* chilled water;
* instrument air;
* plant air;
* nitrogen;
* fuel gas;
* hydraulic fluid.

The utility connection should identify its source/system according to project conventions.

---

# 55. Utility Line Topology

A utility branch follows the same fundamental topology rules as process piping.

For example:

```text
Utility Header
───────────────+────────────
               |
             Valve
               |
            Equipment
```

The branch occurs at a valid junction.

It does not connect directly to the side of an arbitrary valve.

---

# 56. Instrument Air

Instrument-air connections should be distinguished from:

* process air;
* plant air;
* pneumatic signal lines.

The drawing should not rely solely on physical proximity to establish that distinction.

---

# 57. Nitrogen Connections

Nitrogen branches should follow normal piping topology.

For example:

```text
N2 HEADER
───────────────+────────────
               |
             [VALVE]
               |
             Equipment
```

The branch is connected to the header through a junction and to the equipment through its defined connection.

---

# 58. Sampling Connections

A sample point should be modeled as a branch from the process line.

Typical structure:

```text
PROCESS
───────────────+────────────
               |
             Valve
               |
          Sample Point
```

The sample valve should not appear to connect directly into the process line without a valid branch/tap.

---

# 59. Drains

A drain normally represents a branch away from the process line.

The drain path should identify the termination, such as:

* closed drain;
* open drain;
* sewer;
* collection vessel;
* sump;
* designated drain header.

---

# 60. Vents

Vent lines should similarly identify their destination:

* atmosphere;
* vent header;
* flare;
* recovery system;
* scrubber;
* other designated destination.

---

# 61. Fittings

Fittings are structural components, not decorative symbols.

Examples:

* elbows;
* tees;
* reducers;
* crosses;
* caps;
* branch fittings.

Every fitting should have defined ports.

### Elbow

Two ports:

```text
P1 ──┐
     │
     └── P2
```

### Reducer

Two ports:

```text
Large ──[ REDUCER ]── Small
```

### Tee

Three ports.

### Cross

Four ports.

---

# 62. Reducer Rules

A reducer changes line size.

The two reducer ports shall carry their respective sizes.

A reducer should therefore cause an explicit topology transition:

```text
6" PIPE
   |
[REDUCER]
   |
4" PIPE
```

The size change should not be represented only as text.

---

# 63. Spectacle Blinds and Blinds

Blinds are inserted into the process topology where appropriate.

A spectacle blind should not create additional flow paths.

It is still part of a two-port piping relationship.

---

# 64. Strainers and Filters

A strainer/filter is generally a two-port inline component.

```text
────[ STRAINER ]────
```

It should therefore divide the pipe into upstream and downstream segments.

Drain/vent connections are separate auxiliary ports if depicted.

---

# 65. Check Valves

A check valve has two primary process ports.

The directional symbol communicates permitted flow direction.

The valve should not be treated as a branch.

---

# 66. Multiple Connections at a Component

A component may have multiple process ports when its engineering function requires them.

Examples:

* vessels;
* exchangers;
* pumps;
* compressors;
* filters with drains;
* control systems;
* analyzers;
* packaged equipment.

The rule is:

> **Multiple connections require multiple explicitly defined ports.**

Never create extra connections by attaching lines to arbitrary points on a symbol.

---

# 67. Port Type Compatibility

Ports should carry a type.

Examples:

```text
PROCESS
UTILITY
INSTRUMENT_PROCESS
SIGNAL
ELECTRICAL
PNEUMATIC
HYDRAULIC
DRAIN
VENT
RELIEF
SAMPLE
OFF_PAGE
```

A process pipe should not connect to a signal port.

A pneumatic signal should not connect to a process nozzle.

A drain should not accidentally connect to an instrument signal.

---

# 68. Connection Directionality

Some connections are directional.

Examples:

* process flow;
* check valves;
* relief discharge;
* control signals;
* analyzer sample flow.

A connection may therefore have:

```text
source → destination
```

rather than merely:

```text
A ↔ B
```

The underlying model should preserve direction where engineering meaning depends on it.

---

# 69. Component Orientation

Each component should have a defined orientation.

Possible orientations include:

```text
0°
90°
180°
270°
```

and, where supported, arbitrary rotation.

Rotation must transform the component's ports along with the symbol.

A valve rotated 90° must have its ports rotated 90°.

---

# 70. Port Coordinates

For CAD/database implementation, every component should define port locations in local coordinates.

Example:

```text
GateValve
  width = 20
  height = 10

  Port 1 = (-10, 0)
  Port 2 = (+10, 0)
```

After rotation and translation:

```text
WorldPort = Transform(LocalPort, ComponentTransform)
```

This makes graphical connectivity deterministic.

---

# 71. Symbol Insertion Rules

Symbols should be inserted such that their process ports snap directly to the intended line or connection point.

Do not depend on approximate visual alignment.

---

# 72. Snap Rules

A drafting system should use explicit snapping rules for:

* pipe endpoints;
* equipment nozzles;
* valve ports;
* fitting ports;
* instrument taps;
* junctions;
* off-page connectors.

A connection should be accepted only when the endpoint lies within an allowed connection tolerance or is explicitly attached.

---

# 73. Connection Tolerance

A CAD implementation should define a project-wide connection tolerance.

However:

> **Tolerance shall validate intended connectivity; it shall not manufacture connectivity.**

Two objects that happen to be within tolerance should not automatically become connected if their semantic types are incompatible.

---

# 74. Layering

Layers should separate major graphic classes where the CAD platform supports it.

Typical classes include:

* process piping;
* equipment;
* valves;
* instruments;
* instrument signals;
* utility piping;
* annotations;
* line numbers;
* off-page connectors;
* construction/reference graphics.

The exact layer standard is project-specific.

---

# 75. Lineweight

Lineweight should communicate graphic hierarchy.

Process lines should remain visually dominant over:

* annotation leaders;
* instrument signals;
* construction/reference geometry.

The drawing should remain legible after printing/reduction.

---

# 76. Process Line Priority

When graphic objects overlap, the process topology must remain visually understandable.

Avoid allowing:

* annotation leaders;
* text;
* signal lines;
* dimensions;
* revision clouds;

to obscure process connections.

---

# 77. Instrument Signal Line Priority

Signal lines should be visually subordinate to process piping but sufficiently distinct that they cannot be mistaken for process lines.

---

# 78. Text-to-Line Separation

Text should not sit directly on top of process lines unless the project convention specifically permits it.

Prefer:

```text
        4"-P-101
───────────────
```

rather than text overlapping the line.

---

# 79. Tag Uniqueness

Every tagged component should have a unique identifier within its defined scope.

Examples:

```text
P-101
P-102
V-101
FV-101
PT-101
```

The identifier should not be duplicated accidentally.

---

# 80. Tag Association

A tag must belong to exactly one logical object unless the project standard explicitly defines shared tags.

The visual location of the tag is not sufficient to establish ownership.

The data model should explicitly associate:

```text
Annotation → Component ID
```

---

# 81. Equipment and Instrument Relationship

A local instrument associated with equipment should be visually and structurally associated with that equipment.

For example:

```text
        [LT-101]
           |
           |
      +---------+
      | TK-101  |
      +---------+
```

The instrument's process connection and its equipment association are distinct relationships.

---

# 82. Annotation Association vs Physical Connection

This distinction is critical.

An annotation may be associated with an object without being physically connected to it.

For example:

```text
       "NORMALLY CLOSED"
              |
              | annotation leader
              |
          [ VALVE ]
```

The leader is not a process connection.

A P&ID data model should therefore distinguish:

```text
physical_connection
```

from:

```text
annotation_association
```

---

# 83. Equipment Internal Details

Only information necessary to communicate process function should normally appear on the P&ID.

Do not overload equipment symbols with:

* fabrication details;
* dimensions;
* structural steel;
* weld details;
* exact internals;
* unnecessary mechanical geometry.

Unless specifically required, the P&ID is not a fabrication drawing.

---

# 84. Process-Relevant Internals

Internal equipment details may be shown when they affect process understanding.

Examples:

* vessel trays;
* demister;
* distributor;
* agitator;
* coils;
* internal heating/cooling;
* filter elements.

The depiction should remain schematic.

---

# 85. Equipment Boundary Rule

Equipment graphics should establish a clear boundary between:

* equipment;
* connected piping;
* external instruments.

Nozzle lines should terminate clearly on the equipment nozzle.

---

# 86. Nozzle Orientation

Nozzles should be placed at locations that communicate their approximate physical relationship to the equipment.

The P&ID is not normally dimensionally exact, but nozzle relationships should not be misleading.

---

# 87. P&ID Is Functional, Not Scale Drawing

Do not interpret graphical distance as physical distance.

The following are generally schematic:

* pipe length;
* equipment spacing;
* valve spacing;
* elevation;
* exact nozzle location.

However, **topological relationships must remain exact**.

This gives the fundamental principle:

> **P&IDs are not geometrically exact, but they must be topologically exact.**

---

# 88. Elevation and Vertical Relationships

Vertical placement may communicate process intent where relevant.

Examples:

* gravity flow;
* vessel elevation;
* pump suction;
* drainability;
* overflow;
* seal arrangement.

However, graphical vertical position must not be assumed to be a physical elevation unless explicitly indicated.

---

# 89. Flow Path Continuity

A reader should be able to trace a process path from source to destination.

For example:

```text
Tank
 ↓
Isolation Valve
 ↓
Pump
 ↓
Check Valve
 ↓
Control Valve
 ↓
Header
```

A path should not unexpectedly terminate without an explicit reason.

---

# 90. Closed Loops

Recirculation systems should clearly show the loop.

Example:

```text
        +----------------------+
        |                      |
        |    [CONTROL VALVE]   |
        |          |           |
        +----------+           |
                   |           |
                [PUMP]---------+
```

The topology must distinguish the recycle path from the main flow path.

---

# 91. Recycle Connections

Recycle branches should originate at explicit junctions.

A recycle connection should not appear to attach directly to an arbitrary location on equipment.

---

# 92. Bypass Relationships

A bypass consists of:

* upstream branch;
* bypass piping;
* bypass isolation/control valve(s);
* downstream branch.

Both branch points are actual connections.

---

# 93. Isolation Philosophy

Isolation valves should be placed where the process design requires isolation.

The P&ID should make the isolation boundary apparent.

Do not relocate an isolation valve merely to improve drawing aesthetics if doing so changes its process relationship.

---

# 94. Double-Block-and-Bleed

Where applicable, a double-block-and-bleed arrangement should be represented as distinct components and connections:

```text
────[Valve]────[Valve]────
                  |
                [Bleed]
```

Each valve is a separate two-port component.

The bleed branch requires its own valid branch connection.

---

# 95. Control Stations

Local control stations should be shown as functional relationships to the controlled device rather than as process piping.

---

# 96. Manual Valve Stations

Manual valve assemblies should be represented sequentially according to the actual process topology.

Do not merge several valves into one pseudo-symbol if the individual valves are operationally distinct.

---

# 97. Instrument Isolation

Instrument isolation valves, manifolds, and root valves should be represented as actual components when required by the project's P&ID content requirements.

The instrument process path should remain traceable.

---

# 98. Manifolds

An instrument manifold may have multiple ports and must be treated accordingly.

It should not be modeled as an ordinary two-port valve.

---

# 99. Analyzer Systems

Analyzer systems may contain:

* sample tap;
* isolation valve;
* filter;
* regulator;
* flow control;
* analyzer;
* return;
* drain;
* vent.

Each process connection should have a valid port.

The analyzer signal path is separate from the sample process path.

---

# 100. P&ID Graph Rules

A robust machine-readable representation should define at minimum:

```text
Component
├── id
├── type
├── tag
├── position
├── rotation
├── ports[]
└── attributes[]

Port
├── id
├── owner
├── type
├── position
├── direction
├── cardinality
└── compatibility[]

Connection
├── id
├── source_component
├── source_port
├── destination_component
├── destination_port
├── type
├── direction
└── attributes[]
```

---

# 101. Example: Gate Valve Data Model

A gate valve should be modeled approximately as:

```text
Component:
    type = GATE_VALVE
    tag = HV-101

Ports:
    P1:
        type = PROCESS
        cardinality = 1

    P2:
        type = PROCESS
        cardinality = 1
```

Valid:

```text
Pipe-001 → HV-101.P1
HV-101.P2 → Pipe-002
```

Invalid:

```text
Pipe-001 → HV-101.P1
Pipe-003 → HV-101.P1
```

because:

```text
connections(HV-101.P1) = 2
cardinality(HV-101.P1) = 1
```

Therefore:

```text
2 > 1 = ERROR
```

---

# 102. Example: Tee Data Model

```text
TEE-101

P1 cardinality = 1
P2 cardinality = 1
P3 cardinality = 1
```

Valid:

```text
Pipe A → P1
Pipe B → P2
Pipe C → P3
```

Invalid:

```text
Pipe A → P1
Pipe B → P1
Pipe C → P2
```

because P1 has exceeded its cardinality.

---

# 103. Example: Four-Port Equipment

A heat exchanger:

```text
E-101

P1 = shell inlet
P2 = shell outlet
P3 = tube inlet
P4 = tube outlet
```

The topology must preserve the distinction between the two streams.

An accidental connection:

```text
P2 → P3
```

would represent an internal process crossover and should therefore be structurally prohibited unless explicitly permitted by the equipment definition.

---

# 104. Connection Compatibility

Every port should define what can connect to it.

For example:

```text
PROCESS_PIPE
    compatible with:
        PROCESS_PORT
        PIPE_JUNCTION
        VALVE_PORT
        EQUIPMENT_NOZZLE
        FITTING_PORT
        INSTRUMENT_TAP
```

while:

```text
SIGNAL_PORT
    compatible with:
        SIGNAL_LINE
        CONTROL_FUNCTION
```

This prevents invalid drawings such as a process pipe terminating on an instrument bubble.

---

# 105. Connection Classes

At minimum, distinguish:

### Physical process connection

Actual fluid path.

### Utility connection

Physical utility path.

### Instrument process connection

Physical connection between process and instrument.

### Signal connection

Control/instrument signal relationship.

### Electrical connection

Electrical relationship.

### Pneumatic signal

Pneumatic control signal.

### Logical relationship

Functional relationship without a physical connection.

### Off-page continuation

Continuation of an existing path beyond the drawing.

---

# 106. Structural Validation Rules

A P&ID validator should report at least the following errors.

| Error | Description                                           |
| ----- | ----------------------------------------------------- |
| E001  | Connection does not terminate on a valid port         |
| E002  | Port exceeds connection cardinality                   |
| E003  | Incompatible port types                               |
| E004  | Dangling process line                                 |
| E005  | Unresolved off-page connection                        |
| E006  | Invalid junction                                      |
| E007  | Line crosses without defined crossing state           |
| E008  | Component has missing required port                   |
| E009  | Component has unexpected extra connection             |
| E010  | Duplicate component tag                               |
| E011  | Annotation has no valid target                        |
| E012  | Signal line connected as process piping               |
| E013  | Process line connected to signal port                 |
| E014  | Equipment connection bypasses nozzle                  |
| E015  | Branch occurs on non-junction component               |
| E016  | Valve has more than two process connections           |
| E017  | Instrument has excessive process connections          |
| E018  | Pipe endpoint is unclassified                         |
| E019  | Off-page connection missing destination               |
| E020  | Component orientation inconsistent with port geometry |

---

# 107. Structural Warnings

Not every issue is necessarily an error.

Warnings may include:

* excessive annotation density;
* crossing signal lines;
* unusually long signal relationships;
* excessive line length;
* excessive component density;
* ambiguous annotation proximity;
* missing flow arrows where required;
* inconsistent symbol orientation;
* inconsistent tag placement;
* excessive unused drawing space;
* unusually complicated branch arrangement.

---

# 108. Graph Integrity Rules

A P&ID should be considered structurally valid only when:

```text
Every component has a valid type
AND
Every connection references valid ports
AND
No port exceeds cardinality
AND
All connection types are compatible
AND
All line endpoints are classified
AND
All required equipment connections exist
AND
All branches occur at valid junctions
AND
All off-page connections resolve
```

---

# 109. Graphic Integrity Rules

Separately:

```text
All symbols are readable
AND
All annotations have clear association
AND
No critical connection is obscured
AND
Line crossings are unambiguous
AND
Text does not obscure topology
AND
Symbols use approved conventions
AND
Line hierarchy is visually distinguishable
```

A P&ID should pass **both** structural and graphic validation.

---

# 110. Drafting Order

A reliable drafting sequence is:

1. Establish drawing boundaries.
2. Place major equipment.
3. Establish equipment nozzles.
4. Establish major process flow paths.
5. Insert major piping.
6. Insert valves.
7. Insert fittings.
8. Establish branches.
9. Add utility connections.
10. Add relief systems.
11. Add drains and vents.
12. Add instruments.
13. Add control loops.
14. Add off-page connections.
15. Add line numbers.
16. Add equipment tags.
17. Add instrument tags.
18. Add valve tags.
19. Add other annotations.
20. Run topology validation.
21. Run graphical collision/clarity validation.
22. Perform engineering review.

This order prevents annotations and symbols from dictating the underlying process topology.

---

# 111. Never Draft Topology From Annotations

A common failure mode in automated P&ID generation is allowing text or visual placement to determine connectivity.

The correct order is:

```text
ENGINEERING TOPOLOGY
        ↓
COMPONENT GRAPH
        ↓
PORT CONNECTIONS
        ↓
GEOMETRY
        ↓
ANNOTATIONS
```

Never:

```text
TEXT
 ↓
SYMBOLS
 ↓
LINES
 ↓
guess topology
```

---

# 112. Layout Optimization

Once the topology is established, the drawing can be optimized for readability.

Permitted layout changes include:

* moving annotations;
* adjusting pipe routing;
* adjusting component spacing;
* rearranging instrument bubbles;
* shortening leaders;
* moving control functions;
* optimizing off-page connectors.

The layout algorithm must not change the underlying process graph.

---

# 113. Topology vs Geometry

The following are fundamentally different:

### Geometry

```text
x
y
rotation
length
routing
```

### Topology

```text
component
port
connection
relationship
flow path
```

A component can move 100 drawing units without changing the engineering design.

A single changed port connection can fundamentally change the engineering design.

Therefore:

> **Topology has priority over geometry.**

---

# 114. Automated Layout Rule

A P&ID generator should never determine connectivity from geometry alone.

Instead:

```text
Graph → Layout Engine → Geometry
```

not:

```text
Geometry → Guess Graph
```

This distinction is essential for reliable automated P&ID generation.

---

# 115. Recommended Component Schema

A comprehensive component definition should contain:

```text
Component
    ID
    Type
    Tag
    Description

    Geometry
        Symbol
        Position
        Rotation
        Scale

    Ports
        Port ID
        Port Type
        Local Position
        Direction
        Cardinality
        Compatibility

    Attributes
        Size
        Rating
        Spec
        Material
        Service
        Insulation
        Tracing
        Equipment Class
        Instrument Class

    Relationships
        Connections
        Control Relationships
        Annotation Relationships
```

---

# 116. Recommended Port Schema

```text
Port
    id
    owner_id
    type
    local_x
    local_y
    direction
    cardinality
    connection_classes[]
    required
```

For example:

```text
GateValve.P1
    type = PROCESS
    cardinality = 1
    required = true

GateValve.P2
    type = PROCESS
    cardinality = 1
    required = true
```

---

# 117. Required vs Optional Ports

Some components have mandatory ports.

A two-port valve requires:

```text
P1 = required
P2 = required
```

A vessel drain nozzle might be optional depending on the equipment configuration.

The validator should distinguish:

```text
missing required port connection
```

from:

```text
unused optional port
```

---

# 118. Port Naming

Port names should be semantically meaningful.

Prefer:

```text
SUCTION
DISCHARGE
INLET
OUTLET
SHELL_IN
SHELL_OUT
TUBE_IN
TUBE_OUT
DRAIN
VENT
RELIEF_IN
RELIEF_OUT
```

over:

```text
P1
P2
P3
```

where the application requires semantic interpretation.

Internal IDs may still use P1/P2.

---

# 119. Direction Rules

Port direction may be:

```text
IN
OUT
BIDIRECTIONAL
SIGNAL_IN
SIGNAL_OUT
```

For valves and fittings, process direction may be bidirectional.

For directional equipment or connections, direction should be explicit.

---

# 120. Component Relationship Rules

Relationships should be categorized.

For example:

```text
PROCESS_FLOW
UTILITY_SUPPLY
UTILITY_RETURN
CONTROL_SIGNAL
MEASUREMENT
INTERLOCK
RELIEF
DRAIN
VENT
SAMPLE
OFF_PAGE
```

This avoids treating every line as equivalent.

---

# 121. Annotation Relationship Rules

Annotations should contain an explicit association:

```text
annotation_id
target_id
target_type
anchor_point
offset
orientation
```

Thus a line-number annotation might reference:

```text
PipeSegment-1042
```

while an equipment tag references:

```text
Equipment-V101
```

---

# 122. Avoid Ambiguous Shared Annotations

A single text object should not ambiguously describe multiple components.

If one note applies to several objects, use an explicit group/region association or clearly defined leader system.

---

# 123. Notes

General notes should be placed in designated areas where practical.

They should not be positioned in process flow areas where they can be mistaken for equipment or piping information.

---

# 124. Legend

The drawing should contain or reference a legend when project-specific symbols or conventions are used.

The legend should identify nonstandard conventions.

---

# 125. Custom Symbols

Custom symbols are permitted when required, but each custom symbol should have:

* defined meaning;
* defined ports;
* defined connection behavior;
* defined annotation behavior;
* defined orientation;
* defined identification convention.

A visually plausible symbol without a formal connection model is insufficient for automated drafting.

---

# 126. Symbol Library Requirements

Every symbol library component should ideally contain:

```text
Symbol
    graphical geometry
    component class
    port definitions
    connection rules
    orientation rules
    annotation anchor points
    default attributes
    tag class
```

This is substantially safer than treating SVG/DWG graphics as standalone symbols.

---

# 127. SVG/CAD Symbol Rule

For a digital P&ID system, the graphical symbol should be considered the **view** of a component.

The component itself is the engineering object.

Therefore:

```text
Engineering Object
       ↓
     Symbol
       ↓
     Render
```

rather than:

```text
SVG graphic = engineering object
```

---

# 128. Example: Gate Valve as a Digital Object

```text
ID:
    HV-101

Type:
    GATE_VALVE

Ports:
    upstream
    downstream

Cardinality:
    upstream = 1
    downstream = 1

Graphics:
    gate-valve.svg

Annotations:
    tag
    description
```

This allows the same engineering object to be rendered as:

* SVG;
* AutoCAD block;
* Plant 3D representation;
* web canvas;
* PDF;
* other output.

---

# 129. Structural Golden Rules

The following rules should be treated as the highest-priority rules in an automated P&ID system.

### Rule 1

**Every connection terminates at a defined port.**

### Rule 2

**Every port has a defined connection cardinality.**

### Rule 3

**A component cannot accept connections except through its defined ports.**

### Rule 4

**A two-port component cannot become a three-way junction.**

### Rule 5

**Branches occur at junctions, not arbitrary points on component bodies.**

### Rule 6

**A line crossing is not automatically a connection.**

### Rule 7

**Proximity does not create connectivity.**

### Rule 8

**Annotations are not process connections.**

### Rule 9

**Instrument signals are not process piping.**

### Rule 10

**Equipment connections terminate on defined equipment nozzles/ports.**

### Rule 11

**Every dangling endpoint must have an explicit engineering meaning.**

### Rule 12

**Off-page connections must explicitly identify their continuation.**

### Rule 13

**Topology must be defined before graphical layout.**

### Rule 14

**Moving an object must not silently change its engineering relationships.**

### Rule 15

**A valid P&ID must be both graphically unambiguous and topologically valid.**

---

# 130. Minimal Structural Test

For every component on a P&ID, ask:

> **What are its ports?**

Then:

> **What is connected to each port?**

Then:

> **Is that connection permitted?**

Then:

> **Does the graphical representation accurately depict that connection?**

Then:

> **Can a person trace the resulting process/control relationship without guessing?**

If any answer is "no," the P&ID requires correction.

---

# 131. Recommended Automated Validation Algorithm

A robust validator can operate in the following order:

```text
1. Load component definitions
2. Load P&ID components
3. Load ports
4. Load connections
5. Validate component types
6. Validate port existence
7. Validate port ownership
8. Validate cardinality
9. Validate connection compatibility
10. Validate required ports
11. Validate dangling endpoints
12. Validate junctions
13. Validate off-page connections
14. Validate process/signal separation
15. Validate equipment nozzle connections
16. Validate tag uniqueness
17. Validate annotation associations
18. Validate geometry-to-port alignment
19. Detect graphical collisions
20. Detect ambiguous crossings
21. Generate error/warning report
```

---

# 132. Severity Classification

Errors should be classified.

### CRITICAL

Engineering topology is invalid.

Examples:

* valve port has multiple process connections;
* pipe connected to nonexistent port;
* vessel nozzle connected to wrong component;
* process line connected to signal line.

### ERROR

Drawing or database is structurally invalid but may be locally correctable.

Examples:

* dangling pipe;
* missing required connection;
* duplicate tag;
* unresolved off-page connection.

### WARNING

Potential drafting/engineering issue.

Examples:

* ambiguous annotation;
* crowded area;
* unusually long signal line.

### INFORMATION

Style or optimization suggestion.

---

# 133. Final Structural Philosophy

The most important concept for a rules-based P&ID system is this:

> **A P&ID is a topological engineering model expressed graphically.**

The drawing should therefore be constructed from explicit engineering objects:

```text
EQUIPMENT
    ↓
NOZZLES / PORTS
    ↓
PIPING / CONNECTIONS
    ↓
VALVES / FITTINGS / INSTRUMENTS
    ↓
BRANCHES / JUNCTIONS
    ↓
CONTROL RELATIONSHIPS
    ↓
ANNOTATIONS
    ↓
GRAPHICAL LAYOUT
```

The graphical drawing is ultimately a representation of that model.

A gate valve does not have three connections because three lines happen to touch its symbol. It has **two defined process ports**, and each port has a defined cardinality. A tee creates three connection opportunities because its symbol definition contains **three ports**. A vessel can have ten connections because it has ten defined nozzles. An instrument signal can cross a process line without becoming physically connected because the two objects belong to different connection classes.

That distinction—**graphic geometry versus engineering topology**—should be the foundation of any rules-based P&ID drafting system.

---

# 134. Recommended Rule Hierarchy for Software

For a P&ID authoring/validation application, implement the rules in this order:

```text
LEVEL 0 — Object validity
    Is this a valid component?

LEVEL 1 — Port validity
    Does this component have the correct ports?

LEVEL 2 — Connection validity
    Does every connection terminate on a valid port?

LEVEL 3 — Cardinality validity
    Has any port been connected more times than permitted?

LEVEL 4 — Compatibility validity
    Are the two connection endpoints compatible?

LEVEL 5 — Topology validity
    Does the resulting graph represent a valid process/control system?

LEVEL 6 — Annotation validity
    Are tags and annotations correctly associated?

LEVEL 7 — Graphic validity
    Is the topology represented unambiguously?

LEVEL 8 — Presentation quality
    Is the drawing clean, readable, balanced, and efficient?
```

**Never allow a Level 7 or Level 8 layout optimization to violate Levels 0–6.**

That hierarchy is particularly important if this rule set is later used to drive an automated P&ID editor, SVG symbol library, CAD block library, Plant 3D integration, or LLM-based P&ID generation system.

[1]: https://www.isa.org/standards-and-publications/isa-standards/isa-standards-committees/isa5-1?utm_source=chatgpt.com "ISA5.1, Instrumentation Symbols and Identification- ISA"
[2]: https://pip.org/practices/?utm_source=chatgpt.com "Practices That Align with Engineering Standards | PIP"
[3]: https://www.asme.org/codes-standards/find-codes-standards/line-conventions-and-lettering?utm_source=chatgpt.com "Line Conventions and Lettering - ASME"
