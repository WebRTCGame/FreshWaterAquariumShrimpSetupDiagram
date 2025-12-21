import { focusOnComponent } from './sidebar.js';

export function initializeTooltips() {
  const tooltip = document.getElementById('component-tooltip');
  const svg = document.getElementById('mySvgId');

  if (!svg) { console.error('❌ SVG element #mySvgId not found!'); return; }
  if (!tooltip) { console.error('❌ Tooltip element #component-tooltip not found!'); return; }

  console.log('=== TOOLTIP REBUILD INITIALIZATION ===');

  // Remove previous handlers cleanly
  const prev = svg.querySelectorAll('[data-tooltip-enabled="true"]');
  prev.forEach(el => {
    if (el._tooltipHandlers) {
      const h = el._tooltipHandlers;
      if (h.enter) el.removeEventListener('pointerenter', h.enter);
      if (h.move) el.removeEventListener('pointermove', h.move);
      if (h.leave) el.removeEventListener('pointerleave', h.leave);
      if (h.click) el.removeEventListener('click', h.click);
      delete el._tooltipHandlers;
    }
    el.removeAttribute('data-tooltip-enabled');
  });

  // Build index mapping candidate elements -> component data
  const index = buildTooltipIndex(svg);
  const entries = Array.from(index.entries());
  console.log(`🔍 Indexed ${entries.length} candidate elements for tooltips`);

  let attached = 0;

  // Helper: attach pointer handlers to an element
  function attachHandlers(target, componentData) {
    if (target._tooltipHandlers) return; // already attached

    target.setAttribute('data-tooltip-enabled', 'true');
    target.style.cursor = 'pointer';

    let showTimer = null;
    let hideTimer = null;

    const show = (e) => {
      // ensure component data is present
      if (!componentData) return;
      // build content
      let content;
      if (componentData.details) content = createEnhancedTooltipContent(componentData);
      else content = createTooltipContent(componentData);

      if (!content || content.trim().length < 5) return;

      tooltip.innerHTML = content;
      updateTooltipPosition(e, tooltip);
      tooltip.classList.add('visible');
      tooltip.style.opacity = '1';
      // mark currently shown element
      tooltip._currentTarget = target;
      console.log('tooltip show for', componentData.id || componentData.elementId || componentData.name);
    };

    const hide = () => {
      tooltip.style.opacity = '0';
      tooltip.classList.remove('visible');
      tooltip._currentTarget = null;
    };

    const onEnter = (e) => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      // small delay to avoid accidental flicker
      showTimer = setTimeout(() => show(e), 100);
    };

    const onMove = (e) => {
      // update position while visible
      if (tooltip.classList.contains('visible')) updateTooltipPosition(e, tooltip);
    };

    const onLeave = (e) => {
      if (showTimer) { clearTimeout(showTimer); showTimer = null; }
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => hide(), 150);
    };

    const onClick = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (window.panZoomInstance) focusOnComponent(window.panZoomInstance, componentData.id || componentData.elementId);
    };

    target.addEventListener('pointerenter', onEnter);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerleave', onLeave);
    target.addEventListener('click', onClick);

    target._tooltipHandlers = { enter: onEnter, move: onMove, leave: onLeave, click: onClick };
    attached++;
  }

  // Ensure graph element list is parsed and available
  if (!window.graphElementsMap) {
    parseGraphDefinition();
  }

  // Attach handlers for all indexed elements
  for (const [el, componentData] of entries) {
    // quick size checks
    try {
      const r = el.getBoundingClientRect();
      if (r.width * r.height < 36) continue; // too small
      if (r.width * r.height > 20000) continue; // too large
    } catch (err) {}

    // respect parsed graph preferences: ensure target/id is allowed
    try {
      const elId = el.getAttribute && el.getAttribute('id');
      if (elId && window.graphElementsMap && window.graphElementsMap[elId] && window.graphElementsMap[elId].showTooltips === false) {
        // skip this element
        continue;
      }
      // if the element id contains a canonical id that is explicitly disabled
      if (elId && window.graphElementsMap) {
        const disabled = Object.values(window.graphElementsMap).some(g => g.showTooltips === false && elId.indexOf(g.id) !== -1);
        if (disabled) continue;
      }
    } catch (err) { /* ignore */ }

    attachHandlers(el, componentData);
  }

  console.log('✅ Tooltip handlers attached:', attached);

  // Expose rebuild helper
  window.rebuildTooltips = () => { console.log('🔄 Rebuilding tooltips...'); initializeTooltips(); };

  console.log('=== TOOLTIP REBUILD COMPLETE ===');
}


// Build index: map best element targets to component data
export function buildTooltipIndex(svg) {
  const map = new Map();
  const components = window.sidebarComponents || {};
  if (!components) return map;

  const compKeys = Object.keys(components);

  // 1) Try to match by id selectors
  compKeys.forEach(compId => {
    const compData = components[compId];
    const selectors = [
      `#${compId}`,
      `[id*="${compId}"]`,
      `[id*="${compId.replace(/_/g,'-')}"]`,
      `[id^="flowchart-${compId}"]`
    ];
    selectors.forEach(sel => {
      try {
        svg.querySelectorAll(sel).forEach(el => {
          const target = findNearestNodeOrShape(el, svg);
          if (target && !map.has(target)) map.set(target, compData);
        });
      } catch (err) { /* ignore invalid selectors */ }
    });
  });

  // 2) Try name/text based matching for unlabeled nodes
  const nodeGroups = svg.querySelectorAll('g');
  nodeGroups.forEach(g => {
    if (map.has(g)) return;
    if (isAreaLabel(getElementText(g), g)) return;
    const text = (getElementText(g) || '').toLowerCase();
    if (!text || text.length < 2) return;

    // score against component names
    let best = { score: 0, id: null };
    compKeys.forEach(compId => {
      const comp = components[compId];
      const name = (comp.name || '').toLowerCase();
      if (!name) return;
      const nameTokens = name.split(/\s|\-|\(|\)/).filter(Boolean).filter(t => t.length > 2);
      let score = 0;
      nameTokens.forEach(t => { if (text.includes(t)) score += 10; });
      // numeric match bumps
      const cNum = (compId.match(/(\d{2,})/)||[])[1];
      const eNum = (text.match(/(\d{2,})/)||[])[1];
      if (cNum && eNum && cNum === eNum) score += 30;
      if (score > best.score) best = { score, id: compId };
    });

    if (best.score >= 20) {
      const compData = components[best.id];
      map.set(g, compData);
    }
  });

  return map;
}

