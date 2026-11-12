import { describe, expect, it } from 'vitest';

import {
  ECOSYSTEM_UNAVAILABLE_TEXT,
  isEcosystemUnavailable,
  modelUnavailableMessage,
  phaseForError,
} from './generation.js';

/**
 * The pure half of the gated-ecosystem handling (App.ecosystem.test.tsx drives the
 * App). These symbols do not exist at 0.2.0, so this file's red there is VACUOUS
 * (an import failure) — the real reds are the App cases.
 */

const RAW = 'Validation failed: ecosystem: Ecosystem is currently unavailable';
const MODEL = { label: 'Qwen Image 2.1', baseModel: 'Qwen' };

describe('isEcosystemUnavailable', () => {
  it("matches the platform's stable refusal text, wherever it sits and in any case", () => {
    // Literal pin of the platform constant (civitai shared/generation/gates.ts).
    expect(ECOSYSTEM_UNAVAILABLE_TEXT).toBe('Ecosystem is currently unavailable');
    expect(isEcosystemUnavailable(RAW)).toBe(true);
    expect(isEcosystemUnavailable(`${RAW}. Back soon.`)).toBe(true);
    expect(isEcosystemUnavailable(RAW.toUpperCase())).toBe(true);
  });

  it('does not match other failures, nor the WORKFLOW refusal', () => {
    expect(isEcosystemUnavailable('Validation failed: workflow: Workflow is currently unavailable')).toBe(
      false,
    );
    expect(isEcosystemUnavailable('insufficient buzz')).toBe(false);
    expect(isEcosystemUnavailable('')).toBe(false);
    expect(isEcosystemUnavailable(null)).toBe(false);
    expect(isEcosystemUnavailable(undefined)).toBe(false);
  });

  it('stays a plain "failed" phase — it is not an out-of-Buzz state', () => {
    expect(phaseForError(RAW)).toBe('failed');
  });
});

describe('modelUnavailableMessage', () => {
  it('names the model and family, keeps the selection, and never echoes the raw string', () => {
    const msg = modelUnavailableMessage(MODEL, RAW);
    expect(msg).toBe(
      "Qwen Image 2.1 (Qwen) can't be used to generate right now — Civitai has made this base " +
        "model unavailable. It's still your selected model; choose a different one with Change " +
        'model to generate now. Nothing was charged.',
    );
    expect(msg).not.toMatch(/Validation failed/);
  });

  it("appends the gating rule's own copy verbatim", () => {
    const msg = modelUnavailableMessage(MODEL, `${RAW}. Restoring GPU capacity, back soon.`);
    expect(msg).toContain('unavailable: Restoring GPU capacity, back soon. ');
  });

  it('omits the family parenthesis when the base model is unknown', () => {
    expect(modelUnavailableMessage({ label: 'Model #42', baseModel: '' }, RAW)).toMatch(
      /^Model #42 can't be used/,
    );
  });
});
