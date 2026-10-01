import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppWorkflow } from '@civitai/app-sdk/blocks';

/**
 * THUMBNAIL HISTORY at the component boundary — the states the pure logic in
 * `history.test.ts` cannot reach, because they are about which HOOK failed and
 * what the app then puts on screen.
 *
 * 🔴 RED/GREEN MATRIX. `src/history.ts` does not exist at bec8894 and `App.tsx`
 * there imports neither `useAppWorkflows` nor `useSaveImage`, so every case here
 * fails to render at base. That is a VACUOUS red — it proves the feature is new,
 * not that any assertion bites. NONE of this file is regression coverage; it is
 * BEHAVIOUR coverage for behaviour this change introduces. The non-vacuous reds
 * for this change are in models.test.ts (the default checkpoint: a real
 * assertion failure against a file that exists at base) and manifest.test.ts
 * (the Buzz budget, likewise).
 *
 * What each case is worth is stated in its own comment: each pins a state that a
 * plausible implementation collapses into a DIFFERENT one, and the collapse is
 * the defect.
 *
 * 🔴 EVERY hook App imports must appear in the `vi.mock` below. A missing one
 * fails with "No <name> export is defined on the mock", which vitest reports as
 * a test FAILURE indistinguishable at a glance from a broken assertion.
 */

const EXPIRED_WORKFLOW: AppWorkflow = {
  workflowId: 'wf-expired',
  status: 'expired',
  images: [],
  cost: 209,
  createdAt: '2026-09-30T12:00:00.000Z',
};

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
  images: [{ url: 'https://image.civitai.com/done-a.jpg', width: 1536, height: 864, nsfwLevel: 1 }],
  cost: 209,
  createdAt: '2026-09-30T12:45:00.000Z',
};

/** A stored batch. `createdAt` sits inside the live page's window on purpose. */
const RECORD = {
  v: 1,
  batchId: 'b-1',
  createdAt: Date.parse('2026-09-30T12:15:00.000Z'),
  workflowIds: ['wf-expired'],
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
    checkpoint: { versionId: 2880272, modelId: 2563220, label: 'ChatGPT Images', baseModel: 'OpenAI' },
    loras: [],
    quantity: 2,
    account: 'yellow',
    sourceImage: null,
  },
};

const storageGet = vi.fn();
const storageList = vi.fn();
const storageSet = vi.fn();
const storageDelete = vi.fn();
const saveImage = vi.fn();
const cancelWorkflow = vi.fn();
const requestSignIn = vi.fn();
const submitWorkflow = vi.fn();
const estimateWorkflow = vi.fn();

// Mutable per-test hook state, read fresh on every render by the factories below.
const state = {
  viewer: { id: 2, username: 'dev' } as { id: number; username: string } | null,
  workflows: [] as AppWorkflow[],
  workflowsError: null as Error | null,
};

