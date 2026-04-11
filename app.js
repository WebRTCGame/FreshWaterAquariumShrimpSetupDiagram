import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.6.0/+esm';
import { graphDefinition } from './diagram.js';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default'
});

async function loadManifest() {
  const res = await fetch('./components/manifest.json');
  if (!res.ok) throw new Error(`Failed to load manifest: ${res.status}`);
  return res.json();
}

async function loadComponentDetails(id) {
  if (window.sidebarComponents[id]?.details) {
    return window.sidebarComponents[id];
  }
  const res = await fetch(`./components/${id}.json`);
  if (!res.ok) throw new Error(`Failed to load component ${id}: ${res.status}`);
  const data = await res.json();
  window.sidebarComponents[id] = data;
  return data;
}

function prefetchAllComponents(manifest) {
  if (!('requestIdleCallback' in window)) return;
  let i = 0;
  const fetchNext = (deadline) => {
    while (i < manifest.length && deadline.timeRemaining() > 5) {
      const item = manifest[i++];
      if (!window.sidebarComponents[item.id]?.details) {
        loadComponentDetails(item.id).catch(() => {});
      }
    }
    if (i < manifest.length) requestIdleCallback(fetchNext);
  };
  requestIdleCallback(fetchNext);
}

// Example of using the render function
const drawDiagram = async function () {
  const element = document.querySelector('#graphDiv');
  const { svg } = await mermaid.render('mySvgId', graphDefinition.trim());
  element.innerHTML = svg.replace(/[ ]*max-width:[ 0-9\.]*px;/i , '');
  var panZoomTiger = svgPanZoom('#mySvgId', {
    zoomEnabled: true,
    controlIconsEnabled: true,
    fit: true,
    center: true,
    dblClickZoomEnabled: true,
    mouseWheelZoomEnabled: true,
    preventMouseEventsDefault: true,
    eventsListenerElement: document.getElementById('graphDiv')
  });
  
  // Store panZoom instance globally for tooltip functionality
  window.panZoomInstance = panZoomTiger;
  
  // Load manifest and populate component list
  const manifest = await loadManifest();
  populateComponentList(panZoomTiger, manifest);
  prefetchAllComponents(manifest);
  
  // Initialize tooltips after diagram is rendered with delay to ensure SVG is fully processed
  setTimeout(() => {
    initializeTooltips();
  }, 1000);
};

function populateComponentList(panZoom, manifest) {
  console.log('📋 Starting to populate component list...');
  
  // Seed globals from slim manifest data (no details yet)
  window.sidebarComponents = {};
  manifest.forEach(item => {
    window.sidebarComponents[item.id] = item;
  });
  
  console.log('📦 Stored', Object.keys(window.sidebarComponents).length, 'components globally for tooltips');
  
  const componentList = document.getElementById('component-list');
  componentList.innerHTML = '';
  
  // Group manifest items by category, preserving order
  const categories = [];
  const categoryMap = {};
  manifest.forEach(item => {
    if (!categoryMap[item.category]) {
      categoryMap[item.category] = [];
      categories.push(item.category);
    }
    categoryMap[item.category].push(item);
  });
  
  categories.forEach(category => {
    const items = categoryMap[category];
    const categoryDiv = document.createElement('div');
    categoryDiv.className = 'component-category';
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'category-title';
    titleDiv.textContent = `${category} (${items.length})`;
    
    const itemsDiv = document.createElement('div');
    itemsDiv.className = 'category-items';
    
    items.forEach(component => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'component-item';
      
      const headerDiv = document.createElement('div');
      headerDiv.className = 'component-item-header';
      
      const mainContent = document.createElement('div');
      mainContent.innerHTML = `<strong>${component.name}</strong><br><small>${component.desc}</small>`;
      mainContent.onclick = () => focusOnComponent(panZoom, component.id);
      
      const expandArrow = document.createElement('div');
      expandArrow.className = 'expand-arrow';
      expandArrow.innerHTML = '▼';
      expandArrow.onclick = (e) => {
        e.stopPropagation();
        loadAndExpandDetails(itemDiv, expandArrow, component.id);
      };
      
      headerDiv.appendChild(mainContent);
      headerDiv.appendChild(expandArrow);
      itemDiv.appendChild(headerDiv);
      
      // Empty placeholder — details loaded on first expand
      const detailsDiv = document.createElement('div');
      detailsDiv.className = 'component-details';
      itemDiv.appendChild(detailsDiv);
      
      itemsDiv.appendChild(itemDiv);
    });
    
    // Toggle category collapse
    titleDiv.onclick = () => {
      itemsDiv.classList.toggle('collapsed');
    };
    
    categoryDiv.appendChild(titleDiv);
    categoryDiv.appendChild(itemsDiv);
    componentList.appendChild(categoryDiv);
  });
  
  // Verify sidebar was populated
  console.log('✅ Sidebar populated with', componentList.children.length, 'categories');
}

