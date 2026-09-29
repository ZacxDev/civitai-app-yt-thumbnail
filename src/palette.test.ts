import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  AA_TEXT,
  BORDER_MIN,
  BORDER_PAIRS,
  NON_TEXT_TOKENS,
  TEXT_PAIRS,
  THEMES,
  contrastRatio,
  palette,
  paletteFor,
  parseHex,
  type Palette,
} from './palette.js';

// The `brandDepth: "skin"` debt, paid.
//
// 🔴 THIS FILE IS THE REASON THE PALETTE IS A TS OBJECT AND NOT CSS CUSTOM
// PROPERTIES. jsdom does not resolve the cascade for custom properties —
// `getComputedStyle(el).background` on a `var()` hands back the literal `var(...)`
// text — so a `var()`-based palette could only be asserted as "a string that
// mentions a token name". That is a structural check which type-checks past a
// wrong value, and under `skin` the dual-theme check is mandatory rather than
// advisory. Keyed plain objects can be asserted with literal hex in BOTH themes,
// and their contrast can be COMPUTED, which is what the rubric actually asks
// about.

/** Every token, written out. A change to the palette has to change this. */
const EXPECTED: Record<'dark' | 'light', Palette> = {
  dark: {
    page: '#0B0E14',
    surface: '#14181F',
    surfaceRaised: '#1C222B',
    railBg: '#101419',
    border: '#2A313D',
    borderStrong: '#3F4A5A',
    text: '#F7F9FC',
    textDim: '#9AA6B8',
    brand: '#FF49BD',
    brandHover: '#FF7CCF',
    brandFg: '#1A0210',
    brandTint: '#2A0E20',
    brandTintBorder: '#7A2359',
    heroFrom: '#B3006E',
    heroTo: '#14181F',
    heroFg: '#F7F9FC',
    heroSubFg: '#F5D2E8',
    overlay: '#0B0E14',
    overlayFg: '#F7F9FC',
    danger: '#FF8A8A',
  },
  light: {
    page: '#F7F9FC',
    surface: '#FFFFFF',
    surfaceRaised: '#EDF0F6',
    railBg: '#FFFFFF',
    border: '#D2D9E4',
    borderStrong: '#A9B4C4',
    text: '#0B0E14',
    textDim: '#4F5A6B',
    brand: '#D8008A',
    brandHover: '#AE0070',
    brandFg: '#FFFFFF',
    brandTint: '#FDE8F4',
    brandTintBorder: '#F0A9D3',
    heroFrom: '#D8008A',
    heroTo: '#7A004E',
    heroFg: '#FFFFFF',
    heroSubFg: '#FFF7FB',
    overlay: '#0B0E14',
    overlayFg: '#F7F9FC',
    danger: '#B3261E',
  },
};

/**
 * 🔴 DERIVED FROM THE SHIPPED PALETTE, NOT FROM `EXPECTED` ABOVE.
 *
 * Found by mutation: when this read `Object.keys(EXPECTED.dark)`, adding a real new
 * token to `palette.ts` left the completeness check below GREEN — it could only
 * ever see tokens the test author had already written down, while its own docstring
 * claimed it would catch an ungraded new surface. That is a guard whose description
 * was wider than its implementation, which reads as coverage while providing none.
 * Keying off the runtime object makes a new surface fail here immediately; the
 * literal ledger is still pinned separately by the `toEqual(expected)` case.
 */
const TOKENS = Object.keys(palette.dark) as (keyof Palette)[];

