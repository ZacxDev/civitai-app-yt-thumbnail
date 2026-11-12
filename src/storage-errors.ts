/**
 * Classify a document-store refusal. Branches on the store's structured `code`
 * (`StorageError.code`) ONLY — never on prose.
 *
 * Before 0.2.0 this was a substring heuristic over the legacy bridge's free-text
 * errors ("anon", "scope", "denied"), because that bridge had no error codes.
 * The document store sends one envelope `{ code, message, … }`, so the guess is
 * gone.
 */

/** The store's `code`, or `null` when the failure carries none (offline, a bug). */
export function storageErrorCode(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * - `anon`   — the viewer is signed out (`sign_in_required`): sign in fixes it.
 * - `denied` — the app may not use the store here (the scope or consent is
 *              missing, the approved version does not declare the collection, or
 *              the app is not eligible): retrying cannot fix it.
 * - `error`  — anything else (outage, rate limit, too large, offline).
 */
export function classifyStorageError(err: unknown): 'anon' | 'denied' | 'error' {
  switch (storageErrorCode(err)) {
    case 'sign_in_required':
      return 'anon';
    case 'insufficient_scope':
    case 'consent_required':
    case 'collection_not_declared':
    case 'not_eligible':
      return 'denied';
    default:
      return 'error';
  }
}

/**
 * Viewer copy for a refused PUBLISH, or `null` when the refusal has no specific
 * fix (the caller shows its generic line).
 *
 * 🔴 `consent_required` SAYS "TRY AGAIN" BECAUSE NOTHING RETRIES FOR THEM. The
 * consent ask is fire-and-forget (the host's dialog has no reply a declined grant
 * can be read from), so the publish that triggered it has already failed; once
 * the viewer approves, the next press carries the re-minted token.
 */
export function publishRefusalMessage(err: unknown): string | null {
  switch (storageErrorCode(err)) {
    case 'consent_required':
      return 'Publishing needs your permission first. Approve it in the dialog, then press Publish again.';
    case 'sign_in_required':
      return 'Sign in to publish a format.';
    case 'content_rejected':
      // The store scans every string of the document; the offending field is not
      // returned, so name both places the text can be.
      return "The platform's content check rejected this format's name or description. Edit it and try again.";
    default:
      return null;
  }
}
