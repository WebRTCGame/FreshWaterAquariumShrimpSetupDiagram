import { focusOnComponent } from './sidebar.js';

export function initializeTooltips() {
  const tooltip = document.getElementById('component-tooltip');
  const svg = document.getElementById('mySvgId');

  if (!svg) {
    console.error('❌ SVG element #mySvgId not found!');
    return;
  }

  if (!tooltip) {
    console.error('❌ Tooltip element #component-tooltip not found!');
    return;
  }

  console.log('=== INTELLIGENT TOOLTIP INITIALIZATION ===');

  // Clear any existing event markers
  const oldElements = svg.querySelectorAll('[data-tooltip-enabled="true"]');
  oldElements.forEach(el => {
    el.removeAttribute('data-tooltip-enabled');
  });

  // Get ALL elements in the SVG
  const allElements = svg.querySelectorAll('*');
  console.log(`🔍 Scanning ${allElements.length} SVG elements...`);

  let tooltipCount = 0;
  const processedElements = new Set();

  allElements.forEach(element => {
    if (processedElements.has(element)) return;

    const elementText = getElementText(element);
    const elementId = element.getAttribute('id') || '';

    if (elementText || elementId) {
      const componentInfo = extractComponentInfo(elementText, elementId, element);

      if (componentInfo) {
        const targetElement = findBestTooltipTarget(element, svg);

        if (targetElement && !processedElements.has(targetElement)) {
          addIntelligentTooltip(targetElement, componentInfo, tooltip);
          processedElements.add(targetElement);
          processedElements.add(element);
          tooltipCount++;

          const matchType = componentInfo.intelligent ? 'intelligent' : componentInfo.details ? 'detailed' : 'basic';
          console.log(`✅ Added ${matchType} tooltip: ${componentInfo.name} | Text: "${elementText}" | ID: "${elementId}"`);
        }
      }
    }
  });

  console.log(`=== INTELLIGENT TOOLTIP COMPLETE ===`);
  console.log(`🎯 Successfully added ${tooltipCount} intelligent tooltips`);

  if (tooltipCount === 0) {
    console.warn('⚠️ No tooltips detected! Showing sample elements...');
    Array.from(allElements).slice(0, 20).forEach((el, i) => {
      const text = getElementText(el);
      const id = el.getAttribute('id');
      if (text || id) console.log(`  ${i}: ${el.tagName} - Text: "${text}" - ID: "${id}"`);
    });
  }
}

export function getElementText(element) {
  let text = '';

  if (element.textContent) {
    text = element.textContent.trim();
  }

  if (!text) {
    const textNodes = element.querySelectorAll('text, tspan');
    if (textNodes.length > 0) {
      text = Array.from(textNodes).map(node => node.textContent?.trim()).filter(t => t).join(' ');
    }
  }

  return text;
}

// Position the tooltip near the cursor while keeping it within the viewport and main container
export function updateTooltipPosition(event, tooltip) {
  const mainContainer = document.getElementById('main-container');
  const containerRect = mainContainer ? mainContainer.getBoundingClientRect() : { left: 0, top: 0 };

  let x = event.clientX + 15;
  let y = event.clientY - 10;

  const tooltipWidth = 300;
  const tooltipHeight = 200;

  if (x + tooltipWidth > window.innerWidth) {
    x = event.clientX - tooltipWidth - 15;
  }

  if (y + tooltipHeight > window.innerHeight) {
    y = event.clientY - tooltipHeight - 15;
  }

  if (x < containerRect.left) {
    x = containerRect.left + 10;
  }

  if (y < containerRect.top) {
    y = containerRect.top + 10;
  }

  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}

export function extractComponentInfo(text, elementId, element) {
  if (window.sidebarComponents) {
    if (elementId && window.sidebarComponents[elementId]) {
      return window.sidebarComponents[elementId];
    }

    for (const [componentId, componentData] of Object.entries(window.sidebarComponents)) {
      if (elementId && (elementId.includes(componentId) || componentId.includes(elementId))) {
        return componentData;
      }

      if (text && text.includes(componentId)) return componentData;

      if (text && componentData.name) {
        const nameParts = componentData.name.toLowerCase().split(/[\s\-\(\)]+/);
        const textLower = text.toLowerCase();
        const matchCount = nameParts.filter(part => part.length > 2 && textLower.includes(part)).length;
        if (matchCount >= 2) return componentData;
      }

      const variations = getComponentVariations(componentId, componentData);
      for (const variation of variations) {
        if ((elementId && (elementId.includes(variation) || variation.includes(elementId))) || (text && text.toLowerCase().includes(variation.toLowerCase()))) {
          return componentData;
        }
      }
    }
  }

  if (text && text.length > 2) {
    return createIntelligentComponentInfo(text, elementId, element);
  }

  return null;
}

