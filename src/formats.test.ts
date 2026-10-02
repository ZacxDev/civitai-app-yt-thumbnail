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
  WILDCARD_CHAR,
  allFormats,
  customFormatId,
  customFormatsFull,
  customToFormat,
  deleteCustomFormat,
  formatFromSharedItem,
  formatsFromSharedItems,
  hasPreviewArt,
  isCustomId,
  parseCustomFormats,
  reconcileSelection,
  resolveFormats,
  serializeCustomFormats,
  sharedValueForFormat,
  suffixWildcardReason,
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
 * Lockstep with the canonical record. `public/formats/formats.json` is where all
 * TWELVE formats are DEFINED (and where each preview's `sourceWorkflowId`
 * provenance is kept); `BUILTIN_FORMATS` is the bundled copy the app reads. Nothing in the
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

/**
 * THE LEDGER. The exact built-in ids, in exact picker order. Written out as
 * literals on purpose: derived from `BUILTIN_FORMATS` it would assert nothing.
 *
 * ONE assertion compares the whole list against this, which makes it fail when
 * the set GROWS, when it SHRINKS, when an id is RENAMED, and when the order
 * changes — four claims for the price of one, and all four matter. Order is
 * load-bearing twice over: `DEFAULT_FORMAT_ID` is element 0, and the picker
 * renders in this order.
 *
 * Growing the set is SUPPOSED to break this test. Update the literal list in the
 * same commit that adds the format, and say so in the message.
 */
const BUILTIN_LEDGER: readonly string[] = [
  'clickbait',
  'cinematic',
  'bold-simple',
  'tech-review',
  'tutorial',
  'gaming',
  'minimalist',
  'educational',
  'professional',
  'abstract',
  'chaos',
  'magic',
];

/**
 * The built-ins that ship WITH generated preview art, pinned exactly. As of the
 * second art batch that is ALL TWELVE — there is no previewless built-in left.
 *
 * 🔴 STILL A SET, NOT A COUNT, AND STILL NOT DERIVED, now that it happens to equal
 * `BUILTIN_LEDGER`. The temptation once every format has art is to write
 * `expect(withArt).toEqual(BUILTIN_LEDGER)` or `toHaveLength(12)`; both throw away
 * the claim. A count cannot tell "we generated art for `magic`" from "we lost the
 * art for `gaming`" — one is progress, the other a regression that ships a broken
 * image. Deriving it from the ledger cannot see the two moving apart at all. So
 * this stays a hand-written list of ids and goes red when ANY single format's art
 * appears or disappears.
 */
const WITH_PREVIEW_ART: readonly string[] = [
  'clickbait',
  'cinematic',
  'bold-simple',
  'tech-review',
  'tutorial',
  'gaming',
  'minimalist',
  'educational',
  'professional',
  'abstract',
  'chaos',
  'magic',
];

/**
 * The shape a REAL `sourceWorkflowId` has: `<accountId>-<timestamp>-<token>`, e.g.
 * `8753561-20261002022355308-shv0`.
 *
 * 🔴 THIS IS THE FIX FOR WHAT THE AUDIT PROVED. The provenance guard used to check
 * only co-presence plus `typeof === 'string' && length > 0`, so `'TOTALLY-MADE-UP-
 * NEVER-RAN'` passed — a FABRICATED id for a generation that never ran, in the one
 * file whose entire purpose is to not be a false record. A shape check is not proof
 * the workflow ran, and this comment does not claim it is; it is the mechanical
 * half, and it is the half that stops a hand-typed placeholder.
 *
 * Verified against the file before being relied on: all twelve ids present in
 * `formats.json` match this pattern (7 digits, 17 digits, 4 lowercase
 * alphanumerics). Measured, not assumed.
 */
const WORKFLOW_ID_SHAPE = /^\d{7}-\d{17}-[a-z0-9]{4}$/;