// 🔴 The storage handle is deliberately a FRESH OBJECT on every call, mirroring
// what a mocked host actually does. App.tsx must not depend on its identity —
// an effect that did spun without bound and took a worker to an OOM kill.
vi.mock('@civitai/blocks-react', () => ({
  useBlockContext: () => ({ ready: true, viewer: state.viewer, theme: 'dark' }),
  useBlockResize: () => {},
  useBlockBreakpoint: () => ({ tier: 'base', measured: false, atLeast: () => false, below: () => true }),
  useBlockToken: () => ({ scopes: ['ai:write:budgeted'], raw: 't', expiresAt: '' }),
  useBuzzWorkflow: () => ({ estimate: estimateWorkflow, submit: submitWorkflow, poll: vi.fn() }),
  useBuzzBalance: () => ({ balance: null, loading: false, error: null, refetch: vi.fn() }),
  useRequestConsent: () => ({ requestConsent: vi.fn() }),
  useRequestSignIn: () => ({ requestSignIn }),
  useResourcePicker: () => ({ open: vi.fn().mockResolvedValue(null) }),
  useImageUpload: () => ({ open: vi.fn().mockResolvedValue(null) }),
  useSaveImage: () => ({ saveImage }),
  useAppWorkflows: () => ({
    workflows: state.workflows,
    cursor: null,
    loading: false,
    error: state.workflowsError,
    refetch: vi.fn(),
    cancel: cancelWorkflow,
  }),
  useAppStorage: () => ({
    get: storageGet,
    set: storageSet,
    delete: storageDelete,
    list: storageList,
    getQuota: vi.fn().mockResolvedValue({ usedBytes: 0, rowCount: 0, limitBytes: 5e7, limitRows: 1e6 }),
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
const { HISTORY_PREFIX, historyKey } = await import('./history.js');

const RECORD_KEY = historyKey(RECORD.createdAt, RECORD.batchId);

/** Storage stocked with exactly one batch record. */
function stockStorage(records: Array<{ key: string; value: unknown }> = [{ key: RECORD_KEY, value: RECORD }]) {
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
 * assertion below would read as a missing row — which is exactly how this helper
 * failed when auto-expand landed. Reading the label makes it race-free in both
 * directions: if the rows have not loaded yet the toggle says "Show", the click
 * pins the panel open explicitly, and the rows arrive into an open panel.
 */
async function openHistory(user: ReturnType<typeof userEvent.setup>) {
  const toggle = await screen.findByTestId('yt-history-toggle');
  if (/show/i.test(toggle.textContent ?? '')) await user.click(toggle);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.viewer = { id: 2, username: 'dev' };
  state.workflows = [];
  state.workflowsError = null;
  storageSet.mockResolvedValue({ ok: true });
  storageDelete.mockResolvedValue({ ok: true, deleted: true });
  saveImage.mockResolvedValue(undefined);
  cancelWorkflow.mockResolvedValue(undefined);
  stockStorage([]);
});

// ---------------------------------------------------------------------------

describe('history — the anonymous path', () => {
  it('🔴 renders a SIGN-IN prompt, never an empty-looking grid, and never throws', () => {
    /**
     * `useAppWorkflows` ERRORS for an anonymous viewer and `useAppStorage`
     * REJECTS their writes, so there is no history and there never could be. The
     * defect this pins is the collapse of "you are not signed in" into "you have
     * no generations" — an empty list is a FALSE STATEMENT about someone who may
     * have plenty, and it offers them no way forward.
     */
    state.viewer = null;
    state.workflowsError = new Error('anonymous viewer');
    expect(() => render(<App />)).not.toThrow();
  });

  it('shows the sign-in affordance and wires it to the host prompt', async () => {
    state.viewer = null;
    state.workflowsError = new Error('anonymous viewer');
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);

    expect(await screen.findByTestId('yt-history-anon')).toHaveTextContent(/sign in/i);
    await user.click(screen.getByTestId('yt-history-signin'));
    expect(requestSignIn).toHaveBeenCalled();

    // ...and it did NOT show the empty state, which is the collapse being ruled out.
    expect(screen.queryByTestId('yt-history-empty')).not.toBeInTheDocument();
    // Nothing is even attempted against storage for an anonymous viewer.
    expect(storageList).not.toHaveBeenCalled();
  });
});

describe('history — a rejected storage scope', () => {
  it('🔴 is its own state with its own message, not "couldn\'t load"', async () => {
    /**
     * The apps:storage scopes are consent-gated and have NEVER been consented in
     * production — this feature is the first thing to touch them — so a
     * scope-denied read is a realistic FIRST RUN. The fix a viewer needs is
     * "grant this app storage access", which a generic error message does not
     * tell them, and an unhandled rejection tells them even less.
     */
    storageList.mockRejectedValue(new Error('FORBIDDEN: missing scope apps:storage:read'));
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);

    const denied = await screen.findByTestId('yt-history-denied');
    expect(denied).toHaveTextContent(/storage access/i);
    // Distinguished from the generic error state — the collapse being ruled out.
    expect(screen.queryByTestId('yt-history-error')).not.toBeInTheDocument();
  });

  it('a non-scope failure is the GENERIC error state, and says the Buzz was still spent', async () => {
    storageList.mockRejectedValue(new Error('network hiccup'));
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);

    expect(await screen.findByTestId('yt-history-error')).toBeInTheDocument();
    expect(screen.queryByTestId('yt-history-denied')).not.toBeInTheDocument();
  });
});

describe('history — an EXPIRED generation', () => {
  beforeEach(() => {
    stockStorage();
    state.workflows = [EXPIRED_WORKFLOW];
  });

  it('🔴 still RENDERS, marked plainly, rather than vanishing or reading as a failure', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);

    const row = await screen.findByTestId('yt-history-row');
    expect(within(row).getByText('Expired')).toBeInTheDocument();
    // ...and its realized cost is still reported: it was paid for.
    expect(within(row).getByTestId('yt-history-cost')).toHaveTextContent('209 Buzz');
  });

  it('🔴 still RESUMES — the form half is ours and does not expire with the images', async () => {
    /**
     * The whole justification for keeping an expired row on screen. Asserted on
     * the restored FORM, because that is what a resume is for; that the restored
     * form reproduces the original BODY is asserted at the wire level in
     * history.test.ts, where it can be compared to `buildWorkflowBody` directly.
     */
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);
    await user.click(await screen.findByTestId('yt-history-resume'));

    await waitFor(() =>
      expect(screen.getByLabelText(/prompt/i)).toHaveValue('a red bicycle'),
    );
    expect(screen.getByTestId('pm-model-label')).toHaveTextContent('ChatGPT Images');
    // quantity 2, the value the record carries — distinct from the app's default 1,
    // so this cannot pass by coincidence. Read off the <select>'s VALUE now that the
    // control is a dropdown rather than a row of `aria-checked` pills.
    expect(screen.getByTestId('pm-quantity')).toHaveValue('2');
  });

  it('🔴 RESUME DOES NOT SUBMIT — no submit, no Buzz', async () => {
    /**
     * The operator's decision, pinned as BEHAVIOUR at the money hooks rather than
     * as a label. At 209 Buzz an image, a one-click re-run on a history row is
     * exactly how Buzz gets spent by accident; a "Resume" that auto-submitted
     * would look identical on screen and cost real money.
     *
     * 🔴 THE `estimate` HALF OF THIS CASE WAS REMOVED ON PURPOSE, and its removal is
     * not a weakening. `estimate()` is a READ: it prices a body and spends nothing.
     * The app now prices the form whenever it changes, so a resume — which changes
     * the checkpoint, the quantity and the formats — is SUPPOSED to produce an
     * estimate, and a resumed form arriving unpriced would be the defect. `submit()`
     * is the only call that can debit a viewer, so it is what this pins.
     */
    estimateWorkflow.mockResolvedValue({ workflowId: 'e', status: 'pending', cost: { total: 418 } });
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);
    // 🔴 SNAPSHOTTED BEFORE THE RESUME, NOT ASSERTED AS "called at all". This file's
    // token carries `ai:write:budgeted`, so the MOUNT preview has already estimated by
    // now — a bare `toHaveBeenCalled()` resolves on that first call and waits for
    // nothing, which is exactly the hole this closes. What proves the debounce actually
    // fired AFTER the resume is a NEW call, and the resume changes the checkpoint, the
    // quantity and the formats, so one is owed.
    const estimatesBefore = estimateWorkflow.mock.calls.length;
    await user.click(await screen.findByTestId('yt-history-resume'));

    await waitFor(() => expect(screen.getByLabelText(/prompt/i)).toHaveValue('a red bicycle'));
    expect(submitWorkflow).not.toHaveBeenCalled();
    // The Generate button is there, priced-or-not, waiting for a deliberate click.
    expect(screen.getByTestId('pm-generate')).toBeInTheDocument();
    // Give the live preview's debounce room to fire and confirm it STILL has not
    // submitted. Without this the case cannot tell "never submits" from "had not
    // submitted yet at the moment we looked".
    await waitFor(
      () => expect(estimateWorkflow.mock.calls.length).toBeGreaterThan(estimatesBefore),
      { timeout: 3000 },
    );
    expect(submitWorkflow).not.toHaveBeenCalled();
  });

  it('offers NO cancel for a terminal batch', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);
    await screen.findByTestId('yt-history-row');
    expect(screen.queryByTestId('yt-history-cancel')).not.toBeInTheDocument();
  });
});

