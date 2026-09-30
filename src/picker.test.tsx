import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * REGRESSION: the checkpoint picker must open UNCONSTRAINED.
 *
 * The bug, reported from the live app: the "Change model" picker listed only
 * SDXL checkpoints — Z Image, OpenAI and Flux were missing — while other apps
 * (ab-img-poster) listed everything. Cause: App passed
 * `baseModelGroup: checkpoint.baseModel` to the picker, and `baseModelGroup`
 * "NARROWS the browse, never widens it" (blocks-react internal/catalog.d.ts).
 * Since the default checkpoint is SDXL 1.0, the filter was self-trapping: the
 * only way to widen it was to already hold a checkpoint from the family you
 * were trying to reach, so no other ecosystem was reachable AT ALL.
 *
 * The LoRA picker keeps its family filter on purpose and is pinned here too, so
 * a future "just drop every baseModelGroup" edit fails loudly: a LoRA really
 * must match the checkpoint's family, and that constraint is NOT the bug.
 *
 * Asserted at the hook boundary because that is where the defect lived — the
 * mock host answers a checkpoint pick with FLUX regardless of the filter, so
 * the e2e test passes either way and is NOT coverage for this.
 *
 * 🔴 RED-AT-BASE MATRIX. Measured against HEAD~ (a0b37a2) with the old
 * `useCheckpointPicker` ALSO mocked and resolving the Flux pick — i.e. the most
 * favourable conditions the old code can have. Only ONE of these three is
 * regression coverage; read the labels, do not assume all three are:
 *
 *   'no base-model filter'      RED at base  ("expected undefined to be
 *                               defined") <- the regression test
 *   'applies a cross-ecosystem  GREEN at base <- a BEHAVIOUR guard, not
 *    pick'                      regression coverage. A mocked picker does not
 *                               enforce the family filter, so this cannot see
 *                               the bug; it pins that a cross-family pick is
 *                               applied to state at all.
 *   'KEEPS the LoRA filter'     GREEN at base <- an INVARIANT guard. The fix
 *                               did not touch LoRA behaviour; this exists to
 *                               fail a future over-broad "drop every
 *                               baseModelGroup" edit.
 *
 * A first attempt at this matrix was INVALID and is kept here as the warning:
 * with `useCheckpointPicker` missing from the wholesale `vi.mock`, all three
 * went red at base — on a missing-mock-export error, not on any assertion.
 * Three reds that proved nothing.
 */

const checkpointPick = {
  versionId: 691639,
  modelId: 618692,
  baseModel: 'Flux.1 D',
  modelName: 'FLUX.1 [dev]',
  versionName: 'dev',
};

const loraPick = {
  versionId: 135867,
  modelId: 122359,
  baseModel: 'SDXL 1.0',
  modelName: 'Detail Tweaker XL',
};

// One spy for BOTH picker opens: App uses a single `useResourcePicker()` for
// checkpoints and LoRAs, so the calls are told apart by `resourceType`.
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
  useBuzzWorkflow: () => ({ estimate: vi.fn(), submit: vi.fn(), poll: vi.fn() }),
  useBuzzBalance: () => ({ balance: null, loading: false, error: null, refetch: vi.fn() }),
  useRequestConsent: () => ({ requestConsent: vi.fn() }),
  useRequestSignIn: () => ({ requestSignIn: vi.fn() }),
  useResourcePicker: () => ({ open: resourcePickerOpen }),
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
  // 🔴 EVERY hook App imports must be listed here. A missing one fails with
  // "No <name> export is defined on the mock" — which vitest reports as a test
  // FAILURE, indistinguishable at a glance from a broken assertion. A prior
  // session burned three "reds" that way and they proved nothing.
  useAppStorage: () => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue({ ok: true }),
    delete: vi.fn().mockResolvedValue({ ok: true, deleted: false }),
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

const { App } = await import('./App.js');
const { DEFAULT_CHECKPOINT, familyHasLoras } = await import('./models.js');

const optsFor = (type: string) =>
  resourcePickerOpen.mock.calls.map((c) => c[0]).find((o) => o?.resourceType === type);

describe('host resource pickers', () => {
  beforeEach(() => {
    resourcePickerOpen.mockReset();
  });

  it('opens the CHECKPOINT picker with no base-model filter, so every ecosystem is reachable', async () => {
    resourcePickerOpen.mockResolvedValue(checkpointPick);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByTestId('pm-change-model'));

    const opts = optsFor('Checkpoint');
    expect(opts).toBeDefined();
    // The whole point: NO family constraint. Assert the key is absent rather
    // than merely falsy — `baseModelGroup: ''` is a different request from an
    // omitted one, and only the omission is documented as unconstrained.
    expect(Object.prototype.hasOwnProperty.call(opts, 'baseModelGroup')).toBe(false);
    expect(opts).toEqual({ resourceType: 'Checkpoint' });
  });

  it('applies a cross-ecosystem checkpoint pick (the state the old filter made unreachable)', async () => {
    resourcePickerOpen.mockResolvedValue(checkpointPick);
    const user = userEvent.setup();
    render(<App />);

    // Starts on the curated default... read off DEFAULT_CHECKPOINT rather than
    // hard-coded, so moving the default cannot silently un-test this transition.
    expect(await screen.findByTestId('pm-model-label')).toHaveTextContent(DEFAULT_CHECKPOINT.label);
    await user.click(screen.getByTestId('pm-change-model'));

    // ...and lands on a Flux pick. Under the old family-locked picker this
    // transition could not be produced by any sequence of user actions.
    await expect(screen.findByText(/FLUX\.1 \[dev\]/)).resolves.toBeInTheDocument();
  });

  /**
   * 🔴 THIS TEST CHANGED SHAPE WITH THE OPENAI DEFAULT, AND THE CLAIM GOT
   * STRONGER RATHER THAN WEAKER.
   *
   * It used to click Add LoRA straight off the SDXL default and assert the
   * browse carried `baseModelGroup: 'SDXL 1.0'`. That sequence is no longer
   * reachable: the default is now `OpenAI`, a family with no LoRAs, so the
   * button is disabled and the picker is never opened. Deleting the assertion
   * would have thrown away the guard against a future "just drop every
   * baseModelGroup" edit — the thing the whole file exists for.
   *
   * So the test now walks the path a user walks: switch to a LoRA-capable
   * checkpoint, THEN add a LoRA, and assert the filter is the family of the
   * checkpoint actually held. That covers the original claim (the filter is
   * kept) plus one it never made (the filter FOLLOWS the current checkpoint
   * rather than being pinned to whatever the default happens to be) — a Flux
   * pick must produce a Flux-filtered LoRA browse, which a hard-coded
   * 'SDXL 1.0' expectation could never have caught.
   */
  it('KEEPS the LoRA picker filtered to the family of the CURRENT checkpoint', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Move off the default (no LoRAs) onto Flux, which has them.
    resourcePickerOpen.mockResolvedValue(checkpointPick);
    await user.click(await screen.findByTestId('pm-change-model'));
    await screen.findByText(/FLUX\.1 \[dev\]/);

    resourcePickerOpen.mockResolvedValue(loraPick);
    await user.click(screen.getByTestId('pm-lora-add'));

    // The browse is constrained to the family now held — NOT to the default's.
    expect(optsFor('LORA')).toEqual({ resourceType: 'LORA', baseModelGroup: 'Flux.1 D' });
  });

  /**
   * The collateral effect of the OpenAI default, pinned as BEHAVIOUR rather than
   * as copy: on a family with no LoRAs the control is disabled and the picker is
   * never opened. RED at bec8894 — there the default was SDXL, the button was
   * enabled, and clicking it DID call the picker.
   *
   * 🔴 Asserted on the picker CALL, not on the button's `disabled` attribute
   * alone. A disabled attribute is what the user sees; whether a spend-adjacent
   * host modal was opened is what actually matters, and the two can disagree
   * (a click handler wired past a cosmetic disable).
   */
  it('does not open the LoRA picker on a checkpoint family that has no LoRAs', async () => {
    resourcePickerOpen.mockResolvedValue(loraPick);
    const user = userEvent.setup();
    render(<App />);

    // The shipped default IS such a family — asserted, not assumed.
    expect(familyHasLoras(DEFAULT_CHECKPOINT.baseModel)).toBe(false);

    const add = await screen.findByTestId('pm-lora-add');
    await user.click(add);

    expect(optsFor('LORA')).toBeUndefined();
    expect(add).toBeDisabled();
    // ...and the reason is on screen, naming the family, rather than a dead
    // button with no explanation.
    expect(screen.getByTestId('pm-lora-unsupported')).toHaveTextContent(
      DEFAULT_CHECKPOINT.baseModel,
    );
  });
});
