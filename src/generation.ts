// Pure logic for the YT Thumbnail page money app. No React, no DOM — unit-tested
// in node (see generation.test.ts). The App glue imports these so the
// load-bearing decisions (cost format, insufficient-Buzz sniff, terminal-status
// reduction, scope check) live in one tested place.

import type { BlockWorkflowSnapshot, BuzzAccountType } from '@civitai/app-sdk/blocks';

import type { CheckpointOption, LoraOption } from './models.js';
import { clampLoraWeight, roundLoraWeight } from './models.js';

/** Server cap mirror — prompts over this are rejected by the workflow schema. */
export const PROMPT_MAX = 1500;

// ---------------------------------------------------------------------------
// YouTube thumbnail geometry. Thumbnails are 16:9 at 1280×720 (YouTube's
// recommended upload size; per-side cap 2MB applies to the EXPORT, not the
// generation — see editor.ts). The server enforces 64–2048 per side.
// ---------------------------------------------------------------------------
export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;

/** Server `params.quantity` bounds — 1–4 images per generation, default 1. */
export const QUANTITY_MIN = 1;
export const QUANTITY_MAX = 4;

/** Clamp a requested quantity into the server-accepted [1, 4] range. */
export function clampQuantity(q: number | null | undefined): number {
  const n = q == null || !Number.isFinite(q) ? QUANTITY_MIN : Math.round(q);
  return Math.max(QUANTITY_MIN, Math.min(QUANTITY_MAX, n));
}

/**
 * An img2img source — the host image-upload bridge's
 * `useImageUpload({ purpose: 'generationSource' }).open()` reply. `url` is
 * Civitai-hosted by contract (an arbitrary remote URL is rejected; SSRF guard).
 * PAGE-ONLY: a model-slot token rejects `sourceImage` fail-closed; this app is a
 * page app, so it may send it.
 */
export interface SourceImage {
  url: string;
  width: number;
  height: number;
}

/** What {@link composePrompt} puts between the user's text and the suffix. */
const PROMPT_JOINER = ', ';

/**
 * Compose the user's prompt with a FORMAT's suffix into the prompt one workflow
 * will actually carry. (Formats themselves live in `formats.ts`; this is the
 * money-path half — the string that gets priced and generated.)
 *
 * The result is ALWAYS within {@link PROMPT_MAX}, and the suffix is RESERVED:
 * when the combined text would overflow, the USER's prompt is what gets trimmed,
 * not the format. A plain `clampPrompt(user + suffix)` would silently drop the
 * tail — i.e. exactly the format the viewer selected and is about to PAY for —
 * producing a generation that ignores the chosen format with no indication why.
 * Trimming the user's own text is visible to them; dropping the format is not.
 */
export function composePrompt(prompt: string, suffix: string): string {
  const base = prompt.trim();
  const suf = suffix.trim();
  if (suf === '') return clampPrompt(base);
  if (base === '') return clampPrompt(suf);
  const room = userPromptRoom(suf);
  // A suffix at/over the cap on its own leaves no room for any user text.
  if (room <= 0) return clampPrompt(suf);
  return `${base.slice(0, room)}${PROMPT_JOINER}${suf}`;
}

/**
 * How many characters of the USER's own prompt survive composition with
 * `suffix` — i.e. the budget {@link composePrompt} clamps them to.
 *
 * 🔴 ONE RULE, ONE PLACE. `composePrompt` calls this rather than re-deriving the
 * arithmetic, and so does {@link promptWasTruncated}. A second copy of
 * `PROMPT_MAX - suffix - joiner` is how the preview and the submitted body drift
 * apart by one character and nobody notices until a 1500-char prompt is paid for.
 *
 * `0` when the suffix alone fills the cap (the composed prompt is then the suffix
 * and nothing else); `PROMPT_MAX` when there is no suffix at all.
 */
