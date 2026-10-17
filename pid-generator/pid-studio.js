/* ============================================================================
   P&ID Studio — symbol editor
   ----------------------------------------------------------------------------
   A ground-up redesign of pid-components.html as a graphics application:
   tool rail + browser + rulers/guides canvas + context toolbar + inspector.

   Data spine is UNCHANGED from the original editor:
     - window.PID_SYMBOLS is mutated live (in memory only; nothing is written
       to disk unless you export/download/link-save)
     - ports are the live array returned by PIDGenerator.symbolConnections()
     - ports use 0..100 normalized coords; geometry uses viewBox units
       (viewBox ORIGIN is cancelled by the renderer's viewport mapping, so
       normalized x maps to viewBox x as x/100*vbW — see pid-parser.js
       portOffset comment block)
     - connCache / sizeCache entries are dropped after edits so the parser
       re-derives them
     - __PID_EDITOR_TEST__ hook is preserved for parity
   ========================================================================== */
(() => {
'use strict';

/* ============================ 0. tiny helpers ============================ */
const $ = (id) => document.getElementById(id);
const rnd = (v) => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ALPHA = /^-?\d*\.?\d+(?:e-?\d+)?$/i;

const G = window.PIDGenerator;
const ALL = G.componentIds().sort();
const PRISTINE = JSON.parse(JSON.stringify(window.PID_SYMBOLS));

const CFG_KEY = 'pidstudio.cfg';
const cfg = Object.assign({
  theme: 'light', snap: true, grid: true, gridStep: 5, snapGrid: true, snapEls: true,
  snapPorts: true, snapGuides: true, showPorts: true, showExtents: false,
  showAnchor: true, showLabel: true, showGuides: true, inkCheck: true, sections: {}, favorites: [],
}, JSON.parse(localStorage.getItem(CFG_KEY) || '{}'));
const saveCfg = () => localStorage.setItem(CFG_KEY, JSON.stringify(cfg));

/* ============================ 1. state ============================ */
let current = null;
let selPort = null;
let selEls = new Set();        // node indices into analyze(svg)
let view = { k: 1, x: 0, y: 0, fit: true };
let tool = 'select';
let nodeMode = false;           // double-click a shape to edit its vertices
let guides = [];               // {axis:'x'|'y', pos:number} in viewBox units
let clip = [];                 // internal clipboard: array of svg strings
let eidMap = [];               // shape order -> node index
let nodeIndex = [];            // node index -> eid (inverse)
let dirtyCache = new Map();
let hoverEl = -1;
let pen = null;                // pen tool state
let creating = null;           // shape drag-create state
let drag = null;               // active pointer drag
let lastDraw = 0;

const dirtyCount = () => ALL.reduce((n, id) => n + (isDirty(id) ? 1 : 0), 0);
function isDirty(id) {
  if (!dirtyCache.has(id)) dirtyCache.set(id, JSON.stringify(PRISTINE[id]) !== JSON.stringify(window.PID_SYMBOLS[id]));
  return dirtyCache.get(id);
}
function dropCaches(id) {
  // the parser memoises ports/size per key; without this, deletes/moves stay invisible
  try { delete connCache[id]; } catch (_) {}
  try { delete sizeCache[id]; } catch (_) {}
}
function touchDirty(id) {
  id = id || current;
  if (!id) return;
  dirtyCache.delete(id);
  dropCaches(id);
  updateDirtyChrome();
  autoSave();
}
/* ============================ 4b. autosave / recovery ============================ */
const AS_KEY = 'pidstudio.autosave.v1';
let asTimer = 0, asTs = 0, pendingRecovery = null;
function autoSave() {
  clearTimeout(asTimer);
  asTimer = setTimeout(() => {
    const edits = {};
    for (const id of ALL) if (isDirty(id)) edits[id] = window.PID_SYMBOLS[id];
    const n = Object.keys(edits).length;
    if (!n) {
      localStorage.removeItem(AS_KEY);
      asTs = 0;
    } else {
      try {
        asTs = Date.now();
        localStorage.setItem(AS_KEY, JSON.stringify({ ts: asTs, edits }));
      } catch (_) { /* over quota: the bundle download still carries every edit */ }
    }
    updateAutoChrome();
  }, 350);
}
function autoClear() {
  clearTimeout(asTimer);
  localStorage.removeItem(AS_KEY);
  asTs = 0;
  updateAutoChrome();
}
function updateAutoChrome() {
  const el2 = $('stAuto');
  if (!el2) return;
  el2.hidden = !asTs;
  if (asTs) {
    const n = ALL.filter((id) => isDirty(id)).length;
    el2.textContent = 'autosaved ' + new Date(asTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + n + ' edit' + (n > 1 ? 's' : '');
  }
  // the recovery banner describes the autosave; keep its counts honest while the user works
  if (pendingRecovery && !$('recover').hidden && asTs) {
    const n = ALL.filter((id) => isDirty(id)).length;
    $('recoverTitle').textContent = 'Recovered ' + n + ' unsaved edit' + (n > 1 ? 's' : '');
    $('recoverSub').textContent = 'autosaved ' + new Date(asTs).toLocaleString() + ' — restore them, or discard and start clean';
    pendingRecovery = readAutoSave() || pendingRecovery;
  }
}
function readAutoSave() {
  try {
    const snap = JSON.parse(localStorage.getItem(AS_KEY) || 'null');
    if (!snap || !snap.edits) return null;
    const ids = Object.keys(snap.edits).filter((id) => ALL.includes(id) && snap.edits[id] && typeof snap.edits[id] === 'object');
    return ids.length ? { ts: snap.ts, edits: snap.edits, ids } : null;
  } catch (_) { return null; }
}
function offerRecovery() {
  pendingRecovery = readAutoSave();
  if (!pendingRecovery) return;
  const n = pendingRecovery.ids.length;
  $('recoverTitle').textContent = 'Recovered ' + n + ' unsaved edit' + (n > 1 ? 's' : '');
  $('recoverSub').textContent = 'autosaved ' + new Date(pendingRecovery.ts).toLocaleString() + ' — restore them, or discard and start clean';
  $('recover').hidden = false;
}
function applyRecovery(restore) {
  if (pendingRecovery) {
    if (restore) {
      for (const id of pendingRecovery.ids) {
        window.PID_SYMBOLS[id] = JSON.parse(JSON.stringify(pendingRecovery.edits[id]));
        dirtyCache.delete(id);
        dropCaches(id);
      }
      asTs = pendingRecovery.ts;
      toast('Restored ' + pendingRecovery.ids.length + ' component' + (pendingRecovery.ids.length > 1 ? 's' : '') + ' from autosave', 'ok');
    } else {
      autoClear();
      toast('Autosave discarded', 'warn');
    }
    pendingRecovery = null;
  }
  $('recover').hidden = true;
  refreshAll();
  updateAutoChrome();
}
$('recoverRestore').addEventListener('click', () => applyRecovery(true));
$('recoverDiscard').addEventListener('click', () => applyRecovery(false));
const cur = () => window.PID_SYMBOLS[current];
const ports = () => (current ? G.symbolConnections(current) : []);

/* ============================ 2. icons ============================ */
const ICONS = {
  cursor: '<path d="M5 3l14 8-6 1.5L10 19z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v1"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0-6 6v1"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  warn: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  front: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
  back: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M20 8v10a2 2 0 0 1-2 2H8"/>',
  flipH: '<path d="M12 3v18"/><path d="M8 7 3 12l5 5V7z"/><path d="M16 7l5 5-5 5V7z"/>',
  flipV: '<path d="M3 12h18"/><path d="M7 8 12 3l5 5H7z"/><path d="M7 16l5 5 5-5H7z"/>',
  rotCw: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  rotCcw: '<path d="M3 12a9 9 0 1 0 2.6 6.4"/><path d="M3 21v-6h6"/>',
  alignL: '<path d="M4 3v18"/><rect x="8" y="5" width="9" height="4" rx="1"/><rect x="8" y="15" width="13" height="4" rx="1"/>',
  alignR: '<path d="M20 3v18"/><rect x="7" y="5" width="9" height="4" rx="1"/><rect x="4" y="15" width="8" height="4" rx="1"/>',
  alignT: '<path d="M3 4h18"/><rect x="7" y="8" width="4" height="9" rx="1"/><rect x="15" y="8" width="4" height="13" rx="1"/>',
  alignB: '<path d="M3 20h18"/><rect x="7" y="5" width="4" height="9" rx="1"/><rect x="15" y="3" width="4" height="13" rx="1"/>',
  alignCH: '<path d="M3 12h18" stroke-dasharray="2 2"/><rect x="5" y="9" width="14" height="6" rx="1"/>',
  alignCV: '<path d="M12 3v18" stroke-dasharray="2 2"/><rect x="9" y="5" width="6" height="14" rx="1"/>',
  distH: '<path d="M4 3v18M20 3v18"/><rect x="8" y="5" width="3" height="14" rx="1"/><rect x="13" y="5" width="3" height="14" rx="1"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  starOff: '<path d="m12 3 2.9 5.88 6.5.94-4.7 4.58 1.11 6.47L12 17.75l-5.81 3.12L7.3 14.4 2.6 9.82l6.5-.94L12 3z" fill="none"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  layers: '<path d="m12 2 9 4.5-9 4.5-9-4.5L12 2z"/><path d="m3 11.5 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  magnet: '<path d="M6 15V6a6 6 0 0 1 12 0v9"/><path d="M6 15h4v4a2 2 0 0 1-4 0v-4zM14 15h4v4a2 2 0 0 1-4 0v-4z"/>',
  grid: '<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
};
const ic = (name, cls) => '<svg viewBox="0 0 24 24" class="ic ' + (cls || '') + '" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';

/* ============================ 3. toast / status ============================ */
let toastTimer = [];
function toast(msg, kind) {
  const box = $('toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.innerHTML = ic(kind === 'ok' ? 'check' : kind === 'bad' ? 'warn' : kind === 'warn' ? 'warn' : 'info') + '<span></span>';
  t.querySelector('span').textContent = msg;
  box.appendChild(t);
  const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 200); };
  const timer = setTimeout(kill, kind === 'bad' ? 4200 : 2600);
  t.addEventListener('click', () => { clearTimeout(timer); kill(); });
  while (box.children.length > 4) box.firstChild.remove();
  return t;
}
function status(msg) { toast(msg); }

/* ============================ 4. undo / redo ============================ */
const undoStack = [], redoStack = [];
function pushUndo() {
  if (!current) return;
  undoStack.push({ id: current, data: JSON.stringify(window.PID_SYMBOLS[current]) });
  if (undoStack.length > 120) undoStack.shift();
  redoStack.length = 0;
  updateHistChrome();
}
function pushUndoSnap(id, data) {
  undoStack.push({ id, data });
  if (undoStack.length > 120) undoStack.shift();
  redoStack.length = 0;
  updateHistChrome();
}
/* one undo step covering several components (revert-all, review reverts) */
function pushUndoMulti(ids) {
  const data = {};
  for (const id of ids) data[id] = JSON.stringify(window.PID_SYMBOLS[id]);
  undoStack.push({ multi: true, ids: ids.slice(), data });
  if (undoStack.length > 120) undoStack.shift();
  redoStack.length = 0;
  updateHistChrome();
}
function undo() {
  const e = undoStack.pop();
  if (!e) return toast('Nothing to undo', 'warn');
  if (e.multi) {
    const cur2 = {};
    for (const id of e.ids) cur2[id] = JSON.stringify(window.PID_SYMBOLS[id]);
    redoStack.push({ multi: true, ids: e.ids.slice(), data: cur2 });
    for (const id of e.ids) {
      window.PID_SYMBOLS[id] = JSON.parse(e.data[id]);
      dirtyCache.delete(id);
      dropCaches(id);
    }
    if (e.ids.includes(current)) { selPort = null; selEls.clear(); }
    for (const id of e.ids) touchDirty(id);
    refreshAll();
    toast('Undo', 'ok');
    return;
  }
  redoStack.push({ id: e.id, data: JSON.stringify(window.PID_SYMBOLS[e.id]) });
  window.PID_SYMBOLS[e.id] = JSON.parse(e.data);
  if (e.id === current) { selPort = null; selEls.clear(); }
  touchDirty(e.id);
  refreshAll();
  toast('Undo', 'ok');
}
function redo() {
  const e = redoStack.pop();
  if (!e) return toast('Nothing to redo', 'warn');
  if (e.multi) {
    const cur2 = {};
    for (const id of e.ids) cur2[id] = JSON.stringify(window.PID_SYMBOLS[id]);
    undoStack.push({ multi: true, ids: e.ids.slice(), data: cur2 });
    for (const id of e.ids) {
      window.PID_SYMBOLS[id] = JSON.parse(e.data[id]);
      dirtyCache.delete(id);
      dropCaches(id);
    }
    if (e.ids.includes(current)) { selPort = null; selEls.clear(); }
    for (const id of e.ids) touchDirty(id);
    refreshAll();
    toast('Redo', 'ok');
    return;
  }
  undoStack.push({ id: e.id, data: JSON.stringify(window.PID_SYMBOLS[e.id]) });
  window.PID_SYMBOLS[e.id] = JSON.parse(e.data);
  if (e.id === current) { selPort = null; selEls.clear(); }
  touchDirty(e.id);
  refreshAll();
  toast('Redo', 'ok');
}

/* ============================ 5. svg analysis ============================ */
const SHAPE_TAGS = ['path', 'line', 'rect', 'circle', 'ellipse', 'polyline', 'polygon', 'text'];
function analyze(svg) {
  const nodes = [];
  const re = /<(\/?)([\w-]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m, last = 0;
  const stack = [];
  while ((m = re.exec(svg)) !== null) {
    if (m.index > last) nodes.push({ kind: 'raw', start: last, end: m.index });
    const close = m[1] === '/', name = m[2].toLowerCase();
    let attrsRaw = m[3] || '';
    const selfClose = m[4] === '/' || /\/\s*$/.test(attrsRaw);
    attrsRaw = attrsRaw.replace(/\/\s*$/, '');
    const start = m.index, end = re.lastIndex;
    if (!close && name === 'g') {
      const tr = attrsRaw.match(/translate\(\s*(-?[\d.eE+-]+)[ ,]+(-?[\d.eE+-]+)/);
      const sc = attrsRaw.match(/scale\(\s*(-?[\d.eE+-]+)(?:[ ,]+(-?[\d.eE+-]+))?\)/);
      nodes.push({ kind: 'g', name, start, end, attrsRaw, selfClose,
        tr: tr ? [+tr[1], +tr[2]] : null,
        sc: sc ? [+sc[1], sc[2] !== undefined ? +sc[2] : +sc[1]] : null,
        parent: stack.length ? stack[stack.length - 1] : -1 });
      if (!selfClose) stack.push(nodes.length - 1);
    } else if (close) {
      if (name === 'g' && stack.length) stack.pop();
      nodes.push({ kind: 'closer', name, start, end });
    } else if (SHAPE_TAGS.includes(name)) {
      nodes.push({ kind: 'shape', name, start, end, attrsRaw, selfClose,
        parent: stack.length ? stack[stack.length - 1] : -1 });
    } else nodes.push({ kind: 'other', name, start, end });
    last = end;
  }
  if (last < svg.length) nodes.push({ kind: 'raw', start: last, end: svg.length });
  return nodes;
}
function parseAttrs(raw) {
  const a = {};
  for (const m of (raw || '').matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) a[m[1]] = m[2];
  for (const m of (raw || '').matchAll(/([\w:-]+)\s*=\s*'([^']*)'/g)) a[m[1]] = m[2];
  return a;
}
function chainOf(nodes, i) {
  const t = [0, 0], s = [1, 1];
  const walk = (idx) => {
    if (idx === undefined || idx < 0 || !nodes[idx]) return;
    const n = nodes[idx];
    walk(n.parent);
    if (n.tr) { t[0] += s[0] * n.tr[0]; t[1] += s[1] * n.tr[1]; }
    if (n.sc) { s[0] *= n.sc[0]; s[1] *= n.sc[1]; }
  };
  if (nodes[i]) walk(nodes[i].parent);
  return { tx: t[0], ty: t[1], sx: s[0], sy: s[1] };
}
function setAttrInRaw(raw, name, value) {
  const rx = new RegExp('\\s' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*"[^"]*"');
  const nv = ' ' + name + '="' + value + '"';
  return value === '' || value == null ? raw.replace(rx, '') : rx.test(raw) ? raw.replace(rx, nv) : raw + nv;
}
function elemExtent(nodes, idx) {
  const n = nodes[idx];
  if (!n || n.selfClose || n.kind !== 'shape') return n ? [n.start, n.end] : [0, 0];
  for (let j = idx + 1; j < nodes.length; j++) {
    if (nodes[j].kind === 'closer' && nodes[j].name === n.name) return [n.start, nodes[j].end];
  }
  return [n.start, n.end];
}
function shapeIndices() {
  const nodes = analyze(cur().svg);
  return { nodes, shapes: nodes.map((n, i) => (n.kind === 'shape' ? i : -1)).filter((i) => i >= 0) };
}

/* ============================ 6. transforms (2x3 affine) ============================ */
const IDENT = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const mTrans = (x, y) => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });
const mScale = (sx, sy) => ({ a: sx, b: 0, c: 0, d: sy === undefined ? sx : sy, e: 0, f: 0 });
function mRot(deg, cx, cy) {
  const r = (deg * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
  return mMul(mMul(mTrans(cx, cy), { a: co, b: si, c: -si, d: co, e: 0, f: 0 }), mTrans(-cx, -cy));
}
function mMul(m, n) { // m then n
  return {
    a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f,
  };
}
function mApply(m, x, y) { return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }; }
function mInv(m) {
  const det = m.a * m.d - m.b * m.c;
  if (!det) return IDENT;
  const ia = m.d / det, ib = -m.b / det, ic = -m.c / det, id = m.a / det;
  return { a: ia, b: ib, c: ic, d: id, e: -(ia * m.e + ic * m.f), f: -(ib * m.e + id * m.f) };
}
function parseTransform(raw) {
  if (!raw) return null;
  const mm = /matrix\s*\(([^)]+)\)/.exec(raw);
  if (mm) {
    const v = mm[1].trim().split(/[\s,]+/).map(Number);
    if (v.length === 6 && v.every(Number.isFinite)) return { a: v[0], b: v[1], c: v[2], d: v[3], e: v[4], f: v[5] };
  }
  let m = IDENT, found = false;
  const re = /(translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(raw)) !== null) {
    found = true;
    const v = t[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (t[1] === 'translate') m = mMul(m, mTrans(v[0] || 0, v[1] || 0));
    else if (t[1] === 'scale') m = mMul(m, mScale(v[0] ?? 1, v.length > 1 ? v[1] : v[0] ?? 1));
    else if (t[1] === 'rotate') m = mMul(m, mRot(v[0] || 0, v[1] || 0, v[2] || 0));
    else if (t[1] === 'skewX') { const a2 = (v[0] || 0) * Math.PI / 180; m = mMul(m, { a: 1, b: 0, c: Math.tan(a2), d: 1, e: 0, f: 0 }); }
    else if (t[1] === 'skewY') { const a2 = (v[0] || 0) * Math.PI / 180; m = mMul(m, { a: 1, b: Math.tan(a2), c: 0, d: 1, e: 0, f: 0 }); }
  }
  return found ? m : null;
}
function fmtTransform(m) {
  if (!m) return '';
  let rot = Math.atan2(m.b, m.a);
  let co = Math.cos(rot), si = Math.sin(rot);
  let sx, sy;
  if (Math.abs(co) >= Math.abs(si)) { sx = m.a / co; sy = Math.abs(si) > 1e-9 ? m.c / -si : m.d / co; }
  else { sx = m.b / si; sy = Math.abs(si) > 1e-9 ? m.c / -si : m.d / co; }
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
    // skewed or degenerate: emit the raw matrix rather than lie about it
    const r6 = (v) => rnd(v * 1e6) / 1e6;
    return 'matrix(' + [m.a, m.b, m.c, m.d, m.e, m.f].map(r6).join(' ') + ')';
  }
  // a 180° rotation is indistinguishable from mirrored axes — keep the shorter signed form
  if (Math.abs(si) < 1e-9 && co < 0) { rot = 0; co = 1; si = 0; sx = -sx; sy = -sy; }
  const parts = [];
  if (Math.abs(m.e) > 1e-4 || Math.abs(m.f) > 1e-4) parts.push('translate(' + rnd(m.e) + ' ' + rnd(m.f) + ')');
  const deg = (rot * 180) / Math.PI;
  if (Math.abs(deg) > 1e-4) parts.push('rotate(' + rnd(deg * 1000) / 1000 + ')');
  const sxr = rnd(sx * 10000) / 10000, syr = rnd(sy * 10000) / 10000;
  if (Math.abs(sxr - 1) > 1e-4 || Math.abs(syr - 1) > 1e-4) {
    parts.push('scale(' + sxr + (Math.abs(syr - sxr) > 1e-4 ? ' ' + syr : '') + ')');
  }
  if (!parts.length) return '';
  // verify the round-trip; fall back to matrix() if the decomposition drifts
  const rt = parseTransform(parts.join(' '));
  if (rt) {
    const q1 = mApply(m, 3, 7), q2 = mApply(rt, 3, 7);
    if (Math.abs(q1.x - q2.x) > 0.05 || Math.abs(q1.y - q2.y) > 0.05) {
      const r6 = (v) => rnd(v * 1e6) / 1e6;
      return 'matrix(' + [m.a, m.b, m.c, m.d, m.e, m.f].map(r6).join(' ') + ')';
    }
  }
  return parts.join(' ');
}
/* ============================ 7. path parsing ============================ */
function parsePathD(d) {
  const tk = d.match(/[MLHVCSQTAZmlhvcstaz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const raw = []; let c = null;
  for (const t of tk) {
    if (/^[a-zA-Z]$/.test(t)) { c = { cmd: t, args: [] }; raw.push(c); }
    else if (c) c.args.push(parseFloat(t));
  }
  const out = []; let cx = 0, cy = 0, sx = 0, sy = 0;
  for (const { cmd, args } of raw) {
    const rel = cmd !== cmd.toUpperCase(), C = cmd.toUpperCase();
    if (C === 'Z') { out.push({ cmd: 'Z', args: [] }); cx = sx; cy = sy; continue; }
    let k = 0;
    const A = (v, base) => Math.round((rel ? base + v : v) * 10000) / 10000;
    if (C === 'M' || C === 'L' || C === 'T') {
      let first = true;
      do {
        const x = A(args[k], cx), y = A(args[k + 1], cy);
        out.push({ cmd: first ? (C === 'M' ? 'M' : C) : (C === 'T' ? 'T' : 'L'), args: [x, y] });
        cx = x; cy = y;
        if (C === 'M' && first) { sx = cx; sy = cy; }
        first = false; k += 2;
      } while (k < args.length);
    } else if (C === 'H') { out.push({ cmd: 'H', args: [A(args[k], cx)] }); cx = A(args[k], cx); k += 1; }
    else if (C === 'V') { out.push({ cmd: 'V', args: [A(args[k], cy)] }); cy = A(args[k], cy); k += 1; }
    else if (C === 'A') {
      out.push({ cmd: 'A', args: [args[k], args[k + 1], args[k + 2], args[k + 3], args[k + 4], A(args[k + 5], cx), A(args[k + 6], cy)] });
      cx = A(args[k + 5], cx); cy = A(args[k + 6], cy); k += 7;
    } else {
      const arity = C === 'C' ? 6 : 4, pair = [];
      for (let j = 0; j < arity; j += 2) pair.push(A(args[k + j], cx), A(args[k + j + 1], cy));
      out.push({ cmd: C, args: pair });
      cx = pair[pair.length - 2]; cy = pair[pair.length - 1]; k += arity;
    }
  }
  return out;
}
function toD(cmds) {
  return cmds.map((c) => c.cmd + ' ' + c.args.map((n) => Math.round(n * 100) / 100).join(' ')).join(' ');
}
function pathPoints(cmds) {
  const CTRL = { C: [0, 2, 4], S: [0, 2], Q: [0, 2], T: [], A: [5], H: [], V: [] };
  const pts = [];
  for (let ci = 0; ci < cmds.length; ci++) {
    const { cmd, args } = cmds[ci];
    if (cmd === 'Z') continue;
    const ctrlIdx = CTRL[cmd];
    for (let k = 0; k < args.length; k += cmd === 'H' || cmd === 'V' ? 1 : 2) {
      const isCtrl = ctrlIdx ? ctrlIdx.includes(k) : false;
      if (cmd === 'H') pts.push({ ci, ai: k, x: args[k], y: null, axis: 'x', ctrl: false });
      else if (cmd === 'V') pts.push({ ci, ai: k, x: null, y: args[k], axis: 'y', ctrl: false });
      else pts.push({ ci, ai: k, x: args[k], y: args[k + 1], axis: 'xy', ctrl: !!isCtrl && !(cmd === 'A' && k === 5) });
    }
  }
  return pts;
}
function translatePathD(d, ddx, ddy) {
  const cmds = parsePathD(d);
  for (const cm of cmds) {
    if (cm.cmd === 'Z') continue;
    for (let k = 0; k < cm.args.length; k++) {
      if (cm.cmd === 'H') cm.args[k] = rnd(cm.args[k] + ddx);
      else if (cm.cmd === 'V') cm.args[k] = rnd(cm.args[k] + ddy);
      else cm.args[k] = rnd(cm.args[k] + (k % 2 === 0 ? ddx : ddy));
    }
  }
  return toD(cmds);
}
function transformPathD(d, m) {
  const cmds = parsePathD(d);
  for (const cm of cmds) {
    if (cm.cmd === 'Z') continue;
    if (cm.cmd === 'H' || cm.cmd === 'V') {
      const p = mApply(m, cm.cmd === 'H' ? cm.args[0] : 0, cm.cmd === 'V' ? cm.args[0] : 0);
      // promote to absolute L so rotated/scaled axis commands stay exact
      if (cm.cmd === 'H') { cm.cmd = 'L'; cm.args = [p.x, p.y]; } else { cm.cmd = 'L'; cm.args = [p.x, p.y]; }
      continue;
    }
    for (let k = 0; k < cm.args.length; k += 2) {
      const p = mApply(m, cm.args[k], cm.args[k + 1]);
      cm.args[k] = rnd(p.x); cm.args[k + 1] = rnd(p.y);
    }
    if (cm.cmd === 'A') { cm.cmd = 'L'; } // arcs become endpoint lines under arbitrary transforms
  }
  return toD(cmds);
}

/* ============================ 8. geometry ============================ */
function viewDims(c) {
  const m = (c.svg || '').match(/viewBox="\s*([\d.\-+eE]+)[ ,]+([\d.\-+eE]+)[ ,]+([\d.\-+eE]+)[ ,]+([\d.\-+eE]+)\s*"/);
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : { x: 0, y: 0, w: 100, h: 100 };
}
const portToView = (p, vb) => ({ x: (p.x / 100) * vb.w + vb.x, y: (p.y / 100) * vb.h + vb.y });
const viewToPort = (x, y, vb) => ({ x: ((x - vb.x) / vb.w) * 100, y: ((y - vb.y) / vb.h) * 100 });

/* full ancestor chain + own transform, as one matrix */
function chainFull(nodes, i) {
  const anc = chainOf(nodes, i);
  const ancM = mMul(mTrans(anc.tx, anc.ty), mScale(anc.sx, anc.sy));
  const own = parseTransform(parseAttrs(nodes[i] && nodes[i].attrsRaw).transform);
  return { anc, ancM, own, full: own ? mMul(ancM, own) : ancM };
}
/* logical anchor points of a node (before transforms) */
function localPts(n) {
  const a = parseAttrs(n.attrsRaw);
  const pts = [];
  if (n.name === 'line') return [[+a.x1 || 0, +a.y1 || 0], [+a.x2 || 0, +a.y2 || 0]];
  if (n.name === 'rect') {
    const x = +a.x || 0, y = +a.y || 0, w = +a.width || 0, h = +a.height || 0;
    return [[x, y], [x + w, y], [x, y + h], [x + w, y + h], [x + w / 2, y + h / 2]];
  }
  if (n.name === 'circle' || n.name === 'ellipse') {
    const cx = +a.cx || 0, cy = +a.cy || 0;
    const rx = n.name === 'circle' ? (+a.r || 0) : (+a.rx || 0), ry = n.name === 'circle' ? (+a.r || 0) : (+a.ry || 0);
    for (let i = 0; i < 8; i++) {
      const th = (i / 8) * Math.PI * 2;
      pts.push([cx + Math.cos(th) * rx, cy + Math.sin(th) * ry]);
    }
    pts.push([cx, cy]);
    return pts;
  }
  if (n.name === 'polyline' || n.name === 'polygon') {
    const v = (a.points || '').match(/-?\d*\.?\d+(?:e-?\d+)?/g) || [];
    for (let i = 0; i + 1 < v.length; i += 2) pts.push([+v[i], +v[i + 1]]);
    return pts;
  }
  if (n.name === 'text') return [[+a.x || 0, +a.y || 0]];
  if (n.name === 'path' && a.d) {
    const out = [];
    for (const p of pathPoints(parsePathD(a.d))) {
      if (p.axis === 'x') out.push([p.x, 0]);
      else if (p.axis === 'y') out.push([0, p.y]);
      else out.push([p.x, p.y]);
    }
    return out;
  }
  return pts;
}
/* viewBox-space bbox of a node (exact for transforms incl. rotation) */
function elemBounds(idx, _nodes) {
  const nodes = _nodes || analyze(cur().svg);
  const n = nodes[idx];
  if (!n || n.kind !== 'shape') return null;
  const ch = chainFull(nodes, idx);
  let b = null;
  for (const [lx, ly] of localPts(n)) {
    const v = mApply(ch.full, lx, ly);
    b = b ? { x0: Math.min(b.x0, v.x), y0: Math.min(b.y0, v.y), x1: Math.max(b.x1, v.x), y1: Math.max(b.y1, v.y) }
          : { x0: v.x, y0: v.y, x1: v.x, y1: v.y };
  }
  return b;
}
function selBounds() {
  const nodes = analyze(cur().svg);
  let b = null;
  for (const i of selEls) {
    const e = elemBounds(i, nodes);
    if (!e) continue;
    b = b ? { x0: Math.min(b.x0, e.x0), y0: Math.min(b.y0, e.y0), x1: Math.max(b.x1, e.x1), y1: Math.max(b.y1, e.y1) } : e;
  }
  return b;
}
/* element handles for vertex editing, in viewBox space */
function vertexList(idx) {
  const nodes = analyze(cur().svg);
  const n = nodes[idx];
  if (!n || n.kind !== 'shape') return [];
  const ch = chainFull(nodes, idx);
  const a = parseAttrs(n.attrsRaw);
  const out = [];
  const push = (kind, lx, ly, extra) => {
    const v = mApply(ch.full, lx, ly);
    out.push(Object.assign({ kind, vx: v.x, vy: v.y, lx, ly }, extra || {}));
  };
  if (n.name === 'line') {
    push('pt', +a.x1 || 0, +a.y1 || 0, { axis: 'xy', pi: 0 });
    push('pt', +a.x2 || 0, +a.y2 || 0, { axis: 'xy', pi: 1 });
  } else if (n.name === 'rect') {
    const x = +a.x || 0, y = +a.y || 0, w = +a.width || 0, h = +a.height || 0;
    push('corner', x, y, { cn: 'tl', axis: 'xy' });
    push('corner', x + w, y, { cn: 'tr', axis: 'xy' });
    push('corner', x, y + h, { cn: 'bl', axis: 'xy' });
    push('corner', x + w, y + h, { cn: 'br', axis: 'xy' });
  } else if (n.name === 'circle') {
    const cx = +a.cx || 0, cy = +a.cy || 0, r = +a.r || 0;
    push('center', cx, cy, { axis: 'xy' });
    push('radius', cx + r, cy, { axis: 'xy' });
    push('radius', cx, cy + r, { axis: 'xy' });
  } else if (n.name === 'ellipse') {
    const cx = +a.cx || 0, cy = +a.cy || 0;
    push('center', cx, cy, { axis: 'xy' });
    push('radius', cx + (+a.rx || 0), cy, { axis: 'x' });
    push('radius', cx, cy + (+a.ry || 0), { axis: 'y' });
  } else if (n.name === 'polyline' || n.name === 'polygon') {
    const v = (a.points || '').match(/-?\d*\.?\d+(?:e-?\d+)?/g) || [];
    for (let i = 0; i + 1 < v.length; i += 2) push('pt', +v[i], +v[i + 1], { axis: 'xy', pi: i / 2 });
  } else if (n.name === 'text') {
    push('pt', +a.x || 0, +a.y || 0, { axis: 'xy' });
  } else if (n.name === 'path' && a.d) {
    pathPoints(parsePathD(a.d)).forEach((p, i) => {
      if (p.axis === 'x') push(p.ctrl ? 'ctrl' : 'pt', p.x, 0, { axis: 'x', pi: p });
      else if (p.axis === 'y') push(p.ctrl ? 'ctrl' : 'pt', 0, p.y, { axis: 'y', pi: p });
      else push(p.ctrl ? 'ctrl' : 'pt', p.x, p.y, { axis: 'xy', pi: p });
    });
  }
  return out;
}
/* ============================ 9. test hook ============================ */
window.__PID_EDITOR_TEST__ = {
  parsePathD, toD, pathPoints, translatePathD, transformPathD, analyze, chainOf, chainFull,
  parseTransform, fmtTransform, elemBounds, vertexList, viewDims, mApply, mInv, mMul, mRot, mScale, mTrans,
  pushUndo, undo, redo, canUndo: () => undoStack.length > 0, canRedo: () => redoStack.length > 0,
  setTool: (t) => setTool(t), select: (id) => select(id),
  selectEls: (arr) => { selEls = new Set(arr); draw(); },
  state: () => ({ current, selEls: [...selEls], selPort, view, tool, guides, clip, nodeMode, dragKind: drag && drag.kind, cfg }),
  inkCheck, inkOf, inkGap, inkBBoxOf, inkSamplePoints, snapPortToInk, snapAllPortsToInk,
  tapDebug: () => ({ lastTap: lastTap && { dt: Math.round(performance.now() - lastTap.t) }, downInfo: downInfo && { dt: Math.round(performance.now() - downInfo.t) } }),
  shapes: () => shapeIndices().shapes,
  eids: () => eidMap.slice(),
};

/* ============================ 10. scene building ============================ */
function buildInner(c) {
  const nodes = analyze(c.svg);
  eidMap = []; nodeIndex = [];
  let count = 0, out = '';
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind === 'shape') {
      const eid = count++;
      eidMap.push(i);
      nodeIndex[i] = eid;
      out += '<' + n.name + ' data-eid="' + eid + '"' + n.attrsRaw + (n.selfClose ? ' />' : '>');
    } else out += c.svg.slice(n.start, n.end);
  }
  return out;
}
function handlePx() {
  const vb = viewDims(cur());
  const side = sideOf();
  const s = side / vb.w; // css px per viewBox unit
  return (px) => px / s; // css px -> viewBox units
}
function sideOf() {
  const cnv = $('canvas');
  const vb = viewDims(cur());
  return Math.max(240, Math.min(cnv.clientWidth - 48, cnv.clientHeight - 48, 1400));
}
function fitBase() { return sideOf(); }

