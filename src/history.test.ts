import { describe, expect, it } from 'vitest';

import { buildWorkflowBody } from './generation.js';
import {
  HISTORY_PREFIX,
  STORAGE_VALUE_MAX_BYTES,
  batchBodies,
  batchStatus,
  candidateFileName,
  historyKey,
  joinHistory,
  oldestWorkflowTime,
  orphanedKeys,
  parseRecord,
  mergeLiveWorkflows,
  mergeUnsavedRecords,
  recordFits,
  showHistory,
  skeletonCount,
  timestampFromKey,
  upsertOwnWorkflow,
  type GenerationForm,
  type GenerationRecord,
} from './history.js';
import { DEFAULT_CHECKPOINT } from './models.js';

import type { AppWorkflow } from '@civitai/app-sdk/blocks';

/**
 * 🔴 RED/GREEN MATRIX FOR THIS WHOLE FILE — read the label, do not assume.
 *
 * `src/history.ts` does not exist at bec8894, so EVERY case here fails to import
 * there. That is a VACUOUS red: it proves the module is new, not that any
 * assertion bites. NONE of this file is regression coverage; it is all BEHAVIOUR
 * coverage for behaviour this change introduces.
 *
 * What makes the cases below worth having is that each one is killed by a
 * DIFFERENT plausible mistake, and the mistakes are named in each block. Two of
 * them are the ones that would silently destroy user data:
 *
 *   - `orphanedKeys` without its `oldestFetchedAt` bound deletes every record
 *     past the live page's first page.
 *   - `historyKey` without a FIXED-WIDTH inverted timestamp puts the listing in
 *     the wrong order at a digit-count boundary.
 *
 * The regression-coverage cases for this change live in models.test.ts (the
 * default checkpoint) and manifest.test.ts (the Buzz budget), where the file
 * being asserted on DOES exist at base and the red is a real assertion failure.
 */

// --- fixtures -------------------------------------------------------------
//
// 🔴 PAIRWISE-DISTINCT ON PURPOSE. Every numeric field below differs from every
// other, and none equals a constant the assertions name: a fixture whose
// quantity happened to be 1 could not tell `quantity` from the server default,
// and one whose two format prompts were equal could not tell "two prompts" from
// "one prompt twice".

const LORA = { versionId: 135867, modelId: 122359, label: 'Detail Tweaker XL', baseModel: 'SDXL 1.0', weight: 0.75 };

function form(overrides: Partial<GenerationForm> = {}): GenerationForm {
  return {
    mode: 'generate',
    prompt: 'a red bicycle',
    promptEdits: { 'fmt:b': 'an entirely different sentence the viewer typed' },
    formats: [
      { id: 'fmt:a', label: 'Clickbait', suffix: 'bold, high contrast', prompt: 'a red bicycle, bold, high contrast' },
      { id: 'fmt:b', label: 'Minimal', suffix: 'clean, negative space', prompt: 'an entirely different sentence the viewer typed' },
    ],
    checkpoint: { versionId: 2880272, modelId: 2563220, label: 'ChatGPT Images', baseModel: 'OpenAI' },
    loras: [LORA],
    quantity: 3,
    account: 'yellow',
    sourceImage: null,
    ...overrides,
  };
}

function record(overrides: Partial<GenerationRecord> = {}): GenerationRecord {
  return {
    v: 1,
    batchId: 'batch-7',
    createdAt: 1_700_000_000_000,
    workflowIds: ['wf-a', 'wf-b'],
    form: form(),
    ...overrides,
  };
}

function workflow(overrides: Partial<AppWorkflow> & { workflowId: string }): AppWorkflow {
  return {
    status: 'succeeded',
    images: [],
    cost: null,
    createdAt: '2026-09-30T12:00:00.000Z',
    ...overrides,
  };
}

// --- keys -----------------------------------------------------------------

