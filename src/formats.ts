// Thumbnail FORMATS — the pure model behind the format picker, the private
// custom-format store, and the publishable shared store. No React, no DOM, no
// host calls: everything here is total and unit-tested (formats.test.ts), so
// the App stays a thin driver.
//
// A FORMAT is a named prompt suffix. It is NOT a style chip that types text
// into the prompt box (that was the old `THUMB_PROMPT_STYLES` behaviour) — a
// format is SELECTED, and its suffix is composed onto the prompt at
// body-build time. That is what makes multi-select meaningful: N selected
// formats produce N different prompts, hence N workflows (see generation.ts's
// run helpers), because one request cannot carry two different prompts.
//
// Three tiers, deliberately distinct:
//   BUILT-IN   — shipped in the bundle, always available, never editable.
//   CUSTOM     — the viewer's own, PRIVATE BY DEFAULT, persisted per-viewer via
//                `useAppStorage`. Never visible to anyone else.
//   PUBLISHED  — a custom format the viewer explicitly pushed to the app-wide
//                `useSharedStorage` board, where other viewers can find it.
//
// 🔴 THE MODERATION SPLIT IS LOAD-BEARING. `useSharedStorage`'s `title`/`body`
// are MODERATED, user-visible text; `data` is UNMODERATED opaque app state. A
// published format's suffix is injected into OTHER viewers' PAID generations in
// a contentRating:"g" app, so it MUST ride in `body` where the content belt can
// see it. Putting it in `data` would route user-authored prompt text around
// moderation entirely. `sharedValueForFormat` is the single place that decision
// lives, and `formats.test.ts` pins it.

/** A selectable thumbnail format: a named prompt suffix + its preview art. */
export interface Format {
  /** Stable id. Built-ins use a bare slug; custom/published ones are prefixed. */
  id: string;
  /** Short display name shown on the chip. */
  label: string;
  /** Appended to the user's prompt for this format's workflow. */
  suffix: string;
  /**
   * Bundled preview image URL, or `undefined` for a format we have no art for
   * (every custom + published format) — the UI shows a neutral placeholder.
   */
  preview?: string;
  /** Which tier this came from — drives the edit/delete/publish affordances. */
  source: 'builtin' | 'custom' | 'published';
}

/**
 * Does this format have usable preview art? THE one predicate for that question.
 *
 * 🔴 ONE RULE, ONE PLACE — and the rule is TRUTHINESS, not `!== undefined`. The
 * component and the tests used to disagree: `FormatPicker` branched on
 * `fmt.preview ?` while `formats.test.ts` classified art as
 * `f.preview !== undefined`. Those two split on `''` and on `null`, which are
 * exactly the well-meant-placeholder values that would reach the DOM as
 * `<img src="">` and paint a broken-image icon. The component's reading is the
 * safe one, so it is the one that won; both sides now call this.
 */
export function hasPreviewArt(fmt: { preview?: string | null }): boolean {
  return typeof fmt.preview === 'string' && fmt.preview.trim() !== '';
}