export function findNearestNodeOrShape(element, svg) {
  if (!element) return null;
  // prefer a parent g with an id or shapes
  let el = element;
  while (el && el !== svg) {
    if (el.getAttribute && el.getAttribute('id') && /^[A-Za-z0-9_\-]+$/.test(el.getAttribute('id'))) return el;
    // has shape
    if (el.querySelector && el.querySelector('rect,circle,ellipse,path,polygon')) return el;
    el = el.parentElement;
  }
  return null;
}

// Parse window.GRAPH_DEFINITION (Mermaid) to produce a map of graph elements with tooltip preferences
export function parseGraphDefinition() {
  const def = window.GRAPH_DEFINITION || '';
  const lines = def.split(/\n/);
  const map = {};

  // simple regexes
  const nodeRe = /^\s*([A-Za-z0-9_]+)\s*(?:\(|\[|\{)\s*/;
  const nodeLabelRe = /^\s*([A-Za-z0-9_]+)\s*(?:\(|\[|\{)\s*([\s\S]*?)\s*[\]\)\}]/;
  const subgraphRe = /^\s*subgraph\s+([A-Za-z0-9_]+)\s*\[\s*"([\s\S]*?)"\s*\]/;

  const componentKeys = new Set(Object.keys(window.sidebarComponents || {}));
  const excludePrefixes = ['L_', 'viewport', 'mySvgId', 'flowchart-'];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if (m = l.match(subgraphRe)) {
      const id = m[1];
      const label = (m[2] || '').trim();
      map[id] = { id, label, type: 'subgraph', showTooltips: false };
      continue;
    }
    if (m = l.match(nodeLabelRe)) {
      const id = m[1];
      const label = (m[2] || '').replace(/<br>/gi, ' ').trim();
      // default: show if matches a known component id
      let show = false;
      if (componentKeys.has(id)) show = true;
      // exclude certain prefixes
      if (excludePrefixes.some(p => id.startsWith(p))) show = false;
      // also if label looks like a section/legend, disable
      if (label && label === label.toUpperCase() && label.length > 15) show = false;

      map[id] = { id, label, type: 'node', showTooltips: show };
      continue;
    }
    if (m = l.match(nodeRe)) {
      const id = m[1];
      // no label parsed, keep default
      let show = componentKeys.has(id);
      if (excludePrefixes.some(p => id.startsWith(p))) show = false;
      map[id] = map[id] || { id, label: '', type: 'node', showTooltips: show };
    }
  }

  window.graphElementsList = Object.values(map);
  window.graphElementsMap = Object.assign({}, map);
  console.log(`🔧 Parsed ${window.graphElementsList.length} graph elements (from GRAPH_DEFINITION)`);
  return window.graphElementsList;
}

export function shouldShowTooltipForElement(el, componentData) {
  // Prefer explicit mapping by component id
  const compId = componentData && (componentData.id || componentData.elementId);
  if (compId && window.graphElementsMap && window.graphElementsMap[compId]) {
    return window.graphElementsMap[compId].showTooltips;
  }

  const elId = el && el.getAttribute && el.getAttribute('id');
  if (elId && window.graphElementsMap) {
    // direct match
    if (window.graphElementsMap[elId]) return window.graphElementsMap[elId].showTooltips;
    // substring match (e.g., flowchart-P_201-147 contains P_201)
    for (const g of Object.values(window.graphElementsMap)) {
      if (g.id && elId.indexOf(g.id) !== -1) return g.showTooltips;
    }
  }

  // Fallback: if there is componentData, allow; otherwise disallow
  return !!compId;
}

export function setGraphElementTooltipFlag(id, flag) {
  if (!window.graphElementsMap) parseGraphDefinition();
  if (window.graphElementsMap && window.graphElementsMap[id]) {
    window.graphElementsMap[id].showTooltips = !!flag;
    console.log(`Graph element ${id} showTooltips set to ${!!flag}`);
    return true;
  }
  console.warn(`Graph element ${id} not found`);
  return false;
}

export function renderBottomPanel() {
  if (!document) return;
  const panel = document.getElementById('bottom-panel');
  if (!panel) { console.warn('Bottom panel element not found'); return; }

  if (!window.graphElementsList) parseGraphDefinition();
  const list = window.graphElementsList || [];

  const bpList = document.getElementById('bp-list');
  const bpSearch = document.getElementById('bp-search');
  const bpToggle = document.getElementById('bp-toggle');
  const bpShowAll = document.getElementById('bp-show-all');
  const bpHideAll = document.getElementById('bp-hide-all');
  const bpRebuild = document.getElementById('bp-rebuild');
  const bpHoverLogging = document.getElementById('bp-hover-logging');

  // Theme controls
  let bpThemeSelect = document.getElementById('bp-theme-select');
  let bpThemeApply = document.getElementById('bp-theme-apply');
  // if not present (older markup), create dynamically
  if (!bpThemeSelect) {
    const themeWrap = document.createElement('div');
    themeWrap.style.marginTop = '8px';
    themeWrap.style.display = 'flex';
    themeWrap.style.alignItems = 'center';
    themeWrap.style.gap = '8px';

    bpThemeSelect = document.createElement('select');
    bpThemeSelect.id = 'bp-theme-select';
    ['default','neutral','dark','forest','base'].forEach(t => {
      const o = document.createElement('option'); o.value = t; o.textContent = t; bpThemeSelect.appendChild(o);
    });

    bpThemeApply = document.createElement('button'); bpThemeApply.id = 'bp-theme-apply'; bpThemeApply.textContent = 'Apply Theme';

    const themeVarsBtn = document.createElement('button'); themeVarsBtn.textContent = 'Theme Vars'; themeVarsBtn.style.marginLeft = '8px';

    // insert into panel body top
    const bodyTop = panel.querySelector('.panel-controls');
    bodyTop.appendChild(themeWrap);
    themeWrap.appendChild(bpThemeSelect);
    themeWrap.appendChild(bpThemeApply);
    themeWrap.appendChild(themeVarsBtn);

    // theme variables editor (hidden by default)
    const themeVarsEditor = document.createElement('div');
    themeVarsEditor.style.display = 'none';
    themeVarsEditor.style.marginTop = '8px';
    themeVarsEditor.style.padding = '6px';
    themeVarsEditor.style.background = 'rgba(255,255,255,0.02)';
    themeVarsEditor.innerHTML = `
      <label style="font-size:12px; display:block; margin-bottom:6px;"><input type="checkbox" id="bp-theme-darkmode" /> Dark mode</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <label style="font-size:12px;">primaryColor <input type="color" id="bp-theme-primary" value="#ADD8E6" /></label>
        <label style="font-size:12px;">primaryTextColor <input type="color" id="bp-theme-primaryTextColor" value="#083049" /></label>
        <label style="font-size:12px;">primaryBorderColor <input type="color" id="bp-theme-primaryBorderColor" value="#7BA7C9" /></label>
        <label style="font-size:12px;">secondaryColor <input type="color" id="bp-theme-secondary" value="#81C784" /></label>
        <label style="font-size:12px;">secondaryTextColor <input type="color" id="bp-theme-secondaryTextColor" value="#083049" /></label>
        <label style="font-size:12px;">background <input type="color" id="bp-theme-background" value="#f4f4f4" /></label>
        <label style="font-size:12px;">lineColor <input type="color" id="bp-theme-lineColor" value="#cccccc" /></label>
        <label style="font-size:12px;">nodeBorder <input type="color" id="bp-theme-nodeBorder" value="#7BA7C9" /></label>
        <label style="font-size:12px;">clusterBkg <input type="color" id="bp-theme-clusterBkg" value="#FFFFDE" /></label>
        <label style="font-size:12px;">clusterBorder <input type="color" id="bp-theme-clusterBorder" value="#AAA433" /></label>
        <label style="font-size:12px;">nodeTextColor <input type="color" id="bp-theme-nodeTextColor" value="#083049" /></label>
        <label style="font-size:12px;">mainBkg <input type="color" id="bp-theme-mainBkg" value="#FFFFFF" /></label>
        <label style="font-size:12px;">noteBkgColor <input type="color" id="bp-theme-noteBkgColor" value="#fff5ad" /></label>
        <label style="font-size:12px;">noteTextColor <input type="color" id="bp-theme-noteTextColor" value="#333333" /></label>
      </div>
      <div style="margin-top:8px; display:flex;align-items:center;gap:8px;">
        <button id="bp-theme-apply">Apply Theme</button>
        <button id="bp-theme-apply-file">Apply File Theme</button>
        <div id="bp-theme-preview" style="display:flex;gap:6px;align-items:center;margin-left:8px;"><div style="width:18px;height:18px;border-radius:3px;border:1px solid #000" id="bp-swatch-primary"></div><div style="width:18px;height:18px;border-radius:3px;border:1px solid #000" id="bp-swatch-secondary"></div><div style="width:18px;height:18px;border-radius:3px;border:1px solid #000" id="bp-swatch-main"></div></div>
      </div>
    `;
    bodyTop.appendChild(themeVarsEditor);

    themeVarsBtn.onclick = () => { themeVarsEditor.style.display = themeVarsEditor.style.display === 'none' ? 'block' : 'none'; };

    // Attach event handlers to the inline Theme Vars editor buttons (avoid ID collisions by scoping)
    const themeVarsApplyBtn = themeVarsEditor.querySelector('#bp-theme-apply');
    if (themeVarsApplyBtn) {
      themeVarsApplyBtn.addEventListener('click', () => {
        const themeVars = {
          primaryColor: document.getElementById('bp-theme-primary').value,
          primaryTextColor: document.getElementById('bp-theme-primaryTextColor').value,
          primaryBorderColor: document.getElementById('bp-theme-primaryBorderColor').value,
          secondaryColor: document.getElementById('bp-theme-secondary').value,
          secondaryTextColor: document.getElementById('bp-theme-secondaryTextColor').value,
          background: document.getElementById('bp-theme-background').value,
          lineColor: document.getElementById('bp-theme-lineColor').value,
          nodeBorder: document.getElementById('bp-theme-nodeBorder').value,
          clusterBkg: document.getElementById('bp-theme-clusterBkg').value,
          clusterBorder: document.getElementById('bp-theme-clusterBorder').value,
          nodeTextColor: document.getElementById('bp-theme-nodeTextColor').value,
          mainBkg: document.getElementById('bp-theme-mainBkg').value,
          noteBkgColor: document.getElementById('bp-theme-noteBkgColor').value,
          noteTextColor: document.getElementById('bp-theme-noteTextColor').value,
        };
        console.log('Applying theme variables from editor:', themeVars);
        if (window.applyMermaidConfig) {
          window.applyMermaidConfig({ theme: 'base', themeVariables: themeVars }).then(() => {
            setTimeout(() => { if (window.rebuildTooltips) window.rebuildTooltips(); }, 400);
          });
        }
      });
    }

    const applyFileThemeBtn = themeVarsEditor.querySelector('#bp-theme-apply-file');
    if (applyFileThemeBtn) {
      applyFileThemeBtn.addEventListener('click', () => {
        console.log('Applying theme from file (MERMAID_BASE_THEME)');
        if (window.applyBaseTheme) window.applyBaseTheme();
        setTimeout(() => { if (window.rebuildTooltips) window.rebuildTooltips(); }, 500);
      });
    }

    // apply handler (do not persist to localStorage — theme comes from code)
    bpThemeApply.onclick = () => {
      const theme = bpThemeSelect.value;
      const isBase = theme === 'base';
      const vars = {};
      if (isBase) {
        const primary = document.getElementById('bp-theme-primary').value;
        const secondary = document.getElementById('bp-theme-secondary').value;
        const background = document.getElementById('bp-theme-background').value;
        const dark = document.getElementById('bp-theme-darkmode').checked;
        vars.theme = 'base';
        vars.themeVariables = { primaryColor: primary, secondaryColor: secondary, background, darkMode: dark };
      }

      // call diagram apply function
      if (window.applyMermaidConfig) {
        const conf = { theme };
        if (vars.themeVariables) conf.themeVariables = vars.themeVariables;
        window.applyMermaidConfig(conf).then(() => {
          // re-init tooltips after diagram re-render
          setTimeout(() => { if (window.rebuildTooltips) window.rebuildTooltips(); }, 400);
        });
      } else {
        console.warn('applyMermaidConfig not available');
      }
    };

    // Initialize UI to current in-code config (no localStorage)
    try {
      const cur = window._mermaidConfig || {};
      if (cur.theme) bpThemeSelect.value = cur.theme;
      if (cur.themeVariables) {
        document.getElementById('bp-theme-primary').value = cur.themeVariables.primaryColor || '#ADD8E6';
        document.getElementById('bp-theme-secondary').value = cur.themeVariables.secondaryColor || '#FFD700';
        document.getElementById('bp-theme-background').value = cur.themeVariables.background || '#f4f4f4';
        document.getElementById('bp-theme-darkmode').checked = !!cur.themeVariables.darkMode;
      }
    } catch (err) { /* ignore */ }

    // Live preview swatches for quick visual feedback
    try {
      const swPrimary = document.getElementById('bp-swatch-primary');
      const swSecondary = document.getElementById('bp-swatch-secondary');
      const swMain = document.getElementById('bp-swatch-main');

      function updateSwatches() {
        const p = document.getElementById('bp-theme-primary').value;
        const s = document.getElementById('bp-theme-secondary').value;
        const m = document.getElementById('bp-theme-mainBkg').value || document.getElementById('bp-theme-background').value;
        if (swPrimary) swPrimary.style.background = p;
        if (swSecondary) swSecondary.style.background = s;
        if (swMain) swMain.style.background = m;
      }
      ['bp-theme-primary', 'bp-theme-secondary', 'bp-theme-mainBkg', 'bp-theme-background'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateSwatches);
      });
      updateSwatches();
    } catch (err) { /* ignore */ }
  }

  // helper to build list UI
  function buildList(filter = '') {
    bpList.innerHTML = '';
    const low = (filter || '').toLowerCase();
    list.forEach(item => {
      const id = item.id;
      const label = item.label || '';
      const show = !!item.showTooltips;
      if (low && !id.toLowerCase().includes(low) && !(label && label.toLowerCase().includes(low))) return;

      const row = document.createElement('div');
      row.className = 'panel-item';

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = show;
      chk.dataset.id = id;

      const title = document.createElement('div');
      title.innerHTML = `<strong>${id}</strong><div class="meta">${label}</div>`;
      title.style.marginLeft = '8px';

      left.appendChild(chk);
      left.appendChild(title);

      const right = document.createElement('div');
      const info = document.createElement('div');
      info.style.fontSize = '11px';
      info.style.color = '#9da8ad';
      info.textContent = item.type || '';
      right.appendChild(info);

      row.appendChild(left);
      row.appendChild(right);

      bpList.appendChild(row);

      chk.addEventListener('change', (e) => {
        const wanted = chk.checked;
        setGraphElementTooltipFlag(id, wanted);
        // debounce rebuild
        if (window._rebuildTimeout) clearTimeout(window._rebuildTimeout);
        window._rebuildTimeout = setTimeout(() => { if (window.rebuildTooltips) window.rebuildTooltips(); }, 250);
      });
    });
  }

  // initial build
  buildList('');

  // toggle open/close
  bpToggle.onclick = () => {
    panel.classList.toggle('collapsed');
    const isCollapsed = panel.classList.contains('collapsed');
    panel.setAttribute('aria-hidden', isCollapsed ? 'true' : 'false');
    bpToggle.textContent = isCollapsed ? '▲' : '▼';
  };

  // search
  bpSearch.oninput = (e) => {
    buildList(e.target.value || '');
  };

  // show/hide all
  bpShowAll.onclick = () => {
    list.forEach(it => setGraphElementTooltipFlag(it.id, true));
    buildList(bpSearch.value || '');
    setTimeout(() => window.rebuildTooltips && window.rebuildTooltips(), 250);
  };
  bpHideAll.onclick = () => {
    list.forEach(it => setGraphElementTooltipFlag(it.id, false));
    buildList(bpSearch.value || '');
    setTimeout(() => window.rebuildTooltips && window.rebuildTooltips(), 250);
  };

  bpRebuild.onclick = () => { window.rebuildTooltips && window.rebuildTooltips(); };

  // hover logging toggle
  bpHoverLogging.onchange = (e) => {
    if (e.target.checked) window.enableHoverLogging && window.enableHoverLogging();
    else window.disableHoverLogging && window.disableHoverLogging();
  };

  // ensure panel visible when first used
  panel.classList.remove('collapsed');
  setTimeout(() => panel.classList.add('collapsed'), 1000);
}


