import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

/**
 * THE LIVE COST PREVIEW — the price on the Generate button and in the Buzz picker
 * BEFORE any Buzz is at stake.
 *
 * 🔴 EVERY CASE HERE ASSERTS A CALL COUNT OR A CALL ORDER, not just a rendered
 * number, because the defects this feature can have are all invisible on screen:
 * an estimate that fires on every keystroke looks identical to one that fires on a
 * change; a slow response overwriting a newer one shows a number that is simply
 * WRONG rather than missing; and a preview that fires for a viewer who has not
 * consented does not show an error, it shows nothing — while 403ing the backend.
 *
 * 🔴 RED/GREEN: `estimateSignature` and `ESTIMATE_DEBOUNCE_MS` do not exist at
 * `04ca5aa` and App.tsx there has no preview at all, so this whole file fails to
 * import at base. That is a VACUOUS red and is labelled as such — it proves the
 * feature is new, not that any assertion bites. The NON-vacuous reds for this batch
 * are named in the PR: the second-run regression in App.formats.test.tsx, the
 * LoRA-clear case in picker.test.tsx, and the ready-and-empty case in
 * App.historyvis.test.tsx — each a real assertion failure against a file that
 * exists at base. What every case below is worth is stated in its own comment.
 *
 * 🔴 EVERY hook App imports must appear in the `vi.mock` below. A missing one fails
 * with "No <name> export is defined on the mock", which vitest reports as a test
 * FAILURE indistinguishable at a glance from a broken assertion.
 */

const estimateFn = vi.fn<(body: unknown) => Promise<BlockWorkflowSnapshot>>();
const submitFn = vi.fn<(body: unknown) => Promise<BlockWorkflowSnapshot>>();
const requestConsent = vi.fn();
const resourcePickerOpen = vi.fn();

