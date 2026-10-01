// Model types + pick→option helpers for YT Thumbnail.
//
// WHY A CURATED DEFAULT CHECKPOINT (the page platform reality):
//   A W10 page slot is entity=none — it carries NO model context (unlike a model
//   slot, which delivers modelId/modelVersionId via BLOCK_INIT). So a page app
//   must ship a known-good DEFAULT checkpoint that works at first paint, BEFORE
//   the user opens the host's resource picker. The user then picks any other
//   checkpoint (or layers on LoRAs) via the SDK's `useResourcePicker` /
//   `useCheckpointPicker` hooks, which open the HOST's native picker — the block
//   never browses the catalog itself (the host serves it, in dev:live and prod).
//
// MONEY-SAFETY: a pick is DISCOVERY ONLY. Nothing about a client-chosen
// checkpoint OR LoRA is trusted — the SERVER re-validates (public? covered? SFW
// for the domain? LoRA-only? compatible? entitled?) and RE-PRICES every estimate
// and submit. We never imply otherwise.

export interface CheckpointOption {
  /** ModelVersion id submitted to the workflow as `modelVersionId`. */
  versionId: number;
  /** Parent Model id submitted as `modelId`. */
  modelId: number;
  /** Short display label for the current-model label. */
  label: string;
  /** Base-model family — display + the picker's family hint; compatibility is a SERVER authority. */
  baseModel: string;
}

// ---------------------------------------------------------------------------
// LoRAs — the main feature. A LoRA is an ADDITIONAL resource layered on top of
// the checkpoint, each with an adjustable weight (its `strength`). It maps to a
// `body.additionalResources[]` entry, NOT to `modelVersionId` (that's the
// checkpoint). The SDK's WorkflowBody documents the server bounds we mirror:
//   - max 5 entries (MAX_LORAS)
//   - each strength in [-1, 2] (LORA_STRENGTH_MIN/MAX), default 1
//   - LoRA-only; the server rejects non-LoRA versions AND re-checks base-model
//     compatibility + entitlement BEFORE any Buzz spend.
//
// MONEY-SAFETY: a LoRA pick + its weight are DISCOVERY ONLY. The server
// re-validates (LoRA? compatible? entitled?) AND re-prices the whole body at
// every estimate AND submit, so a client choice is never trusted.
// ---------------------------------------------------------------------------

/** Server `additionalResources[].strength` bounds (mirrors WorkflowBody). */
export const LORA_STRENGTH_MIN = -1;
export const LORA_STRENGTH_MAX = 2;
/** Server default strength when none is given. */
export const DEFAULT_LORA_WEIGHT = 1;
/** Server cap on additional resources (max 5 LoRAs per body). */
export const MAX_LORAS = 5;

/** A LoRA the user has added on top of the checkpoint, with its weight. */
export interface LoraOption {
  /** ModelVersion id → an `additionalResources[].modelVersionId` entry. */
  versionId: number;
  /** Parent Model id — display/label only (the wire only needs versionId). */
  modelId: number;
  /** Short display label for the list. */
  label: string;
  /** Base-model family — display/label only; compatibility is a SERVER authority. */
  baseModel: string;
  /** The LoRA's weight → its `additionalResources[].strength`. Clamped to [-1, 2]. */
  weight: number;
}

/** Clamp a LoRA weight into the server-accepted [-1, 2] range; non-finite → default. */
export function clampLoraWeight(weight: number | null | undefined): number {
  const w = weight == null || !Number.isFinite(weight) ? DEFAULT_LORA_WEIGHT : weight;
  return Math.max(LORA_STRENGTH_MIN, Math.min(LORA_STRENGTH_MAX, w));
}

/** Round a weight to 2 decimals so display + dedup agree (0.30000001 → 0.3). */
export function roundLoraWeight(weight: number): number {
  return Math.round(weight * 100) / 100;
}

