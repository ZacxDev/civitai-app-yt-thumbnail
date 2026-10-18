import { readFileSync } from 'node:fs';

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveBlockTier, type BlockSizeTier } from '@civitai/blocks-react';

import { App, HERO_BANNER_SRC, SHELL_PADDING } from './App.js';
import { ULTRAWIDE_MIN, layoutForTier } from './layout.js';
import { IMAGE_MIN_PX, imageGridStyle, panelRowStyle } from './ui-styles.js';
import { installMockMoneyHost } from './mock-buzz.js';
import { DEFAULT_CHECKPOINT } from './models.js';
import { palette, parseHex, type Palette } from './palette.js';

// The width-adaptive layout, tested at its actual widths.
//
// This is the BEHAVIOURAL half of the responsive example. `App.tsx` asks
// `useBlockBreakpoint` for the block's own width tier and renders a DIFFERENT
// container for the Model row depending on the answer; the tests below drive
// that at two widths and assert the swap really happens.
//
// 🔴 THE STUB IS THE WHOLE TEST, so read it before trusting a green.
// jsdom implements no `ResizeObserver` and lays nothing out, so out of the box
// `useBlockBreakpoint` bails on its own `typeof ResizeObserver === 'undefined'`
// guard, never measures, and reports `'base'` — the NARROW branch — at every
// width. A test written without the stub would pass the narrow assertion for a
// reason that has nothing to do with the code under test, and could never
// observe the wide one at all. Two things are therefore faked:
//
//   1. `ResizeObserver`, as an inert class, purely so the hook's effect runs.
//      It never needs to fire: the hook seeds itself synchronously from
//      `element.clientWidth` right after `observe()`, which is the path these
//      tests exercise.
//   2. `clientWidth`, which jsdom always reports as 0.
//
// Both are restored after each test.

/** The width every element reports for the duration of one test. */
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

describe('width-adaptive layout', () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    restoreClientWidth?.();
    restoreClientWidth = undefined;
    restoreResizeObserver?.();
    restoreResizeObserver = undefined;
  });

  // 🔴 THE FIXTURE WIDTHS ARE DELIBERATE. 361 and 900 are distinct from each
  // other and from EVERY breakpoint constant the assertions name (480 / 768 /
  // 1024 / 1184 / 1440), and each sits strictly INSIDE its tier rather than on a
  // boundary. A fixture that lands on a boundary — or that happens to equal a
  // constant — can pass while the comparison it is meant to exercise is wrong.
  //
  // 361 also is not arbitrary: it is roughly the `model.sidebar_top` slot, the
  // narrow case a block actually meets in production.

  it('a NARROW block stacks the Model row', async () => {
    setBlockWidth(361);
    uninstall = installMockMoneyHost({ viewer: { id: 2, username: 'dev', status: 'active' } });
    render(<App />);

    const row = await screen.findByTestId('pm-model-row');
    await waitFor(() => expect(row).toHaveAttribute('data-layout', 'stacked'));
    // The tier the decision was made from, so a failure says WHY.
    expect(document.querySelector('[data-block-tier]')).toHaveAttribute('data-block-tier', 'base');
  });

  it('a WIDE block puts the Model row side by side', async () => {
    setBlockWidth(900);
    uninstall = installMockMoneyHost({ viewer: { id: 2, username: 'dev', status: 'active' } });
    render(<App />);

    const row = await screen.findByTestId('pm-model-row');
    await waitFor(() => expect(row).toHaveAttribute('data-layout', 'row'));
    expect(document.querySelector('[data-block-tier]')).toHaveAttribute('data-block-tier', 'sm');
  });

  it('the Model row keeps its contents in BOTH layouts', async () => {
    // The layout swaps the container, not the content. Without this, deleting
    // the button on one branch would still satisfy the two tests above.
    setBlockWidth(361);
    uninstall = installMockMoneyHost({ viewer: { id: 2, username: 'dev', status: 'active' } });
    render(<App />);

    expect(await screen.findByTestId('pm-change-model')).toBeInTheDocument();
    expect(screen.getByTestId('pm-model-label')).toHaveTextContent(DEFAULT_CHECKPOINT.label);
  });
});

describe('the block breakpoint scale', () => {
  // 🔴 Civitai's block scale is CSS px — xs 480 · sm 768 · md 1024 · lg 1184 ·
  // xl 1440 — and it is NOT Mantine's stock em scale (576 / 768 / 992 / 1200 /
  // 1408). The two agree on `sm` (768) and NOWHERE else, so a test that pins
  // `sm` alone passes against the entirely wrong scale. Every case below is one
  // of the four values that DISCRIMINATE, plus the pixel underneath it.
  //
  // Why assert a scale you do not own: your layout's thresholds are chosen
  // against these numbers, and they are also what you must write out by hand in
  // CSS (a query prelude cannot read `--civitai-bp-*` — see index.css). If the
  // pack ever moves them, this is the line that says so.
  it.each([
    [1, 'base'],
    [479, 'base'],
    [480, 'xs'],
    [767, 'xs'],
    [768, 'sm'],
    [1023, 'sm'],
    [1024, 'md'],
    [1183, 'md'],
    [1184, 'lg'],
    [1439, 'lg'],
    [1440, 'xl'],
  ])('%ipx resolves to %s', (width, tier) => {
    expect(resolveBlockTier(width as number)).toBe(tier);
  });

  it('an unmeasured width resolves to the conservative tier', () => {
    // 0 / NaN mean "not measured yet", not "very narrow" — but `base` is the
    // right answer for both, and it is why the App does not need to gate on
    // `measured`.
    expect(resolveBlockTier(0)).toBe('base');
    expect(resolveBlockTier(Number.NaN)).toBe('base');
  });
});

// ===========================================================================
// THE FULL LADDER, DRIVEN THROUGH THE REAL APP
//
// 🔴 THE SUITE ABOVE DROVE TWO WIDTHS — 361 AND 900 — AND THAT IS THE HOLE THIS
// SECTION CLOSES. A suite that pins two points is structurally blind to every
// defect on the tiers it never renders: before this pass `lg`, `xl` and ultrawide
// had no coverage at all, which is exactly where the 640px column and the
// 2-column result grid were wrong. Every tier below is rendered explicitly.
//
// `layout.test.ts` pins the NUMBERS `layoutForTier` returns, with literal
// expectations. This section pins that the App actually THREADS them to the DOM.
// Either half alone is a claim about one side of a seam nobody owns.
// ===========================================================================

/** One width strictly inside each tier — the same fixtures `layout.test.ts` uses. */
const INSIDE: Record<BlockSizeTier, number> = {
  base: 361,
  xs: 613,
  sm: 901,
  md: 1099,
  lg: 1301,
  xl: 1523,
};
/** `xl` AND above the app-owned 1800px ultrawide threshold. */
const INSIDE_ULTRAWIDE = 1907;

/**
 * A width in the 1101–1183 band — the hole the tier fixtures above cannot see.
 *
 * 🔴 `md` RUNS 1024–1183, AND A CAP BELOW 1183 GUTTERS THE TOP OF IT. The `md`
 * fixture is 1099, which is under the old two-column cap of 1100, so the whole
 * suite could stay green while a two-column block was centred inside gutters at
 * every width from 1101 up. 1180 is the landscape CSS width of the 10.9-inch
 * tablet class, i.e. the device the "full width on a tablet" requirement is about,
 * and it is distinct from every breakpoint (1024 / 1184) and from every cap the
 * layout can return.
 */
const TABLET_LANDSCAPE = 1180;

/**
 * The `xl` cutoff, and the pixel under it — the ONE boundary the three-column /
 * tabs split turns on.
 *
 * 🔴 IT WAS THE `lg` CUTOFF (1184 / 1183) AND THE OPERATOR MOVED IT. At `lg` the
 * three-column grid left ONE thumbnail per row where the tabbed layout renders three, so
 * crossing 1183 → 1184 made the app's primary object smaller — two tiles lost on an
 * ordinary 1280×800 laptop. The rail now starts at `xl`. The measurement is in
 * `the thumbnail COUNT across the cutoff` below, which asserts both sides.
 *
 * 🔴 EVERY OTHER FIXTURE IN THIS FILE SITS STRICTLY INSIDE A TIER, DELIBERATELY, AND
 * THAT IS WHY THIS PAIR EXISTS. An inside-the-tier fixture cannot tell `>= xl` from
 * `> xl`: `INSIDE.lg` (1301) and `INSIDE.xl` (1523) are 222px apart, so a cutoff
 * anywhere in 1302–1523 satisfies both. These two are adjacent integers on either side
 * of the breakpoint, so they pin WHERE the swap happens rather than merely that it
 * happens. They are on a boundary ON PURPOSE — the comparison IS the subject — which is
 * the opposite of the `INSIDE` rule and not an exception to it.
 */
const XL_CUTOFF = 1440;
const BELOW_XL_CUTOFF = 1439;

/**
 * The narrowest `lg` block — the OLD cutoff, kept because it is now the FLOOR of the band
 * whose tile count must be flat. `resolveBlockTier` grades it in the cases that use it.
 */
const LG_FLOOR = 1184;

/**
 * Widths that get the three-column rail layout: the cutoff itself, then a middle of
 * `xl`, and an ultrawide block. Boundary AND middles, named.
 */
const RAIL_WIDTHS = [XL_CUTOFF, INSIDE.xl, INSIDE_ULTRAWIDE] as const;

/**
 * Widths that get the tabbed one-column layout: every tier below `xl` — `lg` included,
 * which is the change this round makes — plus the pixel immediately under the cutoff.
 */
const TAB_WIDTHS = [
  INSIDE.base,
  INSIDE.xs,
  INSIDE.sm,
  INSIDE.md,
  INSIDE.lg,
  BELOW_XL_CUTOFF,
] as const;

/** What the App's own `useUltrawide` seed resolves to for a stubbed `clientWidth`. */
function ultrawideAt(width: number): boolean {
  // The stub makes EVERY element report `width` as its `clientWidth`, and
  // `useUltrawide` seeds from `clientWidth` (the padding box) right after `observe()`
  // — so in this harness the threshold is compared against the block width itself.
  // See `ULTRAWIDE_MIN`'s docblock for which box each observer really grades.
  return width >= ULTRAWIDE_MIN;
}

/** The layout the App should resolve at a stubbed width, with no literals restated. */
function expectedAt(width: number) {
  return layoutForTier(resolveBlockTier(width), ultrawideAt(width));
}

