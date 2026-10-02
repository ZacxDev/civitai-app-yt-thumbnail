import { describe, expect, it } from 'vitest';

import { lightboxView } from './lightbox.js';

/**
 * THE LIGHTBOX'S POSITION RULE, PINNED AS A PURE FUNCTION.
 *
 * 🔴 RED/GREEN MATRIX, AND NOTHING IN THIS FILE IS A BEHAVIOURAL REGRESSION GUARD.
 * Stated flatly because two of the cases describe a defect that WAS measured, and it
 * would be easy to read them as having caught it:
 *
 *  - At the feature's base commit (445558b) `src/lightbox.ts` does not exist, so every
 *    case here is VACUOUSLY RED on the import.
 *  - At cc860e3 — this feature's own second commit, where the view was derived from a
 *    BARE INDEX — 8 of these 10 cases are red, and MEASURED: all 8 die because the
 *    signature took a `number` and a string anchor produces garbage (`index: 'u-c'`,
 *    `url: undefined`). That is an INCOMPATIBLE SIGNATURE, not a defect being caught.
 *    Vacuous red in a second costume.
 *  - So what this file is: the machine-readable statement of two decisions — CLAMP
 *    rather than wrap, and ANCHOR-BY-URL rather than by index — plus the lookup
 *    arithmetic. The behavioural red→green evidence for the index defects lives in
 *    `History.lightbox.test.tsx`, whose cases run unchanged against cc860e3 and fail
 *    on an assertion there; see that file's own matrix.
 *
 * 🔴 THE FIXTURE COUNT IS **5**, AND THE NUMBER MATTERS. The move is one place at a
 * time, so a count of 1 or 2 collapses first/middle/last into one or two positions
 * and a mutant that confuses them survives. 5 gives three pairwise-distinct positions
 * (0, 2, 4), neither end a single step from the other, and 5 is not the length of any
 * other array in this file.
 */

/** Pairwise-distinct, so "returned the wrong one" is always visible. */
const URLS = ['u-a', 'u-b', 'u-c', 'u-d', 'u-e'];
const LABELS = ['Clickbait', 'Cinematic', 'Minimal', 'Vlog', 'Documentary'];

