import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

import { BUILTIN_FORMATS, CUSTOM_FORMATS_KEY } from './formats.js';

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
    await user.click(await screen.findByTestId(`yt-format-${CINEMATIC.id}`));
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
    await user.click(await screen.findByTestId(`yt-format-${CINEMATIC.id}`));
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
    const spent = screen.getByTestId('pm-spent');
    expect(spent).toHaveTextContent(/spent\s*7\s*buzz/i);
    expect(spent).not.toHaveTextContent(/spent\s*6\s*buzz/i);
    expect(spent).not.toHaveTextContent(/spent\s*10\s*buzz/i);
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
    await user.click(await screen.findByTestId(`yt-format-${CINEMATIC.id}`));
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
    await user.click(await screen.findByTestId(`yt-format-${CINEMATIC.id}`));
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

describe('the format selection invariant', () => {
  it('🔴 will not let the viewer deselect the last format', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Clickbait is the lone default selection; its control is disabled so the
    // click cannot produce a zero-workflow Generate.
    const only = await screen.findByTestId(`yt-format-${CLICKBAIT.id}`);
    expect(only).toBeDisabled();

    // Select a second -> the first becomes deselectable again.
    await user.click(screen.getByTestId(`yt-format-${CINEMATIC.id}`));
    await waitFor(() => expect(screen.getByTestId(`yt-format-${CLICKBAIT.id}`)).toBeEnabled());
  });
});

// ---------------------------------------------------------------------------

describe('private custom formats (useAppStorage)', () => {
  it('reads the viewer’s formats from the versioned key on mount', async () => {
    storageGet.mockResolvedValue([{ id: 'custom:1', label: 'Noir', suffix: 'hard shadows' }]);
    render(<App />);
    await waitFor(() => expect(storageGet).toHaveBeenCalledWith(CUSTOM_FORMATS_KEY));
    expect(await screen.findByTestId('yt-format-custom:1')).toHaveTextContent('Noir');
  });

  it('🔴 writes the whole list back under the same key, in the round-trippable shape', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('yt-format-new'));
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
    await user.click(await screen.findByTestId('yt-format-new'));
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
    await user.click(await screen.findByTestId('yt-format-new'));
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
    expect(screen.getByTestId('yt-format-new')).toBeDisabled();
    // Nothing is even attempted against storage for an anonymous viewer.
    expect(storageGet).not.toHaveBeenCalled();
    // The built-ins are still usable — the app is not bricked for them.
    expect(screen.getByTestId(`yt-format-${CLICKBAIT.id}`)).toBeInTheDocument();
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
    await user.click(await screen.findByTestId('yt-format-publish-custom:9'));

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
    await user.click(await screen.findByTestId('yt-board-toggle'));

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
    await user.click(await screen.findByTestId('yt-board-toggle'));

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
    await user.click(await screen.findByTestId('yt-board-toggle'));
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
    await user.click(await screen.findByTestId('yt-board-toggle'));
    const voteBtn = await screen.findByTestId('yt-published-vote-shared_10');
    expect(voteBtn).toHaveTextContent(/voted/i);

    await user.click(voteBtn);
    // Clicking an already-voted row UNVOTES; `vote` must NOT be called.
    expect(sharedVote).not.toHaveBeenCalled();
  });
});
