import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { ULTRAWIDE_MIN } from './layout.js';

/**
 * "Is this block ultrawide?" — the one width question the SDK cannot answer.
 *
 * 🔴 WHY THIS EXISTS AT ALL. `useBlockBreakpoint`'s top tier `xl` is UNBOUNDED:
 * measured through the real `resolveBlockTier`, 1440px and 2560px both resolve to
 * `'xl'`, so a fourth column has no tier to hang off. And the hook deliberately
 * does not expose a raw width — its own docs say doing so "would either force a
 * render per pixel or be a lie (a width that only updates when the tier changes)".
 * So the app owns this threshold, or it does not have it.
 *
 * 🔴 THIS MIRRORS THE SDK HOOK'S DISCIPLINE, DELIBERATELY, LINE FOR LINE:
 *
 *  - It resolves to a **boolean**, never a width. A raw width is never returned,
 *    never stored in state, and never put on the DOM — the whole re-render
 *    argument above applies identically to an app-owned observer.
 *  - The dedupe is a `useRef` compare, NOT `setState(prev => prev === next ? prev
 *    : next)`. React's same-value bail-out is documented to still re-render the
 *    component once more before it takes effect, so the first no-op resize after a
 *    real crossing would still cost a render. Same `lastTier`/`lastHeight` idiom
 *    the SDK's own hooks use.
 *  - The effect keys on the observed ELEMENT, not on the ref wrapper's identity. A
 *    caller writing `useUltrawide({ current: el })` inline would otherwise tear
 *    down and re-observe on every render, re-running the synchronous seed against
 *    a stale width each time.
 *  - It seeds synchronously from `clientWidth` right after `observe()`, because
 *    `observe()` only SCHEDULES its first callback and without the seed the block
 *    paints one frame at the wrong layout even though the width is already
 *    knowable. It is also the only path a jsdom test can exercise, since jsdom
 *    ships no `ResizeObserver` at all.
 *  - With no `ResizeObserver` (SSR, or jsdom without a stub) it stays `false` and
 *    never touches the DOM. `false` is the conservative branch: a block that is
 *    not known to be ultrawide gets the 3-column layout, never the 4-column one.
 *
 * @param ref - element to measure. Omit to measure `document.documentElement`,
 *   which inside the block's sandboxed iframe IS the slot the host handed us.
 * @param threshold - px width at or above which the block counts as ultrawide.
 *   Defaults to `ULTRAWIDE_MIN` (1800).
 */
export function useUltrawide(
  ref?: RefObject<HTMLElement | null>,
  threshold: number = ULTRAWIDE_MIN,
): boolean {
  const [ultrawide, setUltrawide] = useState(false);

  // Held in refs and NEVER used as effect dependencies — see the note above about
  // the ref wrapper's identity. `threshold` gets the same treatment so a caller
  // computing it inline does not re-seed on every render.
  const refHolder = useRef(ref);
  refHolder.current = ref;
  const thresholdHolder = useRef(threshold);
  thresholdHolder.current = threshold;

  // The element is the real dependency: it also picks up an element that mounts
  // on a later render, which a ref wrapper's identity would not.
  const target = ref === undefined ? undefined : ref.current;

  // Last value pushed into state. `null` = nothing pushed yet.
  const last = useRef<boolean | null>(null);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;

    const caller = refHolder.current;
    const el = caller
      ? caller.current
      : typeof document === 'undefined'
        ? null
        : document.documentElement;
    if (!el) return;

    const apply = (width: number) => {
      const next = isUltrawideWidth(width, thresholdHolder.current);
      // The whole re-render guard: only a BUCKET CHANGE reaches the caller.
      if (last.current === next) return;
      last.current = next;
      setUltrawide(next);
    };

    const observer = new ResizeObserver((entries) => {
      apply(entries[0]?.contentRect.width ?? el.clientWidth);
    });
    observer.observe(el);
    apply(el.clientWidth);

    return () => observer.disconnect();
  }, [target]);

  return ultrawide;
}

/**
 * The predicate, extracted so it can be unit-tested without a DOM.
 *
 * A non-finite width (`NaN` from an unmeasured element, `Infinity` from a broken
 * observer entry) is NOT ultrawide — the conservative branch, matching
 * `resolveBlockTier`'s own treatment of an unmeasured width as `'base'`.
 */
export function isUltrawideWidth(width: number, threshold: number = ULTRAWIDE_MIN): boolean {
  return Number.isFinite(width) && width >= threshold;
}
