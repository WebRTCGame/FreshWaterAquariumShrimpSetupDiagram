// Sheet preview — render the finished drawing to PNG so it can be LOOKED AT.
//
// Why this exists: every layout judgement in this project was made by rendering a
// sheet and looking at it. Twice a change that improved the scalar score had to be
// reverted because the sheet was visibly worse, and twice a "fix" turned out to be
// dead code that moved no metric at all. A score cannot express "reads like a
// drawing" — a picture can. This makes looking at the output one command, for
// whoever is holding the pencil, without a screenshot round-trip.
//
// Outputs land in the repo so they can be opened directly:
//   <out>/<case>.png          full sheet, print proportions
//   <out>/_contact.png        all cases on one labelled sheet — the review view
//
// Usage:
//   node preview.mjs                              contact sheet of everything
//   node preview.mjs --case=demo                  one full-size sheet
//   node preview.mjs --case=demo --zoom=X,Y,W,H   magnified crop, mm coords
//   node preview.mjs --theme=cad                  CAD (black) theme instead of print
//   node preview.mjs --out=regress/preview        output directory
//   node preview.mjs --width=2400                 raster width (default 1600)
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const has = (k) => process.argv.includes(`--${k}`);

const WIDTH = parseInt(arg('width', '1600'), 10);
const THEME = arg('theme', 'print');
const OUT = arg('out', 'regress/preview');
const ZOOM = arg('zoom', null);
const ONLY = arg('case', null);
const CONTACT = !ONLY && !ZOOM;

const CASES = [
  { name: 'spike', src: 'regress/spike.dsl' },
  { name: 'dense', src: 'regress/dense.dsl' },
  { name: 'min', src: 'regress/min.dsl' },
  { name: 'split', src: 'regress/split.dsl' },
  { name: 'demo', src: null },            // the pid-spike.html DSL, i.e. the real page
];
const cases = ONLY ? CASES.filter((c) => c.name === ONLY) : CASES;
if (!cases.length) { console.error(`no such case: ${ONLY}`); process.exit(1); }
// Ad-hoc fixture escape hatch. The corpus above is the blessed set, but symbol- and
// geometry-probes are throwaway DSL that must be LOOKED at before any conclusion is
// believable — and every previous phantom in this project came from a conclusion
// drawn without looking. `--src=regress/_foo.dsl` reviews any file.
const SRCARG = arg('src', null);
if (SRCARG) cases.splice(0, cases.length, { name: arg('name', 'adhoc'), src: SRCARG });
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const tmp = mkdtempSync(join(tmpdir(), 'prev-'));
const CH = (args) => execFileSync(CHROME, args, { stdio: 'ignore' });