// ---------------------------------------------------------------------------
// Built-ins. Twelve, spanning the thumbnail styles a creator actually picks
// between rather than twelve variations of one look.
//
// 🔴 ALL TWELVE NOW CARRY ART, and `preview` is STILL OPTIONAL — it has to be,
// because every CUSTOM and PUBLISHED format has none. So the placeholder branch
// in `FormatPicker` is live code, not dead code; it is just no longer reachable
// from a built-in. `hasPreviewArt` is the one predicate both the component and
// the tests branch on — see its own note for why truthiness, not `!== undefined`.
// Do NOT invent a `preview` path or a `sourceWorkflowId` for a format whose art
// has not been generated: the JSON is a provenance ledger and a fabricated
// workflow id is a false record, which `formats.test.ts` now rejects by SHAPE
// and not merely by presence.
//
// 🔴 THESE ARE A MIRROR, NOT THE ORIGINAL. The canonical definition — label,
// suffix and preview path — lives in `public/formats/formats.json`, which also
// records the `sourceWorkflowId` of the REAL generation each preview came from
// (see claudedocs/format-previews.md for provenance). The provenance triple —
// `preview`, `sourceWorkflowId`, `costBuzz` — travels together or not at all,
// and `formats.test.ts` pins that. That file feeds nothing at runtime: it is the
// provenance record. The array below is the bundled, typed copy the app actually
// reads, so there is no runtime fetch and no chance of the picker rendering
// before its own catalogue arrives.
//
// The two are pinned in lockstep by `formats.test.ts` ('mirrors
// public/formats/formats.json exactly'), which reads the JSON off disk and
// compares it field by field. Edit the JSON, then this array — the guard fails
// if you do only one.
//
// `preview` is a ROOT-ABSOLUTE path into `public/`, which Vite copies verbatim
// into `dist/` and the platform serves at the app subdomain's root. It is NOT a
// bundler import: these are content images, not code, and keeping them out of
// the JS means the picker's art is cacheable and never inlined as base64.
// ---------------------------------------------------------------------------

/** The built-in formats, in picker order. */
export const BUILTIN_FORMATS: readonly Format[] = [
  {
    id: 'clickbait',
    label: 'Clickbait',
    suffix:
      'youtube thumbnail, shocked expression, vibrant saturated colors, high contrast, dramatic rim lighting, centered subject, bold and punchy',
    preview: '/formats/clickbait.webp',
    source: 'builtin',
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    suffix:
      'cinematic film still, dramatic moody lighting, shallow depth of field, teal and orange color grade, ultra detailed, anamorphic',
    preview: '/formats/cinematic.webp',
    source: 'builtin',
  },
  {
    id: 'bold-simple',
    label: 'Bold & Simple',
    suffix:
      'bold flat colors, minimal composition, strong single focal point, clean uncluttered background, graphic poster style',
    preview: '/formats/bold-simple.webp',
    source: 'builtin',
  },
  {
    id: 'tech-review',
    label: 'Tech Review',
    suffix:
      'clean product photography, crisp studio lighting, modern minimal desk setup, soft gradient background, sharp focus',
    preview: '/formats/tech-review.webp',
    source: 'builtin',
  },
  {
    id: 'tutorial',
    label: 'Tutorial',
    suffix:
      'bright even lighting, friendly approachable tone, clean organized workspace, soft natural colors, clear and legible',
    preview: '/formats/tutorial.webp',
    source: 'builtin',
  },
  {
    id: 'gaming',
    label: 'Gaming',
    suffix:
      'dynamic action, neon rim lighting, energetic composition, vivid magenta and cyan, high energy, stylized digital art',
    preview: '/formats/gaming.webp',
    source: 'builtin',
  },

  // --- Added in the second batch. Art landed separately (ChatGPT Images, 209
  // Buzz each — provenance in claudedocs/format-previews.md). ---
  //
  // Three of these six sit next to an earlier built-in, so each one's suffix is
  // deliberately written to occupy different vocabulary from its neighbour. The
  // comment on each says which neighbour it is being held apart from and how,
  // because "distinct" is the whole reason the format exists — two formats whose
  // suffixes land on the same look are two bills for one image.
  {
    id: 'minimalist',
    label: 'Minimalist',
    // vs `bold-simple`: that one is LOUD-but-simple — saturated flat colour, a
    // centred focal point, poster graphics. This one is QUIET — empty space, a
    // small off-centre subject, drained colour, photographic rather than graphic.
    // No word is shared between the two suffixes.
    suffix:
      'generous negative space, one small off-center subject, muted desaturated palette, soft diffuse daylight, understated and quiet, delicate fine detail',
    preview: '/formats/minimalist.webp',
    source: 'builtin',
  },
  {
    id: 'educational',
    label: 'Educational',
    // vs `tutorial`: that one is a PHOTOGRAPH of a friendly workspace. This one
    // is a DRAWING — diagram, callouts, whiteboard, chart. Different medium,
    // different subject, no shared vocabulary.
    suffix:
      'infographic layout, labeled diagram with callout arrows, whiteboard sketch annotations, charts and flow lines, explanatory schematic, flat vector illustration',
    preview: '/formats/educational.webp',
    source: 'builtin',
  },
  {
    id: 'professional',
    label: 'Professional',
    // vs `tech-review`: that one photographs an OBJECT on a desk. This one
    // photographs a PERSON in a corporate setting — portrait, presenter,
    // boardroom. Different subject class entirely.
    suffix:
      'corporate business portrait, confident presenter on a conference stage, tailored suit, glass office tower boardroom, authoritative composure, polished editorial lighting',
    preview: '/formats/professional.webp',
    source: 'builtin',
  },
  {
    id: 'abstract',
    label: 'Abstract',
    suffix:
      'non representational abstract shapes, overlapping geometric planes, gradient mesh and flowing curves, risograph grain texture, no recognizable objects, generative art',
    preview: '/formats/abstract.webp',
    source: 'builtin',
  },
  {
    id: 'chaos',
    label: 'Chaos',
    // Not `gaming` with the dial turned up: gaming is ACTION (dynamic, neon,
    // energetic). This is CLUTTER — collage, clashing pattern, glitch, too much
    // of everything at once.
    suffix:
      'maximalist visual overload, cluttered collage of overlapping elements, clashing patterns, motion blur and glitch artifacts, frenetic asymmetric composition, controlled mess',
    preview: '/formats/chaos.webp',
    source: 'builtin',
  },
  {
    id: 'magic',
    label: 'Magic',
    suffix:
      'arcane fantasy sorcery, swirling glowing runes and sparkling particles, enchanted mist, iridescent violet and gold aura, ethereal otherworldly atmosphere, painterly fantasy illustration',
    preview: '/formats/magic.webp',
    source: 'builtin',
  },
];

