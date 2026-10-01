import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_DEFAULT_ORDER,
  PROMPT_MAX,
  aggregateEstimate,
  composePrompt,
  failedRuns,
  hasSubmittablePrompt,
  initRun,
  initRuns,
  isPartialFailure,
  overallPhase,
  patchRun,
  pickDefaultAccount,
  promptWasTruncated,
  userPromptRoom,
  type FormatRun,
} from './generation.js';

/**
 * The MULTI-WORKFLOW money path (N selected formats ⇒ N workflows) and the
 * blue → green → yellow account default.
 *
 * 🔴 RED-AT-BASE MATRIX. Every symbol imported here is NEW in this change:
 * at the base ref (origin/main, e2c3108) `generation.ts` exported none of
 * `composePrompt`, `initRun(s)`, `patchRun`, `aggregateEstimate`,
 * `overallPhase`, `failedRuns`,
 * `isPartialFailure`, `pickDefaultAccount` or `ACCOUNT_DEFAULT_ORDER`. This file
 * therefore goes red at base on an IMPORT/undefined error, which is a VACUOUS
 * red and proves nothing.
 *
 * So: this file is BEHAVIOUR coverage, NOT regression coverage. Nothing here
 * pins a defect that ever happened. The evidence that the assertions bite is the
 * MUTATION sweep recorded in claudedocs/mutation-matrix-formats.md — each 🔴
 * case below was killed by breaking the implementation on purpose and checking
 * that THIS assertion produced the failure.
 *
 * Fixture discipline: every cost is a distinct non-round number and no fixture
 * value equals another, so a mutant that sums the wrong field, returns a
 * constant, or swaps two runs cannot survive by arithmetic coincidence.
 */

const run = (over: Partial<FormatRun> & { formatId: string }): FormatRun => ({
  ...initRun(over.formatId, over.label ?? `L-${over.formatId}`),
  ...over,
});

// ---------------------------------------------------------------------------

describe('composePrompt', () => {
  it('joins the user prompt and the format suffix with a comma', () => {
    expect(composePrompt('a cat on a skateboard', 'neon lighting')).toBe(
      'a cat on a skateboard, neon lighting',
    );
  });

  it('trims both sides before joining', () => {
    expect(composePrompt('  a cat  ', '  neon  ')).toBe('a cat, neon');
  });

  it('returns just the prompt when the format has no suffix', () => {
    expect(composePrompt('a cat', '   ')).toBe('a cat');
  });

  it('returns just the suffix when the prompt is empty', () => {
    expect(composePrompt('   ', 'neon lighting')).toBe('neon lighting');
  });

  it('🔴 RESERVES room for the suffix, trimming the USER prompt instead', () => {
    // The money-safety point: the viewer selected (and is paying for) this
    // format. A naive clampPrompt(user + suffix) would cut the suffix off the
    // end and generate something that silently ignores the chosen format.
    const suffix = 'cinematic teal and orange grade';
    const long = 'w'.repeat(PROMPT_MAX);
    const got = composePrompt(long, suffix);
    expect(got.length).toBeLessThanOrEqual(PROMPT_MAX);
    // The suffix survived INTACT and sits at the end...
    expect(got.endsWith(`, ${suffix}`)).toBe(true);
    // ...and it was the user's text that gave way.
    expect(got.startsWith('w'.repeat(20))).toBe(true);
    expect(got).toHaveLength(PROMPT_MAX);
  });

  it('never exceeds the cap even when the suffix alone is over it', () => {
    const got = composePrompt('a cat', 'z'.repeat(PROMPT_MAX + 40));
    expect(got).toHaveLength(PROMPT_MAX);
  });
});

// ---------------------------------------------------------------------------
// The three predicates the composed-prompt PREVIEW and the Generate gate are
// built on.
//
// 🔴 BEHAVIOUR COVERAGE, NOT REGRESSION COVERAGE. `userPromptRoom`,
// `promptWasTruncated` and `hasSubmittablePrompt` did not exist at the base ref
// (ed88fd5), so a run against that tree fails on a missing export — a VACUOUS
// red. What they pin is the property a SECOND copy of the arithmetic would
// break: the preview's answer and `composePrompt`'s answer are the same answer.
// ---------------------------------------------------------------------------

