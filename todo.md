# P&ID Conversion — TODO

This document tracks work to convert the existing Mermaid-based aquarium schematic into a Piping & Instrumentation Diagram (P&ID)-style SVG with US/ISA P&ID conventions where feasible.

Important constraint: We will NOT use any paid external services (for CI, testing, or hosting). All CI/automation must use self-hosted runners, local tooling, or free/open-source services under the user's control.

---

## Goals
- Replace informal shapes with standardized P&ID symbols (pumps, valves, instruments) using SVG `<symbol>` + `<use>` to keep visuals consistent.
- Add explicit pipe/line styling and arrow markers for flow direction, with classes to represent major/minor flow, signal types (electrical, pneumatic, control), and valve types.
- Add instrumentation bubbles (tags), layer toggles (equipment/piping/instrumentation/electrical), a legend, and a Bill of Materials (BOM) export.
- Maintain accessibility (ARIA attributes, prefers-reduced-motion), print/PDF export quality, and performance (avoid heavy filters by default; optional effects with toggle).

---

## High-level Plan (actionable tasks)
Each task below includes: description, subtasks, acceptance criteria, complexity estimate, and suggested files/locations.

### 1) Research US P&ID symbols & standards (In-progress)
- Description: Collect authoritative references (ISA S5.1, ISO 10628 and common US P&ID conventions), sample symbol sets, and licensing notes.
- Subtasks:
  - Summarize recommended symbol variants for pumps, valves (gate, globe, ball, check), filters, instrumentation bubbles, actuators, fittings.
  - Produce small SVG examples for each symbol with suggested viewBox and sizing conventions.
  - Create `docs/pid-references.md` and `data/pid-symbols-catalog.json` containing canonical names and recommended `<symbol>` ids.
- Acceptance: `docs/pid-references.md` and `data/pid-symbols-catalog.json` exist and are checked into the repo.
- Complexity: Low–Medium (3–6 hours)

### 2) Inventory & mapping (Not started)
- Description: Map existing diagram nodes/ids to P&ID symbols (e.g., P-201 -> centrifugal pump symbol). Create fallback rules for unmapped nodes.
- Subtasks:
  - Add script `scripts/extract-nodes.js` to parse current `#mySvgId` output and list node ids/classes.
  - Create `scripts/pid-mapping.json` containing mapping from node ids to preferred symbol ids.
- Acceptance: `scripts/pid-mapping.json` created and a one-off run shows mapping coverage >= 70%.
- Complexity: Medium (4–8 hours)

### 3) Build a reusable SVG symbol library (Not started)
- Description: Implement `js/pid-symbols.js` (or `assets/pid-symbols.svg`) that injects `<defs>` with `<symbol id="...">` definitions for the chosen symbols.
- Subtasks:
  - Create symbols for pumps (centrifugal, rotary), valves (gate, globe, ball, check), filters, strainers, tanks, instrumentation bubbles, and fittings.
  - Add CSS classes for consistent theming (.pump, .valve, .instrument, .fitting).
  - Include an example page showing usage of each symbol.
- Acceptance: `js/pid-symbols.js` or `assets/pid-symbols.svg` exists and `diagram.js` can instantiate at least pumps and valves using `<use>`.
- Complexity: Medium–High (6–16 hours depending on symbol count)

### 4) Arrow markers & pipe classes (Next short win)
- Description: Add `<marker>` definitions for arrowheads and update pipe/stroke CSS. Add logic to apply `marker-end` where appropriate.
- Subtasks:
  - Add markers to the defs block and CSS classes `.pipe`, `.pipe.major`, `.pipe.minor`, `.pipe.dashed`, `.signal.electrical`, `.signal.pneumatic`.
  - Update render pass to add `marker-end="url(#arrow)"` for flow paths identified as pipes.
- Acceptance: Arrows render on major pipes and pipe classes show expected styles.
- Complexity: Low (1–3 hours)

### 5) Layering & toggles (equipment/piping/instrumentation/electrical)
- Description: Group elements into named layers (SVG `<g class="layer equipment">` etc.) and add UI toggles in the bottom panel.
- Subtasks:
  - Add toggle controls to bottom panel and persist state in `localStorage`.
  - Ensure toggles are keyboard accessible and have ARIA attributes.
- Acceptance: Toggling layers shows/hides corresponding group content and state persists.
- Complexity: Medium (3–6 hours)