// Render one sheet: node -> SVG, then headless Chrome -> PNG.
// A FRESH --user-data-dir every time: Chrome caches file:// scripts by URL, and
// that staleness produced a convincing but wrong screenshot earlier in this project.
function render(c) {
  const svgPath = join(tmp, `${c.name}.svg`);
  const a = ['harness2.mjs', svgPath];
  if (c.src) a.push(`--src=${c.src}`);
  const opts = THEME === 'cad' ? [] : [];
  void opts;
  try { execFileSync('node', a, { encoding: 'utf8', stdio: 'pipe' }); }
  catch (e) { console.error(`${c.name}: render FAILED\n${(e.stdout || '') + (e.stderr || '')}`.slice(0, 800)); return null; }

  let svg = readFileSync(svgPath, 'utf8');
  if (process.env.PREVIEW_DEBUG) {
    console.error(`  [dbg] ${c.name}: ${svg.length} bytes, src=${c.src}`);
    const ids = [...svg.matchAll(/data-pid-id="([^"]+)"/g)].map((m) => m[1]);
    console.error(`  [dbg] ids: ${ids.join(' ')}`);
  }
  const m = svg.match(/viewBox="([^"]+)"/);
  if (!m) { console.error(`${c.name}: no viewBox in SVG`); return null; }
  const vb = m[1].split(/[\s,]+/).map(Number);

  // --zoom works in SHEET millimetres, which is the only coordinate system anyone
  // reading a P&ID has. mm -> px at the sheet's own scale, then magnify.
  if (ZOOM) {
    const [zx, zy, zw, zh] = ZOOM.split(',').map(Number);
    if (![zx, zy, zw, zh].every(Number.isFinite)) { console.error('--zoom needs X,Y,W,H in mm'); return null; }
    // Say what is on screen, in sheet mm. Three phantoms in a row came from
    // reading conclusions off a magnified raster instead of geometry (§9.35, 9.38,
    // 9.40). The eye needs something to check against, not a guess.
    const mmPerPx = zh / (WIDTH * zh / zw);
    console.log(`  region: x ${zx}..${zx + zw} mm, y ${zy}..${zy + zh} mm  (${mmPerPx.toFixed(3)} mm/px)`);
    console.log(`  scale : ${(zw / mmPerPx).toFixed(1)}x linear vs the 1:1 sheet`);
    const k = WIDTH / vb[2];                              // px per mm at full sheet
    const px = (zx - vb[0]) * k, py = (zy - vb[1]) * k;
    const pw = zw * k, ph = zh * k;
    // Wrap the region in its own viewBox so Chrome crops to it. The captured
    // attribute string STILL CONTAINS the original viewBox, and a duplicate
    // attribute is resolved first-wins — so it must be stripped or the crop is
    // silently ignored and you get the whole sheet back. (It did, first time.)
    const gx = vb[0] + px / k, gy = vb[1] + py / k, gw = pw / k, gh = ph / k;
    const cropped = svg.replace(/^([\s\S]*?)<svg([^>]*)>/, (all, pre, at) => {
      const cleaned = at.replace(/\s*viewBox="[^"]*"/i, '');
      return `${pre}<svg${cleaned} viewBox="${gx} ${gy} ${gw} ${gh}">`;
    });
    if (cropped === svg) { console.error(`${c.name}: could not rewrite the root viewBox for --zoom`); return null; }
    const H = Math.round((WIDTH * ph) / pw);
    return shoot(c.name, cropped, WIDTH, H);
  }

  const H = Math.round((WIDTH * vb[3]) / vb[2]);
  return shoot(c.name, svg, WIDTH, H);
}

function shoot(name, svg, w, h) {
  const forced = svg.replace(/<svg([^>]*?)>/, (all, at) => {
    const a = at.replace(/\s*width="[^"]*"/, '').replace(/\s*height="[^"]*"/, '');
    return `<svg${a} width="${w}" height="${h}">`;
  });
  const dir = mkdtempSync(join(tmp, name + '-'));
  const page = join(dir, 'a.html');
  writeFileSync(page, `<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#fff;overflow:hidden}svg{display:block}</style>${forced}`);
  const png = join(OUT, `${name}.png`);
  CH(['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--user-data-dir=${mkdtempSync(join(tmp, 'ud-'))}`,
    `--screenshot=${resolve(png)}`, `--window-size=${w},${h}`,
    '--default-background-color=ffffff', '--force-device-scale-factor=1',
    '--virtual-time-budget=4000', 'file:///' + page.replace(/\\/g, '/')]);
  return { name, png, w, h };
}