export function getElementText(element) {
  let text = '';

  if (element.textContent) {
    text = element.textContent.trim();
  }

  if (!text) {
    const textNodes = element.querySelectorAll('text, tspan');
    if (textNodes.length > 0) {
      text = Array.from(textNodes).map(node => node.textContent?.trim()).filter(t => t).join(' ');
    }
  }

  return text;
}

// Heuristic: detect large area/subgraph labels we should not attach tooltips to
export function isAreaLabel(text, element) {
  if (!text) return false;
  const t = text.trim();

  // Common structural labels produced by the graph generator
  if (/\bINSIDE\b|\bOUTSIDE\b|\bSUBGRAPH\b|\bDIRECT COMPONENTS\b/i.test(t)) return true;

  // Very long, all-caps labels are likely section headers rather than individual components
  if (t.length > 20 && t === t.toUpperCase()) return true;

  // Bounding box too large → likely an area label or container
  try {
    const rect = element.getBoundingClientRect();
    if (rect.width * rect.height > 20000) return true;
  } catch (err) {
    /* ignore */
  }

  // Parent classes that indicate clusters/sections in Mermaid output
  let parent = element.parentElement;
  while (parent && parent !== document) {
    const cls = parent.getAttribute && parent.getAttribute('class');
    if (cls && /cluster|section|subgraph|flowchart|label|section-title/i.test(cls)) return true;
    parent = parent.parentElement;
  }

  return false;
}

