# 🦐 Freshwater Aquarium Shrimp Setup Diagram

**🌐 Live Demo → [webrtcgame.github.io/FreshWaterAquariumShrimpSetupDiagram](https://webrtcgame.github.io/FreshWaterAquariumShrimpSetupDiagram/)**

An interactive, browser-based system diagram for a fully automated 125-gallon freshwater planted shrimp aquarium with an integrated lava-rock island feature. Every piece of equipment, sensor, and control loop in the build is mapped in a pan-and-zoom Mermaid flowchart, with a collapsible sidebar that provides detailed specs, recommended brands, price ranges, maintenance schedules, and live operating-cost estimates for each component.

---

## 📋 Table of Contents

- [Features](#-features)
- [System Overview](#-system-overview)
- [Component Categories](#-component-categories)
- [Island System](#-island-system)
- [Operating Costs](#-operating-costs)
- [Project Structure](#-project-structure)
- [Running Locally](#-running-locally)
- [Technology Stack](#-technology-stack)
- [Humidity & Misting Upgrade Notes](#-humidity--misting-upgrade-notes)
- [License](#-license)

---

## ✨ Features

| Feature | Description |
|---|---|
| **Interactive diagram** | Pan, zoom (scroll / pinch), and double-click to navigate the full system flowchart |
| **Component sidebar** | Collapsible navigator listing every component grouped by category |
| **Click-to-focus** | Click any sidebar item to zoom the diagram to that component and highlight it |
| **Hover / tap tooltips** | Hover over (or tap on mobile) any diagram node for a quick-info popup including status, cost, and key specs |
| **Mobile responsive** | Slide-in drawer sidebar, touch-friendly controls, and bottom-sheet tooltips on small screens |
| **Maintenance schedules** | Every component includes daily / weekly / monthly / quarterly / yearly maintenance tasks |
| **Operating-cost tracking** | Per-component electricity cost (monthly + yearly) based on $0.14/kWh; system totals shown in the sidebar header |
| **Status indicators** | Each component carries an **operational**, **maintenance**, or **critical** status badge |

---

## 🏗 System Overview

The diagram models a **125-gallon (72" × 18" × 24") freshwater planted aquarium** optimised for dwarf shrimp. The build is divided into two physical zones — everything **inside** the main tank and everything **outside** it — plus a self-contained **Island System** sitting above the waterline.

```
┌─────────────────────────────────────────────────────────┐
│  MAIN TANK  125 GAL                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Substrate│  │  Plants  │  │  Habitat │              │
│  │ (root    │  │  (CO₂    │  │  (moss,  │              │
│  │  zone)   │  │   zone)  │  │  caves,  │              │
│  └──────────┘  └──────────┘  │  breed.) │              │
│                               └──────────┘              │
│   Internal filtration: corner sponges + matten filter   │
└───────────────────────┬─────────────────────────────────┘
                        │ water flow (400 GPH pump)
        ┌───────────────▼───────────────────────────┐
        │  EXTERNAL FILTER LOOP                      │
        │  Pre-filter → Bioreactor → pH Buffer Tower │
        │  → Redox Reactor (Zeolite/Purigen)         │
        │  → Degasser → back to tank                 │
        └───────────────────────────────────────────┘
        Side systems: CO₂, Dosing, Lighting, ATO, Water Change,
                      Heating, Air, Power, Quarantine, Island
```

Water flow, electrical connections, signal lines, and air lines are all shown as separate, colour-coded edge types in the flowchart.

---

## 🗂 Component Categories

The sidebar organises every component into the following categories. Click a category header to collapse/expand it.

### Main Systems
| ID | Component | Notes |
|---|---|---|
| TK-101 | Main Tank (125 GAL) | Glass, 72" × 18" × 24"; low-iron preferred |
| P-201 | Circulation Pump (400 GPH, 30 W) | Shrimp-safe ceramic shaft; Sicce / Eheim |
| CONT-101 | Parameter Controller | pH, temp, conductivity monitoring; Neptune Apex Jr / Hydros |

### Filtration
| ID | Component | Notes |
|---|---|---|
| FIL-201 | Prefilter | Dual-density foam, 100 µm mechanical |
| BIO-201 | Bioreactor | Seachem Matrix + bio rings |
| MIN-301 | pH Buffer Tower | Crushed coral / aragonite; critical for soft water |
| OX-401 | Redox Reactor | Zeolite + Seachem Purigen (regenerable) |
| DEG-501 | Degasser | Trickling tower, outgasses CO₂ |
| FIL-101/102 | Corner Sponge Filters | Mechanical + biological; shrimp-safe |
| FIL-103 | Matten Filter | PPI-20 foam wall; excellent for shrimp |

### Sensors & Instruments
pH, TDS, Temperature, Dissolved Oxygen, ORP (Redox Potential), Water Level — all with recommended calibration schedules and target ranges for shrimp.

### Heating & Climate
Dual-heater setup (200 W primary + 100 W backup, set 2 °F lower) controlled by an Inkbird digital temperature controller. Backup heater prevents cold-shock during primary failure.

### CO₂ System
Full pressurised CO₂ circuit: 5–20 lb cylinder → dual-stage regulator → 12 V DC solenoid (timer-off at night) → ceramic/glass diffuser. Prevents pH swings during dark periods.

### Dosing System
Two peristaltic dosing pumps on a programmable timer controller — one for GH/KH+ mineral remineralisation (essential for RO water) and one for plant fertiliser. Separate pumps prevent cross-contamination.

### Air System
Diaphragm compressor (8–12 L/min, 24/7) with a USB battery-backup pump for power outages, distributed via a 6-way manifold with individual check valves.

### Water Management
| Component | Purpose |
|---|---|
| ATO Pump (50 GPH) | Auto top-off; compensates for evaporation |
| Water Change Pump (200 GPH) | Automates periodic water changes |
| Mixing Tank (20 GAL) | Pre-mix and age new water to stable parameters |

### Lighting
Full-spectrum LED (80 W, 8-hour photoperiod) on a programmable controller with sunrise/sunset simulation. PAR sensor available for dialling in plant growth light levels (target 30–50 PAR).

### Shrimp Habitat
Deliberately designed zones inside the tank:
- **Moss fields** — primary biofilm / grazing surface (Java moss, Christmas moss)
- **Rock caves** — cholla wood, lava rock, ceramic tubes for hiding and moulting
- **Breeding colony corner** — dense plants, minimal flow, no disturbance
- **Feeding station** — glass dish; uneaten food removed within 2 hours

### Quarantine
Dedicated 10–20 GAL bare-bottom tank with its own pump kept completely separate from main-tank equipment. Sterilised between uses with bleach solution.

### Power & Control
GFCI-protected outlet strip → UPS battery backup → timer hub → dedicated outlets for pump, heater, CO₂ solenoid, lights, and dosing. All wiring follows aquarium-safe practices.

---

## 🏝 Island System

A **lava-rock island** sits partially submerged and rises above the waterline, creating a humid riparian microclimate within the tank enclosure. It includes its own closed-loop control system:

```
ISL Temp/Humidity Sensor (ISL-SNS-701)
        │
        ├──► Island Temp Controller (ISL-TC-501, Inkbird)
        │         └── controls Basking Spot Lamp (40–60 W)
        │               Target island air: 82–88 °F
        │
        └──► Island Humidity Controller (ISL-HC-601, Inkbird IHC-200)
                  ├── humidify relay → Misting System (ISL-MIST-401)
                  │       Repti Zoo TR09 or Exo Terra Monsoon Nano
                  │       Target island RH: 70–80 %
                  └── dehumidify relay → Island Fan (ISL-FAN-301)
                          Prevents mould on lava rock
```

A small submersible **waterfall pump** (50–80 GPH) routes tank water up through silicone tubing to cascade down the lava-rock face, adding surface agitation, oxygen, and ambient humidity.

A **float-switch reservoir level sensor** protects the waterfall pump from running dry.

> 📄 See [`island.md`](island.md) for a full component comparison of misting systems (Repti Zoo TR09 vs Exo Terra Monsoon Nano vs Zoo Med ReptiRain) and a recommended bill-of-materials for the island humidity circuit.
>
> 📄 See [`Humidity Control Relay Setup.pdf`](Humidity%20Control%20Relay%20Setup.pdf) for the relay wiring diagram.

---

## 💰 Operating Costs

Costs are calculated at **$0.14 / kWh** and displayed live in the sidebar header.

| Budget | Cost |
|---|---|
| **Monthly** | **~$21.84** |
| **Yearly** | **~$273.27** |

Major contributors:

| Component | Monthly | Yearly |
|---|---|---|
| Main heater (200 W, 50 % duty) | $12.44 | $147.17 |
| LED lighting (80 W, 8 hr/day) | $3.63 | $42.78 |
| Circulation pump (30 W, 24/7) | $3.11 | $36.79 |
| Air compressor (10 W, 24/7) | $1.04 | $12.26 |
| Basking lamp (50 W, 8 hr/day) | $2.42 | $29.02 |
| All others | < $0.50 each | — |

---

## 📁 Project Structure

```
FreshWaterAquariumShrimpSetupDiagram/
├── index.html          # Single-page application shell
├── app.js              # Main entry point — renders diagram, sidebar, tooltips
├── diagram.js          # Mermaid flowchart definition (graphDefinition export)
├── components.js       # Component data (specs, costs, brands, maintenance)
├── styles.css          # Layout, sidebar, tooltip, and responsive styles
├── island.md           # Island humidity system BOM + misting product comparison
├── Humidity Control Relay Setup.pdf  # Island relay wiring reference
└── LICENSE
```

### Key modules

**`diagram.js`** exports a `graphDefinition` string — a Mermaid `flowchart LR` definition containing all nodes and edges. It is divided into named subgraphs:
- `LEGEND` — visual key for node shapes and edge colours
- `SYSTEM OVERVIEW` — high-level water-flow loop
- `MAIN TANK & DIRECT COMPONENTS` — tank, overflow, access
- `INSIDE MAIN TANK` — substrate, plant zone, internal filtration, habitat
- `OUTSIDE MAIN TANK` — external filter loop, pumps, CO₂, dosing, ATO, heating…
- `ELECTRICAL DISTRIBUTION` — power, timers, GFCI, UPS
- `ISLAND SYSTEM` — island components and their control loop

**`components.js`** exports a `components` object keyed by category name. Each entry is an array of component objects with the shape:
```js
{
  id: 'P_201',
  name: 'Main Circulation Pump (P-201)',
  desc: '400 GPH, 30W, Shrimp-Safe',
  status: 'operational',   // 'operational' | 'maintenance' | 'critical'
  details: {
    specs, priceRange, operatingCost, preferredBrands,
    alternatives, maintenance, notes, suppliers
  }
}
```

**`app.js`** wires everything together:
1. Initialises Mermaid and renders the SVG from `diagram.js`
2. Passes the SVG to `svg-pan-zoom` for pan / zoom / fit
3. Populates the sidebar from `components.js`
4. Attaches hover and touch event listeners for tooltips
5. Implements `focusOnComponent()` — zooms to 6× and pans to centre the selected node

---

## 🚀 Running Locally

The project is a static site with no build step. It uses ES module imports directly in the browser.

1. Clone the repository:
   ```bash
   git clone https://github.com/WebRTCGame/FreshWaterAquariumShrimpSetupDiagram.git
   cd FreshWaterAquariumShrimpSetupDiagram
   ```

2. Serve the files over HTTP (ES modules require a server, not `file://`):
   ```bash
   # Python 3
   python3 -m http.server 8080

   # Node.js (npx)
   npx serve .

   # VS Code
   # Use the "Live Server" extension
   ```

3. Open `http://localhost:8080` in your browser.

> **Note:** The diagram is loaded from the CDN (`cdn.jsdelivr.net/npm/mermaid@11.6.0`) and `svg-pan-zoom` is loaded from `bumbu.me`. An internet connection is required unless you vendor these dependencies locally.

---

## 🛠 Technology Stack

| Library | Version | Purpose |
|---|---|---|
| [Mermaid.js](https://mermaid.js.org/) | 11.6.0 | Flowchart rendering from text definition |
| [svg-pan-zoom](https://github.com/bumbu/svg-pan-zoom) | latest | Pan, zoom, and fit controls for the SVG |
| Vanilla JS (ES Modules) | — | Application logic, sidebar, tooltips |
| CSS3 | — | Layout, transitions, responsive design |

No framework, no bundler, no build step required.

---

## 🌫 Humidity & Misting Upgrade Notes

[`island.md`](island.md) documents a comparison of prebuilt misting systems considered for the island, including a full system BOM and cost breakdown:

| System | Price | Best For |
|---|---|---|
| Repti Zoo TR09 | ~$41 | Budget + flexible, includes pump + nozzle |
| Exo Terra Monsoon Nano | ~$70 | Premium stability, advanced timer, low noise |
| Zoo Med ReptiRain | ~$53 | Simple plug-and-play |

**Recommended balanced build** (~$170–$190):
Repti Zoo TR09 misting system + Inkbird humidity controller + Inkbird temp controller + water level controller + timer relay + fan

---

## 📄 License

See [LICENSE](LICENSE) for details.