describe('historyKey', () => {
  it('orders NEWEST FIRST lexicographically, which is the order list() pages in', () => {
    // Killed by storing a plain timestamp: that sorts oldest-first, so the panel
    // would page backwards through the viewer's history.
    const older = historyKey(1_700_000_000_000, 'a');
    const newer = historyKey(1_800_000_000_000, 'a');
    expect(newer < older).toBe(true);
    expect([older, newer].sort()).toEqual([newer, older]);
  });

  it('🔴 keeps that order ACROSS a digit-count boundary, which fixed width is for', () => {
    /**
     * Killed by dropping the zero-pad — but ONLY with fixtures that actually
     * reach the boundary, and the first version of this case did not.
     *
     * The inverted value is `10^14 - 1 - t`. Every realistic epoch-ms timestamp
     * (~1.7e12) inverts to a 14-digit number ALREADY, so padding to 14 is a
     * no-op on them: a fixture made only of realistic dates makes the mutant
     * SURVIVE a fully green suite, which is exactly what the first sweep
     * reported. The guard was never executed by the assertion meant to pin it.
     *
     * The values below straddle the boundary by construction — 3-digit, 4-digit
     * and 14-digit inverted forms — so the padded and unpadded implementations
     * genuinely disagree about the ORDER, which is the property under test.
     * (Those `t` values are far-future dates; that is fine. The claim is about
     * the arithmetic, and picking a t the arithmetic cannot distinguish is how
     * the first attempt tested nothing.)
     */
    const times = [
      1_700_000_000_000, // inverted 98299999999999 — 14 digits (a realistic date)
      99_999_999_990_000, // inverted           9999 —  4 digits
      99_999_999_999_000, // inverted            999 —  3 digits
    ];
    const keys = times.map((t) => historyKey(t, 'x'));
    // Ascending by key must be descending by time.
    const timesBySortedKey = [...keys].sort().map((k) => timestampFromKey(k));
    expect(timesBySortedKey).toEqual([...times].sort((a, b) => b - a));

    // The control that makes the above a real disagreement rather than a
    // coincidence: unpadded, these keys sort into a DIFFERENT order.
    const unpadded = times.map((t) => String(10 ** 14 - 1 - t));
    expect([...unpadded].sort().map(Number)).not.toEqual(
      [...keys].sort().map((k) => 10 ** 14 - 1 - (timestampFromKey(k) as number)),
    );
  });

  it('round-trips the timestamp and rejects a key that is not ours', () => {
    expect(timestampFromKey(historyKey(1_234_567_890_123, 'z'))).toBe(1_234_567_890_123);
    expect(timestampFromKey('formats:custom:v1')).toBeNull();
    expect(timestampFromKey(`${HISTORY_PREFIX}nonsense`)).toBeNull();
  });

  it('carries the batch id so two batches in the same millisecond do not collide', () => {
    expect(historyKey(1_700_000_000_000, 'a')).not.toBe(historyKey(1_700_000_000_000, 'b'));
  });
});

// --- the resume body ------------------------------------------------------

describe('🔴 a resumed generation reproduces the EXACT submitted body', () => {
  /**
   * The claim under test is about the WIRE, not the UI: what a resume would
   * submit must be byte-identical to what the original click submitted. So this
   * asserts `batchBodies(...)` against literal `buildWorkflowBody(...)` calls —
   * the same function the App feeds to `submit()` — and it does it AFTER a JSON
   * round trip, because the record's journey to a resume goes through storage.
   */
  it('matches buildWorkflowBody for every format, after a storage round trip', () => {
    const f = form();
    const stored = JSON.parse(JSON.stringify(record({ form: f }))) as GenerationRecord;

    const expected = [
      buildWorkflowBody(
        'a red bicycle, bold, high contrast',
        f.checkpoint,
        f.loras,
        'yellow',
        { quantity: 3 },
      ),
      buildWorkflowBody(
        'an entirely different sentence the viewer typed',
        f.checkpoint,
        f.loras,
        'yellow',
        { quantity: 3 },
      ),
    ];

    expect(batchBodies(stored.form)).toEqual(expected);
  });

  it('🔴 N FORMATS STAY N DISTINCT PROMPTS through the round trip', () => {
    // Killed by a record that stores one prompt for the batch, or that
    // recomposes every row from the prompt box: both collapse the two bodies
    // into one repeated body, which is exactly what multi-format must never do.
    const bodies = batchBodies(JSON.parse(JSON.stringify(form())) as GenerationForm);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].params.prompt).not.toBe(bodies[1].params.prompt);
    expect(bodies[0].params.prompt).toBe('a red bicycle, bold, high contrast');
    expect(bodies[1].params.prompt).toBe('an entirely different sentence the viewer typed');
  });

  it('reproduces the LoRAs, the quantity and the spend-from pool, not just the prompt', () => {
    // Killed by a record that drops any one of them — each is a money-relevant
    // input, and a resume that quietly changed the pool or the image count would
    // charge differently from the run it claims to reuse.
    const body = batchBodies(form())[0];
    expect(body.additionalResources).toEqual([{ modelVersionId: 135867, strength: 0.75 }]);
    expect(body.params.quantity).toBe(3);
    expect(body.accountType).toBe('yellow');
    expect(body.modelId).toBe(2563220);
    expect(body.modelVersionId).toBe(2880272);
  });

  it('carries a remix source back only in remix mode', () => {
    const src = { url: 'https://image.civitai.com/x.jpg', width: 1216, height: 832 };
    expect(batchBodies(form({ mode: 'remix', sourceImage: src }))[0].sourceImage).toEqual(src);
    // A source left over from a remix must NOT turn a generate resume into img2img.
    expect(batchBodies(form({ mode: 'generate', sourceImage: src }))[0].sourceImage).toBeUndefined();
  });

  it('resolves against the SHIPPED default checkpoint, not a literal id of its own', () => {
    const body = batchBodies(form({ checkpoint: DEFAULT_CHECKPOINT }))[0];
    expect(body.modelVersionId).toBe(DEFAULT_CHECKPOINT.versionId);
    expect(body.modelId).toBe(DEFAULT_CHECKPOINT.modelId);
  });
});

