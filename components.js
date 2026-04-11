export const components = {
  'Main Systems': [
    { 
      id: 'TK_101', 
      name: 'Main Tank (TK-101)', 
      desc: '125 GAL Freshwater Planted',
      status: 'operational',
      details: {
        specs: 'Glass aquarium, 72" × 18" × 24", rimless preferred',
        priceRange: '$200-400',
        preferredBrands: 'Waterbox, Red Sea, Innovative Marine',
        alternatives: 'Aqueon, MarineLand, Custom builds',
        maintenance: {
          daily: 'Visual inspection, feeding',
          weekly: 'Water testing, algae cleaning',
          monthly: 'Deep clean, equipment check'
        },
        notes: 'Choose low-iron glass for better clarity. Ensure level placement.',
        suppliers: 'Local fish stores, BRS, Amazon'
      }
    },
    { 
      id: 'P_201', 
      name: 'Main Circulation Pump (P-201)', 
      desc: '400 GPH, 30W, Shrimp-Safe',
      status: 'operational',
      details: {
        specs: 'Variable speed, 300-500 GPH, ceramic shaft, silent operation',
        priceRange: '$80-150',
        operatingCost: {
          monthly: '$3.11 (30W × 24hrs × 30days × $0.14/kWh)',
          yearly: '$36.79 (30W continuous operation)'
        },
        preferredBrands: 'Sicce Syncra, Eheim Compact+',
        alternatives: 'Aquatop, Hydor, Danner Mag-Drive',
        maintenance: {
          monthly: 'Clean impeller and housing',
          quarterly: 'Full disassembly and descale',
          yearly: 'Replace impeller if needed'
        },
        notes: 'Choose ceramic shaft for longevity. Avoid metal impellers with shrimp.',
        suppliers: 'BRS, Amazon, Marine Depot'
      }
    },
    { 
      id: 'CONT_101', 
      name: 'Parameter Controller (CONT-101)', 
      desc: 'Main System Controller',
      status: 'operational',
      details: {
        specs: 'pH, temp, conductivity monitoring, data logging, WiFi enabled',
        priceRange: '$150-300',
        operatingCost: {
          monthly: '$0.52 (5W × 24hrs × 30days × $0.14/kWh)',
          yearly: '$6.13 (continuous monitoring)'
        },
        preferredBrands: 'Neptune Apex Jr, Hydros Control',
        alternatives: 'ReefPi (DIY), Basic pH controllers',
        maintenance: {
          monthly: 'Calibrate probes, clean sensors',
          quarterly: 'Replace probe solutions',
          yearly: 'Replace pH and conductivity probes'
        },
        notes: 'Essential for automated systems. Choose expandable platform.',
        suppliers: 'BRS, Marine Depot, Neptune Systems'
      }
    }
  ],
  'Filtration': [
    { 
      id: 'PRE_FIL', 
      name: 'Prefilter (FIL-201)', 
      desc: 'Dual-Density Foam, 100μm',
      status: 'maintenance',
      details: {
        specs: '100μm mechanical filtration, easy access design',
        priceRange: '$30-60',
        preferredBrands: 'Fluval, Eheim pre-filter',
        alternatives: 'DIY PVC housing, Aquaclear',
        maintenance: {
          weekly: 'Rinse foam in tank water',
          monthly: 'Replace fine filter floss',
          quarterly: 'Replace foam media'
        },
        notes: 'Critical for protecting pump. Size for 2x flow rate.',
        suppliers: 'LFS, Amazon, Chewy'
      }
    },
    { 
      id: 'BIO_RX', 
      name: 'Bioreactor (BIO-201)', 
      desc: 'Matrix + Bio Rings',
      status: 'operational',
      details: {
        specs: 'High-surface area biomedia, 20-30 GPH flow rate',
        priceRange: '$40-80 (media), $20-50 (reactor)',
        preferredBrands: 'Seachem Matrix, Fluval BioMax',
        alternatives: 'Ceramic rings, Lava rock, K1 media',
        maintenance: {
          monthly: 'Light rinse in tank water',
          quarterly: 'Replace 25% of media',
          yearly: 'Full media replacement'
        },
        notes: 'Never over-clean. Bacteria need stable environment.',
        suppliers: 'BRS, Amazon, Petco'
      }
    },
    { 
      id: 'MIN_RX', 
      name: 'pH Buffer Tower (MIN-301)', 
      desc: 'Crushed Coral + Aragonite',
      status: 'operational',
      details: {
        specs: 'Calcium carbonate media, slow flow for dissolution',
        priceRange: '$15-30 per bag',
        preferredBrands: 'CaribSea Aragonite, Seachem Reef Buffer',
        alternatives: 'Crushed oyster shell, Limestone chips',
        maintenance: {
          monthly: 'Check media level, test KH',
          quarterly: 'Top up media as dissolved',
          yearly: 'Replace all media'
        },
        notes: 'Essential for soft water areas. Monitor pH carefully.',
        suppliers: 'Marine stores, Amazon, BRS'
      }
    },
    { 
      id: 'OX_RX', 
      name: 'Redox Reactor (OX-401)', 
      desc: 'Zeolite + Purigen',
      status: 'operational',
      details: {
        specs: 'Chemical filtration, ammonia/organic removal',
        priceRange: '$25-45 (Purigen), $10-20 (Zeolite)',
        preferredBrands: 'Seachem Purigen, API Zeolite',
        alternatives: 'Activated carbon, Chemipure',
        maintenance: {
          monthly: 'Monitor color change',
          'as-needed': 'Regenerate Purigen with bleach',
          quarterly: 'Replace zeolite'
        },
        notes: 'Purigen is regenerable. Zeolite removes ammonia.',
        suppliers: 'Petco, Amazon, BRS'
      }
    },
    { 
      id: 'DEG_COL', 
      name: 'Degasser (DEG-501)', 
      desc: 'Trickling Tower, Bio Balls',
      status: 'operational',
      details: {
        specs: 'CO₂ outgassing, surface agitation, trickling design',
        priceRange: '$50-120',
        preferredBrands: 'Custom PVC build, Lifegard',
        alternatives: 'DIY with bio-balls, Air stones',
        maintenance: {
          weekly: 'Clean bio-balls',
          monthly: 'Check water flow',
          'as-needed': 'Adjust trickle rate'
        },
        notes: 'Reduces CO₂ levels. May need bypass for planted tanks.',
        suppliers: 'DIY build recommended, Amazon for parts'
      }
    },
    { 
      id: 'FIL_101', 
      name: 'Left Corner Sponge (FIL-101)', 
      desc: 'Mechanical Filtration',
      status: 'operational',
      details: {
        specs: 'Dual-density sponge, 30-45 PPI foam',
        priceRange: '$15-35',
        preferredBrands: 'ATI Hydro Sponge, Fluval Edge',
        alternatives: 'DIY with aquarium foam, Aquaclear sponges',
        maintenance: {
          weekly: 'Squeeze clean in tank water',
          monthly: 'Rinse thoroughly',
          'quarterly': 'Replace if deteriorating'
        },
        notes: 'Never use tap water to clean. Gentle maintenance only.',
        suppliers: 'LFS, Amazon, Aquarium Co-op'
      }
    },
    { 
      id: 'FIL_102', 
      name: 'Right Corner Sponge (FIL-102)', 
      desc: 'Biological Filtration',
      status: 'operational',
      details: {
        specs: 'Biomedia chamber, Matrix Mini + coarse foam',
        priceRange: '$20-45',
        preferredBrands: 'Seachem Matrix Mini, ATI Hydro Sponge',
        alternatives: 'Ceramic rings, Bio-balls, Lava rock',
        maintenance: {
          monthly: 'Light rinse in tank water only',
          quarterly: 'Replace outer foam if needed',
          yearly: 'Replace 25% of biomedia'
        },
        notes: 'Primary biological filtration. Handle with care.',
        suppliers: 'BRS, Amazon, Local stores'
      }
    },
    { 
      id: 'FIL_103', 
      name: 'Matten Filter (FIL-103)', 
      desc: 'Combined Filtration',
      status: 'operational',
      details: {
        specs: 'PPI-20 foam wall, 6" height, air-driven flow',
        priceRange: '$25-50',
        preferredBrands: 'Poret foam, Swiss Tropicals',
        alternatives: 'Aquarium foam sheets, DIY setup',
        maintenance: {
          monthly: 'Vacuum detritus from base',
          quarterly: 'Squeeze foam gently in tank water',
          yearly: 'Replace foam if degraded'
        },
        notes: 'Excellent for shrimp tanks. Very gentle flow.',
        suppliers: 'Swiss Tropicals, eBay, Amazon'
      }
    }
  ],
  'Sensors & Instruments': [
    {
      id: 'PH_101',
      name: 'pH Sensor (pH-101)',
      desc: 'pH Monitoring',
      status: 'operational',
      details: {
        specs: 'Digital pH probe, 0.01 accuracy, temperature compensation',
        priceRange: '$50-120',
        preferredBrands: 'Milwaukee, Hanna Instruments, Neptune',
        alternatives: 'API pH test kit, Seachem pH Alert',
        maintenance: {
          weekly: 'Check readings vs test kit',
          monthly: 'Calibrate with buffer solutions',
          'quarterly': 'Replace probe storage solution',
          yearly: 'Replace pH probe'
        },
        notes: 'Critical for shrimp health (6.5-7.5 range). Store in KCl solution.',
        suppliers: 'BRS, Amazon, Hanna Direct'
      }
    },
    {
      id: 'TDS_102',
      name: 'TDS Meter (TDS-102)',
      desc: 'Total Dissolved Solids',
      status: 'operational',
      details: {
        specs: 'Digital conductivity meter, 0-2000 ppm range, ATC',
        priceRange: '$15-40',
        preferredBrands: 'HM Digital, Hanna, Milwaukee',
        alternatives: 'GH/KH test kits, Conductivity pen',
        maintenance: {
          monthly: 'Calibrate with standard solution',
          'as-needed': 'Clean probe tip',
          yearly: 'Replace if drift occurs'
        },
        notes: 'Shrimp prefer 150-250 TDS. Monitor after water changes.',
        suppliers: 'Amazon, eBay, Aquarium stores'
      }
    },
    {
      id: 'TE_103',
      name: 'Temperature Probe (TE-103)',
      desc: 'Temperature Monitoring',
      status: 'operational',
      details: {
        specs: 'Digital thermistor, ±0.1°C accuracy, waterproof',
        priceRange: '$20-50',
        preferredBrands: 'Neptune, Hydros, OneTemp',
        alternatives: 'Glass thermometer, Digital aquarium thermometer',
        maintenance: {
          monthly: 'Verify accuracy vs reference thermometer',
          'as-needed': 'Clean probe housing',
          yearly: 'Recalibrate or replace'
        },
        notes: 'Shrimp need stable 72-78°F. Place away from heaters.',
        suppliers: 'BRS, Marine Depot, Amazon'
      }
    },
    {
      id: 'DO_106',
      name: 'Dissolved Oxygen (DO-106)',
      desc: 'Oxygen Level Monitoring',
      status: 'operational',
      details: {
        specs: 'Optical DO sensor, 0-20 mg/L range, temperature compensated',
        priceRange: '$200-400',
        preferredBrands: 'Hanna, YSI, Atlas Scientific',
        alternatives: 'Drop checker, Surface agitation observation',
        maintenance: {
          monthly: 'Check calibration',
          'quarterly': 'Replace sensor cap',
          yearly: 'Full sensor replacement'
        },
        notes: 'Target 6-8 mg/L. Essential for high bioload systems.',
        suppliers: 'Hanna Direct, BRS, Laboratory suppliers'
      }
    },
    {
      id: 'ORP_105',
      name: 'Redox Potential (ORP-105)',
      desc: 'Oxidation-Reduction Potential',
      status: 'operational',
      details: {
        specs: 'Platinum electrode, -2000 to +2000 mV range',
        priceRange: '$80-150',
        preferredBrands: 'Milwaukee, Hanna, Neptune',
        alternatives: 'Water quality test strips, Visual water assessment',
        maintenance: {
          monthly: 'Clean electrode with soft brush',
          'quarterly': 'Calibrate with standard solutions',
          yearly: 'Replace electrode if needed'
        },
        notes: 'Target 300-450 mV for healthy system. Indicates water quality.',
        suppliers: 'BRS, Hanna Direct, Marine Depot'
      }
    },
    {
      id: 'LVL_107',
      name: 'Water Level Sensor (LVL-107)',
      desc: 'Tank Level Monitoring',
      status: 'operational',
      details: {
        specs: 'Optical or float sensor, normally open/closed contacts',
        priceRange: '$25-60',
        preferredBrands: 'Neptune, Hydros, Tunze',
        alternatives: 'Manual level checking, Overflow protection only',
        maintenance: {
          monthly: 'Clean sensor lens/float',
          'quarterly': 'Test alarm functionality',
          'as-needed': 'Adjust sensor position'
        },
        notes: 'Prevents pump damage from low water. Essential for ATO.',
        suppliers: 'BRS, Amazon, Neptune Systems'
      }
    }
  ],
  'Heating & Climate': [
    {
      id: 'HTR_101',
      name: 'Main Heater (HTR-101)',
      desc: '200W',
      status: 'operational',
      details: {
        specs: 'Submersible, adjustable thermostat, 200W for 125 gal',
        priceRange: '$25-50',
        operatingCost: {
          monthly: '$12.44 (200W × 50% duty cycle × 24hrs × 30days × $0.14/kWh)',
          yearly: '$147.17 (varies by season - winter higher, summer lower)'
        },
        preferredBrands: 'Eheim Jager, Fluval E-Series, Aqueon Pro',
        alternatives: 'Hydor Theo, Marineland Precision, Generic heaters',
        maintenance: {
          monthly: 'Check temperature accuracy',
          'quarterly': 'Clean algae from heater',
          yearly: 'Replace if temperature drift occurs'
        },
        notes: 'Rule: 5W per gallon. Use controller for safety. Never adjust while hot.',
        suppliers: 'Petco, Amazon, BRS'
      }
    },
    {
      id: 'HTR_102',
      name: 'Backup Heater (HTR-102)',
      desc: '100W',
      status: 'operational',
      details: {
        specs: 'Secondary heater, 100W, separate controller circuit',
        priceRange: '$20-40',
        operatingCost: {
          monthly: '$1.56 (100W × 15% duty cycle × 24hrs × 30days × $0.14/kWh)',
          yearly: '$18.43 (backup operation only)'
        },
        preferredBrands: 'Eheim Jager, Aqueon Pro, Fluval M-Series',
        alternatives: 'Same brand as primary, Lower wattage models',
        maintenance: {
          monthly: 'Test activation temperature',
          'quarterly': 'Verify controller function',
          yearly: 'Replace preventively with main heater'
        },
        notes: 'Backup prevents cold shock. Set 2°F lower than main.',
        suppliers: 'Same as main heater suppliers'
      }
    },
    {
      id: 'HTR_CONT',
      name: 'Temperature Controller',
      desc: 'Heating System Control',
      status: 'operational',
      details: {
        specs: 'Digital controller, ±0.5°F accuracy, high/low alarms',
        priceRange: '$40-80',
        preferredBrands: 'Inkbird, Ranco, Johnson Controls',
        alternatives: 'Built-in heater thermostats, Manual monitoring',
        maintenance: {
          monthly: 'Calibrate temperature reading',
          'quarterly': 'Test alarm functions',
          'as-needed': 'Clean probe and housing'
        },
        notes: 'Essential safety device. Prevents overheating disasters.',
        suppliers: 'Amazon, eBay, HVAC suppliers'
      }
    }
  ],
  'CO₂ System': [
    {
      id: 'CO2_CYL',
      name: 'CO₂ Cylinder (CO₂-201)',
      desc: 'CO₂ Supply',
      status: 'operational',
      details: {
        specs: '5-20 lb aluminum cylinder, CGA320 threading, food grade',
        priceRange: '$80-150 (new), $15-25 (refill)',
        preferredBrands: 'Luxfer, Catalina, Local welding supply',
        alternatives: 'Paintball tanks (smaller), CO₂ cartridges (disposable)',
        maintenance: {
          'monthly': 'Check pressure gauge',
          'as-needed': 'Refill when pressure drops to 200 psi',
          'every-5-years': 'Hydrostatic testing (required)'
        },
        notes: 'Larger tanks = fewer refills. Get hydro-tested cylinders.',
        suppliers: 'Welding supply, Airgas, Beverage suppliers'
      }
    },
    {
      id: 'CO2_REG',
      name: 'CO₂ Regulator (CO₂-202)',
      desc: 'Dual Stage, Solenoid',
      status: 'operational',
      details: {
        specs: 'Dual-stage regulator, 0-60 psi working pressure, CGA320',
        priceRange: '$80-200',
        preferredBrands: 'Milwaukee, CO2Art, Aquatek',
        alternatives: 'Single-stage regulators, DIY yeast systems',
        maintenance: {
          'monthly': 'Check for leaks with soapy water',
          'quarterly': 'Verify pressure accuracy',
          'yearly': 'Service diaphragms and seals'
        },
        notes: 'Dual-stage prevents pressure fluctuations. Essential for stability.',
        suppliers: 'BRS, CO2Art, Amazon'
      }
    },
    {
      id: 'CO2_SOL',
      name: 'Solenoid Valve (CO₂-203)',
      desc: '12V DC Control',
      status: 'operational',
      details: {
        specs: '12V DC solenoid, normally closed, timer controlled',
        priceRange: '$30-60',
        preferredBrands: 'ASCO, Parker, Aquatek integrated',
        alternatives: 'Manual needle valve, 24V AC solenoids',
        maintenance: {
          'monthly': 'Test on/off operation',
          'quarterly': 'Check for gas leaks',
          'as-needed': 'Clean valve seat if sticking'
        },
        notes: 'Turns off CO₂ at night. Prevents pH swings and waste.',
        suppliers: 'BRS, Amazon, Industrial suppliers'
      }
    },
    {
      id: 'CO2_DIFF',
      name: 'CO₂ Diffuser (CO₂-205)',
      desc: 'CO₂ Injection Point',
      status: 'operational',
      details: {
        specs: 'Ceramic or glass diffuser, fine bubble production',
        priceRange: '$20-50',
        preferredBrands: 'ADA, CO2Art, Fluval',
        alternatives: 'Reactor chamber, Powerhead venturi, DIY ladder',
        maintenance: {
          'weekly': 'Count bubbles per second',
          'monthly': 'Clean with bleach solution',
          'quarterly': 'Replace if bubble size increases'
        },
        notes: 'Place near filter intake for distribution. Target 1-2 bps.',
        suppliers: 'BRS, Amazon, Planted tank specialists'
      }
    }
  ],
  'Dosing System': [
    {
      id: 'DOS_PMP_1',
      name: 'Mineral Dosing Pump (DOS-P-101)',
      desc: 'GH/KH+ Dosing',
      status: 'operational',
      details: {
        specs: 'Peristaltic pump, 1-5 mL/min, 1/8" tubing, programmable',
        priceRange: '$40-80',
        operatingCost: {
          monthly: '$0.16 (1.5W × 2hrs/day × 30days × $0.14/kWh)',
          yearly: '$1.84 (intermittent operation)'
        },
        preferredBrands: 'Jebao, Neptune DOS, Kamoer',
        alternatives: 'Manual dosing, Seachem remineralizer',
        maintenance: {
          'weekly': 'Check tubing for wear',
          'monthly': 'Clean pump head',
          'quarterly': 'Replace peristaltic tubing'
        },
        notes: 'Essential for RO water systems. Maintains shrimp mineral needs.',
        suppliers: 'BRS, Amazon, Marine Depot'
      }
    },
    {
      id: 'DOS_PMP_2',
      name: 'Fertilizer Dosing Pump (DOS-P-102)',
      desc: 'Plant Fertilizer',
      status: 'operational',
      details: {
        specs: 'Separate pump for plant nutrients, corrosion resistant',
        priceRange: '$40-80',
        operatingCost: {
          monthly: '$0.16 (1.5W × 2hrs/day × 30days × $0.14/kWh)',
          yearly: '$1.84 (intermittent operation)'
        },
        preferredBrands: 'Jebao, Neptune DOS, Kamoer',
        alternatives: 'Manual fertilizer dosing, Root tabs only',
        maintenance: {
          'weekly': 'Check for fertilizer crystallization',
          'monthly': 'Flush lines with RO water',
          'quarterly': 'Replace tubing and check valve'
        },
        notes: 'Use separate pump to avoid contamination. Dilute fertilizers.',
        suppliers: 'BRS, Amazon, Planted tank stores'
      }
    },
    {
      id: 'DOS_TMR',
      name: 'Dosing Timer Controller',
      desc: 'Automated Dosing Control',
      status: 'operational',
      details: {
        specs: 'Multi-channel timer, 24hr programming, backup memory',
        priceRange: '$25-60',
        preferredBrands: 'Digital timers, Apex modules, Hydros',
        alternatives: 'Manual dosing schedule, Basic outlet timers',
        maintenance: {
          'monthly': 'Verify timing accuracy',
          'quarterly': 'Test backup battery',
          'as-needed': 'Update dosing schedules'
        },
        notes: 'Consistency is key for plant and shrimp health.',
        suppliers: 'Amazon, BRS, Electronic stores'
      }
    }
  ],
  'Air System': [
    {
      id: 'AIR_101',
      name: 'Main Air Compressor (AC-101)',
      desc: 'Primary Air Supply',
      status: 'operational',
      details: {
        specs: 'Diaphragm compressor, 8-12 L/min, oil-free, quiet operation',
        priceRange: '$30-80',
        operatingCost: {
          monthly: '$1.04 (10W × 24hrs × 30days × $0.14/kWh)',
          yearly: '$12.26 (continuous operation)'
        },
        preferredBrands: 'Tetra Whisper, Marina, Fluval',
        alternatives: 'Linear piston pumps, Battery backup pumps',
        maintenance: {
          'monthly': 'Clean air intake filter',
          'quarterly': 'Check diaphragm condition',
          'yearly': 'Replace air stones and tubing'
        },
        notes: 'Critical for aeration and filter operation. Size for depth.',
        suppliers: 'Petco, Amazon, LFS'
      }
    },
    {
      id: 'AIR_102',
      name: 'Backup Air Pump (AC-102)',
      desc: 'USB Backup Air',
      status: 'operational',
      details: {
        specs: 'USB powered, battery backup, 2-4 L/min output',
        priceRange: '$25-50',
        operatingCost: {
          monthly: '$0.31 (3W × 24hrs × 30days × $0.14/kWh)',
          yearly: '$3.68 (standby + occasional use)'
        },
        preferredBrands: 'Hygger, KEDSUM, Pawfly',
        alternatives: 'Battery-powered pumps, Manual aeration',
        maintenance: {
          'monthly': 'Test battery backup function',
          'quarterly': 'Charge/replace batteries',
          'as-needed': 'Clean USB connections'
        },
        notes: 'Essential during power outages. Keep batteries charged.',
        suppliers: 'Amazon, eBay, Aquarium stores'
      }
    },
    {
      id: 'AIR_SPL',
      name: 'Air Manifold (ASP-101)',
      desc: '6-Way Distribution',
      status: 'operational',
      details: {
        specs: '6-outlet manifold, individual flow control, check valves',
        priceRange: '$15-35',
        preferredBrands: 'Pawfly, Hygger, Generic aquarium brands',
        alternatives: 'T-splitters, Individual check valves',
        maintenance: {
          'monthly': 'Check valve operation',
          'quarterly': 'Clean valve seats',
          'as-needed': 'Adjust individual flows'
        },
        notes: 'Prevents backflow between air lines. Essential for reliability.',
        suppliers: 'Amazon, Petco, LFS'
      }
    }
  ],
  'Water Management': [
    {
      id: 'ATO_PMP',
      name: 'Auto Top-Off Pump (ATO-202)',
      desc: '50 GPH Submersible',
      status: 'operational',
      details: {
        specs: 'Small submersible pump, 50 GPH, low voltage, quiet',
        priceRange: '$20-40',
        operatingCost: {
          monthly: '$0.21 (8W × 15min/day × 30days × $0.14/kWh)',
          yearly: '$2.56 (intermittent operation for evaporation replacement)'
        },
        preferredBrands: 'Cobalt, Aquatop, Hygger',
        alternatives: 'Peristaltic pumps, Gravity feed systems',
        maintenance: {
          'monthly': 'Clean pump intake',
          'quarterly': 'Test float switch',
          'as-needed': 'Descale pump housing'
        },
        notes: 'Maintains water level automatically. Prevents salinity swings.',
        suppliers: 'BRS, Amazon, Marine Depot'
      }
    },
    {
      id: 'WC_PMP',
      name: 'Water Change Pump (WC-202)',
      desc: '200 GPH Submersible',
      status: 'operational',
      details: {
        specs: 'Utility pump, 200+ GPH, 1/2" output, portable',
        priceRange: '$30-60',
        preferredBrands: 'Little Giant, Aqueon, Danner',
        alternatives: 'Siphon systems, Manual water changes',
        maintenance: {
          'after-use': 'Rinse and dry pump',
          'monthly': 'Check impeller condition',
          'as-needed': 'Replace worn seals'
        },
        notes: 'Automates water changes. Store dry between uses.',
        suppliers: 'Home Depot, Amazon, Aquarium stores'
      }
    },
    {
      id: 'WC_MIX',
      name: 'Mixing Tank (WC-201)',
      desc: '20 GAL Storage',
      status: 'operational',
      details: {
        specs: '20+ gallon HDPE tank, tight lid, drain valve',
        priceRange: '$25-50',
        preferredBrands: 'Rubbermaid Brute, Food grade containers',
        alternatives: 'Trash cans, Storage totes, Barrel systems',
        maintenance: {
          'after-use': 'Empty and air dry',
          'monthly': 'Clean with vinegar solution',
          'as-needed': 'Replace drain valve seals'
        },
        notes: 'Pre-mix and age water for stable parameters.',
        suppliers: 'Home Depot, Walmart, Restaurant supply'
      }
    }
  ],
  'Lighting': [
    {
      id: 'LGT_101',
      name: 'LED Lighting (LGT-101)',
      desc: 'Full Spectrum Plant Growth',
      status: 'operational',
      details: {
        specs: 'Full spectrum LED, 6500K + red, 0.5-1W per gallon',
        priceRange: '$100-300',
        operatingCost: {
          monthly: '$3.63 (80W × 8hr photoperiod × 30days × $0.14/kWh)',
          yearly: '$42.78 (8-hour daily photoperiod)'
        },
        preferredBrands: 'Fluval Plant 3.0, Finnex, Nicrew',
        alternatives: 'T5HO fluorescent, Basic LED strips',
        maintenance: {
          'monthly': 'Clean LED lenses',
          'quarterly': 'Check for dead LEDs',
          'yearly': 'Replace if significant light loss'
        },
        notes: 'Plants need 30-50 PAR for healthy growth. Timer essential.',
        suppliers: 'BRS, Amazon, Planted tank specialists'
      }
    },
    {
      id: 'LGT_CON',
      name: 'Light Controller',
      desc: 'Lighting Control System',
      status: 'operational',
      details: {
        specs: 'Programmable controller, sunrise/sunset simulation, app control',
        priceRange: '$50-150',
        preferredBrands: 'Kessil, AI, Current USA',
        alternatives: 'Basic timers, Manual on/off',
        maintenance: {
          'monthly': 'Update schedules seasonally',
          'quarterly': 'Clean controller screen',
          'as-needed': 'Update firmware'
        },
        notes: 'Gradual lighting changes prevent plant shock.',
        suppliers: 'BRS, Amazon, Lighting manufacturers'
      }
    },
    {
      id: 'PAR_101',
      name: 'PAR Sensor (PAR-101)',
      desc: 'Light Intensity Monitoring',
      status: 'operational',
      details: {
        specs: 'Quantum sensor, 400-700nm range, waterproof probe',
        priceRange: '$200-500',
        preferredBrands: 'Apogee, Li-Cor, Seneye',
        alternatives: 'PAR meter rental, Phone apps (approximate)',
        maintenance: {
          'monthly': 'Clean sensor lens',
          'quarterly': 'Calibrate if available',
          'as-needed': 'Check cable connections'
        },
        notes: 'Measures actual light plants receive. Professional tool.',
        suppliers: 'BRS, Scientific suppliers, Seneye'
      }
    }
  ],
  'Shrimp Habitat': [
    {
      id: 'SH_MOSS',
      name: 'Moss Fields (SH-101)',
      desc: 'Grazing Area',
      status: 'operational',
      details: {
        specs: 'Java moss, Christmas moss, dense coverage for biofilm',
        priceRange: '$20-40 for initial stock',
        preferredBrands: 'Local aquascapers, Online plant sellers',
        alternatives: 'Riccia, Fissidens, Artificial moss mats',
        maintenance: {
          'monthly': 'Trim overgrown sections',
          'quarterly': 'Remove dead moss',
          'as-needed': 'Propagate to new areas'
        },
        notes: 'Primary food source for shrimp. Never use chemicals.',
        suppliers: 'Aquarium Co-op, eBay, Local hobbyists'
      }
    },
    {
      id: 'SH_CAVES',
      name: 'Rock Caves (SH-102)',
      desc: 'Hiding & Molting Area',
      status: 'operational',
      details: {
        specs: 'Cholla wood, lava rock, ceramic tubes, multiple sizes',
        priceRange: '$30-60',
        preferredBrands: 'SunGrow, Natural materials, Ceramic suppliers',
        alternatives: 'PVC pipes, Commercial shrimp tubes',
        maintenance: {
          'monthly': 'Remove excess detritus',
          'quarterly': 'Boil cholla wood if fungal growth',
          'as-needed': 'Rearrange for variety'
        },
        notes: 'Critical for molting success. Provide various sizes.',
        suppliers: 'Amazon, Shrimp specialty stores, eBay'
      }
    },
    {
      id: 'SH_BREED',
      name: 'Breeding Colony (SH-103)',
      desc: 'Quiet Corner',
      status: 'operational',
      details: {
        specs: 'Dense plant cover, minimal flow, stable parameters',
        priceRange: '$40-80 for plants and setup',
        preferredBrands: 'Mixed plant species, Natural setup',
        alternatives: 'Breeding boxes, Separate breeding tank',
        maintenance: {
          'weekly': 'Gentle observation only',
          'monthly': 'Light pruning if needed',
          'minimal': 'Avoid disturbance during breeding'
        },
        notes: 'Undisturbed area essential for breeding success.',
        suppliers: 'Planted tank stores, Online plant sellers'
      }
    },
    {
      id: 'SH_FEED',
      name: 'Feeding Station (SH-104)',
      desc: 'Supplemental Area',
      status: 'operational',
      details: {
        specs: 'Glass feeding dish, easy cleanup, designated area',
        priceRange: '$5-15',
        preferredBrands: 'Glass petri dishes, Ceramic plates',
        alternatives: 'Flat rocks, Dedicated feeding spots',
        maintenance: {
          'after-feeding': 'Remove uneaten food after 2 hours',
          'weekly': 'Clean feeding dish',
          'as-needed': 'Relocate if flow issues'
        },
        notes: 'Prevents overfeeding. Essential for water quality.',
        suppliers: 'Amazon, Laboratory supply, Pet stores'
      }
    }
  ],
  'Quarantine': [
    {
      id: 'QT_TANK',
      name: 'Quarantine Tank (QT-101)',
      desc: '10 GAL Glass',
      status: 'operational',
      details: {
        specs: '10-20 gallon tank, bare bottom, easy cleaning',
        priceRange: '$15-40',
        preferredBrands: 'Aqueon, MarineLand, Petco brand',
        alternatives: 'Plastic tubs, Hospital tanks',
        maintenance: {
          'after-use': 'Sterilize with bleach solution',
          'monthly': 'Inspect for cracks',
          'storage': 'Keep dry and clean when unused'
        },
        notes: 'Essential for new livestock. Prevents disease spread.',
        suppliers: 'Petco, PetSmart, Local stores'
      }
    },
    {
      id: 'QT_PMP',
      name: 'Quarantine Pump (QT-104)',
      desc: '100 GPH Sponge Safe',
      status: 'operational',
      details: {
        specs: 'Small circulation pump, sponge pre-filter, gentle flow',
        priceRange: '$15-35',
        preferredBrands: 'Cobalt, Aquatop, Mini powerheads',
        alternatives: 'Air stones, Small HOB filters',
        maintenance: {
          'after-use': 'Disinfect and dry store',
          'monthly': 'Check impeller condition',
          'as-needed': 'Replace if contaminated'
        },
        notes: 'Keep separate from main tank equipment.',
        suppliers: 'Amazon, Petco, Marine stores'
      }
    }
  ],
  'Power & Control': [
    {
      id: 'PWR_101',
      name: 'Main Power (PWR-101)',
      desc: 'GFCI Protected',
      status: 'operational',
      details: {
        specs: 'GFCI outlet strip, 15A capacity, aquarium rated',
        priceRange: '$30-80',
        preferredBrands: 'Coralife, Current USA, APC',
        alternatives: 'Individual GFCI outlets, Standard power strips',
        maintenance: {
          'monthly': 'Test GFCI function',
          'quarterly': 'Check for corrosion',
          'as-needed': 'Replace if tripping frequently'
        },
        notes: 'GFCI required by code near water. Safety first.',
        suppliers: 'BRS, Home Depot, Electrical supply'
      }
    },
    {
      id: 'PWR_102',
      name: 'Battery Backup (PWR-102)',
      desc: 'Emergency Power',
      status: 'operational',
      details: {
        specs: 'UPS system, 600-1000VA, modified sine wave acceptable',
        priceRange: '$60-150',
        preferredBrands: 'APC, CyberPower, Tripp Lite',
        alternatives: 'Car inverters, Portable power stations',
        maintenance: {
          'quarterly': 'Test battery capacity',
          'yearly': 'Replace UPS battery',
          'as-needed': 'Update runtime calculations'
        },
        notes: 'Size for pumps and heaters only. Skip lights.',
        suppliers: 'Best Buy, Amazon, Office supply'
      }
    },
    {
      id: 'PWR_TMR',
      name: 'Timer Hub (PWR-TMR)',
      desc: 'Scheduling Control',
      status: 'operational',
      details: {
        specs: 'Digital timer outlets, 24hr/7day programming, backup battery',
        priceRange: '$20-50 each',
        preferredBrands: 'Woods, Intermatic, BN-Link',
        alternatives: 'Smart plugs, Mechanical timers',
        maintenance: {
          'bi-yearly': 'Adjust for daylight saving time',
          'yearly': 'Replace backup battery',
          'as-needed': 'Update schedules seasonally'
        },
        notes: 'Consistency critical for livestock health.',
        suppliers: 'Home Depot, Amazon, Hardware stores'
      }
    }
  ]
};