function draw() {
  if (!current) return;
  lastDraw = performance.now();
  const c = cur();
  const vb = viewDims(c);
  const side = Math.round(fitBase() * view.k);
  const hpx = handlePx();
  let inner = buildInner(c);

  /* grid + guides live in viewBox space, drawn under the glyph */
  let bg = '';
  if (cfg.grid && cfg.gridStep > 0) {
    bg += '<rect x="' + vb.x + '" y="' + vb.y + '" width="' + vb.w + '" height="' + vb.h + '" fill="url(#gridpat)" pointer-events="none"/>';
  }
  let gd = '';
  for (const g of guides) {
    gd += g.axis === 'x'
      ? '<line class="guide-line" x1="' + g.pos + '" y1="' + vb.y + '" x2="' + g.pos + '" y2="' + (vb.y + vb.h) + '"/>'
      : '<line class="guide-line" x1="' + vb.x + '" y1="' + g.pos + '" x2="' + (vb.x + vb.w) + '" y2="' + g.pos + '"/>';
  }
  if (cfg.showExtents) {
    const e0 = c.extents || { x0: vb.x, y0: vb.y, x1: vb.x + vb.w, y1: vb.y + vb.h };
    bg += '<rect class="extents-box" x="' + e0.x0 + '" y="' + e0.y0 + '" width="' + (e0.x1 - e0.x0) + '" height="' + (e0.y1 - e0.y0) + '" pointer-events="none"/>';
  }
  if (cfg.showAnchor && c.anchor) {
    bg += '<path class="anchor-x" d="M ' + (c.anchor.x - 3.5) + ' ' + c.anchor.y + ' H ' + (c.anchor.x + 3.5) + ' M ' + c.anchor.x + ' ' + (c.anchor.y - 3.5) + ' V ' + (c.anchor.y + 3.5) + '" pointer-events="none"/>';
  }
  if (cfg.showLabel && c.labelAnchor) {
    bg += '<circle cx="' + c.labelAnchor.x + '" cy="' + c.labelAnchor.y + '" r="' + hpx(7) + '" fill="none" stroke="#8b5cf6" stroke-width="' + hpx(1.5) + '" pointer-events="none"/>';
  }

  /* --- meta points: anchor, label anchor, extents corners --- */
  if (cfg.showExtents) {
    const e0 = c.extents || { x0: vb.x, y0: vb.y, x1: vb.x + vb.w, y1: vb.y + vb.h };
    bg += '<rect class="extents-box" x="' + e0.x0 + '" y="' + e0.y0 + '" width="' + (e0.x1 - e0.x0) + '" height="' + (e0.y1 - e0.y0) + '" pointer-events="none"/>';
    const corners = [['nw', e0.x0, e0.y0, 'nwse-resize'], ['ne', e0.x1, e0.y0, 'nesw-resize'], ['se', e0.x1, e0.y1, 'nwse-resize'], ['sw', e0.x0, e0.y1, 'nesw-resize']];
    for (const [k, x, y, cur] of corners) {
      bg += '<rect class="meta-handle" data-meta="extent-' + k + '" x="' + (x - hpx(4)) + '" y="' + (y - hpx(4)) + '" width="' + hpx(8) + '" height="' + hpx(8) + '" fill="' + varp('--handlefill') + '" stroke="#b58900" stroke-width="' + hpx(1.6) + '" vector-effect="non-scaling-stroke" style="cursor:' + cur + '"/>';
    }
  }
  if (cfg.showAnchor && c.anchor) {
    const ax = c.anchor.x, ay = c.anchor.y;
    bg += '<circle class="meta-handle" data-meta="anchor" cx="' + ax + '" cy="' + ay + '" r="' + hpx(7) + '" fill="none" stroke="#c62828" stroke-width="' + hpx(2) + '" vector-effect="non-scaling-stroke" style="cursor:move"/>';
    bg += '<path d="M ' + (ax - hpx(6)) + ' ' + ay + ' H ' + (ax + hpx(6)) + ' M ' + ax + ' ' + (ay - hpx(6)) + ' V ' + (ay + hpx(6)) + '" stroke="#c62828" stroke-width="' + hpx(1.8) + '" pointer-events="none" vector-effect="non-scaling-stroke"/>';
    bg += '<text x="' + (ax + hpx(9)) + '" y="' + (ay - hpx(9)) + '" fill="#c62828" font-size="' + hpx(11) + '" font-weight="600" pointer-events="none" vector-effect="non-scaling-stroke">anchor</text>';
  }
  if (cfg.showLabel && c.labelAnchor) {
    const lx = c.labelAnchor.x, ly = c.labelAnchor.y;
    bg += '<circle class="meta-handle" data-meta="label" cx="' + lx + '" cy="' + ly + '" r="' + hpx(7) + '" fill="none" stroke="#8b5cf6" stroke-width="' + hpx(2) + '" vector-effect="non-scaling-stroke" style="cursor:move"/>';
    bg += '<text x="' + (lx + hpx(9)) + '" y="' + (ly - hpx(9)) + '" fill="#8b5cf6" font-size="' + hpx(11) + '" font-weight="600" pointer-events="none" vector-effect="non-scaling-stroke">label</text>';
  }
  /* ports */
  if (cfg.showPorts) {
    let pd = '';
    const ink = cfg.inkCheck ? inkCheck(c) : null;
    for (const p of ports()) {
      const v = portToView(p, vb);
      const sel = selPort === p.id;
      const col = p.connectionClass === 'signal' ? '#e8830c' : p.connectionClass === 'process' ? '#2f6bff' : '#7a9a7a';
      const row = ink && ink.ports.find((o) => o.port.id === p.id);
      const bad = row && row.wrong;
      let extra = '';
      if (bad && row.target) {
        const t = portToView({ x: row.to.x, y: row.to.y }, vb);
        extra = '<line x1="' + rnd(v.x) + '" y1="' + rnd(v.y) + '" x2="' + rnd(t.x) + '" y2="' + rnd(t.y) + '" stroke="#d92d20" stroke-width="' + hpx(1.4) + '" stroke-dasharray="' + hpx(3) + ' ' + hpx(2.4) + '" vector-effect="non-scaling-stroke" pointer-events="none"/>' +
          '<circle cx="' + rnd(t.x) + '" cy="' + rnd(t.y) + '" r="' + hpx(3.4) + '" fill="none" stroke="#d92d20" stroke-width="' + hpx(1.2) + '" vector-effect="non-scaling-stroke" pointer-events="none"/>';
      }
      pd += extra + '<circle class="port-dot' + (bad ? ' port-bad' : '') + '" data-port="' + escHtml(p.id) + '" cx="' + rnd(v.x) + '" cy="' + rnd(v.y) + '" r="' + hpx(sel ? 7 : 5.5) +
        '" fill="' + col + '" stroke="' + (bad ? '#d92d20' : sel ? '#c62828' : '#fff') + '" stroke-width="' + hpx(sel || bad ? 2.5 : 1.8) + '" style="cursor:move"><title>' + escHtml(p.id) + (bad ? ' — ' + (row.onInk ? 'overlaps its linework' : 'floats ' + rnd(row.gap) + 'u off the linework') : '') + '</title></circle>';
    }
    inner = pd + inner;
  }

  /* selection visuals: per-element outlines, then either transform box or vertex handles */
  let ov = '';
  for (const i of selEls) {
    const b = elemBounds(i);
    if (b) ov += '<rect class="sel-outline" x="' + b.x0 + '" y="' + b.y0 + '" width="' + (b.x1 - b.x0) + '" height="' + (b.y1 - b.y0) + '"/>';
  }
  if (selEls.size && tool === 'select') {
    const b = selBounds();
    if (b) {
      const hs = hpx(7.5);
      if (nodeMode && selEls.size === 1) {
        /* node mode: vertices only — the transform box would overlap them */
        const vs = vertexList([...selEls][0]);
        vs.forEach((v, vi) => {
          const r = hpx(v.kind === 'ctrl' ? 3.4 : 4.4);
          const fill = v.kind === 'ctrl' ? varp('--ctrl') : varp('--handlefill');
          const stroke = v.kind === 'ctrl' ? '#fff' : varp('--handle');
          const cur2 = v.kind === 'ctrl' ? 'move' : v.kind === 'radius' ? (v.axis === 'y' ? 'ns-resize' : 'ew-resize') : v.kind === 'corner' ? 'nwse-resize' : 'move';
          ov += v.kind === 'ctrl'
            ? '<circle class="vertex ctrl" data-vi="' + vi + '" cx="' + rnd(v.vx) + '" cy="' + rnd(v.vy) + '" r="' + r + '" vector-effect="non-scaling-stroke"/>'
            : v.kind === 'corner'
              ? '<rect class="vertex" data-vi="' + vi + '" x="' + (v.vx - r) + '" y="' + (v.vy - r) + '" width="' + r * 2 + '" height="' + r * 2 + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + hpx(1.6) + '" vector-effect="non-scaling-stroke" style="cursor:' + cur2 + '"/>'
              : '<circle class="vertex" data-vi="' + vi + '" cx="' + rnd(v.vx) + '" cy="' + rnd(v.vy) + '" r="' + r + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + hpx(1.6) + '" vector-effect="non-scaling-stroke" style="cursor:' + cur2 + '"/>';
        });
      } else {
        ov += '<rect class="sel-box" x="' + b.x0 + '" y="' + b.y0 + '" width="' + (b.x1 - b.x0) + '" height="' + (b.y1 - b.y0) + '"/>';
        const corners = [['nw', b.x0, b.y0], ['ne', b.x1, b.y0], ['se', b.x1, b.y1], ['sw', b.x0, b.y1]];
        const edges = [['n', (b.x0 + b.x1) / 2, b.y0], ['e', b.x1, (b.y0 + b.y1) / 2], ['s', (b.x0 + b.x1) / 2, b.y1], ['w', b.x0, (b.y0 + b.y1) / 2]];
        for (const [k, x, y] of edges) ov += '<rect class="sc-handle" data-h="' + k + '" x="' + (x - hs / 2) + '" y="' + (y - hs / 2) + '" width="' + hs + '" height="' + hs + '" fill="' + varp('--handlefill') + '" stroke="' + varp('--handle') + '" stroke-width="' + hpx(1.6) + '" vector-effect="non-scaling-stroke" style="cursor:' + (k === 'n' || k === 's' ? 'ns-resize' : 'ew-resize') + '"/>';
        for (const [k, x, y] of corners) ov += '<rect class="sc-handle" data-h="' + k + '" x="' + (x - hs / 2) + '" y="' + (y - hs / 2) + '" width="' + hs + '" height="' + hs + '" fill="' + varp('--handlefill') + '" stroke="' + varp('--handle') + '" stroke-width="' + hpx(1.6) + '" vector-effect="non-scaling-stroke" style="cursor:' + (k === 'nw' || k === 'se' ? 'nwse-resize' : 'nesw-resize') + '"/>';
        const rotY = b.y0 - hpx(18);
        ov += '<line x1="' + (b.x0 + b.x1) / 2 + '" y1="' + b.y0 + '" x2="' + (b.x0 + b.x1) / 2 + '" y2="' + rotY + '" stroke="' + varp('--handle') + '" stroke-width="' + hpx(1) + '" vector-effect="non-scaling-stroke" pointer-events="none"/>';
        ov += '<circle class="sc-handle" data-h="rot" cx="' + (b.x0 + b.x1) / 2 + '" cy="' + rotY + '" r="' + hpx(5.5) + '" fill="' + varp('--handle') + '" stroke="' + varp('--handlefill') + '" stroke-width="' + hpx(1.6) + '" vector-effect="non-scaling-stroke" style="cursor:grab"/>';
      }
    }
  }
  /* pen preview */
  if (pen && pen.pts.length) {
    let d = 'M ' + pen.pts.map((p) => rnd(p.x) + ' ' + rnd(p.y)).join(' L ');
    ov += '<path class="rubber" d="' + d + '"/>';
    if (pen.cursor) ov += '<path class="ghost" d="M ' + rnd(pen.pts[pen.pts.length - 1].x) + ' ' + rnd(pen.pts[pen.pts.length - 1].y) + ' L ' + rnd(pen.cursor.x) + ' ' + rnd(pen.cursor.y) + '"/>';
    for (const p of pen.pts) ov += '<circle cx="' + rnd(p.x) + '" cy="' + rnd(p.y) + '" r="' + hpx(3) + '" fill="' + varp('--handle') + '" pointer-events="none"/>';
  }
  if (creating) {
    ov += '<path class="ghost" d="' + creating.d + '"/>';
  }
  if (drag && drag.snapLines) {
    for (const s of drag.snapLines) {
      ov += s.axis === 'x'
        ? '<line class="snap-guide" x1="' + s.pos + '" y1="' + vb.y + '" x2="' + s.pos + '" y2="' + (vb.y + vb.h) + '"/>'
        : '<line class="snap-guide" x1="' + vb.x + '" y1="' + s.pos + '" x2="' + (vb.x + vb.w) + '" y2="' + s.pos + '"/>';
    }
  }
  if (hoverEl >= 0 && !selEls.has(hoverEl)) {
    const b = elemBounds(hoverEl);
    if (b) ov += '<rect x="' + b.x0 + '" y="' + b.y0 + '" width="' + (b.x1 - b.x0) + '" height="' + (b.y1 - b.y0) + '" fill="none" stroke="' + varp('--handle') + '" stroke-width="' + hpx(1) + '" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" opacity=".55" pointer-events="none"/>';
  }

  const defs = '<defs><pattern id="gridpat" width="' + cfg.gridStep + '" height="' + cfg.gridStep + '" patternUnits="userSpaceOnUse">' +
    '<path d="M ' + cfg.gridStep + ' 0 L 0 0 0 ' + cfg.gridStep + '" fill="none" stroke="' + varp('--grid') + '" stroke-width="0.15"/></pattern></defs>';
  const svgEl = $('scene');
  svgEl.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
  svgEl.setAttribute('width', side);
  svgEl.setAttribute('height', Math.round(side * vb.h / vb.w));
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svgEl.innerHTML = defs + bg + gd + inner + ov;
  applyView();
  $('zoomVal').textContent = Math.round(view.k * 100) + '%';
  $('stZoom').textContent = 'zoom ' + Math.round(view.k * 100) + '%';
}
function varp(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || '#2f6bff';
}
function applyView() {
  const svg = $('scene');
  if (!svg) return;
  const cnv = $('canvas');
  const vb = viewDims(cur());
  const side = Math.round(fitBase() * view.k);
  const hh = Math.round(side * vb.h / vb.w);
  if (view.fit) {
    view.x = Math.round((cnv.clientWidth - side) / 2);
    view.y = Math.round((cnv.clientHeight - hh) / 2);
  }
  svg.style.left = view.x + 'px';
  svg.style.top = view.y + 'px';
  drawRulers();
}
/* ============================ 11. rulers ============================ */
function niceStep(px, minPx) {
  const steps = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500];
  for (const s of steps) if (s * px >= minPx) return s;
  return 1000;
}
function drawRulers() {
  const svg = $('scene');
  const rh = $('rulerHSvg'), rv = $('rulerVSvg');
  if (!svg || !rh || !rv) return;
  const cnv = $('canvas');
  const W = cnv.clientWidth, H = cnv.clientHeight;
  const vb = viewDims(cur());
  const px = view.k * (sideOf() / vb.w); // css px per viewBox unit
  const colCss = getComputedStyle(document.body);
  const stroke = colCss.getPropertyValue('--border2').trim() || '#c3cfdf';
  const strokeMajor = colCss.getPropertyValue('--text3').trim() || '#8b99ab';
  const labelFill = strokeMajor;
  rh.setAttribute('width', W); rh.setAttribute('height', 18);
  rv.setAttribute('width', 18); rv.setAttribute('height', H);
  const toScreenX = (vx) => view.x + (vx - vb.x) * px;
  const toScreenY = (vy) => view.y + (vy - vb.y) * px;
  let h = '', v = '';
  if (px > 0.4) {
    const step = niceStep(px, 64);
    const minor = niceStep(px, 11);
    const vx0 = ((0 - view.x) / px) + vb.x, vx1 = ((W - view.x) / px) + vb.x;
    for (let vx = Math.ceil(vx0 / minor) * minor; vx <= vx1; vx += minor) {
      const X = Math.round(toScreenX(vx)) + 0.5;
      const major = Math.abs(vx / step - Math.round(vx / step)) < 1e-6;
      h += '<line class="ruler-tick' + (major ? ' major' : '') + '" x1="' + X + '" y1="' + (major ? 2 : 5) + '" x2="' + X + '" y2="18"/>';
      if (major) h += '<text class="ruler-label" x="' + (X + 3) + '" y="11">' + rnd(vx) + '</text>';
    }
    const vy0 = ((0 - view.y) / px) + vb.y, vy1 = ((H - view.y) / px) + vb.y;
    for (let vy = Math.ceil(vy0 / minor) * minor; vy <= vy1; vy += minor) {
      const Y = Math.round(toScreenY(vy)) + 0.5;
      const major = Math.abs(vy / step - Math.round(vy / step)) < 1e-6;
      v += '<line class="ruler-tick' + (major ? ' major' : '') + '" x1="' + (major ? 2 : 5) + '" y1="' + Y + '" x2="18" y2="' + Y + '"/>';
      if (major) v += '<text class="ruler-label" x="9" y="' + (Y - 3) + '" transform="rotate(-90 9 ' + (Y - 3) + ')" text-anchor="end">' + rnd(vy) + '</text>';
    }
  }
  rh.innerHTML = h;
  rv.innerHTML = v;
}

