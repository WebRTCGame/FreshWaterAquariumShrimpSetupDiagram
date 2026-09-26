// Visual regression baseline (redesign plan T0.1/T0.2).
//
// WHY THIS EXISTS: every layout judgement in this project has been made by
// rendering a PNG and looking at it. Twice a change that improved the scalar
// score had to be reverted because the drawing was visibly worse, and twice a
// "fix" turned out to be dead code that moved no metric at all. A scalar total
// cannot express "reads like a drawing". This turns that habit into a gate.
//
// THREE MEASURES, because each catches what the others miss:
//   1. PIXEL  — fraction of pixels differing beyond a per-channel threshold.
//               Catches any geometric move at all.
//   2. INK    — non-white coverage of each image. Catches a sheet going empty,
//               linework exploding, or a symbol silently vanishing (this is what
//               found the clipped PSV spring).
//   3. BLOCKS — 16x16 grid of per-block mean luminance difference. Catches a
//               change LOCALISED to part of the sheet, which a whole-image
//               average can hide.
//
// Reporting by default; `--fail` promotes it to a gate.
//
// Usage:
//   node visual-regress.mjs              compare against baselines
//   node visual-regress.mjs --bless      (re)write baselines
//   node visual-regress.mjs --fail       exit 1 on any regression
//   node visual-regress.mjs --case=demo  one case
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DIR = 'regress/visual';
const W = 1600;                       // fixed raster width; height follows the sheet aspect
const PIXEL_TOL = 24;                 // per-channel delta that counts as "different"
const INK_TOL = 0.0025;               // coverage delta that counts as a change
const BLOCK_TOL = 6;                  // mean-luma delta per 16x16 block
const BLESS = process.argv.includes('--bless');
const FAIL = process.argv.includes('--fail');
const onlyArg = process.argv.find((a) => a.startsWith('--case='));
const ONLY = onlyArg ? onlyArg.slice(7) : null;

const CASES = [
  { name: 'spike', src: 'regress/spike.dsl' },
  { name: 'dense', src: 'regress/dense.dsl' },
  { name: 'min', src: 'regress/min.dsl' },
  { name: 'split', src: 'regress/split.dsl' },
  { name: 'demo', src: null },        // pid-spike.html's own DSL
];
const cases = ONLY ? CASES.filter((c) => c.name === ONLY) : CASES;

if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const tmpRoot = mkdtempSync(join(tmpdir(), 'visreg-'));

// ---- render one sheet to PNG -------------------------------------------------
// A FRESH --user-data-dir per run: Chrome caches file:// scripts by URL, and the
// ?v= query strings in the demo pages mean a stale render is otherwise possible.
// That staleness produced a convincing but wrong screenshot earlier in this project.
function renderPng(name, src) {
  const svgPath = join(tmpRoot, `${name}.svg`);
  const args = ['harness2.mjs', svgPath];
  if (src) args.push(`--src=${src}`);
  try { execFileSync('node', args, { encoding: 'utf8', stdio: 'pipe' }); }
  catch (e) { console.error(`  ${name}: render failed\n${(e.stdout || '') + (e.stderr || '')}`); return null; }

  const svg = readFileSync(svgPath, 'utf8');
  const m = svg.match(/viewBox="([^"]+)"/);
  if (!m) { console.error(`  ${name}: no viewBox`); return null; }
  const vb = m[1].split(/[\s,]+/).map(Number);
  const H = Math.round((W * vb[3]) / vb[2]);
  const forced = svg.replace(/<svg([^>]*?)>/, (all, at) => {
    const a = at.replace(/\s*width="[^"]*"/, '').replace(/\s*height="[^"]*"/, '');
    return `<svg${a} width="${W}" height="${H}">`;
  });
  const pageDir = mkdtempSync(join(tmpRoot, `${name}-`));
  const page = join(pageDir, 'a.html');
  writeFileSync(page, `<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#fff;overflow:hidden}svg{display:block}</style>${forced}`);

  // The current render must go to a TEMP path, never to DIR/<name>.png. Writing
  // it to the baseline path means compare() reads the baseline back as "current"
  // and every comparison is baseline-against-itself — a harness that always
  // reports "same". That bug shipped in the first cut of this file and was only
  // caught because I deliberately perturbed a rule and expected the number to
  // move. Do not "simplify" this path back to DIR.
  const png = BLESS ? join(DIR, `${name}.png`) : join(tmpRoot, `${name}.cur.png`);
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--user-data-dir=${mkdtempSync(join(tmpRoot, 'ud-'))}`,
    `--screenshot=${resolve(png)}`, `--window-size=${W},${H}`,
    '--default-background-color=ffffff', '--force-device-scale-factor=1',
    '--virtual-time-budget=4000', 'file:///' + page.replace(/\\/g, '/')], { stdio: 'ignore' });
  return { png, W, H };
}

// ---- compare two PNGs in one Chrome pass ------------------------------------
// Canvas pixel access is the only diff available without adding a dependency, so
// the browser does the arithmetic and reports JSON through document.title.
function compare(name, cur, base) {
  const b64c = readFileSync(cur).toString('base64');
  const b64b = readFileSync(base).toString('base64');
  const html = `<!doctype html><meta charset=utf-8><body><script>
