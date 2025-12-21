import { drawDiagram } from './diagram.js';
import { populateComponentList } from './sidebar.js';
import { initializeTooltips, testTooltips, renderBottomPanel } from './tooltips.js';

export async function initUI() {
  // Sidebar toggle
  document.addEventListener('DOMContentLoaded', async () => {
    const toggleButton = document.getElementById('toggle-sidebar');
    const sidebar = document.getElementById('sidebar');

    if (toggleButton && sidebar) {
      toggleButton.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        toggleButton.textContent = sidebar.classList.contains('collapsed') ? '☰ Show Sidebar' : '☰ Hide Sidebar';
      });
    }

    // Expose debug function to match existing onclick in HTML (be case-insensitive for convenience)
    window.testTooltips = testTooltips;
    // also add a lowercase alias so developers who type the name casually won't hit a case-sensitivity error
    window.testtooltips = testTooltips;
    console.log('🔧 Tooltip debug helpers: testTooltips() and testtooltips() are available');

    console.log('🎨 Starting diagram initialization...');
    try {
      const panZoom = await drawDiagram();

      // Populate sidebar and initialize tooltips after render
      populateComponentList(panZoom);
      setTimeout(() => initializeTooltips(), 800);
      setTimeout(() => renderBottomPanel(), 1000);

      console.log('✅ Diagram initialization complete');
    } catch (error) {
      console.error('❌ Error during diagram initialization:', error);
    }
  });
}