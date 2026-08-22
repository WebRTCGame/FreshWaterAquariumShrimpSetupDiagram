# DEXPI / pyDEXPI Reference Notes

Reference for designing the P&ID DSL semantic model + validation layer.
Source: https://github.com/process-intelligence-research/pyDEXPI (cloned to
`%TEMP%\opencode\pydexpi-ref` for inspection). DEXPI = "Data Exchange in the
Process Industry" — the emerging industry standard for machine-readable P&IDs.
pyDEXPI implements DEXPI v1.3 as Pydantic classes (ESCAPE35 paper, 2025).

**License: AGPL-3.0** — fine for study/reference; do NOT copy code into the
DSL renderer without considering AGPL obligations. Use it as a design
reference and an interop target, not a dependency.

## Why it matters for us

1. **Semantic model separate from drawing.** DEXPI splits `DexpiModel` into
   `ConceptualModel` (plant structure, equipment, instrumentation, piping
   networks, signals) and `Diagram` (graphics groups/primitives). This is
   exactly the DSL → semantic model → renderer architecture in our plan —
   it confirms the separation is the industry-standard shape.
2. **The validation rules we planned already exist as a schema.** Pydantic
   enforces e.g. "a pump cannot be added as a nozzle to a tank." Our
   validation layer is essentially a hand-rolled subset of these rules.
3. **Connectivity model worth copying.** `PipingConnection` has
   `sourceItem/sourceNode/targetItem/targetNode` — pipes connect *items*
   (equipment, valves) via *nodes* (nozzles, line junctions). We have ports;
   DEXPI has nozzles as first-class objects owned by `NozzleOwner`.
4. **TaggedPlantItem** — every plant item (equipment, valve, instrument,
   line) carries a tag. Our ISA tag validation aligns with this.
5. **Interop target.** A future DEXPI/Proteus XML exporter would let DSL
   diagrams exchange with industry tools.

## Model map (class → our DSL equivalent)

| DEXPI | Our DSL |
|---|---|
| `DexpiModel` (root) | parsed `pid` document |
| `ConceptualModel` | semantic model (post-parse) |
| `Diagram` / `RepresentationGroup` | renderer input (drawing) |
| `PlantStructureItem` (Plant, Unit, Section, System, Train) | (future: areas/zones) |
| `TaggedPlantItem` | equipment / valve / instrument / line |
| `Equipment` subclasses (CentrifugalPump, Compressor, Boiler, ColumnTrays..., ~200 types) | `equipment <id> <type>` |
| `Nozzle` / `NozzleOwner` | `<connections>` metadata (type=nozzle) |
| `PipingNetworkSystem` | `line` specs (size/service/spec...) |
| `PipingNode` | junctions |
| `PipingConnection` (source/target item+node) | `A -> B.port` pipes |
| `InstrumentationLoopFunction` | instrument tags + loops |
| `ProcessInstrumentationFunction` | `signal` lines |
| `ActuatingSystem` | valve actuators |
| `CustomAttribute` | future: per-entity key/value extras |

## Validation rules worth adopting (from the schema's structure)

- Tag uniqueness across all `TaggedPlantItem` (DEXPI ids are UUIDs; plant
  tags must be unique)
- Nozzle/connection compatibility: connections attach only to nozzle owners
  (no pipes dangling to nothing); a pipe's end must be a nozzle or a node
- Line continuity: every `PipingConnection` has a source and a target
- Instrument loop completeness: `InstrumentationLoopFunction` references
  sensors and final elements — check every FCV/XV has a loop
- Equipment taxonomy: type must exist in the catalog (our SYMBOL_KEYS +
  TYPE_LABELS are a mini-catalog)

## References

- Repo: https://github.com/process-intelligence-research/pyDEXPI
- Paper: Goldstein et al., ESCAPE35 (2025), DOI 10.69997/sct.139043
- DEXPI e.V.: https://dexpi.org (standard owner)