/** Mutable per-test hook state, read fresh on every render by the factories below. */
const state = {
  scopes: ['ai:write:budgeted'] as string[],
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
  useBlockToken: () => ({ scopes: state.scopes, raw: 't', expiresAt: '' }),
  useBuzzWorkflow: () => ({ estimate: estimateFn, submit: submitFn, poll: vi.fn() }),
  useBuzzBalance: () => ({
    balance: { blue: 500_000, green: 0, yellow: 0 },
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useRequestConsent: () => ({ requestConsent }),
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
  useAppStorage: () => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue({ ok: true }),
    delete: vi.fn().mockResolvedValue({ ok: true, deleted: true }),
    list: vi.fn().mockResolvedValue({ keys: [] }),
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

const { App, ESTIMATE_DEBOUNCE_MS } = await import('./App.js');
const { BUILTIN_FORMATS } = await import('./formats.js');

const CINEMATIC = BUILTIN_FORMATS[1];
const GAMING = BUILTIN_FORMATS[5];

/**
 * Fixture prices, chosen so no assertion can pass by arithmetic accident.
 *
 * 🔴 PAIRWISE DISTINCT, AND DISTINCT FROM EVERY OTHER NUMBER THESE CASES NAME —
 * including the quantity values (1..4) and each other's sums and multiples. A
 * fixture that can only ever produce a constant the assertion also names cannot see
 * a mutant that hardcodes that constant, so it SURVIVES a fully green run.
 * 209/287 are the app's two real measured ChatGPT Images prices; the rest are picked
 * for separation. 641 is prime, so no pair below multiplies or sums to it.
 */
const PRICE = { mount: 137, first: 209, second: 641, third: 287 } as const;

const priced = (total: number): BlockWorkflowSnapshot => ({
  workflowId: 'wf_estimate',
  status: 'pending',
  cost: { total },
});

/** The Buzz figure a control is publishing, or `null` when it publishes none. */
function priceShown(el: HTMLElement): string | null {
  return el.textContent?.match(/(\d[\d,]*)\s*Buzz/)?.[1] ?? null;
}

/** Wait until the Generate button publishes `total`, i.e. the preview has landed. */
async function untilPriced(total: number) {
  await waitFor(
    () => expect(priceShown(screen.getByTestId('pm-generate'))).toBe(String(total)),
    { timeout: 3000 },
  );
}

const CHECKPOINT_PICK = {
  versionId: 691639,
  modelId: 618692,
  baseModel: 'Flux.1 D',
  modelName: 'FLUX.1 [dev]',
  versionName: 'dev',
};
const LORA_PICK = {
  versionId: 135867,
  modelId: 122359,
  baseModel: 'Flux.1 D',
  modelName: 'Detail Tweaker',
  versionName: 'v1',
};

beforeEach(() => {
  vi.clearAllMocks();
  state.scopes = ['ai:write:budgeted'];
  estimateFn.mockResolvedValue(priced(PRICE.mount));
  submitFn.mockResolvedValue(priced(PRICE.mount));
  resourcePickerOpen.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------

describe('the live estimate — when it fires', () => {
  it('🔴 prices the form ON MOUNT, with no click and nothing typed', async () => {
    /**
     * The headline behaviour. Before this the price only existed after a Generate
     * click had already committed the viewer to spending — "estimate first, then
     * submit" was true of the code and invisible to the user.
     */
    render(<App />);
    await untilPriced(PRICE.mount);
    // ONE request: one format is selected by default (the at-least-one invariant).
    expect(estimateFn).toHaveBeenCalledTimes(1);
    // Nothing was submitted. A preview that spends is not a preview.
    expect(submitFn).not.toHaveBeenCalled();
  });

  it('🔴 does NOT fire without the budgeted scope, and does NOT ask for consent', async () => {
    /**
     * 🔴 THE MOST IMPORTANT CASE IN THIS FILE, and it is a pair rather than a zero.
     * `estimate()` 403s with "block lacks ai:write:budgeted scope" on an unconsented
     * token (measured against the live backend 2026-09-28), so a preview that ignores
     * the scope hammers the backend with rejections and shows the viewer nothing. And
     * prompting for consent on LOAD so a price can be shown is the thing this app
     * deliberately refuses to do: the scope authorises SPENDING.
     *
     * 🔴 THE POSITIVE CONTROL IS IN THIS SAME CASE. A reassuring 0 is
     * indistinguishable from a harness wired to nothing, so the scope is granted at
     * the end and the SAME counter is watched to move.
     */
    state.scopes = [];
    const { rerender } = render(<App />);
    await screen.findByTestId('pm-generate');

    // Well past the debounce, so this is "never" and not "not yet".
    await new Promise((r) => setTimeout(r, ESTIMATE_DEBOUNCE_MS * 4));
    expect(estimateFn).not.toHaveBeenCalled();
    expect(requestConsent).not.toHaveBeenCalled();
    // ...and the button is unpriced, exactly as it was before this feature.
    expect(priceShown(screen.getByTestId('pm-generate'))).toBeNull();

    // POSITIVE CONTROL: grant the scope (what a TOKEN_REFRESH does) and the same
    // counter moves. Without this the zero above proves nothing about the wiring.
    state.scopes = ['ai:write:budgeted'];
    rerender(<App />);
    await untilPriced(PRICE.mount);
    expect(estimateFn).toHaveBeenCalledTimes(1);
    // Still no consent prompt — the grant came from the host, not from us asking.
    expect(requestConsent).not.toHaveBeenCalled();
  });

  it('🔴 quantity is PINNED at 1 — the priced body carries no quantity', async () => {
    // The images-per-format selector is hidden (operator, 2026-10-18) and one
    // image per format is the only quantity there is. `buildWorkflowBody`
    // emits `params.quantity` only when > 1, so the pin reads as ABSENCE on
    // every priced body — and the control itself is not in the DOM.
    render(<App />);
    await untilPriced(PRICE.mount);
    expect(screen.queryByTestId('pm-quantity')).not.toBeInTheDocument();
    const body = estimateFn.mock.calls.at(-1)?.[0] as { params: { quantity?: number } };
    expect(body.params.quantity).toBeUndefined();
  });

  it('🔴 re-prices on a FORMAT change, and asks once PER selected format', async () => {
    /**
     * Formats multiply the request count and therefore the bill, which is why they
     * are in the price signature at all. The count is the assertion: a preview that
     * re-priced only the first format would show a number that is a fraction of the
     * real total on a money control.
     */
    const user = userEvent.setup();
    render(<App />);
    await untilPriced(PRICE.mount);
    estimateFn.mockClear();

    estimateFn.mockResolvedValue(priced(PRICE.first));
    // 🔴 VISIBLE BEFORE CLICKED. This file stubs no block width, so jsdom reports
    // `clientWidth: 0`, the tier is `base` and the app renders its TABBED layout — two
    // `display: none` panels. For one revision the format picker was in the UNSELECTED one,
    // and this click still succeeded (`userEvent` gates on `pointer-events`, not on
    // visibility) against a control no viewer could press. The app now defaults to the
    // Formats tab while Thumbnails is empty; this line is what checks that rather than
    // assuming it, so a change that re-hides the picker fails here.
    const card = screen.getByTestId(`yt-format-${CINEMATIC.id}`);
    expect(card, 'the format checkbox is in a hidden tab panel').toBeVisible();
    await user.click(card);

    // 2 formats x PRICE.first — the SUM, from the same `aggregateEstimate` the
    // in-flight run uses.
    await untilPriced(PRICE.first * 2);
    expect(estimateFn).toHaveBeenCalledTimes(2);
  });

  it('🔴 re-prices on a CHECKPOINT change and on a LoRA change', async () => {
    /**
     * Both are in the signature because both change what the orchestrator is asked to
     * run — the 11× spread between SD XL 1.0 (3 Buzz) and FLUX.1 [dev] (33) is the
     * measured reason a model swap may not leave a stale price on the button.
     */
    const user = userEvent.setup();
    render(<App />);
    await untilPriced(PRICE.mount);
    estimateFn.mockClear();

    // Checkpoint -> Flux (a family that HAS LoRAs, so the LoRA half is reachable).
    resourcePickerOpen.mockResolvedValue(CHECKPOINT_PICK);
    estimateFn.mockResolvedValue(priced(PRICE.first));
    await user.click(screen.getByTestId('pm-change-model'));
    await untilPriced(PRICE.first);
    expect(estimateFn).toHaveBeenCalledTimes(1);

    // LoRA added -> priced again, with the LoRA on the body.
    resourcePickerOpen.mockResolvedValue(LORA_PICK);
    estimateFn.mockResolvedValue(priced(PRICE.second));
    await user.click(await screen.findByTestId('pm-lora-add'));
    await untilPriced(PRICE.second);
    expect(estimateFn).toHaveBeenCalledTimes(2);
    const body = estimateFn.mock.calls.at(-1)?.[0] as {
      additionalResources?: Array<{ modelVersionId: number }>;
    };
    expect(body.additionalResources?.map((r) => r.modelVersionId)).toContain(
      LORA_PICK.versionId,
    );

    // A LoRA WEIGHT change re-prices too — a weight rides on the body, so a stale
    // price after moving it would be quoting a request nobody is making.
    estimateFn.mockResolvedValue(priced(PRICE.third));
    const weight = screen.getByTestId('pm-lora-weight') as HTMLInputElement;
    // `fireEvent.change`, not a raw `dispatchEvent` after setting `.value`: assigning
    // to a React-controlled input's `value` does not notify React, so the raw version
    // fires a handler that reads the OLD value — the weight never moves, the signature
    // never changes, and the case fails on a stale price. (Measured: it did.)
    await act(async () => {
      fireEvent.change(weight, { target: { value: '0.6' } });
    });
    expect(weight.value).toBe('0.6');
    await untilPriced(PRICE.third);
    expect(estimateFn).toHaveBeenCalledTimes(3);
  });

  it('🔴 does NOT re-price on a PROMPT change — the prompt does not price anything', async () => {
    /**
     * The deliberate EXCLUSION from `estimateSignature`, pinned so it cannot be
     * "fixed" by adding the prompt. A prompt does not price a generation — the CLI's
     * own dry-run states the prompt is not even sent with the estimate — so including
     * it would fire one request per selected format per KEYSTROKE against someone
     * else's backend and learn nothing.
     *
     * 🔴 CARRIES ITS OWN POSITIVE CONTROL: a quantity change in the same case moves
     * the counter, so the zero cannot be "the preview stopped working".
     */
    const user = userEvent.setup();
    render(<App />);
    await untilPriced(PRICE.mount);
    estimateFn.mockClear();

    await user.type(screen.getByLabelText(/prompt/i), 'a serene mountain lake at golden hour');
    await new Promise((r) => setTimeout(r, ESTIMATE_DEBOUNCE_MS * 4));
    expect(estimateFn).not.toHaveBeenCalled();

    // POSITIVE CONTROL, same render, same counter: a FORMAT change re-prices.
    await user.click(screen.getByTestId(`yt-format-${CINEMATIC.id}`));
    await waitFor(() => expect(estimateFn).toHaveBeenCalled());
  });

  it('DEBOUNCES a burst of changes into ONE request', async () => {
    /**
     * BEHAVIOUR coverage, not regression: there is nothing to regress from. The claim
     * is a rate limit on someone else's backend — a LoRA weight slider fires an
     * `onChange` per pixel of travel.
     *
     * The burst is driven on the format cards now (the quantity dropdown this
     * used to drive is hidden; quantity is pinned at 1). Asserted as "fewer
     * than one preview pass per change" rather than an exact count: the final
     * pass prices 2 selected formats, so exactly 2 calls is the debounced
     * outcome and 5 changes would be 5 passes (8 calls) undebounced.
     */
    const user = userEvent.setup();
    render(<App />);
    await untilPriced(PRICE.mount);
    estimateFn.mockClear();
    estimateFn.mockResolvedValue(priced(PRICE.first));

    await user.click(screen.getByTestId(`yt-format-${CINEMATIC.id}`));
    await user.click(screen.getByTestId(`yt-format-${GAMING.id}`));
    await user.click(screen.getByTestId(`yt-format-${CINEMATIC.id}`));
    await user.click(screen.getByTestId(`yt-format-${GAMING.id}`));
    await user.click(screen.getByTestId(`yt-format-${CINEMATIC.id}`));

    await waitFor(() => expect(estimateFn).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, ESTIMATE_DEBOUNCE_MS * 4));
    expect(estimateFn.mock.calls.length).toBeLessThan(5);
    // And the price that landed is for the selection actually left standing:
    // Clickbait + Cinematic = 2 formats at PRICE.first each.
    await untilPriced(PRICE.first * 2);
  });
});

describe('the live estimate — no stale price survives a change', () => {
  it('🔴 DROPS the old price the moment an input changes, before the new one lands', async () => {
    /**
     * 🔴 A WRONG NUMBER IS WORSE THAN NO NUMBER ON A SPEND CONTROL. Between an input
     * change and the new estimate landing there is a window of at least
     * `ESTIMATE_DEBOUNCE_MS`; leaving the previous figure up during it means the button
     * states the cost of a generation the viewer has already stopped asking for. An
     * unpriced button is honest about not knowing.
     *
     * The in-flight request is deferred by hand so the window can be observed at all —
     * with a resolving mock the new price arrives too fast to see.
     */
    const user = userEvent.setup();
    render(<App />);
    await untilPriced(PRICE.mount);

    const resolvers: Array<(snap: BlockWorkflowSnapshot) => void> = [];
    estimateFn.mockImplementation(
      () => new Promise<BlockWorkflowSnapshot>((resolve) => resolvers.push(resolve)),
    );

    // Add a second format — two requests go out (one per format), both deferred.
    await user.click(screen.getByTestId(`yt-format-${CINEMATIC.id}`));

    // The OLD price is gone immediately — not after the request settles.
    await waitFor(() =>
      expect(priceShown(screen.getByTestId('pm-generate'))).toBeNull(),
    );
    // There is no second price surface to carry a stale figure either: the Buzz
    // picker that used to publish one is hidden (always Auto now).
    expect(screen.queryByTestId('pm-account-trigger-cost')).not.toBeInTheDocument();

    // POSITIVE CONTROL: the requests really are in flight and really do
    // repopulate, so the null above is a WINDOW and not a broken preview.
    await waitFor(() => expect(resolvers).toHaveLength(2));
    await act(async () => {
      resolvers[0](priced(PRICE.third));
      resolvers[1](priced(PRICE.third));
    });
    await untilPriced(PRICE.third * 2);
  });
});

describe('the live estimate — out-of-order responses', () => {
  it('🔴 a SLOW EARLIER response never overwrites a NEWER price', async () => {
    /**
     * 🔴 THE FAILURE MODE THE DEBOUNCE CANNOT COVER, and the reason `previewSeqRef`
     * exists as well. The debounce stops a request being SENT per keystroke; it does
     * nothing about two requests that are already in flight. N parallel `estimate()`
     * calls settle in whatever order the backend feels like, so without the sequence
     * guard a slow request for quantity 2 lands after a fast one for quantity 3 and
     * the button quotes the price of a generation the viewer is no longer asking for.
     *
     * Both in-flight requests are DEFERRED by hand — the only way to control settle
     * order — and each `waitFor` on the deferred count is what proves the earlier
     * request was genuinely SENT rather than cancelled by the debounce. Without those
     * waits this case would pass trivially by never producing two in-flight requests.
     *
     * Costs are pairwise distinct and distinct from every constant named here, so a
     * mutant that hardcodes any one of them dies.
     */
    const user = userEvent.setup();
    render(<App />);
    await untilPriced(PRICE.mount);

    const resolvers: Array<(snap: BlockWorkflowSnapshot) => void> = [];
    estimateFn.mockImplementation(
      () => new Promise<BlockWorkflowSnapshot>((resolve) => resolvers.push(resolve)),
    );

    // Pass A (2 formats) — two requests in flight, unresolved.
    await user.click(screen.getByTestId(`yt-format-${CINEMATIC.id}`));
    await waitFor(() => expect(resolvers).toHaveLength(2));

    // Pass B (3 formats) — three MORE requests in flight. Two open passes is
    // the state the guard exists for.
    await user.click(screen.getByTestId(`yt-format-${GAMING.id}`));
    await waitFor(() => expect(resolvers).toHaveLength(5));

    // B (the NEWER pass) answers first: 3 formats at PRICE.third.
    await act(async () => {
      resolvers[2](priced(PRICE.third));
      resolvers[3](priced(PRICE.third));
      resolvers[4](priced(PRICE.third));
    });
    await untilPriced(PRICE.third * 3);

    // ...and now A, the STALE pass, answers. It must be discarded.
    await act(async () => {
      resolvers[0](priced(PRICE.first));
      resolvers[1](priced(PRICE.first));
    });
    // Settle everything that could possibly still be pending before reading.
    await new Promise((r) => setTimeout(r, ESTIMATE_DEBOUNCE_MS * 4));

    const button = screen.getByTestId('pm-generate');
    expect(priceShown(button)).toBe(String(PRICE.third * 3));
    expect(priceShown(button)).not.toBe(String(PRICE.first * 2));
    expect(priceShown(button)).not.toBe(String(PRICE.mount));
  });
});

describe('the Generate button is the ONLY price surface', () => {
  it('🔴 the price lives on the button alone, and moves when the form does', async () => {
    // The Buzz picker used to publish a second copy of this figure and the pair
    // had to agree; the picker is hidden now (always Auto, operator 2026-10-18),
    // so the claim inverts: there is exactly ONE place the price can be read,
    // and it still moves with the form.
    const user = userEvent.setup();
    render(<App />);
    await untilPriced(PRICE.mount);

    expect(priceShown(screen.getByTestId('pm-generate'))).toBe(String(PRICE.mount));
    expect(screen.queryByTestId('pm-account-trigger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pm-account-trigger-cost')).not.toBeInTheDocument();

    estimateFn.mockResolvedValue(priced(PRICE.third));
    await user.click(screen.getByTestId(`yt-format-${CINEMATIC.id}`));
    await untilPriced(PRICE.third * 2);
    expect(priceShown(screen.getByTestId('pm-generate'))).toBe(String(PRICE.third * 2));
  });
});