/* ============================ 12. snapping ============================ */
function snapTargets(exclude) {
  const nodes = analyze(cur().svg);
  const vb = viewDims(cur());
  const X = [], Y = [];
  if (cfg.snapGrid && cfg.gridStep > 0) {
    for (let x = vb.x; x <= vb.x + vb.w + 1e-6; x += cfg.gridStep) X.push(rnd(x));
    for (let y = vb.y; y <= vb.y + vb.h + 1e-6; y += cfg.gridStep) Y.push(rnd(y));
  }
  if (cfg.snapGuides) for (const g of guides) (g.axis === 'x' ? X : Y).push(g.pos);
  if (cfg.snapPorts) for (const p of ports()) { const v = portToView(p, vb); X.push(rnd(v.x)); Y.push(rnd(v.y)); }
  if (cfg.snapEls) {
    const mid = (vb.x + vb.x + vb.w) / 2;
    X.push(rnd(mid));
    Y.push(rnd((vb.y + vb.y + vb.h) / 2));
    for (const i of shapeIndices().shapes) {
      if (exclude && exclude.has(i)) continue;
      const b = elemBounds(i, nodes);
      if (!b) continue;
      X.push(rnd(b.x0), rnd(b.x1), rnd((b.x0 + b.x1) / 2));
      Y.push(rnd(b.y0), rnd(b.y1), rnd((b.y0 + b.y1) / 2));
    }
  }
  return { X: [...new Set(X)], Y: [...new Set(Y)] };
}
function snapVal(v, list, tol) {
  let best = v, bd = tol;
  for (const t of list) { const d = Math.abs(t - v); if (d < bd) { bd = d; best = t; } }
  return best;
}
/* snap a rect: returns adjusted rect + the guide lines that fired */
function snapRect(r, exclude, tolPx) {
  if (!cfg.snap) return { r, lines: [] };
  const svg = $('scene');
  const vb = viewDims(cur());
  const px = svg ? svg.getBoundingClientRect().width / vb.w : 1;
  const tol = tolPx / (px || 1);
  const T = snapTargets(exclude);
  const out = { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 };
  const lines = [];
  const candsX = [r.x0, (r.x0 + r.x1) / 2, r.x1];
  const candsY = [r.y0, (r.y0 + r.y1) / 2, r.y1];
  let bx = Infinity, sx = 0;
  for (const c of candsX) for (const t of T.X) { const d = Math.abs(t - c); if (d < bx) { bx = d; sx = t - c; } }
  let by = Infinity, sy = 0;
  for (const c of candsY) for (const t of T.Y) { const d = Math.abs(t - c); if (d < by) { by = d; sy = t - c; } }
  if (bx <= tol) { out.x0 += sx; out.x1 += sx; lines.push({ axis: 'x', pos: out.x0 }); }
  if (by <= tol) { out.y0 += sy; out.y1 += sy; lines.push({ axis: 'y', pos: out.y0 }); }
  return { r: out, lines };
}
function snapPoint(p, exclude, tolPx) {
  if (!cfg.snap) return { p, lines: [] };
  const svg = $('scene');
  const vb = viewDims(cur());
  const px = svg ? svg.getBoundingClientRect().width / vb.w : 1;
  const tol = tolPx / (px || 1);
  const T = snapTargets(exclude);
  const lines = [];
  const nx = snapVal(p.x, T.X, tol);
  const ny = snapVal(p.y, T.Y, tol);
  if (nx !== p.x) lines.push({ axis: 'x', pos: nx });
  if (ny !== p.y) lines.push({ axis: 'y', pos: ny });
  return { p: { x: nx, y: ny }, lines };
}