/**
 * The two-track list the rail grid must emit at a given width: the form rail,
 * then the thumbnails' flexible track. DERIVED from `layoutForTier`, never a
 * hardcoded string — a wrong rail width can then only reach the DOM by
 * disagreeing with this. (It was three tracks while the format picker had its
 * own rail; the picker is a carousel inside the form now, operator 2026-10-18.)
 */
function expectedRailTracks(width: number): string {
  return `${expectedAt(width).railWidth}px minmax(0, 1fr)`;
}

const VIEWER = { viewer: { id: 2, username: 'dev', status: 'active' as const } };

/** jsdom normalises a colour to `rgb(r, g, b)`; express the palette the same way. */
function rgb(hex: string): string {
  const [r, g, b] = parseHex(hex);
  return `rgb(${r}, ${g}, ${b})`;
}

function content(): HTMLElement {
  return screen.getByTestId('yt-content');
}

describe('the layout the App renders, at EVERY tier', () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    restoreClientWidth?.();
    restoreClientWidth = undefined;
    restoreResizeObserver?.();
    restoreResizeObserver = undefined;
  });

  it.each(
    (['base', 'xs', 'sm', 'md', 'lg', 'xl'] as const).map((tier) => [tier, INSIDE[tier]] as const),
  )('%s (%ipx)', async (tier, width) => {
    setBlockWidth(width);
    uninstall = installMockMoneyHost(VIEWER);
    render(<App />);

    await screen.findByTestId('pm-generate');

    const expected = layoutForTier(tier, false);

    // The tier the decision was made from, so a failure says WHY.
    expect(document.querySelector('[data-block-tier]')).toHaveAttribute('data-block-tier', tier);
    expect(document.querySelector('[data-ultrawide]')).toHaveAttribute('data-ultrawide', 'false');

    const box = content();
    // 🔴 `data-result-columns` IS GONE FROM THE SHIPPED DOM with the field behind it.
    // It reported the thumbnail grid's column count, which is the number that
    // multiplied with the history ROW grid's identical count and produced an ~85px
    // tile on an ultrawide block. The grid is intrinsically sized now — asserted as
    // the `minmax` floor at four widths further down this file — so there is no count
    // to report, and an attribute naming a number no style reads could only ever be
    // right by coincidence. Asserted ABSENT so a revert has to update this line.
    expect(box).not.toHaveAttribute('data-result-columns');
    expect(box).toHaveAttribute('data-min-card', String(expected.formatMinCardPx));

    // 🔴 THE INLINE STYLE IS THE LAYOUT — an attribute is only a report of it. The
    // cap used to be asserted twice, as `data-max-width` and again as the style; the
    // attribute is gone from the shipped DOM because this line is the stronger of
    // the two claims. `maxWidth: null` must reach the DOM as NO cap, never as the
    // string "none".
    expect(box.style.maxWidth).toBe(expected.maxWidth === null ? '' : `${expected.maxWidth}px`);

    // The format picker is a CAROUSEL now: one horizontally scrolling row of
    // fixed-width cards (the card width is `formatMinCardPx` at this tier).
    const grid = screen.getByTestId('yt-format-grid');
    expect(grid.style.display).toBe('flex');
    expect(grid.style.overflowX).toBe('auto');
    const firstCard = screen.getAllByTestId('yt-format-card')[0];
    expect(firstCard.style.width).toBe(`${expected.formatMinCardPx}px`);

    // The rail exists exactly when the layout says so — asserted in BOTH
    // directions, because "the rail is present at lg" and "the rail is absent at
    // sm" are two different claims. This pair replaces a `data-rail` attribute that
    // said the same thing one element up: the element's presence and its grid
    // template are what a browser acts on, and they cannot be right while the rail
    // is missing.
    if (expected.rail) {
      const rail = screen.getByTestId('yt-rail');
      expect(screen.getByTestId('yt-main')).toBeInTheDocument();
      // 🔴 TWO TRACKS: form rail | thumbnails. The format picker used to be a
      // second fixed rail between them; it is a carousel inside the form now
      // (operator, 2026-10-18), so every pixel the block gains past the form
      // rail goes to the thumbnail grid — see the dedicated describe below.
      expect(screen.getByTestId('yt-rail-grid').style.gridTemplateColumns).toBe(
        `${expected.railWidth}px minmax(0, 1fr)`,
      );
      // 🔴 STICKY IS LIVE IN PRODUCTION — and this line is annotated because the
      // version of it that shipped before this round said it was inert. Both host
      // surfaces bound the iframe's height, so the app's content scrolls inside the
      // frame and the rail has a scrolling ancestor: the full-page host handles no
      // `RESIZE_IFRAME` at all and sizes the frame to the viewport, and the slot
      // host clamps the height `RESIZE_IFRAME` asks for. See `railStyle` for the
      // host-side reading. What is assertable HERE is still only the declaration —
      // jsdom performs no layout, so it can never travel — and the pixels remain a
      // `deferred[]` item in `taste.json`.
      expect(rail.style.position).toBe('sticky');
      // The prompt AND the format carousel are IN the form rail — the picker
      // moved into the form, which is the restructure, not just a column
      // existing. There is no formats rail any more.
      expect(rail).toContainElement(screen.getByLabelText(/prompt/i));
      expect(rail).toContainElement(grid);
      expect(rail).toContainElement(screen.getByTestId('yt-format-picker'));
      expect(screen.queryByTestId('yt-formats-rail')).not.toBeInTheDocument();
      expect(screen.getByTestId('yt-main')).not.toContainElement(grid);
      // 🔴 WHAT THE PICKER OPENS stays in MAIN: the composed-prompt textareas,
      // the format editor and the published board are full-width surfaces, and
      // the rail's content box is not a place to edit a prompt. Asserted in
      // both directions, at every rail tier.
      expect(rail).not.toContainElement(screen.getByTestId('yt-format-detail'));
      expect(screen.getByTestId('yt-main')).toContainElement(
        screen.getByTestId('yt-format-detail'),
      );
      // No tab control at the rail tiers: both surfaces are visible at once, so a
      // switcher would be a control that hides something for no reason. Asserted by ROLE
      // as well as by testid — a `SegmentedControl` rendered without the testid is still a
      // tablist a viewer can press, and the testid query alone cannot see it. NOT
      // `queryByRole('tablist')` — the Generate/Remix mode toggle is a `SegmentedControl`
      // too and is present at every tier, so that query would always match and this would
      // be a guard that can never pass. The two panel NAMES are the discriminating query.
      expect(screen.queryByTestId('yt-panel-tabs')).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Thumbnails' })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Formats' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('yt-panel-thumbnails')).not.toBeInTheDocument();
      expect(screen.queryByTestId('yt-panel-formats')).not.toBeInTheDocument();
    } else {
      expect(screen.queryByTestId('yt-rail')).not.toBeInTheDocument();
      expect(screen.queryByTestId('yt-main')).not.toBeInTheDocument();
      expect(screen.queryByTestId('yt-rail-grid')).not.toBeInTheDocument();
      expect(screen.queryByTestId('yt-formats-rail')).not.toBeInTheDocument();
      // ...and there are no TABS: below `xl` everything is one column — form,
      // then what the picker opens, then the thumbnails — with nothing hidden
      // behind a switcher (operator, 2026-10-18).
      expect(screen.queryByTestId('yt-panel-tabs')).not.toBeInTheDocument();
      expect(screen.queryByTestId('yt-panel-thumbnails')).not.toBeInTheDocument();
      expect(screen.queryByTestId('yt-panel-formats')).not.toBeInTheDocument();
      expect(screen.queryAllByRole('tab')).toHaveLength(0);
      // Picker AND detail are both in the column, in the open.
      expect(content()).toContainElement(screen.getByTestId('yt-format-picker'));
      expect(content()).toContainElement(screen.getByTestId('yt-format-detail'));
      expect(grid).toBeVisible();
    }

    // The one structural swap this app already shipped, still driven from the
    // same place.
    expect(screen.getByTestId('pm-model-row')).toHaveAttribute('data-layout', expected.modelRow);
  });

  it('ultrawide (1907px) gets the wider format cards and the wider rail', async () => {
    // 🔴 THE ONLY CASE THE SDK CANNOT REACH. `xl` is unbounded, so 1523 and 1907
    // resolve to the SAME tier — the difference below is entirely the app-owned
    // `useUltrawide` threshold, and without this test that hook could be wired to
    // nothing and every other assertion would stay green.
    setBlockWidth(INSIDE_ULTRAWIDE);
    uninstall = installMockMoneyHost(VIEWER);
    render(<App />);
    await screen.findByTestId('pm-generate');

    expect(document.querySelector('[data-block-tier]')).toHaveAttribute('data-block-tier', 'xl');
    expect(document.querySelector('[data-ultrawide]')).toHaveAttribute('data-ultrawide', 'true');
    // 🔴 `data-result-columns` IS GONE (see the tier ladder above). The two
    // ultrawide-only numbers that remain are the format-card floor and the rail
    // width, and they are independent of each other, so this is not one coincidence.
    expect(content()).not.toHaveAttribute('data-result-columns');
    expect(content()).toHaveAttribute('data-min-card', '220');
    expect(screen.getByTestId('yt-rail-grid').style.gridTemplateColumns).toBe(
      `400px minmax(0, 1fr)`,
    );
    // 🔴 THE FORM RAIL WIDENS AT ULTRAWIDE (340 → 400) and it is the ONLY fixed
    // track, so the widening is read straight off the track list: the same
    // assertion at 1523px below reads 340px in the same position.
  });

  it('1523px and 1907px are the SAME tier — the difference is not the tier', async () => {
    // The control for the test above: it proves the 4-column branch is not simply
    // "xl", which is the reading a single ultrawide test would leave open.
    expect(resolveBlockTier(INSIDE.xl)).toBe('xl');
    expect(resolveBlockTier(INSIDE_ULTRAWIDE)).toBe('xl');

    setBlockWidth(INSIDE.xl);
    uninstall = installMockMoneyHost(VIEWER);
    render(<App />);
    await screen.findByTestId('pm-generate');
    // 220 vs 200 and 400 vs 340 — the same two numbers the case above asserts, at the
    // other end, which is what makes the pair a claim about `useUltrawide` rather than
    // about the tier.
    expect(content()).toHaveAttribute('data-min-card', '200');
    expect(screen.getByTestId('yt-rail-grid').style.gridTemplateColumns).toBe(
      `340px minmax(0, 1fr)`,
    );
  });

  it('the 640px column is GONE from every tier that has room', async () => {
    // The regression this pass exists for, asserted where a user would meet it: a
    // full-page block's column is as wide as the viewport (the host imposes no
    // width — see `ULTRAWIDE_MIN`), and it used to render 640px of that.
    setBlockWidth(INSIDE.xl);
    uninstall = installMockMoneyHost(VIEWER);
    render(<App />);
    await screen.findByTestId('pm-generate');
    expect(content().style.maxWidth).toBe('');
    expect(content().getAttribute('style') ?? '').not.toContain('640px');
  });

  it(`a ${TABLET_LANDSCAPE}px block is NOT guttered — the top of md was capped`, async () => {
    // 🔴 THE REGRESSION THIS CASE EXISTS FOR. The two-column cap used to be 1100
    // while `md` runs to 1183, so a 1101–1183px block — a 10.9-inch tablet in
    // landscape is 1180 — rendered a 1100px column with gutters either side. The
    // tier fixtures cannot see it: `md`'s fixture is 1099.
    //
    // The assertion is the mechanism, not the literal: a cap only gutters when it
    // is NARROWER than the block, so what has to hold is "no cap, or a cap at
    // least as wide as the block". That stays true if the ladder moves again.
    setBlockWidth(TABLET_LANDSCAPE);
    uninstall = installMockMoneyHost(VIEWER);
    render(<App />);
    await screen.findByTestId('pm-generate');

    // The tier the cap was chosen from, so a failure says WHY.
    expect(document.querySelector('[data-block-tier]')).toHaveAttribute('data-block-tier', 'md');

    const cap = content().style.maxWidth;
    const capPx = cap === '' ? Number.POSITIVE_INFINITY : Number.parseInt(cap, 10);
    expect(
      capPx,
      `a ${TABLET_LANDSCAPE}px block is capped at ${cap || 'nothing'}, so it is centred inside ` +
        `${(TABLET_LANDSCAPE - capPx) / 2}px of gutter either side`,
    ).toBeGreaterThanOrEqual(TABLET_LANDSCAPE);
  });

  it('a narrow block still gets the readable 640px cap', async () => {
    // The other direction: removing the cap everywhere would be a different bug,
    // and the assertion above cannot see it.
    setBlockWidth(INSIDE.xs);
    uninstall = installMockMoneyHost(VIEWER);
    render(<App />);
    await screen.findByTestId('pm-generate');
    expect(content().style.maxWidth).toBe('640px');
  });

  // =========================================================================
  // THE RAIL IS BOUNDED, SO THE SPEND BUTTON CANNOT BE STRANDED BELOW THE FOLD
  // =========================================================================

  it('the rail is HEIGHT-BOUNDED and scrolls its own overflow', async () => {
    // 🔴 WHAT THIS IS FOR, AND WHAT IT CANNOT SEE. `position: sticky` with no
    // `max-height` and no `overflow` is worse than no sticky at all once the rail is
    // taller than the scrollport: the frame's scroll moves the MAIN column, the rail
    // cannot scroll its own overflow, and its tail — quantity, spend-from, Generate,
    // and the three pre-spend gate alerts — sits below the fold for the whole sticky
    // range. At `lg`+ the rail holds the mode toggle, the prompt, the model, up to
    // MAX_LORAS LoRA rows and all of that tail, so it exceeds a 1280×800 laptop's
    // ~740px of scrollport well before the LoRA cap.
    //
    // 🔴 jsdom PERFORMS NO LAYOUT, so nothing here observes the rail travelling,
    // overflowing or scrolling. What IS assertable is that the bound exists in the
    // emitted style and that both numbers are DERIVED from `SHELL_PADDING` rather
    // than picked — a magic number would drift the moment the shell's inset moved.
    // Whether the tail is reachable in pixels is unverified and carried as a
    // `deferred[]` item in `taste.json`.
    //
    // 🔴 `INSIDE.xl`, NOT `INSIDE.lg`. The rail moved to `xl`, so 1301 renders no rail at
    // all and every assertion below would read an empty style off a missing element.
    setBlockWidth(INSIDE.xl);
    uninstall = installMockMoneyHost(VIEWER);
    render(<App />);
    await screen.findByTestId('pm-generate');

    const rail = screen.getByTestId('yt-rail');
    expect(rail.style.position).toBe('sticky');

    // The bound, and the overflow that makes the bound reachable rather than a clip.
    // Both must be present: `maxHeight` alone would CUT the Generate button off.
    expect(rail.style.maxHeight).toBe(`calc(100dvh - ${SHELL_PADDING * 2}px)`);
    expect(rail.style.overflowY).toBe('auto');

    // `top: 0` put a stuck rail flush against the frame's top edge, ignoring the
    // inset the shell gives every other edge.
    expect(rail.style.top).toBe(`${SHELL_PADDING}px`);
    expect(rail.style.top).not.toBe('0px');

    // The derivation, asserted as a derivation: the bound is TWO insets (one above,
    // one below), so it moves with the shell rather than beside it.
    expect(rail.style.maxHeight).toContain(String(SHELL_PADDING * 2));
    expect(SHELL_PADDING).toBeGreaterThan(0);
  });

  // =========================================================================
  // THE HERO AT `xl`+ — the brand surface, in a pass whose subject is the brand
  // =========================================================================

  it('the hero EXISTS in the rail layout, above all three columns', async () => {
    // 🔴 DELETING `{hero}` FROM THE `xl`+ BRANCH USED TO LEAVE THE SUITE GREEN.
    // The hero was asserted only in the non-rail layout, so the app's brand surface
    // had no coverage at all on the widest screens — the ones this pass is about.
    setBlockWidth(INSIDE.xl);
    uninstall = installMockMoneyHost(VIEWER);
    render(<App />);
    await screen.findByTestId('pm-generate');

    const hero = screen.getByTestId('yt-hero');
    expect(hero).toBeInTheDocument();
    // Above the rail grid, not inside either column — the masthead spans both.
    const grid = screen.getByTestId('yt-rail-grid');
    expect(hero.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(grid).not.toContainElement(hero);
    expect(content()).toContainElement(hero);
  });

  it('the hero SCALES with the block, which App.tsx claims as a feature', async () => {
    // 🔴 TWO MUTANTS THAT BOTH SURVIVED A GREEN SUITE: collapsing `heroStyle`'s
    // padding to the narrow value, and collapsing `heroTitleStyle`'s fontSize to 22.
    // `heroStyle`'s own docblock says "the padding and the headline scale with the
    // block, so the hero is a masthead on a 1600px block rather than a banner that
    // eats the fold" — a claim with no test is a claim.
    //
    // Both widths are asserted, because either number alone passes against a
    // constant. The two fixtures are in different tiers AND on opposite sides of the
    // rail boundary, which is the dimension the scaling keys on — `INSIDE.xl` since the
    // boundary moved there; at `INSIDE.lg` both arms would now be the narrow value and the
    // comparison would be two equal numbers.
    setBlockWidth(INSIDE.xl);
    uninstall = installMockMoneyHost(VIEWER);
    render(<App />);
    await screen.findByTestId('pm-generate');

    const wideHero = screen.getByTestId('yt-hero');
    expect(wideHero.style.padding).toBe('22px 28px');
    const wideTitle = screen.getByText('YT Thumbnail');
    expect(wideTitle.style.fontSize).toBe('26px');

    // The narrow arm, in a second render — the values must DIFFER, not merely exist.
    uninstall?.();
    restoreClientWidth?.();
    restoreResizeObserver?.();
    setBlockWidth(INSIDE.base);
    uninstall = installMockMoneyHost(VIEWER);
    render(<App />);
    const narrowHero = (await screen.findAllByTestId('yt-hero')).at(-1)!;
    expect(narrowHero.style.padding).toBe('18px 20px');
    expect(narrowHero.style.padding).not.toBe(wideHero.style.padding);
    const narrowTitle = screen.getAllByText('YT Thumbnail').at(-1)!;
    expect(narrowTitle.style.fontSize).toBe('22px');
    expect(narrowTitle.style.fontSize).not.toBe(wideTitle.style.fontSize);
  });
});

