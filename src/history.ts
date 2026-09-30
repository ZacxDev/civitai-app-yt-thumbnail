// Pure logic for THUMBNAIL HISTORY: past generations, their realized cost, and
// the form state needed to RESUME one. No React, no DOM — unit-tested in node
// (see history.test.ts). The App glue imports these so every load-bearing
// decision (the storage key order, the join, the prune bound, the resume body)
// lives in one tested place.
//
// ---------------------------------------------------------------------------
// 🔴 WHY THIS IS A JOIN AND NOT ONE SOURCE. The platform's trust boundary forces
// it, and no amount of design removes the seam:
//
//   `useAppWorkflows()` is the LIVE half. It is token-bound and tag-forced by the
//   host, so it can only ever return THIS app's generations for THIS viewer, and
//   it carries what the orchestrator knows: workflowId, status, images[], cost,
//   createdAt, plus a `cancel`. It is the only authority on whether a generation
//   succeeded, what it cost, and whether its blobs are still there.
//
//   It CANNOT carry the form. The host DELIBERATELY drops "steps, params,
//   prompts, resources, tokens, transactions, metadata, tags" from the
//   projection (AppWorkflow's own doc comment) precisely so a block cannot read
//   generation internals of a queue it owns only by tag. So "what prompt was
//   that?" is unanswerable from the live half, by design, forever.
//
//   `useAppStorage()` is the OURS half: a per-(app, viewer) KV we write at submit
//   time, holding exactly the state a resume needs. It knows nothing about
//   whether the workflow ran.
//
// The join key is `workflowId` — the one field that crosses.
//
// 🔴 AND THE GROUPING HAS TO BE OURS TOO. This app submits N workflows per
// Generate click (one per selected format, because a workflow body carries
// exactly ONE params.prompt). Tags are dropped from the projection, so the live
// half hands back N rows with NOTHING tying them together: a 3-format run would
// render as three unrelated history entries at three unrelated prices. The
// stored record therefore carries its own `workflowIds` list, and the join
// rebuilds the batch from it.
// ---------------------------------------------------------------------------

import type { AppWorkflow } from '@civitai/app-sdk/blocks';

import { buildWorkflowBody, type AccountChoice, type SourceImage } from './generation.js';
import type { CheckpointOption, LoraOption } from './models.js';

/** Key prefix for a stored generation record. Bumped if the shape changes. */
export const HISTORY_PREFIX = 'gen:v1:';

/** How many history entries the panel loads at a time. */
export const HISTORY_PAGE_SIZE = 20;

/**
 * Per-value ceiling the host enforces (`useAppStorage.set` rejects over this).
 * Mirrored here so an over-large record is refused BEFORE the round trip, with a
 * message about what it was, rather than as an opaque PAYLOAD_TOO_LARGE.
 */
export const STORAGE_VALUE_MAX_BYTES = 64 * 1024;

/** Digits in the inverted-timestamp key segment. Fits ms well past year 5000. */
const TS_DIGITS = 14;
/** The constant the timestamp is subtracted FROM to invert the ordering. */
const TS_INVERT_BASE = 10 ** TS_DIGITS - 1;

/**
 * Build the storage key for a batch created at `createdAtMs`.
 *
 * 🔴 THE TIMESTAMP IS INVERTED ON PURPOSE. `useAppStorage.list()` is a
 * keyset-paginated KEY listing — it returns keys and `updatedAt` and nothing
 * else, and its cursor is "an opaque, base64-encoded last key", i.e. it pages
 * forward through the key ORDER. There is no sort option. So the only way to get
 * "newest first, cheaply, one page at a time" is to make newest-first BE the key
 * order: store `TS_INVERT_BASE - createdAt`, zero-padded to a FIXED width so
 * lexicographic and numeric order agree.
 *
 * Without the fixed width this silently breaks wherever the inverted value
 * changes digit count — as strings, '999' sorts before '9999' sorts before
 * '98299999999999', which is the opposite of their numeric order. Note that
 * EVERY realistic epoch-ms timestamp inverts to 14 digits already, so the pad is
 * a no-op on them: the defect is invisible to any test built only from plausible
 * dates, and history.test.ts says so and picks values that straddle instead.
 *
 * `batchId` makes the key unique when two batches land in the same millisecond.
 */