// --- parsing --------------------------------------------------------------

describe('parseRecord', () => {
  it('accepts a record that round-tripped through JSON', () => {
    expect(parseRecord(JSON.parse(JSON.stringify(record())))).toEqual(record());
  });

  it('rejects junk rather than rendering it half-parsed', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { v: 2 }, { v: 1, batchId: '' }]) {
      expect(parseRecord(bad)).toBeNull();
    }
  });

  it('rejects a record with no workflowIds — nothing could ever join to it', () => {
    expect(parseRecord({ ...record(), workflowIds: [] })).toBeNull();
  });

  it('🔴 rejects a format entry with no resolved prompt', () => {
    // Killed by accepting it: `batchBodies` would then build
    // `params.prompt: undefined`, which JSON-serialises away or reaches the wire
    // as the string "undefined" — and gets CHARGED FOR either way.
    const bad = record();
    const formats = bad.form.formats.map((f, i) => (i === 1 ? { id: f.id, label: f.label, suffix: f.suffix } : f));
    expect(parseRecord({ ...bad, form: { ...bad.form, formats } })).toBeNull();
  });

  it('rejects a record whose checkpoint has no ids', () => {
    const bad = record();
    expect(
      parseRecord({ ...bad, form: { ...bad.form, checkpoint: { label: 'x', baseModel: 'y' } } }),
    ).toBeNull();
  });
});

describe('recordFits', () => {
  it('accepts an ordinary record and refuses one past the host ceiling', () => {
    expect(recordFits(record())).toBe(true);
    const huge = record();
    huge.form.formats[0].prompt = 'x'.repeat(STORAGE_VALUE_MAX_BYTES + 1);
    expect(recordFits(huge)).toBe(false);
  });

  it('measures BYTES, not characters — a multi-byte prompt is not free', () => {
    // Killed by using `.length`: a prompt of astral-plane characters is ~4x its
    // character count on the wire, so a `.length` check passes a value the host
    // then rejects with an opaque PAYLOAD_TOO_LARGE.
    const r = record();
    // Well under the ceiling by characters, well over it by UTF-8 bytes.
    r.form.formats[0].prompt = '𝕏'.repeat(Math.ceil(STORAGE_VALUE_MAX_BYTES / 3));
    expect(r.form.formats[0].prompt.length).toBeLessThan(STORAGE_VALUE_MAX_BYTES);
    expect(recordFits(r)).toBe(false);
  });
});

// --- the join -------------------------------------------------------------

