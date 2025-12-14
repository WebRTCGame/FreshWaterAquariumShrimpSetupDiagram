/* js/graph-full.js
 * Mermaid diagram definition (authoritative source)
 * This file only defines `window.GRAPH_DEFINITION` and contains no UI logic.
 */
window.GRAPH_DEFINITION = `
flowchart
direction LR
 subgraph LEGEND["LEGEND / KEY"]
    direction LR
        LEG_TANK(["Tank"])
        LEG_EQUIP[["Equipment"]]
        LEG_INST{{"Instrument"}}
        LEG_VALVE{{"Valve"]}
        LEG_SUBSTRATE(["Substrate"])
        LEG_PLANTS(["Plants"])
        LEG_BACT(["Bacteria Zone"])
        LEG_SHRIMP(["Shrimp Zone"])
        LEG_DOSING["Dosing"]
        LEG_ACCESS(["Access Point"])
        LEG_LIGHT(["Lighting"])
        LEG_ALARM(["Alarm"])
        LEG_POWER(["Power"])
        LEG_FLOW_OUTPUT(["Flow Output"])
        LEG_ELEC["LEG_ELEC"]
        LEG_WATER_FLOW["LEG_WATER_FLOW"]
        LEG_SIGNAL["LEG_SIGNAL"]
        LEG_AIR_FLOW["LEG_AIR_FLOW"]
        LEG_RECIRC["Recirculation/Return"]
        LEG_OVERFLOW["Overflow/Drain"])
        LEG_FILTRATION(["Filtration Loop"])
        LEG_CHILLER(["Chiller Loop"])
        LEG_WC(["Water Change"])
        LEG_ATO(["Auto Top-Off"])
        LEG_QUAR(["Quarantine"])
  end
 subgraph OVERVIEW["SYSTEM OVERVIEW - WATER FLOW"]
    direction LR
        OV_TANK["MAIN TANK<br>125 GAL"]
        OV_INT["INTERNAL<br>FILTERS"]
        OV_PUMP(("CIRCULATION<br>PUMP<br>400 GPH, 30W, Shrimp-Safe"))
        OV_PRE["MECHANICAL<br>FILTER<br>Dual-Density Foam, 100μm"]
        OV_BIO["BIOLOGICAL<br>FILTER<br>Matrix + Bio Rings"]
        OV_BUF["pH BUFFER<br>TOWER<br>Crushed Coral/Aragonite"]
        OV_REDOX["CHEMICAL<br>FILTER<br>Zeolite + Purigen"]
        OV_DEG["DEGASSER<br>UNIT<br>Trickle Tower, Bio Balls"]
        TEE_OV1["TEE-OV1<br>1IN PVC TEE"]
        TEE_OV2["TEE-OV2<br>1IN PVC TEE"]
        TEE_OV3["TEE-OV3<br>1IN PVC TEE"]
  end
 subgraph MAIN_TANK["MAIN TANK & DIRECT COMPONENTS"]
    direction LR
        TK_101[("MAIN TANK-101<br>6 ft × 18 in × 24 in<br>125 GAL Freshwater Planted")]
        TK_ACC["TK-ACC-1<br>Access Cover"]
        TK_OVF["TK-OVF-1<br>Overflow Protection<br>Standpipe"]
  end
 subgraph INSIDE_MAIN_TANK["INSIDE MAIN TANK"]
    direction LR
        MAIN_TANK
        SUBSTRATE["SUBSTRATE"]
        PLT_ZONE["PLT_ZONE"]
        INT_FIL["INT_FIL"]
        HABITAT["HABITAT"]
  end
 subgraph OUTSIDE_MAIN_TANK["OUTSIDE MAIN TANK"]
    direction LR
        EXT_FIL["EXT_FIL"]
        PUMP["PUMP"]
        AIR_SYS["AIR_SYS"]
        DOS["DOS"]
        HEAT["HEAT"]
        CO2["CO2"]
        ATO["ATO"]
        WC["WC"]
        FEEDER_101["FD-101<br>Auto Feeder"]
        QUAR["QUAR"]
  end
 subgraph ELECTRICAL_DIST["ELECTRICAL DISTRIBUTION"]
    direction LR
        PWR_101["PWR-101<br>Main Power<br>GFCI Protected"]
        PWR_102["PWR-102<br>Battery Backup"]
        PWR_TMR["PWR-TMR<br>Timer Hub"]
        OUTLET_PUMP["OUTLET-PUMP"]
        OUTLET_AIR1["OUTLET-AIR1"]
        OUTLET_AIR2["OUTLET-AIR2"]
        OUTLET_HTR1["OUTLET-HTR1"]
        OUTLET_HTR2["OUTLET-HTR2"]
        OUTLET_CHILLER["OUTLET-CHILLER"]
        OUTLET_FEEDER["OUTLET-FEEDER"]
        OUTLET_DOS1["OUTLET-DOS1"]
        OUTLET_DOS2["OUTLET-DOS2"]
        OUTLET_CO2["OUTLET-CO2"]
        OUTLET_ATO["OUTLET-ATO"]
        OUTLET_TMR["OUTLET-TMR"]
  end
 subgraph CONTROL_MONITORING["CONTROL & MONITORING"]
    direction LR
        INST["INST"]
        PAR_101["PAR-101<br>PAR Sensor"]
        DATA["DATA"]
  end
%% (truncated in this file; full graph preserved in Graph.txt)
`;