describe('contrastRatio — the instrument, before any verdict it produces', () => {
  // 🔴 A CONTRAST NUMBER IS ONLY EVIDENCE ONCE THE FORMULA HAS BEEN SHOWN TO
  // WORK. Every dual-theme claim below is this function's output, so it gets its
  // own positive and negative controls first: an implementation that always
  // returned 21 would make the entire suite green while asserting nothing.
  it('black on white is 21:1 — the maximum', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('a colour against itself is 1:1 — the minimum, and the NEGATIVE control', () => {
    expect(contrastRatio('#FF49BD', '#FF49BD')).toBeCloseTo(1, 10);
    expect(contrastRatio('#0B0E14', '#0B0E14')).toBeCloseTo(1, 10);
  });

  it('is symmetric in its arguments', () => {
    expect(contrastRatio('#0B0E14', '#F7F9FC')).toBeCloseTo(
      contrastRatio('#F7F9FC', '#0B0E14'),
      10,
    );
  });

  it('reproduces a third-party reference value', () => {
    // WCAG's own worked example: #777777 on #FFFFFF is 4.48:1 — just UNDER AA,
    // which is also a value no plausible always-pass mutant produces.
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(AA_TEXT);
  });

  it('parseHex rejects anything that is not a colour, loudly', () => {
    expect(() => parseHex('rgba(0,0,0,0.5)')).toThrow(/not a hex colour/);
    expect(() => parseHex('#GGGGGG')).toThrow(/not a hex colour/);
    expect(() => parseHex('')).toThrow(/not a hex colour/);
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#FF49BD')).toEqual([255, 73, 189]);
  });
});

describe.each(THEMES)('palette.%s', (theme) => {
  const pal = palette[theme];
  const expected = EXPECTED[theme];

  it('every token holds the literal value the pass decided', () => {
    expect(pal).toEqual(expected);
  });

  it('every token is a 6-digit hex colour', () => {
    for (const token of TOKENS) {
      expect(pal[token], token).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  // 🔴 THE MANDATORY DUAL-THEME CHECK, as a ratio and not as a vibe. Run over the
  // SAME ledger in both themes, so a pair that was only ever looked at in dark
  // cannot pass by being unexamined.
  it.each(TEXT_PAIRS.map((p) => [p[0], p[1]] as const))(
    '%s on %s clears WCAG AA for body text',
    (fg, bg) => {
      const ratio = contrastRatio(pal[fg], pal[bg]);
      expect(
        ratio,
        `${theme}: ${fg} ${pal[fg]} on ${bg} ${pal[bg]} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it.each(BORDER_PAIRS.map((p) => [p[0], p[1]] as const))(
    '%s stays visible against %s',
    (border, ground) => {
      const ratio = contrastRatio(pal[border], pal[ground]);
      expect(
        ratio,
        `${theme}: ${border} ${pal[border]} on ${ground} ${pal[ground]} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(BORDER_MIN);
      // Not the same colour, which a ratio bar this low would otherwise permit at
      // exactly 1.0 only — stated separately so the failure names the real defect.
      expect(pal[border]).not.toBe(pal[ground]);
    },
  );
});

describe('the ledger covers the palette', () => {
  it('the literal ledger names exactly the tokens the palette ships', () => {
    // The other half of deriving TOKENS from the runtime object: a token added to
    // `palette.ts` must also be written into `EXPECTED`, or the literal check would
    // quietly stop being exhaustive.
    expect(Object.keys(EXPECTED.dark).sort()).toEqual([...TOKENS].sort());
    expect(Object.keys(EXPECTED.light).sort()).toEqual([...TOKENS].sort());
    expect(Object.keys(palette.light).sort()).toEqual([...TOKENS].sort());
  });

  // 🔴 A GUARD THAT SILENTLY IGNORES NEW TOKENS READS AS COVERAGE WHILE PROVIDING
  // NONE. `skin`'s failure mode is a NEW surface nobody graded, so adding a field
  // to `Palette` must fail here until it is either in a pair or declared non-text.
  it('every token appears in TEXT_PAIRS or is declared non-text', () => {
    const covered = new Set<string>();
    for (const [fg, bg] of TEXT_PAIRS) {
      covered.add(fg);
      covered.add(bg);
    }
    for (const t of NON_TEXT_TOKENS) covered.add(t);
    const missing = TOKENS.filter((t) => !covered.has(t));
    expect(missing).toEqual([]);
  });

  it('every non-text token is graded by BORDER_PAIRS', () => {
    const graded = new Set(BORDER_PAIRS.map(([b]) => b as string));
    expect(NON_TEXT_TOKENS.filter((t) => !graded.has(t))).toEqual([]);
  });

  it('no token is in both ledgers', () => {
    const fgs = new Set(TEXT_PAIRS.map(([fg]) => fg as string));
    expect(NON_TEXT_TOKENS.filter((t) => fgs.has(t))).toEqual([]);
  });
});

describe('the two themes are actually two themes', () => {
  /**
   * The only tokens allowed to be IDENTICAL across themes, with the reason.
   *
   * `overlay`/`overlayFg` are the scrim on a generated image: what is underneath
   * is an arbitrary photograph, not a theme surface, so a light-theme scrim would
   * be white-on-white as often as not. A dark scrim with light text is correct in
   * both.
   */
  const SHARED: readonly (keyof Palette)[] = ['overlay', 'overlayFg'];

  it.each(TOKENS.filter((t) => !SHARED.includes(t)).map((t) => [t] as const))(
    '%s differs between dark and light',
    (token) => {
      // The copy-paste guard: a token carried over verbatim from dark to light is
      // the exact shape of the `skin` bug that stays invisible until someone opens
      // the other theme.
      expect(palette.light[token]).not.toBe(palette.dark[token]);
    },
  );

  it.each(SHARED.map((t) => [t] as const))('%s is deliberately shared', (token) => {
    expect(palette.light[token]).toBe(palette.dark[token]);
  });

  it('light is genuinely lighter than dark, at the ground and the body text', () => {
    // A cheap orientation check that catches the two palettes being swapped —
    // which every per-token inequality above would happily pass.
    expect(contrastRatio(palette.light.page, '#FFFFFF')).toBeLessThan(
      contrastRatio(palette.dark.page, '#FFFFFF'),
    );
    expect(contrastRatio(palette.light.text, '#FFFFFF')).toBeGreaterThan(
      contrastRatio(palette.dark.text, '#FFFFFF'),
    );
  });
});

describe('paletteFor', () => {
  it('resolves the two names the host sends', () => {
    expect(paletteFor('light')).toBe(palette.light);
    expect(paletteFor('dark')).toBe(palette.dark);
  });

  it.each([undefined, null, '', 'system', 'Light', 'LIGHT', 'auto'])(
    'falls back to dark for %p',
    (value) => {
      expect(paletteFor(value as string | null | undefined)).toBe(palette.dark);
    },
  );

  it('the fallback AGREES with the boot skeleton, which is why it is dark', () => {
    // 🔴 A CROSS-FILE SEAM, ASSERTED. `index.css` declares `color-scheme: dark
    // light` and `index.html`'s meta says the same, so the frame the viewer sees
    // before this bundle lands is dark. A default of `light` here would flash the
    // app from a dark skeleton to a light skin. Nothing in the type system ties
    // the two together, so this reads the CSS.
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
    expect(css).toMatch(/color-scheme:\s*dark light/);
    expect(paletteFor(undefined)).toBe(palette.dark);
  });
});

describe('the brand hue is the measured one', () => {
  it('dark carries the live listing mark resolved through the brand wheel', () => {
    // #FF49BD is `wheel.py`'s `fit_chroma(L*=62, LCh h=345)` for the 322° dominant
    // hue measured off the LIVE assets/icon.png. Pinned here because the whole
    // provenance argument in palette.ts is about THIS value.
    expect(palette.dark.brand).toBe('#FF49BD');
  });

  it('light uses the darker step, because the bright hue cannot carry text on paper', () => {
    // The reason light gets its own value at all: 2.87:1 on paper vs 4.64:1.
    expect(contrastRatio('#FF49BD', palette.light.page)).toBeLessThan(AA_TEXT);
    expect(contrastRatio(palette.light.brand, palette.light.page)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });
});
