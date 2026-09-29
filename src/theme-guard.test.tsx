import { readFileSync } from 'node:fs';

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from './App.js';
import { installMockMoneyHost } from './mock-buzz.js';
import { AA_TEXT, THEMES, contrastRatio, palette, type ThemeName } from './palette.js';

// ===========================================================================
// THE DUAL-THEME GUARD, MADE MECHANICAL.
//
// 🔴 WHAT WAS WRONG WITH THE GUARD THIS REPLACES, MEASURED RATHER THAN ASSERTED.
// `responsive.test.tsx` already renders the App in both themes and checks eight
// surfaces BY HAND, and its own header states the hazard: "a component that
// hardcoded `palette.dark` would leave `palette.test.ts` completely green". It
// then covers eight of them and leaves the rest — `previewPlaceholderStyle`,
// `checkStyle`, `FormatEditor`'s `inputStyle`/`counterStyle`/`errorStyle`,
// `PublishedBoard`'s `boardStyle`/`boardRowStyle`/`boardSuffixStyle`/`dimStyle`,
// `loraRowStyle`, `canvasStyle`, `sourceThumbStyle`, `colorInputStyle` — with no
// coverage at all. The demonstration: mutating `FormatPicker.tsx`'s
// `cardButtonStyle` from `color: pal.text` to the dark theme's own literal
// '#F7F9FC' left the whole suite GREEN, while in the LIGHT theme it renders
// format-card labels at 1.055:1 on `surface` and 1.105:1 on `brandTint` — text
// that is, for practical purposes, invisible.
//
// 🔴 AND THE OBVIOUS MECHANICAL FIX DOES NOT CATCH IT. "Assert every painted
// colour is a member of `palette[theme]`" reads like the right guard and is not:
// '#F7F9FC' is `palette.light.page` AND `palette.light.overlayFg`, so a
// membership test passes in the light theme. Nor does the cross-theme form
// "the dark value and the light value must be the same TOKEN" — (PAPER, PAPER)
// is exactly the pair `overlayFg` has in both themes, so that passes too. The
// value is a legitimate palette colour; what is wrong is WHERE it is used.
//
// So the two guards below grade the two things that actually discriminate, and
// neither of them is a list of surfaces:
//
//   A. NO COLOUR LITERAL MAY APPEAR IN THE CODE OF THE TWO FILES THAT DRAW THE
//      APP. A hex, `rgb()` or `hsl()` anywhere outside `withAlpha` is a colour
//      that did not come from a `Palette`, whatever theme it happens to suit.
//      This is a property of the whole file, not a ledger, so a surface added
//      tomorrow is covered the moment it is written.
//
//   B. EVERY TEXT COLOUR THE APP PAINTS IS GRADED AGAINST ITS OWN RESOLVED
//      GROUND, in both themes, by walking the rendered DOM. This is the
//      relationship the hazard is actually about — not "is this colour in the
//      palette" but "can this text be read where it sits" — and it is what makes
//      the mutant fail: 1.055:1 against `AA_TEXT`'s 4.5.
//
// Neither guard names a surface, so neither can be out of date.
// ===========================================================================

// ---------------------------------------------------------------------------
// GUARD A — no colour may enter these files except through a Palette.
// ---------------------------------------------------------------------------

/** The two files that draw the app's own surfaces. */
const DRAWING_FILES = ['src/App.tsx', 'src/FormatPicker.tsx'] as const;

/**
 * The ONE place a colour literal is legitimate in those files: `withAlpha` builds
 * an `rgba()` string out of a token it was handed, so the literal is the
 * FUNCTION's syntax, not a colour choice. Named rather than counted — a count
 * would still pass if the allowed occurrence moved into a surface.
 */
const LITERAL_ALLOWED_IN = 'withAlpha';