const T=${PIXEL_TOL}, BT=16;
const load=(s)=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src='data:image/png;base64,'+s;});
Promise.all([load('${b64c}'),load('${b64b}')]).then(([A,B])=>{
  const w=A.width,h=A.height;
  const px=(I)=>{const c=document.createElement('canvas');c.width=w;c.height=h;
    const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(I,0,0);
    return g.getImageData(0,0,w,h).data;};
  const a=px(A), b=px(B);
  let diff=0, inkA=0, inkB=0;
  for(let i=0;i<a.length;i+=4){
    const d=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));
    if(d>T) diff++;
    // "ink" = any channel meaningfully below paper white
    if(a[i]<235||a[i+1]<235||a[i+2]<235) inkA++;
    if(b[i]<235||b[i+1]<235||b[i+2]<235) inkB++;
  }
  const n=a.length/4;
  // 16x16 block mean-luma difference
  const cols=Math.ceil(w/BT), rows=Math.ceil(h/BT), blocks=[];
  let worst=0, worstAt=null;
  for(let by=0;by<rows;by++)for(let bx=0;bx<cols;bx++){
    let sa=0,sb=0,c=0;
    for(let y=by*BT;y<Math.min(h,(by+1)*BT);y++)for(let x=bx*BT;x<Math.min(w,(bx+1)*BT);x++){
      const i=(y*w+x)*4; sa+=0.299*a[i]+0.587*a[i+1]+0.114*a[i+2];
      sb+=0.299*b[i]+0.587*b[i+1]+0.114*b[i+2]; c++;
    }
    const d=Math.abs(sa-sb)/c; blocks.push(+d.toFixed(2));
    if(d>worst){worst=d;worstAt=[bx,by];}
  }
  const out={w,h,pixels:+(diff/n).toFixed(5),inkCur:+(inkA/n).toFixed(5),inkBase:+(inkB/n).toFixed(5),
    blocks,worstBlock:+worst.toFixed(2),worstAt};
  // diff image: red where changed
  const c2=document.createElement('canvas');c2.width=w;c2.height=h;
  const g2=c2.getContext('2d');const im=g2.createImageData(w,h);
  for(let i=0;i<a.length;i+=4){
    const d=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));
    const k=d>T?255:0; im.data[i]=k;im.data[i+1]=d>T?0:255;im.data[i+2]=d>T?0:0;im.data[i+3]=d>T?255:70;
  }
  g2.putImageData(im,0,0);
  document.title=JSON.stringify({out,diff:c2.toDataURL('image/png').split(',')[1]});
});
</script></body>`;
  const d = mkdtempSync(join(tmpRoot, 'cmp-'));
  const f = join(d, 'a.html');
  writeFileSync(f, html);
  const outPng = join(d, 'diff.png');
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--user-data-dir=${mkdtempSync(join(tmpRoot, 'ud-'))}`,
    `--screenshot=${resolve(outPng)}`, `--window-size=${W},${Math.round((W * 559) / 864)}`,
    '--default-background-color=ffffff', '--virtual-time-budget=8000',
    '--dump-dom', 'file:///' + f.replace(/\\/g, '/')], { encoding: 'utf8', stdio: 'pipe' });

  // read the JSON payload back out of the DOM dump
  const dom = execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-sandbox',
    `--user-data-dir=${mkdtempSync(join(tmpRoot, 'ud-'))}`,
    '--virtual-time-budget=8000', '--dump-dom', 'file:///' + f.replace(/\\/g, '/')],
    { encoding: 'utf8', stdio: 'pipe' });
  const m = dom.match(/<title>([\s\S]*?)<\/title>/);
  if (!m) return null;
  const txt = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  let payload; try { payload = JSON.parse(txt); } catch { return null; }
  writeFileSync(join(DIR, `${name}.diff.png`), Buffer.from(payload.diff, 'base64'));
  return payload.out;
}

// ---- run ---------------------------------------------------------------------
console.log(`VISUAL REGRESSION  ${BLESS ? '(blessing)' : FAIL ? '(gating)' : '(reporting)'}  raster ${W}px  ${cases.length} case(s)\n`);
let bad = 0;
for (const c of cases) {
  const basePng = join(DIR, `${c.name}.png`);
  const r = renderPng(c.name, c.src);
  if (!r) { bad++; continue; }

  if (BLESS || !existsSync(basePng)) {
    if (!BLESS) console.log(`  ${c.name.padEnd(6)} BASELINE CREATED  (no baseline existed — first run)`);
    else console.log(`  ${c.name.padEnd(6)} baseline written`);
    continue;
  }
  const m = compare(c.name, r.png, basePng);
  if (!m) { console.log(`  ${c.name.padEnd(6)} compare failed (Chrome gave no payload)`); bad++; continue; }

  const inkDelta = Math.abs(m.inkCur - m.inkBase);
  const pxBad = m.pixels > 0.0005;
  const inkBad = inkDelta > INK_TOL;
  const blkBad = m.worstBlock > BLOCK_TOL;
  const verdict = (pxBad || inkBad || blkBad) ? 'CHANGED' : 'same';
  if (verdict === 'CHANGED') bad++;
  console.log(`  ${c.name.padEnd(6)} ${verdict.padEnd(8)} pixels ${(m.pixels * 100).toFixed(3)}%` +
    `  ink ${(m.inkCur * 100).toFixed(2)}% (base ${(m.inkBase * 100).toFixed(2)}%, d ${(inkDelta * 100).toFixed(3)}%)` +
    `  worst block ${m.worstBlock}${m.worstAt ? ` @${m.worstAt}` : ''}`);
  if (verdict === 'CHANGED') console.log(`         -> diff image: ${DIR}/${c.name}.diff.png`);
}

for (const f of readdirSync(tmpRoot)) { try { unlinkSync(join(tmpRoot, f)); } catch {} }

console.log(`\n${bad ? `${bad} case(s) changed` : 'all cases match baseline'}`);
if (bad && FAIL) process.exitCode = 1;