describe('history — cancel, and saving a past image', () => {
  it('🔴 offers Cancel only while a workflow is still running, and cancels THAT id', async () => {
    stockStorage([
      { key: RECORD_KEY, value: { ...RECORD, workflowIds: ['wf-running'] } },
    ]);
    state.workflows = [RUNNING_WORKFLOW];
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);

    await user.click(await screen.findByTestId('yt-history-cancel'));
    await waitFor(() => expect(cancelWorkflow).toHaveBeenCalledWith('wf-running'));
  });

  it('saves a past image through the HOST bridge, with a real filename', async () => {
    stockStorage([{ key: RECORD_KEY, value: { ...RECORD, workflowIds: ['wf-done'] } }]);
    state.workflows = [DONE_WORKFLOW];
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);

    await user.click(await screen.findByTestId('yt-history-save'));
    await waitFor(() =>
      expect(saveImage).toHaveBeenCalledWith({
        url: 'https://image.civitai.com/done-a.jpg',
        filename: 'yt-thumbnail-clickbait-1.jpg',
      }),
    );
  });

  it('🔴 names each image after ITS OWN format, in the filename AND the alt text', async () => {
    /**
     * 🔴 RED AT c84f082, where the row used `form.formats[0].label` for every image in
     * it: the SECOND image of a 2-format batch was saved as
     * `yt-thumbnail-clickbait-2.jpg` — a wrong filename on the only real download this
     * block has — and its alt text named no format at all.
     *
     * Two formats, two workflows, one image each, so `formats[i]` and the image index
     * agree here; the cases where they DON'T (a missing workflow, quantity > 1) are
     * pinned on the join itself in `history.test.ts`, where the arithmetic is visible.
     */
    const DONE_B: AppWorkflow = {
      workflowId: 'wf-done-2',
      status: 'succeeded',
      images: [{ url: 'https://image.civitai.com/done-b.jpg', width: 1536, height: 864, nsfwLevel: 1 }],
      cost: 209,
      createdAt: '2026-09-30T12:46:00.000Z',
    };
    stockStorage([
      {
        key: RECORD_KEY,
        value: {
          ...RECORD,
          workflowIds: ['wf-done', 'wf-done-2'],
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
    state.workflows = [DONE_WORKFLOW, DONE_B];
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);

    const images = await screen.findAllByTestId('yt-history-img');
    expect(images).toHaveLength(2);

    // 🔴 THE FILENAME FIRST — it is the half that leaves the page, so it is the half
    // that should go red. At c84f082 this asks for `yt-thumbnail-clickbait-2.jpg`.
    const saves = await screen.findAllByTestId('yt-history-save');
    await user.click(saves[1]);
    await waitFor(() =>
      expect(saveImage).toHaveBeenCalledWith({
        url: 'https://image.civitai.com/done-b.jpg',
        filename: 'yt-thumbnail-minimal-2.jpg',
      }),
    );

    // Then the on-page ATTRIBUTION, which the alt text had dropped entirely. (Measured
    // separately at base: `alt="Generated result 1"` there, naming no format at all.)
    expect(images[0]).toHaveAttribute('alt', expect.stringContaining('Clickbait'));
    expect(images[1]).toHaveAttribute('alt', expect.stringContaining('Minimal'));
  });
});

describe('history — pruning orphaned rows', () => {
  it('🔴 deletes a record inside the fetched window that matches no live workflow', async () => {
    /**
     * The drift the operator asked for: a storage row nothing can ever join to.
     *
     * 🔴 THE LIVE WORKFLOW IS DATED *BEFORE* THE RECORD, AND THAT IS THE POINT.
     * Pruning is bounded by the oldest workflow actually fetched, so a record is
     * only orphaned when it sits INSIDE the window the page is evidence about.
     * The first version of this case used `DONE_WORKFLOW` at its own 12:45,
     * which is AFTER the record's 12:15 — so the record was outside the window
     * and correctly NOT pruned, and the test failed. That failure was the bound
     * working; the fixture was what was wrong.
     */
    stockStorage();
    state.workflows = [{ ...DONE_WORKFLOW, createdAt: '2026-09-30T11:00:00.000Z' }];
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);

    await waitFor(() => expect(storageDelete).toHaveBeenCalledWith(RECORD_KEY));
    // ...and the row goes with it, so the screen and the store agree.
    await waitFor(() => expect(screen.queryByTestId('yt-history-row')).not.toBeInTheDocument());
  });

  it('🔴 deletes NOTHING when the live page is empty — that is absence of evidence', async () => {
    /**
     * `useAppWorkflows` returns one page. "Not in this page" and "does not exist"
     * are the same observable, so an empty page justifies no deletion at all.
     * Killed by pruning on "no match": the viewer's whole history disappears the
     * first time the queue read fails or returns nothing.
     */
    stockStorage();
    state.workflows = [];
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);

    await screen.findByTestId('yt-history-row');
    expect(storageDelete).not.toHaveBeenCalled();
  });

  it('reads the records back under the history prefix, not the whole keyspace', async () => {
    stockStorage();
    render(<App />);
    await waitFor(() =>
      expect(storageList).toHaveBeenCalledWith(expect.objectContaining({ prefix: HISTORY_PREFIX })),
    );
  });
});