/**
 * The default checkpoint a fresh session starts on: ChatGPT Images v2.0
 * (versionId 2880272 / modelId 2563220), baseModel `OpenAI`. It's the initial
 * state so Generate works at first paint, before the user opens the picker. The
 * user replaces it via the host's resource picker. DISCOVERY ONLY — the server
 * re-validates + re-prices it like any pick.
 *
 * 🔴 WHY THIS ONE AND NOT SD XL 1.0 (the 0.1.5 default, versionId 128078):
 * BECAUSE THE ASPECT RATIO ACTUALLY LANDS. Measured 2026-09-30 against the live
 * backend through THIS BLOCK'S OWN ROUTE — `POST /api/trpc/blocks.submitWorkflow`
 * with the exact body `buildWorkflowBody` emits, which is the route
 * `createLiveHost` drives in `npm run dev:live`:
 *
 *   requested params 1280x720 (16:9)  ->  delivered 1536x864 (16:9), cost 209
 *   (two agreeing reads: `magick identify` = 1536x864, and the JPEG SOF marker
 *   parsed straight out of the bytes = 1536x864)
 *
 * The EXACT PIXELS are not honoured — the server snaps to the ecosystem's own
 * supported size — but the ASPECT is. Contrast SD XL 1.0 / FLUX.1 [dev], where a
 * 1280x720 AND a 1344x768 request both came back 1216x832 (~3:2): on those the
 * requested shape is inert and a 16:9 thumbnail has to be cropped out of a
 * 3:2 frame.
 *
 * 🔴 THE DISCRIMINATING CONTROL, because "it came back 16:9" alone cannot tell
 * "the aspect was honoured" from "this model always returns 16:9".
 * `blocks.estimateWorkflow` is FREE and the OpenAI ecosystem PRICES BY SHAPE, so
 * the estimate is a signal that moves only if `params.width`/`height` reach the
 * request. Measured the same day, same route:
 *
 *   ChatGPT Images  1280x720 -> 209 · 1024x1024 -> 287 · 720x1280 -> 209
 *   SD XL 1.0       1280x720 ->   3 · 1024x1024 ->   3 · 720x1280 ->   3
 *
 * The number MOVES on OpenAI and is FLAT on SD XL — i.e. a positive arm and a
 * negative arm, which is what makes this a measurement rather than a story.
 *
 * COST: 209 Buzz/image at a non-square aspect (287 at 1:1) versus 3 on SD XL.
 * That is why `page.buzzBudgetPerGen` had to go 300 -> 900; see block.manifest.json.
 */
export const DEFAULT_CHECKPOINT: CheckpointOption = {
  versionId: 2880272,
  modelId: 2563220,
  label: 'ChatGPT Images',
  baseModel: 'OpenAI',
};

/**
 * Base-model families with NO LoRAs in the catalogue at all, so the LoRA picker
 * cannot do its job on them.
 *
 * 🔴 WHY A SET AND NOT A GUESS. The LoRA picker deliberately keeps its
 * `baseModelGroup` family filter (a LoRA must match its checkpoint's base model,
 * and the SERVER enforces that at estimate/submit). With the OpenAI default that
 * filter matches nothing — measured 2026-09-30 against the same catalogue
 * endpoint the host picker serves, `/api/v1/blocks/models`:
 *
 *   types=LORA       & baseModels=OpenAI  -> 0 items
 *   types=Checkpoint & baseModels=OpenAI  -> 2 items   <- POSITIVE CONTROL
 *   types=LORA       & (no baseModels)    -> non-empty <- POSITIVE CONTROL
 *
 * Both controls matter. The unfiltered LoRA read proves the query CAN return
 * LoRAs, so the 0 is not a dead request. The Checkpoint read proves `OpenAI` is a
 * real `baseModels` VALUE the filter understands, so the 0 is "this family has no
 * LoRAs" and not "that string isn't a base-model name" — which is exactly the
 * mistake the same survey caught elsewhere: `baseModels=Flux1` also returns 0
 * LoRAs, but only because `Flux1` is an ECOSYSTEM KEY; the base-model NAME
 * `Flux.1 D` returns plenty. Entries go in this set ONLY when BOTH controls have
 * been run — otherwise a naming mismatch gets recorded as a product fact.
 *
 * 🔴 WHAT THIS PREVENTS, which is worse than an empty grid. The dev-shim catalog
 * (`blocks-react/internal/catalog.js`) does NOT show an empty result for an
 * unmatched family: `filterCardsByFamily` falls back to the FULL card set when
 * nothing matched, and `fetchCatalog` retries once with `baseModels` cleared. So
 * an un-annotated Add LoRA button on an OpenAI checkpoint offers a grid of
 * SD-family LoRAs that are all incompatible — a control that looks like it
 * works, and whose failure only arrives server-side after the viewer has
 * committed to a pick.
 */
