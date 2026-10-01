import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CHECKPOINT,
  LORA_FREE_BASE_MODELS,
  MAX_LORAS,
  addLora,
  checkpointFromPick,
  clampLoraWeight,
  familyHasLoras,
  loraFromPick,
  loraOption,
  lorasForCheckpoint,
  pickedCheckpointLabel,
  removeLora,
  setLoraWeight,
  type LoraOption,
} from './models.js';

// Pure-logic units for the default checkpoint + the pick→option mappers (the SDK
// pickers resolve with a BlockCheckpointInfo / BlockResourceInfo) + the LoRA
// selection helpers. The default-checkpoint id is load-bearing (a verified Public
// + generation-covered + SFW base), so it's asserted here.

describe('default checkpoint', () => {
  /**
   * 🔴 RED AT bec8894 — this is regression coverage, not an invariant guard.
   * At base `DEFAULT_CHECKPOINT` was SD XL 1.0 (versionId 128078 / modelId
   * 101055 / baseModel 'SDXL 1.0'), on which `params.width`/`height` are inert
   * (every request comes back 1216x832, ~3:2). The whole ID TRIPLE is pinned
   * because the wire carries `modelId` AND `modelVersionId` and the app routes
   * the family filter off `baseModel` — a change to any one of the three is a
   * different generation at a different price.
   */
  it('ships ChatGPT Images (OpenAI) as the initial state — the aspect-honouring default', () => {
    expect(DEFAULT_CHECKPOINT).toMatchObject({ versionId: 2880272, modelId: 2563220 });
    expect(DEFAULT_CHECKPOINT.baseModel).toBe('OpenAI');
    expect(DEFAULT_CHECKPOINT.label).toBe('ChatGPT Images');
  });
});

describe('familyHasLoras', () => {
  /**
   * 🔴 RED AT bec8894 — `familyHasLoras` did not exist there, so the whole
   * describe fails to import. That makes it regression coverage for the OpenAI
   * default's collateral effect, but note the shape of the red: an import
   * failure, not an assertion. The BEHAVIOURAL claim underneath it — that the
   * default's own family is the one being excluded — is the first case below,
   * and it is written against DEFAULT_CHECKPOINT rather than the literal
   * 'OpenAI' so it cannot pass while the default moves somewhere unmeasured.
   */
  it('reports the shipped default as a family with no LoRAs', () => {
    expect(familyHasLoras(DEFAULT_CHECKPOINT.baseModel)).toBe(false);
  });

  it('reports the SD-family base models as LoRA-capable', () => {
    expect(familyHasLoras('SDXL 1.0')).toBe(true);
    expect(familyHasLoras('SD 1.5')).toBe(true);
    expect(familyHasLoras('Pony')).toBe(true);
    expect(familyHasLoras('Flux.1 D')).toBe(true);
    expect(familyHasLoras('Illustrious')).toBe(true);
  });

  it('matches case- and punctuation-insensitively, so a host label spelling cannot walk it', () => {
    // A guard on the WORD 'OpenAI' would pass for a pick labelled 'open ai'.
    expect(familyHasLoras('openai')).toBe(false);
    expect(familyHasLoras('Open AI')).toBe(false);
    expect(familyHasLoras('OPEN-AI')).toBe(false);
  });

  it('defaults an unknown or absent family to LoRA-capable', () => {
    // The set is a measured exception list, NOT an allowlist: defaulting the
    // other way would disable a working control for every unmeasured family.
    expect(familyHasLoras('Some Future Ecosystem')).toBe(true);
    expect(familyHasLoras('')).toBe(true);
    expect(familyHasLoras(null)).toBe(true);
    expect(familyHasLoras(undefined)).toBe(true);
  });

  it('keeps the deny-set to families measured with BOTH catalogue controls', () => {
    // Pinned as a SET so adding an entry is a deliberate act that has to come
    // with its measurement. 'Flux1' and 'Z Image' both returned 0 LoRAs in the
    // same survey and are deliberately ABSENT: they also returned 0 checkpoints,
    // so their zero is an unusable-filter-value result, not a product fact.
    expect([...LORA_FREE_BASE_MODELS].sort()).toEqual(['OpenAI']);
  });
});