/* ============================ 13. coords ============================ */
function screenToView(e) {
  const svg = $('scene');
  if (!svg || !svg.getScreenCTM) return null;
  const inv = svg.getScreenCTM().inverse();
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(inv);
  return { x: p.x, y: p.y };
}
function fmtV(v) { return (Math.round(v * 10) / 10).toString(); }
function updateStatus() {
  $('stTool').textContent = (nodeMode ? 'Node edit · ' : '') + ({
    select: 'Select', pen: 'Pen', line: 'Line', rect: 'Rect', ellipse: 'Ellipse', text: 'Text', port: 'Port', pan: 'Pan',
  }[tool] || tool);
  const b = selBounds();
  if (selPort) $('stSel').textContent = 'port ' + selPort;
  else if (selEls.size) {
    const names = [...selEls].map((i) => analyze(cur().svg)[i]?.name).filter(Boolean);
    $('stSel').textContent = selEls.size + (selEls.size > 1 ? ' elements selected' : ' ' + names[0] + ' selected') +
      (b ? '  ·  ' + fmtV(b.x1 - b.x0) + ' × ' + fmtV(b.y1 - b.y0) : '');
  } else $('stSel').textContent = '';
  const vb = viewDims(cur());
  $('stDirty').textContent = isDirty(current) ? 'unsaved changes' : 'saved state';
  const warns = validateIssues();
  $('stWarn').hidden = !warns.length;
  $('stWarnSep').hidden = !warns.length;
  $('stWarn').textContent = warns.length ? warns.length + ' warning' + (warns.length > 1 ? 's' : '') : '';
}
function updateDirtyChrome() {
  $('dirtyPill').hidden = !isDirty(current);
  $('dirtyPill').textContent = isDirty(current) ? 'unsaved' : 'saved';
  $('dirtyN').textContent = String(dirtyCount());
  updateStatus();
}
function updateHistChrome() {
  $('undoBtn').disabled = !undoStack.length;
  $('redoBtn').disabled = !redoStack.length;
}
/* ============================ 14. interaction ============================ */
function setTool(t) {
  if (tool === 'pen' && t !== 'pen') cancelPen();
  tool = t;
  creating = null;
  document.querySelectorAll('#rail .tool[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  const cnv = $('canvas');
  cnv.classList.toggle('tool-draw', ['pen', 'line', 'rect', 'ellipse', 'text', 'port'].includes(t));
  cnv.classList.toggle('tool-pan', t === 'pan');
  updateStatus();
  renderCtxbar();
}
function hitPort(pt, tolPx) {
  const svg = $('scene');
  if (!svg) return null;
  const vb = viewDims(cur());
  const px = svg.getBoundingClientRect().width / vb.w;
  const tol = tolPx / px;
  for (const p of ports()) {
    const v = portToView(p, vb);
    if (Math.hypot(pt.x - v.x, pt.y - v.y) <= tol) return p;
  }
  return null;
}

let spaceDown = false;
$('canvas').addEventListener('pointerdown', (e) => {
  if (e.button === 2) return; // context menu handles it
  const cnv = $('canvas');
  const pt = screenToView(e);
  downInfo = { x: e.clientX, y: e.clientY, t: performance.now(), pointerId: e.pointerId, target: e.target };
  const wantPan = tool === 'pan' || spaceDown || e.button === 1;
  cnv.focus();
  if (wantPan) {
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    cnv.classList.add('panning');
    cnv.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  const onEmpty = !e.target.closest('[data-eid]') && !e.target.closest('.port-dot') && !e.target.closest('.vertex') && !e.target.closest('.sc-handle');

  /* --- handles (scale / rotate) --- */
  if (tool === 'select' && selEls.size) {
    const h = e.target.closest('.sc-handle');
    if (h && h.dataset.h) {
      const b0 = selBounds();
      drag = { kind: h.dataset.h === 'rot' ? 'rotate' : 'scale', h: h.dataset.h, b0, objStart: JSON.stringify(window.PID_SYMBOLS[current]), center: { x: (b0.x0 + b0.x1) / 2, y: (b0.y0 + b0.y1) / 2 }, startView: pt };
      cnv.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
  }
  /* --- vertices (node mode only, so they never fight the transform box) --- */
  if (tool === 'select' && nodeMode && selEls.size === 1) {
    const vh = e.target.closest('.vertex');
    if (vh) {
      const vi = +vh.dataset.vi;
      if (e.altKey) { deleteVertex([...selEls][0], vi); e.preventDefault(); return; }
      const idx = [...selEls][0];
      const objStart = JSON.stringify(window.PID_SYMBOLS[current]);
      drag = { kind: 'vertex', vi, idx, origin: pt, objStart };
      cnv.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
  }
  const meta = e.target.closest('[data-meta]');
  if (meta && pt) {
    pushUndo();
    drag = { kind: 'meta', metaKind: meta.dataset.meta, origin: pt, objStart: JSON.stringify(window.PID_SYMBOLS[current]), pushed: false };
    cnv.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  /* --- ports --- */
  const dot = e.target.closest('.port-dot');
  if (dot && pt) {
    const p = ports().find((q) => q.id === dot.dataset.port);
    if (p) {
      selPort = p.id;
      const objStart = JSON.stringify(window.PID_SYMBOLS[current]);
      const portStart = { x: p.x, y: p.y };
      drag = { kind: 'port', p, origin: pt, objStart, portStart };
      cnv.setPointerCapture(e.pointerId);
      refreshAll();
      e.preventDefault();
      return;
    }
  }
  /* --- element body --- */
  const shapeEl = e.target.closest('[data-eid]');
  if (shapeEl && pt) {
    const idx = eidMap[+shapeEl.dataset.eid] ?? -1;
    if (tool === 'select') {
      if (e.shiftKey) { selEls.has(idx) ? selEls.delete(idx) : selEls.add(idx); }
      else if (!selEls.has(idx)) selEls = new Set([idx]);
      if (!e.shiftKey) nodeMode = false;
      selPort = null;
      drag = { kind: 'move', origin: pt, objStart: JSON.stringify(window.PID_SYMBOLS[current]), last: pt, cumx: 0, cumy: 0 };
      cnv.setPointerCapture(e.pointerId);
      draw();
      renderInspector();
      renderCtxbar();
      updateStatus();
      e.preventDefault();
      return;
    }
  }
  /* --- empty canvas --- */
  if (!pt) return;
  if (tool === 'pen') { penClick(pt, e); e.preventDefault(); return; }
  if (tool === 'port') { addPortAt(pt); e.preventDefault(); return; }
  if (tool === 'text') { createTextAt(pt); e.preventDefault(); return; }
  if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
    creating = { kind: tool, x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y, d: '' };
    drag = { kind: 'create' };
    cnv.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  if (tool === 'select') {
    if (e.shiftKey) {
      drag = { kind: 'marquee', x0: e.clientX, y0: e.clientY, base: new Set(selEls) };
      const m = $('marquee');
      m.hidden = false;
      m.style.left = e.clientX - cnv.getBoundingClientRect().left + 'px';
      m.style.top = e.clientY - cnv.getBoundingClientRect().top + 'px';
      m.style.width = '0px'; m.style.height = '0px';
      cnv.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    selEls.clear(); selPort = null;
    drag = { kind: 'marquee', x0: e.clientX, y0: e.clientY, base: new Set() };
    const m = $('marquee');
    m.hidden = false;
    m.style.left = e.clientX - cnv.getBoundingClientRect().left + 'px';
    m.style.top = e.clientY - cnv.getBoundingClientRect().top + 'px';
    m.style.width = '0px'; m.style.height = '0px';
    cnv.setPointerCapture(e.pointerId);
    draw(); renderInspector(); renderCtxbar(); updateStatus();
    e.preventDefault();
  }
});

$('canvas').addEventListener('pointermove', (e) => {
  const pt = screenToView(e);
  const vb = viewDims(cur());
  if (pt && !drag) {
    const nv = viewToPort(pt.x, pt.y, vb);
    $('stCoords').textContent = 'x ' + fmtV(pt.x) + '  y ' + fmtV(pt.y) + '   ·   ' + fmtV(nv.x) + '%, ' + fmtV(nv.y) + '%';
  }
  /* pen preview */
  if (tool === 'pen' && pen && !drag && pt) { pen.cursor = pt; draw(); }

  if (!drag || !pt) return;
  const c = cur();

  if (drag.kind === 'pan') {
    view.x = drag.ox + (e.clientX - drag.sx);
    view.y = drag.oy + (e.clientY - drag.sy);
    view.fit = false;
    applyView();
    return;
  }
  if (drag.kind === 'marquee') {
    const r = $('canvas').getBoundingClientRect();
    const x = Math.min(drag.x0, e.clientX) - r.left, y = Math.min(drag.y0, e.clientY) - r.top;
    const w = Math.abs(e.clientX - drag.x0), h = Math.abs(e.clientY - drag.y0);
    const m = $('marquee');
    m.style.left = x + 'px'; m.style.top = y + 'px'; m.style.width = w + 'px'; m.style.height = h + 'px';
    drag.rect = { x, y, w, h, r };
    return;
  }
  if (drag.kind === 'meta') {
    if (!drag.pushed) { pushUndoSnap(current, drag.objStart); drag.pushed = true; }
    const c2 = cur();
    const snap = (v) => snapV(v, e.shiftKey);
    if (drag.metaKind === 'anchor') {
      c2.anchor = c2.anchor || { x: 50, y: 50 };
      c2.anchor.x = snap(pt.x); c2.anchor.y = snap(pt.y);
    } else if (drag.metaKind === 'label') {
      c2.labelAnchor = c2.labelAnchor || { x: 50, y: 86 };
      c2.labelAnchor.x = snap(pt.x); c2.labelAnchor.y = snap(pt.y);
    } else if (drag.metaKind.startsWith('extent-')) {
      const corner = drag.metaKind.slice('extent-'.length);
      c2.extents = c2.extents || { x0: 0, y0: 0, x1: 100, y1: 100 };
      const e0 = c2.extents;
      if (corner === 'nw') { e0.x0 = snap(pt.x); e0.y0 = snap(pt.y); }
      else if (corner === 'ne') { e0.x1 = snap(pt.x); e0.y0 = snap(pt.y); }
      else if (corner === 'se') { e0.x1 = snap(pt.x); e0.y1 = snap(pt.y); }
      else if (corner === 'sw') { e0.x0 = snap(pt.x); e0.y1 = snap(pt.y); }
    }
    touchDirty();
    draw();
    updateStatus();
    return;
  }
  if (drag.kind === 'port') {
    const vb2 = viewDims(c);
    const nv = viewToPort(pt.x, pt.y, vb2);
    const nx = snapV(nv.x, e.shiftKey), ny = snapV(nv.y, e.shiftKey);
    if (!drag.pushed && (nx !== drag.portStart.x || ny !== drag.portStart.y)) {
      pushUndoSnap(current, drag.objStart);
      drag.pushed = true;
    }
    drag.p.x = nx;
    drag.p.y = ny;
    touchDirty();
    draw();
    updateStatus();
    return;
  }
  if (drag.kind === 'move') {
    let ddx = pt.x - drag.last.x, ddy = pt.y - drag.last.y;
    if (e.shiftKey) { ddx *= 0.25; ddy *= 0.25; }
    drag.last = pt;
    if (!ddx && !ddy) return;
    if (!drag.pushed) { pushUndoSnap(current, drag.objStart); drag.pushed = true; }
    drag.cumx = (drag.cumx || 0) + ddx; drag.cumy = (drag.cumy || 0) + ddy;
    moveEls(ddx, ddy, e.shiftKey);
    showMeasure('dx ' + fmtV(drag.cumx) + '  dy ' + fmtV(drag.cumy));
    return;
  }
  if (drag.kind === 'vertex') {
    const vs = vertexList(drag.idx);
    const v = vs[drag.vi];
    if (!v) return;
    if (!drag.pushed) { pushUndoSnap(current, drag.objStart); drag.pushed = true; }
    applyVertexDrag(drag.idx, v, pt, e.shiftKey);
    draw();
    return;
  }
  if (drag.kind === 'scale') {
    if (!drag.pushed) { pushUndoSnap(current, drag.objStart); drag.pushed = true; }
    applyScale(drag, pt, e.shiftKey);
    return;
  }
  if (drag.kind === 'rotate') {
    if (!drag.pushed) { pushUndoSnap(current, drag.objStart); drag.pushed = true; }
    applyRotate(drag, pt, e.shiftKey);
    return;
  }
  if (drag.kind === 'create' && creating) {
    creating.x1 = pt.x; creating.y1 = pt.y;
    const s = snapPoint({ x: creating.x1, y: creating.y1 }, new Set(), 6);
    creating.x1 = s.p.x; creating.y1 = s.p.y;
    creating.d = creating.kind === 'line'
      ? 'M ' + rnd(creating.x0) + ' ' + rnd(creating.y0) + ' L ' + rnd(creating.x1) + ' ' + rnd(creating.y1)
      : creating.kind === 'rect'
        ? 'M ' + rnd(creating.x0) + ' ' + rnd(creating.y0) + ' H ' + rnd(creating.x1) + ' V ' + rnd(creating.y1) + ' H ' + rnd(creating.x0) + ' Z'
        : 'M ' + rnd(creating.x0) + ' ' + rnd(creating.y0) + ' A ' + rnd(Math.abs(creating.x1 - creating.x0) / 2) + ' ' + rnd(Math.abs(creating.y1 - creating.y0) / 2) + ' 0 1 0 ' + rnd(creating.x1) + ' ' + rnd(creating.y1);
    draw();
    return;
  }
});

$('canvas').addEventListener('pointerup', (e) => {
  const wasDrag = drag;
  drag = null;
  $('canvas').classList.remove('panning');
  $('marquee').hidden = true;
  hideMeasure();
  if (!wasDrag) return;
  if (wasDrag.kind === 'marquee') {
    const svg = $('scene');
    if (svg && wasDrag.rect) {
      const vb = viewDims(cur());
      const px = svg.getBoundingClientRect().width / vb.w;
      const mx0 = wasDrag.rect.x / px + vb.x, mx1 = (wasDrag.rect.x + wasDrag.rect.w) / px + vb.x;
      const my0 = wasDrag.rect.y / px + vb.y, my1 = (wasDrag.rect.y + wasDrag.rect.h) / px + vb.y;
      const hit = new Set(wasDrag.base);
      const nodes = analyze(cur().svg);
      for (const i of shapeIndices().shapes) {
        const b = elemBounds(i, nodes);
        if (b && b.x1 >= Math.min(mx0, mx1) && b.x0 <= Math.max(mx0, mx1) && b.y1 >= Math.min(my0, my1) && b.y0 <= Math.max(my0, my1)) hit.add(i);
      }
      selEls = hit;
      draw(); renderInspector(); renderCtxbar(); updateStatus();
    }
    return;
  }
  if (wasDrag.kind === 'create' && creating) {
    const c = creating;
    creating = null;
    if (Math.abs(c.x1 - c.x0) > 1 || Math.abs(c.y1 - c.y0) > 1) {
      commitNewShape(c.kind, c.x0, c.y0, c.x1, c.y1);
    }
    draw();
    return;
  }
  if (wasDrag.kind === 'port') { renderInspector(); }
  if (wasDrag.kind === 'move' || wasDrag.kind === 'vertex' || wasDrag.kind === 'scale' || wasDrag.kind === 'rotate' || wasDrag.kind === 'meta') {
    if (wasDrag.pushed) { touchDirty(); renderInspector(); }
    refreshAll();
  }
});
function viewToBox(v) { return v; }
$('canvas').addEventListener('pointercancel', () => { drag = null; $('marquee').hidden = true; $('canvas').classList.remove('panning'); hideMeasure(); });
/* ============================ 15. mutations ============================ */
function nodeSvg(idx) {
  const nodes = analyze(cur().svg);
  const [s, e] = elemExtent(nodes, idx);
  return cur().svg.slice(s, e);
}
function commitNodeAttrs(idx, newAttrsRaw) {
  const c = cur();
  const nodes = analyze(c.svg), n = nodes[idx];
  c.svg = c.svg.slice(0, n.start) + '<' + n.name + newAttrsRaw + (n.selfClose ? ' />' : '>') + c.svg.slice(n.end);
}
function setNodeAttr(idx, name, value) {
  const c = cur();
  const n = analyze(c.svg)[idx];
  commitNodeAttrs(idx, setAttrInRaw(n.attrsRaw, name, value));
}
function setNodeTransform(idx, m) {
  setNodeAttr(idx, 'transform', fmtTransform(m));
}
/* translate an element by viewBox delta, honoring ancestor transforms / own transform */
function translateElemLocal(idx, ddx, ddy) {
  const nodes = analyze(cur().svg), n = nodes[idx];
  if (!n) return;
  const a = parseAttrs(n.attrsRaw);
  let raw = n.attrsRaw;
  if (n.name === 'line') {
    raw = setAttrInRaw(setAttrInRaw(setAttrInRaw(setAttrInRaw(raw, 'x1', rnd((+a.x1 || 0) + ddx)), 'y1', rnd((+a.y1 || 0) + ddy)), 'x2', rnd((+a.x2 || 0) + ddx)), 'y2', rnd((+a.y2 || 0) + ddy));
  } else if (n.name === 'rect') {
    raw = setAttrInRaw(setAttrInRaw(raw, 'x', rnd((+a.x || 0) + ddx)), 'y', rnd((+a.y || 0) + ddy));
  } else if (n.name === 'circle' || n.name === 'ellipse') {
    raw = setAttrInRaw(setAttrInRaw(raw, 'cx', rnd((+a.cx || 0) + ddx)), 'cy', rnd((+a.cy || 0) + ddy));
  } else if (n.name === 'text') {
    raw = setAttrInRaw(setAttrInRaw(raw, 'x', rnd((+a.x || 0) + ddx)), 'y', rnd((+a.y || 0) + ddy));
  } else if ((n.name === 'polyline' || n.name === 'polygon') && a.points) {
    const v = a.points.match(/-?\d*\.?\d+(?:e-?\d+)?/g) || [];
    for (let i = 0; i + 1 < v.length; i += 2) { v[i] = rnd(+v[i] + ddx); v[i + 1] = rnd(+v[i + 1] + ddy); }
    raw = setAttrInRaw(raw, 'points', v.join(' '));
  } else if (n.name === 'path' && a.d) {
    raw = setAttrInRaw(raw, 'd', translatePathD(a.d, ddx, ddy));
  }
  commitNodeAttrs(idx, raw);
}
function snapV(v, fine) {
  if (fine) return rnd(v);
  const s = cfg.snapGrid ? cfg.gridStep : 0;
  return s ? rnd(Math.round(v / s) * s) : rnd(v);
}
/* move all selected by a viewBox-space delta (with optional snapping) */
function moveEls(ddx, ddy, fine) {
  const nodes = analyze(cur().svg);
  const b = selBounds();
  let dx = ddx, dy = ddy;
  if (cfg.snap && !fine) {
    const res = snapRect({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy }, new Set(selEls), 7);
    drag.snapLines = res.lines;
    dx = res.r.x0 - b.x0; dy = res.r.y0 - b.y0;
  } else if (drag) drag.snapLines = [];
  for (const i of selEls) {
    const ch = chainFull(nodes, i);
    const d = mApply(mInv(ch.ancM), dx, dy); // viewBox delta -> node-space delta
    if (ch.own) setNodeTransform(i, mMul(mTrans(d.x, d.y), ch.own));
    else translateElemLocal(i, d.x, d.y);
  }
  draw();
}
/* vertex drag: set the local coordinate under the cursor */
function applyVertexDrag(idx, v, pt, fine) {
  const nodes = analyze(cur().svg), n = nodes[idx];
  const ch = chainFull(nodes, idx);
  const a = parseAttrs(n.attrsRaw);
  const local = mApply(mInv(ch.full), pt.x, pt.y);
  const setXY = (lx, ly) => snapPair(lx, ly, v.axis, fine);
  const [lx, ly] = setXY(local.x, local.y);
  if (n.name === 'line') {
    const k1 = v.pi === 0 ? 'x1' : 'x2', k2 = v.pi === 0 ? 'y1' : 'y2';
    const raw = setAttrInRaw(setAttrInRaw(n.attrsRaw, k1, lx), k2, ly);
    commitNodeAttrs(idx, raw);
  } else if (n.name === 'polyline' || n.name === 'polygon') {
    const vv = a.points.match(/-?\d*\.?\d+(?:e-?\d+)?/g) || [];
    vv[v.pi * 2] = rnd(lx); vv[v.pi * 2 + 1] = rnd(ly);
    commitNodeAttrs(idx, setAttrInRaw(n.attrsRaw, 'points', vv.join(' ')));
  } else if (n.name === 'path') {
    const cmds = parsePathD(a.d);
    const cm = cmds[v.pi.ci];
    if (!cm) return;
    if (v.axis === 'x') cm.args[v.pi.ai] = snapV(lx, fine);
    else if (v.axis === 'y') cm.args[v.pi.ai] = snapV(ly, fine);
    else { cm.args[v.pi.ai] = snapV(lx, fine); cm.args[v.pi.ai + 1] = snapV(ly, fine); }
    commitNodeAttrs(idx, setAttrInRaw(n.attrsRaw, 'd', toD(cmds)));
  } else if (n.name === 'rect') {
    let x = +a.x || 0, y = +a.y || 0, w = +a.width || 0, h = +a.height || 0;
    if (v.cn === 'tl') { x = lx; y = ly; w = (+a.x + (+a.width || 0)) - lx; h = (+a.y + (+a.height || 0)) - ly; }
    else if (v.cn === 'tr') { y = ly; w = lx - (+a.x || 0); h = (+a.y + (+a.height || 0)) - ly; }
    else if (v.cn === 'bl') { x = lx; w = (+a.x + (+a.width || 0)) - lx; h = ly - (+a.y || 0); }
    else { w = lx - (+a.x || 0); h = ly - (+a.y || 0); }
    let raw = setAttrInRaw(setAttrInRaw(n.attrsRaw, 'x', rnd(x)), 'y', rnd(y));
    raw = setAttrInRaw(setAttrInRaw(raw, 'width', rnd(Math.max(0.2, w))), 'height', rnd(Math.max(0.2, h)));
    commitNodeAttrs(idx, raw);
  } else if (n.name === 'circle' || n.name === 'ellipse') {
    let raw = n.attrsRaw;
    if (v.kind === 'radius') {
      if (n.name === 'circle') raw = setAttrInRaw(raw, 'r', rnd(Math.max(0.2, Math.abs(lx - (+a.cx || 0)))));
      else if (v.axis === 'x') raw = setAttrInRaw(raw, 'rx', rnd(Math.max(0.2, Math.abs(lx - (+a.cx || 0)))));
      else raw = setAttrInRaw(raw, 'ry', rnd(Math.max(0.2, Math.abs(ly - (+a.cy || 0)))));
    } else {
      raw = setAttrInRaw(setAttrInRaw(raw, 'cx', snapV(lx, fine)), 'cy', snapV(ly, fine));
    }
    commitNodeAttrs(idx, raw);
  } else if (n.name === 'text') {
    commitNodeAttrs(idx, setAttrInRaw(setAttrInRaw(n.attrsRaw, 'x', snapV(lx, fine)), 'y', snapV(ly, fine)));
  }
}
function snapPair(lx, ly, axis, fine) {
  if (axis === 'x') return [snapV(lx, fine), ly];
  if (axis === 'y') return [lx, snapV(ly, fine)];
  return [snapV(lx, fine), snapV(ly, fine)];
}
/* scale selection: per-element transform compose around the fixed anchor */
const ANCHOR = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne', n: 's', s: 'n', e: 'w', w: 'e' };
function applyScale(d, pt, fine) {
  const b = d.b0;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const sx = Math.abs(b.x1 - b.x0) < 1e-6 ? 1 : (pt.x - cx) / ((b.x1 - b.x0) / 2);
  const sy = Math.abs(b.y1 - b.y0) < 1e-6 ? 1 : (pt.y - cy) / ((b.y1 - b.y0) / 2);
  const useX = ['nw', 'ne', 'sw', 'se', 'e', 'w'].includes(d.h);
  const useY = ['nw', 'ne', 'sw', 'se', 'n', 's'].includes(d.h);
  const kx = useX ? clamp(sx, 0.02, 60) : 1, ky = useY ? clamp(sy, 0.02, 60) : 1;
  const nodes = analyze(cur().svg);
  for (const i of selEls) {
    const ch = chainFull(nodes, i);
    // scale about the selection centre in viewBox space, expressed in the node's own space
    const cLocal = mApply(mInv(ch.ancM), cx, cy);
    const M = mMul(mTrans(cLocal.x, cLocal.y), mMul(mScale(kx, ky), mTrans(-cLocal.x, -cLocal.y)));
    setNodeTransform(i, mMul(M, ch.own || IDENT));
  }
  draw();
  updateStatus();
}
function applyRotate(d, pt, fine) {
  const cx = d.center.x, cy = d.center.y;
  let ang = (Math.atan2(pt.y - cy, pt.x - cx) - Math.atan2(d.startView.y - cy, d.startView.x - cx)) * 180 / Math.PI;
  if (!fine && Math.abs(ang % 15) < 4) ang = Math.round(ang / 15) * 15;
  const nodes = analyze(cur().svg);
  for (const i of selEls) {
    const ch = chainFull(nodes, i);
    const cLocal = mApply(mInv(ch.ancM), cx, cy);
    const M = mRot(ang, cLocal.x, cLocal.y);
    setNodeTransform(i, mMul(M, ch.own || IDENT));
  }
  draw();
  updateStatus();
}
/* ============================ 16. clipboard / z / delete / dup ============================ */
function copySel() {
  if (!selEls.size) return;
  clip = [...selEls].sort((a, b) => a - b).map((i) => nodeSvg(i));
  navigator.clipboard && navigator.clipboard.writeText(clip.join('\n')).catch(() => {});
  toast('Copied ' + clip.length + ' element' + (clip.length > 1 ? 's' : ''), 'ok');
}
function cutSel() { copySel(); deleteSel(); }
function pasteClip(atView) {
  if (!clip.length) return toast('Clipboard empty', 'warn');
  pushUndo();
  const c = cur();
  const nodes = analyze(c.svg);
  const firstIdx = shapeIndices().shapes[0] ?? -1;
  // measure the clipboard bbox in the source component's space by re-parsing against a temp svg
  const tmpSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' + clip.join('') + '</svg>';
  const tmpNodes = analyze(tmpSvg);
  let bb = null;
  const pushb = (x, y) => { bb = bb ? { x0: Math.min(bb.x0, x), y0: Math.min(bb.y0, y), x1: Math.max(bb.x1, x), y1: Math.max(bb.y1, y) } : { x0: x, y0: y, x1: x, y1: y }; };
  for (const i of tmpNodes.map((n, i2) => (n.kind === 'shape' ? i2 : -1)).filter((x) => x >= 0)) {
    const b = elemBoundsTmp(tmpNodes, i);
    if (b) { pushb(b.x0, b.y0); pushb(b.x1, b.y1); }
  }
  const inset = c.svg.lastIndexOf('</');
  let insert = '';
  for (const frag of clip) {
    let s = frag;
    if (bb && atView) {
      const dx = rnd(atView.x - (bb.x0 + bb.x1) / 2), dy = rnd(atView.y - (bb.y0 + bb.y1) / 2);
      s = s.replace(/^<([\w-]+)/, '<$1 data-eid="" transform="translate(' + dx + ' ' + dy + ')"');
    } else if (bb) {
      const dx = rnd(5), dy = rnd(5);
      s = s.replace(/^<([\w-]+)/, '<$1 data-eid="" transform="translate(' + dx + ' ' + dy + ')"');
    }
    insert += s;
  }
  c.svg = inset >= 0 ? c.svg.slice(0, inset) + insert + c.svg.slice(inset) : c.svg + insert;
  // select the pasted copies
  const after = shapeIndices().shapes;
  selEls = new Set(after.slice(after.length - clip.length));
  touchDirty();
  refreshAll();
  toast('Pasted ' + clip.length, 'ok');
}
function elemBoundsTmp(nodes, i) {
  const n = nodes[i];
  if (!n || n.kind !== 'shape') return null;
  const ch = chainFull(nodes, i);
  let b = null;
  for (const [lx, ly] of localPts(n)) {
    const v = mApply(ch.full, lx, ly);
    b = b ? { x0: Math.min(b.x0, v.x), y0: Math.min(b.y0, v.y), x1: Math.max(b.x1, v.x), y1: Math.max(b.y1, v.y) }
          : { x0: v.x, y0: v.y, x1: v.x, y1: v.y };
  }
  return b;
}
function deleteSel() {
  if (!selEls.size) return;
  pushUndo();
  const c = cur();
  let svg = c.svg, removed = 0;
  for (const i of [...selEls].sort((a, b) => b - a)) {
    const nodes = analyze(svg), n = nodes[i];
    if (!n || n.kind !== 'shape') continue;
    const [s, e] = elemExtent(nodes, i);
    svg = svg.slice(0, s) + svg.slice(e);
    removed++;
  }
  c.svg = svg;
  selEls.clear();
  touchDirty();
  refreshAll();
  toast('Deleted ' + removed + ' element' + (removed > 1 ? 's' : ''), 'ok');
}
function duplicateSel() {
  if (!selEls.size) return;
  pushUndo();
  const c = cur();
  let svg = c.svg;
  const newIdx = [];
  for (const i of [...selEls].sort((a, b) => a - b)) {
    const nodes = analyze(svg);
    const [s, e] = elemExtent(nodes, i);
    const frag = svg.slice(s, e);
    svg = svg.slice(0, e) + frag + svg.slice(e);
  }
  c.svg = svg;
  const after = shapeIndices().shapes;
  selEls = new Set(after.slice(after.length - selEls.size));
  touchDirty();
  refreshAll();
  toast('Duplicated', 'ok');
}
function zOrder(dir) {
  if (!selEls.size) return;
  const sel = [...selEls].sort((a, b) => a - b);
  const newSel = [];
  let moved = 0;
  for (const i of sel) {
    const before = analyze(cur().svg);
    const shapes = before.map((n, ix) => (n.kind === 'shape' ? ix : -1)).filter((x) => x >= 0);
    const at = shapes.indexOf(i);
    if (at < 0) continue;
    const swap = dir === 'front' ? shapes[shapes.length - 1] : dir === 'back' ? shapes[0]
      : dir === 'up' ? shapes[at + 1] : shapes[at - 1];
    if (swap === undefined || swap === i) continue;
    pushUndo();
    const c = cur();
    const frag = nodeSvg(i); // identity of the moved element, to re-find it after the splice
    const [s1, e1] = elemExtent(before, i), [s2, e2] = elemExtent(before, swap);
    if (e1 <= s2) {
      c.svg = c.svg.slice(0, s1) + c.svg.slice(s2, e2) + c.svg.slice(e1, s2) + c.svg.slice(s1, e1) + c.svg.slice(e2);
    } else if (e2 <= s1) {
      c.svg = c.svg.slice(0, s2) + c.svg.slice(s1, e1) + c.svg.slice(e2, s1) + c.svg.slice(s2, e2) + c.svg.slice(e1);
    } else continue;
    moved++;
    const after = analyze(c.svg);
    const afterShapes = after.map((n, ix) => (n.kind === 'shape' ? ix : -1)).filter((x) => x >= 0);
    const found = afterShapes.find((ix) => {
      const [a, b2] = elemExtent(after, ix);
      return c.svg.slice(a, b2) === frag;
    });
    if (found !== undefined) newSel.push(found);
  }
  if (newSel.length) selEls = new Set(newSel);
  touchDirty();
  refreshAll();
  toast(dir === 'front' ? 'Brought to front' : dir === 'back' ? 'Sent to back' : dir === 'up' ? 'Brought forward' : 'Sent backward', 'ok');
}
function mirrorSel(axis) {
  if (!selEls.size) return;
  pushUndo();
  const b = selBounds();
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const nodes = analyze(cur().svg);
  for (const i of selEls) {
    const ch = chainFull(nodes, i);
    const cLocal = mApply(mInv(ch.ancM), cx, cy);
    const M = axis === 'h' ? mMul(mTrans(2 * cLocal.x, 0), mScale(-1, 1)) : mMul(mTrans(0, 2 * cLocal.y), mScale(1, -1));
    setNodeTransform(i, mMul(M, ch.own || IDENT));
  }
  touchDirty();
  refreshAll();
  toast(axis === 'h' ? 'Flipped horizontally' : 'Flipped vertically', 'ok');
}
function rotate90(dir) {
  if (!selEls.size) return;
  pushUndo();
  const b = selBounds();
  const nodes = analyze(cur().svg);
  for (const i of selEls) {
    const ch = chainFull(nodes, i);
    const cLocal = mApply(mInv(ch.ancM), (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    setNodeTransform(i, mMul(mRot(dir === 'cw' ? 90 : -90, cLocal.x, cLocal.y), ch.own || IDENT));
  }
  touchDirty();
  refreshAll();
  toast('Rotated ' + (dir === 'cw' ? '90° CW' : '90° CCW'), 'ok');
}
function alignSel(mode) {
  if (selEls.size < 2) return toast('Select 2+ elements to align', 'warn');
  pushUndo();
  const nodes = analyze(cur().svg);
  const all = selBounds();
  const boxes = [...selEls].map((i) => ({ i, b: elemBounds(i, nodes) })).filter((x) => x.b);
  const first = boxes[0].b;
  for (const { i, b } of boxes) {
    let dx = 0, dy = 0;
    if (mode === 'l') dx = first.x0 - b.x0;
    else if (mode === 'r') dx = first.x1 - b.x1;
    else if (mode === 't') dy = first.y0 - b.y0;
    else if (mode === 'b') dy = first.y1 - b.y1;
    else if (mode === 'ch') dx = (first.x0 + first.x1) / 2 - (b.x0 + b.x1) / 2;
    else if (mode === 'cv') dy = (first.y0 + first.y1) / 2 - (b.y0 + b.y1) / 2;
    if (dx || dy) {
      const ch = chainFull(nodes, i);
      const d = mApply(mInv(ch.ancM), dx, dy);
      if (ch.own) setNodeTransform(i, mMul(mTrans(d.x, d.y), ch.own));
      else translateElemLocal(i, d.x, d.y);
    }
  }
  touchDirty();
  refreshAll();
  toast('Aligned', 'ok');
}
function distributeSel(axis) {
  if (selEls.size < 3) return toast('Select 3+ elements to distribute', 'warn');
  pushUndo();
  const nodes = analyze(cur().svg);
  const boxes = [...selEls].map((i) => ({ i, b: elemBounds(i, nodes) })).filter((x) => x.b);
  if (axis === 'h') {
    boxes.sort((p, q) => p.b.x0 - q.b.x0);
    const total = boxes.reduce((s, x) => s + (x.b.x1 - x.b.x0), 0);
    const span = boxes[boxes.length - 1].b.x1 - boxes[0].b.x0;
    const gap = (span - total) / (boxes.length - 1);
    let cur2 = boxes[0].b.x0;
    for (const { i, b } of boxes) {
      const d = cur2 - b.x0;
      const ch = chainFull(nodes, i);
      const dv = mApply(mInv(ch.ancM), d, 0);
      if (ch.own) setNodeTransform(i, mMul(mTrans(dv.x, dv.y), ch.own));
      else translateElemLocal(i, dv.x, dv.y);
      cur2 += (b.x1 - b.x0) + gap;
    }
  } else {
    boxes.sort((p, q) => p.b.y0 - q.b.y0);
    const total = boxes.reduce((s, x) => s + (x.b.y1 - x.b.y0), 0);
    const span = boxes[boxes.length - 1].b.y1 - boxes[0].b.y0;
    const gap = (span - total) / (boxes.length - 1);
    let cur2 = boxes[0].b.y0;
    for (const { i, b } of boxes) {
      const d = cur2 - b.y0;
      const ch = chainFull(nodes, i);
      const dv = mApply(mInv(ch.ancM), 0, d);
      if (ch.own) setNodeTransform(i, mMul(mTrans(dv.x, dv.y), ch.own));
      else translateElemLocal(i, dv.x, dv.y);
      cur2 += (b.y1 - b.y0) + gap;
    }
  }
  touchDirty();
  refreshAll();
  toast('Distributed', 'ok');
}
/* ============================ 17. style ops ============================ */
const STYLE_KEYS = ['stroke', 'fill', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor'];
function applyStyle(key, value) {
  if (!selEls.size) return;
  pushUndo();
  const nodes = analyze(cur().svg);
  for (const i of selEls) {
    const n = nodes[i];
    if (!n || n.kind !== 'shape') continue;
    setNodeAttr(i, key, value);
  }
  touchDirty();
  refreshAll();
  toast(key + ' = ' + (value || '(removed)'), 'ok');
}
function removeStyle(key) {
  if (!selEls.size) return;
  pushUndo();
  const nodes = analyze(cur().svg);
  for (const i of selEls) {
    const n = nodes[i];
    if (!n || n.kind !== 'shape') continue;
    setNodeAttr(i, key, '');
  }
  touchDirty();
  refreshAll();
}
function commonStyleValue(key) {
  const nodes = analyze(cur().svg);
  let v = null, mixed = false, first = true;
  for (const i of selEls) {
    const a = parseAttrs(nodes[i] && nodes[i].attrsRaw);
    const val = a[key];
    if (first) { v = val; first = false; }
    else if (val !== v) mixed = true;
  }
  return { v: mixed ? '' : (v ?? ''), mixed };
}
function applyAllDefaults() {
  const sw = $('swAll').value.trim(), st = $('strokeAll').value.trim();
  const c = cur();
  if (!sw && !st) return toast('Nothing to apply', 'warn');
  pushUndo();
  const nodes = analyze(c.svg);
  let out = '', last = 0;
  for (const n of nodes) {
    if (n.kind !== 'shape') continue;
    let raw = n.attrsRaw;
    if (sw) raw = setAttrInRaw(raw, 'stroke-width', sw);
    if (st) raw = setAttrInRaw(raw, 'stroke', st);
    out += c.svg.slice(last, n.start) + '<' + n.name + raw + (n.selfClose ? ' />' : '>');
    last = n.end;
  }
  c.svg = out + c.svg.slice(last);
  touchDirty();
  refreshAll();
  toast('Applied to every shape', 'ok');
}
/* ============================ 18. new shapes ============================ */
const DEFAULTS = { stroke: 'currentColor', 'stroke-width': '2', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
const SHAPE_TPL = {
  line: (x0, y0, x1, y1) => '<line x1="' + rnd(x0) + '" y1="' + rnd(y0) + '" x2="' + rnd(x1) + '" y2="' + rnd(y1) + '"' + attrStr(DEFAULTS) + '/>',
  rect: (x0, y0, x1, y1) => '<rect x="' + rnd(Math.min(x0, x1)) + '" y="' + rnd(Math.min(y0, y1)) + '" width="' + rnd(Math.abs(x1 - x0)) + '" height="' + rnd(Math.abs(y1 - y0)) + '"' + attrStr(DEFAULTS) + '/>',
  ellipse: (x0, y0, x1, y1) => '<ellipse cx="' + rnd((x0 + x1) / 2) + '" cy="' + rnd((y0 + y1) / 2) + '" rx="' + rnd(Math.abs(x1 - x0) / 2) + '" ry="' + rnd(Math.abs(y1 - y0) / 2) + '"' + attrStr(DEFAULTS) + '/>',
};
const attrStr = (o) => Object.entries(o).map(([k, v]) => ' ' + k + '="' + v + '"').join('');
function commitNewShape(kind, x0, y0, x1, y1) {
  pushUndo();
  const frag = SHAPE_TPL[kind](x0, y0, x1, y1);
  addMarkup(frag);
  const after = shapeIndices().shapes;
  selEls = new Set(after.slice(after.length - 1));
  touchDirty();
  refreshAll();
  toast('Added ' + kind + ' — drag handles to refine', 'ok');
}
function addMarkup(frag) {
  const c = cur();
  const i = c.svg.lastIndexOf('</');
  c.svg = i >= 0 ? c.svg.slice(0, i) + frag + c.svg.slice(i) : c.svg + frag;
}
/* ============================ 19. pen tool ============================ */
function penClick(pt, e) {
  if (!pen) pen = { pts: [], cursor: null };
  const s = snapPoint(pt, new Set(), 8);
  pen.pts.push(s.p);
  draw();
}
function cancelPen() { pen = null; }
function commitPen() {
  if (!pen || pen.pts.length < 2) { pen = null; draw(); return; }
  pushUndo();
  const d = 'M ' + pen.pts.map((p) => rnd(p.x) + ' ' + rnd(p.y)).join(' L ') + (pen.closed ? ' Z' : '');
  pen = null;
  addMarkup('<path d="' + d + '"' + attrStr(DEFAULTS) + '/>');
  const after = shapeIndices().shapes;
  selEls = new Set(after.slice(after.length - 1));
  touchDirty();
  refreshAll();
  toast('Path created (' + after.length + ' pts)', 'ok');
}
function undoPenPoint() { if (pen && pen.pts.length) { pen.pts.pop(); draw(); } }
/* ============================ 20. text ============================ */
function createTextAt(pt) {
  pushUndo();
  const s = snapPoint(pt, new Set(), 8);
  const p = s.p;
  const frag = '<text x="' + rnd(p.x) + '" y="' + rnd(p.y) + '" text-anchor="middle" font-size="12" fill="currentColor" stroke="none">label</text>';
  addMarkup(frag);
  const after = shapeIndices().shapes;
  const idx = after[after.length - 1];
  selEls = new Set([idx]);
  touchDirty();
  refreshAll();
  openTextEditor(idx);
}
function textRange(idx) {
  const nodes = analyze(cur().svg), n = nodes[idx];
  if (!n || n.name !== 'text' || n.selfClose) return null;
  const [, e2] = elemExtent(nodes, idx);
  const cs = cur().svg.lastIndexOf('</' + n.name, e2);
  return cs < 0 ? null : [n.end, cs];
}
function openTextEditor(idx) {
  const nodes = analyze(cur().svg), n = nodes[idx];
  if (!n) return;
  const a = parseAttrs(n.attrsRaw);
  const ch = chainFull(nodes, idx);
  const r = textRange(idx);
  const txt = r ? cur().svg.slice(r[0], r[1]) : '';
  const wrap = $('textEditWrap');
  const ta = $('textEdit');
  const fs = parseFloat(a['font-size']) || 12;
  const anchor = mApply(ch.full, +a.x || 0, +a.y || 0);
  const svg = $('scene');
  const ctm = svg.getScreenCTM();
  const pt = svg.createSVGPoint(); pt.x = anchor.x; pt.y = anchor.y;
  const scr = pt.matrixTransform(ctm);
  const cnvRect = $('canvas').getBoundingClientRect();
  const px = fs * ctm.a; // ctm maps viewBox units -> css px, incl. zoom
  const wpx = Math.max(90, fs * 8);
  wrap.hidden = false;
  wrap.style.left = (scr.x - cnvRect.left - wpx / 2) + 'px';
  wrap.style.top = (scr.y - cnvRect.top - px * 0.8) + 'px';
  wrap.style.width = wpx + 'px';
  wrap.style.height = px * 1.3 + 'px';
  ta.style.fontSize = px + 'px';
  ta.style.fontFamily = (a['font-family'] && a['font-family'] !== 'inherit') ? a['font-family'] : 'var(--sans)';
  ta.value = txt;
  ta.focus(); ta.select();
  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    wrap.hidden = true;
    if (save && ta.value !== txt && r) {
      pushUndo();
      cur().svg = cur().svg.slice(0, r[0]) + escHtml(ta.value) + cur().svg.slice(r[1]);
      touchDirty();
    }
    refreshAll();
  };
  ta.onkeydown = (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
    else if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(true); }
  };
  ta.onblur = () => commit(true);
}
/* ============================ 21. ports ============================ */
const PORT_DEF = { ownerId: '', type: 'pipe', role: 'connection', direction: null, connectionClass: 'process', connectionType: 'process', flowDirection: null, cardinality: 1, lead: 14, allowedTypes: null, position: null, orientation: null, networkId: null };
function addPortAt(pt) {
  const def = cur();
  const vb = viewDims(def);
  const np = viewToPort(pt.x, pt.y, vb);
  const id = uniquePortId(def);
  pushUndo();
  def.ports = def.ports || [];
  def.ports.push(Object.assign({ id, x: rnd(np.x), y: rnd(np.y) }, PORT_DEF));
  selPort = id;
  touchDirty();
  refreshAll();
  toast('Added ' + id + ' — edit type/role in the ports panel', 'ok');
}
function uniquePortId(def) {
  let n = (def.ports || []).length + 1, id = 'port' + n;
  while ((def.ports || []).some((p) => p.id === id)) id = 'port' + ++n;
  return id;
}
function delPort(id) {
  const def = cur();
  pushUndo();
  def.ports = (def.ports || []).filter((p) => p.id !== id);
  if (selPort === id) selPort = null;
  touchDirty();
  refreshAll();
  toast('Deleted port ' + id, 'ok');
}
/* ============================ 22. validation ============================ */
function validateIssues() {
  const c = cur();
  if (!c) return [];
  const issues = [];
  const ps = ports();
  if (!ps.length) issues.push({ msg: 'no ports defined' });
  const ids = new Set();
  const vb = viewDims(c);
  for (const p of ps) {
    if (ids.has(p.id)) issues.push({ msg: 'duplicate port ' + p.id, port: p.id });
    ids.add(p.id);
    if (p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100) issues.push({ msg: p.id + ' off-canvas', port: p.id });
  }
  const e0 = c.extents || { x0: vb.x, y0: vb.y, x1: vb.x + vb.w, y1: vb.y + vb.h };
  for (const p of ps) {
    const px = (p.x / 100) * vb.w, py = (p.y / 100) * vb.h;
    if (px < e0.x0 - 1 || px > e0.x1 + 1 || py < e0.y0 - 1 || py > e0.y1 + 1) issues.push({ msg: p.id + ' maps outside extents', port: p.id });
  }
  if (c.anchor && (c.anchor.x < e0.x0 - 1 || c.anchor.x > e0.x1 + 1 || c.anchor.y < e0.y0 - 1 || c.anchor.y > e0.y1 + 1)) issues.push({ msg: 'anchor outside extents' });
  if (c.extents && (c.extents.x1 <= c.extents.x0 || c.extents.y1 <= c.extents.y0)) issues.push({ msg: 'extents inverted' });
  // ports must terminate on the glyph's own linework (mirrors fix-port-linework.mjs)
  try {
    const chk = inkCheck(c);
    if (chk) for (const o of chk.ports) {
      if (!o.wrong) continue;
      issues.push({
        msg: 'port ' + o.port.id + (o.onInk ? ' overlaps its linework' : ' floats ' + rnd(o.gap) + 'u off the linework'),
        port: o.port.id, ink: o,
      });
    }
  } catch (_) {}
  try {
    if (window.PIDValidator && window.PIDValidator.validateSymbol) {
      const r = window.PIDValidator.validateSymbol(current, c) || {};
      (r.issues || r.errors || []).forEach((i) => issues.push({ msg: typeof i === 'string' ? i : i.message || 'validator flag' }));
    }
  } catch (_) {}
  return issues;
}
/* ============================ 23. measure badge ============================ */
function showMeasure(html) {
  const m = $('measure');
  m.innerHTML = html;
  m.hidden = false;
  const cnv = $('canvas').getBoundingClientRect();
  m.style.left = Math.min(cnv.width - m.offsetWidth - 12, cnv.width / 2 - m.offsetWidth / 2) + 'px';
  m.style.top = '14px';
}
function hideMeasure() { $('measure').hidden = true; }

/* ============================ 24. browser ============================ */
let filter = 'all';
let favSet = new Set(cfg.favorites);
function visibleIds() {
  const q = $('search').value.trim().toLowerCase();
  let ids = ALL;
  if (filter === 'dirty') ids = ids.filter((id) => isDirty(id));
  if (filter === 'fav') ids = ids.filter((id) => favSet.has(id));
  if (q) ids = ids.filter((id) => {
    if (id.toLowerCase().includes(q)) return true;
    const c = window.PID_SYMBOLS[id];
    return (c.standard || '').toLowerCase().includes(q) ||
      (c.behavior ? Object.keys(c.behavior).some((k) => k.toLowerCase().includes(q)) : false);
  });
  return ids;
}
function thumbSvg(id) {
  const c = window.PID_SYMBOLS[id];
  if (!c || !c.svg) return '';
  const vb = viewDims(c);
  const inner = svgParts(c.svg) ? svgParts(c.svg).inner : innerOf(c.svg);
  return '<svg viewBox="' + vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h + '" width="22" height="22" preserveAspectRatio="xMidYMid meet">' + inner + '</svg>';
}
function renderList() {
  const vis = visibleIds();
  $('count').textContent = vis.length + ' of ' + ALL.length + ' symbols';
  $('favN').textContent = String(favSet.size);
  $('dirtyN').textContent = String(dirtyCount());
  let html = '', lastGroup = '';
  for (const id of vis) {
    const group = id.split('/').slice(0, 2).join('/');
    if (group !== lastGroup) { html += '<div class="list-group">' + escHtml(group) + '</div>'; lastGroup = group; }
    html += '<div class="list-item' + (id === current ? ' sel' : '') + (isDirty(id) ? ' dirty' : '') + (favSet.has(id) ? ' starred' : '') +
      '" data-id="' + escHtml(id) + '" role="option" aria-selected="' + (id === current) + '" title="' + escHtml(id) + '">' +
      '<span class="li-star">' + ic('star') + '</span>' +
      (isDirty(id) ? '<span class="li-dot"></span>' : '') +
      '<span class="li-thumb">' + thumbSvg(id) + '</span>' +
      '<span class="li-label">' + escHtml(id) + '</span></div>';
  }
  $('list').innerHTML = html || '<div class="list-empty">no matches</div>';
}
function select(id) {
  if (!ALL.includes(id)) return;
  current = id;
  selPort = null; selEls.clear();
  nodeMode = false;
  view = { k: 1, x: 0, y: 0, fit: true };
  guides = [];
  refreshAll();
  $('crumbName').textContent = id;
  $('crumbName').title = id;
  // scroll the browser to the selection
  const row = $('list').querySelector('.list-item.sel');
  if (row) row.scrollIntoView({ block: 'nearest' });
  setTool(tool === 'pan' ? 'pan' : 'select');
}
function step(d) {
  const vis = visibleIds();
  if (!vis.length) return;
  select(vis[(vis.indexOf(current) + d + vis.length) % vis.length]);
}
function refreshAll() {
  draw();
  renderList();
  renderInspector();
  renderCtxbar();
  updateDirtyChrome();
  updateHistChrome();
}
function toggleFav(id) {
  favSet.has(id) ? favSet.delete(id) : favSet.add(id);
  cfg.favorites = [...favSet];
  saveCfg();
  renderList();
}
function viewPanel() {
  const cb = (key, label, desc) => '<label class="fchk"><input type="checkbox" data-cfg="' + key + '"' + (cfg[key] ? ' checked' : '') + '><span><b>' + label + '</b><span class="vhint">' + desc + '</span></span></label>';
  return '<div class="view-grid">' +
    cb('showPorts', 'Ports', 'connection points — drag a dot to move it') +
    cb('showExtents', 'Extents', 'bounding box — drag the yellow corners to resize') +
    cb('showAnchor', 'Anchor', 'placement centre — drag the red cross to move it') +
    cb('showLabel', 'Label anchor', 'text placement point — drag the purple dot') +
    cb('grid', 'Grid', 'snap grid overlay') +
    cb('showGuides', 'Guides', 'draggable guide lines (double-click a ruler to clear)') +
    cb('snap', 'Snapping', 'snap drags to grid / elements / ports / guides') +
    cb('inkCheck', 'Ink check', 'flag ports that do not terminate on the linework') +
  cb('diff', 'Diff vs pristine', 'overlay the original glyph in green — see exactly what you changed') +
    '<div class="sec-hint" style="margin:4px 0 0">Turn on Anchor / Extents / Label to see &amp; drag those points on the canvas.</div>' +
    '<div class="fspan"><div class="fgrid"><div class="flabel">grid step</div><div class="fcontrol">' +
    '<select class="fsel" data-cfg="gridStep">' + [1, 2, 2.5, 5, 10, 20].map((s) => '<option value="' + s + '"' + (cfg.gridStep === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div></div></div>' +
    '</div>';
}
/* ============================ view panel ============ */
function sec(id, title, n, bodyHTML, open) {
  const isOpen = cfg.sections[id] !== undefined ? cfg.sections[id] : (open !== false);
  return '<section class="sec' + (isOpen ? '' : ' collapsed') + '" data-sec="' + id + '">' +
    '<button class="sec-head" data-toggle-sec="' + id + '">' + ic('down', 'chev') + '<span>' + title + '</span>' +
    (n !== undefined && n !== '' ? '<span class="sec-n">' + escHtml(String(n)) + '</span>' : '') + '</button>' +
    '<div class="sec-body">' + bodyHTML + '</div></section>';
}
function renderInspector() {
  const c = cur();
  if (!c) { $('inspector').innerHTML = ''; return; }
  const vb = viewDims(c);
  const ps = ports();
  const issues = validateIssues();
  let h = '';
  /* --- view --- */
  h += sec('view', 'View', '', viewPanel());
  /* --- component --- */
  h += sec('comp', 'Component', '', compForm(c));
  /* --- ports --- */
  h += sec('ports', 'Ports', ps.length, portsPanel(ps));
  /* --- selected element --- */
  h += sec('elem', 'Element', selEls.size || (selPort ? 'port' : ''), elemPanel(selEls.size === 1 ? [...selEls][0] : -1, selEls.size));
  /* --- layers --- */
  h += sec('layers', 'Elements', shapeIndices().shapes.length, layersPanel());
  /* --- validation --- */
  h += sec('valid', 'Validation', issues.length ? issues.length : 'ok', validPanel(issues));
  /* --- glyph preview --- */
  h += sec('prev', 'Diagram preview', '', previewPanel(c, vb));
  /* --- svg defaults --- */
  h += sec('defaults', 'SVG defaults', '', defaultsPanel());
  /* --- source --- */
  h += sec('src', 'SVG source', '', sourcePanel(c), false);
  $('inspector').innerHTML = h;
  bindInspector();
}
function compForm(c) {
  const b = c.behavior || {};
  return '<div class="fgrid">' +
    row('standard', fld('standard', c.standard || '', 'e.g. ISA-5.1')) +
    row('nominal size', '<div class="dual">' + num('size', c.size, 1) + num('version', c.version ?? 1, 1) + '</div>') +
    row('flowAxis', '<div class="dual">' + sel('flowAxis', [['', '(none)'], ['h', 'h'], ['v', 'v']], c.flowAxis) +
      '<label class="fchk"><input type="checkbox" data-flag="autoRotate"' + (c.autoRotate ? ' checked' : '') + '>autoRotate</label></div>') +
    row('rotatable', '<label class="fchk"><input type="checkbox" data-flag="rotatable"' + (c.rotatable !== false ? ' checked' : '') + '>allow rotation in diagrams</label>') +
    row('anchor', '<div class="dual">' + num('anchor.x', c.anchor?.x ?? 50) + num('anchor.y', c.anchor?.y ?? 50) + '</div>') +
    row('label anchor', '<div class="dual">' + num('labelAnchor.x', c.labelAnchor?.x ?? 50) + num('labelAnchor.y', c.labelAnchor?.y ?? 86) + '</div>') +
    row('extents', '<div class="fgrid" style="grid-template-columns:1fr 1fr">' + num('extents.x0', c.extents?.x0 ?? 0) + num('extents.y0', c.extents?.y0 ?? 0) + num('extents.x1', c.extents?.x1 ?? vb.w) + num('extents.y1', c.extents?.y1 ?? vb.h) + '</div>') +
    '<div class="fspan"><div class="fgrid">' +
    ['isolation', 'throttling', 'directional', 'actuated', 'requiresControl', 'safety'].map((k) =>
      '<label class="fchk"><input type="checkbox" data-beh="' + k + '"' + (b[k] ? ' checked' : '') + '>' + k + '</label>').join('') +
    '</div></div>' +
    row('min ports', num('behavior.minProcessPorts', b.minProcessPorts ?? 2, 1)) +
    '</div>' +
    '<div class="src-toolbar"><button class="btn sm" id="btnRevert">' + ic('undo') + 'Revert component</button>' +
    '<button class="btn sm" id="btnExport">' + ic('download') + 'Export JSON</button>' +
    '<button class="btn sm" id="btnPng">' + ic('image') + 'Export PNG</button>' +
    '<button class="btn sm" id="btnCopySvg">' + ic('clipboard') + 'Copy SVG</button></div>';
}
const row = (label, ctrl) => '<div class="flabel">' + label + '</div><div class="fcontrol">' + ctrl + '</div>';
const fld = (path, v, ph) => '<input class="fld" type="text" value="' + escHtml(v) + '" data-path="' + path + '"' + (ph ? ' placeholder="' + escHtml(ph) + '"' : '') + '>';
const num = (path, v, step) => '<input class="fnum" type="number" step="' + (step ?? 0.5) + '" value="' + (v ?? 0) + '" data-path="' + path + '">';
const sel = (path, opts, v) => '<select class="fsel" data-path="' + path + '">' + opts.map(([val, lbl]) => '<option value="' + val + '"' + (String(v ?? '') === val ? ' selected' : '') + '>' + lbl + '</option>').join('') + '</select>';
function portsPanel(ps) {
  const clsColor = (p) => p.connectionClass === 'signal' ? '#e8830c' : p.connectionClass === 'process' ? '#2f6bff' : '#7a9a7a';
  const ink = cfg.inkCheck ? inkCheck() : null;
  const bad = ink ? ink.ports.filter((o) => o.wrong) : [];
  return '<div class="ports-head"><button class="btn sm" id="btnAddPort">' + ic('plus') + 'Add port</button><span class="sec-n">' + ps.length + ' total</span><span class="tb-spacer"></span>' +
    '<span class="sec-n">click a dot on canvas to select</span></div>' +
    (bad.length ? '<div class="ink-note">' + ic('warn') + '<span>' + bad.length + ' port' + (bad.length > 1 ? 's do' : ' does') + ' not terminate on the linework</span>' +
      '<button class="btn xs" id="btnSnapAll">' + ic('magnet') + 'Snap to ink</button></div>' : '') +
    (ps.length ? ps.map((p) => {
      const row = ink && ink.ports.find((o) => o.port.id === p.id);
      const isBad = row && row.wrong;
      return '<div class="port-row' + (selPort === p.id ? ' sel' : '') + (isBad ? ' port-row-bad' : '') + '" data-port-row="' + escHtml(p.id) + '" title="' + escHtml(isBad ? (row.onInk ? 'overlaps its linework' : 'floats ' + rnd(row.gap) + 'u off the linework') : p.id) + '">' +
        '<span class="pdot" style="background:' + clsColor(p) + '"></span>' +
        '<span class="pname" title="' + escHtml(p.id) + '">' + escHtml(p.id) + (isBad ? ' <span class="pflag">' + ic('warn') + '</span>' : '') + '</span>' +
        '<span class="ptype">' + escHtml(p.type || 'pipe') + '</span>' +
        (isBad
          ? '<button class="icon-btn sm pdel" data-snap-port="' + escHtml(p.id) + '" title="Snap onto the linework">' + ic('magnet') + '</button>'
          : '<button class="icon-btn sm pdel" data-del-port="' + escHtml(p.id) + '" title="Delete port">' + ic('trash') + '</button>') +
        '</div>';
    }).join('') : '<div class="ports-empty">No ports.<br>Double-click empty canvas, use the port tool,<br>or "Add port" above.</div>') +
    (selPort ? portFields(ps.find((p) => p.id === selPort)) : '');
}
function portFields(p) {
  if (!p) return '';
  return '<div class="fgrid" style="margin-top:10px">' +
    row('id', fld('port.' + p.id + '.id', p.id)) +
    row('type', sel('port.' + p.id + '.type', [['pipe', 'pipe'], ['nozzle', 'nozzle'], ['signal', 'signal']], p.type)) +
    row('role', fld('port.' + p.id + '.role', p.role || '')) +
    row('position', '<div class="dual">' + num('port.' + p.id + '.x', p.x) + num('port.' + p.id + '.y', p.y) + '</div>') +
    row('direction', sel('port.' + p.id + '.direction', [['', '(none)'], ['in', 'in'], ['out', 'out']], p.direction)) +
    row('flow', sel('port.' + p.id + '.flowDirection', [['', '(none)'], ['in', 'in'], ['out', 'out'], ['bidirectional', 'both']], p.flowDirection)) +
    row('conn type', sel('port.' + p.id + '.connectionType', [['', '(none)'], ['process', 'process'], ['utility', 'utility'], ['pneumatic', 'pneumatic'], ['electrical', 'electrical'], ['digital', 'digital']], p.connectionType)) +
    row('cardinality', num('port.' + p.id + '.cardinality', p.cardinality || 1, 1)) +
    row('lead length', num('port.' + p.id + '.lead', p.lead ?? 14, 1)) +
    '</div>';
}
function elemPanel(idx, nsel) {
  if (selPort && nsel === 0) return '<div class="sec-hint">Port <b>' + escHtml(selPort) + '</b> selected — edit it in the Ports panel above, or drag its dot.</div>';
  if (!nsel) return '<div class="sec-hint">Click linework in the canvas to select. Shift-click or rubber-band for multiple. ' + ic('info') + '</div>';
  if (nsel > 1) {
    const b = selBounds();
    const common = ['stroke', 'fill', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'opacity'].map((k) => ({ k, ...commonStyleValue(k) }));
    return '<div class="sec-hint">' + nsel + ' elements selected' + (b ? ' · ' + fmtV(b.x1 - b.x0) + ' × ' + fmtV(b.y1 - b.y0) : '') + '</div>' +
      '<div class="fgrid">' +
      row('stroke', colorCtl('stroke')) +
      row('fill', colorCtl('fill')) +
      row('stroke width', '<div class="dual">' + numKV('stroke-width', common.find((x) => x.k === 'stroke-width').v, 0.25) + selKV('stroke-linecap', common.find((x) => x.k === 'stroke-linecap').v, [['butt', 'butt'], ['round', 'round'], ['square', 'square']]) + '</div>') +
      row('opacity', numKV('opacity', common.find((x) => x.k === 'opacity').v, 0.05)) +
      '</div>' +
      '<div class="src-toolbar">' +
      btnMini('dupBtn', 'copy', 'Duplicate') + btnMini('fwdBtn', 'up', 'Forward') + btnMini('backBtn', 'down', 'Backward') +
      btnMini('frontBtn', 'front', 'Front') + btnMini('bottomBtn', 'back', 'Back') + '</div>';
  }
  const nodes = analyze(cur().svg), n = nodes[idx];
  if (!n) return '<div class="sec-hint">Selection lost.</div>';
  const a = parseAttrs(n.attrsRaw);
  const b = elemBounds(idx);
  let rows = '';
  const tRange = n.name === 'text' ? textRange(idx) : null;
  if (tRange) rows += row('text', '<input class="fld" type="text" value="' + escHtml(cur().svg.slice(tRange[0], tRange[1])) + '" data-eltext="1">');
  const order = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd', 'points', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'stroke', 'fill', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'transform'];
  const keys = [...new Set([...order.filter((k) => k in a), ...Object.keys(a).filter((k) => !order.includes(k))])];
  for (const k of keys) {
    const v = a[k];
    const ctl = k === 'd' || k === 'points'
      ? '<textarea class="fld" data-elattr="' + k + '" spellcheck="false">' + escHtml(v) + '</textarea>'
      : k === 'stroke' || k === 'fill'
        ? colorCtlAttr(k, v)
        : '<input class="fld" type="text" value="' + escHtml(v) + '" data-elattr="' + k + '">';
    rows += row(k, ctl);
  }
  const missing = ['stroke', 'fill', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity'].filter((k) => !(k in a));
  return '<div class="fgrid">' +
    row('tag', '<input class="fld" type="text" value="' + n.name + '" disabled>') +
    (b ? row('bbox', '<div class="dual mono" style="font-size:11px;color:var(--text2)"><span>' + fmtV(b.x1 - b.x0) + ' w</span><span>' + fmtV(b.y1 - b.y0) + ' h</span></div>') : '') +
    rows + '</div>' +
    (missing.length ? '<div class="fgrid" style="margin-top:8px">' + missing.map((k) => row('+ ' + k, '<input class="fld" type="text" placeholder="(unset)" data-elattr-new="' + k + '">')).join('') + '</div>' : '') +
    '<div class="src-toolbar">' +
    btnMini('dupBtn', 'copy', 'Duplicate') + btnMini('fwdBtn', 'up', 'Forward') + btnMini('backBtn', 'down', 'Backward') +
    btnMini('frontBtn', 'front', 'To front') + btnMini('bottomBtn', 'back', 'To back') + btnMini('delBtn', 'trash', 'Delete', 'btn-danger') + '</div>';
}
const btnMini = (id, icon, label, cls) => '<button class="btn sm ' + (cls || '') + '" id="' + id + '" title="' + label + '">' + ic(icon) + label + '</button>';
const numKV = (k, v, step) => '<input class="fnum" type="number" step="' + step + '" value="' + escHtml(v) + '" data-style="' + k + '">';
const selKV = (k, v, opts) => '<select class="fsel" data-style="' + k + '">' + opts.map(([val, lbl]) => '<option value="' + val + '"' + (v === val ? ' selected' : '') + '>' + lbl + '</option>').join('') + '</select>';
function colorCtl(key) {
  const { v, mixed } = commonStyleValue(key);
  return colorCtlInner('style', key, v, mixed);
}
function colorCtlAttr(key, v) { return colorCtlInner('elattr', key, v, false); }
function colorCtlInner(kind, key, v, mixed) {
  const presets = ['currentColor', '#000000', '#ffffff', '#2f6bff', '#e8830c', '#12934f', '#d92d20', 'none'];
  const solid = v && v !== 'none' && v !== 'currentColor';
  return '<div class="colorctl">' +
    '<label class="sw"><span style="background:' + (mixed ? 'repeating-linear-gradient(45deg,#ccc 0 3px,#fff 3px 6px)' : v || 'transparent') + '"></span>' +
    '<input type="color" data-' + kind + '-color="' + key + '" value="' + (solid ? v : '#000000') + '"></label>' +
    '<input class="fld" type="text" data-' + kind + '="' + key + '" value="' + escHtml(v) + '" placeholder="' + (mixed ? 'mixed' : 'unset') + '">' +
    '</div><div class="swatches">' + presets.map((p) =>
      '<button class="sw-btn' + (p === 'none' ? ' none' : p === 'currentColor' ? ' cur' : '') + '" data-' + kind + '-preset="' + key + '" data-v="' + p + '" title="' + p + '"' +
      (p === 'currentColor' || p === 'none' ? '' : ' style="background:' + p + '"') + '></button>').join('') + '</div>';
}
function layersPanel() {
  const { nodes, shapes } = shapeIndices();
  if (!shapes.length) return '<div class="sec-hint">No shapes yet — draw with the tools on the left rail.</div>';
  return shapes.map((i, k) => {
    const a = parseAttrs(nodes[i].attrsRaw);
    const nm = nodes[i].name + (a.d ? ' ' + (a.d.length > 26 ? a.d.slice(0, 26) + '…' : a.d) : a.points ? ' ' + a.points.slice(0, 20) : '');
    return '<div class="layer-row' + (selEls.has(i) ? ' sel' : '') + '" data-layer="' + i + '">' +
      '<span class="lnum">' + (k + 1) + '</span>' +
      '<span class="lname"><span class="ltag">' + escHtml(nodes[i].name) + '</span>' + escHtml(a.d ? (a.d.length > 30 ? a.d.slice(0, 30) + '…' : a.d) : '') + '</span>' +
      '<span class="lacts"><button class="icon-btn" data-z="up" data-zi="' + i + '" title="Bring forward">' + ic('up') + '</button>' +
      '<button class="icon-btn" data-z="down" data-zi="' + i + '" title="Send backward">' + ic('down') + '</button>' +
      '<button class="icon-btn" data-del-layer="' + i + '" title="Delete">' + ic('trash') + '</button></span></div>';
  }).join('');
}
function validPanel(issues) {
  if (!issues.length) return '<div class="vline ok">OK — ports, extents and anchor look sane.</div>';
  return '<div class="vlist">' + issues.slice(0, 12).map((i) =>
    '<button class="vitem" data-vissue="' + escHtml(i.port || '') + '">' + ic('warn') + '<span>' + escHtml(i.msg) + '</span>' +
    (i.ink && i.ink.to ? '<span class="vfix" data-snap-port="' + escHtml(i.port) + '" title="Snap this port onto the linework">' + ic('magnet') + '</span>' : '') +
    '</button>').join('') +
    (issues.length > 12 ? '<div class="sec-hint">+' + (issues.length - 12) + ' more…</div>' : '') + '</div>';
}
function previewPanel(c, vb) {
  const parts = svgParts(c.svg);
  const body = parts ? parts.inner : innerOf(c.svg);
  const stripped = body.replace(/<text[\s\S]*?<\/text>/g, '').replace(/<text[^>]*\/>/g, '');
  const mm = c.size || 40, px = Math.max(70, Math.min(210, mm * 3));
  const dots = (cfg.showPorts ? ports() : []).map((p) => {
    const v = portToView(p, vb);
    const col = p.connectionClass === 'signal' ? '#e8830c' : p.connectionClass === 'process' ? '#2f6bff' : '#7a9a7a';
    return '<circle cx="' + rnd(v.x) + '" cy="' + rnd(v.y) + '" r="' + vb.w * 0.03 + '" fill="' + col + '" stroke="white" stroke-width="' + vb.w * 0.008 + '"><title>' + escHtml(p.id) + '</title></circle>';
  }).join('');
  const same = stripped.length === c.svg.length;
  return '<div class="preview-card"><svg viewBox="' + vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h + '" width="' + Math.round(px) + '" height="' + Math.round(px * vb.h / vb.w) + '">' + stripped + dots + '</svg></div>' +
    '<div class="preview-note">nominal ' + mm + 'mm render · ' + (stripped.length === body.length ? 'no &lt;text&gt; in glyph' : '<b style="color:var(--warn)">baked-in &lt;text&gt; never reaches a diagram</b> — labels come from the DSL') + '</div>';
}
function defaultsPanel() {
  return '<div class="fgrid">' +
    row('stroke-width (all)', num('swAll', '', 0.1)) +
    row('stroke (all)', fld('strokeAll', '', '#000 / currentColor')) +
    '</div><div class="src-toolbar"><button class="btn sm" id="btnApplyAll">' + ic('check') + 'Apply to every shape</button></div>' +
    '<div class="sec-hint">Empty fields leave that attribute untouched.</div>';
}
function sourcePanel(c) {
  const parts = svgParts(c.svg);
  const inner = parts ? parts.inner : innerOf(c.svg);
  return '<textarea class="fld" id="srcArea" spellcheck="false">' + escHtml(inner) + '</textarea>' +
    '<div class="src-toolbar"><button class="btn sm" id="btnApplySrc">' + ic('check') + 'Apply source</button>' +
    '<button class="btn sm" id="btnTidySrc">' + ic('sliders') + 'Round numbers</button></div>' +
    '<div class="sec-hint">Full inner markup. Apply parses with DOMParser — invalid XML is rejected and nothing is lost.</div>';
}
function bindInspector() {
  // sections toggle
  $('inspector').querySelectorAll('[data-toggle-sec]').forEach((b) => b.addEventListener('click', () => {
    const s = b.closest('.sec');
    s.classList.toggle('collapsed');
    cfg.sections[b.dataset.toggleSec] = !s.classList.contains('collapsed');
    saveCfg();
  }));
  // rows / buttons
  $('inspector').querySelectorAll('[data-layer]').forEach((r) => r.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (e.shiftKey) { const i = +r.dataset.layer; selEls.has(i) ? selEls.delete(i) : selEls.add(i); }
    else selEls = new Set([+r.dataset.layer]);
    selPort = null;
    nodeMode = false;
    draw(); renderInspector(); renderCtxbar(); updateStatus();
  }));
  $('inspector').querySelectorAll('[data-del-layer]').forEach((b) => b.addEventListener('click', () => {
    selEls = new Set([+b.dataset.delLayer]); deleteSel();
  }));
  $('inspector').querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => {
    selEls = new Set([+b.dataset.zi]); zOrder(b.dataset.z);
  }));
  $('inspector').querySelectorAll('[data-port-row]').forEach((r) => r.addEventListener('click', (e) => {
    if (e.target.closest('[data-del-port]')) return;
    selPort = r.dataset.portRow; selEls.clear();
    draw(); renderInspector(); renderCtxbar(); updateStatus();
  }));
  $('inspector').querySelectorAll('[data-vissue]').forEach((b) => b.addEventListener('click', () => {
    const pid = b.dataset.vissue;
    if (pid && ports().some((p) => p.id === pid)) { selPort = pid; selEls.clear(); draw(); renderInspector(); renderCtxbar(); updateStatus(); }
  }));
  const one = (id, fn) => { const el2 = $(id); if (el2) el2.addEventListener('click', fn); };
  one('btnAddPort', () => { const def = cur(); const id = uniquePortId(def); pushUndo(); def.ports = def.ports || []; def.ports.push(Object.assign({ id, x: 50, y: 50 }, PORT_DEF)); selPort = id; touchDirty(); refreshAll(); toast('Added ' + id, 'ok'); });
  one('btnSnapAll', snapAllPortsToInk);
  one('btnApplyAll', applyAllDefaults);
  one('btnApplySrc', applySource);
  one('btnTidySrc', tidySource);
  one('dupBtn', duplicateSel);
  one('fwdBtn', () => zOrder('up'));
  one('backBtn', () => zOrder('down'));
  one('frontBtn', () => zOrder('front'));
  one('bottomBtn', () => zOrder('back'));
  one('delBtn', deleteSel);
  one('btnRevert', () => { pushUndo(); window.PID_SYMBOLS[current] = JSON.parse(JSON.stringify(PRISTINE[current])); selPort = null; selEls.clear(); touchDirty(); refreshAll(); toast('Reverted ' + current, 'ok'); });  one('btnExport', exportComponent);
  one('btnPng', exportPng);
  one('btnCopySvg', () => {
    const parts = svgParts(cur().svg);
    const svgTxt = parts ? parts.inner : innerOf(cur().svg);
    navigator.clipboard.writeText(svgTxt).then(() => toast('SVG markup copied', 'ok'), () => toast('Clipboard blocked by browser', 'bad'));
  });
}
/* inspector inputs (delegated on the panel) */
$('inspector').addEventListener('change', onInspectorChange);
$('inspector').addEventListener('input', onInspectorInput);
$('inspector').addEventListener('click', onInspectorClick);
function onInspectorClick(e) {
  const t = e.target;
  const del = t.closest('[data-del-port]');
  if (del) { delPort(del.dataset.delPort); return; }
  const snap = t.closest('[data-snap-port]');
  if (snap) { snapPortToInk(snap.dataset.snapPort); return; }
  const pre = t.closest('[data-style-preset], [data-elattr-preset]');
  if (pre) {
    const key = pre.dataset.stylePreset || pre.dataset.elattrPreset;
    const v = pre.dataset.v;
    if (key.startsWith('style')) applyStyle(key.replace('style-', ''), v);
    else { pushUndo(); setNodeAttr([...selEls][0], key, v); touchDirty(); refreshAll(); }
    return;
  }
}
function onInspectorInput(e) {
  const t = e.target;
  if (t.dataset.elattr !== undefined && t.dataset.elattr && t.type !== 'textarea') return; // wait for change
  if (t.id === 'srcArea') return;
  if (t.dataset.elattr !== undefined && t.dataset.elattr && t.type === 'textarea') {
    pushUndo(); setNodeAttr([...selEls][0], t.dataset.elattr, t.value); touchDirty(); draw(); renderLayersOnly();
  }
}
function onInspectorChange(e) {
  const t = e.target;
  const c = cur();
  /* component paths */
  if (t.dataset.path && !t.dataset.path.startsWith('port.')) {
    let v = t.type === 'number' ? parseFloat(t.value) : t.value;
    if (t.type === 'number' && !Number.isFinite(v)) return;
    pushUndo();
    const segs = t.dataset.path.split('.');
    let o = c;
    while (segs.length > 1) { const k = segs.shift(); o = o[k] = o[k] || {}; }
    o[segs[0]] = v;
    touchDirty();
    if (t.dataset.path.startsWith('extents.') || t.dataset.path.startsWith('anchor.') || t.dataset.path.startsWith('labelAnchor.')) draw();
    updateStatus();
    return;
  }
  /* default-apply scratch fields */
  if (t.id === 'swAll' || t.id === 'strokeAll') return;
  /* behavior + flags */
  if (t.dataset.flag) { pushUndo(); c[t.dataset.flag] = t.checked; touchDirty(); return; }
  if (t.dataset.beh) { pushUndo(); c.behavior = c.behavior || {}; c.behavior[t.dataset.beh] = t.checked; touchDirty(); return; }
  /* view */
  if (t.dataset.cfg) {
    if (t.dataset.cfg === 'gridStep') { cfg.gridStep = parseFloat(t.value); }
    else cfg[t.dataset.cfg] = t.type === 'checkbox' ? t.checked : t.value;
    saveCfg();
    refreshAll();
    return;
  }
  if (t.dataset.path && t.dataset.path.startsWith('port.')) {
    const [, pid, field] = t.dataset.path.split('.');
    const p = ports().find((q) => q.id === pid);
    if (!p) return;
    if (field === 'id') {
      const nv = String(t.value || '').trim();
      if (!nv) return toast('Port id cannot be empty', 'bad');
      if (nv !== pid && ports().some((q) => q.id === nv)) return toast('Port id "' + nv + '" already exists', 'bad');
      pushUndo();
      p.id = nv;
      selPort = nv;
    } else {
      pushUndo();
      p[field] = t.type === 'number' ? parseFloat(t.value) : t.value;
    }
    touchDirty();
    renderList(); renderInspector();
    if (field === 'x' || field === 'y') draw();
    return;
  }
  /* element attrs */
  if (t.dataset.elattr) {
    pushUndo(); setNodeAttr([...selEls][0], t.dataset.elattr, t.value); touchDirty(); refreshAll(); return;
  }
  if (t.dataset.elattrNew) {
    if (t.value.trim()) { pushUndo(); setNodeAttr([...selEls][0], t.dataset.elattrNew, t.value); touchDirty(); refreshAll(); }
    return;
  }
  if (t.dataset.style) {
    const key = t.dataset.style;
    let v = t.type === 'number' ? t.value : t.value;
    applyStyle(key, v);
    return;
  }
  if (t.dataset.eltext !== undefined) {
    const idx = [...selEls][0];
    const r = textRange(idx);
    if (!r) return;
    pushUndo();
    c.svg = c.svg.slice(0, r[0]) + escHtml(t.value) + c.svg.slice(r[1]);
    touchDirty(); refreshAll(); return;
  }
}
function renderLayersOnly() {
  const s = $('inspector').querySelector('[data-sec="layers"] .sec-body');
  if (s) s.innerHTML = layersPanel();
}
/* color inputs */
$('inspector').addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.styleColor) { applyStyleFast(t.dataset.styleColor, t.value); return; }
  if (t.dataset.elattrColor) { pushUndo(); setNodeAttr([...selEls][0], t.dataset.elattrColor, t.value); touchDirty(); draw(); }
});
function applyStyleFast(key, v) {
  const nodes = analyze(cur().svg);
  for (const i of selEls) { const n = nodes[i]; if (n && n.kind === 'shape') setNodeAttr(i, key, v); }
  touchDirty();
  draw();
}
/* ============================ 26. context toolbar ============================ */
function renderCtxbar() {
  const bar = $('ctxbar');
  const nsel = selEls.size;
  const has = nsel > 0;
  if (nodeMode && nsel === 1) {
    bar.innerHTML = '<div class="ctx-group"><span class="ctx-label"><b>Node editing</b> — drag points · dbl-click a segment to insert · Alt+click a point to delete</span></div>' +
      '<div class="ctx-spacer" style="flex:1"></div>' +
      '<div class="ctx-group"><button class="btn sm" data-act="nodeOff">Done</button></div>';
    $('ctxbar').querySelector('[data-act=nodeOff]').addEventListener('click', () => { nodeMode = false; draw(); renderCtxbar(); updateStatus(); });
    return;
  }
  let h = '';
  h += '<div class="ctx-group"><span class="ctx-label">Snap</span>';
  h += '<button class="icon-btn' + (cfg.snap ? ' on' : '') + '" id="ctxSnap" title="Toggle snapping (S)">' + ic('magnet') + '</button>';
  h += '<select class="ctx-select" id="ctxStep" title="Grid step">' + [1, 2, 2.5, 5, 10, 20].map((s) => '<option value="' + s + '"' + (cfg.gridStep === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div>';
  h += '<div class="ctx-group"><button class="icon-btn' + (cfg.grid ? ' on' : '') + '" id="ctxGrid" title="Grid (G)">' + ic('grid') + '</button>';
  h += '<button class="icon-btn' + (cfg.showGuides ? ' on' : '') + '" id="ctxGuides" title="Show guides">' + ic('ruler') + '</button></div>';
  h += '<div class="ctx-sep"></div>';
  h += '<div class="ctx-group"><span class="ctx-label">Show</span>';
  h += chkBtn('ctxPorts', cfg.showPorts, 'Ports', 'port');
  h += chkBtn('ctxExt', cfg.showExtents, 'Extents', 'layers');
  h += chkBtn('ctxAnchor', cfg.showAnchor, 'Anchor', 'anchor');
  h += chkBtn('ctxLabel', cfg.showLabel, 'Label anchor', 'info');
  h += '<button class="icon-btn' + (cfg.inkCheck ? ' on' : '') + '" id="ctxInk" title="Ink check — flag ports that do not terminate on the linework">' + ic('warn') + '</button></div>';
  h += '<div class="ctx-sep"></div>';
  if (has) {
    h += '<div class="ctx-group">';
    h += '<button class="icon-btn" data-act="flipH" title="Flip horizontal">' + ic('flipH') + '</button>';
    h += '<button class="icon-btn" data-act="flipV" title="Flip vertical">' + ic('flipV') + '</button>';
    h += '<button class="icon-btn" data-act="rotCcw" title="Rotate 90° CCW">' + ic('rotCcw') + '</button>';
    h += '<button class="icon-btn" data-act="rotCw" title="Rotate 90° CW">' + ic('rotCw') + '</button></div>';
    h += '<div class="ctx-sep"></div><div class="ctx-group">';
    for (const [a, i, t] of [['alignL', 'alignL', 'Align left'], ['alignCH', 'alignCH', 'Align centres H'], ['alignR', 'alignR', 'Align right'], ['alignT', 'alignT', 'Align top'], ['alignCV', 'alignCV', 'Align centres V'], ['alignB', 'alignB', 'Align bottom']]) {
      h += '<button class="icon-btn" data-act="' + a + '" title="' + t + '"' + (nsel < 2 ? ' disabled' : '') + '>' + ic(i) + '</button>';
    }
    h += '<button class="icon-btn" data-act="distH" title="Distribute horizontally"' + (nsel < 3 ? ' disabled' : '') + '>' + ic('distH') + '</button></div>';
    h += '<div class="ctx-sep"></div>';
    if (nsel === 1) {
      const { v: sw, mixed } = commonStyleValue('stroke-width');
      h += '<div class="ctx-group"><input class="ctx-num" id="ctxW" type="number" step="0.25" value="' + escHtml(sw) + '" placeholder="w" title="Stroke width">' +
        '<input class="ctx-color" id="ctxStroke" type="color" title="Stroke colour"></div>';
      h += '<div class="ctx-sep"></div>';
    }
    h += '<div class="ctx-group">';
    h += '<button class="icon-btn" data-act="dup" title="Duplicate (Ctrl+D)">' + ic('copy') + '</button>';
    h += '<button class="icon-btn" data-act="up" title="Bring forward">' + ic('up') + '</button>';
    h += '<button class="icon-btn" data-act="down" title="Send backward">' + ic('down') + '</button>';
    h += '<button class="icon-btn" data-act="del" title="Delete (Del)">' + ic('trash') + '</button></div>';
  } else if (selPort) {
    h += '<div class="ctx-group"><span class="ctx-label">port <b>' + escHtml(selPort) + '</b></span>';
    h += '<button class="icon-btn" data-act="portDel" title="Delete port">' + ic('trash') + '</button></div>';
  } else {
    h += '<div class="ctx-group"><span class="ctx-empty">Select linework to transform it, or pick a tool to draw</span></div>';
  }
  bar.innerHTML = h;
  bindCtxbar();
}
const chkBtn = (id, on, title, icon) => '<button class="icon-btn' + (on ? ' on' : '') + '" id="' + id + '" title="' + title + '">' + ic(icon) + '</button>';
function bindCtxbar() {
  const bar = $('ctxbar');
  const one = (sel, ev, fn) => { const e2 = $(sel); if (e2) e2.addEventListener(ev, fn); };
  one('ctxSnap', 'click', () => { cfg.snap = !cfg.snap; saveCfg(); renderCtxbar(); draw(); });
  one('ctxGrid', 'click', () => { cfg.grid = !cfg.grid; saveCfg(); renderCtxbar(); draw(); });
  one('ctxGuides', 'click', () => { cfg.showGuides = !cfg.showGuides; saveCfg(); renderCtxbar(); draw(); });
  one('ctxStep', 'change', (e) => { cfg.gridStep = parseFloat(e.target.value); saveCfg(); draw(); });
  one('ctxPorts', 'click', () => { cfg.showPorts = !cfg.showPorts; saveCfg(); renderCtxbar(); draw(); });
  one('ctxExt', 'click', () => { cfg.showExtents = !cfg.showExtents; saveCfg(); renderCtxbar(); draw(); });
  one('ctxAnchor', 'click', () => { cfg.showAnchor = !cfg.showAnchor; saveCfg(); renderCtxbar(); draw(); });
  one('ctxLabel', 'click', () => { cfg.showLabel = !cfg.showLabel; saveCfg(); renderCtxbar(); draw(); });
  one('ctxInk', 'click', () => { cfg.inkCheck = !cfg.inkCheck; saveCfg(); renderCtxbar(); draw();
    const chk = inkCheck();
    toast(cfg.inkCheck ? (chk && chk.wrongCount ? chk.wrongCount + ' port' + (chk.wrongCount > 1 ? 's' : '') + ' do not terminate on the linework' : 'all ports terminate on the linework') : 'ink check off',
      cfg.inkCheck && chk && chk.wrongCount ? 'warn' : 'ok');
  });
  const wEl = $('ctxW');
  if (wEl) wEl.addEventListener('change', () => applyStyle('stroke-width', wEl.value || ''));
  const sEl = $('ctxStroke');
  if (sEl) {
    sEl.value = /^#[0-9a-f]{6}$/i.test(commonStyleValue('stroke').v) ? commonStyleValue('stroke').v : '#000000';
    sEl.addEventListener('input', () => applyStyleFast('stroke', sEl.value));
    sEl.addEventListener('change', () => { applyStyle('stroke', sEl.value); });
  }
  bar.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'flipH') mirrorSel('h');
    else if (a === 'flipV') mirrorSel('v');
    else if (a === 'rotCw') rotate90('cw');
    else if (a === 'rotCcw') rotate90('ccw');
    else if (a === 'alignL') alignSel('l');
    else if (a === 'alignR') alignSel('r');
    else if (a === 'alignT') alignSel('t');
    else if (a === 'alignB') alignSel('b');
    else if (a === 'alignCH') alignSel('ch');
    else if (a === 'alignCV') alignSel('cv');
    else if (a === 'distH') distributeSel('h');
    else if (a === 'dup') duplicateSel();
    else if (a === 'up') zOrder('up');
    else if (a === 'down') zOrder('down');
    else if (a === 'del') deleteSel();
    else if (a === 'portDel') delPort(selPort);
  }));
}
/* ============================ 27. source ============================ */
function innerOf(svg) {
  const a = svg.indexOf('>'), b = svg.lastIndexOf('</');
  return a >= 0 && b > a ? svg.slice(a + 1, b) : svg;
}
/* Split a glyph into pre-declaration / <svg> open tag / inner markup / closing tag.
   Symbols in this library sometimes carry an <?xml ...?> prolog, so "first >" is wrong. */
function svgParts(svg) {
  let i = 0;
  for (;;) {
    const m = /^\s*(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)/i.exec(svg.slice(i));
    if (!m) break;
    i += m[0].length;
  }
  const open = /^\s*(<svg\b[^>]*>)/i.exec(svg.slice(i));
  if (!open) return null;
  const openEnd = i + open[0].length;
  const closeIdx = svg.lastIndexOf('</svg>');
  if (closeIdx < openEnd) return { pre: svg.slice(0, openEnd - open[1].length), openTag: open[1], inner: svg.slice(openEnd), post: '' };
  return { pre: svg.slice(0, openEnd - open[1].length), openTag: open[1], inner: svg.slice(openEnd, closeIdx), post: svg.slice(closeIdx + 6) };
}
function applySource() {
  const c = cur();
  const raw = $('srcArea').value;
  const doc = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg">' + raw + '</svg>', 'image/svg+xml');
  if (doc.querySelector('parsererror')) return toast('Invalid XML — nothing changed', 'bad');
  pushUndo();
  const parts = svgParts(c.svg);
  c.svg = parts ? parts.pre + parts.openTag + raw + parts.post : c.svg.slice(0, c.svg.indexOf('>') + 1) + raw;
  selEls.clear(); selPort = null;
  touchDirty();
  refreshAll();
  toast('Source applied', 'ok');
}
function tidySource() {
  pushUndo();
  const c = cur();
  c.svg = c.svg.replace(/-?\d*\.\d+(?:e-?\d+)?/g, (m) => String(Math.round(+m * 100) / 100));
  touchDirty();
  refreshAll();
  toast('Numbers rounded to 2dp', 'ok');
}
function openReview() {
  const dirty = ALL.filter((id) => isDirty(id));
  $('modalTitle').textContent = 'Unsaved edits';
  $('modalBody').innerHTML = '<div class="review">' +
    (dirty.length ? '<div class="review-list">' + dirty.map((id) => {
      const c = window.PID_SYMBOLS[id];
      const vb = viewDims(c);
      const parts = svgParts(c.svg);
      const inner = parts ? parts.inner : innerOf(c.svg);
      return '<div class="review-row">' +
        '<div class="review-thumb"><svg viewBox="' + vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h + '">' + inner + '</svg></div>' +
        '<div><div class="review-name" title="' + escHtml(id) + '">' + escHtml(id) + '</div>' +
        '<div class="review-meta">' + escHtml(c.standard || '—') + ' · ' + (c.ports || []).length + ' ports</div></div>' +
        '<div class="review-acts">' +
        '<button class="btn xs" data-rev-open="' + escHtml(id) + '">Open</button>' +
        '<button class="btn xs" data-rev-rev="' + escHtml(id) + '">Revert</button>' +
        '</div></div>';
    }).join('') + '</div>'
      : '<div class="review-empty">No unsaved edits — every symbol matches the bundle you loaded.</div>') +
    (dirty.length ? '<div class="review-foot">' +
      '<span class="ctx-label">' + dirty.length + ' component' + (dirty.length > 1 ? 's' : '') + ' edited</span>' +
      '<span class="tb-spacer" style="flex:1"></span>' +
      '<button class="btn sm" id="revExportAll">Export all as JSON</button>' +
      '<button class="btn sm" id="revBundle">Download bundle</button>' +
      '<button class="btn sm btn-danger" id="revRevertAll">Revert all</button>' +
      '</div>' : '') +
    '</div>';
  $('modal').hidden = false;
  $('modalBody').querySelectorAll('[data-rev-open]').forEach((b) => b.addEventListener('click', () => {
    $('modal').hidden = true;
    select(b.dataset.revOpen);
  }));
  $('modalBody').querySelectorAll('[data-rev-rev]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.revRev;
    pushUndo();
    window.PID_SYMBOLS[id] = JSON.parse(JSON.stringify(PRISTINE[id]));
    dirtyCache.delete(id);
    dropCaches(id);
    touchDirty(id);
    openReview();
    refreshAll();
    toast('Reverted ' + id, 'ok');
  }));
  const one = (id, fn) => { const e2 = $('modalBody').querySelector('#' + id); if (e2) e2.addEventListener('click', fn); };
  one('revBundle', () => { downloadBundle(); });
  one('revExportAll', () => {
    const dirtyIds = ALL.filter((x) => isDirty(x));
    const blob = new Blob([JSON.stringify(dirtyIds.map((id) => ({ id, ...JSON.parse(JSON.stringify(window.PID_SYMBOLS[id])) })), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pid-edits-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click(); URL.revokeObjectURL(a.href);
    toast('Exported ' + dirtyIds.length + ' edited components', 'ok');
  });
  one('revRevertAll', () => {
    const dirtyIds = ALL.filter((x) => isDirty(x));
    pushUndoMulti(dirtyIds);
    for (const id of dirtyIds) {
      window.PID_SYMBOLS[id] = JSON.parse(JSON.stringify(PRISTINE[id]));
      dirtyCache.delete(id);
      dropCaches(id);
    }
    autoClear();
    $('modal').hidden = true;
    refreshAll();
    toast('Reverted ' + dirtyIds.length + ' components — Ctrl+Z to undo', 'ok');
  });
}
$('stDirty').addEventListener('click', () => { if (dirtyCount()) openReview(); });
/* ============================ 28b. png export ============================ */
function exportPng() {
  const c = cur();
  if (!c) return;
  const vb = viewDims(c);
  const scale = 3;
  let s = c.svg;
  // currentColor has no inherited value inside an <img>; pin the root colour
  s = s.replace(/<svg\b/, '<svg color="#000000" width="' + Math.round(vb.w * scale) + '" height="' + Math.round(vb.h * scale) + '"');
  const blob = new Blob([s], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = Math.round(vb.w * scale);
    cv.height = Math.round(vb.h * scale);
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    cv.toBlob((b) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = current.replaceAll('/', '__') + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Exported PNG (' + cv.width + '×' + cv.height + ')', 'ok');
    }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('PNG export failed — use Copy SVG instead', 'bad'); };
  img.src = url;
}
/* ============================ 28. io ============================ */
function exportComponent() {
  const c = cur();
  const blob = new Blob([JSON.stringify({ id: current, ...JSON.parse(JSON.stringify(c)) }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = current.replaceAll('/', '__') + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported ' + current, 'ok');
}
function downloadBundle() {
  const out = 'window.PID_SYMBOLS = ' + JSON.stringify(window.PID_SYMBOLS) + ';\n';
  const blob = new Blob([out], { type: 'text/javascript' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pid-symbols-bundle.js';
  a.click();
  URL.revokeObjectURL(a.href);
  autoClear();
  toast('Bundle downloaded — overwrite pid-symbols-bundle.js and reload', 'ok');
}
let genHandle = null, genText = null;
async function linkGen() {
  try {
    [genHandle] = await window.showOpenFilePicker({ types: [{ description: 'P&ID Generator', accept: { 'text/javascript': ['.js'] } }], suggestedName: 'P&IDGenerator.js' });
    const f = await genHandle.getFile();
    genText = await f.text();
    $('saveBtn').disabled = false;
    toast('Linked ' + f.name + ' (' + f.size.toLocaleString() + ' bytes)', 'ok');
  } catch (err) { if (err.name !== 'AbortError') toast('Link failed: ' + err.message, 'bad'); }
}
function buildGenText(base) {
  const ASSIGN = 'window.PID_SYMBOLS = ';
  const start = base.indexOf(ASSIGN);
  let i = base.indexOf('{', start), depth = 0, q = false, e = false;
  for (; i < base.length; i++) {
    const ch = base[i];
    if (q) { if (e) e = false; else if (ch === '\\') e = true; else if (ch === '"') q = false; continue; }
    if (ch === '"') q = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (!depth) break; }
  }
  return base.slice(0, start + ASSIGN.length) + JSON.stringify(window.PID_SYMBOLS) + base.slice(i + 1);
}
async function saveGen() {
  try {
    const out = buildGenText(genText);
    const w = await genHandle.createWritable();
    await w.write(out); await w.close();
    genText = out;
    autoClear();
    toast('Saved ' + Object.keys(window.PID_SYMBOLS).length + ' components to the generator', 'ok');
  } catch (err) { toast('Save failed: ' + err.message, 'bad'); }
}
/* ============================ 29. keyboard ============================ */
document.addEventListener('keydown', (e) => {
  const ae = document.activeElement;
  const typing = ae && (/INPUT|TEXTAREA|SELECT/.test(ae.tagName) || ae.isContentEditable);
  if (e.key === ' ' && !typing) { spaceDown = true; $('canvas').classList.add('tool-pan'); }
  if (typing) {
    if (e.key === 'Escape') ae.blur();
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  /* tool keys */
  const tools = { v: 'select', p: 'pen', l: 'line', r: 'rect', o: 'ellipse', t: 'text', a: 'port', h: 'pan' };
  if (!mod && tools[e.key.toLowerCase()]) { setTool(tools[e.key.toLowerCase()]); e.preventDefault(); return; }
  if (!mod && (e.key === 'g' || e.key === 'G')) { cfg.grid = !cfg.grid; saveCfg(); renderCtxbar(); draw(); return; }
  if (!mod && (e.key === 's' || e.key === 'S')) { cfg.snap = !cfg.snap; saveCfg(); renderCtxbar(); return; }
  if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (mod && (e.key === 'z' || e.key === 'Z') && e.shiftKey) { e.preventDefault(); redo(); return; }
  if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
  if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); togglePalette(true); return; }
  if (mod && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault();
    selEls = new Set(shapeIndices().shapes);
    selPort = null;
    draw(); renderInspector(); renderCtxbar(); updateStatus();
    toast('Selected all ' + selEls.size + ' shapes');
    return;
  }
  if (mod && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); copySel(); return; }
  if (mod && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); cutSel(); return; }
  if (mod && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); pasteClip(); return; }
  if (mod && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicateSel(); return; }
  if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); downloadBundle(); return; }
  if (mod && (e.key === ']')) { e.preventDefault(); zOrder('up'); return; }
  if (mod && (e.key === '[')) { e.preventDefault(); zOrder('down'); return; }
  if (e.key === 'Escape') {
    if (!$('palette').hidden) { togglePalette(false); return; }
    if (!$('modal').hidden) { $('modal').hidden = true; return; }
    if (!$('ctxMenu').hidden) { $('ctxMenu').hidden = true; return; }
    if (tool === 'pen' && pen) { cancelPen(); draw(); return; }
    if (nodeMode) { nodeMode = false; draw(); renderCtxbar(); updateStatus(); toast('Node editing off'); return; }
    selEls.clear(); selPort = null;
    draw(); renderInspector(); renderCtxbar(); updateStatus();
    return;
  }
  if (e.key === '?' || (e.key === '/' && e.shiftKey)) { openModal(); return; }
  if (e.key === 'F1') { e.preventDefault(); $('modal').hidden = false; return; }
  if (!mod && e.key === 'Enter' && tool === 'pen' && pen) { commitPen(); e.preventDefault(); return; }
  if (!mod && e.key === 'Backspace' && tool === 'pen' && pen) { undoPenPoint(); e.preventDefault(); return; }
  const fineStep = e.shiftKey ? 5 : 0.5;
  if (e.key === 'f' || e.key === 'F') { fitView(); return; }
  if (e.key === '1') { setZoom(1); return; }
  if (e.key === '+' || e.key === '=') { setZoom(view.k * 1.25); return; }
  if (e.key === '-' || e.key === '_') { setZoom(view.k / 1.25); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace')) {
    if (selEls.size) { e.preventDefault(); deleteSel(); return; }
    if (selPort) { e.preventDefault(); delPort(selPort); return; }
  }
  /* nudge */
  const d = fineStep;
  const dirs = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
  if (dirs[e.key]) {
    e.preventDefault();
    if (selEls.size) {
      if (!drag) pushUndo();
      moveEls(dirs[e.key][0], dirs[e.key][1], true);
      touchDirty();
      renderInspector();
    } else if (selPort) {
      const p = ports().find((q) => q.id === selPort);
      if (p) {
        pushUndo();
        p.x = rnd(p.x + dirs[e.key][0] / 100 * viewDims(cur()).w);
        p.y = rnd(p.y + dirs[e.key][1] / 100 * viewDims(cur()).h);
        touchDirty();
        draw();
      }
    }
    return;
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ') { spaceDown = false; if (tool !== 'pan') $('canvas').classList.remove('tool-pan'); }
});
/* ============================ 30. wheel / zoom ============================ */
function setZoom(k, cx, cy) {
  const old = view.k;
  const nk = clamp(k, 0.15, 12);
  if (nk === old) return;
  const cnv = $('canvas').getBoundingClientRect();
  const mx = cx === undefined ? cnv.width / 2 : cx - cnv.left;
  const my = cy === undefined ? cnv.height / 2 : cy - cnv.top;
  view.x = mx - (mx - view.x) * (nk / old);
  view.y = my - (my - view.y) * (nk / old);
  view.k = nk;
  view.fit = false;
  draw();
}
function fitView() { view.k = 1; view.fit = true; draw(); toast('Fit to view'); }
$('canvas').addEventListener('wheel', (e) => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  setZoom(view.k * f, e.clientX, e.clientY);
}, { passive: false });
$('zoomIn').addEventListener('click', () => setZoom(view.k * 1.25));
$('zoomOut').addEventListener('click', () => setZoom(view.k / 1.25));
$('zoomFit').addEventListener('click', fitView);
$('zoom100').addEventListener('click', () => setZoom(1));
/* guides from rulers */
function rulerGuide(axis, e) {
  const svg = $('scene');
  const vb = viewDims(cur());
  const pt = screenToView(e);
  if (!pt) return null;
  const pos = axis === 'x' ? snapV(pt.x, false) : snapV(pt.y, false);
  guides.push({ axis, pos });
  draw();
  return pos;
}
function initRulers() {
  for (const [el2, axis] of [['rulerH', 'x'], ['rulerV', 'y']]) {
    const R = $(el2);
    R.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      R.setPointerCapture(e.pointerId);
      const existing = [];
      const onMove = (ev) => {
        const p = screenToView(ev);
        if (!p) return;
        // drag to reposition the newest guide
        const g = guides[guides.length - 1];
        if (g && g.axis === axis) {
          g.pos = axis === 'x' ? snapV(p.x, false) : snapV(p.y, false);
          draw();
        }
      };
      const onUp = (ev) => {
        R.removeEventListener('pointermove', onMove);
        R.removeEventListener('pointerup', onUp);
      };
      R.addEventListener('pointermove', onMove);
      R.addEventListener('pointerup', onUp);
      rulerGuide(axis, e);
      toast('Guide added — drag on the ruler to move, ' + (axis === 'x' ? 'vertical' : 'horizontal') + ' line');
    });
    R.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const before = guides.length;
      guides = guides.filter((g) => g.axis !== axis);
      if (guides.length !== before) { draw(); toast('Cleared guides'); }
    });
    R.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      guides = guides.filter((g) => g.axis !== axis);
      draw();
      toast('Cleared guides');
    });
  }
}
/* ============================ 37. ink geometry ============================ */
/* Mirrors symbol-ink.mjs (the browser cannot import an ESM from file://), extended to
   honour <g> and per-element transforms — the editor can now create those, and ink that
   ignores them would put ports back on the ghost of the old linework.
   Units are the glyph's own viewBox units. ARITY matches their table. */
