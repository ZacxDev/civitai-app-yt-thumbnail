import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

import { BUILTIN_FORMATS, CUSTOM_FORMATS_KEY, hasPreviewArt } from './formats.js';

/**
 * HOOK-BOUNDARY coverage for formats, storage, publishing and the
 * multi-workflow money path.
 *
 * 🔴 WHY AT THE HOOK BOUNDARY AND NOT THROUGH THE MOCK HOST. The mock host does
 * not police any of the things that matter here. It was read directly
 * (`blocks-react/dist/internal/mockHost.js`) to confirm it:
 *   - `APP_STORAGE_SET` stores whatever it is given. It never checks the viewer,
 *     so the ANONYMOUS-write rejection — which the real host enforces — simply
 *     does not exist there.
 *   - `SHARED_APPEND` validates only that `title` is a non-empty string, then
 *     echoes `body` and `data` back unmodified. It has NO opinion about which
 *     field the suffix travels in, which is precisely the decision that keeps
 *     published prompt text inside moderation.
 * A harness test would therefore pass whether or not those two behaviours are
 * right. The only surface that can see them is the ARGUMENTS the app passes to
 * the hooks, so that is what these assert.
 *
 * 🔴 RED-AT-BASE MATRIX. At the base ref (origin/main, e2c3108) `App` did not
 * import `useAppStorage`/`useSharedStorage` at all, there was no format picker,
 * and one Generate click made exactly one submit. This file cannot even be
 * mounted against that code — it fails on missing `./formats.js`. That is a
 * VACUOUS red, so:
 *
 *   NONE of this file is REGRESSION coverage. It is all BEHAVIOUR coverage for
 *   behaviour introduced by this change.
 *
 * The evidence that these assertions bite is the mutation sweep in
 * claudedocs/mutation-matrix-formats.md — in particular the suffix-in-`body`
 * case, which was killed by moving the suffix to `data` and watching THIS file's
 * `body` assertion fail.
 *
 * 🔴 The wholesale `vi.mock` below must list EVERY hook `App` imports. A missing
 * one fails as "No <name> export is defined on the mock", which reads exactly
 * like an assertion failure and proves nothing.
 */

const estimateFn = vi.fn<(body: unknown) => Promise<BlockWorkflowSnapshot>>();
const submitFn = vi.fn<(body: unknown) => Promise<BlockWorkflowSnapshot>>();
const pollFn = vi.fn<(id: string) => Promise<BlockWorkflowSnapshot>>();

const storageGet = vi.fn<(key: string) => Promise<unknown>>();
const storageSet = vi.fn<(key: string, value: unknown) => Promise<{ ok: true }>>();
const sharedAppend = vi.fn<(value: unknown) => Promise<{ key: string }>>();
const sharedList = vi.fn<(opts?: unknown) => Promise<{ items: unknown[] }>>();
const sharedReport = vi.fn<(key: string, reason?: string) => Promise<void>>();
const sharedVote = vi.fn<(key: string) => Promise<number>>();

/** Flipped per-test to exercise the anonymous path. */
const host = { viewer: { id: 2, username: 'dev' } as { id: number; username: string } | null };

vi.mock('@civitai/blocks-react', () => ({
  useBlockContext: () => ({ ready: true, viewer: host.viewer, theme: 'dark' }),
  useBlockResize: () => {},
  useBlockBreakpoint: () => ({
    tier: 'base',
    measured: false,
    atLeast: () => false,
    below: () => true,
  }),
  useBlockToken: () => ({ scopes: ['ai:write:budgeted'], raw: 't', expiresAt: '' }),
  useBuzzWorkflow: () => ({ estimate: estimateFn, submit: submitFn, poll: pollFn }),
  // A balance no single pool can cover at these costs would drag the account
  // ladder into these assertions; `null` keeps the ladder on Auto so these tests
  // are about formats and storage only. The ladder has its own tests.
  useBuzzBalance: () => ({ balance: null, loading: false, error: null, refetch: vi.fn() }),
  useRequestConsent: () => ({ requestConsent: vi.fn() }),
  useRequestSignIn: () => ({ requestSignIn: vi.fn() }),
  useResourcePicker: () => ({ open: vi.fn().mockResolvedValue(null) }),
  useImageUpload: () => ({ open: vi.fn().mockResolvedValue(null) }),
  // History's two hooks. `useAppWorkflows` is the LIVE half of the join (this
  // app's own generations for this viewer) and `useSaveImage` is the host-side
  // download bridge. Stubbed empty/no-op here: these suites are about other
  // surfaces, and a hook App imports but this mock omits fails with "No <name>
  // export is defined on the mock" — a FAILURE indistinguishable at a glance
  // from a broken assertion (see the note below).
  useAppWorkflows: () => ({
    workflows: [],
    cursor: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
  }),
  useSaveImage: () => ({ saveImage: vi.fn().mockResolvedValue(undefined) }),
  useAppStorage: () => ({
    get: storageGet,
    set: storageSet,
    delete: vi.fn().mockResolvedValue({ ok: true, deleted: true }),
    list: vi.fn().mockResolvedValue({ keys: [] }),
    getQuota: vi
      .fn()
      .mockResolvedValue({ usedBytes: 0, rowCount: 0, limitBytes: 5e7, limitRows: 1e6 }),
  }),
  useSharedStorage: () => ({
    list: sharedList,
    get: vi.fn().mockResolvedValue(null),
    report: sharedReport,
    getCount: vi.fn().mockResolvedValue(0),
    getCounts: vi.fn().mockResolvedValue({}),
    append: sharedAppend,
    update: vi.fn().mockResolvedValue(undefined),
    vote: sharedVote,
    unvote: vi.fn().mockResolvedValue(0),
    withdraw: vi.fn().mockResolvedValue({ ok: true, deleted: true }),
  }),
}));

