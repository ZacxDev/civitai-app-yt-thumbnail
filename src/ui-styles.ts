// The handful of inline-style helpers that MORE THAN ONE component file paints
// with. Everything else stays private to the file that uses it.
//
// 🔴 WHY THIS FILE EXISTS AT ALL, rather than these living in App.tsx: the history
// surface moved into its own component file (`History.tsx`) and it draws the SAME
// field chrome, the SAME image tile and the SAME responsive gallery grid as the
// generation surface. A copy in each file is two definitions of one visual rule,
// and `theme-guard.test.tsx` has already caught that shape once — the off-palette
// literal it found was a second copy of a border that was correct elsewhere.
//
// 🔴 NO COLOUR LITERAL MAY APPEAR HERE. Guard A in `theme-guard.test.tsx` derives
// its file set from this directory, so this module is scanned the moment it exists:
// every colour comes off the `Palette` it is handed. `withAlpha` deliberately did
// NOT move — it is App.tsx's named exemption in that guard, and the styles below
// do not need it.

import type { Palette } from './palette.js';

// Field chrome. The Model + LoRA controls match the pack's own input surface
// because both sit on the same app palette, not because they share a CSS var.
export const fieldStyle: React.CSSProperties = { display: 'grid', gap: 4 };
export const fieldLabelStyle: React.CSSProperties = { fontSize: 14, fontWeight: 600 };
export function fieldDescStyle(pal: Palette): React.CSSProperties {
  // 🔴 NO `opacity` HERE EITHER. It used to be `text-dimmed` at `opacity: 0.8`,
  // i.e. a contrast ratio nothing could assert. `textDim` is a real token: 7.84:1
  // on `page` dark, 6.62:1 light.
  return { fontSize: 12, color: pal.textDim };
}

/**
 * The narrowest a thumbnail tile may get before the grid drops a column — down to
 * the point where the CONTAINER is narrower than this, where the container wins.
 *
 * 300px of 16:9 is a 300×169 tile — small, but a 1280×720 thumbnail is still
 * JUDGEABLE at that size, which is the whole job of this surface. It is the same
 * shape of number as `layout.formatMinCardPx`, and deliberately a single constant
 * rather than a per-tier one: see {@link imageGridStyle}, which also explains why it
 * is a CLAMPED floor rather than an absolute one (a 360px phone has ~292px of
 * content width, so an absolute 300px floor overflowed).
 */
export const IMAGE_MIN_PX = 300;

/**
 * The thumbnail grid, shared by every history row's images AND its skeletons.
 *
 * 🔴 IT IS INTRINSICALLY SIZED — `auto-fill` + a `minmax` FLOOR — AND THAT IS A
 * BUG FIX, NOT A STYLE PREFERENCE. It used to be
 * `repeat(layout.resultColumns, minmax(0, 1fr))`, i.e. a COUNT from the tier
 * ladder (1 / 2 / 3 / 4), and `History.tsx` applied that same count at TWO NESTED
 * LEVELS: the batch ROWS were a grid of `resultColumns` columns and the images
 * INSIDE each row were another. The counts therefore MULTIPLIED. At `lg` that is
 * 3 × 3 = each thumbnail one NINTH of the main column; on an ultrawide block
 * 4 × 4 = one SIXTEENTH, which on a 1920px screen is an ~85px-wide 16:9 tile —
 * a thumbnail too small to tell two generations apart, produced by a layout rule
 * that was individually correct at both levels.
 *
 * Two changes close it and the second is what makes it stay closed:
 *
 *  1. the rows are FULL WIDTH now (see `historyRowsStyle`), so nothing nests;
 *  2. the column count is no longer a number anyone chose. `auto-fill` fits as
 *     many columns as the container actually has room for, so there is NO tier
 *     arithmetic left to get wrong — including at a tier the SDK adds above `xl`
 *     tomorrow. A count can be wrong at a width nobody tested.
 *
 * 🔴 AND THE FLOOR IS CLAMPED BY `min(…, 100%)`, WHICH IS NOT COSMETIC — WITHOUT IT
 * THE NARROWEST TIER OVERFLOWS. The previous version of this comment claimed there
 * was "no width at which this can produce a tile narrower than the floor" and offered
 * the 640 / 1184 / 1580 arithmetic as evidence. Every one of those numbers is at the
 * WIDE end, and the claim was true in the wrong direction: a bare `minmax(300px, 1fr)`
 * is a HARD lower bound, so `auto-fill` drops to a single column and then STOPS, and a
 * container narrower than 300px gets a 300px track and a horizontal overflow. The
 * available width here is the block's width minus two `SHELL_PADDING`s (24 each,
 * `App.tsx`) and two `panelRowStyle` insets (10 each, below) — blockWidth − 68 — so a
 * 360px phone has ~292px and the test suite's own 361px base-tier fixture has 293px,
 * both under the floor. `min(IMAGE_MIN_PX, 100%)` makes 300px the floor only while the
 * container can afford it and lets the single column fall back to the container width
 * below that, which is the standard spelling of this rule.
 *
 * Measured against the `minmax` arithmetic (`gap: 10`): a 640px column fits 2
 * columns, 1184px fits 3, ~1580px fits 5; the clamp changes none of those, because
 * `100%` only binds when it is the smaller of the two. jsdom lays nothing out, so the
 * tests assert this STRING and NOTHING has measured the rendered result at 293px —
 * see the PR body.
 */