export function userPromptRoom(suffix: string): number {
  const suf = suffix.trim();
  if (suf === '') return PROMPT_MAX;
  return Math.max(0, PROMPT_MAX - suf.length - PROMPT_JOINER.length);
}

/**
 * Did composing `prompt` with `suffix` CLAMP the user's own text? Drives the
 * preview's "your prompt was trimmed to fit" note — the suffix is reserved, so
 * the loss is always the viewer's words, and they should be told before paying.
 */
export function promptWasTruncated(prompt: string, suffix: string): boolean {
  return prompt.trim().length > userPromptRoom(suffix);
}

/**
 * Is there anything at all to submit? TRUE when at least one selected format
 * composes to a non-empty prompt.
 *
 * 🔴 AN EMPTY USER PROMPT IS LEGITIMATE. A format IS a prompt — "show me this
 * look in three models" is a real request — so the gate is not
 * `prompt.trim() !== ''`. What it must still refuse is the state where a click
 * would spend on nothing: no formats selected (zero workflows), or formats whose
 * suffixes are all blank AND no user text.
 *
 * Derived from {@link composePrompt} itself rather than from a second predicate,
 * so the button can never be enabled for a prompt the body-builder would send as
 * an empty string.
 */
export function hasSubmittablePrompt(
  prompt: string,
  formats: ReadonlyArray<{ suffix: string }>,
): boolean {
  return formats.some((f) => composePrompt(prompt, f.suffix) !== '');
}

// ---------------------------------------------------------------------------
// EDITABLE composed prompts.
//
// The composed-prompt preview shipped in 0.1.5 read-only. Making it editable is
// a money-path change — the edited string is what gets SUBMITTED and therefore
// what gets PAID FOR — so the whole model lives here, beside `composePrompt`,
// rather than as state the view interprets for itself.
//
// 🔴 ONE STRING, ONE FUNCTION. `effectivePrompt` is the ONLY answer to "what
// will this format submit". The preview field reads it (via
// {@link promptFieldValue}, which differs only in that it does not trim while
// you are still typing), the Generate gate reads it, and the submit body is
// built from it. A view that kept its own copy of the edited text and a body
// that recomposed from the base prompt is precisely the two-sources-of-truth
// split that lets a viewer pay for a string they never saw.
//
// 🔴 N FORMATS STAY N PROMPTS. Edits are keyed BY FORMAT ID, never merged.
// Editing one row cannot collapse the batch into one workflow, and two rows
// edited to different text still submit two different prompts — the property
// that makes multi-select mean anything.
//
// 🔴 THE CAP IS ENFORCED ON THE WAY IN, not discovered at submit.
// {@link setPromptEdit} clamps to {@link PROMPT_MAX}; the field additionally
// carries `maxLength`, and the row shows a live character count. An edit is
// therefore never silently truncated between what is on screen and what is
// sent. NOTE the asymmetry with `composePrompt`, and it is deliberate: an
// UNEDITED row reserves the format suffix and clamps the USER's words, because
// the app chose to append that suffix. An EDITED row is the viewer's own whole
// string — there is no suffix left to reserve — so it is simply capped.
// ---------------------------------------------------------------------------

/**
 * Per-format overrides of the composed prompt, keyed by format id. An id that is
 * ABSENT means "this row still follows the prompt box"; an id present (even with
 * an empty string) means the viewer has taken the row over.
 *
 * Session state only. Deliberately NOT persisted to `useAppStorage`: an edit is
 * about the click you are about to make, and a prompt silently restored from a
 * previous visit is a string you would pay for without having written it now.
 */
export type PromptEdits = Readonly<Record<string, string>>;

/** Has the viewer taken this row over from the prompt box? */
export function isPromptEdited(edits: PromptEdits, formatId: string): boolean {
  return typeof edits[formatId] === 'string';
}

/**
 * Record an edit for one format, clamped to {@link PROMPT_MAX}.
 *
 * Clamping HERE (rather than at submit) is what keeps the field and the wire in
 * agreement: the stored value is already within the cap, so the character count
 * the viewer sees is the length that will be sent.
 */