// Contact sheet: lay every rendered case out on one labelled page, so the whole
// corpus can be reviewed in a single look instead of one file at a time.
function contactSheet(rendered) {
  const COLS = rendered.length <= 2 ? rendered.length : rendered.length <= 4 ? 2 : 3;
  const cw = 620, ch = Math.round(cw * (rendered[0].h / rendered[0].w)), pad = 26, lab = 30;
  const rows = Math.ceil(rendered.length / COLS);
  const W = COLS * cw + (COLS + 1) * pad;
  const H = rows * (ch + lab + 16) + (rows + 1) * pad;
  const imgs = rendered.map((r) => ({ name: r.name, b64: readFileSync(r.png).toString('base64') }));
  // a mm ruler on each thumbnail, so "is that line 3mm or 30mm?" is answerable
  // by eye instead of by guesswork
  const sheetW = 864, cwmm = sheetW * (cw / rendered[0].w);

  const html = `<!doctype html><meta charset=utf-8><style>
html,body{margin:0;background:#f4f4f4;font:13px/1.2 -apple-system,Segoe UI,Roboto,sans-serif}
.grid{display:grid;grid-template-columns:repeat(${COLS},${cw}px);gap:${pad}px;padding:${pad}px;width:max-content}
figure{margin:0;background:#fff;border:1px solid #bbb;box-shadow:0 1px 3px rgba(0,0,0,.12)}
figcaption{padding:6px 9px;font-weight:600;color:#222;border-bottom:1px solid #ddd;display:flex;justify-content:space-between}
img{display:block;width:${cw}px}
.ruler{position:relative;height:16px;font:10px/1 monospace;color:#555}
.ruler i{position:absolute;top:0;bottom:0;border-left:1px solid #999}
.ruler b{position:absolute;top:1px;font-weight:400;transform:translateX(2px)}
</style><div class=grid id=g></div><script>
const D=${JSON.stringify(imgs)}, COLS=${COLS}, CWMM=${cwmm}, CW=${cw};
Promise.all(D.map(d=>new Promise(r=>{const i=new Image();i.onload=()=>r({d,i});i.src='data:image/png;base64,'+d.b64;})))
.then(items=>{const g=document.getElementById('g');
 for(const {d,i} of items){const f=document.createElement('figure');
  f.innerHTML='<figcaption><span>'+d.name+'</span><span style="font-weight:400;color:#666">'+i.width+'x'+i.height+'</span></figcaption>';
  f.appendChild(i);
  // 50mm scale bar with ticks every 10mm, so distances are readable not guessed.
  // px/mm must use the DISPLAYED width (cw), not the image's native width —
  // using native overflowed the figure by 2.5x and pushed ticks into the next
  // grid cell.
  const pxPerMm=CW/CWMM, r=document.createElement('div'); r.className='ruler';
  r.style.width=CW+'px';
  for(let mm=0;mm<=Math.floor(CWMM/10)*10;mm+=10){const px=mm*pxPerMm;
    if(px>CW-2) break;
    r.innerHTML+='<i style="left:'+px+'px;height:'+(mm%50===0?16:8)+'px"></i>'+(mm%50===0?'<b style="left:'+px+'px">'+mm+'</b>':'');}
  f.appendChild(r); g.appendChild(f);}
 document.title='done';});
</script>`;
  const dir = mkdtempSync(join(tmp, 'contact-'));
  const page = join(dir, 'a.html');
  writeFileSync(page, html);
  const png = join(OUT, '_contact.png');
  CH(['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--user-data-dir=${mkdtempSync(join(tmp, 'ud-'))}`,
    `--screenshot=${resolve(png)}`, `--window-size=${W},${H}`,
    '--default-background-color=ffffff', '--virtual-time-budget=9000',
    'file:///' + page.replace(/\\/g, '/')]);
  return { png, W, H };
}

// ---- run ---------------------------------------------------------------------
const themeNote = THEME === 'cad' ? ' [cad theme]' : '';
console.log(`PREVIEW${themeNote}  ${cases.length} case(s)  ${WIDTH}px  -> ${OUT}/`);
const rendered = [];
for (const c of cases) {
  const r = render(c);
  if (r) { rendered.push(r); console.log(`  ${r.name.padEnd(6)} ${r.w}x${r.h}  ${r.png}`); }
  else console.log(`  ${c.name.padEnd(6)} FAILED`);
}
if (CONTACT && rendered.length > 1) {
  const cs = contactSheet(rendered);
  console.log(`\n  contact sheet ${cs.W}x${cs.H}  ${cs.png}`);
}
try { rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\nOpen ${OUT}\\ directly, or read the PNGs back.`);
