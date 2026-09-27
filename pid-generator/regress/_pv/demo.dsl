pid
layout auto
fit page
stub 8
title "TK-101 Pump-Out to Battery Limit"
project "Tank Farm - Product Pumphouse"
sheet 1 of 1
rev "1" "2026-09-06" "Issued for Review"

line L-101 size 4 service HC number 101 spec 1C1 ins H thick 25
line L-102 size 3 service HC number 102 spec 1C1 ins H thick 25
line L-104 size 2 service HC number 104 spec 1C1

version 1

equipment TK-101 tank "Product storage tank" service "Storage" area "Tank Farm" status existing
nozzle NZ-TK-O on TK-101 port outlet size 4" rating 150
nozzle NZ-TK-LT on TK-101 port top size 2" rating 150
equipment P-101 pump "Loading pump" service "Transfer" area "Pumphouse" status existing
nozzle NZ-P101-S on P-101 port suction size 4" rating 150
nozzle NZ-P101-D on P-101 port discharge size 3" rating 150
valve V-101 gate "Suction block" normal open
valve V-102 check "Discharge check"
valve V-103 gate "Manifold inlet block" normal open
valve FV-101 control "Flow control" normal open fail closed mode auto
valve V-104 gate "Manifold outlet block" normal open
valve V-105 gate "Bypass block" normal closed
valve V-106 gate "Tank drain" normal closed
valve PSV-101 relief "Thermal relief" set-pressure 150psi
nozzle NZ-PSV101 on PSV-101 port inlet size 2" rating 150
junction J-0
junction J-1
junction J-2
offpage OP-101 ref "Battery limit, to loading"
offpage OP-CD ref "Closed drain header"
instrument LT-101 field "Tank level transmitter" service "Storage"
instrument FT-101 field "Loading flow transmitter" service "Transfer"
instrument FIC-101 dcs "Loading flow controller" loop 101
instrument PI-101 field "Discharge pressure gauge" service "Transfer"

TK-101.outlet -> J-0 line L-101 flow forward
J-0 -> V-101.left line L-101 flow forward
V-101.right -> P-101.suction line L-101 flow forward
J-0 -> V-106.left line L-104 flow forward
V-106.right -> OP-CD line L-104 flow forward
P-101.discharge -> V-102.left line L-102 flow forward
V-102.right -> J-1 line L-102 flow forward
J-1 -> V-103.left line L-102 flow forward
V-103.right -> FV-101.left line L-102 flow forward
FV-101.right -> V-104.left line L-102 flow forward
V-104.right -> J-2 line L-102 flow forward
J-1 -> V-105.left line L-102 flow forward
V-105.right -> J-2 line L-102 flow forward
J-2 -> OP-101 line L-102 flow forward
J-1 -> PSV-101.inlet
PSV-101.discharge -> OP-CD
protects PSV-101 -> P-101
discharges PSV-101 -> OP-CD

tap LT-101 -> TK-101.top
tap FT-101 -> P-101.discharge.line
tap PI-101 -> P-101.discharge.line
signal FT-101 -> FIC-101 electrical
signal FIC-101 -> FV-101 electrical
alarm LAH-101 from LT-101 condition high
alarm LAL-101 from LT-101 condition low