export function imageGridStyle(): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(min(${IMAGE_MIN_PX}px, 100%), 1fr))`,
    gap: 10,
  };
}

/**
 * The container for the history ROWS: one batch per line, at every width.
 *
 * 🔴 IT WAS A `resultColumns`-WIDE GRID AND THAT IS HALF THE BUG `imageGridStyle`
 * describes — the outer count multiplied the inner one. A batch is a wide object
 * (a timestamp, a price, a format list, and up to `quantity × formats` pictures),
 * so it wants the whole width even on an ultrawide block; packing three of them
 * side by side is what squeezed the pictures into a ninth of the column.
 */
export const historyRowsStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: 12,
};

/**
 * Visually hidden, still in the accessibility tree.
 *
 * For text that must be READ but not SHOWN: the history row's cost says "836"
 * beside a bolt glyph, and a screen reader reading a bare number off a surface
 * about money is the failure this closes. The bolt is `aria-hidden`; this carries
 * the unit and the Buzz pool.
 *
 * The usual clip-rect recipe rather than `display: none` or `visibility: hidden`,
 * both of which remove the node from the accessibility tree as well as the page.
 */
export const srOnlyStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  borderWidth: 0,
};

export const galleryItemStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
};

export const imageStyle: React.CSSProperties = {
  width: '100%',
  aspectRatio: '16 / 9',
  objectFit: 'cover',
  borderRadius: 8,
  display: 'block',
};

/**
 * A pending image tile: the same box an `imageStyle` image will occupy, so a batch
 * that is still running does not shift its own row's layout when the pictures
 * arrive. Animated via the `yt-skeleton` class in `index.css` — the keyframes
 * cannot be expressed as an inline style, and the class carries no colour.
 *
 * 🔴 THE TILE IS ONLY HALF OF "DOES NOT REFLOW" — the GRID has to match too, and
 * it does because `History.tsx` lays the images and the skeletons out with the
 * SAME `imageGridStyle()` call. That used to be two `galleryStyle(layout)` call
 * sites which could drift; there is now one function and no argument, so the two
 * grids cannot disagree about a column count that no longer exists.
 */
export function skeletonTileStyle(pal: Palette): React.CSSProperties {
  return {
    width: '100%',
    aspectRatio: '16 / 9',
    borderRadius: 8,
    border: `1px solid ${pal.border}`,
    background: pal.surfaceRaised,
  };
}

// A bordered sub-panel: one LoRA's controls, and one history row.
export function panelRowStyle(pal: Palette): React.CSSProperties {
  return {
    display: 'grid',
    gap: 6,
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${pal.border}`,
    background: pal.surface,
  };
}
