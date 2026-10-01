// Every glyph the app draws itself.
//
// 🔴 HAND-ROLLED INLINE SVG BECAUSE THERE IS NO ALTERNATIVE, NOT BY PREFERENCE.
// `@civitai/blocks-react/ui` exports exactly `Alert Badge Button Card Collapse
// Group Loader NumberInput ResourceCard SegmentedControl Select Slider Stack
// Textarea TextInput` — there is NO `ActionIcon`, NO icon set and NO `Tooltip` —
// `@tabler/icons-react` is not a dependency of this app, and `@civitai/buzz` is
// `private: true`. So an icon button is a `Button` with an `<svg>` child, its hover
// affordance is the native `title` attribute and its accessible name is
// `aria-label`; an icon-only control carrying neither is a button nobody on a
// screen reader can identify.
//
// 🔴 `currentColor` EVERYWHERE EXCEPT `BuzzBolt`. The icons inherit their button's
// own text colour, which the W6 pack sets from `data-theme`, so they flip with the
// theme for free and `theme-guard.test.tsx`'s Guard A (no colour literal anywhere
// under `src/` outside its four exempt files) has nothing to find here. `BuzzBolt`
// is the one exception and it does not break the rule either: its colour is a fact
// about the DATA (which Buzz pool paid) and it comes from `BUZZ_TYPE_COLOR`, which
// lives in `palette.ts`.
//
// 🔴 WHY THIS FILE EXISTS. `BuzzBolt` was defined inside `App.tsx` and the history
// row needed the same glyph with the same per-pool colour. A second copy of one
// 24×24 path plus a second pool→colour lookup is exactly the shape this repo's
// audits keep finding — two renderings of one visual rule that drift. One
// component, two call sites.

import { type AccountChoice } from './generation.js';
import { BUZZ_TYPE_COLOR, type Palette } from './palette.js';

/** Icons are never squeezed by a flex parent and never inherit a line box. */
const iconStyle: React.CSSProperties = { flex: 'none', display: 'block' };

/**
 * The Buzz bolt.
 *
 * 🔴 ONE GLYPH FOR ALL THREE POOLS, COLOURED PER POOL — which is exactly what the
 * native generator does. `FormFooter.tsx`'s `BuzzTypeSelector` renders tabler's
 * generic `IconBolt` for every type and varies only the colour; there is no
 * per-type Buzz icon to import. The colour comes from `BUZZ_TYPE_COLOR` (see
 * `palette.ts` for its provenance as a verbatim mirror of the site's own
 * currency theme).
 *
 * `auto` is not a Buzz type at all — it is the ABSENCE of a preference — so it gets
 * the palette's own `textDim` rather than borrowing a pool's colour. The history
 * row reuses that arm for "the pool is not known": a record written before the
 * field existed, a batch still running, and a batch funded from two different
 * pools all pass `'auto'`, because none of them is a different pool and a guessed
 * colour would be a false statement about where the viewer's money came from.
 *
 * DECORATIVE: `aria-hidden` + `focusable="false"`. Every place it renders it sits
 * beside text naming the same pool, so nothing here is carried by colour alone
 * (WCAG 1.4.1) — see `palette.ts`'s note on why these hexes never carry text.
 */
export function BuzzBolt({
  choice,
  pal,
  testId,
  size = 14,
}: {
  choice: AccountChoice;
  pal: Palette;
  testId: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={choice === 'auto' ? pal.textDim : BUZZ_TYPE_COLOR[choice]}
      aria-hidden="true"
      focusable="false"
      data-testid={testId}
      data-buzz-type={choice}
      style={iconStyle}
    >
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  );
}

/** The trigger's open/closed affordance. Decorative — `aria-expanded` is the claim. */
export function Chevron({ pal }: { pal: Palette }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke={pal.textDim}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={iconStyle}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * Save: an arrow into a tray.
 *
 * The REAL file download — the raw candidate through the host's SAVE_IMAGE bridge.
 * Deliberately a different shape from {@link AddTextIcon}: the two buttons it
 * labels do genuinely different things (see `History.tsx`), and once the visible
 * text went the icon is half of what carries that.
 */
export function DownloadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={iconStyle}
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

/** Add text: a capital T on a baseline — the canvas editor, not a download. */
export function AddTextIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={iconStyle}
    >
      <path d="M5 5h14" />
      <path d="M12 5v12" />
      <path d="M8 19h8" />
    </svg>
  );
}
