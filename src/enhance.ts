// Prompt enhancement — built on the host's REGISTERED `chat-completion`
// step (`{ kind: 'step', step: 'chat-completion' }`), the documented
// block-side LLM primitive. There is no `promptEnhancement` step registered
// for blocks, and the orchestration REST recipe needs a Bearer token a
// sandboxed block never holds — so the enhancement is expressed as a chat
// completion with a rewrite instruction, priced by the host's live quote
// through the same estimate -> submit -> poll lifecycle as generation.
//
// The reply rides the terminal poll snapshot's `textOutputs` (host-derived,
// moderation-scanned before release; `textOutputWithheld` explains a
// withheld reply). Those two fields are live on the host but not in the
// published SDK snapshot type, so they're read through a structural cast —
// the transport validator passes unknown fields through untouched.
//
// Same construction as Character Sheet Studio's `sheet/enhance.ts`, with a
// YouTube-thumbnail system prompt. No React, no DOM — unit-tested in node.

import type { BlockWorkflowSnapshot, WorkflowBody } from '@civitai/app-sdk/blocks';

/**
 * One of the host registry's allowlisted chat models. The allowlist is
 * host-side and load-bearing: a fabricated model name is quoted, CHARGED,
 * and then fails at execution with no output and no refund — so this string
 * must stay boring and well-known.
 */
export const ENHANCE_MODEL = 'openai/gpt-4o-mini';

/** Output budget for one rewritten thumbnail prompt (~100 words of prose). */
export const ENHANCE_MAX_TOKENS = 300;

/**
 * The workflow body that rewrites the viewer's prompt for a YouTube
 * thumbnail. Only the raw prompt is rewritten — the selected formats'
 * suffixes are composed on top of it at generation time, unchanged.
 */
export function buildEnhanceBody(prompt: string): WorkflowBody {
  return {
    kind: 'step',
    step: 'chat-completion',
    params: {
      model: ENHANCE_MODEL,
      maxTokens: ENHANCE_MAX_TOKENS,
      messages: [
        {
          role: 'system',
          content:
            'You rewrite prompts for YouTube thumbnail image generation. ' +
            'Return ONLY the rewritten prompt — no preamble, no explanation, no quotation marks, no line breaks. ' +
            'Preserve the subject, and preserve verbatim any name, title text, or quoted words from the input. ' +
            'Make it vivid and click-worthy: concrete subject detail, a strong expression or action where a person is present, ' +
            'bold saturated colors, high contrast, dramatic lighting, one clear focal point, clean uncluttered composition that reads at small size. ' +
            'Keep it under 100 words.',
        },
        { role: 'user', content: prompt },
      ],
    },
  };
}

/** What a terminal enhance snapshot gave back. */
export type EnhanceOutcome =
  | { type: 'text'; text: string }
  | { type: 'withheld'; reason: string }
  | { type: 'none' };

/**
 * Read the enhancement out of a terminal snapshot. `textOutputs` carries the
 * released (scanned) reply; `textOutputWithheld` carries a user-facing reason
 * when text was produced but kept back. Anything else — an older host, a
 * snapshot without a step — is `none`, and callers keep the original prompt.
 */
export function enhanceOutcomeFromSnapshot(snap: BlockWorkflowSnapshot): EnhanceOutcome {
  const ext = snap as BlockWorkflowSnapshot & {
    textOutputs?: unknown;
    textOutputWithheld?: { reason?: unknown } | null;
  };
  if (Array.isArray(ext.textOutputs)) {
    const text = ext.textOutputs.find(
      (t): t is string => typeof t === 'string' && t.trim() !== '',
    );
    if (text) return { type: 'text', text: text.trim() };
  }
  const reason = ext.textOutputWithheld?.reason;
  if (typeof reason === 'string' && reason.trim() !== '') {
    return { type: 'withheld', reason: reason.trim() };
  }
  return { type: 'none' };
}
