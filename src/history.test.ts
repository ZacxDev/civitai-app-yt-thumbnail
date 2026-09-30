import { describe, expect, it } from 'vitest';

import { buildWorkflowBody } from './generation.js';
import {
  HISTORY_PREFIX,
  STORAGE_VALUE_MAX_BYTES,
  batchBodies,
  batchStatus,
  batchStatusColor,
  batchStatusLabel,
  candidateFileName,
  historyKey,
  joinHistory,
  oldestWorkflowTime,
  orphanedKeys,
  parseRecord,
  recordFits,
  timestampFromKey,
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

  it('lists the still-cancellable workflow ids, and only those', () => {
    const entries = joinHistory(
      [{ key: 'k1', record: record() }],
      [workflow({ workflowId: 'wf-a', status: 'processing' }), workflow({ workflowId: 'wf-b', status: 'succeeded' })],
    );
    expect(entries[0].cancellableIds).toEqual(['wf-a']);
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
    // Three different facts with three different words. Collapsing them tells a
    // viewer their generation broke when in fact its images merely aged out.
    expect(batchStatus([w('expired')])).toBe('expired');
    expect(batchStatus([w('failed')])).toBe('failed');
    expect(batchStatus([])).toBe('unavailable');
    expect(batchStatusLabel('unavailable')).toBe('Images no longer available');
    expect(batchStatusLabel('failed')).toBe('Failed');
    expect(batchStatusLabel('expired')).toBe('Expired');
  });

  it('gives every status a label and a colour', () => {
    // Exhaustiveness: a new status that nobody labelled renders as `undefined`.
    for (const s of ['running', 'succeeded', 'partial', 'failed', 'expired', 'canceled', 'unavailable'] as const) {
      expect(typeof batchStatusLabel(s)).toBe('string');
      expect(batchStatusLabel(s).length).toBeGreaterThan(0);
      expect(['info', 'success', 'warning', 'error']).toContain(batchStatusColor(s));
    }
  });
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