export function historyKey(createdAtMs: number, batchId: string): string {
  const inverted = TS_INVERT_BASE - Math.max(0, Math.floor(createdAtMs));
  return `${HISTORY_PREFIX}${String(inverted).padStart(TS_DIGITS, '0')}:${batchId}`;
}

/** Recover the creation timestamp a key encodes, or `null` if it isn't one of ours. */
export function timestampFromKey(key: string): number | null {
  if (!key.startsWith(HISTORY_PREFIX)) return null;
  const rest = key.slice(HISTORY_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) return null;
  const digits = rest.slice(0, colon);
  if (digits.length !== TS_DIGITS || !/^\d+$/.test(digits)) return null;
  return TS_INVERT_BASE - Number(digits);
}

/**
 * Everything a RESUME needs to rebuild the form — and, via {@link batchBodies},
 * the exact bodies the original click submitted.
 *
 * 🔴 THE RESOLVED FORMATS ARE STORED, NOT JUST THEIR IDS. A format is a label +
 * a prompt suffix, and the viewer's own formats are deletable. Storing ids alone
 * would make a resume of a run whose custom format has since been deleted
 * silently submit a DIFFERENT prompt — the one thing a resume must never do.
 */
export interface GenerationForm {
  mode: 'generate' | 'remix';
  /** The prompt BOX's text — restored into the form. */
  prompt: string;
  /** Per-format prompt overrides, keyed by format id (generation.ts PromptEdits). */
  promptEdits: Record<string, string>;
  /**
   * The formats this click ran, resolved and in submission order.
   *
   * 🔴 `prompt` HERE IS THE STRING THAT WAS ACTUALLY SUBMITTED for this format —
   * `effectivePrompt` already applied, trimmed and capped. It is stored
   * RESOLVED, not re-derivable, because re-deriving it at resume time from
   * `prompt` + `suffix` + `promptEdits` would give a different answer the moment
   * any of the three moved, and "different answer" here means the viewer pays
   * for a string they did not see. `label`/`suffix` are carried alongside it so
   * the form can be rebuilt even for a custom format since deleted.
   */
  formats: Array<{ id: string; label: string; suffix: string; prompt: string }>;
  checkpoint: CheckpointOption;
  loras: LoraOption[];
  quantity: number;
  /** The pool actually submitted under — NOT the picker's value before the default ran. */
  account: AccountChoice;
  sourceImage: SourceImage | null;
}

/** One stored batch: the grouping plus the form. */
export interface GenerationRecord {
  /** Schema version, so a future shape change can be told apart rather than guessed. */
  v: 1;
  batchId: string;
  /** Epoch ms. Also encoded in the key, but carried in the value so a parsed
   *  record is self-describing without its key. */
  createdAt: number;
  /** The workflows this one click produced — the join key, and the grouping. */
  workflowIds: string[];
  form: GenerationForm;
}

/**
 * 🔴 THE BODIES A RESUME WOULD SUBMIT — and the SAME function the original click
 * builds its bodies with. That identity is the whole point: "resume reproduces
 * the original body" is not a property this code hopes for and a test checks
 * afterwards, it is the only way either path can produce a body at all.
 *
 * One body per format, in order, each carrying the prompt that format ACTUALLY
 * submitted (resolved once, at snapshot time — see `GenerationForm.formats`).
 */
export function batchBodies(form: GenerationForm): Array<ReturnType<typeof buildWorkflowBody>> {
  return form.formats.map((fmt) =>
    buildWorkflowBody(fmt.prompt, form.checkpoint, form.loras, form.account, {
      quantity: form.quantity,
      sourceImage: form.mode === 'remix' ? form.sourceImage : null,
    }),
  );
}

/**
 * Is this value a record we wrote? Storage hands back arbitrary JSON (a row
 * written by an older version, a half-written value, anything), so every read is
 * validated rather than cast.
 *
 * Deliberately STRUCTURAL and total: an unrecognised row is dropped from the
 * list, never rendered half-parsed and never thrown on.
 */