/** The format selected when nothing is stored yet. Always exists. */
export const DEFAULT_FORMAT_ID = BUILTIN_FORMATS[0].id;

// ---------------------------------------------------------------------------
// Multi-select. AT LEAST ONE format is always selected — the selection drives
// how many workflows a Generate click submits, and zero workflows is not a
// state the UI should be able to reach (the Generate button would spend
// nothing and report success).
// ---------------------------------------------------------------------------

/**
 * Toggle a format in the selected set. Deselecting the LAST remaining format is
 * a NO-OP by design: at least one format is always selected, so Generate always
 * has something to submit. Returns a new array, in the order ids were added.
 */
export function toggleFormat(selected: readonly string[], id: string): string[] {
  if (selected.includes(id)) {
    if (selected.length <= 1) return [...selected];
    return selected.filter((s) => s !== id);
  }
  return [...selected, id];
}

/**
 * Drop any selected id that no longer resolves to a real format (a custom
 * format the viewer just deleted, or a published one that was withdrawn) and
 * guarantee the at-least-one invariant by falling back to the default built-in.
 * Total: never returns an empty array.
 */
export function reconcileSelection(
  selected: readonly string[],
  available: readonly Format[],
): string[] {
  const ids = new Set(available.map((f) => f.id));
  const kept = selected.filter((s) => ids.has(s));
  return kept.length > 0 ? kept : [DEFAULT_FORMAT_ID];
}

/** Resolve selected ids to formats, in the AVAILABLE order (stable picker order). */
export function resolveFormats(
  selected: readonly string[],
  available: readonly Format[],
): Format[] {
  const want = new Set(selected);
  return available.filter((f) => want.has(f.id));
}

// ---------------------------------------------------------------------------
// Custom formats — the viewer's own, private, persisted via `useAppStorage`.
// ---------------------------------------------------------------------------

/**
 * The `useAppStorage` key holding this viewer's custom formats. Versioned in the
 * key itself so a future incompatible shape can land beside the old one rather
 * than silently mis-parsing it.
 */
export const CUSTOM_FORMATS_KEY = 'formats:custom:v1';

