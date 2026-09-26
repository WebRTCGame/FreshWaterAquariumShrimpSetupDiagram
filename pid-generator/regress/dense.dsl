pid
layout auto
fit page
title "Dense stress"
project "Regress"
sheet 1 of 1

line S1 size 3 service PW number 1 spec CS150
line S2 size 2 service CW number 2 spec CS150

equipment T-1 tank "Feed tank"
nozzle NZ-T1-O on T-1 port outlet size 3" rating 150
valve V-1 gate "Feed isolation" normal open
equipment P-1 pump "Feed pump"
nozzle NZ-P1-S on P-1 port suction size 3" rating 150
nozzle NZ-P1-D on P-1 port discharge size 3" rating 150
equipment C-1 tower "Column"
nozzle NZ-C1-F on C-1 port feed size 3" rating 150
nozzle NZ-C1-O on C-1 port overhead size 3" rating 150
nozzle NZ-C1-B on C-1 port bottoms size 3" rating 150
equipment E-1 kettle-reboiler "Reboiler"
nozzle NZ-E1-I on E-1 port inlet size 3" rating 150
nozzle NZ-E1-O on E-1 port outlet size 3" rating 150
equipment D-1 drum "Accumulator"
nozzle NZ-D1-I on D-1 port inlet size 3" rating 150
nozzle NZ-D1-O on D-1 port outlet size 3" rating 150
valve FV-1 control "Level control" normal open fail closed mode auto
valve V-2 control "Bypass" rotated 90 normal open
junction J-1
stub OUT-1
instrument FT-1 field "Flow transmitter"
instrument FIC-1 dcs "Flow controller" loop 1
instrument LT-1 field "Level transmitter"
instrument LIC-1 dcs "Level controller" loop 2

T-1.outlet -> V-1 line S1
V-1 -> P-1 line S1
P-1 -> FV-1 line S1
FV-1 -> C-1.feed line S1
C-1.bottoms -> E-1.inlet line S1
E-1.outlet -> J-1 line S1
J-1 -> V-2.left line S2
V-2.right -> C-1.reflux line S2
J-1 -> OUT-1 line S1
tap FT-1 -> P-1.discharge.line
signal FT-1 -> FIC-1 electrical
signal FIC-1 -> FV-1 electrical
tap LT-1 -> D-1.inlet
signal LT-1 -> LIC-1 electrical
signal LIC-1 -> V-2 electrical
loop FC-1 measure FT-1 controller FIC-1 manipulate FV-1
loop LC-2 measure LT-1 controller LIC-1 manipulate V-2
alarm LAH-1 from LT-1 condition high priority high
