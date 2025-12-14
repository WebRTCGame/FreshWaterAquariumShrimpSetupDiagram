const { getCandidatesWithCache } = require('./intelligent-tooltip-scanner');
const { getElementText, findBestTooltipTarget } = require('./tooltip-utils');

function cleanupTooltipElements(svg) {
  if (!svg || typeof svg.querySelectorAll !== 'function') return;
  const oldElements = svg.querySelectorAll('[data-tooltip-enabled="true"]');
  oldElements.forEach((el) => {
    if (el._tooltipHandlers) {
      const h = el._tooltipHandlers;
      if (h.mouseEnter) el.removeEventListener('mouseenter', h.mouseEnter);
      if (h.mouseLeave) el.removeEventListener('mouseleave', h.mouseLeave);
      if (h.mouseMove) el.removeEventListener('mousemove', h.mouseMove);
      if (h.click) el.removeEventListener('click', h.click);
      if (h.focus) el.removeEventListener('focus', h.focus);
      if (h.blur) el.removeEventListener('blur', h.blur);
      if (h.keydown) el.removeEventListener('keydown', h.keydown);
      if (h.touchStart) el.removeEventListener('touchstart', h.touchStart);
      if (h.touchEnd) el.removeEventListener('touchend', h.touchEnd);
      if (h.touchMove) el.removeEventListener('touchmove', h.touchMove);
      delete el._tooltipHandlers;
    }
    el.removeAttribute('data-tooltip-enabled');
    el.removeAttribute('aria-describedby');
    if (el.getAttribute && el.getAttribute('data-tooltip-tabindex') === 'true') {
      el.tabIndex = -1;
      el.removeAttribute('data-tooltip-tabindex');
    }
  });
}

function attachIntelligentTooltips(svg, tooltip, attachFn) {
  if (!svg || !tooltip) return 0;
  const candidates = getCandidatesWithCache(svg);
  let count = 0;
  const processed = new Set();
  candidates.forEach((element) => {
    if (processed.has(element)) return;
    const elementText = getElementText(element);
    const elementId = (element.getAttribute && element.getAttribute('id')) || '';
    if (elementText || elementId) {
      // For tests, attachFn will decide whether to attach
      const target = findBestTooltipTarget(element, svg);
      if (target && !processed.has(target)) {
        if (typeof attachFn === 'function') {
          attachFn(target, { name: elementText || elementId });
        }
        processed.add(target);
        processed.add(element);
        count++;
      }
    }
  });
  return count;
}

module.exports = { cleanupTooltipElements, attachIntelligentTooltips };
