import { readFileSync } from 'node:fs';

import { resolveBlockTier } from '@civitai/blocks-react';
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
// placeholder behind one. It previously painted the W6 pack's old greys inside a
// 640px cap. That agreed with the app while the app was also 640px of pack
// greys; once the app became a full-width `page`-grounded layout with a rail,
// the boot state jumped BOTH colour and width at mount — on the full-page
// surface at 1905px, a 640px dark-grey card centred on near-black snapping to a
// full-width `page`. Its own comment claimed it "mirrors the `shell` style in
// src/App.tsx", which had become false at every tier from `sm` up.
//
// 🔴 AND FIXING IT CREATED THE HAZARD THIS FILE CLOSES. `index.html` is static:
// it cannot import `palette.ts` or call `layoutForTier`, so every value moved
// onto the palette is a SECOND COPY of a number TypeScript owns. A silently
// drifting duplicate is worse than the mismatch it replaced, because it reads as
// deliberate. So the rules below are parsed out of the shipped HTML and compared
// against their sources. The reasoning lives HERE and not in the document: the
// built `dist/index.html` ships to every viewer, and internal commentary — which
// at one point still quoted the three RETIRED greys as if they were live values —
// is not something to hand out with the page.
//
// 🔴 THE COMPARISON IS CLOSED BY DECLARATION, NOT BY VALUE. An earlier version
// closed it by scanning the stylesheet for `#rrggbb` and demanding every hex be a
// ledger colour. That was walkable twice over: `body { background: white }` and
// `background: rgb(255, 0, 0)` both passed, because neither is a hex. So the
// closing check now compares the SET OF COLOUR-BEARING DECLARATIONS against the
// ledger's own rows — a paint on a selector the ledger does not name fails on its
// property, whatever syntax its value is written in.
// ===========================================================================

const INDEX_HTML = readFileSync('index.html', 'utf8');

/**
 * The inline `<style>` block of an HTML document — the only part that PAINTS.
 *
 * 🔴 HTML COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT TIDINESS. `index.html`'s
 * own comment quotes the tag name of this very block ("parses this `<style>`
 * block"), so a non-greedy `<style>…</style>` match run over the raw document
 * opens inside the COMMENT and captures prose along with the rules. That was a
 * real failure of this parser, and the case below proves the hazard is still live
 * in the document as shipped rather than asserting it from memory.
 *
 * Takes the document as an argument so that case can feed it one.
 */
function styleSheetOf(doc: string): string {
  const withoutComments = doc.replace(/<!--[\s\S]*?-->/g, ' ');
  const m = withoutComments.match(/<style>([\s\S]*?)<\/style>/);
  expect(m, 'no inline <style> block').not.toBeNull();
  // And CSS comments too, so a hex named in prose inside the block is not a rule.
  return m![1].replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const styleSheet = () => styleSheetOf(INDEX_HTML);

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
const LIGHT = '(prefers-color-scheme: light)';

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

/**
 * The first colour in a value, as a 6-digit lowercase hex. `border: 1px solid #x`
 * included.
 *
 * Shorthand is EXPANDED rather than compared as written: `#fff` and `#ffffff` are
 * the same colour, and a guard that failed on the short spelling with "no palette
 * token accounts for #fff" would be reporting a formatting preference as drift.
 */
function hexOf(value: string): string {
  const m = value.match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/);
  expect(m, `no hex colour in \`${value}\``).not.toBeNull();
  const h = m![1];
  return ('#' + (h.length === 3 ? [...h].map((c) => c + c).join('') : h)).toLowerCase();
}

/**
 * Does this property paint a colour? Wide on purpose — the closing check below is
 * only as closed as this predicate, so anything that can carry a colour counts,
 * and `border-radius` / `box-sizing` deliberately do not.
 */
