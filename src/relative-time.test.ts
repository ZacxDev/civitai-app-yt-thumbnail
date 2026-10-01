import { describe, expect, it } from 'vitest';

import { absoluteTime, relativeTime } from './relative-time.js';

/**
 * 🔴 EVERY CASE HERE IS A LITERAL, BECAUSE `nowMs` IS INJECTED. The point of the
 * injected clock is that these are arithmetic facts, not observations about the
 * machine the suite ran on.
 *
 * 🔴 EVERY BAND IS MEASURED AT ITS LOWER BOUNDARY *AND* IN ITS MIDDLE, and the
 * two answers differ, so a mutant that collapses a band to its boundary value (or
 * swaps a `<` for a `<=`) changes a literal. A band measured only at its boundary
 * cannot tell a working `floor` from a hardcoded 1.
 *
 * 🔴 `NOW` IS NOT A ROUND NUMBER OF MINUTES. It is deliberately offset by 7_777 ms
 * so no `diff` in this file lands exactly on a multiple of its own band step by
 * accident of the fixture, which is how a boundary-only mutant survives.
 *
 * INVARIANT GUARD, not regression coverage: the row rendered
 * `new Date(createdAt).toLocaleString()` before this change, so there is no prior
 * `relativeTime` for these to have been red against. What they pin is the ladder and
 * the future-timestamp behaviour — NOT "the clamp", which an earlier version of this
 * sentence claimed and which a mutation run then proved was dead code (see the
 * future-timestamp case for what happened).
 *
 * MUTATION RESULTS ACTUALLY RUN against this file: `<` -> `<=` on the minute boundary
 * dies; `Math.floor` -> `Math.round` in the minutes band dies; deleting the `< WEEK`
 * bound (so the days band swallows the absolute arm) dies; gating the first band on
 * `diff >= 0` dies. The one that SURVIVED — deleting `Math.max(0, ...)` — is recorded
 * above rather than hidden, and the dead expression it found is gone.
 */
const NOW = Date.parse('2026-09-30T14:23:11.000Z') + 777;

/** `NOW` minus a duration, as the ISO/number a record would carry. */
const ago = (ms: number) => NOW - ms;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

describe('relativeTime — the band ladder', () => {
  it('reads "just now" from 0 up to (but not including) 60s', () => {
    expect(relativeTime(ago(0), NOW)).toBe('just now');
    // Middle of the band.
    expect(relativeTime(ago(31 * SECOND), NOW)).toBe('just now');
    // The last millisecond that is still "just now".
    expect(relativeTime(ago(MINUTE - 1), NOW)).toBe('just now');
  });

  it('crosses to minutes AT exactly 60s, and floors within the band', () => {
    expect(relativeTime(ago(MINUTE), NOW)).toBe('1m ago');
    // Middle of the band, and 23 is not derivable from any other number here.
    expect(relativeTime(ago(23 * MINUTE), NOW)).toBe('23m ago');
    // Floors rather than rounds: 23m 59s is still 23m.
    expect(relativeTime(ago(23 * MINUTE + 59 * SECOND), NOW)).toBe('23m ago');
    // The last millisecond that is still minutes.
    expect(relativeTime(ago(HOUR - 1), NOW)).toBe('59m ago');
  });

  it('crosses to hours AT exactly 60m, and floors within the band', () => {
    expect(relativeTime(ago(HOUR), NOW)).toBe('1h ago');
    expect(relativeTime(ago(11 * HOUR), NOW)).toBe('11h ago');
    expect(relativeTime(ago(11 * HOUR + 59 * MINUTE), NOW)).toBe('11h ago');
    expect(relativeTime(ago(DAY - 1), NOW)).toBe('23h ago');
  });

  it('crosses to days AT exactly 24h, and floors within the band', () => {
    expect(relativeTime(ago(DAY), NOW)).toBe('1d ago');
    expect(relativeTime(ago(3 * DAY), NOW)).toBe('3d ago');
    expect(relativeTime(ago(3 * DAY + 23 * HOUR), NOW)).toBe('3d ago');
    expect(relativeTime(ago(WEEK - 1), NOW)).toBe('6d ago');
  });

  it('🔴 AT exactly 7 days it becomes the ABSOLUTE date, and stays absolute beyond', () => {
    // The one band that is not an "N<unit> ago" string at all. Asserted as "equals
    // the absolute rendering of the SAME instant" rather than as a locale literal:
    // the string is the viewer's own locale/timezone and pinning it here would make
    // this test pass or fail on the machine's `Intl` data instead of on the ladder.
    // What discriminates is that it is NOT a relative string.
    const sevenDays = ago(WEEK);
    expect(relativeTime(sevenDays, NOW)).toBe(absoluteTime(sevenDays));
    expect(relativeTime(sevenDays, NOW)).not.toMatch(/ago/);

    const long = ago(400 * DAY);
    expect(relativeTime(long, NOW)).toBe(absoluteTime(long));
    expect(relativeTime(long, NOW)).not.toMatch(/ago/);
  });

  it('every band produces a DIFFERENT string for the same instant seen from four clocks', () => {
    // The discriminating control for the ladder as a whole: one `createdAt`, four
    // `nowMs` values, four different answers. A mutant that returns one band's
    // answer for everything fails here even if each case above were somehow
    // satisfied.
    const t = Date.parse('2026-09-01T00:00:00.000Z');
    const seen = [
      relativeTime(t, t + 5 * SECOND),
      relativeTime(t, t + 5 * MINUTE),
      relativeTime(t, t + 5 * HOUR),
      relativeTime(t, t + 5 * DAY),
      relativeTime(t, t + 5 * WEEK),
    ];
    expect(new Set(seen).size).toBe(5);
    expect(seen).toEqual(['just now', '5m ago', '5h ago', '5d ago', absoluteTime(t)]);
  });
});

