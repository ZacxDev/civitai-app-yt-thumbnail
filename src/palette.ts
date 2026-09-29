/**
 * The app-owned palette — `brandDepth: "skin"`.
 *
 * 🔴 WHAT CHANGED, AND WHAT IT COSTS. Before this module every colour in the app
 * was a `--civitai-color-*` custom property published by the W6 pack, so the HOST
 * owned light/dark and the app could not get it wrong. Declaring `skin` moves
 * that correctness onto us: a hardcoded surface that only works in dark is now
 * OUR bug, and it is invisible until someone opens the other theme. The price of
 * the move is paid in `palette.test.ts`, which asserts every pair below in BOTH
 * themes and re-derives the WCAG contrast of every text-on-surface pair.
 *
 * 🔴 WHY A TYPED TS OBJECT AND NOT CASCADING CSS CUSTOM PROPERTIES. The dual-theme
 * check is mandatory under `skin`, and this app's only test environment is jsdom,
 * which does not implement the cascade for custom properties: `getComputedStyle`
 * hands back the literal `var(--x)` text, not a resolved colour. A palette built
 * on `var()` could therefore only be asserted as *strings that mention a token
 * name* — a structural check that type-checks past a wrong value and reads as
 * coverage while providing none. Keyed plain objects can be asserted with literal
 * hex in both themes, and their contrast can be COMPUTED, which is the thing the
 * rubric actually asks about.
 *
 * WHAT THIS PALETTE DOES *NOT* OWN. The W6 pack's own components (Button, Alert,
 * Card, Textarea, TextInput, Slider, SegmentedControl, Badge) style themselves
 * from the pack stylesheet against `data-theme` on the block root. We do not
 * fight them, and this module does not attempt to restyle them. `skin` here means
 * "the surfaces the APP draws itself are the app's" — the shell, the hero, the
 * rail, the field chrome, the pill rows, the format cards, the board, the
 * candidate grid. Both families read the same `data-theme`, so they flip
 * together.
 */

/** The two themes the host can put the block in. */
export type ThemeName = 'dark' | 'light';

/**
 * Every colour the app draws itself with. Deliberately small: a token that only
 * one surface uses is a surface that should have reused a token.
 */
export interface Palette {
  /** The iframe surface behind the content. */
  page: string;
  /** A panel sitting on `page` — the model row, a LoRA row, a format card. */
  surface: string;
  /** A control *inside* a panel — a raw input, a board row. */
  surfaceRaised: string;
  /** The persistent rail's ground at `lg`+ (see `layout.ts`). */
  railBg: string;
  /** Hairline between surfaces. */
  border: string;
  /** A border that has to be seen rather than felt (rail edge, pill outline). */
  borderStrong: string;
  /** Body text. */
  text: string;
  /** Secondary text: descriptions, counters, hints. */
  textDim: string;
  /** The brand hue, at the weight that survives this theme's ground. */
  brand: string;
  /** The brand hue one step further from the ground, for hover/pressed. */
  brandHover: string;
  /** Text/iconography ON `brand` or `brandHover`. */
  brandFg: string;
  /** A brand-tinted ground for a selected card, still carrying `text`. */
  brandTint: string;
  /** The border of a selected card. */
  brandTintBorder: string;
  /** Hero gradient, brand end. Hero text sits mostly over this end. */
  heroFrom: string;
  /** Hero gradient, ground end. */
  heroTo: string;
  /** Hero headline. */
  heroFg: string;
  /** Hero sub-line. */
  heroSubFg: string;
  /** The scrim behind a label overlaid on an image. */
  overlay: string;
  /** Text on `overlay`. */
  overlayFg: string;
  /** Error text the app renders itself (the pack owns its own Alert colours). */
  danger: string;
}

