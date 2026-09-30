import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from './App.js';
import { ACCOUNT_CHOICES } from './generation.js';
import { DEFAULT_MOCK_BALANCE, installMockMoneyHost } from './mock-buzz.js';
import { BUZZ_TYPE_COLOR, THEMES, palette, type ThemeName } from './palette.js';

/**
 * THE "SPEND FROM" CONTROL, AFTER IT BECAME A DROPDOWN WITH BUZZ-TYPE ICONS.
 *
 * 🔴 WHY THIS IS A HAND-BUILT MENU AND NOT THE PACK'S `Select`, RESTATED HERE
 * BECAUSE IT IS WHAT THESE TESTS ARE SHAPED BY. `@civitai/blocks-react`'s
 * `Select` wraps a NATIVE `<select>`; its `SelectOption.label` is typed
 * `React.ReactNode` but renders into an `<option>`, and no browser paints an SVG
 * inside one. The per-pool bolt is the whole point of the control, so the pack's
 * Select structurally cannot deliver it. Buttons can — hence a trigger + a
 * `role="menu"` popup, and hence the keyboard cases below, which a native select
 * would have got for free.
 *
 * 🔴 RED/GREEN MATRIX. At the base ref (ed88fd5) "Spend from" was a
 * `role="radiogroup"` row of four always-rendered buttons with no icon, no
 * balance and no price. Every case here fails there:
 *   • `pm-account-trigger`, `pm-account-menu`, `pm-account-icon-*` and
 *     `pm-account-trigger-cost` do not exist — `getByTestId` throws;
 *   • `BUZZ_TYPE_COLOR` is not exported from `palette.ts` — the import fails.
 * So this file is BEHAVIOUR coverage for a new control, NOT regression coverage
 * for a defect that happened. The one claim it carries forward from the old
 * control — Auto omits `accountType` from the submit body — is pinned both here
 * and, unchanged, in `e2e.test.tsx`.
 *
 * 🔴 NOT VERIFIED IN A REAL BROWSER. This repo has no browser driver; every claim
 * here is jsdom plus arithmetic. In particular jsdom lays nothing out, so the
 * popup's POSITION is not tested — only its existence, roles, colours and
 * keyboard behaviour.
 */

const VIEWER = { viewer: { id: 2, username: 'dev', status: 'active' as const } };

/** The icon element for one choice, inside the open menu. */
const iconFor = (choice: string) => screen.getByTestId(`pm-account-icon-${choice}`);

