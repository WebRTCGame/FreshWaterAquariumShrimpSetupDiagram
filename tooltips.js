// Overview subgraph nodes duplicate real components — point them at the real entry
const OVERVIEW_ALIASES = {
  OV_TANK: 'TK_101', OV_PUMP: 'P_201', OV_PRE: 'PRE_FIL', OV_BIO: 'BIO_RX',
  OV_BUF: 'MIN_RX', OV_REDOX: 'OX_RX', OV_DEG: 'DEG_COL'
};

// Mermaid node groups get id="<diagramId>-flowchart-<NODE_ID>-<N>" (prefix varies by version) — exact match, no fuzzy text guessing
function componentForSvgId(id) {
  const m = String(id).match(/flowchart-(.+?)-\d+$/);
  if (!m) return null;
  const cid = m[1];
  if (window.sidebarComponents[cid]) return window.sidebarComponents[cid];
  return OVERVIEW_ALIASES[cid] ? window.sidebarComponents[OVERVIEW_ALIASES[cid]] : null;
}

function initializeTooltips() {
  const tooltip = document.getElementById('component-tooltip');
  const svg = document.getElementById('mySvgId');

  if (!svg || !tooltip) return;

  tooltip.setAttribute('role', 'tooltip');

  // Escape dismisses the tooltip
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTooltip(tooltip);
  });

  // Clear any existing event listeners
  const oldElements = svg.querySelectorAll('[data-tooltip-enabled="true"]');
  oldElements.forEach(el => el.removeAttribute('data-tooltip-enabled'));

  // Bind by exact mermaid node group id only
  svg.querySelectorAll('g[class*="node"]').forEach(g => {
    const component = componentForSvgId(g.id);
    if (component) addTooltip(g, component, tooltip);
  });
}

function addTooltip(element, component, tooltip) {
  if (element.hasAttribute('data-tooltip-enabled')) return;

  element.setAttribute('data-tooltip-enabled', 'true');
  element.style.cursor = 'pointer';
  element.setAttribute('tabindex', '0');

  const showAt = (position) => {
    tooltip.innerHTML = createTooltipContent(component);
    updateTooltipPosition(position, tooltip);
    tooltip.style.opacity = '1';
    tooltip.classList.add('visible');
  };

  const mouseEnter = (e) => showAt(e);
  const mouseLeave = () => hideTooltip(tooltip);

  const mouseMove = (e) => {
    if (tooltip.classList.contains('visible')) {
      updateTooltipPosition(e, tooltip);
    }
  };

  // Keyboard: focus shows tooltip at element center, blur hides
  const focusShow = () => showAt(getElementScreenCenter(element));
  const focusHide = () => hideTooltip(tooltip);

  element.addEventListener('mouseenter', mouseEnter);
  element.addEventListener('mouseleave', mouseLeave);
  element.addEventListener('mousemove', mouseMove);
  element.addEventListener('focus', focusShow);
  element.addEventListener('blur', focusHide);

  const click = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.panZoomInstance) focusOnComponent(window.panZoomInstance, component.id);
  };
  element.addEventListener('click', click);

  // Touch support: tap to show / tap again or tap elsewhere to dismiss
  const TOUCH_MOVE_THRESHOLD = 10; // pixels; below this is treated as a tap, not a drag
  let touchStartX = 0;
  let touchStartY = 0;

  const touchStart = (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  };

  const touchEnd = (e) => {
    if (e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    if (Math.abs(t.clientX - touchStartX) > TOUCH_MOVE_THRESHOLD || Math.abs(t.clientY - touchStartY) > TOUCH_MOVE_THRESHOLD) return;
    e.preventDefault(); // prevent ghost click
    e.stopPropagation(); // prevent global body dismiss from firing simultaneously
    if (tooltip.classList.contains('visible')) {
      hideTooltip(tooltip);
    } else {
      showAt(t);
      if (window.innerWidth <= 768) tooltip.classList.add('touch-positioned');
    }
  };

  element.addEventListener('touchstart', touchStart, { passive: true });
  element.addEventListener('touchend', touchEnd);
}

function createTooltipContent(componentData) {
  let html = `<div class="tooltip-title">${componentData.name}</div>`;

  if (componentData.desc) {
    html += `<div class="tooltip-desc">${componentData.desc}</div>`;
  }

  if (componentData.status) {
    html += `<div class="tooltip-status ${componentData.status}">${componentData.status}</div>`;
  }

  if (!componentData.details) {
    return html;
  }

  const details = componentData.details;

  if (details.operatingCost?.monthly) {
    html += `<div class="tooltip-cost">⚡ ${details.operatingCost.monthly}</div>`;
  }

  if (details.priceRange) {
    html += `<div style="color: #81c784; font-size: 11px; margin-top: 4px;">💰 ${details.priceRange}</div>`;
  }

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

  if (details.notes && details.notes.length <= 100) {
    html += `<div style="color: #f48fb1; font-size: 10px; margin-top: 4px;">💡 ${details.notes}</div>`;
  }

  if (details.suppliers) {
    const shortSuppliers = details.suppliers.length > 50 ? details.suppliers.substring(0, 50) + '...' : details.suppliers;
    html += `<div style="color: #a5d6a7; font-size: 9px; margin-top: 3px;">🛒 ${shortSuppliers}</div>`;
  }

  html += `<div style="color: #90caf9; font-size: 9px; margin-top: 6px; font-style: italic; border-top: 1px solid #444; padding-top: 4px;">💬 Click sidebar for full details</div>`;

  return html;
}

function hideTooltip(tooltip) {
  tooltip.style.opacity = '0';
  tooltip.classList.remove('visible');
  tooltip.classList.remove('touch-positioned');
}

function updateTooltipPosition(event, tooltip) {
  const mainContainer = document.getElementById('main-container');
  const containerRect = mainContainer.getBoundingClientRect();

  let x = event.clientX + 15;
  let y = event.clientY - 10;

  const tooltipWidth = 300; // max-width from CSS
  const tooltipHeight = 200; // estimated height

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