export function setPromptEdit(edits: PromptEdits, formatId: string, text: string): PromptEdits {
  return { ...edits, [formatId]: clampPrompt(text) };
}

/** Hand a row back to the prompt box — it recomposes and tracks it again. */
export function clearPromptEdit(edits: PromptEdits, formatId: string): PromptEdits {
  if (!isPromptEdited(edits, formatId)) return edits;
  const next = { ...edits };
  delete next[formatId];
  return next;
}

/**
 * What the editable field shows for this format: the raw edit if there is one,
 * otherwise the live composition of the prompt box with the format's suffix.
 *
 * Raw — NOT trimmed — so that typing a space mid-sentence is not eaten under the
 * cursor. {@link effectivePrompt} is the trimmed, submitted form; the two differ
 * only in surrounding whitespace, exactly as the prompt box already differs from
 * what `buildWorkflowBody` sends.
 */
export function promptFieldValue(
  basePrompt: string,
  format: { id: string; suffix: string },
  edits: PromptEdits,
): string {
  return isPromptEdited(edits, format.id)
    ? (edits[format.id] as string)
    : composePrompt(basePrompt, format.suffix);
}

/**
 * 🔴 THE STRING THIS FORMAT WILL SUBMIT. The single source of truth for the
 * money path — `buildWorkflowBody` is fed this and nothing else.
 *
 * An edited row is the viewer's own text, trimmed and capped. An unedited row is
 * `composePrompt`, byte-for-byte as before this change, suffix reservation and
 * all — so nothing about the shipped, money-verified path moves for a viewer who
 * never touches a row.
 */
export function effectivePrompt(
  basePrompt: string,
  format: { id: string; suffix: string },
  edits: PromptEdits,
): string {
  if (isPromptEdited(edits, format.id)) return clampPrompt((edits[format.id] as string).trim());
  return composePrompt(basePrompt, format.suffix);
}

/**
 * The Generate gate, edit-aware. Two clauses, both asking "would this click
 * spend on nothing":
 *
 *  1. the shipped rule — at least one selected format composes to something
 *     ({@link hasSubmittablePrompt}); and
 *  2. NO selected format resolves to an EMPTY prompt once edits are applied.
 *
 * Clause 2 is the new one and it is the reason clearing a row is safe: an edit
 * emptied to blank would otherwise submit `params.prompt: ""` for that format
 * and charge the viewer for it, while its siblings looked fine. Refusing the
 * whole click is the conservative answer — the viewer can always deselect the
 * row they did not want.
 */
export function promptsReadyToSubmit(
  basePrompt: string,
  formats: ReadonlyArray<{ id: string; suffix: string }>,
  edits: PromptEdits,
): boolean {
  if (!hasSubmittablePrompt(basePrompt, formats)) return false;
  return formats.every((f) => effectivePrompt(basePrompt, f, edits) !== '');
}

// ---------------------------------------------------------------------------
// Per-account Buzz — which pool funds a generation.
//
// A block can prefer + read exactly three pools (the SDK's `BuzzAccountType`):
//   blue   = free / earned Buzz
//   yellow = purchased Buzz
//   green  = creator-earned / tips
// The platform-internal pools (red/purple) are never exposed to a block.
// ---------------------------------------------------------------------------

/** The Buzz pools a block can prefer + read ({ blue, green, yellow }). */
export const BUZZ_ACCOUNT_TYPES: readonly BuzzAccountType[] = ['blue', 'green', 'yellow'];

/**
 * What the account picker offers: `'auto'` (the default — let the host choose the
 * funding order, today's behavior) plus one entry per readable pool.
 */
export type AccountChoice = 'auto' | BuzzAccountType;

/** Picker order: Auto first, then the pools. */
export const ACCOUNT_CHOICES: readonly AccountChoice[] = ['auto', 'blue', 'green', 'yellow'];