/**
 * 🔴 THE BRAND HUE IS MEASURED, NOT CHOSEN HERE.
 *
 * `#FF49BD` is the app's own live listing mark resolved through the brand
 * system's own math, not a colour picked in a design session:
 *
 *  1. The dominant hue of the LIVE `assets/icon.png` — the magenta/cyan burst
 *     that is on the public listing today — measured by saturation×value-weighted
 *     HSV histogram: **322°** (the 320–329° bucket, weight 1443.6; the cyan
 *     secondary is 183°).
 *  2. Placed at the brand family's fixed `L* = 62` with the highest in-gamut
 *     chroma at that hue, by `brand-assets-rev5-2026-08-13/scripts/wheel.py`'s
 *     own `fit_chroma`: LCh h=345.0, C*=81 → `#FF49BD`, realized HSV 321.8°
 *     (0.2° from the measurement), realized L* 61.4.
 *
 * 🔴 AND IT FAILS THE WHEEL'S OWN SEPARATION GATE — recorded, not hidden.
 * rev5's bar is ≥40° minimum pairwise HSV separation across the onsite family.
 * `#FF49BD` sits **11.8°** from `gen-matrix` (`#DB6EC9`, 309.9°) and 30.2° from
 * `playable-collections` (`#FA6478`, 352.0°). That is not a mistake in the
 * measurement: the onsite wheel is documented FULL at seven hues (seven at ≥42°
 * already consume 294° of 360°), and yt-thumbnail is an eighth onsite app with no
 * slot in it. The alternative — moving the app off its own live mark — would put
 * the in-app skin at odds with the icon and cover that are approved and live on
 * the store right now, which is the worse of the two wrongs. `taste.json`
 * carries the collision as a `deferred[]` item with its closing condition.
 *
 * The light-theme `brand` is the same hue one lightness step down
 * (`shade(-0.22)` by `emit-svg.py`'s own function) because `#FF49BD` only reaches
 * 2.87× against paper — it cannot carry text on a light ground. `#D8008A` reaches
 * 4.64× on `page` and 4.90× on `surface`.
 */
const BRAND_DARK = '#FF49BD';
const BRAND_LIGHT = '#D8008A';

/**
 * The ink/paper anchors are the brand system's, shared with every other app's
 * store art (`wheel.py`: `INK, PAPER = '#0B0E14', '#F7F9FC'`), so the block's own
 * ground matches the family rather than inventing a third near-black.
 */
const INK = '#0B0E14';
const PAPER = '#F7F9FC';

const dark: Palette = {
  page: INK,
  surface: '#14181F',
  surfaceRaised: '#1C222B',
  railBg: '#101419',
  border: '#2A313D',
  borderStrong: '#3F4A5A',
  text: PAPER,
  textDim: '#9AA6B8',
  brand: BRAND_DARK,
  brandHover: '#FF7CCF',
  brandFg: '#1A0210',
  brandTint: '#2A0E20',
  brandTintBorder: '#7A2359',
  heroFrom: '#B3006E',
  heroTo: '#14181F',
  heroFg: PAPER,
  heroSubFg: '#F5D2E8',
  overlay: INK,
  overlayFg: PAPER,
  danger: '#FF8A8A',
};

const light: Palette = {
  page: PAPER,
  surface: '#FFFFFF',
  surfaceRaised: '#EDF0F6',
  railBg: '#FFFFFF',
  border: '#D2D9E4',
  borderStrong: '#A9B4C4',
  text: INK,
  textDim: '#4F5A6B',
  brand: BRAND_LIGHT,
  brandHover: '#AE0070',
  brandFg: '#FFFFFF',
  brandTint: '#FDE8F4',
  brandTintBorder: '#F0A9D3',
  heroFrom: BRAND_LIGHT,
  heroTo: '#7A004E',
  heroFg: '#FFFFFF',
  heroSubFg: '#FFF7FB',
  overlay: INK,
  overlayFg: PAPER,
  danger: '#B3261E',
};

/** Both themes, keyed. `palette.dark.surface` / `palette.light.surface`. */
export const palette: Record<ThemeName, Palette> = { dark, light };

/**
 * Resolve whatever the host put in `useBlockContext().theme` to a palette.
 *
 * 🔴 THE FALLBACK IS `dark`, AND IT IS NOT ARBITRARY. `index.html` declares
 * `<meta name="color-scheme" content="dark light">` and `index.css` re-states
 * `color-scheme: dark light`, so the boot skeleton the viewer sees before the
 * bundle lands is dark. An unknown/absent theme resolving to `light` would make
 * the app flash from a dark skeleton to a light skin and back — so the two
 * defaults have to agree, the same way the meta and the CSS property already do.
 */
export function paletteFor(theme: string | null | undefined): Palette {
  return theme === 'light' ? light : dark;
}

/** The two theme names, for `it.each` over both. */
export const THEMES: readonly ThemeName[] = ['dark', 'light'];

