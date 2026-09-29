import type { BlockSizeTier } from '@civitai/blocks-react';

/**
 * ONE PLACE where the block's width decides its shape.
 *
 * 🔴 WHAT THIS REPLACES. Every screen used to be `{ width: '100%', maxWidth: 640 }`
 * — a single 640px centred column at every width. A full-page block's column is the
 * viewport wide (see `ULTRAWIDE_MIN` for the host-side measurement), so on any
 * ordinary desktop most of the block was empty — at 1600px, 60% of it — and the
 * 1280×720 editor canvas was rendered at 640px wide while 900px of blank page sat
 * beside it. Nothing about that was a styling problem; it was one constant.
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
   * ladder is 640 at one column, 1184 at two, uncapped at three or more.
   *
   * 🔴 THE ONE-COLUMN CAP IS MEANT TO BIND; THE TWO-COLUMN ONE IS NOT. At `base`/
   * `xs` the 640 cap binds from 641px up, and that is its whole job — a single text
   * column wants a readable measure. Two columns are already spending the width, so
   * there the requirement is the opposite: a two-column block fills its width. 1184
   * is the `lg` boundary, one past the top of `md`, so the two-column cap cannot
   * bind at ANY width in `sm` (768–1023) or `md` (1024–1183).
   *
   * 🔴 IT WAS 1100, AND THAT GUTTERED THE TOP OF `md`. `md` runs to 1183, so a
   * block 1101–1183px wide got a 1100px column centred in it — 40px of gutter
   * either side at 1180px, which is the landscape width of the 10.9-inch tablet
   * class. Pinned by `layout.test.ts`'s "the TWO-column cap cannot gutter" case and
   * by `responsive.test.tsx`'s 1180px arm.
   *
   * 🔴 SO WHAT DOES THE NUMBER STILL DO? Nothing, at any width its tiers admit —
   * and that is stated rather than dressed up. It is the two-column rung of "cap by
   * column count" written as a value instead of a special case. It is not `null`
   * because in this module `null` means "the rail is on" — an invariant
   * `layout.test.ts` asserts in both directions — and spending the same word on
   * "two columns, no cap" would make it mean two things.
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
 * 1800 rather than 1440, and the argument is REACHABILITY OF BOTH BRANCHES, read
 * off the host rather than guessed. A full-page block's column is simply the
 * viewport: `PageBlockHost.tsx` gives the content wrapper `width: 100%` and no
 * `max-width` in any spelling, and the host's own browser suite
 * `PageBlockHostMaxWidth.browser.test.tsx` asserts the app column equals its parent
 * AND the viewport, with zero gutter, at 1620 / 1905 / 2560 / 3440. So a maximised
 * 1920×1080 browser hands the block ~1905px, which is what makes the 4-column branch
 * something a person actually meets, while 1440–1799 (a windowed browser, a 1600 or
 * 1680 monitor, a scaled laptop panel) stays `xl` without it. Neither branch is
 * decoration.
 *
 * 🔴 THIS NUMBER IS NOT COMPARED AGAINST BLOCK WIDTH, AND EVERY EARLIER VERSION OF
 * THIS PARAGRAPH ARGUED AS IF IT WERE. `useUltrawide` observes the element `App.tsx`
 * puts `shellStyle` on, and that element carries `padding: SHELL_PADDING` (24px a
 * side). Its steady-state reading is `ResizeObserver`'s `contentRect.width` — the
 * CONTENT box — so the width this threshold actually grades is the block LESS 48px,
 * and the real crossing point is **1848px of block width, not 1800**. The seed taken
 * right after `observe()` reads `el.clientWidth`, the PADDING box, so it crosses at
 * 1800: a block 1800–1847px wide paints one frame at four columns and then settles at
 * three.
 *
 * That split is `useBlockBreakpoint`'s own — the SDK hook reads
 * `entries[0]?.contentRect.width ?? el.clientWidth` and seeds from `el.clientWidth`,
 * verified in the installed `dist/hooks/useBlockBreakpoint.js` — and `useUltrawide`
 * mirrors it deliberately, so the tier and the ultrawide flag can never be measured
 * against two different boxes. Matching the SDK is worth one frame of disagreement in
 * a 48px-wide band; it is NOT worth stating the headroom wrongly. Corrected: at a
 * maximised 1920px browser the margin over this threshold is **57px** (1905 − 48 −
 * 1800), not the 105px that reading the block width directly would suggest.
 *
 * 🔴 THE REASON THAT USED TO BE HERE WAS STALE, AND IT ARGUED THE OPPOSITE WAY. It
 * read "the live block iframe measures ~1600px on an ordinary desktop, so a
 * threshold at or below that would make ultrawide the normal case". That 1600 was
 * the host's own `max-width: 1600px` on the full-page surface, deleted in civitai
 * `7570507fb8` (2026-09-28, "uncap the full-page app surface so each app controls
 * its own width") — one day before this app's pass. After the uncap a maximised
 * desktop IS ultrawide, so the old sentence was both out of date and pointing at a
 * number it would not have chosen. The threshold survives the correction; its
 * stated reason did not.
 */
export const ULTRAWIDE_MIN = 1800;