export function parseRecord(raw: unknown): GenerationRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  if (typeof r.batchId !== 'string' || r.batchId === '') return null;
  if (typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt)) return null;
  if (!Array.isArray(r.workflowIds)) return null;
  const workflowIds = r.workflowIds.filter((w): w is string => typeof w === 'string' && w !== '');
  if (workflowIds.length === 0) return null;
  const f = r.form;
  if (typeof f !== 'object' || f === null) return null;
  const form = f as Record<string, unknown>;
  if (!Array.isArray(form.formats) || form.formats.length === 0) return null;
  // 🔴 EVERY format entry must carry its resolved `prompt`. A row written before
  // that field existed would otherwise resume with `undefined` as the prompt —
  // i.e. build a body whose `params.prompt` is the string "undefined" and charge
  // for it. Refusing the row is the only safe answer; it still isn't rendered
  // half-parsed, it simply doesn't appear.
  const formatsOk = form.formats.every(
    (e) =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as Record<string, unknown>).id === 'string' &&
      typeof (e as Record<string, unknown>).prompt === 'string',
  );
  if (!formatsOk) return null;
  const checkpoint = form.checkpoint as Record<string, unknown> | undefined;
  if (
    typeof checkpoint !== 'object' ||
    checkpoint === null ||
    typeof checkpoint.versionId !== 'number' ||
    typeof checkpoint.modelId !== 'number'
  ) {
    return null;
  }
  return {
    v: 1,
    batchId: r.batchId,
    createdAt: r.createdAt,
    workflowIds,
    form: f as unknown as GenerationForm,
  };
}

/** Would this record fit the host's 64 KB per-value ceiling? */
export function recordFits(record: GenerationRecord): boolean {
  return new TextEncoder().encode(JSON.stringify(record)).length <= STORAGE_VALUE_MAX_BYTES;
}

/** A batch's status, reduced from its workflows' statuses. */
export type BatchStatus =
  | 'running'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'expired'
  | 'canceled'
  | 'unavailable';

/** One history row: the stored record joined to whatever the live queue knows. */
export interface HistoryEntry {
  key: string;
  record: GenerationRecord;
  /** The live workflows this batch's ids resolved to. EMPTY when none did. */
  workflows: AppWorkflow[];
  status: BatchStatus;
  /** Every displayable image across the batch's workflows, in workflow order. */
  imageUrls: string[];
  /** Summed realized cost over the workflows that reported one; `null` when none did. */
  cost: number | null;
  /** True when the live queue knows nothing about ANY of this batch's workflows. */
  unavailable: boolean;
  /** Workflow ids that are still cancellable (pending/processing). */
  cancellableIds: string[];
}

/**
 * Reduce a batch's workflow statuses to the one badge the row shows.
 *
 * 🔴 'unavailable' IS NOT 'failed', AND THE DIFFERENCE IS THE WHOLE POINT OF
 * KEEPING THESE ROWS. A batch whose workflows have aged out of the orchestrator
 * has no live half left — but the stored half is OURS and does not expire, so
 * Resume still works perfectly. Rendering it as a failure would tell the viewer
 * their generation broke, when what actually happened is that its images went
 * away. Different fact, different word, same working button.
 *
 * Running outranks everything (there is still something to cancel); then a mix of
 * success and non-success is 'partial', because reporting a 3-format run as
 * 'failed' when two of them delivered hides images the viewer PAID for.
 */
export function batchStatus(workflows: readonly AppWorkflow[]): BatchStatus {
  if (workflows.length === 0) return 'unavailable';
  const has = (s: AppWorkflow['status']) => workflows.some((w) => w.status === s);
  if (has('pending') || has('processing')) return 'running';
  const succeeded = workflows.filter((w) => w.status === 'succeeded').length;
  if (succeeded === workflows.length) return 'succeeded';
  if (succeeded > 0) return 'partial';
  if (has('failed')) return 'failed';
  if (has('expired')) return 'expired';
  if (has('canceled')) return 'canceled';
  return 'unavailable';
}

/**
 * THE JOIN. Stored records (newest-first) × the live workflow page → the rows the
 * history panel renders.
 *
 * A record whose workflows are all missing from the live page is KEPT, flagged
 * `unavailable`. It is not an error state and it is not pruned here — see
 * {@link orphanedKeys} for why pruning needs a bound this function does not have.
 */