/** Strip `//` and block comments so a hex quoted in prose is not a finding. */
function stripComments(src: string): string {
  // Replace with spaces rather than nothing, so byte offsets stay usable for
  // locating the enclosing function.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/** Nearest `function foo` / `const foo =` at or above `offset`. */
function enclosingName(src: string, offset: number): string {
  const before = src.slice(0, offset);
  const matches = [...before.matchAll(/(?:function\s+([A-Za-z0-9_$]+)|const\s+([A-Za-z0-9_$]+)\s*[:=])/g)];
  const last = matches.at(-1);
  return last ? (last[1] ?? last[2] ?? '<unknown>') : '<file scope>';
}

describe('GUARD A — no colour literal reaches an app surface', () => {
  it.each(DRAWING_FILES)('%s introduces no colour outside a Palette', (file) => {
    const src = stripComments(readFileSync(file, 'utf8'));

    // `#rgb`, `#rrggbb`, `#rrggbbaa`, plus functional colour notations.
    const pattern = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/g;
    const findings = [...src.matchAll(pattern)]
      .map((m) => ({ text: m[0], where: enclosingName(src, m.index) }))
      .filter((f) => f.where !== LITERAL_ALLOWED_IN);

    expect(
      findings,
      `${file} contains ${findings.length} colour literal(s) outside \`${LITERAL_ALLOWED_IN}\`: ` +
        findings.map((f) => `${f.text} in ${f.where}`).join(', ') +
        `. Every colour an app surface paints must come from a \`Palette\` field, or it is ` +
        `correct in at most one theme.`,
    ).toEqual([]);
  });

  it('the guard can SEE a literal — positive control', () => {
    // 🔴 WITHOUT THIS THE ZERO ABOVE IS INDISTINGUISHABLE FROM A DEAD PATTERN.
    // The control is the real mutant: `color: pal.text` → `color: '#F7F9FC'`, in
    // the function it was demonstrated on.
    const mutated = stripComments(readFileSync('src/FormatPicker.tsx', 'utf8')).replace(
      'color: pal.text,',
      "color: '#F7F9FC',",
    );
    expect(mutated, 'the mutation did not apply — the control proves nothing').toContain('#F7F9FC');

    const found = [...mutated.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/g)].map((m) => ({
      text: m[0],
      where: enclosingName(mutated, m.index),
    }));
    expect(found.filter((f) => f.where !== LITERAL_ALLOWED_IN)).not.toEqual([]);
    // And it is attributed to the surface that did it, not to the file.
    expect(found.map((f) => f.where)).toContain('cardButtonStyle');
  });

  it('`withAlpha` is the only exemption, and it is still a real function', () => {
    // The exemption is a name, so it has to be a name that exists — otherwise a
    // rename silently widens it to nothing and Guard A starts flagging the helper.
    const src = readFileSync('src/App.tsx', 'utf8');
    expect(src).toContain(`function ${LITERAL_ALLOWED_IN}(`);
  });
});

// ---------------------------------------------------------------------------
// GUARD B — every painted text colour, graded against its own ground.
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];

/** `rgb()` / `rgba()` / `#hex` → channels + alpha. `null` for anything else. */
function parseColour(value: string): { rgb: Rgb; alpha: number } | null {
  const v = value.trim();
  if (v === '' || v === 'none' || v === 'transparent' || v === 'inherit' || v === 'currentColor') {
    return null;
  }
  const fn = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.%]+))?\s*\)$/i);
  if (fn) {
    const a = fn[4] === undefined ? 1 : fn[4].endsWith('%') ? parseFloat(fn[4]) / 100 : parseFloat(fn[4]);
    return { rgb: [Number(fn[1]), Number(fn[2]), Number(fn[3])], alpha: a };
  }
  const hex = v.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return {
      rgb: [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)],
      alpha: 1,
    };
  }
  return null;
}

function toHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

/** `src` at `alpha` over `dst`. Gamma-space, which is what a browser does. */
function composite(src: Rgb, alpha: number, dst: Rgb): Rgb {
  return [0, 1, 2].map((i) => src[i] * alpha + dst[i] * (1 - alpha)) as Rgb;
}

/** Every colour stop in a `linear-gradient(...)`, in source order. */
function gradientStops(image: string): Rgb[] {
  if (!/gradient\(/i.test(image)) return [];
  const out: Rgb[] = [];
  for (const m of image.matchAll(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,6}\b/g)) {
    const c = parseColour(m[0]);
    if (c) out.push(c.alpha === 1 ? c.rgb : c.rgb);
  }
  return out;
}