// ===========================================================================
// THE THIRD COLUMN — Formats gets its own FIXED rail beside the thumbnail grid.
//
// 🔴 THE DEFECT THIS SECTION EXISTS FOR, STATED AS THE MUTANT: a formats column
// spelled `minmax(0, 1fr)` instead of a px length. It looks like the obvious way to
// add a column, it is what a CSS-first instinct reaches for, and it costs the
// thumbnail grid half of its row — at a 1440px block, 2 tiles become 1. The grid is
// this app's primary object and the only surface that converts block width into
// information; the picker is an `auto-fill` list with a 200px card floor whose appetite
// stops at one column. See `FORMATS_RAIL_WIDTH` for the full arithmetic.
//
// 🔴 AND WHAT NONE OF IT MEASURES. jsdom lays nothing out. Every assertion below is
// about the STYLE CONTRACT a browser would act on, plus arithmetic over the numbers in
// that contract. No tile has been rendered, no rail has been seen to scroll, and the
// three columns have never been observed side by side. A browser pass is still owed.
// ===========================================================================

/** The thumbnail grid's own gap, read off the shipped style rather than restated. */
const TILE_GAP = Number(imageGridStyle().gap);

/**
 * How many `IMAGE_MIN_PX` tiles fit in a container, under `imageGridStyle()`'s rule.
 *
 * `auto-fill` + `minmax(min(300px, 100%), 1fr)` at `gap: TILE_GAP` fits n tiles when
 * `n * IMAGE_MIN_PX + (n - 1) * TILE_GAP <= container`. Both inputs come from
 * `ui-styles.ts`, so this cannot drift from the grid it is reasoning about.
 */
function tilesIn(containerPx: number): number {
  return Math.max(0, Math.floor((containerPx + TILE_GAP) / (IMAGE_MIN_PX + TILE_GAP)));
}

/**
 * The horizontal inset the images grid sits inside — ONE `panelRowStyle` (a history row),
 * whose horizontal padding is the second value of its `padding` shorthand.
 *
 * Read off the shipped style rather than restated, and hoisted out of the one case that
 * used to compute it inline because three cases need it now.
 */
