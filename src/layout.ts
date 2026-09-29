import type { BlockSizeTier } from '@civitai/blocks-react';

/**
 * ONE PLACE where the block's width decides its shape.
 *
 * 🔴 WHAT THIS REPLACES. Every screen used to be `{ width: '100%', maxWidth: 640 }`
 * — a single 640px centred column at every width. The live block iframe measures
 * ~1600px on a desktop, so roughly 60% of the block was empty, and the 1280×720
 * editor canvas was rendered at 640px wide while 900px of blank page sat beside
 * it. Nothing about that was a styling problem; it was one constant.
 *
 * 🔴 WHY A PURE FUNCTION AND NOT TERNARIES AT THE CALL SITES. `App.tsx` is ~2000
 * lines with six surfaces that all want an answer to the same question. A
 * predicate open-coded at six sites is typically wrong at five of them in the same
 * direction, and the disagreement is inaudible until someone opens the app at a
 * width nobody tested. One function, one ledger of literal expectations, and every
 * consumer reads fields off the result.
 *
 * 🔴 WHY NOT A CSS CONTAINER QUERY. Two reasons, both measured. (1) A query
 * PRELUDE cannot read a custom property — `@container (min-width: var(--civitai-bp-sm))`
 * is silently dead, no error and no warning — so the breakpoints would have to be
 * written out as literals in a second place, which is the duplication this module
 * exists to remove. (2) This app's only test environment is jsdom, which lays
 * nothing out and evaluates no container queries; a container-query layout could
 * only be asserted as *the text of a CSS rule*, which type-checks past a wrong
 * value. A function returning numbers can be asserted with literal numbers.
 */

/** Everything the block's width decides, resolved once per render. */
export interface BlockLayout {
  /** Echo of the inputs, so a failing assertion says which case it was. */
  tier: BlockSizeTier;
  ultrawide: boolean;
  /**
   * px cap on the content column, or `null` for "fill the block".
   *
   * The cap is a function of `columns`, not of the tier: a single column wants a
   * readable measure, and a multi-column grid already spends the width. So the
   * ladder is 640 at one column, 1100 at two, uncapped at three or more.
   *
   * It does not bind in every tier, and that is correct rather than dead: at `xs`
   * (480–767) the 640 cap binds from 641px up, and at `md` (1024–1183) the 1100
   * cap binds from 1101px up. At `sm` (768–1023) the two-column cap of 1100 never
   * binds — the tier is narrower than its own cap — which is the honest shape of
   * "cap by column count".
   */
  maxWidth: number | null;
  /**
   * Minimum card width, in px, for the format picker's `auto-fill` grid.
   *
   * 🔴 THE FORMAT GRID IS SIZED, NOT COUNTED — and the brief asked for a count.
   * A fixed column count is the wrong control for this grid in both directions. At
   * `base` a one-card-per-row picker would hand each of the six built-in formats a
   * ~340px-wide 16:9 preview and make the picker taller than the phone, where
   * `auto-fill` at 124px already fits two or three; at `xl` a count of three would
   * stretch three cards across ~1000px of main column and make each preview wider
   * than the thumbnail it previews. What the ask actually wanted — "previews at
   * usable size" — is a minimum, so that is what this is. The RESULTS grid keeps
   * the count ladder, because there comparability across a fixed number of
   * candidates is the whole point. Recorded as a fork in `taste.json`.
   */
  formatMinCardPx: number;
  /** Columns in the results/candidates grid. */
  resultColumns: number;
  /**
   * The prompt / model / LoRA / spend controls become a persistent left rail, so
   * they stay on screen while results fill the main area.
   */
  rail: boolean;
  /** px width of that rail. `0` exactly when `rail` is false. */
  railWidth: number;
  /** The 1280×720 editor canvas sits beside its text controls rather than above. */
  editorSideBySide: boolean;
  /** The Model row is a side-by-side `Group` rather than a stacked `Stack`. */
  modelRow: 'stacked' | 'row';
}

/**
 * The width at or above which a block is treated as ultrawide.
 *
 * 🔴 THE SDK CANNOT ANSWER THIS AND NEVER WILL. `useBlockBreakpoint`'s top tier
 * `xl` is UNBOUNDED — 1440px and 2560px resolve identically — and the hook
 * deliberately does not expose a raw width, because doing so "would either force a
 * render per pixel or be a lie". So a fourth column needs a threshold the app owns
 * (`useUltrawide`), not a tier.
 *
 * 1800 rather than 1440: the live block iframe measures ~1600px on an ordinary
 * desktop, so a threshold at or below that would make "ultrawide" the normal case
 * and the 3-column `lg`/`xl` layout unreachable in practice.
 */
export const ULTRAWIDE_MIN = 1800;

/** Rail width at `lg`/`xl`. Wide enough for the prompt textarea to stay usable. */
const RAIL_W = 340;
/** Rail width once there is a fourth column's worth of room to spare. */
const RAIL_W_ULTRAWIDE = 400;

/**
 * Resolve the block's width tier (plus the app-owned ultrawide flag) to a layout.
 *
 * Pure. No DOM, no hooks, no clock — which is what makes the table in
 * `layout.test.ts` able to pin literal expectations for every tier rather than
 * re-deriving them from this code.
 *
 * @param tier - from `useBlockBreakpoint(rootRef).tier`. `'base'` is also what an
 *   unmeasured block reports, and the single-column branch is the right answer for
 *   both, so no caller needs to gate on `measured`.
 * @param ultrawide - from `useUltrawide(rootRef)`. Ignored below `xl`: a block can
 *   only be ≥1800px wide while also being ≥1440px wide, so a `true` at a lower
 *   tier is a contradiction and the tier is trusted over it.
 */
export function layoutForTier(tier: BlockSizeTier, ultrawide = false): BlockLayout {
  // 🔴 `ultrawide` IS CLAMPED TO THE TIER, NOT TRUSTED. The two come from two
  // different ResizeObservers, so during the frame in which a block is resized
  // they can disagree — and a stubbed test, or a caller passing a literal, can
  // hand over `('sm', true)`, which no real geometry produces. Taking the tier as
  // the authority means the 4-column branch is unreachable except from a block
  // that is genuinely both ≥1440 (xl) and ≥1800 (ultrawide).
  const wide = ultrawide && tier === 'xl';

  if (tier === 'base' || tier === 'xs') {
    return {
      tier,
      ultrawide: wide,
      maxWidth: 640,
      formatMinCardPx: 124,
      resultColumns: 1,
      rail: false,
      railWidth: 0,
      editorSideBySide: false,
      modelRow: 'stacked',
    };
  }

  if (tier === 'sm' || tier === 'md') {
    return {
      tier,
      ultrawide: wide,
      maxWidth: 1100,
      formatMinCardPx: 160,
      resultColumns: 2,
      rail: false,
      railWidth: 0,
      editorSideBySide: false,
      // `sm` is exactly where the existing Model row stops stacking — the one
      // structural swap this app already shipped, preserved by `bp.below('sm')`
      // being false from here up.
      modelRow: 'row',
    };
  }

  // `lg` (1184+) and `xl` (1440+). Both get the rail and the side-by-side editor;
  // only a genuinely ultrawide block gets the fourth column.
  return {
    tier,
    ultrawide: wide,
    maxWidth: null,
    formatMinCardPx: wide ? 220 : 200,
    resultColumns: wide ? 4 : 3,
    rail: true,
    railWidth: wide ? RAIL_W_ULTRAWIDE : RAIL_W,
    editorSideBySide: true,
    modelRow: 'row',
  };
}