const INK_AR = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };
function inkOf(svg) {
  const segs = [], circles = [];
  const attr = (s, n) => { const m = s.match(new RegExp('\\b' + n + '="([^"]*)"')); return m ? parseFloat(m[1]) : NaN; };
  svg = svg || '';
  const stack = [];
  const mat = () => {
    let mm = IDENT;
    for (const g of stack) mm = mMul(mm, g);
    return mm;
  };
  const push = (x1, y1, x2, y2, sw, m, own) => {
    if (![x1, y1, x2, y2].every(Number.isFinite)) return;
    const s = Number.isFinite(sw) ? sw : 1;
    const mm = own ? mMul(m, own) : m;
    if (!own && mm === IDENT) { segs.push([x1, y1, x2, y2, s]); return; }
    const a = mApply(mm, x1, y1), b = mApply(mm, x2, y2);
    segs.push([a.x, a.y, b.x, b.y, s]);
  };
  const flush = (txt) => {
    const m = mat();
    for (const t of txt.matchAll(/<line\b[^>]*>/gi)) push(attr(t[0], 'x1'), attr(t[0], 'y1'), attr(t[0], 'x2'), attr(t[0], 'y2'), attr(t[0], 'stroke-width'), m);
    for (const t of txt.matchAll(/<rect\b[^>]*>/gi)) {
      const x = attr(t[0], 'x'), y = attr(t[0], 'y'), w = attr(t[0], 'width'), h = attr(t[0], 'height'), sw = attr(t[0], 'stroke-width');
      if ([x, y, w, h].every(Number.isFinite)) {
        push(x, y, x + w, y, sw, m); push(x + w, y, x + w, y + h, sw, m);
        push(x + w, y + h, x, y + h, sw, m); push(x, y + h, x, y, sw, m);
      }
    }
    for (const t of txt.matchAll(/<(?:polyline|polygon)\b[^>]*>/gi)) {
      const p = t[0].match(/\bpoints="([^"]*)"/); if (!p) continue;
      const sw = attr(t[0], 'stroke-width');
      const v = p[1].trim().split(/[\s,]+/).map(Number);
      for (let i = 0; i + 3 < v.length; i += 2) push(v[i], v[i + 1], v[i + 2], v[i + 3], sw, m);
      if (/polygon/i.test(t[0]) && v.length >= 4) push(v[v.length - 2], v[v.length - 1], v[0], v[1], sw, m);
    }
    for (const t of txt.matchAll(/<path\b[^>]*>/gi)) {
      const d = t[0].match(/\bd="([^"]*)"/); if (!d) continue;
      const sw = attr(t[0], 'stroke-width');
      const own = parseTransform(attr(t[0], 'transform'));
      const toks = d[1].match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
      let i = 0, cmd = null, cx = 0, cy = 0, sx = 0, sy = 0, started = false;
      while (i < toks.length) {
        const tk = toks[i];
        if (/^[a-zA-Z]$/.test(tk)) {
          cmd = tk; i++;
          if (/[Zz]/.test(cmd)) { if (started) push(cx, cy, sx, sy, sw, m, own); cx = sx; cy = sy; started = false; }
          continue;
        }
        if (!cmd) { i++; continue; }
        const U = cmd.toUpperCase(), rel = cmd !== U, n = INK_AR[U]; if (!n) { i++; continue; }
        const a = toks.slice(i, i + n).map(Number); if (a.length < n) break;
        let ex, ey;
        if (n === 1) { const v = a[0]; if (U === 'H') { ex = rel ? cx + v : v; ey = cy; } else { ex = cx; ey = rel ? cy + v : v; } }
        else if (U === 'A') { ex = rel ? cx + a[5] : a[5]; ey = rel ? cy + a[6] : a[6]; }
        else { ex = rel ? cx + a[a.length - 2] : a[a.length - 2]; ey = rel ? cy + a[a.length - 1] : a[a.length - 1]; }
        // M moves the pen and draws nothing (their note: a phantom stroke from 0,0 otherwise)
        if (started) push(cx, cy, ex, ey, sw, m, own);
        if (U === 'M') { sx = ex; sy = ey; started = true; }
        cx = ex; cy = ey; i += n;
      }
    }
  };
  const tagRe = /<(\/?)([\w-]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m, last = 0;
  while ((m = tagRe.exec(svg)) !== null) {
    const close = m[1] === '/', name = m[2].toLowerCase();
    const attrsRaw = m[3] || '';
    const chunkEnd = tagRe.lastIndex;
    if (!close && name === 'g') {
      if (!/\/\s*$/.test(attrsRaw)) stack.push(parseTransform(parseAttrs(attrsRaw).transform) || IDENT);
    } else if (close && name === 'g') stack.pop();
    // the geometry lives IN the tags, so each flushed chunk must cover the tag itself
    flush(svg.slice(last, chunkEnd));
    last = chunkEnd;
  }
  if (last < svg.length) flush(svg.slice(last));
  const circRe = /<circle\b((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let cm;
  while ((cm = circRe.exec(svg)) !== null) {
    const a = parseAttrs(cm[1]);
    const cx = +a.cx, cy = +a.cy, r = +a.r;
    if (![cx, cy, r].every(Number.isFinite)) continue;
    const own = parseTransform(a.transform);
    const mm = own ? mMul(mat(), own) : mat();
    const p = mApply(mm, cx, cy);
    const q = mApply(mm, cx + r, cy);
    circles.push([p.x, p.y, Math.max(0.05, Math.hypot(q.x - p.x, q.y - p.y))]);
  }
  return { segs, circles };
}
function inkBBoxOf(g) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const put = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const [a, b, c, d] of g.segs) { put(a, b); put(c, d); }
  for (const [cx, cy, r] of g.circles) { put(cx - r, cy - r); put(cx + r, cy + r); }
  return Number.isFinite(x0) ? { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 } : null;
}
function inkMaxStroke(g) {
  let m = 1;
  for (const [, , , , s] of g.segs) if (Number.isFinite(s) && s > m) m = s;
  return m;
}
const inkDPointSeg = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};
function inkGap(g, x, y) {
  let d = Infinity;
  for (const [x1, y1, x2, y2] of g.segs) d = Math.min(d, inkDPointSeg(x, y, x1, y1, x2, y2));
  for (const [cx, cy, r] of g.circles) d = Math.min(d, Math.abs(Math.hypot(x - cx, y - cy) - r));
  return d;
}
function inkSamplePoints(g, step) {
  step = step || 0.25;
  const P = [];
  for (const [x1, y1, x2, y2] of g.segs) {
    const L = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k <= n; k++) { const t = k / n; P.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]); }
  }
  for (const [cx, cy, r] of g.circles) {
    const n = Math.max(8, Math.ceil((2 * Math.PI * r) / step / 4) * 4);
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; P.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  }
  return P;
}
/* role -> arrival direction, used only when a port sits ON the ink centre */
const INK_INBOUND = {
  left: [-1, 0], inlet: [-1, 0], suction: [-1, 0], base: [-1, 0], feed: [-1, 0], feedwater: [-1, 0],
  right: [1, 0], outlet: [1, 0], discharge: [1, 0], tip: [1, 0], product: [1, 0],
  top: [0, -1], vent: [0, -1], gas_out: [0, -1], overhead: [0, -1],
  bottom: [0, 1], liquid_out: [0, 1], bottoms: [0, 1], drain: [0, 1], condensate: [0, 1],
  motive: [0, -1], fuel: [0, -1], burner: [0, -1],
};
/* does each port terminate on the glyph's own linework? */
function inkCheck(c, ps) {
  c = c || cur();
  if (!c) return null;
  ps = ps || (c === cur() ? ports() : c.ports) || [];
  const vb = viewDims(c);
  const g = inkOf(c.svg);
  const bb = inkBBoxOf(g);
  if (!bb || (!g.segs.length && !g.circles.length)) return null;
  const P = inkSamplePoints(g, 0.25);
  const AXIS_TOL = Math.max(3, Math.max(vb.w, vb.h) * 0.06);
  const halfStroke = inkMaxStroke(g) / 2;
  const out = [];
  for (const p of ps) {
    const X = vb.x + (p.x / 100) * vb.w, Y = vb.y + (p.y / 100) * vb.h;
    const gap = inkGap(g, X, Y);
    let ax = 0, ay = 0;
    const eps = 1e-6;
    const outL = X < bb.x0 - eps, outR = X > bb.x1 + eps, outT = Y < bb.y0 - eps, outB = Y > bb.y1 + eps;
    if (outL !== outR) ax = outL ? -1 : 1;
    if (outT !== outB) ay = outT ? -1 : 1;
    if (!ax && !ay) {
      const nx = (X - bb.cx) / (bb.x1 - bb.cx || 1), ny = (Y - bb.cy) / (bb.y1 - bb.cy || 1);
      if (Math.abs(nx) >= Math.abs(ny)) ax = Math.sign(nx) || 1; else ay = Math.sign(ny) || 1;
    }
    if (!ax && !ay) {
      const role = INK_INBOUND[String(p.id || '').toLowerCase()];
      if (role) { ax = role[0]; ay = role[1]; }
    }
    let target = null;
    if (ax || ay) {
      const dx = ax, dy = ay;
      const onAxis = (x, y) => Math.abs(-dx * (y - Y) + dy * (x - X));
      const proj = (x, y) => x * dx + y * dy;
      const centreProj = proj(bb.cx, bb.cy);
      const portSide = Math.sign(proj(X, Y) - centreProj) || 1;
      let best = -Infinity, bestPerp = Infinity;
      for (const [x, y] of P) {
        const a = onAxis(x, y);
        if (a > AXIS_TOL) continue;
        const pr = proj(x, y);
        if (Math.sign(pr - centreProj) !== portSide) continue;
        if (pr > best + 1e-9 || (Math.abs(pr - best) <= 1e-9 && a < bestPerp)) { best = pr; bestPerp = a; target = [x, y]; }
      }
    }
    if (!target) { // nothing on the arrival axis: fall back to the nearest metal
      let bd = Infinity;
      for (const [x, y] of P) { const d = Math.hypot(x - X, y - Y); if (d < bd) { bd = d; target = [x, y]; } }
    }
    const onInk = gap <= halfStroke;
    // only a port ON linework that runs PARALLEL to its arrival axis is wrong (co-linear
    // overlap); one meeting the pipe head-on is already right wherever the pipe lands
    let parallel = false;
    if (onInk) {
      for (const [x1, y1, x2, y2] of g.segs) {
        if (inkDPointSeg(X, Y, x1, y1, x2, y2) > halfStroke) continue;
        const L = Math.hypot(x2 - x1, y2 - y1) || 1;
        const cos = Math.abs(((x2 - x1) / L) * ax + ((y2 - y1) / L) * ay);
        if (cos >= 0.7) { parallel = true; break; }
      }
    }
    const moved = target ? Math.hypot(target[0] - X, target[1] - Y) : 0;
    // a port inside half a stroke of the end of its own linework is on the metal; any
    // less is noise, and moving it would be the defect (their fixer's guard)
    const needsMove = target ? moved > Math.max(0.05, halfStroke) : gap > halfStroke + 0.25;
    const wrong = needsMove && (!onInk || parallel);
    out.push({
      port: p, X, Y, gap, target, wrong, onInk, parallel, moved,
      vb, halfStroke,
      to: target ? { x: clamp((target[0] - vb.x) / vb.w * 100, 0, 100), y: clamp((target[1] - vb.y) / vb.h * 100, 0, 100) } : null,
    });
  }
  return { vb, g, bb, halfStroke, ports: out, wrongCount: out.filter((o) => o.wrong).length };
}
/* move one port onto the linework it terminates on */
function snapPortToInk(id) {
  const chk = inkCheck();
  if (!chk) return toast('No ink to snap to in this glyph', 'warn');
  const p = ports().find((q) => q.id === id);
  const row = chk.ports.find((o) => o.port.id === id);
  if (!p || !row) return;
  if (!row.wrong || !row.to || row.moved <= 0.05) return toast('Port ' + id + ' already terminates on its linework', 'ok');
  pushUndo();
  p.x = rnd(row.to.x); p.y = rnd(row.to.y);
  touchDirty();
  refreshAll();
  toast('Snapped ' + id + (row.onInk ? ' clear of the overlap' : ' onto the linework') + ' (moved ' + rnd(row.moved) + 'u)', 'ok');
}
/* every port of the current glyph, one undo step */
function snapAllPortsToInk() {
  const chk = inkCheck();
  if (!chk) return toast('No ink to snap to in this glyph', 'warn');
  // repair exactly what is flagged: their batch fixer skips a sub-half-stroke overlap as
  // indistinguishable from being on the metal, but the flag below already says otherwise
  const bad = chk.ports.filter((o) => o.wrong && o.to && o.moved > 0.05);
  if (!bad.length) return toast('All ' + chk.ports.length + ' ports already terminate on their linework', 'ok');
  pushUndo();
  for (const o of bad) { o.port.x = rnd(o.to.x); o.port.y = rnd(o.to.y); }
  touchDirty();
  refreshAll();
  toast('Snapped ' + bad.length + ' port' + (bad.length > 1 ? 's' : '') + ' onto the linework', 'ok');
}

