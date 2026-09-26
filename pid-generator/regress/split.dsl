pid
layout auto
fit page
title "Off-page split"
project "Regress"
sheet 1 of 2

line L-1 size 2 service PW number 1 spec CS150

equipment T-1 tank "Surge tank" at 160,280
nozzle NZ-T1-O on T-1 port outlet size 2" rating 150
equipment P-1 pump at 340,280
nozzle NZ-P1-S on P-1 port suction size 2" rating 150
nozzle NZ-P1-D on P-1 port discharge size 2" rating 150
offpage OP-A at 520,280 ref "Sheet 2, L-1"
offpage OP-B at 160,420 ref "Sheet 2, L-1"
valve V-1 gate "Return block" at 340,420
equipment T-2 tank "Product tank" at 520,420
nozzle NZ-T2-I on T-2 port inlet size 2" rating 150

T-1.outlet -> P-1.suction line L-1
P-1.discharge -> OP-A line L-1
OP-B -> V-1 line L-1
V-1 -> T-2.inlet line L-1
