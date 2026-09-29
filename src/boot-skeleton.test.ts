import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SHELL_PADDING } from './App.js';
import { layoutForTier } from './layout.js';
import { palette, type Palette, type ThemeName } from './palette.js';

// ===========================================================================
// THE BOOT SKELETON IS A SECOND SURFACE, AND IT HAS TO AGREE WITH THE FIRST.
//
// 🔴 WHY THIS FILE EXISTS AT ALL. `block.manifest.json` declares
// `"bootSkeleton": true`, which makes the Civitai run host stand down its own
// loading veil — so `index.html` IS the loading state a viewer sees, not a
// placeholder behind one. It previously painted the W6 pack's old greys
// (#101113 / #1a1b1e / #2c2e33) inside a 640px cap. That agreed with the app
// while the app was also 640px of pack greys; once the app became a full-width
// `page`-grounded layout with a rail, the boot state jumped BOTH colour and
// width at mount — on the full-page surface at 1905px, a 640px dark-grey card
// centred on near-black snapping to a full-width #0B0E14 page. Its own comment
// claimed it "mirrors the `shell` style in src/App.tsx", which had become false
// at every tier from `sm` up.
//
// 🔴 AND FIXING IT CREATED THE HAZARD THIS FILE CLOSES. `index.html` is static:
// it cannot import `palette.ts` or call `layoutForTier`, so every value moved
// onto the palette is a SECOND COPY of a number TypeScript owns. A silently
// drifting duplicate is worse than the mismatch it replaced, because it reads as
// deliberate. So the rules below are parsed out of the shipped HTML and compared
// against their sources — and the comparison is CLOSED: a colour appearing in
// that stylesheet which no palette token accounts for is itself a failure, so
// the guard cannot be satisfied by a value nobody has thought about.
// ===========================================================================

const INDEX_HTML = readFileSync('index.html', 'utf8');

/**
 * The inline `<style>` block — the only part of the document that PAINTS.
 *
 * 🔴 HTML COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT TIDINESS. `index.html`'s
 * own comments discuss the colours they replaced and quote the tag name of this
 * very block, so a non-greedy `<style>…</style>` match run over the raw document
 * opens inside the COMMENT and drags three retired greys into the stylesheet. That
 * was a real failure of this parser before the completeness case below caught it:
 * the instrument was reading a region the browser never paints. Comments out
 * first, then locate the block.
 */
function styleSheet(): string {
  const withoutComments = INDEX_HTML.replace(/<!--[\s\S]*?-->/g, ' ');
  const m = withoutComments.match(/<style>([\s\S]*?)<\/style>/);
  expect(m, 'index.html no longer has an inline <style> block').not.toBeNull();
  // And CSS comments too, so a hex named in prose inside the block is not a rule.
  return m![1].replace(/\/\*[\s\S]*?\*\//g, ' ');
}

interface Decl {
  /** `null` for a top-level rule, else the `@media` condition text. */
  media: string | null;
  selector: string;
  prop: string;
  value: string;
}

/**
 * A deliberately small CSS reader: `selector { prop: value; }` plus one level of
 * `@media`. Enough for this stylesheet and nothing more — a real parser would be a
 * dependency, and a regex over the whole file could not tell a rule inside the
 * light-theme block from one outside it, which is the distinction that matters here.
 */
function parseCss(css: string, media: string | null = null, out: Decl[] = []): Decl[] {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const head = css.slice(i, open).trim();

    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);

    if (head.startsWith('@media')) {
      parseCss(body, head.replace(/^@media\s*/, '').trim(), out);
    } else {
      for (const part of body.split(';')) {
        const colon = part.indexOf(':');
        if (colon === -1) continue;
        out.push({
          media,
          selector: head.replace(/\s+/g, ' '),
          prop: part.slice(0, colon).trim(),
          value: part.slice(colon + 1).trim(),
        });
      }
    }
    i = j;
  }
  return out;
}

const DECLS = parseCss(styleSheet());

const CARD = "[data-boot-skeleton] [data-boot-shape='card']";
const SHAPE = `${CARD} > [data-boot-shape]`;
const LIGHT = 'light';

