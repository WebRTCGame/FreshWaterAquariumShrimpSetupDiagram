import MERMAID_BASE_THEME from './mermaid-theme-vars.js';
import { getMermaid } from './mermaid-provider.js';

export async function drawDiagram() {
  // Obtain mermaid via the provider (prefers preloaded instance or loads CDN if needed)
  const mermaid = await getMermaid();

  // Use centralized base theme from js/mermaid-theme-vars.js
  const effectiveConfig = Object.assign({}, MERMAID_BASE_THEME, { startOnLoad: false, securityLevel: 'loose' });

  // Initialize mermaid with the effective theme config
  mermaid.initialize(effectiveConfig);

  // keep references for reconfiguration
  window._mermaidModule = mermaid;
  window._mermaidConfig = Object.assign({}, effectiveConfig);

  async function renderSvg() {
    const element = document.querySelector('#graphDiv');
    const graphDefinition = (window.GRAPH_DEFINITION || '').trim();
    const { svg } = await mermaid.render('mySvgId', graphDefinition.trim());
    element.innerHTML = svg.replace(/[ ]*max-width:[ 0-9\.]*px;/i, '');

    // Add reusable drop-shadow filters (only once per render), scoped class, and apply to non-container nodes
    (function addDropShadow() {
      const svgEl = document.getElementById('mySvgId');
      if (!svgEl) return;
      const svgNS = 'http://www.w3.org/2000/svg';

      // Add defs & styles once
      if (!svgEl.querySelector('#drop-shadow-filter')) {
        const defs = document.createElementNS(svgNS, 'defs');
        defs.setAttribute('id', 'mermaid-additional-defs');

        // subtle filter
        const filter = document.createElementNS(svgNS, 'filter');
        filter.setAttribute('id', 'drop-shadow-filter');
        filter.setAttribute('x', '-50%');
        filter.setAttribute('y', '-50%');
        filter.setAttribute('width', '200%');
        filter.setAttribute('height', '200%');

        const feGaussianBlur = document.createElementNS(svgNS, 'feGaussianBlur');
        feGaussianBlur.setAttribute('in', 'SourceAlpha');
        feGaussianBlur.setAttribute('stdDeviation', '2');
        feGaussianBlur.setAttribute('result', 'blur');

        const feOffset = document.createElementNS(svgNS, 'feOffset');
        feOffset.setAttribute('dx', '0');
        feOffset.setAttribute('dy', '2');
        feOffset.setAttribute('result', 'off');

        const feMerge = document.createElementNS(svgNS, 'feMerge');
        const feMergeNode1 = document.createElementNS(svgNS, 'feMergeNode');
        feMergeNode1.setAttribute('in', 'off');
        const feMergeNode2 = document.createElementNS(svgNS, 'feMergeNode');
        feMergeNode2.setAttribute('in', 'SourceGraphic');

        feMerge.appendChild(feMergeNode1);
        feMerge.appendChild(feMergeNode2);

        filter.appendChild(feGaussianBlur);
        filter.appendChild(feOffset);
        filter.appendChild(feMerge);

        // stronger filter for hover state
        const filterStrong = document.createElementNS(svgNS, 'filter');
        filterStrong.setAttribute('id', 'drop-shadow-filter-strong');
        filterStrong.setAttribute('x', '-60%');
        filterStrong.setAttribute('y', '-60%');
        filterStrong.setAttribute('width', '220%');
        filterStrong.setAttribute('height', '220%');

        const feGaussianBlur2 = document.createElementNS(svgNS, 'feGaussianBlur');
        feGaussianBlur2.setAttribute('in', 'SourceAlpha');
        feGaussianBlur2.setAttribute('stdDeviation', '4');
        feGaussianBlur2.setAttribute('result', 'blur2');

        const feOffset2 = document.createElementNS(svgNS, 'feOffset');
        feOffset2.setAttribute('dx', '0');
        feOffset2.setAttribute('dy', '3');
        feOffset2.setAttribute('result', 'off2');

        const feMerge2 = document.createElementNS(svgNS, 'feMerge');
        const feMerge2Node1 = document.createElementNS(svgNS, 'feMergeNode');
        feMerge2Node1.setAttribute('in', 'off2');
        const feMerge2Node2 = document.createElementNS(svgNS, 'feMergeNode');
        feMerge2Node2.setAttribute('in', 'SourceGraphic');

        feMerge2.appendChild(feMerge2Node1);
        feMerge2.appendChild(feMerge2Node2);

        filterStrong.appendChild(feGaussianBlur2);
        filterStrong.appendChild(feOffset2);
        filterStrong.appendChild(feMerge2);

        defs.appendChild(filter);
        defs.appendChild(filterStrong);

        // Small scoped style - use class-based application so we can be selective
        const style = document.createElementNS(svgNS, 'style');
        style.textContent = `
          /* Use a class so we can target only specific node shapes */
          .drop-shadow-target { filter: url(#drop-shadow-filter); }
          .drop-shadow-target:hover { filter: url(#drop-shadow-filter-strong); }

          /* Combined: apply CSS drop-shadow() in addition to SVG filter for visual comparison */
          .drop-shadow-target.combined { filter: url(#drop-shadow-filter) drop-shadow(0 2px 4px rgba(0,0,0,0.35)); }
          .drop-shadow-target.combined:hover { filter: url(#drop-shadow-filter-strong) drop-shadow(0 4px 8px rgba(0, 255, 17, 0.45)); }

          /* Explicitly prevent text + foreignObject HTML labels from being filtered */
          text, tspan, textPath, .node text, .node tspan { filter: none !important; }
          .drop-shadow-target text, .drop-shadow-target tspan { filter: none !important; }
          foreignObject, foreignObject * { filter: none !important; }
          .drop-shadow-target foreignObject, .drop-shadow-target foreignObject * { filter: none !important; }

          @media (prefers-reduced-motion: reduce) { .drop-shadow-target, .drop-shadow-target.combined { transition: none; } }
        `;
        defs.appendChild(style);

        svgEl.insertBefore(defs, svgEl.firstChild);
      }

      // Apply class to all SVG elements (except defs/style/meta) so every rendered shape gets the drop shadow
      try {
        const allElems = svgEl.querySelectorAll('*');
        // Don't add classes to container groups directly; target individual shapes instead.
        const excludeTags = new Set(['defs','style','title','desc','metadata','script','lineargradient','radialgradient','marker','clippath','mask','pattern','filter','text','tspan','g','foreignobject']);
        allElems.forEach(el => {
          const tag = (el.tagName || '').toLowerCase();
          if (!tag || excludeTags.has(tag)) return;
          if (el === svgEl) return;

          // Skip elements that live inside <defs> or inside a <foreignObject> explicitly
          if (el.closest && (el.closest('defs') || el.closest('foreignObject') || el.closest('foreignobject'))) return;

          try {
            el.classList.add('drop-shadow-target','combined');
          } catch (err) {
            // ignore addClass errors for non-element nodes
          }
        });

        // Ensure no shadows are applied to foreignObject contents (clean up from previous renders)
        try {
          const foEls = svgEl.querySelectorAll('foreignObject, foreignobject');
          foEls.forEach(fo => {
            try { fo.classList.remove('drop-shadow-target','combined'); } catch (_) {}
            try {
              const inner = fo.querySelectorAll('*');
              inner.forEach(ch => {
                try { ch.classList.remove('drop-shadow-target','combined'); } catch (_) {}
              });
            } catch (_) {}
          });
        } catch (e3) { /* ignore */ }

        // Ensure text nodes do NOT have shadow classes and remove shadow classes from any ancestor groups
        try {
          const textEls = svgEl.querySelectorAll('text, tspan, textPath');
          textEls.forEach(te => {
            try { te.classList.remove('drop-shadow-target','combined'); } catch (_) {}
            // Walk up parents and remove classes from groups/containers so the text won't be affected by ancestor filters
            let parent = te.parentElement;
            while (parent && parent !== svgEl) {
              try { parent.classList.remove('drop-shadow-target','combined'); } catch (_) {}
              parent = parent.parentElement;
            }
          });
        } catch (e2) { /* ignore */ }

      } catch (e) {
        console.warn('drop-shadow: failed to apply to all elements', e);
      }

      // Apply drop shadow to connection paths (edges) as well so links have the shadow
      try {
        const edgePaths = svgEl.querySelectorAll('g.edgePath path, g.edge path, path.edge');
        edgePaths.forEach(p => {
          // Avoid adding to tiny decorative paths (optional heuristics can be added later)
          p.classList.add('drop-shadow-target','combined');
        });
      } catch (e2) {
        console.warn('drop-shadow: failed to apply to edge paths', e2);
      }
    })();

    // initialize pan/zoom (destroy previous if exists)
    try { if (window.panZoomInstance) window.panZoomInstance.destroy(); } catch (err) {}

    const panZoomTiger = svgPanZoom('#mySvgId', {
      zoomEnabled: true,
      controlIconsEnabled: true,
      fit: true,
      center: true
    });

    // Store panZoom instance globally for tooltip functionality
    window.panZoomInstance = panZoomTiger;
    return panZoomTiger;
  }

  // initial render
  await renderSvg();

  // Note: theme is driven by the hard-coded `defaultConfig` above — no localStorage or external persistence used.

  // expose helper to apply new theme/config and re-render
  window.applyMermaidConfig = async (newConfig = {}) => {
    const mer = window._mermaidModule;
    if (!mer) return console.warn('Mermaid module not loaded');
    window._mermaidConfig = Object.assign({}, window._mermaidConfig, newConfig);
    mer.initialize(window._mermaidConfig);
    await renderSvg();
    // rebuild tooltips after re-render
    setTimeout(() => { if (window.rebuildTooltips) window.rebuildTooltips(); }, 300);
    return true;
  };

  // Convenience: reapply the in-file base theme defined in js/mermaid-theme-vars.js
  window.applyBaseTheme = async () => {
    try {
      // MERMAID_BASE_THEME is imported at module scope and available
      await window.applyMermaidConfig ? window.applyMermaidConfig(MERMAID_BASE_THEME) : (async () => { mermaid.initialize(MERMAID_BASE_THEME); await renderSvg(); })();
      return true;
    } catch (err) { console.warn('applyBaseTheme failed', err); return false; }
  };

  // Apply the in-file base theme once after initial render to ensure themeVariables are enforced
  // (guarded to avoid reapplying on subsequent calls)
  (async () => {
    try {
      if (!window._baseThemeApplied) {
        console.log('🔧 Applying in-file MERMAID_BASE_THEME after initial render');
        if (window.applyBaseTheme) await window.applyBaseTheme();
        window._baseThemeApplied = true;
      }
    } catch (err) { console.warn('Failed to apply base theme after render', err); }
  })();

  return window.panZoomInstance;
}