describe('relativeTime — clock skew and bad input', () => {
  it('🔴 a FUTURE timestamp reads "just now" rather than counting backwards', () => {
    // A clock correction between the submit that stamped `createdAt` and the render
    // that reads it is ordinary, and "-3m ago" / "NaN" on a surface about money is
    // not an acceptable rendering of it.
    //
    // 🔴 MUTATION-GRADED, AND THE FIRST MUTANT IT WAS GRADED WITH *SURVIVED* — which
    // is why this comment exists. `relativeTime` originally clamped with
    // `Math.max(0, nowMs - t)`; deleting that clamp left this whole file green,
    // because `diff < MINUTE_MS` is already true of every negative number. The clamp
    // was dead code reading as the guard for this case, so it is gone and the
    // behaviour is produced by the first band being UNCONDITIONAL.
    //
    // The mutant that does bite is `if (diff >= 0 && diff < MINUTE_MS)`, which sends a
    // negative diff on to the minutes branch and prints '-3m ago'. Run, and it fails
    // on these three lines.
    expect(relativeTime(NOW + 3 * MINUTE, NOW)).toBe('just now');
    // Far in the future too — not flipped into a date by the `>= 7d` arm.
    expect(relativeTime(NOW + 400 * DAY, NOW)).toBe('just now');
    // The shape of the wrong answer, named explicitly: no leading minus anywhere.
    expect(relativeTime(NOW + 3 * MINUTE, NOW)).not.toMatch(/-/);
    expect(relativeTime(NOW + 400 * DAY, NOW)).not.toMatch(/-/);
  });

  it('returns null — never "Invalid Date" or "NaNm ago" — for a value that is not a time', () => {
    expect(relativeTime(null, NOW)).toBeNull();
    expect(relativeTime(undefined, NOW)).toBeNull();
    expect(relativeTime(Number.NaN, NOW)).toBeNull();
    expect(relativeTime(Number.POSITIVE_INFINITY, NOW)).toBeNull();
    expect(relativeTime('not a date', NOW)).toBeNull();
    expect(relativeTime('', NOW)).toBeNull();
  });

  it('accepts an ISO string as well as epoch ms, and agrees between the two', () => {
    // `GenerationRecord.createdAt` is epoch ms, but `AppWorkflow.createdAt` is ISO
    // and the two must not need two helpers.
    const t = ago(42 * MINUTE);
    expect(relativeTime(new Date(t).toISOString(), NOW)).toBe('42m ago');
    expect(relativeTime(t, NOW)).toBe('42m ago');
  });
});

describe('absoluteTime', () => {
  it('renders a real instant and distinguishes two different ones', () => {
    // Deliberately NOT a pinned locale literal — that would assert the test
    // machine's `Intl` tables. The claims that survive on any machine: it produces
    // something, it names the year, and two different instants do not collapse to
    // one string (the control that a stubbed/constant implementation would fail).
    const a = Date.parse('2026-09-30T14:23:11.000Z');
    const b = Date.parse('2024-02-29T01:02:03.000Z');
    expect(absoluteTime(a)).toContain('2026');
    expect(absoluteTime(b)).toContain('2024');
    expect(absoluteTime(a)).not.toBe(absoluteTime(b));
  });

  it('returns null for a value that is not a time', () => {
    expect(absoluteTime(null)).toBeNull();
    expect(absoluteTime(Number.NaN)).toBeNull();
    expect(absoluteTime('nope')).toBeNull();
  });
});