describe('userPromptRoom — the budget the USER’s text is clamped to', () => {
  it('is the whole cap when there is no suffix at all', () => {
    expect(userPromptRoom('')).toBe(PROMPT_MAX);
    expect(userPromptRoom('   ')).toBe(PROMPT_MAX);
  });

  it('is the cap minus the trimmed suffix and the two-character joiner', () => {
    // Literal answers, derived by hand rather than read back off the module.
    // 'neon ' TRIMS to 4 characters, so 1500 - 4 - 2 = 1494 — which also pins
    // that the trim happens before the arithmetic; 1500 - 20 - 2 = 1478 for the
    // second. Neither equals the cap, a suffix length, or a round multiple of
    // anything, so a mutant returning a constant or dropping the joiner shows.
    expect(userPromptRoom('neon ')).toBe(1494);
    expect(userPromptRoom('cinematic teal grade')).toBe(1478);
  });

  it('is 0 — never negative — when the suffix alone fills the cap', () => {
    expect(userPromptRoom('z'.repeat(PROMPT_MAX))).toBe(0);
    expect(userPromptRoom('z'.repeat(PROMPT_MAX + 500))).toBe(0);
  });

  it('🔴 AGREES WITH `composePrompt`, which is the whole reason it exists', () => {
    // The seam: the preview asks THIS function how much of the viewer's text
    // survives, while the submitted body is built by `composePrompt`. If the two
    // ever disagree, the string on screen is not the string that gets paid for.
    const suffix = 'cinematic teal and orange grade';
    const long = 'w'.repeat(PROMPT_MAX);
    const kept = userPromptRoom(suffix);
    expect(composePrompt(long, suffix)).toBe(`${'w'.repeat(kept)}, ${suffix}`);
    // …and the composed result is exactly the cap, so `kept` is not merely a
    // number the two sides happen to agree on while both being wrong.
    expect(composePrompt(long, suffix)).toHaveLength(PROMPT_MAX);
  });
});

describe('promptWasTruncated', () => {
  it('is false for prompts that fit alongside their suffix', () => {
    expect(promptWasTruncated('a cat', 'neon lighting')).toBe(false);
    expect(promptWasTruncated('', 'neon lighting')).toBe(false);
    // Exactly ON the boundary is not truncation: 1478 characters against a
    // 20-character suffix compose to exactly 1500.
    expect(promptWasTruncated('w'.repeat(1478), 'cinematic teal grade')).toBe(false);
  });

  it('is true one character past the boundary', () => {
    expect(promptWasTruncated('w'.repeat(1479), 'cinematic teal grade')).toBe(true);
  });

  it('is true when the suffix alone fills the cap, so no user text survives', () => {
    expect(promptWasTruncated('a cat', 'z'.repeat(PROMPT_MAX))).toBe(true);
  });

  it('is true for an over-cap prompt even with no suffix', () => {
    expect(promptWasTruncated('w'.repeat(PROMPT_MAX + 1), '')).toBe(true);
    expect(promptWasTruncated('w'.repeat(PROMPT_MAX), '')).toBe(false);
  });
});