function focusOnComponent(panZoom, componentId) {
  // Close sidebar on mobile so the graph is fully visible
  if (window.innerWidth <= 768) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const toggleBtn = document.getElementById('toggle-sidebar');
    sidebar.classList.add('collapsed');
    if (overlay) overlay.classList.remove('visible');
    if (toggleBtn) toggleBtn.textContent = '☰ Show Sidebar';
  }

  const element = document.querySelector(`[id="${componentId}"]`) || document.querySelector(`[id*="${componentId}"]`);
  if (element) {
    const rect = element.getBoundingClientRect();
    const svgRect = document.getElementById('mySvgId').getBoundingClientRect();
    
    // Calculate relative position within SVG
    const relativeX = rect.left - svgRect.left + rect.width / 2;
    const relativeY = rect.top - svgRect.top + rect.height / 2;
    
    // Get current pan and zoom
    const sizes = panZoom.getSizes();
    const centerX = sizes.width / 2;
    const centerY = sizes.height / 2;
    
    // Calculate pan needed to center the component
    const panX = centerX - relativeX;
    const panY = centerY - relativeY;
    
    // Set zoom to 2x for better focus
    panZoom.zoom(6);
    
    // Pan to center the component
    setTimeout(() => {
      const currentPan = panZoom.getPan();
      panZoom.pan({ x: currentPan.x + panX, y: currentPan.y + panY });
    }, 100);
    
    // Highlight the component briefly
    element.style.filter = 'drop-shadow(0 0 10px #ff6b35)';
    setTimeout(() => {
      element.style.filter = '';
    }, 2000);
  }
}

function createComponentDetails(component) {
  const detailsDiv = document.createElement('div');
  detailsDiv.className = 'component-details';
  
  const details = component.details;
  const statusClass = `status-${component.status}`;
  
  let html = `
    <div class="detail-section">
      <div class="detail-title">
        <span class="status-indicator ${statusClass}"></span>
        Status: ${component.status.charAt(0).toUpperCase() + component.status.slice(1)}
      </div>
    </div>
  `;
  
  if (details.specs) {
    html += `
      <div class="detail-section">
        <div class="detail-title">📋 Specifications</div>
        <div class="detail-content">${details.specs}</div>
      </div>
    `;
  }
  
  if (details.priceRange) {
    html += `
      <div class="detail-section">
        <div class="detail-title">💰 Price Range</div>
        <div class="detail-content"><span class="price-range">${details.priceRange}</span></div>
      </div>
    `;
  }
  
  if (details.preferredBrands) {
    html += `
      <div class="detail-section">
        <div class="detail-title">⭐ Recommended Brands</div>
        <div class="detail-content"><span class="brand-preferred">${details.preferredBrands}</span></div>
      </div>
    `;
  }
  
  if (details.alternatives) {
    html += `
      <div class="detail-section">
        <div class="detail-title">🔄 Alternative Options</div>
        <div class="detail-content"><span class="brand-alternative">${details.alternatives}</span></div>
      </div>
    `;
  }
  
  if (details.operatingCost) {
    html += `
      <div class="detail-section">
        <div class="detail-title">⚡ Operating Cost (@ $0.14/kWh)</div>
        <div class="detail-content">
    `;
    
    Object.entries(details.operatingCost).forEach(([period, cost]) => {
      html += `<div class="operating-cost">${period}: ${cost}</div>`;
    });
    
    html += `</div></div>`;
  }
  
  if (details.maintenance) {
    html += `
      <div class="detail-section">
        <div class="detail-title">🔧 Maintenance Schedule</div>
        <div class="detail-content">
    `;
    
    Object.entries(details.maintenance).forEach(([freq, task]) => {
      html += `<div class="maintenance-freq">${freq}: ${task}</div>`;
    });
    
    html += `</div></div>`;
  }
  
  if (details.notes) {
    html += `
      <div class="detail-section">
        <div class="detail-title">💡 Important Notes</div>
        <div class="detail-content">${details.notes}</div>
      </div>
    `;
  }
  
  if (details.suppliers) {
    html += `
      <div class="detail-section">
        <div class="detail-title">🛒 Where to Buy</div>
        <div class="detail-content">${details.suppliers}</div>
      </div>
    `;
  }
  
  detailsDiv.innerHTML = html;
  return detailsDiv;
}