/** Map a root-absolute `preview` URL to where Vite will actually ship it from. */
function previewOnDisk(preview: string): string {
  return resolve(__dirname, '..', 'public', preview.replace(/^\//, ''));
}

describe('built-in formats', () => {
  it('🔴 mirrors public/formats/formats.json exactly — id, label, suffix and preview', () => {
    // Prove the fixture EXISTS before comparing against it. A missing file that
    // parsed to `{}` would make every comparison below vacuously pass.
    expect(existsSync(CANONICAL_PATH)).toBe(true);
    const canonical = JSON.parse(readFileSync(CANONICAL_PATH, 'utf8')) as Record<
      string,
      { label: string; suffix: string; preview?: string }
    >;
    const canonicalIds = Object.keys(canonical);
    expect(canonicalIds).toEqual(BUILTIN_LEDGER);
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

  it('🔴 the JSON provenance triple travels TOGETHER — art implies a real workflow id', () => {
    // `preview`, `sourceWorkflowId` and `costBuzz` are one record: the art, the
    // generation it came from, and what it cost. A `preview` with no
    // `sourceWorkflowId` is art nobody can trace; a `sourceWorkflowId` with no
    // `preview` is a provenance line for a file that is not there. Both are false
    // records, and the whole point of this JSON is that it is not one.
    //
    // 🔴 CO-PRESENCE WAS NOT ENOUGH, AND THIS GUARD ONCE CLAIMED MORE THAN IT DID.
    // An audit put real art, `sourceWorkflowId: 'TOTALLY-MADE-UP-NEVER-RAN'` and
    // `costBuzz: 0` on `magic` and the whole suite stayed green: every field was
    // PRESENT and `typeof === 'string' && length > 0` held. Presence is not
    // provenance. Two assertions below close that, and they are what a fabricated
    // record now fails on:
    //   - the id must match WORKFLOW_ID_SHAPE, not merely be a non-empty string;
    //   - `costBuzz` must be > 0, not merely a number. A generation that produced
    //     an image cost something. `0` is the value a fabricator reaches for, and
    //     it is also what "we never looked" looks like.
    // Neither proves the workflow ran — only the backend can — and the claim here
    // is exactly that narrow: a hand-typed placeholder is rejected.
    const canonical = JSON.parse(readFileSync(CANONICAL_PATH, 'utf8')) as Record<
      string,
      { preview?: unknown; sourceWorkflowId?: unknown; costBuzz?: unknown }
    >;
    const withArt: string[] = [];
    for (const [id, rec] of Object.entries(canonical)) {
      const hasPreview = rec.preview !== undefined && rec.preview !== null;
      if (!hasPreview) {
        // Previewless: carries NO provenance at all. A fabricated workflow id for
        // a generation that never ran is the specific thing being forbidden here.
        expect(rec.sourceWorkflowId, `${id} declares a workflow id but no preview`).toBeUndefined();
        expect(rec.costBuzz, `${id} declares a cost but no preview`).toBeUndefined();
        continue;
      }
      withArt.push(id);
      expect(typeof rec.sourceWorkflowId, `${id} has art but no sourceWorkflowId`).toBe('string');
      expect(
        rec.sourceWorkflowId as string,
        `${id}'s sourceWorkflowId is not shaped like a real workflow id`,
      ).toMatch(WORKFLOW_ID_SHAPE);
      expect(typeof rec.costBuzz, `${id} has art but no costBuzz`).toBe('number');
      expect(
        rec.costBuzz as number,
        `${id} has art but claims it cost nothing to generate`,
      ).toBeGreaterThan(0);
    }
    expect(withArt).toEqual(WITH_PREVIEW_ART);
  });

  it('🔴 the workflow-id shape check can REJECT — the instrument, not just its verdict', () => {
    // 🔴 NEGATIVE CONTROL FOR THE ASSERTION ADDED ABOVE. `WORKFLOW_ID_SHAPE` is a
    // regex written by hand; if it were accidentally permissive (a missing anchor,
    // a stray `.*`) the guard above would go green on exactly the fabricated record
    // it exists to catch, and nothing would say so. These are the strings an
    // audit — or a careless edit — actually produces.
    expect(WORKFLOW_ID_SHAPE.test('TOTALLY-MADE-UP-NEVER-RAN')).toBe(false);
    expect(WORKFLOW_ID_SHAPE.test('')).toBe(false);
    expect(WORKFLOW_ID_SHAPE.test('TODO')).toBe(false);
    expect(WORKFLOW_ID_SHAPE.test('1234567-20261002022355308-shv0-EXTRA')).toBe(false);
    expect(WORKFLOW_ID_SHAPE.test('PREFIX-1234567-20261002022355308-shv0')).toBe(false);
    // ...and the positive half: a real id from each of the two batches passes, so
    // the regex is not simply rejecting everything.
    expect(WORKFLOW_ID_SHAPE.test('8753561-20260930161257252-7o4y')).toBe(true);
    expect(WORKFLOW_ID_SHAPE.test('8753561-20261002023313073-mpt8')).toBe(true);
  });

  it('🔴 every DECLARED preview path resolves to a file that is actually shipped', () => {
    // `preview` is a root-absolute URL into public/, which Vite copies verbatim
    // into dist/. A typo here is invisible until a viewer sees a broken image.
    //
    // 🔴 POSITIVE CONTROL FIRST. The loop below is CONDITIONAL, and a conditional
    // loop that iterates zero times passes while checking nothing. Prove the
    // instrument can go both ways before reading its verdict. (It now happens to
    // iterate over every built-in — but the condition is still there, so the
    // control still earns its place.)
    expect(existsSync(previewOnDisk('/formats/clickbait.webp'))).toBe(true);
    expect(existsSync(previewOnDisk('/formats/no-such-format.webp'))).toBe(false);

    let checked = 0;
    for (const f of BUILTIN_FORMATS) {
      if (!hasPreviewArt(f)) continue;
      expect(f.preview).toMatch(/^\/formats\/[a-z-]+\.webp$/);
      expect(existsSync(previewOnDisk(f.preview!)), `missing preview file for ${f.id}`).toBe(true);
      checked += 1;
    }
    // The count the loop actually ran, not the count we hoped it ran.
    expect(checked, 'the preview-exists loop checked nothing').toBe(WITH_PREVIEW_ART.length);
  });

  it('🔴 EVERY built-in has art now — and the placeholder branch is still live code', () => {
    // 🔴 THIS TEST CHANGED MEANING, so read it rather than its title's history. It
    // used to assert "the six formats without art declare no preview at all" and
    // ended on `expect(previewless.length).toBeGreaterThan(0)`. All twelve now carry
    // art, so that version would be RED — and quietly rewriting it to `toEqual([])`
    // would leave the placeholder branch with no population at all, which is how a
    // guard becomes vacuous while still reading as coverage. So, two halves:
    //
    // (1) No built-in is previewless. DERIVED from the two literal lists, so it
    //     fails the moment they disagree rather than asserting a bare `[]`.
    const previewless = BUILTIN_FORMATS.filter((f) => !hasPreviewArt(f)).map((f) => f.id);
    const expected = BUILTIN_LEDGER.filter((id) => !WITH_PREVIEW_ART.includes(id));
    expect(previewless).toEqual(expected);
    expect(previewless).toEqual([]);

    // (2) The placeholder branch is NOT dead code — its population MOVED, it did
    //     not vanish. Every CUSTOM and every PUBLISHED format has no art, by
    //     construction and permanently: there is nowhere for a viewer's own format
    //     to get a bundled image from. The hazard the old version pinned (a
    //     well-meant `''` or `'TODO'` reaching the DOM as `<img src>`) now lives in
    //     `hasPreviewArt`'s own test below. The DOM-level proof that this branch is
    //     actually TAKEN is in App.formats.test.tsx, driven from a custom format for
    //     exactly this reason.
    expect(
      hasPreviewArt(customToFormat({ id: 'custom:1', label: 'Mine', suffix: 'my look' })),
    ).toBe(false);
    const [published] = formatsFromSharedItems([
      { key: 'k1', authorUserId: 1, value: { title: 'Theirs', body: 'their look' }, count: 0 },
    ]);
    expect(hasPreviewArt(published)).toBe(false);
  });

  it('🔴 `hasPreviewArt` is ONE predicate, and it rejects the placeholder values', () => {
    // 🔴 THE TEST-VS-COMPONENT SPLIT THIS CLOSES. `FormatPicker` branched on
    // `fmt.preview ?` while this file classified art as `f.preview !== undefined`.
    // The two agree on every value the repo currently holds and disagree on exactly
    // the ones that break a viewer's screen: `''` and `null` are falsy (component →
    // placeholder, correct) but are NOT `undefined`, so the old test predicate
    // called them "has art", demanded an `<img>`, and would have asserted its `src`
    // is `''` — certifying the broken-image render. A test and its component
    // disagreeing about what the code does is how a real defect gets signed off.
    // One predicate now, in formats.ts; these are its edges.
    expect(hasPreviewArt({ preview: '/formats/clickbait.webp' })).toBe(true);
    expect(hasPreviewArt({})).toBe(false);
    expect(hasPreviewArt({ preview: undefined })).toBe(false);
    expect(hasPreviewArt({ preview: null })).toBe(false);
    expect(hasPreviewArt({ preview: '' })).toBe(false);
    expect(hasPreviewArt({ preview: '   ' })).toBe(false);
  });

  it('🔴 ships exactly the ledger — fails if the set grows OR shrinks', () => {
    // One comparison, four claims: membership, count, naming and order.
    expect(BUILTIN_FORMATS.map((f) => f.id)).toEqual(BUILTIN_LEDGER);
  });

  it('every built-in has a unique id, a non-empty suffix, and the builtin source', () => {
    const ids = BUILTIN_FORMATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of BUILTIN_FORMATS) {
      expect(f.suffix.trim().length, `${f.id} has a blank suffix`).toBeGreaterThan(0);
      expect(f.label.trim().length, `${f.id} has a blank label`).toBeGreaterThan(0);
      expect(f.source).toBe('builtin');
    }
  });

  it('🔴 no two built-ins share a suffix — the copy-paste guard', () => {
    // Two formats with one suffix are two bills for one image: the viewer selects
    // both, pays twice, and gets the same look. This is the cheap mechanical half
    // of "the formats are distinct"; the rest is editorial judgement recorded in
    // the per-format comments in formats.ts.
    const suffixes = BUILTIN_FORMATS.map((f) => f.suffix.trim().toLowerCase());
    expect(new Set(suffixes).size, 'two built-ins share a suffix').toBe(suffixes.length);
  });

  it('🔴 no built-in suffix contains a character the generator eats', () => {
    // A `#` in a prompt is consumed SERVER-SIDE as a wildcard reference, so it
    // never reaches the model and silently changes the prompt. These suffixes are
    // appended to every prompt for their format, so one `#` here corrupts every
    // generation that format will ever produce.
    //
    // 🔴 THIS USED TO BE THE *ONLY* `#` CHECK ANYWHERE, which made it a guard over
    // the one population that cannot have the problem: these twelve literals are
    // code-reviewed, while a viewer's custom suffix is typed at runtime and was
    // checked for LENGTH only. The rule now lives in `suffixWildcardReason` and is
    // enforced on the save and publish paths; this assertion calls that same
    // predicate, so the built-ins are covered as a free byproduct rather than being
    // the whole of the coverage.
    for (const f of BUILTIN_FORMATS) {
      expect(
        suffixWildcardReason(f.suffix),
        `${f.id}'s suffix contains a wildcard character`,
      ).toBeNull();
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

  it('🔴 the default format is still `clickbait`, and still FIRST', () => {
    // A LITERAL, not `BUILTIN_FORMATS[0].id` — deriving it from the array would
    // re-state the implementation and pass for whatever happens to be first.
    // Adding formats must not move the default: `clickbait` is what an untouched
    // picker has selected, and it is what every default-selection test assumes.
    expect(DEFAULT_FORMAT_ID).toBe('clickbait');
    expect(BUILTIN_FORMATS[0].id).toBe('clickbait');
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

  /**
   * 🔴 THE WILDCARD RULE — the audit finding this closes, and what it actually was.
   *
   * `formats.test.ts` asserted no `#` across the twelve built-in literals: a guard
   * over the population that cannot have the problem, because those twelve are
   * code-reviewed. `validateCustomFormat` checked LENGTH only, and there was no `#`
   * sanitisation anywhere in `src/`. So a viewer typing `#` into their own format's
   * suffix silently corrupted every generation that format would ever make —
   * measured, not theorised: a suffix containing `#FF49BD` came back with
   * `targets.prompt[0].category = "FF49BD"`, the `#` and the word after it lifted
   * straight out of the paid prompt. Publishing such a format spread the corruption
   * to OTHER viewers' paid generations.
   *
   * ONE RULE, ONE PLACE: `suffixWildcardReason`, reached from `validateCustomFormat`
   * (save) and from the publish handler (App.tsx — asserted at the hook boundary in
   * App.formats.test.tsx, since that is the only surface that can see the argument
   * never reaching `shared.append`).
   */
  it('🔴 rejects a suffix containing the wildcard `#` — the custom path, not just built-ins', () => {
    // The literal the audit measured, and the generic case.
    expect(validateCustomFormat({ label: draft.label, suffix: 'neon glow #FF49BD rim light' })).toMatch(
      /#/,
    );
    expect(validateCustomFormat({ label: draft.label, suffix: '#' })).not.toBeNull();
    // Position does not matter — it is consumed wherever it appears.
    expect(validateCustomFormat({ label: draft.label, suffix: '#lead word' })).not.toBeNull();
    expect(validateCustomFormat({ label: draft.label, suffix: 'trailing hash #' })).not.toBeNull();
    // ...and a clean suffix is still accepted, so this is not rejecting everything.
    expect(validateCustomFormat({ label: draft.label, suffix: 'neon glow rim light' })).toBeNull();
  });

  it('the rejection tells the viewer WHY, not just that it was refused', () => {
    // Honest, specific copy: a bare "invalid character" leaves the viewer deleting
    // text at random. It must name the character and say what the generator does
    // with it, because the failure mode is SILENT — nothing errors at generate time.
    const why = validateCustomFormat({ label: draft.label, suffix: 'neon glow #FF49BD' })!;
    expect(why).toContain('#');
    expect(why).toMatch(/wildcard/i);
    expect(why).toMatch(/prompt/i);
  });

  it('🔴 the `#` rule is checked on SAVE and NOT on LOAD — a stored format stays loadable', () => {
    // 🔴 THE DIRECTION MATTERS AND IT IS ASSERTED BOTH WAYS. A viewer may already
    // have a stored suffix containing `#`: it was accepted before this rule existed.
    // Enforcing the rule in `parseCustomFormats` would make their saved format
    // vanish from their own picker on next load — deleting visible work to fix a
    // problem they did not cause, and with no message, because parse failures
    // degrade silently by design.
    const stored = [{ id: 'custom:77', label: 'Legacy', suffix: 'neon glow #FF49BD rim light' }];

    // LOAD: kept, verbatim, suffix and all.
    const loaded = parseCustomFormats(stored);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].suffix).toBe('neon glow #FF49BD rim light');
    // And it is a selectable format, not a husk.
    expect(customToFormat(loaded[0]).suffix).toContain('#');

    // SAVE: the very same value is refused, with the reason.
    expect(validateCustomFormat(loaded[0])).not.toBeNull();
    expect(validateCustomFormat(loaded[0])!).toMatch(/wildcard/i);

    // Control for the pair: a clean suffix is kept on load AND accepted on save,
    // so "kept on load" above is not just parse being indiscriminate about
    // everything, and "refused on save" is not validate refusing everything.
    const clean = [{ id: 'custom:78', label: 'Clean', suffix: 'neon glow rim light' }];
    expect(parseCustomFormats(clean)).toHaveLength(1);
    expect(validateCustomFormat(clean[0])).toBeNull();
  });

  it('🔴 `suffixWildcardReason` is the single predicate both paths call', () => {
    // A direct test of the shared rule, so a future caller has something to point
    // at and the two call sites are not each asserting their own copy of it.
    expect(suffixWildcardReason('clean text')).toBeNull();
    expect(suffixWildcardReason('')).toBeNull();
    expect(suffixWildcardReason('has a # in it')).not.toBeNull();
    expect(WILDCARD_CHAR).toBe('#');
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
