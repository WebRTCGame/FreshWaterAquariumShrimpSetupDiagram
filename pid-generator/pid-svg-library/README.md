# P&ID SVG Symbol Library

A structured set of **136 line-art SVG symbols** for building a North American–style
P&ID (Piping & Instrumentation Diagram) application, organized around the three
symbol traditions most P&ID lead sheets in the US/Canada draw from:

- **`isa-5.1/`** – Instrumentation symbols per the ISA‑5.1 convention: instrument
  bubbles (field/panel/shared/computer/PLC, discrete vs. accessible vs. auxiliary),
  example measurement-loop bubbles (P/T/F/L/A/etc.), signal-line types (pneumatic,
  electrical, hydraulic, digital, capillary, software link, mechanical link, line
  crossings), control valve bodies + actuator types, and binary logic gates.
- **`pip/`** – Piping/equipment/layout symbols in the spirit of Process Industry
  Practices **PNSM0001** (piping symbols) and **PNSM0002** (equipment/instrument
  symbols): pipe line types, fittings, valves at piping scale, major equipment
  silhouettes, and drawing/layout annotations (north arrow, match line, tags,
  revision cloud).
- **`y32.11-1961/`** – Legacy equipment silhouettes tracing back to the ASME
  Y32.11-1961 lineage that PIP/ISA equipment symbols evolved from: vessels, tanks,
  pumps, compressors, heat exchangers, furnaces, separators, and miscellaneous
  in-line devices (motor, strainer, sight glass, silencer, flame arrestor).
- **`combined/pid-symbol-library.svg`** – a single reference sheet laying out
  every symbol with its file id and source folder, useful as a visual index or
  a symbol-picker background.
- **`manifest.json`** – machine-readable index of every symbol (standard →
  subfolder → id → relative path) for programmatic loading into a symbol
  palette/library UI.

## Conventions used across every file

- Each file is a **standalone, self-closed `<svg>`** with a tight `viewBox`
  (no fixed `width`/`height`), so you can drop it into any layout and size it
  with CSS or a `width`/`height` attribute at render time.
- All strokes use `stroke="currentColor"`, **no fill** (except solid junction
  dots and a few filled arrowheads), so symbols recolor automatically with CSS
  `color` — handy for selection highlighting, layers, or dark mode.
- Line pipe/process connections use a heavier stroke (3px) than instrument
  signal lines and internals (2px/1px) to match typical P&ID line-weight
  conventions (process pipe > signal line > internal detail).
- Instrument bubbles are 120×120 circles/squares/hexagons with two lines of
  text (tag letters on top, loop number below) — swap the `<text>` content to
  relabel a bubble for any ISA tag combination (PIC, TT, FSL, LAHH, etc.).

## Using in your app

```html
<img src="pid-svg-library/isa-5.1/valves/control-valve.svg" width="48" />
```

or inline for CSS recoloring:

```html
<div style="color:#1a73e8; width:48px;">
  <!-- paste raw <svg> markup here, strokes inherit color -->
</div>
```

Load `manifest.json` to populate a symbol palette/browser programmatically —
each entry gives you a stable `id` and relative `path`.

## Important note on standards fidelity

ISA‑5.1, PIP PNSM0001/0002, and ASME Y32.11-1961 are **copyrighted, paid
standards documents** published by ISA, PIP (Construction Industry Institute),
and ASME. This library was **built from scratch as original line art**
that follows the *publicly documented conventions* those standards are known
for (bubble shapes for field/panel/shared/computer/PLC instruments, standard
signal-line dash patterns, standard valve-body silhouettes, standard equipment
silhouettes, etc.) — it does not reproduce any copyrighted drawings, page
layouts, or figures from the standards documents themselves. Treat these
symbols as a **practical, close approximation** suitable for building your own
P&ID tool, not as a certified reproduction of the official standard. If exact
compliance is required for regulatory/contractual deliverables, cross-check
critical symbols (especially valve/actuator combinations and instrument
identification-letter tables) against a licensed copy of the current standard.

## Extending the library

Each generator followed one visual grammar (2px instrument strokes / 3px pipe
strokes, `currentColor`, tight viewBoxes), so new symbols can be added by
copying the closest existing file and adjusting the `<path>`/`<circle>`/`<text>`
elements — no build step required.
