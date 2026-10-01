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

import type { AppWorkflow, BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

import type { BuzzAccountType } from '@civitai/app-sdk/blocks';

import {
  BUZZ_ACCOUNT_TYPES,
  buildWorkflowBody,
  type AccountChoice,
  type SourceImage,
} from './generation.js';
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
  /**
   * The Buzz pool that PRIMARILY funded this batch, once the server has said.
   *
   * 🔴 OPTIONAL, AND IT HAS TO BE, FOR TWO INDEPENDENT REASONS. (1) Every record
   * ALREADY IN A VIEWER'S STORAGE was written before this field existed, so
   * `undefined` is the normal case for a row from yesterday and must render a
   * NEUTRAL bolt rather than a guessed colour. (2) Even for a new batch it is
   * unknown AT WRITE TIME: the record is written the moment workflow ids exist —
   * before anything has run — while the pool arrives on a SUCCEEDED
   * `BlockWorkflowSnapshot` (`spentAccountType`) seconds to minutes later. The App
   * therefore patches it in afterwards (see {@link spendPatches}).
   *
   * 🔴 IT IS NOT `form.account`. `form.account` is the pool the viewer ASKED to
   * spend from and can be `'auto'`; this is the pool the server actually debited
   * most from, which can differ from the request (a gen covered mostly by
   * free/earned Buzz reports `blue` whatever was picked). Colouring the bolt from
   * the request would be a false statement about where the money came from.
   *
   * `undefined` = not known. The field is never written as `null`: an absent key
   * costs nothing in the 64 KB budget and a stored `null` would have to mean
   * exactly the same thing as its absence.
   */
  spentAccount?: BuzzAccountType;
}

/** Is this one of the three pools a block can be told about? */
function isBuzzAccountType(value: unknown): value is BuzzAccountType {
  return typeof value === 'string' && (BUZZ_ACCOUNT_TYPES as readonly string[]).includes(value);
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
    // 🔴 AN UNRECOGNISED POOL IS DROPPED, NOT A REASON TO REFUSE THE ROW. This
    // field is decoration on a row whose load-bearing half (the form, the ids) is
    // already validated above, so a row carrying `spentAccount: 'red'` — a pool a
    // block may not be told about — or a number, or a typo, still renders, still
    // resumes, and simply gets the neutral bolt a row from before this field
    // existed gets. Refusing it would delete a past generation over a colour.
    ...(isBuzzAccountType(r.spentAccount) ? { spentAccount: r.spentAccount } : {}),
  };
}

/**
 * The spent pool a batch's workflows AGREE on, or `null`.
 *
 * 🔴 AGREEMENT IS REQUIRED, AND `null` IS THE HONEST ANSWER WITHOUT IT. One click
 * submits N workflows and the server clamps each one's funding INDEPENDENTLY, so a
 * 3-format batch really can be funded from two different pools. Painting the row's
 * bolt with one of them would be a false statement about where the viewer's money
 * came from; a neutral bolt is not. This is the same rule `SpentAccountNote` used
 * to apply to the alert this replaced, which is why it is one function and not two.
 *
 * Workflows with no pool reported yet are IGNORED rather than treated as
 * disagreement — a batch whose second format is still running has one pool known
 * and that is not a conflict.
 *
 * 🔴 AND NO LIVE CALLER DEPENDS ON THAT RULE — THE RENDER PATH THIS NOTE USED TO NAME
 * DOES NOT EXIST. `joinHistory` never calls this function: it reads
 * `record.spentAccount ?? null` straight off the stored row (see its `spentAccount:`
 * line), so no render recomputes a provisional answer and nothing is "corrected when
 * the second format reports". This function's ONLY caller in the app is `spendPatches`
 * below, and that caller requires EVERY workflow in the batch to have reported before
 * it calls here — so `pools[id]` is never `undefined` on the live path and the
 * `pool !== undefined` test below is unreachable from production code.
 *
 * It is kept, and NOT as defence-in-depth: it IS the contract stated above rather than
 * a guard over it. Without it `seen` would collect `undefined` as though it were a
 * pool. Measured by deleting it and running the whole suite: exactly 2 of 841 cases red,
 * both of them this function's own, and both with the predicted failures — a
 * partly-reported batch returned `null` where `'blue'` is correct (a disagreement that
 * is not there), and an all-unknown batch returned `undefined` where `null` is correct.
 * Nothing else in the suite moved. So those unit tests are its only exercisers, and the
 * alternative is not a simpler function but a differently-wrong one.
 *
 * The ignore rule is wrong for a WRITE, which is why `spendPatches` does not rely on
 * this function alone: formats finish seconds apart, so the first answer is almost
 * always the only answer, and a stamp is permanent. See its own note.
 */