describe('the Buzz-account dropdown', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  it('is a menu button that starts CLOSED and names the current pool', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER });
    render(<App />);

    const trigger = await screen.findByTestId('pm-account-trigger');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('pm-account-menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('pm-account-trigger-label')).toHaveTextContent('Auto');
  });

  it('shows the CLICK PRICE on the trigger, and it is the summed estimate', async () => {
    // The native control shows the cost on its trigger. This one shows the same
    // figure the Generate button quotes — the aggregate over the runs — rather
    // than a second calculation that could disagree with it.
    const submitted: unknown[] = [];
    uninstall = installMockMoneyHost({
      ...VIEWER,
      consentGranted: true,
      cost: 8,
      pollsUntilDone: 2,
      onOutbound: (m) => {
        if (m.type === 'SUBMIT_WORKFLOW') submitted.push(m);
      },
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');

    // Nothing priced yet — it says so rather than inventing a number.
    expect(screen.getByTestId('pm-account-trigger-cost')).toHaveTextContent(/not priced yet/i);

    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));
    await screen.findByAltText(/generated result/i, {}, { timeout: 5000 });

    // One format, priced at 8 by the mock host.
    expect(screen.getByTestId('pm-account-trigger-cost')).toHaveTextContent('8 Buzz');
    expect(screen.getByTestId('pm-generate')).toHaveTextContent('8 Buzz');
    expect(submitted).toHaveLength(1);
  });

  it('opens a "Pay with" menu listing every pool WITH ITS BALANCE', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER, buzzBalance: DEFAULT_MOCK_BALANCE });
    const user = userEvent.setup();
    render(<App />);

    const trigger = await screen.findByTestId('pm-account-trigger');
    await user.click(trigger);

    const menu = screen.getByTestId('pm-account-menu');
    expect(menu).toHaveAttribute('role', 'menu');
    expect(menu).toHaveAccessibleName('Pay with');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);

    // Every choice the model offers has a row, with the menu-radio role that
    // says "exactly one of these is chosen".
    for (const choice of ACCOUNT_CHOICES) {
      const item = screen.getByTestId(`pm-account-${choice}`);
      expect(item).toHaveAttribute('role', 'menuitemradio');
      expect(item).toHaveAttribute('aria-checked', choice === 'auto' ? 'true' : 'false');
    }

    // The balances, as the native "Pay with" menu lists them. Literal figures,
    // all three distinct, so a row rendering the wrong pool's number shows.
    expect(screen.getByTestId('pm-account-blue')).toHaveTextContent('1,500');
    expect(screen.getByTestId('pm-account-green')).toHaveTextContent('250');
    expect(screen.getByTestId('pm-account-yellow')).toHaveTextContent('6,000');
  });

  it('picking a pool closes the menu, moves the trigger, and returns focus', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER });
    const user = userEvent.setup();
    render(<App />);

    const trigger = await screen.findByTestId('pm-account-trigger');
    await user.click(trigger);
    await user.click(screen.getByTestId('pm-account-yellow'));

    expect(screen.queryByTestId('pm-account-menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('pm-account-trigger-label')).toHaveTextContent('Yellow');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(trigger);
  });

  it('a pointer press OUTSIDE the control dismisses it', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByTestId('pm-account-trigger'));
    expect(screen.getByTestId('pm-account-menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByTestId('pm-account-menu')).not.toBeInTheDocument());
  });

  it('a zero-balance pool stays SELECTABLE and is merely annotated', async () => {
    // The semantics the radio row had, carried over verbatim: the server still
    // preferred-first falls back, so a picked-but-empty pool is harmless and
    // blocking it would be the app overruling the server.
    uninstall = installMockMoneyHost({
      ...VIEWER,
      buzzBalance: { blue: 20, green: 0, yellow: 80 },
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('pm-account-trigger'));

    const green = await screen.findByTitle(/0 Buzz in this account/i);
    expect(green).toBe(screen.getByTestId('pm-account-green'));
    expect(green).not.toBeDisabled();
    expect(screen.getByTestId('pm-account-yellow')).not.toHaveAttribute('title');

    await user.click(green);
    expect(screen.getByTestId('pm-account-trigger-label')).toHaveTextContent('Green');
  });

  it('🔴 Auto still omits `accountType` from the submit body ENTIRELY', async () => {
    // The one semantic that must survive the redesign. Auto is not "send
    // accountType: auto" — it is the ABSENCE of the key, which is what lets the
    // host drain its own domain-allowed order. Picked explicitly, because an
    // untouched picker applies the blue→green→yellow default instead.
    const bodies: Array<Record<string, unknown>> = [];
    uninstall = installMockMoneyHost({
      ...VIEWER,
      consentGranted: true,
      cost: 8,
      pollsUntilDone: 2,
      buzzBalance: DEFAULT_MOCK_BALANCE,
      onOutbound: (m) => {
        if (m.type === 'SUBMIT_WORKFLOW') {
          bodies.push((m.payload as { body: Record<string, unknown> }).body);
        }
      },
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');

    await user.click(screen.getByTestId('pm-account-trigger'));
    await user.click(screen.getByTestId('pm-account-auto'));
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));
    await screen.findByAltText(/generated result/i, {}, { timeout: 5000 });

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty('accountType');

    // The POSITIVE control for the same read: a picked pool DOES put the key on
    // the wire, so the absence above is a fact about Auto and not about the
    // capture never seeing an `accountType` at all. (Every balance covers 8, so
    // only the explicit pick decides this.)
    await user.click(screen.getByTestId('pm-account-trigger'));
    await user.click(screen.getByTestId('pm-account-yellow'));
    await user.click(screen.getByTestId('pm-generate'));
    await waitFor(() => expect(bodies).toHaveLength(2), { timeout: 5000 });
    expect(bodies[1]).toHaveProperty('accountType', 'yellow');
  });

  it('still says a pick is a PREFERENCE, not a guarantee', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER });
    render(<App />);
    await screen.findByTestId('pm-account-trigger');
    expect(screen.getByText(/the server picks the final pool/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// KEYBOARD. A native <select> would have given all of this for free; a hand-built
// menu has to be shown to do it.
// ---------------------------------------------------------------------------

describe('the dropdown’s keyboard operation', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  const openWithKeyboard = async (user: ReturnType<typeof userEvent.setup>, key: string) => {
    const trigger = await screen.findByTestId('pm-account-trigger');
    trigger.focus();
    await user.keyboard(key);
    return trigger;
  };

  it('ArrowDown on the closed trigger opens onto the CURRENT pool', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER });
    const user = userEvent.setup();
    render(<App />);

    await openWithKeyboard(user, '{ArrowDown}');
    expect(screen.getByTestId('pm-account-menu')).toBeInTheDocument();
    // Auto is selected, and Auto is what focus lands on — not blindly the first
    // row, which would be the same element here and prove nothing, so the next
    // case opens from a DIFFERENT selection.
    expect(document.activeElement).toBe(screen.getByTestId('pm-account-auto'));
  });

  it('ArrowUp on the closed trigger opens onto the LAST pool', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER });
    const user = userEvent.setup();
    render(<App />);

    await openWithKeyboard(user, '{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByTestId('pm-account-yellow'));
  });

  it('opens onto the SELECTED pool, not onto the first row', async () => {
    // The discriminating case for the assertion above: with Green picked,
    // "focus the selection" and "focus row 0" give different answers.
    uninstall = installMockMoneyHost({ ...VIEWER });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByTestId('pm-account-trigger'));
    await user.click(screen.getByTestId('pm-account-green'));
    await user.click(screen.getByTestId('pm-account-trigger'));

    expect(document.activeElement).toBe(screen.getByTestId('pm-account-green'));
    expect(document.activeElement).not.toBe(screen.getByTestId('pm-account-auto'));
  });

  it('Arrow keys move through the rows and WRAP', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER });
    const user = userEvent.setup();
    render(<App />);

    await openWithKeyboard(user, '{ArrowDown}'); // -> auto (index 0)
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByTestId('pm-account-blue'));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByTestId('pm-account-yellow'));
    // Past the end, back to the top…
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByTestId('pm-account-auto'));
    // …and the other way round the other way.
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByTestId('pm-account-yellow'));
  });

  it('Home and End jump to the ends', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER });
    const user = userEvent.setup();
    render(<App />);

    await openWithKeyboard(user, '{ArrowDown}');
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByTestId('pm-account-yellow'));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByTestId('pm-account-auto'));
  });

  it('Enter chooses the focused pool', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER });
    const user = userEvent.setup();
    render(<App />);

    const trigger = await openWithKeyboard(user, '{ArrowDown}');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(screen.queryByTestId('pm-account-menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('pm-account-trigger-label')).toHaveTextContent('Blue');
    expect(document.activeElement).toBe(trigger);
  });

  it('Escape closes WITHOUT choosing, and returns focus to the trigger', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER });
    const user = userEvent.setup();
    render(<App />);

    const trigger = await openWithKeyboard(user, '{ArrowDown}');
    await user.keyboard('{ArrowDown}'); // move onto Blue, but do not choose it
    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('pm-account-menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
    // The selection is untouched — Escape is a cancel, not a commit.
    expect(screen.getByTestId('pm-account-trigger-label')).toHaveTextContent('Auto');
  });
});