describe('hasSubmittablePrompt — the Generate gate', () => {
  it('🔴 an EMPTY user prompt with a format selected IS submittable', () => {
    // The operator's case: "show me this look in different models". The format's
    // suffix IS the prompt, and refusing it was the defect.
    expect(hasSubmittablePrompt('', [{ suffix: 'neon lighting' }])).toBe(true);
    expect(hasSubmittablePrompt('   \n  ', [{ suffix: 'neon lighting' }])).toBe(true);
  });

  it('a typed prompt is submittable even against a blank-suffix format', () => {
    expect(hasSubmittablePrompt('a cat', [{ suffix: '' }])).toBe(true);
  });

  it('🔴 NOTHING at all is NOT submittable', () => {
    // No formats -> zero workflows -> a click that spends nothing and reports
    // success. That is the state the gate still has to refuse, and it is the
    // half `prompt.trim().length === 0` never covered.
    expect(hasSubmittablePrompt('a cat', [])).toBe(false);
    expect(hasSubmittablePrompt('', [])).toBe(false);
    expect(hasSubmittablePrompt('  ', [{ suffix: '' }, { suffix: '   ' }])).toBe(false);
  });

  it('one usable format among blank ones is enough', () => {
    expect(hasSubmittablePrompt('', [{ suffix: '  ' }, { suffix: 'neon' }])).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('run bookkeeping', () => {
  it('starts one idle run per selected format, tagged with its label', () => {
    const runs = initRuns([
      { id: 'cinematic', label: 'Cinematic' },
      { id: 'gaming', label: 'Gaming' },
    ]);
    expect(runs.map((r) => [r.formatId, r.label, r.phase])).toEqual([
      ['cinematic', 'Cinematic', 'idle'],
      ['gaming', 'Gaming', 'idle'],
    ]);
  });

  it('🔴 patches ONE run and leaves its siblings byte-identical', () => {
    // The out-of-order-reply guard: two workflows finish independently, so a
    // patch keyed on the wrong row would let a slow reply clobber a fast one.
    const runs = initRuns([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
    const next = patchRun(runs, 'b', { phase: 'succeeded', actualCost: 37 });
    expect(next[0]).toEqual(runs[0]);
    expect(next[1].phase).toBe('succeeded');
    expect(next[1].actualCost).toBe(37);
    expect(next[1].formatId).toBe('b');
  });

  it('is a no-op for an unknown format id', () => {
    const runs = initRuns([{ id: 'a', label: 'A' }]);
    expect(patchRun(runs, 'ghost', { phase: 'failed' })).toEqual(runs);
  });
});

// ---------------------------------------------------------------------------

describe('cost aggregation', () => {
  it('sums the per-run estimates into the total shown on the button', () => {
    const runs = [
      run({ formatId: 'a', estimatedCost: 13 }),
      run({ formatId: 'b', estimatedCost: 29 }),
      run({ formatId: 'c', estimatedCost: 7 }),
    ];
    expect(aggregateEstimate(runs)).toEqual({ total: 49, partial: false });
  });

  it('🔴 flags a PARTIAL estimate and sums only what priced', () => {
    const runs = [
      run({ formatId: 'a', estimatedCost: 13 }),
      run({ formatId: 'b', estimatedCost: null }),
    ];
    expect(aggregateEstimate(runs)).toEqual({ total: 13, partial: true });
  });

  it('returns null when nothing priced, so the button shows no figure', () => {
    const runs = [run({ formatId: 'a' }), run({ formatId: 'b' })];
    expect(aggregateEstimate(runs)).toEqual({ total: null, partial: true });
  });

  it('ignores a non-finite estimate rather than poisoning the sum with NaN', () => {
    const runs = [
      run({ formatId: 'a', estimatedCost: 13 }),
      run({ formatId: 'b', estimatedCost: Number.NaN }),
    ];
    expect(aggregateEstimate(runs)).toEqual({ total: 13, partial: true });
  });

  // 🔴 THE THREE `aggregateSpend` CASES THAT STOOD HERE WERE DELETED WITH THE
  // FUNCTION — its only caller was the `pm-spent` alert the operator asked to be
  // removed. They pinned a MONEY rule ("never fall back to the estimate when no run
  // reported a cost"), and that rule did not go with them: the realized cost is read
  // off the history row now, where `joinHistory` applies the identical rule to the
  // same server figures and `history.test.ts > joinHistory` grades it — including the
  // `null`-when-nothing-priced arm and the server-reported-zero arm. Left as a note
  // rather than silently: a reader looking for the spend rule needs to be sent to
  // where it now lives.
});

// ---------------------------------------------------------------------------

describe('overall phase', () => {
  it('is idle with no runs at all', () => {
    expect(overallPhase([])).toBe('idle');
  });

  it('reports the LEAST advanced busy stage while work is in flight', () => {
    expect(
      overallPhase([
        run({ formatId: 'a', phase: 'polling' }),
        run({ formatId: 'b', phase: 'estimating' }),
      ]),
    ).toBe('estimating');
    expect(
      overallPhase([
        run({ formatId: 'a', phase: 'polling' }),
        run({ formatId: 'b', phase: 'submitting' }),
      ]),
    ).toBe('submitting');
    expect(
      overallPhase([
        run({ formatId: 'a', phase: 'polling' }),
        run({ formatId: 'b', phase: 'succeeded' }),
      ]),
    ).toBe('polling');
  });

  it('🔴 lets SUCCESS outrank FAILURE — the partial-failure contract', () => {
    // If failure won, a viewer who paid for three formats and got two back
    // would be shown an error page and NO images.
    expect(
      overallPhase([
        run({ formatId: 'a', phase: 'succeeded' }),
        run({ formatId: 'b', phase: 'failed' }),
      ]),
    ).toBe('succeeded');
    expect(
      overallPhase([
        run({ formatId: 'a', phase: 'failed' }),
        run({ formatId: 'b', phase: 'succeeded' }),
      ]),
    ).toBe('succeeded');
  });

  it('ranks a disallowed account ABOVE insufficient Buzz', () => {
    // Same precedence as the single-run classifier: the disallowed-pool message
    // contains the word "buzz", and it is a recoverable preference problem —
    // reporting it as "out of Buzz" sends the viewer to a top-up page for
    // nothing.
    expect(
      overallPhase([
        run({ formatId: 'a', phase: 'insufficient' }),
        run({ formatId: 'b', phase: 'account-rejected' }),
      ]),
    ).toBe('account-rejected');
  });

  it('surfaces needs-consent above everything', () => {
    expect(
      overallPhase([
        run({ formatId: 'a', phase: 'needs-consent' }),
        run({ formatId: 'b', phase: 'estimating' }),
      ]),
    ).toBe('needs-consent');
  });

  it('is failed when every run failed', () => {
    expect(
      overallPhase([
        run({ formatId: 'a', phase: 'failed' }),
        run({ formatId: 'b', phase: 'failed' }),
      ]),
    ).toBe('failed');
  });
});

// ---------------------------------------------------------------------------

describe('run reduction — failures and partial failure', () => {
  // 🔴 THE TWO `runCandidates` CASES THAT OPENED THIS BLOCK WERE DELETED WITH THE
  // FUNCTION AND ITS `Candidate` TYPE. They pinned that a failed run does not discard
  // its siblings' images and that every image keeps the label of the format that
  // produced it. Both claims moved to `joinHistory`, which is now the only thing that
  // flattens images for the screen: `history.test.ts` asserts that a workflow missing
  // from the live page does not drop or shift anyone else's images, and that
  // `imageLabels` is paired at the `workflowIds` index — a STRONGER version of the
  // label claim, since indexing by image position is exactly the bug that saved a
  // cinematic picture as `yt-thumbnail-clickbait-3.jpg`.

  it('lists the terminal non-successes for the partial-failure note', () => {
    const runs = [
      run({ formatId: 'a', phase: 'succeeded' }),
      run({ formatId: 'b', phase: 'failed' }),
      run({ formatId: 'c', phase: 'insufficient' }),
      run({ formatId: 'd', phase: 'account-rejected' }),
      run({ formatId: 'e', phase: 'polling' }),
    ];
    expect(failedRuns(runs).map((r) => r.formatId)).toEqual(['b', 'c', 'd']);
  });

  it('detects partial failure only when BOTH a success and a failure exist', () => {
    expect(
      isPartialFailure([
        run({ formatId: 'a', phase: 'succeeded' }),
        run({ formatId: 'b', phase: 'failed' }),
      ]),
    ).toBe(true);
    expect(isPartialFailure([run({ formatId: 'a', phase: 'succeeded' })])).toBe(false);
    expect(isPartialFailure([run({ formatId: 'a', phase: 'failed' })])).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('🔴 the blue → green → yellow account ladder', () => {
  it('declares the order blue, green, yellow', () => {
    expect(ACCOUNT_DEFAULT_ORDER).toEqual(['blue', 'green', 'yellow']);
  });

  it('picks BLUE when blue alone covers the cost', () => {
    // Deliberately: every pool here could cover 90. Only order decides.
    expect(pickDefaultAccount({ blue: 500, green: 400, yellow: 300 }, 90)).toBe('blue');
  });

  it('falls through to GREEN when blue is short', () => {
    expect(pickDefaultAccount({ blue: 89, green: 400, yellow: 300 }, 90)).toBe('green');
  });

  it('falls through to YELLOW when blue and green are both short', () => {
    expect(pickDefaultAccount({ blue: 89, green: 12, yellow: 300 }, 90)).toBe('yellow');
  });

  it('🔴 falls back to AUTO when NO single pool is sufficient', () => {
    // Picking an insufficient pool would be strictly worse than Auto: it wastes
    // the host-side fallback that Auto would have performed.
    expect(pickDefaultAccount({ blue: 89, green: 12, yellow: 7 }, 90)).toBe('auto');
  });

  it('🔴 falls back to AUTO when the cost is not yet known', () => {
    // This is the common case: estimate() 403s until the viewer consents, so
    // the page sits with a known balance and an UNKNOWN cost.
    expect(pickDefaultAccount({ blue: 500, green: 400, yellow: 300 }, null)).toBe('auto');
    expect(pickDefaultAccount({ blue: 500, green: 400, yellow: 300 }, undefined)).toBe('auto');
    expect(pickDefaultAccount({ blue: 500, green: 400, yellow: 300 }, Number.NaN)).toBe('auto');
  });

  it('falls back to AUTO when the balance is unknown', () => {
    expect(pickDefaultAccount(null, 90)).toBe('auto');
    expect(pickDefaultAccount(undefined, 90)).toBe('auto');
  });

  it('treats an EXACTLY sufficient balance as sufficient', () => {
    expect(pickDefaultAccount({ blue: 90, green: 400, yellow: 300 }, 90)).toBe('blue');
    expect(pickDefaultAccount({ blue: 89.99, green: 400, yellow: 300 }, 90)).toBe('green');
  });

  it('ignores a missing or non-finite pool balance', () => {
    expect(pickDefaultAccount({ green: 400 }, 90)).toBe('green');
    expect(pickDefaultAccount({ blue: Number.NaN, green: 400 }, 90)).toBe('green');
  });

  it('falls back to AUTO for a nonsensical zero/negative cost', () => {
    expect(pickDefaultAccount({ blue: 500 }, 0)).toBe('auto');
    expect(pickDefaultAccount({ blue: 500 }, -5)).toBe('auto');
  });

  it('🔴 exhausts a pool at REAL multi-format prices, not toy ones', () => {
    // Measured on the live backend 2026-09-28: SD XL 1.0 prices a 1-image
    // generation at 3 Buzz, FLUX.1 [dev] at 33 — an 11x spread. The ladder must
    // be exercised at a cost big enough to actually empty a pool, or every case
    // above is just "the first pool always wins".
    //
    // Six formats x quantity 4 on FLUX: 6 workflows x 4 images x 33 = 792.
    const SIX_FORMATS_FLUX_Q4 = 6 * 4 * 33;
    expect(SIX_FORMATS_FLUX_Q4).toBe(792);

    // A viewer with 500 free Buzz cannot cover it from blue, but can from green.
    expect(
      pickDefaultAccount({ blue: 500, green: 900, yellow: 1200 }, SIX_FORMATS_FLUX_Q4),
    ).toBe('green');
    // Drop green below the line too and only the purchased pool is left.
    expect(
      pickDefaultAccount({ blue: 500, green: 791, yellow: 1200 }, SIX_FORMATS_FLUX_Q4),
    ).toBe('yellow');
    // Nothing covers it -> Auto, so the host still gets to combine pools.
    expect(
      pickDefaultAccount({ blue: 500, green: 791, yellow: 300 }, SIX_FORMATS_FLUX_Q4),
    ).toBe('auto');
    // The SAME balances on the SDXL-priced version of that run (6 x 4 x 3 = 72)
    // stay on blue — the ladder's answer moves with the cost, which is the whole
    // behaviour under test.
    expect(pickDefaultAccount({ blue: 500, green: 791, yellow: 300 }, 6 * 4 * 3)).toBe('blue');
  });
});