/* ============================ 31. context menu ============================ */
function showCtxMenu(x, y, items) {
  const m = $('ctxMenu');
  m.innerHTML = items.map((it) => it === '-' ? '<div class="ctxm-sep"></div>'
    : it.cat ? '<div class="ctxm-label">' + escHtml(it.cat) + '</div>'
      : '<button class="ctxmi' + (it.danger ? ' danger' : '') + '" data-cmd="' + escHtml(it.cmd) + '"' + (it.disabled ? ' disabled' : '') + '>' +
        (it.icon ? ic(it.icon) : '') + '<span>' + escHtml(it.label) + '</span>' + (it.k ? '<span class="k">' + escHtml(it.k) + '</span>' : '') + '</button>').join('');
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  m.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => {
    m.hidden = true;
    runCommand(b.dataset.cmd);
  }));
}
function canvasCtxMenu(e) {
  e.preventDefault();
  const pt = screenToView(e);
  const shape = e.target.closest('[data-eid]');
  const dot = e.target.closest('.port-dot');
  if (dot) {
    const p = ports().find((q) => q.id === dot.dataset.port);
    if (p) {
      selPort = p.id; selEls.clear(); draw(); renderInspector(); renderCtxbar();
      showCtxMenu(e.clientX, e.clientY, [
        { cat: 'port ' + p.id },
        { label: 'Duplicate port', cmd: 'dupPort', icon: 'copy' },
        { label: 'Delete port', cmd: 'delPort', icon: 'trash', danger: true, k: 'Del' },
      ]);
    }
    return;
  }
  if (shape) {
    const idx = eidMap[+shape.dataset.eid] ?? -1;
    if (!selEls.has(idx)) selEls = new Set([idx]);
    selPort = null;
    draw(); renderInspector(); renderCtxbar();
    showCtxMenu(e.clientX, e.clientY, [
      { cat: selEls.size + ' element' + (selEls.size > 1 ? 's' : '') },
      { label: 'Duplicate', cmd: 'dup', icon: 'copy', k: 'Ctrl+D' },
      { label: 'Copy', cmd: 'copy', icon: 'clipboard', k: 'Ctrl+C' },
      { label: 'Cut', cmd: 'cut', icon: 'copy', k: 'Ctrl+X' },
      '-',
      { label: 'Bring to front', cmd: 'front', icon: 'front', k: 'Ctrl+]' },
      { label: 'Bring forward', cmd: 'up', icon: 'up' },
      { label: 'Send backward', cmd: 'down', icon: 'down' },
      { label: 'Send to back', cmd: 'bottom', icon: 'back', k: 'Ctrl+[' },
      '-',
      { label: 'Flip horizontal', cmd: 'flipH', icon: 'flipH' },
      { label: 'Flip vertical', cmd: 'flipV', icon: 'flipV' },
      { label: 'Rotate 90° CW', cmd: 'rotCw', icon: 'rotCw' },
      '-',
      { label: 'Delete', cmd: 'del', icon: 'trash', danger: true, k: 'Del' },
    ]);
    return;
  }
  selEls.clear(); selPort = null; draw(); renderInspector(); renderCtxbar();
  showCtxMenu(e.clientX, e.clientY, [
    { cat: 'canvas' },
    { label: 'Paste', cmd: 'paste', icon: 'clipboard', k: 'Ctrl+V', disabled: !clip.length },
    { label: 'Add port here', cmd: 'addPortHere', icon: 'port' },
    { label: 'Add guide', cmd: 'addGuideHere', icon: 'ruler' },
    { label: 'Clear guides', cmd: 'clearGuides', icon: 'trash', disabled: !guides.length },
    '-',
    { label: 'Fit to view', cmd: 'fit', icon: 'eye', k: 'F' },
    { label: 'Select tool', cmd: 'toolSelect', icon: 'cursor', k: 'V' },
    { label: 'Toggle grid', cmd: 'toggleGrid', icon: 'grid', k: 'G' },
    { label: 'Toggle snapping', cmd: 'toggleSnap', icon: 'magnet', k: 'S' },
  ]);
}
$('canvas').addEventListener('contextmenu', canvasCtxMenu);
document.addEventListener('pointerdown', (e) => {
  const m = $('ctxMenu');
  if (!m.hidden && !e.target.closest('#ctxMenu')) m.hidden = true;
}, true);
/* ============================ 32. commands ============================ */
function runCommand(cmd) {
  const ACT = {
    dup, copy: copySel, cut: cutSel, paste: () => pasteClip(), front: () => zOrder('front'),
    up: () => zOrder('up'), down: () => zOrder('down'), bottom: () => zOrder('back'),
    flipH: () => mirrorSel('h'), flipV: () => mirrorSel('v'), rotCw: () => rotate90('cw'),
    rotCcw: () => rotate90('ccw'), del: deleteSel, delPort: () => selPort && delPort(selPort),
    fit: fitView, toggleGrid: () => { cfg.grid = !cfg.grid; saveCfg(); renderCtxbar(); draw(); },
    toggleSnap: () => { cfg.snap = !cfg.snap; saveCfg(); renderCtxbar(); },
    toolSelect: () => setTool('select'), toolPen: () => setTool('pen'),
    clearGuides: () => { guides = []; draw(); }, help: () => { $('modal').hidden = false; },
    theme: toggleTheme, exportJson: exportComponent, bundle: () => { downloadBundle(); }, review: openReview, exportPng,
    snapAll: snapAllPortsToInk,
    copySvg: () => { const parts = svgParts(cur().svg); navigator.clipboard.writeText(parts ? parts.inner : innerOf(cur().svg)).then(() => toast('SVG markup copied', 'ok'), () => toast('Clipboard blocked by browser', 'bad')); },
    selAll: () => { selEls = new Set(shapeIndices().shapes); selPort = null; draw(); renderInspector(); renderCtxbar(); updateStatus(); },
    tidy: tidySource, undo, redo,
    validate: () => { const i = validateIssues(); toast(i.length ? i.length + ' warning' + (i.length > 1 ? 's' : '') : 'symbol is clean', i.length ? 'warn' : 'ok'); },
  };
  if (ACT[cmd]) return ACT[cmd]();
  if (cmd === 'addPortHere') { if (lastCanvasPt) addPortAt(lastCanvasPt); else toast('Right-click on the canvas first', 'warn'); return; }
  if (cmd === 'addGuideHere') {
    const vb = viewDims(cur());
    guides.push({ axis: 'x', pos: rnd(vb.x + vb.w / 2) });
    draw();
    toast('Vertical guide at centre — drag the top ruler to move it');
    return;
  }
  if (cmd.startsWith('goto:')) { select(cmd.slice(5)); return; }
  if (cmd.startsWith('tool:')) { setTool(cmd.slice(5)); return; }
}
let lastCanvasPt = null;
/* ============================ 33. shortcut modal ============================ */
const SHORTCUTS = [
  ['Tools', [['V', 'Select'], ['P', 'Pen'], ['L', 'Line'], ['R', 'Rectangle'], ['O', 'Ellipse'], ['T', 'Text'], ['A', 'Port'], ['H', 'Pan'], ['Space+drag', 'Pan from any tool']]],
  ['Edit', [['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z', 'Redo'], ['Ctrl+A', 'Select all shapes'], ['Ctrl+C / X / V', 'Copy / cut / paste'], ['Ctrl+D', 'Duplicate'], ['Ctrl+]', 'Bring forward'], ['Ctrl+[', 'Send backward'], ['Del', 'Delete'], ['Enter', 'Finish pen path'], ['Backspace', 'Undo pen point']]],
  ['Nudge', [['Arrows', 'Move 0.5'], ['Shift+Arrows', 'Move 5'], ['Shift+drag', 'Fine drag (¼ speed)']]],
  ['View', [['F', 'Fit to view'], ['1', 'Actual size'], ['+ / −', 'Zoom'], ['Wheel', 'Zoom at cursor'], ['G', 'Grid'], ['S', 'Snapping']]],
  ['Canvas', [['Click', 'Select'], ['Shift+click', 'Add to selection'], ['Drag empty', 'Rubber-band select'], ['Alt+click vertex', 'Delete vertex'], ['Double-click empty', 'Add port'], ['Double-click path', 'Insert vertex'], ['Double-click text', 'Edit text inline'], ['Right-click', 'Context menu']]],
  ['App', [['?', 'This dialog'], ['Ctrl+K', 'Command palette'], ['Ctrl+S', 'Download bundle'], ['Esc', 'Deselect / close']]],
];
function openModal() {
  $('modalTitle').textContent = 'Keyboard shortcuts';
  $('modalBody').innerHTML = SHORTCUTS.map(([g, rows]) =>
    '<div class="sc-group"><h3>' + g + '</h3>' + rows.map(([k, l]) =>
      '<div class="sc-row"><span>' + l + '</span><span class="keys">' + k.split(' ').map((x) => '<kbd>' + escHtml(x) + '</kbd>').join('') + '</span></div>').join('') + '</div>').join('');
  $('modal').hidden = false;
}
/* ============================ 34. command palette ============================ */
function paletteItems() {
  const items = [];
  items.push({ cat: 'Symbols' });
  for (const id of visibleIds().slice(0, 40)) items.push({ label: id, cmd: 'goto:' + id, icon: 'layers' });
  items.push({ cat: 'Tools' });
  for (const [t, l] of [['select', 'Select'], ['pen', 'Pen'], ['line', 'Line'], ['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['text', 'Text'], ['port', 'Port'], ['pan', 'Pan']]) items.push({ label: l + ' tool', cmd: 'tool:' + t, icon: 'cursor' });
  items.push({ cat: 'Actions' });
  for (const [l, cmd, icon] of [
    ['Fit to view', 'fit', 'eye'], ['Toggle grid', 'toggleGrid', 'grid'], ['Toggle snapping', 'toggleSnap', 'magnet'],
    ['Undo', 'undo', 'undo'], ['Redo', 'redo', 'redo'], ['Select all shapes', 'selAll', 'layers'],
    ['Duplicate', 'dup', 'copy'], ['Delete selection', 'del', 'trash'], ['Clear guides', 'clearGuides', 'ruler'],
    ['Round source numbers', 'tidy', 'sliders'], ['Validate symbol', 'validate', 'warn'],
    ['Review unsaved edits…', 'review', 'layers'],
    ['Snap all ports to linework', 'snapAll', 'magnet'],
    ['Copy SVG markup', 'copySvg', 'clipboard'], ['Export JSON', 'exportJson', 'download'],
    ['Export PNG', 'exportPng', 'image'],
    ['Download bundle', 'bundle', 'download'], ['Toggle theme', 'theme', 'moon'], ['Keyboard shortcuts', 'help', 'keyboard'],
  ]) items.push({ label: l, cmd, icon });
  return items;
}
let palIdx = 0;
function togglePalette(show) {
  $('palette').hidden = !show;
  if (show) {
    $('paletteInput').value = '';
    palIdx = 0;
    renderPalette('');
    $('paletteInput').focus();
  }
}
function renderPalette(q) {
  const items = paletteItems().filter((it) => it.cat || it.label.toLowerCase().includes(q.toLowerCase()));
  const flat = items.filter((it) => !it.cat);
  palIdx = clamp(palIdx, 0, Math.max(0, flat.length - 1));
  let html = '', n = 0;
  for (const it of items) {
    if (it.cat) { html += '<div class="pal-cat">' + it.cat + '</div>'; continue; }
    const on = n === palIdx;
    html += '<button class="pal-item' + (on ? ' on' : '') + '" data-cmd="' + escHtml(it.cmd) + '">' + ic(it.icon) + '<span>' + escHtml(it.label) + '</span></button>';
    n++;
  }
  $('paletteList').innerHTML = html || '<div class="pal-empty">no matches</div>';
  $('paletteList').querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => {
    togglePalette(false);
    runCommand(b.dataset.cmd);
  }));
}
$('paletteInput').addEventListener('input', (e) => { palIdx = 0; renderPalette(e.target.value); });
$('paletteInput').addEventListener('keydown', (e) => {
  const flat = paletteItems().filter((it) => !it.cat && it.label.toLowerCase().includes($('paletteInput').value.toLowerCase()));
  if (e.key === 'ArrowDown') { palIdx = Math.min(flat.length - 1, palIdx + 1); renderPalette($('paletteInput').value); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { palIdx = Math.max(0, palIdx - 1); renderPalette($('paletteInput').value); e.preventDefault(); }
  else if (e.key === 'Enter') { const c = flat[palIdx]; togglePalette(false); if (c) runCommand(c.cmd); e.preventDefault(); }
  else if (e.key === 'Escape') { togglePalette(false); e.preventDefault(); }
});
$('palette').addEventListener('click', (e) => { if (e.target === $('palette')) togglePalette(false); });
/* ============================ 35. chrome bindings ============================ */
function toggleTheme() {
  cfg.theme = cfg.theme === 'dark' ? 'light' : 'dark';
  document.body.dataset.theme = cfg.theme;
  saveCfg();
  draw();
  toast(cfg.theme === 'dark' ? 'Dark theme' : 'Light theme');
}
$('themeBtn').addEventListener('click', toggleTheme);
$('helpBtn').addEventListener('click', openModal);
$('modalClose').addEventListener('click', () => { $('modal').hidden = true; });
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').hidden = true; });
$('paletteBtn').addEventListener('click', () => togglePalette(true));
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('exportBtn').addEventListener('click', exportComponent);
$('bundleBtn').addEventListener('click', downloadBundle);
$('linkBtn').addEventListener('click', linkGen);
$('saveBtn').addEventListener('click', saveGen);
document.addEventListener('keydown', (e) => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (e.altKey && e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
  if (e.altKey && e.key === 'ArrowRight') { step(1); e.preventDefault(); }
});
document.addEventListener('keydown', (e) => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (e.key === '/') { e.preventDefault(); $('search').focus(); }
});
$('list').addEventListener('click', (e) => {
  const star = e.target.closest('.li-star');
  const item = e.target.closest('.list-item');
  if (!item) return;
  if (star) { toggleFav(item.dataset.id); return; }
  select(item.dataset.id);
});
$('search').addEventListener('input', () => { renderList(); });
$('search').addEventListener('keydown', (e) => {
  const vis = visibleIds();
  const at = vis.indexOf(current);
  if (e.key === 'ArrowDown') { e.preventDefault(); select(vis[Math.min(vis.length - 1, at + 1)] ?? vis[0]); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); select(vis[Math.max(0, at - 1)] ?? vis[0]); }
  else if (e.key === 'Enter') { e.preventDefault(); $('search').blur(); }
});
$('search').addEventListener('blur', () => { if (!$('search').value) renderList(); });
document.querySelectorAll('#browserFilters .chip').forEach((c) => c.addEventListener('click', () => {
  document.querySelectorAll('#browserFilters .chip').forEach((x) => x.classList.remove('on'));
  c.classList.add('on');
  filter = c.dataset.filter;
  renderList();
  const vis = visibleIds();
  if (vis.length && !vis.includes(current)) select(vis[0]);
}));
document.querySelectorAll('#rail .tool[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('railSnap').addEventListener('click', () => { cfg.snap = !cfg.snap; saveCfg(); renderCtxbar(); toast('Snapping ' + (cfg.snap ? 'on' : 'off')); });
$('railGrid').addEventListener('click', () => { cfg.grid = !cfg.grid; saveCfg(); renderCtxbar(); draw(); });
/* track last canvas point for context-menu actions */
$('canvas').addEventListener('pointermove', (e) => { lastCanvasPt = screenToView(e); });
/* canvas double-click: port / vertex split */
function canvasDoubleClick(e) {
  const dot = e.target.closest('.port-dot');
  const vh = e.target.closest('.vertex');
  const shape = e.target.closest('[data-eid]');
  const pt = screenToView(e);
  if (dot || vh) return;
  if (shape && pt) {
    const idx = eidMap[+shape.dataset.eid] ?? -1;
    if (idx >= 0 && selEls.has(idx)) {
      if (!nodeMode) {
        nodeMode = true;
        draw(); renderCtxbar();
        toast('Node editing — drag points to move them, double-click a segment to insert, Esc to exit');
        return;
      }
      insertVertexAt(idx, pt);
      return;
    }
    // a different shape: select it and enter node mode in one gesture
    selEls = new Set([idx]);
    selPort = null;
    nodeMode = true;
    draw(); renderInspector(); renderCtxbar();
    return;
  }
  if (pt) addPortAt(pt);
}
$('canvas').addEventListener('dblclick', canvasDoubleClick);
/* Chrome suppresses compatibility dblclick when pointerdown is preventDefault'd,
   so detect the double-tap ourselves from pointerup timing. */
let lastTap = null, downInfo = null;
$('canvas').addEventListener('pointerup', (e) => {
  if (e.button !== 0) return;
  const now = performance.now();
  const moved = !downInfo || downInfo.pointerId !== e.pointerId ||
    Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y) > 6 || now - downInfo.t > 1200;
  const near = lastTap && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 8 && now - lastTap.t < 750;
  if (near && !moved) {
    lastTap = null;
    canvasDoubleClick({ target: downInfo.target, clientX: e.clientX, clientY: e.clientY });
  } else {
    lastTap = moved ? null : { t: now, x: e.clientX, y: e.clientY };
  }
});
function insertVertexAt(idx, pt) {
  const nodes = analyze(cur().svg), n = nodes[idx];
  if (!n || (n.name !== 'path' && n.name !== 'polyline' && n.name !== 'polygon')) return toast('Double-click splits path/polyline vertices only', 'warn');
  const ch = chainFull(nodes, idx);
  const a = parseAttrs(n.attrsRaw);
  const local = mApply(mInv(ch.full), pt.x, pt.y);
  const lx = snapV(local.x, false), ly = snapV(local.y, false);
  pushUndo();
  if (n.name === 'path' && a.d) {
    const cmds = parsePathD(a.d);
    let cx = 0, cy = 0, sx = 0, sy = 0;
    const anchors = [];
    const rec = (x, y, ci) => { anchors.push({ x, y, ci }); cx = x; cy = y; };
    cmds.forEach((cm, ci) => {
      const ar = cm.args;
      if (cm.cmd === 'M') { sx = ar[ar.length - 2]; sy = ar[ar.length - 1]; rec(sx, sy, ci); }
      else if (cm.cmd === 'Z') rec(sx, sy, ci);
      else if (cm.cmd === 'H') rec(ar[0], cy, ci);
      else if (cm.cmd === 'V') rec(cx, ar[0], ci);
      else if (ar.length >= 2) rec(ar[ar.length - 2], ar[ar.length - 1], ci);
    });
    if (anchors.length < 2) { undoStack.pop(); return toast('Path needs 2+ points to split', 'warn'); }
    let best = 0, bd = 1e9;
    for (let j = 0; j + 1 < anchors.length; j++) {
      const d = segDist(lx, ly, anchors[j].x, anchors[j].y, anchors[j + 1].x, anchors[j + 1].y);
      if (d < bd) { bd = d; best = j; }
    }
    cmds.splice(anchors[best + 1].ci, 0, { cmd: 'L', args: [lx, ly] });
    commitNodeAttrs(idx, setAttrInRaw(n.attrsRaw, 'd', toD(cmds)));
  } else {
    const v = (a.points || '').match(/-?\d*\.?\d+(?:e-?\d+)?/g) || [];
    const np = v.length / 2, segs = n.name === 'polygon' ? np : np - 1;
    if (segs < 1) { undoStack.pop(); return toast('Need 2+ points to split', 'warn'); }
    let best = 0, bd = 1e9;
    for (let j = 0; j < segs; j++) {
      const ax = +v[(j * 2) % v.length], ay = +v[(j * 2 + 1) % v.length];
      const bx = +v[((j + 1) * 2) % v.length], by = +v[((j + 1) * 2 + 1) % v.length];
      const d = segDist(lx, ly, ax, ay, bx, by);
      if (d < bd) { bd = d; best = j; }
    }
    v.splice((best + 1) * 2, 0, String(lx), String(ly));
    commitNodeAttrs(idx, setAttrInRaw(n.attrsRaw, 'points', v.join(' ')));
  }
  touchDirty();
  refreshAll();
  toast('Vertex inserted — drag to refine', 'ok');
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
/* delete vertex via alt+click on handle */
$('canvas').addEventListener('click', (e) => {
  const vh = e.target.closest('.vertex');
  if (vh && e.altKey && selEls.size === 1) deleteVertex([...selEls][0], +vh.dataset.vi);
});
function deleteVertex(idx, vi) {
  const nodes = analyze(cur().svg), n = nodes[idx];
  if (!n) return;
  const a = parseAttrs(n.attrsRaw);
  pushUndo();
  if (n.name === 'polyline' || n.name === 'polygon') {
    const v = (a.points || '').match(/-?\d*\.?\d+(?:e-?\d+)?/g) || [];
    const min = n.name === 'polygon' ? 3 : 2;
    if (v.length / 2 <= min) { undoStack.pop(); return toast('A ' + n.name + ' needs at least ' + min + ' points', 'warn'); }
    v.splice(vi * 2, 2);
    commitNodeAttrs(idx, setAttrInRaw(n.attrsRaw, 'points', v.join(' ')));
  } else if (n.name === 'path') {
    const cmds = parsePathD(a.d);
    const cm = cmds[vertexList(idx)[vi]?.pi?.ci];
    if (!cm || cm.cmd === 'M' || cm.cmd === 'Z') { undoStack.pop(); return toast("Can't delete the " + (cm ? cm.cmd : 'anchor') + ' command — delete the element instead', 'warn'); }
    cmds.splice(vertexList(idx)[vi].pi.ci, 1);
    commitNodeAttrs(idx, setAttrInRaw(n.attrsRaw, 'd', toD(cmds)));
  } else { undoStack.pop(); return toast('Alt+click deletes path/poly vertices only', 'warn'); }
  touchDirty();
  refreshAll();
  toast('Vertex deleted', 'ok');
}
/* selAll command for the palette */
/* resize */
let resizeRaf = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => { if (current) draw(); });
});
/* ============================ 36. boot ============================ */
function boot() {
  document.body.dataset.theme = cfg.theme;
  document.querySelectorAll('#rail .tool[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === 'select'));
  $('search').placeholder = 'Search ' + ALL.length + ' symbols…';
  if (!window.showOpenFilePicker) {
    $('linkBtn').disabled = true;
    $('linkBtn').title = 'File System Access API unavailable — use Download bundle + reload';
    $('saveBtn').disabled = true;
  }
  initRulers();
  select(ALL[0]);
  bindCtxbarOnce();
  updateHistChrome();
  updateAutoChrome();
  offerRecovery();
  setTimeout(() => toast('Loaded ' + ALL.length + ' symbols — press ? for shortcuts'), 400);
}
function bindCtxbarOnce() { /* ctxbar re-renders itself; nothing global to bind */ }
boot();
})();










