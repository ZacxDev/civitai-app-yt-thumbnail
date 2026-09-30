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

function find(selector: string, prop: string, media: string | null, decls: readonly Decl[] = DECLS): Decl {
  const hit = decls.filter(
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
 * Properties that CANNOT carry a colour. Everything else can, and counts.
 *
 * 🔴 A DENYLIST, BECAUSE AN ALLOWLIST CANNOT BE "WIDE ON PURPOSE". The previous
 * version of this was an allowlist whose docstring claimed "anything that can carry
 * a colour counts" while the pattern named eleven properties. DEMONSTRATED: adding
 * `border-image: linear-gradient(#ff0000, #00ff00) 1` to the boot card ships two
 * off-palette colours with the whole suite green, and `filter: drop-shadow(...)`,
 * `border-inline-start`, `border-block`, `-webkit-text-stroke` and `caret-color`
 * were all equally invisible. Enumerating the colour-bearing half of CSS is not a
 * thing anyone finishes; enumerating the 12 of this stylesheet's 15 distinct
 * properties that cannot paint is, and it fails in the safe direction — one nobody has
 * classified reads as a paint and has to be either put in the ledger or declared
 * here, which is a deliberate act either way.
 */
const CARRIES_NO_COLOUR: readonly string[] = [
  'align-items',
  'border-radius',
  'box-sizing',
  'display',
  'height',
  'justify-content',
  'margin',
  'margin-bottom',
  'max-width',
  'min-height',
  'padding',
  'width',
];

function paintsAColour(prop: string): boolean {
  return !CARRIES_NO_COLOUR.includes(prop);
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

/** The closing check's own read, as a function of the declarations, so it can be
 * fed a mutated stylesheet by the control below. */
function unledgeredPaints(decls: readonly Decl[]): string[] {
  const expected = COLOUR_LEDGER.map((r) => declKey(r.media, r.selector, r.prop));
  return decls
    .filter((d) => paintsAColour(d.prop))
    .map((d) => declKey(d.media, d.selector, d.prop))
    .filter((k) => !expected.includes(k));
}

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
    expect(
      unledgeredPaints(DECLS),
      `index.html paints a colour the ledger does not account for. Add it to ` +
        `COLOUR_LEDGER (and to the palette), take it out of the stylesheet, or — if the ` +
        `property genuinely cannot carry a colour — add it to CARRIES_NO_COLOUR. An ` +
        `unlisted paint is the drift this guard exists to prevent.`,
    ).toEqual([]);

    // And the other direction, so a ledger row cannot outlive the rule it describes.
    const inSheet = DECLS.filter((d) => paintsAColour(d.prop)).map((d) =>
      declKey(d.media, d.selector, d.prop),
    );
    const expected = COLOUR_LEDGER.map((r) => declKey(r.media, r.selector, r.prop));
    expect(
      expected.filter((k) => !inSheet.includes(k)),
      `a ledger row names no rule in the stylesheet.\n` +
        `🔴 IF THE MISSING ROW IS A \`dark\` ONE, DO NOT REPAIR IT BY GIVING THAT ROW A ` +
        `MEDIA CONDITION. The dark rules are the BASE rules on purpose — there is ` +
        `deliberately no \`prefers-color-scheme: dark\` block, and light is the only ` +
        `override — because a UA that reports \`no-preference\` matches NEITHER \`dark\` ` +
        `NOR \`light\`, so a sheet with one block per theme and no base paint leaves that ` +
        `viewer on the browser's own default: an unstyled flash on the surface this file ` +
        `exists to keep steady. Move the RULE back to top level, not the ledger row into ` +
        `a media query.`,
    ).toEqual([]);
  });

  it('there is deliberately NO `prefers-color-scheme: dark` block', () => {
    // 🔴 THE REASONING THAT USED TO LIVE IN `index.html` AND MUST NOT GO BACK THERE:
    // the built document ships to every viewer, so the argument lives here while the
    // invariant is pinned mechanically. `prefers-color-scheme` has THREE states, not
    // two — `dark`, `light`, and `no-preference` — and a UA reporting the third
    // matches neither media query. So the dark theme is the unconditional base and
    // `light` is the only override; symmetrising the sheet into two blocks would
    // leave a `no-preference` viewer with no paint at all.
    //
    // Pinned in both shapes it can be broken: the condition appearing at all, and a
    // dark ledger row acquiring a media condition (which is what the sibling check's
    // failure message warns against).
    expect(styleSheet(), 'the boot stylesheet grew a dark media block').not.toMatch(
      /prefers-color-scheme\s*:\s*dark/,
    );
    expect(
      COLOUR_LEDGER.filter((r) => r.theme === 'dark').map((r) => r.media),
      'a dark ledger row moved under a media condition',
    ).toEqual([null, null, null, null]);
  });

  it('a property outside CARRIES_NO_COLOUR is read as a paint — positive control', () => {
    // 🔴 WITHOUT THIS THE ZERO ABOVE IS A CLAIM ABOUT ELEVEN PROPERTY NAMES. Both of
    // these ship two off-palette colours each and were invisible to the allowlist
    // this replaced; `filter` is the one that is not even spelled like a colour.
    const mutated = parseCss(
      `${CARD} { border-image: linear-gradient(#ff0000, #00ff00) 1; filter: drop-shadow(0 0 2px #ff00ff); }`,
    );
    expect(unledgeredPaints(mutated)).toEqual([
      declKey(null, CARD, 'border-image'),
      declKey(null, CARD, 'filter'),
    ]);
  });

  it('CARRIES_NO_COLOUR names only properties the stylesheet actually uses', () => {
    // A denylist is the safe direction only while it stays a record of THIS
    // stylesheet. An entry for a property no rule declares is either dead weight or
    // someone widening the exemption ahead of the paint it will excuse.
    const used = new Set(DECLS.map((d) => d.prop));
    expect(CARRIES_NO_COLOUR.filter((p) => !used.has(p))).toEqual([]);
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
 * TWO frames of disagreement remain, and the earlier of the two was left out of the
 * previous version of this note. Neither is changed here: this file grades the
 * stylesheet, the app's mount sequence is `useBlockBreakpoint`'s, and there is no
 * browser driver in this suite to observe either frame — so they are DISCLOSED, not
 * fixed, and not claimed to have been seen.
 *
 *   1. `useBlockBreakpoint` holds its tier in `useState(null)` and seeds inside
 *      `useEffect`, i.e. after the first commit. So the app's FIRST paint resolves no
 *      tier at all and falls back to `base` — a 640px column at every viewport width,
 *      including the ones where the skeleton has just drawn a full-width card.
 *   2. The seed itself then reads `el.clientWidth`, the PADDING box, so the second
 *      frame resolves the tier from the raw viewport rather than the content box —
 *      `useBlockBreakpoint`'s own seed/steady split, as `ULTRAWIDE_MIN` describes.
 *
 * At a 1000px viewport that is: skeleton 952 → 640 → 952 → 952. The steady state is
 * the width the viewer ends up looking at, and it is the one the sweep below pins.
 */
const SHELL_INSET = SHELL_PADDING * 2;

interface Ladder {
  /** The cap the stylesheet declares at each viewport rung, narrowest first. */
  rungs: { at: number; cap: number | null }[];
  /** Media conditions capping the card that this reader cannot express as a rung. */
  unreadable: string[];
}

/**
 * The card's declared width ladder.
 *
 * 🔴 IT COLLECTS EVERY MEDIA-SCOPED `max-width` ON THE CARD AND REPORTS THE ONES IT
 * CANNOT READ, rather than FILTERING for `min-width` and walking past the rest. The
 * filter was the bug: a `@media (max-width: 500px)` cap on the card was invisible to
 * this reader, so it escaped the sweep AND the "exactly three rungs" guard at once —
 * DEMONSTRATED green with a fourth rung that put the card at a width the app never
 * settles on below 500px. Returned rather than asserted on the spot, because this
 * runs at module scope: a throw here fails COLLECTION, which reports as "no tests"
 * and reads like a broken suite instead of a named finding.
 */
function declaredLadder(decls: readonly Decl[] = DECLS): Ladder {
  const capOf = (value: string): number | null => {
    if (value === 'none') return null;
    const m = value.match(/^(\d+)px$/);
    expect(m, `unreadable max-width \`${value}\``).not.toBeNull();
    return Number(m![1]);
  };
  const rungs = [{ at: 0, cap: capOf(find(CARD, 'max-width', null, decls).value) }];
  const unreadable: string[] = [];
  for (const d of decls.filter(
    (d) => d.selector === CARD && d.prop === 'max-width' && d.media !== null,
  )) {
    const m = d.media!.match(/^\(\s*min-width:\s*(\d+)px\s*\)$/);
    if (m) rungs.push({ at: Number(m[1]), cap: capOf(d.value) });
    else unreadable.push(d.media!);
  }
  return { rungs: rungs.sort((a, b) => a.at - b.at), unreadable };
}

const LADDER = declaredLadder();
const RUNGS = LADDER.rungs;

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

  it('every rung the stylesheet declares is one this reader can express', () => {
    expect(
      LADDER.unreadable,
      `index.html caps the boot card inside a media condition this file cannot read as ` +
        `a rung. Every rung must be a bare \`(min-width: Npx)\`, because that is the only ` +
        `shape the sweep and the rung count can grade — a \`max-width\` or compound ` +
        `condition used to be SKIPPED here, which is how a fourth rung escaped both of ` +
        `them. Rewrite it as a min-width rung or teach this reader the new shape; do not ` +
        `delete this assertion.`,
    ).toEqual([]);
  });

  it('a `max-width` rung is SEEN, not skipped — positive control', () => {
    // 🔴 THE HOLE THE `min-width` FILTER LEFT, AS THE SHAPE THAT WALKED IT. A fourth
    // rung written as a max-width query was skipped by the reader, so `RUNGS` still
    // had three entries, the count guard passed, and the sweep compared a ladder the
    // stylesheet does not actually declare. Both halves are asserted: that it is
    // reported, and that the report NAMES the condition rather than only counting it.
    const fourth = parseCss(`@media (max-width: 500px) { ${CARD} { max-width: 300px; } }`);
    expect(fourth).toHaveLength(1);

    const withFourth = declaredLadder([...DECLS, ...fourth]);
    expect(withFourth.unreadable).toEqual(['(max-width: 500px)']);
    // And the three real rungs are still read without complaint, so the insistence is
    // on the SHAPE and not on there being no media queries at all.
    expect(withFourth.rungs).toHaveLength(3);
    expect(declaredLadder([...DECLS]).unreadable).toEqual([]);
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
