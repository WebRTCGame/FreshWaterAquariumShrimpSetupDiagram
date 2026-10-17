// Diagnostic probe: draw a symbol's ink beside its DECLARED metadata, at 20x, so the
// mismatch is visible. Also draws the pipe endpoints the real engine produced.
//   node probe-symbol.mjs <key> [morekeys...]
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { contentBBox } from './symbol-ink.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BUNDLE = 'D:/Programming Projects/FreshWaterAquariumShrimpSetupDiagram2/pid-generator/pid-symbols-bundle.js';
const S = JSON.parse(readFileSync(BUNDLE, 'utf8').replace(/^\s*window\.PID_SYMBOLS\s*=\s*/, '').replace(/;\s*$/, ''));
const vbOf = (svg) => { const m = svg.match(/viewBox="([^"]+)"/); if (!m) return null; const p = m[1].split(/[\s,]+/).map(Number); return p.length === 4 ? { x: p[0], y: p[1], w: p[2], h: p[3] } : null; };
const r2 = (n) => Math.round(n * 100) / 100;

const keys = process.argv.slice(2);
const K = 22;                       // magnification
const cards = [];
let maxH = 0;

for (const key of keys) {
  const sym = S[key];
  if (!sym) { console.error('no such symbol: ' + key); process.exit(1); }
  const vb = vbOf(sym.svg);
  const size = sym.size;
  const s = Math.min(size / vb.w, size / vb.h);
  const ox = (size - vb.w * s) / 2, oy = (size - vb.h * s) / 2;
  // glyph inner markup only
  const inner = sym.svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const W = vb.w * K, H = vb.h * K;
  const g = [];
  // 5mm drafting grid in render mm, scaled
  g.push(`<g stroke="#f0f0f0" stroke-width="1">`);
  for (let x = 0; x <= size; x += 5) g.push(`<line x1="${(ox + x) * K}" y1="0" x2="${(ox + x) * K}" y2="${H}"/>`);
  for (let y = 0; y <= size; y += 5) g.push(`<line x1="0" y1="${(oy + y) * K}" x2="${W}" y2="${(oy + y) * K}"/>`);
  g.push('</g>');
  // the glyph, exactly as embedSymbolRaw nests it: a size x size box, letterboxed
  g.push(`<svg x="${ox * K}" y="${oy * K}" width="${vb.w * s * K}" height="${vb.h * s * K}" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" xmlns="http://www.w3.org/2000/svg" style="color:#111">${inner}</svg>`);
  // nominal size box (what `size` claims)
  g.push(`<rect x="0" y="0" width="${size * K}" height="${size * K}" fill="none" stroke="#bbb" stroke-dasharray="4 4"/>`);
  const X = (u) => (ox + u * s) * K, Y = (u) => (oy + u * s) * K;
  // declared extents (viewBox units)
  if (sym.extents) {
    const e = sym.extents;
    g.push(`<rect x="${X(e.x0)}" y="${Y(e.y0)}" width="${(e.x1 - e.x0) * s * K}" height="${(e.y1 - e.y0) * s * K}" fill="none" stroke="#06c" stroke-width="2"/>`);
  }
  // ports, as the ENGINE resolves them (connWorld: naive, size in both axes)
  for (const p of (sym.ports || [])) {
    const px = ((p.x - 50) / 100) * size * K, py = ((p.y - 50) / 100) * size * K;      // engine
    const tx = X(vb.x + (p.x / 100) * vb.w), ty = Y(vb.y + (p.y / 100) * vb.h);        // truth
    g.push(`<circle cx="${px}" cy="${py}" r="9" fill="#0a7" fill-opacity=".85" stroke="#fff" stroke-width="2"/>`);
    g.push(`<line x1="${px}" y1="${py}" x2="${tx}" y2="${ty}" stroke="#c00" stroke-width="2" stroke-dasharray="3 3"/>`);
    g.push(`<circle cx="${tx}" cy="${ty}" r="5" fill="#c00" fill-opacity=".85"/>`);
    g.push(`<text x="${px + 12}" y="${py - 8}" font-size="13" fill="#0a7">${p.id} pct(${p.x},${p.y})</text>`);
  }
  // anchor: the ENGINE's real formula (PIDEngine.portOffset), which is letterbox-aware
  // and measures from the box CENTRE -- probe coords have the origin at the box top-left.
  if (sym.anchor) {
    const vx = (sym.anchor.x / 100) * vb.w, vy = (sym.anchor.y / 100) * vb.h;
    const ax = (ox + vx * s) * K, ay = (oy + vy * s) * K;
    g.push(`<path d="M${ax - 7} ${ay}h14M${ax} ${ay - 7}v14" stroke="#7a3" stroke-width="2.5"/>`);
    g.push(`<text x="${ax + 11}" y="${ay + 18}" font-size="13" fill="#7a3">anchor pct(${sym.anchor.x},${sym.anchor.y})</text>`);
    // ink centre, in viewBox units
    const bb = contentBBox(inner);
    if (bb) {
      const cx = X(bb.cx), cy = Y(bb.cy);
      g.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="none" stroke="#06c" stroke-width="2" stroke-dasharray="2 2"/>`);
      g.push(`<text x="${cx + 8}" y="${cy - 8}" font-size="13" fill="#06c">ink centre</text>`);
    }
  }
  if (sym.labelAnchor) g.push(`<circle cx="${X(sym.labelAnchor.x)}" cy="${Y(sym.labelAnchor.y)}" r="4" fill="#a0a"/>`);
  const label = `${key}  ·  size ${size}mm  ·  vb ${r2(vb.w)}x${r2(vb.h)}  ·  drawn ${r2(vb.w * s)}x${r2(vb.h * s)}mm`;
  cards.push(`<div style="page-break-after:always;font:13px ui-monospace,monospace;color:#333">
    <div style="padding:6px 10px">${label}</div>
    <svg width="${W + 240}" height="${H + 40}" viewBox="-120 -20 ${W + 240} ${H + 40}" style="background:#fff">${g.join('')}</svg>
    <div style="padding:4px 10px;color:#666">green = where the ENGINE puts the port · red = where the glyph ink actually ends · dashed red = the error</div>
  </div>`);
  maxH = Math.max(maxH, H);
}

const dir = mkdtempSync(join(tmpdir(), 'probe-'));
const html = join(dir, 'p.html');
writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style>${cards.join('')}`);
const png = join('D:/Programming Projects/FreshWaterAquariumShrimpSetupDiagram2/pid-generator/regress/preview', 'probe.png');
execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ud-'))}`,
  `--screenshot=${png}`, '--window-size=1500,900',
  '--default-background-color=ffffff', '--force-device-scale-factor=1',
  '--virtual-time-budget=4000', 'file:///' + html.replace(/\\/g, '/')], { stdio: 'ignore' });
console.log('wrote ' + png);
