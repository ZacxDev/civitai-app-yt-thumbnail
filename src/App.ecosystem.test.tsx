import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

/**
 * A GATED ECOSYSTEM — the platform refusing the SELECTED checkpoint's base-model
 * family ("Validation failed: ecosystem: Ecosystem is currently unavailable").
 *
 * Feedback #190 (v0.2.0): the viewer saw
 *   "Generation failed — Clickbait: Validation failed: ecosystem: Ecosystem is currently unavailable"
 * "Clickbait" is only the default FORMAT (a prompt suffix); the ecosystem comes from
 * the checkpoint. At 0.2.0 a THROWN estimate was swallowed, so the click went on to
 * submit every format and printed the raw validation string once per format.
 *
 * 🔴 RED/GREEN: every App case below imports nothing new, so each is a REAL red at
 * the 0.2.0 commit (07ee091) — the raw string is on screen and/or submit is called,
 * and `pm-model-unavailable` does not exist. The one invariant guard (model stays
 * selected) is labelled as such.
 *
 * 🔴 EVERY hook App imports must appear in the `vi.mock` below (see
 * App.estimate.test.tsx for why).
 */

const estimateFn = vi.fn<(body: unknown) => Promise<BlockWorkflowSnapshot>>();
const submitFn = vi.fn<(body: unknown) => Promise<BlockWorkflowSnapshot>>();
const resourcePickerOpen = vi.fn();

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
  useBuzzWorkflow: () => ({ estimate: estimateFn, submit: submitFn, poll: vi.fn() }),
  useBuzzBalance: () => ({
    balance: { blue: 500_000, green: 0, yellow: 0 },
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useRequestConsent: () => ({ requestConsent: vi.fn() }),
  useRequestSignIn: () => ({ requestSignIn: vi.fn() }),
  useResourcePicker: () => ({ open: resourcePickerOpen }),
  useImageUpload: () => ({ open: vi.fn().mockResolvedValue(null) }),
  useSaveImage: () => ({ saveImage: vi.fn() }),
  useAppWorkflows: () => ({
    workflows: [],
    cursor: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
    cancel: vi.fn(),
  }),
}));

vi.mock('./app-storage.js', () => ({
  useKvStorage: () => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue({ ok: true }),
    delete: vi.fn().mockResolvedValue({ ok: true, deleted: true }),
    list: vi.fn().mockResolvedValue({ entries: [] }),
  }),
  useBoardStore: () => ({
    list: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue({ key: 'shared_1' }),
    vote: vi.fn().mockResolvedValue(1),
    unvote: vi.fn().mockResolvedValue(0),
    report: vi.fn().mockResolvedValue(undefined),
  }),
}));

const { App, ESTIMATE_DEBOUNCE_MS } = await import('./App.js');

/** The exact string the platform's generation graph throws (civitai blocks.router tests). */
const RAW = 'Validation failed: ecosystem: Ecosystem is currently unavailable';

/**
 * What `@civitai/blocks-react` throws: a generic `.message`, the server's reason on
 * `.snapshot.error` (see `submitErrorReason`).
 */
function refusal(reason: string): Error {
  return Object.assign(new Error('The workflow request was rejected.'), {
    snapshot: { workflowId: '', status: 'failed', error: reason },
  });
}

const ok = (total: number): BlockWorkflowSnapshot => ({
  workflowId: 'wf_ok',
  status: 'pending',
  cost: { total },
});

const OTHER_MODEL = {
  versionId: 691639,
  modelId: 618692,
  baseModel: 'Flux.1 D',
  modelName: 'FLUX.1 [dev]',
  versionName: 'dev',
};

/** No raw validation text anywhere on the page. */
function expectNoRawError() {
  expect(document.body.textContent ?? '').not.toMatch(/Validation failed/i);
}

beforeEach(() => {
  vi.clearAllMocks();
  submitFn.mockResolvedValue({ workflowId: 'wf_x', status: 'succeeded', cost: { total: 1 } });
  resourcePickerOpen.mockResolvedValue(null);
});

async function clickGenerate() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/prompt/i), 'a cat on a skateboard');
  await user.click(screen.getByTestId('pm-generate'));
  return user;
}