function historyRowInset(): number {
  const inset =
    2 * Number.parseInt(String(panelRowStyle(palette.dark).padding).split(/\s+/)[1], 10);
  // The control: a parse failure would read as `NaN` and quietly make every tile count
  // `NaN`, which `toBe(3)` reports as a value mismatch rather than as a broken helper.
  expect(inset, 'panelRowStyle’s padding shorthand no longer parses as `V H`').toBeGreaterThan(0);
  return inset;
}

/** Every `data-testid` INSIDE a container, sorted — exact ids, never a prefix. */
function testidsIn(el: HTMLElement): string[] {
  return [...el.querySelectorAll('[data-testid]')]
    .map((n) => n.getAttribute('data-testid') as string)
    .sort();
}

describe('the rail grid is TWO tracks — the form rail, then the thumbnails', () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    restoreClientWidth?.();
    restoreClientWidth = undefined;
    restoreResizeObserver?.();
    restoreResizeObserver = undefined;
  });

  async function renderAt(width: number) {
    setBlockWidth(width);
    uninstall = installMockMoneyHost(VIEWER);
    render(<App />);
    await screen.findByTestId('pm-generate');
  }

  /**
   * Unmount and uninstall, so a SECOND `renderAt` inside the same test starts from an
   * empty document. The cross-boundary cases below render twice; without this every query
   * would be ambiguous and could read the wrong tree.
   */
  async function teardownRail() {
    uninstall?.();
    uninstall = undefined;
    cleanup();
    restoreClientWidth?.();
    restoreClientWidth = undefined;
    restoreResizeObserver?.();
    restoreResizeObserver = undefined;
  }

  it.each(RAIL_WIDTHS.map((w) => [w] as const))(
    '🔴 at %ipx the THUMBNAILS track is the only flexible one',
    async (width) => {
      await renderAt(width);
      const tracks = screen.getByTestId('yt-rail-grid').style.gridTemplateColumns;

      // EXACTLY ONE flexible track. A second `fr` anywhere is a split of the
      // main column, under whatever syntax — and every pixel split away from
      // the thumbnails is a pixel the grid cannot spend on tiles. A `%` would
      // be the same defect in another unit, so it is rejected by name.
      expect(
        tracks.match(/fr\b/g),
        `the rail grid has more than one flexible track: ${tracks}`,
      ).toHaveLength(1);
      // ...and the flexible one is LAST, behind the ONE fixed track (the form
      // rail). The formats rail that used to sit between them is gone — the
      // picker is a carousel inside the form (operator, 2026-10-18).
      expect(tracks).toMatch(/^\d+px\s+minmax\(0,\s*1fr\)$/);
      expect(tracks).not.toContain('%');
      const trackList = tracks.split(/\s+(?=\d+px|minmax)/);
      expect(trackList, `not two tracks: ${tracks}`).toHaveLength(2);
      expect(trackList[0]).toBe(`${expectedAt(width).railWidth}px`);

      // Then the literal, derived from the layout rather than restated.
      expect(tracks).toBe(expectedRailTracks(width));

      // The tier the tracks were chosen from, so a failure says WHY.
      expect(document.querySelector('[data-block-tier]')).toHaveAttribute(
        'data-block-tier',
        resolveBlockTier(width),
      );
    },
  );

  it.each(RAIL_WIDTHS.map((w) => [w] as const))(
    'at %ipx the format carousel is IN the form rail and the thumbnails are in main',
    async (width) => {
      await renderAt(width);

      const main = screen.getByTestId('yt-main');
      const inputsRail = screen.getByTestId('yt-rail');

      // No formats rail exists at any width now.
      expect(screen.queryByTestId('yt-formats-rail')).not.toBeInTheDocument();

      // 🔴 EXACT IDS, NEVER THE `yt-format-` PREFIX — a prefix selector also
      // matches the layout nodes, so it cannot carry a containment claim.
      const grid = screen.getByTestId('yt-format-grid');
      expect(inputsRail).toContainElement(grid);
      expect(main).not.toContainElement(grid);
      expect(inputsRail).toContainElement(screen.getByTestId('yt-format-picker'));

      // The two columns are two SIBLING children of the rail grid, in reading
      // order: form | thumbnails.
      const railGrid = screen.getByTestId('yt-rail-grid');
      expect([...railGrid.children]).toEqual([inputsRail, main]);

      // The prompt is in the form rail too — the picker moving into the form
      // must not have taken anything out of it.
      expect(inputsRail).toContainElement(screen.getByLabelText(/prompt/i));
      expect(main).not.toContainElement(screen.getByLabelText(/prompt/i));

      // 🔴 WHAT THE PICKER OPENS IS IN MAIN, FIRST. `yt-format-detail` — the
      // composed-prompt textareas, the format editor's mount point and the
      // published board — is a full-width surface, so it leads the main
      // column, ahead of the thumbnails it feeds.
      expect(main).toContainElement(screen.getByTestId('yt-format-detail'));
      expect(inputsRail).not.toContainElement(screen.getByTestId('yt-format-detail'));
      const detail = screen.getByTestId('yt-format-detail');
      expect(detail.parentElement?.firstElementChild).toBe(detail);
    },
  );

  it.each([
    [XL_CUTOFF, 3],
    [INSIDE.xl, 3],
    [INSIDE_ULTRAWIDE, 4],
  ] as const)(
    '🔴 at %ipx the ONE fixed rail leaves %i thumbnail columns',
    async (BLOCK, expectedTiles) => {
      // 🔴 THE REGRESSION CASE, EXPRESSED IN TILES RATHER THAN IN CSS. The
      // assertions above pin the track list; this one says what the track list
      // is FOR, because "there is exactly one `fr`" reads as a style nit while
      // the stake is how many thumbnails a viewer can compare at once.
      //
      // Every number is read off the shipped code — `SHELL_PADDING`, the rail
      // grid's own `gap`, `panelRowStyle`'s inset, `IMAGE_MIN_PX` and
      // `imageGridStyle()`'s gap — so nothing here is a second copy of a
      // layout constant.
      //
      // 🔴 THE COUNTS WENT UP WHEN THE FORMATS RAIL WENT AWAY. With a second
      // fixed 320px rail these same widths left 2 / 2 / 3 tiles; the carousel
      // inside the form buys one tile back at every rail width. The comparison
      // arm below prices that rail explicitly, so the gain is asserted rather
      // than merely recorded in the parameters.
      await renderAt(BLOCK);
      expect(document.querySelector('[data-block-tier]')).toHaveAttribute('data-block-tier', 'xl');
      expect(document.querySelector('[data-ultrawide]')).toHaveAttribute(
        'data-ultrawide',
        String(ultrawideAt(BLOCK)),
      );

      const railGrid = screen.getByTestId('yt-rail-grid');
      const gridGap = Number.parseInt(railGrid.style.gap, 10);
      const inputsRailPx = Number.parseInt(railGrid.style.gridTemplateColumns, 10);
      expect(gridGap).toBeGreaterThan(0);
      expect(inputsRailPx).toBe(expectedAt(BLOCK).railWidth);

      const rowInset = historyRowInset();
      const contentPx = BLOCK - 2 * SHELL_PADDING;

      // What ships: ONE fixed rail and one flexible track after it, across ONE gap.
      const fixedRailMain = contentPx - inputsRailPx - gridGap;
      expect(tilesIn(fixedRailMain - rowInset)).toBe(expectedTiles);

      // The comparison, as the removed rail's price: subtract a second fixed
      // 320px rail (and its gap) and the grid LOSES a tile at every width here.
      const withFormatsRail = contentPx - inputsRailPx - 320 - 2 * gridGap;
      expect(
        tilesIn(withFormatsRail - rowInset),
        `a second fixed rail would leave ${withFormatsRail}px of main at ${BLOCK}px`,
      ).toBeLessThan(expectedTiles);
    },
  );

  it('🔴 the thumbnail COUNT across the cutoff: 1439 gets THREE and 1440 gets THREE — no step at all', async () => {
    // 🔴 THE CASE THAT USED TO MEASURE A ONE-TILE STEP. While the format
    // picker had its own fixed rail, crossing into the rail tier cost the
    // thumbnail grid exactly one tile (3 -> 2) and this case pinned that as
    // the accepted price. The carousel removed the second rail, so the price
    // is gone: both sides render THREE, and the step is asserted as ZERO —
    // a future fixed column that reintroduces any step fails here.
    const rowInset = historyRowInset();

    // --- The single-column side: 1439px, one capped column.
    await renderAt(BELOW_XL_CUTOFF);
    expect(document.querySelector('[data-block-tier]')).toHaveAttribute('data-block-tier', 'lg');
    expect(screen.queryByTestId('yt-rail-grid')).not.toBeInTheDocument();
    // The column's width is the EMITTED cap, or the block's content box if it is narrower.
    const capPx = Number.parseInt(content().style.maxWidth, 10);
    expect(capPx, 'the single column is uncapped at 1439 — read the cap, do not assume it')
      .toBeGreaterThan(0);
    const column = Math.min(BELOW_XL_CUTOFF - 2 * SHELL_PADDING, capPx);
    const columnTiles = tilesIn(column - rowInset);
    expect(columnTiles).toBe(3);

    // --- The rail side: 1440px, two tracks.
    await teardownRail();
    await renderAt(XL_CUTOFF);
    expect(document.querySelector('[data-block-tier]')).toHaveAttribute('data-block-tier', 'xl');
    const railGrid = screen.getByTestId('yt-rail-grid');
    const gridGap = Number.parseInt(railGrid.style.gap, 10);
    const inputsRailPx = Number.parseInt(railGrid.style.gridTemplateColumns, 10);
    const railMain = XL_CUTOFF - 2 * SHELL_PADDING - inputsRailPx - gridGap;
    const railTiles = tilesIn(railMain - rowInset);
    expect(railTiles).toBe(3);

    expect(
      columnTiles - railTiles,
      `crossing ${BELOW_XL_CUTOFF} -> ${XL_CUTOFF} costs the thumbnail grid ` +
        `${columnTiles - railTiles} tiles (${columnTiles} -> ${railTiles})`,
    ).toBe(0);
    // ...and the two sides really are different layouts, so the comparison is not one
    // shape measured twice.
    expect(resolveBlockTier(BELOW_XL_CUTOFF)).not.toBe(resolveBlockTier(XL_CUTOFF));
  });

  it('🔴 the tile count is FLAT across `lg` — the band the one-width case could not see', async () => {
    // 🔴 A BAND, NOT A POINT, AND THAT DISTINCTION IS THE AUDIT FINDING. `lg` runs
    // 1184–1439. The rail-at-`lg` layout gave ONE tile at the bottom of that band and two
    // at the top; the capped single-column layout gives THREE at every width in it,
    // because the cap stops the column growing. Asserted at the FLOOR, a MIDDLE and
    // the TOP — named, so the claim carries its own scope — because "3 tiles at `lg`"
    // measured once is a claim about one width.
    const rowInset = historyRowInset();
    const widths = [LG_FLOOR, INSIDE.lg, BELOW_XL_CUTOFF];
    expect(widths.map(resolveBlockTier)).toEqual(['lg', 'lg', 'lg']);

    const counts: number[] = [];
    for (const [i, w] of widths.entries()) {
      if (i > 0) await teardownRail();
      await renderAt(w);
      expect(document.querySelector('[data-block-tier]')).toHaveAttribute('data-block-tier', 'lg');
      // No rail anywhere in the band — that IS the change.
      expect(screen.queryByTestId('yt-formats-rail')).not.toBeInTheDocument();
      expect(screen.queryByTestId('yt-rail-grid')).not.toBeInTheDocument();
      const capPx = Number.parseInt(content().style.maxWidth, 10);
      counts.push(tilesIn(Math.min(w - 2 * SHELL_PADDING, capPx) - rowInset));
    }

    expect(counts, `tile counts at ${widths.join('/')}px`).toEqual([3, 3, 3]);
    // The positive control: this arithmetic CAN produce a number other than 3, so the
    // flatness above is a measurement and not a constant.
    expect(tilesIn(640 - rowInset)).toBe(2);
    expect(tilesIn(300 - rowInset)).toBe(0);
  });
});

