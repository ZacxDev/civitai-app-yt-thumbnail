import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from './App.js';
import { installMockMoneyHost, type MockMoneyHostOptions } from './mock-buzz.js';

// Prompt enhancement, end to end through the real SDK transport against the
// mock host (the same seam as e2e.test.tsx — no hook mocking):
//
//   type a prompt -> click the sparkle in the input
//     -> ESTIMATE_WORKFLOW for { kind:'step', step:'chat-completion' }
//     -> an inline confirm carrying the quoted price
//     -> click Enhance -> SUBMIT_WORKFLOW -> poll
//     -> the reply (mock-armed `textOutputs`) REPLACES the prompt text.
//
// The money rules are the point: nothing submits before the confirm, the
// confirm shows the estimate's price, and every failure arm leaves the
// viewer's prompt exactly as they wrote it.

const VIEWER = { id: 2, username: 'dev', status: 'active' } as const;
const ENHANCED = 'a SHOCKED gamer clutching a glowing controller, neon rim light, bold saturated colors';

interface SeenBody {
  kind?: string;
  step?: string;
  params?: { model?: string; messages?: Array<{ role: string; content: string }> };
}

describe('prompt enhancement (chat-completion)', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  function mount(options: MockMoneyHostOptions = {}) {
    const bodies: SeenBody[] = [];
    const types: string[] = [];
    uninstall = installMockMoneyHost({
      viewer: { ...VIEWER },
      consentGranted: true,
      cost: 5,
      pollsUntilDone: 1,
      buzzBalance: { blue: 100, green: 0, yellow: 0 },
      ...options,
      onOutbound: (msg) => {
        types.push(msg.type);
        if (msg.type === 'SUBMIT_WORKFLOW' || msg.type === 'ESTIMATE_WORKFLOW') {
          const body = (msg.payload as { body?: SeenBody } | undefined)?.body;
          if (body) bodies.push(body);
        }
      },
    });
    render(<App />);
    return { bodies, types };
  }

  const promptBox = () => screen.getByLabelText(/prompt/i) as HTMLTextAreaElement;

  it('prices first, confirms with the price, then replaces the prompt with the rewrite', async () => {
    const user = userEvent.setup();
    const { bodies, types } = mount({ stepTextOutputs: [ENHANCED] });
    await screen.findByTestId('pm-generate');

    await user.type(promptBox(), 'a gamer with a controller');
    const sparkle = screen.getByTestId('pm-enhance');
    expect(sparkle).toHaveAttribute('aria-label', 'Enhance');
    expect(sparkle).not.toBeDisabled();

    await user.click(sparkle);
    // The confirm appears carrying the estimate's price — and nothing has
    // been submitted yet.
    const confirm = await screen.findByTestId('pm-enhance-confirm');
    expect(confirm).toHaveTextContent('5 Buzz');
    expect(types.filter((t) => t === 'SUBMIT_WORKFLOW')).toHaveLength(0);
    const estimateBody = bodies.find((b) => b.kind === 'step');
    expect(estimateBody?.step).toBe('chat-completion');
    expect(estimateBody?.params?.model).toBe('openai/gpt-4o-mini');
    expect(estimateBody?.params?.messages?.at(-1)).toEqual({
      role: 'user',
      content: 'a gamer with a controller',
    });

    await user.click(screen.getByTestId('pm-enhance-run'));
    await waitFor(() => expect(promptBox().value).toBe(ENHANCED));
    expect(screen.getByTestId('pm-enhance-applied')).toHaveTextContent('Prompt enhanced.');
    // Exactly one submit, and it is the step body — no image generation ran.
    const submits = bodies.filter((b) => b.kind === 'step');
    expect(types.filter((t) => t === 'SUBMIT_WORKFLOW')).toHaveLength(1);
    expect(submits.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('yt-history-img')).not.toBeInTheDocument();
  });

  it('the button is disabled on an empty prompt — an empty field is never priced', async () => {
    mount({ stepTextOutputs: [ENHANCED] });
    await screen.findByTestId('pm-generate');
    expect(screen.getByTestId('pm-enhance')).toBeDisabled();
    expect(screen.queryByTestId('pm-enhance-confirm')).not.toBeInTheDocument();
  });

  it('Cancel on the confirm spends nothing', async () => {
    const user = userEvent.setup();
    const { types } = mount({ stepTextOutputs: [ENHANCED] });
    await screen.findByTestId('pm-generate');
    await user.type(promptBox(), 'a cat in sunglasses');
    await user.click(screen.getByTestId('pm-enhance'));
    await screen.findByTestId('pm-enhance-confirm');
    await user.click(screen.getByTestId('pm-enhance-cancel'));
    await waitFor(() =>
      expect(screen.queryByTestId('pm-enhance-confirm')).not.toBeInTheDocument(),
    );
    expect(types.filter((t) => t === 'SUBMIT_WORKFLOW')).toHaveLength(0);
    expect(promptBox().value).toBe('a cat in sunglasses');
  });

  it('a prompt edited after pricing voids the quote — no submit, a fresh price is asked for', async () => {
    const user = userEvent.setup();
    const { types } = mount({ stepTextOutputs: [ENHANCED] });
    await screen.findByTestId('pm-generate');
    await user.type(promptBox(), 'a cat');
    await user.click(screen.getByTestId('pm-enhance'));
    await screen.findByTestId('pm-enhance-confirm');
    await user.type(promptBox(), ' in sunglasses');
    await user.click(screen.getByTestId('pm-enhance-run'));
    expect(await screen.findByTestId('pm-enhance-note')).toHaveTextContent(/prompt changed/i);
    expect(types.filter((t) => t === 'SUBMIT_WORKFLOW')).toHaveLength(0);
    expect(promptBox().value).toBe('a cat in sunglasses');
  });

  it('a withheld reply leaves the prompt untouched and says why', async () => {
    const user = userEvent.setup();
    mount({ stepWithheldReason: 'the reply tripped the content filter' });
    await screen.findByTestId('pm-generate');
    await user.type(promptBox(), 'a cat in sunglasses');
    await user.click(screen.getByTestId('pm-enhance'));
    await screen.findByTestId('pm-enhance-confirm');
    await user.click(screen.getByTestId('pm-enhance-run'));
    expect(await screen.findByTestId('pm-enhance-note')).toHaveTextContent(
      /withheld: the reply tripped the content filter/i,
    );
    expect(promptBox().value).toBe('a cat in sunglasses');
  });

  it('a run with no text back leaves the prompt untouched', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('pm-generate');
    await user.type(promptBox(), 'a cat in sunglasses');
    await user.click(screen.getByTestId('pm-enhance'));
    await screen.findByTestId('pm-enhance-confirm');
    await user.click(screen.getByTestId('pm-enhance-run'));
    expect(await screen.findByTestId('pm-enhance-note')).toHaveTextContent(/didn’t come back/i);
    expect(promptBox().value).toBe('a cat in sunglasses');
  });

  it('without consent, the first click asks and the grant auto-resumes into pricing', async () => {
    const user = userEvent.setup();
    const { types } = mount({ consentGranted: false, stepTextOutputs: [ENHANCED] });
    await screen.findByTestId('pm-generate');
    await user.type(promptBox(), 'a gamer with a controller');
    await user.click(screen.getByTestId('pm-enhance'));
    // The mock host grants on request and pushes a fresh token; pricing
    // resumes on its own and the confirm appears — still nothing submitted.
    await screen.findByTestId('pm-enhance-confirm');
    expect(types).toContain('REQUEST_CONSENT');
    expect(types.filter((t) => t === 'SUBMIT_WORKFLOW')).toHaveLength(0);
  });
});
