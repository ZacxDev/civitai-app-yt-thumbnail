import { readFileSync, readdirSync } from 'node:fs';

import { render, screen } from '@testing-library/react';
import ts from 'typescript';
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
// So the two guards below grade the two things that actually discriminate:
//
//   A. NO COLOUR LITERAL MAY APPEAR IN THE CODE OF ANY NON-TEST TYPESCRIPT FILE
//      UNDER `src/`, except in `withAlpha` and in the four files named in
//      `EXEMPT` below. A hex, `rgb()` or `hsl()` anywhere else is a colour that
//      did not come from a `Palette`, whatever theme it happens to suit.
//
//   B. EVERY TEXT COLOUR THE APP PAINTS IS GRADED AGAINST ITS OWN RESOLVED
//      GROUND, in both themes, by walking the rendered DOM. This is the
//      relationship the hazard is actually about — not "is this colour in the
//      palette" but "can this text be read where it sits" — and it is what makes
//      the mutant fail: 1.055:1 against `AA_TEXT`'s 4.5.
//
// 🔴 WHAT EACH GUARD IS AND IS NOT, STATED PRECISELY, BECAUSE THE PREVIOUS
// VERSION OF THIS PARAGRAPH OVERCLAIMED BOTH. It said "a surface added tomorrow
// is covered the moment it is written" and "neither guard names a surface, so
// neither can be out of date". Guard A was at the time a two-entry FILE ledger,
// and the same off-palette literal moved verbatim into a new `src/` file passed;
// its comment stripper was also string-unaware, so a `//` inside a `url(...)`
// blanked the rest of the line INSIDE a file it did cover. Both are closed below.
// The honest statements now:
//
//   * Guard A's file set is DERIVED from the directory, so a new FILE is covered
//     the moment it is written. What can go stale is the `EXEMPT` list, which is
//     therefore asserted to name only files that still exist.
//   * Guard A reads TypeScript only. `src/index.css` paints, and Guard A cannot
//     see it; `palette.test.ts` and Guard B cover what that stylesheet does.
//   * Guard B names no surface at all, but it grades TEXT against its ground. A
//     BORDER or a BACKGROUND colour is never graded for contrast by either guard
//     — Guard A is the only thing standing between those and an off-palette
//     value, which is why widening Guard A's file set mattered.
// ===========================================================================

// ---------------------------------------------------------------------------
// GUARD A — no colour may enter the app's own code except through a Palette.
// ---------------------------------------------------------------------------

/**
 * The ONE regex, used by the guard AND by its positive control.
 *
 * 🔴 HOISTED BECAUSE THE CONTROL USED TO RE-WRITE IT. The control below existed to
 * prove "the zero above is not a dead pattern", and it inlined a second copy of
 * this literal — so it validated a DUPLICATE. Measured: replacing the guard's copy
 * with `/ZZZZZZNOMATCH/g` left the whole suite green, which is precisely the state
 * the control claimed to rule out. There is now one expression and one reader of
 * it, so mutating it takes the control down with the guard.
 */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/g;

/**
 * The ONE place a colour literal is legitimate in a covered file: `withAlpha` builds
 * an `rgba()` string out of a token it was handed, so the literal is the
 * FUNCTION's syntax, not a colour choice. Named rather than counted — a count
 * would still pass if the allowed occurrence moved into a surface.
 */
const LITERAL_ALLOWED_IN = 'withAlpha';

/**
 * Files that may name a colour, each with the reason it may.
 *
 * 🔴 AN EXEMPTION LIST, NOT A COVERAGE LIST, AND THE DIRECTION IS THE POINT. The
 * set Guard A scans is whatever is in the directory minus these four, so a file
 * added tomorrow is scanned without anyone remembering to add it. The previous
 * shape was the opposite — two files named as covered — and it let the identical
 * off-palette border literal live in a new `src/` module with the suite green.
 */