describe('joinHistory — the batch grouping', () => {
  it('🔴 groups a multi-format batch into ONE row, summing its realized cost', () => {
    // Killed by joining on workflows rather than records: the host drops `tags`,
    // so N workflows from one click carry nothing tying them together and would
    // render as N unrelated rows at N unrelated prices.
    const entries = joinHistory(
      [{ key: 'k1', record: record() }],
      [
        workflow({ workflowId: 'wf-a', cost: 209, images: [{ url: 'u1', width: 1536, height: 864, nsfwLevel: 1 }] }),
        workflow({ workflowId: 'wf-b', cost: 418, images: [{ url: 'u2', width: 1536, height: 864, nsfwLevel: 1 }] }),
        workflow({ workflowId: 'wf-someone-elses', cost: 999 }),
      ],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].workflows.map((w) => w.workflowId)).toEqual(['wf-a', 'wf-b']);
    // 209 + 418, and NOT + 999: a workflow this batch does not own is not its bill.
    expect(entries[0].cost).toBe(627);
    expect(entries[0].imageUrls).toEqual(['u1', 'u2']);
    expect(entries[0].status).toBe('succeeded');
  });

  it('reports cost `null` — never an estimate — when the server priced nothing', () => {
    const entries = joinHistory([{ key: 'k1', record: record() }], [workflow({ workflowId: 'wf-a' })]);
    expect(entries[0].cost).toBeNull();
  });

  it('counts a server-reported ZERO as a price, not as "unknown"', () => {
    // Killed by a truthiness check on cost: 0 is the server's word, not a gap.
    const entries = joinHistory(
      [{ key: 'k1', record: record() }],
      [workflow({ workflowId: 'wf-a', cost: 0 })],
    );
    expect(entries[0].cost).toBe(0);
  });

  it('marks a batch the live queue knows nothing about as unavailable, and KEEPS it', () => {
    const entries = joinHistory([{ key: 'k1', record: record() }], [workflow({ workflowId: 'other' })]);
    expect(entries).toHaveLength(1);
    expect(entries[0].unavailable).toBe(true);
    expect(entries[0].status).toBe('unavailable');
    // 🔴 The form half is OURS and does not expire — the whole reason the row stays.
    expect(batchBodies(entries[0].record.form)).toHaveLength(2);
  });

  it('🔴 labels EVERY image with ITS OWN format, through a missing workflow and quantity > 1', () => {
    /**
     * 🔴 REGRESSION COVERAGE, red at c84f082 — where `imageLabels` does not exist
     * and the row passed `form.formats[0].label` for every image, so a 2-format
     * batch saved its Minimal picture as `yt-thumbnail-clickbait-N.jpg`.
     *
     * 🔴 THE FIXTURE IS BUILT TO KILL THE TWO NEAR-MISS FIXES AS WELL, and each
     * needs its own distinct number:
     *   - `formats[imageIndex]` — wrong because quantity > 1 means one workflow
     *     contributes SEVERAL images. 'wf-a' delivers two, so an image-indexed
     *     lookup would label the second one 'Minimal'.
     *   - pairing AFTER the `.filter` — wrong because a workflow the live page does
     *     not carry is dropped, shifting every later index. 'wf-missing' sits
     *     BETWEEN the two present workflows precisely so that shift happens: a
     *     post-filter pairing would label 'wf-c' 'Minimal' instead of 'Cinematic'.
     */
    const three = form({
      formats: [
        { id: 'fmt:a', label: 'Clickbait', suffix: 's', prompt: 'p1' },
        { id: 'fmt:b', label: 'Minimal', suffix: 's', prompt: 'p2' },
        { id: 'fmt:c', label: 'Cinematic', suffix: 's', prompt: 'p3' },
      ],
    });
    const img = (url: string) => ({ url, width: 1536, height: 864, nsfwLevel: 1 });
    const entries = joinHistory(
      [{ key: 'k1', record: record({ workflowIds: ['wf-a', 'wf-missing', 'wf-c'], form: three }) }],
      [
        workflow({ workflowId: 'wf-a', images: [img('a1'), img('a2')] }),
        workflow({ workflowId: 'wf-c', images: [img('c1')] }),
      ],
    );
    expect(entries[0].imageUrls).toEqual(['a1', 'a2', 'c1']);
    expect(entries[0].imageLabels).toEqual(['Clickbait', 'Clickbait', 'Cinematic']);
  });

  it('stays TOTAL on a row with fewer formats than ids — `null`, not a throw', () => {
    /**
     * 🔴 A TOTALITY GUARD AT THE PARSE BOUNDARY, NOT REGRESSION COVERAGE, and the
     * difference matters because the reason written here before was false. It said a
     * pre-change record "can carry MORE ids than formats". It cannot: measured at the
     * only released writer (`a6aae56`), `workflowIds = submittedIds ⊆ viable` while
     * `form.formats = formats.filter(viable)`, so `|formats| >= |ids|` ALWAYS — the
     * inequality runs the other way, and the case below is one NO shipped writer
     * produces. What it does pin is real but much smaller: `parseRecord` validates the
     * two lists separately and never relates their lengths, so `joinHistory` has to
     * survive every shape it accepts. Without the `?.` this row throws a TypeError out
     * of the function that renders the whole surface. `null` is a filename without a
     * slug, not a wrong slug — see candidateFileName.
     *
     * The REACHABLE skew is the mirror image, and it is the case below this one.
     */
    const entries = joinHistory(
      [{ key: 'k1', record: record({ workflowIds: ['wf-a', 'wf-b', 'wf-extra'] }) }],
      [workflow({ workflowId: 'wf-extra', images: [{ url: 'x', width: 1, height: 1, nsfwLevel: 1 }] })],
    );
    expect(entries[0].imageLabels).toEqual([null]);
  });

  it('pins the KNOWN MISLABEL on a pre-change row: more formats than ids shifts every later label', () => {
    /**
     * 🔴 THIS PINS A LIMITATION, NOT DESIRED BEHAVIOUR, and it is here because the
     * limitation was undocumented and unasserted while a comment described the
     * unreachable mirror case instead. At `a6aae56` `form.formats` held the ESTIMATE
     * survivors and `workflowIds` held the SUBMIT survivors, so one failed submit
     * leaves a row with more formats than ids — and the pairing is positional, so
     * every label after the gap names the wrong format. Nothing in the row records
     * which format each id came from, so this is not repairable from the data; the
     * README states it and this makes it machine-readable.
     *
     * Fixture: formats [A, B, C], ids [wf-a, wf-c] (B's submit failed). The correct
     * labels would be A and C; positional pairing gives A and B.
     */
    const three = record({
      workflowIds: ['wf-a', 'wf-c'],
      form: form({
        formats: [
          { id: 'fmt:a', label: 'Alpha', suffix: 'one', prompt: 'p one' },
          { id: 'fmt:b', label: 'Beta', suffix: 'two', prompt: 'p two' },
          { id: 'fmt:c', label: 'Gamma', suffix: 'three', prompt: 'p three' },
        ],
      }),
    });
    const entries = joinHistory(
      [{ key: 'k1', record: three }],
      [
        workflow({ workflowId: 'wf-a', images: [{ url: 'x', width: 1, height: 1, nsfwLevel: 1 }] }),
        workflow({ workflowId: 'wf-c', images: [{ url: 'y', width: 1, height: 1, nsfwLevel: 1 }] }),
      ],
    );
    // 'Gamma' is the truth for the second image; 'Beta' is what a positional pairing
    // can know. Asserted so that a later change which DOES fix it fails here loudly
    // rather than silently contradicting the README.
    expect(entries[0].imageLabels).toEqual(['Alpha', 'Beta']);
  });

  it('lists the still-cancellable workflow ids, and only those', () => {
    const entries = joinHistory(
      [{ key: 'k1', record: record() }],
      [workflow({ workflowId: 'wf-a', status: 'processing' }), workflow({ workflowId: 'wf-b', status: 'succeeded' })],
    );
    expect(entries[0].cancellableIds).toEqual(['wf-a']);
  });
});

