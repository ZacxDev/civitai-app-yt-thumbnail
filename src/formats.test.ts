import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BUILTIN_FORMATS,
  CUSTOM_FORMATS_KEY,
  DEFAULT_FORMAT_ID,
  LABEL_MAX,
  MAX_CUSTOM_FORMATS,
  PUBLISHED_ID_PREFIX,
  SUFFIX_MAX,
  allFormats,
  customFormatId,
  customFormatsFull,
  customToFormat,
  deleteCustomFormat,
  formatFromSharedItem,
  formatsFromSharedItems,
  isCustomId,
  parseCustomFormats,
  reconcileSelection,
  resolveFormats,
  serializeCustomFormats,
  sharedValueForFormat,
  toggleFormat,
  upsertCustomFormat,
  validateCustomFormat,
  type CustomFormat,
  type SharedItemLike,
} from './formats.js';

/**
 * The FORMATS model — built-ins, multi-select, the private custom store, and
 * the publishable shared store.
 *
 * 🔴 RED-AT-BASE MATRIX — READ THIS BEFORE TRUSTING ANY LABEL BELOW.
 *
 * `src/formats.ts` DID NOT EXIST at the base ref (origin/main, e2c3108). Every
 * test in this file therefore goes "red at base" on `Cannot find module
 * './formats.js'` — an IMPORT error, not an assertion. That is a VACUOUS red and
 * it is worth exactly nothing; it is the same class of non-evidence as the
 * missing-mock-export reds recorded in picker.test.tsx.
 *
 * So NONE of this file is REGRESSION coverage. It is all BEHAVIOUR coverage for
 * code introduced by this change. The real evidence is a MUTATION sweep — each
 * load-bearing assertion was killed by breaking the implementation on purpose
 * and confirming THIS test failed with THIS assertion's message. The mutants
 * that were run, and the specific assertion each one killed, are recorded in
 * claudedocs/mutation-matrix-formats.md.
 *
 * Fixture discipline: label/suffix/id values are pairwise distinct and distinct
 * from every constant an assertion names, so a mutant that hardcodes a constant
 * or swaps two fields cannot survive by coincidence.
 */

const draft = { label: 'Retro VHS', suffix: 'analog vhs grain, chromatic aberration, 1987 camcorder' };

/**
 * Lockstep with the canonical record. `public/formats/formats.json` is where the
 * six formats are DEFINED (and where each preview's `sourceWorkflowId` provenance
 * is kept); `BUILTIN_FORMATS` is the bundled copy the app reads. Nothing in the
 * build compares them, so without this guard the two drift silently and the
 * picker renders a suffix that no longer matches the art beside it — a viewer
 * then pays for a generation that does not look like the preview they chose.
 *
 * INVARIANT guard (both sides are introduced by this change, so it has never
 * been red on a real defect). Its evidence is the mutation sweep: editing a
 * single character of one suffix in `formats.ts` fails this test and nothing
 * else.
 */
const CANONICAL_PATH = resolve(__dirname, '..', 'public', 'formats', 'formats.json');