export function getComponentVariations(componentId, componentData) {
  const variations = [componentId];

  if (componentId.includes('_')) {
    variations.push(componentId.replace(/_/g, '-'));
    variations.push(componentId.replace(/_/g, ''));
  }

  const commonVariations = {
    'ATO_PMP': ['ATO-202', 'ATO_202', 'ATO202', 'AUTO TOP-OFF', 'AUTOTOPOFF'],
    'P_201': ['P-201', 'P201', 'PUMP-201', 'CIRCULATION PUMP'],
    'HTR_101': ['HTR-101', 'HTR101', 'HEATER-101', 'MAIN HEATER'],
    'HTR_102': ['HTR-102', 'HTR102', 'HEATER-102', 'BACKUP HEATER'],
    'LGT_101': ['LGT-101', 'LGT101', 'LIGHT-101', 'LED LIGHTING'],
    'DOS_PMP_1': ['DOS-P-101', 'DOS_P_101', 'DOSP101', 'DOSING PUMP 1'],
    'DOS_PMP_2': ['DOS-P-102', 'DOS_P_102', 'DOSP102', 'DOSING PUMP 2'],
    'AIR_101': ['AC-101', 'AC101', 'AIR COMPRESSOR'],
    'AIR_102': ['AC-102', 'AC102', 'BACKUP AIR'],
    'CO2_CYL': ['CO2-201', 'CO2_201', 'CO2 CYLINDER'],
    'CO2_REG': ['CO2-202', 'CO2_202', 'CO2 REGULATOR'],
    'TK_101': ['TANK-101', 'TK101', 'MAIN TANK'],
    'CONT_101': ['CONTROLLER-101', 'CONT101', 'PARAMETER CONTROLLER'],
    'QT_TANK': ['QT-101', 'QT101', 'QUARANTINE'],
    'SH_MOSS': ['SH-101', 'SH101', 'MOSS FIELDS'],
    'SH_CAVES': ['SH-102', 'SH102', 'ROCK CAVES']
  };

  if (commonVariations[componentId]) variations.push(...commonVariations[componentId]);

  if (componentData.name) {
    const name = componentData.name.toLowerCase();
    const nameMatches = name.match(/([a-z]+[\-\s]*\d+)|([a-z]{2,})/g);
    if (nameMatches) variations.push(...nameMatches);
  }

  return variations;
}

export function createIntelligentComponentInfo(text, elementId, element) {
  const info = { name: text, type: 'diagram-element', intelligent: true };

  if (text.match(/tank|vessel|container/i)) {
    info.category = 'Tank/Vessel'; info.desc = 'Water storage or processing vessel';
  } else if (text.match(/pump|motor|circulation/i)) {
    info.category = 'Pump/Motor'; info.desc = 'Water circulation or movement device';
  } else if (text.match(/filter|filtration|media/i)) {
    info.category = 'Filtration'; info.desc = 'Water filtration component';
  } else if (text.match(/sensor|probe|monitor|meter/i)) {
    info.category = 'Instrumentation'; info.desc = 'Monitoring or measurement device';
  } else if (text.match(/heater|heating|temperature/i)) {
    info.category = 'Heating'; info.desc = 'Temperature control system';
  } else if (text.match(/light|lighting|led|lamp/i)) {
    info.category = 'Lighting'; info.desc = 'Illumination system';
  } else if (text.match(/valve|control|flow/i)) {
    info.category = 'Flow Control'; info.desc = 'Flow regulation component';
  } else if (text.match(/air|oxygen|aeration|bubble/i)) {
    info.category = 'Aeration'; info.desc = 'Air supply or oxygenation';
  } else if (text.match(/co2|carbon|gas/i)) {
    info.category = 'Gas System'; info.desc = 'Gas injection or management';
  } else if (text.match(/dose|dosing|chemical|nutrient/i)) {
    info.category = 'Dosing'; info.desc = 'Chemical or nutrient dosing system';
  } else if (text.match(/power|electrical|outlet|battery/i)) {
    info.category = 'Electrical'; info.desc = 'Power and electrical systems';
  } else {
    info.category = 'Component'; info.desc = 'System component';
  }

  if (elementId) info.elementId = elementId;
  return info;
}