// ===========================================================================
// BELOW `xl` — ONE column, NO tabs.
//
// 🔴 THE TABS ARE GONE (operator, 2026-10-18). Thumbnails and Formats used to
// share a tab control below `xl`, which forced the two surfaces to move as a
// pair and hid whichever one was not selected. With the format picker inside
// the Generate form there is nothing left to tab between: the column is form
// (prompt, format carousel, model, Generate), then what the picker opens,
// then the thumbnails — everything mounted, everything visible, in reading
// order. The cases below pin the absence of the switcher, the visibility of
// what it used to hide, and that a first batch needs no switch to be seen.
// ===========================================================================

describe('below xl: one column, no tabs', () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    restoreClientWidth?.();
    restoreClientWidth = undefined;
    restoreResizeObserver?.();
    restoreResizeObserver = undefined;
  });

  async function renderAt(width: number, host: Parameters<typeof installMockMoneyHost>[0] = VIEWER) {
    setBlockWidth(width);
    uninstall = installMockMoneyHost(host);
    render(<App />);
    await screen.findByTestId('pm-generate');
  }

  /** Unmount the tree and uninstall the host, so the NEXT render starts empty. */
  async function teardown() {
    uninstall?.();
    uninstall = undefined;
    cleanup();
    restoreClientWidth?.();
    restoreClientWidth = undefined;
    restoreResizeObserver?.();
    restoreResizeObserver = undefined;
  }

  /** Re-render at another width, inside one test, in a fresh document. */
  async function rerenderAt(width: number, host: Parameters<typeof installMockMoneyHost>[0]) {
    await teardown();
    await renderAt(width, host);
  }

  /** Drive the real money path to a succeeded run, so the column has real content. */
  async function generateAt(width: number) {
    setBlockWidth(width);
    uninstall = installMockMoneyHost({
      ...VIEWER,
      consentGranted: true,
      cost: 8,
      pollsUntilDone: 2,
      buzzBalance: { blue: 100, green: 0, yellow: 0 },
    });
    const user = userEvent.setup();
    render(<App />);
    const generateBtn = await screen.findByTestId('pm-generate');
    await user.type(screen.getByLabelText(/prompt/i), 'a serene mountain lake');
    await user.click(generateBtn);
    await screen.findByAltText(/generated result/i, {}, { timeout: 5000 });
    return user;
  }

  it.each(TAB_WIDTHS.map((w) => [w] as const))(
    '🔴 at %ipx there is NO tab control and every surface is in the one column, visible',
    async (width) => {
      await renderAt(width);

      // The switcher and both of its panels are gone, in every spelling.
      expect(screen.queryByTestId('yt-panel-tabs')).not.toBeInTheDocument();
      expect(screen.queryByTestId('yt-panel-thumbnails')).not.toBeInTheDocument();
      expect(screen.queryByTestId('yt-panel-formats')).not.toBeInTheDocument();
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
      expect(screen.queryAllByRole('tab')).toHaveLength(0);
      expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
      // And no rail either — one column is the whole shape below `xl`.
      expect(screen.queryByTestId('yt-rail-grid')).not.toBeInTheDocument();
      expect(screen.queryByTestId('yt-formats-rail')).not.toBeInTheDocument();

      // Everything the tabs used to take turns hiding is mounted AND visible:
      // the form (with the carousel inside it), what the picker opens, and —
      // once there are rows — the thumbnails below them.
      for (const id of ['yt-format-picker', 'yt-format-grid', 'yt-format-cost-note', 'yt-format-new', 'yt-format-detail']) {
        expect(screen.getByTestId(id), `${id} is not visible in the single column`).toBeVisible();
      }
      expect(screen.getByLabelText(/prompt/i)).toBeVisible();
      expect(screen.getByTestId('pm-generate')).toBeVisible();

      // The tier the decision was made from, so a failure says WHY.
      expect(document.querySelector('[data-block-tier]')).toHaveAttribute(
        'data-block-tier',
        resolveBlockTier(width),
      );
    },
  );

  it('🔴 1439px is one column and 1440px gets the two-track rail — the cutoff, pinned on both sides', async () => {
    // 🔴 EVERY OTHER FIXTURE SITS INSIDE A TIER, SO NONE OF THEM CAN SEE WHERE THE
    // CUTOFF IS. These are adjacent integers on either side of the breakpoint.
    await renderAt(BELOW_XL_CUTOFF);
    expect(screen.queryByTestId('yt-rail-grid')).not.toBeInTheDocument();
    expect(screen.queryByTestId('yt-panel-tabs')).not.toBeInTheDocument();
    expect(document.querySelector('[data-block-tier]')).toHaveAttribute('data-block-tier', 'lg');

    await rerenderAt(XL_CUTOFF, VIEWER);
    expect(screen.getByTestId('yt-rail-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('yt-formats-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('yt-panel-tabs')).not.toBeInTheDocument();
    expect(screen.getByTestId('yt-rail-grid').style.gridTemplateColumns).toBe(
      expectedRailTracks(XL_CUTOFF),
    );
    expect(document.querySelector('[data-block-tier]')).toHaveAttribute('data-block-tier', 'xl');
    expect(resolveBlockTier(BELOW_XL_CUTOFF)).not.toBe(resolveBlockTier(XL_CUTOFF));
  });

  it('🔴 a first batch needs NO switch: the results land in the same column, under the form', async () => {
    await generateAt(INSIDE.base);

    // The generated image and its history row are simply THERE — visible, with
    // no tab to press and no panel to swap. (Under the tabs this needed the
    // first-batch latch to move the selection; the latch went with the tabs.)
    const img = screen.getByAltText(/generated result/i);
    expect(img).toBeVisible();
    expect(screen.getByTestId('yt-history-row')).toBeVisible();
    // ...and they are BELOW the form in reading order.
    const prompt = screen.getByLabelText(/prompt/i);
    expect(
      prompt.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the generated image comes BEFORE the prompt box',
    ).toBeTruthy();
  });

  it('🔴 the column holds EXACTLY what the rail layout holds — the same surfaces, one container apart', async () => {
    // The parity claim the tab panels used to carry, restated for a layout
    // with no panels: below `xl` and at `xl`+ the app renders the SAME
    // surface testids; only the container nodes (rail / main / grid) differ.
    const CONTAINERS = ['yt-rail', 'yt-main', 'yt-rail-grid'];
    const surfaces = (root: HTMLElement) =>
      testidsIn(root).filter((id) => !CONTAINERS.includes(id));

    await generateAt(INSIDE.base);
    const narrow = surfaces(content());
    await teardown();

    await generateAt(INSIDE.xl);
    const wide = surfaces(content());

    expect(narrow).toEqual(wide);
    // The control: the set is not trivially small — it names the real surfaces.
    for (const id of ['yt-format-picker', 'yt-format-grid', 'yt-format-detail', 'yt-history-row', 'pm-generate']) {
      expect(narrow).toContain(id);
    }
  });
});


