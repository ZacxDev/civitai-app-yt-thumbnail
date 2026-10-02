// Mutants for the FORMATS surface — run by scripts/mutation-sweep.mjs.
//
// Each entry breaks ONE narrow expression and names the assertion that must
// catch it. Results go in claudedocs/mutation-matrix-formats.md with the exact
// failure message the runner printed, which is the only thing that proves the
// INTENDED assertion is the one that fired rather than some neighbour.
//
// 🔴 ISOLATION RULES THESE FOLLOW:
//   - the narrowest expression that can be wrong, never a guard together with
//     its enclosing condition (so a disabled branch becomes `if (false && …)`,
//     not a deleted block);
//   - where a mutation would trip the `formats.ts` ↔ `public/formats/formats.json`
//     lockstep guard as a side effect, it is applied to BOTH files, so the guard
//     under test is the one that fires;
//   - at least one mutant in the batch is a KNOWN-CAUGHT positive control (M25),
//     so a batch that reports all-survived can be told apart from a batch whose
//     runner never executed.

export const testFiles = ['src/formats.test.ts', 'src/App.formats.test.tsx'];

const FORMATS = 'src/formats.ts';
const JSON_FILE = 'public/formats/formats.json';
const TESTS = 'src/formats.test.ts';
const APP = 'src/App.tsx';

export const mutants = [
  // -------------------------------------------------------------------------
  // 🟡1 — the provenance guard. The audit PROVED the old guard passed a
  // fabricated record; these three are that proof, re-run against the fix.
  // -------------------------------------------------------------------------
  {
    id: 'M25',
    desc: "THE AUDITOR'S EXACT PROBE: `magic` keeps its real art, gets a fabricated sourceWorkflowId AND costBuzz 0",
    // This is the acceptance criterion for the 🟡1 fix. Before the fix this exact
    // tree passed all 63 tests with rc 0.
    edits: [
      {
        file: JSON_FILE,
        find: '"sourceWorkflowId": "8753561-20261002023313073-mpt8",\n    "costBuzz": 209',
        replace: '"sourceWorkflowId": "TOTALLY-MADE-UP-NEVER-RAN",\n    "costBuzz": 0',
      },
    ],
  },
  {
    id: 'M26',
    desc: 'ONLY a fabricated sourceWorkflowId on `magic` — costBuzz left correct (isolates the SHAPE assertion)',
    edits: [
      {
        file: JSON_FILE,
        find: '"sourceWorkflowId": "8753561-20261002023313073-mpt8"',
        replace: '"sourceWorkflowId": "TOTALLY-MADE-UP-NEVER-RAN"',
      },
    ],
  },
  {
    id: 'M27',
    desc: 'ONLY `costBuzz: 0` on `magic` — id left real (isolates the cost assertion the audit walked past)',
    edits: [
      {
        file: JSON_FILE,
        find: '"sourceWorkflowId": "8753561-20261002023313073-mpt8",\n    "costBuzz": 209',
        replace: '"sourceWorkflowId": "8753561-20261002023313073-mpt8",\n    "costBuzz": 0',
      },
    ],
  },
  {
    id: 'M28',
    desc: 'WORKFLOW_ID_SHAPE made permissive (`/^.*$/`) — grades the regex\'s OWN negative control',
    // Mutating the instrument on purpose. If this survives, the shape check could
    // be silently loosened and nothing would say so.
    edits: [
      {
        file: TESTS,
        find: 'const WORKFLOW_ID_SHAPE = /^\\d{7}-\\d{17}-[a-z0-9]{4}$/;',
        replace: 'const WORKFLOW_ID_SHAPE = /^.*$/;',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 🟡2 — the `#` wildcard rule: one predicate, two write paths, load untouched.
  // -------------------------------------------------------------------------
  {
    id: 'M29',
    desc: '`suffixWildcardReason` never finds anything (the predicate itself is inert)',
    edits: [
      {
        file: FORMATS,
        find: '  if (!suffix.includes(WILDCARD_CHAR)) return null;',
        replace: '  if (true) return null;',
      },
    ],
  },
  {
    id: 'M30',
    desc: '`validateCustomFormat` stops calling the predicate (the SAVE path loses the rule)',
    edits: [
      { file: FORMATS, find: '  return suffixWildcardReason(suffix);', replace: '  return null;' },
    ],
  },
  {
    id: 'M31',
    desc: 'the PUBLISH gate in App.tsx is disabled — save still guarded, publish not',
    // Narrowest form: the condition is falsified, the branch and its copy stay.
    edits: [
      {
        file: APP,
        find: '      const why = validateCustomFormat(fmt);\n      if (why) {',
        replace: '      const why = validateCustomFormat(fmt);\n      if (false && why) {',
      },
    ],
  },
  {
    id: 'M32',
    desc: '🔴 THE INVERSION: `parseCustomFormats` starts REJECTING a stored `#` suffix (validate on LOAD)',
    // The mutant that proves the save-vs-load DIRECTION is actually asserted and
    // not merely described in a comment. A viewer's already-saved format would
    // silently vanish from their picker.
    edits: [
      {
        file: FORMATS,
        find: "    if (id === '' || label === '' || suffix === '') continue;",
        replace: "    if (id === '' || label === '' || suffix === '' || suffix.includes('#')) continue;",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // The unified preview predicate, and the art-bearing SET.
  // -------------------------------------------------------------------------
  {
    id: 'M33',
    desc: '`hasPreviewArt` reverts to the old TEST predicate (`!== undefined`), re-opening the `\'\'`/`null` split',
    edits: [
      {
        file: FORMATS,
        find: "  return typeof fmt.preview === 'string' && fmt.preview.trim() !== '';",
        replace: '  return fmt.preview !== undefined;',
      },
    ],
  },
  {
    id: 'M34',
    desc: "🔴 `gaming`'s art silently LOST — preview + provenance removed from both files (M21 re-run at 12-with-art)",
    // The claim WITH_PREVIEW_ART exists to make: a SET sees one format losing its
    // art; a count of 12 would too, but a count could not tell this from "we added
    // a 13th". Applied to BOTH files so the lockstep guard is not what fires first.
    edits: [
      {
        file: JSON_FILE,
        // 🔴 THIS FIND-STRING QUOTES `gaming`'s PROVENANCE, so it goes stale every
        // time that art is regenerated — and it did, on 2026-10-02, when all six of
        // the original previews moved from SD XL (`…-siqc`, costBuzz 3) to ChatGPT
        // Images. The driver catches that loudly (`occurs 0×, expected 1×` →
        // NOT-APPLIED) instead of scoring SURVIVED, which is the only reason this is
        // a chore rather than a silent hole. Re-quote it whenever the art moves.
        find:
          'energy, stylized digital art",\n' +
          '    "preview": "/formats/gaming.webp",\n' +
          '    "sourceWorkflowId": "8753561-20261002060045425-9p8h",\n' +
          '    "costBuzz": 209\n',
        replace: 'energy, stylized digital art"\n',
      },
      { file: FORMATS, find: "    preview: '/formats/gaming.webp',\n", replace: '' },
    ],
  },
  {
    id: 'M35',
    desc: '`magic` loses only its PREVIEW, provenance kept — a provenance line for a file that is not there',
    edits: [
      {
        file: JSON_FILE,
        find: '    "preview": "/formats/magic.webp",\n',
        replace: '',
      },
      { file: FORMATS, find: "    preview: '/formats/magic.webp',\n", replace: '' },
    ],
  },
];
