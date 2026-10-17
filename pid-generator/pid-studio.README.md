# P&ID Studio

A ground-up redesign of `pid-components.html` as a graphics application for
editing the P&ID symbol library. Three files, no build step:

| file | role |
|---|---|
| `pid-studio.html` | app shell — titlebar, tool rail, symbol browser, stage, inspector, overlays |
| `pid-studio.css` | design system (light + dark) |
| `pid-studio.js` | editor engine |

Open `pid-studio.html` next to the generator scripts it loads:

```
pid-textmetrics.js · pid-rules.js · pid-collide.js · geometric_objects.js
pid-symbols-bundle.js · pid-parser.js · pid-router.js · pid-validator.js
pid-renderer.js
```

`pid-components.html` still works and is left untouched; both editors read the
same live `window.PID_SYMBOLS`.

## Editing

* Select — click, shift-click, rubber-band; multi-select keeps one transform box
* Scale / rotate handles; flip H/V; rotate 90°; 6 alignments + distribute
* Z-order (list, buttons, Ctrl+[ / Ctrl+]), duplicate, cut/copy/paste
* Node editing — double-click a shape to drag, insert, delete (Alt+click) vertices
* Pen tool (click points, Enter to finish, Backspace undoes a point), shapes by
  drag, text tool with on-canvas inline editing
* Snapping — grid, other elements' edges/centres, ports, guides — with live
  guide lines and a measure badge
* Ports — drag the dots, double-click empty canvas, or the port tool
* Inspector — component fields, ports, per-element geometry + style with colour
  pickers, layers list, clickable validation issues, glyph preview, source editor

## Ink check

A P&ID symbol is drawn **on** the process line, so a port that does not terminate on
the glyph's own linework leaves a gap between the pipe end and the metal — and an
unlabelled break reads as "not connected". The studio ports the geometry from
`symbol-ink.mjs` (the browser cannot import that ESM from `file://`) and extends it to
honour `<g>` and per-element transforms, which the Node version does not:

```js
window.__PID_EDITOR_TEST__.inkCheck()   // per-port gap, arrival axis, snap target
```

`node`-side parity was verified across all 201 symbols: identical ink counts, identical
per-port gaps (max delta 0.000000). The arrival-axis rule and the half-stroke noise guard
match `fix-port-linework.mjs`, so **Snap to ink** in the studio repairs exactly what
that script would — the library as shipped flags zero ports; the check is a guard for
edits you make here. Toggle it from the context toolbar's warning icon; flagged ports
pulse red on canvas with a dashed line to the metal they should reach, and the ports
panel plus the validation list each carry a snap action.

## Meta points

The anchor, label anchor and extents are not just numbers in the inspector any
more: turn them on in the **View** section (or the *Show* group) and drag them on
canvas — the red cross, the purple dot and the yellow corner handles all snap to the
grid. The extents rectangle is the bounding box the layout engine uses, so dragging
it is the fastest way to fix a symbol that the engine thinks is off-centre.

## Safety

* **Autosave** — every edit is snapshotted to `localStorage` (dirty components
  only). Reload freely: a banner offers Restore or Discard.
* **Review** — click the status bar's dirty indicator (or `Ctrl+K` → *Review
  unsaved edits…*) for thumbnails of every changed symbol with Open / Revert /
  Revert all / Export all / Download bundle.
* Undo/redo is per-component snapshot based (Ctrl+Z / Ctrl+Shift+Z, 120 deep).
* The bundle download and the File System Access *link + save* flow are
  unchanged from the original editor, so `apply-component.mjs` still works.

## Conventions the engine depends on

Ports are the live array from `PIDGenerator.symbolConnections(key)` in
**0–100 normalised** coordinates; geometry is in **viewBox units**. The
renderer nests the glyph's `viewBox` in a square box, so the viewBox origin is
cancelled by the viewport mapping: normalised `x` maps to viewBox `x` as
`x/100 * vbW` (see the `portOffset` comment block in `pid-parser.js` — the
measured-but-not-adopted drift). After any structural edit the editor drops
`connCache`/`sizeCache` entries so the parser re-derives them.

`window.__PID_EDITOR_TEST__` exposes the analysis and transform layer
(`analyze`, `chainFull`, `parseTransform`, `fmtTransform`, `elemBounds`,
`vertexList`, `mApply`, `mInv`, `mMul`, undo/redo, and `state()`) for tests.

## Keys

`V P L R O T A H` tools · `F` fit · `1` actual size · `G` grid · `S` snap ·
arrows nudge (Shift = ×10) · `Ctrl+A/C/X/V/D` · `Ctrl+[` `Ctrl+]` z-order ·
`Enter` finish path · `Esc` deselect / exit node mode · `?` shortcuts ·
`Ctrl+K` palette · `Ctrl+S` download bundle.