/** Id prefix for a custom format, so it can never collide with a built-in slug. */
export const CUSTOM_ID_PREFIX = 'custom:';

/** Display-name bounds. Short enough to fit a chip, long enough to be useful. */
export const LABEL_MAX = 40;
/**
 * Suffix bound. Well under `PROMPT_MAX` (1500) so a format can never be the
 * reason a prompt is truncated to nothing.
 */
export const SUFFIX_MAX = 400;
/**
 * How many custom formats one viewer may keep. The whole list lives in ONE
 * storage value, and the host rejects a value over 64KB; 40 × (40 + 400) chars
 * is ~18KB worst case, a comfortable margin under that cap.
 */
export const MAX_CUSTOM_FORMATS = 40;

/** A custom format as persisted. Same shape as `Format` minus the derived bits. */
export interface CustomFormat {
  id: string;
  label: string;
  suffix: string;
}

/**
 * The one character a format suffix may not contain.
 *
 * 🔴 `#` IS EATEN SERVER-SIDE BEFORE THE MODEL EVER SEES IT. The generator reads
 * `#name` as a WILDCARD REFERENCE, not as literal prompt text: measured, a suffix
 * containing `#FF49BD` came back with `targets.prompt[0].category = "FF49BD"` —
 * the `#` and the word after it were lifted out of the prompt entirely. Nothing
 * errors; the generation succeeds and silently is not the prompt that was paid
 * for. A format's suffix is appended to EVERY prompt made with that format, so
 * one `#` corrupts every generation it will ever produce — and a PUBLISHED format
 * carries that corruption into OTHER viewers' paid generations.
 */
export const WILDCARD_CHAR = '#';

/**
 * Why this suffix cannot be used, or `null` when it is fine. THE single place the
 * `#` rule lives.
 *
 * 🔴 ONE RULE, ONE PLACE. This predicate is called from `validateCustomFormat`
 * (the viewer saving their own format) and from the publish path (pushing one to
 * the app-wide board). It is deliberately NOT called from `parseCustomFormats` or
 * `formatFromSharedItem` — see the note on `validateCustomFormat` for why loading
 * must stay permissive. The built-in suffixes get the same check for free in
 * `formats.test.ts`, which is the population that can least have the problem and
 * was, before this, the only one that was checked at all.
 */
export function suffixWildcardReason(suffix: string): string | null {
  if (!suffix.includes(WILDCARD_CHAR)) return null;
  return `Remove the “${WILDCARD_CHAR}” — the generator reads it as a wildcard and deletes the word after it from your prompt.`;
}

/**
 * Validate a candidate custom format's user-entered fields. Returns a
 * human-readable reason, or `null` when it is acceptable. Checked BEFORE the
 * storage write so the viewer gets a specific message instead of the host's
 * generic rejection string.
 *
 * 🔴 THIS RUNS ON SAVE, NEVER ON LOAD. A viewer may ALREADY have a stored suffix
 * containing `#` — it was accepted before this rule existed — and making that
 * format unloadable would delete work they can see in the UI, to fix a problem
 * they did not cause. So `parseCustomFormats` keeps such an entry verbatim and
 * this function refuses the next SAVE of it, with copy that says why. Both
 * directions are tested (`formats.test.ts`, "validated on SAVE, not on LOAD").
 */
export function validateCustomFormat(draft: { label: string; suffix: string }): string | null {
  const label = draft.label.trim();
  const suffix = draft.suffix.trim();
  if (label.length === 0) return 'Give the format a name.';
  if (label.length > LABEL_MAX) return `Name is too long (max ${LABEL_MAX} characters).`;
  if (suffix.length === 0) return 'Describe the look — this text is added to your prompt.';
  if (suffix.length > SUFFIX_MAX) return `Description is too long (max ${SUFFIX_MAX} characters).`;
  return suffixWildcardReason(suffix);
}

/**
 * Mint a stable id for a new custom format. Prefixed so it can never collide
 * with a built-in slug, and suffixed with a caller-supplied unique token (the
 * App passes `Date.now()`) so the function stays PURE and testable — no clock,
 * no randomness reached from inside.
 */