async function loadAndExpandDetails(itemDiv, arrow, componentId) {
  const detailsDiv = itemDiv.querySelector('.component-details');

  // Collapse if already expanded
  if (detailsDiv.classList.contains('expanded')) {
    detailsDiv.classList.remove('expanded');
    arrow.classList.remove('expanded');
    return;
  }

  // Already loaded — just expand
  if (detailsDiv.dataset.loaded === 'true') {
    detailsDiv.classList.add('expanded');
    arrow.classList.add('expanded');
    return;
  }

  // First expand: show spinner, fetch, render
  detailsDiv.innerHTML = '<div class="detail-section"><div class="detail-content loading-details" aria-live="polite" aria-label="Loading details">⏳ Loading details...</div></div>';
  detailsDiv.classList.add('expanded');
  arrow.classList.add('expanded');

  try {
    const component = await loadComponentDetails(componentId);
    const tempDiv = createComponentDetails(component);
    detailsDiv.innerHTML = tempDiv.innerHTML;
    detailsDiv.dataset.loaded = 'true';
  } catch (err) {
    detailsDiv.innerHTML = '<div class="detail-section"><div class="detail-content" style="color:#f44336;" aria-live="assertive">Error: Failed to load details.</div></div>';
  }
}

function initializeTooltips() {
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
  
  // Clear any existing event listeners
  const oldElements = svg.querySelectorAll('[data-tooltip-enabled="true"]');
  oldElements.forEach(el => {
    el.removeAttribute('data-tooltip-enabled');
  });
  
  // Get ALL elements in the SVG
  const allElements = svg.querySelectorAll('*');
  console.log(`🔍 Scanning ${allElements.length} SVG elements...`);
  
  let tooltipCount = 0;
  const processedElements = new Set();
  
  // Strategy 1: Smart text-based detection for ALL elements
  allElements.forEach(element => {
    if (processedElements.has(element)) return;
    
    const elementText = getElementText(element);
    const elementId = element.getAttribute('id') || '';
    
    if (elementText || elementId) {
      const componentInfo = extractComponentInfo(elementText, elementId, element);
      
      if (componentInfo) {
        // Find the best element to attach tooltip to (prefer interactive groups)
        const targetElement = findBestTooltipTarget(element, svg);
        
        if (targetElement && !processedElements.has(targetElement)) {
          addIntelligentTooltip(targetElement, componentInfo, tooltip);
          processedElements.add(targetElement);
          processedElements.add(element);
          tooltipCount++;
          
          const matchType = componentInfo.intelligent ? 'intelligent' : 
                           componentInfo.details ? 'detailed' : 'basic';
          console.log(`✅ Added ${matchType} tooltip: ${componentInfo.name} | Text: "${elementText}" | ID: "${elementId}"`);
        }
      }
    }
  });
  
  console.log(`=== INTELLIGENT TOOLTIP COMPLETE ===`);
  console.log(`🎯 Successfully added ${tooltipCount} intelligent tooltips`);
  
  if (tooltipCount === 0) {
    console.warn('⚠️ No tooltips detected! Showing sample elements...');
    allElements.slice(0, 20).forEach((el, i) => {
      const text = getElementText(el);
      const id = el.getAttribute('id');
      if (text || id) {
        console.log(`  ${i}: ${el.tagName} - Text: "${text}" - ID: "${id}"`);
      }
    });
  }
}

function getElementText(element) {
  // Get text content from element and its children
  let text = '';
  
  // Direct text content
  if (element.textContent) {
    text = element.textContent.trim();
  }
  
  // Check for text in child elements
  if (!text) {
    const textNodes = element.querySelectorAll('text, tspan');
    if (textNodes.length > 0) {
      text = Array.from(textNodes).map(node => node.textContent?.trim()).filter(t => t).join(' ');
    }
  }
  
  return text;
}