export function agreedSpentPool(
  workflowIds: readonly string[],
  pools: Readonly<Record<string, BuzzAccountType>>,
): BuzzAccountType | null {
  const seen = new Set<BuzzAccountType>();
  for (const id of workflowIds) {
    const pool = pools[id];
    if (pool !== undefined) seen.add(pool);
  }
  return seen.size === 1 ? [...seen][0] : null;
}

/** One row the caller should patch, plus whether storage will take the result. */
export interface SpendPatch extends StoredRecord {
  /**
   * The patched record is past the host's per-value ceiling, so the `set` would be
   * refused. The caller must still apply the patch IN MEMORY — that is what stops this
   * function returning the row forever — and skip the write, saying so rather than
   * letting the rejection disappear into a `.catch`.
   */
  tooLarge: boolean;
}

/**
 * Records that can LEARN their spent pool from what the app has been told, each
 * returned as the record it should become.
 *
 * Pure, and deliberately returns ONLY the rows that change: the caller writes one
 * storage `set` per returned row, so a function that returned every record would
 * rewrite a viewer's whole history on every render. An empty result is the steady
 * state and is what makes the caller's effect terminate.
 *
 * A row that ALREADY carries a pool is never re-patched, even if the map now
 * disagrees — the first thing the server said about a batch is the thing we
 * recorded, and rewriting it would make the row's history depend on when it was
 * last looked at.
 *
 * 🔴 SO EVERY WORKFLOW IN THE BATCH MUST HAVE REPORTED BEFORE ANYTHING IS WRITTEN, AND
 * THAT IS WHAT MAKES THE NEVER-RE-PATCH RULE SAFE. `agreedSpentPool` ignores a workflow
 * with no pool yet, which is correct for the render it was written for and wrong here:
 * composed with "never re-patch", it stamped the row from whichever format reported
 * FIRST — the normal timeline, since formats finish seconds apart — so a 2-format batch
 * funded from two pools asserted ONE of them, permanently, on a surface about the
 * viewer's money. Measured: patch `wf-a='blue'`, then learn `wf-b='yellow'`, and the row
 * rendered its whole cost as `blue`. Requiring the full set is what keeps the honest
 * neutral bolt reachable; `agreedSpentPool` then decides agreement, as before.
 *
 * It is NOT a terminal-status check, deliberately: this module has no status for a
 * workflow the live page has not delivered yet, and a batch whose last format never
 * reports simply keeps the neutral bolt — the same answer it has today while running.
 *
 * 🔴 AND THAT NEUTRAL BOLT IS THEN PERMANENT FOR THAT ROW. The app-side half is
 * unconditional: a pool is recorded ONLY from a snapshot that actually carries
 * `spentAccountType` (`App.tsx` `applySnapshotToRun`), so a workflow whose pool never
 * arrives contributes nothing, `every` above holds the WHOLE batch back, and no write is
 * ever made. There is no later repair: the pool map is session state filled only by the
 * SUBMIT poll loop, which runs for the batch being submitted and never re-polls an older
 * one. So after a reload the map starts empty and no unstamped row can learn its pool
 * again, whatever ended it — the write only ever happens in the session that submitted
 * the batch, while that batch's own poll loop is still running.
 *
 * That already makes one trigger CERTAIN and host-independent: a batch still running
 * when the viewer reloads or closes the tab keeps the neutral bolt for good, because
 * nothing will ever poll it again.
 *
 * ⚠ THE OTHER TWO SHAPES ARE HOST-DEPENDENT AND THE DEPENDENCE IS UNVERIFIED: the
 * shipped `yt-history-cancel` button (`History.tsx`), and one format of a multi-format
 * batch failing while its siblings succeed. Both reach this rule ONLY IF the host leaves
 * `spentAccountType` off the terminal snapshot — and whether it does is untested here,
 * because every test of this path runs against the MOCK host. Note the poll loop does
 * keep running after a cancel until it sees a terminal status, so the app does get one
 * more snapshot; the open question is purely what that snapshot carries. If the host
 * stamps a pool on it, these two shapes largely disappear; if it does not, any
 * multi-format batch with one casualty keeps a grey bolt forever. This note asserts
 * neither.
 *
 * 🔴 ACCEPTED BY THE OPERATOR, with both alternatives on the table: treating a terminal
 * non-success as "reported", or reverting to a memory-only colour. Neither was taken. A
 * neutral bolt means "we do not know", which is TRUE in every shape above, and both
 * alternatives trade that for a row that can assert the WRONG pool on a surface about
 * the viewer's money. `history.test.ts` pins the rule so it stays deliberate rather than
 * incidental — what it pins is the app's behaviour given a missing pool, not when the
 * host leaves one missing.
 *
 * 🔴 AND THE 64 KB CEILING IS RE-CHECKED, because the pool field is what can cross it.
 * `recordFits` was consulted once, at submit, where the record carries no
 * `spentAccount`; `,"spentAccount":"yellow"` is enough to push a row that fit then over
 * now. One rule in one place — `recordFits` — asked a second time, at the second write.
 */
