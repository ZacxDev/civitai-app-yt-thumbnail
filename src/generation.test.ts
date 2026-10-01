import { describe, expect, it } from 'vitest';

import type { BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

import {
  PROMPT_MAX,
  QUANTITY_MAX,
  QUANTITY_MIN,
  THUMB_HEIGHT,
  THUMB_WIDTH,
  accountLabel,
  buildWorkflowBody,
  clampPrompt,
  clampQuantity,
  estimateSignature,
  firstImageUrl,
  formatCost,
  hasBudgetedScope,
  imageUrlsFrom,
  isSubmittingPhase,
  isDisallowedAccountError,
  isInsufficientBuzz,
  isTerminalStatus,
  phaseForError,
  phaseForSnapshot,
  submitErrorReason,
  type GenPhase,
} from './generation.js';
import { DEFAULT_CHECKPOINT, type LoraOption } from './models.js';

// A couple of pure-logic tests so authors inherit a working test setup. Run with
// `npm test`. Add cases here as you grow the app's logic.

describe('formatCost', () => {
  it('renders an integer with separators', () => {
    expect(formatCost(1234)).toBe('1,234');
  });
  it('renders a dash for null / undefined / non-finite', () => {
    expect(formatCost(null)).toBe('—');
    expect(formatCost(undefined)).toBe('—');
    expect(formatCost(NaN)).toBe('—');
    expect(formatCost(Infinity)).toBe('—');
  });
  it('rounds fractional costs and separates large ones', () => {
    expect(formatCost(1234.6)).toBe('1,235');
    expect(formatCost(1_234_567)).toBe((1_234_567).toLocaleString());
  });
});

describe('hasBudgetedScope', () => {
  it('true only when ai:write:budgeted is present', () => {
    expect(hasBudgetedScope(['ai:write:budgeted'])).toBe(true);
    expect(hasBudgetedScope([])).toBe(false);
    expect(hasBudgetedScope(undefined)).toBe(false);
  });
});

describe('isInsufficientBuzz', () => {
  it('catches common phrasings, false for unrelated', () => {
    expect(isInsufficientBuzz('Insufficient Buzz')).toBe(true);
    expect(isInsufficientBuzz('prompt rejected by audit')).toBe(false);
    expect(isInsufficientBuzz(null)).toBe(false);
    expect(isInsufficientBuzz(undefined)).toBe(false);
  });
  it('catches each budget/balance phrasing the sniff covers', () => {
    // Each substring the heuristic keys on should independently match.
    expect(isInsufficientBuzz('not enough funds')).toBe(true);
    expect(isInsufficientBuzz('over your per-gen budget')).toBe(true);
    expect(isInsufficientBuzz('your balance is too low')).toBe(true);
    expect(isInsufficientBuzz('needs more buzz')).toBe(true);
  });
});

describe('clampPrompt', () => {
  it('trims to the server cap', () => {
    expect(clampPrompt('x'.repeat(PROMPT_MAX + 100)).length).toBe(PROMPT_MAX);
  });
});

describe('clampQuantity', () => {
  it('clamps into the server-accepted [1, 4] range and rounds', () => {
    expect(clampQuantity(1)).toBe(1);
    expect(clampQuantity(3)).toBe(3);
    expect(clampQuantity(0)).toBe(QUANTITY_MIN);
    expect(clampQuantity(-2)).toBe(QUANTITY_MIN);
    expect(clampQuantity(9)).toBe(QUANTITY_MAX);
    expect(clampQuantity(2.6)).toBe(3);
    expect(clampQuantity(null)).toBe(QUANTITY_MIN);
    expect(clampQuantity(undefined)).toBe(QUANTITY_MIN);
    expect(clampQuantity(NaN)).toBe(QUANTITY_MIN);
  });
});

describe('buildWorkflowBody', () => {
  it('builds a textToImage body with the chosen checkpoint, trimmed prompt, and 16:9 size', () => {
    expect(buildWorkflowBody('  a cat  ', DEFAULT_CHECKPOINT)).toEqual({
      kind: 'textToImage',
      modelId: DEFAULT_CHECKPOINT.modelId,
      modelVersionId: DEFAULT_CHECKPOINT.versionId,
      params: { prompt: 'a cat', width: THUMB_WIDTH, height: THUMB_HEIGHT },
    });
    expect(THUMB_WIDTH).toBe(1280);
    expect(THUMB_HEIGHT).toBe(720);
  });
  it('threads the picked checkpoint into modelId/modelVersionId', () => {
    const pick = { versionId: 290640, modelId: 257749, label: 'Pony V6 XL', baseModel: 'Pony' };
    const body = buildWorkflowBody('x', pick);
    expect(body.modelId).toBe(257749);
    expect(body.modelVersionId).toBe(290640);
  });
  it('omits additionalResources when no LoRAs are selected', () => {
    const body = buildWorkflowBody('a cat', DEFAULT_CHECKPOINT, []);
    expect(body.additionalResources).toBeUndefined();
  });
  it('emits one additionalResources entry per selected LoRA (version + clamped strength)', () => {
    const loras: LoraOption[] = [
      { versionId: 135867, modelId: 122359, label: 'Detail Tweaker XL', baseModel: 'SDXL 1.0', weight: 0.8 },
      // weight out of the [-1, 2] bound is clamped at build time too.
      { versionId: 152309, modelId: 136749, label: 'Add More Details XL', baseModel: 'SDXL 1.0', weight: 9 },
    ];
    const body = buildWorkflowBody('a cat', DEFAULT_CHECKPOINT, loras);
    expect(body.additionalResources).toEqual([
      { modelVersionId: 135867, strength: 0.8 },
      { modelVersionId: 152309, strength: 2 },
    ]);
  });
  it('omits quantity when 1 (server default) and threads it when > 1 (clamped)', () => {
    expect(buildWorkflowBody('a cat', DEFAULT_CHECKPOINT, [], 'auto', { quantity: 1 }).params).not.toHaveProperty('quantity');
    expect(buildWorkflowBody('a cat', DEFAULT_CHECKPOINT, [], 'auto', {}).params).not.toHaveProperty('quantity');
    expect(buildWorkflowBody('a cat', DEFAULT_CHECKPOINT, [], 'auto', { quantity: 3 }).params.quantity).toBe(3);
    expect(buildWorkflowBody('a cat', DEFAULT_CHECKPOINT, [], 'auto', { quantity: 99 }).params.quantity).toBe(QUANTITY_MAX);
    expect(buildWorkflowBody('a cat', DEFAULT_CHECKPOINT, [], 'auto', { quantity: 0 }).params.quantity).toBeUndefined();
  });
  it('omits sourceImage by default and threads it for img2img (remix)', () => {
    expect('sourceImage' in buildWorkflowBody('a cat', DEFAULT_CHECKPOINT)).toBe(false);
    const src = { url: 'https://image.civitai.com/x/y.jpeg', width: 1024, height: 1024 };
    const body = buildWorkflowBody('a cat', DEFAULT_CHECKPOINT, [], 'auto', { sourceImage: src });
    expect(body.sourceImage).toEqual(src);
    // A null sourceImage is the generate path — nothing threaded.
    expect('sourceImage' in buildWorkflowBody('a cat', DEFAULT_CHECKPOINT, [], 'auto', { sourceImage: null })).toBe(false);
  });

  it('Auto (omitted / "auto") threads NO accountType — today’s behavior byte-for-byte', () => {
    const base = buildWorkflowBody('a cat', DEFAULT_CHECKPOINT, []);
    expect('accountType' in base).toBe(false);
    // Passing 'auto' explicitly is identical to omitting it.
    expect(buildWorkflowBody('a cat', DEFAULT_CHECKPOINT, [], 'auto')).toEqual(base);
  });
  it('a picked pool is threaded as accountType (blue/green/yellow)', () => {
    expect(buildWorkflowBody('a cat', DEFAULT_CHECKPOINT, [], 'yellow').accountType).toBe('yellow');
    expect(buildWorkflowBody('a cat', DEFAULT_CHECKPOINT, [], 'green').accountType).toBe('green');
    expect(buildWorkflowBody('a cat', DEFAULT_CHECKPOINT, [], 'blue').accountType).toBe('blue');
  });
});

describe('accountLabel', () => {
  it('labels each account choice', () => {
    expect(accountLabel('auto')).toBe('Auto');
    expect(accountLabel('blue')).toBe('Blue');
    expect(accountLabel('green')).toBe('Green');
    expect(accountLabel('yellow')).toBe('Yellow');
  });
  // `spentAccountLabel`'s case went with the function: it lost its only caller when
  // `SpentAccountNote` was deleted, and a test was the only thing still exercising it.
});

describe('isDisallowedAccountError', () => {
  it('catches the server domain-clamp rejection (before the buzz-in-message trap)', () => {
    const msg = "buzz account 'yellow' is not spendable for this app's content rating";
    expect(isDisallowedAccountError(msg)).toBe(true);
    // The disallowed message contains "buzz" — insufficient WOULD match it, so
    // callers must check disallowed FIRST (phaseForError does).
    expect(isInsufficientBuzz(msg)).toBe(true);
  });
  it('false for unrelated / insufficient errors', () => {
    expect(isDisallowedAccountError('Insufficient Buzz')).toBe(false);
    expect(isDisallowedAccountError('prompt rejected by audit')).toBe(false);
    expect(isDisallowedAccountError(null)).toBe(false);
  });
});

describe('phaseForError', () => {
  it('classifies disallowed-account before insufficient, otherwise failed', () => {
    expect(
      phaseForError("buzz account 'yellow' is not spendable for this app's content rating"),
    ).toBe('account-rejected');
    expect(phaseForError('Insufficient Buzz')).toBe('insufficient');
    expect(phaseForError('prompt rejected by audit')).toBe('failed');
  });
  it('classifies an unrecognized platform gate as failed, not a special phase', () => {
    // A flag/author-gate string (formerly the Comfy invite-only path) has no
    // dedicated phase anymore — it is a plain failure for this app's paths.
    expect(phaseForError('Apps are not enabled')).toBe('failed');
  });
});

describe('isTerminalStatus', () => {
  it('terminal for end states, not for in-flight', () => {
    expect(isTerminalStatus('succeeded')).toBe(true);
    expect(isTerminalStatus('processing')).toBe(false);
  });
});

describe('phaseForSnapshot', () => {
  const snap = (over: Partial<BlockWorkflowSnapshot>): BlockWorkflowSnapshot => ({
    workflowId: 'wf',
    status: 'pending',
    ...over,
  });
  it('maps in-flight to polling and success to succeeded', () => {
    expect(phaseForSnapshot(snap({ status: 'processing' }))).toBe('polling');
    expect(phaseForSnapshot(snap({ status: 'succeeded' }))).toBe('succeeded');
  });
  it('maps an insufficient-Buzz failure to insufficient', () => {
    expect(phaseForSnapshot(snap({ status: 'failed', error: 'Insufficient Buzz' }))).toBe(
      'insufficient',
    );
  });
  it('maps a disallowed-account failure to account-rejected', () => {
    expect(
      phaseForSnapshot(
        snap({
          status: 'failed',
          error: "buzz account 'yellow' is not spendable for this app's content rating",
        }),
      ),
    ).toBe('account-rejected');
  });
  it('never returns gated — a gate is a submit-time rejection, not a snapshot', () => {
    // A feature-gate fails the submit (thrown tRPC rejection) BEFORE a workflow
    // exists, so it can never arrive as a terminal snapshot. A snapshot error
    // therefore reduces via phaseForError -> failed.
    expect(
      phaseForSnapshot(snap({ status: 'failed', error: 'Apps are not enabled' })),
    ).toBe('failed');
  });
  it('routes expired / canceled terminal statuses through the error classifier', () => {
    // Both non-success terminal states reduce via phaseForError: a plain reason
    // -> failed, an insufficient-Buzz reason -> insufficient.
    expect(phaseForSnapshot(snap({ status: 'expired' }))).toBe('failed');
    expect(phaseForSnapshot(snap({ status: 'canceled' }))).toBe('failed');
    expect(phaseForSnapshot(snap({ status: 'expired', error: 'Insufficient Buzz' }))).toBe(
      'insufficient',
    );
  });
});

describe('submitErrorReason', () => {
  // Faithful to the real shape: blocks-react ^0.44 throws an Error SUBCLASS whose
  // `.message` is a generic template and whose `.snapshot.error` holds the server
  // reason. The three strings below are pairwise distinct and none equals the
  // 'submit failed' fallback, so every assertion can see WHICH source was read.
  class FakeWorkflowSubmitError extends Error {
    snapshot: { error?: string };
    constructor(message: string, snapshotError?: string) {
      super(message);
      this.name = 'WorkflowSubmitError';
      this.snapshot = { error: snapshotError };
    }
  }

  const GENERIC = 'submit did not return a usable workflow (exception) — reason on .snapshot.error';
  const SERVER_REASON = "buzz account 'green' is not spendable for this app's content rating";

  it('prefers .snapshot.error over the generic .message (blocks-react ^0.44)', () => {
    // THE REGRESSION: reading `.message` here classifies as `failed` and renders a
    // hard "Generation failed" instead of the friendly switched-back-to-Auto note.
    expect(submitErrorReason(new FakeWorkflowSubmitError(GENERIC, SERVER_REASON))).toBe(
      SERVER_REASON,
    );
  });

  it('falls back to .message when there is no snapshot (blocks-react ^0.43)', () => {
    expect(submitErrorReason(new Error(SERVER_REASON))).toBe(SERVER_REASON);
  });

  it('falls back to .message when .snapshot.error is absent, empty or whitespace', () => {
    expect(submitErrorReason(new FakeWorkflowSubmitError(GENERIC))).toBe(GENERIC);
    expect(submitErrorReason(new FakeWorkflowSubmitError(GENERIC, ''))).toBe(GENERIC);
    expect(submitErrorReason(new FakeWorkflowSubmitError(GENERIC, '   '))).toBe(GENERIC);
  });

  it('falls back to the caller default for a non-Error throw or an empty message', () => {
    expect(submitErrorReason('a bare string')).toBe('submit failed');
    expect(submitErrorReason(null)).toBe('submit failed');
    expect(submitErrorReason(undefined)).toBe('submit failed');
    expect(submitErrorReason(new Error(''))).toBe('submit failed');
    expect(submitErrorReason(new Error(''), 'estimate failed')).toBe('estimate failed');
  });

  it('end-to-end: a ^0.44 disallowed-pool rejection still classifies as account-rejected', () => {
    // The behavioural claim the structural one exists to serve. Reading `.message`
    // would yield 'failed' here — that is the mutation this case kills.
    const err = new FakeWorkflowSubmitError(GENERIC, SERVER_REASON);
    expect(phaseForError(submitErrorReason(err))).toBe('account-rejected');
    expect(phaseForError(GENERIC)).toBe('failed');
  });
});

describe('isSubmittingPhase', () => {
  /**
   * 🔴 THIS REPLACES `isBusyPhase`, WHICH ALSO RETURNED TRUE FOR `'polling'`, AND
   * `'polling'` IS THE WHOLE REASON THE PREDICATE CHANGED. The form (mode, formats,
   * composed prompts, quantity, Buzz pool) and the Generate button were all gated on
   * the old answer, so they were dead for the entire 30–90s a generation takes;
   * nothing in flight can be altered by the form, because `runGeneration` builds
   * every body from one `formSnapshot` closure taken at click time.
   *
   * REGRESSION-ADJACENT, NOT AN INVARIANT GUARD: the case below is red against
   * `isBusyPhase` (it asserts FALSE for `'polling'`, which that function answers
   * TRUE), which is exactly the behaviour change. It is a new function, so the
   * honest matrix is "the predicate it replaces fails this assertion".
   *
   * 🔴 ENUMERATED OVER THE WHOLE `GenPhase` UNION, both arms, and the two arms are
   * asserted to COVER it — so a phase added to `GenPhase` tomorrow fails here
   * instead of silently defaulting to "the form stays live", which is the direction
   * that spends money.
   */
  const SHUT: readonly GenPhase[] = ['estimating', 'submitting'];
  const LIVE: readonly GenPhase[] = [
    'idle',
    'needs-consent',
    'polling',
    'succeeded',
    'failed',
    'insufficient',
    'account-rejected',
  ];

  it('true ONLY while the click is still being placed — estimating and submitting', () => {
    for (const p of SHUT) expect(isSubmittingPhase(p)).toBe(true);
    for (const p of LIVE) expect(isSubmittingPhase(p)).toBe(false);
  });

  it('🔴 is FALSE for polling — the form and Generate stay live once a workflow exists', () => {
    // Called out on its own line because it is the one answer that differs from the
    // `isBusyPhase` this replaced, and a mutant restoring `|| phase === 'polling'`
    // dies here with this assertion rather than somewhere incidental.
    expect(isSubmittingPhase('polling')).toBe(false);
  });

  it('the two arms above are the WHOLE GenPhase union — a new phase fails this', () => {
    // A phase nobody classified would otherwise be treated as "form live", i.e. the
    // permissive direction on a money control.
    const all: readonly GenPhase[] = [...SHUT, ...LIVE];
    expect(new Set(all).size).toBe(all.length);
    // Every phase `phaseForSnapshot`/`phaseForError`/`overallPhase` can produce is in
    // the list. Checked against the type by assignment above; checked for completeness
    // by the one value the union has that nothing else here names.
    const union: Record<GenPhase, true> = {
      idle: true,
      'needs-consent': true,
      estimating: true,
      submitting: true,
      polling: true,
      succeeded: true,
      failed: true,
      insufficient: true,
      'account-rejected': true,
    };
    expect(all.slice().sort()).toEqual(Object.keys(union).sort());
  });
});

describe('firstImageUrl / imageUrlsFrom', () => {
  const snap = (over: Partial<BlockWorkflowSnapshot>): BlockWorkflowSnapshot => ({
    workflowId: 'wf',
    status: 'succeeded',
    ...over,
  });
  it('firstImageUrl returns the first image url when present', () => {
    expect(firstImageUrl(snap({ imageUrls: ['a.png', 'b.png'] }))).toBe('a.png');
  });
  it('firstImageUrl returns null for a null snapshot / empty or missing imageUrls', () => {
    expect(firstImageUrl(null)).toBeNull();
    expect(firstImageUrl(snap({ imageUrls: [] }))).toBeNull();
    expect(firstImageUrl(snap({}))).toBeNull();
  });
  it('imageUrlsFrom returns every url in order (multi-image / quantity runs)', () => {
    expect(imageUrlsFrom(snap({ imageUrls: ['a.png', 'b.png', 'c.png'] }))).toEqual([
      'a.png',
      'b.png',
      'c.png',
    ]);
  });
  it('imageUrlsFrom returns [] for a null snapshot / empty or missing imageUrls', () => {
    expect(imageUrlsFrom(null)).toEqual([]);
    expect(imageUrlsFrom(snap({ imageUrls: [] }))).toEqual([]);
    expect(imageUrlsFrom(snap({}))).toEqual([]);
  });
});

describe('estimateSignature', () => {
  /**
   * 🔴 THIS FUNCTION IS THE APP'S DEFINITION OF "SOMETHING THAT CHANGES THE PRICE",
   * and the live cost preview re-estimates when its output changes and at no other
   * time. So every case here is a statement about when the viewer's money figure gets
   * refreshed — an input wrongly EXCLUDED leaves a stale price on a spend control, and
   * an input wrongly INCLUDED fires a request per keystroke at someone else's backend.
   *
   * BEHAVIOUR coverage: the function is new, so there is nothing to regress from.
   *
   * 🔴 THE FIXTURE VALUES ARE PAIRWISE DISTINCT AND NONE IS A DEFAULT. A base built
   * from quantity 1, zero LoRAs and one format would make several of the cases below
   * pass by landing on the same empty shape.
   */
  const base = {
    formatIds: ['fmt:a', 'fmt:b'],
    checkpointVersionId: 691639,
    loras: [
      { versionId: 135867, weight: 0.65 },
      { versionId: 222111, weight: 1.35 },
    ],
    quantity: 3,
    mode: 'generate' as const,
    sourceImageUrl: null,
  };

  it('is stable for identical input', () => {
    expect(estimateSignature(base)).toBe(estimateSignature({ ...base }));
  });

  it('🔴 CHANGES for every price-relevant input, one at a time', () => {
    // One variable per row. A signature that ignored any of these would leave the
    // button quoting a price for a request nobody is making.
    const sig = estimateSignature(base);
    expect(estimateSignature({ ...base, quantity: 4 })).not.toBe(sig);
    expect(estimateSignature({ ...base, checkpointVersionId: 2880272 })).not.toBe(sig);
    expect(estimateSignature({ ...base, formatIds: ['fmt:a'] })).not.toBe(sig);
    expect(estimateSignature({ ...base, formatIds: ['fmt:a', 'fmt:b', 'fmt:c'] })).not.toBe(sig);
    expect(estimateSignature({ ...base, loras: [base.loras[0]] })).not.toBe(sig);
    expect(estimateSignature({ ...base, mode: 'remix' })).not.toBe(sig);
    expect(
      estimateSignature({ ...base, sourceImageUrl: 'https://image.civitai.com/a.jpg' }),
    ).not.toBe(sig);
  });

  it('🔴 CHANGES on a LoRA WEIGHT alone — a weight rides on the body and is priced', () => {
    // Killed by hashing only the version ids: moving a slider would then leave a stale
    // price, which is the single most likely way to get this function wrong.
    const moved = {
      ...base,
      loras: [{ ...base.loras[0], weight: 1.85 }, base.loras[1]],
    };
    expect(estimateSignature(moved)).not.toBe(estimateSignature(base));
  });

  it('🔴 is SENSITIVE to LoRA ORDER, because the body is', () => {
    // Not a nicety: `additionalResources` is built by mapping the selection in order,
    // so two orders are two different bodies. Treating them as one would be a claim
    // about the server this app has not measured.
    const swapped = { ...base, loras: [base.loras[1], base.loras[0]] };
    expect(estimateSignature(swapped)).not.toBe(estimateSignature(base));
  });

  it('🔴 clamps the quantity, so two values the server treats alike are ONE signature', () => {
    // `clampQuantity` maps everything above the cap to the cap, and the body carries
    // the clamped number — so 9 and QUANTITY_MAX are the same request and must not
    // cost an extra round trip.
    expect(estimateSignature({ ...base, quantity: 9 })).toBe(
      estimateSignature({ ...base, quantity: QUANTITY_MAX }),
    );
    // ...and the positive control, so this is not "quantity is ignored": a value
    // INSIDE the range still moves it.
    expect(estimateSignature({ ...base, quantity: QUANTITY_MIN })).not.toBe(
      estimateSignature({ ...base, quantity: QUANTITY_MAX }),
    );
  });

  it('🔴 an absent source image and an empty string are ONE signature', () => {
    // `null` and `''` both mean "no img2img seed", and distinguishing them would fire a
    // request for a change that cannot alter a body.
    expect(estimateSignature({ ...base, sourceImageUrl: null })).toBe(
      estimateSignature({ ...base, sourceImageUrl: '' }),
    );
  });
});