describe('built-in formats', () => {
  it('🔴 mirrors public/formats/formats.json exactly — id, label, suffix and preview', () => {
    // Prove the fixture EXISTS before comparing against it. A missing file that
    // parsed to `{}` would make every comparison below vacuously pass.
    expect(existsSync(CANONICAL_PATH)).toBe(true);
    const canonical = JSON.parse(readFileSync(CANONICAL_PATH, 'utf8')) as Record<
      string,
      { label: string; suffix: string; preview: string }
    >;
    const canonicalIds = Object.keys(canonical);
    expect(canonicalIds).toHaveLength(6);
    // Same set AND same order — the picker order is the JSON's key order.
    expect(BUILTIN_FORMATS.map((f) => f.id)).toEqual(canonicalIds);
    for (const f of BUILTIN_FORMATS) {
      expect({ label: f.label, suffix: f.suffix, preview: f.preview }).toEqual({
        label: canonical[f.id].label,
        suffix: canonical[f.id].suffix,
        preview: canonical[f.id].preview,
      });
    }
  });

  it('🔴 every preview path resolves to a file that is actually shipped', () => {
    // `preview` is a root-absolute URL into public/, which Vite copies verbatim
    // into dist/. A typo here is invisible until a viewer sees a broken image.
    for (const f of BUILTIN_FORMATS) {
      expect(f.preview).toMatch(/^\/formats\/[a-z-]+\.webp$/);
      const onDisk = resolve(__dirname, '..', 'public', (f.preview as string).replace(/^\//, ''));
      expect(existsSync(onDisk)).toBe(true);
    }
  });

  it('ships six built-ins with unique ids and non-empty suffixes', () => {
    expect(BUILTIN_FORMATS).toHaveLength(6);
    const ids = BUILTIN_FORMATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of BUILTIN_FORMATS) {
      expect(f.suffix.trim().length).toBeGreaterThan(0);
      expect(f.label.trim().length).toBeGreaterThan(0);
      expect(f.source).toBe('builtin');
    }
  });

  it('every built-in suffix fits the custom-format suffix bound', () => {
    // Keeps the shipped built-ins inside the same envelope a viewer's own
    // format must satisfy — so "publish a copy of a built-in" can never be
    // rejected for length.
    for (const f of BUILTIN_FORMATS) {
      expect(f.suffix.length).toBeLessThanOrEqual(SUFFIX_MAX);
      expect(f.label.length).toBeLessThanOrEqual(LABEL_MAX);
    }
  });

  it('the default format id resolves to a real built-in', () => {
    expect(BUILTIN_FORMATS.some((f) => f.id === DEFAULT_FORMAT_ID)).toBe(true);
  });
});

describe('multi-select', () => {
  it('adds an unselected format', () => {
    expect(toggleFormat(['cinematic'], 'gaming')).toEqual(['cinematic', 'gaming']);
  });

  it('removes a selected format when others remain', () => {
    expect(toggleFormat(['cinematic', 'gaming', 'tech-review'], 'gaming')).toEqual(['cinematic', 'tech-review']);
  });

  it('🔴 REFUSES to deselect the last remaining format', () => {
    // At-least-one is the invariant that keeps Generate from submitting zero
    // workflows and reporting success having spent nothing.
    expect(toggleFormat(['tech-review'], 'tech-review')).toEqual(['tech-review']);
  });

  it('reconciles away ids that no longer resolve, keeping the rest', () => {
    const available = allFormats([{ id: 'custom:7', label: 'Mine', suffix: 'my look' }]);
    expect(reconcileSelection(['cinematic', 'custom:7', 'custom:GONE'], available)).toEqual([
      'cinematic',
      'custom:7',
    ]);
  });

  it('🔴 falls back to the default when reconciliation would empty the selection', () => {
    const available = allFormats([]);
    expect(reconcileSelection(['custom:DELETED'], available)).toEqual([DEFAULT_FORMAT_ID]);
  });

  it('resolves ids to formats in the catalogue order, not the click order', () => {
    const available = allFormats([]);
    // 'gaming' is last among the built-ins, 'cinematic' second — asking in the
    // reverse order must still come back in picker order so the UI is stable.
    const got = resolveFormats(['gaming', 'cinematic'], available).map((f) => f.id);
    expect(got).toEqual(['cinematic', 'gaming']);
  });
});

describe('custom format validation', () => {
  it('accepts a well-formed draft', () => {
    expect(validateCustomFormat(draft)).toBeNull();
  });

  it('rejects a blank name', () => {
    expect(validateCustomFormat({ label: '   ', suffix: draft.suffix })).toMatch(/name/i);
  });

  it('rejects a blank description', () => {
    expect(validateCustomFormat({ label: draft.label, suffix: '  ' })).toMatch(/describe/i);
  });

  it('rejects an over-long name at exactly one character past the bound', () => {
    // Boundary AND a middle value: LABEL_MAX itself must pass.
    expect(validateCustomFormat({ label: 'x'.repeat(LABEL_MAX), suffix: draft.suffix })).toBeNull();
    expect(
      validateCustomFormat({ label: 'x'.repeat(LABEL_MAX + 1), suffix: draft.suffix }),
    ).toMatch(/too long/i);
  });

  it('rejects an over-long description at exactly one character past the bound', () => {
    expect(validateCustomFormat({ label: draft.label, suffix: 'y'.repeat(SUFFIX_MAX) })).toBeNull();
    expect(
      validateCustomFormat({ label: draft.label, suffix: 'y'.repeat(SUFFIX_MAX + 1) }),
    ).toMatch(/too long/i);
  });
});

describe('custom format list mutation', () => {
  const a: CustomFormat = { id: 'custom:1', label: 'Alpha', suffix: 'alpha look' };
  const b: CustomFormat = { id: 'custom:2', label: 'Beta', suffix: 'beta look' };

  it('appends a new format', () => {
    expect(upsertCustomFormat([a], b)).toEqual([a, b]);
  });

  it('replaces an existing format IN PLACE, preserving order', () => {
    const edited = { id: 'custom:1', label: 'Alpha II', suffix: 'revised alpha look' };
    expect(upsertCustomFormat([a, b], edited)).toEqual([edited, b]);
  });

  it('🔴 refuses to append past the cap but still allows an EDIT at the cap', () => {
    // Ids are namespaced away from `a`/`b` above so the "append" case below is
    // genuinely an append and cannot be silently taken by the edit branch.
    const full: CustomFormat[] = Array.from({ length: MAX_CUSTOM_FORMATS }, (_, i) => ({
      id: `full:${i}`,
      label: `F${i}`,
      suffix: `look ${i}`,
    }));
    expect(customFormatsFull(full)).toBe(true);
    // Append is refused...
    expect(upsertCustomFormat(full, b)).toHaveLength(MAX_CUSTOM_FORMATS);
    expect(upsertCustomFormat(full, b).some((f) => f.id === b.id)).toBe(false);
    // ...but editing one that is already there must keep working, or a viewer
    // at the cap could never fix a typo.
    const edit = { id: 'full:3', label: 'Edited', suffix: 'edited look' };
    const after = upsertCustomFormat(full, edit);
    expect(after).toHaveLength(MAX_CUSTOM_FORMATS);
    expect(after[3]).toEqual(edit);
  });

  it('deletes by id and leaves the rest untouched', () => {
    expect(deleteCustomFormat([a, b], 'custom:1')).toEqual([b]);
    expect(deleteCustomFormat([a, b], 'custom:NOPE')).toEqual([a, b]);
  });

  it('mints ids that are recognisable as custom and never collide with a built-in', () => {
    const id = customFormatId(1730000000000);
    expect(isCustomId(id)).toBe(true);
    expect(BUILTIN_FORMATS.some((f) => f.id === id)).toBe(false);
    for (const f of BUILTIN_FORMATS) expect(isCustomId(f.id)).toBe(false);
  });
});

describe('custom format persistence round-trip', () => {
  const list: CustomFormat[] = [
    { id: 'custom:11', label: 'Noir', suffix: 'high contrast black and white, hard shadows' },
    { id: 'custom:12', label: 'Pastel', suffix: 'soft pastel palette, gentle diffuse light' },
  ];

  it('round-trips through serialize -> parse unchanged', () => {
    expect(parseCustomFormats(serializeCustomFormats(list))).toEqual(list);
  });

  it('uses a versioned storage key', () => {
    expect(CUSTOM_FORMATS_KEY).toBe('formats:custom:v1');
  });

  it('🔴 parses `null` to an empty list — that is the ANONYMOUS viewer path', () => {
    // `useAppStorage().get()` resolves null both for "unset" and for an
    // anonymous viewer. Neither may throw during first paint.
    expect(parseCustomFormats(null)).toEqual([]);
    expect(parseCustomFormats(undefined)).toEqual([]);
  });

  it('🔴 never throws on a hostile / wrong-shaped stored value', () => {
    // Anything unrecognisable degrades to empty rather than breaking boot.
    expect(parseCustomFormats('not an array')).toEqual([]);
    expect(parseCustomFormats(42)).toEqual([]);
    expect(parseCustomFormats({ id: 'x' })).toEqual([]);
    expect(parseCustomFormats([null, 7, 'str', { nope: true }])).toEqual([]);
  });

  it('drops individual malformed entries without losing the good ones', () => {
    const raw = [
      { id: 'custom:11', label: 'Noir', suffix: 'hard shadows' },
      { id: 'custom:12', label: '', suffix: 'blank label is dropped' },
      { id: '', label: 'blank id is dropped', suffix: 'x' },
      { id: 'custom:13', label: 'No suffix', suffix: '   ' },
      { id: 'custom:14', label: 'Good', suffix: 'kept' },
    ];
    expect(parseCustomFormats(raw).map((f) => f.id)).toEqual(['custom:11', 'custom:14']);
  });

  it('de-duplicates by id, keeping the first occurrence', () => {
    const raw = [
      { id: 'custom:11', label: 'First', suffix: 'first look' },
      { id: 'custom:11', label: 'Second', suffix: 'second look' },
    ];
    expect(parseCustomFormats(raw)).toEqual([
      { id: 'custom:11', label: 'First', suffix: 'first look' },
    ]);
  });

  it('clamps over-long stored fields rather than rejecting the entry', () => {
    const raw = [{ id: 'custom:20', label: 'z'.repeat(LABEL_MAX + 25), suffix: 'w'.repeat(SUFFIX_MAX + 60) }];
    const [got] = parseCustomFormats(raw);
    expect(got.label).toHaveLength(LABEL_MAX);
    expect(got.suffix).toHaveLength(SUFFIX_MAX);
  });

  it('🔴 caps a stored list that somehow exceeds the maximum', () => {
    const raw = Array.from({ length: MAX_CUSTOM_FORMATS + 13 }, (_, i) => ({
      id: `custom:${i}`,
      label: `F${i}`,
      suffix: `look ${i}`,
    }));
    expect(parseCustomFormats(raw)).toHaveLength(MAX_CUSTOM_FORMATS);
  });

  it('converts a stored custom format into a pickable one with no preview art', () => {
    const f = customToFormat(list[0]);
    expect(f).toEqual({
      id: 'custom:11',
      label: 'Noir',
      suffix: 'high contrast black and white, hard shadows',
      source: 'custom',
    });
    expect(f.preview).toBeUndefined();
  });
});

describe('🔴 the shared-storage moderation split', () => {
  /**
   * The single most consequential assertion in this file. `title`/`body` are
   * MODERATED user-visible text; `data` is UNMODERATED app state. A published
   * format's suffix is prompt text injected into OTHER viewers' PAID
   * generations in a contentRating:"g" app, so it MUST travel in `body`.
   *
   * These are STATE assertions, not word assertions: they check WHICH FIELD
   * carries the text, so no rewording of a suffix can walk past them.
   */

  it('puts the suffix in `body`, NEVER in `data`', () => {
    const value = sharedValueForFormat(draft);
    expect(value.body).toBe(draft.suffix);
    expect(value.title).toBe(draft.label);
    // `data` must carry NO user-authored text at all.
    expect(value.data).toEqual({ v: 1 });
    expect(JSON.stringify(value.data)).not.toContain('vhs');
    expect(JSON.stringify(value.data)).not.toContain('camcorder');
  });

  it('trims and clamps the published fields to the same bounds as a custom format', () => {
    const value = sharedValueForFormat({
      label: `  ${'L'.repeat(LABEL_MAX + 9)}  `,
      suffix: `  ${'S'.repeat(SUFFIX_MAX + 30)}  `,
    });
    expect(value.title).toHaveLength(LABEL_MAX);
    expect(value.body).toHaveLength(SUFFIX_MAX);
  });

  it('reads a published format back OUT of `body`', () => {
    const item: SharedItemLike = {
      key: 'shared_42',
      authorUserId: 991,
      value: { title: 'Retro VHS', body: 'analog vhs grain, chromatic aberration' },
      count: 17,
      viewerVoted: true,
    };
    expect(formatFromSharedItem(item)).toEqual({
      id: `${PUBLISHED_ID_PREFIX}shared_42`,
      label: 'Retro VHS',
      suffix: 'analog vhs grain, chromatic aberration',
      source: 'published',
      sharedKey: 'shared_42',
      votes: 17,
      viewerVoted: true,
      authorUserId: 991,
    });
  });

  it('🔴 REJECTS an entry whose suffix is only in `data` — no unmoderated fallback', () => {
    // If this ever returned a format, `data` would become a working channel for
    // prompt text that never passed the content belt. Rejecting is the point.
    const smuggled: SharedItemLike = {
      key: 'shared_43',
      authorUserId: 992,
      value: { title: 'Looks innocent', data: { suffix: 'text that bypassed moderation' } },
      count: 0,
    };
    expect(formatFromSharedItem(smuggled)).toBeNull();
  });

  it('rejects an entry with a blank body or a blank title', () => {
    const base = { key: 'shared_44', authorUserId: 993, count: 1 };
    expect(formatFromSharedItem({ ...base, value: { title: 'T', body: '   ' } })).toBeNull();
    expect(formatFromSharedItem({ ...base, value: { title: '  ', body: 'B' } })).toBeNull();
  });

  it('defaults viewerVoted to false and a non-finite count to 0 on an older host', () => {
    const item: SharedItemLike = {
      key: 'shared_45',
      authorUserId: 994,
      value: { title: 'Old host', body: 'some look' },
      count: Number.NaN,
    };
    const got = formatFromSharedItem(item);
    expect(got?.viewerVoted).toBe(false);
    expect(got?.votes).toBe(0);
  });

  it('maps a page, silently dropping entries that are not usable formats', () => {
    const items: SharedItemLike[] = [
      { key: 'k1', authorUserId: 1, value: { title: 'Good', body: 'good look' }, count: 3 },
      { key: 'k2', authorUserId: 2, value: { title: 'Bad', data: { suffix: 'nope' } }, count: 9 },
      { key: 'k3', authorUserId: 3, value: { title: 'Also good', body: 'other look' }, count: 5 },
    ];
    expect(formatsFromSharedItems(items).map((f) => f.sharedKey)).toEqual(['k1', 'k3']);
  });
});

describe('the picker catalogue', () => {
  it('groups built-ins, then custom, then published — in that order', () => {
    const custom: CustomFormat[] = [{ id: 'custom:31', label: 'Mine', suffix: 'my look' }];
    const published = formatsFromSharedItems([
      { key: 'k9', authorUserId: 4, value: { title: 'Theirs', body: 'their look' }, count: 2 },
    ]);
    const got = allFormats(custom, published);
    expect(got).toHaveLength(BUILTIN_FORMATS.length + 2);
    expect(got.slice(0, BUILTIN_FORMATS.length).every((f) => f.source === 'builtin')).toBe(true);
    expect(got[BUILTIN_FORMATS.length].source).toBe('custom');
    expect(got[BUILTIN_FORMATS.length + 1].source).toBe('published');
  });

  it('is just the built-ins for a viewer with nothing saved (the anonymous case)', () => {
    expect(allFormats([]).map((f) => f.id)).toEqual(BUILTIN_FORMATS.map((f) => f.id));
  });
});