function extractComponentInfo(text, elementId, element) {
  // First try to match known sidebar components with comprehensive matching
  if (window.sidebarComponents) {
    // Direct ID match first
    if (elementId && window.sidebarComponents[elementId]) {
      return window.sidebarComponents[elementId];
    }
    
    // Enhanced matching - check both directions and common variations
    for (const [componentId, componentData] of Object.entries(window.sidebarComponents)) {
      // Check if element ID contains component ID or vice versa
      if (elementId && (elementId.includes(componentId) || componentId.includes(elementId))) {
        return componentData;
      }
      
      // Check if text contains the component ID
      if (text && text.includes(componentId)) {
        return componentData;
      }
      
      // Check if text contains the component name parts
      if (text && componentData.name) {
        const nameParts = componentData.name.toLowerCase().split(/[\s\-\(\)]+/);
        const textLower = text.toLowerCase();
        
        // If text contains multiple parts of the component name, it's likely a match
        const matchCount = nameParts.filter(part => part.length > 2 && textLower.includes(part)).length;
        if (matchCount >= 2) {
          return componentData;
        }
      }
      
      // Check for common abbreviations and variations
      const variations = getComponentVariations(componentId, componentData);
      for (const variation of variations) {
        if ((elementId && (elementId.includes(variation) || variation.includes(elementId))) ||
            (text && text.toLowerCase().includes(variation.toLowerCase()))) {
          return componentData;
        }
      }
    }
  }
  
  // If no sidebar match, create intelligent tooltip based on content
  if (text && text.length > 2) {
    return createIntelligentComponentInfo(text, elementId, element);
  }
  
  return null;
}

function getComponentVariations(componentId, componentData) {
  const variations = [componentId];
  
  // Add common variations based on component ID patterns
  if (componentId.includes('_')) {
    variations.push(componentId.replace(/_/g, '-'));
    variations.push(componentId.replace(/_/g, ''));
  }
  
  // Add specific component type variations
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
  
  if (commonVariations[componentId]) {
    variations.push(...commonVariations[componentId]);
  }
  
  // Add name-based variations
  if (componentData.name) {
    const name = componentData.name.toLowerCase();
    // Extract key identifying parts from the name
    const nameMatches = name.match(/([a-z]+[\-\s]*\d+)|([a-z]{2,})/g);
    if (nameMatches) {
      variations.push(...nameMatches);
    }
  }
  
  return variations;
}

function createIntelligentComponentInfo(text, elementId, element) {
  // Analyze the text and element to create meaningful tooltip content
  const info = {
    name: text,
    type: 'diagram-element',
    intelligent: true
  };
  
  // Categorize based on text content patterns
  if (text.match(/tank|vessel|container/i)) {
    info.category = 'Tank/Vessel';
    info.desc = 'Water storage or processing vessel';
  } else if (text.match(/pump|motor|circulation/i)) {
    info.category = 'Pump/Motor';
    info.desc = 'Water circulation or movement device';
  } else if (text.match(/filter|filtration|media/i)) {
    info.category = 'Filtration';
    info.desc = 'Water filtration component';
  } else if (text.match(/sensor|probe|monitor|meter/i)) {
    info.category = 'Instrumentation';
    info.desc = 'Monitoring or measurement device';
  } else if (text.match(/heater|heating|temperature/i)) {
    info.category = 'Heating';
    info.desc = 'Temperature control system';
  } else if (text.match(/light|lighting|led|lamp/i)) {
    info.category = 'Lighting';
    info.desc = 'Illumination system';
  } else if (text.match(/valve|control|flow/i)) {
    info.category = 'Flow Control';
    info.desc = 'Flow regulation component';
  } else if (text.match(/air|oxygen|aeration|bubble/i)) {
    info.category = 'Aeration';
    info.desc = 'Air supply or oxygenation';
  } else if (text.match(/co2|carbon|gas/i)) {
    info.category = 'Gas System';
    info.desc = 'Gas injection or management';
  } else if (text.match(/dose|dosing|chemical|nutrient/i)) {
    info.category = 'Dosing';
    info.desc = 'Chemical or nutrient dosing system';
  } else if (text.match(/power|electrical|outlet|battery/i)) {
    info.category = 'Electrical';
    info.desc = 'Power and electrical systems';
  } else {
    info.category = 'Component';
    info.desc = 'System component';
  }
  
  // Add ID information if available
  if (elementId) {
    info.elementId = elementId;
  }
  
  return info;
}

function findBestTooltipTarget(element, svg) {
  // Find the best element to attach tooltip to (prefer groups with larger interaction areas)
  let target = element;
  
  // If it's a text element, try to find parent group
  if (element.tagName === 'text' || element.tagName === 'tspan') {
    let parent = element.parentElement;
    while (parent && parent !== svg) {
      if (parent.tagName === 'g') {
        // Check if this group has a reasonable size for interaction
        const rect = parent.getBoundingClientRect();
        if (rect.width > 10 && rect.height > 10) {
          target = parent;
          break;
        }
      }
      parent = parent.parentElement;
    }
  }
  
  return target;
}

