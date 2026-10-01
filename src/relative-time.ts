// "3m ago" for a history row's timestamp. Pure, no DOM, no clock.
//
// 🔴 `nowMs` IS AN ARGUMENT AND MUST STAY ONE. A helper that read `Date.now()`
// itself could only ever be tested against whatever the test machine's clock said
// at that instant — i.e. it would pass by accident of the environment, and the
// band boundaries (the only interesting part) would be untestable. Injecting
// "now" is what makes every case below a literal.

/** Milliseconds in each band, smallest first. One statement of the ladder. */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * A human gap between `createdAt` and `nowMs`, or `null` when `createdAt` is not
 * a time at all.
 *
 * The ladder, with the comparison that decides each band:
 *
 *   diff < 60s    'just now'
 *   diff < 60m    'Nm ago'      N = floor(diff / 60s)
 *   diff < 24h    'Nh ago'      N = floor(diff / 60m)
 *   diff < 7d     'Nd ago'      N = floor(diff / 24h)
 *   diff >= 7d    the absolute date (see {@link absoluteTime})
 *
 * Every bound is STRICT, so a value exactly on a boundary belongs to the band
 * ABOVE it: 60_000 is '1m ago', not 'just now'; exactly 7 days is a date.
 *
 * 🔴 A FUTURE TIMESTAMP READS 'just now', NOT '-3m ago', AND THE LADDER ITSELF IS
 * WHAT GUARANTEES IT — there is deliberately NO `Math.max(0, ...)` here. `createdAt`
 * is stamped from `Date.now()` in the viewer's OWN browser at submit time, but the
 * row is re-rendered against a `nowMs` from a later render, possibly after the
 * machine's clock was corrected (NTP step, a laptop waking from sleep, a
 * deliberately-wrong clock) — so `createdAt > nowMs` is reachable without anything
 * being broken, and '-3m ago' on a surface about money is not an acceptable
 * rendering of it.
 *
 * 🔴 THE CLAMP THAT USED TO BE ON THE LINE BELOW WAS DEAD CODE, AND A MUTATION RUN
 * IS WHAT PROVED IT: deleting `Math.max(0, ...)` left all 11 cases in
 * `relative-time.test.ts` GREEN — including both future-timestamp cases — because
 * `diff < MINUTE_MS` is already true of EVERY negative number. So the clamp read as
 * the thing making the future safe while contributing nothing, and the comment here
 * claimed it was "the honest answer" to a case the first band had already absorbed.
 * It is gone, the claim is corrected, and the behaviour is unchanged.
 *
 * What DOES have to hold is that the first band stays UNCONDITIONAL. A guard like
 * `if (diff >= 0 && diff < MINUTE_MS)` would send a negative diff on to the minutes
 * branch and print '-3m ago'; that mutant is run against the future cases in the test
 * file, and it dies there.
 */
export function relativeTime(
  createdAt: number | string | null | undefined,
  nowMs: number,
): string | null {
  const t = toEpochMs(createdAt);
  if (t === null) return null;
  const diff = nowMs - t;
  // Unconditional, and load-bearing for a NEGATIVE `diff` — see above.
  if (diff < MINUTE_MS) return 'just now';
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`;
  if (diff < WEEK_MS) return `${Math.floor(diff / DAY_MS)}d ago`;
  return absoluteTime(t);
}

/**
 * The full local date + time, for the `title` attribute and for the oldest band.
 *
 * Locale- and timezone-dependent on purpose: it is the viewer's own clock being
 * reported, and this is the one place in the row where no precision is dropped.
 * `null` for a value that is not a time.
 */
export function absoluteTime(createdAt: number | string | null | undefined): string | null {
  const t = toEpochMs(createdAt);
  return t === null ? null : new Date(t).toLocaleString();
}

/**
 * Epoch ms from whatever a stored record carried, or `null`.
 *
 * `GenerationRecord.createdAt` is typed `number` and `parseRecord` rejects a
 * non-finite one, so the string and nullish arms are not reachable from a parsed
 * record today. They are here because this module is the renderer's only
 * arithmetic on that field and an unparseable value must produce an absent
 * timestamp rather than the string "Invalid Date" on a surface about money.
 */
function toEpochMs(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