/** Human label for an account choice (Auto / Blue / Green / Yellow). */
export function accountLabel(choice: AccountChoice): string {
  switch (choice) {
    case 'auto':
      return 'Auto';
    case 'blue':
      return 'Blue';
    case 'green':
      return 'Green';
    case 'yellow':
      return 'Yellow';
  }
}

/**
 * Label the pool that PRIMARILY funded a generation
 * (`BlockWorkflowSnapshot.spentAccountType`). This is the largest-debit account,
 * NOT necessarily "the paid account": a gen covered mostly by free/earned Buzz
 * reports `blue`. `undefined` (a host predating the field, or no spend) -> null,
 * so the caller can skip the "funded from…" note.
 */
export function spentAccountLabel(spent: BuzzAccountType | undefined): string | null {
  if (!spent) return null;
  return accountLabel(spent);
}

/**
 * Mirror of the manifest's `page.buzzBudgetPerGen`. MUST be kept in sync with
 * block.manifest.json — the SERVER reads the MANIFEST value at mint (and clamps
 * it to the platform per-gen cap); this constant is exported for your own copy
 * and is not read by the scaffold's UI. The real ceiling is enforced
 * server-side, so changing this constant alone changes nothing about spend.
 */
export const PAGE_BUZZ_BUDGET = 300;

/** The scope the page token must carry before a generation can be submitted. */
export const BUDGETED_SCOPE = 'ai:write:budgeted';

/** Snapshot statuses that mean "stop polling". Mirrors the SDK's TERMINAL set. */
const TERMINAL: ReadonlySet<BlockWorkflowSnapshot['status']> = new Set([
  'succeeded',
  'failed',
  'expired',
  'canceled',
]);

export function isTerminalStatus(status: BlockWorkflowSnapshot['status']): boolean {
  return TERMINAL.has(status);
}

/**
 * Does the token carry the budgeted-spend scope? Drives whether a Generate
 * click submits directly or first asks the host to open the consent UI.
 * `ai:write:budgeted` is consent-gated, so a fresh viewer's mint WITHHOLDS it
 * until they grant it; after grant the host pushes TOKEN_REFRESH with the scope
 * and this flips true -> retry.
 */
export function hasBudgetedScope(scopes: readonly string[] | undefined): boolean {
  return Array.isArray(scopes) && scopes.includes(BUDGETED_SCOPE);
}

/**
 * Sniff a workflow failure / error string for insufficient-Buzz language so the
 * UI can swap to a Top-Up CTA. There is NO structured error.code on the
 * BlockWorkflowSnapshot today (only a free-text `error`), so this is a substring
 * heuristic.
 *
 * NOTE: call {@link isDisallowedAccountError} FIRST — the disallowed-account
 * message also contains the word "buzz", which this heuristic would otherwise
 * misclassify as insufficient.
 */
export function isInsufficientBuzz(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('insufficient') ||
    m.includes('not enough') ||
    m.includes('budget') ||
    m.includes('balance') ||
    m.includes('buzz')
  );
}

/**
 * Sniff for the server's domain-clamp rejection of a preferred `accountType`.
 * When a page picks a Buzz pool that isn't spendable on this app's content-rating
 * domain, `blocks.submitWorkflow` rejects with a tRPC BAD_REQUEST whose message
 * is (civitai/civitai `blocks.router`):
 *
 *   buzz account '<type>' is not spendable for this app's content rating
 *
 * Detecting it lets the UI show a friendly "switched back to Auto" note instead
 * of a raw error. MUST be checked before {@link isInsufficientBuzz} (that
 * message contains "buzz").
 */
export function isDisallowedAccountError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return m.includes('not spendable') || (m.includes('account') && m.includes('content rating'));
}

