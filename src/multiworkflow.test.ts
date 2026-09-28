import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_DEFAULT_ORDER,
  PROMPT_MAX,
  aggregateEstimate,
  aggregateSpend,
  composePrompt,
  failedRuns,
  initRun,
  initRuns,
  isPartialFailure,
  overallPhase,
  patchRun,
  pickDefaultAccount,
  runCandidates,
  type FormatRun,
} from './generation.js';

/**
 * The MULTI-WORKFLOW money path (N selected formats ⇒ N workflows) and the
 * blue → green → yellow account default.
 *
 * 🔴 RED-AT-BASE MATRIX. Every symbol imported here is NEW in this change:
 * at the base ref (origin/main, e2c3108) `generation.ts` exported none of
 * `composePrompt`, `initRun(s)`, `patchRun`, `aggregateEstimate`,
 * `aggregateSpend`, `overallPhase`, `runCandidates`, `failedRuns`,
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

  it('🔴 sums SPEND only from runs the server actually priced', () => {
    const runs = [
      run({ formatId: 'a', phase: 'succeeded', estimatedCost: 13, actualCost: 11 }),
      // Failed before it ever cost anything — it must contribute NOTHING, and
      // must NOT contribute its estimate.
      run({ formatId: 'b', phase: 'failed', estimatedCost: 29, actualCost: null }),
    ];
    expect(aggregateSpend(runs)).toBe(11);
  });

  it('🔴 NEVER falls back to the estimate when no run reported a cost', () => {
    // Every estimate is known here; if aggregateSpend ever read estimatedCost
    // the answer would be 42 and the viewer would be told they spent Buzz that
    // was never debited.
    const runs = [
      run({ formatId: 'a', phase: 'failed', estimatedCost: 13, actualCost: null }),
      run({ formatId: 'b', phase: 'failed', estimatedCost: 29, actualCost: null }),
    ];
    expect(aggregateSpend(runs)).toBeNull();
    expect(aggregateSpend(runs)).not.toBe(42);
  });

  it('counts a server-reported zero as zero, not as unknown', () => {
    const runs = [run({ formatId: 'a', phase: 'succeeded', actualCost: 0 })];
    expect(aggregateSpend(runs)).toBe(0);
  });
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

describe('candidate merging', () => {
  it('🔴 keeps a failed run from discarding the other runs images', () => {
    const runs = [
      run({ formatId: 'cine', label: 'Cinematic', phase: 'succeeded', imageUrls: ['c1', 'c2'] }),
      run({ formatId: 'game', label: 'Gaming', phase: 'failed', imageUrls: [] }),
      run({ formatId: 'tech', label: 'Tech', phase: 'succeeded', imageUrls: ['t1'] }),
    ];
    expect(runCandidates(runs)).toEqual([
      { url: 'c1', formatId: 'cine', formatLabel: 'Cinematic' },
      { url: 'c2', formatId: 'cine', formatLabel: 'Cinematic' },
      { url: 't1', formatId: 'tech', formatLabel: 'Tech' },
    ]);
  });

  it('tags every candidate with the format that produced it', () => {
    const runs = [
      run({ formatId: 'a', label: 'Alpha', phase: 'succeeded', imageUrls: ['x'] }),
      run({ formatId: 'b', label: 'Beta', phase: 'succeeded', imageUrls: ['y'] }),
    ];
    const got = runCandidates(runs);
    expect(got.map((c) => c.formatLabel)).toEqual(['Alpha', 'Beta']);
    // The tag must track the URL, not the index — a mutant that reads the
    // label off the wrong run is caught because the labels differ.
    expect(got.find((c) => c.url === 'y')?.formatLabel).toBe('Beta');
  });

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