describe('the cost disclosures survive', () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    restoreClientWidth?.();
    restoreClientWidth = undefined;
    restoreResizeObserver?.();
    restoreResizeObserver = undefined;
  });

  /** Collapse whitespace so a re-wrap in JSX is not a failure. */
  const norm = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('the PRE-spend per-format cost note is VISIBLE and says generations cost Buzz', async () => {
    setBlockWidth(INSIDE.md);
    uninstall = installMockMoneyHost(VIEWER);
    render(<App />);
    await screen.findByTestId('pm-generate');

    // One format is selected by default (the at-least-one invariant).
    const note = screen.getByTestId('yt-format-cost-note');
    // 🔴 VISIBILITY FIRST, THEN THE STRING. The note lives in the form now
    // (the carousel is part of it), so it is on screen at every width with no
    // tab to select and no panel to hide it — the previous version of this
    // case had to care which tab was default; this one asserts there is no
    // tab at all.
    expect(screen.queryByTestId('yt-panel-tabs')).not.toBeInTheDocument();
    expect(note, 'the per-format cost note is hidden').toBeVisible();
    expect(norm(note)).toBe('One generation. Costs Buzz.');

    // The other pre-spend disclosure is the price on the Generate button —
    // the ONLY price surface now that the Buzz picker is hidden.
    expect(screen.getByTestId('pm-generate')).toBeVisible();
    expect(screen.queryByTestId('pm-account-trigger')).not.toBeInTheDocument();
  });

  it('the cost note scales to N formats — the format count IS the bill', async () => {
    // The plural arm is a different string, and it is the one that carries the
    // "each one costs" warning. Selecting a second format is what makes the count
    // reachable, and it is the interaction that doubles the price.
    setBlockWidth(INSIDE.md);
    uninstall = installMockMoneyHost(VIEWER);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');

    const unselected = screen
      .getAllByTestId('yt-format-card')
      .find((c) => c.querySelector('[role="checkbox"][aria-checked="false"]'));
    expect(unselected, 'no unselected format card to click').toBeDefined();
    // 🔴 THE CARD IS VISIBLE BEFORE IT IS CLICKED. `userEvent.click` gates on
    // `pointer-events`, not on visibility, so in jsdom it succeeds just as well on a
    // `display: none` panel — which is exactly what this case used to do. Without this line
    // the interaction below is not evidence that a viewer could perform it.
    expect(unselected!, 'the format card a viewer must click is hidden').toBeVisible();
    await user.click(unselected!.querySelector('[role="checkbox"]') as HTMLElement);

    const note = screen.getByTestId('yt-format-cost-note');
    expect(note).toBeVisible();
    expect(norm(note)).toBe('2 separate generations — each one costs Buzz.');
  });

  it('the POST-spend figure is reported, and it is the SERVER’s number', async () => {
    // The third disclosure: what was actually taken. It must never be the estimate —
    // a partial failure would otherwise bill for work that never ran.
    setBlockWidth(INSIDE.md);
    uninstall = installMockMoneyHost({
      ...VIEWER,
      consentGranted: true,
      cost: 8,
      pollsUntilDone: 2,
      buzzBalance: { blue: 100, green: 0, yellow: 0 },
    });
    const user = userEvent.setup();
    render(<App />);
    const generateBtn = await screen.findByTestId('pm-generate');
    await user.type(screen.getByLabelText(/prompt/i), 'a serene mountain lake');
    await user.click(generateBtn);
    await screen.findByAltText(/generated result/i, {}, { timeout: 5000 });

    // 🔴 THE `pm-spent` ALERT IS GONE IN EVERY STATE and the figure it carried now
    // lives on the history row — so the "third disclosure" this case is about is
    // asserted THERE, with the funding pool it was always paired with. Pinned as the
    // whole normalised string so a reword cannot drift past it, plus the pool on the
    // bolt, which is the machine-readable half.
    expect(screen.queryByTestId('pm-spent')).not.toBeInTheDocument();
    const cost = await screen.findByTestId('yt-history-cost');
    await waitFor(() => expect(norm(cost)).toBe('8 Buzz from your blue balance'));
    expect(within(cost).getByTestId('yt-history-bolt')).toHaveAttribute('data-buzz-type', 'blue');
    expect(cost).toHaveAttribute('title', '8 Buzz from your blue balance');
  });
});

// ===========================================================================
// BOTH THEMES, ON THE RENDERED APP — mandatory under `brandDepth: "skin"`.
//
// `palette.test.ts` grades every surface/border/text PAIR in both themes. What it
// cannot see is whether the App reaches for the right palette: a component that
// hardcoded `palette.dark` would leave that file completely green. So each
// assertion below names the theme's own value AND rejects the other theme's.
// ===========================================================================

describe.each([
  ['dark', palette.dark, palette.light],
  ['light', palette.light, palette.dark],
] as const)('the App skins itself for the %s theme', (theme, own: Palette, other: Palette) => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    restoreClientWidth?.();
    restoreClientWidth = undefined;
    restoreResizeObserver?.();
    restoreResizeObserver = undefined;
  });

  it('the block root carries the theme and the page ground', async () => {
    setBlockWidth(INSIDE.md);
    uninstall = installMockMoneyHost({ ...VIEWER, theme });
    render(<App />);
    await screen.findByTestId('pm-generate');

    const root = document.querySelector('[data-block-tier]') as HTMLElement;
    expect(root).toHaveAttribute('data-theme', theme);
    expect(root.style.backgroundColor).toBe(rgb(own.page));
    expect(root.style.backgroundColor).not.toBe(rgb(other.page));
    expect(root.style.color).toBe(rgb(own.text));
    expect(root.style.color).not.toBe(rgb(other.text));
  });

  it('the block root hands the stylesheet THIS theme’s focus ring', async () => {
    // 🔴 THE OTHER HALF OF A SEAM NEITHER FILE OWNS. `palette.test.ts` pins that
    // `index.css` paints the outline from `--yt-focus-ring` and from nothing else;
    // this pins that the App actually SETS that property, and sets it from the right
    // theme. Each file alone leaves the ring undefined in production — the stylesheet
    // would fall through to `currentColor`, which is a plausible-looking outline and
    // would never fail anything.
    setBlockWidth(INSIDE.md);
    uninstall = installMockMoneyHost({ ...VIEWER, theme });
    render(<App />);
    await screen.findByTestId('pm-generate');

    const root = document.querySelector('[data-block-tier]') as HTMLElement;
    expect(root.style.getPropertyValue('--yt-focus-ring')).toBe(own.brand);
    expect(root.style.getPropertyValue('--yt-focus-ring')).not.toBe(other.brand);
  });

  it('the hero gradient uses BOTH stops from THIS theme, plus its ink', async () => {
    // The hero was the surface that used to be entirely host-owned
    // (`--civitai-color-primary` → `-primary-hover` → `-surface-2`). Under `skin`
    // its light-theme pair is a separate set of literals, which is precisely the
    // thing that stays invisible until someone opens the other theme.
    //
    // 🔴 THIS ASSERTION MOVED FROM `style.background` TO `style.backgroundImage`,
    // AND THAT IS A SHAPE CHANGE, NOT A WEAKENING. The hero now emits a three-layer
    // `background-image` plus its own size/position/repeat longhands, and jsdom's
    // `background` shorthand getter composes those longhands back into a string with
    // ` right center no-repeat` appended — so the old whole-string `toBe` could only
    // have been kept by writing the position and repeat into the expectation, which
    // asserts chrome rather than colour. The claim is unchanged and still whole: the
    // ENTIRE layer list, in order, pinned as one string. The three-layer design has
    // its own coverage in "the hero banner image" below.
    setBlockWidth(INSIDE.md);
    uninstall = installMockMoneyHost({ ...VIEWER, theme });
    render(<App />);
    await screen.findByTestId('pm-generate');

    const hero = screen.getByTestId('yt-hero');
    expect(hero.style.backgroundImage).toBe(
      `linear-gradient(90deg, ${own.heroTo} 0%, ${own.heroTo} 42%, transparent 82%), ` +
        `url("/hero-banner.jpg"), ` +
        `linear-gradient(135deg, ${own.heroFrom} 0%, ${own.heroTo} 100%)`,
    );
    expect(hero.style.backgroundImage).not.toContain(other.heroFrom);
    expect(hero.style.color).toBe(rgb(own.heroFg));
  });

  it('the model field and a selected format card (ground, border, brand check) all read this theme', async () => {
    setBlockWidth(INSIDE.md);
    uninstall = installMockMoneyHost({ ...VIEWER, theme });
    render(<App />);
    await screen.findByTestId('pm-generate');

    // A surface + a border + text, on one element.
    const model = screen.getByTestId('pm-model-label');
    expect(model.style.backgroundColor).toBe(rgb(own.surface));
    expect(model.style.color).toBe(rgb(own.text));
    expect(model.style.borderColor).toBe(rgb(own.border));
    expect(model.style.backgroundColor).not.toBe(rgb(other.surface));

    // The SELECTED state: tint ground + tint border. One format is always
    // selected (the at-least-one invariant), so this needs no interaction.
    const selected = screen
      .getAllByTestId('yt-format-card')
      .find((c) => c.querySelector('[role="checkbox"][aria-checked="true"]'));
    expect(selected).toBeDefined();
    expect(selected!.style.backgroundColor).toBe(rgb(own.brandTint));
    expect(selected!.style.borderColor).toBe(rgb(own.brandTintBorder));
    expect(selected!.style.backgroundColor).not.toBe(rgb(other.brandTint));

    // 🔴 THE `brand`/`brandFg` PAIR MOVED SURFACE AND THIS CASE FOLLOWED IT. It used
    // to be graded on the selected images-per-format PILL (`pm-quantity-1` brand
    // ground, `pm-quantity-2` plain surface). That control is the pack's `<Select>`
    // now — auto-themed by the pack, so the app paints no colour on it and there is
    // nothing of OURS to grade there. The selected format card's check badge is the
    // app's remaining `brand`-on-`brandFg` surface, so it is what carries the pair.
    // Dropping the assertion instead would have left `brand`/`brandFg` ungraded in
    // Guard A's blind spot (it checks provenance, never contrast).
    const check = within(selected!).getByTestId('yt-format-check');
    expect(check.style.backgroundColor).toBe(rgb(own.brand));
    expect(check.style.color).toBe(rgb(own.brandFg));
    expect(check.style.backgroundColor).not.toBe(rgb(other.brand));
    // ...and it is a DIFFERENT ground from the card it sits on, so this is not two
    // reads of one token.
    expect(check.style.backgroundColor).not.toBe(selected!.style.backgroundColor);
  });

  it('the rail ground comes from THIS theme, at xl', async () => {
    // The rail is new in this pass, so it has no host-token history to fall back
    // on — if it were wrong in one theme nothing else would say so. `INSIDE.xl`, not
    // `INSIDE.lg`: the rail moved to `xl`, and at 1301 there is no rail to grade.
    setBlockWidth(INSIDE.xl);
    uninstall = installMockMoneyHost({ ...VIEWER, theme });
    render(<App />);
    await screen.findByTestId('pm-generate');

    const rail = screen.getByTestId('yt-rail');
    expect(rail.style.backgroundColor).toBe(rgb(own.railBg));
    expect(rail.style.borderColor).toBe(rgb(own.borderStrong));
    expect(rail.style.borderColor).not.toBe(rgb(other.borderStrong));
  });

  it('secondary copy uses the dim TOKEN, never an opacity', async () => {
    // 🔴 THE OLD CODE DIMMED THIS WITH `opacity: 0.8` ON TOP OF A TOKEN, which
    // makes the realized contrast a number no test can read off the palette —
    // and under `skin` the contrast of every text pair is the claim. An explicit
    // token is assertable; an opacity is not.
    setBlockWidth(INSIDE.md);
    uninstall = installMockMoneyHost({ ...VIEWER, theme });
    render(<App />);
    await screen.findByTestId('pm-generate');

    const note = screen.getByTestId('yt-format-cost-note');
    expect(note.style.color).toBe(rgb(own.textDim));
    expect(note.style.opacity).toBe('');
  });
});