export function spendPatches(
  records: ReadonlyArray<StoredRecord>,
  pools: Readonly<Record<string, BuzzAccountType>>,
): SpendPatch[] {
  const out: SpendPatch[] = [];
  for (const entry of records) {
    if (entry.record.spentAccount !== undefined) continue;
    if (!entry.record.workflowIds.every((id) => pools[id] !== undefined)) continue;
    const pool = agreedSpentPool(entry.record.workflowIds, pools);
    if (pool === null) continue;
    const record = { ...entry.record, spentAccount: pool };
    out.push({ key: entry.key, record, tooLarge: !recordFits(record) });
  }
  return out;
}

/** Would this record fit the host's 64 KB per-value ceiling? */
export function recordFits(record: GenerationRecord): boolean {
  return new TextEncoder().encode(JSON.stringify(record)).length <= STORAGE_VALUE_MAX_BYTES;
}

/** One stored batch as the app holds it: the storage key plus the parsed value. */
export interface StoredRecord {
  key: string;
  record: GenerationRecord;
}

/**
 * Re-attach records the app is HOLDING that storage does not have.
 *
 * 🔴 THIS IS THE REASON A FAILED WRITE NO LONGER DELETES PAID-FOR IMAGES. The
 * batch row is inserted optimistically, before `set()` is acknowledged, because it
 * is the surface the viewer's images appear in. If that write REJECTS, the row
 * exists only in memory — and every reload of the stored half (`loadHistory`,
 * which the error banner's own "Try again" button calls, and which the Show
 * toggle calls too) REPLACES the list with what storage actually holds. That list
 * never contained this run, so the row and its images vanished permanently: the
 * join is the only renderer for them, so they did not come back on reload either.
 *
 * So a reload is a merge, not a replacement. 🔴 AND THE RULE IS ABOUT ROWS THAT
 * EXIST, NOT ONLY ABOUT ROWS WE KNOW FAILED TO SAVE — this sentence used to say the
 * narrower thing, and the narrower reading is what let a second bug through. A batch
 * inserted AND successfully saved while a `loadHistory` was already in flight is in
 * neither half that read can see: not in the stored listing (taken before the write)
 * and not in the unsaved map (the write succeeded, so it was dropped from it). The
 * caller therefore passes the CURRENT list as well, which is why `App.tsx` calls this
 * from inside a functional `setHistoryRecords` rather than on a snapshot. Anything on
 * screen that storage has not accounted for survives the reload.
 *
 * Ordering is restored by `createdAt` descending, the same newest-first order the
 * inverted key gives the stored half, so a carried-over row lands where it belongs
 * rather than being pinned to the top.
 *
 * Stored WINS on a key collision — storage is the authority once it has the row —
 * and within `unsaved` the FIRST occurrence of a key wins, so a caller may
 * concatenate several sources (the unsaved map, then the current list) without
 * rendering the same key twice.
 */
