function getElementText(element) {
  if (!element) return '';
  let text = '';
  if (element.textContent) {
    text = element.textContent.trim();
  }
  if (!text) {
    const textNodes = element.querySelectorAll ? element.querySelectorAll('text, tspan') : [];
    if (textNodes && textNodes.length > 0) {
      text = Array.from(textNodes)
        .map((node) => (node.textContent || '').trim())
        .filter((t) => t)
        .join(' ');
    }
  }
  return text;
}

function findBestTooltipTarget(element, svg) {
  if (!element) return element;
  let target = element;
  const tag = element.tagName && element.tagName.toLowerCase ? element.tagName.toLowerCase() : '';
  if (tag === 'text' || tag === 'tspan') {
    let parent = element.parentElement;
    while (parent && parent !== svg) {
      const ptag = parent.tagName && parent.tagName.toLowerCase ? parent.tagName.toLowerCase() : '';
      if (ptag === 'g') {
        const rect = parent.getBoundingClientRect
          ? parent.getBoundingClientRect()
          : { width: 0, height: 0 };
        if (rect.width > 10 && rect.height > 10) {
          target = parent;
          break;
        }
      }
      parent = parent.parentElement;
    }
  }
  return target;
}

module.exports = { getElementText, findBestTooltipTarget };
