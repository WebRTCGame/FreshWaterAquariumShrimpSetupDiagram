// js/mermaid-provider.js
// Provides a single entry point for obtaining the mermaid module.
// Prefer the preloaded instance on window._externalMermaid (from index.html),
// otherwise lazily load from the CDN (and cache the promise on window).

export async function getMermaid() {
  // Fast path: already preloaded by index.html
  if (window._externalMermaid) return window._externalMermaid;

  // If a load is already in-flight, return the same promise
  if (window._mermaidLoading) return window._mermaidLoading;

  // Lazily import from CDN and cache the promise on the window object
  window._mermaidLoading = (async () => {
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/mermaid@11.12.2/+esm');
      const mer = mod.default || mod;
      // Cache the loaded module for other code to reuse
      window._externalMermaid = mer;
      return mer;
    } catch (err) {
      console.error('Failed to load mermaid from CDN', err);
      throw err;
    } finally {
      // clear the in-flight marker if it failed (so retrying is possible)
      if (!window._externalMermaid) window._mermaidLoading = null;
    }
  })();

  return window._mermaidLoading;
}

// Convenience: expose getter on window for ad-hoc usage in console/debug
window.getMermaid = getMermaid;