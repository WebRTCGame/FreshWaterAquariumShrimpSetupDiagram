function scanSvgForTooltipCandidates(svg) {
  if (!svg || typeof svg.querySelectorAll !== 'function') return [];

  const idElements = svg.querySelectorAll('*[id]');
  const textElements = svg.querySelectorAll('text, tspan');
  return Array.from(new Set([...Array.from(idElements), ...Array.from(textElements)]));
}

function getCandidatesWithCache(svg) {
  if (!svg || typeof svg.querySelectorAll !== 'function') return [];
  if (
    svg._tooltipCandidates &&
    Array.isArray(svg._tooltipCandidates) &&
    svg._tooltipCandidates.length > 0
  ) {
    return svg._tooltipCandidates;
  }
  const candidates = scanSvgForTooltipCandidates(svg);
  svg._tooltipCandidates = candidates;
  return candidates;
}

module.exports = { scanSvgForTooltipCandidates, getCandidatesWithCache };
