// P&IDGenerator ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â standalone P&ID generator (no mermaid dependency).
// DSL text -> semantic model -> validated, orthogonal SVG.
// Glyphs from window.PID_SYMBOLS (bundled from pid-svg-library by build-data.ps1).

const PID_PARSER = {
  parse: (text) => {
    const data = { equipment: [], valves: [], instruments: [], junctions: [], pipes: [], lineDefs: {}, view: { show: 'all', hideLabels: false, stubLength: 8, layout: 'manual', fitPage: false, legend: false, northArrow: false, grid: 5, chips: false, route: 'avoid', symbolScale: 1, sheetW: 864, sheetH: 559 }, warnings: [], errors: [], info: [], schemaVersion: 1, _seq: 0 };
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('%%')) continue;
      let m;

      if (line === 'pid' || line === 'pidDiagram') continue;

      if ((m = line.match(/^show\s+(all|equipment|valves|instruments)$/))) { data.view.show = m[1]; continue; }
      if ((m = line.match(/^(hide|show)\s+labels$/))) { data.view.hideLabels = m[1] === 'hide'; continue; }
      if ((m = line.match(/^stub\s+([\d.]+)$/))) { data.view.stubLength = parseFloat(m[1]); continue; }
      if ((m = line.match(/^grid\s+([\d.]+)$/))) { data.view.grid = parseFloat(m[1]); continue; }
      if ((m = line.match(/^scale\s+([\d.]+)$/))) { data.view.symbolScale = parseFloat(m[1]); continue; }
      if ((m = line.match(/^chips\s+(on|off)$/))) { data.view.chips = m[1] === 'on'; continue; }
      if ((m = line.match(/^route\s+(avoid|direct)$/))) { data.view.route = m[1]; continue; }
      if ((m = line.match(/^fit\s+page$/))) { data.view.fitPage = true; continue; }
      if ((m = line.match(/^layout\s+(auto|manual)$/))) { data.view.layout = m[1]; continue; }
      if ((m = line.match(/^title\s+"([^"]+)"/))) { data.view.title = m[1]; continue; }
      if ((m = line.match(/^project\s+"([^"]+)"/))) { data.view.project = m[1]; continue; }
      if ((m = line.match(/^sheet\s+(\d+)(?:\s+of\s+(\d+))?$/))) { data.view.sheet = m[1]; data.view.sheetTotal = m[2] || m[1]; continue; }
      if ((m = line.match(/^rev\s+"([^"]+)"\s+"([^"]+)"(?:\s+"([^"]*)")?$/))) { data.view.rev = { mark: m[1], date: m[2], desc: m[3] || '' }; continue; }
      if ((m = line.match(/^(?:legend|north-arrow)\s+(on|off)$/))) { data.view[m[1] === 'legend' ? 'legend' : 'northArrow'] = m[2] === 'on'; continue; }

      if ((m = line.match(/^line\s+([A-Za-z0-9_\-]+)(.*)$/))) {
        const def = {};
        let rem = m[2].trim();
        while (rem) {
          rem = rem.trim();
          const f = rem.match(/^(size|service|number|spec|ins|thick|trace)\s+(\S+)/);
          if (!f) throw new Error(`pid parser: bad line spec field in "${line}"`);
          def[f[1]] = f[2];
          rem = rem.slice(f[0].length);
        }
        data.lineDefs[m[1]] = def;
        continue;
      }

      if ((m = line.match(/^version\s+(\d+)$/))) {
        data.schemaVersion = parseInt(m[1], 10);
        continue;
      }

      if ((m = line.match(/^(equipment|valve)\s+([A-Za-z0-9_\-]+)\s+([a-z_\-]+)(.*)$/))) {
        const e = { id: m[2], type: m[3], _seq: data._seq++ };
        parseModifiers(m[4], e);
        (m[1] === 'equipment' ? data.equipment : data.valves).push(e);
        continue;
      }

      if ((m = line.match(/^instrument\s+([A-Za-z0-9_\-]+)(.*)$/))) {
        const inst = { tag: m[1] };
        parseModifiers(m[2], inst);
        validateTag(m[1], data.warnings);
        data.instruments.push(inst);
        continue;
      }

      if ((m = line.match(/^junction\s+([A-Za-z0-9_\-]+)(?:\s+at\s+(-?[\d.]+)\s*,\s*(-?[\d.]+))?$/))) {
        data.junctions.push({ id: m[1], x: m[2] ? parseFloat(m[2]) : null, y: m[3] ? parseFloat(m[3]) : null });
        continue;
      }

      if ((m = line.match(/^stub\s+([A-Za-z0-9_\-]+)(?:\s+at\s+(-?[\d.]+)\s*,\s*(-?[\d.]+))?$/))) {
        data.junctions.push({ id: m[1], x: m[2] ? parseFloat(m[2]) : null, y: m[3] ? parseFloat(m[3]) : null, stub: true });
        continue;
      }

      if ((m = line.match(/^signal\s+([A-Za-z0-9_\-]+)(?:\.(\w+))?\s*->\s*([A-Za-z0-9_\-]+)(?:\.(\w+))?\s*(\w+)$/))) {
        data.pipes.push({ from: m[1], fromPort: m[2] || null, to: m[3], toPort: m[4] || null, kind: 'signal', signalType: m[5] });
        continue;
      }

      // explicit process tap: instrument taps the line running to the named entity
      if ((m = line.match(/^tap\s+([A-Za-z0-9_\-]+)\s*->\s*([A-Za-z0-9_\-]+)(.*)$/))) {
        const p = { from: m[1], to: m[2], kind: 'tap' };
        parseModifiers(m[3], p);
        data.pipes.push(p);
        continue;
      }

      if ((m = line.match(/^([A-Za-z0-9_\-]+)(?:\.(\w+))?\s*->\s*([A-Za-z0-9_\-]+)(?:\.(\w+))?(.*)$/))) {
        const p = { from: m[1], fromPort: m[2] || null, to: m[3], toPort: m[4] || null, kind: 'process' };
        parseModifiers(m[5], p);
        data.pipes.push(p);
        continue;
      }

      throw new Error(`pid parser: unrecognized line "${line}"`);
    }

    // resolve relative placement + auto-layout
    const all = [...data.equipment, ...data.valves].sort((a, b) => a._seq - b._seq);
    const resolve = (e) => {
      if (e.at) { e.x = e.at.x; e.y = e.at.y; e._fixed = true; return; }
      if (e.rel) {
        const ref = all.find(o => o.id === e.rel.ref) || data.instruments.find(o => o.tag === e.rel.ref);
        if (!ref) { e.x = 90; e.y = 220; return; }
        const p = placeRelative(e, ref, 70, data.view.sheetW || 864, data.view.sheetH || 559);
        e.x = p.x; e.y = p.y;
        return;
      }
      e.x = 90; e.y = 220;
    };
    for (let pass = 0; pass < 2; pass++) for (const e of all) resolve(e);
    for (const inst of data.instruments) {
      if (inst.at) { inst.x = inst.at.x; inst.y = inst.at.y; inst._fixed = true; }
      else if (inst.rel) {
        const ref = all.find(o => o.id === inst.rel.ref);
        if (ref) { const p = placeRelative(inst, ref, 70, data.view.sheetW || 864, data.view.sheetH || 559); inst.x = p.x; inst.y = p.y; }
        else { inst.x = 150; inst.y = 110; }
      } else { inst.x = 150; inst.y = 110; }
    }
    for (const j of data.junctions) {
      if (j.x === null) { j.x = 100; j.y = 100; }
    }

    if (data.view.layout === 'auto') autoLayout(data);
    // sheet clamp: nothing may sit outside the drawn border (runs after autoLayout,
    // which re-resolves relative placements)
    const SH = data.view.sheetH || 559, SW = data.view.sheetW || 864;
    for (const e of [...data.equipment, ...data.valves, ...data.junctions]) {
      e.y = Math.max(40, Math.min(SH - 60, e.y));
      e.x = Math.max(40, Math.min(SW - 60, e.x));
    }
    for (const i of data.instruments) {
      i.y = Math.max(32, Math.min(SH - 45, i.y));
      i.x = Math.max(32, Math.min(SW - 45, i.x));
    }
    resolveOverlaps(data);
    // grid-align all entity centers (Rule 71/72: explicit snapping); fixed `at` is honored exactly
    const grid = data.view.grid || 20;
    for (const e of [...data.equipment, ...data.valves, ...data.instruments, ...data.junctions]) {
      if (e._fixed) continue;
      e.x = Math.round(e.x / grid) * grid;
      e.y = Math.round(e.y / grid) * grid;
    }

    // pipes referencing line specs get their formatted label
    for (const p of data.pipes) {
      if (p.line && data.lineDefs[p.line]) {
        const d = data.lineDefs[p.line];
        p.label = `${d.size || ''}${d.size ? '"' : ''}-${d.service || ''}-${d.number || ''}-${d.spec || ''}-${d.ins || ''}-${d.ins ? 'INS-' : ''}${d.thick || ''}-${d.trace || ''}`.replace(/-+/g, '-').replace(/^-|-$/g, '');
      }
    }

    validateModel(data);
    resolveTopology(data); // authoritative: assign ports, enforce cardinality, build junction/tap graph
    return data;
  }
};

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ modifiers ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
// relative placement that stays inside the sheet: if the requested side runs off an
// edge, flip to the opposite side of the reference
function placeRelative(e, ref, step, SW, SH) {
  const MX = 40, MY = 40;
  const place = (dir) => {
    if (dir === 'right') return { x: ref.x + step + e.rel.dx, y: ref.y + e.rel.dy };
    if (dir === 'left') return { x: ref.x - step + e.rel.dx, y: ref.y + e.rel.dy };
    if (dir === 'above') return { x: ref.x + e.rel.dx, y: ref.y - step + e.rel.dy };
    return { x: ref.x + e.rel.dx, y: ref.y + step + e.rel.dy };
  };
  let p = place(e.rel.dir);
  if (p.y < MY && e.rel.dir === 'above') { const f = place('below'); p = f.y >= MY ? f : { ...p, y: MY }; }
  if (p.y > SH - MY && e.rel.dir === 'below') { const f = place('above'); p = f.y <= SH - MY ? f : { ...p, y: SH - MY }; }
  if (p.x < MX && e.rel.dir === 'left') { const f = place('right'); p = f.x >= MX ? f : { ...p, x: MX }; }
  if (p.x > SW - MX && e.rel.dir === 'right') { const f = place('left'); p = f.x <= SW - MX ? f : { ...p, x: SW - MX }; }
  return p;
}

function parseModifiers(rem, target) {
  while (rem && rem.trim()) {
    rem = rem.trim();
    let m;
    if ((m = rem.match(/^at\s+(-?[\d.]+)\s*,\s*(-?[\d.]+)/))) { target.at = { x: parseFloat(m[1]), y: parseFloat(m[2]) }; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^(right|left|above|below)\s+(?:of\s+)?([A-Za-z0-9_\-]+)(?:\s+offset\s+(-?[\d.]+)\s*,\s*(-?[\d.]+))?/))) {
      target.rel = { dir: m[1], ref: m[2], dx: m[3] ? parseFloat(m[3]) : 0, dy: m[4] ? parseFloat(m[4]) : 0 };
      rem = rem.slice(m[0].length);
    }
    else if ((m = rem.match(/^rotated\s+([\d.]+)/))) { target.rotation = parseFloat(m[1]); rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^symbol\s+"([^"]+)"/))) { target.symbol = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^scale\s+([\d.]+)/))) { target.scale = parseFloat(m[1]); rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^stroke\s+"([^"]+)"/))) { target.stroke = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^tag\s+"([^"]+)"/))) { target.tag = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^tag-above/))) { target.tagAbove = true; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^no-type-label/))) { target.noTypeLabel = true; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^bubble\s+(field|panel|dcs|computer|plc)/))) { target.bubble = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^(field|panel|dcs|computer|plc)\b/))) { target.bubble = m[1]; rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^via\s+(-?[\d.]+)\s*,\s*(-?[\d.]+)/))) { (target.via = target.via || []).push({ x: parseFloat(m[1]), y: parseFloat(m[2]) }); rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^"((?:[^"\\]|\\.)*)"/))) { target.label = m[1].replace(/\\"/g, '"'); rem = rem.slice(m[0].length); }
    else if ((m = rem.match(/^line\s+([A-Za-z0-9_\-]+)/))) { target.line = m[1]; rem = rem.slice(m[0].length); }
    else throw new Error(`pid parser: unrecognized modifier "${rem.split(/\s/)[0]}" in "${rem}"`);
  }
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ ISA-5.1 tag semantics ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
const ISA_VARIABLES = { P: 'pressure', T: 'temperature', F: 'flow', L: 'level', A: 'analysis', D: 'density', G: 'gauge', V: 'vibration', S: 'speed', W: 'weight', Q: 'quantity', Z: 'position', U: 'multivariable', X: 'unclassified', Y: 'event/state' };
const ISA_FUNCTIONS = { I: 'indicator', C: 'controller', T: 'transmitter', A: 'alarm', R: 'recorder', S: 'switch', G: 'gauge', E: 'element', V: 'valve', Y: 'relay/compute', H: 'high', L: 'low', Z: 'position', U: 'multivariable', K: 'time/rate' };
const ISA_MODIFIERS = { D: 'differential', R: 'ratio', Q: 'sum' };

function validateTag(tag, warnings) {
  const m = tag.match(/^([A-Za-z])([A-Za-z])([A-Za-z]{0,2})(?:[- ]?(\d+.*))?$/);
  if (!m) { warnings.push(`tag "${tag}": not a valid ISA tag (expects VARIABLE-FUNCTION-LOOP)`); return; }
  let variable = m[1].toUpperCase();
  let functions = m[2].toUpperCase() + (m[3] || '').toUpperCase();
  if (ISA_MODIFIERS[m[2].toUpperCase()]) { variable += m[2].toUpperCase(); functions = (m[3] || '').toUpperCase(); }
  for (const ch of variable) if (!ISA_VARIABLES[ch]) warnings.push(`tag "${tag}": unknown measured variable "${ch}"`);
  for (const ch of functions) if (!ISA_FUNCTIONS[ch]) warnings.push(`tag "${tag}": unknown function letter "${ch}"`);
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ auto layout: flow-based placement by connection order ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
function autoLayout(data) {
  const { equipment, valves, instruments, junctions, pipes } = data;

  const all = [...equipment, ...valves].sort((a, b) => a._seq - b._seq);
  const byId = {};
  for (const e of all) byId[e.id] = e;

  const processPipes = pipes.filter(p => p.kind !== 'signal');
  const outgoing = {}, incoming = {};
  for (const e of all) { outgoing[e.id] = []; incoming[e.id] = []; }
  for (const p of processPipes) {
    if (byId[p.from] && byId[p.to]) {
      outgoing[p.from].push(p.to);
      incoming[p.to].push(p.from);
    }
  }

  // BFS depth from sources (leftmost = no incoming connections)
  const depth = {};
  const sources = all.filter(e => incoming[e.id].length === 0);
  for (const s of sources) depth[s.id] = 0;
  let queue = sources.map(s => s.id);
  while (queue.length) {
    const next = [];
    for (const id of queue) {
      for (const t of outgoing[id]) {
        if (depth[t] === undefined) { depth[t] = depth[id] + 1; next.push(t); }
      }
    }
    queue = next;
  }
  // leftovers (loops): stack after the deepest column
  let maxD = Object.values(depth).reduce((a, b) => Math.max(a, b), 0);
  for (const e of all) if (depth[e.id] === undefined) depth[e.id] = ++maxD;

  // column x, stacked rows y; explicit `at`/relative placement always wins.
  // entities fed from bottom-ish ports (bottoms/drains) sort into lower rows.
  // the flow snakes: rows of columns, alternating direction, to fit the sheet
  const COL = 140, ROW = 150, MARGIN = 60;
  const colsPerRow = Math.max(2, Math.floor(((data.view.sheetW || 864) - 2 * MARGIN) / COL));
  const isBottomPort = (p, end) => {
    // the bottom-ish port is on the OTHER endpoint (e.g. C-101.bottoms -> E-101)
    const port = end === p.to ? p.fromPort : p.toPort;
    if (port && /bottoms|bottom|drain|outlet/i.test(port)) return true;
    return false;
  };
  const column = {};
  for (const e of all) (column[depth[e.id]] = column[depth[e.id]] || []).push(e);
  for (const dcol of Object.keys(column)) {
    const members = column[dcol];
    members.sort((a, b) => {
      const aBelow = processPipes.some(p => p.to === a.id && isBottomPort(p, a.id)) ? 1 : 0;
      const bBelow = processPipes.some(p => p.to === b.id && isBottomPort(p, b.id)) ? 1 : 0;
      return aBelow - bBelow || a._seq - b._seq;
    });
    members.forEach((e, i) => {
      if (e.at || e.rel) return;
      const d = Number(dcol);
      const row = Math.floor(d / colsPerRow);
      const colInRow = d % colsPerRow;
      const colX = row % 2 === 0 ? colInRow : (colsPerRow - 1 - colInRow);
      e.x = MARGIN + colX * COL;
      e.y = MARGIN + row * ROW + i * (ROW * 0.55);
    });
  }

  // rule: a valve directly downstream of equipment sits close to it (spacing no less
  // than the valve width) at the equipment port's elevation, so the process line
  // runs straight instead of jogging
  const valveHalf = symbolSize('isa-5.1/valves/gate') * (data.view.symbolScale || 1) / 2 || 6;
  for (const v of valves) {
    if (v.at || v.rel) continue;
    const pipe = processPipes.find(p => p.from === v.id || p.to === v.id);
    if (!pipe) continue;
    const eqId = pipe.from === v.id ? pipe.to : pipe.from;
    const eq = byId[eqId];
    if (!eq || valves.some(x => x.id === eqId)) continue; // partner must be equipment
    const portName = pipe.from === v.id ? pipe.toPort : pipe.fromPort;
    const conns = symbolConnections(eq.symbol || SYMBOL_KEYS[eq.type]);
    const conn = (portName && conns.find(c => c.id === portName)) || conns[0];
    if (!conn) continue;
    const size = (eq.symbol ? symbolSize(eq.symbol) : symbolSize(SYMBOL_KEYS[eq.type] || 'pip/equipment/vessel-vertical')) * (eq.scale || 1) * (data.view.symbolScale || 1);
    const sx = ((conn.x - 50) / 100) * size, sy = ((conn.y - 50) / 100) * size;
    let rx = sx, ry = sy, pdx = conn.x - 50, pdy = conn.y - 50;
    if (eq.rotation) {
      const r = (eq.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
      rx = sx * cos - sy * sin; ry = sx * sin + sy * cos;
      const qx = pdx, qy = pdy;
      pdx = qx * cos - qy * sin; pdy = qx * sin + qy * cos;
    }
    const port = { x: eq.x + rx, y: eq.y + ry };
    const dir = Math.abs(pdx) >= Math.abs(pdy) ? { x: Math.sign(pdx), y: 0 } : { x: 0, y: Math.sign(pdy) };
    const gap = 14; // >= valve width of clearance
    v.x = port.x + dir.x * (gap + valveHalf);
    v.y = port.y + dir.y * (gap + valveHalf);
  }

  // instruments: above their host entity (dcs/panel higher than field), or
  // stacked with an instrument partner (field below its dcs controller).
  // slot-aware: multiple instruments sharing a host spread horizontally.
  const usedSlots = [];
  const SC0 = data.view.symbolScale || 1;
  const avoidHalf = (e) => {
    if (instruments.some(i => i.tag === (e.tag || e.id))) return symbolSize('isa-5.1/instruments/field-instrument') * SC0 / 2;
    return (e.symbol ? symbolSize(e.symbol) : symbolSize(SYMBOL_KEYS[e.type] || 'pip/equipment/vessel-vertical')) * (e.scale || 1) * SC0 / 2;
  };
  const avoidBoxes = [...equipment, ...valves].map(e => ({ e, h: avoidHalf(e) + 8 }));
  const freeSlot = (x, y) => {
    const taken = (sx, sy) =>
      usedSlots.some(s => Math.abs(s.x - sx) < 45 && Math.abs(s.y - sy) < 45) ||
      avoidBoxes.some(b => Math.abs(b.e.x - sx) < b.h && Math.abs(b.e.y - sy) < b.h);
    for (const dy of [0, -20, 20, -40, 40]) {
      for (const dx of [0, 18, -18, 36, -36, 54]) {
        if (!taken(x + dx, y + dy)) { usedSlots.push({ x: x + dx, y: y + dy }); return { x: x + dx, y: y + dy }; }
      }
    }
    return { x, y };
  };
  for (const inst of instruments) {
    if (inst.at || inst.rel) continue;

    // prefer the PROCESS/tap partner (equipment, valve, junction) over a signal
    // partner — an instrument must sit near its host, not its fellow bubble
    const pipe = pipes.find(p => (p.from === inst.tag || p.to === inst.tag) && byId[p.from === inst.tag ? p.to : p.from] && !instruments.some(i => i.tag === (p.from === inst.tag ? p.to : p.from)))
      || pipes.find(p => (p.from === inst.tag || p.to === inst.tag) && byId[p.from === inst.tag ? p.to : p.from]);
    const partnerId = pipe ? (pipe.from === inst.tag ? pipe.to : pipe.from) : null;
    const partner = partnerId ? byId[partnerId] : null;
    if (partner) {
      const SCi = data.view.symbolScale || 0.55;
      const SHEET_H = data.view.sheetH || 559;
      const dcs = inst.bubble && inst.bubble !== 'field';
      // instruments sit above the host, but must stay inside the sheet: if the
      // host is too close to the top edge, place the instrument below instead
      let yy = partner.y - (dcs ? 200 : 110) * SCi;
      if (yy < 32) yy = partner.y + (dcs ? 95 : 60) * SCi;
      if (yy > SHEET_H - 40) yy = partner.y - (dcs ? 200 : 110) * SCi;
      const slot = freeSlot(partner.x, yy);
      inst.x = slot.x;
      inst.y = slot.y;

    }
  }
  for (const inst of instruments) {
    if (inst.at || inst.rel || inst.x !== 150 || inst.y !== 110) continue;
    const pipe = pipes.find(p => (p.from === inst.tag || p.to === inst.tag) && !byId[p.from === inst.tag ? p.to : p.from]);
    const partnerId = pipe ? (pipe.from === inst.tag ? pipe.to : pipe.from) : null;
    const partnerInst = partnerId ? instruments.find(i => i.tag === partnerId) : null;
    if (partnerInst && (partnerInst.x !== 150 || partnerInst.y !== 110)) {
      const gap = 20;
      let fy = partnerInst.y, cy = fy - gap;
      if (cy < 32) { const shift = 32 - cy; fy += shift; cy += shift; }
      inst.x = partnerInst.x;
      inst.y = cy;
      partnerInst.y = fy;
    }
  }
  // final fallback: above the first horizontal process pipe
  for (const inst of instruments) {
    if (inst.at || inst.rel || inst.x !== 150 || inst.y !== 110) continue;
    const fp = processPipes.find(p => byId[p.from] && byId[p.to] && byId[p.from].y === byId[p.to].y);
    if (fp) { inst.x = (byId[fp.from].x + byId[fp.to].x) / 2; inst.y = byId[fp.from].y - 110; }
  }

  // junctions: offset from their connected entity
  for (const j of junctions) {
    const conn = processPipes.find(p => p.from === j.id || p.to === j.id);
    const other = conn && byId[conn.from === j.id ? conn.to : conn.from];
    if (other) { j.x = other.x + 20; j.y = other.y + 25; }
  }

  // re-resolve relative placements against auto-assigned coordinates (sheet-aware)
  for (let pass = 0; pass < 2; pass++) {
    for (const e of all) {
      if (!e.rel) continue;
      const ref = all.find(o => o.id === e.rel.ref) || instruments.find(o => o.tag === e.rel.ref);
      if (!ref) continue;
      const p = placeRelative(e, ref, 70, data.view.sheetW || 864, data.view.sheetH || 559);
      e.x = p.x; e.y = p.y;
    }
    for (const inst of instruments) {
      if (!inst.rel) continue;
      const ref = all.find(o => o.id === inst.rel.ref);
      if (ref) {
        const p = placeRelative(inst, ref, 70, data.view.sheetW || 864, data.view.sheetH || 559);
        inst.x = p.x; inst.y = p.y;
      }
    }
  }
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ model validation (mirrors DEXPI/Pydantic-style rules) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
// ---- obstacle-aware routing: A* grid search with a cost model -------
// `routed` = polylines already placed; crossing one is penalized, running along one is
// heavily penalized, so later lines prefer clean corridors (crossings only when forced).
function avoidObstacles(pts, data, exclude, grid, routed, hardLines) {
  const CELL = Math.max(grid || 5, 5); // 5mm grid resolution
  const PAD = 4;
  const SC = data.view.symbolScale || 1;
  // lines that must stay inviolable: their cells are hard-blocked (refinement's
  // overlap elimination — a re-routed line may not touch them at all)
  const hardCells = new Set();
  if (hardLines) {
    for (const poly of hardLines) {
      if (!poly || poly.length < 2) continue;
      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i], b = poly[i + 1];
        const c0 = Math.round(a.x / CELL), c1 = Math.round(b.x / CELL);
        if (Math.abs(a.y - b.y) < 0.5) {
          const cy = Math.round(a.y / CELL);
          for (let cx = Math.min(c0, c1); cx <= Math.max(c0, c1); cx++) hardCells.add(cx + ',' + cy);
        } else {
          const cx = Math.round(a.x / CELL);
          for (let cy = Math.min(c0, c1); cy <= Math.max(c0, c1); cy++) hardCells.add(cx + ',' + cy);
        }
      }
    }
  }
  const SHEET = { x0: 26, x1: (data.view.sheetW || 864) - 26, y0: 26, y1: (data.view.sheetH || 559) - 26 };
  const ob = [];
  for (const e of [...data.equipment, ...data.valves, ...data.instruments]) {
    if (e === exclude.a || e === exclude.b) continue;
    const isInst = data.instruments.some(i => i.tag === (e.tag || e.id));
    const s = isInst
      ? symbolSize('isa-5.1/instruments/field-instrument') * SC
      : (e.symbol ? symbolSize(e.symbol) : symbolSize(SYMBOL_KEYS[e.type] || 'pip/equipment/vessel-vertical')) * (e.scale || 1) * SC;
    // asymmetric pad: labels sit below equipment/valves, so the bottom needs room
    const padB = isInst ? 3 : 14;
    ob.push({ x0: e.x - s / 2 - PAD, x1: e.x + s / 2 + PAD, y0: e.y - s / 2 - PAD, y1: e.y + s / 2 + padB });
  }

  // penalty field over already-routed lines (grid-cell resolution)
  const field = new Map();
  const bump = (cx, cy, p) => { const k = cx + ',' + cy; field.set(k, (field.get(k) || 0) + p); };
  const markSeg = (x0, y0, x1, y1, p) => {
    if (Math.abs(y0 - y1) < 0.5) {
      const cy = Math.round(y0 / CELL);
      const c0 = Math.round(x0 / CELL), c1 = Math.round(x1 / CELL);
      for (let cx = Math.min(c0, c1); cx <= Math.max(c0, c1); cx++) bump(cx, cy, p);
    } else {
      const cx = Math.round(x0 / CELL);
      const c0 = Math.round(y0 / CELL), c1 = Math.round(y1 / CELL);
      for (let cy = Math.min(c0, c1); cy <= Math.max(c0, c1); cy++) bump(cx, cy, p);
    }
  };
  const markLine = (poly, pen, penNear) => {
    if (!poly || poly.length < 2) return;
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i], b = poly[i + 1];
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5) continue;
      markSeg(a.x, a.y, b.x, b.y, pen);
      // adjacent corridor cells: mild cost so lines keep ~1 cell of clearance
      if (Math.abs(a.y - b.y) < 0.5) {
        markSeg(a.x, a.y - CELL, b.x, b.y - CELL, penNear);
        markSeg(a.x, a.y + CELL, b.x, b.y + CELL, penNear);
      } else {
        markSeg(a.x - CELL, a.y, b.x - CELL, b.y, penNear);
        markSeg(a.x + CELL, a.y, b.x + CELL, b.y, penNear);
      }
    }
  };
  for (const r of (routed || [])) markLine(r.poly, 300, 35);

  const blockedAt = (x, y) => {
    if (hardCells.has(Math.round(x / CELL) + ',' + Math.round(y / CELL))) return true;
    for (const r of ob) {
      if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
    }
    return false;
  };
  // relax a blocked endpoint to the nearest free cell (neighbor boxes may
  // overlap the stub point even though the endpoint's own box is excluded)
  const relax = (p) => {
    const clamp = (q) => ({ x: Math.max(SHEET.x0, Math.min(SHEET.x1, q.x)), y: Math.max(SHEET.y0, Math.min(SHEET.y1, q.y)) });
    if (!blockedAt(p.x, p.y)) return clamp(p);
    // axis-aligned cells first (keeps lead-ins orthogonal), diagonals only as a fallback
    for (let d = 1; d < 8; d++) {
      for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
        const x = p.x + dx * CELL, y = p.y + dy * CELL;
        if (x < SHEET.x0 || x > SHEET.x1 || y < SHEET.y0 || y > SHEET.y1) continue;
        if (!blockedAt(x, y)) return { x, y };
      }
    }
    for (let ring = 1; ring < 8; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          const x = p.x + dx * CELL, y = p.y + dy * CELL;
          if (x < SHEET.x0 || x > SHEET.x1 || y < SHEET.y0 || y > SHEET.y1) continue;
          if (!blockedAt(x, y)) return { x, y };
        }
      }
    }
    return clamp(p);
  };
  // stub-aware endpoints: pts[1] is only the lead-in end if it sits near pts[0];