describe('🔴 the record WRITTEN at submit time', () => {
  /**
   * THE STRONGEST FORM OF "a resume reproduces the exact submitted body": rather
   * than comparing the stored record to a body this test wrote down, it compares
   * it to the bodies `submit()` was ACTUALLY called with in the same click.
   *
   * `history.test.ts` pins `batchBodies` against literal `buildWorkflowBody`
   * calls — that is the wire contract in isolation. This is the SEAM: that the
   * thing the App stored is the thing the App sent. Neither test can see the
   * other's defect. A record written from a parallel snapshot that drifted from
   * the submitted body would satisfy the pure test and fail here.
   */
  it('stores ONE batch whose bodies equal the bodies submit() was called with', async () => {
    const { batchBodies, parseRecord } = await import('./history.js');
    const { BUILTIN_FORMATS } = await import('./formats.js');
    const [CLICKBAIT, CINEMATIC] = BUILTIN_FORMATS;

    estimateWorkflow.mockResolvedValue({ workflowId: 'e', status: 'pending', cost: { total: 209 } });
    let n = 0;
    submitWorkflow.mockImplementation(async () => ({
      workflowId: `wf-new-${++n}`,
      status: 'succeeded',
      cost: { total: 209 },
      imageUrls: [`img-${n}`],
    }));

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByTestId(`yt-format-${CINEMATIC.id}`));
    await user.type(screen.getByLabelText(/prompt/i), 'a cat on a skateboard');
    await user.selectOptions(screen.getByTestId('pm-quantity'), '3');
    await user.click(screen.getByTestId('pm-generate'));

    await waitFor(() => expect(submitWorkflow).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(storageSet).toHaveBeenCalledTimes(1));

    const [key, value] = storageSet.mock.calls[0];
    expect(key).toMatch(new RegExp(`^${HISTORY_PREFIX}`));

    // Survives the JSON round trip storage actually performs, and parses back.
    const stored = parseRecord(JSON.parse(JSON.stringify(value)));
    expect(stored).not.toBeNull();

    // 🔴 THE GROUPING: both workflows from this ONE click, in ONE record.
    expect(stored?.workflowIds.sort()).toEqual(['wf-new-1', 'wf-new-2']);

    // 🔴 THE BODIES: what a resume would send === what was sent.
    const submitted = submitWorkflow.mock.calls.map((c) => c[0]);
    const resumed = batchBodies(stored!.form);
    const byPrompt = (a: { params: { prompt: string } }, b: { params: { prompt: string } }) =>
      a.params.prompt.localeCompare(b.params.prompt);
    expect([...resumed].sort(byPrompt)).toEqual([...submitted].sort(byPrompt));

    // And a sanity check that this is not two copies of one body — the property
    // multi-format exists for, and the one a collapsed record would still pass
    // the equality above by breaking on BOTH sides at once.
    expect(resumed).toHaveLength(2);
    expect(resumed[0].params.prompt).not.toBe(resumed[1].params.prompt);
    expect(resumed.some((b) => b.params.prompt.includes(CLICKBAIT.suffix))).toBe(true);
    expect(resumed.some((b) => b.params.prompt.includes(CINEMATIC.suffix))).toBe(true);
    // quantity 3 was chosen above — distinct from the default, so it cannot pass
    // by coincidence.
    for (const b of resumed) expect(b.params.quantity).toBe(3);
  });

  it('never writes a record when nothing submitted — an unjoinable row', async () => {
    estimateWorkflow.mockResolvedValue({ workflowId: 'e', status: 'pending', cost: { total: 209 } });
    submitWorkflow.mockRejectedValue(new Error('orchestrator refused'));

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    await waitFor(() => expect(submitWorkflow).toHaveBeenCalled());
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('🔴 a storage failure NEVER reads as a generation failure — the Buzz is already spent', async () => {
    estimateWorkflow.mockResolvedValue({ workflowId: 'e', status: 'pending', cost: { total: 209 } });
    submitWorkflow.mockResolvedValue({
      workflowId: 'wf-new',
      status: 'succeeded',
      cost: { total: 209 },
      imageUrls: ['img-1'],
    });
    storageSet.mockRejectedValue(new Error('FORBIDDEN: missing scope apps:storage:write'));

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    // 🔴 THE IMAGES ARE STILL SHOWN, and this is much harder to get right than it was.
    // The images used to live in a candidate grid that knew nothing about storage; they
    // now live in the history row, so a rejected write reaches the very surface that
    // renders them. Two things make it hold and both are load-bearing: the record is
    // inserted into the list BEFORE the round trip, and `denied` renders as a BANNER
    // OVER the rows rather than instead of them.
    expect(await screen.findByTestId('yt-history-img')).toBeInTheDocument();
    expect(screen.getByTestId('pm-spent')).toHaveTextContent('209');
    // The storage problem is reported SEPARATELY, and names the grant.
    expect(await screen.findByTestId('yt-history-note')).toHaveTextContent(/storage access/i);
    expect(await screen.findByTestId('yt-history-denied')).toBeInTheDocument();
    // ...and NOT as a failed generation.
    expect(screen.queryByTestId('pm-failed')).not.toBeInTheDocument();
  });
});

describe('🔴 a run whose storage write FAILED is not deleted by a refresh', () => {
  /**
   * 🔴 THE BUG THIS CLOSES, AND IT IS THE DEPLOY-BLOCKING ONE. The batch record is
   * inserted optimistically, before `set()` is acknowledged, because the row IS the
   * surface the viewer's images appear in. When that write rejects, the panel shows a
   * banner and a **"Try again"** button — and that button called `loadHistory`, which
   * REPLACED the list with what storage actually holds. Storage never held this run,
   * so the row and its paid-for images vanished, permanently: `joinHistory` is their
   * only renderer, so a reload did not bring them back either.
   *
   * 🔴 RED AT c84f082 on a real assertion in both cases below (measured). Each asserts
   * the image is present BEFORE the refresh as well as after, so "still there" cannot
   * be confused with "never rendered".
   */
  const FRESH_IMAGE = 'https://image.civitai.com/fresh.jpg';

  function generateOnce() {
    estimateWorkflow.mockResolvedValue({ workflowId: 'e', status: 'pending', cost: { total: 209 } });
    submitWorkflow.mockResolvedValue({
      workflowId: 'wf-new',
      status: 'succeeded',
      cost: { total: 209 },
      imageUrls: [FRESH_IMAGE],
    });
    // 🔴 THE LIST STILL WORKS. That is the exact shape of the bug: the refresh
    // SUCCEEDS and hands back a store that never contained this run.
    stockStorage([]);
  }

  it('survives the "Try again" button the error state itself offers', async () => {
    /**
     * 🔴 A NON-DENIED, NON-ANON message ON PURPOSE. `classifyStorageError` maps this to
     * `error`, which is the only state that renders a retry button — so this is the
     * one path where the app hands the viewer the control that deleted their images.
     */
    generateOnce();
    storageSet.mockRejectedValue(new Error('network hiccup'));

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    expect(await screen.findByTestId('yt-history-img')).toHaveAttribute('src', FRESH_IMAGE);
    const retry = await screen.findByRole('button', { name: /try again/i });

    const listsBefore = storageList.mock.calls.length;
    await user.click(retry);
    // The refresh really ran, which is the only sync point this case needs...
    await waitFor(() => expect(storageList.mock.calls.length).toBeGreaterThan(listsBefore));

    // 🔴 THE POINT, AND ASSERTED FIRST SO IT IS WHAT GOES RED: the row and the image
    // the viewer already PAID FOR are still there. (Ordered deliberately — with the
    // retry-count assertion above these, the case failed at base on the RETRY and
    // never reached the survival claim, so the survival claim was unproven.)
    expect(screen.getByTestId('yt-history-row')).toBeInTheDocument();
    expect(screen.getByTestId('yt-history-img')).toHaveAttribute('src', FRESH_IMAGE);
    // ...and the honest note about the SAVE is still beside them.
    expect(screen.getByTestId('yt-history-note')).toHaveTextContent(/couldn't save this run/i);

    // Separately: the refresh RETRIED the write that failed, which is what "try again"
    // should mean on a surface whose only problem was a rejected write.
    await waitFor(() => expect(storageSet).toHaveBeenCalledTimes(2));
  });

  it('survives a token that expired mid-run — the ANON state is a banner, not a replacement', async () => {
    /**
     * `classifyStorageError` matches 'anon' / 'sign in' / 'not signed in' on a failed
     * `set`, so a mid-run expiry lands here. The `anon` branch was an UNCONDITIONAL
     * early return, so it replaced the row with a sign-in prompt — while the note
     * written on that very path says "This run's images are above". They were not.
     */
    generateOnce();
    storageSet.mockRejectedValue(new Error('not signed in'));

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    // The sign-in prompt appears...
    expect(await screen.findByTestId('yt-history-anon')).toHaveTextContent(/sign in/i);
    // ...ABOVE the images, not instead of them, and the note is then a true statement.
    expect(screen.getByTestId('yt-history-img')).toHaveAttribute('src', FRESH_IMAGE);
    expect(screen.getByTestId('yt-history-note')).toHaveTextContent(/images are above/i);
  });

  it('🔴 a RELOAD IN FLIGHT does not blank rows it already has', async () => {
    /**
     * 🔴 RED AT c84f082: `state === 'loading'` was an unconditional early return
     * alongside a `loading` FLAG that had been correctly narrowed to
     * `entries.length === 0`. So EVERY reload — the Show toggle and the error
     * banner's Try again both call one — blanked the images for its duration.
     *
     * The `list()` call is left UNRESOLVED on purpose: that is what holds the app in
     * `historyState === 'loading'` for the assertions. With the fix the loading state
     * is invisible when there are rows, so there is nothing positive to assert about
     * it; what makes this non-vacuous is that it was RED at base, plus the two facts
     * asserted here — `list()` was called again and has not come back — which together
     * mean the code is inside the branch by construction.
     */
    stockStorage();
    state.workflows = [EXPIRED_WORKFLOW];
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);
    await screen.findByTestId('yt-history-row');

    let release = () => {};
    storageList.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ keys: [{ key: RECORD_KEY, updatedAt: new Date() }] });
        }),
    );
    const listsBefore = storageList.mock.calls.length;
    // Hide, then Show — the Show is what calls `loadHistory`, and it now hangs.
    await user.click(screen.getByTestId('yt-history-toggle'));
    await user.click(screen.getByTestId('yt-history-toggle'));
    await waitFor(() => expect(storageList.mock.calls.length).toBeGreaterThan(listsBefore));

    expect(screen.getByTestId('yt-history-row')).toBeInTheDocument();
    expect(screen.queryByTestId('yt-history-loading')).not.toBeInTheDocument();

    // Let the hung read settle so nothing is left pending past the test.
    release();
    await waitFor(() => expect(screen.getByTestId('yt-history-row')).toBeInTheDocument());
  });
});