describe('a gated ecosystem on Generate', () => {
  it('🔴 a THROWN estimate refusal stops the click before ANY submit and explains it once', async () => {
    // Red at 0.2.0: the throw was swallowed, submit ran, and the raw string printed.
    estimateFn.mockRejectedValue(refusal(RAW));
    render(<App />);
    await clickGenerate();

    const note = await screen.findByTestId('pm-model-unavailable');
    // Names the model the viewer chose (the default checkpoint here)…
    expect(note).toHaveTextContent('ChatGPT Images (OpenAI)');
    // …says it is still selected and what to do.
    expect(note).toHaveTextContent(/still your selected model/i);
    expect(note).toHaveTextContent(/Change model/);
    expect(submitFn).not.toHaveBeenCalled();
    expectNoRawError();
    expect(screen.queryByTestId('pm-failed')).not.toBeInTheDocument();
  });

  it('🔴 a RETURNED estimate refusal is handled the same way', async () => {
    // Red at 0.2.0: the run went terminal 'failed' and pm-failed showed the raw string.
    estimateFn.mockResolvedValue({ workflowId: '', status: 'failed', error: RAW });
    render(<App />);
    await clickGenerate();

    expect(await screen.findByTestId('pm-model-unavailable')).toBeInTheDocument();
    expect(submitFn).not.toHaveBeenCalled();
    expectNoRawError();
  });

  it('🔴 a refusal at SUBMIT (gate closed after the estimate) is still never shown raw', async () => {
    estimateFn.mockResolvedValue(ok(209));
    submitFn.mockRejectedValue(refusal(RAW));
    render(<App />);
    await clickGenerate();

    await waitFor(() => expect(submitFn).toHaveBeenCalled());
    const note = await screen.findByTestId('pm-model-unavailable');
    expectNoRawError();
    // 🔴 Submits run in parallel, so a sibling format may already have been charged:
    // this path must not claim nothing was.
    expect(note).not.toHaveTextContent(/Nothing was charged/i);
    expect(document.body.textContent ?? '').not.toMatch(/Nothing was charged/i);
  });

  it("🔴 carries the gating rule's own copy through — the only part that says why", async () => {
    estimateFn.mockRejectedValue(
      refusal(`${RAW}. Restoring GPU capacity for this family, back within the hour.`),
    );
    render(<App />);
    await clickGenerate();

    expect(await screen.findByTestId('pm-model-unavailable')).toHaveTextContent(
      'Restoring GPU capacity for this family, back within the hour.',
    );
  });

  it('an unrelated estimate throw still does NOT block the submit (unchanged behaviour)', async () => {
    // Positive control for the two cases above: the throw-swallowing rule is kept
    // for every OTHER failure, so a zero submit count there means the gate fired.
    estimateFn.mockRejectedValue(refusal('upstream timeout'));
    render(<App />);
    await clickGenerate();

    await waitFor(() => expect(submitFn).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('pm-model-unavailable')).not.toBeInTheDocument();
  });
});

describe('a gated ecosystem in the live price preview', () => {
  it('🔴 withdraws the note once the SAME model prices again (the gate reopened)', async () => {
    estimateFn.mockRejectedValue(refusal(RAW));
    render(<App />);
    await screen.findByTestId('pm-model-unavailable', undefined, {
      timeout: ESTIMATE_DEBOUNCE_MS * 10,
    });

    // The operator reopens the family; any input change re-runs the preview for the
    // same checkpoint, and it now prices.
    estimateFn.mockResolvedValue(ok(287));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('yt-format-cinematic'));
    await waitFor(() => expect(screen.queryByTestId('pm-model-unavailable')).not.toBeInTheDocument(), {
      timeout: ESTIMATE_DEBOUNCE_MS * 10,
    });
    // Same model all along — the note went because the gate did, not because the pick changed.
    expect(screen.getByTestId('pm-model-label')).toHaveTextContent('ChatGPT Images (OpenAI)');
  });

  it('🔴 warns next to the model BEFORE any click, keeps the model selected, and retires on a new pick', async () => {
    estimateFn.mockRejectedValue(refusal(RAW));
    render(<App />);

    const note = await screen.findByTestId('pm-model-unavailable', undefined, {
      timeout: ESTIMATE_DEBOUNCE_MS * 10,
    });
    expect(note).toHaveTextContent('ChatGPT Images (OpenAI)');
    expect(submitFn).not.toHaveBeenCalled();

    // INVARIANT GUARD (never failed at 0.2.0 — nothing changed the selection then
    // either): the app does not swap the model for one the viewer did not choose.
    expect(screen.getByTestId('pm-model-label')).toHaveTextContent('ChatGPT Images (OpenAI)');

    // The viewer picks another model, which prices fine: the note is about the OLD
    // model, so it must go.
    estimateFn.mockResolvedValue(ok(287));
    resourcePickerOpen.mockResolvedValue(OTHER_MODEL);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('pm-change-model'));
    await waitFor(() =>
      expect(screen.getByTestId('pm-model-label')).toHaveTextContent('FLUX.1 [dev] — dev'),
    );
    expect(screen.queryByTestId('pm-model-unavailable')).not.toBeInTheDocument();
  });
});
