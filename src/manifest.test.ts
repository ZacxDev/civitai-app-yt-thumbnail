import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Manifest guards. The version-lockstep case is the fleet standard — every
 * other app repo carries one, this one was scaffolded without it, and the
 * 0.1.0 -> 0.1.1 bump is what made the gap matter: the platform reads
 * `block.manifest.json`'s `version`, humans read `package.json`'s, and nothing
 * else in this repo compares them.
 *
 * Read it as an INVARIANT GUARD, not as regression coverage: at the commit
 * before this one both files already read 0.1.0, so this assertion was green
 * on pre-change code and has never been red on a real defect. It was killed on
 * purpose (package.json pinned back to 0.1.0 -> this test alone failed, the
 * other four here stayed green) and that is the whole of its evidence.
 *
 * The listing-copy cases are NOT lockstep checks — they pin the platform
 * bounds, because `civitai app validate` does not. It is a manifest-SHAPE
 * pre-check that accepts any unknown top-level key at rc=0 (`--strict` too),
 * so a misspelled field or an over-long tagline passes validate and fails (or
 * silently no-ops) server-side at approve.
 */

const root = resolve(__dirname, '..');
const manifest = JSON.parse(
  readFileSync(resolve(root, 'block.manifest.json'), 'utf8'),
) as Record<string, unknown>;
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as Record<
  string,
  unknown
>;

