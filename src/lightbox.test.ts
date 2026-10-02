import { describe, expect, it } from 'vitest';

import { clampIndex, lightboxView, stepIndex } from './lightbox.js';

/**
 * THE LIGHTBOX'S BOUNDARY RULE, PINNED AS ARITHMETIC.
 *
 * 🔴 RED/GREEN MATRIX. Every case in this file is VACUOUSLY RED at the base commit
 * (445558b) — `src/lightbox.ts` does not exist there, so the import fails and nothing
 * here is regression coverage for a reproduced bug. What it IS: the machine-readable
 * statement of a decision (CLAMP, not WRAP) that is otherwise only prose, plus the
 * one case that is a real defect guard — see `an index that outlived its images`
 * below, which closes a path that CAN happen in production.
 *
 * 🔴 THE FIXTURE COUNT IS **5**, AND THE NUMBER MATTERS. The step is ±1, so a count
 * of 1 or 2 collapses first/middle/last into one or two positions and a mutant that
 * confuses them survives. 5 gives three pairwise-distinct positions (0, 2, 4), none
 * of them a multiple of the step away from both ends, and 5 is not the length of any
 * other array in this file. The degenerate counts get their own cases BELOW rather
 * than being the only fixture.
 */

/** Pairwise-distinct, so "returned the wrong one" is always visible. */
const URLS = ['u-a', 'u-b', 'u-c', 'u-d', 'u-e'];
const LABELS = ['Clickbait', 'Cinematic', 'Minimal', 'Vlog', 'Documentary'];

describe('clampIndex', () => {
  it('leaves an in-range index alone', () => {
    expect(clampIndex(0, 5)).toBe(0);
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(4, 5)).toBe(4);
  });

  it('🔴 pins BOTH ends — below 0 and above the last index', () => {
    // Not -1 (unclamped) and not 4 (wrapped).
    expect(clampIndex(-1, 5)).toBe(0);
    // Not 5 (unclamped) and not 0 (wrapped).
    expect(clampIndex(5, 5)).toBe(4);
    // Far outside, so a mutant that clamps by one step rather than to the bound
    // cannot pass: `-3 + 1` is not 0 and `9 - 1` is not 4.
    expect(clampIndex(-3, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
  });

  it('answers 0 for an empty list rather than -1', () => {
    // `count - 1` is -1 here, so an implementation without the `count <= 0` arm
    // returns a negative index that would read `urls[-1]`.
    expect(clampIndex(0, 0)).toBe(0);
    expect(clampIndex(3, 0)).toBe(0);
  });
});

describe('stepIndex', () => {
  it('moves one place in the middle, in both directions', () => {
    expect(stepIndex(2, 5, 1)).toBe(3);
    expect(stepIndex(2, 5, -1)).toBe(1);
  });

  /**
   * 🔴 THE CLAMP-vs-WRAP DECISION, ASSERTED AT BOTH ENDS. This is the test that
   * would have to be edited to change the decision, which is the point: the choice
   * is recorded somewhere a reader cannot miss it.
   */
  it('🔴 CLAMPS at the first index — it does NOT wrap to the last', () => {
    expect(stepIndex(0, 5, -1)).toBe(0);
    // Spelled out so the rejected behaviour is named, not merely absent: wrapping
    // would answer 4 here.
    expect(stepIndex(0, 5, -1)).not.toBe(4);
  });

  it('🔴 CLAMPS at the last index — it does NOT wrap to the first', () => {
    expect(stepIndex(4, 5, 1)).toBe(4);
    expect(stepIndex(4, 5, 1)).not.toBe(0);
  });

  it('is the only mover, so an out-of-range start is clamped before it steps', () => {
    // 7 clamps to 4, then +1 clamps back to 4.
    expect(stepIndex(7, 5, 1)).toBe(4);
    // 7 clamps to 4, then -1 is 3 — NOT 6, which is what stepping before clamping
    // would give.
    expect(stepIndex(7, 5, -1)).toBe(3);
  });

  it('a single-image batch cannot move in either direction', () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, 1, -1)).toBe(0);
  });
});

describe('lightboxView', () => {
  it('is null when closed', () => {
    expect(lightboxView(null, URLS, LABELS)).toBeNull();
  });

  it('resolves the url and label AT the index, not the first of each', () => {
    const view = lightboxView(2, URLS, LABELS);
    // 🔴 INDEX 2 OF 5, so neither the url nor the label can be matched by an
    // implementation that returns `urls[0]`, `urls[index - 1]` or the last entry.
    expect(view?.url).toBe('u-c');
    expect(view?.label).toBe('Minimal');
    expect(view?.index).toBe(2);
  });

  it('🔴 the position indicator is 1-BASED and names the total', () => {
    // The whole normalised string, not a substring: "3" alone would also match "3 of
    // 3" and "13 of 50".
    expect(lightboxView(2, URLS, LABELS)?.position).toBe('3 of 5');
    expect(lightboxView(0, URLS, LABELS)?.position).toBe('1 of 5');
    expect(lightboxView(4, URLS, LABELS)?.position).toBe('5 of 5');
  });

  it('🔴 hasPrev/hasNext are false only at their OWN end', () => {
    const first = lightboxView(0, URLS, LABELS)!;
    expect(first.hasPrev).toBe(false);
    expect(first.hasNext).toBe(true);

    const middle = lightboxView(2, URLS, LABELS)!;
    expect(middle.hasPrev).toBe(true);
    expect(middle.hasNext).toBe(true);

    const last = lightboxView(4, URLS, LABELS)!;
    expect(last.hasPrev).toBe(true);
    expect(last.hasNext).toBe(false);
  });

  it('a single-image batch has neither direction', () => {
    const only = lightboxView(0, ['u-only'], ['Clickbait'])!;
    expect(only.hasPrev).toBe(false);
    expect(only.hasNext).toBe(false);
    expect(only.position).toBe('1 of 1');
  });

  /**
   * 🔴 THE ONE CASE HERE THAT GUARDS A REACHABLE DEFECT RATHER THAN RECORDING A
   * DECISION. `HistoryEntry.imageUrls` is rebuilt from the live queue on every poll
   * snapshot and every storage reload, so a batch's image list can SHRINK while the
   * lightbox is open on its last picture — a reload that drops a workflow does it.
   * Without the clamp the dialog reads `urls[4]` of a 2-element array and renders
   * `src={undefined}`: a broken-image icon in place of a picture the viewer paid for.
   */
  it('🔴 an index that outlived its images shows the LAST surviving one', () => {
    const view = lightboxView(4, ['u-a', 'u-b'], ['Clickbait', 'Cinematic'])!;
    expect(view.index).toBe(1);
    expect(view.url).toBe('u-b');
    expect(view.label).toBe('Cinematic');
    expect(view.position).toBe('2 of 2');
    expect(view.hasNext).toBe(false);
  });

  it('🔴 is null when the images went away entirely, rather than reading urls[0]', () => {
    expect(lightboxView(0, [], [])).toBeNull();
    expect(lightboxView(3, [], [])).toBeNull();
  });

  it('reports a missing label as null rather than undefined or a guess', () => {
    // The history join writes `null` where the record cannot name a format; a short
    // `labels` array is the other way to get there.
    expect(lightboxView(1, URLS, ['Clickbait', null])?.label).toBeNull();
    expect(lightboxView(3, URLS, ['Clickbait'])?.label).toBeNull();
  });
});