/**
 * The reason string to CLASSIFY and DISPLAY for a rejected submit.
 *
 * `@civitai/blocks-react@^0.44` throws a `WorkflowSubmitError` whose `.message`
 * is a deliberately GENERIC template — it carries no server text, so a raw
 * server string never lands on the default-printed surface of code that merely
 * awaited the promise. The server's actual reason, the one
 * {@link isDisallowedAccountError} and {@link isInsufficientBuzz} sniff for,
 * rides on `.snapshot.error` instead. Under `^0.43` the reason was on `.message`
 * and there was no snapshot.
 *
 * So read the snapshot reason FIRST and fall back to `.message`: that classifies
 * correctly on BOTH sides of the change, and it is what keeps a disallowed-pool
 * rejection rendering the friendly "switched back to Auto" note rather than a
 * hard "Generation failed".
 *
 * 🔴 STRUCTURAL ON PURPOSE — it keys on WHERE the reason lives, never on the
 * wording of the generic template. Sniffing for that wording would be a spelled
 * guard: the next upstream reword would silently restore the misclassification,
 * which is exactly the defect this replaces.
 */
export function submitErrorReason(err: unknown, fallback = 'submit failed'): string {
  const snapshotError = (err as { snapshot?: { error?: unknown } } | null | undefined)?.snapshot
    ?.error;
  if (typeof snapshotError === 'string' && snapshotError.trim() !== '') return snapshotError;
  if (err instanceof Error && err.message.trim() !== '') return err.message;
  return fallback;
}

/** Format a Buzz cost for display, with thousands separators. `null` -> '—'. */
export function formatCost(cost: number | null | undefined): string {
  if (cost == null || !Number.isFinite(cost)) return '—';
  return Math.round(cost).toLocaleString();
}

/** Trim + clamp a prompt to the server cap so submit can't be rejected on length. */
export function clampPrompt(raw: string): string {
  return raw.slice(0, PROMPT_MAX);
}

/**
 * Build the textToImage submit/estimate body for the chosen checkpoint + the
 * selected LoRAs, sized for a YouTube thumbnail (always 1280×720 — see
 * THUMB_WIDTH/THUMB_HEIGHT).
 *
 * LoRAs are layered on as `additionalResources` — ONE entry per selected LoRA,
 * `{ modelVersionId, strength }` where strength is the user's weight (clamped +
 * rounded to the server's [-1, 2] bound). The key is emitted ONLY when at least
 * one LoRA is selected, so a checkpoint-only body stays backward compatible.
 *
 * `opts.quantity` (clamped to the server's [1, 4]) is emitted ONLY when > 1 —
 * the server default is 1, so a single-image body stays minimal.
 *
 * `opts.sourceImage` (from the host's generationSource upload bridge) turns the
 * body into img2img. Emitted ONLY when provided. PAGE-ONLY field — this app is a
 * page app. Use the SINGULAR `sourceImage` (works on every host; a 1-element
 * `sourceImages` would be byte-identical, and plural needs a newer host).
 *
 * MONEY-SAFETY: both the checkpoint AND every LoRA + weight are the user's
 * in-block PICKS (curated default or catalog-browsed), which are DISCOVERY ONLY.
 * The server re-validates (public? covered? SFW? LoRA-only? base-model
 * compatible? entitled?) AND re-prices this body at estimate AND submit — a
 * client can't force a non-generatable / incompatible / mis-priced resource
 * through here.
 *
 * `accountType` is the OPTIONAL preferred Buzz pool. `'auto'` (or omitted) =
 * today's behavior BYTE-FOR-BYTE: the body carries NO `accountType`, so the host
 * drains its default domain-allowed order. A real pool ('blue'|'green'|'yellow')
 * is a *preference* — the server clamps it to what the viewer holds + the
 * domain-allowed set (preferred-first, then falls back), and REJECTS a pool the
 * domain forbids (see {@link isDisallowedAccountError}).
 */