function addIntelligentTooltip(element, componentInfo, tooltip) {
  if (element.hasAttribute('data-tooltip-enabled')) {
    return;
  }
  
  element.setAttribute('data-tooltip-enabled', 'true');
  element.style.cursor = 'pointer';
  
  // Create enhanced tooltip content for intelligent components
  const createContent = () => {
    if (componentInfo.intelligent) {
      return createIntelligentTooltipContent(componentInfo);
    } else if (componentInfo.details) {
      // Use enhanced content for components with rich sidebar data
      return createEnhancedTooltipContent(componentInfo);
    } else {
      return createTooltipContent(componentInfo);
    }
  };
  
  // Event handlers
  const mouseEnter = (e) => {
    const content = createContent();
    tooltip.innerHTML = content;
    updateTooltipPosition(e, tooltip);
    tooltip.style.opacity = '1';
    tooltip.classList.add('visible');
  };
  
  const mouseLeave = () => {
    tooltip.style.opacity = '0';
    tooltip.classList.remove('visible');
  };
  
  const mouseMove = (e) => {
    if (tooltip.classList.contains('visible')) {
      updateTooltipPosition(e, tooltip);
    }
  };
  
  const click = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // For known components, use focus functionality
    if (!componentInfo.intelligent && window.panZoomInstance) {
      focusOnComponent(window.panZoomInstance, componentInfo.id || componentInfo.elementId);
    } else {
      // For intelligent components, just highlight briefly
      element.style.filter = 'drop-shadow(0 0 8px #00ff88)';
      setTimeout(() => {
        element.style.filter = '';
      }, 2000);
    }
  };
  
  element.addEventListener('mouseenter', mouseEnter);
  element.addEventListener('mouseleave', mouseLeave);
  element.addEventListener('mousemove', mouseMove);
  element.addEventListener('click', click);
  
  // Touch support: tap to show / tap again or tap elsewhere to dismiss
  const TOUCH_MOVE_THRESHOLD = 10; // pixels; below this is treated as a tap, not a drag
  let _touchStartX = 0, _touchStartY = 0;

  const touchStart = (e) => {
    if (e.touches.length === 1) {
      _touchStartX = e.touches[0].clientX;
      _touchStartY = e.touches[0].clientY;
    }
  };

  const touchEnd = (e) => {
    if (e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    // Only treat as tap if finger barely moved
    if (Math.abs(t.clientX - _touchStartX) > TOUCH_MOVE_THRESHOLD || Math.abs(t.clientY - _touchStartY) > TOUCH_MOVE_THRESHOLD) return;
    e.preventDefault(); // prevent ghost click
    e.stopPropagation(); // prevent global body dismiss from firing simultaneously
    if (tooltip.classList.contains('visible')) {
      hideTooltip(tooltip);
    } else {
      const content = createContent();
      tooltip.innerHTML = content;
      positionTooltipForTouch(t, tooltip);
      tooltip.style.opacity = '1';
      tooltip.classList.add('visible');
    }
  };

  element.addEventListener('touchstart', touchStart, { passive: true });
  element.addEventListener('touchend', touchEnd);

  // Store references for cleanup
  element._tooltipHandlers = { mouseEnter, mouseLeave, mouseMove, click, touchStart, touchEnd };
}

function createIntelligentTooltipContent(componentInfo) {
  let html = `<div class="tooltip-title">🔧 ${componentInfo.name}</div>`;
  
  if (componentInfo.category) {
    html += `<div class="tooltip-desc">📂 ${componentInfo.category}</div>`;
  }
  
  if (componentInfo.desc) {
    html += `<div style="color: #b0bec5; font-size: 11px; margin-top: 4px;">${componentInfo.desc}</div>`;
  }
  
  if (componentInfo.elementId) {
    html += `<div style="color: #81c784; font-size: 10px; margin-top: 4px;">🏷️ ID: ${componentInfo.elementId}</div>`;
  }
  
  html += `<div style="color: #90caf9; font-size: 10px; margin-top: 6px; font-style: italic;">✨ Intelligent detection</div>`;
  
  return html;
}