describe('mergeUnsavedRecords', () => {
  /**
   * 🔴 THE FUNCTION THAT STOPS A FAILED WRITE DELETING PAID-FOR IMAGES. The batch row
   * is inserted optimistically; when `set()` rejects it exists in memory only, and
   * every reload of the stored half replaces the list with what storage holds. This is
   * what carries the unsaved half across that replacement. See `App.history.test.tsx`
   * for the click path, which is where the red at c84f082 is.
   */
  const at = (ms: number, id: string) => ({
    key: historyKey(ms, id),
    record: record({ batchId: id, createdAt: ms }),
  });

  it('🔴 keeps a record storage does not have', () => {
    const stored = at(1_700_000_000_000, 'old');
    const unsaved = at(1_800_000_000_000, 'new');
    expect(mergeUnsavedRecords([stored], [unsaved]).map((e) => e.record.batchId)).toEqual([
      'new',
      'old',
    ]);
  });

  it('🔴 puts it back in NEWEST-FIRST order, not on top', () => {
    // The stored half is newest-first because the key inverts the timestamp. An
    // unsaved row from BEFORE the newest stored one belongs second, and a `[...unsaved,
    // ...stored]` concat — the obvious wrong implementation — would pin it first.
    const newest = at(1_900_000_000_000, 'newest');
    const middle = at(1_800_000_000_000, 'middle');
    const oldest = at(1_700_000_000_000, 'oldest');
    expect(
      mergeUnsavedRecords([newest, oldest], [middle]).map((e) => e.record.batchId),
    ).toEqual(['newest', 'middle', 'oldest']);
  });

  it('does not duplicate a record storage DOES have, and storage wins', () => {
    // The retry that finally lands leaves the key in both halves for one render.
    const stored = at(1_700_000_000_000, 'same');
    const stale = { key: stored.key, record: record({ batchId: 'same', createdAt: 1_700_000_000_000, workflowIds: ['stale'] }) };
    const merged = mergeUnsavedRecords([stored], [stale]);
    expect(merged).toHaveLength(1);
    expect(merged[0].record.workflowIds).toEqual(['wf-a', 'wf-b']);
  });

  it('is a no-op copy when nothing is unsaved', () => {
    const stored = [at(1_800_000_000_000, 'a'), at(1_700_000_000_000, 'b')];
    const merged = mergeUnsavedRecords(stored, []);
    expect(merged).toEqual(stored);
    expect(merged).not.toBe(stored);
  });
});

describe('batchStatus', () => {
  const w = (status: AppWorkflow['status']) => workflow({ workflowId: status, status });

  it('🔴 never reports a partly-successful batch as failed', () => {
    // Killed by ranking failure first: that hides images the viewer PAID for.
    expect(batchStatus([w('succeeded'), w('failed')])).toBe('partial');
  });

  it('running outranks everything — there is still something to cancel', () => {
    expect(batchStatus([w('succeeded'), w('pending')])).toBe('running');
    expect(batchStatus([w('failed'), w('processing')])).toBe('running');
  });

  it('🔴 tells EXPIRED apart from FAILED, and both from unavailable', () => {
    // Three different facts, and `batchStatus` still has to distinguish them even
    // though the row no longer puts a WORD on screen for them: 'unavailable' is the
    // one that keeps a row's Resume button meaningful (the images aged out of the
    // orchestrator; the stored form is ours and does not expire), and 'running' is
    // the one that decides whether the row shows skeletons at all.
    expect(batchStatus([w('expired')])).toBe('expired');
    expect(batchStatus([w('failed')])).toBe('failed');
    expect(batchStatus([])).toBe('unavailable');
  });

  // 🔴 THE TWO BADGE-STRING CASES THAT STOOD HERE WERE DELETED WITH
  // `batchStatusLabel`/`batchStatusColor`. Their only caller was the status Badge on
  // each history row, which the operator asked to be removed in ALL states, so they
  // asserted the labels and colours of a surface that no longer renders — coverage
  // that reads as coverage and covers nothing, which is worse than none because it
  // stops the next reader looking. `batchStatus` ITSELF is still graded above: it
  // decides skeletons and the unavailable line, not a word on a pill.
});