export function buildWorkflowBody(
  prompt: string,
  checkpoint: CheckpointOption,
  loras: readonly LoraOption[] = [],
  accountType?: AccountChoice,
  opts: { quantity?: number; sourceImage?: SourceImage | null } = {},
) {
  const body: {
    kind: 'textToImage';
    modelId: number;
    modelVersionId: number;
    params: { prompt: string; width: number; height: number; quantity?: number };
    additionalResources?: Array<{ modelVersionId: number; strength: number }>;
    sourceImage?: SourceImage;
    accountType?: BuzzAccountType;
  } = {
    kind: 'textToImage',
    modelId: checkpoint.modelId,
    modelVersionId: checkpoint.versionId,
    params: {
      prompt: clampPrompt(prompt.trim()),
      width: THUMB_WIDTH,
      height: THUMB_HEIGHT,
    },
  };
  const quantity = clampQuantity(opts.quantity);
  if (quantity > QUANTITY_MIN) body.params.quantity = quantity;
  if (loras.length > 0) {
    body.additionalResources = loras.map((l) => ({
      modelVersionId: l.versionId,
      strength: roundLoraWeight(clampLoraWeight(l.weight)),
    }));
  }
  if (opts.sourceImage) body.sourceImage = opts.sourceImage;
  if (accountType && accountType !== 'auto') {
    body.accountType = accountType;
  }
  return body;
}

/** All displayable image urls from a succeeded snapshot (gallery order). */
export function imageUrlsFrom(snapshot: BlockWorkflowSnapshot | null): string[] {
  if (!snapshot || !snapshot.imageUrls || snapshot.imageUrls.length === 0) return [];
  return [...snapshot.imageUrls];
}

/** Pull the single displayable image url from a succeeded snapshot, if any. */
export function firstImageUrl(snapshot: BlockWorkflowSnapshot | null): string | null {
  if (!snapshot || !snapshot.imageUrls || snapshot.imageUrls.length === 0) return null;
  return snapshot.imageUrls[0] ?? null;
}

/** The single-in-flight generation phase the page tracks. */
export type GenPhase =
  | 'idle'
  | 'needs-consent'
  | 'estimating'
  | 'submitting'
  | 'polling'
  | 'succeeded'
  | 'failed'
  | 'insufficient'
  | 'account-rejected';

/** Is a generation in flight (Generate should be disabled / show progress)? */
export function isBusyPhase(phase: GenPhase): boolean {
  return phase === 'estimating' || phase === 'submitting' || phase === 'polling';
}

/**
 * Classify a submit/estimate ERROR string (the thrown-rejection path) into a
 * terminal phase. Order matters: disallowed-account BEFORE insufficient (the
 * disallowed message contains "buzz").
 */
export function phaseForError(message: string | null | undefined): GenPhase {
  if (isDisallowedAccountError(message)) return 'account-rejected';
  if (isInsufficientBuzz(message)) return 'insufficient';
  return 'failed';
}

/**
 * Reduce a polled snapshot to the next page phase. Keeps the status->phase
 * mapping in one tested place so the poll loop stays a thin driver.
 */
export function phaseForSnapshot(snapshot: BlockWorkflowSnapshot): GenPhase {
  switch (snapshot.status) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
    case 'expired':
    case 'canceled':
      return phaseForError(snapshot.error);
    case 'pending':
    case 'processing':
      return 'polling';
  }
}

// ---------------------------------------------------------------------------
// MULTI-WORKFLOW money path — N selected formats ⇒ N workflows.
//
// WHY N REQUESTS AND NOT ONE. A format is a prompt suffix, and a workflow body
// carries exactly ONE `params.prompt`. Two formats mean two different prompts,
// so they cannot share a request no matter how the quantity is set. `quantity`
// multiplies IMAGES WITHIN one prompt; formats multiply PROMPTS. They compose:
// 3 formats × quantity 2 = 3 workflows of 2 images = 6 images.
//
// 🔴 THE SPEND CONSEQUENCE, which is the whole reason this is a separate model:
// the manifest's `page.buzzBudgetPerGen` is enforced PER WORKFLOW, so N formats
// authorise N budgets, not one. The viewer must see the TOTAL before clicking,
// and after a PARTIAL failure must be told what was actually spent — never the
// estimate, and never a total that quietly includes runs that never ran.
// ---------------------------------------------------------------------------

