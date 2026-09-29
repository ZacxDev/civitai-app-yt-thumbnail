import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ULTRAWIDE_MIN } from './layout.js';
import { isUltrawideWidth, useUltrawide } from './useUltrawide.js';

// The app-owned ultrawide hook, at its own boundary.
//
// 🔴 THE STUBS ARE THE WHOLE TEST — the same warning `responsive.test.tsx` carries
// about `useBlockBreakpoint`, for the same reason: jsdom implements no
// `ResizeObserver` and lays nothing out, so without a stub this hook takes its
// `typeof ResizeObserver === 'undefined'` early return, never measures, and
// reports `false` at every width. A test written without the stub would pass the
// "not ultrawide" assertion for a reason that has nothing to do with the code, and
// could never observe the `true` branch at all.
//
// This file's stub differs from `responsive.test.tsx`'s in one way that matters:
// that one is INERT (the hook's synchronous `clientWidth` seed is the only path it
// needs), whereas the memoisation claim here is about what happens when the
// observer FIRES, so this one is controllable.

/** The width every element reports for the duration of one test. */
let blockWidth = 0;
let restoreClientWidth: (() => void) | undefined;
let restoreResizeObserver: (() => void) | undefined;

type Entry = { contentRect: { width: number } };
type Callback = (entries: Entry[]) => void;

/** Live observers, so a test can drive a resize. */
const live: { cb: Callback; el: Element }[] = [];

class ControllableResizeObserver {
  constructor(private readonly cb: Callback) {}
  observe(el: Element) {
    live.push({ cb: this.cb, el });
  }
  unobserve() {}
  disconnect() {
    for (let i = live.length - 1; i >= 0; i -= 1) {
      if (live[i].cb === this.cb) live.splice(i, 1);
    }
  }
}

function installStubs(width: number) {
  blockWidth = width;

  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => blockWidth,
  });
  restoreClientWidth = () => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    if (original) Object.defineProperty(Element.prototype, 'clientWidth', original);
  };

  const prior = (globalThis as unknown as Record<string, unknown>).ResizeObserver;
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = ControllableResizeObserver;
  restoreResizeObserver = () => {
    (globalThis as unknown as Record<string, unknown>).ResizeObserver = prior;
  };
}

/** Drive every live observer with a new width, flushed through React. */
function resizeTo(width: number) {
  blockWidth = width;
  act(() => {
    for (const o of [...live]) o.cb([{ contentRect: { width } }]);
  });
}

/** Drive the observers with an EMPTY entry list — the `?? el.clientWidth` path. */
function resizeWithNoEntries(width: number) {
  blockWidth = width;
  act(() => {
    for (const o of [...live]) o.cb([]);
  });
}

let renders = 0;