describe('pickedCheckpointLabel', () => {
  it('prefers the public display name (model — version)', () => {
    expect(
      pickedCheckpointLabel(8, 'SDXL', { modelName: 'DreamShaper', versionName: 'v8' }),
    ).toBe('DreamShaper — v8');
  });
  it('falls back to "Model #id (base)" with no names', () => {
    expect(pickedCheckpointLabel(128078, 'SDXL 1.0')).toBe('Model #128078 (SDXL 1.0)');
  });
});

describe('checkpointFromPick (BlockCheckpointInfo → CheckpointOption)', () => {
  it('maps a full pick into a CheckpointOption', () => {
    expect(
      checkpointFromPick({
        versionId: 290640,
        modelId: 257749,
        modelName: 'Pony Diffusion V6 XL',
        versionName: 'V6',
        baseModel: 'Pony',
      }),
    ).toEqual({
      versionId: 290640,
      modelId: 257749,
      label: 'Pony Diffusion V6 XL — V6',
      baseModel: 'Pony',
    });
  });
  it('tolerates missing display names → deterministic id fallback label', () => {
    expect(
      checkpointFromPick({ versionId: 691639, modelId: 618692, baseModel: 'Flux.1 D' }),
    ).toEqual({
      versionId: 691639,
      modelId: 618692,
      label: 'Model #691639 (Flux.1 D)',
      baseModel: 'Flux.1 D',
    });
  });
});

// --- LoRA selection (the main feature) ---

const lora = (versionId: number, weight = 1): LoraOption =>
  loraOption({ versionId, modelId: versionId * 10, label: `L${versionId}`, baseModel: 'SDXL 1.0' }, weight);

describe('clampLoraWeight', () => {
  it('clamps to the server [-1, 2] bound; non-finite → default 1', () => {
    expect(clampLoraWeight(0.5)).toBe(0.5);
    expect(clampLoraWeight(9)).toBe(2);
    expect(clampLoraWeight(-9)).toBe(-1);
    expect(clampLoraWeight(undefined)).toBe(1);
    expect(clampLoraWeight(NaN)).toBe(1);
  });
});

describe('loraFromPick (BlockResourceInfo → LoraOption)', () => {
  it('maps a full pick into a LoraOption (default weight, clamped)', () => {
    expect(
      loraFromPick({
        versionId: 135867,
        modelId: 122359,
        modelName: 'Detail Tweaker XL',
        versionName: 'v1',
        baseModel: 'SDXL 1.0',
      }),
    ).toEqual({
      versionId: 135867,
      modelId: 122359,
      label: 'Detail Tweaker XL — v1',
      baseModel: 'SDXL 1.0',
      weight: 1,
    });
  });
  it('tolerates missing names → id-fallback label, and honors an explicit weight', () => {
    expect(loraFromPick({ versionId: 42, modelId: 7, baseModel: 'SDXL 1.0' }, 0.5)).toEqual({
      versionId: 42,
      modelId: 7,
      label: 'LoRA #42 (SDXL 1.0)',
      baseModel: 'SDXL 1.0',
      weight: 0.5,
    });
  });
});