// Position the tooltip near the cursor while keeping it within the viewport and main container
export function updateTooltipPosition(event, tooltip) {
  const mainContainer = document.getElementById('main-container');
  const containerRect = mainContainer ? mainContainer.getBoundingClientRect() : { left: 0, top: 0 };

  let x = event.clientX + 15;
  let y = event.clientY - 10;

  const tooltipWidth = 300;
  const tooltipHeight = 200;

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

export function extractComponentInfo(text, elementId, element) {
  // Preferably match by ID using a scored approach to avoid accidental substring matches
  function normalizeId(id) {
    return (id || '').toString().toLowerCase().replace(/^flowchart-/, '').replace(/[^a-z0-9\-]+/g, ' ').trim();
  }

  function tokensFromId(id) {
    return normalizeId(id).split(/\s|\-|_/).filter(Boolean);
  }

  function numericPart(id) {
    const m = id && id.match(/(\d{2,})/);
    return m ? m[1] : null;
  }

  function scoreMatch(componentId, componentData, elId, txt) {
    const cNorm = normalizeId(componentId);
    const eNorm = normalizeId(elId);
    const cTokens = tokensFromId(componentId);
    // include tokens derived from text if ID is missing or informative
    const eTokens = tokensFromId(elId || txt);

    let score = 0;

    if (!elId && !txt) return 0;

    // exact normalized equality
    if (eNorm && cNorm && eNorm === cNorm) score += 100;

    // all component tokens appear in element tokens (strong match)
    const tokenMatches = cTokens.filter(t => t.length > 2 && eTokens.includes(t)).length;
    if (tokenMatches === cTokens.length && tokenMatches > 0) score += 90;
    else score += Math.min(30, tokenMatches * 20);

    // exact numeric match (e.g., 201 -> matches component with 201)
    const cNum = numericPart(componentId) || numericPart(componentData.id) || numericPart(componentData.elementId || '');
    const eNum = numericPart(elId) || numericPart(txt);
    if (cNum && eNum && cNum === eNum) {
      // prefer numeric match only when there is supporting evidence (token matches or exact normalized equality)
      if (tokenMatches > 0 || (eNorm && cNorm && eNorm === cNorm)) score += 80;
      else score += 20; // weaker match when only the numeric portion aligns (avoids P_201 matching all *-201 ids)
    }

    // element contains component id as whole word (respect separators)
    const regex = new RegExp('(?:^|[\\s\\-_])' + cNorm.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '(?:$|[\\s\\-_])');
    if (eNorm && regex.test(eNorm)) score += 85;

    // text-based name matching (less reliable)
    if (txt && componentData.name) {
      const name = componentData.name.toLowerCase();
      const words = name.split(/\s|\-|\(|\)/).filter(Boolean);
      const textLower = txt.toLowerCase();
      const textMatches = words.filter(w => w.length > 3 && textLower.includes(w)).length;
      score += Math.min(40, textMatches * 15);
    }

    // penalize matches that are based only on very short tokens
    const shortTokenPenalty = cTokens.filter(t => t.length <= 2).length * 10;
    score -= shortTokenPenalty;

    return score;
  }

  if (window.sidebarComponents) {
    // if exact id is present as key, return immediately
    if (elementId && window.sidebarComponents[elementId]) return window.sidebarComponents[elementId];

    let best = { score: 0, data: null, id: null };

    for (const [componentId, componentData] of Object.entries(window.sidebarComponents)) {
      const s = scoreMatch(componentId, componentData, elementId, text);
      if (s > best.score) best = { score: s, data: componentData, id: componentId };
    }

    // Accept a match only if it is reasonably strong AND meets additional reliability checks
    if (best.score >= 70) {
      const elIdLow = (elementId || '').toLowerCase();
      const hasDirectIdMatch = best.id && elIdLow.includes(best.id.toLowerCase());
      const hasNumeric = numericPart(elementId) || numericPart(text);
      const hasText = text && text.trim().length > 2;

      // Only accept borderline matches (70-89) if we have direct evidence (id contains component id, numeric part matches, or visible text)
      if (best.score >= 90 || hasDirectIdMatch || hasNumeric || hasText) return best.data;
      // otherwise, fall back to variations below
    }

    // Fallback: try variations and loose text match but score them lower
    for (const [componentId, componentData] of Object.entries(window.sidebarComponents)) {
      const variations = getComponentVariations(componentId, componentData);
      for (const variation of variations) {
        if (elementId && elementId.toLowerCase() === variation.toLowerCase()) return componentData;
        if (text && text.toLowerCase().includes(variation.toLowerCase())) return componentData;
      }
    }
  }

  // As last resort, use intelligent detection (based on heuristics) if element text seems meaningful
  if (text && text.length > 2) {
    return createIntelligentComponentInfo(text, elementId, element);
  }

  return null;
}

export function getComponentVariations(componentId, componentData) {
  const variations = [componentId];

  if (componentId.includes('_')) {
    variations.push(componentId.replace(/_/g, '-'));
    variations.push(componentId.replace(/_/g, ''));
  }

  const commonVariations = {
    'ATO_PMP': ['ATO-202', 'ATO_202', 'ATO202', 'AUTO TOP-OFF', 'AUTOTOPOFF'],
    'P_201': ['P-201', 'P201', 'PUMP-201', 'CIRCULATION PUMP'],
    'HTR_101': ['HTR-101', 'HTR101', 'HEATER-101', 'MAIN HEATER'],
    'HTR_102': ['HTR-102', 'HTR102', 'HEATER-102', 'BACKUP HEATER'],
    'LGT_101': ['LGT-101', 'LGT101', 'LIGHT-101', 'LED LIGHTING'],
    'DOS_PMP_1': ['DOS-P-101', 'DOS_P_101', 'DOSP101', 'DOSING PUMP 1'],
    'DOS_PMP_2': ['DOS-P-102', 'DOS_P_102', 'DOSP102', 'DOSING PUMP 2'],
    'AIR_101': ['AC-101', 'AC101', 'AIR COMPRESSOR'],
    'AIR_102': ['AC-102', 'AC102', 'BACKUP AIR'],
    'CO2_CYL': ['CO2-201', 'CO2_201', 'CO2 CYLINDER'],
    'CO2_REG': ['CO2-202', 'CO2_202', 'CO2 REGULATOR'],
    'TK_101': ['TANK-101', 'TK101', 'MAIN TANK'],
    'CONT_101': ['CONTROLLER-101', 'CONT101', 'PARAMETER CONTROLLER'],
    'QT_TANK': ['QT-101', 'QT101', 'QUARANTINE'],
    'SH_MOSS': ['SH-101', 'SH101', 'MOSS FIELDS'],
    'SH_CAVES': ['SH-102', 'SH102', 'ROCK CAVES']
  };

  if (commonVariations[componentId]) variations.push(...commonVariations[componentId]);

  if (componentData.name) {
    const name = componentData.name.toLowerCase();
    const nameMatches = name.match(/([a-z]+[\-\s]*\d+)|([a-z]{2,})/g);
    if (nameMatches) variations.push(...nameMatches);
  }

  return variations;
}

export function createIntelligentComponentInfo(text, elementId, element) {
  const info = { name: text, type: 'diagram-element', intelligent: true };

  if (text.match(/tank|vessel|container/i)) {
    info.category = 'Tank/Vessel'; info.desc = 'Water storage or processing vessel';
  } else if (text.match(/pump|motor|circulation/i)) {
    info.category = 'Pump/Motor'; info.desc = 'Water circulation or movement device';
  } else if (text.match(/filter|filtration|media/i)) {
    info.category = 'Filtration'; info.desc = 'Water filtration component';
  } else if (text.match(/sensor|probe|monitor|meter/i)) {
    info.category = 'Instrumentation'; info.desc = 'Monitoring or measurement device';
  } else if (text.match(/heater|heating|temperature/i)) {
    info.category = 'Heating'; info.desc = 'Temperature control system';
  } else if (text.match(/light|lighting|led|lamp/i)) {
    info.category = 'Lighting'; info.desc = 'Illumination system';
  } else if (text.match(/valve|control|flow/i)) {
    info.category = 'Flow Control'; info.desc = 'Flow regulation component';
  } else if (text.match(/air|oxygen|aeration|bubble/i)) {
    info.category = 'Aeration'; info.desc = 'Air supply or oxygenation';
  } else if (text.match(/co2|carbon|gas/i)) {
    info.category = 'Gas System'; info.desc = 'Gas injection or management';
  } else if (text.match(/dose|dosing|chemical|nutrient/i)) {
    info.category = 'Dosing'; info.desc = 'Chemical or nutrient dosing system';
  } else if (text.match(/power|electrical|outlet|battery/i)) {
    info.category = 'Electrical'; info.desc = 'Power and electrical systems';
  } else {
    info.category = 'Component'; info.desc = 'System component';
  }

  if (elementId) info.elementId = elementId;
  return info;
}

export function findBestTooltipTarget(element, svg) {
  // Default to the element itself
  if (!element) return element;

  // If it's text, try to find a nearby node group that's the actual component
  if (element.tagName === 'text' || element.tagName === 'tspan') {
    // 1) Prefer the nearest parent with an explicit id (likely a node)
    let parent = element.parentElement;
    while (parent && parent !== svg) {
      if (parent.getAttribute && parent.getAttribute('id')) return parent;
      parent = parent.parentElement;
    }

    // 2) Prefer the nearest parent that contains a shape (rect/circle/path/ellipse)
    parent = element.parentElement;
    while (parent && parent !== svg) {
      if (parent.querySelector && parent.querySelector('rect,circle,ellipse,path')) return parent;
      parent = parent.parentElement;
    }

    // 3) Fallback: choose the smallest "g" parent with reasonable size (to avoid choosing huge cluster/group parents)
    parent = element.parentElement;
    let best = null;
    while (parent && parent !== svg) {
      if (parent.tagName === 'g') {
        try {
          const rect = parent.getBoundingClientRect();
          if (rect.width > 10 && rect.height > 10) {
            const area = rect.width * rect.height;
            if (!best || area < best.area) best = { parent, area };
          }
        } catch (err) { /* ignore */ }
      }
      parent = parent.parentElement;
    }

    if (best) return best.parent;
  }

  return element;
}

export function addIntelligentTooltip(element, componentInfo, tooltip) {
  if (element.hasAttribute('data-tooltip-enabled')) return;

  // Extra guard: don't attach tooltips to huge container elements accidentally
  try {
    const r = element.getBoundingClientRect();
    if (r.width * r.height > 20000) {
      console.log('⛔ addIntelligentTooltip: skipping large element', componentInfo && componentInfo.name, r.width, r.height);
      return;
    }
  } catch (err) { /* ignore */ }

  element.setAttribute('data-tooltip-enabled', 'true');
  element.style.cursor = 'pointer';

  const createContent = () => {
    if (componentInfo.intelligent) return createIntelligentTooltipContent(componentInfo);
    if (componentInfo.details) return createEnhancedTooltipContent(componentInfo);
    return createTooltipContent(componentInfo);
  };

  const mouseEnter = (e) => {
    // Clear any pending hide timers (stability)
    if (element._tooltipHideTimeout) { clearTimeout(element._tooltipHideTimeout); element._tooltipHideTimeout = null; }

    console.log('tooltip mouseEnter:', element.getAttribute && element.getAttribute('id'), 'text:', getElementText(element), 'client:', e.clientX, e.clientY);

    // Try to use the most specific element under the cursor to avoid mis-attribution when zoomed
    let infoForContent = componentInfo;
    try {
      const elUnder = document.elementFromPoint(e.clientX, e.clientY);
      if (elUnder && elUnder !== element) {
        const altText = getElementText(elUnder);
        const altId = elUnder.getAttribute && elUnder.getAttribute('id') || '';
        const altInfo = extractComponentInfo(altText, altId, elUnder);
        if (altInfo) infoForContent = altInfo;
      }
    } catch (err) { console.warn('elementFromPoint failed:', err); }

    // Build content from the chosen info (do not mutate the original componentInfo)
    let content;
    if (infoForContent.intelligent) content = createIntelligentTooltipContent(infoForContent);
    else if (infoForContent.details) content = createEnhancedTooltipContent(infoForContent);
    else content = createTooltipContent(infoForContent);

    tooltip.innerHTML = content;
    updateTooltipPosition(e, tooltip);

    // If there's no meaningful content, don't show the tooltip
    if (!content || content.trim().length < 5) {
      console.log('tooltip: empty content, skipping display', element.getAttribute && element.getAttribute('id'));
      return;
    }

    // debugging: log content size and tooltip rect so we can see if it's off-screen
    try {
      const rectBefore = tooltip.getBoundingClientRect();
      console.log('tooltip show: content length', content.length, 'rect(before adjust):', rectBefore.left.toFixed(0), rectBefore.top.toFixed(0), rectBefore.width.toFixed(0), rectBefore.height.toFixed(0));
    } catch (err) { /* ignore */ }

    tooltip.style.opacity = '1';
    tooltip.classList.add('visible');

    // debugging: confirm position after showing
    try {
      const rect = tooltip.getBoundingClientRect();
      console.log('tooltip visible at', rect.left.toFixed(0), rect.top.toFixed(0), rect.width.toFixed(0), rect.height.toFixed(0));
    } catch (err) { /* ignore */ }
  };

  const mouseLeave = (e) => {
    // Schedule hide with a short delay to prevent flicker while moving across child elements
    console.log('tooltip mouseLeave (scheduling hide):', element.getAttribute && element.getAttribute('id'));
    if (element._tooltipHideTimeout) clearTimeout(element._tooltipHideTimeout);
    element._tooltipHideTimeout = setTimeout(() => { tooltip.style.opacity = '0'; tooltip.classList.remove('visible'); element._tooltipHideTimeout = null; }, 150);
  };

  const mouseMove = (e) => {
    if (element._tooltipHideTimeout) { clearTimeout(element._tooltipHideTimeout); element._tooltipHideTimeout = null; }
    if (tooltip.classList.contains('visible')) { updateTooltipPosition(e, tooltip); console.log('tooltip mouseMove:', element.getAttribute && element.getAttribute('id'), 'client:', e.clientX, e.clientY); }
  };

  const click = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!componentInfo.intelligent && window.panZoomInstance) {
      focusOnComponent(window.panZoomInstance, componentInfo.id || componentInfo.elementId);
    } else {
      element.style.filter = 'drop-shadow(0 0 8px #00ff88)';
      setTimeout(() => element.style.filter = '', 2000);
    }
  };

  element.addEventListener('mouseenter', mouseEnter);
  element.addEventListener('mouseleave', mouseLeave);
  element.addEventListener('mousemove', mouseMove);
  element.addEventListener('click', click);

  element._tooltipHandlers = { mouseEnter, mouseLeave, mouseMove, click };

  console.log('Attached tooltip handlers on', element.tagName, element.getAttribute && element.getAttribute('id'));
}