function paintsAColour(prop: string): boolean {
  return (
    /color$/.test(prop) ||
    /^(background(-image)?|border(-(top|right|bottom|left))?|outline|box-shadow|text-shadow|column-rule|text-decoration|fill|stroke)$/.test(
      prop,
    )
  );
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
  media: string | null;
  selector: string;
  prop: string;
  token: keyof Palette;
}[] = [
  { theme: 'dark', media: null, selector: 'html', prop: 'background', token: 'page' },
  { theme: 'dark', media: null, selector: CARD, prop: 'background', token: 'surface' },
  { theme: 'dark', media: null, selector: CARD, prop: 'border', token: 'border' },
  { theme: 'dark', media: null, selector: SHAPE, prop: 'background', token: 'surfaceRaised' },
  { theme: 'light', media: LIGHT, selector: 'html', prop: 'background', token: 'page' },
  { theme: 'light', media: LIGHT, selector: CARD, prop: 'background', token: 'surface' },
  { theme: 'light', media: LIGHT, selector: CARD, prop: 'border-color', token: 'border' },
  { theme: 'light', media: LIGHT, selector: SHAPE, prop: 'background', token: 'surfaceRaised' },
];

/** `media | selector | prop`, the identity the closing check compares on. */
const declKey = (media: string | null, selector: string, prop: string) =>
  `${media ?? '<top level>'} | ${selector} | ${prop}`;

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
    ({ theme, media, selector, prop, token }) => {
      expect(hexOf(find(selector, prop, media).value)).toBe(palette[theme][token].toLowerCase());
    },
  );

  it('every colour-bearing DECLARATION in the stylesheet is in the ledger', () => {
    // 🔴 THE CLOSING HALF, AND IT IS A PROPERTY CHECK RATHER THAN A VALUE SCAN —
    // see the file header for why the value scan this replaces was walkable by
    // `background: white` and by `rgb(255, 0, 0)`. A paint on a selector the ledger
    // does not name now fails on its PROPERTY, before its value is ever read.
    const inSheet = DECLS.filter((d) => paintsAColour(d.prop)).map((d) =>
      declKey(d.media, d.selector, d.prop),
    );
    const expected = COLOUR_LEDGER.map((r) => declKey(r.media, r.selector, r.prop));

    expect(
      inSheet.filter((k) => !expected.includes(k)),
      `index.html paints a colour the ledger does not account for. Add it to ` +
        `COLOUR_LEDGER (and to the palette) or take it out of the stylesheet — an ` +
        `unlisted paint is the drift this guard exists to prevent.`,
    ).toEqual([]);
    // And the other direction, so a ledger row cannot outlive the rule it describes.
    expect(expected.filter((k) => !inSheet.includes(k)), 'a ledger row names no rule').toEqual([]);
  });

  it('expands shorthand hex, so `#fff` is not reported as drift', () => {
    // The converse of the check above: `#fff` IS `palette.light.surface`, and a
    // guard that failed on it would be reporting a spelling as a colour change.
    expect(hexOf('background: #fff')).toBe('#ffffff');
    expect(hexOf('border: 1px solid #D2D9E4')).toBe('#d2d9e4');
  });

  it('the parser reads the stylesheet, not a `<style>` named inside a comment', () => {
    // 🔴 THE POSITIVE CONTROL ON THE INSTRUMENT, taken from the LIVE document. The
    // raw non-greedy match and the comment-stripped one must DISAGREE — that is what
    // proves index.html still mentions `<style>` in prose and that the stripping is
    // doing work, rather than being a defence against a hazard that has since gone.
    const raw = INDEX_HTML.match(/<style>([\s\S]*?)<\/style>/)![1];
    expect(raw, 'index.html no longer names `<style>` in a comment — this control is inert').not.toBe(
      styleSheet(),
    );
    // Negative control: the stripped read must not drag prose in with the rules.
    expect(styleSheet()).not.toContain('boot-skeleton.test.ts');
    expect(styleSheet()).toContain('[data-boot-skeleton]');
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
    // The closing check above reads the `<style>` block, so a `style="..."`
    // attribute in the markup would be a paint it structurally cannot see.
    const body = INDEX_HTML.slice(INDEX_HTML.indexOf('<body>'));
    expect(body).not.toMatch(/<[^>]*\sstyle=/);
  });
});