export const LORA_FREE_BASE_MODELS: ReadonlySet<string> = new Set(['OpenAI']);

/**
 * Can this base-model family take LoRAs at all? Drives whether the LoRA control
 * is offered or explained. Case/punctuation-insensitive so `OpenAI`, `openai`
 * and `Open AI` all resolve the same way — the label comes from a host pick and
 * this must not turn into a spelling contest.
 *
 * TRUE for an unknown/absent family, deliberately: this set is a measured
 * exception list, not an allowlist, and defaulting to "no LoRAs" would silently
 * disable a working control for every family nobody has measured yet.
 */
export function familyHasLoras(baseModel: string | null | undefined): boolean {
  const key = (baseModel ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key === '') return true;
  for (const denied of LORA_FREE_BASE_MODELS) {
    if (denied.toLowerCase().replace(/[^a-z0-9]/g, '') === key) return false;
  }
  return true;
}

/**
 * The LoRAs that may actually ride with a checkpoint of this family: the selection
 * as-is when the family takes LoRAs, and NOTHING when it does not.
 *
 * 🔴 ONE RULE, ONE PLACE, AND IT CLOSES A REAL SUBMIT BUG. Switching the
 * checkpoint used to set the new model and leave `loras` untouched, so an SDXL
 * LoRA stayed selected under an OpenAI checkpoint and rode into
 * `additionalResources` — the server then rejected the generation with nothing on
 * screen explaining why. Hiding the LoRA field for such a family (which is the
 * right UI) makes that state INVISIBLE rather than merely wrong, which is why the
 * clearing rule and the body-building rule have to be the SAME function: the App
 * calls this when the model changes (so the viewer SEES the clear and is told),
 * AND when it builds the submitted form snapshot (so no body can carry an
 * impossible resource even if some other path — a resume of an old record — sets
 * the two inconsistently).
 */
export function lorasForCheckpoint(
  baseModel: string | null | undefined,
  selected: readonly LoraOption[],
): LoraOption[] {
  return familyHasLoras(baseModel) ? [...selected] : [];
}

// ---------------------------------------------------------------------------
// Pick → option helpers.
//
// `useCheckpointPicker().open(...)` resolves with a `BlockCheckpointInfo` and
// `useResourcePicker().open(...)` with a `BlockResourceInfo` — both carry the
// public display names (`modelName`/`versionName`) the HOST resolved for the
// resource the user picked. These mappers turn that pick into a CheckpointOption
// / LoraOption with the same money-safety invariants as the default checkpoint.
// Everything here is DISCOVERY ONLY — the wire is re-validated + re-priced
// server-side at estimate/submit.
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a picked resource — the common subset of the SDK's
 * `BlockCheckpointInfo` and `BlockResourceInfo`. We accept the names as optional
 * so the mappers tolerate a host that omitted them (older host / partial reply).
 */
export interface PickedResource {
  versionId: number;
  modelId: number;
  /** Public display name of the picked model (e.g. "DreamShaper"). */
  modelName?: string;
  /** Public display name of the picked model version (e.g. "v8"). */
  versionName?: string;
  baseModel: string;
}