function Probe({ threshold }: { threshold?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const ultrawide = useUltrawide(ref, threshold);
  renders += 1;
  return <div ref={ref} data-testid="probe" data-ultrawide={String(ultrawide)} />;
}

function readFlag(): string {
  return screen.getByTestId('probe').getAttribute('data-ultrawide') ?? 'missing';
}

describe('isUltrawideWidth', () => {
  // The pure half, so the boundary is pinned without a DOM in the way.
  it.each([
    [1, false],
    [1799, false],
    [ULTRAWIDE_MIN, true],
    [1801, true],
    [2560, true],
  ])('%ipx -> %s at the default threshold', (width, expected) => {
    expect(isUltrawideWidth(width as number)).toBe(expected);
  });

  it('the boundary is AT the threshold, not above it', () => {
    // `>=` vs `>` is the one-character mutation this catches; 1799/1800/1801 is the
    // only triple that can see it.
    expect(isUltrawideWidth(ULTRAWIDE_MIN - 1)).toBe(false);
    expect(isUltrawideWidth(ULTRAWIDE_MIN)).toBe(true);
    expect(isUltrawideWidth(ULTRAWIDE_MIN + 1)).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])(
    'an unmeasurable width (%p) is NOT ultrawide',
    (width) => {
      // The conservative branch, matching `resolveBlockTier`'s treatment of an
      // unmeasured width as `base`. Note `Infinity >= 1800` is TRUE, so the
      // finiteness guard is load-bearing rather than decorative.
      expect(isUltrawideWidth(width as number)).toBe(false);
    },
  );

  it('honours an explicit threshold', () => {
    expect(isUltrawideWidth(1300, 1200)).toBe(true);
    expect(isUltrawideWidth(1300, 1400)).toBe(false);
  });
});

describe('useUltrawide', () => {
  afterEach(() => {
    live.length = 0;
    renders = 0;
    restoreClientWidth?.();
    restoreClientWidth = undefined;
    restoreResizeObserver?.();
    restoreResizeObserver = undefined;
  });

  it('seeds synchronously from clientWidth — an ultrawide block reports true on mount', () => {
    // 1907 is inside `xl` and above 1800, and equals no constant either side
    // names.
    installStubs(1907);
    render(<Probe />);
    expect(readFlag()).toBe('true');
  });

  it('a wide-but-not-ultrawide block reports false', () => {
    // 1523 is the live-desktop shape: `xl`, three columns, NOT four.
    installStubs(1523);
    render(<Probe />);
    expect(readFlag()).toBe('false');
  });

  it('with no ResizeObserver at all it stays false and never touches the DOM', () => {
    // SSR, and plain jsdom. `clientWidth` is stubbed to an ultrawide value, so a
    // `true` here would prove the early return is gone.
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 2560,
    });
    const prior = (globalThis as unknown as Record<string, unknown>).ResizeObserver;
    delete (globalThis as unknown as Record<string, unknown>).ResizeObserver;
    try {
      render(<Probe />);
      expect(readFlag()).toBe('false');
      expect(live).toHaveLength(0);
    } finally {
      (globalThis as unknown as Record<string, unknown>).ResizeObserver = prior;
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
      if (original) Object.defineProperty(Element.prototype, 'clientWidth', original);
    }
  });

  // 🔴 THE MEMOISATION CLAIM. A `ResizeObserver` fires on every pixel; the whole
  // reason this hook resolves to a BOOLEAN is that dragging a window edge inside
  // one bucket must cost zero renders. That is a claim about render COUNT, so it is
  // measured as one.
  //
  // 🔴 AND THE BUCKET HAS TO BE ENTERED BY A CROSSING FIRST, OR THE TEST IS
  // VACUOUS. This was found by mutation: deleting the hook's
  // `if (last.current === next) return;` gate left an earlier version of these two
  // tests completely GREEN, because React's own same-value bail-out was doing the
  // deduping. React's documented caveat is that the bail-out "may still render the
  // component one more time" — and measured here, it renders exactly one more time
  // on the FIRST same-value `setState` after a real change, then stops. So a test
  // that never causes a real change can never observe the gate at all. Both cases
  // below therefore cross the boundary, and only then move inside the new bucket.
  // Measured with the gate removed: 2 → 3 renders. With it: 2 → 2.
  it('after entering the ultrawide bucket, moving inside it re-renders ZERO times', () => {
    // 🔴 THE MOUNT SEED MUST ITSELF BE A REAL CHANGE, or React's bail-out chain
    // absorbs the caveat before the measurement and the gate goes unobserved again.
    // Measured: mounting at 700 (seed false == initial state, so no real change)
    // left this case green with the gate deleted, while the mirror case below —
    // which mounts at 1907 and therefore changes state at the seed — went red. So
    // this one mounts ultrawide too, and reaches the bucket under test by crossing
    // out and back.
    installStubs(1907);
    render(<Probe />);
    expect(readFlag()).toBe('true');

    resizeTo(700);
    expect(readFlag()).toBe('false');

    resizeTo(1907);
    expect(readFlag()).toBe('true');

    const before = renders;
    // 653px of movement, all of it inside the ultrawide bucket.
    resizeTo(1908);
    resizeTo(2000);
    resizeTo(2413);
    resizeTo(2560);
    expect(renders).toBe(before);
    expect(readFlag()).toBe('true');
  });

  it('the same is true inside the NOT-ultrawide bucket', () => {
    // The mirror case. Without it, a hook that hardcoded `true` would pass the
    // test above.
    installStubs(1907);
    render(<Probe />);
    expect(readFlag()).toBe('true');

    resizeTo(700);
    expect(readFlag()).toBe('false');

    const before = renders;
    resizeTo(701);
    resizeTo(1099);
    resizeTo(1523);
    resizeTo(1799);
    expect(renders).toBe(before);
    expect(readFlag()).toBe('false');
  });

  it('crossing the boundary DOES re-render, exactly once per crossing', () => {
    // The positive control for the counter: if the count never moved, the two
    // zero-render assertions above would be indistinguishable from a hook wired to
    // nothing.
    installStubs(1523);
    render(<Probe />);
    expect(readFlag()).toBe('false');

    const before = renders;
    resizeTo(1907);
    expect(readFlag()).toBe('true');
    const afterUp = renders;
    expect(afterUp).toBeGreaterThan(before);

    resizeTo(1523);
    expect(readFlag()).toBe('false');
    expect(renders).toBeGreaterThan(afterUp);
  });

  it('falls back to clientWidth when the observer entry carries no rect', () => {
    installStubs(1523);
    render(<Probe />);
    expect(readFlag()).toBe('false');

    resizeWithNoEntries(1907);
    expect(readFlag()).toBe('true');
  });

  it('honours a custom threshold at mount', () => {
    installStubs(1301);
    render(<Probe threshold={1200} />);
    expect(readFlag()).toBe('true');
  });

  it('a threshold change does NOT re-seed on a later render — and that is deliberate', () => {
    // The ref-holder discipline, stated as behaviour: `threshold` is held in a ref
    // and is never an effect dependency, so a caller recomputing it inline cannot
    // cause a tear-down/re-observe (and a stale re-seed) on every render. The
    // consequence is that a *changed* threshold lands on the next MEASUREMENT.
    //
    // 🔴 THE FIRST RERENDER IS NOT A NO-OP AND THE TEST HAS TO ACCOUNT FOR IT. The
    // effect's one dependency is the OBSERVED ELEMENT, read during render — which
    // is `null` on the very first render (refs are assigned before effects, so the
    // effect itself still sees the element, but the dependency it captured does
    // not). The next render is therefore the one where the dependency transitions
    // null → element and the effect legitimately re-runs once. So the threshold
    // change is made AFTER that has settled; asserting it on the first rerender
    // would be measuring the settle, not the ref discipline.
    installStubs(1523);
    const { rerender } = render(<Probe threshold={1800} />);
    expect(readFlag()).toBe('false');

    // Settle the element dependency at the ORIGINAL threshold.
    rerender(<Probe threshold={1800} />);
    expect(readFlag()).toBe('false');

    // Now change it. 1523 is above 1400, so a re-seed here would flip the flag.
    rerender(<Probe threshold={1400} />);
    expect(readFlag()).toBe('false');

    // The next measurement picks the new threshold up.
    resizeTo(1523);
    expect(readFlag()).toBe('true');
  });

  it('disconnects its observer on unmount', () => {
    installStubs(1907);
    const { unmount } = render(<Probe />);
    expect(live.length).toBeGreaterThan(0);
    unmount();
    expect(live).toHaveLength(0);
  });
});