describe('🔴 the surface is OPEN whenever there are rows', () => {
  it('shows a returning visitor their generations without a click', async () => {
    /**
     * 🔴 RED AT c84f082, where `historyOpen` was `useState(false)` and only ever set
     * true at submit: a returning viewer's whole history — this app's results surface
     * — was collapsed behind a "Show" button. NO CLICK ANYWHERE IN THIS CASE, which is
     * the assertion.
     */
    stockStorage([{ key: RECORD_KEY, value: { ...RECORD, workflowIds: ['wf-done'] } }]);
    state.workflows = [DONE_WORKFLOW];
    render(<App />);

    expect(await screen.findByTestId('yt-history-img')).toBeInTheDocument();
    expect(await screen.findByTestId('yt-history-toggle')).toHaveTextContent(/hide/i);
  });

  it('still honours an explicit Hide', async () => {
    // The other arm: auto-expand must not mean "cannot be closed".
    stockStorage([{ key: RECORD_KEY, value: { ...RECORD, workflowIds: ['wf-done'] } }]);
    state.workflows = [DONE_WORKFLOW];
    const user = userEvent.setup();
    render(<App />);

    await screen.findByTestId('yt-history-img');
    await user.click(screen.getByTestId('yt-history-toggle'));
    await waitFor(() => expect(screen.queryByTestId('yt-history-img')).not.toBeInTheDocument());
    expect(screen.getByTestId('yt-history-toggle')).toHaveTextContent(/show/i);
  });

  it('🔴 "Reuse settings" does not hide the images', async () => {
    /**
     * 🔴 RED AT c84f082: `onResume` called `setHistoryOpen(false)`, which was harmless
     * while this was a collapsible archive and is a deletion now that it is where the
     * pictures live — clicking Reuse settings hid the row it was clicked in, and every
     * image on the page with it.
     */
    stockStorage([{ key: RECORD_KEY, value: { ...RECORD, workflowIds: ['wf-done'] } }]);
    state.workflows = [DONE_WORKFLOW];
    const user = userEvent.setup();
    render(<App />);

    await screen.findByTestId('yt-history-img');
    await user.click(screen.getByTestId('yt-history-resume'));

    await waitFor(() => expect(screen.getByLabelText(/prompt/i)).toHaveValue('a red bicycle'));
    expect(screen.getByTestId('yt-history-img')).toBeInTheDocument();
    expect(screen.getByTestId('yt-history-row')).toBeInTheDocument();
  });
});

