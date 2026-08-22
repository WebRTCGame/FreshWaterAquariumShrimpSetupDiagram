import { firefox } from 'playwright';
import { fileURLToPath } from 'node:url';

const root = 'file:///' + fileURLToPath(new URL('./index.html', import.meta.url)).replace(/\\/g, '/');
const browser = await firefox.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(root);
await page.waitForFunction(() => window.panZoomInstance !== undefined);
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const out = { clusters: [], edgesEndingInCluster: 0, electricalEndpoints: [] };
  document.querySelectorAll('g.cluster').forEach(g => {
    const r = g.getBoundingClientRect();
    const title = (g.querySelector('.cluster-label, text, tspan') || {}).textContent || '';
    out.clusters.push({ title: title.trim().slice(0, 28), w: Math.round(r.width), h: Math.round(r.height) });
  });
  const toScreen = (el, x, y) => {
    const m = el.getScreenCTM();
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  };
  const clusters = Array.from(document.querySelectorAll('g.cluster')).map(g => g.getBoundingClientRect());
  document.querySelectorAll('path[id*="L_"][class*="edge"]').forEach(ep => {
    const m = String(ep.id).match(/L_(.+)_(.+)_\d+$/);
    if (!m) return;
    const tgt = m[2];
    const node = document.querySelector('[id*="flowchart-' + tgt + '-"]');
    if (!node) return;
    const d = ep.getAttribute('d');
    const n = d.match(/[\d.]+/g).map(Number);
    if (n.length < 2) return;
    const e = toScreen(ep, n[n.length - 2], n[n.length - 1]);
    const nb = node.getBoundingClientRect();
    const insideNode = e.x >= nb.left && e.x <= nb.right && e.y >= nb.top && e.y <= nb.bottom;
    if (!insideNode) {
      out.edgesEndingInCluster++;
      out.electricalEndpoints.push({ id: ep.id, target: tgt, endX: Math.round(e.x), endY: Math.round(e.y) });
    }
  });
  return out;
});
console.log('cluster sizes:');
console.log(r.clusters.filter(c => ['OUTSIDE MAIN TANK', 'MAIN PUMP SYSTEM', 'AIR SUPPLY SYSTEM', 'DOSING SYSTEM', 'HEATING SYSTEM', 'CO₂ INJECTION SYSTEM', 'AUTO TOP-OFF SYSTEM', 'WATER CHANGE SYSTEM', 'QUARANTINE/ISOLATION SYSTEM'].some(t => c.title.includes(t))));
console.log('edges NOT ending inside their target node:', r.edgesEndingInCluster);
console.log(JSON.stringify(r.electricalEndpoints.slice(0, 5)));
await browser.close();
