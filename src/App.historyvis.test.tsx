import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppWorkflow } from '@civitai/app-sdk/blocks';

/**
 * THE HISTORY SURFACE'S VISIBILITY AND ITS PENDING STATE.
 *
 * Two questions, both about what a viewer sees rather than about the join:
 *
 *   1. WHEN DOES THE WHOLE BLOCK EXIST? Exactly one state hides it — ready with
 *      nothing in it. The other four (anon / denied / error / loading) are
 *      ACTIONABLE: each names a different fix, and hiding them deletes the only
 *      thing on screen that tells the viewer why they have no history.
 *   2. WHAT DOES A STILL-RUNNING BATCH LOOK LIKE? A skeleton per image it is
 *      expected to produce — not an empty row, which reads as "this one produced
 *      nothing", and not a spinner, which says nothing about how much is coming.
 *
 * 🔴 RED/GREEN MATRIX, per case, because this file is a MIX:
 *   - 'hides the whole block when ready and empty'  RED at 04ca5aa on a real
 *     assertion: `yt-history` renders there with a "History 0 / Show" header whose
 *     only content is a sentence saying there is nothing. This is the regression
 *     coverage in this file.
 *   - the anon / denied / error cases                GREEN at base — INVARIANT
 *     GUARDS. Those states already rendered; what they now guard is that the hide
 *     rule above did not widen to swallow them, which is the plausible way to get
 *     this wrong.
 *   - the skeleton cases                             VACUOUSLY RED at base: there
 *     is no skeleton there at all, so they prove the feature is new, not that any
 *     assertion bites. `history.test.ts` carries the non-vacuous arithmetic.
 *
 * 🔴 EVERY hook App imports must appear in the `vi.mock` below. A missing one fails
 * with "No <name> export is defined on the mock", which vitest reports as a test
 * FAILURE indistinguishable at a glance from a broken assertion.
 */

const RUNNING_WORKFLOW: AppWorkflow = {
  workflowId: 'wf-running',
  status: 'processing',
  images: [],
  cost: null,
  createdAt: '2026-09-30T12:30:00.000Z',
};

const DONE_WORKFLOW: AppWorkflow = {
  workflowId: 'wf-done',
  status: 'succeeded',
  images: [
    { url: 'https://image.civitai.com/done-a.jpg', width: 1536, height: 864, nsfwLevel: 1 },
    { url: 'https://image.civitai.com/done-b.jpg', width: 1536, height: 864, nsfwLevel: 1 },
  ],
  cost: 418,
  createdAt: '2026-09-30T12:45:00.000Z',
};

/**
 * A stored batch: ONE format at quantity 3, so the expected image count (3) is
 * distinct from the format count (1), from the number of live workflows (1) and from
 * the two images `DONE_WORKFLOW` carries. A fixture where those collapsed could not
 * tell `formats × quantity` from either factor alone.
 */
const RECORD = {
  v: 1,
  batchId: 'b-1',
  createdAt: Date.parse('2026-09-30T12:31:00.000Z'),
  workflowIds: ['wf-running'],
  form: {
    mode: 'generate',
    prompt: 'a red bicycle',
    promptEdits: {},
    formats: [
      {
        id: 'clickbait',
        label: 'Clickbait',
        suffix: 'bold, high contrast',
        prompt: 'a red bicycle, bold, high contrast',
      },
    ],
    checkpoint: {
      versionId: 2880272,
      modelId: 2563220,
      label: 'ChatGPT Images',
      baseModel: 'OpenAI',
    },
    loras: [],
    quantity: 3,
    account: 'yellow',
    sourceImage: null,
  },
};

const storageGet = vi.fn();
const storageList = vi.fn();
const storageSet = vi.fn();
const storageDelete = vi.fn();
// Hoisted so the toggle case below can assert the live half was refetched. An inline
// `vi.fn()` in the hook factory is a NEW mock every render and records nothing a test
// can read.
const refetchWorkflows = vi.fn();