function find(selector: string, prop: string, media: string | null): Decl {
  const hit = DECLS.filter(
    (d) =>
      d.selector === selector &&
      d.prop === prop &&
      (media === null ? d.media === null : (d.media ?? '').includes(media)),
  );
  expect(
    hit.length,
    `index.html has ${hit.length} \`${prop}\` on \`${selector}\`` +
      (media ? ` inside @media …${media}…` : ' at top level') +
      ' — expected exactly one',
  ).toBe(1);
  return hit[0];
}

/** The first `#rrggbb` in a value, lowercased. `border: 1px solid #x` included. */
function hexOf(value: string): string {
  const m = value.match(/#[0-9a-fA-F]{3,6}\b/);
  expect(m, `no colour in \`${value}\``).not.toBeNull();
  return m![0].toLowerCase();
}

/**
 * The ledger: which declaration in `index.html` mirrors which palette token.
 *
 * 🔴 PER-DECLARATION, NOT A SET COMPARISON. Comparing the SET of colours in the
 * stylesheet against the set of expected ones would pass while `surface` and
 * `surfaceRaised` were swapped — the panel painted as its own controls and vice
 * versa. Each row below names the surface, so a swap fails on both rows.
 */
const COLOUR_LEDGER: readonly {
  theme: ThemeName;
  selector: string;
  prop: string;
  token: keyof Palette;
}[] = [
  { theme: 'dark', selector: 'html', prop: 'background', token: 'page' },
  { theme: 'dark', selector: CARD, prop: 'background', token: 'surface' },
  { theme: 'dark', selector: CARD, prop: 'border', token: 'border' },
  { theme: 'dark', selector: SHAPE, prop: 'background', token: 'surfaceRaised' },
  { theme: 'light', selector: 'html', prop: 'background', token: 'page' },
  { theme: 'light', selector: CARD, prop: 'background', token: 'surface' },
  { theme: 'light', selector: CARD, prop: 'border-color', token: 'border' },
  { theme: 'light', selector: SHAPE, prop: 'background', token: 'surfaceRaised' },
];

describe('the boot skeleton mirrors the app it precedes', () => {
  it('the manifest still declares bootSkeleton — the whole argument rests on it', () => {
    // 🔴 WITHOUT THIS FLAG THIS FILE IS GRADING THE WRONG THING. If the host puts
    // its own veil back up, `index.html` stops being the loading state and the
    // colour match stops mattering. The pairing is load-bearing in both directions
    // (declaring the flag over an empty #root is worse than not opting in), so the
    // flag is asserted where the skeleton is asserted.
    const manifest = JSON.parse(readFileSync('block.manifest.json', 'utf8'));
    expect(manifest.bootSkeleton).toBe(true);
  });

  it.each(COLOUR_LEDGER)(
    '$theme: $selector $prop is palette.$theme.$token',
    ({ theme, selector, prop, token }) => {
      const decl = find(selector, prop, theme === 'light' ? LIGHT : null);
      expect(hexOf(decl.value)).toBe(palette[theme][token].toLowerCase());
    },
  );

  it('every colour in the stylesheet is accounted for by the ledger', () => {
    // 🔴 THE CLOSING HALF. The rows above prove the values the ledger KNOWS about
    // are right; this proves there are no others. Without it a new surface could be
    // painted in any colour at all and the guard would stay green while reading as
    // coverage.
    const inSheet = new Set(
      [...styleSheet().matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((m) => m[0].toLowerCase()),
    );
    const expected = new Set(
      COLOUR_LEDGER.map(({ theme, token }) => palette[theme][token].toLowerCase()),
    );
    const unaccounted = [...inSheet].filter((h) => !expected.has(h));
    expect(
      unaccounted,
      `index.html paints ${unaccounted.join(', ')}, which no palette token in the ledger ` +
        `accounts for. Add it to COLOUR_LEDGER (and to the palette) or take it out of the ` +
        `stylesheet — an unlisted colour is the drift this guard exists to prevent.`,
    ).toEqual([]);
  });

  it('the skeleton is INSIDE #root, or it never gets replaced', () => {
    // React's `createRoot(container).render()` clears the container's children on
    // first commit, which is the only reason no removal code is needed. A skeleton
    // painted as a SIBLING of #root stays on screen after mount.
    const root = INDEX_HTML.match(/<div id="root">([\s\S]*?)<\/div>\s*<script/);
    expect(root, 'index.html no longer has a #root wrapping the skeleton').not.toBeNull();
    expect(root![1]).toContain('data-boot-skeleton');
  });

  it('the skeleton carries no inline style — every colour stays in the stylesheet', () => {
    // The completeness check above reads the `<style>` block, so a `style="..."`
    // attribute in the markup would be a colour it structurally cannot see.
    const body = INDEX_HTML.slice(INDEX_HTML.indexOf('<body>'));
    expect(body).not.toMatch(/<[^>]*\sstyle=/);
  });
});

describe('the boot skeleton mirrors the SHELL, not a guessed inset', () => {
  it('its padding is SHELL_PADDING', () => {
    // The comment on this rule claims it mirrors `shellStyle`. `shellStyle`'s inset
    // is `SHELL_PADDING`, which `railStyle` also derives from — so this is the third
    // reader of one number and the only one written as a literal.
    expect(find('[data-boot-skeleton]', 'padding', null).value).toBe(`${SHELL_PADDING}px`);
  });

  it.each([
    ['min-height', '100dvh'],
    ['display', 'flex'],
    ['justify-content', 'center'],
    ['align-items', 'flex-start'],
    ['box-sizing', 'border-box'],
  ])('its %s matches shellStyle (%s)', (prop, value) => {
    // Asserted as literals because `shellStyle` writes them as literals too; the
    // claim being pinned is that the two agree, and jsdom cannot compare them for us.
    expect(find('[data-boot-skeleton]', prop, null).value).toBe(value);
  });
});

describe('the boot skeleton width ladder is layoutForTier’s', () => {
  /**
   * The three rungs, read off the layout function rather than written down.
   *
   * 🔴 THE 640px CAP WAS THE SECOND HALF OF THE DEFECT. `layoutForTier` caps at 640
   * on one column, 1184 on two and NOT AT ALL from `lg` up; the skeleton capped at
   * 640 everywhere. So on a 1905px full-page block the boot card was 640px and the
   * app that replaced it was ~1857px — a width jump on top of the colour jump.
   *
   * The media queries are VIEWPORT queries, which is legitimate here and nowhere
   * else in this app: inside the block's sandboxed iframe the viewport IS the box
   * `useBlockBreakpoint` measures (its own docs: `document.documentElement` "inside
   * the sandbox IS the slot the host handed us"), so the skeleton and the app change
   * shape at the same widths. `layout.ts` explains why a CONTAINER query is not an
   * option — a query prelude cannot read `--civitai-bp-*`.
   */
  it('the base rung is the one-column cap', () => {
    const cap = layoutForTier('base').maxWidth;
    expect(cap, 'the one-column cap became uncapped — the ladder moved').not.toBeNull();
    expect(find(CARD, 'max-width', null).value).toBe(`${cap}px`);
  });

  it('the sm rung is the two-column cap, at the sm breakpoint', () => {
    const cap = layoutForTier('sm').maxWidth;
    expect(cap).not.toBeNull();
    const decl = find(CARD, 'max-width', 'min-width: 768px');
    expect(decl.value).toBe(`${cap}px`);
  });

  it('the lg rung drops the cap, because layoutForTier does', () => {
    expect(layoutForTier('lg').maxWidth).toBeNull();
    const decl = find(CARD, 'max-width', 'min-width: 1184px');
    expect(decl.value).toBe('none');
  });

  it('the two media breakpoints are the SDK’s sm and lg, not round numbers', () => {
    // 🔴 THE PIN THAT MAKES THE LADDER MEAN SOMETHING. 768 and 1184 are civitai's
    // PX scale, which is NOT Mantine's stock em scale (576 / 768 / 992 / 1200 /
    // 1408) — the two agree on `sm` alone. Written as literals here, they would be a
    // coincidence a reader has to check; asserted against `resolveBlockTier` they are
    // the boundary they claim to be.
    const conditions = DECLS.filter((d) => d.selector === CARD && d.media?.includes('min-width'))
      .map((d) => d.media!)
      .filter((m, i, a) => a.indexOf(m) === i);
    expect(conditions).toEqual(['(min-width: 768px)', '(min-width: 1184px)']);
  });
});