export function createIntelligentTooltipContent(componentInfo) {
  let html = `<div class="tooltip-title">🔧 ${componentInfo.name}</div>`;
  if (componentInfo.category) html += `<div class="tooltip-desc">📂 ${componentInfo.category}</div>`;
  if (componentInfo.desc) html += `<div style="color: #b0bec5; font-size: 11px; margin-top: 4px;">${componentInfo.desc}</div>`;
  if (componentInfo.elementId) html += `<div style="color: #81c784; font-size: 10px; margin-top: 4px;">🏷️ ID: ${componentInfo.elementId}</div>`;
  html += `<div style="color: #90caf9; font-size: 10px; margin-top: 6px; font-style: italic;">✨ Intelligent detection</div>`;
  return html;
}

export function createEnhancedTooltipContent(componentData) {
  let html = `<div class="tooltip-title">${componentData.name}</div>`;
  if (componentData.desc) html += `<div class="tooltip-desc">${componentData.desc}</div>`;
  if (componentData.status) html += `<div class="tooltip-status ${componentData.status}">${componentData.status}</div>`;

  if (componentData.details) {
    const details = componentData.details;
    if (details.operatingCost && details.operatingCost.monthly) html += `<div class="tooltip-cost">⚡ ${details.operatingCost.monthly}</div>`;
    if (details.priceRange) html += `<div style="color: #81c784; font-size: 11px; margin-top: 4px;">💰 ${details.priceRange}</div>`;
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
    if (details.notes && details.notes.length <= 100) html += `<div style="color: #f48fb1; font-size: 10px; margin-top: 4px;">💡 ${details.notes}</div>`;
    if (details.suppliers) {
      const shortSuppliers = details.suppliers.length > 50 ? details.suppliers.substring(0, 50) + '...' : details.suppliers;
      html += `<div style="color: #a5d6a7; font-size: 9px; margin-top: 3px;">🛒 ${shortSuppliers}</div>`;
    }
  }

  html += `<div style="color: #90caf9; font-size: 9px; margin-top: 6px; font-style: italic; border-top: 1px solid #444; padding-top: 4px;">💬 Click sidebar for full details</div>`;
  return html;
}

