import { describe, expect, it } from 'vitest';

import type { BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

import { ENHANCE_MAX_TOKENS, ENHANCE_MODEL, buildEnhanceBody, enhanceOutcomeFromSnapshot } from './enhance.js';

function snap(extra: Record<string, unknown>): BlockWorkflowSnapshot {
  return { workflowId: 'w1', status: 'succeeded', ...extra } as BlockWorkflowSnapshot;
}

describe('buildEnhanceBody', () => {
  it('is the registered chat-completion step with the allowlisted model', () => {
    const body = buildEnhanceBody('a cat in sunglasses');
    expect(body.kind).toBe('step');
    if (body.kind !== 'step' || !('params' in body)) throw new Error('not the registry arm');
    expect(body.step).toBe('chat-completion');
    const params = body.params as {
      model: string;
      maxTokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(params.model).toBe(ENHANCE_MODEL);
    expect(params.model).toBe('openai/gpt-4o-mini');
    expect(params.maxTokens).toBe(ENHANCE_MAX_TOKENS);
    // The viewer's text is the user message, verbatim; the instruction is the system one.
    expect(params.messages).toHaveLength(2);
    expect(params.messages[0].role).toBe('system');
    expect(params.messages[1]).toEqual({ role: 'user', content: 'a cat in sunglasses' });
    expect(params.messages[0].content).toMatch(/ONLY the rewritten prompt/);
  });
});

describe('enhanceOutcomeFromSnapshot', () => {
  it('reads the first non-empty text output, trimmed', () => {
    expect(enhanceOutcomeFromSnapshot(snap({ textOutputs: ['', '  a bolder cat  '] }))).toEqual({
      type: 'text',
      text: 'a bolder cat',
    });
  });

  it('surfaces a withheld reason when no text was released', () => {
    expect(
      enhanceOutcomeFromSnapshot(snap({ textOutputs: [], textOutputWithheld: { reason: ' flagged ' } })),
    ).toEqual({ type: 'withheld', reason: 'flagged' });
  });

  it('is none for a snapshot with neither field (older host / no step)', () => {
    expect(enhanceOutcomeFromSnapshot(snap({}))).toEqual({ type: 'none' });
    expect(enhanceOutcomeFromSnapshot(snap({ textOutputs: 'not-an-array' }))).toEqual({ type: 'none' });
    expect(enhanceOutcomeFromSnapshot(snap({ textOutputWithheld: { reason: 42 } }))).toEqual({
      type: 'none',
    });
  });
});
