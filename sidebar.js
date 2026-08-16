function populateComponentList(panZoom, manifest) {
  // Seed globals from slim manifest data (no details yet); tooltips read these
  window.sidebarComponents = {};
  manifest.forEach(item => {
    window.sidebarComponents[item.id] = item;
  });

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

      // Details loaded on first expand
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
}

// Mermaid renders node groups as flowchart-<ID>-<N>; look up by that exact prefix
function findNodeElement(componentId) {
  return document.querySelector(`g[id^="flowchart-${componentId}-"]`);
}

// Screen-space center of an SVG element (getBoundingClientRect is stale on SVG internals)
function getElementScreenCenter(element) {
  const ctm = element.getScreenCTM();
  const bbox = element.getBBox();
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  return {
    clientX: ctm.a * cx + ctm.c * cy + ctm.e,
    clientY: ctm.b * cx + ctm.d * cy + ctm.f
  };
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

  const element = findNodeElement(componentId);
  if (!element) return;

  const svg = document.getElementById('mySvgId');

  // Pan first (no pending transform updates, so CTM is accurate), then zoom around
  // the viewport center — a centered node stays centered.
  const center = getElementScreenCenter(element);
  const svgRect = svg.getBoundingClientRect();
  panZoom.panBy({
    x: (svgRect.left + svgRect.width / 2) - center.clientX,
    y: (svgRect.top + svgRect.height / 2) - center.clientY
  });
  panZoom.zoom(6);

  // Highlight the component briefly
  element.style.filter = 'drop-shadow(0 0 10px #ff6b35)';
  setTimeout(() => {
    element.style.filter = '';
  }, 2000);
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

// Shared with app.js — load a component's full data (cached in window.sidebarComponents)
async function loadComponentDetails(id) {
  if (window.sidebarComponents[id]?.details) {
    return window.sidebarComponents[id];
  }
  const data = window.COMPONENT_DATA[id];
  if (!data) throw new Error(`Failed to load component ${id}`);
  window.sidebarComponents[id] = data;
  return data;
}
