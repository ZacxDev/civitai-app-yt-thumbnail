import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from './App.js';
import { BUILTIN_FORMATS } from './formats.js';
import { PROMPT_MAX } from './generation.js';
import { installMockMoneyHost } from './mock-buzz.js';

/**
 * THE COMPOSED-PROMPT PREVIEW, AND THE EMPTY-PROMPT GATE.
 *
 * 🔴 WHY THESE TWO LIVE IN ONE FILE. They are the two halves of one complaint:
 * a format is a prompt SUFFIX composed at body-build time and deliberately never
 * typed into the prompt box, so selecting one produced no visible feedback AND
 * an empty box read as "nothing to send" even when a format was chosen. Both are
 * about the same question — what string will this click actually submit.
 *
 * 🔴 RED/GREEN MATRIX. Every case below goes red at the base ref (ed88fd5):
 *   • the preview cases fail on `getByTestId('yt-prompt-preview')` — there was no
 *     such element, and no component rendered any composed string at all;
 *   • the gate case fails on `expect(pm-generate).not.toBeDisabled()` — at base
 *     the attribute is `disabled={prompt.trim().length === 0 || …}`, so an empty
 *     box with a format selected is DISABLED.
 * The preview cases are therefore BEHAVIOUR coverage for a new surface; the gate
 * case is REGRESSION coverage for a real defect (an empty prompt could not be
 * submitted), and it was watched to fail at base — see the PR body's matrix.
 *
 * 🔴 THE GATE IS ASSERTED AS `.disabled`, NEVER AS "a click did nothing". The
 * prompt field's placeholder reads exactly like a filled-in value —
 * "a serene mountain lake at golden hour, highly detailed" — and a click on a
 * disabled button resolves successfully while changing nothing, which is
 * indistinguishable from a swallowed event. Only the attribute discriminates.
 *
 * 🔴 NOT VERIFIED IN A REAL BROWSER. This repo has no browser driver; everything
 * here is jsdom plus arithmetic.
 */

const CLICKBAIT = BUILTIN_FORMATS[0];
const CINEMATIC = BUILTIN_FORMATS[1];

const VIEWER = { viewer: { id: 2, username: 'dev', status: 'active' as const } };

/** The prompt string a SUBMIT_WORKFLOW message carried. */
const promptOf = (body: unknown) => (body as { params: { prompt: string } }).params.prompt;

/** Collapse the whitespace jsdom leaves between text nodes. */
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the composed-prompt preview', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  it('shows the REAL composed string for the selected format', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');

    // One format is selected by default (the at-least-one invariant), so the
    // preview exists before any interaction — and it is the SUFFIX ALONE while
    // nothing has been typed, which is the empty-prompt case made visible.
    const row = await screen.findByTestId(`yt-prompt-preview-${CLICKBAIT.id}`);
    expect(row).toHaveTextContent(CLICKBAIT.suffix);
    expect(text(row)).toBe(CLICKBAIT.suffix);

    await user.type(screen.getByLabelText(/prompt/i), 'a cat on a skateboard');

    // …and once there is user text, the joined string, spelled out literally
    // rather than read back from `composePrompt`.
    await waitFor(() =>
      expect(text(screen.getByTestId(`yt-prompt-preview-${CLICKBAIT.id}`))).toBe(
        `a cat on a skateboard, ${CLICKBAIT.suffix}`,
      ),
    );
  });

  it('🔴 reflects composePrompt’s TRUNCATION: the suffix is kept, the user’s text gives way', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER });
    render(<App />);
    await screen.findByTestId('pm-generate');

    // 1500 'w's — at the cap on their own, so ANY suffix forces a trim. Set via
    // fireEvent rather than `user.type` both for speed and because the field
    // carries `maxLength={PROMPT_MAX}`, which would clamp the typed value first
    // and hide the case.
    const long = 'w'.repeat(PROMPT_MAX);
    fireEvent.change(screen.getByLabelText(/prompt/i), { target: { value: long } });

    const row = await screen.findByTestId(`yt-prompt-preview-${CLICKBAIT.id}`);
    // The expectation is re-derived here by hand — cap, minus the suffix, minus
    // the two-character joiner — NOT by calling the function under test.
    const kept = PROMPT_MAX - CLICKBAIT.suffix.length - ', '.length;
    await waitFor(() =>
      expect(text(row)).toBe(`${'w'.repeat(kept)}, ${CLICKBAIT.suffix}`),
    );
    expect(text(row)).toHaveLength(PROMPT_MAX);
    // The format the viewer is PAYING for survived intact…
    expect(text(row).endsWith(CLICKBAIT.suffix)).toBe(true);
    // …and they are told whose words gave way, rather than discovering it in the
    // result.
    expect(screen.getByTestId(`yt-prompt-trimmed-${CLICKBAIT.id}`)).toHaveTextContent(
      /trimmed to fit/i,
    );
  });

  it('says nothing about trimming when nothing was trimmed — the negative control', async () => {
    // Without this the assertion above could pass against a note that is always
    // rendered, which would be a warning the viewer learns to ignore.
    uninstall = installMockMoneyHost({ ...VIEWER });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');
    await user.type(screen.getByLabelText(/prompt/i), 'a cat');

    await waitFor(() =>
      expect(screen.getByTestId(`yt-prompt-preview-${CLICKBAIT.id}`)).toHaveTextContent(
        /^a cat,/,
      ),
    );
    expect(screen.queryByTestId(`yt-prompt-trimmed-${CLICKBAIT.id}`)).not.toBeInTheDocument();
  });

  it('🔴 N selected formats ⇒ N DISTINCT previews, and each is the string that gets SUBMITTED', async () => {
    // The seam nobody else owns. `multiworkflow.test.ts` pins `composePrompt` in
    // isolation and `App.formats.test.tsx` pins that one submit happens per
    // format; NEITHER can see the preview and the wire disagreeing. This asserts
    // the RELATIONSHIP: the set of strings on screen IS the set of strings sent.
    const submitted: string[] = [];
    uninstall = installMockMoneyHost({
      ...VIEWER,
      consentGranted: true,
      cost: 8,
      pollsUntilDone: 2,
      onOutbound: (m) => {
        if (m.type === 'SUBMIT_WORKFLOW') {
          submitted.push(promptOf((m.payload as { body: unknown }).body));
        }
      },
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');

    await user.click(screen.getByTestId(`yt-format-${CINEMATIC.id}`));
    await user.type(screen.getByLabelText(/prompt/i), 'a cat on a skateboard');

    await waitFor(() => expect(screen.getAllByTestId('yt-prompt-preview-row')).toHaveLength(2));
    const previews = screen
      .getAllByTestId('yt-prompt-preview-row')
      .map((r) => text(r.querySelector('[data-testid^="yt-prompt-preview-"]') as HTMLElement));

    // Two DIFFERENT prompts — the property that makes multi-select mean
    // anything, since one request cannot carry two prompts.
    expect(new Set(previews).size).toBe(2);
    expect(previews.some((p) => p.endsWith(CLICKBAIT.suffix))).toBe(true);
    expect(previews.some((p) => p.endsWith(CINEMATIC.suffix))).toBe(true);

    await user.click(screen.getByTestId('pm-generate'));
    await waitFor(() => expect(submitted).toHaveLength(2), { timeout: 5000 });

    expect([...submitted].sort()).toEqual([...previews].sort());
  });
});