export function joinHistory(
  records: ReadonlyArray<{ key: string; record: GenerationRecord }>,
  workflows: readonly AppWorkflow[],
): HistoryEntry[] {
  const byId = new Map(workflows.map((w) => [w.workflowId, w]));
  return records.map(({ key, record }) => {
    const found = record.workflowIds
      .map((id) => byId.get(id))
      .filter((w): w is AppWorkflow => w !== undefined);
    const costs = found.filter((w) => typeof w.cost === 'number' && Number.isFinite(w.cost));
    return {
      key,
      record,
      workflows: found,
      status: batchStatus(found),
      imageUrls: found.flatMap((w) => w.images.map((i) => i.url)),
      cost: costs.length === 0 ? null : costs.reduce((sum, w) => sum + (w.cost as number), 0),
      unavailable: found.length === 0,
      cancellableIds: found
        .filter((w) => w.status === 'pending' || w.status === 'processing')
        .map((w) => w.workflowId),
    };
  });
}

/**
 * Storage keys whose batches no live workflow matches — safe to delete so the two
 * halves cannot drift.
 *
 * 🔴 BOUNDED BY `oldestFetchedAt`, AND WITHOUT THAT BOUND THIS FUNCTION DELETES
 * THE VIEWER'S HISTORY. `useAppWorkflows({ limit })` returns ONE PAGE. Every
 * record older than that page's oldest workflow has, trivially, none of its ids
 * in the page — not because those workflows are gone, but because we never asked
 * about them. Pruning on "no match" alone would therefore wipe every batch past
 * the first page on the first render, silently and irreversibly.
 *
 * So a record is orphaned ONLY when it matched nothing AND it was created at or
 * after the oldest workflow we actually fetched — i.e. only inside the window the
 * live page is evidence about. An absent `oldestFetchedAt` (no workflows returned
 * at all) means we have NO evidence about any record, so nothing is pruned.
 *
 * This is the same rule as "an empty result cannot distinguish two mechanisms":
 * "not in this page" and "does not exist" look identical, so the window is what
 * separates them.
 */
export function orphanedKeys(
  records: ReadonlyArray<{ key: string; record: GenerationRecord }>,
  workflows: readonly AppWorkflow[],
  oldestFetchedAt: number | null,
): string[] {
  if (oldestFetchedAt == null) return [];
  const live = new Set(workflows.map((w) => w.workflowId));
  return records
    .filter(
      ({ record }) =>
        record.createdAt >= oldestFetchedAt && !record.workflowIds.some((id) => live.has(id)),
    )
    .map(({ key }) => key);
}

/**
 * The creation time of the OLDEST workflow in a fetched page — the bound
 * {@link orphanedKeys} needs. `null` for an empty page (no evidence).
 *
 * Reads `createdAt` (an ISO-8601 string on the wire) rather than trusting the
 * page's order, so a host that returns them in some other order still yields a
 * correct bound.
 */
export function oldestWorkflowTime(workflows: readonly AppWorkflow[]): number | null {
  let oldest: number | null = null;
  for (const w of workflows) {
    const t = Date.parse(w.createdAt);
    if (!Number.isFinite(t)) continue;
    if (oldest === null || t < oldest) oldest = t;
  }
  return oldest;
}

/** Human label for a batch status badge. */
export function batchStatusLabel(status: BatchStatus): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'succeeded':
      return 'Done';
    case 'partial':
      return 'Partly done';
    case 'failed':
      return 'Failed';
    case 'expired':
      return 'Expired';
    case 'canceled':
      return 'Canceled';
    case 'unavailable':
      return 'Images no longer available';
  }
}

/** Badge colour for a batch status (the W6 pack's colour names). */
export function batchStatusColor(status: BatchStatus): 'info' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'running':
      return 'info';
    case 'succeeded':
      return 'success';
    case 'partial':
    case 'expired':
    case 'canceled':
    case 'unavailable':
      return 'warning';
    case 'failed':
      return 'error';
  }
}

/**
 * A filename for a saved candidate. The host's Save As uses it verbatim, so it is
 * sanitised here rather than trusting a format label to be path-safe.
 */
export function candidateFileName(index: number, label?: string): string {
  const slug = (label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug ? `yt-thumbnail-${slug}-${index}.jpg` : `yt-thumbnail-${index}.jpg`;
}
