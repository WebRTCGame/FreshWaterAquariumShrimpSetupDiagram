const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'index.html');
let s = fs.readFileSync(file, 'utf8');
const startMarker = '// graphDefinition moved to js/graph.js (window.GRAPH_DEFINITION)';
const endMarker = "const { svg } = await mermaid.render('mySvgId', graphDefinition.trim());";
const i = s.indexOf(startMarker);
const j = s.indexOf(endMarker);
if (i === -1 || j === -1) {
  console.error('Markers not found', i, j);
  process.exit(1);
}
const before = s.slice(0, i);
const after = s.slice(j);
const newMiddle = startMarker + '\n        // full graph moved to js/graph.js (window.GRAPH_DEFINITION)\n\n';
const ns = before + newMiddle + after;
fs.writeFileSync(file, ns, 'utf8');
console.log('Removed inline graph block');