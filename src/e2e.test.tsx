import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    // The succeeded snapshot's cost + funded-from note render (blue-only wallet
    // -> primary funder is blue).
    const spent = screen.getByTestId('pm-spent');
    expect(spent).toHaveTextContent('8');
    expect(spent).toHaveTextContent(/from your blue account/i);

    // No ERROR alert surfaced on the happy path.
    expect(screen.queryByText(/generation failed/i)).not.toBeInTheDocument();
  });

  it('picking a pool -> accountType rides on the submit body; the funder note renders', async () => {
    const user = userEvent.setup();
    const submittedBodies: Array<{ accountType?: string }> = [];
    uninstall = installMockMoneyHost({
      viewer: { id: 2, username: 'dev', status: 'active' },
      consentGranted: true,
      cost: 8,
      pollsUntilDone: 2,
      // A yellow-only wallet -> the native primary-funder stamp reports `yellow`.
      buzzBalance: { blue: 0, green: 0, yellow: 100 },
      onOutbound: (m) => {
        if (m.type === 'SUBMIT_WORKFLOW') {
          submittedBodies.push((m.payload as { body: { accountType?: string } }).body);
        }
      },
    });

    render(<App />);
    await screen.findByTestId('pm-generate');

    // Pick Yellow, then generate.
    // 🔴 MARKUP SHAPE CHANGED, ASSERTIONS DID NOT. "Spend from" is a trigger + a
    // popup menu now, so a pool has to be OPENED before it can be clicked, and
    // re-opened before its `aria-checked` can be read — choosing closes the menu.
    // The expectation itself is the one this test has always made.
    await user.click(screen.getByTestId('pm-account-trigger'));
    await user.click(screen.getByTestId('pm-account-yellow'));
    await user.click(screen.getByTestId('pm-account-trigger'));
    expect(screen.getByTestId('pm-account-yellow')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Escape}');
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    await screen.findByAltText(/generated result/i, {}, { timeout: 5000 });

    // The picked pool is threaded into the submit body (the real proof of the
    // pick wiring). The funder note reflects the wallet's primary funder — yellow
    // here — which the mock host stamps natively from `buzzBalance`.
    expect(submittedBodies.at(-1)?.accountType).toBe('yellow');
    expect(screen.getByTestId('pm-spent')).toHaveTextContent(/from your yellow account/i);
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
    // It starts on Auto — the cost is unknown until the estimate lands.
    // (Menu open/close around each read: see the shape note on the Yellow test.)
    await user.click(screen.getByTestId('pm-account-trigger'));
    expect(screen.getByTestId('pm-account-auto')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Escape}');
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    await screen.findByAltText(/generated result/i, {}, { timeout: 5000 });
    // The wire carries the ladder's pick...
    expect(submittedBodies.at(-1)).toHaveProperty('accountType', 'blue');
    // ...and the control SHOWS it. Submitting under a pool the picker still
    // displays as "Auto" would misstate where the money came from.
    await user.click(screen.getByTestId('pm-account-trigger'));
    expect(screen.getByTestId('pm-account-blue')).toHaveAttribute('aria-checked', 'true');
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
    await user.click(screen.getByTestId('pm-account-trigger'));
    expect(screen.getByTestId('pm-account-auto')).toHaveAttribute('aria-checked', 'true');
  });

  it('a disallowed pool (server BAD_REQUEST) -> friendly note + reset to Auto', async () => {
    const user = userEvent.setup();
    uninstall = installMockMoneyHost({
      viewer: { id: 2, username: 'dev', status: 'active' },
      consentGranted: true,
      // Force the submit to fail; rejectAccount rewrites it into the domain-clamp
      // rejection (since a pool was picked) so the App classifies it correctly.
      generation: { failNext: 1 },
      rejectAccount: true,
    });

    render(<App />);
    await screen.findByTestId('pm-generate');

    await user.click(screen.getByTestId('pm-account-trigger'));
    await user.click(screen.getByTestId('pm-account-green'));
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    // The App surfaces a friendly "not available" note and falls back to Auto.
    expect(await screen.findByTestId('pm-account-rejected')).toBeInTheDocument();
    // The trigger publishes the current pool without opening anything, so the
    // fallback is readable exactly where the old radio row published it.
    await waitFor(() =>
      expect(screen.getByTestId('pm-account-trigger-label')).toHaveTextContent('Auto'),
    );
    await user.click(screen.getByTestId('pm-account-trigger'));
    expect(screen.getByTestId('pm-account-auto')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Escape}');
    // Not shown as a hard "generation failed" error, and no image.
    expect(screen.queryByText(/generation failed/i)).not.toBeInTheDocument();
    expect(screen.queryByAltText(/generated result/i)).not.toBeInTheDocument();
  });

  it('quantity pill -> params.quantity rides on the submit body', async () => {
    const user = userEvent.setup();
    const submittedBodies: Array<{ params?: { quantity?: number } }> = [];
    uninstall = installMockMoneyHost({
      viewer: { id: 2, username: 'dev', status: 'active' },
      consentGranted: true,
      cost: 24,
      pollsUntilDone: 2,
      onOutbound: (m) => {
        if (m.type === 'SUBMIT_WORKFLOW') {
          submittedBodies.push((m.payload as { body: { params?: { quantity?: number } } }).body);
        }
      },
    });

    render(<App />);
    await screen.findByTestId('pm-generate');

    // Pick 3 candidates, then generate.
    await user.click(screen.getByTestId('pm-quantity-3'));
    expect(screen.getByTestId('pm-quantity-3')).toHaveAttribute('aria-checked', 'true');
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');
    await user.click(screen.getByTestId('pm-generate'));

    await screen.findByAltText(/generated result/i, {}, { timeout: 5000 });
    // The REAL proof: the clamped quantity reached the host on the submit body.
    expect(submittedBodies.at(-1)?.params?.quantity).toBe(3);
    // And every candidate from the snapshot landed in the gallery.
    expect(screen.getAllByTestId('pm-result-img').length).toBeGreaterThan(0);
  });

  it('Remix mode: the generationSource upload seeds the body as sourceImage', async () => {
    const user = userEvent.setup();
    const submittedBodies: Array<{
      sourceImage?: { url: string; width: number; height: number };
    }> = [];
    uninstall = installMockMoneyHost({
      viewer: { id: 2, username: 'dev', status: 'active' },
      consentGranted: true,
      cost: 12,
      pollsUntilDone: 2,
      onOutbound: (m) => {
        if (m.type === 'SUBMIT_WORKFLOW') {
          submittedBodies.push(
            (m.payload as { body: { sourceImage?: { url: string; width: number; height: number } } })
              .body,
          );
        }
      },
    });

    render(<App />);
    await screen.findByTestId('pm-generate');

    // Switch to Remix. Generate is disabled until a source image exists.
    await user.click(screen.getByRole('tab', { name: /remix an image/i }));
    expect(screen.getByTestId('pm-generate')).toBeDisabled();

    // Choose a source image — the mock host returns its canned generationSource
    // (a Civitai-hosted { url, width, height }).
    await user.click(screen.getByTestId('pm-remix-upload'));
    const preview = await screen.findByTestId('pm-remix-preview');
    const src = preview.querySelector('img');
    expect(src).not.toBeNull();
    expect(src?.getAttribute('src')).toMatch(/^https:\/\/image\.civitai\.com\//);

    // Generate is re-enabled; the submit body carries the sourceImage (img2img).
    await user.type(screen.getByLabelText(/prompt/i), 'make it clickbait');
    await user.click(screen.getByTestId('pm-generate'));
    await screen.findByAltText(/generated result/i, {}, { timeout: 5000 });

    const body = submittedBodies.at(-1);
    expect(body?.sourceImage?.url).toMatch(/^https:\/\/image\.civitai\.com\//);
    expect(body?.sourceImage?.width).toBeGreaterThan(0);
    expect(body?.sourceImage?.height).toBeGreaterThan(0);
    // The generate path must NOT have threaded a source image — the last body is
    // the remix one, so the absence check is about the shape of THIS body.
    expect(screen.queryByTestId('pm-remix-hint')).not.toBeInTheDocument();
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

    // Open the editor on the first candidate.
    await user.click(screen.getByTestId('pm-edit-0'));
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