/**
 * One format's independent trip through estimate -> submit -> poll. The App
 * holds an array of these instead of the old single set of scalars, and every
 * transition goes through {@link patchRun} so a late reply from one workflow can
 * never clobber another's state.
 */
export interface FormatRun {
  /** The format this run generates for. */
  formatId: string;
  /** That format's display label, captured at launch so results stay tagged. */
  label: string;
  phase: GenPhase;
  /** This run's own estimate. `null` when the estimate failed or hasn't run. */
  estimatedCost: number | null;
  /** What the SERVER reported this run cost. `null` until it reports one. */
  actualCost: number | null;
  spentAccount: BuzzAccountType | null;
  workflowId: string | null;
  imageUrls: string[];
  error: string | null;
}

/** A fresh, idle run for one format. */
export function initRun(formatId: string, label: string): FormatRun {
  return {
    formatId,
    label,
    phase: 'idle',
    estimatedCost: null,
    actualCost: null,
    spentAccount: null,
    workflowId: null,
    imageUrls: [],
    error: null,
  };
}

/** One idle run per selected format, in selection order. */
export function initRuns(formats: ReadonlyArray<{ id: string; label: string }>): FormatRun[] {
  return formats.map((f) => initRun(f.id, f.label));
}

/**
 * Apply a partial update to ONE run, by formatId. Returns a new array; unknown
 * ids are a no-op. This is the only mutator, so an out-of-order reply from a
 * slow workflow updates its own row and nothing else.
 */
export function patchRun(
  runs: readonly FormatRun[],
  formatId: string,
  patch: Partial<FormatRun>,
): FormatRun[] {
  return runs.map((r) => (r.formatId === formatId ? { ...r, ...patch } : r));
}

/**
 * The TOTAL Buzz the pending click is expected to cost: the sum of the runs'
 * individual estimates.
 *
 * Returns `null` when NO run has a usable estimate — the caller then shows the
 * button with no price rather than a fabricated one. When only SOME runs priced
 * (a partial estimate failure), the sum of the known ones is returned together
 * with `partial: true`, so the UI can mark it "at least" instead of implying the
 * figure is the whole bill.
 */
export function aggregateEstimate(runs: readonly FormatRun[]): {
  total: number | null;
  partial: boolean;
} {
  const known = runs.filter((r) => r.estimatedCost != null && Number.isFinite(r.estimatedCost));
  if (known.length === 0) return { total: null, partial: runs.length > 0 };
  const total = known.reduce((sum, r) => sum + (r.estimatedCost as number), 0);
  return { total, partial: known.length < runs.length };
}

/**
 * What was ACTUALLY spent, summed from the runs the SERVER reported a cost for.
 *
 * 🔴 NEVER falls back to the estimate. On a partial failure the estimate covers
 * workflows that never ran, so reporting it as spend would overstate the bill;
 * `null` (rendered as '—') is the honest answer when the server has told us
 * nothing yet. A run the server priced at 0 contributes 0 — that is the
 * server's word, not a guess of ours.
 */
export function aggregateSpend(runs: readonly FormatRun[]): number | null {
  const known = runs.filter((r) => r.actualCost != null && Number.isFinite(r.actualCost));
  if (known.length === 0) return null;
  return known.reduce((sum, r) => sum + (r.actualCost as number), 0);
}

/**
 * Collapse N run phases into the ONE phase the page chrome renders.
 *
 * 🔴 SUCCESS OUTRANKS FAILURE, and that is the partial-failure contract: if any
 * run produced images, the page is in its results state and those images are
 * shown, even though another run failed. Ranking 'failed' first would throw away
 * generations the viewer has already PAID for. The failures are surfaced
 * separately via {@link failedRuns}, not by suppressing the successes.
 *
 * While work is in flight the LEAST advanced busy stage wins, so the button
 * label doesn't read "Generating…" while another run is still being priced.
 */
