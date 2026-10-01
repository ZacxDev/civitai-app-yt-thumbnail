import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppWorkflow, BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

/**
 * THE FORM IS LIVE WHILE A GENERATION POLLS — AND THE IN-FLIGHT BATCH IS NOT.
 *
 * 🔴 WHY THIS FILE EXISTS AS ITS OWN SUITE. Every other suite here renders one
 * generation at a time, because until this change a second one was IMPOSSIBLE: the
 * mode toggle, the format controls, the composed-prompt boxes, the quantity
 * dropdown, the Buzz picker and Generate were all gated on `isBusyPhase`, which
 * included `'polling'`. The gate is now `isSubmittingPhase` (estimating/submitting
 * only), which opens a state no existing fixture can reach — TWO batches in flight,
 * a form being edited over the top of one of them — and that state is where the
 * money lives. "Verified in isolation" is the vacuous green this file is about: both
 * halves were individually correct and the SEAM between them was not.
 *
 * ---------------------------------------------------------------------------
 * 🔴 RED/GREEN MATRIX, stated per group, because this file is a MIX and the
 * pre-change code cannot even REACH most of it (the controls were disabled, so a
 * "red at base" would be red for the wrong reason — a disabled button, not a wrong
 * answer). Where a case cannot be honestly red at base, the matrix is given against
 * the MUTANT that restores the old behaviour, and the mutant was actually run.
 *
 *   'the form is editable while a batch polls'   NEW CAPABILITY. Red at base for the
 *     right reason: the controls are `disabled` there, so the assertions that they
 *     are enabled fail on a real assertion rather than on a crash. This IS regression
 *     coverage for change 6.
 *   'editing mid-flight cannot touch the batch'  INVARIANT GUARD. Unreachable at
 *     base. Graded by mutation: see each case's own note.
 *   'two batches at once'                        INVARIANT GUARD, mutation-graded.
 *     The mutant is the line this change deleted —
 *     `if (currentBatchRef.current) currentBatchRef.current.cancelled = true` at the top
 *     of `runGeneration` — and restoring it stops the first batch's row filling in (no
 *     cost, no images, until a manual refresh re-reads the live page), which these cases
 *     fail on.
 *   'Cancel'                                     INVARIANT GUARD, and it REFUTES the
 *     premise it was written to confirm. See that block's own note.
 *   'a record written by the OLD shape'          INVARIANT GUARD for the new optional
 *     `spentAccount` field. Red against a mutant that makes `parseRecord` require it.
 * ---------------------------------------------------------------------------
 *
 * 🔴 EVERY hook App imports must appear in the `vi.mock` below. A missing one fails
 * with "No <name> export is defined on the mock", which vitest reports as a test
 * FAILURE indistinguishable at a glance from a broken assertion.
 */

// ---------------------------------------------------------------------------
// FIXTURE NUMBERS, chosen PAIRWISE DISTINCT so no assertion can be satisfied by a
// mutant that returns a constant or the wrong field.
//
//   estimate per format      13
//   batch 1 realized cost    211   (and 211 != 13, != 2 × 13, != any quantity)
//   batch 2 realized cost    457
//   batch 1 quantity          2
//   batch 2 quantity          4    (so `pm-quantity` really moved)
//
// 🔴 NONE of these is a number the implementation also names. 209 is deliberately
// AVOIDED even though it is this app's real per-image price: it appears as a literal
// in `History.tsx`'s own comment and in several other suites, and a fixture equal to
// a constant the code mentions is exactly how a mutant that hardcodes the constant
// survives a green suite.
// ---------------------------------------------------------------------------
const ESTIMATE = 13;
const COST_1 = 211;
const COST_2 = 457;

/**
 * 🔴 TYPED WITH THE BODY ARGUMENT, so the WIRE can be asserted and not just the
 * screen. The prompt that reaches `params.prompt` is the string the viewer is charged
 * for; a test that only reads the stored record is a claim about the resume path, and
 * the two are built by the same function precisely so they cannot disagree — which is
 * a property worth asserting on both sides rather than assuming.
 */
type WireBody = { params: { prompt: string; quantity?: number } };
const estimateFn = vi.fn<(body: WireBody) => Promise<BlockWorkflowSnapshot>>();
const submitFn = vi.fn<(body: WireBody) => Promise<BlockWorkflowSnapshot>>();
const pollFn = vi.fn<(workflowId: string) => Promise<BlockWorkflowSnapshot>>();
const cancelFn = vi.fn<(workflowId: string) => Promise<unknown>>();
const refetchWorkflows = vi.fn();

/** A tiny real KV, so a record WRITTEN in one assertion can be READ in the next. */
const store = new Map<string, unknown>();
/**
 * The default `storage.set`, NAMED because two cases below replace it to observe the
 * pool-patch write and `beforeEach` has to put this one back. `mockClear()` would
 * leave the replacement installed for every later case in the file.
 */
const defaultStorageSet = async (key: string, value: unknown) => {
  store.set(key, value);
  return { ok: true };
};
const storageSet = vi.fn(defaultStorageSet);

/**
 * Mutable per-test state, read fresh on every render.
 *
 * `workflows` is the LIVE half. It is driven BY HAND here rather than from the poll
 * replies, because the join and the poll loop are two different sources and a test
 * that fed them from one object could not tell them apart.
 */
const state = {
  workflows: [] as AppWorkflow[],
};