// for stubless pipes (junction endpoints) it is the FAR end — search between the
// true endpoints or the A* degenerates (start==goal) and lets overlaps through
  const nearEnd = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 30;
  const start = relax(nearEnd(pts[0], pts[1] || pts[0]) ? pts[1] || pts[0] : pts[0]);
  const goal = relax(nearEnd(pts[pts.length - 1], pts[pts.length - 2] || pts[pts.length - 1]) ? pts[pts.length - 2] || pts[pts.length - 1] : pts[pts.length - 1]);

  // Deliberate routing: if the direct orthogonal route is already clean (no component
  // crossing, no paid line crossing, stays inside the sheet), keep it — what a drafter draws.
  let directCost = 0;
  const outOfSheet = (x, y) => x < SHEET.x0 || x > SHEET.x1 || y < SHEET.y0 || y > SHEET.y1;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (outOfSheet(a.x, a.y) || outOfSheet(b.x, b.y)) { directCost += 1e6; continue; }
    const c0 = Math.round(a.x / CELL), c1 = Math.round(b.x / CELL), c0y = Math.round(a.y / CELL), c1y = Math.round(b.y / CELL);
    if (Math.abs(a.y - b.y) < 0.5) {
      const cy = Math.round(a.y / CELL);
      for (let cx = Math.min(c0, c1); cx <= Math.max(c0, c1); cx++) {
        const x = cx * CELL, y = cy * CELL;
        if (blockedAt(x, y)) { directCost += 1e6; break; }
        directCost += field.get(cx + ',' + cy) || 0;
      }
    } else if (Math.abs(a.x - b.x) < 0.5) {
      const cx = Math.round(a.x / CELL);
      for (let cy = Math.min(c0y, c1y); cy <= Math.max(c0y, c1y); cy++) {
        const x = cx * CELL, y = cy * CELL;
        if (blockedAt(x, y)) { directCost += 1e6; break; }
        directCost += field.get(cx + ',' + cy) || 0;
      }
    } else {
      directCost += 1e6; // diagonal — never direct
    }
  }
  if (directCost < 1) return pts;