describe('block.manifest.json', () => {
  it('keeps `version` in lockstep with package.json', () => {
    expect(manifest.version).toBe(pkg.version);
  });

  it('declares a semver version', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // Bounds are the published schema's (civitai.com/schemas/app-block/v1.json,
  // read 2026-09-27): tagline minLength 1 / maxLength 140 / pattern \S.
  it('has a tagline within the platform-enforced 140-character cap', () => {
    const tagline = manifest.tagline;
    expect(typeof tagline).toBe('string');
    expect((tagline as string).trim().length).toBeGreaterThan(0);
    expect((tagline as string).length).toBeLessThanOrEqual(140);
  });

  // `set-text --description` refuses on-site apps and names a 2000-char cap.
  it('has a description within the 2000-character cap', () => {
    const description = manifest.description;
    expect(typeof description).toBe('string');
    expect((description as string).trim().length).toBeGreaterThan(0);
    expect((description as string).length).toBeLessThanOrEqual(2000);
  });

  // The schema's `category` enum, kept server-side in lockstep with
  // MARKETPLACE_CATEGORIES. An off-enum value is refused at approve.
  it('declares a category the marketplace enum actually contains', () => {
    expect([
      'generation',
      'games',
      'utility',
      'discovery',
      'moderation',
      'analytics',
      'other',
    ]).toContain(manifest.category);
  });
});

/**
 * SCOPE guards, added with the formats/storage batch.
 *
 * 🔴 RED-AT-BASE MATRIX — measured against origin/main (e2c3108), where
 * `block.manifest.json` declared `["ai:write:budgeted"]` and one justification.
 * Unlike the new pure-logic suites in this change, these are NOT vacuous reds:
 * the manifest file exists at base and parses fine, so each failure below is a
 * real ASSERTION failure about the manifest's contents.
 *
 *   'declares exactly the scopes the code uses'   RED at base
 *       AssertionError: expected [ 'ai:write:budgeted' ] to deeply equal
 *       [ 'ai:write:budgeted', 'apps:storage:read', 'apps:storage:shared:read',
 *         'apps:storage:shared:write', 'apps:storage:write' ]
 *
 *   'every declared scope carries a justification'  GREEN at base
 *       <- an INVARIANT guard. At base there was one scope and one
 *          justification, so it already held. It exists because
 *          `civitai app validate` does NOT check the pairing: a scope added
 *          without a justification passes validate at rc=0 and is questioned by
 *          a human moderator instead, days later.
 *
 *   'declares no scope the SDK does not know'      GREEN at base
 *       <- an INVARIANT guard, for the same reason: the canonical schema
 *          validates `scopes` by MEMBERSHIP in a fixed enum, but a typo'd scope
 *          is caught server-side at approve, not by local validate.
 *
 * These pin the MANIFEST only. That a scope is declared says nothing about
 * whether the viewer GRANTED it — a newly declared scope is consent-gated and
 * is dropped from the token until they consent. The runtime side of that is the
 * App's problem, not this file's.
 */
/**
 * IFRAME SANDBOX guards.
 *
 * 🔴 WHY THIS EXISTS, AND WHY IT PINS THE *ABSENCE* OF `allow-downloads`.
 *
 * The editor's "Download 1280×720 JPG" button uses the classic `<a download>` +
 * `a.click()` pattern. That click is INERT inside a sandboxed iframe that does
 * not carry `allow-downloads` — silently inert: no throw, no console error,
 * nothing for the app to catch. 0.1.0–0.1.5 shipped `allow-scripts allow-forms`,
 * so the button has never produced a file in production and the whole suite
 * stayed green the entire time.
 *
 * The obvious fix — add `allow-downloads` — IS NOT AVAILABLE TO THIS APP, and
 * that is the fact this block records so nobody spends another session
 * rediscovering it. `civitai app validate .` refuses the token outright:
 *
 *   sandbox token "allow-downloads" is not allowed for unverified blocks
 *   (trustTier is server-forced to unverified at submit; only allow-scripts and
 *   allow-forms are permitted)
 *
 * and the CLI's own bundled schema says the same: "Unverified tier allows only:
 * allow-scripts, allow-forms". `trustTier` is a server-owned field, and a
 * submitted block is always unverified — so there is no manifest edit that gets
 * the token. Adding it does not make the download work; it makes `submit` fail.
 *
 * Hence: the guard fails if `allow-downloads` APPEARS (a future session
 * "fixing" the button would break every submit) and fails if either shippable
 * token DISAPPEARS. When this block is granted a verified tier, this is the one
 * place to change, and the comment above is the checklist.
 *
 * 🔴 ASSERTED AS SET MEMBERSHIP, NOT AS A STRING. `sandbox` is a
 * whitespace-separated token list; pinning the whole literal would fail on a
 * harmless reorder. The token is what the browser reads, so the token is what
 * is pinned.
 */
describe('block.manifest.json iframe sandbox', () => {
  const iframe = (manifest.iframe ?? {}) as Record<string, unknown>;
  const raw = typeof iframe.sandbox === 'string' ? iframe.sandbox : '';
  const tokens = new Set(raw.split(/\s+/).filter((t) => t.length > 0));

  // The unverified-tier allowlist, transcribed from the CLI's bundled
  // app-block schema (`civitai` 2026-09-29 build, `sandboxChecks`).
  const UNVERIFIED_TIER_ALLOWLIST = ['allow-scripts', 'allow-forms'];

  it('🔴 declares NO token outside the unverified-tier allowlist — `submit` refuses them', () => {
    // RED at base? No — GREEN at base, deliberately. This is an INVARIANT GUARD
    // against a change nobody has made yet: the natural "fix" for the inert
    // Download button is `allow-downloads`, which `civitai app validate` rejects
    // and the server force-strips. See this block's header.
    for (const t of tokens) expect(UNVERIFIED_TIER_ALLOWLIST).toContain(t);
    expect(tokens.has('allow-downloads')).toBe(false);
  });

  it('still declares the tokens the app actually depends on', () => {
    // INVARIANT GUARD. Both have always been present; this is here so an edit
    // that rewrites the sandbox string cannot quietly drop one.
    expect(tokens.has('allow-scripts')).toBe(true);
    expect(tokens.has('allow-forms')).toBe(true);
  });

  it('never combines allow-same-origin with allow-scripts (sandbox escape)', () => {
    // INVARIANT GUARD, and the one sandbox rule that is a SECURITY rule rather
    // than a tier rule — the CLI refuses the combination outright.
    expect(tokens.has('allow-same-origin') && tokens.has('allow-scripts')).toBe(false);
  });

  it('spells every sandbox entry as a real `allow-*` token', () => {
    // INVARIANT GUARD. An unknown token is dropped by the browser in silence —
    // the same class of failure as the missing one this block is named for.
    expect(tokens.size).toBeGreaterThan(0);
    for (const t of tokens) expect(t).toMatch(/^allow-[a-z-]+$/);
  });
});

describe('block.manifest.json scopes', () => {
  const scopes = manifest.scopes as string[];
  const justifications = manifest.scopeJustifications as Record<string, string>;

  // The full block-scope enum from @civitai/app-sdk's BLOCK_SCOPES. Written out
  // rather than imported so this test fails on a scope the INSTALLED SDK would
  // accept but the published schema's enum does not — the two are meant to be
  // in lockstep and this is the place that notices when they are not.
  const KNOWN_BLOCK_SCOPES = [
    'models:read:self',
    'user:read:self',
    'ai:write:budgeted',
    'buzz:read:self',
    'social:tip:self',
    'apps:storage:read',
    'apps:storage:write',
    'apps:storage:shared:read',
    'apps:storage:shared:write',
    'collections:read:self',
    'collections:write:self',
    'collections:read:private',
  ];

  it('declares exactly the scopes the code uses — spend, private storage, shared storage', () => {
    // Sorted so the assertion is about the SET, not about manifest key order.
    expect([...scopes].sort()).toEqual([
      'ai:write:budgeted',
      'apps:storage:read',
      'apps:storage:shared:read',
      'apps:storage:shared:write',
      'apps:storage:write',
    ]);
  });

  it('every declared scope carries a justification, and there are no orphan justifications', () => {
    // Both directions: a scope without a justification is what a moderator
    // bounces the review on, and a justification for a scope that was removed
    // is a stale claim about what the app does.
    expect([...scopes].sort()).toEqual(Object.keys(justifications).sort());
  });

  it('every justification is substantive prose, not a placeholder', () => {
    for (const scope of scopes) {
      const why = justifications[scope];
      expect(typeof why).toBe('string');
      expect(why.trim().length).toBeGreaterThan(40);
    }
  });

  it('declares no scope outside the SDK block-scope enum', () => {
    for (const scope of scopes) {
      expect(KNOWN_BLOCK_SCOPES).toContain(scope);
    }
  });
});