describe('the boot skeleton mirrors the SHELL, not a guessed inset', () => {
  it('its padding is SHELL_PADDING', () => {
    // The comment on this rule claims it mirrors `shellStyle`. `shellStyle`'s inset
    // is `SHELL_PADDING`, which `railStyle` and the rung offsets below also derive
    // from — so this is the fourth reader of one number and the only one written as
    // a literal.
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

// ---------------------------------------------------------------------------
// THE WIDTH LADDER — pinned against the box the app MEASURES, not the viewport.
// ---------------------------------------------------------------------------

/**
 * The px inset the shell puts between the block's edge and its content, doubled.
 *
 * 🔴 THIS IS THE WHOLE OF THE DEFECT THAT WAS HERE, AND IT SURVIVED TWO WRITE-UPS
 * OF ITS OWN CORRECTION. The skeleton's rungs are VIEWPORT media queries, which is
 * legitimate — `layout.ts` explains why a container query is not an option — but
 * the app does NOT switch tier on the viewport. `App.tsx` passes `rootRef` to
 * `useBlockBreakpoint`, and that element carries `padding: SHELL_PADDING`; its
 * steady-state reading is `ResizeObserver`'s `contentRect.width`, so the width the
 * app grades is the viewport LESS 48px. Two comments here and in `index.html`
 * asserted the opposite ("inside the sandbox the viewport IS the box the app
 * measures") one round after `ULTRAWIDE_MIN`'s docblock had retracted exactly that
 * sentence.
 *
 * MEASURED consequence of the un-offset rungs, at the commit before this one: for
 * every viewport in 768–815 the boot card and the app's settled column disagreed —
 * 48 widths, worst case 127px at 815px (card 767, column 640). Offsetting both
 * rungs by this inset takes the disagreement to zero across 300–2600px, which is
 * the sweep below.
 *
 * One frame of disagreement remains and is not papered over: the SEED taken right
 * after `observe()` reads `el.clientWidth`, the PADDING box, so an unsettled app
 * resolves its tier from the raw viewport for one frame. That is
 * `useBlockBreakpoint`'s own seed/steady split (see `ULTRAWIDE_MIN`), and the
 * skeleton is matched to the width the viewer ends up looking at.
 */
const SHELL_INSET = SHELL_PADDING * 2;

/** The cap the stylesheet declares at each viewport rung, narrowest first. */
function declaredRungs(): { at: number; cap: number | null }[] {
  const capOf = (value: string): number | null => {
    if (value === 'none') return null;
    const m = value.match(/^(\d+)px$/);
    expect(m, `unreadable max-width \`${value}\``).not.toBeNull();
    return Number(m![1]);
  };
  const rungs = [{ at: 0, cap: capOf(find(CARD, 'max-width', null).value) }];
  for (const d of DECLS.filter(
    (d) => d.selector === CARD && d.prop === 'max-width' && d.media?.includes('min-width'),
  )) {
    const m = d.media!.match(/min-width:\s*(\d+)px/);
    expect(m, `unreadable media condition \`${d.media}\``).not.toBeNull();
    rungs.push({ at: Number(m![1]), cap: capOf(d.value) });
  }
  return rungs.sort((a, b) => a.at - b.at);
}

const RUNGS = declaredRungs();

/** Border-box width of the boot card at `viewport`, from the parsed stylesheet. */
function skeletonCardWidth(viewport: number, rungs = RUNGS): number {
  const available = viewport - SHELL_INSET;
  let cap: number | null = null;
  for (const r of rungs) if (viewport >= r.at) cap = r.cap;
  return cap === null ? available : Math.min(available, cap);
}

/**
 * Border-box width of the app's content column at `viewport`, once settled.
 *
 * `contentStyle` is `{ width: '100%', maxWidth: layout.maxWidth ?? undefined }`
 * inside the shell's content box — so this is the app's own two functions, read
 * through the SDK's real `resolveBlockTier`, not a restatement of them.
 */
function appColumnWidth(viewport: number): number {
  const measured = viewport - SHELL_INSET;
  const cap = layoutForTier(resolveBlockTier(measured)).maxWidth;
  return cap === null ? measured : Math.min(measured, cap);
}

/** Narrowest viewport whose MEASURED box resolves to `tier`. */
function firstViewportFor(tier: string): number {
  for (let v = SHELL_INSET + 1; v <= 4000; v++) {
    if (resolveBlockTier(v - SHELL_INSET) === tier) return v;
  }
  throw new Error(`no viewport in range resolves to ${tier}`);
}

describe('the boot skeleton width ladder is the app’s own, offset by the shell inset', () => {
  it('the base rung is the one-column cap', () => {
    const cap = layoutForTier('base').maxWidth;
    expect(cap, 'the one-column cap became uncapped — the ladder moved').not.toBeNull();
    expect(RUNGS[0]).toEqual({ at: 0, cap });
  });

  it('the second rung is the two-column cap, at the viewport where the app reaches sm', () => {
    // 🔴 DERIVED, NOT WRITTEN DOWN. An earlier version of this file claimed the
    // rungs were "asserted against `resolveBlockTier`" while asserting two literal
    // strings and never importing it. Both numbers now come out of the SDK.
    expect(RUNGS[1]).toEqual({ at: firstViewportFor('sm'), cap: layoutForTier('sm').maxWidth });
  });

  it('the third rung drops the cap, at the viewport where the app reaches lg', () => {
    expect(layoutForTier('lg').maxWidth).toBeNull();
    expect(RUNGS[2]).toEqual({ at: firstViewportFor('lg'), cap: null });
  });

  it('there are exactly three rungs', () => {
    // A fourth would be a shape the app does not change at, and would escape the
    // two assertions above without failing either of them.
    expect(RUNGS).toHaveLength(3);
  });

  it('the two ladders coincide at every viewport from 300 to 2600px', () => {
    // 🔴 THE GUARD THAT WOULD HAVE CAUGHT THE 48px ERROR, and the reason it is a
    // SWEEP rather than a rung comparison: the rungs can be individually defensible
    // and still put the card at a different width from the column, because the cap
    // and the available width interact. This compares the two WIDTHS.
    const mismatches: string[] = [];
    for (let v = 300; v <= 2600; v++) {
      const card = skeletonCardWidth(v);
      const column = appColumnWidth(v);
      if (card !== column) mismatches.push(`${v}px: card ${card} vs column ${column}`);
    }
    expect(
      mismatches.slice(0, 8),
      `the boot card and the app's settled column disagree at ${mismatches.length} viewport ` +
        `width(s) — a viewer sees the block change width at mount. First few:`,
    ).toEqual([]);
  });

  it('the sweep CAN see a disagreement — positive control', () => {
    // 🔴 WITHOUT THIS, THE ZERO ABOVE IS INDISTINGUISHABLE FROM A SWEEP THAT
    // COMPARES A NUMBER WITH ITSELF. The control is the exact defect: the rungs at
    // the RAW breakpoints instead of the offset ones. It must reproduce the measured
    // band 768–815 and the 127px worst case.
    const unoffset = RUNGS.map((r) => ({ at: r.at === 0 ? 0 : r.at - SHELL_INSET, cap: r.cap }));
    const bad: number[] = [];
    let worst = 0;
    for (let v = 300; v <= 2600; v++) {
      const card = skeletonCardWidth(v, unoffset);
      const column = appColumnWidth(v);
      if (card !== column) {
        bad.push(v);
        worst = Math.max(worst, Math.abs(card - column));
      }
    }
    expect(bad.length, 'the un-offset ladder agrees everywhere — the sweep proves nothing').toBe(48);
    expect([bad[0], bad[bad.length - 1]]).toEqual([768, 815]);
    expect(worst).toBe(127);
  });
});