const state = {
  viewer: { id: 2, username: 'dev' } as { id: number; username: string } | null,
  workflows: [] as AppWorkflow[],
  workflowsError: null as Error | null,
};

vi.mock('@civitai/blocks-react', () => ({
  useBlockContext: () => ({ ready: true, viewer: state.viewer, theme: 'dark' }),
  useBlockResize: () => {},
  useBlockBreakpoint: () => ({
    tier: 'base',
    measured: false,
    atLeast: () => false,
    below: () => true,
  }),
  // 🔴 NO BUDGETED SCOPE ON PURPOSE. Nothing in this file is about pricing, and an
  // unconsented token means the live cost preview never fires — so no `estimate()`
  // traffic can race the assertions below. See App.estimate.test.tsx for the
  // granted-token behaviour.
  useBlockToken: () => ({ scopes: [], raw: 't', expiresAt: '' }),
  useBuzzWorkflow: () => ({ estimate: vi.fn(), submit: vi.fn(), poll: vi.fn() }),
  useBuzzBalance: () => ({ balance: null, loading: false, error: null, refetch: vi.fn() }),
  useRequestConsent: () => ({ requestConsent: vi.fn() }),
  useRequestSignIn: () => ({ requestSignIn: vi.fn() }),
  useResourcePicker: () => ({ open: vi.fn().mockResolvedValue(null) }),
  useImageUpload: () => ({ open: vi.fn().mockResolvedValue(null) }),
  useSaveImage: () => ({ saveImage: vi.fn() }),
  useAppWorkflows: () => ({
    workflows: state.workflows,
    cursor: null,
    loading: false,
    error: state.workflowsError,
    refetch: refetchWorkflows,
    cancel: vi.fn(),
  }),
  useAppStorage: () => ({
    get: storageGet,
    set: storageSet,
    delete: storageDelete,
    list: storageList,
    getQuota: vi
      .fn()
      .mockResolvedValue({ usedBytes: 0, rowCount: 0, limitBytes: 5e7, limitRows: 1e6 }),
  }),
  useSharedStorage: () => ({
    list: vi.fn().mockResolvedValue({ items: [] }),
    get: vi.fn().mockResolvedValue(null),
    report: vi.fn().mockResolvedValue(undefined),
    getCount: vi.fn().mockResolvedValue(0),
    getCounts: vi.fn().mockResolvedValue({}),
    append: vi.fn().mockResolvedValue({ key: 'shared_1' }),
    update: vi.fn().mockResolvedValue(undefined),
    vote: vi.fn().mockResolvedValue(1),
    unvote: vi.fn().mockResolvedValue(0),
    withdraw: vi.fn().mockResolvedValue({ ok: true, deleted: true }),
  }),
}));

const { App } = await import('./App.js');
const { IMAGE_MIN_PX } = await import('./ui-styles.js');
const { historyKey } = await import('./history.js');

const RECORD_KEY = historyKey(RECORD.createdAt, RECORD.batchId);

function stockStorage(records: Array<{ key: string; value: unknown }>) {
  storageList.mockResolvedValue({
    keys: records.map((r) => ({ key: r.key, updatedAt: new Date() })),
  });
  storageGet.mockImplementation(async (key: string) => {
    if (key === 'formats:custom:v1') return null;
    return records.find((r) => r.key === key)?.value ?? null;
  });
}

/**
 * Make sure the surface is EXPANDED.
 *
 * 🔴 IT CLICKS ONLY WHEN THE TOGGLE STILL SAYS "Show". The surface auto-expands
 * whenever there are rows, so an UNCONDITIONAL click would COLLAPSE it and every
 * assertion below would read as a missing row. Reading the label makes it race-free
 * either way round.
 *
 * 🔴 THE COST OF THAT CONDITION, STATED SO IT IS NOT FORGOTTEN: in every row-bearing
 * case the panel is ALREADY open, so this helper presses nothing and `onToggle` — the
 * one path that still drives a manual reload of both halves — goes unexercised. The
 * 'Show RE-READS both halves' case below presses it deliberately for that reason.
 */
