import { describe, expect, it } from 'vitest';

import { StorageError } from '@civitai/sdk';

import { classifyStorageError, publishRefusalMessage } from './storage-errors.js';

const refusal = (status: number, code: string) => new StorageError(status, code, code, { code });

describe('classifyStorageError branches on the store code, never on prose', () => {
  it('maps the codes onto anon / denied / error', () => {
    expect(classifyStorageError(refusal(401, 'sign_in_required'))).toBe('anon');
    for (const code of ['insufficient_scope', 'consent_required', 'collection_not_declared', 'not_eligible']) {
      expect(classifyStorageError(refusal(403, code))).toBe('denied');
    }
    for (const code of ['too_large', 'quota_exceeded', 'rate_limited', 'service_unavailable']) {
      expect(classifyStorageError(refusal(413, code))).toBe('error');
    }
  });

  it('🔴 no longer guesses from words: legacy-shaped prose is just an error', () => {
    expect(classifyStorageError(new Error('FORBIDDEN: missing scope apps:storage:read'))).toBe('error');
    expect(classifyStorageError(new Error('not signed in'))).toBe('error');
    expect(classifyStorageError(null)).toBe('error');
  });

  it('gives viewer copy only for the publish refusals a viewer can act on', () => {
    expect(publishRefusalMessage(refusal(403, 'consent_required'))).toMatch(/permission first/);
    expect(publishRefusalMessage(refusal(401, 'sign_in_required'))).toMatch(/Sign in/);
    expect(publishRefusalMessage(refusal(422, 'content_rejected'))).toMatch(/content check/);
    expect(publishRefusalMessage(refusal(429, 'rate_limited'))).toBeNull();
  });
});
