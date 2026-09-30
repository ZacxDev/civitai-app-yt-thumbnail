import { describe, expect, it } from 'vitest';

import {
  PROMPT_MAX,
  clearPromptEdit,
  composePrompt,
  effectivePrompt,
  isPromptEdited,
  promptFieldValue,
  promptsReadyToSubmit,
  setPromptEdit,
  type PromptEdits,
} from './generation.js';

/**
 * EDITABLE COMPOSED PROMPTS — the pure model behind the per-format prompt boxes.
 *
 * 🔴 RED/GREEN MATRIX, STATED HONESTLY. Every symbol imported here except
 * `PROMPT_MAX` and `composePrompt` is NEW in this change, so at the base ref
 * (5c10658) this file goes red on an IMPORT error. That is a VACUOUS red and it
 * proves nothing about any defect. This file is BEHAVIOUR coverage for a new
 * surface; the one piece of genuine regression coverage in this change is in
 * `editor.download.test.tsx` (the synchronous object-URL revoke), which fails
 * at base on a real ASSERTION rather than an import error.
 *
 * What these cases do buy is the money-path invariant the feature could break:
 * the string in the box is the string submitted, N formats stay N prompts, and
 * the server cap cannot be crossed by editing.
 *
 * Fixture discipline: the two format suffixes below are different lengths and
 * share no words, and no fixture string equals any constant the assertions name,
 * so a mutant that returns the wrong format's suffix, a constant, or the base
 * prompt alone cannot survive by coincidence.
 */

const ALPHA = { id: 'alpha', suffix: 'neon rim lighting, vivid magenta' };
const BETA = { id: 'beta', suffix: 'soft daylight' };
const NONE: PromptEdits = {};

describe('isPromptEdited — has the viewer taken this row over?', () => {
  it('is false for a format with no entry at all', () => {
    expect(isPromptEdited(NONE, ALPHA.id)).toBe(false);
    expect(isPromptEdited({ beta: 'x' }, ALPHA.id)).toBe(false);
  });

  it('🔴 is TRUE for an entry that is the EMPTY STRING', () => {
    // Presence, not truthiness. A row cleared to blank is still a row the viewer
    // owns — treating '' as "not edited" would silently hand it back to the
    // prompt box and submit text they deleted on purpose.
    expect(isPromptEdited({ alpha: '' }, ALPHA.id)).toBe(true);
    expect(isPromptEdited({ alpha: '   ' }, ALPHA.id)).toBe(true);
  });
});

describe('promptFieldValue — what the box shows', () => {
  it('is the live composition while the row is unedited', () => {
    expect(promptFieldValue('a cat', ALPHA, NONE)).toBe(`a cat, ${ALPHA.suffix}`);
    expect(promptFieldValue('a cat', BETA, NONE)).toBe(`a cat, ${BETA.suffix}`);
  });

  it('🔴 is the RAW edit once edited — whitespace preserved, so typing a space works', () => {
    // If the field showed the TRIMMED form, a trailing space would vanish under
    // the cursor on every keystroke and mid-sentence typing would be impossible.
    expect(promptFieldValue('a cat', ALPHA, { alpha: 'a dog and ' })).toBe('a dog and ');
  });

  it('shows the edit and ignores the prompt box entirely', () => {
    expect(promptFieldValue('a completely different base', ALPHA, { alpha: 'a dog' })).toBe(
      'a dog',
    );
  });
});

describe('effectivePrompt — THE string that gets submitted', () => {
  it('🔴 is `composePrompt` BYTE-FOR-BYTE while the row is unedited', () => {
    // The money-verified path must not move for a viewer who never edits.
    // Spelled out literally rather than read back from the function.
    expect(effectivePrompt('a cat', ALPHA, NONE)).toBe('a cat, neon rim lighting, vivid magenta');
    expect(effectivePrompt('', ALPHA, NONE)).toBe('neon rim lighting, vivid magenta');
    expect(effectivePrompt('a cat', ALPHA, NONE)).toBe(composePrompt('a cat', ALPHA.suffix));
  });

  it('🔴 keeps the suffix-reservation truncation on an unedited row', () => {
    const long = 'w'.repeat(PROMPT_MAX);
    const kept = PROMPT_MAX - ALPHA.suffix.length - ', '.length;
    expect(effectivePrompt(long, ALPHA, NONE)).toBe(`${'w'.repeat(kept)}, ${ALPHA.suffix}`);
    expect(effectivePrompt(long, ALPHA, NONE)).toHaveLength(PROMPT_MAX);
  });

  it('🔴 is the viewer’s own text, TRIMMED, once edited — no suffix appended', () => {
    // The whole point: an edited row is the viewer's string. Re-appending the
    // format suffix would submit something they never saw and did not approve.
    expect(effectivePrompt('a cat', ALPHA, { alpha: '  a dog on a surfboard  ' })).toBe(
      'a dog on a surfboard',
    );
    expect(effectivePrompt('a cat', ALPHA, { alpha: 'a dog' })).not.toContain(ALPHA.suffix);
  });

  it('🔴 CLAMPS an over-long edit to PROMPT_MAX — the cap cannot be crossed by editing', () => {
    // Belt to `setPromptEdit`'s braces: even a map assembled by hand (a future
    // caller, a restored value) cannot push an over-cap prompt onto the wire.
    const over = 'z'.repeat(PROMPT_MAX + 137);
    const got = effectivePrompt('a cat', ALPHA, { alpha: over });
    expect(got).toHaveLength(PROMPT_MAX);
    expect(got).toBe('z'.repeat(PROMPT_MAX));
  });

  it('🔴 keeps N formats at N DISTINCT prompts after one of them is edited', () => {
    // Editing must not collapse the batch. One request cannot carry two prompts,
    // so this property is what makes multi-select mean anything.
    const edits = setPromptEdit(NONE, ALPHA.id, 'a dog on a surfboard');
    const a = effectivePrompt('a cat', ALPHA, edits);
    const b = effectivePrompt('a cat', BETA, edits);
    expect(a).toBe('a dog on a surfboard');
    expect(b).toBe('a cat, soft daylight');
    expect(a).not.toBe(b);
  });
});