export function overallPhase(runs: readonly FormatRun[]): GenPhase {
  if (runs.length === 0) return 'idle';
  if (runs.some((r) => r.phase === 'needs-consent')) return 'needs-consent';
  if (runs.some((r) => r.phase === 'estimating')) return 'estimating';
  if (runs.some((r) => r.phase === 'submitting')) return 'submitting';
  if (runs.some((r) => r.phase === 'polling')) return 'polling';
  if (runs.some((r) => r.phase === 'succeeded')) return 'succeeded';
  // Same precedence as the single-run classifier: a disallowed pool is a
  // recoverable preference problem and must not be reported as "out of Buzz".
  if (runs.some((r) => r.phase === 'account-rejected')) return 'account-rejected';
  if (runs.some((r) => r.phase === 'insufficient')) return 'insufficient';
  if (runs.some((r) => r.phase === 'failed')) return 'failed';
  return 'idle';
}

/** One generated image, tagged with the format that produced it. */
export interface Candidate {
  url: string;
  formatId: string;
  formatLabel: string;
}

/**
 * Every image from every run, flattened into one gallery in run order and
 * tagged with its format. Runs that failed simply contribute nothing — they do
 * not remove anyone else's results.
 */
export function runCandidates(runs: readonly FormatRun[]): Candidate[] {
  const out: Candidate[] = [];
  for (const r of runs) {
    for (const url of r.imageUrls) {
      out.push({ url, formatId: r.formatId, formatLabel: r.label });
    }
  }
  return out;
}

/** The runs that ended in a terminal non-success, for the partial-failure note. */
export function failedRuns(runs: readonly FormatRun[]): FormatRun[] {
  return runs.filter(
    (r) => r.phase === 'failed' || r.phase === 'insufficient' || r.phase === 'account-rejected',
  );
}

/** Did SOME runs succeed while others did not? Drives the partial-failure banner. */
export function isPartialFailure(runs: readonly FormatRun[]): boolean {
  return runs.some((r) => r.phase === 'succeeded') && failedRuns(runs).length > 0;
}

// ---------------------------------------------------------------------------
// Default Buzz account selection.
// ---------------------------------------------------------------------------

/**
 * The order a default account is chosen in: spend the free/earned pool first,
 * then creator-earned, and only then the pool the viewer paid cash for.
 * Deliberately NOT the same thing as the server's funding order — this is only
 * which pool the app PREFERS on the viewer's behalf.
 */
export const ACCOUNT_DEFAULT_ORDER: readonly BuzzAccountType[] = ['blue', 'green', 'yellow'];

/**
 * Pick the account to default the picker to: the FIRST pool in
 * {@link ACCOUNT_DEFAULT_ORDER} that by itself covers `cost`.
 *
 * Falls back to `'auto'` — today's behaviour, which threads NO `accountType` and
 * lets the host drain its own order — when the balance is unknown, the cost is
 * unknown, or NO single pool is sufficient. That last case matters: picking an
 * insufficient pool would be strictly worse than Auto, because a preference the
 * server cannot satisfy just wastes the fallback the host would have done for
 * us. An explicit pick is only ever a PREFERENCE: the server clamps it to what
 * the viewer holds and to the app's content-rating domain, and may reject it
 * outright (see {@link isDisallowedAccountError}).
 */
export function pickDefaultAccount(
  balance: Partial<Record<BuzzAccountType, number>> | null | undefined,
  cost: number | null | undefined,
): AccountChoice {
  if (!balance) return 'auto';
  if (cost == null || !Number.isFinite(cost) || cost <= 0) return 'auto';
  for (const pool of ACCOUNT_DEFAULT_ORDER) {
    const have = balance[pool];
    if (typeof have === 'number' && Number.isFinite(have) && have >= cost) return pool;
  }
  return 'auto';
}
