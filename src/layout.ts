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
   * The cap is a function of the SHAPE, not of the tier: a single column wants a
   * readable measure, and a three-column grid already spends the width. So the
   * ladder is 640 at one column, 1184 at two, uncapped at the rail.
   *
   * 🔴 THE ONE-COLUMN CAP IS MEANT TO BIND; THE TWO-COLUMN ONE BINDS AT `lg` ONLY.
   * At `base`/`xs` the 640 cap binds from 641px up, and that is its whole job — a
   * single text column wants a readable measure. For the TABLET tiers the requirement
   * is the opposite — "full width on a tablet" — and 1184 is one past the top of `md`
   * (1183), so the cap cannot bind at ANY width in `sm` (768–1023) or `md`
   * (1024–1183). It DOES bind at `lg` (1184–1439), which joined the two-column shape
   * when the rail moved to `xl`: see `TWO_COLUMN_MAX_WIDTH` for the tile arithmetic
   * that makes that the right answer rather than a regression. Both halves are pinned
   * by `layout.test.ts` — the tablet case and the `lg` case are two separate tests
   * because they are two opposite claims.
   *
   * 🔴 IT WAS 1100, AND THAT GUTTERED THE TOP OF `md`. `md` runs to 1183, so a
   * block 1101–1183px wide got a 1100px column centred in it — 40px of gutter
   * either side at 1180px, which is the landscape width of the 10.9-inch tablet
   * class. Pinned by `layout.test.ts`'s tablet-gutter case and by
   * `responsive.test.tsx`'s 1180px arm.
   *
   * It is not `null` at two columns because in this module `null` means "the rail is
   * on" — an invariant `layout.test.ts` asserts in both directions — and spending the
   * same word on "two columns, no cap" would make it mean two things.
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
   * usable size" — is a minimum, so that is what this is. Recorded as a fork in
   * `taste.json`.
   *
   * 🔴 THE CLAUSE THAT USED TO SIT HERE — "the RESULTS grid keeps the count ladder,
   * because there comparability across a fixed number of candidates is the whole
   * point" — IS GONE WITH `resultColumns`, AND THE RESULTS GRID PROVED IT WRONG.
   * `History.tsx` applied that count at TWO NESTED levels (a grid of batch rows, and
   * a grid of images inside each row), so the counts MULTIPLIED: 3 × 3 at `lg` made
   * each thumbnail a ninth of the main column and 4 × 4 on an ultrawide block made it
   * a sixteenth — an ~85px 16:9 tile on a 1920px screen. The thumbnail grid is now
   * `auto-fill` + a px floor like this one, except that ITS floor is clamped by
   * `min(…, 100%)` because at 300px it exceeds the content width of the narrowest tier
   * (this field's narrowest value, 124px, does not), and it owns its own constant
   * (`IMAGE_MIN_PX` in `ui-styles.ts`) rather than a per-tier number. Nothing in the
   * app lays out from a column COUNT any more, which is why the field is gone rather
   * than merely unused.
   */
  formatMinCardPx: number;
  /**
   * The prompt / model / LoRA / spend controls become a persistent left rail, so
   * they stay on screen while results fill the main area.
   */
  rail: boolean;
  /** px width of that rail. `0` exactly when `rail` is false. */
  railWidth: number;
  /**
   * px floor on the hero's height, so the banner image behind the headline has
   * room to read as a picture rather than a stripe.
   *
   * 🔴 IT IS HERE RATHER THAN OPEN-CODED IN `App.tsx` FOR THE REASON THIS WHOLE
   * MODULE EXISTS. `heroStyle` already asks the layout one width question
   * (`layout.rail ? '22px 28px' : '18px 20px'`), and a second ternary on the same
   * predicate at the same call site is the first copy of a predicate — the shape
   * the module docblock above says is wrong at N−1 sites. Keyed off `rail` and
   * nothing else, so the hero's padding and its height can never disagree about
   * which shape the block is in; `layout.test.ts` asserts exactly that, in both
   * directions, over the whole tier ladder.
   *
   * The values are 132 / 104 and they are a judgement, not a measurement: jsdom
   * lays nothing out, so nothing in this repo can observe the crop. What IS
   * derivable is that 104 clears the two-line text stack the hero draws (26px +
   * 13px of type, 1.15 line-height, plus 36px of vertical padding ≈ 81px), so the
   * floor binds rather than being absorbed by the text — which is the property
   * that makes the image visible at all.
   */
  heroMinHeight: number;
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
 * px width of the FORMATS rail — the third column at the `rail` tier, holding the
 * format picker beside the thumbnail grid instead of stacked under it.
 *
 * 🔴 IT IS A FIXED px TRACK AND IT MAY NEVER BECOME A FRACTION. This is the whole
 * reason the number is named here rather than written into `railGridStyle`, and the
 * argument is the thumbnail grid's own arithmetic, not a preference.
 *
 * `imageGridStyle()` in `ui-styles.ts` is `repeat(auto-fill, minmax(min(300px, 100%),
 * 1fr))` at `gap: 10`, so the number of thumbnails on a row is a STEP FUNCTION of the
 * container: n tiles need `n * 300 + (n - 1) * 10` px. Worked at `xl` (a 1440px
 * block), where the available content width is 1440 − 2×`SHELL_PADDING` = 1392 and the
 * images grid sits inside one `panelRowStyle` inset (10 a side, so −20 more):
 *
 *  - FIXED, as shipped: 1392 − 340 (inputs rail) − 320 (this) − 2×20 (grid gaps) = 692
 *    of main, 672 inside the inset → 2 tiles (610 fits, 920 does not).
 *  - FRACTIONAL (`minmax(0, 1fr) minmax(0, 1fr)`, a 50/50 split of main): main is
 *    1392 − 340 − 20 = 1032, halved across a 20px gap = 506 each, 486 inside the
 *    inset → ONE tile. The thumbnail grid loses half its row to a surface that cannot
 *    use the width.
 *  - For the record, because this change is not free: stacking the picker UNDER the
 *    grid (what shipped before) left 1012 inside the inset → 3 tiles. So the fixed
 *    rail costs the grid one tile at 1440 and a fractional one would cost two.
 *
 * 🔴 AND THE ASYMMETRY IS THE POINT: the formats column's appetite is BOUNDED, the
 * thumbnail grid's is not. The picker is itself an `auto-fill` grid with a 200px card
 * floor (`formatMinCardPx` at this tier) and `gap: 8`, so a SECOND card column needs
 * 2×200 + 8 + 34 of rail chrome (16+16 padding, 1+1 border) = 442px — outside any
 * width this constant is allowed to take. Every px past one card column buys the
 * picker nothing, while the grid converts px into tiles forever. A fraction hands half
 * of every pixel the block gains to the surface that cannot spend it; a fixed track
 * hands all of it to the one that can. The thumbnail grid is this app's primary
 * object, and `ui-styles.ts` records what happens when its width arithmetic is got
 * wrong — a per-tier column count applied at two nested levels multiplied into ~85px
 * tiles on a 1920px screen.
 *
 * 🔴 WHY 320 AND NOT THE TOP OF THE 320–360 BAND THE OPERATOR SET. The low end, for
 * the reason above: 234px (200 + 34 of chrome) already fits one card at its floor, so
 * 320 renders it at 286px — 43% over the floor — and every px above 320 is taken from
 * the thumbnail grid for no gain. It is also deliberately DISTINCT from `RAIL_W` (340)
 * and `RAIL_W_ULTRAWIDE` (400): a mutant that swaps the two rails' widths has to be
 * visible, and `layout.test.ts` pins that no fixture width equals it either.
 *
 * ONE value at every `rail` tier, unlike `railWidth`, which widens at ultrawide. The
 * inputs rail widens because the prompt textarea genuinely reads better wider; this
 * one would just be a wider single card column, so it stays put and the extra width
 * goes to the grid. jsdom lays nothing out, so every number above is arithmetic over
 * the emitted CSS — nothing in this repo has measured a rendered tile.
 */
export const FORMATS_RAIL_WIDTH = 320;

/**
 * The content cap for every tier between `sm` and `lg` inclusive — the tiers that get
 * the one-column tabbed layout with a readable measure rather than the three-column
 * rail.
 *
 * 🔴 IT USED TO BE INERT AND IT IS NOW LIVE, DELIBERATELY. While `md` was the widest
 * capped tier this number was the NEXT breakpoint (1184 = the `lg` floor), so it could
 * never bind: `md` tops out at 1183px of block, i.e. 1135px of content after two
 * `SHELL_PADDING`s. `lg` joining the capped tiers makes 1184 that tier's FLOOR instead,
 * so from a 1233px block up the content column is centred inside gutters. That is the
 * decision, and the argument is the thumbnail grid's step function, not a measure
 * preference:
 *
 *   - CAPPED at 1184, every width in `lg` renders a 1164px grid container (1184 less one
 *     `panelRowStyle` inset) → 3 tiles, flat across 1184–1439. The step into the rail at
 *     1440 costs ONE tile (672px of main → 2).
 *   - UNCAPPED, a 1439px block renders a 1371px container → 4 tiles, and the SAME step
 *     into the rail at 1440 costs TWO. That is the defect this round exists to fix,
 *     relocated from 1183→1184 to 1439→1440 rather than removed.
 *
 * So the cap is what makes the one discontinuity this layout still has a one-tile step
 * instead of a two-tile cliff. `layout.test.ts` pins both halves: that the cap does NOT
 * gutter at `sm`/`md` (where "full width on a tablet" is the requirement), and that it
 * DOES bind inside `lg` with the tile count that justifies it.
 */
const TWO_COLUMN_MAX_WIDTH = 1184;

/**
 * The hero's height floor, in px, at the two shapes its padding already
 * distinguishes. Named rather than inlined for the same reason `TWO_COLUMN_MAX_WIDTH`
 * is: `heroMinHeight`'s docblock argues about these two numbers, and a bare literal
 * in the return would make the pairing something a reader has to re-derive.
 */
const HERO_MIN_H_RAIL = 132;
/** The hero's height floor below the rail — a phone, or the `model.sidebar_top` slot. */
const HERO_MIN_H_NARROW = 104;

/** Rail width at `xl`. Wide enough for the prompt textarea to stay usable. */
const RAIL_W = 340;
/** Rail width once there is a fourth column's worth of room to spare. */
const RAIL_W_ULTRAWIDE = 400;

/** Which of the three shapes a tier gets. Named so the `null` cap has one meaning. */
type TierShape = 'one-column' | 'two-column' | 'rail';

/**
 * 🔴 `lg` IS A TWO-COLUMN TIER, NOT A RAIL TIER, AND THAT IS THE OPERATOR'S DECISION
 * AFTER MEASUREMENT. It had the rail for one revision and the cost was counted in
 * thumbnails: at `lg` the three-column grid leaves 416px inside the history row's inset,
 * which is ONE tile, where the tabbed layout one pixel below (1183px) renders three and
 * the two-column rail that shipped before rendered two. Crossing 1183 → 1184 therefore
 * LOST TWO TILES on an ordinary 1280×800 laptop — the app's primary object halved by
 * getting wider. The rail needs 340 + 320 of fixed track plus two 20px gaps before the
 * grid sees a pixel, and `lg` does not have that much to spare; `xl` does.
 *
 * The `return 'rail'` is a FALLTHROUGH, and it carries the same assumption
 * `admitsUltrawide` documents at length: an unrecognised tier counts as wider than
 * `xl`. Right for a tier APPENDED above `xl` (the only direction this scale has
 * grown), wrong for one INSERTED below — a hypothetical `2xs` would get the rail.
 * Not guessed at here either: `layout.test.ts` pins the ladder's contents and its
 * top against `resolveBlockTier`, so an insertion fails loudly and a human decides.
 */
function shapeForTier(tier: BlockSizeTier): TierShape {
  if (tier === 'base' || tier === 'xs') return 'one-column';
  if (tier === 'sm' || tier === 'md' || tier === 'lg') return 'two-column';
  return 'rail';
}

/**
 * The SDK's tier ladder as this module understands it, narrowest first.
 *
 * NOT a copy of `BREAKPOINT_KEYS` — it is `BREAKPOINT_KEYS` PLUS `'base'`, which is
 * six entries against the SDK's five (`xs`, `sm`, `md`, `lg`, `xl`). Saying it
 * "mirrors" the keys elided that, and the extra entry is not cosmetic: `'base'` is
 * what an unmeasured block reports, it is the bottom of `shapeForTier`'s
 * one-column branch, and its index is what makes `admitsUltrawide`'s comparison
 * against `'xl'` land where it does.
 *
 * Written out rather than imported: `@civitai/theme` is a TRANSITIVE dependency here
 * (pinned by `@civitai/blocks-react`, absent from this app's own `package.json`), so
 * importing it into shipped code would take a dependency the manifest does not
 * declare. `layout.test.ts` pins this ladder against the SDK's own `resolveBlockTier`
 * instead, which IS a first-party export.
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
 * own clamp case. Since `lg` left the rail shape that spelling would no longer admit
 * `lg`, so it would pass the clamp case today and remain wrong for the same reason: it
 * ties an ULTRAWIDE question to a SHAPE question, and the two are independent. The
 * clamp's job is to reject a contradiction between two observers — `lg` spans 1184–1439,
 * so no block wide enough to be ultrawide can ever report it, and `('lg', true)` is a
 * disagreement to be resolved in the tier's favour, whatever shape `lg` happens to get.
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
      rail: false,
      railWidth: 0,
      heroMinHeight: HERO_MIN_H_NARROW,
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
      rail: false,
      railWidth: 0,
      heroMinHeight: HERO_MIN_H_NARROW,
      editorSideBySide: false,
      // `sm` is exactly where the existing Model row stops stacking — the one
      // structural swap this app already shipped, preserved by `bp.below('sm')`
      // being false from here up.
      modelRow: 'row',
    };
  }

  // The `'rail'` shape: `xl` (1440+) and any tier the SDK adds above it. `lg` used to be
  // here and was moved out — see `shapeForTier` for the tile count that decided it. All
  // get the rail and the side-by-side editor; only a genuinely ultrawide block gets the
  // fourth column.
  return {
    tier,
    ultrawide: wide,
    maxWidth: null,
    formatMinCardPx: wide ? 220 : 200,
    rail: true,
    railWidth: wide ? RAIL_W_ULTRAWIDE : RAIL_W,
    heroMinHeight: HERO_MIN_H_RAIL,
    editorSideBySide: true,
    modelRow: 'row',
  };
}
