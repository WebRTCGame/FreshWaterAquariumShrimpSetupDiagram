export function populateComponentList(panZoom) {
  console.log('📋 Starting to populate component list...');
  const components = window.AQUARIUM_COMPONENTS || {};

  // Store components globally for tooltip reuse
  window.sidebarComponents = {};
  Object.entries(components).forEach(([category, items]) => {
    items.forEach(component => {
      window.sidebarComponents[component.id] = component;
    });
  });

  console.log('📦 Stored', Object.keys(window.sidebarComponents).length, 'components globally for tooltips');

  const componentList = document.getElementById('component-list');
  componentList.innerHTML = '';

  Object.entries(components).forEach(([category, items]) => {
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
        toggleComponentDetails(itemDiv, expandArrow, component);
      };

      headerDiv.appendChild(mainContent);
      headerDiv.appendChild(expandArrow);
      itemDiv.appendChild(headerDiv);

      if (component.details) {
        const detailsDiv = createComponentDetails(component);
        itemDiv.appendChild(detailsDiv);
      }

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

export function focusOnComponent(panZoom, componentId) {
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

export function createComponentDetails(component) {
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

export function toggleComponentDetails(itemDiv, arrow, component) {
  const detailsDiv = itemDiv.querySelector('.component-details');

  if (detailsDiv.classList.contains('expanded')) {
    detailsDiv.classList.remove('expanded');
    arrow.classList.remove('expanded');
  } else {
    detailsDiv.classList.add('expanded');
    arrow.classList.add('expanded');
  }
}