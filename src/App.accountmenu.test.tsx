import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from './App.js';
import { BuzzBolt } from './icons.js';
import { installMockMoneyHost } from './mock-buzz.js';
import { BUZZ_TYPE_COLOR, THEMES, palette, type ThemeName } from './palette.js';

/**
 * THE "SPEND FROM" CONTROL IS GONE — SPENDING IS ALWAYS AUTO.
 *
 * Operator, 2026-10-18: the Buzz type selector is hidden and the app always
 * uses Auto. The hand-built dropdown this file used to pin (trigger, popup
 * menu, keyboard operation, portal-against-clipping, `menuBoxFor` geometry)
 * was deleted with it, and its tests went with it — a deleted control gets an
 * ABSENCE pin, not a museum. What survives here:
 *
 *   • the absence itself, asserted on the rendered app;
 *   • the Buzz bolt's colours, which did NOT go with the menu — the history
 *     row still stamps the funding pool with the same glyph (`BuzzBolt` in
 *     icons.tsx), so the colour mirror and the `auto` neutral are still live
 *     claims. They are asserted on the component directly now.
 *
 * The Auto behaviour at the wire (ladder picks the first sufficient pool,
 * Auto omits `accountType` when none is sufficient) is pinned in
 * e2e.test.tsx, where it always also lived.
 */

const VIEWER = { viewer: { id: 2, username: 'dev', status: 'active' as const } };

describe('there is no Buzz pool selector', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  it('renders no trigger, no menu and no per-pool rows', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER });
    render(<App />);
    await screen.findByTestId('pm-generate');

    expect(screen.queryByTestId('pm-account-trigger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pm-account-menu')).not.toBeInTheDocument();
    for (const pool of ['auto', 'blue', 'green', 'yellow'] as const) {
      expect(screen.queryByTestId(`pm-account-${pool}`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`pm-account-icon-${pool}`)).not.toBeInTheDocument();
    }
    // The price has exactly one home now: the Generate button itself.
    expect(screen.queryByTestId('pm-account-trigger-cost')).not.toBeInTheDocument();
  });
});

describe.each(THEMES)('the Buzz bolt in the %s theme', (theme: ThemeName) => {
  const own = palette[theme];
  const other = palette[theme === 'dark' ? 'light' : 'dark'];

  it('paints each pool its own Civitai currency colour', () => {
    // 🔴 THE LITERAL HEXES, WRITTEN OUT. `BUZZ_TYPE_COLOR` is a MIRROR of
    // civitai/civitai's `currency-theme.constants.ts`; asserting the rendered
    // fill against the constant alone would pass if the mirror itself drifted,
    // so the literals are spelled here too and the constant is checked against
    // them. Three distinct values, so a component painting one colour for all
    // three pools cannot survive.
    for (const choice of ['blue', 'green', 'yellow'] as const) {
      const { container } = render(<BuzzBolt choice={choice} pal={own} testId={`bolt-${choice}`} />);
      expect(container.querySelector('svg')).toHaveAttribute('fill', BUZZ_TYPE_COLOR[choice]);
    }
    expect(BUZZ_TYPE_COLOR).toEqual({
      blue: '#4dabf7',
      green: '#40c057',
      yellow: '#f59f00',
    });
  });

  it('gives `auto` THIS theme’s neutral, because it is not a Buzz type at all', () => {
    const { container } = render(<BuzzBolt choice="auto" pal={own} testId="bolt-auto" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('fill', own.textDim);
    expect(svg).not.toHaveAttribute('fill', other.textDim);
    // And it is none of the three pool colours: Auto must not look like a pick.
    expect(Object.values(BUZZ_TYPE_COLOR)).not.toContain(own.textDim);
  });

  it('🔴 never carries the distinction by COLOUR ALONE', () => {
    // WCAG 1.4.1: the bolt is decorative (`aria-hidden`) wherever it renders —
    // in the history row it sits beside text naming the same pool.
    const { container } = render(<BuzzBolt choice="blue" pal={own} testId="bolt-blue" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