export function createTooltipContent(componentData) {
  let html = `<div class="tooltip-title">${componentData.name}</div>`;
  if (componentData.desc) html += `<div class="tooltip-desc">${componentData.desc}</div>`;
  if (componentData.status) html += `<div class="tooltip-status ${componentData.status}">${componentData.status}</div>`;
  if (componentData.details && componentData.details.operatingCost && componentData.details.operatingCost.monthly) html += `<div class="tooltip-cost">⚡ ${componentData.details.operatingCost.monthly}</div>`;
  if (componentData.details && componentData.details.priceRange) html += `<div style="color: #81c784; font-size: 11px; margin-top: 4px;">💰 ${componentData.details.priceRange}</div>`;
  return html;
}

export function getComponentData(elementId) {
  if (!window.sidebarComponents) { console.warn('⚠️ Sidebar components not yet loaded'); return null; }
  if (window.sidebarComponents[elementId]) return window.sidebarComponents[elementId];

  for (const [componentId, componentData] of Object.entries(window.sidebarComponents)) {
    if (elementId && (elementId.includes(componentId) || componentId.includes(elementId))) return componentData;
    const variations = getComponentVariations(componentId, componentData);
    for (const variation of variations) if (elementId && (elementId.includes(variation) || variation.includes(elementId))) return componentData;
  }

  return null;
}