/**
 * Put the thumbnail surface ON SCREEN, then open it.
 *
 * 🔴 THE TAB SWITCH IS NOT OPTIONAL AND THIS FILE DID NOT USED TO DO IT. These tests stub
 * no block width, so jsdom reports `clientWidth: 0`, the tier resolves to `base`, and the
 * app renders its TABBED layout — where Thumbnails and Formats are two `display: none`
 * panels and the selected tab starts on FORMATS whenever there is nothing in Thumbnails
 * yet (which is every case in this file: the point of them is the zero-row and error
 * states). So the entire history surface sat inside a hidden panel.
 *
 * It stayed green because `getByTestId` does not check visibility and `userEvent.click`
 * gates on `pointer-events`, not on visibility — so every assertion and every click here
 * was being made against a surface a real viewer could not see or press. One case
 * (`LOAD ERROR`) failed out loud, only because it happens to query by ROLE, and role
 * queries DO exclude a `display: none` subtree.
 *
 * Switching the tab first makes every case in this file a claim about a reachable surface,
 * and the `toBeVisible()` below is the guard: if a future change hides the thumbnails panel
 * again, this fails HERE, for every test in the file, instead of being absorbed.
 */
async function openHistory(user: ReturnType<typeof userEvent.setup>) {
  const tabs = screen.queryByTestId('yt-panel-tabs');
  if (tabs) {
    await user.click(within(tabs).getByRole('tab', { name: 'Thumbnails' }));
    expect(
      screen.getByTestId('yt-panel-thumbnails'),
      'the thumbnails panel is hidden even after selecting its own tab',
    ).toBeVisible();
  }
  const toggle = await screen.findByTestId('yt-history-toggle');
  expect(toggle, 'the history toggle is not visible — this file is driving a hidden panel')
    .toBeVisible();
  if (/show/i.test(toggle.textContent ?? '')) await user.click(toggle);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.viewer = { id: 2, username: 'dev' };
  state.workflows = [];
  state.workflowsError = null;
  storageSet.mockResolvedValue({ ok: true });
  storageDelete.mockResolvedValue({ ok: true, deleted: true });
  stockStorage([]);
});

// ---------------------------------------------------------------------------

