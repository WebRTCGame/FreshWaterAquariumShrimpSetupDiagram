pid
layout auto
fit page
stub 8
title "Reactor & Distillation Unit"
project "PID Generator Demo"
sheet 1 of 1
rev "A" "2026-08-16" "Initial issue"

line N2-001 size 4 service PG number 101 spec 1E1 ins H thick 50 trace T
line N2-002 size 3 service PW number 102 spec 1E1 ins H thick 50 trace T
line N2-003 size 2 service PW number 103 spec 1E1 ins H thick 50 trace T
line N2-004 size 2 service CW number 104 spec 1E1 ins H thick 50 trace T
line N2-005 size 2 service CW number 105 spec 1E1 ins H thick 50 trace T
line N2-006 size 3 service PW number 106 spec 1E1 ins H thick 50 trace T

version 1

equipment T-101 tank "Feed surge drum" service "Process" system "N2" area "Reactor Unit" status existing
nozzle NZ-T101-1 on T-101 port inlet size 6" rating 150
nozzle NZ-T101-2 on T-101 port outlet size 4" rating 150
valve V-101 gate "Feed isolation" normal open service "Process" status existing
equipment P-101 pump "Feed circulation pump" "Circulates process fluid through reactor loop" service "Process" system "N2" area "Reactor Unit" attribute manufacturer Grundfos attribute flow 500GPM status existing
nozzle NZ-P101-S on P-101 port suction size 4" rating 150
nozzle NZ-P101-D on P-101 port discharge size 3" rating 150
instrument FT-101 field "Feed flow transmitter" service "Process" area "Reactor Unit"
instrument FIC-101 dcs "Feed flow controller" loop 101
valve FV-101 control "Feed control valve" normal open fail closed mode auto
valve PSV-101 relief "Reactor pressure relief" above R-101 offset 40,0 set-pressure 150psi
nozzle NZ-PSV101 on PSV-101 port inlet size 2" rating 300
equipment R-101 reactor "Main reactor vessel" service "Reaction" system "N2" area "Reactor Unit" attribute volume 5000L attribute designPressure 250psi status existing
nozzle NZ-R101-1 on R-101 port left size 4" rating 150
nozzle NZ-R101-2 on R-101 port right size 4" rating 150
nozzle NZ-R101-T on R-101 port top size 2" rating 150
nozzle NZ-R101-B on R-101 port bottom size 2" rating 150
instrument TT-101 field "Reactor temperature transmitter" service "Reaction"
instrument TIC-101 dcs "Reactor temperature controller" loop 101
valve V-102 control "Reactor outlet valve" normal open fail closed
equipment C-101 tower "Distillation column" service "Separation" system "N2" area "Distillation Unit" attribute stages 30 status existing
nozzle NZ-C101-1 on C-101 port feed size 3" rating 150
nozzle NZ-C101-2 on C-101 port overhead size 3" rating 150
nozzle NZ-C101-R on C-101 port reflux size 2" rating 150
nozzle NZ-C101-B on C-101 port bottoms size 3" rating 150
instrument LT-101 field "Column bottom level transmitter" service "Separation"
instrument LIC-101 dcs "Column bottom level controller" loop 101
equipment E-101 kettle-reboiler "Column reboiler" service "Separation" area "Distillation Unit"
nozzle NZ-E101-1 on E-101 port steam size 2" rating 300
nozzle NZ-E101-2 on E-101 port condensate size 2" rating 300
nozzle NZ-E101-I on E-101 port inlet size 3" rating 300
nozzle NZ-E101-O on E-101 port outlet size 3" rating 300
valve V-103 control "Reboiler steam control" normal open mode auto
equipment P-103 pump "Reflux pump" service "Reflux" system "N2" area "Distillation Unit"
nozzle NZ-P103-S on P-103 port suction size 3" rating 150
nozzle NZ-P103-D on P-103 port discharge size 2" rating 150
instrument FT-103 field "Reflux flow transmitter" service "Reflux"
instrument FIC-103 dcs "Reflux flow controller" loop 103
stub UTIL-1
stub UTIL-2
stub FLARE-1
junction J-3
junction J-4
equipment E-102 heat-exchanger "Overhead condenser" service "Condensation" system "N2" area "Distillation Unit" attribute area 50 status existing
nozzle NZ-E102-T1 on E-102 port tube_in size 3" rating 150
nozzle NZ-E102-T2 on E-102 port tube_out size 3" rating 150
nozzle NZ-E102-S1 on E-102 port shell_in size 3" rating 150
nozzle NZ-E102-S2 on E-102 port shell_out size 3" rating 150
instrument PT-101 field "Column pressure transmitter" service "Separation"
instrument PIC-101 dcs "Column pressure controller" loop 101
equipment D-101 drum "Reflux accumulator" service "Reflux" system "N2" area "Distillation Unit"
nozzle NZ-D101-1 on D-101 port inlet size 3" rating 150
nozzle NZ-D101-2 on D-101 port outlet size 3" rating 150
nozzle NZ-D101-V on D-101 port vent size 2" rating 150
valve V-105 control "Condensate control" rotated 90 normal open
equipment P-102 pump "Product pump" service "Product" system "N2" area "Product Unit" status existing
nozzle NZ-P102-S on P-102 port suction size 3" rating 150
nozzle NZ-P102-D on P-102 port discharge size 2" rating 150
instrument LT-102 field "Accumulator level transmitter" service "Reflux"
instrument LIC-102 dcs "Accumulator level controller" loop 102
equipment E-103 heat-exchanger "Product cooler" service "Product" area "Product Unit"
nozzle NZ-E103-1 on E-103 port tube_in size 2" rating 150
nozzle NZ-E103-2 on E-103 port tube_out size 2" rating 150
equipment T-102 tank "Product storage" service "Product" system "N2" area "Product Unit" status existing
nozzle NZ-T102-1 on T-102 port inlet size 4" rating 150
nozzle NZ-T102-2 on T-102 port outlet size 4" rating 150

