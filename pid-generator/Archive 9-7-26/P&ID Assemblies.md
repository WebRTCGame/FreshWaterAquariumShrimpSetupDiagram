Here is a comprehensive list of common P&ID assemblies, organized by process variable and equipment type. Each follows the same depth as your PI/PT example: instruments, mechanical components, typical layouts, and service-specific options.

---

## 1. Pressure Instrument Assemblies

### 1.1 PI / PT Shared Tap Assembly
*(Your provided example — included here for completeness)*

**Typical Components:** Process root isolation valve (gate/ball), gauge tee or 2-valve/3-valve manifold, local pressure gauge (PI), electronic pressure transmitter (PT), optional siphon (steam) or snubber (pulsating service).

**Common Layouts:** Shared dual-instrument manifold; stacked arrangement with vertical PI and side-mounted PT; remote seal with capillary tubes for corrosive/high-temp media.

---

### 1.2 PSV / PRV Relief Assembly

**Instruments:** PSV (Pressure Safety Valve), PRV (Pressure Relief Valve), optional PSHH (Pressure Switch High-High) for SIS interlock.

**Typical Components:**
- Inlet block valve (car-sealed open) for isolation during maintenance
- PSV with spring or pilot-operated actuator
- Outlet piping to flare header, vent stack, or closed drain
- Optional rupture disk upstream of PSV (inlet) for corrosive service
- Test gag or lifting lever
- Discharge elbow and drip pan (if venting to atmosphere)

**Common Layouts:**
- **Standard Relief:** Block valve → PSV → vent/flare line
- **Rupture Disk + PSV:** Rupture disk → spool piece → PSV (used when process fluid is corrosive to the PSV seat)
- **Pilot-Operated PSV:** Sense line tapped upstream of main valve; pilot senses system pressure and modulates main valve

**Service Notes:** Set pressure, orifice designation (e.g., "D" orifice), and relieving capacity are annotated on the P&ID. Inlet piping pressure drop must be <3% of set pressure per API 520/521.

---

### 1.3 Pressure Control Loop Assembly (PIC / PCV)

**Instruments:** PT (Pressure Transmitter), PIC (Pressure Indicating Controller), PY (I/P converter or signal relay), PCV (Pressure Control Valve).

**Typical Components:**
- PT with root valve and manifold
- Signal line (electrical or digital bus) to PIC in control room
- Output signal from PIC to PY (field-mounted I/P converter)
- Pneumatic tubing from PY to PCV diaphragm actuator
- Air-set (filter + regulator) on instrument air supply to PCV
- Positioner on PCV for precise throttling
- Block and bypass valves around PCV for manual operation during maintenance

**Common Layouts:**
- **Single Loop:** PT → PIC → PY → PCV
- **Split-Range Control:** One PIC outputs to two PCVs (e.g., one vents gas, one admits inert gas) to maintain tight pressure control
- **Cascade Control:** PIC master controller sets setpoint of a secondary flow controller (FIC)

---

## 2. Temperature Instrument Assemblies

### 2.1 TI / TT Thermowell Assembly

**Instruments:** TW (Thermowell), TE (Temperature Element — RTD or Thermocouple), TT (Temperature Transmitter), optional TI (local temperature indicator).

**Typical Components:**
- Welded or threaded thermowell (TW) inserted into process nozzle
- Temperature element (TE) inserted into thermowell
- Extension neck (nipple + union) to clear insulation
- Terminal head (weatherproof or explosion-proof) housing TE connections
- TT (head-mounted or remote) converting sensor signal to 4–20 mA
- Optional local bimetal thermometer (TI) in separate thermowell or dual-well arrangement

**Common Layouts:**
- **Integral Transmitter:** TE wired directly to head-mounted TT; single 4–20 mA cable to DCS
- **Remote Transmitter:** TE wired to remote-mounted TT on a pipe stand; used when process temperature exceeds transmitter limits
- **Dual Thermowell:** One nozzle with two bores — one for TI (local gauge) and one for TE/TT

