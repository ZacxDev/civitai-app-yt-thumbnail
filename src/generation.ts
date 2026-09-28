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

/** Suffixable prompt styles tuned for thumbnail aesthetics (quick-fill chips). */
export const THUMB_PROMPT_STYLES: ReadonlyArray<{ label: string; suffix: string }> = [
  { label: 'Clickbait', suffix: 'youtube thumbnail style, shocked expression, vibrant colors, high contrast, dramatic lighting, centered subject, bold' },
  { label: 'Cinematic', suffix: 'cinematic lighting, dramatic atmosphere, ultra detailed, movie still, depth of field' },
  { label: 'Bold & Simple', suffix: 'bold flat colors, simple composition, strong focal point, clean background' },
];

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