// --- pruning --------------------------------------------------------------

describe('🔴 orphanedKeys — pruning, and the bound that keeps it from eating history', () => {
  const inWindow = record({ createdAt: Date.parse('2026-09-30T13:00:00.000Z'), workflowIds: ['gone'] });
  const beforeWindow = record({
    batchId: 'older',
    createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
    workflowIds: ['also-gone'],
  });
  const page = [
    workflow({ workflowId: 'live-1', createdAt: '2026-09-30T12:00:00.000Z' }),
    workflow({ workflowId: 'live-2', createdAt: '2026-09-30T14:00:00.000Z' }),
  ];
  const oldest = oldestWorkflowTime(page);

  it('prunes a record inside the fetched window that matches nothing', () => {
    expect(orphanedKeys([{ key: 'k-new', record: inWindow }], page, oldest)).toEqual(['k-new']);
  });

  it('🔴 NEVER prunes a record OLDER than the page we fetched', () => {
    // This is the whole bound. `useAppWorkflows` returns one page, so every
    // record past it trivially matches nothing — not because those workflows are
    // gone, but because we never asked. Killed by dropping `oldestFetchedAt`:
    // the viewer's entire history past page one disappears on first render.
    expect(orphanedKeys([{ key: 'k-old', record: beforeWindow }], page, oldest)).toEqual([]);
  });

  it('keeps a record that still matches a live workflow', () => {
    const matching = record({ workflowIds: ['live-2'], createdAt: Date.parse('2026-09-30T13:30:00.000Z') });
    expect(orphanedKeys([{ key: 'k', record: matching }], page, oldest)).toEqual([]);
  });

  it('prunes NOTHING when the live page came back empty — no evidence either way', () => {
    // An empty result cannot distinguish "you have no generations" from "the
    // query failed". Deleting on it would act on the first reading of an
    // observable that is equally consistent with the second.
    expect(orphanedKeys([{ key: 'k-new', record: inWindow }], [], oldestWorkflowTime([]))).toEqual([]);
  });

  it('keeps a batch alive while ANY one of its workflows is still live', () => {
    // Killed by requiring every id to match: a batch whose second format expired
    // earlier than its first would be pruned while still on screen.
    const half = record({ workflowIds: ['live-1', 'gone'], createdAt: Date.parse('2026-09-30T13:00:00.000Z') });
    expect(orphanedKeys([{ key: 'k', record: half }], page, oldest)).toEqual([]);
  });
});

describe('oldestWorkflowTime', () => {
  it('reads the minimum createdAt rather than trusting the page order', () => {
    expect(
      oldestWorkflowTime([
        workflow({ workflowId: 'a', createdAt: '2026-09-30T14:00:00.000Z' }),
        workflow({ workflowId: 'b', createdAt: '2026-09-30T09:00:00.000Z' }),
        workflow({ workflowId: 'c', createdAt: '2026-09-30T11:00:00.000Z' }),
      ]),
    ).toBe(Date.parse('2026-09-30T09:00:00.000Z'));
  });

  it('is null for an empty page, and ignores an unparseable timestamp', () => {
    expect(oldestWorkflowTime([])).toBeNull();
    expect(oldestWorkflowTime([workflow({ workflowId: 'a', createdAt: 'not a date' })])).toBeNull();
  });
});

describe('candidateFileName', () => {
  it('slugs the format label into a path-safe name the host can use verbatim', () => {
    expect(candidateFileName(2, 'Clickbait / Bold!')).toBe('yt-thumbnail-clickbait-bold-2.jpg');
  });
  it('falls back cleanly when there is no usable label', () => {
    expect(candidateFileName(1)).toBe('yt-thumbnail-1.jpg');
    expect(candidateFileName(1, '///')).toBe('yt-thumbnail-1.jpg');
  });
});

// --- the app's own view of the live queue ---------------------------------