// search bounds: LOCAL box around the direct route + margin, clamped to the sheet.
  // A drawing-wide bound lets A* take absurd perimeter tours to dodge line costs.
  let x0 = start.x, x1 = start.x, y0 = start.y, y1 = start.y;
  for (const q of pts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
  x0 = Math.min(x0, goal.x); x1 = Math.max(x1, goal.x); y0 = Math.min(y0, goal.y); y1 = Math.max(y1, goal.y);
  const M = 260;
  const bounds = {
    x0: Math.max(SHEET.x0, x0 - M), x1: Math.min(SHEET.x1, x1 + M),
    y0: Math.max(SHEET.y0, y0 - M), y1: Math.min(SHEET.y1, y1 + M)
  };

  const path = aStar(start, goal, ob, CELL, { field, bounds, maxCells: 100000, dipFloor: Math.max(pts[0].y, pts[pts.length - 1].y) });
  if (!path) { window.__astarFails = (window.__astarFails || 0) + 1; return pts; } // no path — fall back to the direct route

  // snap interior bend points to a coarser draft grid (kills doglegs); a point that
  // would snap into a component keeps its original position. The first/last path
  // points are the exact start/goal (lead-ins stay axis-aligned) and are NOT snapped.
  const snapPitch = CELL; // 10mm — a coarser snap would collapse parallel corridors onto each other
  const snapped = [pts[0]];
  for (let qi = 0; qi < path.length; qi++) {
    const q = path[qi];
    if (qi === 0 || qi === path.length - 1) { snapped.push(q); continue; }
    const x = Math.round(q.x / snapPitch) * snapPitch;
    const y = Math.round(q.y / snapPitch) * snapPitch;
    const s = blockedAt(x, y) ? q : { x, y };
    const last = snapped[snapped.length - 1];
    if (Math.abs(last.x - s.x) < 0.5 && Math.abs(last.y - s.y) < 0.5) continue; // collapsed onto previous
    snapped.push(s);
  }
  const lastP = snapped[snapped.length - 1];
  if (Math.abs(lastP.x - pts[pts.length - 1].x) > 0.5 || Math.abs(lastP.y - pts[pts.length - 1].y) > 0.5) snapped.push(pts[pts.length - 1]);

  // orthogonality guarantee: exact (un-snapped) endpoints vs grid cells can produce a
  // diagonal; replace any diagonal segment with an L-bend so lines run only at 0/90/180/270°
  const ortho = [snapped[0]];
  for (let i = 1; i < snapped.length; i++) {
    const a = ortho[ortho.length - 1], b = snapped[i];
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
      const c1 = { x: b.x, y: a.y }, c2 = { x: a.x, y: b.y };
      ortho.push(!blockedAt(c1.x, c1.y) ? c1 : c2);
    }
    ortho.push(b);
  }
  return ortho;
}

function aStar(start, goal, obstacles, cell, ctx) {
  const field = ctx.field, bounds = ctx.bounds, maxCells = ctx.maxCells;
  const blockedAt = (x, y) => {
    for (const r of obstacles) {
      if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
    }
    return false;
  };
  const inBounds = (x, y) => x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y <= bounds.y1;
  const toCell = (p) => [Math.round(p.x / cell), Math.round(p.y / cell)];
  const fromCell = (c) => ({ x: c[0] * cell, y: c[1] * cell });
  const s = toCell(start), g = toCell(goal);
  const key = (c) => c[0] + ',' + c[1];
  const h = (c) => Math.abs(c[0] - g[0]) + Math.abs(c[1] - g[1]);
  const gScore = new Map([[key(s), 0]]);
  const came = new Map();
  const seen = new Set([key(s)]);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let found = null;

  // tiny binary heap for the open set (the old linear scan crawls on big grids)
  const heap = [{ c: s, f: h(s) }];
  const push = (n) => {
    heap.push(n);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].f <= heap[i].f) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].f < heap[m].f) m = l;
        if (r < heap.length && heap[r].f < heap[m].f) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  let expansions = 0;
  while (heap.length) {
    if (++expansions > maxCells) return null; // runaway guard
    const cur = pop();
    if (cur.c[0] === g[0] && cur.c[1] === g[1]) { found = cur.c; break; }
    for (const [dx, dy] of dirs) {
      const nc = [cur.c[0] + dx, cur.c[1] + dy];
      const k = key(nc);
      if (seen.has(k)) continue;
      const nx = nc[0] * cell, ny = nc[1] * cell;
      // the relaxed goal point is free by construction; its cell center may still sit
      // inside a neighbor's box (grid quantization) — never seal the goal itself
      const isGoal = nc[0] === g[0] && nc[1] === g[1];
      if (!inBounds(nx, ny) || (blockedAt(nx, ny) && !isGoal)) { seen.add(k); continue; }
      // cost model: base + existing-line field + bend penalty + dip penalty (a line must
      // not travel lower than its lower port unless forced; soft, so it still routes)
      const turn = cur.dir && (cur.dir[0] !== dx || cur.dir[1] !== dy) ? 12 : 0;
      const dip = (ctx.dipFloor !== undefined && ny > ctx.dipFloor) ? 50 : 0;
      const ng = gScore.get(key(cur.c)) + 1 + (field.get(k) || 0) + turn + dip;
      if (ng < (gScore.get(k) ?? Infinity)) {
        gScore.set(k, ng);
        came.set(k, cur.c);
        heap.push({ c: nc, f: ng + h(nc), dir: [dx, dy] });
        seen.add(k);
      }
    }
  }
  if (!found) return null;

  // reconstruct (pin exact start/goal so lead-ins stay axis-aligned)
  const cells = [found];
  while (came.has(key(cells[0]))) cells.unshift(came.get(key(cells[0])));
  let path = cells.map(fromCell);
  path[0] = { x: start.x, y: start.y };
  path[path.length - 1] = { x: goal.x, y: goal.y };

  // smoothing: drop intermediate points where a straight orthogonal segment — or an
  // L-shaped shortcut (straighter, longer runs over pointless stair-stepping) — is
  // clear AND does not pay more line-penalty than the path it replaces.
  const pathPenalty = (a, b) => {
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) return Infinity;
    let sum = 0;
    const c0 = Math.round(a.x / cell), c1 = Math.round(b.x / cell), cy = Math.round(b.y / cell);
    if (Math.abs(a.y - b.y) < 0.5) {
      for (let cx = Math.min(c0, c1); cx <= Math.max(c0, c1); cx++) sum += field.get(cx + ',' + cy) || 0;
    } else {
      const cx = Math.round(a.x / cell);
      for (let cy2 = Math.min(Math.round(a.y / cell), Math.round(b.y / cell)); cy2 <= Math.max(Math.round(a.y / cell), Math.round(b.y / cell)); cy2++) sum += field.get(cx + ',' + cy2) || 0;
    }
    return sum;
  };
  const segClear = (a, b) => {
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / cell;
    for (let t = 0.5; t < steps; t += 1) {
      const x = a.x + (b.x - a.x) * (t / steps);
      const y = a.y + (b.y - a.y) * (t / steps);
      if (blockedAt(x, y)) return false;
    }
    return true;
  };
  // a shortcut must never cross an existing line (max on-line cell penalty) — the
  // staircase it replaces skirted the corridor; the shortcut must not re-introduce
  // a crossing the A* had deliberately avoided
  const crossesLine = (a, b) => {
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / cell;
    for (let t = 0.5; t < steps; t += 1) {
      const x = a.x + (b.x - a.x) * (t / steps);
      const y = a.y + (b.y - a.y) * (t / steps);
      if ((field.get(Math.round(x / cell) + ',' + Math.round(y / cell)) || 0) >= 300) return true;
    }
    return false;
  };
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let i = 0; i < path.length - 2; i++) {
      for (let j = path.length - 1; j > i + 1; j--) {
        const a = path[i], b = path[j];
        let removed = 0;
        for (let k = i; k < j; k++) removed += pathPenalty(path[k], path[k + 1]);
        let replace = null;
        if (a.x === b.x || a.y === b.y) {
          // axis-aligned shortcut: straight through
          if (segClear(a, b) && pathPenalty(a, b) <= removed) replace = [];
        } else {
          // L-shaped shortcut: collapse the staircase to a single corner (H-then-V
          // preferred — matches the horizontal-precedence drafting rule)
          for (const corner of [{ x: b.x, y: a.y }, { x: a.x, y: b.y }]) {
            if (!segClear(a, corner) || !segClear(corner, b)) continue;
            if (pathPenalty(a, corner) + pathPenalty(corner, b) <= removed) { replace = [corner]; break; }
          }
        }
        if (!replace) continue;
        path.splice(i + 1, j - i - 1, ...replace);
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return path;
}

// ---- overlap resolution: push overlapping entities apart (placement engine) --
function resolveOverlaps(data) {
  const all = [...data.equipment, ...data.valves, ...data.instruments];
  const SC = data.view.symbolScale || 1;
  const half = (e) => {
    if (data.instruments.some(i => i.tag === (e.tag || e.id))) return symbolSize('isa-5.1/instruments/field-instrument') * SC / 2;
    return (e.symbol ? symbolSize(e.symbol) : symbolSize(SYMBOL_KEYS[e.type] || "pip/equipment/vessel-vertical")) * (e.scale || 1) * SC / 2;
  };
  for (let pass = 0; pass < 10; pass++) {
    // accumulate pushes per entity, apply once per pass (avoids ping-pong)
    const acc = new Map();
    const push = (e, dx, dy) => {
      const k = e.tag || e.id;
      const cur = acc.get(k) || { x: 0, y: 0 };
      cur.x += dx; cur.y += dy;
      acc.set(k, cur);
    };
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const ha = half(a), hb = half(b);
        const ox = ha + hb - Math.abs(a.x - b.x);
        const oy = ha + hb - Math.abs(a.y - b.y);
        if (ox <= 0 || oy <= 0) continue;
        // push the instrument away when involved; otherwise split the push
        const aInst = half(a) === 35, bInst = half(b) === 35;
        if (bInst && !aInst) { push(b, a.x > b.x ? -ox : ox, a.y > b.y ? -oy : oy); }
        else if (aInst && !bInst) { push(a, b.x > a.x ? -ox : ox, b.y > a.y ? -oy : oy); }
        else {
          const px = ox < oy ? (a.x > b.x ? -ox / 2 : ox / 2) : 0;
          const py = ox < oy ? 0 : (a.y > b.y ? -oy / 2 : oy / 2);
          push(a, -px, -py); push(b, px, py);
        }
      }
    }
    if (!acc.size) break;
    let moved = false;
    for (const e of all) {
      const d = acc.get(e.tag || e.id);
      if (!d) continue;
      if (e._fixed) { data.warnings.push(`"${e.id || e.tag}": overlaps a neighbor but is fixed (\`at\`) — move it manually`); continue; }
      e.x += d.x; e.y += d.y;
      moved = true;
    }
    if (!moved) break;
  }
}