export function findBestTooltipTarget(element, svg) {
  let target = element;
  if (element.tagName === 'text' || element.tagName === 'tspan') {
    let parent = element.parentElement;
    while (parent && parent !== svg) {
      if (parent.tagName === 'g') {
        const rect = parent.getBoundingClientRect();
        if (rect.width > 10 && rect.height > 10) { target = parent; break; }
      }
      parent = parent.parentElement;
    }
  }
  return target;
}

export function addIntelligentTooltip(element, componentInfo, tooltip) {
  if (element.hasAttribute('data-tooltip-enabled')) return;

  element.setAttribute('data-tooltip-enabled', 'true');
  element.style.cursor = 'pointer';

  const createContent = () => {
    if (componentInfo.intelligent) return createIntelligentTooltipContent(componentInfo);
    if (componentInfo.details) return createEnhancedTooltipContent(componentInfo);
    return createTooltipContent(componentInfo);
  };

  const mouseEnter = (e) => {
    const content = createContent();
    tooltip.innerHTML = content;
    updateTooltipPosition(e, tooltip);
    tooltip.style.opacity = '1';
    tooltip.classList.add('visible');
  };
  const mouseLeave = () => { tooltip.style.opacity = '0'; tooltip.classList.remove('visible'); };
  const mouseMove = (e) => { if (tooltip.classList.contains('visible')) updateTooltipPosition(e, tooltip); };
  const click = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!componentInfo.intelligent && window.panZoomInstance) {
      focusOnComponent(window.panZoomInstance, componentInfo.id || componentInfo.elementId);
    } else {
      element.style.filter = 'drop-shadow(0 0 8px #00ff88)';
      setTimeout(() => element.style.filter = '', 2000);
    }
  };

  element.addEventListener('mouseenter', mouseEnter);
  element.addEventListener('mouseleave', mouseLeave);
  element.addEventListener('mousemove', mouseMove);
  element.addEventListener('click', click);

  element._tooltipHandlers = { mouseEnter, mouseLeave, mouseMove, click };
}

export function createIntelligentTooltipContent(componentInfo) {
  let html = `<div class="tooltip-title">🔧 ${componentInfo.name}</div>`;
  if (componentInfo.category) html += `<div class="tooltip-desc">📂 ${componentInfo.category}</div>`;
  if (componentInfo.desc) html += `<div style="color: #b0bec5; font-size: 11px; margin-top: 4px;">${componentInfo.desc}</div>`;
  if (componentInfo.elementId) html += `<div style="color: #81c784; font-size: 10px; margin-top: 4px;">🏷️ ID: ${componentInfo.elementId}</div>`;
  html += `<div style="color: #90caf9; font-size: 10px; margin-top: 6px; font-style: italic;">✨ Intelligent detection</div>`;
  return html;
}

export function createEnhancedTooltipContent(componentData) {
  let html = `<div class="tooltip-title">${componentData.name}</div>`;
  if (componentData.desc) html += `<div class="tooltip-desc">${componentData.desc}</div>`;
  if (componentData.status) html += `<div class="tooltip-status ${componentData.status}">${componentData.status}</div>`;

  if (componentData.details) {
    const details = componentData.details;
    if (details.operatingCost && details.operatingCost.monthly) html += `<div class="tooltip-cost">⚡ ${details.operatingCost.monthly}</div>`;
    if (details.priceRange) html += `<div style="color: #81c784; font-size: 11px; margin-top: 4px;">💰 ${details.priceRange}</div>`;
    if (details.specs) {
      const shortSpecs = details.specs.length > 80 ? details.specs.substring(0, 80) + '...' : details.specs;
      html += `<div style="color: #e0e0e0; font-size: 10px; margin-top: 4px;">📋 ${shortSpecs}</div>`;
    }
    if (details.preferredBrands) {
      const shortBrands = details.preferredBrands.length > 60 ? details.preferredBrands.substring(0, 60) + '...' : details.preferredBrands;
      html += `<div style="color: #64b5f6; font-size: 10px; margin-top: 3px;">⭐ ${shortBrands}</div>`;
    }
    if (details.maintenance) {
      const maintenanceItems = Object.entries(details.maintenance).slice(0, 2);
      if (maintenanceItems.length > 0) {
        html += `<div style="color: #ffb74d; font-size: 10px; margin-top: 3px;">🔧 Maintenance:</div>`;
        maintenanceItems.forEach(([freq, task]) => {
          const shortTask = task.length > 40 ? task.substring(0, 40) + '...' : task;
          html += `<div style="color: #ffcc02; font-size: 9px; margin-left: 8px;">• ${freq}: ${shortTask}</div>`;
        });
      }
    }
    if (details.notes && details.notes.length <= 100) html += `<div style="color: #f48fb1; font-size: 10px; margin-top: 4px;">💡 ${details.notes}</div>`;
    if (details.suppliers) {
      const shortSuppliers = details.suppliers.length > 50 ? details.suppliers.substring(0, 50) + '...' : details.suppliers;
      html += `<div style="color: #a5d6a7; font-size: 9px; margin-top: 3px;">🛒 ${shortSuppliers}</div>`;
    }
  }

  html += `<div style="color: #90caf9; font-size: 9px; margin-top: 6px; font-style: italic; border-top: 1px solid #444; padding-top: 4px;">💬 Click sidebar for full details</div>`;
  return html;
}

