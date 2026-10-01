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

  it('🔴 survives the retry SUCCEEDING, which is the outcome that nearly dropped it', async () => {
    /**
     * 🔴 THE NEAR-MISS FIX, PINNED. The merge must use the unsaved list SNAPSHOTTED
     * BEFORE the retry. Reading the map again afterwards drops exactly the records
     * whose retry LANDED: they are no longer unsaved, and they are not in the stored
     * half either, because that was read before they were written. The row would
     * vanish on the one outcome that fixed the problem — and every other case in this
     * describe would still pass, because in all of them the retry fails.
     *
     * Not a red-at-base case (the whole retry is new here): this is a MUTATION guard,
     * and it was watched to fail against the `unsavedRecords()`-after-the-retry
     * mutant with this test's own assertion.
     */
    generateOnce();
    // Reject the submit-time write, accept the retry.
    storageSet.mockRejectedValueOnce(new Error('network hiccup')).mockResolvedValue({ ok: true });

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    expect(await screen.findByTestId('yt-history-img')).toHaveAttribute('src', FRESH_IMAGE);
    const listsBefore = storageList.mock.calls.length;
    await user.click(await screen.findByRole('button', { name: /try again/i }));
    await waitFor(() => expect(storageList.mock.calls.length).toBeGreaterThan(listsBefore));
    // The retry landed...
    await waitFor(() => expect(storageSet).toHaveBeenCalledTimes(2));
    // ...and the row is STILL on screen, even though the `list()` that ran a moment
    // before the successful write could not have seen it.
    expect(screen.getByTestId('yt-history-row')).toBeInTheDocument();
    expect(screen.getByTestId('yt-history-img')).toHaveAttribute('src', FRESH_IMAGE);
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

  it('🔴 a retry that FAILS AGAIN keeps the banner and the Try again button', async () => {
    /**
     * 🔴 RED AT f4df1a38 — the retry's `catch` was empty and `setHistoryState('ready')`
     * ran unconditionally, so the ONE outcome that means "still broken" was reported as
     * "fine". Shape: host KV quota exhausted, so `set()` rejects forever while
     * `list()`/`get()` keep working. Submit → banner + "Try again" → click → the read
     * succeeds, the retry rejects → the banner and the button were WITHDRAWN while the
     * record was still only in memory and still about to die with the iframe.
     *
     * 🔴 THE SYNC POINT IS A SECOND ROW, NOT A TIMER. The reload's `setHistoryRecords`
     * and its `setHistoryState` are called back-to-back, so React commits them
     * together: once the row this read ADDS is on screen, the state write has landed
     * too. Waiting on `storageSet` alone would assert before it, which passes at base
     * for the wrong reason.
     */
    generateOnce();
    state.workflows = [EXPIRED_WORKFLOW];
    storageSet.mockRejectedValue(new Error('storage quota exceeded'));

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    expect(await screen.findByTestId('yt-history-img')).toHaveAttribute('src', FRESH_IMAGE);
    await screen.findByTestId('yt-history-error');

    // The read now hands back a row that was NOT on screen before, so the merge's
    // commit is observable.
    stockStorage();
    await user.click(await screen.findByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.getAllByTestId('yt-history-row')).toHaveLength(2));
    // The retry really ran and really failed again.
    await waitFor(() => expect(storageSet).toHaveBeenCalledTimes(2));

    // 🔴 THE POINT: the surface still says there is a problem, and still offers the
    // only control that can fix it.
    expect(screen.getByTestId('yt-history-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    // ...and the unsaved row is still rendered, with its image.
    const srcs = screen.getAllByTestId('yt-history-img').map((n) => n.getAttribute('src'));
    expect(srcs).toContain(FRESH_IMAGE);
  });

  it('🔴 a batch SAVED while a reload is in flight is not overwritten away', async () => {
    /**
     * 🔴 RED AT f4df1a38, and the half `unsavedRecordsRef` cannot cover. The merge was
     * `setHistoryRecords(mergeUnsavedRecords(stored, held))` — a NON-functional setter
     * fed two snapshots taken before the awaits. A batch inserted AND SUCCESSFULLY
     * SAVED while the read was in flight is in NEITHER: not in `stored` (listed before
     * the write) and not in `held` (its write succeeded, so it was dropped from the
     * unsaved map). The resolving read therefore overwrote that row and its images away
     * — the success path, with no banner and nothing to retry.
     *
     * The `get()` for a second stored key is held open to put the read INSIDE that
     * window; releasing it adds a row in every version, which is the sync point.
     */
    const RECORD2_KEY = historyKey(Date.parse('2026-09-30T12:20:00.000Z'), 'b-2');
    const RECORD2 = { ...RECORD, batchId: 'b-2', createdAt: Date.parse('2026-09-30T12:20:00.000Z'), workflowIds: ['wf-done'] };

    stockStorage([{ key: RECORD_KEY, value: RECORD }]);
    state.workflows = [EXPIRED_WORKFLOW, DONE_WORKFLOW];
    estimateWorkflow.mockResolvedValue({ workflowId: 'e', status: 'pending', cost: { total: 209 } });
    submitWorkflow.mockResolvedValue({
      workflowId: 'wf-new',
      status: 'succeeded',
      cost: { total: 209 },
      imageUrls: [FRESH_IMAGE],
    });

    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);
    await screen.findByTestId('yt-history-row');

    // The reload will list TWO keys and hang on the second one's value.
    let release = () => {};
    storageList.mockResolvedValue({
      keys: [
        { key: RECORD_KEY, updatedAt: new Date() },
        { key: RECORD2_KEY, updatedAt: new Date() },
      ],
    });
    storageGet.mockImplementation(async (key: string) => {
      if (key === 'formats:custom:v1') return null;
      if (key === RECORD_KEY) return RECORD;
      return new Promise((resolve) => {
        release = () => resolve(RECORD2);
      });
    });

    // Hide then Show: the Show starts the reload, which now hangs mid-read.
    await user.click(screen.getByTestId('yt-history-toggle'));
    await user.click(screen.getByTestId('yt-history-toggle'));
    await waitFor(() => expect(storageGet).toHaveBeenCalledWith(RECORD2_KEY));

    // Generate DURING that read. Its write SUCCEEDS, which is the whole point: there
    // is nothing in the unsaved map to carry this row across.
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));
    await waitFor(() =>
      expect(screen.getAllByTestId('yt-history-img').map((n) => n.getAttribute('src'))).toContain(
        FRESH_IMAGE,
      ),
    );
    await waitFor(() => expect(storageSet).toHaveBeenCalledTimes(1));

    // Let the read resolve. Its second row lands in every version, so this is a sync
    // point on the merge's own commit rather than on a timer.
    release();
    await waitFor(() =>
      expect(screen.getAllByTestId('yt-history-img').map((n) => n.getAttribute('src'))).toContain(
        'https://image.civitai.com/done-a.jpg',
      ),
    );

    // 🔴 THE POINT: the batch that was saved mid-read is still on screen.
    const srcs = screen.getAllByTestId('yt-history-img').map((n) => n.getAttribute('src'));
    expect(srcs).toContain(FRESH_IMAGE);
    expect(screen.getAllByTestId('yt-history-row')).toHaveLength(3);
  });

  it('🔴 a token that expires does not delete the rows storage ALREADY HAS', async () => {
    /**
     * 🔴 RED AT f4df1a38. The anon branch passed `[]` as the STORED half —
     * `mergeUnsavedRecords([], unsavedRecords())` — so every row storage had already
     * given us was dropped the moment `viewerId` went null. A token expiring and the
     * viewer clicking Hide then Show collapsed the surface to "Thumbnails 0" and took
     * the images with it until a full reload. (Better than the `setHistoryRecords([])`
     * it replaced, which dropped the unsaved half too — still a deletion of paid-for
     * images.)
     */
    stockStorage([{ key: RECORD_KEY, value: { ...RECORD, workflowIds: ['wf-done'] } }]);
    state.workflows = [DONE_WORKFLOW];
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('yt-history-img');

    // The token expires: the host now reports no viewer at all.
    state.viewer = null;
    // Hide forces the render that picks that up — which re-runs the load effect under
    // the new (null) viewer id, i.e. the anon branch.
    await user.click(screen.getByTestId('yt-history-toggle'));
    // Then Show, which is the click that calls `loadHistory` itself. (Measured: at
    // f4df1a38 the list is still intact after the Hide — the anon branch runs on this
    // second click — so there is nothing load-bearing to assert in between, and a
    // `waitFor` on the badge here passes on its first attempt either way.)
    await user.click(screen.getByTestId('yt-history-toggle'));

    // 🔴 THE POINT: the row and its paid-for image are still there, with the sign-in
    // prompt as a BANNER above them rather than in place of them.
    expect(await screen.findByTestId('yt-history-row')).toBeInTheDocument();
    expect(screen.getByTestId('yt-history-img')).toHaveAttribute(
      'src',
      'https://image.civitai.com/done-a.jpg',
    );
    expect(screen.getByTestId('yt-history-anon')).toBeInTheDocument();
    // And the header still counts it — the badge read "Thumbnails 0" at base.
    expect(screen.getByTestId('yt-history')).toHaveTextContent(/Thumbnails\s*1/);
  });

  it('🔴 a DIFFERENT signed-in id gets none of the previous viewer\'s rows', async () => {
    /**
     * 🔴 BEHAVIOUR COVERAGE FOR A CLASS, NOT A REPRODUCED BUG. Neither the unsaved map
     * nor the on-screen list is keyed to a viewer, and `loadHistory` re-`set()`s the map
     * under whoever is signed in when it next runs — so if the host ever swapped
     * `viewer` to a different id without remounting the block, viewer A's records would
     * be written into viewer B's storage and rendered to them. Whether `blocks-react`
     * does that is NOT established; `historyOwnerRef` closes the class either way, and
     * this is what exercises it. (Its other arm — `null` is NOT a swap, because a
     * mid-run token expiry must not delete anything — is the case above.)
     *
     * Deliberately asserts on the WRITE as well as the render: a guard that only blanked
     * the screen would still hand viewer A's unsaved record to viewer B's storage. The
     * new viewer is given a row of their OWN so that BOTH assertions are reached in every
     * variant — its arrival is the sync point, rather than the absence of viewer A's row,
     * which is one of the things under test.
     */
    const OWN_IMAGE = 'https://image.civitai.com/done-a.jpg';
    const srcs = () => screen.getAllByTestId('yt-history-img').map((n) => n.getAttribute('src'));

    generateOnce();
    state.workflows = [DONE_WORKFLOW];
    storageSet.mockRejectedValue(new Error('network hiccup'));

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));
    expect(await screen.findByTestId('yt-history-img')).toHaveAttribute('src', FRESH_IMAGE);

    // A different person is now signed in, and storage answers with THEIR row.
    stockStorage([{ key: RECORD_KEY, value: { ...RECORD, workflowIds: ['wf-done'] } }]);
    state.viewer = { id: 7, username: 'someone-else' };
    const setsBefore = storageSet.mock.calls.length;
    await user.click(await screen.findByRole('button', { name: /try again/i }));
    // Their own row arriving means the reload completed — true in every variant.
    await waitFor(() => expect(srcs()).toContain(OWN_IMAGE));

    // 🔴 THE POINT: viewer 2's record was not written under viewer 7...
    expect(storageSet.mock.calls.length).toBe(setsBefore);
    // ...and is not rendered to them either.
    expect(srcs()).not.toContain(FRESH_IMAGE);
    expect(screen.getAllByTestId('yt-history-row')).toHaveLength(1);
  });

  it('🔴 a read IN FLIGHT when the id changes renders NOTHING to the new viewer', async () => {
    /**
     * 🔴 RED AT 0a2cc97d, AND THIS IS THE HALF `historyOwnerRef`'s EFFECT CANNOT COVER.
     * That effect runs BETWEEN reads: it clears the unsaved map and blanks the list the
     * moment the id changes. A read that was ALREADY IN FLIGHT under the old id was
     * fenced by nothing at all — it resolved afterwards and ran
     * `setHistoryRecords((cur) => mergeUnsavedRecords(stored_OLD, [...held, ...cur]))`,
     * merging the PREVIOUS viewer's stored rows straight into the list the NEW viewer is
     * looking at. Measured at 0a2cc97d: `["VIEWER-SEVEN","VIEWER-TWO"]` on screen,
     * against `["VIEWER-TWO"]` for the same path at f4df1a38 — i.e. the carrying merge
     * this change introduced is what widened a blank-the-list guard into a disclosure.
     *
     * 🔴 AND IT IS STICKY, WHICH IS WHY THE SECOND RELOAD BELOW IS PART OF THE CASE. The
     * leaked row is in neither the new viewer's `stored` half nor the (cleared) unsaved
     * map, so the `...cur` arm re-carries it on EVERY subsequent reload — forever. At
     * f4df1a38 the non-functional setter dropped it on the next read.
     *
     * The existing swap case above asserts on `storageSet` call COUNT, which is the
     * WRITE side, and the write side was already safe (`held` is snapshotted after the
     * awaits, so the effect's `clear()` has already emptied it). This asserts on
     * RENDERED rows, which is where the leak is.
     *
     * The live workflow page is not viewer-scoped in this mock, deliberately: every
     * workflow is visible to both ids so that a leaked record RENDERS as an image rather
     * than as an `unavailable` row, which is what makes the leak observable at all.
     */
    const TWO_IMAGE = 'https://image.civitai.com/viewer-two.jpg';
    const SEVEN_IMAGE = 'https://image.civitai.com/viewer-seven.jpg';
    const SEVEN_B_IMAGE = 'https://image.civitai.com/viewer-seven-b.jpg';
    const wf = (id: string, url: string, at: string): AppWorkflow => ({
      workflowId: id,
      status: 'succeeded',
      images: [{ url, width: 1536, height: 864, nsfwLevel: 1 }],
      cost: 209,
      createdAt: at,
    });
    const rec = (batchId: string, at: string, workflowId: string) => {
      const createdAt = Date.parse(at);
      return {
        key: historyKey(createdAt, batchId),
        value: { ...RECORD, batchId, createdAt, workflowIds: [workflowId] },
      };
    };
    const V2 = rec('b-two', '2026-09-30T12:15:00.000Z', 'wf-two');
    const V7 = rec('b-seven', '2026-09-30T12:35:00.000Z', 'wf-seven');
    const V7B = rec('b-seven-b', '2026-09-30T12:50:00.000Z', 'wf-seven-b');
    const srcs = () => screen.getAllByTestId('yt-history-img').map((n) => n.getAttribute('src'));

    state.workflows = [
      wf('wf-two', TWO_IMAGE, '2026-09-30T12:10:00.000Z'),
      wf('wf-seven', SEVEN_IMAGE, '2026-09-30T12:30:00.000Z'),
      wf('wf-seven-b', SEVEN_B_IMAGE, '2026-09-30T12:45:00.000Z'),
    ];
    stockStorage([V2]);

    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);
    await waitFor(() => expect(srcs()).toContain(TWO_IMAGE));

    // Viewer 2 starts a reload that HANGS inside `get`, holding the read open across
    // the swap. That is the whole shape of the bug.
    let release = () => {};
    storageList.mockResolvedValue({ keys: [{ key: V2.key, updatedAt: new Date() }] });
    storageGet.mockImplementation(async (key: string) => {
      if (key === 'formats:custom:v1') return null;
      if (key === V2.key) return new Promise((resolve) => (release = () => resolve(V2.value)));
      if (key === V7.key) return V7.value;
      if (key === V7B.key) return V7B.value;
      return null;
    });
    const v2GetsBefore = storageGet.mock.calls.filter((c) => c[0] === V2.key).length;
    // Hide, then Show — the Show is the click that calls `loadHistory`, and it now hangs.
    await user.click(screen.getByTestId('yt-history-toggle'));
    await user.click(screen.getByTestId('yt-history-toggle'));
    await waitFor(() =>
      expect(storageGet.mock.calls.filter((c) => c[0] === V2.key).length).toBeGreaterThan(
        v2GetsBefore,
      ),
    );

    // A different person is now signed in, and storage answers with THEIR row. The
    // Hide/Show pair is just the render that picks the new id up (which runs the owner
    // effect, which runs the reload under viewer 7) plus the re-open to see it.
    storageList.mockResolvedValue({ keys: [{ key: V7.key, updatedAt: new Date() }] });
    state.viewer = { id: 7, username: 'someone-else' };
    await user.click(screen.getByTestId('yt-history-toggle'));
    await user.click(screen.getByTestId('yt-history-toggle'));
    await waitFor(() => expect(srcs()).toContain(SEVEN_IMAGE));
    expect(srcs()).not.toContain(TWO_IMAGE);

    // Now let viewer 2's read resolve, INTO viewer 7's surface.
    release();
    // 🔴 THE SYNC POINT, AND IT IS NOT A TIMER. Resolving that `get` queues only
    // microtasks — `Promise.all`, then the merge — and `waitFor` yields a macrotask, so
    // everything the resolving read does has happened by the time this returns. The
    // CONTROL for that claim is the base measurement: at 0a2cc97d `VIEWER-TWO` is on
    // screen at exactly this assertion, so the drain is demonstrably sufficient.
    await waitFor(() => expect(srcs()).toContain(SEVEN_IMAGE));
    // 🔴 THE POINT: viewer 2's rows are not rendered to viewer 7.
    expect(srcs()).not.toContain(TWO_IMAGE);
    expect(screen.getAllByTestId('yt-history-row')).toHaveLength(1);

    // ...and not on the next reload either. A row that got in once would be re-carried
    // by `...cur` forever; the new row is the variant-independent sync point.
    stockStorage([V7, V7B]);
    await user.click(screen.getByTestId('yt-history-toggle'));
    await user.click(screen.getByTestId('yt-history-toggle'));
    await waitFor(() => expect(srcs()).toContain(SEVEN_B_IMAGE));
    expect(srcs()).not.toContain(TWO_IMAGE);
    expect(screen.getAllByTestId('yt-history-row')).toHaveLength(2);
  });

  it("🔴 a read that FAILS after the id changed does not put an error over the new viewer's", async () => {
    /**
     * 🔴 RED AT 0a2cc97d, and the other half of the same unfenced `loadHistory`. The
     * `catch` was reached with no owner check at all, so a read that was in flight under
     * the old id and then REJECTED painted "Couldn't load your history" and a "Try
     * again" over the new viewer's own, fully successful load. Not a disclosure — a
     * false statement about someone else's storage, and a retry button that re-runs a
     * read that had already worked.
     *
     * The hang is on `list()` rather than a `get()` here on purpose: a per-key `get`
     * rejection is caught INSIDE the map and turns into a dropped row, so the outer
     * `catch` is only reachable through `list` (or a throw in the join below it).
     */
    const TWO_IMAGE = 'https://image.civitai.com/viewer-two.jpg';
    const SEVEN_IMAGE = 'https://image.civitai.com/viewer-seven.jpg';
    const wf = (id: string, url: string, at: string): AppWorkflow => ({
      workflowId: id,
      status: 'succeeded',
      images: [{ url, width: 1536, height: 864, nsfwLevel: 1 }],
      cost: 209,
      createdAt: at,
    });
    const rec = (batchId: string, at: string, workflowId: string) => {
      const createdAt = Date.parse(at);
      return {
        key: historyKey(createdAt, batchId),
        value: { ...RECORD, batchId, createdAt, workflowIds: [workflowId] },
      };
    };
    const V2 = rec('b-two', '2026-09-30T12:15:00.000Z', 'wf-two');
    const V7 = rec('b-seven', '2026-09-30T12:35:00.000Z', 'wf-seven');
    const srcs = () => screen.getAllByTestId('yt-history-img').map((n) => n.getAttribute('src'));

    state.workflows = [
      wf('wf-two', TWO_IMAGE, '2026-09-30T12:10:00.000Z'),
      wf('wf-seven', SEVEN_IMAGE, '2026-09-30T12:30:00.000Z'),
    ];
    stockStorage([V2]);

    const user = userEvent.setup();
    render(<App />);
    await openHistory(user);
    await waitFor(() => expect(srcs()).toContain(TWO_IMAGE));

    // Viewer 2 starts a reload whose `list()` hangs, and will later REJECT.
    let fail = () => {};
    const listsBefore = storageList.mock.calls.length;
    storageList.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (fail = () => reject(new Error('network hiccup')))),
    );
    await user.click(screen.getByTestId('yt-history-toggle'));
    await user.click(screen.getByTestId('yt-history-toggle'));
    await waitFor(() => expect(storageList.mock.calls.length).toBeGreaterThan(listsBefore));

    // A different person signs in and their own read SUCCEEDS.
    stockStorage([V7]);
    state.viewer = { id: 7, username: 'someone-else' };
    await user.click(screen.getByTestId('yt-history-toggle'));
    await user.click(screen.getByTestId('yt-history-toggle'));
    await waitFor(() => expect(srcs()).toContain(SEVEN_IMAGE));
    expect(screen.queryByTestId('yt-history-error')).not.toBeInTheDocument();

    // Now viewer 2's read fails, into viewer 7's surface. Same sync-point reasoning as
    // the case above: the rejection's continuation is a microtask and `waitFor` yields a
    // macrotask — and at 0a2cc97d the banner IS present at this assertion, which is the
    // control proving the drain is sufficient.
    fail();
    await waitFor(() => expect(srcs()).toContain(SEVEN_IMAGE));
    // 🔴 THE POINT: viewer 7's surface still reports the state of viewer 7's own read.
    expect(screen.queryByTestId('yt-history-error')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('🔴 a RELOAD IN FLIGHT does not blank rows it already has', async () => {
    /**
     * 🔴 RED AT c84f082: `state === 'loading'` was an unconditional early return
     * alongside a `loading` FLAG that had been correctly narrowed to
     * `entries.length === 0`. So EVERY reload — the Show toggle and the error
     * banner's Try again both call one — blanked the images for its duration.
     *
     * The `list()` call is left UNRESOLVED on purpose: that is what holds the app in
     * `historyState === 'loading'` for the assertions.
     *
     * 🔴 AND THERE *IS* SOMETHING POSITIVE TO ASSERT NOW. This docstring used to say
     * there was not — "the loading state is invisible when there are rows" — which was
     * a true description of a surface that gave a reload over an existing list NO
     * feedback at all, while three comment blocks and the README claimed a banner. The
     * banner exists; it is asserted here, alongside the absence of the full-panel
     * replacement. Those are the two halves of the rule and they are not the same
     * claim.
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
    // The full-panel replacement is NOT used while there are rows...
    expect(screen.queryByTestId('yt-history-loading')).not.toBeInTheDocument();
    // ...and the banner that reports the reload IS, so the list is not silently
    // presented as current while a read is outstanding.
    expect(screen.getByTestId('yt-history-reloading')).toBeInTheDocument();

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