const { App } = await import('./App.js');

const snap = (over: Partial<BlockWorkflowSnapshot>): BlockWorkflowSnapshot => ({
  workflowId: 'wf',
  status: 'succeeded',
  ...over,
});

/** The prompt string a submit body carried. */
const promptOf = (body: unknown) =>
  (body as { params: { prompt: string } }).params.prompt;

const CLICKBAIT = BUILTIN_FORMATS[0];
const CINEMATIC = BUILTIN_FORMATS[1];

/**
 * Click a control in the FORMATS surface, having first proved a viewer could.
 *
 * 🔴 WHY A HELPER RATHER THAN A BARE `user.click`. These tests stub no block width, so
 * jsdom reports `clientWidth: 0`, the tier resolves to `base`, and the app renders its
 * TABBED layout — Thumbnails and Formats as two `display: none` panels. For one revision
 * the selected tab started on Thumbnails, which put every format control in this file
 * inside a HIDDEN panel; the suite stayed green because `getByTestId` does not check
 * visibility and `userEvent.click` gates on `pointer-events`, not on visibility. So the
 * whole format-interaction surface stopped representing a reachable path and no test moved.
 *
 * The app now defaults to the Formats tab while there is nothing in Thumbnails, which is
 * why these controls are reachable again. `toBeVisible()` is what makes that a CHECKED
 * fact rather than a belief: if a future change hides the formats panel on a first render,
 * every case in this file fails here with this message instead of passing against a panel
 * a viewer cannot see. An assertion that merely finds the id in the DOM is exactly what
 * failed before.
 */
async function clickFormatControl(
  user: ReturnType<typeof userEvent.setup>,
  testid: string,
): Promise<HTMLElement> {
  const el = await screen.findByTestId(testid);
  expect(el, `${testid} is not visible — this file is driving a hidden tab panel`).toBeVisible();
  await user.click(el);
  return el;
}

/**
 * Wait for the LIVE COST PREVIEW to settle on `expectedTotal`, then zero the estimate
 * counter so a following assertion counts only the CLICK's estimates.
 *
 * 🔴 WITHOUT THIS EVERY ESTIMATE COUNT AND EVERY BUTTON PRICE IN THIS FILE IS A RACE,
 * and it would be a race that usually goes the right way — the worst kind. This token
 * carries `ai:write:budgeted`, so the app prices the form on mount and on every
 * price-relevant change, `ESTIMATE_DEBOUNCE_MS` after the last one. A test that
 * clicks Generate before that timer fires sees N estimates; one that is a few
 * milliseconds slower sees N+1. Waiting for the price to actually appear pins the
 * boundary instead of hoping for it — and it also asserts the preview happened at
 * all, which is the feature.
 */
async function settlePreview(expectedTotal: number) {
  await waitFor(
    () => expect(screen.getByTestId('pm-generate')).toHaveTextContent(String(expectedTotal)),
    { timeout: 3000 },
  );
  estimateFn.mockClear();
}

beforeEach(() => {
  host.viewer = { id: 2, username: 'dev' };
  estimateFn.mockReset();
  submitFn.mockReset();
  pollFn.mockReset();
  storageGet.mockReset().mockResolvedValue(null);
  storageSet.mockReset().mockResolvedValue({ ok: true });
  sharedAppend.mockReset().mockResolvedValue({ key: 'shared_1' });
  sharedList.mockReset().mockResolvedValue({ items: [] });
  sharedReport.mockReset().mockResolvedValue(undefined);
  sharedVote.mockReset().mockResolvedValue(1);
});