describe('the history surface — when it exists at all', () => {
  it('🔴 HIDES the whole block — header, badge and toggle — when ready and empty', async () => {
    /**
     * 🔴 REGRESSION COVERAGE, red at 04ca5aa. A first-time viewer got a
     * "History 0 / Show" affordance whose only content, once expanded, was a
     * sentence telling them there was nothing there. Asserted on the OUTER
     * container and on the toggle separately: hiding only the panel's body, or only
     * the empty sentence, is the near-miss fix and leaves the affordance up.
     */
    render(<App />);
    // Wait for a surface that is always present, so "absent" cannot mean
    // "not rendered yet".
    await screen.findByTestId('pm-generate');
    await waitFor(() => expect(storageList).toHaveBeenCalled());

    await waitFor(() => expect(screen.queryByTestId('yt-history')).not.toBeInTheDocument());
    expect(screen.queryByTestId('yt-history-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('yt-history-empty')).not.toBeInTheDocument();
  });

  it('🔴 KEEPS the block for an ANONYMOUS viewer — that is a sign-in prompt, not an empty list', async () => {
    /**
     * INVARIANT GUARD (green at base): what it protects is that the hide rule above
     * did not widen. An empty-looking absence here is a FALSE STATEMENT about someone
     * who may have plenty of generations, and it offers them no way forward.
     */
    state.viewer = null;
    state.workflowsError = new Error('anonymous viewer');
    const user = userEvent.setup();
    render(<App />);

    await openHistory(user);
    expect(await screen.findByTestId('yt-history-anon')).toHaveTextContent(/sign in/i);
    // ...and specifically NOT the empty state.
    expect(screen.queryByTestId('yt-history-empty')).not.toBeInTheDocument();
  });

  it('🔴 KEEPS the block when STORAGE ACCESS was refused', async () => {
    // INVARIANT GUARD. The apps:storage scopes have never been consented in
    // production, so this is a realistic FIRST RUN and the fix it names — grant the
    // app storage — is not discoverable from a blank space.
    storageList.mockRejectedValue(new Error('FORBIDDEN: missing scope apps:storage:read'));
    const user = userEvent.setup();
    render(<App />);

    await openHistory(user);
    expect(await screen.findByTestId('yt-history-denied')).toHaveTextContent(/storage access/i);
    expect(screen.queryByTestId('yt-history-error')).not.toBeInTheDocument();
  });

  it('🔴 KEEPS the block on a LOAD ERROR, and it offers a retry', async () => {
    // INVARIANT GUARD. Distinct from `denied` because the fix is different.
    storageList.mockRejectedValue(new Error('network hiccup'));
    const user = userEvent.setup();
    render(<App />);

    await openHistory(user);
    expect(await screen.findByTestId('yt-history-error')).toBeInTheDocument();
    expect(screen.queryByTestId('yt-history-denied')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('🔴 KEEPS the block when the STORED HALF is fine but the LIVE queue failed', async () => {
    /**
     * The live half failing is reported separately from the stored half — the rows are
     * still rendered from storage and Resume still works on every one of them, so
     * "history is broken" would be false. Also an INVARIANT GUARD.
     */
    stockStorage([{ key: RECORD_KEY, value: RECORD }]);
    state.workflowsError = new Error('queue unreachable');
    const user = userEvent.setup();
    render(<App />);

    await openHistory(user);
    expect(await screen.findByTestId('yt-history-live-error')).toBeInTheDocument();
    expect(screen.getByTestId('yt-history-row')).toBeInTheDocument();
    expect(screen.getByTestId('yt-history-resume')).toBeInTheDocument();
  });

  it('🔴 pressing Show RE-READS both halves — the stored rows and the live queue', async () => {
    /**
     * 🔴 NOT REGRESSION COVERAGE — a BEHAVIOUR case for the path `openHistory` stopped
     * reaching. Narrowing that helper to "click only when it says Show" was correct (an
     * unconditional click COLLAPSES an auto-expanded panel), but it left `onToggle`'s
     * `loadHistory()` + `refetchWorkflows()` exercised only where there are no rows —
     * i.e. never on the surface that actually has something to reload. So this presses
     * the toggle twice, deliberately, with rows present.
     *
     * Both calls are asserted because they are two different failures: dropping the
     * `loadHistory()` leaves a stale STORED half (a row deleted in another tab), and
     * dropping the `refetchWorkflows()` leaves a stale LIVE half (images that have
     * since landed stay as skeletons). Either alone looks like "Show did nothing".
     */
    stockStorage([{ key: RECORD_KEY, value: RECORD }]);
    state.workflows = [RUNNING_WORKFLOW];
    const user = userEvent.setup();
    render(<App />);

    // Auto-expanded, because there are rows — so the toggle reads "Hide".
    await screen.findByTestId('yt-history-row');
    const toggle = screen.getByTestId('yt-history-toggle');
    expect(toggle).toHaveTextContent(/hide/i);

    await user.click(toggle);
    await waitFor(() => expect(screen.queryByTestId('yt-history-row')).not.toBeInTheDocument());
    const listsBefore = storageList.mock.calls.length;
    const refetchesBefore = refetchWorkflows.mock.calls.length;

    await user.click(screen.getByTestId('yt-history-toggle'));

    await waitFor(() => expect(storageList.mock.calls.length).toBeGreaterThan(listsBefore));
    expect(refetchWorkflows.mock.calls.length).toBeGreaterThan(refetchesBefore);
    // ...and the rows come back into an open panel.
    expect(await screen.findByTestId('yt-history-row')).toBeInTheDocument();
  });

  // 🔴 THE 'a note keeps the block up even with nothing in it' CASE IS DELETED, and
  // its docstring is why: it claimed to drive the `note` clause of `showHistory` via
  // "the DENIED path, which sets both a note and a non-ready state". Neither half was
  // true. `loadHistory` never calls `setHistoryNote`, so `note` was `null`; and
  // `showHistory` returns at its FIRST clause (`state !== 'ready'`) without ever
  // reaching `return args.note != null`. What it actually asserted was that a denied
  // state keeps the block up — the case directly above it. A docstring claiming
  // coverage it does not have is worse than no test: it stops anyone looking. The
  // ready+note clause is pinned where it can be reached, in
  // `history.test.ts > showHistory`.
});

describe('the history surface — a batch that is still running', () => {
  it('🔴 renders a SKELETON per expected image, and no images', async () => {
    /**
     * `formats × quantity` = 1 × 3. The fixture's three numbers (1 format, quantity 3,
     * 1 live workflow) are all different, so a mutant that counted formats, or
     * workflows, or simply rendered one tile, produces a different number.
     */
    stockStorage([{ key: RECORD_KEY, value: RECORD }]);
    state.workflows = [RUNNING_WORKFLOW];
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);

    const row = await screen.findByTestId('yt-history-row');
    // 🔴 NO 'Running' BADGE — the status badge was removed in ALL states. The skeleton
    // count below IS the running signal now, which is the stronger claim anyway: it
    // says how much is still coming, not merely that something is.
    expect(within(row).queryByText('Running')).not.toBeInTheDocument();
    expect(within(row).getAllByTestId('yt-history-skeleton-tile')).toHaveLength(3);
    // No images yet, and no image GRID either — an empty grid would collapse the row.
    expect(within(row).queryByTestId('yt-history-img')).not.toBeInTheDocument();
    expect(within(row).queryByTestId('yt-history-images')).not.toBeInTheDocument();
    // The realized cost is honestly absent, not zero and not the estimate.
    expect(within(row).getByTestId('yt-history-cost')).toHaveTextContent('—');
    // A running batch is cancellable — the skeleton is not decorative, there is
    // really something in flight.
    expect(within(row).getByTestId('yt-history-cancel')).toBeInTheDocument();
  });

  it('🔴 a SUCCEEDED batch renders its images and NO skeleton', async () => {
    // The other arm. Without it the case above cannot distinguish "skeletons while
    // running" from "skeletons always".
    stockStorage([
      { key: RECORD_KEY, value: { ...RECORD, workflowIds: ['wf-done'] } },
    ]);
    state.workflows = [DONE_WORKFLOW];
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);

    const row = await screen.findByTestId('yt-history-row');
    expect(within(row).getAllByTestId('yt-history-img')).toHaveLength(2);
    expect(within(row).queryByTestId('yt-history-skeleton-tile')).not.toBeInTheDocument();
    // The server's realized number, which is distinct from every other figure in
    // this file's fixtures.
    expect(within(row).getByTestId('yt-history-cost')).toHaveTextContent('418');
    // Terminal — nothing to cancel.
    expect(within(row).queryByTestId('yt-history-cancel')).not.toBeInTheDocument();
  });

  it('🔴 a PARTLY delivered batch shows BOTH: the images that landed AND skeletons for the rest', async () => {
    /**
     * Two workflows, one done with two images and one still processing, against an
     * expected 2 formats × 3 = 6. So 2 images are up and 4 tiles remain. Showing only
     * one of the two would either hide finished output or claim the batch is done —
     * and 6, 4, 2, 3 are all different numbers, so no off-by-one reading passes.
     */
    stockStorage([
      {
        key: RECORD_KEY,
        value: {
          ...RECORD,
          workflowIds: ['wf-done', 'wf-running'],
          form: {
            ...RECORD.form,
            formats: [
              RECORD.form.formats[0],
              { id: 'minimal', label: 'Minimal', suffix: 'clean', prompt: 'a red bicycle, clean' },
            ],
          },
        },
      },
    ]);
    state.workflows = [DONE_WORKFLOW, RUNNING_WORKFLOW];
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);

    const row = await screen.findByTestId('yt-history-row');
    expect(within(row).getAllByTestId('yt-history-img')).toHaveLength(2);
    expect(within(row).getAllByTestId('yt-history-skeleton-tile')).toHaveLength(4);
    // Running outranks done: there is still something to cancel. Asserted on the
    // CANCEL BUTTON rather than on the badge word, which is gone in all states — and
    // the button is the better witness, because it is the thing the status enables.
    expect(within(row).getByTestId('yt-history-cancel')).toBeInTheDocument();
  });

  it('🔴 the rows are FULL WIDTH and the images are INTRINSICALLY sized, not counted', async () => {
    /**
     * 🔴 THIS ASSERTION INVERTED, AND THE INVERSION IS THE BUG FIX. It used to require
     * the two containers to carry the SAME `galleryStyle(layout)` template — rows and
     * images both `repeat(resultColumns, …)` — which is exactly what made the counts
     * MULTIPLY: 3 columns of rows × 3 columns of images = each thumbnail a ninth of
     * the main column, 4 × 4 = a sixteenth (~85px wide on a 1920px screen). They are
     * now deliberately DIFFERENT rules, and the pair below is what stops either half
     * regressing: one row per line, and an image grid whose column is a CLAMPED px
     * floor instead of a count. `responsive.test.tsx` walks four widths to show the
     * floor is tier-independent and carries the arithmetic behind the clamp; this pins
     * the shape at the base tier.
     *
     * jsdom lays nothing out, so this is a claim about the STYLE CONTRACT, not about
     * any rendered tile size and not about a measured overflow.
     */
    stockStorage([{ key: RECORD_KEY, value: { ...RECORD, workflowIds: ['wf-done'] } }]);
    state.workflows = [DONE_WORKFLOW];
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);

    await screen.findByTestId('yt-history-row');
    const rows = screen.getByTestId('yt-history-grid');
    const images = screen.getByTestId('yt-history-images');
    expect(rows.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(images.style.gridTemplateColumns).toBe(
      `repeat(auto-fill, minmax(min(${IMAGE_MIN_PX}px, 100%), 1fr))`,
    );
    // The two rules are NOT the same any more — asserted explicitly, because them
    // being the same is the defect.
    expect(images.style.gridTemplateColumns).not.toBe(rows.style.gridTemplateColumns);
    // And no column COUNT survives anywhere in either: a `repeat(<digit>, …)` here is
    // the old multiplying rule coming back under any name.
    expect(rows.style.gridTemplateColumns).not.toMatch(/repeat\(\s*\d/);
    expect(images.style.gridTemplateColumns).not.toMatch(/repeat\(\s*\d/);
  });

  it('🔴 the SKELETON grid is sized identically to the IMAGE grid, so a landing picture cannot reflow the row', async () => {
    // The invariant `ui-styles.ts` claims and the reason both call sites share ONE
    // no-argument helper. A partly-delivered batch is the only state where both grids
    // are on screen at once, so it is the only state in which this can be measured.
    stockStorage([
      {
        key: RECORD_KEY,
        value: {
          ...RECORD,
          workflowIds: ['wf-done', 'wf-running'],
          form: {
            ...RECORD.form,
            formats: [
              RECORD.form.formats[0],
              { id: 'minimal', label: 'Minimal', suffix: 'clean', prompt: 'a red bicycle, clean' },
            ],
          },
        },
      },
    ]);
    state.workflows = [DONE_WORKFLOW, RUNNING_WORKFLOW];
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);

    await screen.findByTestId('yt-history-row');
    const images = screen.getByTestId('yt-history-images');
    const skeleton = screen.getByTestId('yt-history-skeleton');
    expect(skeleton.style.gridTemplateColumns).toBe(images.style.gridTemplateColumns);
    // Not vacuous: both are the real intrinsic template, not two empty strings.
    expect(skeleton.style.gridTemplateColumns).toBe(
      `repeat(auto-fill, minmax(min(${IMAGE_MIN_PX}px, 100%), 1fr))`,
    );
    expect(skeleton.style.gap).toBe(images.style.gap);
  });
});
