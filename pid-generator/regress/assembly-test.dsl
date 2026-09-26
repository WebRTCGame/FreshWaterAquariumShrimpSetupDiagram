pid
layout auto
fit page
title "Assembly Test"
project "Assembly Demo"
sheet 1 of 1

line L1 size 4" service "Process" spec CS150

# Test control-valve-bypass assembly (self-contained)
use control-valve-bypass(tag="FCV-101", line="L1", service="Feed", type="control", fail="closed")

# Add nozzles for all valves in the assembly
# FCV-101-BV1 (gate): inlet, outlet
nozzle NZ-FCV101BV1-1 on FCV-101-BV1 port inlet size 4" rating 150
nozzle NZ-FCV101BV1-2 on FCV-101-BV1 port outlet size 4" rating 150
# FCV-101 (control): inlet, outlet
nozzle NZ-FCV101-1 on FCV-101 port inlet size 4" rating 150
nozzle NZ-FCV101-2 on FCV-101 port outlet size 4" rating 150
# FCV-101-BV2 (gate): inlet, outlet
nozzle NZ-FCV101BV2-1 on FCV-101-BV2 port inlet size 4" rating 150
nozzle NZ-FCV101BV2-2 on FCV-101-BV2 port outlet size 4" rating 150
# FCV-101-BP (gate): inlet, outlet
nozzle NZ-FCV101BP-1 on FCV-101-BP port inlet size 4" rating 150
nozzle NZ-FCV101BP-2 on FCV-101-BP port outlet size 4" rating 150