function createEnhancedTooltipContent(componentData) {
  let html = `<div class="tooltip-title">${componentData.name}</div>`;
  
  if (componentData.desc) {
    html += `<div class="tooltip-desc">${componentData.desc}</div>`;
  }
  
  if (componentData.status) {
    html += `<div class="tooltip-status ${componentData.status}">${componentData.status}</div>`;
  }
  
  // Add detailed information from sidebar data
  if (componentData.details) {
    const details = componentData.details;
    
    // Operating cost (priority info)
    if (details.operatingCost) {
      if (details.operatingCost.monthly) {
        html += `<div class="tooltip-cost">⚡ ${details.operatingCost.monthly}</div>`;
      }
    }
    
    // Price range
    if (details.priceRange) {
      html += `<div style="color: #81c784; font-size: 11px; margin-top: 4px;">💰 ${details.priceRange}</div>`;
    }
    
    // Specifications (condensed)
    if (details.specs) {
      const shortSpecs = details.specs.length > 80 ? details.specs.substring(0, 80) + '...' : details.specs;
      html += `<div style="color: #e0e0e0; font-size: 10px; margin-top: 4px;">📋 ${shortSpecs}</div>`;
    }
    
    // Preferred brands
    if (details.preferredBrands) {
      const shortBrands = details.preferredBrands.length > 60 ? details.preferredBrands.substring(0, 60) + '...' : details.preferredBrands;
      html += `<div style="color: #64b5f6; font-size: 10px; margin-top: 3px;">⭐ ${shortBrands}</div>`;
    }
    
    // Quick maintenance info
    if (details.maintenance) {
      const maintenanceItems = Object.entries(details.maintenance).slice(0, 2); // Show first 2 items
      if (maintenanceItems.length > 0) {
        html += `<div style="color: #ffb74d; font-size: 10px; margin-top: 3px;">🔧 Maintenance:</div>`;
        maintenanceItems.forEach(([freq, task]) => {
          const shortTask = task.length > 40 ? task.substring(0, 40) + '...' : task;
          html += `<div style="color: #ffcc02; font-size: 9px; margin-left: 8px;">• ${freq}: ${shortTask}</div>`;
        });
      }
    }
    
    // Important notes (if short enough)
    if (details.notes && details.notes.length <= 100) {
      html += `<div style="color: #f48fb1; font-size: 10px; margin-top: 4px;">💡 ${details.notes}</div>`;
    }
    
    // Supplier info (condensed)
    if (details.suppliers) {
      const shortSuppliers = details.suppliers.length > 50 ? details.suppliers.substring(0, 50) + '...' : details.suppliers;
      html += `<div style="color: #a5d6a7; font-size: 9px; margin-top: 3px;">🛒 ${shortSuppliers}</div>`;
    }
  }
  
  // Add link to sidebar for more details
  html += `<div style="color: #90caf9; font-size: 9px; margin-top: 6px; font-style: italic; border-top: 1px solid #444; padding-top: 4px;">💬 Click sidebar for full details</div>`;
  
  return html;
}

function addTooltipToElement(element, componentId, componentData, tooltip) {
  if (!componentData || element.hasAttribute('data-tooltip-enabled')) {
    return;
  }
  
  element.setAttribute('data-tooltip-enabled', 'true');
  element.style.cursor = 'pointer';
  
  // Remove existing listeners to prevent duplicates
  element.removeEventListener('mouseenter', element._tooltipMouseEnter);
  element.removeEventListener('mouseleave', element._tooltipMouseLeave);
  element.removeEventListener('mousemove', element._tooltipMouseMove);
  element.removeEventListener('click', element._tooltipClick);
  
  // Create new event handlers
  element._tooltipMouseEnter = (e) => {
    console.log(`🖱️ Mouse ENTER on: ${componentId}`);
    showTooltip(e, componentData, tooltip);
  };
  
  element._tooltipMouseLeave = () => {
    console.log(`🖱️ Mouse LEAVE on: ${componentId}`);
    hideTooltip(tooltip);
  };
  
  element._tooltipMouseMove = (e) => {
    if (tooltip.classList.contains('visible')) {
      updateTooltipPosition(e, tooltip);
    }
  };
  
  element._tooltipClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log(`🖱️ CLICKED on: ${componentId}`);
    focusOnComponent(window.panZoomInstance, componentId);
  };
  
  // Add event listeners
  element.addEventListener('mouseenter', element._tooltipMouseEnter);
  element.addEventListener('mouseleave', element._tooltipMouseLeave);
  element.addEventListener('mousemove', element._tooltipMouseMove);
  element.addEventListener('click', element._tooltipClick);
  
  // Make the element more interactive
  element.style.pointerEvents = 'all';
  
  console.log(`✅ Added all events to ${componentId}`);
}

