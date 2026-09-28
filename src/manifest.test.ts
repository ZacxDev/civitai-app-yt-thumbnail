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
