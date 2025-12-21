# GitHub Copilot Instructions (VS Code)

## Project Overview

This project is a **100% offline**, **tooling-free** web application built with **plain HTML, CSS, and vanilla JavaScript**. It renders an **interactive shrimp aquarium diagram** using **Mermaid.js**, **SVG**, and **custom tooltips** to visually and semantically describe a *complete* shrimp aquarium ecosystem.

No build steps. No servers. No transpilers. No package managers.

Copilot must generate code that works by opening `index.html` directly in a browser.

---

## Hard Constraints (Non‑Negotiable)

Copilot **must not**:

* Use Node.js, npm, yarn, pnpm, bun
* Use TypeScript
* Use Babel, Webpack, Vite, Rollup, Parcel
* Use Prettier, ESLint, or formatters
* Use frameworks (React, Vue, Svelte, etc.)
* Require internet access at runtime **by default** (external scripts may be used optionally with graceful offline fallback)
* Assume a dev server exists

Copilot **must**:

* Write **pure ES5/ES6 JavaScript only**
* Work when opened via `file:///`
* Use **local files only** (Mermaid included locally)
* Keep logic readable and explicit

---

## External Scripts Policy

Externally linked scripts **are allowed** using `<script src>` tags under the following rules:

* External scripts must be **optional**, not mandatory
* The application must still load and function meaningfully when offline
* External scripts must fail gracefully (no uncaught errors)
* Feature detection must be used before relying on an external API
* No external script may assume Node, build tools, or transpilation
* Prefer local fallbacks when feasible

Example pattern:

```html
<script src="https://example.com/lib.min.js" defer></script>
<script>
  if (!window.ExampleLib) {
    // fallback or reduced functionality
  }
</script>
```

External CDN usage must never be required for core rendering of the aquarium diagram.

---

## File & Folder Structure

Copilot should follow this modular structure strictly:

```
/
├─ index.html
├─ /css
│  ├─ base.css        # layout, resets, typography
│  ├─ aquarium.css    # aquarium visuals & SVG styling
│  └─ tooltip.css     # tooltip behavior & transitions
├─ /js
│  ├─ app.js          # application bootstrap
│  ├─ diagram.js      # Mermaid + SVG orchestration
│  ├─ tooltips.js     # tooltip creation & positioning
│  ├─ data.js         # aquarium domain data (facts only)
│  └─ utils.js        # helpers (DOM, math, SVG helpers)
├─ /vendor
│  └─ mermaid.min.js  # local copy, never CDN
└─ /assets
   └─ icons.svg       # optional SVG symbols
```

No file should exceed ~300 lines unless unavoidable such as the diagram.js file.

---

## Mermaid Usage Rules

* Mermaid **must be initialized manually** via JS
* Use `securityLevel: 'loose'`
* Flowchart syntax only (`flowchart`)
* Mermaid output **must be post‑processed** as SVG
* Mermaid nodes represent aquarium components

---

## SVG Interaction Rules

Copilot must:

* Treat Mermaid output as **raw SVG**
* Add `data-id` attributes to nodes
* Never inline JS in SVG

### Supported Interactions

* Hover → tooltip
* Focus → tooltip (keyboard accessible)
* Click → persistent highlight

---

## Tooltip System

Tooltips are **custom**, not libraries.

Rules:

* Tooltips are positioned relative to SVG bounding boxes
* Tooltips must never overflow viewport
* One tooltip visible at a time
* Content sourced from `data.js`

---

## Aquarium Domain Model (`data.js`)

Copilot must treat this as **authoritative truth**.

Each entry:

```js
            {
              id: 'HTR_102',
              name: 'Backup Heater (HTR-102)',
              desc: '100W',
              status: 'operational',
              details: {
                specs: 'Secondary heater, 100W, separate controller circuit',
                priceRange: '$20-40',
                operatingCost: {
                  monthly: '$1.56 (100W × 15% duty cycle × 24hrs × 30days × $0.14/kWh)',
                  yearly: '$18.43 (backup operation only)'
                },
                preferredBrands: 'Eheim Jager, Aqueon Pro, Fluval M-Series',
                alternatives: 'Same brand as primary, Lower wattage models',
                maintenance: {
                  monthly: 'Test activation temperature',
                  'quarterly': 'Verify controller function',
                  yearly: 'Replace preventively with main heater'
                },
                notes: 'Backup prevents cold shock. Set 2°F lower than main.',
                suppliers: 'Same as main heater suppliers'
              }
            }
```

No UI logic allowed in `data.js`.

---

## Styling Rules (CSS)

* Use CSS variables for theme colors
* SVG styled via CSS, not inline attributes
* Smooth transitions only (no animations over 300ms)
* Color‑blind safe palette

No CSS frameworks.

---

## JavaScript Style Rules

Copilot must:

* Avoid global variables (use IIFEs or modules via closures)
* Prefer `const` / `let`
* Use named functions for clarity
* Avoid clever tricks
* Comment *why*, not *what*

---

## Accessibility

Copilot must:

* Add `aria-labels` to interactive SVG nodes
* Ensure keyboard navigation works
* Maintain readable contrast

---

## Performance Expectations

* Mermaid renders once on load
* No polling
* No observers unless required
* DOM queries cached

---

## Output Expectations

Copilot responses should:

* Generate **complete files**, not snippets
* Include necessary comments for clarity
* No placeholders like `// TODO` or `/* ... */` only real code
* Never under any circumstances truncate code for any reason.
* Respect the structure above
* Never suggest external tools
* Never suggest installing anything

If something cannot be done offline, **do not propose it**.

---

## Mental Model

Think of this project as:

> A technical aquarium blueprint rendered as an explorable SVG knowledge graph in the form of a Piping and instrumentation diagram (P&ID).

Every component exists for a reason. Every relationship must be explainable.

Copilot should optimize for **clarity, correctness, and calm precision**.
