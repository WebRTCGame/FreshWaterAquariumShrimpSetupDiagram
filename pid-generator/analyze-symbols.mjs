const fs = require('fs');
const raw = fs.readFileSync('pid-symbols-bundle.js', 'utf8');
const jsonStr = raw.replace('window.PID_SYMBOLS = ', '').replace(/;\s*$/, '');
const symbols = JSON.parse(jsonStr);

const results = [];
for (const [key, sym] of Object.entries(symbols)) {
  const processPorts = (sym.ports || []).filter(p => p.connectionClass === 'process' && p.type === 'pipe');
  const nozzlePorts = (sym.ports || []).filter(p => p.connectionClass === 'process' && p.type === 'nozzle');
  const allProcessPorts = [...processPorts, ...nozzlePorts];
  const vbMatch = sym.svg.match(/viewBox="([^"]+)"/);
  let viewBox = null;
  if (vbMatch) {
    const parts = vbMatch[1].split(/[\s,]+/).map(Number);
    viewBox = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
  }
  results.push({
    key, size: sym.size,
    portCount: allProcessPorts.length,
    processPipeCount: processPorts.length,
    nozzleCount: nozzlePorts.length,
    ports: allProcessPorts.map(p => ({ id: p.id, type: p.type, x: p.x, y: p.y })),
    currentAnchor: sym.anchor,
    currentExtents: sym.extents,
    viewBox,
  });
}

console.log('Total symbols: ' + results.length);

const byPorts = {};
for (const r of results) {
  const k = r.portCount + ' ports';
  byPorts[k] = (byPorts[k] || 0) + 1;
}
for (const [k, v] of Object.entries(byPorts).sort()) console.log('  ' + k + ': ' + v);

console.log('\n=== 2-PORT SYMBOLS (anchor-between-ports candidates) ===');
for (const r of results.filter(r => r.portCount === 2)) {
  const p0 = r.ports[0], p1 = r.ports[1];
  const mx = ((p0.x + p1.x) / 2).toFixed(1);
  const my = ((p0.y + p1.y) / 2).toFixed(1);
  const vbStr = r.viewBox ? r.viewBox.w + 'x' + r.viewBox.h : 'none';
  const curAnch = r.currentAnchor ? '(' + r.currentAnchor.x + ',' + r.currentAnchor.y + ')' : 'none';
  const curExt = r.currentExtents
    ? '(' + r.currentExtents.x0 + ',' + r.currentExtents.y0 + ')-(' + r.currentExtents.x1 + ',' + r.currentExtents.y1 + ')'
    : 'none';
  console.log('  ' + r.key);
    console.log('    size=' + r.size + '  vb=' + vbStr);
    console.log('    ' + p0.id + '@(' + p0.x + ',' + p0.y + ')  ' + p1.id + '@(' + p1.x + ',' + p1.y + ')');
    console.log('    midpoint=(' + mx + ',' + my + ')  anchor=' + curAnch + '  extents=' + curExt);
}

console.log('\n=== 0-PORT SYMBOLS ===');
for (const r of results.filter(r => r.portCount === 0)) {
  const vbStr = r.viewBox ? 'vb=' + r.viewBox.w + 'x' + r.viewBox.h : 'no vb';
  console.log('  ' + r.key + '  sz=' + r.size + '  ' + vbStr);
}

console.log('\n=== 1-PORT SYMBOLS ===');
for (const r of results.filter(r => r.portCount === 1)) {
  const p = r.ports[0];
  const vbStr = r.viewBox ? 'vb=' + r.viewBox.w + 'x' + r.viewBox.h : 'none';
  console.log('  ' + r.key + '  sz=' + r.size + '  ' + p.id + '@(' + p.x + ',' + p.y + ')  ' + vbStr);
}

console.log('\n=== 3+ PORT SYMBOLS ===');
for (const r of results.filter(r => r.portCount >= 3)) {
  const portStr = r.ports.map(p => p.id + '@(' + p.x + ',' + p.y + ')').join('  ');
  const vbStr = r.viewBox ? 'vb=' + r.viewBox.w + 'x' + r.viewBox.h : 'none';
  console.log('  ' + r.key + '  sz=' + r.size + '  ' + vbStr);
  console.log('    ' + portStr);
}
