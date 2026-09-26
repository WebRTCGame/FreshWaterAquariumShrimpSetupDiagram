pid
layout auto
fit page
title "Min loop"
project "Regress"
sheet 1 of 1

line L-1 size 2 service PW number 1 spec CS150

equipment P-1 pump at 160,280
nozzle NZ-P1-S on P-1 port suction size 2" rating 150
nozzle NZ-P1-D on P-1 port discharge size 2" rating 150
valve FV-1 control "Feed control valve" normal open fail closed mode auto
equipment T-1 tank "Surge tank" at 460,280
nozzle NZ-T1-I on T-1 port inlet size 2" rating 150
nozzle NZ-T1-O on T-1 port outlet size 2" rating 150
instrument FT-1 field "Feed flow transmitter"
instrument FIC-1 dcs "Feed flow controller" loop 1
stub FEED-1 at 40,280

FEED-1 -> P-1.suction line L-1
P-1.discharge -> FV-1.left line L-1
FV-1.right -> T-1.inlet line L-1
tap FT-1 -> P-1.discharge.line
signal FT-1 -> FIC-1 electrical
signal FIC-1 -> FV-1 electrical
loop FC-1 measure FT-1 controller FIC-1 manipulate FV-1