export function testTooltips() {
  console.log('=== COMPREHENSIVE TOOLTIP DEBUG ===');
  const svg = document.getElementById('mySvgId');
  const tooltip = document.getElementById('component-tooltip');

  console.log('SVG element:', svg ? '✅ Found' : '❌ Not found');
  console.log('Tooltip element:', tooltip ? '✅ Found' : '❌ Not found');

  if (svg) {
    const allElements = svg.querySelectorAll('*[id]');
    console.log(`📊 Total elements with IDs: ${allElements.length}`);
    console.log('🔍 First 30 elements with IDs:');
    allElements.forEach((el, index) => {
      if (index < 30) {
        const rect = el.getBoundingClientRect();
        const text = getElementText(el);
        const skipped = isAreaLabel(text, el) ? ' (skipped area label)' : '';
        console.log(`  ${index}: ${el.tagName}#${el.getAttribute('id')} (${rect.width.toFixed(0)}x${rect.height.toFixed(0)}) - Text: "${text}"${skipped}`);
      }
    });
    const textElements = svg.querySelectorAll('text, tspan');
    console.log(`📝 Text elements: ${textElements.length}`);
    const componentKeys = window.sidebarComponents ? Object.keys(window.sidebarComponents) : [];
    console.log('🎯 Component keys we are looking for:', componentKeys);
    console.log('📄 Available sidebar components:', componentKeys.length);
    const tooltipElements = svg.querySelectorAll('[data-tooltip-enabled="true"]');
    console.log(`✅ Currently tooltip-enabled elements: ${tooltipElements.length}`);

    if (tooltip) {
      tooltip.innerHTML = '<div class="tooltip-title">✅ Test Successful!</div><div class="tooltip-desc">Tooltips are working</div><div class="tooltip-cost">⚡ Manual test</div>';
      tooltip.style.left = '50%'; tooltip.style.top = '50%'; tooltip.style.transform = 'translate(-50%, -50%)'; tooltip.style.opacity = '1'; tooltip.classList.add('visible');
      console.log('testTooltips: displayed manual tooltip');
      setTimeout(() => { tooltip.classList.remove('visible'); tooltip.style.transform = ''; }, 4000);
    }

    // Debug helper: show best N matches for a selected element
    window.debugTooltipMatches = (elementIdOrText, topN = 6) => {
      const candidates = Object.entries(window.sidebarComponents || {}).map(([componentId, componentData]) => {
        const s = (function cScore() {
          // reuse scoring but avoid duplication of logic here by calling extractComponentInfo's score via trying to match
          // we'll use the same local scoring routine by constructing a fake call
          // duplicate minimal scoring for quick debug
          const normalizeId = id => (id||'').toString().toLowerCase().replace(/^flowchart-/, '').replace(/[^a-z0-9\-]+/g, ' ').trim();
          const cNorm = normalizeId(componentId);
          const eNorm = normalizeId(elementIdOrText);
          let score = 0;
          if (eNorm && cNorm && eNorm === cNorm) score += 100;
          const cNum = (componentId.match(/(\d{2,})/)||[])[1];
          const eNum = (elementIdOrText.match(/(\d{2,})/)||[])[1];
          if (cNum && eNum && cNum === eNum) score += 80;
          const cTokens = cNorm.split(/[\s\-_]/).filter(Boolean);
          const eTokens = eNorm.split(/[\s\-_]/).filter(Boolean);
          const tokenMatches = cTokens.filter(t => t.length > 2 && eTokens.includes(t)).length;
          if (tokenMatches === cTokens.length && tokenMatches > 0) score += 90;
          else score += Math.min(30, tokenMatches * 20);
          const regex = new RegExp('(?:^|[\\s\\-_])' + cNorm.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&') + '(?:$|[\\s\\-_])');
          if (eNorm && regex.test(eNorm)) score += 85;
          const name = (componentData.name||'').toLowerCase();
          const words = name.split(/\s|\-|\(|\)/).filter(Boolean);
          const textMatches = words.filter(w => w.length > 3 && elementIdOrText.toLowerCase().includes(w)).length;
          score += Math.min(40, textMatches * 15);
          score -= cTokens.filter(t => t.length <= 2).length * 10;
          return score;
        })();
        return { componentId, score: s, name: componentData.name };
      }).sort((a,b) => b.score - a.score).slice(0, topN);

      console.log('🔎 Best matches for', elementIdOrText, candidates);
      return candidates;
    };
  }

  console.log('🔄 Re-initializing tooltips...');
  initializeTooltips();
}

// Debug utility: enable/disable hover logging for all candidate elements
export function enableHoverLogging(opts = {}) {
  // opts: { onlyComponents: true, excludePrefixes: ['viewport','L_'], minTextLength: 2, event: 'mouseenter' }
  const cfg = Object.assign({ onlyComponents: true, excludePrefixes: ['viewport', 'L_'], minTextLength: 2, event: 'mouseenter' }, opts || {});
  const svg = document.getElementById('mySvgId');
  if (!svg) { console.warn('⚠️ enableHoverLogging: SVG #mySvgId not found'); return; }

  // Prepare a set of component ids and names for quick matching
  const componentKeys = new Set(Object.keys(window.sidebarComponents || {}));
  const componentNames = Object.values(window.sidebarComponents || {}).map(c => (c.name || '').toLowerCase());

  const selector = '*[id], g.node, [class*="node"], [class*="label"]';
  const els = Array.from(svg.querySelectorAll(selector));
  let attached = 0;

  els.forEach(el => {
    // filter by id prefixes
    const id = (el.getAttribute && el.getAttribute('id')) || '';
    const idLower = (id || '').toLowerCase();
    if (cfg.excludePrefixes.some(p => idLower.startsWith(p.toLowerCase()))) return;

    const text = (getElementText(el) || '').trim();
    if (cfg.onlyComponents) {
      // require either a matching component id or name in text
      const idMatches = Array.from(componentKeys).some(k => id && id.includes(k));
      const nameMatches = componentNames.some(n => n && text.toLowerCase().includes(n));
      if (!idMatches && !nameMatches) return;
    } else {
      if (text.length < cfg.minTextLength && !id) return;
    }

    if (el._hoverLogHandler) return;
    const handler = (e) => {
      // Concise single-line log to avoid noise
      console.log('HOVER LOG:', (el.tagName || '').toLowerCase(), id || '(no-id)', text ? `"${text.replace(/\s+/g,' ').slice(0,80)}"` : '(no-text)');
    };
    el.addEventListener(cfg.event, handler);
    el._hoverLogHandler = { handler, event: cfg.event };
    attached++;
  });

  window._hoverLoggingEnabled = true;
  console.log(`✅ Hover logging enabled on ${attached} elements (onlyComponents=${cfg.onlyComponents}, event=${cfg.event}). Call disableHoverLogging() to remove logs.`);
}

export function disableHoverLogging() {
  const svg = document.getElementById('mySvgId');
  if (!svg) { console.warn('⚠️ disableHoverLogging: SVG #mySvgId not found'); return; }
  const selector = '*[id], g.node, [class*="node"], [class*="label"]';
  const els = Array.from(svg.querySelectorAll(selector));
  let removed = 0;
  els.forEach(el => {
    if (el._hoverLogHandler) {
      el.removeEventListener(el._hoverLogHandler.event, el._hoverLogHandler.handler);
      el._hoverLogHandler = null;
      removed++;
    }
  });
  window._hoverLoggingEnabled = false;
  console.log(`🛑 Hover logging disabled, removed handlers from ${removed} elements.`);
}

// Convenience aliases on window for quick testing
window.enableHoverLogging = enableHoverLogging;
window.disableHoverLogging = disableHoverLogging;