const EXEMPT: readonly { file: string; why: string }[] = [
  { file: 'src/palette.ts', why: 'the palette itself: this is where the colours are DEFINED' },
  {
    file: 'src/main.tsx',
    why: "the dev harness banner's own chrome, gated behind VITE_DEV_HARNESS and pinned to data-theme=dark — deliberately not themed, because it is not part of the block",
  },
  { file: 'src/Harness.tsx', why: 'the dev harness terminal chrome, same gate, same reason' },
  {
    file: 'src/editor.ts',
    why: "DEFAULT_TEXT_OVERLAY's text and stroke colours: a default the viewer edits with a colour input and which is drawn ONTO the image, not painted as an app surface",
  },
];

/** Every non-test `.ts`/`.tsx` file under `dir`, recursively. */
function tsSourcesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) tsSourcesUnder(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const ALL_SOURCES = tsSourcesUnder('src');
const COVERED_FILES = ALL_SOURCES.filter((f) => !EXEMPT.some((e) => e.file === f));

/**
 * Blank out comments, LEAVING STRING LITERALS INTACT — using TypeScript's OWN
 * parser, because both hand-rolled versions of this were holes inside the files
 * Guard A covered.
 *
 * 🔴 VERSION 1, A `replace` OF "SLASH SLASH TO END OF LINE", WAS STRING-UNAWARE.
 * One line of `App.tsx` —
 * `backgroundImage: 'url(https://cdn…/x.png)', border: '1px solid #2A313D',` —
 * had everything after the URL's `//` blanked, and the off-palette border was
 * invisible to the scanner with the suite green.
 *
 * 🔴 VERSION 2, A FOUR-STATE CHARACTER WALK, MOVED THE HOLE INTO REGEX LITERALS,
 * AND IT WAS LIVE. The walk tracked `'`/`"`/`` ` ``/`${…}` but read a regex literal
 * as code, so every quote inside one flipped its quote parity. `setManifestBlockId`
 * in `src/setup-dev-live.ts` holds `/("blockId"\s*:\s*)"[^"]*"/` — five quotes, an
 * odd number — so the walk opened a string at the last one and ran it to the next
 * quote 2,962 characters later. MEASURED against this implementation across the 13
 * covered files: **940 characters of real comment left unstripped, all of them in
 * that file, and 0 characters over-blanked.** So a hex named in prose anywhere in
 * that region was a FALSE finding — and it was live, not hypothetical.
 *
 * The other direction, a literal made INVISIBLE, needed one more step, and getting
 * it wrong is how this would be mis-fixed: version 2 never blanked strings, so an
 * inverted parity could only hide a colour by OVER-blanking. The spurious string
 * ends at the next `'`, which leaves whatever follows sitting in what the walk now
 * thinks is code — so a URL's `//` on that line became a comment start and the walk
 * blanked to end of line. MEASURED on version 2: a bare off-palette hex appended
 * under a `/can't/` was still caught; the same hex written after a URL string on one
 * line went GREEN, and went red again the moment the regex above it was removed.
 * That pair is `a regex literal's apostrophe …` below.
 *
 * HOW THIS ONE WORKS, AND WHY IT HAS NOTHING TO GET WRONG. It parses the file and
 * marks the extent of every leaf TOKEN. Everything else is trivia — whitespace or a
 * comment — by the parser's own definition, so the blanking needs no rule about
 * what a comment looks like, and a regex literal, a JSX text node, a template
 * literal and a string are all single tokens it cannot see inside.
 *
 * 🔴 JSDoc IS THE ONE THING THE TOKEN WALK GETS WRONG, AND IT IS SKIPPED
 * EXPLICITLY. `getChildren()` hands back `/** … *\/` blocks as JSDoc NODES whose
 * text descends into tokens, so without the `FirstJSDocNode`/`LastJSDocNode` skip
 * they are kept rather than blanked. MEASURED: dropping that one line turns
 * `models.ts`'s JSDoc into a finding (`#128078`) and re-attributes `App.tsx`'s
 * `withAlpha` exemption, i.e. it goes red on prose. `a hex inside a JSDoc block …`
 * below is the case that pins it.
 *
 * Replaced with spaces rather than nothing, so offsets stay usable for locating the
 * enclosing function, and `\n` is kept so line numbers survive. TypeScript's
 * positions are UTF-16 code-unit indices — the same units `String.prototype.slice`
 * uses — so the astral-drift bug that `[...src]` caused in version 2 cannot recur
 * here; the case below still pins it.
 *
 * NO RESIDUAL HOLE OF THAT KIND REMAINS: there is no second parser to disagree with
 * the compiler. The one thing this DEPENDS on is that the file parses, and
 * `npm run build` runs `tsc --noEmit` over the same tree before anything ships.
 */
function stripComments(src: string, fileName = 'snippet.ts'): string {
  const source = ts.createSourceFile(
    fileName,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const isToken = new Uint8Array(src.length);
  const mark = (node: ts.Node): void => {
    // See the JSDoc note above: these are comments the token walk would KEEP.
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(source);
    if (children.length === 0) {
      for (let p = node.getStart(source); p < node.end; p++) isToken[p] = 1;
      return;
    }
    for (const child of children) mark(child);
  };
  mark(source);

  let out = '';
  for (let p = 0; p < src.length; p++) out += isToken[p] === 1 || src[p] === '\n' ? src[p] : ' ';
  return out;
}

/** Nearest `function foo` / `const foo =` at or above `offset`. */
function enclosingName(src: string, offset: number): string {
  const before = src.slice(0, offset);
  const matches = [...before.matchAll(/(?:function\s+([A-Za-z0-9_$]+)|const\s+([A-Za-z0-9_$]+)\s*[:=])/g)];
  const last = matches.at(-1);
  return last ? (last[1] ?? last[2] ?? '<unknown>') : '<file scope>';
}

/** Every colour literal in `src`, with the function it sits in. The guard's own read. */
function colourLiterals(src: string): { text: string; where: string }[] {
  return [...src.matchAll(COLOUR_LITERAL)].map((m) => ({
    text: m[0],
    where: enclosingName(src, m.index),
  }));
}

/** …minus the one exemption that is a FUNCTION rather than a file. */
function findingsIn(src: string): { text: string; where: string }[] {
  return colourLiterals(src).filter((f) => f.where !== LITERAL_ALLOWED_IN);
}

describe('GUARD A — no colour literal reaches an app surface', () => {
  it('the scanned set is derived from the directory, and it is not empty', () => {
    // 🔴 REACHABILITY BEFORE VERDICT. A walk that found nothing would pass every
    // per-file case below vacuously — `it.each([])` registers no tests at all — and
    // read as coverage of the whole app.
    expect(COVERED_FILES.length, 'Guard A scanned no files').toBeGreaterThan(5);
    // The two files that draw the app's surfaces must be in the derived set. Named
    // here as an assertion ABOUT the derivation, not as the derivation itself.
    expect(COVERED_FILES).toContain('src/App.tsx');
    expect(COVERED_FILES).toContain('src/FormatPicker.tsx');
  });

  it('every exemption still names a file that exists', () => {
    // A stale exemption is dead weight that reads as a considered decision about a
    // file which may have been deleted or renamed — and it would silently stop
    // covering whatever replaced it.
    for (const { file } of EXEMPT) {
      expect(ALL_SOURCES, `EXEMPT names ${file}, which is no longer a source file`).toContain(file);
    }
  });

  it.each(COVERED_FILES)('%s introduces no colour outside a Palette', (file) => {
    const findings = findingsIn(stripComments(readFileSync(file, 'utf8'), file));

    expect(
      findings,
      `${file} contains ${findings.length} colour literal(s) outside \`${LITERAL_ALLOWED_IN}\`: ` +
        findings.map((f) => `${f.text} in ${f.where}`).join(', ') +
        `. Every colour an app surface paints must come from a \`Palette\` field, or it is ` +
        `correct in at most one theme.`,
    ).toEqual([]);
  });

  it('the guard can SEE a literal — positive control', () => {
    // 🔴 WITHOUT THIS THE ZEROES ABOVE ARE INDISTINGUISHABLE FROM A DEAD PATTERN,
    // and this control only makes that distinction because it goes through
    // `findingsIn` — i.e. through `COLOUR_LITERAL` itself. The mutant is the real
    // one: `color: pal.text` → `color: '#F7F9FC'`, in the function it was
    // demonstrated on.
    const mutated = stripComments(
      readFileSync('src/FormatPicker.tsx', 'utf8'),
      'src/FormatPicker.tsx',
    ).replace('color: pal.text,', "color: '#F7F9FC',");
    expect(mutated, 'the mutation did not apply — the control proves nothing').toContain('#F7F9FC');

    const found = findingsIn(mutated);
    expect(found, 'the guard did not see the injected literal').not.toEqual([]);
    // And it is attributed to the surface that did it, not to the file.
    expect(found.map((f) => f.where)).toContain('cardButtonStyle');
  });

  it('a `//` inside a string does not blank the rest of the line — positive control', () => {
    // 🔴 THE SECOND WALKABLE ROUTE, AS A CASE. The regex stripper this replaces
    // blanked from the URL's `//` to end of line, hiding the border literal that
    // follows it on the same line of real code.
    const line = `const s = { backgroundImage: 'url(https://cdn.example/x.png)', border: '1px solid #2A313D' };`;
    const stripped = stripComments(line);
    expect(stripped, 'the string was treated as a comment').toContain('#2A313D');
    expect(findingsIn(stripped).map((f) => f.text)).toContain('#2A313D');
  });

  it('a real comment IS still blanked, and a string is still left alone', () => {
    // The negative half of the pair above: widening the stripper must not have
    // turned it off. A hex quoted in prose is not a finding; one in a string is.
    expect(findingsIn(stripComments(`// the old grey was #101113\nconst x = 1;`))).toEqual([]);
    expect(findingsIn(stripComments(`/* #101113 */ const x = 1;`))).toEqual([]);
    expect(findingsIn(stripComments(`const x = '#101113';`)).map((f) => f.text)).toEqual(['#101113']);
    // Byte offsets survive blanking, which is what `enclosingName` depends on.
    expect(stripComments(`// abc\nconst q = 1;`)).toHaveLength(`// abc\nconst q = 1;`.length);
  });

  it('an astral character does not shift the offsets `enclosingName` reads', () => {
    // 🔴 A REGRESSION CASE FOR A BUG IN THIS FILE'S OWN STRIPPER, not a hypothetical:
    // blanking through `[...src]` splits by CODE POINT, so each 🔴 cost one UTF-16
    // unit of drift and `withAlpha`'s own `rgba(` was reported against a `const` 14
    // lines above it. Both halves are pinned — the length, and the attribution.
    const src = `/* 🔴🔴 note */\nfunction realOwner() {\n  return '#ABCDEF';\n}\n`;
    const stripped = stripComments(src);
    expect(stripped).toHaveLength(src.length);
    expect(findingsIn(stripped)).toEqual([{ text: '#ABCDEF', where: 'realOwner' }]);
  });

  it('a regex literal’s apostrophe does not invert quote parity', () => {
    // 🔴 THE SHAPE THAT WALKED VERSION 2, AND THE MECHANISM IS WORTH BEING EXACT
    // ABOUT, because the obvious fixture does NOT reproduce it. Version 2 never
    // blanked strings, so an inverted parity could only HIDE a colour by
    // over-blanking: the apostrophe's spurious string ends at the next `'`, which
    // leaves the URL's `//` sitting in what the walk now thinks is code, and the walk
    // blanks from there to end of line — taking the border literal with it. MEASURED:
    // the hex alone under a `/can't/` was still caught; this pair went GREEN, with
    // the same line caught the moment the regex above it was removed.
    const src =
      "export const APOSTROPHE_RE = /can't/;\n" +
      "const s = { backgroundImage: 'url(https://cdn.example/x.png)', border: '1px solid #2A313D' };\n";
    expect(findingsIn(stripComments(src)).map((f) => f.text)).toEqual(['#2A313D']);
  });

  it('the odd-quote regex in `setup-dev-live.ts` swallows nothing after it', () => {
    // 🔴 THE LIVE MANIFESTATION, BOUND TO THE REAL LINE RATHER THAN A FIXTURE.
    // `setManifestBlockId` holds five quotes in one regex literal, which left 940
    // characters of real comment unstripped from there on. Both directions are
    // asserted, because version 2 got both wrong: a hex in prose after it was a
    // FALSE finding, and a hex in code after it was invisible.
    const file = 'src/setup-dev-live.ts';
    const src = readFileSync(file, 'utf8');
    const anchor = 'const re = /("blockId"\\s*:\\s*)"[^"]*"/;';
    expect(src, `${file} no longer holds the odd-quote regex this case is about`).toContain(anchor);

    const inProse = src.replace(anchor, `${anchor}\n  // the old grey was #101113`);
    expect(findingsIn(stripComments(inProse, file)), 'a hex named in prose was read as a colour').toEqual(
      [],
    );

    const inCode = src.replace(anchor, `${anchor}\n  const injected = '#101113';`);
    expect(
      findingsIn(stripComments(inCode, file)).map((f) => f.text),
      'a hex in real code after the regex was invisible',
    ).toContain('#101113');
  });

  it('JSX text containing `//` does not blank the rest of the line', () => {
    // The third route version 2 named as an open residual. A JSX text node is one
    // token to the parser, so its `//` is text and the code after it is still code.
    const line = `const Cell = () => <span>a // b</span>; const s = { color: '#2A313D' };`;
    expect(findingsIn(stripComments(line, 'snippet.tsx')).map((f) => f.text)).toEqual(['#2A313D']);
  });

  it('a hex inside a JSDoc block is not a finding, and one after it still is', () => {
    // 🔴 THE ONE CASE THE TOKEN WALK NEEDS A RULE FOR. `getChildren()` descends into
    // JSDoc, so without the explicit skip a `/**` block is KEPT and prose becomes a
    // finding — measured: `models.ts`'s own JSDoc goes red. Both halves are pinned,
    // so a skip widened to swallow the following code fails too.
    expect(findingsIn(stripComments(`/** the old grey was #101113 */\nconst x = 1;`))).toEqual([]);
    expect(
      findingsIn(stripComments(`/** was #101113 */\nconst x = '#2A313D';`)).map((f) => f.text),
    ).toEqual(['#2A313D']);
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
interface Layer {
  rgb: Rgb;
  alpha: number;
}

/** `rgb()` / `rgba()` / `#hex` → channels + alpha. `null` for anything else. */
function parseColour(value: string): Layer | null {
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

/**
 * Every colour stop in a `linear-gradient(...)`, in source order, WITH ITS ALPHA.
 *
 * 🔴 THE ALPHA USED TO BE READ AND THEN DISCARDED: the line was
 * `out.push(c.alpha === 1 ? c.rgb : c.rgb)` — two identical branches, so a
 * translucent stop was graded as though it were opaque. Inert at the time (both
 * hero stops are opaque) and silent the moment it stopped being: the first
 * `withAlpha(...)` stop added to a gradient would have been graded against a
 * colour nothing paints. `groundsFor` now composites such a stop over whatever is
 * behind the gradient.
 */
function gradientLayers(image: string): Layer[] {
  if (!/gradient\(/i.test(image)) return [];
  const out: Layer[] = [];
  for (const m of image.matchAll(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,6}\b/g)) {
    const c = parseColour(m[0]);
    if (c) out.push(c);
  }
  return out;
}

/** What an element paints for itself: a gradient's stops, else its background colour. */
function ownLayers(el: HTMLElement): Layer[] {
  const stops = gradientLayers(el.style.backgroundImage || el.style.background || '');
  if (stops.length > 0) return stops;
  const bg = parseColour(el.style.backgroundColor || '');
  return bg && bg.alpha > 0 ? [bg] : [];
}

/**
 * The OPAQUE ground(s) an element's own text sits on.
 *
 * More than one when the ground is a gradient — then every stop is a ground the
 * text really does sit on somewhere along its width, and the worst of them is the
 * one that decides legibility. A translucent layer, gradient stop or plain
 * background alike, is composited over what is behind it rather than skipped, so
 * the candidate tag's 78% scrim is graded at the colour it actually produces.
 *
 * Expressed as recursion on the parent rather than a loop with an accumulator,
 * because that is the definition: a layer over the grounds of whatever encloses it.
 */
function groundsFor(el: HTMLElement): Rgb[] {
  const layers = ownLayers(el);
  const behind = (): Rgb[] => (el.parentElement ? groundsFor(el.parentElement) : []);
  if (layers.length === 0) return behind();

  const translucent = layers.some((l) => l.alpha < 1);
  const grounds = translucent ? behind() : [];
  const out: Rgb[] = [];
  for (const l of layers) {
    if (l.alpha >= 1) out.push(l.rgb);
    else for (const g of grounds) out.push(composite(l.rgb, l.alpha, g));
  }
  return out;
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
    const groundless: string[] = [];

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
      if (grounds.length === 0) {
        groundless.push(`<${el.tagName.toLowerCase()} testid=${el.dataset.testid ?? '—'}> ${toHex(fg.rgb)}`);
        continue;
      }

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

    // 🔴 THIS ONE CANNOT FIRE TODAY AND IS KEPT AS A TRIPWIRE, NOT COUNTED AS
    // COVERAGE. The walk starts at the block root, which always carries an opaque
    // inline `background: pal.page`, so every descendant resolves to something. It
    // is here to fail loudly if that stops being true — an unreachable assertion
    // that says so is better than one that reads as a check on the grader. The
    // grader's own empty-set behaviour is exercised below, where it IS reachable.
    expect(groundless, 'text with no resolvable opaque ground above it').toEqual([]);

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

  it('composites a TRANSLUCENT gradient stop over what is behind the gradient', () => {
    // 🔴 THE CASE THE DEAD TERNARY WOULD FAIL. Graded as opaque, the first stop
    // resolves to black (#000000); composited over the white behind it, to mid grey.
    // Both grounds are returned, because the text crosses both.
    const parent = document.createElement('div');
    parent.style.backgroundColor = 'rgb(255, 255, 255)';
    const el = document.createElement('div');
    el.style.backgroundImage = 'linear-gradient(90deg, rgba(0, 0, 0, 0.5) 0%, #ffffff 100%)';
    parent.appendChild(el);
    const grounds = groundsFor(el).map((g) => g.map(Math.round));
    expect(grounds).toEqual([
      [128, 128, 128],
      [255, 255, 255],
    ]);
  });

  it('resolves NO ground when nothing above the element is opaque', () => {
    // Where the walk's `groundless` case is reachable: the grader returns an empty
    // set rather than inventing a ground, which is what makes that assertion mean
    // something if the block root ever stops painting `page`.
    const el = document.createElement('div');
    el.style.color = 'rgb(0, 0, 0)';
    expect(groundsFor(el)).toEqual([]);
    const translucentOnly = document.createElement('div');
    translucentOnly.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    translucentOnly.appendChild(el);
    expect(groundsFor(el)).toEqual([]);
  });
});