describe('the Generate gate', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  it('🔴 is ENABLED with an EMPTY prompt box and a format selected', async () => {
    uninstall = installMockMoneyHost({ ...VIEWER });
    render(<App />);

    const generate = await screen.findByTestId('pm-generate');
    // Nothing typed. The placeholder LOOKS like a value; the value is ''.
    expect((screen.getByLabelText(/prompt/i) as HTMLTextAreaElement).value).toBe('');
    // Asserted on the property, never inferred from a click that appears to do
    // nothing — a click on a disabled button reports success either way.
    expect((generate as HTMLButtonElement).disabled).toBe(false);
    expect(generate).not.toBeDisabled();
  });

  it('🔴 submits the format’s suffix ALONE when the prompt box is empty', async () => {
    // Enabled is necessary, not sufficient: the click has to produce a real
    // workflow carrying real prompt text, not an empty `params.prompt`.
    const submitted: string[] = [];
    uninstall = installMockMoneyHost({
      ...VIEWER,
      consentGranted: true,
      cost: 8,
      pollsUntilDone: 2,
      onOutbound: (m) => {
        if (m.type === 'SUBMIT_WORKFLOW') {
          submitted.push(promptOf((m.payload as { body: unknown }).body));
        }
      },
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByTestId('pm-generate'));
    await waitFor(() => expect(submitted).toHaveLength(1), { timeout: 5000 });
    expect(submitted[0]).toBe(CLICKBAIT.suffix);
  });

  it('the NEGATIVE control: the gate can still go disabled', async () => {
    // 🔴 WITHOUT THIS, "not disabled" is indistinguishable from a button that is
    // never disabled for any reason. Remix mode with no source image is the
    // other clause of the same expression, so it exercises the SAME attribute.
    //
    // 🔴 AND IT IS NOT THE "no prompt AND no format" CASE, WHICH IS UNREACHABLE
    // THROUGH THIS UI: `reconcileSelection` guarantees at least one format is
    // always selected and every format's suffix is non-blank by construction, so
    // the zero-formats state cannot be built by clicking. That half of the gate
    // is pinned directly on the predicate in `multiworkflow.test.ts`
    // ('🔴 NOTHING at all is NOT submittable'), which is the only place it can be.
    uninstall = installMockMoneyHost({ ...VIEWER });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('pm-generate');

    await user.click(screen.getByRole('tab', { name: /remix an image/i }));
    expect((screen.getByTestId('pm-generate') as HTMLButtonElement).disabled).toBe(true);
  });
});