**Service Notes:** Wake frequency calculation required per ASME PTC 19.3 TW for high-velocity or vibrating service. Flanged thermowells used for high-pressure or hazardous service.

---

### 2.2 Temperature Control Loop Assembly (TIC / TCV)

**Instruments:** TT, TIC (Temperature Indicating Controller), TY (I/P), TCV (Temperature Control Valve).

**Typical Components:**
- TT in thermowell at process outlet or critical temperature point
- TIC in control room receiving TT signal
- TCV on cooling water, steam, or heating medium line
- PY/TY converter for pneumatic actuation
- Steam trap assembly downstream of TCV if controlling steam heating

**Common Layouts:**
- **Heat Exchanger Temperature Control:** TT on tube-side outlet → TIC → TCV on shell-side cooling medium inlet; TCV throttles cooling water to maintain setpoint
- **Furnace Burner Control:** Multiple TTs (high-select logic) → TIC → TCV on fuel gas line

---

## 3. Flow Measurement Assemblies

### 3.1 Orifice Plate / DP Flow Assembly (FE / FT / FI)

**Instruments:** FE (Flow Element — orifice plate), FT (Flow Transmitter — differential pressure), optional FI (Flow Indicator) or FIT (Flow Indicating Transmitter).

**Typical Components:**
- Orifice plate with flange taps, corner taps, or D-D/2 taps
- Orifice flanges (paddle or weld-neck) with jack screws for plate removal
- Two impulse lines (high side and low side) from taps to transmitter
- Two root valves (or double-block-and-bleed) on each impulse line
- 3-valve or 5-valve manifold at the DP transmitter for isolation, equalization, and venting
- FT (DP transmitter) converting differential pressure to flow signal
- Optional condensate pots (for steam service) to maintain constant liquid head
- Seal pots or diaphragm seals (for viscous or corrosive fluids)