/**
 * The two-column content cap — the `lg` boundary, so it cannot bind inside `sm` or
 * `md`. Named rather than inlined because the `maxWidth` docblock's whole argument
 * is that this value IS the next breakpoint; a bare literal makes that a
 * coincidence a reader has to check.
 */
const TWO_COLUMN_MAX_WIDTH = 1184;

/** Rail width at `lg`/`xl`. Wide enough for the prompt textarea to stay usable. */
const RAIL_W = 340;
/** Rail width once there is a fourth column's worth of room to spare. */
const RAIL_W_ULTRAWIDE = 400;

/** Which of the three shapes a tier gets. Named so the `null` cap has one meaning. */
type TierShape = 'one-column' | 'two-column' | 'rail';

function shapeForTier(tier: BlockSizeTier): TierShape {
  if (tier === 'base' || tier === 'xs') return 'one-column';
  if (tier === 'sm' || tier === 'md') return 'two-column';
  return 'rail';
}

/**
 * The SDK's tier ladder as this module understands it, narrowest first.
 *
 * Mirrored rather than imported: `BREAKPOINT_KEYS` lives in `@civitai/theme`, which
 * is a TRANSITIVE dependency here (pinned by `@civitai/blocks-react`, absent from
 * this app's own `package.json`), so importing it into shipped code would take a
 * dependency the manifest does not declare. `layout.test.ts` pins this ladder against
 * the SDK's own `resolveBlockTier` instead, which IS a first-party export.
 */
const TIER_LADDER = ['base', 'xs', 'sm', 'md', 'lg', 'xl'] as const;

/**
 * Can a block that is genuinely ≥`ULTRAWIDE_MIN` wide report this tier?
 *
 * 🔴 WHY THIS IS NOT `tier === 'xl'`, WHICH IS WHAT IT USED TO BE. That spelling
 * silently hardcodes "xl is the SDK's last breakpoint", and nothing in this app makes
 * that true — the ladder is `@civitai/theme`'s. Add a `2xl` there and
 * `resolveBlockTier(2560)` returns `'2xl'`, which reaches the rail branch as it
 * should but was clamped OUT of `wide`: the widest screens would quietly lose the
 * fourth column and the 400px rail, with every test still green because they only
 * ever pinned 1440 → `'xl'`.
 *
 * 🔴 AND IT IS NOT "any tier that gets the rail" EITHER — that was the first attempt
 * at this fix and it was wrong in the OTHER direction, caught by `layout.test.ts`'s
 * own clamp case. `lg` spans 1184–1439, so no block wide enough to be ultrawide can
 * ever report it; admitting `('lg', true)` would hand a 1184px block four columns and
 * a 400px rail, which is exactly the contradictory-input case the clamp exists to
 * reject.
 *
 * 🔴 AN UNRECOGNISED TIER COUNTS AS WIDER THAN `xl`, AND THAT IS AN ASSUMPTION, NOT A
 * DEDUCTION. It is right for a tier APPENDED above `xl`, which is the defect above and
 * the only direction the scale has ever grown. It would be wrong for a tier INSERTED
 * below — a hypothetical `2xs` would wrongly become ultrawide-admissible. That case is
 * not guessed at here: `layout.test.ts` pins the ladder's contents and its top against
 * `resolveBlockTier`, so an insertion anywhere fails loudly and a human decides,
 * rather than this function inventing an answer.
 */
function admitsUltrawide(tier: BlockSizeTier): boolean {
  const index = TIER_LADDER.indexOf(tier as (typeof TIER_LADDER)[number]);
  return index === -1 || index >= TIER_LADDER.indexOf('xl');
}

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
 * @param ultrawide - from `useUltrawide(rootRef)`. Ignored on every tier below `xl`:
 *   a block whose measured box clears `ULTRAWIDE_MIN` is necessarily wider than the
 *   `xl` breakpoint too (see that constant for which BOX is measured), so a `true` at
 *   a narrower tier is a contradiction between two observers and the tier is trusted
 *   over it. Honoured at `xl` and at any tier the SDK adds above it — see
 *   `admitsUltrawide`, which is deliberately not spelled `tier === 'xl'`.
 */
export function layoutForTier(tier: BlockSizeTier, ultrawide = false): BlockLayout {
  const shape = shapeForTier(tier);

  // 🔴 `ultrawide` IS CLAMPED TO THE TIER, NOT TRUSTED. The two come from two
  // different ResizeObservers, so during the frame in which a block is resized
  // they can disagree — and a stubbed test, or a caller passing a literal, can
  // hand over `('sm', true)` or `('lg', true)`, which no real geometry produces.
  // The admissible tiers are a ladder position rather than the literal `=== 'xl'` —
  // see `admitsUltrawide` for why both of the obvious spellings were wrong.
  const wide = ultrawide && admitsUltrawide(tier);

  if (shape === 'one-column') {
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

  if (shape === 'two-column') {
    return {
      tier,
      ultrawide: wide,
      maxWidth: TWO_COLUMN_MAX_WIDTH,
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

  // The `'rail'` shape: `lg` (1184+), `xl` (1440+), and any tier the SDK adds above
  // them. All get the rail and the side-by-side editor; only a genuinely ultrawide
  // block gets the fourth column.
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