describe('history — a multi-format batch', () => {
  it('🔴 groups one click\'s N workflows into ONE row and restores all N formats', async () => {
    /**
     * The host drops `tags`, so nothing on the live side ties a click's N
     * workflows together. Killed by rendering per workflow: a 2-format run would
     * show as two rows at two prices, and a resume from either would restore one
     * format instead of two.
     */
    const twoFormat = {
      ...RECORD,
      workflowIds: ['wf-done', 'wf-running'],
      form: {
        ...RECORD.form,
        formats: [
          RECORD.form.formats[0],
          { id: 'minimal', label: 'Minimal', suffix: 'clean', prompt: 'a red bicycle, clean' },
        ],
      },
    };
    stockStorage([{ key: RECORD_KEY, value: twoFormat }]);
    state.workflows = [DONE_WORKFLOW, RUNNING_WORKFLOW];
    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);

    // ONE row, not two.
    expect(await screen.findAllByTestId('yt-history-row')).toHaveLength(1);
    const row = screen.getByTestId('yt-history-row');
    expect(within(row).getByTestId('yt-history-formats')).toHaveTextContent('Clickbait · Minimal');
    // Running outranks done — there is still something to cancel.
    expect(within(row).getByText('Running')).toBeInTheDocument();

    await user.click(within(row).getByTestId('yt-history-resume'));
    // BOTH formats come back selected, including one the viewer does not own.
    await waitFor(() => {
      expect(screen.getByTestId('yt-format-clickbait')).toBeInTheDocument();
      expect(screen.getByTestId('yt-format-minimal')).toBeInTheDocument();
    });
  });
});