function showTooltip(event, componentData, tooltip) {
  console.log('📋 Showing tooltip for:', componentData.name || componentData.title);
  
  // Choose appropriate content creation method
  let content;
  if (componentData.intelligent) {
    content = createIntelligentTooltipContent(componentData);
  } else if (componentData.details) {
    content = createEnhancedTooltipContent(componentData);
  } else {
    content = createTooltipContent(componentData);
  }
  
  tooltip.innerHTML = content;
  
  // Position first, then show
  updateTooltipPosition(event, tooltip);
  tooltip.style.opacity = '1';
  tooltip.classList.add('visible');
  
  console.log('✅ Enhanced tooltip displayed');
}

function hideTooltip(tooltip) {
  console.log('🔄 Hiding tooltip');
  tooltip.style.opacity = '0';
  tooltip.classList.remove('visible');
  tooltip.classList.remove('touch-positioned');
}

function updateTooltipPosition(event, tooltip) {
  // Get the main container to position relative to the viewport
  const mainContainer = document.getElementById('main-container');
  const containerRect = mainContainer.getBoundingClientRect();
  
  // Use mouse position relative to viewport (not affected by SVG transforms)
  let x = event.clientX + 15;
  let y = event.clientY - 10;
  
  // Ensure tooltip stays within the main container bounds
  const tooltipWidth = 300; // max-width from CSS
  const tooltipHeight = 200; // estimated height
  
  // Adjust horizontal position if tooltip would go off-screen
  if (x + tooltipWidth > window.innerWidth) {
    x = event.clientX - tooltipWidth - 15;
  }
  
  // Adjust vertical position if tooltip would go off-screen
  if (y + tooltipHeight > window.innerHeight) {
    y = event.clientY - tooltipHeight - 15;
  }
  
  // Keep tooltip within container bounds
  if (x < containerRect.left) {
    x = containerRect.left + 10;
  }
  
  if (y < containerRect.top) {
    y = containerRect.top + 10;
  }
  
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}

function positionTooltipForTouch(touch, tooltip) {
  if (window.innerWidth <= 768) {
    // On mobile: show as a bottom sheet so the finger never covers the content
    tooltip.classList.add('touch-positioned');
  } else {
    // On larger touch screens (e.g. Surface): position near touch point like a mouse
    tooltip.classList.remove('touch-positioned');
    updateTooltipPosition({ clientX: touch.clientX, clientY: touch.clientY }, tooltip);
  }
}

function createTooltipContent(componentData) {
  let html = `<div class="tooltip-title">${componentData.name}</div>`;
  
  if (componentData.desc) {
    html += `<div class="tooltip-desc">${componentData.desc}</div>`;
  }
  
  if (componentData.status) {
    html += `<div class="tooltip-status ${componentData.status}">${componentData.status}</div>`;
  }
  
  // Extract operating cost from details
  if (componentData.details && componentData.details.operatingCost) {
    const cost = componentData.details.operatingCost;
    if (cost.monthly) {
      html += `<div class="tooltip-cost">⚡ ${cost.monthly}</div>`;
    }
  }
  
  // Extract price range from details
  if (componentData.details && componentData.details.priceRange) {
    html += `<div style="color: #81c784; font-size: 11px; margin-top: 4px;">💰 ${componentData.details.priceRange}</div>`;
  }
  
  return html;
}

// Component data is now sourced directly from the sidebar components
// No need for duplicate data - everything comes from populateComponentList()

function getComponentData(elementId) {
  // Use the globally stored sidebar components instead of duplicating data
  if (!window.sidebarComponents) {
    console.warn('⚠️ Sidebar components not yet loaded');
    return null;
  }
  
  // Direct match first
  if (window.sidebarComponents[elementId]) {
    return window.sidebarComponents[elementId];
  }
  
  // Enhanced matching using the same logic as extractComponentInfo
  for (const [componentId, componentData] of Object.entries(window.sidebarComponents)) {
    // Basic partial matching
    if (elementId && (elementId.includes(componentId) || componentId.includes(elementId))) {
      console.log(`🔗 Partial match: ${elementId} matched to ${componentId}`);
      return componentData;
    }
    
    // Check component variations
    const variations = getComponentVariations(componentId, componentData);
    for (const variation of variations) {
      if (elementId && (elementId.includes(variation) || variation.includes(elementId))) {
        console.log(`🔗 Variation match: ${elementId} matched to ${componentId} via ${variation}`);
        return componentData;
      }
    }
  }
  
  return null;
}

