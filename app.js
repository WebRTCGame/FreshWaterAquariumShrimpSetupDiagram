mermaid.initialize({
  startOnLoad: false,
  theme: 'default'
});

async function loadManifest() {
  if (!window.MANIFEST || !window.COMPONENT_DATA) {
    showFatalError('Data bundle (components/data.js) is missing. Run build-data.ps1.');
    throw new Error('Data bundle missing — run build-data.ps1');
  }
  const missing = window.MANIFEST.filter(item => !window.COMPONENT_DATA[item.id]);
  if (missing.length > 0) {
    console.warn('Missing component data for:', missing.map(item => item.id).join(', '));
  }
  return window.MANIFEST;
}

function showFatalError(message) {
  const list = document.getElementById('component-list');
  if (list) list.innerHTML = `<div style="color:#f44336;padding:12px;">${message}</div>`;
  const monthlyEl = document.getElementById('total-cost-monthly');
  const yearlyEl = document.getElementById('total-cost-yearly');
  if (monthlyEl) monthlyEl.textContent = 'Unavailable';
  if (yearlyEl) yearlyEl.textContent = '';
}

// Sum operating costs from component data; keeps header totals in sync with components/*.json
async function updateTotalCost(manifest) {
  const monthlyEl = document.getElementById('total-cost-monthly');
  const yearlyEl = document.getElementById('total-cost-yearly');
  if (!monthlyEl || !yearlyEl) return;

  const components = await Promise.all(
    manifest.map(item => loadComponentDetails(item.id).catch(() => null))
  );

  let monthly = 0;
  let yearly = 0;
  for (const component of components) {
    const cost = component?.details?.operatingCost;
    if (!cost) continue;
    const monthlyMatch = cost.monthly?.match(/\$\d+(?:\.\d+)?/);
    if (!monthlyMatch) continue;
    const m = parseFloat(monthlyMatch[0].slice(1));
    const yearlyMatch = cost.yearly?.match(/\$\d+(?:\.\d+)?/);
    monthly += m;
    yearly += yearlyMatch ? parseFloat(yearlyMatch[0].slice(1)) : m * 12;
  }

  monthlyEl.textContent = `Monthly: ~$${monthly.toFixed(2)}`;
  yearlyEl.textContent = `Yearly: ~$${yearly.toFixed(2)}`;
}

async function drawDiagram() {
  const element = document.querySelector('#graphDiv');
  const { svg } = await mermaid.render('mySvgId', graphDefinition.trim());
  element.innerHTML = svg.replace(/[ ]*max-width:[ 0-9\.]*px;/i, '');
  const panZoom = svgPanZoom('#mySvgId', {
    zoomEnabled: true,
    controlIconsEnabled: true,
    fit: true,
    center: true,
    dblClickZoomEnabled: true,
    mouseWheelZoomEnabled: true,
    preventMouseEventsDefault: true,
    eventsListenerElement: element
  });

  window.panZoomInstance = panZoom;

  const manifest = await loadManifest();
  populateComponentList(panZoom, manifest);
  await updateTotalCost(manifest);

  initializeTooltips();
}

// Sidebar toggle (classic scripts at end of body run after DOM parse)
const toggleButton = document.getElementById('toggle-sidebar');
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('sidebar-overlay');

if (localStorage.getItem('sidebar-collapsed') === 'true' ||
    (localStorage.getItem('sidebar-collapsed') === null && window.innerWidth <= 768)) {
  sidebar.classList.add('collapsed');
  toggleButton.textContent = '☰ Show Sidebar';
}

const closeSidebar = () => {
  localStorage.setItem('sidebar-collapsed', 'true');
  sidebar.classList.add('collapsed');
  if (overlay) overlay.classList.remove('visible');
  toggleButton.textContent = '☰ Show Sidebar';
};

const openSidebar = () => {
  localStorage.setItem('sidebar-collapsed', 'false');
  sidebar.classList.remove('collapsed');
  if (overlay && window.innerWidth <= 768) overlay.classList.add('visible');
  toggleButton.textContent = '☰ Hide Sidebar';
};

toggleButton.addEventListener('click', () => {
  if (sidebar.classList.contains('collapsed')) openSidebar();
  else closeSidebar();
});

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
  if (tooltipEl.contains(e.target) || e.target.closest('[data-tooltip-enabled]')) return;
  hideTooltip(tooltipEl);
}, { passive: true });

drawDiagram().catch((error) => {
  console.error('Error during diagram initialization:', error);
});
