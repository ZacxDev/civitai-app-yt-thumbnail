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

import type { BlockLayout } from './layout.js';
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
 * The responsive image grid, shared by the results surface and every history row.
 *
 * 🔴 IT USED TO BE `repeat(2, …)` AT EVERY WIDTH, with a comment claiming two
 * columns "keep each preview readable at the block's usual width". That was two
 * ~170px thumbnails on a phone and two ~300px ones inside a 640px column on a
 * 1600px block. The count is now `layoutForTier`'s, so generating four candidates
 * produces four comparable ones — and the history rows use the SAME function
 * rather than a second column rule that could drift from it.
 */
export function galleryStyle(layout: BlockLayout): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${layout.resultColumns}, minmax(0, 1fr))`,
    gap: 10,
  };
}

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