describe('lightboxView', () => {
  it('is null when closed', () => {
    expect(lightboxView(null, URLS, LABELS)).toBeNull();
  });

  it('resolves the url and label AT the anchor, not the first of each', () => {
    const view = lightboxView('u-c', URLS, LABELS);
    // 🔴 THE THIRD OF FIVE, so neither the url nor the label can be matched by an
    // implementation that returns `urls[0]`, the one before it, or the last entry.
    expect(view?.url).toBe('u-c');
    expect(view?.label).toBe('Minimal');
    expect(view?.index).toBe(2);
  });

  it('🔴 the position indicator is 1-BASED and names the total', () => {
    // The whole normalised string, not a substring: "3" alone would also match "3 of
    // 3" and "13 of 50".
    expect(lightboxView('u-c', URLS, LABELS)?.position).toBe('3 of 5');
    expect(lightboxView('u-a', URLS, LABELS)?.position).toBe('1 of 5');
    expect(lightboxView('u-e', URLS, LABELS)?.position).toBe('5 of 5');
  });

  /**
   * 🔴 THE BOUNDARY DECISION IS **CLAMP**, NOT WRAP, AND IT IS ASSERTED AT BOTH ENDS
   * BY NAMING THE REJECTED VALUE. A `null` neighbour is how the clamp is expressed:
   * the end of the list has nothing beyond it, which is also what renders the button
   * disabled. Wrap would answer the far end instead, and that is what these
   * `not.toBe` lines rule out — so switching to wrap-around fails here loudly rather
   * than passing on a technicality.
   */
  it('🔴 the first picture has NO previous one — it does NOT wrap to the last', () => {
    const first = lightboxView('u-a', URLS, LABELS)!;
    expect(first.prevUrl).toBeNull();
    expect(first.prevUrl).not.toBe('u-e');
    expect(first.nextUrl).toBe('u-b');
  });

  it('🔴 the last picture has NO next one — it does NOT wrap to the first', () => {
    const last = lightboxView('u-e', URLS, LABELS)!;
    expect(last.nextUrl).toBeNull();
    expect(last.nextUrl).not.toBe('u-a');
    expect(last.prevUrl).toBe('u-d');
  });

  it('🔴 in the middle both neighbours are the ADJACENT pictures, in the right order', () => {
    const middle = lightboxView('u-c', URLS, LABELS)!;
    // Index 2 of 5, so a swapped pair, an off-by-one, or a jump to an end is visible.
    expect(middle.prevUrl).toBe('u-b');
    expect(middle.nextUrl).toBe('u-d');
  });

  it('a single-image batch has neither neighbour', () => {
    const only = lightboxView('u-only', ['u-only'], ['Clickbait'])!;
    expect(only.prevUrl).toBeNull();
    expect(only.nextUrl).toBeNull();
    expect(only.position).toBe('1 of 1');
  });

  /**
   * 🔴 THE TWO CASES THAT GUARD A REACHABLE DEFECT RATHER THAN RECORDING A DECISION,
   * AND THE DEFECT WAS MEASURED ON THIS FEATURE'S OWN SECOND COMMIT.
   *
   * `HistoryEntry.imageUrls` is ordered by `record.workflowIds` and rebuilt from the
   * live queue on every poll snapshot and every storage reload. This app submits one
   * workflow PER FORMAT, so the list GROWS IN FRONT OF AN OPEN DIALOG whenever an
   * earlier format resolves after a later one — the ordinary case for a two-format
   * batch — and SHRINKS whenever a reload drops a workflow.
   */
  it('🔴 an INSERTION IN FRONT of the open picture does not change which picture it is', () => {
    // Format two resolved first, so the row held only its image and the viewer opened
    // it. Format one then lands and the join puts it at index 0.
    const before = lightboxView('u-b', ['u-b'], ['Cinematic'])!;
    expect(before.url).toBe('u-b');
    expect(before.position).toBe('1 of 1');

    const after = lightboxView('u-b', ['u-a', 'u-b'], ['Clickbait', 'Cinematic'])!;
    // 🔴 STILL THE SAME PICTURE AND THE SAME LABEL. A bare index of 0 answers 'u-a'
    // and 'Clickbait' here — a different picture under a renamed heading, with no
    // viewer input. Both rejected values are named so the index version cannot pass.
    expect(after.url).toBe('u-b');
    expect(after.url).not.toBe('u-a');
    expect(after.label).toBe('Cinematic');
    expect(after.label).not.toBe('Clickbait');
    // The indicator moves, which is correct and is the only thing that may: the list
    // really does have two pictures now, and this one really is the second.
    expect(after.index).toBe(1);
    expect(after.position).toBe('2 of 2');
    expect(after.prevUrl).toBe('u-a');
    expect(after.nextUrl).toBeNull();
  });

  it('🔴 a picture that LEFT the row shows nothing — it does not fall back to a neighbour', () => {
    // The viewer was on 'u-c'; a reload dropped that workflow and kept the others.
    const gone = lightboxView('u-c', ['u-a', 'u-b'], ['Clickbait', 'Cinematic']);
    // 🔴 NULL, NOT THE LAST SURVIVOR. Clamping to 'u-b' is the SAME defect as the
    // case above wearing different clothes: a different picture under a different
    // format's heading, unasked for. Both survivors are named so a clamp cannot pass.
    expect(gone).toBeNull();

    // And the whole list going away is the same answer, rather than reading urls[0].
    expect(lightboxView('u-a', [], [])).toBeNull();
    expect(lightboxView('u-c', [], [])).toBeNull();
  });

  it('reports a missing label as null rather than undefined or a guess', () => {
    // The history join writes `null` where the record cannot name a format; a short
    // `labels` array is the other way to get there.
    expect(lightboxView('u-b', URLS, ['Clickbait', null])?.label).toBeNull();
    expect(lightboxView('u-d', URLS, ['Clickbait'])?.label).toBeNull();
  });
});