describe('addLora / removeLora / setLoraWeight', () => {
  it('adds a LoRA, dedups by versionId, and caps at MAX_LORAS', () => {
    let sel: LoraOption[] = [];
    sel = addLora(sel, lora(1));
    sel = addLora(sel, lora(1)); // dup → ignored
    expect(sel).toHaveLength(1);

    // Fill to the cap, then prove a further add is a no-op.
    sel = [];
    for (let i = 0; i < MAX_LORAS; i++) sel = addLora(sel, lora(100 + i));
    expect(sel).toHaveLength(MAX_LORAS);
    sel = addLora(sel, lora(999));
    expect(sel).toHaveLength(MAX_LORAS);
    expect(sel.some((l) => l.versionId === 999)).toBe(false);
  });
  it('removeLora drops the matching versionId', () => {
    const sel = [lora(1), lora(2)];
    expect(removeLora(sel, 1).map((l) => l.versionId)).toEqual([2]);
  });
  it('setLoraWeight clamps + rounds the weight in place', () => {
    const sel = [lora(1, 1)];
    expect(setLoraWeight(sel, 1, 9)[0].weight).toBe(2); // clamped
    expect(setLoraWeight(sel, 1, 0.333333)[0].weight).toBe(0.33); // rounded
    expect(setLoraWeight(sel, 2, 0.5)).toEqual(sel); // no match → unchanged
  });
});

describe('lorasForCheckpoint', () => {
  /**
   * 🔴 ONE RULE, TWO CALL SITES, AND IT CLOSES A REAL SUBMIT BUG. `onChangeModel` used
   * to set the checkpoint and leave `loras` alone, so an SDXL LoRA stayed selected under
   * an OpenAI checkpoint, rode into `additionalResources`, and the server rejected the
   * generation with nothing on screen naming the cause. The App calls this when the
   * model changes (so the viewer SEES the clear and is told) and again when it builds
   * the form snapshot every body comes from (so no body can carry an impossible
   * resource, whatever path set the two inconsistently).
   *
   * BEHAVIOUR coverage here; the end-to-end clear is red-at-base in picker.test.tsx.
   */
  const selection: LoraOption[] = [
    { versionId: 135867, modelId: 122359, label: 'Detail Tweaker XL', baseModel: 'SDXL 1.0', weight: 0.65 },
    { versionId: 222111, modelId: 333222, label: 'Sinfully Stylish', baseModel: 'SDXL 1.0', weight: 1.35 },
  ];

  it('🔴 returns NOTHING for a family with no LoRAs', () => {
    // 'OpenAI' is the measured member of LORA_FREE_BASE_MODELS — 0 LoRAs with two
    // positive controls; see that set's own comment.
    expect(lorasForCheckpoint('OpenAI', selection)).toEqual([]);
  });

  it('🔴 returns EVERY LoRA for a family that has them — the resume path', () => {
    // The arm that makes a resume safe: restoring an SDXL batch's checkpoint AND its
    // LoRAs must keep all of them. A mutant that returned `[]` unconditionally, or
    // dropped all but the first, dies here.
    expect(lorasForCheckpoint('SDXL 1.0', selection)).toEqual(selection);
    expect(lorasForCheckpoint('SDXL 1.0', selection)).toHaveLength(2);
  });

  it('returns a COPY, never the caller’s array', () => {
    // It feeds a `setState` and a stored record; handing back the same reference makes
    // a later mutation of the selection silently rewrite history.
    const out = lorasForCheckpoint('SDXL 1.0', selection);
    expect(out).not.toBe(selection);
  });

  it('is case/punctuation-insensitive and permissive for an unknown family', () => {
    // It delegates to `familyHasLoras`, whose deny-set is an EXCEPTION list: an
    // unmeasured family keeps its LoRAs rather than silently losing a working control.
    expect(lorasForCheckpoint('open ai', selection)).toEqual([]);
    expect(lorasForCheckpoint('Some Future Model', selection)).toEqual(selection);
    expect(lorasForCheckpoint(null, selection)).toEqual(selection);
  });

  it('🔴 agrees with familyHasLoras for the SHIPPED DEFAULT, which is such a family', () => {
    // The premise the hidden LoRA field rests on, asserted rather than assumed so a
    // change of default cannot leave the UI decision silently wrong.
    expect(familyHasLoras(DEFAULT_CHECKPOINT.baseModel)).toBe(false);
    expect(lorasForCheckpoint(DEFAULT_CHECKPOINT.baseModel, selection)).toEqual([]);
  });
});