// ---------------------------------------------------------------------------
// THE ICONS, IN BOTH THEMES — mandatory under `brandDepth: "skin"`.
// ---------------------------------------------------------------------------

describe.each(THEMES)('the Buzz bolt in the %s theme', (theme: ThemeName) => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  const own = palette[theme];
  const other = palette[theme === 'dark' ? 'light' : 'dark'];

  it('paints each pool its own Civitai currency colour', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER, theme });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('pm-account-trigger'));

    // 🔴 THE LITERAL HEXES, WRITTEN OUT. `BUZZ_TYPE_COLOR` is a MIRROR of
    // civitai/civitai's `currency-theme.constants.ts`; asserting the rendered
    // fill against the constant alone would pass if the mirror itself drifted,
    // so the literals are spelled here too and the constant is checked against
    // them. Three distinct values, so a component painting one colour for all
    // three pools cannot survive.
    expect(iconFor('blue')).toHaveAttribute('fill', '#4dabf7');
    expect(iconFor('green')).toHaveAttribute('fill', '#40c057');
    expect(iconFor('yellow')).toHaveAttribute('fill', '#f59f00');
    expect(BUZZ_TYPE_COLOR).toEqual({
      blue: '#4dabf7',
      green: '#40c057',
      yellow: '#f59f00',
    });

    // …and they are the SAME in both themes, because the site's currency colours
    // are not theme-dependent. (The `describe.each` runs this twice; a component
    // that swapped them per theme would fail one of the two runs.)
    for (const choice of ['blue', 'green', 'yellow'] as const) {
      expect(iconFor(choice)).toHaveAttribute('fill', BUZZ_TYPE_COLOR[choice]);
    }
  });

  it('gives `auto` THIS theme’s neutral, because it is not a Buzz type at all', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER, theme });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('pm-account-trigger'));

    // 🔴 THE ONE THEME-DEPENDENT FILL, so it is the one that can be read off the
    // wrong palette — the `skin` failure mode that stays invisible until someone
    // opens the other theme.
    expect(iconFor('auto')).toHaveAttribute('fill', own.textDim);
    expect(iconFor('auto')).not.toHaveAttribute('fill', other.textDim);
    // And it is none of the three pool colours: Auto must not look like a pick.
    expect(Object.values(BUZZ_TYPE_COLOR)).not.toContain(own.textDim);
  });

  it('the trigger carries the CURRENT pool’s icon', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER, theme });
    const user = userEvent.setup();
    render(<App />);

    const trigger = await screen.findByTestId('pm-account-trigger');
    expect(screen.getByTestId('pm-account-trigger-icon')).toHaveAttribute('fill', own.textDim);

    await user.click(trigger);
    await user.click(screen.getByTestId('pm-account-green'));
    expect(screen.getByTestId('pm-account-trigger-icon')).toHaveAttribute(
      'fill',
      BUZZ_TYPE_COLOR.green,
    );
  });

  it('🔴 never carries the distinction by COLOUR ALONE', async () => {
    // WCAG 1.4.1, and the reason painting text in these hexes would be a
    // different claim: #4dabf7 reaches only ~2.4:1 on the light theme's paper.
    // Nothing here is a text colour — every bolt is `aria-hidden` and sits beside
    // a text label naming the same pool.
    uninstall = installMockMoneyHost({ ...VIEWER, theme });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('pm-account-trigger'));

    for (const choice of ACCOUNT_CHOICES) {
      const item = screen.getByTestId(`pm-account-${choice}`);
      const icon = iconFor(choice);
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      // The row NAMES its pool…
      expect(item.textContent).toMatch(new RegExp(choice === 'auto' ? 'Auto' : choice, 'i'));
      // …and paints no text in a currency hex.
      expect(Object.values(BUZZ_TYPE_COLOR)).not.toContain(item.style.color);
      expect(item.style.color).toBe(`rgb(${[...own.text.matchAll(/[0-9a-f]{2}/gi)]
        .map((m) => parseInt(m[0], 16))
        .join(', ')})`);
    }
  });
});