const AUTO_VALVES = new Set(['control', 'motor-gate', 'solenoid', 'electrohydraulic']);
const CONTROL_TAG_RE = /^(FCV|PCV|LCV|XV|FV|TV|PV|AV|HV|PSV)\d/;

// ---- topology engine: authoritative port assignment + graph (runs post-layout, pre-render) --
// The renderer consumes only what this stage decides; it never infers topology.
function resolveTopology(data) {
  const errs = data.errors;
  const byId = {};
  for (const e of [...data.equipment, ...data.valves, ...data.instruments, ...data.junctions]) byId[e.id || e.tag] = e;
  const instSet = new Set(data.instruments.map(i => i.tag));
  const jSet = new Set(data.junctions.map(j => j.id));
  const used = {}; // entityKey -> Map(portId -> count)
  const usedPorts = {}; // entityKey -> [conn, ...] for nozzle drawing
  const capacity = (e, c) => { const card = (c && c.cardinality) || 1; return (used[e.id || e.tag] && used[e.id || e.tag].get(c.id)) || 0; };
  const use = (e, c) => { const k = e.id || e.tag; if (!used[k]) used[k] = new Map(); used[k].set(c.id, capacity(e, c) + 1); (usedPorts[k] = usedPorts[k] || []).push(c); };
  data.usedConns = used;
  data.usedPorts = usedPorts;

  const connWorld = (e, c, size) => {
    const sx = ((c.x - 50) / 100) * size * (data.view.symbolScale || 1);
    const sy = ((c.y - 50) / 100) * size * (data.view.symbolScale || 1);
    let rx = sx, ry = sy;
    if (e.rotation) {
      const r = (e.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
      rx = sx * cos - sy * sin; ry = sx * sin + sy * cos;
    }
    return { x: e.x + rx, y: e.y + ry };
  };

  const resolvePort = (e, portName, other, kind) => {
    // junction: free-form node, no ports
    if (jSet.has(e.id || e.tag)) return { junction: true, x: e.x, y: e.y, dir: { x: 0, y: 0 } };
    if (instSet.has(e.id || e.tag)) {
      if (kind === 'signal') return { x: e.x, y: e.y - 4.5 * (data.view.symbolScale || 1), dir: { x: 0, y: -1 }, signal: true };
      return null; // process pipe to an instrument is a hard error (checked by caller)
    }
    const key = e.symbol || SYMBOL_KEYS[e.type];
    const conns = key ? symbolConnections(key) : [];
    if (!conns.length) {
      errs.push({ code: 'NO_PORT_DEFINITION', entity: e.id || e.tag, message: `${e.id || e.tag}: no connection ports defined in the symbol library — connection refused (no topology guessing)` });
      return null;
    }
    if (kind === 'signal') {
      // Rule 67: a signal must not consume a process port — attach at the
      // actuator/top nozzle if defined, else the top-center of the symbol
      const sig = conns.find(c => /actuator|top|signal/i.test(c.id) && c.type === 'nozzle')
        || conns.find(c => c.type === 'nozzle');
      const size = (e.symbol ? symbolSize(e.symbol) : symbolSize(SYMBOL_KEYS[e.type] || 'pip/equipment/vessel-vertical')) * (e.scale || 1) * (data.view.symbolScale || 1);
      if (sig) { const p = connWorld(e, sig, size); return { conn: sig, x: p.x, y: p.y, dir: { x: 0, y: -1 } }; }
      return { x: e.x, y: e.y - size / 2, dir: { x: 0, y: -1 } };
    }
    const size = (e.symbol ? symbolSize(e.symbol) : symbolSize(SYMBOL_KEYS[e.type] || 'pip/equipment/vessel-vertical')) * (e.scale || 1) * (data.view.symbolScale || 1);
    let conn = null;
    if (portName) {
      conn = conns.find(c => c.id === portName);
      if (!conn) {
        errs.push({ code: 'UNKNOWN_PORT', entity: `${e.id || e.tag}.${portName}`, message: `${e.id || e.tag}: no port named "${portName}" (have: ${conns.map(c => c.id).join(', ')})` });
        return null;
      }
      if (capacity(e, conn) >= ((conn.cardinality) || 1)) {
        errs.push({ code: 'PORT_CAPACITY', entity: `${e.id || e.tag}.${portName}`, message: `${e.id || e.tag}: port "${portName}" is at capacity (${capacity(e, conn)}/${(conn.cardinality) || 1})` });
        return null;
      }
    } else {
      const sigPort = kind === 'signal';
      const avail = conns.filter(c => capacity(e, c) < ((c.cardinality) || 1) && (sigPort || !/actuator/i.test(c.id)));
      if (!avail.length) {
        errs.push({ code: 'NO_AVAILABLE_PORT', entity: e.id || e.tag, message: `${e.id || e.tag}: no available connection port (all ${conns.length} port(s) at capacity)` });
        return null;
      }
      if (avail.length === 1) {
        conn = avail[0];
      } else {
        const scored = avail.map(c => {
          const p = connWorld(e, c, size);
          const toX = other.x - p.x, toY = other.y - p.y;
          const len = Math.hypot(toX, toY) || 1;
          let dir = { x: toX / len, y: toY / len };
          if (e.rotation) {
            const r = (e.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
            dir = { x: cos * dir.x + sin * dir.y, y: -sin * dir.x + cos * dir.y };
          }
          const pl = Math.hypot(c.x - 50, c.y - 50) || 1;
          const pd = { x: (c.x - 50) / pl, y: (c.y - 50) / pl };
          return { c, s: dir.x * pd.x + dir.y * pd.y };
        }).sort((a, b) => b.s - a.s);
        const best = scored[0], second = scored[1];
        if (!second || best.s - second.s > 0.35) conn = best.c;
        else {
          errs.push({ code: 'AMBIGUOUS_PORT', entity: e.id || e.tag, message: `${e.id || e.tag}: ambiguous connection — ${scored.length} unused ports face the other endpoint similarly (${scored.map(s => s.c.id).join(', ')}); specify the port explicitly` });
          return null;
        }
      }
    }
    use(e, conn);
    const p = connWorld(e, conn, size);
    // port lead-in must be axis-aligned (0/90/180/270) AND in the same orientation as the
// symbol body (rotate the port direction with the entity, then take the dominant axis)
    const pdx = conn.x - 50, pdy = conn.y - 50;
    let rdx = pdx, rdy = pdy;
    if (e.rotation) {
      const r = (e.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
      rdx = pdx * cos - pdy * sin; rdy = pdx * sin + pdy * cos;
    }
    return { conn, x: p.x, y: p.y, dir: Math.abs(rdx) >= Math.abs(rdy) ? { x: Math.sign(rdx), y: 0 } : { x: 0, y: Math.sign(rdy) } };
  };

  data.junctionGraph = {};
  for (const p of data.pipes) {
    if (p.kind === 'tap') {
      // tap is a real topology object: instrument -> host line
      const inst = byId[p.from], host = byId[p.to];
      if (!inst || !instSet.has(p.from)) errs.push({ code: 'TAP_SOURCE', entity: p.from, message: `tap "${p.from} -> ${p.to}": source must be an instrument` });
      if (!host) errs.push({ code: 'TAP_HOST', entity: p.to, message: `tap "${p.from} -> ${p.to}": unknown host entity "${p.to}"` });
      else if (instSet.has(p.to)) errs.push({ code: 'TAP_HOST_INSTRUMENT', entity: p.to, message: `tap "${p.from} -> ${p.to}": host must not be an instrument` });
      p._tap = { host: p.to };
      continue;
    }
    const a = byId[p.from], b = byId[p.to];
    if (!a || !b) continue; // unknown endpoint already reported by validateModel
    const aIsJ = jSet.has(p.from), bIsJ = jSet.has(p.to);
    const pa = aIsJ ? { junction: true, x: a.x, y: a.y } : resolvePort(a, p.fromPort, b, p.kind);
    const pb = bIsJ ? { junction: true, x: b.x, y: b.y } : resolvePort(b, p.toPort, a, p.kind);
    if (aIsJ) (data.junctionGraph[a.id] = data.junctionGraph[a.id] || []).push({ pipe: p, end: 'a' });
    if (bIsJ) (data.junctionGraph[b.id] = data.junctionGraph[b.id] || []).push({ pipe: p, end: 'b' });
    if (!pa || !pb) continue; // topology error: pipe refused, no geometry
    p._from = pa; p._to = pb;
  }

  // junction sanity: a junction must be a real node (≥2 incident pipes), not a stray point
  for (const j of data.junctions) {
    const n = (data.junctionGraph[j.id] || []).length;
    if (n === 0) errs.push({ code: 'ISOLATED_JUNCTION', entity: j.id, message: `junction "${j.id}": no connections` });
    else if (n === 1 && !j.stub) errs.push({ code: 'DENDRITE_JUNCTION', entity: j.id, message: `junction "${j.id}": only 1 connection — a junction is a node (≥2) or an off-page stub; use \`stub ${j.id}\` or connect a branch` });
  }
}

// ---- geometry validation: runs after routing, before the SVG is committed ----
// enforces: every segment is axis-aligned (0/90/180/270); tap lines reach a minimum
// length off the bubble; signal runs have a sane maximum length. Returns a line
// audit: crossing counts with gap-status and collinear overlaps between lines.
function validateGeometry(data, geometries, pipes) {
  const w = data.warnings;
  const SHEET_W = data.view.sheetW || 864, SHEET_H = data.view.sheetH || 559;
  for (const g of geometries) {
    const pts = g.pts;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
      if (dx > 0.5 && dy > 0.5) {
        w.push(`geometry "${g.p.from} -> ${g.p.to}": non-orthogonal segment (${dx.toFixed(1)}x${dy.toFixed(1)}mm) — lines must run at 0/90/180/270°`);
      }
    }
    if (g.signal) {
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
      if (len > SHEET_W * 0.55) w.push(`signal "${g.p.from} -> ${g.p.to}": very long run (${Math.round(len)}mm) — instrument pair far apart; consider moving the receiver`);
    }
  }
  // taps: the instrument must reach the line — a tap shorter than the bubble radius
  // means the bubble is sitting on the pipe
  for (const p of pipes) {
    if (p.kind !== 'tap') continue;
    const hostGeom = geometries.find(gg => gg.p.from === p._tap.host || gg.p.to === p._tap.host);
    if (!hostGeom) continue;
    const inst = data.instruments.find(i => i.tag === p.from);
    if (!inst) continue;
    const r = 4.5 * (data.view.symbolScale || 1);
    const segs = [];
    const pts = hostGeom.pts;
    for (let k = 0; k < pts.length - 1; k++) {
      const s = pts[k], e2 = pts[k + 1];
      if (Math.abs(s.y - e2.y) < 0.5 && Math.abs(s.x - e2.x) > 5) segs.push({ x1: Math.min(s.x, e2.x), x2: Math.max(s.x, e2.x), y: s.y });
    }
    const seg = segs.filter(s => s.y >= inst.y && inst.x >= s.x1 - 2 && inst.x <= s.x2 + 2).sort((a, b) => a.y - b.y)[0]
      || segs.sort((a, b) => Math.abs(a.y - inst.y) - Math.abs(b.y - inst.y))[0];
    if (seg) {
      const reach = seg.y - (inst.y + r);
      if (Math.abs(reach) < 3) w.push(`tap "${p.from} -> ${p._tap.host}": reach only ${Math.abs(reach).toFixed(1)}mm — instrument bubble is sitting on the line; move the instrument up`);
    }
  }

  // ---- line audit: crossings (with gap-status) and collinear overlaps ----
  const GAP = 4, MIN_RUN = 8;
  const segsOf = (pts) => { const o = []; for (let i = 1; i < pts.length; i++) o.push([pts[i - 1], pts[i]]); return o; };
  const crossPt = (s1, s2) => {
    const p1 = s1[0], p2 = s1[1], p3 = s2[0], p4 = s2[1];
    const h1 = p1.y === p2.y, h2 = p3.y === p4.y;
    if (h1 === h2) return null;
    const h = h1 ? s1 : s2, v = h1 ? s2 : s1;
    const hx1 = h[0].x, hx2 = h[1].x, cy = h[0].y;
    const vx = v[0].x, vy1 = v[0].y, vy2 = v[1].y;
    if (vx < Math.min(hx1, hx2) + 1 || vx > Math.max(hx1, hx2) - 1) return null;
    if (cy < Math.min(vy1, vy2) + 1 || cy > Math.max(vy1, vy2) - 1) return null;
    return { x: vx, y: cy };
  };
  const isReal = (si, sj) => {
    const x = crossPt(si, sj);
    if (!x) return false;
    for (const s of [si, sj]) {
      if (Math.hypot(x.x - s[0].x, x.y - s[0].y) < 4) return false;
      if (Math.hypot(x.x - s[1].x, x.y - s[1].y) < 4) return false;
    }
    return true;
  };
  let overlaps = 0, ungapped = 0;
  const overlapList = [], ungappedList = [];
  const segList = geometries.map(g => segsOf(g.pts));
  for (let i = 0; i < geometries.length; i++) {
    const a = geometries[i];
    for (let j = i + 1; j < geometries.length; j++) {
      const b = geometries[j];
      for (const si of segList[i]) {
        for (const sj of segList[j]) {
          const h1 = Math.abs(si[0].y - si[1].y) < 0.5, h2 = Math.abs(sj[0].y - sj[1].y) < 0.5;
          // collinear overlap (two lines running along the same corridor)
          if (h1 && h2 && Math.abs(si[0].y - sj[0].y) < 1) {
            const s1 = Math.max(Math.min(si[0].x, si[1].x), Math.min(sj[0].x, sj[1].x));
            const s2 = Math.min(Math.max(si[0].x, si[1].x), Math.max(sj[0].x, sj[1].x));
            if (s2 - s1 > 3) { overlaps++; if (overlapList.length < 8) overlapList.push(`${a.p.from}->${a.p.to} & ${b.p.from}->${b.p.to} overlap ${Math.round(s2 - s1)}mm at y=${Math.round(si[0].y)}`); }
          } else if (!h1 && !h2 && Math.abs(si[0].x - sj[0].x) < 1) {
            const s1 = Math.max(Math.min(si[0].y, si[1].y), Math.min(sj[0].y, sj[1].y));
            const s2 = Math.min(Math.max(si[0].y, si[1].y), Math.max(sj[0].y, sj[1].y));
            if (s2 - s1 > 3) { overlaps++; if (overlapList.length < 8) overlapList.push(`${a.p.from}->${a.p.to} & ${b.p.from}->${b.p.to} overlap ${Math.round(s2 - s1)}mm at x=${Math.round(si[0].x)}`); }
          }
          // crossing whose gap would be cut too close to a bend (pass 3 skips it)
          const x = crossPt(si, sj);
          if (x && isReal(si, sj)) {
            const sjLen = Math.abs(sj[0].x - sj[1].x) + Math.abs(sj[0].y - sj[1].y);
            if (sjLen) {
              const t = ((x.x - sj[0].x) + (x.y - sj[0].y)) / sjLen;
              if (t < (GAP + MIN_RUN) / sjLen || t > 1 - (GAP + MIN_RUN) / sjLen) {
                ungapped++; if (ungappedList.length < 8) ungappedList.push(`${a.p.from}->${a.p.to} & ${b.p.from}->${b.p.to} at [${Math.round(x.x)},${Math.round(x.y)}]`);
              }
            }
          }
        }
      }
    }
  }
  if (overlaps) w.push(`line audit: ${overlaps} collinear overlap(s) — lines sharing a corridor (${overlapList.join('; ')})`);
  if (ungapped) w.push(`line audit: ${ungapped} crossing(s) without a gap break (too close to a bend; pass 3 skipped) (${ungappedList.join('; ')})`);
  return { overlaps, ungapped };
}

function validateModel(data) {
  const w = data.warnings;
  const seen = {};
  const named = [...data.equipment, ...data.valves, ...data.junctions];
  const idSet = new Set(named.map(e => e.id));
  const instSet = new Set(data.instruments.map(i => i.tag));
  const exists = (id) => idSet.has(id) || instSet.has(id);

  for (const e of named) {
    if (seen[e.id]) w.push(`duplicate id "${e.id}"`);
    seen[e.id] = true;
  }
  for (const i of data.instruments) {
    if (seen[i.tag]) w.push(`duplicate instrument tag "${i.tag}"`);
    seen[i.tag] = true;
  }
  for (const id of Object.keys(data.lineDefs)) {
    if (seen[id]) w.push(`duplicate line id "${id}"`);
    seen[id] = true;
  }

  for (const e of [...data.equipment, ...data.valves]) {
    if (!SYMBOL_KEYS[e.type] && !e.symbol) w.push(`"${e.id}": unknown entity type "${e.type}" (falls back to vessel glyph)`);
    const connected = data.pipes.some(p => p.from === e.id || p.to === e.id);
    if (!connected) w.push(`"${e.id}" (${e.type}): not connected to any pipe`);
  }

  for (const p of data.pipes) {
    if (!exists(p.from)) w.push(`pipe "${p.from} -> ${p.to}": unknown source "${p.from}"`);
    if (!exists(p.to)) w.push(`pipe "${p.from} -> ${p.to}": unknown target "${p.to}"`);
    for (const [end, port] of [[p.from, p.fromPort], [p.to, p.toPort]]) {
      if (!port) continue;
      const e = named.find(x => x.id === end);
      if (!e) continue;
      const key = e.symbol || SYMBOL_KEYS[e.type];
      if (key && !symbolConnections(key).some(c => c.id === port)) {
        w.push(`pipe "${p.from} -> ${p.to}": port "${port}" does not exist on ${end}`);
      }
    }
    if (p.line && !data.lineDefs[p.line]) w.push(`pipe "${p.from} -> ${p.to}": unknown line spec "${p.line}"`);
    if (p.kind !== 'signal' && p.kind !== 'tap') {
      // Rule 67/104/105: a process pipe must not terminate on an instrument bubble
      for (const end of [p.from, p.to]) {
        if (instSet.has(end)) w.push(`process pipe "${p.from} -> ${p.to}": "${end}" is an instrument — connect through a process tap or junction`);
      }
    }
    if (p.kind === 'signal') {
      for (const end of [p.from, p.to]) {
        const e = data.valves.find(v => v.id === end) || data.equipment.find(q => q.id === end);
        const okAuto = e && (AUTO_VALVES.has(e.type) || /^(pump|compressor|fan|blower|turbine)/.test(e.type));
        if (!instSet.has(end) && !okAuto) w.push(`signal "${p.from} -> ${p.to}": "${end}" is neither an instrument, auto valve, nor rotating equipment`);
      }
    }
  }

  for (const inst of data.instruments) {
    const hasSignal = data.pipes.some(p => p.kind === 'signal' && (p.from === inst.tag || p.to === inst.tag));
    const hasTap = data.pipes.some(p => p.kind === 'tap' && (p.from === inst.tag || p.to === inst.tag));
    if (inst.bubble === 'dcs') {
      if (!hasSignal) w.push(`DCS instrument "${inst.tag}": no signal connection`);
    } else if (!hasTap) {
      w.push(`field instrument "${inst.tag}": no process tap (declare \`tap ${inst.tag} -> <line entity>\`)`);
    }
  }

  for (const v of data.valves) {
    if (!AUTO_VALVES.has(v.type)) continue;
    const hasSignal = data.pipes.some(p => p.kind === 'signal' && (p.from === v.id || p.to === v.id));
    const hasLoopTag = CONTROL_TAG_RE.test(v.tag || v.id);
    if (!hasSignal && !hasLoopTag) w.push(`valve "${v.id}" (${v.type}): no instrument loop or control-valve tag`);
  }
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ symbol catalog ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
const SYMBOL_KEYS = {
  pump: 'pip/equipment/pump-centrifugal',
  'pump-vertical': 'y32.11-1961/pumps/centrifugal-pump',
  'pump-gear': 'y32.11-1961/pumps/gear-pump',
  'pump-pd': 'y32.11-1961/pumps/reciprocating-pump',
  'pump-vacuum': 'y32.11-1961/pumps/vacuum-pump',
  'pump-screw': 'y32.11-1961/pumps/pump-screw',
  'pump-vertical-turbine': 'y32.11-1961/pumps/pump-vertical-turbine',
  vessel: 'pip/equipment/vessel-vertical',
  'vessel-horizontal': 'pip/equipment/vessel-horizontal',
  drum: 'y32.11-1961/vessels/drum',
  'knockout-drum': 'y32.11-1961/vessels/knockout-drum',
  reactor: 'y32.11-1961/vessels/reactor-stirred',
  'reactor-jacketed': 'y32.11-1961/vessels/reactor-jacketed',
  tank: 'pip/equipment/tank-cone-roof',
  'tank-dome-roof': 'y32.11-1961/tanks/tank-dome-roof',
  'tank-internal-floating-roof': 'y32.11-1961/tanks/tank-internal-floating-roof',
  'heat-exchanger': 'pip/equipment/heat-exchanger-shell-tube',
  'kettle-reboiler': 'y32.11-1961/heat-exchangers/kettle-reboiler',
  compressor: 'pip/equipment/compressor',
  'compressor-liquid-ring': 'y32.11-1961/compressors/compressor-liquid-ring',
  filter: 'pip/equipment/filter',
  mixer: 'pip/equipment/agitator',
  furnace: 'y32.11-1961/furnaces/box-furnace',
  'fired-heater': 'y32.11-1961/furnaces/fired-heater',
  'electric-heater': 'y32.11-1961/furnaces/electric-heater',
  boiler: 'y32.11-1961/furnaces/boiler',
  tower: 'pip/equipment/column-tower',
  silencer: 'y32.11-1961/miscellaneous/silencer',
  fan: 'y32.11-1961/miscellaneous/fan',
  blower: 'y32.11-1961/miscellaneous/blower',
  turbine: 'y32.11-1961/miscellaneous/turbine',
  ejector: 'y32.11-1961/miscellaneous/ejector',
  conveyor: 'y32.11-1961/miscellaneous/conveyor',
  crusher: 'y32.11-1961/miscellaneous/crusher',
  'ball-mill': 'y32.11-1961/miscellaneous/ball-mill',
  dryer: 'y32.11-1961/miscellaneous/dryer',
  'steam-trap': 'y32.11-1961/miscellaneous/steam-trap',
  'gas-cylinder': 'y32.11-1961/miscellaneous/gas-cylinder',
  'gravity-separator': 'y32.11-1961/separators/gravity-separator',
  gate: 'isa-5.1/valves/gate',
  globe: 'isa-5.1/valves/globe',
  ball: 'isa-5.1/valves/ball',
  check: 'isa-5.1/valves/check-valve',
  'check-swing': 'isa-5.1/valves/check-valve-swing',
  'check-lift': 'isa-5.1/valves/check-valve-lift',
  butterfly: 'isa-5.1/valves/butterfly',
  needle: 'isa-5.1/valves/needle-valve',
  control: 'isa-5.1/valves/control-valve',
  relief: 'isa-5.1/valves/relief-safety',
  'vacuum-relief': 'isa-5.1/valves/vacuum-relief-valve',
  '3way': 'isa-5.1/valves/three-way',
  '4way': 'isa-5.1/valves/four-way-valve',
  angle: 'isa-5.1/valves/angle-valve',
  rupture: 'isa-5.1/valves/rupture-disc',
  'motor-gate': 'isa-5.1/valves/motor-operated-gate'
};
const BUBBLE_KEYS = {
  field: 'isa-5.1/instruments/field-instrument',
  panel: 'isa-5.1/instruments/panel-instrument',
  dcs: 'isa-5.1/instruments/shared-display',
  computer: 'isa-5.1/instruments/computer-function',
  plc: 'isa-5.1/instruments/plc-function'
};

// symbol sizes come from the bundle metadata (pid-svg-library/sizes.json)

const TYPE_LABELS = {
  pump: 'centrifugal pump', 'pump-vertical': 'vertical turbine pump', 'pump-gear': 'gear pump',
  'pump-pd': 'positive displacement pump', 'pump-vacuum': 'vacuum pump',
  'pump-screw': 'screw pump', 'pump-vertical-turbine': 'vertical turbine pump',
  vessel: 'vertical vessel', 'vessel-horizontal': 'horizontal vessel', tank: 'cone roof tank',
  drum: 'drum', 'knockout-drum': 'knockout drum', reactor: 'stirred reactor',
  'reactor-jacketed': 'jacketed reactor',
  'tank-dome-roof': 'dome roof tank', 'tank-internal-floating-roof': 'internal floating roof tank',
  'heat-exchanger': 'shell & tube exchanger', 'kettle-reboiler': 'kettle reboiler',
  compressor: 'compressor', 'compressor-liquid-ring': 'liquid ring compressor',
  filter: 'filter', mixer: 'agitator', furnace: 'furnace',
  'fired-heater': 'fired heater', 'electric-heater': 'electric heater', boiler: 'boiler',
  tower: 'column', silencer: 'silencer',
  fan: 'fan', blower: 'blower', turbine: 'turbine', ejector: 'ejector',
  conveyor: 'conveyor', crusher: 'crusher', 'ball-mill': 'ball mill', dryer: 'dryer',
  'steam-trap': 'steam trap', 'gas-cylinder': 'gas cylinder',
  'gravity-separator': 'gravity separator',
  gate: 'gate valve', globe: 'globe valve', ball: 'ball valve', check: 'check valve',
  butterfly: 'butterfly valve', needle: 'needle valve', control: 'control valve',
  relief: 'relief valve', '3way': '3-way valve',
  'check-swing': 'swing check valve', 'check-lift': 'lift check valve',
  'vacuum-relief': 'vacuum relief valve', '4way': '4-way valve', angle: 'angle valve',
  rupture: 'rupture disc', 'motor-gate': 'motor-operated gate'
};

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ glyph connection metadata ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sizeCache = {};
function symbolSize(key) {
  if (sizeCache[key]) return sizeCache[key];
  const glyph = window.PID_SYMBOLS[key] || '';
  let m = glyph.match(/<size>([\d.]+)<\/size>/);
  if (!m) {
    const vb = glyph.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    m = vb ? [null, vb[1]] : [null, '40'];
  }
  sizeCache[key] = parseFloat(m[1]);
  return sizeCache[key];
}
function glyphSizeOf(e) {
  if (e.symbol) return symbolSize(e.symbol);
  return symbolSize(SYMBOL_KEYS[e.type] || 'pip/equipment/vessel-vertical');
}

const connCache = {};
function symbolConnections(key) {
  if (connCache[key]) return connCache[key];
  const glyph = window.PID_SYMBOLS[key] || '';
  const conns = [];
  const re = /<connection id="([\w-]+)" x="([\d.]+)" y="([\d.]+)" type="(\w+)"/g;
  let m;
  while ((m = re.exec(glyph)) !== null) {
    conns.push({ id: m[1], x: parseFloat(m[2]), y: parseFloat(m[3]), type: m[4] });
  }
  connCache[key] = conns;
  return conns;
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ renderer ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
function renderInto(svg, data) {
  const { equipment, valves, instruments, junctions, pipes, view } = data;

  const byId = {};
  for (const e of [...equipment, ...valves, ...junctions]) byId[e.id] = e;
  for (const i of instruments) byId[i.tag] = i;

  const isJunction = (id) => junctions.some(j => j.id === id);
  const isInstrument = (e) => instruments.some(i => i.tag === (e.tag || e.id));
  const shown = (e, kind) => view.show === 'all' || view.show === kind;

  const glyphKeyOf = (e) => isInstrument(e) ? (BUBBLE_KEYS[e.bubble] || BUBBLE_KEYS.field) : (e.symbol || SYMBOL_KEYS[e.type] || SYMBOL_KEYS.vessel);
  // content scale: symbols and text shrink together (real P&IDs: ~12mm bubbles on
  // a 24x36in sheet = ~1.3% of width; we render ~2-3% with fit-page)
  const SC = view.symbolScale || 1;
  const textScale = Math.max(0.85, SC);
  const fs = (n) => Math.round(n * textScale * 10) / 10;
  const sizeOf = (e) => {
    let s = isInstrument(e) ? symbolSize(glyphKeyOf(e)) : glyphSizeOf(e);
    if (e.scale) s *= e.scale;
    return s * SC;
  };

  // canvas: content-sized, or full page when `fit page`
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of [...equipment, ...valves, ...instruments, ...junctions]) {
    const s = sizeOf(e);
    minX = Math.min(minX, e.x - s / 2); minY = Math.min(minY, e.y - s / 2);
    maxX = Math.max(maxX, e.x + s / 2); maxY = Math.max(maxY, e.y + s / 2);
  }
  minX = Math.min(minX, 0); minY = Math.min(minY, 0);
  // include room for tags/labels that extend beyond the symbol boxes
  minX -= 10; minY -= 12; maxX += 10; maxY += 14;

    let W, H, wrap = '';
    if (view.fitPage) {
      // the sheet is a fixed 22x34in (559x864mm) drawing; content is laid out
      // inside it, and the whole sheet maps to the window
      W = view.sheetW || 864; H = view.sheetH || 559;
      const pad = 10;
      const cw = Math.max(maxX - minX, 1), ch = Math.max(maxY - minY, 1);
      if (cw > W - 2 * pad || ch > H - 2 * pad) {
        data.warnings.push(`content (${Math.round(cw)}x${Math.round(ch)}mm) exceeds sheet (${W}x${H}mm) — reduce scale or layout`);
      }
      const k = Math.min((W - 2 * pad) / cw, (H - 2 * pad) / ch);
      wrap = `<g transform="translate(${pad - minX * k} ${pad - minY * k}) scale(${k})">`;
    } else {
      W = maxX + 20; H = maxY + 20;
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', String(view.fitPage ? window.innerWidth : W));
    svg.setAttribute('height', String(view.fitPage ? window.innerHeight : H));

  const connWorld = (e, conn, size) => {
    let cx = conn.x, cy = conn.y;
    if (e.rotation) {
      const r = (e.rotation * Math.PI) / 180;
      const rx = (cx - 50) * Math.cos(r) - (cy - 50) * Math.sin(r) + 50;
      const ry = (cx - 50) * Math.sin(r) + (cy - 50) * Math.cos(r) + 50;
      cx = rx; cy = ry;
    }
    const scale = size / 100;
    const x = e.x + (cx - 50) * scale;
    const y = e.y + (cy - 50) * scale;
    if (conn.type === 'nozzle') {
      const dx = cx - 50, dy = cy - 50;
      const len = Math.hypot(dx, dy) || 1;
      return { x: x + (dx / len) * 14 * scale, y: y + (dy / len) * 14 * scale };
    }
    return { x, y };
  };

    let body = '<defs><marker id="pid-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="3" markerHeight="3" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#1E90FF"/></marker></defs>';

    // ----â”€ pipes: pass 1 â€” route geometry for every pipe â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const geometries = [];
    const labeledLines = new Set();
    const routed = []; // polylines already placed — the router pays to cross/avoid them

    // segment helpers (also used by the crossing-break pass and the refinement loop)
    const segs = (pts) => {
      const out = [];
      for (let i = 1; i < pts.length; i++) out.push([pts[i - 1], pts[i]]);
      return out;
    };
    const crossing = (s1, s2) => {
      const p1 = s1[0], p2 = s1[1], p3 = s2[0], p4 = s2[1];
      const h1 = p1.y === p2.y, h2 = p3.y === p4.y;
      if (h1 === h2) return null; // parallel
      const h = h1 ? s1 : s2, v = h1 ? s2 : s1;
      const hx1 = h[0].x, hx2 = h[1].x, cy = h[0].y;
      const vx = v[0].x, vy1 = v[0].y, vy2 = v[1].y;
      if (vx < Math.min(hx1, hx2) + 1 || vx > Math.max(hx1, hx2) - 1) return null;
      if (cy < Math.min(vy1, vy2) + 1 || cy > Math.max(vy1, vy2) - 1) return null;
      return { x: vx, y: cy };
    };

    // route one pipe (stubs + via + orthogonalize + A*) against the routed pool.
    // hardLines (optional): polylines whose cells are BLOCKED — the route cannot
    // touch them (used by refinement to forbid overlaps)
    const routeOne = (p, pA, pB, routedPool, hardLines) => {
      const a = byId[p.from], b = byId[p.to];
      const stub = view.stubLength || 0;
      let effStub = stub;
      if (stub) {
        const spanX = Math.abs(pB.x - pA.x), spanY = Math.abs(pB.y - pA.y);
        effStub = Math.min(stub, spanX / 3 || Infinity, spanY / 3 || Infinity);
      }
      // rule: the straight run at a valve port must extend at least the valve body
      // length in the port orientation before any bend is allowed
      const isValveEnd = (id) => data.valves.some(v => v.id === id);
      if (isValveEnd(p.from) || isValveEnd(p.to)) {
        const spanX = Math.abs(pB.x - pA.x), spanY = Math.abs(pB.y - pA.y);
        effStub = Math.max(effStub, Math.min(14, spanX / 3 || Infinity, spanY / 3 || Infinity));
      }
      const pts = [{ x: pA.x, y: pA.y }];
      if (effStub > 0 && pA.dir) pts.push({ x: pA.x + pA.dir.x * effStub, y: pA.y + pA.dir.y * effStub });
      for (const wp of (p.via || [])) pts.push(wp);
      if (effStub > 0 && pB.dir) pts.push({ x: pB.x + pB.dir.x * effStub, y: pB.y + pB.dir.y * effStub });
      pts.push({ x: pB.x, y: pB.y });
      // orthogonalize: each consecutive pair routes L-shaped (H then V, or V then H),
      // horizontal precedence unless the vertical span clearly dominates (>1.5x)
      const orth = [];
      orth.push({ x: pts[0].x, y: pts[0].y });
      for (let i = 1; i < pts.length; i++) {
        const a2 = pts[i - 1], b2 = pts[i];
        if (Math.abs(b2.x - a2.x) * 1.5 >= Math.abs(b2.y - a2.y)) {
          orth.push({ x: b2.x, y: a2.y }, { x: b2.x, y: b2.y });
        } else {
          orth.push({ x: a2.x, y: b2.y }, { x: b2.x, y: b2.y });
        }
      }
      // grid-align interior bend points (ports stay exact); Rule 71/72
      const g2 = view.grid || 20;
      for (let k = 1; k < orth.length - 1; k++) {
        orth[k].x = Math.round(orth[k].x / g2) * g2;
        orth[k].y = Math.round(orth[k].y / g2) * g2;
      }
      // obstacle-aware routing: detour around component bodies + costed against existing lines
      if (view.route !== 'direct') {
        for (let k = 0; k < orth.length; k++) {
          orth[k] = { x: orth[k].x, y: orth[k].y };
        }
        // note: avoidObstacles may return `orth` itself (direct-route early return) —
        // never empty it in place and re-push from itself, that aliases to []
        return avoidObstacles(orth, data, { a, b, dest: pB }, g2, routedPool, hardLines);
      }
      return orth;
    };

    // process pipes route first (they form the skeleton); signals weave around them
    const routingOrder = pipes.filter(q => q.kind !== 'tap').slice().sort((x, y) => (x.kind === 'signal' ? 1 : 0) - (y.kind === 'signal' ? 1 : 0));
    for (const p of routingOrder) {
      if (p.kind === 'tap') continue; // explicit taps are drawn at instrument render time
      // topology was resolved authoritatively in resolveTopology(); the renderer never guesses
      const pA = p._from, pB = p._to;
      if (!pA || !pB) continue; // invalid topology: refused at model stage, no geometry

      const orth = routeOne(p, pA, pB, routed);
      routed.push({ poly: orth });

      const signal = p.kind === 'signal';
      const style = signal
        ? (p.signalType === 'pneumatic' ? { dash: '', double: true }
          : p.signalType === 'hydraulic' ? { dash: '8 5', double: true }
          : p.signalType === 'capillary' ? { dash: '12 4 2 4' }
          : p.signalType === 'digital' ? { dash: '1 4' }
          : { dash: '8 5' })   // electrical default
        : { dash: '' };

      geometries.push({
        p, pts: orth, signal, style,
        stroke: signal ? '#444' : (p.stroke || '#1E90FF'),
        width: signal ? 0.4 : 0.6,
        label: p.label && !view.hideLabels ? p.label : null,
        labelOnce: p.line && labeledLines.has(p.line),
        pA, pB
      });
      if (p.line) labeledLines.add(p.line);
    }

    // ---- refinement: rip-up & re-route the worst process lines a few times ----
    // Removes order dependence (the greedy one-shot routes in DSL order) and lets
    // badly placed lines get a second chance once their neighbors are in place.
    // a real crossing must be well inside both segments — junction/port meetings
    // (shared endpoints) are not crossings
    const isRealCrossing = (si, sj) => {
      const x = crossing(si, sj);
      if (!x) return false;
      for (const s of [si, sj]) {
        if (Math.hypot(x.x - s[0].x, x.y - s[0].y) < 4) return false;
        if (Math.hypot(x.x - s[1].x, x.y - s[1].y) < 4) return false;
      }
      return true;
    };
    const refineRoutes = () => {
      const segListOf = (geoms) => geoms.map(g => g.pts.length < 2 ? [] : segs(g.pts));
      const countPer = (geoms, segList) => {
        const per = geoms.map(() => 0);
        for (let i = 0; i < geoms.length; i++) {
          if (!segList[i].length) continue;
          for (let j = i + 1; j < geoms.length; j++) {
            if (!segList[j].length) continue;
            for (const si of segList[i]) for (const sj of segList[j]) {
              if (isRealCrossing(si, sj)) { per[i]++; per[j]++; }
            }
          }
        }
        return per;
      };
      // collinear overlaps between line pairs (segments on the same corridor)
      const overlapPairs = (geoms, segList) => {
        const pairs = [];
        for (let i = 0; i < geoms.length; i++) {
          if (!segList[i].length) continue;
          for (let j = i + 1; j < geoms.length; j++) {
            if (!segList[j].length) continue;
            for (const si of segList[i]) for (const sj of segList[j]) {
              const h1 = Math.abs(si[0].y - si[1].y) < 0.5, h2 = Math.abs(sj[0].y - sj[1].y) < 0.5;
              let ol = 0;
              if (h1 && h2 && Math.abs(si[0].y - sj[0].y) < 1) {
                ol = Math.min(Math.max(si[0].x, si[1].x), Math.max(sj[0].x, sj[1].x)) - Math.max(Math.min(si[0].x, si[1].x), Math.min(sj[0].x, sj[1].x));
              } else if (!h1 && !h2 && Math.abs(si[0].x - sj[0].x) < 1) {
                ol = Math.min(Math.max(si[0].y, si[1].y), Math.max(sj[0].y, sj[1].y)) - Math.max(Math.min(si[0].y, si[1].y), Math.min(sj[0].y, sj[1].y));
              }
              if (ol > 3) pairs.push({ i, j, len: ol });
            }
          }
        }
        return pairs;
      };
      // full objective: overlaps dominate (a shared corridor is catastrophic), then
      // crossings, then bends and length
      const objective = (geoms) => {
        const segList = segListOf(geoms);
        const per = countPer(geoms, segList);
        const ovl = overlapPairs(geoms, segList);
        let bends = 0, length = 0;
        for (const g of geoms) {
          const pts = g.pts;
          for (let k = 1; k < pts.length; k++) length += Math.abs(pts[k].x - pts[k - 1].x) + Math.abs(pts[k].y - pts[k - 1].y);
          for (let k = 1; k < pts.length - 1; k++) {
            const p0 = pts[k - 1], p1 = pts[k], p2 = pts[k + 1];
            if (Math.abs((p1.x - p0.x) * (p2.x - p1.x) + (p1.y - p0.y) * (p2.y - p1.y)) < 0.5) bends++;
          }
        }
        const crossings = per.reduce((a, b) => a + b, 0) / 2;
        const overlaps = ovl.reduce((a, p) => a + p.len, 0);
        return { crossings, overlaps, bends, length, score: crossings * 30 + overlaps * 2000 + bends * 2 + length * 0.05 };
      };
      let best = objective(geometries);
      let stall = 0;
      for (let iter = 0; iter < 15 && stall < 2; iter++) {
        const segList = segListOf(geometries);
        const per = countPer(geometries, segList);
        const ovl = overlapPairs(geometries, segList);
        const ovlPer = geometries.map(() => 0);
        for (const p of ovl) { ovlPer[p.i] += p.len; ovlPer[p.j] += p.len; }
        // worst offenders among process lines (weighted: overlaps >> crossings)
        const worst = geometries.map((g, i) => ({ i, c: per[i] * 20 + ovlPer[i] * 500, g }))
          .filter(x => x.c > 0 && x.g.p.kind !== 'signal')
          .sort((a, b) => b.c - a.c).slice(0, 3);
        if (!worst.length) break;
        const worstIdx = new Set(worst.map(w => w.i));
        const pool = geometries.map((g, i) => ({ poly: g.pts })).filter((_, i) => !worstIdx.has(i));
        let changed = false;
        for (const w of worst) {
          const g = w.g;
          const old = g.pts;
          // lines this one overlaps become HARD blockers on re-route (no new overlap possible)
          const partners = ovl.filter(p => p.i === w.i || p.j === w.i).map(p => geometries[p.i === w.i ? p.j : p.i].pts);
          const before = objective(geometries).score;
          g.pts = routeOne(g.p, g.pA, g.pB, pool, partners.length ? partners : undefined);
          if (objective(geometries).score < before) { changed = true; best = objective(geometries); }
          else g.pts = old;
        }
        if (!changed) { stall++; } else { stall = 0; }
      }
    };
    refineRoutes();

    // ----â”€ pipes: pass 2 â€” find crossings; the later-drawn (upper) pipe breaks â”€â”€â”€â”€
    const breaks = geometries.map(() => []);
    for (let i = 0; i < geometries.length; i++) {
      for (let j = i + 1; j < geometries.length; j++) {
        for (const si of segs(geometries[i].pts)) {
          for (const sj of segs(geometries[j].pts)) {
            const x = crossing(si, sj);
            if (x) breaks[j].push(x); // upper pipe (later index) breaks
          }
        }
      }
    }

    // ----â”€ pipes: pass 3 â€” emit paths with gap breaks at crossings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let pipesSvg = '';
    const GAP = 4;          // visual gap cut at a crossing
    const MIN_RUN = 6;      // min straight run each side of a gap (no bend right after a crossing)
    for (let i = 0; i < geometries.length; i++) {
      const g = geometries[i];
      const pts = g.pts;
      const bks = breaks[i];
      // emit segment-by-segment, cutting clean gaps at crossing points in order along
      // each segment (multiple breaks per segment must not create stale M-jumps).
      // A gap is only cut when there is >= MIN_RUN of straight line on both sides,
      // so the line never turns immediately after a crossing. The path ALWAYS starts
      // at the true segment start (a gap cut must not drop the leading run).
      let d = '';
      for (let k = 1; k < pts.length; k++) {
        const prev = pts[k - 1], cur = pts[k];
        const horiz = prev.y === cur.y;
        const len = horiz ? Math.abs(cur.x - prev.x) : Math.abs(cur.y - prev.y);
        const cuts = bks
          .filter(b => horiz ? (Math.abs(b.y - prev.y) < 1 && b.x > Math.min(prev.x, cur.x) && b.x < Math.max(prev.x, cur.x))
                              : (Math.abs(b.x - prev.x) < 1 && b.y > Math.min(prev.y, cur.y) && b.y < Math.max(prev.y, cur.y)))
          .map(b => (horiz ? b.x - prev.x : b.y - prev.y) / len)
          .filter(t => t > (GAP + MIN_RUN) / len && t < 1 - (GAP + MIN_RUN) / len)
          .sort((a, b) => a - b);
        if (!d) d = `M ${prev.x} ${prev.y}`;
        if (!cuts.length) {
          d += ` L ${cur.x} ${cur.y}`;
          continue;
        }
        for (const t of cuts) {
          const atX = horiz ? prev.x + (cur.x - prev.x) * t : prev.x;
          const atY = horiz ? prev.y : prev.y + (cur.y - prev.y) * t;
          const gx1 = horiz ? atX - GAP : atX, gy1 = horiz ? atY : atY - GAP;
          const gx2 = horiz ? atX + GAP : atX, gy2 = horiz ? atY : atY + GAP;
          d += ` L ${gx1} ${gy1}`;
          d += ` M ${gx2} ${gy2}`;
        }
        d += ` L ${cur.x} ${cur.y}`;
      }
      if (!d) continue;
      const marker = g.signal ? '' : ' marker-end="url(#pid-arrow)"';
      const cls = g.signal ? 'pid-line pid-signal' : 'pid-line pid-process';
      const ends = ` data-from="${g.p.from}" data-to="${g.p.to}"`;
      if (g.style.double) {
        pipesSvg += `<path d="${d}" class="${cls}"${ends} fill="none" stroke="${g.stroke}" stroke-width="${g.width}" stroke-dasharray="${g.style.dash}" transform="translate(0 -4)"/>`;
        pipesSvg += `<path d="${d}" class="${cls}"${ends} fill="none" stroke="${g.stroke}" stroke-width="${g.width}" stroke-dasharray="${g.style.dash}" transform="translate(0 4)"/>`;
      } else {
        pipesSvg += `<path d="${d}" class="${cls}"${ends} fill="none" stroke="${g.stroke}" stroke-width="${g.width}" stroke-dasharray="${g.style.dash}"${marker}/>`;
      }
    }
    // labels after all paths so they sit on top
    for (const g of geometries) {
      if (!g.label || g.labelOnce) continue;
      const pA = g.pA, pB = g.pB;
      const lx = (pA.x + pB.x) / 2;
      const horiz = Math.abs(pA.y - pB.y) < Math.abs(pA.x - pB.x);
      const minY = Math.min(pA.y, pB.y);
      const clear = (x, y) => {
        if ([...equipment, ...valves].some(e => {
          const s = sizeOf(e);
          return x > e.x - s / 2 - 6 && x < e.x + s / 2 + 6 && y > e.y - s / 2 - 6 && y < e.y + s / 2 + 6;
        })) return false;
        if (junctions.some(j => Math.abs(j.x - x) < 8 && y > Math.min(j.y, minY) - 8 && y < Math.max(j.y, minY) + 8)) return false;
        if (instruments.some(i => Math.abs(i.x - x) < 22 && Math.abs(i.y - y) < 30)) return false;
        return true;
      };
      const candidates = horiz
        ? [{ x: lx, y: minY - 16 }, { x: lx, y: minY + 18 }, { x: lx - 70, y: minY - 6 }, { x: lx + 70, y: minY - 6 }]
        : [{ x: lx + 3, y: minY + 1 }, { x: lx - 3, y: minY + 1 }, { x: lx + 3, y: minY - 3 }, { x: lx - 3, y: minY - 3 }];
      let pos = candidates[0];
      for (const c of candidates) {
        if (clear(c.x, c.y)) { pos = c; break; }
      }
      pipesSvg += `<text x="${pos.x}" y="${pos.y}" text-anchor="middle" font-size="${fs(2.6)}" font-style="italic" fill="#0D47A1" paint-order="stroke" stroke="white" stroke-width="3">${esc(g.label)}</text>`;
    }

    // entity groups (chips optional; pipes are drawn above everything)
    for (const e of equipment) {
      if (!shown(e, 'equipment')) continue;
      const s = sizeOf(e);
      let g = '';
      if (view.chips) g += chip(e.x, e.y, s, e.id);
      g += embedSymbol(glyphKeyOf(e), e.x, e.y, s, e.rotation);
      if (!view.hideLabels) {
        const tag = e.tag || e.id;
        // tag below the equipment, close to the symbol
        const ty = e.y + s / 2 + 2;
        g += `<text x="${e.x}" y="${ty}" text-anchor="middle" font-size="${fs(3.2)}" font-weight="bold" fill="#111" text-decoration="underline" paint-order="stroke" stroke="white" stroke-width="3">${esc(tag)}</text>`;
        if (!e.noTypeLabel) g += `<text x="${e.x}" y="${ty + 3.5}" text-anchor="middle" font-size="${fs(2.8)}" fill="#666" paint-order="stroke" stroke="white" stroke-width="3">${esc(TYPE_LABELS[e.type] || e.type)}</text>`;
      }
      body += `<g data-pid-id="${e.id}">${g}</g>`;
    }
    for (const v of valves) {
      if (!shown(v, 'valves')) continue;
      const s = sizeOf(v);
      let g = '';
      if (view.chips) g += chip(v.x, v.y, s, v.id);
      g += embedSymbol(glyphKeyOf(v), v.x, v.y, s, v.rotation);
      if (!view.hideLabels) {
        const tag = v.tag || v.id;
        const vertical = ((v.rotation || 0) % 180) !== 0;
        // tag below for horizontal valves, to the right for vertical (rotated) valves — close to the symbol
        const tx = vertical ? v.x + s / 2 + 3 : v.x;
        const ty = vertical ? v.y + 1 : v.y + s / 2 + 2;
        g += `<text x="${tx}" y="${ty}" ${vertical ? '' : 'text-anchor="middle"'} font-size="${fs(3.0)}" font-weight="bold" fill="#111" paint-order="stroke" stroke="white" stroke-width="3">${esc(tag)}</text>`;
        if (!v.noTypeLabel) g += `<text x="${tx}" y="${ty + 3.5}" ${vertical ? '' : 'text-anchor="middle"'} font-size="${fs(2.8)}" fill="#666" paint-order="stroke" stroke="white" stroke-width="3">${TYPE_LABELS[v.type] || v.type}</text>`;
      }
      body += `<g data-pid-id="${v.id}">${g}</g>`;
    }
  for (const inst of instruments) {
    if (!shown(inst, 'instruments')) continue;
    let glyph = window.PID_SYMBOLS[glyphKeyOf(inst)] || '';
    const m = inst.tag.match(/^([A-Za-z]{2,})(.*)$/);
    const letters = m ? m[1] : inst.tag;
    const loop = m ? m[2].replace(/^[^A-Za-z0-9]+/, '') : '';
    glyph = glyph.replace(/<text[\s\S]*?<\/text>/g, '');
    let g = '';
    if (view.chips) g += chip(inst.x, inst.y, sizeOf(inst), inst.tag);
    g += embedSymbolRaw(glyph, inst.x, inst.y, sizeOf(inst), inst.rotation);
    if (!view.hideLabels) {
      // full tag inside the bubble: letters + loop number (ISA convention)
      g += `<text x="${inst.x}" y="${inst.y + 0.5}" text-anchor="middle" font-size="${fs(3.2)}" font-weight="bold" fill="#111" paint-order="stroke" stroke="white" stroke-width="3">${esc(letters)}</text>`;
      if (loop) g += `<text x="${inst.x}" y="${inst.y + 4.3}" text-anchor="middle" font-size="${fs(2.6)}" fill="#111" paint-order="stroke" stroke="white" stroke-width="3">${esc(loop)}</text>`;
    }
    // explicit process tap: only drawn when the DSL declares `tap TAG -> ENTITY`
    const tap = pipes.find(p => p.kind === 'tap' && (p.from === inst.tag || p.to === inst.tag));
    if (tap && inst.bubble !== 'dcs') {
      const hostId = tap._tap ? tap._tap.host : (tap.from === inst.tag ? tap.to : tap.from);
      if (hostId) {
        // land on an actual axis-aligned segment of the host's routed polyline
        // (horizontal preferred, vertical accepted — the host pipe may be a short run)
        const hostGeom = geometries.find(gg => gg.p.from === hostId || gg.p.to === hostId);
        const segs = [], vsegs = [];
        if (hostGeom) {
          const pts = hostGeom.pts;
          for (let k = 0; k < pts.length - 1; k++) {
            const s = pts[k], e2 = pts[k + 1];
            if (Math.abs(s.y - e2.y) < 0.5 && Math.abs(s.x - e2.x) > 3) segs.push({ x1: Math.min(s.x, e2.x), x2: Math.max(s.x, e2.x), y: s.y, horiz: true });
            if (Math.abs(s.x - e2.x) < 0.5 && Math.abs(s.y - e2.y) > 3) vsegs.push({ y1: Math.min(s.y, e2.y), y2: Math.max(s.y, e2.y), x: s.x, horiz: false });
          }
        }
        // prefer a horizontal segment the instrument can drop onto; else a vertical one
        // the instrument can reach from the side
        let seg = segs.filter(s => s.y >= inst.y && inst.x >= s.x1 - 2 && inst.x <= s.x2 + 2).sort((a, b) => a.y - b.y)[0];
        let tx = inst.x, fromSide = false;
        if (!seg && segs.length) {
          seg = segs.sort((a, b) => Math.abs(a.y - inst.y) - Math.abs(b.y - inst.y))[0];
          tx = Math.max(seg.x1, Math.min(seg.x2, inst.x));
        }
        if (!seg && vsegs.length) {
          seg = vsegs.filter(s => inst.y >= s.y1 - 2 && inst.y <= s.y2 + 2).sort((a, b) => Math.abs(a.x - inst.x) - Math.abs(b.x - inst.x))[0]
            || vsegs.sort((a, b) => Math.abs(a.x - inst.x) - Math.abs(b.x - inst.x))[0];
          tx = seg.x; fromSide = true;
        }
        if (seg) {
          // orthogonal tap: vertical drop off the bubble, horizontal run, vertical land
          // (no diagonal segments; the line never bends immediately at the landing)
          const r = 4.5 * (data.view.symbolScale || 1);
          const sx = inst.x, sy = inst.y + r;
          let td;
          if (fromSide) {
            // vertical host: run horizontally off the bubble, then down to the host x at seg.y range midpoint
            const landY = Math.min(Math.max(sy + 2, seg.y1 + 2), seg.y2 - 2);
            td = `M ${sx} ${sy} L ${sx} ${landY} L ${tx} ${landY}`;
          } else if (Math.abs(tx - inst.x) < 0.5 || seg.y <= sy + 2) {
            td = `M ${sx} ${sy} L ${sx} ${seg.y}`;
          } else {
            const dropY = Math.min(seg.y - 2, sy + 6);
            td = `M ${sx} ${sy} L ${sx} ${dropY} L ${tx} ${dropY} L ${tx} ${seg.y}`;
          }
          g += `<path d="${td}" stroke="black" stroke-width="1" fill="none" data-pid-id="tap-${inst.tag}"/>`;
        }
      }
    }
    body += `<g data-pid-id="${inst.tag}">${g}</g>`;
  }
  body += pipesSvg;
  for (const j of junctions) {
    body += `<circle cx="${j.x}" cy="${j.y}" r="3.5" fill="#1E90FF" data-pid-id="${j.id}"/>`;
  }

  // nozzles on used connections
  for (const e of [...equipment, ...valves]) {
    if (!shown(e, e.type ? 'equipment' : 'valves')) continue;
    const key = glyphKeyOf(e);
    const size = sizeOf(e);
    const used = data.usedPorts[e.id] || [];
    for (const conn of used) {
      if (conn.type !== 'nozzle') continue;
      const scale = size / 100;
      let cx = conn.x, cy = conn.y;
      if (e.rotation) {
        const r = (e.rotation * Math.PI) / 180;
        cx = (conn.x - 50) * Math.cos(r) - (conn.y - 50) * Math.sin(r) + 50;
        cy = (conn.x - 50) * Math.sin(r) + (conn.y - 50) * Math.cos(r) + 50;
      }
      const at = { x: e.x + (cx - 50) * scale, y: e.y + (cy - 50) * scale };
      const tip = connWorld(e, conn, size);
      body += `<path d="M ${at.x} ${at.y} L ${tip.x} ${tip.y}" stroke="black" stroke-width="2.5" fill="none"/>`;
    }
  }

  svg.innerHTML = wrap + body + (wrap ? '</g>' : '') + annotationsSvg(data, W, H);
  const lineIssues = validateGeometry(data, geometries, pipes);

  // transparency mode: neutralize white glyph fills so overlaps are visible
  if (!view.chips) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = '.sym-fill, .sym-fill-light { fill: none; }';
    svg.appendChild(style);
  }

  // ---- drawing fitness: grouped terms, one comparable total (the fitness meter) ----
  const SHEET = { x0: 26, x1: (data.view.sheetW || 864) - 26, y0: 26, y1: (data.view.sheetH || 559) - 26 };
  let pp = 0, ps = 0, ss = 0, bends = 0, length = 0, nonOrtho = 0, offSheet = 0;
  const segList = geometries.map(g => g.pts.length < 2 ? [] : segs(g.pts));
  for (let i = 0; i < geometries.length; i++) {
    if (!segList[i].length) continue;
    for (let j = i + 1; j < geometries.length; j++) {
      if (!segList[j].length) continue;
      for (const si of segList[i]) for (const sj of segList[j]) {
        if (!isRealCrossing(si, sj)) continue;
        if (geometries[i].signal && geometries[j].signal) ss++;
        else if (geometries[i].signal || geometries[j].signal) ps++;
        else pp++;
      }
    }
  }
  for (const g of geometries) {
    const pts = g.pts;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      length += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
      if (dx > 0.5 && dy > 0.5) nonOrtho++;
      if (a.x < SHEET.x0 || a.x > SHEET.x1 || a.y < SHEET.y0 || a.y > SHEET.y1 ||
          b.x < SHEET.x0 || b.x > SHEET.x1 || b.y < SHEET.y0 || b.y > SHEET.y1) offSheet++;
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      const dot = (p1.x - p0.x) * (p2.x - p1.x) + (p1.y - p0.y) * (p2.y - p1.y);
      if (Math.abs(dot) < 0.5) bends++;
    }
  }
  // annotation collisions: overlap between any two rendered label text boxes
  let labelCollisions = 0;
  const textBoxes = [...svg.querySelectorAll('text')].map(t => t.getBBox());
  for (let i = 0; i < textBoxes.length; i++) {
    for (let j = i + 1; j < textBoxes.length; j++) {
      const a = textBoxes[i], b = textBoxes[j];
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) labelCollisions++;
    }
  }
  // instrument placement: tap reaches and signal runs (already warned on; quantified here)
  let tapReachTotal = 0, maxSignalLen = 0;
  const r = 4.5 * (data.view.symbolScale || 1);
  for (const p of pipes) {
    if (p.kind === 'tap') {
      const inst = data.instruments.find(i => i.tag === p.from);
      if (!inst) continue;
      const hostGeom = geometries.find(gg => gg.p.from === p._tap.host || gg.p.to === p._tap.host);
      if (!hostGeom) continue;
      const pts = hostGeom.pts;
      let best = Infinity;
      for (let k = 0; k < pts.length - 1; k++) {
        const s = pts[k], e2 = pts[k + 1];
        if (Math.abs(s.y - e2.y) < 0.5 && inst.x >= Math.min(s.x, e2.x) - 2 && inst.x <= Math.max(s.x, e2.x) + 2 && s.y >= inst.y) best = Math.min(best, s.y);
      }
      if (best < Infinity) tapReachTotal += Math.max(0, best - (inst.y + r));
    } else if (p.kind === 'signal') {
      const g = geometries.find(gg => gg.p === p);
      if (g) for (let k = 1; k < g.pts.length; k++) maxSignalLen = Math.max(maxSignalLen, Math.abs(g.pts[k].x - g.pts[k - 1].x) + Math.abs(g.pts[k].y - g.pts[k - 1].y));
    }
  }
  const score = {
    total: Math.round(30 * pp + 20 * ps + 10 * ss + 2 * bends + 0.05 * length + 500 * nonOrtho + 500 * offSheet + 30 * labelCollisions + 0.2 * tapReachTotal + 0.2 * maxSignalLen),
    routing: { crossings: pp + ps + ss, pp, ps, ss, bends, length: Math.round(length), nonOrtho },
    sheet: { offSheet },
    annotations: { labelCollisions },
    lines: { overlaps: lineIssues.overlaps, ungapped: lineIssues.ungapped },
    instruments: { tapReachTotal: Math.round(tapReachTotal), maxSignalLen: Math.round(maxSignalLen) }
  };
  svg.__pidScore = score;
  return score;
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ drafting annotations: border, title block, legend, north arrow ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
function annotationsSvg(data, W, H) {
  if (!data.view.fitPage) return '';
  const v = data.view;
  const pad = 18;
  let s = '';

  // border frame (double line)
  s += `<rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}" fill="none" stroke="#333" stroke-width="2"/>`;
  s += `<rect x="${pad + 6}" y="${pad + 6}" width="${W - 2 * pad - 12}" height="${H - 2 * pad - 12}" fill="none" stroke="#333" stroke-width="1"/>`;

  // north arrow, top-right inside the frame
  if (v.northArrow) {
    const na = window.PID_SYMBOLS['pip/layout/north-arrow'] || '';
    if (na) {
      s += `<svg x="${W - 92}" y="${pad + 28}" width="46" height="46" xmlns="http://www.w3.org/2000/svg">${na}</svg>`;
      s += `<text x="${W - 69}" y="${pad + 84}" text-anchor="middle" font-size="11" font-weight="bold" fill="#333">N</text>`;
    }
  }

  // legend, bottom-left inside the frame
  if (v.legend) {
    const lx = pad + 24, ly = H - pad - 48;
    const entries = [
      { key: 'isa-5.1/instruments/field-instrument', label: 'Field instrument', size: 30 },
      { key: 'isa-5.1/instruments/shared-display', label: 'DCS function', size: 30 },
      { key: 'isa-5.1/valves/gate', label: 'Gate valve', size: 26 },
      { key: 'pip/equipment/pump-centrifugal', label: 'Pump', size: 30 },
      { key: 'signal', label: 'Signal line', size: 0 },
      { key: 'line', label: 'Line designation', size: 0 }
    ];
    const rowH = 30, colW = 230;
    s += `<rect x="${lx - 12}" y="${ly - 12 - entries.length * rowH - 26}" width="${colW + 24}" height="${entries.length * rowH + 52}" fill="white" stroke="#333" stroke-width="1.5"/>`;
    s += `<text x="${lx}" y="${ly - entries.length * rowH - 4}" font-size="13" font-weight="bold" fill="#111">LEGEND</text>`;
    entries.forEach((en, i) => {
      const ey = ly - (entries.length - 1 - i) * rowH;
      if (en.key === 'signal') {
        s += `<line x1="${lx}" y1="${ey - 3}" x2="${lx + 46}" y2="${ey - 3}" stroke="#444" stroke-width="1.5" stroke-dasharray="8 5"/>`;
      } else if (en.key === 'line') {
        s += `<text x="${lx}" y="${ey}" font-size="9" font-style="italic" fill="#0D47A1">4"-PG-101-1E1</text>`;
      } else {
        const g = window.PID_SYMBOLS[en.key] || '';
        if (g) s += `<svg x="${lx}" y="${ey - en.size}" width="${en.size}" height="${en.size}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
      }
      s += `<text x="${lx + 58}" y="${ey - 5}" font-size="11" fill="#333">${en.label}</text>`;
    });
  }

  // title block, bottom-right inside the frame (compact)
  if (v.title) {
    const bx = W - pad - 160, by = H - pad - 60, bw = 160, bh = 60;
    s += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="white" stroke="#333" stroke-width="1.5"/>`;
    s += `<line x1="${bx}" y1="${by + 17}" x2="${bx + bw}" y2="${by + 17}" stroke="#333" stroke-width="1"/>`;
    s += `<text x="${bx + 8}" y="${by + 12}" font-size="8" font-weight="bold" fill="#111">${esc(v.title)}</text>`;
    if (v.project) s += `<text x="${bx + 8}" y="${by + 26}" font-size="6" fill="#333">Project: ${esc(v.project)}</text>`;
    if (v.sheet) s += `<text x="${bx + 8}" y="${by + 35}" font-size="6" fill="#333">Sheet ${v.sheet}${v.sheetTotal !== v.sheet ? ' of ' + v.sheetTotal : ''}</text>`;
    if (v.rev) s += `<text x="${bx + 8}" y="${by + 44}" font-size="6" fill="#333">Rev ${v.rev.mark} (${v.rev.date})${v.rev.desc ? ' - ' + v.rev.desc : ''}</text>`;
    s += `<text x="${bx + 8}" y="${by + 54}" font-size="5" fill="#666">P&amp;ID Gen ${new Date().toISOString().slice(0, 10)}</text>`;
  }

  return s;
}

function chip(x, y, size, pidId) {
  const attr = pidId ? ` data-pid-id="${pidId}"` : '';
  return `<rect x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" fill="white"${attr}/>`;
}

function embedSymbol(key, cx, cy, size, rotation) {
  return embedSymbolRaw(window.PID_SYMBOLS[key], cx, cy, size, rotation);
}

function embedSymbolRaw(glyph, cx, cy, size, rotation) {
  if (!glyph) return '';
  if (rotation) {
    const t = ` transform="translate(${cx - size / 2} ${cy - size / 2}) rotate(${rotation} ${size / 2} ${size / 2})"`;
    // glyph carries its own natural mm viewBox — embed at 1:1
    return `<svg${t} width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${glyph}</svg>`;
  }
  return `<svg x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${glyph}</svg>`;
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ public API ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
window.PIDGenerator = {
  parse(source) {
    const data = PID_PARSER.parse(source);
    return { data, warnings: data.warnings, errors: data.errors, info: data.info };
  },
  renderPid(source, containerId) {
    const data = PID_PARSER.parse(source);
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`PIDGenerator: container #${containerId} not found`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', containerId + '-svg');
    svg.setAttribute('role', 'img');
    container.innerHTML = '';
    container.appendChild(svg);
    const score = renderInto(svg, data);
    return { svg: svg.outerHTML, warnings: data.warnings, errors: data.errors, info: data.info, score, data };
  },
  // regenerate DSL source from the model (used by drag-to-move export)
  toSource(data) {
    const lines = ['pid'];
    const v = data.view;
    if (data.schemaVersion) lines.push(`version ${data.schemaVersion}`);
    if (v.layout === 'auto') lines.push('layout auto');
    if (v.fitPage) lines.push('fit page');
    if (v.stubLength !== 8) lines.push(`stub ${v.stubLength}`);
    if (v.grid !== 5) lines.push(`grid ${v.grid}`);
    if (!v.chips) lines.push('chips off');
    if (v.legend) lines.push('legend on');
    if (v.northArrow) lines.push('north-arrow on');
    if (v.title) lines.push(`title "${v.title}"`);
    if (v.project) lines.push(`project "${v.project}"`);
    if (v.sheet) lines.push(`sheet ${v.sheet}${v.sheetTotal && v.sheetTotal !== v.sheet ? ' of ' + v.sheetTotal : ''}`);
    if (v.rev) lines.push(`rev "${v.rev.mark}" "${v.rev.date}"${v.rev.desc ? ` "${v.rev.desc}"` : ''}`);
    if (v.show !== 'all') lines.push(`show ${v.show}`);
    if (v.hideLabels) lines.push('hide labels');
    for (const [id, d] of Object.entries(data.lineDefs)) {
      const fields = ['size', 'service', 'number', 'spec', 'ins', 'thick', 'trace']
        .filter(k => d[k]).map(k => `${k} ${d[k]}`).join(' ');
      lines.push(`line ${id} ${fields}`);
    }
    const pos = (e) => ` at ${Math.round(e.x)},${Math.round(e.y)}`;
    const modifiers = (e) => {
      let m = '';
      if (e.rotation) m += ` rotated ${e.rotation}`;
      if (e.symbol) m += ` symbol "${e.symbol}"`;
      if (e.scale) m += ` scale ${e.scale}`;
      if (e.stroke) m += ` stroke "${e.stroke}"`;
      if (e.tag) m += ` tag "${e.tag}"`;
      if (e.tagAbove) m += ' tag-above';
      if (e.noTypeLabel) m += ' no-type-label';
      if (e.bubble) m += ` ${e.bubble}`;
      return m;
    };
    for (const e of data.equipment) lines.push(`equipment ${e.id} ${e.type}${pos(e)}${modifiers(e)}`);
    for (const vv of data.valves) lines.push(`valve ${vv.id} ${vv.type}${pos(vv)}${modifiers(vv)}`);
    for (const i of data.instruments) lines.push(`instrument ${i.tag}${pos(i)}${modifiers(i)}`);
    for (const j of data.junctions) lines.push(`${j.stub ? "stub" : "junction"} ${j.id} at ${Math.round(j.x)},${Math.round(j.y)}`);
    for (const p of data.pipes) {
      const src = p.fromPort ? `${p.from}.${p.fromPort}` : p.from;
      const tgt = p.toPort ? `${p.to}.${p.toPort}` : p.to;
      if (p.kind === 'signal') { lines.push(`signal ${src} -> ${tgt} ${p.signalType}`); continue; }
      let l = `${src} -> ${tgt}`;
      for (const wp of (p.via || [])) l += ` via ${Math.round(wp.x)},${Math.round(wp.y)}`;
      if (p.line) l += ` line ${p.line}`;
      else if (p.label) l += ` "${p.label.replace(/"/g, '\\"')}"`;
      lines.push(l);
    }
    return lines.join('\n');
  }
};