// ===========================================================================
// THE HERO BANNER — three layers, and the ORDER is the whole guarantee.
//
// 🔴 WHY THE ORDER IS A TEST AND NOT A COMMENT. `background-image` paints its FIRST
// entry on TOP, which is the opposite of how a list of layers reads to most people.
// Move the photo in front of the scrim and every one of the colour assertions below
// still passes — the same three strings are present, the same two palette stops are
// named — while the headline is now sitting on an arbitrary photograph and the
// already-graded `['heroFg','heroTo']` pair has stopped describing anything a viewer
// sees. So the order is asserted by INDEX, in both themes, and a reordering goes red.
//
// 🔴 AND WHAT THESE CANNOT SEE. jsdom performs no layout, evaluates no gradient and
// fetches no image. Nothing here observes the scrim's realized width, the crop, or
// the photo painting at all. Every claim below is about the emitted CSS plus
// arithmetic — the same standing caveat the rail's sticky bound carries.
// ===========================================================================

describe.each([
  ['dark', palette.dark, palette.light],
  ['light', palette.light, palette.dark],
] as const)('the hero banner image, %s theme', (theme, own: Palette, other: Palette) => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    restoreClientWidth?.();
    restoreClientWidth = undefined;
    restoreResizeObserver?.();
    restoreResizeObserver = undefined;
  });

  /** One rail-tier render, returning the hero's emitted `background-image` list. */
  async function heroLayers(width: number = INSIDE.xl): Promise<string> {
    setBlockWidth(width);
    uninstall = installMockMoneyHost({ ...VIEWER, theme });
    render(<App />);
    await screen.findByTestId('pm-generate');
    return screen.getByTestId('yt-hero').style.backgroundImage;
  }

  it('the scrim’s OPAQUE run is literally this theme’s heroTo, at both its stops', async () => {
    // 🔴 THIS IS THE CONTRAST ARGUMENT, AND IT IS THE REASON THE SCRIM IS NOT A
    // TRANSLUCENT BLACK. `palette.ts` already grades `['heroFg','heroTo']` and
    // `['heroSubFg','heroTo']` at AA in both themes. Those two pairs stay TRUE
    // STATEMENTS ABOUT THE SCREEN only while the thing actually painted behind the
    // text is `heroTo` itself — an `rgba(0,0,0,.55)` scrim would produce a realized
    // ground that is in no ledger, and the app would be claiming a contrast it no
    // longer has. Both stops are named, because a scrim that started at `heroTo`
    // and faded from 0% would leave the headline on the photo immediately.
    const image = await heroLayers();
    expect(image).toContain(
      `linear-gradient(90deg, ${own.heroTo} 0%, ${own.heroTo} 42%, transparent 82%)`,
    );
    // The other theme's ground must NOT appear — a hardcoded `palette.dark` would
    // leave every "contains heroTo" assertion green in exactly one of the two arms.
    expect(image).not.toContain(other.heroTo);
    // And the run is OPAQUE where the text is: the fade-out stop is the third one,
    // never the first or the second.
    expect(image.indexOf('transparent')).toBeGreaterThan(image.indexOf('42%'));
  });

  it('the banner image layer is requested, at the path public/ actually serves', async () => {
    const image = await heroLayers();
    // jsdom re-quotes `url('…')` to `url("…")`; the literal here is the EMITTED
    // form, written out rather than derived from `HERO_BANNER_SRC`, so a typo in
    // the source cannot agree with itself.
    expect(image).toContain('url("/hero-banner.jpg")');
  });

  it('the no-bytes FALLBACK gradient survives, with BOTH of this theme’s stops', async () => {
    // 🔴 THE FALLBACK IS THE REASON THIS CHANGE IS SAFE TO SHIP. Layer 3 is the
    // gradient the hero had before there was an image: if the banner 404s, is
    // blocked, or is still in flight, the viewer gets exactly what shipped in PR #7.
    // Deleting it "because the image covers it" is the silent regression this pins —
    // and it must be the LAST layer, since anything painted after it hides it.
    const image = await heroLayers();
    const fallback = `linear-gradient(135deg, ${own.heroFrom} 0%, ${own.heroTo} 100%)`;
    expect(image).toContain(fallback);
    expect(image.endsWith(fallback)).toBe(true);
    expect(image).not.toContain(other.heroFrom);
  });

  it('the layers are ordered scrim → photo → fallback, which is front → back', async () => {
    const image = await heroLayers();
    const scrim = image.indexOf('linear-gradient(90deg');
    const photo = image.indexOf('url("/hero-banner.jpg")');
    const fallback = image.indexOf('linear-gradient(135deg');

    // All three present — otherwise a `-1` from a missing layer would satisfy the
    // ordering below by accident.
    expect(scrim).toBeGreaterThanOrEqual(0);
    expect(photo).toBeGreaterThanOrEqual(0);
    expect(fallback).toBeGreaterThanOrEqual(0);

    expect(scrim).toBeLessThan(photo);
    expect(photo).toBeLessThan(fallback);

    // Exactly three layers: two gradients and one url. A fourth would change what
    // "front" means without moving any index above.
    expect(image.match(/linear-gradient\(/g)).toHaveLength(2);
    expect(image.match(/url\(/g)).toHaveLength(1);
  });

  it('the photo is sized and anchored so the burst on its right survives a crop', async () => {
    setBlockWidth(INSIDE.xl);
    uninstall = installMockMoneyHost({ ...VIEWER, theme });
    render(<App />);
    await screen.findByTestId('pm-generate');

    const hero = screen.getByTestId('yt-hero');
    expect(hero.style.backgroundSize).toBe('cover');
    expect(hero.style.backgroundPosition).toBe('right center');
    expect(hero.style.backgroundRepeat).toBe('no-repeat');
  });

  it('the text did not move: same padding, still start-aligned, still left', async () => {
    // The `minHeight` below creates free space in the grid for the first time, and
    // grid's DEFAULT `align-content: stretch` inflates auto rows — which would open
    // a gap between the headline and the sub-line. `start` is what makes "the text
    // does not move" true rather than merely intended. No `textAlign` and no
    // `justifyContent`: the hero is a plain left-aligned stack, as before.
    setBlockWidth(INSIDE.xl);
    uninstall = installMockMoneyHost({ ...VIEWER, theme });
    render(<App />);
    await screen.findByTestId('pm-generate');

    const hero = screen.getByTestId('yt-hero');
    expect(hero.style.padding).toBe('22px 28px');
    expect(hero.style.alignContent).toBe('start');
    expect(hero.style.textAlign).toBe('');
    expect(hero.style.justifyContent).toBe('');
  });
});

describe('the hero has room for the image to read', () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    restoreClientWidth?.();
    restoreClientWidth = undefined;
    restoreResizeObserver?.();
    restoreResizeObserver = undefined;
  });

  it('the minHeight DIFFERS between the rail and non-rail layouts', async () => {
    // 🔴 BOTH ARMS, BECAUSE EITHER ALONE PASSES AGAINST A CONSTANT — the same mutant
    // that survived a green suite for `heroStyle`'s padding. The two fixtures are
    // 1523 (`xl`, rail on) and 1099 (`md`, rail off): different tiers, opposite sides
    // of the rail boundary, and neither is any of 480 / 768 / 1024 / 1184 / 1440, so
    // the comparison is genuinely reachable rather than decided by a boundary. The wide
    // arm was 1301 (`lg`) until the rail moved to `xl`, where 1301 is rail-OFF and both
    // arms would have been the same number.
    setBlockWidth(INSIDE.xl);
    uninstall = installMockMoneyHost(VIEWER);
    render(<App />);
    await screen.findByTestId('pm-generate');

    const wide = screen.getByTestId('yt-hero');
    expect(wide.style.minHeight).toBe('132px');
    // Derived from the layout rather than re-stated, so the two cannot drift.
    expect(wide.style.minHeight).toBe(`${layoutForTier('xl').heroMinHeight}px`);

    uninstall?.();
    restoreClientWidth?.();
    restoreResizeObserver?.();
    setBlockWidth(INSIDE.md);
    uninstall = installMockMoneyHost(VIEWER);
    render(<App />);
    const narrow = (await screen.findAllByTestId('yt-hero')).at(-1)!;
    expect(narrow.style.minHeight).toBe('104px');
    expect(narrow.style.minHeight).not.toBe(wide.style.minHeight);
  });

  it('the file the hero asks for is really in public/ — the seam neither side owns', async () => {
    // 🔴 TWO INDEPENDENT CLAIMS, AND THE HERO HIDES THE SECOND ONE FAILING. "the
    // style requests /hero-banner.jpg" and "a file is at public/hero-banner.jpg" are
    // separately true or false, and because layer 3 is a working gradient a 404 here
    // looks EXACTLY like the design working. Nothing on screen, and no other test in
    // this repo, would ever say so.
    //
    // Labelled honestly: this is an INVARIANT GUARD on the public/ side (the asset
    // was committed before this change, so that half was already true) and genuine
    // regression coverage on the URL side.
    const bytes = readFileSync('public/hero-banner.jpg');
    expect(bytes.byteLength).toBeGreaterThan(0);
    // A JPEG, not a renamed something-else: SOI marker.
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    expect(HERO_BANNER_SRC).toBe('/hero-banner.jpg');
    // `public/` is copied verbatim to the output root, so the served path is the
    // file's path under public/ with a leading slash — and nothing else.
    expect(`public${HERO_BANNER_SRC}`).toBe('public/hero-banner.jpg');
  });
});

// ===========================================================================
// THE TWO SURFACES THAT NEED A GENERATION FIRST
// ===========================================================================

/**
 * 🔴 A THIRD STUB, AND LIKE THE OTHER TWO IT IS LOAD-BEARING. jsdom fetches
 * nothing, so an `<img>`'s `load` event NEVER fires and `loadImageElement`'s
 * promise never settles — the editor stays on `editorStatus === 'loading'` forever
 * and renders only "Loading image…". A test of the editor's LAYOUT written without
 * this would time out looking for a split that the code is perfectly capable of
 * rendering. (The existing e2e editor test only asserts the editor mounted, which
 * is why it never needed this.)
 *
 * The draw effect is unaffected: jsdom's `canvas.getContext('2d')` returns null, so
 * `drawThumbnail` is skipped either way.
 */