/**
 * The OPAQUE ground(s) an element's own text sits on.
 *
 * More than one when the ground is a gradient — then every stop is a ground the
 * text really does sit on somewhere along its width, and the worst of them is the
 * one that decides legibility. A translucent ground is composited over whatever
 * is behind it rather than skipped, so the candidate tag's 78% scrim is graded at
 * the colour it actually produces.
 */
function groundsFor(el: HTMLElement): Rgb[] {
  let node: HTMLElement | null = el;
  const layers: { rgb: Rgb; alpha: number }[] = [];

  while (node) {
    const stops = gradientStops(node.style.backgroundImage || node.style.background || '');
    if (stops.length > 0) {
      // A gradient is opaque here: resolve each stop through the layers above it.
      return stops.map((s) => layers.reduceRight((acc, l) => composite(l.rgb, l.alpha, acc), s));
    }
    const bg = parseColour(node.style.backgroundColor || '');
    if (bg && bg.alpha > 0) {
      if (bg.alpha === 1) {
        return [layers.reduceRight((acc, l) => composite(l.rgb, l.alpha, acc), bg.rgb)];
      }
      layers.push(bg);
    }
    node = node.parentElement;
  }
  return [];
}

const VIEWER = { viewer: { id: 2, username: 'dev', status: 'active' as const } };

/** Width inside `lg`, so the rail and its own ground are part of the walk. */
const LG_WIDTH = 1301;

let blockWidth = 0;
let restoreClientWidth: (() => void) | undefined;
let restoreResizeObserver: (() => void) | undefined;

class InertResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function setBlockWidth(px: number) {
  blockWidth = px;
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => blockWidth,
  });
  restoreClientWidth = () => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    if (original) Object.defineProperty(Element.prototype, 'clientWidth', original);
  };
  const priorRO = (globalThis as unknown as Record<string, unknown>).ResizeObserver;
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = InertResizeObserver;
  restoreResizeObserver = () => {
    (globalThis as unknown as Record<string, unknown>).ResizeObserver = priorRO;
  };
}

/**
 * The minimum number of (element, ground) pairs the walk must find.
 *
 * 🔴 THIS IS THE REACHABILITY CONTROL, AND `> 0` WOULD BE TOO WEAK. A guard that
 * walked zero elements would pass every assertion vacuously and read as coverage;
 * so would one that walked three after a refactor stopped mounting the format
 * grid. MEASURED at the commit that introduced this file: **24** (element, ground)
 * pairs in each theme, from a single `lg` render — the shell, both hero gradient
 * stops against the headline and against the sub-line, the model label, two
 * `fieldDesc` hints on the rail ground, four quantity pills, four spend-from pills,
 * the cost note, the ✓ badge, and all six format-card buttons. Six of those are
 * `cardButtonStyle`, which is the surface the demonstrated mutant lives on.
 *
 * The bar is a FLOOR, not an equality — it can only fail if coverage SHRINKS, which
 * is the direction that matters. Raising it when a new surface mounts is optional;
 * letting it fall silently is the failure this prevents.
 */
const MIN_GRADED_PAIRS = 24;