/**
 * Build a human display name from a pick's `modelName`/`versionName`, or
 * `undefined` when neither is present. Prefers "<model> — <version>" when both
 * exist (e.g. "DreamShaper — v8"); falls back to whichever single name is set.
 * Whitespace-only names are treated as absent.
 */
function resourceDisplayName(names?: { modelName?: string; versionName?: string }): string | undefined {
  const model = names?.modelName?.trim();
  const version = names?.versionName?.trim();
  if (model && version) return `${model} — ${version}`;
  return model || version || undefined;
}

/**
 * Label a picked checkpoint. PREFER the public display name; fall back to the
 * version id + base model ("Model #128078 (SDXL 1.0)") when no name is present.
 * The fallback is deterministic, dedupes, and still tells the user the family.
 */
export function pickedCheckpointLabel(
  versionId: number,
  baseModel: string,
  names?: { modelName?: string; versionName?: string },
): string {
  return resourceDisplayName(names) ?? `Model #${versionId} (${baseModel})`;
}

/** Turn a picked resource (`BlockCheckpointInfo`) into a `CheckpointOption`. */
export function checkpointFromPick(picked: PickedResource): CheckpointOption {
  return {
    versionId: picked.versionId,
    modelId: picked.modelId,
    label: pickedCheckpointLabel(picked.versionId, picked.baseModel, picked),
    baseModel: picked.baseModel,
  };
}

// ---------------------------------------------------------------------------
// LoRA pick → option + the selected-LoRA list mutators (pure + total). The App
// holds the selected list in state and drives every change through these so the
// money-relevant invariants (the MAX_LORAS cap, the weight clamp, no duplicate
// versionId) live in one tested place.
// ---------------------------------------------------------------------------

/**
 * Turn a discovered LoRA into a selectable LoraOption at a given weight
 * (defaults to DEFAULT_LORA_WEIGHT). The weight is clamped + rounded so the
 * value the user sees is exactly what's submitted.
 */
export function loraOption(
  src: Omit<LoraOption, 'weight'>,
  weight: number = DEFAULT_LORA_WEIGHT,
): LoraOption {
  return { ...src, weight: roundLoraWeight(clampLoraWeight(weight)) };
}

/** Turn a picked resource (`BlockResourceInfo`) into a LoraOption (label-resolved like a checkpoint). */
export function loraFromPick(picked: PickedResource, weight?: number): LoraOption {
  return loraOption(
    {
      versionId: picked.versionId,
      modelId: picked.modelId,
      label: resourceDisplayName(picked) ?? `LoRA #${picked.versionId} (${picked.baseModel})`,
      baseModel: picked.baseModel,
    },
    weight,
  );
}

/**
 * Add a LoRA to the selected list. No-ops if it's already present (dedup by
 * versionId) OR the MAX_LORAS cap is already reached (the server caps at 5; we
 * never let the UI build a body that would be rejected). Returns a new array.
 */
export function addLora(
  selected: readonly LoraOption[],
  lora: LoraOption,
): LoraOption[] {
  if (selected.length >= MAX_LORAS) return [...selected];
  if (selected.some((l) => l.versionId === lora.versionId)) return [...selected];
  return [...selected, loraOption(lora, lora.weight)];
}

/** Remove a LoRA from the selected list by versionId. Returns a new array. */
export function removeLora(selected: readonly LoraOption[], versionId: number): LoraOption[] {
  return selected.filter((l) => l.versionId !== versionId);
}

/** Set a selected LoRA's weight (clamped + rounded). Returns a new array. */
export function setLoraWeight(
  selected: readonly LoraOption[],
  versionId: number,
  weight: number,
): LoraOption[] {
  const w = roundLoraWeight(clampLoraWeight(weight));
  return selected.map((l) => (l.versionId === versionId ? { ...l, weight: w } : l));
}

/** versionIds already selected — drives dedup at the picker callback. */
export function selectedLoraIds(selected: readonly LoraOption[]): Set<number> {
  return new Set(selected.map((l) => l.versionId));
}
