import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveBlockTier, type BlockSizeTier } from '@civitai/blocks-react';

import { App, SHELL_PADDING } from './App.js';
import { layoutForTier } from './layout.js';
import { installMockMoneyHost } from './mock-buzz.js';
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
    expect(screen.getByTestId('pm-model-label')).toHaveTextContent(/SD XL 1\.0/);
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
    expect(box).toHaveAttribute('data-result-columns', String(expected.resultColumns));
    expect(box).toHaveAttribute('data-min-card', String(expected.formatMinCardPx));

    // 🔴 THE INLINE STYLE IS THE LAYOUT — an attribute is only a report of it. The
    // cap used to be asserted twice, as `data-max-width` and again as the style; the
    // attribute is gone from the shipped DOM because this line is the stronger of
    // the two claims. `maxWidth: null` must reach the DOM as NO cap, never as the
    // string "none".
    expect(box.style.maxWidth).toBe(expected.maxWidth === null ? '' : `${expected.maxWidth}px`);

    // The format grid is SIZED (auto-fill + a minimum), not counted.
    const grid = screen.getByTestId('yt-format-grid');
    expect(grid.style.gridTemplateColumns).toBe(
      `repeat(auto-fill, minmax(${expected.formatMinCardPx}px, 1fr))`,
    );

    // The rail exists exactly when the layout says so — asserted in BOTH
    // directions, because "the rail is present at lg" and "the rail is absent at
    // sm" are two different claims. This pair replaces a `data-rail` attribute that
    // said the same thing one element up: the element's presence and its grid
    // template are what a browser acts on, and they cannot be right while the rail
    // is missing.
    if (expected.rail) {
      const rail = screen.getByTestId('yt-rail');
      expect(screen.getByTestId('yt-main')).toBeInTheDocument();
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
      // The prompt is IN the rail, and the format picker is NOT — that is the
      // restructure, not just a second column existing.
      expect(rail).toContainElement(screen.getByLabelText(/prompt/i));
      expect(rail).not.toContainElement(grid);
      expect(screen.getByTestId('yt-main')).toContainElement(grid);
    } else {
      expect(screen.queryByTestId('yt-rail')).not.toBeInTheDocument();
      expect(screen.queryByTestId('yt-main')).not.toBeInTheDocument();
      expect(screen.queryByTestId('yt-rail-grid')).not.toBeInTheDocument();
    }

    // The one structural swap this app already shipped, still driven from the
    // same place.
    expect(screen.getByTestId('pm-model-row')).toHaveAttribute('data-layout', expected.modelRow);
  });

  it('ultrawide (1907px) gets the fourth column and the wider rail', async () => {
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
    expect(content()).toHaveAttribute('data-result-columns', '4');
    expect(content()).toHaveAttribute('data-min-card', '220');
    expect(screen.getByTestId('yt-rail-grid').style.gridTemplateColumns).toBe(
      '400px minmax(0, 1fr)',
    );
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
    expect(content()).toHaveAttribute('data-result-columns', '3');
    expect(screen.getByTestId('yt-rail-grid').style.gridTemplateColumns).toBe(
      '340px minmax(0, 1fr)',
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
    setBlockWidth(INSIDE.lg);
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
  // THE HERO AT `lg`+ — the brand surface, in a pass whose subject is the brand
  // =========================================================================

  it('the hero EXISTS in the rail layout, above both columns', async () => {
    // 🔴 DELETING `{hero}` FROM THE `lg`+ BRANCH USED TO LEAVE THE SUITE GREEN.
    // The hero was asserted only in the non-rail layout, so the app's brand surface
    // had no coverage at all on the widest screens — the ones this pass is about.
    setBlockWidth(INSIDE.lg);
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
    // rail boundary, which is the dimension the scaling keys on.
    setBlockWidth(INSIDE.lg);
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
// COST DISCLOSURE — the copy that may never be deleted.
//
// 🔴 NO TEST PINNED ANY OF THESE, IN THE PASS THAT DELETED THREE ADJACENT STRINGS
// AND RECORDED "KEPT: every cost disclosure" AS A DECISION. The deletions were
// right and the decision was right; what was missing is any mechanism that would
// notice the NEXT deletion. This app spends the viewer's own Buzz, so the three
// places it says so are the ones a copy-trimming pass must not reach.
//
// Pinned as WHOLE NORMALISED STRINGS rather than keywords. A guard on the word
// "Buzz" is walkable by rewording around it; the whole string makes a cosmetic
// reword fail the test, which is the price of a machine-readable claim.
//
// 🔴 AND ALL THREE REALLY ARE WHOLE, WHICH THIS HEADER TWICE CLAIMED WITHOUT IT
// BEING TRUE. The post-spend case was `toContain('Spent 8 Buzz')` — a substring
// that would have survived deleting the account note, or appending copy that
// contradicted it. It is a `toBe` now. Its expected value leads with `Done`
// because that is the `Alert`'s own `title` prop, written in `App.tsx`: app copy
// like the rest of the string, not pack chrome leaking into the assertion.
// ===========================================================================

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

  it('the PRE-spend per-format cost note says generations cost Buzz', async () => {
    setBlockWidth(INSIDE.md);
    uninstall = installMockMoneyHost(VIEWER);
    render(<App />);
    await screen.findByTestId('pm-generate');

    // One format is selected by default (the at-least-one invariant).
    expect(norm(screen.getByTestId('yt-format-cost-note'))).toBe('One generation. Costs Buzz.');
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
    await user.click(unselected!.querySelector('[role="checkbox"]') as HTMLElement);

    expect(norm(screen.getByTestId('yt-format-cost-note'))).toBe(
      '2 separate generations — each one costs Buzz.',
    );
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

    expect(norm(screen.getByTestId('pm-spent'))).toBe('DoneSpent 8 Buzz from your Blue account.');
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
    setBlockWidth(INSIDE.md);
    uninstall = installMockMoneyHost({ ...VIEWER, theme });
    render(<App />);
    await screen.findByTestId('pm-generate');

    const hero = screen.getByTestId('yt-hero');
    expect(hero.style.background).toBe(
      `linear-gradient(135deg, ${own.heroFrom} 0%, ${own.heroTo} 100%)`,
    );
    expect(hero.style.background).not.toContain(other.heroFrom);
    expect(hero.style.color).toBe(rgb(own.heroFg));
  });

  it('the model field, a selected format card and a quantity pill all read this theme', async () => {
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

    // The brand pill: brand ground + brandFg text. Quantity 1 is selected by
    // default.
    const pill = screen.getByTestId('pm-quantity-1');
    expect(pill.style.backgroundColor).toBe(rgb(own.brand));
    expect(pill.style.color).toBe(rgb(own.brandFg));
    expect(pill.style.backgroundColor).not.toBe(rgb(other.brand));

    // And an UNSELECTED pill is the plain surface, so the two states differ.
    const off = screen.getByTestId('pm-quantity-2');
    expect(off.style.backgroundColor).toBe(rgb(own.surface));
    expect(off.style.backgroundColor).not.toBe(pill.style.backgroundColor);
  });

  it('the rail ground comes from THIS theme, at lg', async () => {
    // The rail is new in this pass, so it has no host-token history to fall back
    // on — if it were wrong in one theme nothing else would say so.
    setBlockWidth(INSIDE.lg);
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

  it.each([
    [INSIDE.base, 1],
    [INSIDE.md, 2],
    [INSIDE.lg, 3],
    [INSIDE_ULTRAWIDE, 4],
  ])('the candidate grid is %i-wide → %i columns', async (width, columns) => {
    // 🔴 IT WAS `repeat(2, …)` AT EVERY WIDTH, including a 361px phone and a
    // 1907px monitor. Four widths, four different answers — a single-width test
    // could not tell a working ladder from a hardcoded 2.
    //
    // Asserted as the grid template only. A `data-columns` attribute used to repeat
    // the same number on the same element; the template is what the browser lays
    // out from, so the attribute was a second copy of one fact and is gone from the
    // shipped DOM.
    await generate(width as number);
    const grid = screen.getByTestId('yt-results-grid');
    expect(grid.style.gridTemplateColumns).toBe(`repeat(${columns}, minmax(0, 1fr))`);
  });

  it('the results land ABOVE the controls once they exist', async () => {
    // Phase 2: the app's primary object is the first thing on screen. Asserted
    // structurally (document order), not by looking for a heading.
    await generate(INSIDE.md);
    const results = screen.getByTestId('yt-results-grid');
    const prompt = screen.getByLabelText(/prompt/i);
    expect(
      results.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('the editor puts the canvas beside its controls at lg', async () => {
    const user = await generate(INSIDE.lg);
    restoreImageLoad = installImageLoad();
    await user.click(screen.getByTestId('pm-edit-0'));
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
    await user.click(screen.getByTestId('pm-edit-0'));
    const split = await screen.findByTestId('pm-editor-split');
    expect(split).toHaveAttribute('data-layout', 'stacked');
    expect(split.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
  });
});