export function mergeUnsavedRecords(
  stored: ReadonlyArray<StoredRecord>,
  unsaved: ReadonlyArray<StoredRecord>,
): StoredRecord[] {
  const have = new Set(stored.map((e) => e.key));
  const missing: StoredRecord[] = [];
  for (const e of unsaved) {
    if (have.has(e.key)) continue;
    // Added as we go, so a key repeated WITHIN `unsaved` is kept once. Two rows
    // with the same key would be two React children with the same `key` prop and
    // two renderings of one batch.
    have.add(e.key);
    missing.push(e);
  }
  if (missing.length === 0) return [...stored];
  return [...stored, ...missing].sort((a, b) => b.record.createdAt - a.record.createdAt);
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
  /**
   * The FORMAT LABEL for each image, index-aligned with {@link imageUrls} — `null`
   * where the record cannot name one.
   *
   * 🔴 IT IS BUILT HERE RATHER THAN INDEXED AT THE RENDER SITE, and that is the
   * whole point. The row used to pass `form.formats[0].label` for EVERY image, so a
   * 2-format batch saved its Cinematic picture as `yt-thumbnail-clickbait-3.jpg`.
   * Indexing `formats[i]` by IMAGE index would be just as wrong twice over: a
   * workflow missing from the live page is dropped from `imageUrls`, which shifts
   * every later index, and at quantity > 1 one workflow contributes several images.
   * The only sound pairing is `workflowIds[i]` ↔ `formats[i]` — the alignment the
   * writer guarantees — carried through the flatten, which is what this does.
   */
  imageLabels: Array<string | null>;
  /** Summed realized cost over the workflows that reported one; `null` when none did. */
  cost: number | null;
  /**
   * The pool that funded this batch, straight off the stored record — `null` for a
   * row written before the field existed, for a batch still running, and for a
   * batch whose workflows were funded from different pools. See
   * {@link GenerationRecord.spentAccount}; the row paints a NEUTRAL bolt for all
   * three, because none of them is "a different pool".
   */
  spentAccount: BuzzAccountType | null;
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
 *
 * 🔴 THE FORMAT LABEL IS PAIRED BEFORE THE FILTER, NOT AFTER. `workflowIds[i]` and
 * `form.formats[i]` are written together and in the same order (see the App's
 * record write), so the pairing has to be taken at the `workflowIds` index — the
 * `.filter` that drops workflows the live page does not carry would otherwise shift
 * every later one. See {@link HistoryEntry.imageLabels}.
 *
 * 🔴 THE PAIRING IS ONLY AS GOOD AS THE WRITER, AND AN OLD ROW'S IS KNOWN WRONG.
 * Records written before the two lists came off the same `submitted` array recorded
 * `workflowIds` in COMPLETION order while `form.formats` held the ESTIMATE
 * SURVIVORS in selection order. Measured against the released writer at `a6aae56`:
 * `workflowIds = submittedIds` (pushed as each submit resolved) and
 * `form.formats = formats.filter(viable)`, so such a row can carry MORE FORMATS
 * THAN IDS — one submit failure shifts every later label by one — and a batch whose
 * second format replied first pairs the two the wrong way round. Neither is
 * repairable from the row: nothing in it records which format each id came from.
 * Those rows age out with the orchestrator's images; this is a stated limitation,
 * not a guard.
 *
 * The `?.label ?? null` below is NOT that case and does not fix it. It is reached
 * only by a row carrying FEWER formats than ids, which NO shipped writer produces
 * (`|formats| >= |ids|` above, and they are equal from this change on). It is here
 * because `parseRecord` validates the two lists SEPARATELY and never relates their
 * lengths, so `joinHistory` has to stay total over every shape `parseRecord`
 * accepts — without the `?.` such a row throws a TypeError out of the join, which
 * is the renderer for the whole surface. A totality guard at a parse boundary, with
 * no writer-side bug behind it; `null` is a filename without a slug, not a wrong
 * slug (see `candidateFileName`).
 */
export function joinHistory(
  records: ReadonlyArray<StoredRecord>,
  workflows: readonly AppWorkflow[],
): HistoryEntry[] {
  const byId = new Map(workflows.map((w) => [w.workflowId, w]));
  return records.map(({ key, record }) => {
    type Pair = { w: AppWorkflow; label: string | null };
    const paired = record.workflowIds
      .map((id, i): Pair | null => {
        const w = byId.get(id);
        // `formats[i]` absent means a row with FEWER formats than ids, which no
        // shipped writer produces — `parseRecord` simply never relates the two
        // lengths, so the `?.` is what keeps this total. See the block above.
        return w === undefined ? null : { w, label: record.form.formats[i]?.label ?? null };
      })
      .filter((p): p is Pair => p !== null);
    const found = paired.map((p) => p.w);
    const costs = found.filter((w) => typeof w.cost === 'number' && Number.isFinite(w.cost));
    return {
      key,
      record,
      workflows: found,
      status: batchStatus(found),
      imageUrls: found.flatMap((w) => w.images.map((i) => i.url)),
      imageLabels: paired.flatMap((p) => p.w.images.map(() => p.label)),
      cost: costs.length === 0 ? null : costs.reduce((sum, w) => sum + (w.cost as number), 0),
      // From the RECORD, not the live half: `AppWorkflow` carries no funding
      // information at all (the host drops "transactions" from the projection), so
      // the stored row is the only place this can come from. `undefined` -> `null`
      // so the renderer has one absent value to branch on.
      spentAccount: record.spentAccount ?? null,
      unavailable: found.length === 0,
      cancellableIds: found
        .filter((w) => w.status === 'pending' || w.status === 'processing')
        .map((w) => w.workflowId),
    };
  });
}

// ---------------------------------------------------------------------------
// THE APP'S OWN VIEW OF THE WORKFLOWS IT IS DRIVING RIGHT NOW.
//
// 🔴 WHY THIS EXISTS, AND IT IS NOT A CACHE. `useAppWorkflows()` is A PAGE THAT
// WAS FETCHED EARLIER. A batch submitted a moment ago is not in it, `refetch()`
// is not synchronous with our own poll loop, and a host may page it out entirely.
// Without a second source the row for the batch the viewer JUST PAID FOR joins to
// nothing, so it renders `unavailable` — no status, no images, no cost — while the
// app is holding that workflow's own snapshot in its hands. Worse, `orphanedKeys`
// would then see a record inside the fetched window matching no live workflow and
// DELETE it.
//
// So every snapshot the app receives from `submit()`/`poll()` is folded into a map
// keyed by workflowId and merged into the live page before the join. The map is
// CUMULATIVE for the session and is deliberately NOT cleared by a new Generate:
// clearing it is exactly how the previous batch's images disappeared the moment
// the next click started.
// ---------------------------------------------------------------------------

/** Workflow statuses that cannot change again. Used to stop a merge regressing one. */
const TERMINAL_WORKFLOW_STATUSES: ReadonlySet<AppWorkflow['status']> = new Set([
  'succeeded',
  'failed',
  'expired',
  'canceled',
]);

/**
 * Fold ONE snapshot the app received itself into its map of driven workflows.
 *
 * `createdAt` is stamped on FIRST SIGHT and never moved, because a snapshot does
 * not carry one. That only ever feeds {@link oldestWorkflowTime}, where "now" is
 * the newest possible value and therefore cannot loosen the prune bound.
 *
 * `imageUrls` is passed in (rather than read off the snapshot) so this shares
 * generation.ts's ONE extractor — `imageUrlsFrom` — instead of re-deriving which
 * field the host put the urls in.
 */
export function upsertOwnWorkflow(
  current: Readonly<Record<string, AppWorkflow>>,
  snapshot: BlockWorkflowSnapshot,
  imageUrls: readonly string[],
  nowIso: string,
): Record<string, AppWorkflow> {
  const id = snapshot.workflowId;
  if (!id) return current as Record<string, AppWorkflow>;
  const previous = current[id];
  const next: AppWorkflow = {
    workflowId: id,
    status: snapshot.status,
    // An empty image list on a `pending` poll must not erase urls a previous
    // snapshot already delivered.
    images:
      imageUrls.length > 0
        ? imageUrls.map((url) => ({ url, width: null, height: null, nsfwLevel: null }))
        : (previous?.images ?? []),
    // Same rule for the price: only a number the SERVER sent replaces one it sent
    // before. `null` here means "not told yet", never "free".
    cost: snapshot.cost?.total ?? previous?.cost ?? null,
    createdAt: previous?.createdAt ?? nowIso,
  };
  return { ...current, [id]: next };
}

/**
 * The live half, widened by what the app knows itself: the fetched page, plus our
 * own rows for workflows the page does not carry, plus a FIELD-WISE fill-in where
 * both have the same workflow.
 *
 * 🔴 THE MERGE IS MONOTONIC — it can only ever ADD information, which is what
 * makes it safe to run on every render. Three clauses, each with a reason:
 *
 *   images  the page's list wins when it is non-empty; ours fills an empty one.
 *           A page fetched before the generation finished has no images for it,
 *           and dropping ours there hides output the viewer PAID for.
 *   cost    the page's number wins when it has one; ours fills a `null`. BOTH are
 *           the server's own figure (`snapshot.cost.total` / the projection), so
 *           neither is an ESTIMATE, and an estimate may never stand in for a realized
 *           cost: it prices the workflows that were ASKED for, which includes any that
 *           failed and were never charged. `null` here means "not told yet", never
 *           "free", and the row renders `—` for it. (This used to defer to
 *           `aggregateSpend`'s note; that function was deleted with the `pm-spent`
 *           alert, so the reason is stated here instead of pointed at.)
 *   status  a TERMINAL status wins over a non-terminal one, whichever side holds
 *           it. A stale page saying `processing` about a workflow we have already
 *           watched succeed would show a permanent skeleton; the reverse (our
 *           `pending` against the page's `succeeded`) is the same error mirrored.
 *
 * `createdAt` always comes from the page when it has the row: it is the real one.
 */
export function mergeLiveWorkflows(
  page: readonly AppWorkflow[],
  own: Readonly<Record<string, AppWorkflow>>,
): AppWorkflow[] {
  const merged = page.map((w) => {
    const mine = own[w.workflowId];
    if (!mine) return w;
    const pageTerminal = TERMINAL_WORKFLOW_STATUSES.has(w.status);
    const mineTerminal = TERMINAL_WORKFLOW_STATUSES.has(mine.status);
    return {
      ...w,
      status: !pageTerminal && mineTerminal ? mine.status : w.status,
      images: w.images.length > 0 ? w.images : mine.images,
      cost: w.cost != null ? w.cost : mine.cost,
    };
  });
  const seen = new Set(page.map((w) => w.workflowId));
  for (const w of Object.values(own)) if (!seen.has(w.workflowId)) merged.push(w);
  return merged;
}

/**
 * Should the history surface be rendered AT ALL?
 *
 * 🔴 ONLY THE `ready`-AND-EMPTY CASE HIDES, and the other states are not
 * "empty with a different message" — each is ACTIONABLE and each names a
 * different fix: sign in ('anon'), grant storage ('denied'), retry ('error'),
 * wait ('loading'). Hiding those would delete the only thing on screen that tells
 * the viewer why they have no history.
 *
 * A `note` keeps the surface up even when ready-and-empty, because the notes this
 * surface carries are about the run that JUST happened — "too large to save",
 * "wasn't saved to history" — and a note that vanishes with its container is a
 * message nobody reads.
 */
export function showHistory(args: {
  state: 'loading' | 'ready' | 'anon' | 'denied' | 'error';
  entryCount: number;
  note: string | null;
}): boolean {
  if (args.state !== 'ready') return true;
  if (args.entryCount > 0) return true;
  return args.note != null;
}

/**
 * How many skeleton tiles a still-running batch should show: one per image it is
 * expected to produce, i.e. quantity × formats, minus whatever has already landed.
 *
 * 🔴 FORMATS AND QUANTITY MULTIPLY — the same arithmetic the cost disclosure
 * makes. A skeleton count of 1 for a 3-format × 2-image run would understate what
 * is coming, which on this surface is a claim about what was paid for.
 *
 * Neither factor is floored at 1, and the two reasons are NOT the same strength —
 * the sentence here used to blur them:
 *
 *  - `formats` is guaranteed by the PARSE BOUNDARY: `parseRecord` refuses a record
 *    whose `formats` is empty, so no row that reaches this function can carry 0.
 *  - `quantity` is guaranteed by the WRITER ONLY. `parseRecord` does not validate it
 *    at all: it checks `form.formats` and `form.checkpoint` and then casts the rest of
 *    `form` unchecked (see that function) — so the claim is about
 *    `formSnapshot`, which passes `quantity` through `clampQuantity`
 *    (`QUANTITY_MIN` = 1) before it is stored. No shipped writer produces
 *    `quantity === 0`; a hand-written row could.
 *
 * A `Math.max(1, …)` is still the wrong answer to the second one: it would invent a
 * skeleton for a row that claims no images, on a surface where the tile count is a
 * claim about what was paid for. If `quantity` ever has to be trusted from
 * unvalidated JSON, the fix belongs in `parseRecord`, with the rest of the
 * validation, not in a floor here.
 */
export function skeletonCount(record: GenerationRecord, alreadyLanded: number): number {
  const expected = record.form.formats.length * record.form.quantity;
  return Math.max(0, expected - Math.max(0, alreadyLanded));
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
  records: ReadonlyArray<StoredRecord>,
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

// 🔴 `batchStatusLabel` AND `batchStatusColor` ARE GONE, DELIBERATELY AND WITH
// THEIR TESTS. They existed for ONE caller — the status Badge on each history row —
// and the operator asked for that badge to be removed in ALL states (see the
// tradeoff note in `History.tsx`'s `HistoryRow`). Keeping two exported functions
// and ~10 assertions about strings nothing renders would read as coverage of a
// surface that no longer exists, which is worse than no coverage: it stops the next
// person looking. `batchStatus` itself STAYS — `entry.status` still decides whether
// a row shows skeletons.

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
