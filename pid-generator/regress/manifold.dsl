pid
layout auto
fit page
title "Branch manifold"
project "Regress"
sheet 1 of 1

# Three branches off a supply header, each its own size, each with its own valve, all
# returning to a common return header. Built to cover what the corpus does not:
#   - two junctions with FOUR lines each (1 in / 3 out, and 3 in / 1 out), so fan-out
#     pairs exist in quantity. min.dsl and split.dsl produce ZERO fan-out pairs, which
#     is why T3.4 could not be designed against (9.62).
#   - DIFFERENT sizes per branch, so a valve's two ends differ and the derived size has
#     to report a pair such as 2"x4" rather than one number.
#   - a real route for the nearest-equipment walk: valve -> junction -> vessel nozzle.

line L-100 size 2 service PW number 100 spec CS150
line L-200 size 3 service PW number 300 spec CS150
line L-300 size 4 service PW number 400 spec CS300
line L-400 size 4 service CW number 500 spec CS300

equipment P-1 pump "Circulation pump"
nozzle NZ-P1-S on P-1 port suction size 4" rating 150
nozzle NZ-P1-D on P-1 port discharge size 4" rating 150

equipment T-1 tank "Branch 1 vessel"
nozzle NZ-T1-I on T-1 port inlet size 2" rating 150
nozzle NZ-T1-O on T-1 port outlet size 2" rating 150

equipment T-2 tank "Branch 2 vessel"
nozzle NZ-T2-I on T-2 port inlet size 3" rating 150
nozzle NZ-T2-O on T-2 port outlet size 3" rating 150

equipment T-3 tank "Branch 3 vessel"
nozzle NZ-T3-I on T-3 port inlet size 4" rating 150
nozzle NZ-T3-O on T-3 port outlet size 4" rating 150

# V-1 is a CONTROL valve so the loop has a legal output; the others are manual blocks.
valve V-1 control "Branch 1 control valve" normal open fail closed mode auto
valve V-2 gate "Branch 2 block valve" normal open
valve V-3 gate "Branch 3 block valve" normal open
valve V-4 gate "Return block valve" normal open

instrument FT-1 field "Header flow transmitter"
instrument FT-2 field "Branch 1 flow transmitter"
instrument FIC-1 dcs "Branch 1 flow controller" loop 1

stub SUPPLY-1 at 40,300
stub DISCHARGE-1 at 900,300

junction J-H
junction J-R

# supply -> pump -> supply header
SUPPLY-1 -> P-1.suction line L-400
P-1.discharge -> V-4.left line L-400
V-4.right -> J-H line L-400

# header -> three branches, one per size
J-H -> V-1.left line L-100
V-1.right -> T-1.inlet line L-100
J-H -> V-2.left line L-200
V-2.right -> T-2.inlet line L-200
J-H -> V-3.left line L-300
V-3.right -> T-3.inlet line L-300

# three returns -> return header -> out
T-1.outlet -> J-R line L-100
T-2.outlet -> J-R line L-200
T-3.outlet -> J-R line L-300
J-R -> DISCHARGE-1 line L-400

tap FT-1 -> P-1.discharge.line
tap FT-2 -> V-1.right.line
signal FT-1 -> FIC-1 electrical
signal FIC-1 -> V-1 electrical
loop FC-1 measure FT-1 controller FIC-1 manipulate V-1