// ---------------------------------------------------------------------------
// Contrast, so the dual-theme claim is COMPUTED rather than eyeballed.
// ---------------------------------------------------------------------------

/** `#RGB` / `#RRGGBB` → 0–255 triple. Throws on anything else, loudly. */
export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`palette: not a hex colour: ${hex}`);
  }
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG 2.x relative luminance. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.x contrast ratio, 1–21. Symmetric in its arguments.
 *
 * This is here rather than in a test file on purpose: a ratio the TEST computes
 * with its own copy of the formula is a test of the test. The app ships the
 * formula, the test drives it, and a palette edit that drops a pair below the bar
 * fails at the value it actually broke.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Every foreground/background pair the app actually renders, as
 * `[foregroundToken, backgroundToken]`.
 *
 * 🔴 THIS LEDGER IS THE GUARD, so it must GROW when a surface does. It is asserted
 * against the token set: adding a token to `Palette` without either using it in a
 * pair here or listing it in `NON_TEXT_TOKENS` fails `palette.test.ts`. That is
 * deliberate — a new surface with no contrast pair is exactly the hole `skin`
 * opens, and a ledger that silently ignores new tokens would read as coverage
 * while providing none.
 */
export const TEXT_PAIRS: readonly (readonly [keyof Palette, keyof Palette])[] = [
  ['text', 'page'],
  ['text', 'surface'],
  ['text', 'surfaceRaised'],
  ['text', 'railBg'],
  ['text', 'brandTint'],
  ['textDim', 'page'],
  ['textDim', 'surface'],
  ['textDim', 'surfaceRaised'],
  ['textDim', 'railBg'],
  ['brandFg', 'brand'],
  ['brandFg', 'brandHover'],
  ['brand', 'page'],
  ['brand', 'surface'],
  ['heroFg', 'heroFrom'],
  ['heroFg', 'heroTo'],
  ['heroSubFg', 'heroFrom'],
  ['heroSubFg', 'heroTo'],
  ['overlayFg', 'overlay'],
  ['danger', 'surface'],
  ['danger', 'surfaceRaised'],
];

/**
 * Tokens that are never a foreground and never a text ground: the hairlines.
 * Listed so the completeness assertion over `TEXT_PAIRS` can tell "not a text
 * pair" from "forgotten", and separately graded by `BORDER_PAIRS`.
 */
export const NON_TEXT_TOKENS: readonly (keyof Palette)[] = [
  'border',
  'borderStrong',
  'brandTintBorder',
];

/** WCAG AA for body text. Every pair in `TEXT_PAIRS` clears this in BOTH themes. */
export const AA_TEXT = 4.5;

/**
 * Border-against-ground adjacencies the app actually draws, `[border, ground]`.
 *
 * 🔴 THESE ARE NOT GRADED AT WCAG 1.4.11's 3:1, AND SAYING SO IS THE POINT.
 * Measured, the widest of them is 1.48:1 and the narrowest 1.22:1 — these are
 * decorative hairlines separating two filled surfaces, not the sole boundary of a
 * control, so 3:1 is the wrong bar and asserting it would either fail honestly or
 * force a palette that looks like a wireframe. What 1.4.11 *does* govern here is
 * SELECTED STATE, and the format card does not rest on the tint: a selected card
 * carries a ✓ badge drawn in `brandFg` on `brand` (6.55:1 dark / 4.90:1 light,
 * both in `TEXT_PAIRS`) plus `aria-checked`, so the state survives a viewer who
 * cannot see the tint at all.
 *
 * The bar below is therefore "still visible", not "WCAG non-text" — it exists to
 * catch a token edit that makes a hairline vanish into its ground.
 */
export const BORDER_PAIRS: readonly (readonly [keyof Palette, keyof Palette])[] = [
  ['border', 'page'],
  ['border', 'surface'],
  ['border', 'surfaceRaised'],
  ['borderStrong', 'page'],
  ['borderStrong', 'railBg'],
  ['brandTintBorder', 'brandTint'],
  ['brandTintBorder', 'page'],
];

/**
 * The "a hairline is still a hairline" bar. Measured minimum across
 * `BORDER_PAIRS` × both themes is 1.22 (`border` on `surfaceRaised`); this sits
 * just under it so the guard fires on a token that collapses into its ground
 * rather than on a deliberate tweak.
 */
export const BORDER_MIN = 1.2;