T-101.outlet -> V-101 line N2-001
V-101 -> P-101 line N2-001
P-101 -> FV-101 line N2-001
FV-101 -> R-101.left line N2-001
R-101.right -> V-102.left line N2-002
V-102.right -> C-101.feed line N2-002
C-101.overhead -> E-102.tube_in line N2-003
E-102.tube_out -> D-101.inlet line N2-003
D-101.outlet -> P-102.suction line N2-003
P-102.discharge -> J-4
J-4 -> V-105.left line N2-004
V-105.right -> C-101.reflux line N2-004
J-4 -> E-103.tube_in line N2-005
E-103.tube_out -> J-3 line N2-005
C-101.bottoms -> E-101.inlet line N2-006
E-101.outlet -> V-103 line N2-006
V-103 -> P-103 line N2-006
P-103 -> J-3 line N2-006
J-3 -> T-102 line N2-006
R-101.top -> PSV-101.inlet
PSV-101.discharge -> FLARE-1
protects PSV-101 -> R-101
discharges PSV-101 -> FLARE-1
UTIL-1 -> E-102.shell_in line N2-004
E-102.shell_out -> UTIL-2

signal FT-101 -> FIC-101 electrical
tap FT-101 -> P-101.discharge.line
signal FIC-101 -> FV-101 electrical
signal TT-101 -> TIC-101 electrical
tap TT-101 -> R-101.bottom
signal LT-101 -> LIC-101 electrical
tap LT-101 -> C-101.bottoms.line
signal LIC-101 -> V-103 electrical
signal PT-101 -> PIC-101 electrical
tap PT-101 -> D-101.vent
signal LT-102 -> LIC-102 electrical
tap LT-102 -> D-101.outlet.line
signal FT-103 -> FIC-103 electrical
tap FT-103 -> P-103.discharge.line
signal LIC-102 -> P-102 electrical
signal PIC-101 -> V-105 electrical
signal TIC-101 -> V-102 electrical
