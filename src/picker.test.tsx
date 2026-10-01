import { render, screen, waitFor } from '@testing-library/react';
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
// 🔴 `DEFAULT_CHECKPOINT` is imported at the top because it EXISTS at bec8894;
// `familyHasLoras` does NOT, so importing it here would make every case in this
// file fail to import at base — a vacuous red that would hide the one case whose
// red is real. It is imported lazily inside the single test that needs it.
const { DEFAULT_CHECKPOINT } = await import('./models.js');

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
   * The collateral effect of the OpenAI default, pinned as BEHAVIOUR rather than as
   * copy: on a family with no LoRAs the control does not exist at all, so there is
   * no route to the picker.
   *
   * 🔴 THIS CASE CHANGED SHAPE, AND THE OLD SHAPE IS WHY. It used to assert a
   * DISABLED `pm-lora-add` plus a `pm-lora-unsupported` explanation. Both are gone:
   * the field is now hidden outright for such a family. The claim being pinned is
   * unchanged and is still asserted on the picker CALL rather than on any attribute
   * — whether a spend-adjacent host modal was opened is what matters, and a click
   * handler wired past a cosmetic disable makes an attribute and a call disagree.
   *
   * 🔴 INVARIANT GUARD, NOT REGRESSION COVERAGE, for the call half: at base the
   * button existed-but-disabled and the picker was likewise never opened, so that
   * assertion passed there too. The ABSENCE half is the part that is red at base.
   */
  it('offers no LoRA control at all on a checkpoint family that has no LoRAs', async () => {
    resourcePickerOpen.mockResolvedValue(loraPick);
    render(<App />);

    // The field is gone — button, badge, cap note and all. RED at base, where the
    // button rendered (disabled) and this query resolved.
    await screen.findByTestId('pm-change-model');
    expect(screen.queryByTestId('pm-lora-add')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pm-lora-row')).not.toBeInTheDocument();

    // And there is therefore no route to the LoRA browse. Asserted on the CALL:
    // nothing the viewer can click asks the host for an incompatible resource.
    expect(optsFor('LORA')).toBeUndefined();

    // The premise, stated here so the absence above cannot be read as "the field
    // is broken" — the shipped default really is such a family.
    const { familyHasLoras } = await import('./models.js');
    expect(familyHasLoras(DEFAULT_CHECKPOINT.baseModel)).toBe(false);
  });

  /**
   * THE BUG THAT MADE HIDING THE FIELD DANGEROUS, pinned end to end.
   *
   * `onChangeModel` set the checkpoint and left `loras` alone. While the field stayed
   * visible that was merely wrong — the viewer could see stale rows under a model
   * that cannot use them. Hiding the field makes it INVISIBLE: the LoRAs still ride
   * into `additionalResources`, the server rejects the generation, and nothing on
   * screen names the cause.
   *
   * 🔴 RED AT BASE ON THE FIRST ASSERTION: there, switching Flux → the OpenAI default
   * left `pm-lora-row` on screen.
   */
  it('🔴 switching to a no-LoRA family CLEARS the selection and says so; switching back re-enables Add', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Onto Flux (has LoRAs), then add one.
    resourcePickerOpen.mockResolvedValue(checkpointPick);
    await user.click(await screen.findByTestId('pm-change-model'));
    await screen.findByText(/FLUX\.1 \[dev\]/);
    resourcePickerOpen.mockResolvedValue(loraPick);
    await user.click(screen.getByTestId('pm-lora-add'));
    await waitFor(() => expect(screen.getAllByTestId('pm-lora-row')).toHaveLength(1));

    // Back to a family with none. The pick is the app's own default checkpoint, so
    // the `baseModel` is `OpenAI` — the measured member of LORA_FREE_BASE_MODELS.
    resourcePickerOpen.mockResolvedValue({
      modelId: DEFAULT_CHECKPOINT.modelId,
      versionId: DEFAULT_CHECKPOINT.versionId,
      modelName: DEFAULT_CHECKPOINT.label,
      baseModel: DEFAULT_CHECKPOINT.baseModel,
    });
    await user.click(screen.getByTestId('pm-change-model'));

    // The selection is GONE, not merely hidden behind a disabled button...
    await waitFor(() => expect(screen.queryByTestId('pm-lora-row')).not.toBeInTheDocument());
    expect(screen.queryByTestId('pm-lora-add')).not.toBeInTheDocument();
    // ...and the viewer is TOLD, naming the family and the count. An unannounced
    // removal is a silent edit to what they are about to pay for.
    expect(screen.getByTestId('pm-lora-cleared')).toHaveTextContent(
      DEFAULT_CHECKPOINT.baseModel,
    );
    expect(screen.getByTestId('pm-lora-cleared')).toHaveTextContent('1');

    // Switching back brings the control back, empty and usable.
    resourcePickerOpen.mockResolvedValue(checkpointPick);
    await user.click(screen.getByTestId('pm-change-model'));
    const add = await screen.findByTestId('pm-lora-add');
    expect(add).toBeEnabled();
    expect(screen.queryByTestId('pm-lora-row')).not.toBeInTheDocument();
    // The note went with the field it explained.
    expect(screen.queryByTestId('pm-lora-cleared')).not.toBeInTheDocument();

    // And a fresh add works, so the clear did not leave the picker wedged.
    resourcePickerOpen.mockResolvedValue(loraPick);
    await user.click(add);
    await waitFor(() => expect(screen.getAllByTestId('pm-lora-row')).toHaveLength(1));
  });

  /**
   * 🔴 A RESUME RESTORES A CHECKPOINT *AND* ITS LoRAs, and the clear above must not
   * eat them. This is why the clearing lives in the click handler and NOT in an
   * effect keyed on `checkpoint`: an effect would fire on the restore and wipe the
   * LoRAs it had just put back, which is the exact failure the test above would
   * still pass through.
   *
   * Asserted here at the MODEL layer rather than through the history panel — the
   * component-level resume is covered in App.history.test.tsx. What this pins is
   * that `lorasForCheckpoint` is a function of the FAMILY, so an SDXL restore keeps
   * every LoRA it was handed.
   */
  it('🔴 a family that HAS LoRAs keeps every restored one — the resume path', async () => {
    const { lorasForCheckpoint, familyHasLoras } = await import('./models.js');
    const restored = [
      { versionId: 11, modelId: 1, label: 'A', baseModel: 'SDXL 1.0', weight: 0.8 },
      { versionId: 22, modelId: 2, label: 'B', baseModel: 'SDXL 1.0', weight: 1.2 },
    ];
    expect(familyHasLoras('SDXL 1.0')).toBe(true);
    expect(lorasForCheckpoint('SDXL 1.0', restored)).toEqual(restored);
    // The negative arm, so this is not just "the function returns its input".
    expect(lorasForCheckpoint('OpenAI', restored)).toEqual([]);
  });

  it('the shipped default IS a family with no LoRAs — asserted, not assumed', async () => {
    // The premise the case above rests on, separated so that case can stay
    // import-clean at base. VACUOUS red at bec8894 (`familyHasLoras` does not
    // exist there); its real evidence is models.test.ts's measured deny-set.
    const { familyHasLoras } = await import('./models.js');
    expect(familyHasLoras(DEFAULT_CHECKPOINT.baseModel)).toBe(false);
  });
});