describe('upsertOwnWorkflow', () => {
  /**
   * 🔴 WHAT THIS FUNCTION IS FOR: `useAppWorkflows()` is a page fetched EARLIER, so a
   * batch submitted seconds ago is not in it. The app folds every snapshot it polls
   * itself into a map keyed by workflowId, and that map is what stops the newest
   * history row rendering `unavailable` — and what stops `orphanedKeys` DELETING its
   * record for matching nothing.
   *
   * BEHAVIOUR coverage (the function is new). Each case names the plausible mistake.
   */
  const snap = (over: Record<string, unknown> = {}) =>
    ({ workflowId: 'wf-1', status: 'processing', ...over }) as never;

  it('is a no-op for a snapshot with no workflowId — there is nothing to key on', () => {
    const before = {};
    expect(upsertOwnWorkflow(before, snap({ workflowId: '' }), ['a.jpg'], 'T')).toBe(before);
  });

  it('stamps createdAt on FIRST SIGHT and never moves it', () => {
    // Killed by re-stamping `now` on every poll: `oldestWorkflowTime` would then walk
    // forward under the prune bound while a long generation is still running.
    const first = upsertOwnWorkflow({}, snap(), [], '2026-09-30T12:00:00.000Z');
    const second = upsertOwnWorkflow(first, snap(), [], '2026-09-30T12:09:00.000Z');
    expect(second['wf-1'].createdAt).toBe('2026-09-30T12:00:00.000Z');
  });

  it('🔴 an EMPTY image list does not erase urls a previous snapshot delivered', () => {
    // The real shape: a `succeeded` snapshot carries urls, and a later `poll` for the
    // same workflow can come back without them. Blanket-assigning would blank the
    // images the viewer paid for.
    const withImages = upsertOwnWorkflow(
      {},
      snap({ status: 'succeeded' }),
      ['a.jpg', 'b.jpg'],
      'T',
    );
    const later = upsertOwnWorkflow(withImages, snap({ status: 'succeeded' }), [], 'T');
    expect(later['wf-1'].images.map((i) => i.url)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('🔴 a MISSING cost does not erase one the server already reported', () => {
    // Same rule as `applySnapshotToRun`'s: `null` means "not told yet", never "free".
    const priced = upsertOwnWorkflow({}, snap({ cost: { total: 418 } }), [], 'T');
    const later = upsertOwnWorkflow(priced, snap({}), [], 'T');
    expect(later['wf-1'].cost).toBe(418);
  });

  it('carries the snapshot status through, and keeps other workflows untouched', () => {
    const two = upsertOwnWorkflow(
      upsertOwnWorkflow({}, snap({ workflowId: 'wf-a' }), ['a.jpg'], 'T'),
      snap({ workflowId: 'wf-b', status: 'succeeded' }),
      ['b.jpg'],
      'T',
    );
    expect(two['wf-a'].status).toBe('processing');
    expect(two['wf-b'].status).toBe('succeeded');
    expect(two['wf-a'].images.map((i) => i.url)).toEqual(['a.jpg']);
  });
});

describe('mergeLiveWorkflows', () => {
  /**
   * 🔴 THE MERGE MUST ONLY EVER ADD INFORMATION — it runs on every render, so a clause
   * that can LOSE a field would blink images or costs in and out. Each case pins one
   * clause and names what going the other way costs.
   */
  it('passes a page-only row through unchanged', () => {
    const page = [workflow({ workflowId: 'wf-a', cost: 209 })];
    expect(mergeLiveWorkflows(page, {})).toEqual(page);
  });

  it('🔴 APPENDS a workflow the page does not carry — the just-submitted batch', () => {
    // Killed by intersecting instead of unioning: the row for the batch the viewer
    // just paid for joins to nothing and reads `unavailable`.
    const mine = workflow({ workflowId: 'wf-new', status: 'processing' });
    const merged = mergeLiveWorkflows([workflow({ workflowId: 'wf-old' })], { 'wf-new': mine });
    expect(merged.map((w) => w.workflowId).sort()).toEqual(['wf-new', 'wf-old']);
  });

  it('🔴 fills an EMPTY page image list from ours, and never the other way round', () => {
    const page = [workflow({ workflowId: 'wf-a', images: [] })];
    const mine = {
      'wf-a': workflow({
        workflowId: 'wf-a',
        images: [{ url: 'mine.jpg', width: null, height: null, nsfwLevel: null }],
      }),
    };
    expect(mergeLiveWorkflows(page, mine)[0].images.map((i) => i.url)).toEqual(['mine.jpg']);

    // The page's own images WIN when it has them: it is the server's settled answer.
    const pageWithImages = [
      workflow({
        workflowId: 'wf-a',
        images: [{ url: 'page.jpg', width: null, height: null, nsfwLevel: null }],
      }),
    ];
    expect(mergeLiveWorkflows(pageWithImages, mine)[0].images.map((i) => i.url)).toEqual([
      'page.jpg',
    ]);
  });

  it('🔴 fills a NULL page cost from ours, and the page wins when it has one', () => {
    // 641 and 209 are distinct and neither is a multiple or sum of the other, so a
    // mutant that adds the two sides is visible.
    const mine = { 'wf-a': workflow({ workflowId: 'wf-a', cost: 209 }) };
    expect(
      mergeLiveWorkflows([workflow({ workflowId: 'wf-a', cost: null })], mine)[0].cost,
    ).toBe(209);
    expect(
      mergeLiveWorkflows([workflow({ workflowId: 'wf-a', cost: 641 })], mine)[0].cost,
    ).toBe(641);
  });

  it('🔴 upgrades a STALE non-terminal page status from our terminal one', () => {
    // A page fetched mid-generation says `processing` about a workflow we have already
    // watched succeed. Leaving it would show a permanent skeleton over finished images.
    const mine = { 'wf-a': workflow({ workflowId: 'wf-a', status: 'succeeded' }) };
    expect(
      mergeLiveWorkflows([workflow({ workflowId: 'wf-a', status: 'processing' })], mine)[0]
        .status,
    ).toBe('succeeded');
  });

  it('🔴 never DOWNGRADES a terminal page status from our stale non-terminal one', () => {
    // The same error mirrored, and the one a naive "ours always wins" produces: our
    // last poll said `pending` while the page knows the workflow expired.
    const mine = { 'wf-a': workflow({ workflowId: 'wf-a', status: 'pending' }) };
    expect(
      mergeLiveWorkflows([workflow({ workflowId: 'wf-a', status: 'expired' })], mine)[0].status,
    ).toBe('expired');
  });

  it('keeps the PAGE’s createdAt when both have the row — it is the real one', () => {
    const mine = {
      'wf-a': workflow({ workflowId: 'wf-a', createdAt: '2030-01-01T00:00:00.000Z' }),
    };
    expect(
      mergeLiveWorkflows(
        [workflow({ workflowId: 'wf-a', createdAt: '2026-01-01T00:00:00.000Z' })],
        mine,
      )[0].createdAt,
    ).toBe('2026-01-01T00:00:00.000Z');
  });

  it('🔴 a merged own-row PROTECTS its record from the prune', () => {
    /**
     * THE SEAM, not either component. The record is written the moment ids exist, so
     * its `createdAt` is inside the fetched window and it matches nothing in the page
     * — the exact condition `orphanedKeys` deletes on. Two observations, one variable:
     * without the merge the key is orphaned, with it the key is not.
     */
    const rec = record({
      createdAt: Date.parse('2026-09-30T13:00:00.000Z'),
      workflowIds: ['wf-new'],
    });
    const stored = [{ key: 'gen:v1:k', record: rec }];
    const page = [workflow({ workflowId: 'wf-old', createdAt: '2026-09-30T11:00:00.000Z' })];

    expect(orphanedKeys(stored, page, oldestWorkflowTime(page))).toEqual(['gen:v1:k']);

    const widened = mergeLiveWorkflows(page, {
      'wf-new': workflow({ workflowId: 'wf-new', status: 'processing' }),
    });
    expect(orphanedKeys(stored, widened, oldestWorkflowTime(widened))).toEqual([]);
  });
});

// --- what the surface shows -----------------------------------------------

describe('showHistory', () => {
  /**
   * 🔴 THE ONLY HIDING CASE IS ready-AND-EMPTY. The plausible mistake is widening it
   * to "empty", which deletes the sign-in prompt, the storage-grant message and the
   * retry — each the only thing on screen naming the fix for its own state.
   */
  it('hides ONLY when ready, empty and noteless', () => {
    expect(showHistory({ state: 'ready', entryCount: 0, note: null })).toBe(false);
  });

  it('shows for every non-ready state, even empty and noteless', () => {
    for (const state of ['loading', 'anon', 'denied', 'error'] as const) {
      expect(showHistory({ state, entryCount: 0, note: null }), state).toBe(true);
    }
  });

  it('shows as soon as there is a row, and shows for a note with no rows', () => {
    expect(showHistory({ state: 'ready', entryCount: 1, note: null })).toBe(true);
    // The note is about the run that JUST happened ("too large to save"), so it may
    // not vanish with its container.
    expect(showHistory({ state: 'ready', entryCount: 0, note: 'x' })).toBe(true);
  });
});

describe('skeletonCount', () => {
  /**
   * 🔴 FORMATS AND QUANTITY MULTIPLY — the same arithmetic the cost disclosure makes.
   * The fixtures below keep the two factors DIFFERENT from each other and from the
   * product, so a mutant that returns either factor alone, or their sum, is visible.
   */
  const rec = (formats: number, quantity: number) =>
    record({
      form: form({
        quantity,
        formats: Array.from({ length: formats }, (_, i) => ({
          id: `f${i}`,
          label: `F${i}`,
          suffix: 's',
          prompt: 'p',
        })),
      }),
    });

  it('is formats × quantity when nothing has landed', () => {
    // 3 formats × 4 = 12. Deliberately NOT a power-of-two multiple of either factor,
    // and 12 is none of 3, 4 or 7 (their sum).
    expect(skeletonCount(rec(3, 4), 0)).toBe(12);
  });

  it('subtracts what has already landed', () => {
    expect(skeletonCount(rec(3, 4), 5)).toBe(7);
  });

  it('never goes negative when MORE landed than expected', () => {
    // A host may return more images than asked; a negative count renders nothing at
    // all in one reading and throws in another (`Array.from({length: -1})`).
    expect(skeletonCount(rec(1, 1), 9)).toBe(0);
  });

  // The 'treats a zero/absent factor as one' case is GONE with the clamp it
  // described. Neither factor can be zero: `parseRecord` refuses a record whose
  // `formats` is empty, and `quantity` passes `clampQuantity` (QUANTITY_MIN = 1)
  // before it is stored. The clamp was unreachable, and a test pinning unreachable
  // behaviour reads as coverage while guarding nothing — the `rec(0, 0)` record it
  // asserted on cannot exist.
});