describe.each(THEMES)('GUARD B — every text colour is legible where it sits (%s)', (theme: ThemeName) => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    restoreClientWidth?.();
    restoreClientWidth = undefined;
    restoreResizeObserver?.();
    restoreResizeObserver = undefined;
  });

  it('grades every app-painted text colour against its own resolved ground', async () => {
    setBlockWidth(LG_WIDTH);
    uninstall = installMockMoneyHost({ ...VIEWER, theme });
    render(<App />);
    await screen.findByTestId('pm-generate');

    const root = document.querySelector('[data-block-tier]') as HTMLElement;
    expect(root, 'the App did not render its block root').not.toBeNull();
    expect(root).toHaveAttribute('data-theme', theme);

    const own = palette[theme];
    const graded: string[] = [];
    const failures: string[] = [];

    for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
      // Only the app's OWN surfaces carry an inline colour. The W6 pack's
      // components style themselves from the block-root `data-theme`, so they
      // have none and are correctly out of scope here.
      const fg = parseColour(el.style.color || '');
      if (!fg) continue;

      // A deliberately faded control is exempt from contrast by WCAG's own
      // reading, and the app only fades DISABLED pills. Recorded, not silent.
      const op = el.style.opacity === '' ? 1 : Number(el.style.opacity);
      if (op < 1) continue;

      const grounds = groundsFor(el);
      expect(
        grounds.length,
        `<${el.tagName.toLowerCase()} data-testid=${el.dataset.testid ?? '—'}> paints ` +
          `${toHex(fg.rgb)} with no resolvable opaque ground above it`,
      ).toBeGreaterThan(0);

      for (const ground of grounds) {
        const ratio = contrastRatio(toHex(fg.rgb), toHex(ground));
        const label =
          `${el.tagName.toLowerCase()}[${el.dataset.testid ?? (el.className || 'anon')}] ` +
          `${toHex(fg.rgb)} on ${toHex(ground)} = ${ratio.toFixed(3)}:1`;
        graded.push(label);
        if (ratio < AA_TEXT) failures.push(label);
      }
    }

    // 🔴 REACHABILITY BEFORE VERDICT. Assert the walk found something FIRST, so a
    // guard that observed nothing fails loudly instead of passing on an empty set.
    expect(
      graded.length,
      `the walk graded ${graded.length} (element, ground) pairs — a guard that walks ` +
        `nothing is worse than no guard`,
    ).toBeGreaterThanOrEqual(MIN_GRADED_PAIRS);

    expect(
      failures,
      `${failures.length} of ${graded.length} app-painted text pairs fall below AA ` +
        `(${AA_TEXT}:1) in the ${theme} theme:\n  ${failures.join('\n  ')}\n` +
        `A colour that is a legitimate \`Palette\` value can still be wrong for the ` +
        `surface it lands on — that is what this grades.`,
    ).toEqual([]);

    // Every ground the walk resolved is one of THIS theme's own colours (or a
    // composite of them), never a bare value from the other theme. Cheap, and it
    // is the half Guard A cannot see: a token read from the wrong `Palette`.
    const otherOnly = new Set(
      Object.values(palette[theme === 'dark' ? 'light' : 'dark']).filter(
        (hex) => !Object.values(own).some((o) => o.toLowerCase() === hex.toLowerCase()),
      ),
    );
    for (const label of graded) {
      for (const hex of otherOnly) {
        expect(
          label.toLowerCase(),
          `a colour unique to the OTHER theme (${hex}) is painted in the ${theme} theme: ${label}`,
        ).not.toContain(hex.toLowerCase());
      }
    }
  });
});

describe('GUARD B — the grader itself', () => {
  it('goes RED on the demonstrated mutant’s realized contrast', () => {
    // 🔴 THE NEGATIVE CONTROL. Guard B's verdict is only worth reading if it can
    // fail, so the exact mutant is fed through the SAME comparison the walk uses:
    // `cardButtonStyle`'s `color` hardcoded to the dark theme's '#F7F9FC', landing
    // on the light theme's two format-card grounds.
    const mutant = '#F7F9FC';
    for (const ground of [palette.light.surface, palette.light.brandTint] as const) {
      expect(contrastRatio(mutant, ground)).toBeLessThan(AA_TEXT);
    }
    // And the honest value it SHOULD have: `pal.text` on the same grounds.
    for (const ground of [palette.light.surface, palette.light.brandTint] as const) {
      expect(contrastRatio(palette.light.text, ground)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('composites a translucent ground rather than ignoring it', () => {
    // The candidate tag's scrim is `overlay` at 78%. A grader that skipped
    // translucent grounds would grade its label against the page instead, which is
    // a different and much more flattering number in the dark theme.
    const el = document.createElement('div');
    const parent = document.createElement('div');
    parent.style.backgroundColor = 'rgb(255, 255, 255)';
    el.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    parent.appendChild(el);
    const [ground] = groundsFor(el);
    expect(ground.map(Math.round)).toEqual([128, 128, 128]);
  });

  it('returns every stop of a gradient ground', () => {
    const el = document.createElement('div');
    el.style.backgroundImage = 'linear-gradient(135deg, #b3006e 0%, #14181f 100%)';
    expect(groundsFor(el)).toHaveLength(2);
  });
});
