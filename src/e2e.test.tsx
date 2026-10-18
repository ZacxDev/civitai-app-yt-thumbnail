import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from './App.js';
import { installMockMoneyHost } from './mock-buzz.js';
import { DEFAULT_CHECKPOINT } from './models.js';

// End-to-end proof of the money wiring: this drives the FULL page money path
// through the REAL SDK transport (NO hook mocking) against the mock host. It is
// the regression guard that estimate -> consent -> submit -> poll stays wired,
// plus the per-account-buzz surface (pick a pool -> accountType on the body,
// spentAccountType feedback, disallowed-pool reset). Generate is ONE click — no
// confirm modal (consent is the real, host-driven spend gate):
//
//   render <App/> (consent WITHHELD)
//     -> type a prompt
//     -> click Generate
//     -> App asks the host for consent (REQUEST_CONSENT)
//     -> host grants + pushes a TOKEN_REFRESH carrying ai:write:budgeted
//     -> App auto-resumes: estimate -> submit -> poll
//     -> succeeded snapshot -> result image + spent-cost success Alert
//
// `installMockMoneyHost` is a thin createMockHost wrapper. 0.18 answers the
// balance read + stamps `spentAccountType` (the largest-debit `buzzBalance` pool)
// NATIVELY; the wrapper only adds the domain-clamp rejection the mock host doesn't
// model. The funder note therefore reflects the wallet's primary funder — the pick
// itself is proven by the `accountType` on the submit body (asserted below). Its
// timers all fire on setTimeout(0), so real timers + findBy/waitFor resolve promptly.