export function customFormatId(unique: string | number): string {
  return `${CUSTOM_ID_PREFIX}${unique}`;
}

/** Is this id a custom (viewer-owned, editable) format? */
export function isCustomId(id: string): boolean {
  return id.startsWith(CUSTOM_ID_PREFIX);
}

/**
 * Insert or replace a custom format by id, preserving list order on an edit and
 * appending on a create. Returns the list UNCHANGED when a create would cross
 * {@link MAX_CUSTOM_FORMATS} — the caller checks {@link customFormatsFull} to
 * show the cap message, and this is the backstop that keeps an over-cap list
 * from ever being built.
 */
export function upsertCustomFormat(
  list: readonly CustomFormat[],
  fmt: CustomFormat,
): CustomFormat[] {
  const at = list.findIndex((f) => f.id === fmt.id);
  if (at >= 0) {
    const next = [...list];
    next[at] = fmt;
    return next;
  }
  if (list.length >= MAX_CUSTOM_FORMATS) return [...list];
  return [...list, fmt];
}

/** Remove a custom format by id. Returns a new array. */
export function deleteCustomFormat(list: readonly CustomFormat[], id: string): CustomFormat[] {
  return list.filter((f) => f.id !== id);
}

/** Is the viewer at the custom-format cap? Drives the disabled "New format" button. */
export function customFormatsFull(list: readonly CustomFormat[]): boolean {
  return list.length >= MAX_CUSTOM_FORMATS;
}

/**
 * Parse whatever `useAppStorage().get()` returned into a clean CustomFormat[].
 *
 * TOTAL AND DEFENSIVE ON PURPOSE. The stored value is JSON this app wrote, but
 * it round-trips through a host datastore and can be an older shape, a partial
 * write, or `null` (which is ALSO what an anonymous viewer gets). A throw here
 * would break first paint for everybody, so anything unrecognisable degrades to
 * an empty list and any individual malformed entry is dropped rather than
 * poisoning the rest. Entries are trimmed, length-clamped and de-duplicated by
 * id, and the result is capped at MAX_CUSTOM_FORMATS.
 *
 * 🔴 IT DOES NOT APPLY `suffixWildcardReason`, AND THAT IS DELIBERATE. The `#`
 * rule is a SAVE-time rule. A viewer whose stored suffix contains `#` saved it
 * before the rule existed; dropping the entry here would silently delete a format
 * they can see in their picker. They keep it, it keeps working as it always did
 * (badly — the `#` is still eaten), and the next time they SAVE or PUBLISH it they
 * are told why and asked to fix it. Pinned in both directions in `formats.test.ts`.
 */
export function parseCustomFormats(raw: unknown): CustomFormat[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomFormat[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== 'string' || typeof e.label !== 'string' || typeof e.suffix !== 'string') {
      continue;
    }
    const id = e.id.trim();
    const label = e.label.trim().slice(0, LABEL_MAX);
    const suffix = e.suffix.trim().slice(0, SUFFIX_MAX);
    if (id === '' || label === '' || suffix === '') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, suffix });
    if (out.length >= MAX_CUSTOM_FORMATS) break;
  }
  return out;
}

/**
 * The exact value handed to `useAppStorage().set()`. A plain array — no wrapper
 * object — so {@link parseCustomFormats} round-trips it, and so the stored bytes
 * stay minimal against the 64KB per-value cap.
 */
export function serializeCustomFormats(list: readonly CustomFormat[]): CustomFormat[] {
  return list.map((f) => ({ id: f.id, label: f.label, suffix: f.suffix }));
}

/** Turn a stored custom format into a pickable Format (no bundled preview art). */
export function customToFormat(f: CustomFormat): Format {
  return { id: f.id, label: f.label, suffix: f.suffix, source: 'custom' };
}

// ---------------------------------------------------------------------------
// Published formats — the app-wide `useSharedStorage` board.
// ---------------------------------------------------------------------------