### 6) Instrumentation bubbles & control loops
- Description: Implement small instrument symbols (bubbles) with tags and allow linking of instruments to lines/components to highlight control loops.
- Subtasks:
  - Add instrumentation bubble `<symbol>` and tagging scheme (e.g., FIC-###).
  - Implement hover/click to highlight loop members, and add a keyboard accessible control to navigate loops.
- Acceptance: Hovering an instrument highlights all linked elements in the loop. Keyboard navigation cycles through loop elements.
- Complexity: Medium (4–8 hours)

### 7) Render-time mapping to `<use>` (replace shapes)
- Description: Modify `js/diagram.js` so it uses `scripts/pid-mapping.json` to replace nodes with `<use href="#symbol-id">` where possible, preserving Mermaid text labels (in foreignObject when used).
- Subtasks:
  - Add fallback to keep original shape if no symbol exists.
  - Preserve anchors/IDs and tooltip behavior.
- Acceptance: Pumps and valves render with the symbol library; tooltips/hover still work.
- Complexity: Medium–High (6–12 hours)

### 8) Legend & BOM export
- Description: Create a legend overlay and generate BOM CSV/JSON from `js/data.js` using the mapping.
- Acceptance: Legend visible and BOM exports correctly with tags and component specs.
- Complexity: Medium (3–6 hours)

### 9) Accessibility & print/PDF layout
- Description: Add ARIA roles, `prefers-reduced-motion` compliance, high-contrast theme and a print stylesheet for SVG export with revision block.
- Acceptance: Labels readable (no filters), keyboard navigation works, reduced-motion respected, and printed PDF looks correct.
- Complexity: Medium (4–8 hours)

### 10) Visual tests & CI (local/self-hosted only)
- Description: Add visual snapshot tests using Playwright or Puppeteer. **No paid external CI**; use local runner or self-hosted runner (e.g., self-hosted GitHub Actions runner, Drone, GitLab self-hosted, or a Jenkins instance).
- Subtasks:
  - Add `test/visual` scripts and a simple snapshot test for the rendered SVG (arrowheads, symbol usage, a legend presence test).
  - Document how to run tests locally and how to add them to a self-hosted runner.
- Acceptance: Visual tests runnable locally and instructions added to `README.md`.
- Complexity: Medium (4–8 hours)

### 11) Performance audit & filter fallbacks
- Description: Ensure that shadows/filters do not cause sluggish pan/zoom. Provide user toggle to disable heavy effects.
- Acceptance: Default UX is fast; heavy effects off by default and toggleable.
- Complexity: Medium (3–6 hours)

### 12) Documentation & contributor guide
- Description: Document symbol conventions, how to add symbols, mapping files, and local test instructions (no paid CI). Add `docs/pid-guidelines.md`.
- Acceptance: Docs added with examples and local testing instructions.
- Complexity: Low–Medium (3–6 hours)

### 13) Branching & PR workflow (LOCAL-ONLY CI constraint)
- Description: Define branching and PR guidelines and include a PR template that reminds reviewers to run visual tests locally or on self-hosted runners.
- Acceptance: `.github/PULL_REQUEST_TEMPLATE.md` added and README updated with contributor workflow.
- Complexity: Low (1–2 hours)

### 14) Polish & QA
- Description: Final visual polish, review, and QA checklist completion.
- Acceptance: Sign-off and merged changes.
- Complexity: Medium (4–8 hours)

---

## Constraints & Decisions
- NO paid external services (e.g., never configure or rely on paid CI or paid hosted services). Use local tooling and open-source/free self-hosted runners.
- Prefer inline SVG `<defs>` so the generated Mermaid SVG remains self-contained.
- Respect `prefers-reduced-motion` and add toggles for optional visual effects.

---

## Immediate next steps (short term)
1. Finish Task 1 research and create `docs/pid-references.md` and `data/pid-symbols-catalog.json`. (In-progress)
2. Implement Task 4 (arrow markers & pipe classes) as a quick improvement that makes diagrams more P&ID-like visually. (Recommended next implementation)
3. Then start Task 3 (symbol library) and Task 2 (mapping) in parallel.

---

## Notes on tools and CI (local & free options)
- Visual testing: Playwright/Puppeteer for local snapshots; store snapshot images in repo or generate when run locally.
- Self-hosted CI options: run GitHub Actions self-hosted runner (not using hosted minutes), Drone (self-hosted), GitLab self-hosted, or Jenkins on local machine — any of these avoids paid hosted CI minutes.
- Testing on developer machines must be straightforward (`npm test`, `npm run visual`) and documented in `README.md`.

---

If you'd like, I can now:
- Implement Task 4 (arrowheads + pipe classes) immediately, or
- Start Task 1 research (finish references and build the symbol catalog) and then implement Task 3 (symbol library).

Which would you prefer me to do next?