describe('App money path (e2e)', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  it('estimate -> consent -> submit -> poll -> succeeded (+cost, +funded-from note)', async () => {
    const user = userEvent.setup();
    // consentGranted:false -> the first token has NO budgeted scope, so the
    // first Generate must go through the lazy-consent round-trip. cost:8 is the
    // succeeded snapshot's reported cost.
    uninstall = installMockMoneyHost({
      viewer: { id: 2, username: 'dev', status: 'active' },
      consentGranted: false,
      cost: 8,
      pollsUntilDone: 2,
      // A blue-only wallet -> the native primary-funder stamp reports `blue` on
      // the succeeded snapshot (Auto funds from the only funded pool).
      buzzBalance: { blue: 100, green: 0, yellow: 0 },
    });

    render(<App />);

    // Wait for BLOCK_INIT -> the Generate button appears.
    const generate = await screen.findByTestId('pm-generate');

    // The model starts on the curated DEFAULT (SD XL 1.0). Click "Change model" —
    // the mock host returns its canned Checkpoint pick (FLUX.1 [dev]); the label
    // updates to the picked model (the pick is still server-revalidated).
    expect(screen.getByTestId('pm-model-label')).toHaveTextContent(DEFAULT_CHECKPOINT.label);
    await user.click(screen.getByTestId('pm-change-model'));
    await waitFor(() =>
      expect(screen.getByTestId('pm-model-label')).toHaveTextContent(/FLUX\.1 \[dev\]/),
    );

    // Add a LoRA via the host resource picker — the mock host returns its canned
    // LoRA pick (Sinfully Stylish); it rides along as an additionalResource in
    // the body (server-revalidated + re-priced).
    await user.click(screen.getByTestId('pm-lora-add'));
    await waitFor(() => expect(screen.getAllByTestId('pm-lora-row')).toHaveLength(1));
    expect(screen.getByTestId('pm-lora-row')).toHaveTextContent(/Sinfully Stylish/);

    // Change the LoRA's weight via its range input.
    const weight = screen.getByTestId('pm-lora-weight') as HTMLInputElement;
    fireEvent.change(weight, { target: { value: '0.6' } });
    expect(weight.value).toBe('0.6');

    // Enter a prompt (Generate is disabled while empty).
    await user.type(screen.getByLabelText(/prompt/i), 'a serene mountain lake');
    expect(generate).toBeEnabled();

    // Click Generate. Scope is withheld so the App requests consent first, then
    // auto-resumes once the host grants it.
    await user.click(generate);

    // The host grants consent + token-refreshes; the App auto-resumes through
    // estimate -> submit -> poll -> succeeded. Assert the terminal success UI.
    const result = await screen.findByAltText(/generated result/i, {}, { timeout: 5000 });
    expect(result).toBeInTheDocument();

    // 🔴 THE COST AND THE FUNDING POOL MOVED ONTO THE HISTORY ROW. The `pm-spent`
    // "Done — spent 8 Buzz from your Blue account" alert is gone in every state, and
    // the two facts it carried are now on the row beside the picture they paid for —
    // which is where they survive the next Generate click. Asserted as a PAIR so the
    // removal cannot pass by the information simply disappearing.
    expect(screen.queryByTestId('pm-spent')).not.toBeInTheDocument();
    const cost = await screen.findByTestId('yt-history-cost');
    expect(cost).toHaveTextContent('8');
    // The pool is read from the stored record, which this app PATCHES after the
    // succeeded snapshot reports `spentAccountType` — so this line also proves that
    // round trip, not just the rendering. A blue-only wallet -> primary funder blue.
    await waitFor(() =>
      expect(within(cost).getByTestId('yt-history-bolt')).toHaveAttribute(
        'data-buzz-type',
        'blue',
      ),
    );
    expect(cost).toHaveTextContent(/from your blue balance/i);

    // No ERROR alert surfaced on the happy path.
    expect(screen.queryByText(/generation failed/i)).not.toBeInTheDocument();
  });

  it('Auto resolves to the only sufficient pool (yellow) -> accountType rides on the submit body; the funder note renders', async () => {
    const user = userEvent.setup();
    const submittedBodies: Array<{ accountType?: string }> = [];
    uninstall = installMockMoneyHost({
      viewer: { id: 2, username: 'dev', status: 'active' },
      consentGranted: true,
      cost: 8,
      pollsUntilDone: 2,
      // A yellow-only wallet -> the Auto ladder (blue -> green -> yellow) lands
      // on yellow, and the native primary-funder stamp reports `yellow`.
      buzzBalance: { blue: 0, green: 0, yellow: 100 },
      onOutbound: (m) => {
        if (m.type === 'SUBMIT_WORKFLOW') {
          submittedBodies.push((m.payload as { body: { accountType?: string } }).body);
        }
      },
    });

    render(<App />);
    await screen.findByTestId('pm-generate');

    // No pool is picked — there is no selector any more (operator, 2026-10-18:
    // the Buzz type selector is hidden and spending is always Auto).
    expect(screen.queryByTestId('pm-account-trigger')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    await screen.findByAltText(/generated result/i, {}, { timeout: 5000 });

    // The ladder's pick is threaded into the submit body (the real proof of the
    // Auto wiring). The funder note reflects the wallet's primary funder —
    // yellow here — which the mock host stamps natively from `buzzBalance`.
    expect(submittedBodies.at(-1)?.accountType).toBe('yellow');
    expect(screen.queryByTestId('pm-spent')).not.toBeInTheDocument();
    const cost = await screen.findByTestId('yt-history-cost');
    await waitFor(() =>
      expect(within(cost).getByTestId('yt-history-bolt')).toHaveAttribute(
        'data-buzz-type',
        'yellow',
      ),
    );
    expect(cost).toHaveTextContent(/from your yellow balance/i);
  });

  /**
   * The Buzz-account DEFAULT changed in the formats/storage batch: the picker no
   * longer stays on Auto when a sufficient pool is known. It now defaults to the
   * FIRST SUFFICIENT pool in blue -> green -> yellow, falling back to Auto when
   * none is sufficient (or the balance/cost is unknown).
   *
   * The test that used to sit here pinned the OLD default ("Auto omits
   * accountType") and was REPLACED, not deleted — its substance survives as the
   * second case below, still the only thing asserting that Auto threads no
   * `accountType` at all. Both assert on the WIRE (the submitted body), which is
   * the surface that decides whose Buzz is debited.
   *
   * BEHAVIOUR coverage, not regression: the ladder is new in this change.
   */
  it('defaults to the first sufficient pool (blue) and threads it on the body', async () => {
    const user = userEvent.setup();
    const submittedBodies: Array<Record<string, unknown>> = [];
    uninstall = installMockMoneyHost({
      viewer: { id: 2, username: 'dev', status: 'active' },
      consentGranted: true,
      cost: 8,
      pollsUntilDone: 2,
      // DEFAULT_MOCK_BALANCE is { blue: 1500, green: 250, yellow: 6000 } — all
      // three cover a cost of 8, so ONLY the ladder's ORDER decides the answer.
      onOutbound: (m) => {
        if (m.type === 'SUBMIT_WORKFLOW') {
          submittedBodies.push((m.payload as { body: Record<string, unknown> }).body);
        }
      },
    });

    render(<App />);
    await screen.findByTestId('pm-generate');
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    await screen.findByAltText(/generated result/i, {}, { timeout: 5000 });
    // The wire carries the ladder's pick — that is the whole claim now that
    // there is no selector to show it on.
    expect(submittedBodies.at(-1)).toHaveProperty('accountType', 'blue');
  });

  it('falls back to Auto — and Auto omits accountType — when NO pool is sufficient', async () => {
    const user = userEvent.setup();
    const submittedBodies: Array<Record<string, unknown>> = [];
    uninstall = installMockMoneyHost({
      viewer: { id: 2, username: 'dev', status: 'active' },
      consentGranted: true,
      cost: 8,
      pollsUntilDone: 2,
      // Every pool is BELOW the cost of 8, so the ladder has no sufficient pool
      // to pick and must leave the preference off entirely.
      buzzBalance: { blue: 5, green: 3, yellow: 2 },
      onOutbound: (m) => {
        if (m.type === 'SUBMIT_WORKFLOW') {
          submittedBodies.push((m.payload as { body: Record<string, unknown> }).body);
        }
      },
    });

    render(<App />);
    await screen.findByTestId('pm-generate');
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    await screen.findByAltText(/generated result/i, {}, { timeout: 5000 });
    // Auto threads NO accountType — the host drains its own order, which beats
    // naming a pool that cannot cover the bill.
    expect(submittedBodies.at(-1)).not.toHaveProperty('accountType');
  });

  it('a disallowed pool (server BAD_REQUEST) -> friendly note, stays on Auto', async () => {
    const user = userEvent.setup();
    uninstall = installMockMoneyHost({
      viewer: { id: 2, username: 'dev', status: 'active' },
      consentGranted: true,
      // Force the submit to fail; rejectAccount rewrites it into the domain-clamp
      // rejection (the Auto ladder threads a concrete pool on the body) so the
      // App classifies it correctly.
      generation: { failNext: 1 },
      rejectAccount: true,
    });

    render(<App />);
    await screen.findByTestId('pm-generate');

    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    // The App surfaces a friendly "not available" note; spending stays Auto
    // (there is no selector to reset — the note is the whole surface now).
    expect(await screen.findByTestId('pm-account-rejected')).toBeInTheDocument();
    expect(screen.getByTestId('pm-account-rejected')).toHaveTextContent(/switched back to Auto/i);
    // Not shown as a hard "generation failed" error, and no image.
    expect(screen.queryByText(/generation failed/i)).not.toBeInTheDocument();
    expect(screen.queryByAltText(/generated result/i)).not.toBeInTheDocument();
  });

  it('quantity is pinned to 1 -> the submit body omits params.quantity', async () => {
    const user = userEvent.setup();
    const submittedBodies: Array<{ params?: { quantity?: number } }> = [];
    uninstall = installMockMoneyHost({
      viewer: { id: 2, username: 'dev', status: 'active' },
      consentGranted: true,
      cost: 8,
      pollsUntilDone: 2,
      onOutbound: (m) => {
        if (m.type === 'SUBMIT_WORKFLOW') {
          submittedBodies.push((m.payload as { body: { params?: { quantity?: number } } }).body);
        }
      },
    });

    render(<App />);
    await screen.findByTestId('pm-generate');

    // The selector is hidden (operator, 2026-10-18) and one image per format
    // is the only quantity: `buildWorkflowBody` emits the field only when > 1,
    // so the pin reads as ABSENCE on the wire.
    expect(screen.queryByTestId('pm-quantity')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    await screen.findByAltText(/generated result/i, {}, { timeout: 5000 });
    expect(submittedBodies.at(-1)?.params?.quantity).toBeUndefined();
    expect(screen.getAllByTestId('yt-history-img').length).toBeGreaterThan(0);
  });

  it('Generate only: there is no Remix mode, and the body carries no sourceImage', async () => {
    const user = userEvent.setup();
    const submittedBodies: Array<{ sourceImage?: unknown }> = [];
    uninstall = installMockMoneyHost({
      viewer: { id: 2, username: 'dev', status: 'active' },
      consentGranted: true,
      cost: 8,
      pollsUntilDone: 2,
      onOutbound: (m) => {
        if (m.type === 'SUBMIT_WORKFLOW') {
          submittedBodies.push((m.payload as { body: { sourceImage?: unknown } }).body);
        }
      },
    });

    render(<App />);
    await screen.findByTestId('pm-generate');

    // The mode toggle is hidden and Remix is unsupported for now (operator,
    // 2026-10-18): no tab, no upload control, and Generate is live with just
    // a prompt — no source image is ever required or sent.
    expect(screen.queryByRole('tab', { name: /remix an image/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('pm-remix-upload')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));
    await screen.findByAltText(/generated result/i, {}, { timeout: 5000 });

    expect(submittedBodies.at(-1)?.sourceImage).toBeUndefined();
  });

  it('a gallery image opens the editor view, and Back returns to the main view', async () => {
    const user = userEvent.setup();
    uninstall = installMockMoneyHost({
      viewer: { id: 2, username: 'dev', status: 'active' },
      consentGranted: true,
      cost: 8,
      pollsUntilDone: 2,
    });

    render(<App />);
    await screen.findByTestId('pm-generate');
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));
    await screen.findByAltText(/generated result/i, {}, { timeout: 5000 });

    // Open the editor on the first candidate. The entry point moved with the images:
    // it is the "Add text" button on a row in the unified surface. Losing that button
    // when the candidate grid went away would have made the canvas editor — a whole
    // feature — unreachable, which is why this case is worth keeping pointed at it.
    await user.click(screen.getAllByTestId('yt-history-edit')[0]);
    expect(screen.getByTestId('pm-editor')).toBeInTheDocument();

    // Back returns to the generation surface — results intact.
    await user.click(screen.getByTestId('pm-editor-back'));
    expect(screen.queryByTestId('pm-editor')).not.toBeInTheDocument();
    expect(screen.getByAltText(/generated result/i)).toBeInTheDocument();
  });

  it('insufficient Buzz on submit -> warning Alert, no result image', async () => {
    const user = userEvent.setup();
    uninstall = installMockMoneyHost({
      viewer: { id: 2, username: 'dev', status: 'active' },
      consentGranted: true, // skip the consent round-trip; go straight to submit
      failMode: 'insufficient',
    });

    render(<App />);

    const generate = await screen.findByTestId('pm-generate');
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(generate);

    // The failed snapshot carries insufficient-Buzz text -> the App swaps to
    // the Top-Up warning Alert and renders no image.
    expect(await screen.findByText(/not enough buzz/i)).toBeInTheDocument();
    expect(screen.queryByAltText(/generated result/i)).not.toBeInTheDocument();
  });
});
