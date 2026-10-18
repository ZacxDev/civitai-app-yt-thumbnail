import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createMockHost } from '@civitai/blocks-react/testing';

import { App } from './App.js';
import { installMockMoneyHost, mockBuzzBalance } from './mock-buzz.js';
import { DEFAULT_CHECKPOINT } from './models.js';

// Component tests: render <App/> against the SDK mock host under a scenario and
// assert the rendered UI. `installMockMoneyHost` is a thin createMockHost wrapper:
// the 3-pool balance + spentAccountType are answered NATIVELY by 0.18 (pass the
// `buzzBalance` / `viewer` options straight through); the wrapper only adds the
// two behaviours 0.18 doesn't model — a balance-read error + the domain-clamp
// rejection. Each test controls its own scenario + teardown; the transport is
// reset before each test by src/test-setup.ts.

describe('App (component)', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  it('shows a loading state before BLOCK_INIT lands', () => {
    // Install the host but render before its setTimeout(0) BLOCK_INIT fires.
    // (Plain createMockHost is fine here — we assert the pre-init frame.)
    uninstall = createMockHost({ viewer: null }).install();
    render(<App />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('anon viewer -> renders the sign-in affordance (no Generate button / picker)', async () => {
    uninstall = installMockMoneyHost({ viewer: null });
    render(<App />);

    // Once BLOCK_INIT arrives with viewer=null, the App swaps the loading state
    // for the sign-in CTA. The account picker is viewer-only. (No `pm-balance`
    // assertion here — the app renders no balance readout for ANY viewer, so it
    // would pass regardless and prove nothing about the anon path. The readout's
    // absence is guarded by its own test below.)
    const signIn = await screen.findByTestId('pm-signin');
    expect(signIn).toHaveTextContent(/sign in to generate/i);
    expect(screen.queryByTestId('pm-generate')).not.toBeInTheDocument();
    // Both halves of the control: its trigger AND (were it open) its pools.
    expect(screen.queryByTestId('pm-account-trigger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pm-account-auto')).not.toBeInTheDocument();
  });

  it('signed-in viewer -> renders the prompt field + Generate + picker buttons', async () => {
    uninstall = installMockMoneyHost({ viewer: { id: 2, username: 'dev', status: 'active' } });
    render(<App />);

    expect(await screen.findByTestId('pm-generate')).toBeInTheDocument();
    expect(screen.getByLabelText(/prompt/i)).toBeInTheDocument();
    expect(screen.queryByTestId('pm-signin')).not.toBeInTheDocument();
    // The host-picker affordances: Change model + Add LoRA, starting on the
    // curated default checkpoint.
    expect(screen.getByTestId('pm-change-model')).toBeInTheDocument();
    // Read off DEFAULT_CHECKPOINT rather than hard-coded: this case is about
    // the picker affordances EXISTING, not about which model is default.
    expect(screen.getByTestId('pm-model-label')).toHaveTextContent(DEFAULT_CHECKPOINT.label);
    // 🔴 AND NO "Add LoRA" — because the shipped default is a family that has none.
    // This assertion used to be the opposite; the field is now hidden outright for
    // such a family rather than rendered disabled with an explanation. The premise is
    // asserted rather than assumed, so a change of default cannot leave this case
    // quietly checking the wrong thing. (picker.test.tsx owns the switch-back path.)
    const { familyHasLoras } = await import('./models.js');
    expect(familyHasLoras(DEFAULT_CHECKPOINT.baseModel)).toBe(false);
    expect(screen.queryByTestId('pm-lora-add')).not.toBeInTheDocument();
  });

  it('does NOT render a Buzz balance readout — the Civitai chrome already shows it', async () => {
    // A simulated wallet of 100 splits to yellow 80 / blue 20 / green 0 (mock-buzz),
    // handed to 0.18's native `buzzBalance` option (what useBuzzBalance reads).
    // The balance IS read (it feeds the Auto pool default at submit time), but
    // the app deliberately renders no balance panel/chips/total of its own.
    uninstall = installMockMoneyHost({
      viewer: { id: 2, username: 'dev', status: 'active' },
      buzzBalance: mockBuzzBalance(100),
    });
    render(<App />);

    // Wait for a post-BLOCK_INIT frame so this isn't vacuously green pre-render.
    expect(await screen.findByTestId('pm-generate')).toBeInTheDocument();
    for (const id of ['pm-balance', 'pm-balance-blue', 'pm-balance-green', 'pm-balance-yellow', 'pm-balance-total']) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
    // No stray balance-readout prose either (the panel's old copy).
    expect(screen.queryByText(/total .* buzz/i)).not.toBeInTheDocument();
  });

  it('there is NO Buzz pool selector and NO quantity selector — spending is always Auto, one image per format', async () => {
    // Operator, 2026-10-18: both selectors are hidden. The pool picker's whole
    // surface (trigger, menu, per-pool rows) is gone, as is the quantity
    // dropdown; what remains is the behaviour they defaulted to — Auto pool
    // resolution at submit time and quantity 1 — pinned at the wire in
    // e2e.test.tsx and App.estimate.test.tsx.
    uninstall = installMockMoneyHost({
      viewer: { id: 2, username: 'dev', status: 'active' },
      buzzBalance: mockBuzzBalance(100),
    });
    render(<App />);

    expect(await screen.findByTestId('pm-generate')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-account-trigger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pm-account-menu')).not.toBeInTheDocument();
    for (const pool of ['auto', 'blue', 'green', 'yellow'] as const) {
      expect(screen.queryByTestId(`pm-account-${pool}`)).not.toBeInTheDocument();
    }
    expect(screen.queryByTestId('pm-quantity')).not.toBeInTheDocument();
    expect(screen.queryByTestId('yt-spend-row')).not.toBeInTheDocument();
  });

  it('a failed balance read degrades silently — app still generates, no pool chrome appears', async () => {
    uninstall = installMockMoneyHost({
      viewer: { id: 2, username: 'dev', status: 'active' },
      balanceError: true,
    });
    render(<App />);

    // The app still works. With no balance there is nothing to annotate, and
    // (since the readout AND the picker are gone) the error surfaces NO
    // user-visible balance chrome at all.
    expect(await screen.findByTestId('pm-generate')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-account-trigger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pm-balance')).not.toBeInTheDocument();
    expect(screen.queryByText(/balance unavailable/i)).not.toBeInTheDocument();
  });
});
