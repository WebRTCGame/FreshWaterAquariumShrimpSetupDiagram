// One-shot verification of the diagram app with Playwright + Firefox.
// Usage: npx playwright test verify.mjs --browser=firefox  (or node verify.mjs)
import { firefox } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pageUrl = 'file:///' + fileURLToPath(new URL('./index.html', import.meta.url)).replace(/\\/g, '/');
const browser = await firefox.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

await page.goto(pageUrl);
await page.waitForFunction(() => window.panZoomInstance !== undefined);
await page.waitForTimeout(300);

const results = await page.evaluate(async () => {
  const out = {};
  out.mermaidVersion = mermaid.version || 'not exposed';
  out.tooltipBindings = document.querySelectorAll('[data-tooltip-enabled]').length;
  out.manifestCount = window.MANIFEST.length;

  // Tooltip content check
  const tooltip = document.getElementById('component-tooltip');
  const fire = (id) => {
    const g = document.querySelector(`[id*="flowchart-${id}-"]`);
    if (!g) return null;
    g.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 500, clientY: 300 }));
    const t = tooltip.textContent.trim().slice(0, 40);
    g.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    return t;
  };
  out.tooltipTK101 = fire('TK_101');
  out.tooltipOVTank = fire('OV_TANK');

  // Focus centering check: node center vs viewport center after focus
  out.focus = {};
  for (const id of ['TK_101', 'FIL_101', 'ISL_ROCK']) {
    focusOnComponent(window.panZoomInstance, id);
    await new Promise(r => setTimeout(r, 250));
    const g = document.querySelector(`[id*="flowchart-${id}-"]`);
    const c = getElementScreenCenter(g);
    const svgRect = document.getElementById('mySvgId').getBoundingClientRect();
    out.focus[id] = {
      offX: Math.round(c.clientX - (svgRect.left + svgRect.width / 2)),
      offY: Math.round(c.clientY - (svgRect.top + svgRect.height / 2)),
      zoom: window.panZoomInstance.getZoom()
    };
  }
  return out;
});

await page.screenshot({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-screenshot.png') });
await browser.close();

console.log(JSON.stringify(results, null, 2));
console.log('JS errors:', errors.length ? errors.join('\n') : 'none');
