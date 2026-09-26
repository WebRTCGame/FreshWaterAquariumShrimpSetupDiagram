// RETIRED 2026-09-25. This script no longer works and could not have silently
// reverted anything.
//
// It looked like a live hazard: it regenerates pid-symbols-bundle.js wholesale
// from pid-backup-tmp.js, so running it WOULD have reverted the six SYM-CLIPPED
// viewBox fixes (see P&ID-VISUAL-QUALITY.md 9.28 / T7.7). It was flagged as
// high-risk accordingly.
//
// On checking, the marker it greps for is not there. `pid-backup-tmp.js` only
// REFERENCES window.PID_SYMBOLS (in code that reads the table); it does not
// contain the table. So `indexOf('window.PID_SYMBOLS = ')` returns -1 and the
// script has always exited 1 with "no PID_SYMBOLS block found":
//
//     $ node restore-bundle.mjs
//     no PID_SYMBOLS block found
//
// The hazard was real in shape and inert in fact. The script is kept as a stub
// rather than deleted so the history is not lost, and so nobody re-derives this.
//
// IF THIS IS EVER REVIVED: the symbol table's source of truth is now
// `pid-symbols-bundle.js` itself (the .svg sources are archived, not live). Any
// symbol fix applied to the bundle must be mirrored into whatever is used to
// rebuild it, or it will be lost. Run `node audit-symbols.mjs` afterwards to
// confirm SYM-CLIPPED is still 0 and SYM-PORT-DRIFT has not grown.
import { readFileSync } from 'node:fs';
const marker = 'window.PID_SYMBOLS = ';
const src = readFileSync('pid-backup-tmp.js', 'utf8');
console.log('RETIRED. Would have needed marker "' + marker + '" at index ' + src.indexOf(marker) + '.');
console.log('The symbol table is not in pid-backup-tmp.js. pid-symbols-bundle.js is the source of truth.');
process.exit(1);
