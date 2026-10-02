// Mutants for the LIGHTBOX surface — run by scripts/mutation-sweep.mjs.
//
// 🔴 WHY THIS SET IS IN THE REPO AT ALL. A review round for this feature quoted
// per-mutant RED COUNTS in its PR body that an independent re-run could not
// reproduce (one mutant reported at 10 red; a second run of the same mutant got
// 5). A number nobody else can get is not evidence. So the set is committed and
// what gets quoted is VERDICTS and KILLING TEST NAMES — a red count is a property
// of the whole suite on the day, not of the mutant.
//
// 🔴 THIS USED TO BE A SECOND DRIVER, IN A SECOND LANGUAGE. `lightbox-mutants.py`
// carried both this set AND its own runner, duplicating the sweep logic in Python
// beside the one in `mutation-sweep.mjs`. Three of its controls had no equivalent
// here and were PORTED INTO THE DRIVER rather than dropped — the `expect` field
// below is one of them (see items 6–8 in `mutation-sweep.mjs`). The Python file is
// deleted; this is the set it held.
//
// ⚠ AND IT WAS ALREADY INERT WHEN IT WAS DELETED. That driver hard-coded
// `BASELINE_TOTAL = 884` and aborted unless the suite matched it exactly; the
// suite is 933. Every run of it since had been refusing at the parser check. The
// replacement derives the baseline from its own control run, so the number cannot
// go stale.
//
// Each entry names, in `expect`, a substring of the test title that MUST be among
// the failures. A kill credited to any other red is WRONG-REASON: a different
// guard's error killing your mutant is green for the wrong reason, and stays green
// with the intended guard deleted.

export const testFiles = ['src/lightbox.test.ts', 'src/History.lightbox.test.tsx'];

const VIEW = 'src/lightbox.ts';
const DIALOG = 'src/Lightbox.tsx';

// The two neighbour expressions, quoted once so M-B and M-C cannot drift apart.
const NEIGHBOURS =
  '    prevUrl: at > 0 ? urls[at - 1] : null,\n' +
  '    nextUrl: at < count - 1 ? urls[at + 1] : null,';

export const mutants = [
  {
    id: 'M-A',
    desc: 'own-arithmetic in the key handler (the mutant that used to SURVIVE)',
    // Before the url anchor, the key handler called `stepIndex(at, count, delta)`
    // and so did the buttons; replacing the handler's call with a bare `at + delta`
    // passed the ENTIRE suite, because `lightboxView` re-clamped the index at
    // render and erased the difference. "One mover, so they cannot disagree" was
    // therefore an unguardable claim. This is that mutant against the current
    // shape: the handler computes its own neighbour instead of reading the view's.
    expect: 'clamp as the buttons',
    edits: [
      {
        file: DIALOG,
        find:
          "      const next = e.key === 'ArrowLeft' ? prevUrl : nextUrl;\n" +
          '      if (next !== null) onUrlChange(next);',
        replace:
          "      const i = urls.indexOf(view.url) + (e.key === 'ArrowLeft' ? -1 : 1);\n" +
          '      onUrlChange(urls[i]);',
      },
    ],
  },
  {
    id: 'M-B',
    desc: 'wrap instead of clamp, both neighbours',
    expect: 'does NOT wrap',
    edits: [
      {
        file: VIEW,
        find: NEIGHBOURS,
        replace:
          '    prevUrl: at > 0 ? urls[at - 1] : urls[count - 1],\n' +
          '    nextUrl: at < count - 1 ? urls[at + 1] : urls[0],',
      },
    ],
  },
  {
    id: 'M-C',
    desc: 'the two neighbours swapped — prev goes forward, next goes back',
    // A fixture whose positions were not pairwise distinct would not see this.
    expect: 'ADJACENT pictures',
    edits: [
      {
        file: VIEW,
        find: NEIGHBOURS,
        replace:
          '    prevUrl: at < count - 1 ? urls[at + 1] : null,\n' +
          '    nextUrl: at > 0 ? urls[at - 1] : null,',
      },
    ],
  },
  {
    id: 'M-D',
    desc: 'a departed picture clamps to a survivor instead of closing',
    // F1's fix undone: a different picture under a different heading, which is
    // what the index version did.
    expect: 'LEAVING the row',
    edits: [
      {
        file: VIEW,
        find: '  if (at < 0) return null;\n  const count = urls.length;',
        replace:
          '  const count = urls.length;\n' +
          '  if (count === 0) return null;\n' +
          '  if (at < 0) return lightboxView(urls[count - 1], urls, labels);',
      },
    ],
  },
  {
    id: 'M-E',
    desc: 'the emptied view no longer asks the caller to close',
    // F2's fix undone: render nothing but keep considering yourself open, so the
    // next non-empty snapshot remounts the dialog with no user input.
    expect: 'REFILL does not reopen',
    edits: [
      { file: DIALOG, find: '    if (orphaned) onClose();', replace: '    if (false && orphaned) onClose();' },
    ],
  },
  // ── M-F IS DELIBERATELY ABSENT, AND ITS RESULT IS THE REASON. It removed an
  // explicit "an editable target always keeps its keys" arm from
  // `keysBelongToThisDialog` and SURVIVED the whole suite — green with the arm
  // gone. That was not a coverage gap: every editable element in this app sits
  // OUTSIDE the panel, where the containment rule already rejects it, so the arm
  // had no caller at all. The arm was DELETED rather than guarded, which is why
  // its pattern no longer exists to mutate.
  {
    id: 'M-G',
    desc: 'keysBelongToThisDialog always says yes — the dialog takes every arrow key on the page',
    expect: 'behind the overlay',
    edits: [
      {
        file: DIALOG,
        find: 'function keysBelongToThisDialog(target: EventTarget | null, inside: Element | null): boolean {',
        replace:
          'function keysBelongToThisDialog(target: EventTarget | null, inside: Element | null): boolean {\n  return true;',
      },
    ],
  },
  {
    id: 'M-H',
    desc: 'the in-panel arm removed, leaving only the unfocused case',
    // Asks whether the in-panel arm is REACHED, not merely present — a guard that
    // never executes is not a guard.
    expect: 'POSITIVE CONTROL',
    edits: [
      {
        file: DIALOG,
        find: '  if (panel !== null && target instanceof Node && panel.contains(target)) return true;',
        replace: '  if (false && panel !== null && target instanceof Node && panel.contains(target)) return true;',
      },
    ],
  },
  {
    id: 'PC',
    desc: 'POSITIVE CONTROL: 0-based position indicator — known caught, rides in every run',
    positiveControl: true,
    expect: '1-BASED',
    edits: [
      { file: VIEW, find: '    position: `${at + 1} of ${count}`,', replace: '    position: `${at} of ${count}`,' },
    ],
  },
];