**Common Layouts:**
- **Standard Gas/Liquid:** Orifice plate → impulse lines → 3-valve manifold → DP transmitter mounted below taps
- **Steam Service:** Orifice plate → condensate pots at same elevation → impulse lines filled with condensate → DP transmitter
- **Horizontal Pipe, Liquid:** Orifice plate with taps at bottom (3 or 9 o'clock) to avoid gas pockets; transmitter mounted below pipe
- **Horizontal Pipe, Gas:** Taps at top (12 o'clock); transmitter mounted above pipe to avoid liquid accumulation

**Service Notes:** Flow is proportional to square root of differential pressure; square-root extraction done in transmitter or DCS. Beta ratio (d/D) and bore size annotated on P&ID.

---

### 3.2 Magnetic / Coriolis / Ultrasonic Flow Assembly

**Instruments:** FT (Flow Transmitter), sometimes FI (local indicator).

**Typical Components:**
- Inline flowmeter body (mag meter, Coriolis, or ultrasonic spool piece)
- Upstream and downstream straight-run piping requirements (e.g., 5D upstream, 3D downstream for mag meter)
- Grounding rings or grounding electrodes (mag meter)
- Transmitter electronics (integral or remote mounted)
- Power and signal cable

**Common Layouts:**
- **Integral Transmitter:** Electronics mounted directly on meter body
- **Remote Transmitter:** Electronics on pipe stand; required when meter is in buried or insulated line

---

## 4. Level Instrument Assemblies

### 4.1 Level Gauge / Sight Glass Assembly (LG)

**Instruments:** LG (Level Gauge), optional LS (Level Switch) for high/low alarm.

**Typical Components:**
- Reflex or transparent sight glass gauge mounted to vessel nozzle
- Isolation valves (block valves) top and bottom for maintenance
- Drain/vent valve at bottom of gauge for blowdown
- Optional illuminator for transparent gauges
- Magnetic level gauge with external flag indicator (no glass — used for hazardous service)

**Common Layouts:**
- **Direct-Mount Gauge:** Top and bottom nozzles on vessel → block valves → LG; must be within visible range from operating floor
- **Magnetic Level Gauge:** Chamber connected to vessel via side nozzles; float with magnets drives external visual indicator and can activate reed switches for alarm

---

### 4.2 Displacer / Float Level Assembly (LT / LC / LIC)

**Instruments:** LT (Level Transmitter), optional LI (Level Indicator), LIC (Level Indicating Controller), LCV (Level Control Valve).

**Typical Components:**
- Displacer cage or chamber connected to vessel via side nozzles (top and bottom)
- Torque tube or spring-operated displacer element
- LT (electronic or pneumatic) converting buoyancy force to signal
- Optional LI (local mechanical indicator)
- Block valves on chamber connections for isolation

**Common Layouts:**
- **Cage-Mounted:** Displacer in external cage with top and bottom equalizing lines to vessel; allows maintenance without depressurizing vessel
- **Internal Displacer:** Displacer inserted directly into vessel nozzle (less common due to maintenance constraints)

---

### 4.3 DP Level Assembly (LT / DPT)

**Instruments:** LT (DP Level Transmitter), optional LI.

**Typical Components:**
- High-side impulse line connected to bottom of vessel (wet leg)
- Low-side impulse line connected to top of vessel (dry leg / reference leg)
- Root valves on both connections
- 3-valve or 5-valve manifold at transmitter
- Seal fluid or fill fluid in wet leg (for condensing vapors)
- Diaphragm seals with capillary on both sides (for corrosive, viscous, or solid-laden fluids)

**Common Layouts:**
- **Open Tank:** High side to bottom tap; low side open to atmosphere (vented)
- **Closed Tank, Dry Leg:** High side to bottom; low side to top (vapor space) with condensate pot or dry reference leg
- **Closed Tank, Wet Leg:** High side to bottom; low side filled with seal fluid to top tap; used when vapor condenses
- **Remote Seals:** Two capillary-connected diaphragm seals — one at bottom tap, one at top tap; transmitter mounted remotely at grade

---

### 4.4 Radar / Ultrasonic Level Assembly (LT)

**Instruments:** LT (Level Transmitter).

**Typical Components:**
- Radar or ultrasonic sensor mounted on vessel nozzle (typically top-center)
- Stillwell or bypass chamber (for turbulent surfaces or foam)
- Waveguide or coaxial probe (for guided-wave radar)
- Local display or remote transmitter head

**Common Layouts:**
- **Top-Mount Free-Space Radar:** Sensor flange-mounted on vessel roof; beam reflects off liquid surface
- **Guided-Wave Radar:** Probe extends into vessel; used for interface level or low-dielectric fluids
- **Stillwell Installation:** Sensor on top of stillwell pipe extending into vessel; isolates sensor from turbulence/agitation

---

## 5. Analyzer / Sampling Assemblies

### 5.1 Process Analyzer Sampling System

**Instruments:** AE (Analyzer Element), AT (Analyzer Transmitter), AIT (Analyzer Indicating Transmitter).

**Typical Components:**
- Fast-loop sample probe inserted into main process line
- Root isolation valve and secondary block valve
- Sample conditioning system: filter, pressure regulator, flow restrictor, cooler, coalescer
- Rotameter or flow indicator for sample flow rate
- Analyzer cell (e.g., pH, conductivity, O₂, H₂S, chromatograph)
- Sample return line to process (closed loop) or drain (open loop)
- Calibration gas connection with selector valve

**Common Layouts:**
- **Fast-Loop Sampling:** Sample extracted from main line, conditioned, analyzed, and returned to process at lower pressure point; ensures representative sample and minimal lag time
- **Grab Sample Station:** Manual sampling valve with sample cooler and collection point for laboratory analysis

---

## 6. Control Valve Assemblies

### 6.1 Modulating Control Valve Assembly (FCV / PCV / TCV / LCV)

**Instruments:** Control valve tag (e.g., FCV-101), positioner, solenoid valve (if ESD), limit switches.

**Typical Components:**
- Control valve body (globe, butterfly, ball, or plug type)
- Actuator (diaphragm spring-return, piston double-acting, or electric)
- Positioner (pneumatic, electro-pneumatic, or smart digital)
- I/P converter (if positioner is not integral)
- Air-set (filter + regulator) on instrument air supply
- Volume booster or quick-exhaust valve (for fast stroke requirements)
- Solenoid valve for fail-safe or ESD action
- Limit switches (ZSO/ZSC — open/closed indication) for DCS feedback
- Handwheel or declutchable manual override
- Bypass line with block valves around control valve for manual operation

**Common Layouts:**
- **Standard Throttling:** Process line → upstream block valve → control valve → downstream block valve → process line; bypass with block valves parallel to CV
- **Fail-Safe ESD:** Solenoid vents actuator air on signal loss; valve fails open or closed depending on safety requirement
- **Split-Range:** Two control valves on same line receiving split signal ranges (e.g., 4–12 mA to one, 12–20 mA to the other)

---

### 6.2 On/Off Valve Assembly (XV / YV / ESDV)

**Instruments:** XV (On/Off Valve), YV (Solenoid Valve), ZSH/ZSL (Limit Switches).

**Typical Components:**
- On/off valve (ball, gate, or butterfly)
- Pneumatic or electric actuator
- Solenoid valve (YV) for pilot air control
- Air-set on supply
- Limit switches (ZSH — open, ZSL — closed) wired to PLC/DCS
- Partial-stroke test (PST) device (for ESD valves in safety systems)
- Local control panel or junction box

**Common Layouts:**
- **ESD Valve:** Process line → ESD valve with actuator; solenoid wired to SIS; valve fails closed on air/signal loss
- **Pumped-Through Bypass:** ESD valve with small bypass and manual valve for startup/line packing

---

## 7. Pump Piping Assemblies

### 7.1 Centrifugal Pump Suction / Discharge Assembly

**Typical Components:**
- Suction block valve (gate or butterfly)
- Suction strainer or temporary strainer (cone type with start-up spool piece)
- Eccentric reducer (flat on top for liquids to avoid vapor pockets)
- Pump casing with vents and drains
- Check valve on discharge (between pump and block valve)
- Discharge block valve
- Flow orifice or flow element for minimum flow protection
- Minimum flow recirculation line with control valve or restriction orifice back to suction vessel
- Pressure gauges (PI) on suction and discharge
- Vibration and temperature sensors on bearing housings (if monitored)

**Common Layouts:**
- **Standard Process Pump:** Suction vessel → block valve → strainer → reducer → pump → check valve → block valve → discharge header
- **Hot Service (e.g., Boiler Feed):** Warm-up line from discharge to suction with small bypass valve; thermal relief on pump casing
- **Dual Pump (Running/Standby):** Common suction header with individual suction valves; common discharge header with individual discharge valves and check valves

---

## 8. Heat Exchanger Piping Assemblies

### 8.1 Shell-and-Tube Heat Exchanger Assembly

**Typical Components:**
- Tube-side inlet/outlet block valves
- Shell-side inlet/outlet block valves
- Vent valves high point (both sides)
- Drain valves low point (both sides)
- Relief valve or thermal relief on shell side (if blocked-in heating possible)
- Temperature indicators (TI) on inlets and outlets
- Pressure indicators (PI) on inlets and outlets
- Control valve on heating/cooling medium (shell or tube side)
- Bypass line around exchanger for maintenance or temperature control

**Common Layouts:**
- **Single Exchanger:** Process through tubes; utility through shell; TCV on utility inlet; TT on process outlet
- **Series/Parallel Exchangers:** Multiple shells with piping allowing series or parallel operation via valve manifolds
- **Thermosiphon Reboiler:** Vertical exchanger connected to column bottom; no pump; natural circulation driven by density difference

---

## 9. Tank / Vessel Nozzle Assemblies

### 9.1 Tank Nozzle Instrument Cluster

**Typical Components:**
- Multiple nozzles on tank roof and shell for instruments
- Level instruments: LT (radar, displacer), LG (sight glass), LI (local)
- Pressure instruments: PT, PSH, PSL (pressure switches for alarm)
- Temperature instruments: TT, TI
- Sampling nozzles and dip pipes
- Vent / pressure-vacuum relief valve (PVRV) on roof
- Manway and davits for access

**Common Layouts:**
- **Floating Roof Tank:** Level measured via radar or servo gauge; seal monitors; roof drain system
- **Pressure Vessel:** Multiple instrument nozzles at different elevations; PSV on top nozzle; drain at bottom

---

## 10. Sample Point / Drain / Vent Assemblies

### 10.1 Process Sample Point

**Typical Components:**
- ½" or ¾" nozzle on main line or vessel
- Root valve (needle or ball valve)
- Secondary valve or double block
- Sample cooler (if hot fluid)
- Sample connection (quick-connect or threaded cap)
- Drain to closed drain system or catch pan

**Common Layouts:**
- **Liquid Sample:** Valve → sample cooler → quick-connect; sample returned to process or disposed
- **Gas Sample:** Valve → sample probe → analyzer or collection cylinder

---

### 10.2 Drain / Vent Assembly

**Typical Components:**
- Drain nozzle at low point of piping or vessel
- Block valve (gate or ball)
- Second block valve or blind flange for positive isolation
- Connection to closed drain header (hazardous fluids) or open drain (non-hazardous)
- Vent nozzle at high point with valve for air release during filling

**Common Layouts:**
- **Closed Drain:** Process → block valve → funnel into closed drain header → drain vessel or sump
- **Open Drain:** Process → block valve → funnel to trench or grade (only for non-hazardous, non-hot service)

---

## 11. Steam Tracing Assemblies

**Typical Components:**
- Steam supply header with trap station
- Tracing tubing (copper or SS) wrapped around process line or instrument impulse line
- Steam trap (thermostatic, thermodynamic, or inverted bucket) at low point
- Condensate return header or collection pot
- Block valves on supply and return
- Insulation over traced line

**Common Layouts:**
- **Jacketed Pipe:** Process line inside steam jacket; used for materials that solidify at ambient temperature (sulfur, asphalt)
- **Tubing Trace:** Small-bore steam tubing spiraled around process pipe; secured with bands; trap at end

---

## Summary Table of Common Assemblies

| Assembly Type | Primary Instruments | Key Mechanical Components | Typical Options |
|--------------|---------------------|---------------------------|-----------------|
| Pressure Tap | PI, PT, PIT | Root valve, manifold, gauge | Siphon, snubber, remote seal |
| Thermowell | TE, TT, TI | Thermowell, extension, head | Flanged, welded, dual-bore |
| Orifice Flow | FE, FT, FI | Orifice plate, flanges, impulse lines, manifold | Condensate pots, seal pots |
| DP Level | LT, LI | Impulse lines, wet/dry legs, manifold | Remote diaphragm seals |
| Level Gauge | LG | Sight glass, block valves, drain | Reflex, transparent, magnetic |
| Control Valve | FCV, PCV, TCV, LCV | Valve, actuator, positioner, air-set | Solenoid, limit switches, bypass |
| PSV Relief | PSV, PRV | Inlet block valve, outlet piping, rupture disk | Pilot-operated, dual PSV |
| Pump | — | Suction/discharge valves, strainer, check valve, recirculation | Min flow line, warm-up line |
| Heat Exchanger | TT, TIC, TCV | Inlet/outlet valves, vents, drains, bypass | Thermal relief, control valve |
| Sample Point | AT, AE | Probe, cooler, valves, rotameter | Fast-loop, grab sample |
| Steam Trace | — | Supply header, tubing, trap, return | Jacketed pipe, tubing trace |

Each of these assemblies appears repeatedly across P&IDs in oil & gas, chemical, power, and refining industries. The specific configuration (valve types, manifold styles, remote vs. direct mount) is dictated by the project piping class, process conditions, and company engineering standards (e.g., Shell DEP, ADNOC ES, Aramco SAES).