function installImageLoad(): () => void {
  const originalSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get(this: HTMLImageElement) {
      return (originalSrc?.get?.call(this) as string) ?? '';
    },
    set(this: HTMLImageElement, value: string) {
      originalSrc?.set?.call(this, value);
      setTimeout(() => this.onload?.(new Event('load')), 0);
    },
  });

  // jsdom has no 2D context (it logs "Not implemented" to its virtual console and
  // returns undefined, which the draw effect then treats as falsy). Returning null
  // makes the skip EXPLICIT — the editor's layout is what these tests are about,
  // and a suite that prints a stack trace on the happy path trains people to
  // ignore its output.
  const originalCtx = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = () => null;

  return () => {
    if (originalSrc) Object.defineProperty(HTMLImageElement.prototype, 'src', originalSrc);
    HTMLCanvasElement.prototype.getContext = originalCtx;
  };
}

describe('results and the editor, at width', () => {
  let uninstall: (() => void) | undefined;
  let restoreImageLoad: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    restoreImageLoad?.();
    restoreImageLoad = undefined;
    restoreClientWidth?.();
    restoreClientWidth = undefined;
    restoreResizeObserver?.();
    restoreResizeObserver = undefined;
  });

  /** Drive the real money path to a succeeded run so candidates exist. */
  async function generate(width: number) {
    setBlockWidth(width);
    uninstall = installMockMoneyHost({
      ...VIEWER,
      consentGranted: true,
      cost: 8,
      pollsUntilDone: 2,
      buzzBalance: { blue: 100, green: 0, yellow: 0 },
    });
    const user = userEvent.setup();
    render(<App />);
    const generateBtn = await screen.findByTestId('pm-generate');
    await user.type(screen.getByLabelText(/prompt/i), 'a serene mountain lake');
    await user.click(generateBtn);
    await screen.findByAltText(/generated result/i, {}, { timeout: 5000 });
    return user;
  }

  /**
   * 🔴 THIS CASE USED TO ASSERT A PER-TIER COLUMN COUNT AND THE ASSERTION IS NOW THE
   * OPPOSITE — the count is what was broken. History:
   *
   *  - v1 was `repeat(2, …)` at EVERY width, on a 361px phone and a 1907px monitor
   *    alike. That was the defect the tier ladder fixed.
   *  - v2 (what this replaces) made the count `layout.resultColumns` — 1/2/3/4 — and
   *    was individually correct, but `History.tsx` applied the SAME template at TWO
   *    NESTED levels: a grid of batch ROWS and, inside each row, a grid of IMAGES. The
   *    counts MULTIPLIED. 3 × 3 at `lg` made each thumbnail a ninth of the main
   *    column; 4 × 4 on an ultrawide block made it a sixteenth — an ~85px-wide 16:9
   *    tile on a 1920px screen. A per-tier assertion could not see that at all,
   *    because each level was correct in isolation.
   *  - v3, below: rows are FULL WIDTH (nothing nests) and the images are
   *    INTRINSICALLY sized — `auto-fill` with an `IMAGE_MIN_PX` floor, so there is no
   *    count left to be wrong.
   *  - v3.1, which is what this now asserts: that floor is CLAMPED by `min(…, 100%)`.
   *    A bare `minmax(300px, 1fr)` is a HARD floor — `auto-fill` drops to one column
   *    and then stops, so a container narrower than 300px OVERFLOWS horizontally. The
   *    base tier really is narrower: available width is blockWidth − 68 (two
   *    `SHELL_PADDING`s at 24 and two `panelRowStyle` insets at 10), so this suite's
   *    own 361px base fixture has 293px for a 300px floor, and a 360px phone ~292px.
   *    `min(IMAGE_MIN_PX, 100%)` lets the single column fall back to the container.
   *
   * 🔴 SO THE CLAIM BEING WIDENED HERE IS "TIER-INDEPENDENT", AND IT NEEDS THE SAME
   * FOUR WIDTHS TO BE WORTH ANYTHING. A single-width run cannot tell an intrinsic
   * rule from a count that happens to be right at that one width — which is exactly
   * how a config that pins a dimension goes blind to that dimension's bugs. Four
   * widths spanning phone to ultrawide, one expected string, asserted identical at
   * all four.
   *
   * 🔴 jsdom LAYS NOTHING OUT, AND THAT BOUNDS WHAT THE CLAMP CASE CAN CLAIM. These
   * are assertions about the STYLE CONTRACT a browser reads, never about a rendered
   * tile size or a measured overflow. The clamp is standard CSS and jsdom's CSSOM
   * round-trips it verbatim (measured), but NO test here has seen the grid fit inside
   * a 293px container — only that the rule a browser would act on is present.
   */
  const INTRINSIC = `repeat(auto-fill, minmax(min(${IMAGE_MIN_PX}px, 100%), 1fr))`;

  it.each([
    [INSIDE.base],
    [INSIDE.md],
    [INSIDE.xl],
    [INSIDE_ULTRAWIDE],
  ])('🔴 at %ipx the image grid is intrinsically sized and the rows are full width', async (width) => {
    await generate(width as number);
    const grid = screen.getByTestId('yt-history-images');
    // Identical at every width — that IS the claim.
    expect(grid.style.gridTemplateColumns).toBe(INTRINSIC);
    // The rows are one per line, so the two rules can no longer multiply.
    expect(screen.getByTestId('yt-history-grid').style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    // 🔴 AND NEITHER CARRIES A COLUMN COUNT. `repeat(<digit>` is the multiplying rule
    // coming back, under whatever name — this is the structural guard, and it is what
    // a mutant reinstating `repeat(${'$'}{layout.resultColumns}, …)` dies on at EVERY width
    // rather than only at the one where the number differs.
    expect(grid.style.gridTemplateColumns).not.toMatch(/repeat\(\s*\d/);
    expect(screen.getByTestId('yt-history-grid').style.gridTemplateColumns).not.toMatch(
      /repeat\(\s*\d/,
    );
    // 🔴 AND THE FLOOR IS CLAMPED BY A PERCENTAGE OF THE CONTAINER — the structural
    // half of the literal above, and the one that names the DEFECT rather than the
    // current spelling. A bare px floor passes the `repeat(\d` guard and the
    // `auto-fill` guard and still overflows the narrowest tier; only a `min(…, %)`
    // inside the `minmax` lower bound can shrink. The regex is deliberately
    // whitespace-tolerant and does not pin the argument ORDER, because `min()` is
    // commutative and a future reword of the style must not fail a money-irrelevant
    // assertion.
    expect(grid.style.gridTemplateColumns).toMatch(
      /minmax\(\s*min\(\s*(?:\d+px\s*,\s*100%|100%\s*,\s*\d+px)\s*\)\s*,/,
    );
  });

  // 🔴 NO SEPARATE "SAME AT THE NARROWEST AND THE WIDEST" CASE, DELIBERATELY. It would
  // be the same claim as the `it.each` above — one expected string asserted at four
  // widths spanning phone to ultrawide IS the tier-independence measurement — bought
  // for a second full money-path run (≈5s each) and a teardown helper this file does
  // not otherwise need. The structural `not.toMatch(/repeat\(\s*\d/)` is what makes the
  // four literals more than four coincidences.

  it('🔴 the PROMPT comes before the results, in BOTH layouts — the order the operator set', async () => {
    // 🔴 THIS CASE ASSERTED THE OPPOSITE ONE REVISION AGO, AND THE REVERSAL IS THE
    // OPERATOR'S DECISION, NOT A REGRESSION. "Results above the controls" was right while
    // the format picker sat BETWEEN the two halves of the inputs: the primary object could
    // be first and the prompt could still precede the picker. Tabs ended that — Thumbnails
    // and Formats share one tab control, a tab control cannot be in two places, so the
    // panels move as a pair. Putting them first put the PICKER above the prompt box, and
    // the picker decides the bill, so reading "pick your formats" before "say what you
    // want" inverts the sentence the form is. The operator chose prompt-then-formats.
    //
    // 🔴 ASSERTED AT BOTH TIERS, because "the order" is one claim about two different
    // containers and the tabbed arm alone cannot see the rail arm. At the rail tier it
    // follows from the grid's child order (inputs rail first, thumbnails second), which is
    // also asserted directly as a list in the rail describe; here it is the same property
    // read the way a viewer meets it — document order between the prompt and the images.
    for (const width of [INSIDE.md, INSIDE.xl]) {
      const railed = width === INSIDE.xl;
      await generate(width);
      // The layout the order was read from, so a failure says WHICH arm broke.
      // There are no tabs at either width any more; the rail is the only
      // structural difference between the two arms.
      expect(screen.queryByTestId('yt-panel-tabs')).not.toBeInTheDocument();
      expect(Boolean(screen.queryByTestId('yt-rail-grid'))).toBe(railed);
      const results = screen.getByTestId('yt-history-images');
      const prompt = screen.getByLabelText(/prompt/i);
      expect(
        prompt.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING,
        `at ${width}px the thumbnail images come BEFORE the prompt box`,
      ).toBeTruthy();
      // ...and the picker is after the prompt too, at BOTH widths — it is
      // inside the form now, which is the half the images comparison does
      // not cover.
      const picker = screen.getByTestId('yt-format-grid');
      expect(
        prompt.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING,
        'the format picker comes BEFORE the prompt box',
      ).toBeTruthy();
      cleanup();
      restoreClientWidth?.();
      restoreClientWidth = undefined;
      restoreResizeObserver?.();
      restoreResizeObserver = undefined;
    }
  });

  it('the editor puts the canvas beside its controls at xl', async () => {
    const user = await generate(INSIDE.xl);
    restoreImageLoad = installImageLoad();
    await user.click(screen.getAllByTestId('yt-history-edit')[0]);
    const split = await screen.findByTestId('pm-editor-split');
    expect(split).toHaveAttribute('data-layout', 'side-by-side');
    expect(split.style.gridTemplateColumns).toBe('minmax(0, 3fr) minmax(0, 2fr)');
    // The canvas and the text field are siblings in the split, not stacked in one
    // column — the point of the restructure.
    expect(screen.getByTestId('pm-editor-canvas').parentElement).toBe(split);
    expect(split).toContainElement(screen.getByTestId('pm-editor-controls'));
  });

  it('the editor stacks on a narrow block', async () => {
    const user = await generate(INSIDE.base);
    restoreImageLoad = installImageLoad();
    await user.click(screen.getAllByTestId('yt-history-edit')[0]);
    const split = await screen.findByTestId('pm-editor-split');
    expect(split).toHaveAttribute('data-layout', 'stacked');
    expect(split.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
  });
});
