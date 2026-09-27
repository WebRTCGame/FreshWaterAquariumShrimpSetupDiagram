// pid-textmetrics.js — advance widths and vertical extents for the drawing face.
//
// WHY THIS FILE EXISTS (T4.4, and the reason it is per-character)
//
// Every clearance decision in this project is a width decision: how much room a
// valve's label stack needs (router `passDecrowd`), how big an instrument bubble
// has to be (`bubbleRadiusFor`), where the equipment list row ends (renderer
// `annotationsSvg`), whether two labels overlap (the `labelCollisions` term the
// whole layout search is minimised against). All of them used to be
// `str.length * fontSize * 0.55`.
//
// 0.55 is the average advance of MIXED-CASE text. Every glyph this project draws
// is uppercase: the renderer does not transform the strings, a CSS presentation
// rule does — `svg[data-theme] text { text-transform: uppercase }`. So the metric
// was measuring a case that is never rendered, and uppercase Helvetica averages
// 0.678em against mixed case's ~0.50em. **The under-measurement was about 35 %,
// on every annotation on every sheet.**
//
// Two attempts to fix it at the string level both failed, and the reason is worth
// keeping:
//   * Uppercasing the string before counting characters changed NOTHING, because
//     `toUpperCase()` does not change `.length`. That is correct, and useless.
//   * Splitting the average into `WIDTH_EM = {regular, medium, bold}` fixed the
//     BOLD case (0.55 -> 0.68, which is the real bold-caps average) and left the
//     regular case at a mixed-case average for text that is all caps. 9.70 fixed
//     the demo's invisible label pile-up with it and the grey type lines were
//     still 20 % narrow.
//   * `getComputedTextLength()` on the live node would be exact, but the score is
//     computed for every candidate while the SVG is detached from the document, so
//     there is nothing to measure. It cannot run inside the search.
//
// What is left is the right answer anyway: a real advance table. These are the
// Adobe Core font metrics for Helvetica, in 1/1000 em, which is the standard
// metrically-compatible model for the CSS generic `sans-serif` this drawing uses
// (Arial is metrically identical to Helvetica for Latin; the usual Linux and
// macOS substitutes are within a couple of percent). SVG renderers use the same
// table when they have to estimate without a layout pass, so this is not a fudge
// with extra steps — it is the face's own numbers.
//
// The vertical metrics matter as much. `textBox` used a flat `1.15em` height,
// which is neither cap height nor line height, and the `1.84mm` mis-centred
// instrument tag of 9.72 is that guess compounding with a second one. Caps have
// no descenders, so an all-caps line runs from -0.718em (cap top) to 0 (baseline):
// an 0.718em box, not a 1.15em one. Every box in this file is therefore TIGHTER
// than it was, and tighter in the direction that matters — the box was previously
// claiming 0.43em of empty space below the baseline that nothing ever draws into.
//
// ONE SOURCE OF TRUTH. The router and the renderer both need these numbers and
// they MUST agree: the router reserves space the renderer then has to fit into,
// and when the two models disagree the drawing overflows the space the layout
// believed it had. That disagreement is not hypothetical — it is what regressed
// spike 997 -> 1274 when an instrument bubble was grown in the renderer alone.
// Both files now call `PIDText`.
//
// Fold: uppercase, matching the CSS. Non-ASCII falls back to `fallbackEm` (the
// widest common advance) rather than to the average, so a stray en-dash or degree
// sign reserves space rather than none.
const PIDText = (function () {
  // Helvetica, Adobe Core metrics, 1/1000 em. Index = charCode - 32.
  const REG = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ];
  // Helvetica-Bold.
  const BOLD = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
  ];
  // A capital `M` is the widest thing a P&ID label normally contains, and it is the
  // right pessimistic default: a box that is too wide costs a little air, a box
  // that is too narrow costs an overlap.
  const FALLBACK = 833;
  // Vertical metrics, 1/1000 em, Helvetica.
  const CAP = 718;        // cap height: top of a capital above the baseline
  const XH = 523;         // x-height
  const DESC = 207;       // descender depth below the baseline
  const ASC = 718;        // ascender (b/d/f/h/k/l), same as cap height here

  const fold = (s) => String(s == null ? '' : s).toUpperCase();

  // Advance width in em. `bold` selects the weight table. Deliberately NOT
  // `str.length * factor`: the whole point is that 'I' is 0.278em and 'M' is
  // 0.833em, so "ILL MILL" and "MINIMUM" land where they actually land.
  const widthEm = function (s, bold) {
    const t = fold(s);
    const tab = bold ? BOLD : REG;
    let w = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      w += (c >= 32 && c <= 126) ? tab[c - 32] : FALLBACK;
    }
    return w / 1000;
  };

  // Width in millimetres for a run at `fontMm`.
  const widthMm = (s, fontMm, bold) => widthEm(s, bold) * (fontMm || 0);

  // Vertical extent of a run about its BASELINE, in em, folded to sign: y0 is
  // above the baseline (negative), y1 below (positive). All-caps text has no
  // descenders, so y1 is 0 unless the string contains one after folding (it
  // cannot) — the descender branch exists for safety and for the few literal
  // strings the renderer does not uppercase.
  const extentEm = function (s) {
    const t = fold(s);
    let hasDesc = false, hasAsc = false;
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      if (c < 32 || c > 126) { hasAsc = hasAsc || c > 126; continue; }
      const lower = s.charCodeAt(i) >= 97 && s.charCodeAt(i) <= 122;
      if (lower) { hasDesc = true; hasAsc = true; }
    }
    const top = hasAsc ? ASC : CAP;
    return { y0: -top / 1000, y1: hasDesc ? DESC / 1000 : 0, xh: XH / 1000 };
  };

  // Self-test. A metric that cannot be shown to be wrong is a metric nobody can
  // trust, and this file is the input to every clearance in the engine. Each case
  // is checked against a hand-summed column of the table above, and the two that
  // matter most are the ones the old model got wrong:
  //   - "CENTRIFUGAL PUMP" is 16 characters and 10.223em wide, not 8.8em — a 16 %
  //     under-measurement before the per-character model, and 16 % is not a
  //     rounding detail when it is multiplied across a whole label stack.
  //   - "I" is 0.278em and "M" is 0.833em, so a 4-character tag is never the
  //     2.2em the flat 0.55 factor claimed. The average is wrong in BOTH
  //     directions, which is why tuning it is hopeless: "MANUAL" is 4.167em and
  //     the flat model says 3.30em (26 % narrow), "III" is 0.834em and it says
  //     1.65em (98 % wide).
  const cases = [
    ['M', 0.833, false], ['I', 0.278, false], [' ', 0.278, false],
    ['MM', 1.666, false], ['II', 0.556, false], ['MI', 1.111, false],
    ['CENTRIFUGAL PUMP', 10.223, false],
    ['CENTRIFUGAL PUMP', 10.333, true],
    ['GATE VALVE', 6.225, false],
    ['CLOSED DRAIN HEADER', 11.946, false],
    ['FIC', 1.611, true],
    ['CONE ROOF TANK', 9.001, false],
    ['', 0, false],
  ];
  const failures = [];
  for (const [s, want, bold] of cases) {
    const got = widthEm(s, bold);
    if (Math.abs(got - want) > 0.002) failures.push(`widthEm(${JSON.stringify(s)},${bold}) = ${got.toFixed(3)}, want ${want}`);
  }
  // the flat model is provably wrong, not merely different
  if (Math.abs(widthEm('CENTRIFUGAL PUMP') - 16 * 0.55) < 0.01) failures.push('uppercase width collapsed onto the mixed-case 0.55 average');
  if (Math.abs(widthEm('MANUAL') - 4.167) > 0.002) failures.push('MANUAL width wrong');
  if (Math.abs(widthEm('III') - 0.834) > 0.002) failures.push('per-character widths lost the I/M distinction');

  return {
    widthEm, widthMm, extentEm,
    // Kept for the existing call sites that pass a role through as a number.
    EM: { regular: widthEm('CENTRIFUGAL PUMP') / 16, bold: widthEm('CENTRIFUGAL PUMP', true) / 16 },
    CAP, DESC, ASC, FALLBACK, selfTest: () => failures,
    _tables: { REG, BOLD, FALLBACK },
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PIDText;