// Test function for debugging tooltips
function testTooltips() {
  console.log('=== COMPREHENSIVE TOOLTIP DEBUG ===');
  const svg = document.getElementById('mySvgId');
  const tooltip = document.getElementById('component-tooltip');
  
  console.log('SVG element:', svg ? '✅ Found' : '❌ Not found');
  console.log('Tooltip element:', tooltip ? '✅ Found' : '❌ Not found');
  
  if (svg) {
    // Check all elements with IDs
    const allElements = svg.querySelectorAll('*[id]');
    console.log(`📊 Total elements with IDs: ${allElements.length}`);
    
    console.log('🔍 First 30 elements with IDs:');
    allElements.forEach((el, index) => {
      if (index < 30) {
        const rect = el.getBoundingClientRect();
        console.log(`  ${index}: ${el.tagName}#${el.getAttribute('id')} (${rect.width.toFixed(0)}x${rect.height.toFixed(0)})`);
      }
    });
    
    // Check text elements
    const textElements = svg.querySelectorAll('text, tspan');
    console.log(`📝 Text elements: ${textElements.length}`);
    textElements.forEach((el, index) => {
      if (index < 20) {
        console.log(`  Text ${index}: "${el.textContent?.trim()}" (${el.tagName})`);
      }
    });
    
    // Check which component keys we're looking for
    const componentKeys = window.sidebarComponents ? Object.keys(window.sidebarComponents) : [];
    console.log('🎯 Component keys we are looking for:', componentKeys);
    console.log('📄 Available sidebar components:', componentKeys.length);
    
    // Check current tooltip-enabled elements
    const tooltipElements = svg.querySelectorAll('[data-tooltip-enabled="true"]');
    console.log(`✅ Currently tooltip-enabled elements: ${tooltipElements.length}`);
    
    // Test manual tooltip
    if (tooltip) {
      console.log('🧪 Testing manual tooltip...');
      tooltip.innerHTML = '<div class="tooltip-title">✅ Test Successful!</div><div class="tooltip-desc">Tooltips are working</div><div class="tooltip-cost">⚡ Manual test</div>';
      tooltip.style.left = '50%';
      tooltip.style.top = '50%';
      tooltip.style.transform = 'translate(-50%, -50%)';
      tooltip.style.opacity = '1';
      tooltip.classList.add('visible');
      
      setTimeout(() => {
        tooltip.classList.remove('visible');
        tooltip.style.transform = '';
      }, 4000);
    }
  }
  
  // Re-initialize tooltips
  console.log('🔄 Re-initializing tooltips...');
  initializeTooltips();
}

// Sidebar toggle functionality
document.addEventListener('DOMContentLoaded', () => {
  const toggleButton = document.getElementById('toggle-sidebar');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  // Auto-collapse sidebar on mobile screens at startup
  if (window.innerWidth <= 768) {
    sidebar.classList.add('collapsed');
    toggleButton.textContent = '☰ Show Sidebar';
  }

  const closeSidebar = () => {
    sidebar.classList.add('collapsed');
    if (overlay) overlay.classList.remove('visible');
    toggleButton.textContent = '☰ Show Sidebar';
  };

  const openSidebar = () => {
    sidebar.classList.remove('collapsed');
    if (overlay && window.innerWidth <= 768) overlay.classList.add('visible');
    toggleButton.textContent = '☰ Hide Sidebar';
  };

  toggleButton.addEventListener('click', () => {
    if (sidebar.classList.contains('collapsed')) {
      openSidebar();
    } else {
      closeSidebar();
    }
  });

  // Tap the dim overlay to close the sidebar
  if (overlay) {
    overlay.addEventListener('click', closeSidebar);
    overlay.addEventListener('touchend', (e) => {
      e.preventDefault();
      closeSidebar();
    });
  }

  // Global touch-to-dismiss tooltip: tapping empty SVG area hides tooltip
  document.body.addEventListener('touchend', (e) => {
    const tooltipEl = document.getElementById('component-tooltip');
    if (!tooltipEl || !tooltipEl.classList.contains('visible')) return;
    // Don't dismiss if the touch was on the tooltip itself or a tooltip-enabled element
    if (tooltipEl.contains(e.target) || e.target.closest('[data-tooltip-enabled]')) return;
    hideTooltip(tooltipEl);
  }, { passive: true });
});

try {
  console.log('🎨 Starting diagram initialization...');
  await drawDiagram();
  console.log('✅ Diagram initialization complete');
} catch (error) {
  console.error('❌ Error during diagram initialization:', error);
}

window.testTooltips = testTooltips;