export function createTooltipContent(componentData) {
  let html = `<div class="tooltip-title">${componentData.name}</div>`;
  if (componentData.desc) html += `<div class="tooltip-desc">${componentData.desc}</div>`;
  if (componentData.status) html += `<div class="tooltip-status ${componentData.status}">${componentData.status}</div>`;
  if (componentData.details && componentData.details.operatingCost && componentData.details.operatingCost.monthly) html += `<div class="tooltip-cost">⚡ ${componentData.details.operatingCost.monthly}</div>`;
  if (componentData.details && componentData.details.priceRange) html += `<div style="color: #81c784; font-size: 11px; margin-top: 4px;">💰 ${componentData.details.priceRange}</div>`;
  return html;
}

export function getComponentData(elementId) {
  if (!window.sidebarComponents) { console.warn('⚠️ Sidebar components not yet loaded'); return null; }
  if (window.sidebarComponents[elementId]) return window.sidebarComponents[elementId];

  for (const [componentId, componentData] of Object.entries(window.sidebarComponents)) {
    if (elementId && (elementId.includes(componentId) || componentId.includes(elementId))) return componentData;
    const variations = getComponentVariations(componentId, componentData);
    for (const variation of variations) if (elementId && (elementId.includes(variation) || variation.includes(elementId))) return componentData;
  }

  return null;
}

export function testTooltips() {
  console.log('=== COMPREHENSIVE TOOLTIP DEBUG ===');
  const svg = document.getElementById('mySvgId');
  const tooltip = document.getElementById('component-tooltip');

  console.log('SVG element:', svg ? '✅ Found' : '❌ Not found');
  console.log('Tooltip element:', tooltip ? '✅ Found' : '❌ Not found');

  if (svg) {
    const allElements = svg.querySelectorAll('*[id]');
    console.log(`📊 Total elements with IDs: ${allElements.length}`);
    console.log('🔍 First 30 elements with IDs:');
    allElements.forEach((el, index) => { if (index < 30) { const rect = el.getBoundingClientRect(); console.log(`  ${index}: ${el.tagName}#${el.getAttribute('id')} (${rect.width.toFixed(0)}x${rect.height.toFixed(0)})`); } });
    const textElements = svg.querySelectorAll('text, tspan');
    console.log(`📝 Text elements: ${textElements.length}`);
    const componentKeys = window.sidebarComponents ? Object.keys(window.sidebarComponents) : [];
    console.log('🎯 Component keys we are looking for:', componentKeys);
    console.log('📄 Available sidebar components:', componentKeys.length);
    const tooltipElements = svg.querySelectorAll('[data-tooltip-enabled="true"]');
    console.log(`✅ Currently tooltip-enabled elements: ${tooltipElements.length}`);

    if (tooltip) {
      tooltip.innerHTML = '<div class="tooltip-title">✅ Test Successful!</div><div class="tooltip-desc">Tooltips are working</div><div class="tooltip-cost">⚡ Manual test</div>';
      tooltip.style.left = '50%'; tooltip.style.top = '50%'; tooltip.style.transform = 'translate(-50%, -50%)'; tooltip.style.opacity = '1'; tooltip.classList.add('visible');
      setTimeout(() => { tooltip.classList.remove('visible'); tooltip.style.transform = ''; }, 4000);
    }
  }

  console.log('🔄 Re-initializing tooltips...');
  initializeTooltips();
}