// ---------------------------------------------------------------------------

describe('N formats ⇒ N workflows', () => {
  it('🔴 submits ONE workflow PER selected format, each with that format’s suffix', async () => {
    estimateFn.mockResolvedValue(snap({ status: 'pending', cost: { total: 3 } }));
    submitFn.mockImplementation(async (body) =>
      snap({ status: 'succeeded', cost: { total: 3 }, imageUrls: [`img-${promptOf(body).slice(-6)}`] }),
    );
    const user = userEvent.setup();
    render(<App />);

    // Clickbait is selected by default; add Cinematic.
    await clickFormatControl(user, `yt-format-${CINEMATIC.id}`);
    await user.type(screen.getByLabelText(/prompt/i), 'a cat on a skateboard');
    // The live preview has already priced this form; zero the counter so the count
    // below is the CLICK's, not the click's plus the preview's. See `settlePreview`.
    await settlePreview(6);
    await user.click(screen.getByTestId('pm-generate'));

    await waitFor(() => expect(submitFn).toHaveBeenCalledTimes(2));
    // TWO estimates and TWO submits — not one request with a bigger quantity.
    expect(estimateFn).toHaveBeenCalledTimes(2);

    const prompts = submitFn.mock.calls.map((c) => promptOf(c[0]));
    // Each body carries the user's prompt PLUS its own format's suffix, which is
    // the whole reason these cannot share a request.
    expect(prompts).toHaveLength(2);
    expect(prompts.some((p) => p.includes(CLICKBAIT.suffix))).toBe(true);
    expect(prompts.some((p) => p.includes(CINEMATIC.suffix))).toBe(true);
    for (const p of prompts) expect(p).toContain('a cat on a skateboard');
    // ...and NEITHER body carries the OTHER format's suffix.
    const clickbaitBody = prompts.find((p) => p.includes(CLICKBAIT.suffix)) as string;
    expect(clickbaitBody).not.toContain(CINEMATIC.suffix);
  });

  it('🔴 PARTIAL FAILURE: a failed format does not discard the others’ results or spend', async () => {
    estimateFn.mockResolvedValue(snap({ status: 'pending', cost: { total: 3 } }));
    // Cinematic's submit is rejected; Clickbait's succeeds.
    submitFn.mockImplementation(async (body) => {
      if (promptOf(body).includes(CINEMATIC.suffix)) {
        throw Object.assign(new Error('submit failed'), {
          snapshot: { error: 'orchestrator refused this workflow' },
        });
      }
      return snap({
        workflowId: 'wf-good',
        status: 'succeeded',
        cost: { total: 7 },
        imageUrls: ['good-1', 'good-2'],
      });
    });

    const user = userEvent.setup();
    render(<App />);
    await clickFormatControl(user, `yt-format-${CINEMATIC.id}`);
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    // The surviving run's images are rendered — in the unified results/history
    // surface, which is now the only place images appear.
    const imgs = await screen.findAllByTestId('yt-history-img', {}, { timeout: 5000 });
    expect(imgs).toHaveLength(2);
    // ...alongside — not instead of — a named report of what failed.
    const partial = screen.getByTestId('pm-partial');
    expect(partial).toHaveTextContent(CINEMATIC.label);
    expect(partial).toHaveTextContent(/orchestrator refused this workflow/i);

    // 🔴 SPEND IS THE SERVER'S NUMBER FOR THE RUN THAT RAN — 7. NOT the
    // aggregate estimate (which was 3 + 3 = 6 and covers a workflow that never
    // executed), and not 10.
    //
    // 🔴 THE FIGURE MOVED FROM THE `pm-spent` ALERT (removed in all states) TO THE
    // HISTORY ROW, AND THE RULE IS UNCHANGED: `joinHistory` sums only the realized
    // `cost` the live half reports for the workflows that reported one, so a run that
    // never executed contributes nothing and its ESTIMATE can never stand in. The
    // three numbers stay pairwise distinct (7 real, 6 estimate-sum, 10 neither), so a
    // mutant that summed estimates or hardcoded a total is still visible here.
    expect(screen.queryByTestId('pm-spent')).not.toBeInTheDocument();
    const cost = await screen.findByTestId('yt-history-cost');
    await waitFor(() => expect(cost).toHaveTextContent('7'));
    expect(cost).not.toHaveTextContent('6');
    expect(cost).not.toHaveTextContent('10');
  });

  it('🔴 prices the Generate button with the SUM across formats, not one format’s cost', async () => {
    // 33 Buzz/image is FLUX.1 [dev]'s real measured price (2026-09-28), chosen
    // over a toy number so a mutant that returns one run's cost (33) is visibly
    // different from the correct total (66).
    estimateFn.mockResolvedValue(snap({ status: 'pending', cost: { total: 33 } }));
    let n = 0;
    submitFn.mockImplementation(async () =>
      snap({ workflowId: `wf-${++n}`, status: 'succeeded', cost: { total: 33 }, imageUrls: ['x'] }),
    );

    const user = userEvent.setup();
    render(<App />);
    await clickFormatControl(user, `yt-format-${CINEMATIC.id}`);
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');

    const button = screen.getByTestId('pm-generate');
    // 🔴 BEFORE THE CLICK. The price is now on the button BEFORE any Buzz is at
    // stake — that is the whole point of the live preview, and it comes from the
    // same `aggregateEstimate` the in-flight run uses. 2 formats × 33 = 66, the
    // TOTAL...
    await settlePreview(66);
    // ...and specifically NOT a single run's 33.
    expect(button).not.toHaveTextContent(/·\s*33\s*Buzz/);

    await user.click(button);
    // And it still reads the SUM after the run, where it is `runs`, not the
    // preview, that prices it.
    await screen.findAllByTestId('yt-history-img', {}, { timeout: 5000 });
    expect(button).toHaveTextContent(/66/);
    expect(button).not.toHaveTextContent(/·\s*33\s*Buzz/);
  });

  it('labels a multi-format batch with every format that produced it', async () => {
    /**
     * 🔴 THIS REPLACES A PER-IMAGE FORMAT TAG (`pm-result-format`) THAT NO LONGER
     * EXISTS, and the reduction is deliberate rather than an oversight. The tag lived
     * on the candidate grid, which is gone; in the unified list an image belongs to a
     * BATCH, and attributing it to one of the batch's workflows would mean trusting a
     * positional pairing that records written before this change do not guarantee. A
     * wrong label is worse than a row-level list of the formats involved, which is
     * what is asserted here.
     */
    estimateFn.mockResolvedValue(snap({ status: 'pending', cost: { total: 3 } }));
    submitFn.mockImplementation(async (body) => {
      const cine = promptOf(body).includes(CINEMATIC.suffix);
      return snap({
        workflowId: cine ? 'wf-cine' : 'wf-click',
        status: 'succeeded',
        cost: { total: 3 },
        imageUrls: [cine ? 'cine-1' : 'click-1'],
      });
    });
    const user = userEvent.setup();
    render(<App />);
    await clickFormatControl(user, `yt-format-${CINEMATIC.id}`);
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    // ONE row for the click, carrying BOTH images...
    const imgs = await screen.findAllByTestId('yt-history-img', {}, { timeout: 5000 });
    expect(imgs).toHaveLength(2);
    expect(screen.getAllByTestId('yt-history-row')).toHaveLength(1);
    // ...and naming both formats. Both labels, so a collapsed record that recorded
    // one format cannot pass.
    const formats = screen.getByTestId('yt-history-formats');
    expect(formats).toHaveTextContent(CLICKBAIT.label);
    expect(formats).toHaveTextContent(CINEMATIC.label);
  });

  it('🔴 a SECOND run does not erase the FIRST run’s images', async () => {
    /**
     * THE REGRESSION THIS BATCH EXISTS FOR. The candidate grid was built from `runs`
     * and `initRuns` resets `runs` on every Generate, so starting a second run blanked
     * the first run's output — images the viewer had already paid for, gone from the
     * page with no way back until a reload.
     *
     * 🔴 RED AT BASE, and not vacuously: at `04ca5aa` this file renders, the grid
     * exists, and after the second click `pm-result-img` is the SECOND batch's image
     * alone. The count is the assertion — 1 after run two, where it must be 2.
     */
    estimateFn.mockResolvedValue(snap({ status: 'pending', cost: { total: 3 } }));
    let n = 0;
    submitFn.mockImplementation(async () => {
      n += 1;
      return snap({
        workflowId: `wf-run-${n}`,
        status: 'succeeded',
        cost: { total: 3 },
        imageUrls: [`run-${n}-img`],
      });
    });

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));
    await waitFor(() => expect(screen.getAllByTestId('yt-history-img')).toHaveLength(1));

    // Second run, same form. Nothing about the first one may disappear.
    await user.click(screen.getByTestId('pm-generate'));
    await waitFor(() => expect(submitFn).toHaveBeenCalledTimes(2));

    await waitFor(() => {
      const urls = screen
        .getAllByTestId('yt-history-img')
        .map((img) => img.getAttribute('src'))
        .sort();
      expect(urls).toEqual(['run-1-img', 'run-2-img']);
    });
    // Two batches, two rows — not one row that swallowed both.
    expect(screen.getAllByTestId('yt-history-row')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------

describe('🔴 the picker renders EVERY built-in, with or without preview art', () => {
  /**
   * All twelve built-ins now carry generated art. `Format.preview` is STILL
   * optional and `FormatPicker` still branches on it — `<img>` when there is art,
   * a letter placeholder when there is not — because every CUSTOM and PUBLISHED
   * format has none. This suite is the only thing that proves the placeholder
   * branch is actually taken in the shipped DOM.
   *
   * 🔴 THE PREVIEWLESS CASE IS NOW DRIVEN FROM A CUSTOM FORMAT, NOT A BUILT-IN,
   * and that is a real change in what is covered rather than bookkeeping. When the
   * six new built-ins got their art, the old version of that test — which filtered
   * `BUILTIN_FORMATS` for `preview === undefined` and asserted the result was
   * non-empty — had exactly two futures: delete it, or let it select nothing and
   * pass vacuously. Both lose the only DOM-level evidence that the placeholder
   * branch runs. A custom format is where previewless formats permanently live, so
   * that is what the test mounts.
   *
   * 🔴 SELECTION IS BY EXACT TESTID, NEVER BY THE `yt-format-` PREFIX. That
   * prefix also matches `yt-format-grid`, `yt-format-card`, `yt-format-check`,
   * `yt-format-label`, `yt-format-suffix`, `yt-format-save`, … — a count over it
   * is wrong by a number that changes with the layout, not with the format list.
   * `yt-format-card` IS exact, so counting cards is safe; matching chips is not.
   */

  /** The chip button for one format id. Exact testid — see the note above. */
  const chip = (id: string) => screen.getByTestId(`yt-format-${id}`);

  it('renders one chip per built-in, found by its own exact id', async () => {
    render(<App />);
    await screen.findByTestId('yt-format-grid');

    for (const f of BUILTIN_FORMATS) {
      const el = chip(f.id);
      expect(el, `no chip for ${f.id}`).toBeInTheDocument();
      expect(el).toHaveAttribute('role', 'checkbox');
      expect(el).toHaveTextContent(f.label);
    }
    // One card per format and nothing else: `yt-format-card` is an EXACT testid,
    // so this count is about the format list rather than the layout.
    expect(screen.getAllByTestId('yt-format-card')).toHaveLength(BUILTIN_FORMATS.length);
  });

  /**
   * A previewless format in the picker. Custom formats never carry art, so a
   * stored one is the honest fixture for the placeholder branch — and it is the
   * population that will still be previewless however much built-in art lands.
   */
  // `preview` is declared (and left absent) so `hasPreviewArt` can be called on the
  // fixture directly — a weak-type object with no field in common would not compile,
  // and the point is to run the SAME predicate the component runs.
  const PREVIEWLESS: { id: string; label: string; suffix: string; preview?: string } = {
    id: 'custom:placeholder',
    label: 'Zeta Look',
    suffix: 'a look of my own',
  };

  it('🔴 EVERY built-in renders its art as an <img> with the exact declared src', async () => {
    render(<App />);
    await screen.findByTestId('yt-format-grid');

    // All twelve have art, so this is unconditional now — and the `checked` count
    // at the end is what stops it quietly covering fewer than it claims.
    expect(BUILTIN_FORMATS.every((f) => hasPreviewArt(f)), 'a built-in lost its art').toBe(true);
    let checked = 0;
    for (const f of BUILTIN_FORMATS) {
      const img = chip(f.id).querySelector('img');
      expect(img, `${f.id} has art but rendered no <img>`).not.toBeNull();
      expect(img).toHaveAttribute('src', f.preview as string);
      // Decorative: the label beside it already names the format.
      expect(img).toHaveAttribute('alt', '');
      checked += 1;
    }
    expect(checked).toBe(BUILTIN_FORMATS.length);
  });

  it('🔴 a format with NO preview renders a placeholder, never an <img>', async () => {
    // The previewless format is a CUSTOM one — see the suite note. It is loaded
    // from storage so it reaches the real picker through the real code path.
    storageGet.mockResolvedValue([PREVIEWLESS]);
    render(<App />);
    await screen.findByTestId(`yt-format-${PREVIEWLESS.id}`);

    // Positive control: prove this assertion can SEE an <img> at all, by checking a
    // format that HAS art. Without it, the `toBeNull()` below is indistinguishable
    // from a query that never matches anything.
    const withArt = BUILTIN_FORMATS.filter((f) => hasPreviewArt(f));
    expect(withArt.length, 'no format has art — the control below is vacuous').toBeGreaterThan(0);
    const controlImg = chip(withArt[0].id).querySelector('img');
    expect(controlImg, 'the control format rendered no <img> — this query sees nothing').not.toBeNull();
    expect(controlImg).toHaveAttribute('src', withArt[0].preview as string);

    // The case under test. An <img> with an empty/absent/wrong src is exactly what
    // paints a broken-image icon, so the claim is that there is NO img node at all.
    expect(hasPreviewArt(PREVIEWLESS), 'the fixture is not previewless').toBe(false);
    const el = chip(PREVIEWLESS.id);
    expect(el.querySelector('img'), `${PREVIEWLESS.id} has no art but rendered an <img>`).toBeNull();
    // The placeholder is the format's initial, and it is aria-hidden so a screen
    // reader hears the label once, not a stray letter before it.
    expect(el).toHaveTextContent(PREVIEWLESS.label);
    const ph = el.querySelector('[aria-hidden="true"]');
    expect(ph, `${PREVIEWLESS.id} rendered no placeholder`).not.toBeNull();
    expect(ph!.textContent).toBe('Z');
    // 🔴 'Z' as a LITERAL, and the fixture label starts with a letter no built-in
    // label starts with. Derived as `label.slice(0,1).toUpperCase()` this assertion
    // would restate the implementation and pass for whatever it produced.
  });

  it('🔴 the preview box reserves 16/9 whether or not there is art — no layout jump', async () => {
    storageGet.mockResolvedValue([PREVIEWLESS]);
    render(<App />);
    await screen.findByTestId(`yt-format-${PREVIEWLESS.id}`);

    // The aspect-ratio lives on the WRAPPER, not the image, which is what makes a
    // previewless card the same height as one with art. If it moved onto the <img>,
    // every previewless card would collapse and the grid would reflow — which is now
    // a CUSTOM-format problem rather than a built-in one, since all twelve built-ins
    // have art. The branch is the same branch.
    const boxOf = (id: string) => {
      const el = chip(id).querySelector('span') as HTMLElement;
      return el.style.aspectRatio;
    };
    const art = BUILTIN_FORMATS.find((f) => hasPreviewArt(f))!;
    expect(boxOf(art.id)).toBe('16 / 9');
    expect(boxOf(PREVIEWLESS.id)).toBe('16 / 9');
  });
});

describe('the format selection invariant', () => {
  it('🔴 will not let the viewer deselect the last format', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Clickbait is the lone default selection; its control is disabled so the
    // click cannot produce a zero-workflow Generate.
    const only = await screen.findByTestId(`yt-format-${CLICKBAIT.id}`);
    // VISIBLE, not merely present — see `clickFormatControl` for the hidden-panel trap
    // this guards. A disabled control inside a `display: none` panel is two different
    // kinds of unreachable and only one of them is the invariant under test.
    expect(only).toBeVisible();
    expect(only).toBeDisabled();

    // Select a second -> the first becomes deselectable again.
    await clickFormatControl(user, `yt-format-${CINEMATIC.id}`);
    await waitFor(() => expect(screen.getByTestId(`yt-format-${CLICKBAIT.id}`)).toBeEnabled());
  });
});

// ---------------------------------------------------------------------------

describe('private custom formats (useAppStorage)', () => {
  it('reads the viewer’s formats from the versioned key on mount', async () => {
    storageGet.mockResolvedValue([{ id: 'custom:1', label: 'Noir', suffix: 'hard shadows' }]);
    render(<App />);
    await waitFor(() => expect(storageGet).toHaveBeenCalledWith(CUSTOM_FORMATS_KEY));
    const custom = await screen.findByTestId('yt-format-custom:1');
    expect(custom, 'the viewer’s own format is in a hidden panel').toBeVisible();
    expect(custom).toHaveTextContent('Noir');
  });

  it('🔴 writes the whole list back under the same key, in the round-trippable shape', async () => {
    const user = userEvent.setup();
    render(<App />);
    await clickFormatControl(user, 'yt-format-new');
    await user.type(screen.getByTestId('yt-format-label'), 'Retro VHS');
    await user.type(screen.getByTestId('yt-format-suffix'), 'analog vhs grain');
    await user.click(screen.getByTestId('yt-format-save'));

    await waitFor(() => expect(storageSet).toHaveBeenCalledTimes(1));
    const [key, value] = storageSet.mock.calls[0];
    expect(key).toBe(CUSTOM_FORMATS_KEY);
    // A plain array of {id,label,suffix} — what parseCustomFormats round-trips.
    expect(Array.isArray(value)).toBe(true);
    expect(value).toHaveLength(1);
    expect(value as unknown[]).toEqual([
      expect.objectContaining({ label: 'Retro VHS', suffix: 'analog vhs grain' }),
    ]);
  });

  it('validates before writing — a blank name never reaches storage', async () => {
    const user = userEvent.setup();
    render(<App />);
    await clickFormatControl(user, 'yt-format-new');
    await user.type(screen.getByTestId('yt-format-suffix'), 'a look with no name');
    await user.click(screen.getByTestId('yt-format-save'));

    expect(await screen.findByTestId('yt-format-error')).toHaveTextContent(/name/i);
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('🔴 REVERTS the list when the host rejects the write (quota / size / anon)', async () => {
    // The real host rejects a value over 64KB, a write that would cross the
    // per-app quota, and every anonymous write. The MOCK host enforces none of
    // that, which is why this is driven from the hook.
    storageSet.mockRejectedValue(new Error('PAYLOAD_TOO_LARGE'));
    const user = userEvent.setup();
    render(<App />);
    await clickFormatControl(user, 'yt-format-new');
    await user.type(screen.getByTestId('yt-format-label'), 'Too Big');
    await user.type(screen.getByTestId('yt-format-suffix'), 'x'.repeat(40));
    await user.click(screen.getByTestId('yt-format-save'));

    // The failure is REPORTED...
    expect(await screen.findByTestId('yt-storage-note')).toHaveTextContent(/PAYLOAD_TOO_LARGE/);
    // ...and the format is NOT left on screen as if it had saved.
    await waitFor(() =>
      expect(screen.queryByText('Too Big')).not.toBeInTheDocument(),
    );
  });

  it('🔴 the ANONYMOUS path degrades explicitly instead of silently eating the work', async () => {
    // `useAppStorage` resolves null on read and REJECTS every write for an
    // anonymous viewer, so a "New" button that looked enabled would lose their
    // format with no explanation.
    host.viewer = null;
    render(<App />);
    expect(await screen.findByTestId('yt-storage-anon')).toHaveTextContent(/sign in/i);
    // VISIBLE as well as disabled: "the button looks enabled and eats your work" is the
    // defect, and a button nobody can see makes neither claim. See `clickFormatControl`.
    expect(screen.getByTestId('yt-format-new')).toBeVisible();
    expect(screen.getByTestId('yt-format-new')).toBeDisabled();
    // Nothing is even attempted against storage for an anonymous viewer.
    expect(storageGet).not.toHaveBeenCalled();
    // The built-ins are still usable — the app is not bricked for them, and they are on
    // screen rather than merely mounted.
    expect(screen.getByTestId(`yt-format-${CLICKBAIT.id}`)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------

describe('🔴 publishing puts the suffix in the MODERATED field', () => {
  it('appends `{title, body}` with the suffix in `body` and NO user text in `data`', async () => {
    storageGet.mockResolvedValue([
      { id: 'custom:9', label: 'Retro VHS', suffix: 'analog vhs grain, 1987 camcorder' },
    ]);
    const user = userEvent.setup();
    render(<App />);
    await clickFormatControl(user, 'yt-format-publish-custom:9');

    await waitFor(() => expect(sharedAppend).toHaveBeenCalledTimes(1));
    const value = sharedAppend.mock.calls[0][0] as {
      title: string;
      body: string;
      data: unknown;
    };
    // The suffix is prompt text that will be injected into OTHER viewers' PAID
    // generations in a contentRating:"g" app. It MUST be in `body`, which the
    // content belt reads — `data` is UNMODERATED.
    expect(value.body).toBe('analog vhs grain, 1987 camcorder');
    expect(value.title).toBe('Retro VHS');
    // A STATE assertion, not a word assertion: no user-authored text of any kind
    // may ride in `data`, whatever it says.
    expect(JSON.stringify(value.data)).not.toContain('vhs');
    expect(JSON.stringify(value.data)).not.toContain('camcorder');
    expect(JSON.stringify(value.data)).not.toContain('Retro');
  });

  it('🔴 REFUSES to publish a suffix carrying the wildcard `#` — it would spend OTHER people’s Buzz', async () => {
    // 🔴 THIS IS THE PUBLISHED HALF OF THE `#` RULE, and it is a sharper case than
    // the save half: a published suffix is injected into the paid generations of
    // viewers who never typed it, and `#` is eaten server-side — the generation
    // succeeds and silently is not the prompt anyone asked for.
    //
    // 🔴 WHY THIS TEST EXISTS AT THE HOOK BOUNDARY. The format below comes from
    // STORAGE, carrying a `#` that `parseCustomFormats` deliberately still loads
    // (it may predate the rule — see formats.test.ts "checked on SAVE and NOT on
    // LOAD"). So this viewer genuinely has a `#` format in their picker with a live
    // Publish button, and the ONLY thing that can see whether it reaches the board
    // is the argument to `shared.append`. The mock host would accept it happily.
    storageGet.mockResolvedValue([
      { id: 'custom:hash', label: 'Neon Hex', suffix: 'neon glow #FF49BD rim light' },
      // The control for the `not.toHaveBeenCalled()` below — see the note there.
      { id: 'custom:clean', label: 'Plain', suffix: 'plain rim light' },
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('yt-format-publish-custom:hash'));

    // Nothing reached the board.
    expect(sharedAppend).not.toHaveBeenCalled();
    // And the viewer is TOLD, naming the character and what happens to it — a
    // silent no-op here would read as a broken Publish button.
    const note = await screen.findByTestId('yt-storage-note');
    expect(note).toHaveTextContent('#');
    expect(note).toHaveTextContent(/wildcard/i);

    // 🔴 POSITIVE CONTROL, SAME TEST. `expect(sharedAppend).not.toHaveBeenCalled()`
    // is exactly what a broken Publish button, a wrong testid, or a mock wired to
    // nothing also produces. Publishing a CLEAN format must still work, through the
    // same click path, so the zero above is a fact about the `#` and not about the
    // instrument.
    await user.click(screen.getByTestId('yt-format-publish-custom:clean'));
    await waitFor(() => expect(sharedAppend).toHaveBeenCalledTimes(1));
    expect((sharedAppend.mock.calls[0][0] as { body: string }).body).toBe('plain rim light');
  });
});

// ---------------------------------------------------------------------------

describe('the published board', () => {
  it('lists published formats and can pull one into the picker', async () => {
    sharedList.mockResolvedValue({
      items: [
        {
          key: 'shared_7',
          authorUserId: 99,
          value: { title: 'Neon Noir', body: 'wet streets, neon reflections' },
          count: 12,
          viewerVoted: false,
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    await clickFormatControl(user, 'yt-board-toggle');

    const row = await screen.findByTestId('yt-published-row');
    expect(row).toHaveTextContent('Neon Noir');
    expect(row).toHaveTextContent('12');

    await user.click(screen.getByTestId('yt-published-add-shared_7'));
    // It becomes a selectable format in the picker, keyed by its shared key.
    expect(await screen.findByTestId('yt-format-shared:shared_7')).toHaveTextContent('Neon Noir');
  });

  it('🔴 DROPS a published entry whose text is only in the unmoderated `data`', async () => {
    sharedList.mockResolvedValue({
      items: [
        {
          key: 'shared_8',
          authorUserId: 98,
          value: { title: 'Smuggled', data: { suffix: 'text that bypassed moderation' } },
          count: 3,
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    await clickFormatControl(user, 'yt-board-toggle');

    // Rendering it would make `data` a working channel for unmoderated prompt
    // text — the exact thing putting the suffix in `body` exists to prevent.
    expect(await screen.findByTestId('yt-published-empty')).toBeInTheDocument();
    expect(screen.queryByText('Smuggled')).not.toBeInTheDocument();
  });

  it('reports a published format through the shared-storage abuse seam', async () => {
    sharedList.mockResolvedValue({
      items: [
        {
          key: 'shared_9',
          authorUserId: 97,
          value: { title: 'Bad One', body: 'something objectionable' },
          count: 0,
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    await clickFormatControl(user, 'yt-board-toggle');
    await user.click(await screen.findByTestId('yt-published-report-shared_9'));

    await waitFor(() => expect(sharedReport).toHaveBeenCalledTimes(1));
    expect(sharedReport.mock.calls[0][0]).toBe('shared_9');
  });

  it('votes using the HYDRATED viewerVoted state, not a guess', async () => {
    sharedList.mockResolvedValue({
      items: [
        {
          key: 'shared_10',
          authorUserId: 96,
          value: { title: 'Already Voted', body: 'a look' },
          count: 5,
          // The viewer ALREADY voted. A block that guessed `false` here would
          // send `vote` and appear to do nothing (it is idempotent).
          viewerVoted: true,
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    await clickFormatControl(user, 'yt-board-toggle');
    const voteBtn = await screen.findByTestId('yt-published-vote-shared_10');
    expect(voteBtn).toHaveTextContent(/voted/i);

    await user.click(voteBtn);
    // Clicking an already-voted row UNVOTES; `vote` must NOT be called.
    expect(sharedVote).not.toHaveBeenCalled();
  });
});