/** Id prefix for a published format, keyed by the host-minted shared key. */
export const PUBLISHED_ID_PREFIX = 'shared:';

/** A format someone published, plus its board metadata. */
export interface PublishedFormat extends Format {
  source: 'published';
  /** Host-minted shared-storage key — the handle for vote/unvote/report. */
  sharedKey: string;
  /** Live vote total. */
  votes: number;
  /** Whether THIS viewer already up-voted it (hydrated, never guessed). */
  viewerVoted: boolean;
  /** Contributing viewer's id — lets the UI mark "yours". */
  authorUserId: number;
}

/**
 * Build the `useSharedStorage().append()` / `.update()` value for a format.
 *
 * 🔴 THE SUFFIX GOES IN `body`, NEVER IN `data`. `title` and `body` are the
 * MODERATED, user-visible text; `data` is UNMODERATED opaque app state. This
 * suffix is prompt text that will be injected into OTHER viewers' PAID
 * generations inside a contentRating:"g" app — it has to pass the content belt.
 * `data` carries only the non-text structure (a schema version), which is
 * exactly what an unmoderated channel is for.
 *
 * This function MAPS; it does not gate. The publish path calls
 * {@link validateCustomFormat} first — publishing is a WRITE, so the `#` rule
 * applies to it exactly as it applies to a save, and for a sharper reason: a
 * published suffix is spent by people who never typed it.
 */
export function sharedValueForFormat(fmt: { label: string; suffix: string }): {
  title: string;
  body: string;
  data: { v: 1 };
} {
  return {
    title: fmt.label.trim().slice(0, LABEL_MAX),
    body: fmt.suffix.trim().slice(0, SUFFIX_MAX),
    data: { v: 1 },
  };
}

/**
 * Minimal structural shape of a `useSharedStorage().list()` item — declared
 * locally rather than imported so this module stays pure TS with no SDK types
 * to satisfy in tests.
 */
export interface SharedItemLike {
  key: string;
  authorUserId: number;
  value: { title?: unknown; body?: unknown; data?: unknown };
  count: number;
  viewerVoted?: boolean;
}

/**
 * Turn one shared-board item into a PublishedFormat, or `null` when it cannot
 * be used as a format.
 *
 * 🔴 The suffix is read from `body` ONLY. An entry whose `body` is missing or
 * blank is REJECTED rather than falling back to `data` — a fallback would make
 * the unmoderated channel a usable path for prompt text, quietly undoing the
 * reason the suffix lives in `body` at all. `data` is never read for text here.
 */
export function formatFromSharedItem(item: SharedItemLike): PublishedFormat | null {
  const title = typeof item.value?.title === 'string' ? item.value.title.trim() : '';
  const body = typeof item.value?.body === 'string' ? item.value.body.trim() : '';
  if (title === '' || body === '') return null;
  return {
    id: `${PUBLISHED_ID_PREFIX}${item.key}`,
    label: title.slice(0, LABEL_MAX),
    suffix: body.slice(0, SUFFIX_MAX),
    source: 'published',
    sharedKey: item.key,
    votes: Number.isFinite(item.count) ? item.count : 0,
    viewerVoted: item.viewerVoted === true,
    authorUserId: item.authorUserId,
  };
}

/** Map a whole shared-board page, dropping entries that aren't usable formats. */
export function formatsFromSharedItems(items: readonly SharedItemLike[]): PublishedFormat[] {
  const out: PublishedFormat[] = [];
  for (const item of items) {
    const f = formatFromSharedItem(item);
    if (f) out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The picker's full catalogue.
// ---------------------------------------------------------------------------

/**
 * Everything the viewer can select right now: built-ins, then their own custom
 * formats, then any published formats they have pulled in. Order is stable and
 * tier-grouped so the picker never reshuffles under a re-render.
 */
export function allFormats(
  custom: readonly CustomFormat[],
  published: readonly PublishedFormat[] = [],
): Format[] {
  return [...BUILTIN_FORMATS, ...custom.map(customToFormat), ...published];
}