describe('setPromptEdit / clearPromptEdit', () => {
  it('🔴 clamps on the way IN, so the box and the wire agree on the length', () => {
    const edits = setPromptEdit(NONE, ALPHA.id, 'y'.repeat(PROMPT_MAX + 400));
    expect(promptFieldValue('a cat', ALPHA, edits)).toHaveLength(PROMPT_MAX);
    expect(effectivePrompt('a cat', ALPHA, edits)).toHaveLength(PROMPT_MAX);
  });

  it('stores an edit without disturbing another format’s', () => {
    const one = setPromptEdit(NONE, ALPHA.id, 'a dog');
    const two = setPromptEdit(one, BETA.id, 'a fox');
    expect(promptFieldValue('a cat', ALPHA, two)).toBe('a dog');
    expect(promptFieldValue('a cat', BETA, two)).toBe('a fox');
    // …and returns a NEW object each time, never mutating the caller's.
    expect(one).not.toBe(two);
    expect(isPromptEdited(one, BETA.id)).toBe(false);
  });

  it('🔴 clearPromptEdit hands the row BACK to the prompt box', () => {
    const edits = setPromptEdit(NONE, ALPHA.id, 'a dog');
    const cleared = clearPromptEdit(edits, ALPHA.id);
    expect(isPromptEdited(cleared, ALPHA.id)).toBe(false);
    expect(effectivePrompt('a cat', ALPHA, cleared)).toBe('a cat, neon rim lighting, vivid magenta');
    // Following the box again means a LATER base prompt change reaches it.
    expect(effectivePrompt('a wolf', ALPHA, cleared)).toBe('a wolf, neon rim lighting, vivid magenta');
  });

  it('clearing a row that was never edited is a no-op and keeps identity', () => {
    expect(clearPromptEdit(NONE, ALPHA.id)).toBe(NONE);
  });

  it('clears one row and leaves its siblings edited', () => {
    const edits = setPromptEdit(setPromptEdit(NONE, ALPHA.id, 'a dog'), BETA.id, 'a fox');
    const cleared = clearPromptEdit(edits, ALPHA.id);
    expect(isPromptEdited(cleared, ALPHA.id)).toBe(false);
    expect(promptFieldValue('a cat', BETA, cleared)).toBe('a fox');
  });
});

describe('promptsReadyToSubmit — the edit-aware Generate gate', () => {
  it('is true for the ordinary cases the shipped gate already allowed', () => {
    expect(promptsReadyToSubmit('a cat', [ALPHA], NONE)).toBe(true);
    // An empty prompt box beside a selected format is a real request.
    expect(promptsReadyToSubmit('', [ALPHA, BETA], NONE)).toBe(true);
  });

  it('🔴 is FALSE when a selected row has been edited to BLANK', () => {
    // The money case: submitting `params.prompt: ""` for that format and being
    // charged for it, while its siblings looked fine.
    expect(promptsReadyToSubmit('a cat', [ALPHA], { alpha: '' })).toBe(false);
    expect(promptsReadyToSubmit('a cat', [ALPHA], { alpha: '   \n ' })).toBe(false);
  });

  it('🔴 is FALSE when only ONE of several rows is blank', () => {
    // `every`, not `some`. A per-row failure has to stop the click, because the
    // click submits every row.
    expect(promptsReadyToSubmit('a cat', [ALPHA, BETA], { beta: '  ' })).toBe(false);
  });

  it('is true again once that row carries text, or is reset', () => {
    expect(promptsReadyToSubmit('a cat', [ALPHA, BETA], { beta: 'a fox' })).toBe(true);
    expect(promptsReadyToSubmit('a cat', [ALPHA, BETA], clearPromptEdit({ beta: '' }, BETA.id))).toBe(
      true,
    );
  });

  it('🔴 NOTHING selected is still not submittable', () => {
    // Zero workflows: a click that spends nothing and reports success.
    expect(promptsReadyToSubmit('a cat', [], NONE)).toBe(false);
    expect(promptsReadyToSubmit('a cat', [], { alpha: 'a dog' })).toBe(false);
  });

  it('an edit is enough on its own — the prompt box may stay empty', () => {
    expect(promptsReadyToSubmit('', [ALPHA], { alpha: 'a dog on a surfboard' })).toBe(true);
  });
});