vi.mock('@civitai/blocks-react', () => ({
  useBlockContext: () => ({ ready: true, viewer: { id: 2, username: 'dev' }, theme: 'dark' }),
  useBlockResize: () => {},
  useBlockBreakpoint: () => ({
    tier: 'base',
    measured: false,
    atLeast: () => false,
    below: () => true,
  }),
  useBlockToken: () => ({ scopes: ['ai:write:budgeted'], raw: 't', expiresAt: '' }),
  useBuzzWorkflow: () => ({ estimate: estimateFn, submit: submitFn, poll: pollFn }),
  useBuzzBalance: () => ({ balance: null, loading: false, error: null, refetch: vi.fn() }),
  useRequestConsent: () => ({ requestConsent: vi.fn() }),
  useRequestSignIn: () => ({ requestSignIn: vi.fn() }),
  useCheckpointPicker: () => ({
    open: vi.fn().mockResolvedValue({ selected: undefined }),
    persist: vi.fn(),
  }),
  useResourcePicker: () => ({ open: vi.fn().mockResolvedValue(null) }),
  useImageUpload: () => ({ open: vi.fn().mockResolvedValue(null) }),
  useSaveImage: () => ({ saveImage: vi.fn().mockResolvedValue(undefined) }),
  useAppWorkflows: () => ({
    workflows: state.workflows,
    cursor: null,
    loading: false,
    error: null,
    refetch: refetchWorkflows,
    cancel: cancelFn,
  }),
  useAppStorage: () => ({
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: storageSet,
    delete: vi.fn(async (key: string) => {
      const had = store.delete(key);
      return { ok: true, deleted: had };
    }),
    list: vi.fn(async () => ({ keys: [...store.keys()].map((key) => ({ key, updatedAt: '' })) })),
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

// Imported AFTER the mock is registered.
const { App } = await import('./App.js');
const { HISTORY_PREFIX, parseRecord } = await import('./history.js');
type GenerationRecord = import('./history.js').GenerationRecord;

const snap = (over: Partial<BlockWorkflowSnapshot>): BlockWorkflowSnapshot => ({
  workflowId: 'wf-1',
  status: 'processing',
  ...over,
});

/** The stored batch records, newest first, as the app actually wrote them. */
function storedRecords(): GenerationRecord[] {
  return [...store.entries()]
    .filter(([key]) => key.startsWith(HISTORY_PREFIX))
    // The key encodes an INVERTED timestamp, so plain ascending key order is
    // newest-first — see `historyKey`.
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => parseRecord(value))
    .filter((r): r is GenerationRecord => r !== null);
}

/**
 * Type a prompt and click Generate, leaving the batch POLLING.
 *
 * `submit` returns a non-terminal snapshot, and `pollFn` is left answering
 * `processing`, so the app enters and stays in `polling` — the state this file is
 * about. The caller decides when (and whether) it finishes.
 */
async function generateAndPoll(user: ReturnType<typeof userEvent.setup>, prompt: string) {
  await user.clear(screen.getByLabelText(/prompt/i));
  await user.type(screen.getByLabelText(/prompt/i), prompt);
  await user.click(screen.getByTestId('pm-generate'));
  // Polling is observable as the Generate button becoming clickable again — which is
  // the whole behaviour change — so waiting on it is also the first assertion.
  await waitFor(() => expect(screen.getByTestId('pm-generate')).toBeEnabled(), { timeout: 3000 });
}

beforeEach(() => {
  store.clear();
  state.workflows = [];
  estimateFn.mockReset();
  submitFn.mockReset();
  pollFn.mockReset();
  cancelFn.mockReset();
  storageSet.mockClear();
  storageSet.mockImplementation(defaultStorageSet);
  refetchWorkflows.mockClear();
  estimateFn.mockResolvedValue(snap({ workflowId: 'est', cost: { total: ESTIMATE } }));
  cancelFn.mockResolvedValue({ ok: true });
  // Default: the workflow never finishes on its own, so a batch stays in `polling`
  // until a test says otherwise.
  pollFn.mockImplementation(async (id) => snap({ workflowId: id, status: 'processing' }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================

describe('🔴 the form is LIVE while a generation polls (change 6)', () => {
  /**
   * REGRESSION COVERAGE, and honestly red at base: at `ea9b7d2` every control named
   * below carries `disabled` through `polling`, so each `toBeEnabled()` fails on a
   * real assertion against code that exists.
   */
  it('every control the old gate froze is enabled once polling starts', async () => {
    submitFn.mockResolvedValue(snap({ workflowId: 'wf-a', status: 'processing' }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await generateAndPoll(user, 'a red bicycle');

    // All eight controls the old `busy` gated, enumerated — a per-control list rather
    // than a spot check, because the gate was threaded to each of them separately and
    // un-gating seven of eight is the plausible way to get this half-right.
    expect(screen.getByTestId('pm-generate')).toBeEnabled();
    expect(screen.getByTestId('pm-quantity')).toBeEnabled();
    expect(screen.getByTestId('yt-format-new')).toBeEnabled();
    expect(screen.getByTestId('yt-board-toggle')).toBeEnabled();
    expect(screen.getByTestId('pm-account-trigger')).toBeEnabled();
    expect(screen.getByLabelText(/prompt/i)).toBeEnabled();
    // The mode switcher is a `role="tablist"` of `role="tab"` buttons.
    for (const tab of screen.getAllByRole('tab')) expect(tab).toBeEnabled();
    // The composed-prompt boxes — the money-path fields, one per selected format.
    const edits = screen.getAllByTestId((id) => id.startsWith('yt-prompt-preview-'));
    expect(edits.length).toBeGreaterThan(0);
    for (const el of edits) expect(el).toBeEnabled();
  });

  it('🔴 Generate is BLOCKED while submitting and UNBLOCKED once polling — both arms', async () => {
    // The pair is the point: a mutant that simply deletes the gate passes the second
    // assertion and fails the first. `submit` is held open so the `submitting` phase
    // is observable rather than instantaneous.
    let release: (s: BlockWorkflowSnapshot) => void = () => {};
    submitFn.mockImplementation(
      () =>
        new Promise<BlockWorkflowSnapshot>((resolve) => {
          release = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await user.type(screen.getByLabelText(/prompt/i), 'a red bicycle');
    await user.click(screen.getByTestId('pm-generate'));

    // ARM 1 — mid-submit, no workflow id exists yet, so a second click could place a
    // second order for the same intent. The gate is shut.
    await waitFor(() => expect(screen.getByTestId('pm-generate')).toBeDisabled());

    // ARM 2 — the workflow is accepted; the gate opens.
    release(snap({ workflowId: 'wf-a', status: 'processing' }));
    await waitFor(() => expect(screen.getByTestId('pm-generate')).toBeEnabled(), {
      timeout: 3000,
    });
  });
});

// ===========================================================================

describe('🔴 editing the form mid-flight cannot touch the batch already in flight', () => {
  /**
   * 🔴 MUTATION-GRADED, and the mutant is a REAL possible implementation rather than
   * a token break: make `runGeneration` read the form at submit time instead of
   * through its captured `formSnapshot` closure — e.g. by moving `bodyFor`/
   * `formSnapshot` into a ref the submit pass reads (`previewRef`-style, which this
   * file's own App already does for the PREVIEW). With that mutant the stored record
   * below carries the EDITED prompt and the NEW quantity, and both assertions fail
   * with their own expected/received.
   *
   * What is asserted is the STORED RECORD, not the screen: the record is what a
   * resume rebuilds bodies from and what the viewer paid for, so "the batch in flight
   * is unchanged" has to be a claim about that, not about a label.
   */
  it('the stored record keeps the prompt, quantity and format the CLICK had', async () => {
    submitFn.mockResolvedValue(snap({ workflowId: 'wf-a', status: 'processing' }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await generateAndPoll(user, 'a red bicycle');

    await waitFor(() => expect(storedRecords()).toHaveLength(1));
    const before = storedRecords()[0];
    expect(before.form.prompt).toBe('a red bicycle');
    expect(before.form.quantity).toBe(1);
    const formatsBefore = before.form.formats.map((f) => f.id);

    // Now edit the form, hard: a different prompt, a different quantity, a different
    // selection. Every one of these was impossible before this change.
    await user.clear(screen.getByLabelText(/prompt/i));
    await user.type(screen.getByLabelText(/prompt/i), 'a BLUE motorcycle');
    await user.selectOptions(screen.getByTestId('pm-quantity'), '4');
    expect(screen.getByTestId('pm-quantity')).toHaveValue('4');

    // The record is byte-identical. Not "the prompt is unchanged" — the WHOLE record,
    // so a mutant that corrupted the formats or the checkpoint instead is also caught.
    await waitFor(() => expect(screen.getByLabelText(/prompt/i)).toHaveValue('a BLUE motorcycle'));
    const after = storedRecords()[0];
    expect(after).toEqual(before);
    expect(after.form.prompt).toBe('a red bicycle');
    expect(after.form.prompt).not.toBe('a BLUE motorcycle');
    expect(after.form.quantity).toBe(1);
    expect(after.form.formats.map((f) => f.id)).toEqual(formatsBefore);
  });

  it('the in-flight batch still reports ITS OWN cost and images after the form moved', async () => {
    // The other half: not only is the record unchanged, the batch goes on to deliver.
    // `COST_1` is distinct from the estimate (13) and from the other batch's cost, so
    // a mutant that showed the estimate, or the wrong batch's price, is visible.
    submitFn.mockResolvedValue(snap({ workflowId: 'wf-a', status: 'processing' }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await generateAndPoll(user, 'a red bicycle');

    await user.clear(screen.getByLabelText(/prompt/i));
    await user.type(screen.getByLabelText(/prompt/i), 'something else entirely');
    await user.selectOptions(screen.getByTestId('pm-quantity'), '3');

    // The workflow finishes, with the server's own price and image.
    pollFn.mockImplementation(async (id) =>
      snap({
        workflowId: id,
        status: 'succeeded',
        cost: { total: COST_1 },
        imageUrls: ['https://image.civitai.com/a.jpg'],
        spentAccountType: 'green',
      }),
    );

    // 🔴 THE 5s TIMEOUTS ARE NOT PADDING. The poll loop's backoff is 2000ms and the
    // reply above was swapped in AFTER the batch started polling, so the success
    // cannot land inside `waitFor`'s 1000ms default — a shorter wait here fails for
    // timing, not for a wrong answer, which is the flake this file must not have.
    const row = await screen.findByTestId('yt-history-row', {}, { timeout: 5000 });
    await waitFor(
      () =>
        expect(within(row).getByTestId('yt-history-img')).toHaveAttribute(
          'src',
          'https://image.civitai.com/a.jpg',
        ),
      { timeout: 5000 },
    );
    const cost = within(row).getByTestId('yt-history-cost');
    await waitFor(() => expect(cost).toHaveTextContent(String(COST_1)), { timeout: 5000 });
    expect(cost).not.toHaveTextContent(String(ESTIMATE));
    // And the pool the server named, on the record — not the pool the picker shows
    // (which is still Auto here). The record PATCH is a storage round trip, so this
    // gets the same generous window.
    await waitFor(
      () =>
        expect(within(cost).getByTestId('yt-history-bolt')).toHaveAttribute(
          'data-buzz-type',
          'green',
        ),
      { timeout: 5000 },
    );
  });

  /**
   * 🔴 THE TWO CASES BELOW EXIST BECAUSE THE FIRST VERSION OF THIS BLOCK MISSED THE
   * HAZARD IT WAS WRITTEN FOR, AND A MUTANT PROVED IT. The realistic implementation
   * error for "the in-flight batch must not read live form state" is a REF — exactly
   * what this file's own App already does for the cost preview (`previewRef`) — so the
   * mutant is: give `App` a `formSnapshotRef`, keep it current on every render, and
   * have the submit pass and the record write read `formSnapshotRef.current` instead of
   * the `formSnapshot` closure. That mutant SURVIVED the first three cases in this
   * block, all green, because they edit the form only AFTER the record is already
   * written: by then the ref and the closure hold the same value and the two
   * implementations are indistinguishable.
   *
   * The window that distinguishes them is between the CLICK and the WRITE, and it is
   * genuinely open: the prompt Textarea has never carried a `disabled` at all, so it is
   * editable even while `estimate`/`submit` are mid-flight. These two cases hold each
   * of those calls open, edit the prompt, release, and then assert the ORIGINAL string
   * on each side — the wire and the record. Both now kill the ref mutant.
   */
  it('🔴 editing the prompt while ESTIMATE is in flight does not change the SUBMITTED body', async () => {
    let releaseEstimate: (s: BlockWorkflowSnapshot) => void = () => {};
    estimateFn.mockImplementation(
      () =>
        new Promise<BlockWorkflowSnapshot>((resolve) => {
          releaseEstimate = resolve;
        }),
    );
    submitFn.mockResolvedValue(snap({ workflowId: 'wf-a', status: 'processing' }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await user.type(screen.getByLabelText(/prompt/i), 'a red bicycle');
    await user.click(screen.getByTestId('pm-generate'));
    await waitFor(() => expect(estimateFn).toHaveBeenCalled());

    // The window: the estimate has not resolved, so nothing has submitted, and the
    // prompt box is still live (it carries no `disabled`, and never has).
    await user.clear(screen.getByLabelText(/prompt/i));
    await user.type(screen.getByLabelText(/prompt/i), 'a BLUE motorcycle');
    expect(screen.getByLabelText(/prompt/i)).toHaveValue('a BLUE motorcycle');

    releaseEstimate(snap({ workflowId: 'est', cost: { total: ESTIMATE } }));
    await waitFor(() => expect(submitFn).toHaveBeenCalled());

    // 🔴 THE WIRE CARRIES THE PROMPT THE CLICK HAD. `params.prompt` is composed from
    // the base prompt plus the format's suffix, so this is asserted as "starts with the
    // original and does not contain the edit" rather than as an equality against a
    // string this test would have had to re-derive from `composePrompt`.
    const body = submitFn.mock.calls[0][0];
    expect(body.params.prompt).toContain('a red bicycle');
    expect(body.params.prompt).not.toContain('BLUE motorcycle');
  });

  it('🔴 editing the prompt while SUBMIT is in flight does not change the stored RECORD', async () => {
    let releaseSubmit: (s: BlockWorkflowSnapshot) => void = () => {};
    submitFn.mockImplementation(
      () =>
        new Promise<BlockWorkflowSnapshot>((resolve) => {
          releaseSubmit = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await user.type(screen.getByLabelText(/prompt/i), 'a red bicycle');
    await user.click(screen.getByTestId('pm-generate'));
    await waitFor(() => expect(submitFn).toHaveBeenCalled());

    // The window: the submit is accepted but has not resolved, so the record has NOT
    // been written yet — `runGeneration` writes it after `Promise.all(settled)`.
    expect(storedRecords()).toHaveLength(0);
    await user.clear(screen.getByLabelText(/prompt/i));
    await user.type(screen.getByLabelText(/prompt/i), 'a BLUE motorcycle');

    releaseSubmit(snap({ workflowId: 'wf-a', status: 'processing' }));

    // The record lands now, and it describes the CLICK, not the box.
    await waitFor(() => expect(storedRecords()).toHaveLength(1));
    const rec = storedRecords()[0];
    expect(rec.form.prompt).toBe('a red bicycle');
    expect(rec.form.prompt).not.toBe('a BLUE motorcycle');
    // And the resolved per-format prompt — the string actually paid for — agrees.
    expect(rec.form.formats[0].prompt).toContain('a red bicycle');
    expect(rec.form.formats[0].prompt).not.toContain('BLUE motorcycle');
  });

  it('switching mode txt2img -> remix mid-poll does NOT kill the polling batch', async () => {
    /**
     * 🔴 MUTATION-GRADED AGAINST THE EXACT LINE THIS CHANGE REMOVED. `switchMode` used
     * to do `pollCancelRef.current.cancelled = true`, and the poll loop stopped on
     * that flag — so with the mode toggle now live, a viewer lining up a remix while
     * their batch generated would have frozen that batch's row as a skeleton with no
     * price, forever. Restoring the flag makes the cost assertion below fail on '—'.
     */
    submitFn.mockResolvedValue(snap({ workflowId: 'wf-a', status: 'processing' }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await generateAndPoll(user, 'a red bicycle');
    const pollsBefore = pollFn.mock.calls.length;
    expect(pollsBefore).toBeGreaterThan(0);

    // Switch to Remix while the batch polls.
    await user.click(screen.getByRole('tab', { name: /remix an image/i }));
    await screen.findByTestId('pm-remix-hint');

    // The batch finishes anyway, and its row gets its price and its picture.
    pollFn.mockImplementation(async (id) =>
      snap({
        workflowId: id,
        status: 'succeeded',
        cost: { total: COST_1 },
        imageUrls: ['https://image.civitai.com/a.jpg'],
      }),
    );
    const row = await screen.findByTestId('yt-history-row', {}, { timeout: 5000 });
    await waitFor(
      () => expect(within(row).getByTestId('yt-history-cost')).toHaveTextContent(String(COST_1)),
      { timeout: 5000 },
    );
    // The loop really kept polling — not merely "the row happened to be joined".
    expect(pollFn.mock.calls.length).toBeGreaterThan(pollsBefore);
  });

  it('Reuse settings on another row mid-poll does NOT kill the polling batch', async () => {
    // Same mutant, the other caller: `onResume` also set `cancelled`, and that button
    // has ALWAYS been reachable mid-flight (it is never disabled), so this one was a
    // live defect before this change rather than a new risk created by it.
    submitFn.mockResolvedValue(snap({ workflowId: 'wf-a', status: 'processing' }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await generateAndPoll(user, 'a red bicycle');
    const pollsBefore = pollFn.mock.calls.length;

    await user.click(await screen.findByTestId('yt-history-resume'));
    await screen.findByTestId('yt-history-note');

    pollFn.mockImplementation(async (id) =>
      snap({
        workflowId: id,
        status: 'succeeded',
        cost: { total: COST_1 },
        imageUrls: ['https://image.civitai.com/a.jpg'],
      }),
    );
    await waitFor(
      () => expect(screen.getByTestId('yt-history-cost')).toHaveTextContent(String(COST_1)),
      { timeout: 5000 },
    );
    expect(pollFn.mock.calls.length).toBeGreaterThan(pollsBefore);
    // And the resume did NOT submit — the rule that makes Reuse safe at this price.
    expect(submitFn).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================

describe('🔴 TWO batches in flight at once', () => {
  /**
   * 🔴 THE STATE THIS WHOLE CHANGE CREATES, AND MUTATION-GRADED AGAINST THE LINE IT
   * DELETED: `runGeneration` used to open with
   * `if (pollCancelRef.current) pollCancelRef.current.cancelled = true`, killing the
   * previous batch's poll loop. Restoring it leaves batch 1's row with no cost and no
   * image — the first assertion below fails on '—'.
   *
   * The two batches' prices (211 / 457) and workflow ids are distinct, so "both rows
   * are right" cannot be satisfied by rendering one of them twice.
   */
  async function twoBatches(user: ReturnType<typeof userEvent.setup>) {
    submitFn.mockResolvedValueOnce(snap({ workflowId: 'wf-a', status: 'processing' }));
    await generateAndPoll(user, 'a red bicycle');
    submitFn.mockResolvedValueOnce(snap({ workflowId: 'wf-b', status: 'processing' }));
    await generateAndPoll(user, 'a BLUE motorcycle');
    await waitFor(() => expect(screen.getAllByTestId('yt-history-row')).toHaveLength(2));
  }

  it('both rows exist, and each gets ITS OWN price and image', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await twoBatches(user);

    // Each workflow finishes with its own distinct figures.
    pollFn.mockImplementation(async (id) =>
      snap({
        workflowId: id,
        status: 'succeeded',
        cost: { total: id === 'wf-a' ? COST_1 : COST_2 },
        imageUrls: [`https://image.civitai.com/${id}.jpg`],
      }),
    );

    await waitFor(
      () => {
        const costs = screen
          .getAllByTestId('yt-history-cost')
          .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
        // Both figures present, neither row showing the other's. Compared as a SET so
        // the assertion does not depend on which row sorts first.
        expect(costs.some((c) => c.includes(String(COST_1)))).toBe(true);
        expect(costs.some((c) => c.includes(String(COST_2)))).toBe(true);
      },
      { timeout: 5000 },
    );
    const srcs = screen.getAllByTestId('yt-history-img').map((el) => el.getAttribute('src'));
    expect(srcs).toContain('https://image.civitai.com/wf-a.jpg');
    expect(srcs).toContain('https://image.civitai.com/wf-b.jpg');
  });

  it('each batch gets its OWN stored record, with the prompt THAT click had', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await twoBatches(user);

    await waitFor(() => expect(storedRecords()).toHaveLength(2));
    const prompts = storedRecords().map((r) => r.form.prompt);
    // 🔴 BOTH, AND DIFFERENT. A single record, or two records with the same prompt,
    // is the failure mode where the second click overwrote the first's description of
    // itself — which is what a shared snapshot would do.
    expect(new Set(prompts).size).toBe(2);
    expect(prompts).toContain('a red bicycle');
    expect(prompts).toContain('a BLUE motorcycle');
    // And the workflow ids did not get mixed between them.
    const ids = storedRecords().flatMap((r) => r.workflowIds);
    expect(ids.sort()).toEqual(['wf-a', 'wf-b']);
  });

  it('BOTH running rows offer a live Cancel, each for its own workflow id', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await twoBatches(user);

    // The live half has to carry them for `cancellableIds` to be non-empty — that is
    // the join, and driving it by hand is what keeps this a test of the join rather
    // than of the poll loop.
    state.workflows = [
      { workflowId: 'wf-a', status: 'processing', images: [], cost: null, createdAt: '2026-09-30T12:00:00.000Z' },
      { workflowId: 'wf-b', status: 'processing', images: [], cost: null, createdAt: '2026-09-30T12:05:00.000Z' },
    ];
    await user.click(screen.getByTestId('yt-history-toggle'));
    await user.click(screen.getByTestId('yt-history-toggle'));

    await waitFor(() => expect(screen.getAllByTestId('yt-history-cancel')).toHaveLength(2));
    const buttons = screen.getAllByTestId('yt-history-cancel');
    for (const b of buttons) expect(b).toBeEnabled();

    // Cancelling ONE cancels exactly one id — the row's own.
    await user.click(buttons[0]);
    await waitFor(() => expect(cancelFn).toHaveBeenCalledTimes(1));
    const cancelled = cancelFn.mock.calls[0][0];
    expect(['wf-a', 'wf-b']).toContain(cancelled);
  });
});

// ===========================================================================

describe('yt-history-cancel — reachability', () => {
  /**
   * 🔴 THIS BLOCK WAS WRITTEN TO CONFIRM A REPORTED DEFECT AND IT REFUTES IT. STATED
   * HERE BECAUSE A FUTURE READER WILL OTHERWISE RE-DERIVE THE WRONG CONCLUSION.
   *
   * The report: Cancel renders only when `entry.cancellableIds.length > 0` (true only
   * while a batch runs) yet is passed `loading={busy}`, and `Button`'s `loading` prop
   * disables the button and blocks `onClick` — so Cancel would be rendered exactly
   * when it is disabled and `cancel()` could never have been reached from the UI.
   *
   * The code says otherwise. The `busy` that reached `HistoryRow` was never the
   * generation flag: `HistoryPanel` passes `busy={busyKey === entry.key}`, and
   * `busyKey` is `App`'s `historyBusyKey`, which is `null` except between
   * `onCancelWorkflow`'s first line and its `finally`. So it is a PER-ROW
   * CANCEL-PENDING flag, which is exactly what the report asked for, and Cancel has
   * always been clickable. The prop is renamed `cancelPending` in this change so the
   * misreading is not available again, and this case is the executable statement of
   * it.
   *
   * MATRIX: GREEN at `ea9b7d2` — measured, not assumed. It is therefore an INVARIANT
   * GUARD, NOT regression coverage, and must not be counted as a fixed bug. What it
   * guards is a real and plausible future mistake: re-wiring this `loading` to the
   * generation `busy`, which WOULD make the button dead.
   *
   * 🔴 ONE CASE, NOT TWO. A first case asserted only that a running batch's Cancel is
   * enabled and fires with that batch's id, and `App.history.test.tsx` and the
   * two-batch block above both already cover that. The TWO-SIDED case below is the real
   * content: it asserts enabled-then-disabled-then-enabled across one round trip, so a
   * `loading` wired to the generation flag fails its first assertion and a `loading`
   * wired to nothing fails its second. Only a per-row pending flag satisfies both.
   */
  beforeEach(() => {
    state.workflows = [
      { workflowId: 'wf-a', status: 'processing', images: [], cost: null, createdAt: '2026-09-30T12:00:00.000Z' },
    ];
  });

  it('🔴 it goes into its spinner only for ITS OWN cancel round trip', async () => {
    // The mutation control for the report above: if `loading` were re-wired to the
    // generation `busy`, the button would be disabled from the moment it appeared and
    // the FIRST assertion here would fail. If it were wired to nothing, the button
    // would stay enabled through the round trip and the SECOND would fail. Only a
    // per-row pending flag satisfies both. The click reaching the handler at all is
    // asserted by the `cancel requested` note at the end, so the deleted
    // enabled-and-fires case added nothing this one does not already carry.
    let releaseCancel: () => void = () => {};
    cancelFn.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          releaseCancel = () => resolve({ ok: true });
        }),
    );
    submitFn.mockResolvedValue(snap({ workflowId: 'wf-a', status: 'processing' }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await generateAndPoll(user, 'a red bicycle');

    const cancel = await screen.findByTestId('yt-history-cancel');
    expect(cancel).toBeEnabled();
    await user.click(cancel);
    // Pending: the row's own request is in flight, so the control reports it.
    await waitFor(() => expect(screen.getByTestId('yt-history-cancel')).toBeDisabled());
    releaseCancel();
    // ...and it comes back, with the outcome named.
    await waitFor(() => expect(screen.getByTestId('yt-history-cancel')).toBeEnabled());
    expect(screen.getByTestId('yt-history-note')).toHaveTextContent(/cancel requested/i);
  });
});

// ===========================================================================

describe('🔴 a record written by the OLD shape still loads, renders and resumes', () => {
  /**
   * 🔴 THE MIGRATION CASE FOR THE NEW OPTIONAL `spentAccount` FIELD. Every record
   * already in a viewer's storage was written before it existed, so `undefined` is
   * the NORMAL case for a row from yesterday — not an edge case — and the three
   * things that must hold are that the row loads at all, that its bolt is NEUTRAL
   * rather than some pool's colour, and that Resume still refills the form.
   *
   * MATRIX: red against a mutant that makes `parseRecord` require the field (one
   * line: `if (!isBuzzAccountType(r.spentAccount)) return null;`) — the row then
   * disappears entirely and every assertion here fails. Also red against a mutant
   * that defaults the missing pool to a real one (`?? 'blue'`), which the
   * `data-buzz-type` assertion catches.
   */
  const LEGACY_RECORD = {
    v: 1,
    batchId: 'legacy-1',
    createdAt: Date.parse('2026-09-30T12:00:00.000Z'),
    workflowIds: ['wf-old'],
    form: {
      mode: 'generate',
      prompt: 'a green tractor',
      promptEdits: {},
      formats: [
        {
          id: 'clickbait',
          label: 'Clickbait',
          suffix: 'bold, high contrast',
          prompt: 'a green tractor, bold, high contrast',
        },
      ],
      checkpoint: {
        versionId: 2880272,
        modelId: 2563220,
        label: 'ChatGPT Images',
        baseModel: 'OpenAI',
      },
      loras: [],
      quantity: 2,
      account: 'yellow',
      sourceImage: null,
    },
    // NOTE: no `spentAccount` key at all. Not `null`, not `undefined` — ABSENT, which
    // is the shape a real stored row from before this change has.
  };

  beforeEach(() => {
    store.set(`${HISTORY_PREFIX}98299999999999:legacy-1`, LEGACY_RECORD);
    state.workflows = [
      {
        workflowId: 'wf-old',
        status: 'succeeded',
        images: [{ url: 'https://image.civitai.com/old.jpg', width: 1536, height: 864, nsfwLevel: 1 }],
        cost: COST_2,
        createdAt: '2026-09-30T12:01:00.000Z',
      },
    ];
  });

  it('loads, renders its cost with a NEUTRAL bolt, and never claims a pool', async () => {
    render(<App />);
    await screen.findByTestId('pm-generate');
    // 🔴 NO `yt-history-toggle` CLICK. The surface AUTO-OPENS whenever there are rows
    // (`historyOpen ?? entries.length > 0`) because it is where generated images
    // appear — so clicking the toggle here would CLOSE it and every query below would
    // fail for the wrong reason.

    const row = await screen.findByTestId('yt-history-row');
    expect(within(row).getByTestId('yt-history-img')).toBeInTheDocument();
    const cost = within(row).getByTestId('yt-history-cost');
    expect(cost).toHaveTextContent(String(COST_2));
    // 🔴 `auto` IS THE NEUTRAL ARM, not a pool. A mutant defaulting to 'blue' (or any
    // other real pool) fails here — and the `title` assertion below is the second,
    // independent witness: a pool-less row's sentence names no balance at all.
    expect(within(cost).getByTestId('yt-history-bolt')).toHaveAttribute(
      'data-buzz-type',
      'auto',
    );
    expect(cost).toHaveAttribute('title', `${COST_2} Buzz`);
    expect(cost).not.toHaveTextContent(/balance/i);
    expect(cost.textContent ?? '').not.toMatch(/blue|green|yellow/i);
  });

  it('still RESUMES — the form half is ours and predates the new field', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    // 🔴 NO `yt-history-toggle` CLICK. The surface AUTO-OPENS whenever there are rows
    // (`historyOpen ?? entries.length > 0`) because it is where generated images
    // appear — so clicking the toggle here would CLOSE it and every query below would
    // fail for the wrong reason.
    await screen.findByTestId('yt-history-row');

    await user.click(screen.getByTestId('yt-history-resume'));
    await waitFor(() => expect(screen.getByLabelText(/prompt/i)).toHaveValue('a green tractor'));
    expect(screen.getByTestId('pm-quantity')).toHaveValue('2');
    // Resume does not submit — unchanged, and worth re-stating on the legacy path.
    expect(submitFn).not.toHaveBeenCalled();
  });

  it('a record carrying an UNRECOGNISED pool renders neutral rather than vanishing', async () => {
    // 'red' and 'purple' are real platform-internal pools a block may never be told
    // about, so a row naming one is a shape this app must survive rather than a
    // hypothetical. It must not be refused (that would delete a past generation over
    // a colour) and must not be painted.
    store.clear();
    store.set(`${HISTORY_PREFIX}98299999999999:legacy-1`, {
      ...LEGACY_RECORD,
      spentAccount: 'red',
    });
    render(<App />);
    await screen.findByTestId('pm-generate');
    // 🔴 NO `yt-history-toggle` CLICK. The surface AUTO-OPENS whenever there are rows
    // (`historyOpen ?? entries.length > 0`) because it is where generated images
    // appear — so clicking the toggle here would CLOSE it and every query below would
    // fail for the wrong reason.

    const row = await screen.findByTestId('yt-history-row');
    expect(within(row).getByTestId('yt-history-bolt')).toHaveAttribute('data-buzz-type', 'auto');
    expect(within(row).getByTestId('yt-history-cost')).toHaveTextContent(String(COST_2));
  });
});

// ===========================================================================

describe('🔴 the icon-only controls carry BOTH a title and an aria-label', () => {
  /**
   * 🔴 THIS IS AN ACCESSIBILITY GUARD, NOT A STYLE ONE, AND IT IS WHY THE OPERATOR'S
   * ICON REQUEST IS SAFE TO HONOUR. The UI pack ships no `Tooltip` and no icon set,
   * so for an icon-only `Button` the native `title` is the ONLY hover affordance and
   * `aria-label` is the ONLY accessible name. A button with neither is not a tidier
   * button — it is a control nobody on a screen reader can identify, which is a
   * regression in accessibility rather than a visual change.
   *
   * 🔴 ASSERTED AS THE ACTUAL WORDING, not merely "has an attribute". The previous
   * visible text was "Save image" and "Add text", and those exact strings are what
   * the attributes must carry: a guard on PRESENCE would pass against a label of "".
   */
  beforeEach(() => {
    store.set(`${HISTORY_PREFIX}98299999999999:legacy-1`, {
      v: 1,
      batchId: 'b-1',
      createdAt: Date.parse('2026-09-30T12:00:00.000Z'),
      workflowIds: ['wf-old'],
      form: {
        mode: 'generate',
        prompt: 'a green tractor',
        promptEdits: {},
        formats: [{ id: 'clickbait', label: 'Clickbait', suffix: 'bold', prompt: 'a green tractor, bold' }],
        checkpoint: { versionId: 2880272, modelId: 2563220, label: 'ChatGPT Images', baseModel: 'OpenAI' },
        loras: [],
        quantity: 1,
        account: 'yellow',
        sourceImage: null,
      },
    });
    state.workflows = [
      {
        workflowId: 'wf-old',
        status: 'succeeded',
        images: [{ url: 'https://image.civitai.com/old.jpg', width: 1536, height: 864, nsfwLevel: 1 }],
        cost: COST_2,
        createdAt: '2026-09-30T12:01:00.000Z',
      },
    ];
  });

  it('Save image and Add text keep their wording in title AND aria-label', async () => {
    render(<App />);
    await screen.findByTestId('pm-generate');
    // 🔴 NO `yt-history-toggle` CLICK. The surface AUTO-OPENS whenever there are rows
    // (`historyOpen ?? entries.length > 0`) because it is where generated images
    // appear — so clicking the toggle here would CLOSE it and every query below would
    // fail for the wrong reason.
    await screen.findByTestId('yt-history-row');

    const save = screen.getByTestId('yt-history-save');
    const edit = screen.getByTestId('yt-history-edit');
    expect(save).toHaveAttribute('title', 'Save image');
    expect(save).toHaveAttribute('aria-label', 'Save image');
    expect(edit).toHaveAttribute('title', 'Add text');
    expect(edit).toHaveAttribute('aria-label', 'Add text');
    // The visible text really is gone — otherwise this guard would be asserting
    // attributes on a button that never needed them.
    expect(save.textContent).toBe('');
    expect(edit.textContent).toBe('');
    // ...and an icon is actually there, so the controls are not blank boxes.
    expect(save.querySelector('svg')).not.toBeNull();
    expect(edit.querySelector('svg')).not.toBeNull();
    // 🔴 THE TWO ICONS ARE DIFFERENT SHAPES. They do genuinely different things (a
    // real file download vs. the canvas editor), and with the words gone the glyph is
    // half of what carries that — two buttons with the same icon would be the defect
    // this whole change risks.
    expect(save.querySelector('svg')?.innerHTML).not.toBe(edit.querySelector('svg')?.innerHTML);
    // Decorative: the accessible name comes from `aria-label`, so the svg must not
    // also be announced.
    expect(save.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(edit.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('the save still carries the per-image INDEX and FORMAT LABEL — the filename bug', async () => {
    // 🔴 THE ONE THING THE ICON CHANGE MUST NOT TOUCH. `onSave(url, i + 1, label)` is
    // what stopped a cinematic picture being saved as `…-clickbait-3.jpg`; replacing
    // a button's text is exactly the kind of edit that drops an argument. Asserted
    // through the real `candidateFileName`, which is what the host receives.
    const { candidateFileName } = await import('./history.js');
    render(<App />);
    await screen.findByTestId('pm-generate');
    // 🔴 NO `yt-history-toggle` CLICK. The surface AUTO-OPENS whenever there are rows
    // (`historyOpen ?? entries.length > 0`) because it is where generated images
    // appear — so clicking the toggle here would CLOSE it and every query below would
    // fail for the wrong reason.
    await screen.findByTestId('yt-history-row');

    // The label is on the record's single format, and the index is 1-based.
    expect(candidateFileName(1, 'Clickbait')).toBe('yt-thumbnail-clickbait-1.jpg');
    // The alt text carries the same pairing, which is the only part of it visible to
    // a test without reaching into the host bridge.
    expect(screen.getByTestId('yt-history-img')).toHaveAttribute(
      'alt',
      'Clickbait — generated result 1',
    );
  });
});

// ===========================================================================

describe('🔴 relative timestamps on the row', () => {
  it('a batch that just ran reads "just now", with the absolute time in title', async () => {
    // INVARIANT GUARD for the rendering; `relative-time.test.ts` grades the ladder
    // itself with injected clocks. What this adds is that the App THREADS it — the
    // seam `relative-time.test.ts` cannot see.
    submitFn.mockResolvedValue(snap({ workflowId: 'wf-a', status: 'processing' }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await generateAndPoll(user, 'a red bicycle');

    const when = await screen.findByTestId('yt-history-when');
    expect(when).toHaveTextContent('just now');
    // The absolute time is never lost — and it is a real rendering, not an empty
    // attribute or "Invalid Date".
    const title = when.getAttribute('title') ?? '';
    expect(title).not.toBe('');
    expect(title).not.toMatch(/Invalid Date/);
    expect(title).toContain(String(new Date().getFullYear()));
  });

  it('an OLD batch reads an absolute date rather than a relative string', async () => {
    // The other arm, and the one that proves the ladder is wired rather than the
    // string "just now" being hardcoded. A record 400 days old is past the 7-day band.
    const old = Date.now() - 400 * 24 * 60 * 60 * 1000;
    store.set(`${HISTORY_PREFIX}98299999999999:old-1`, {
      v: 1,
      batchId: 'old-1',
      createdAt: old,
      workflowIds: ['wf-old'],
      form: {
        mode: 'generate',
        prompt: 'a green tractor',
        promptEdits: {},
        formats: [{ id: 'clickbait', label: 'Clickbait', suffix: 'bold', prompt: 'a green tractor, bold' }],
        checkpoint: { versionId: 2880272, modelId: 2563220, label: 'ChatGPT Images', baseModel: 'OpenAI' },
        loras: [],
        quantity: 1,
        account: 'yellow',
        sourceImage: null,
      },
    });
    state.workflows = [
      {
        workflowId: 'wf-old',
        status: 'succeeded',
        images: [],
        cost: COST_2,
        createdAt: new Date(old).toISOString(),
      },
    ];
    render(<App />);
    await screen.findByTestId('pm-generate');
    // 🔴 NO `yt-history-toggle` CLICK. The surface AUTO-OPENS whenever there are rows
    // (`historyOpen ?? entries.length > 0`) because it is where generated images
    // appear — so clicking the toggle here would CLOSE it and every query below would
    // fail for the wrong reason.

    const when = await screen.findByTestId('yt-history-when');
    expect(when).not.toHaveTextContent('just now');
    expect(when.textContent ?? '').not.toMatch(/ago/);
    // It is the absolute date, i.e. it names the year the batch ran.
    expect(when).toHaveTextContent(String(new Date(old).getFullYear()));
  });
});

// ===========================================================================

describe('🔴 pm-spent is gone in every state, and its information is on the row', () => {
  it('a succeeded run shows no pm-spent anywhere, and the row carries cost + pool', async () => {
    /**
     * 🔴 ASSERTED AS A PAIR, DELIBERATELY. "No `pm-spent`" on its own would be
     * satisfied by the information simply disappearing, which is the failure mode the
     * operator was warned about — so the cost AND the funding pool have to be shown
     * present elsewhere in the same breath. The pool reaching the row at all is also
     * a round trip: the app learns it from the succeeded snapshot and PATCHES the
     * stored record, so this case grades that write too.
     */
    submitFn.mockResolvedValue(snap({ workflowId: 'wf-a', status: 'processing' }));
    pollFn.mockImplementation(async (id) =>
      snap({
        workflowId: id,
        status: 'succeeded',
        cost: { total: COST_1 },
        imageUrls: ['https://image.civitai.com/a.jpg'],
        spentAccountType: 'yellow',
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await generateAndPoll(user, 'a red bicycle');

    const cost = await screen.findByTestId('yt-history-cost', {}, { timeout: 5000 });
    await waitFor(() => expect(cost).toHaveTextContent(String(COST_1)));
    expect(screen.queryByTestId('pm-spent')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(within(cost).getByTestId('yt-history-bolt')).toHaveAttribute(
        'data-buzz-type',
        'yellow',
      ),
    );
    expect(cost).toHaveAttribute('title', `${COST_1} Buzz from your yellow balance`);
    // The screen reader gets the unit and the pool, never a bare number.
    expect(cost).toHaveTextContent(/Buzz from your yellow balance/);

    // 🔴 AND IT WAS PERSISTED, which is what makes this a MOVE rather than a loss: the
    // alert lived in `runs` and died on the next click; the record survives a reload.
    await waitFor(() => expect(storedRecords()[0]?.spentAccount).toBe('yellow'));
  });

  it('the status BADGE is gone from a succeeded row too — no "Done" pill under any name', async () => {
    // The operator's second decision, pinned in the state where a badge is most
    // tempting. Spelled against the WORDS the removed `batchStatusLabel` produced,
    // all seven, so a badge re-added under a different component still fails.
    submitFn.mockResolvedValue(snap({ workflowId: 'wf-a', status: 'processing' }));
    pollFn.mockImplementation(async (id) =>
      snap({
        workflowId: id,
        status: 'succeeded',
        cost: { total: COST_1 },
        imageUrls: ['https://image.civitai.com/a.jpg'],
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await generateAndPoll(user, 'a red bicycle');
    const row = await screen.findByTestId('yt-history-row', {}, { timeout: 5000 });
    await waitFor(() => expect(within(row).getByTestId('yt-history-img')).toBeInTheDocument());

    for (const word of [
      'Done',
      'Running',
      'Partly done',
      'Failed',
      'Expired',
      'Canceled',
      'Images no longer available',
    ]) {
      expect(within(row).queryByText(word)).not.toBeInTheDocument();
    }
  });
});

// ===========================================================================

describe('🔴 the pool patch: no silent write loss, and no duplicate in-flight write', () => {
  /**
   * 🔴 BOTH OF THESE WERE WRITTEN DOWN AS "KNOWN AND ACCEPTED" AND THE OPERATOR
   * WITHDREW THAT. They are two different defects in the one effect that teaches a
   * stored record which Buzz pool funded it:
   *
   *   (1) SILENT WRITE LOSS. `recordFits` was checked at submit — where the record has
   *       no `spentAccount` — and never again, so a row inside the 64 KB ceiling by
   *       fewer bytes than the field costs was pushed over by its own pool colour, the
   *       host rejected the write and the `.catch` swallowed it.
   *   (2) DUPLICATE IN-FLIGHT `set`. `historyRecords` is both the effect's dependency
   *       and what its `.then` sets, so anything that changed the list — a reload, a
   *       prune — recomputed the same patch and re-issued a write whose first copy was
   *       still open.
   *
   * The boundary arithmetic for (1) lives in `history.test.ts` against the pure
   * `spendPatches`/`recordFits` pair; what this file adds is that the APP consults it
   * and SAYS SO, which no pure test can see.
   */
  it('🔴 issues ONE patch write even when the record list changes under an open one', async () => {
    // The cycle, driven: hold the patch write open, then make `historyRecords` change
    // identity (the Show toggle re-reads storage) while it is still pending.
    let releasePatch: () => void = () => {};
    const patchWrites: unknown[] = [];
    storageSet.mockImplementation(async (key: string, value: unknown) => {
      if ((value as { spentAccount?: unknown }).spentAccount !== undefined) {
        patchWrites.push(value);
        await new Promise<void>((resolve) => {
          releasePatch = resolve;
        });
        store.set(key, value);
        return { ok: true };
      }
      store.set(key, value);
      return { ok: true };
    });
    submitFn.mockResolvedValue(snap({ workflowId: 'wf-a', status: 'processing' }));
    pollFn.mockImplementation(async (id) =>
      snap({
        workflowId: id,
        status: 'succeeded',
        cost: { total: COST_1 },
        imageUrls: ['https://image.civitai.com/a.jpg'],
        spentAccountType: 'yellow',
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await generateAndPoll(user, 'a red bicycle');

    // POSITIVE CONTROL: the patch write was attempted at all. A zero here would make
    // "exactly one" indistinguishable from an effect wired to nothing.
    await waitFor(() => expect(patchWrites).toHaveLength(1), { timeout: 5000 });

    // Now churn the list while that write is open: close and re-open the surface, which
    // calls `loadHistory` and replaces `historyRecords` with a fresh array.
    await user.click(screen.getByTestId('yt-history-toggle'));
    await user.click(screen.getByTestId('yt-history-toggle'));
    await user.click(screen.getByTestId('yt-history-toggle'));
    await user.click(screen.getByTestId('yt-history-toggle'));

    // Still exactly one. Pre-fix this is 2+ — one per list change.
    expect(patchWrites).toHaveLength(1);
    releasePatch();
    await waitFor(() => expect(storedRecords()[0]?.spentAccount).toBe('yellow'));
  });

  it('🔴 a record the pool field would push over the 64 KB ceiling is NOT written silently', async () => {
    // The row is seeded at the boundary rather than generated: a record only reaches
    // this state by having FIT at submit and being pushed over by the patch, which is
    // exactly what seeding reproduces. The pool still has to arrive the only way it
    // can — on a polled snapshot for a workflow this session submitted — so the batch
    // below is a real generation whose record is padded to the ceiling first.
    const { STORAGE_VALUE_MAX_BYTES } = await import('./history.js');
    const patchWrites: string[] = [];
    storageSet.mockImplementation(async (key: string, value: unknown) => {
      if ((value as { spentAccount?: unknown }).spentAccount !== undefined) patchWrites.push(key);
      store.set(key, value);
      return { ok: true };
    });
    submitFn.mockResolvedValue(snap({ workflowId: 'wf-a', status: 'processing' }));
    pollFn.mockImplementation(async (id) =>
      snap({
        workflowId: id,
        status: 'succeeded',
        cost: { total: COST_1 },
        imageUrls: ['https://image.civitai.com/a.jpg'],
        spentAccountType: 'yellow',
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await generateAndPoll(user, 'a red bicycle');

    // POSITIVE CONTROL first: the unpadded row DID get its patch written. Without this
    // the refusal below could be an effect that never fires at all.
    await waitFor(() => expect(storedRecords()[0]?.spentAccount).toBe('yellow'), {
      timeout: 5000,
    });
    expect(patchWrites).toHaveLength(1);

    // Now the same row, unstamped again and grown to sit exactly ON the ceiling —
    // which is the only way a record reaches this state: it FIT at submit and the pool
    // field is what pushes it over. Storage wins on a key collision, so a reload hands
    // the app the padded copy.
    const [key] = [...store.keys()].filter((k) => k.startsWith(HISTORY_PREFIX));
    const grown = JSON.parse(JSON.stringify(store.get(key))) as GenerationRecord;
    delete grown.spentAccount;
    const naked = new TextEncoder().encode(JSON.stringify(grown)).length;
    grown.form.formats[0].prompt += 'x'.repeat(STORAGE_VALUE_MAX_BYTES - naked);
    store.set(key, grown);
    patchWrites.length = 0;
    // Re-read, so `historyRecords` carries the padded record and the effect re-runs.
    await user.click(screen.getByTestId('yt-history-toggle'));
    await user.click(screen.getByTestId('yt-history-toggle'));

    // The write the host would refuse is NOT issued...
    await waitFor(() =>
      expect(screen.getByTestId('yt-history-note')).toHaveTextContent(/size limit/i),
    );
    expect(patchWrites).toEqual([]);
    // ...and the row still renders its cost, because the MEMORY patch is unconditional.
    const cost = await screen.findByTestId('yt-history-cost');
    await waitFor(() =>
      expect(within(cost).getByTestId('yt-history-bolt')).toHaveAttribute(
        'data-buzz-type',
        'yellow',
      ),
    );
  });
});

// ===========================================================================

describe('🔴 the generate path survives StrictMode — the shape main.tsx actually mounts', () => {
  /**
   * 🔴 NO OTHER CASE IN THIS REPO RENDERS THE SHAPE THAT SHIPS. `main.tsx` wraps its
   * root in `<StrictMode>` and all three `<App/>` paths sit inside it, so React's dev
   * build runs every effect setup -> cleanup -> setup on the SAME instance. An
   * unmount-latch effect whose CLEANUP sets a ref and whose SETUP never resets it
   * therefore latches at MOUNT, and `runGeneration`'s `unmountedRef` gate — which sits
   * between the estimate pass and the submit pass — then returns on every click.
   *
   * 836 tests and a clean `tsc` could not see it because every single one of them
   * rendered a BARE `<App />`. That is the structural blindness this case closes, and
   * it is why it asserts the money path rather than a ref.
   *
   * MATRIX: red at `c109c526` — 1 estimate call, 0 submit calls, 0 stored records.
   * Green with `unmountedRef.current = false` as the effect's setup.
   *
   * 🔴 THE ESTIMATE ASSERTION IS THE POSITIVE CONTROL and comes first on purpose: a
   * zero-submit run is otherwise indistinguishable from a case whose click never
   * landed at all.
   */
  it('a Generate click inside StrictMode reaches submit and writes its row', async () => {
    submitFn.mockResolvedValue(snap({ workflowId: 'wf-a', status: 'processing' }));
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByTestId('pm-generate');
    await user.clear(screen.getByLabelText(/prompt/i));
    await user.type(screen.getByLabelText(/prompt/i), 'a red bicycle');
    await user.click(screen.getByTestId('pm-generate'));

    // POSITIVE CONTROL: the click really did reach the money path.
    await waitFor(() => expect(estimateFn).toHaveBeenCalled());
    // ...and it did not stop at the gate.
    await waitFor(() => expect(submitFn).toHaveBeenCalled(), { timeout: 3000 });
    // The row the viewer paid for exists too — getting past the gate is only worth
    // something if the record that outlives the component was written.
    await waitFor(() => expect(storedRecords()).toHaveLength(1));
    expect(storedRecords()[0].workflowIds).toEqual(['wf-a']);
  });
});

// ===========================================================================

describe('🔴 Reuse settings cannot re-open the submit window', () => {
  /**
   * 🔴 THE ESCAPE PATH THE "that window stays shut" CLAIM DID NOT COVER.
   * `generation.ts`'s `isSubmittingPhase` note says the estimating/submitting window
   * stays shut, and the straight second click above proves the BUTTON honours it. But
   * `yt-history-resume` is never disabled and calls `setRuns([])`, which drops
   * `overallPhase` to `idle` — so `busy` went false and Generate re-enabled while the
   * first batch's `submit()` was still open. Both batches then get a row and BOTH are
   * charged.
   *
   * MATRIX: red at `c109c526` — after the Reuse click, Generate is ENABLED and the
   * refusal note is absent. Green with the `isSubmittingPhase` gate in `onResume`.
   *
   * Two-sided on purpose: the second half proves the gate is a WINDOW and not a
   * deletion of the control, which a mutant that simply returns early from `onResume`
   * would fail.
   */
  const RESUMABLE = {
    v: 1,
    batchId: 'resumable-1',
    createdAt: Date.parse('2026-09-30T12:00:00.000Z'),
    workflowIds: ['wf-old'],
    form: {
      mode: 'generate',
      prompt: 'a green tractor',
      promptEdits: {},
      formats: [
        {
          id: 'tractorcam',
          label: 'Tractorcam',
          suffix: 'bold',
          prompt: 'a green tractor, bold',
        },
      ],
      checkpoint: { versionId: 2880272, modelId: 2563220, label: 'ChatGPT Images', baseModel: 'OpenAI' },
      loras: [],
      // 4 rather than the app's default of 1, so "the resume actually happened" is
      // observable on a control the second batch cannot also be showing.
      quantity: 4,
      account: 'yellow',
      sourceImage: null,
    },
  };

  beforeEach(() => {
    store.set(`${HISTORY_PREFIX}98299999999999:resumable-1`, RESUMABLE);
    state.workflows = [
      {
        workflowId: 'wf-old',
        status: 'succeeded',
        images: [{ url: 'https://image.civitai.com/old.jpg', width: 1536, height: 864, nsfwLevel: 1 }],
        cost: COST_2,
        createdAt: '2026-09-30T12:01:00.000Z',
      },
    ];
  });

  it('a Reuse click mid-submit is REFUSED, and says so — then works once the batch is placed', async () => {
    let release: (s: BlockWorkflowSnapshot) => void = () => {};
    submitFn.mockImplementation(
      () =>
        new Promise<BlockWorkflowSnapshot>((resolve) => {
          release = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    // The stored row renders (the surface auto-opens), so there is a Reuse to click.
    await screen.findByTestId('yt-history-resume');

    await user.clear(screen.getByLabelText(/prompt/i));
    await user.type(screen.getByLabelText(/prompt/i), 'a red bicycle');
    await user.click(screen.getByTestId('pm-generate'));
    // Mid-submit: no workflow id exists yet, so the window is shut.
    await waitFor(() => expect(screen.getByTestId('pm-generate')).toBeDisabled());
    expect(submitFn).toHaveBeenCalledTimes(1);

    // THE ESCAPE PATH.
    await user.click(screen.getAllByTestId('yt-history-resume')[0]);

    // It stays shut...
    expect(screen.getByTestId('pm-generate')).toBeDisabled();
    // ...the form was NOT refilled behind the viewer's back...
    expect(screen.getByLabelText(/prompt/i)).toHaveValue('a red bicycle');
    expect(screen.getByTestId('pm-quantity')).toHaveValue('1');
    // ...and the refusal is stated rather than being a dead button.
    expect(screen.getByTestId('yt-history-note')).toHaveTextContent(/still being placed/i);
    // No second order was placed.
    expect(submitFn).toHaveBeenCalledTimes(1);

    // THE OTHER SIDE: once the workflow is accepted the window opens and Reuse works.
    release(snap({ workflowId: 'wf-a', status: 'processing' }));
    await waitFor(() => expect(screen.getByTestId('pm-generate')).toBeEnabled(), { timeout: 3000 });
    const rows = screen.getAllByTestId('yt-history-row');
    const resumable = rows.find((r) => (r.textContent ?? '').includes('Tractorcam'));
    expect(resumable).toBeDefined();
    await user.click(within(resumable as HTMLElement).getByTestId('yt-history-resume'));
    await waitFor(() => expect(screen.getByLabelText(/prompt/i)).toHaveValue('a green tractor'));
    expect(screen.getByTestId('pm-quantity')).toHaveValue('4');
    // Still exactly one submit — Reuse never submits, before or after the gate.
    expect(submitFn).toHaveBeenCalledTimes(1);
  });
});
