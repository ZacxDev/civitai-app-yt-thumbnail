import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HistorySurface } from './History.js';
import type { GenerationRecord, HistoryEntry } from './history.js';
import { palette } from './palette.js';

/**
 * THE FULL-SIZE VIEWER: OPEN, NAVIGATE, CLOSE.
 *
 * 🔴 THIS FILE RENDERS `HistorySurface` DIRECTLY, NOT `<App/>`, and that is a
 * deliberate difference from every other `App.*.test.tsx` here. Those files exist to
 * prove the money path and the storage join, so each pays for a ~30-line `vi.mock`
 * of every SDK hook. Nothing in this feature touches a hook, a token or a Buzz
 * balance — it is a dialog over an array of strings — so the entries are handed in as
 * data. The cost of going through `<App/>` would be a fixture whose storage and
 * polling behaviour could fail the test for reasons that have nothing to do with the
 * lightbox.
 *
 * 🔴 RED/GREEN MATRIX. Every case here is VACUOUSLY RED at the base commit (445558b):
 * there is no lightbox there, so `yt-history-zoom` does not exist and each case dies
 * on the click rather than on an assertion. They are therefore NEW-FEATURE coverage,
 * not regression guards — with one exception, `an image list that shrinks …`, whose
 * underlying path (a poll rebuilding `imageUrls` under an open dialog) is reachable
 * today. The per-assertion mutation results are in the PR body.
 *
 * 🔴 WHAT jsdom CANNOT ANSWER, STATED HERE SO NOTHING IN THIS FILE IS READ AS MORE
 * THAN IT IS. jsdom lays nothing out and computes no cascade:
 *   - the `maxWidth` / `maxHeight` / `objectFit` assertions are STYLE-CONTRACT
 *     STRINGS. They prove the inline value reaches the element; they do NOT prove a
 *     1536×864 picture fits, that the inline value beats the pack's `[data-size]`
 *     `max-width` rule, or that `calc(100vh - 220px)` resolves to anything sensible.
 *     Only a browser can say that.
 *   - `document.activeElement` IS real in jsdom, but the browser's implicit
 *     focus-on-mousedown is not: `userEvent.click` emulates it by calling `focus()`
 *     on the nearest focusable ancestor. So the focus cases prove the TILE IS A
 *     FOCUSABLE ELEMENT AND THE RESTORE TARGETS IT, standing on userEvent's
 *     emulation for the step a real mouse would perform.
 *   - nothing here can see that the overlay actually covers the viewport, or that
 *     `position: fixed` is not trapped by an ancestor.
 */

const FORM: GenerationRecord['form'] = {
  mode: 'generate',
  prompt: 'a red bicycle',
  promptEdits: {},
  formats: [
    {
      id: 'clickbait',
      label: 'Clickbait',
      suffix: 'bold, high contrast',
      prompt: 'a red bicycle, bold, high contrast',
    },
  ],
  checkpoint: {
    versionId: 2880272,
    modelId: 2563220,
    label: 'ChatGPT Images',
    baseModel: 'OpenAI',
  },
  loras: [],
  quantity: 1,
  account: 'yellow',
  sourceImage: null,
};

/**
 * 🔴 EVERY URL IN THIS FILE IS PAIRWISE DISTINCT, ACROSS ROWS AS WELL AS WITHIN
 * THEM, and that is the control that makes the multi-row case able to fail. A fixture
 * where row A and row B shared a url — or where a row's own images repeated — would
 * go green against an implementation that resolved the WRONG ROW'S array or that
 * ignored the clicked index, because the string it compared would be right by
 * accident. The host is the real one these images come from.
 */
const A1 = 'https://orchestration-new.civitai.com/row-a-first.jpeg';
const A2 = 'https://orchestration-new.civitai.com/row-a-second.jpeg';
const B1 = 'https://orchestration-new.civitai.com/row-b-first.jpeg';
const B2 = 'https://orchestration-new.civitai.com/row-b-second.jpeg';
const B3 = 'https://orchestration-new.civitai.com/row-b-third.jpeg';

function entry(key: string, imageUrls: string[], imageLabels: Array<string | null>): HistoryEntry {
  return {
    key,
    record: { v: 1, batchId: key, createdAt: Date.parse('2026-09-30T12:00:00.000Z'), workflowIds: [`wf-${key}`], form: FORM },
    workflows: [],
    status: 'succeeded',
    imageUrls,
    imageLabels,
    cost: 418,
    spentAccount: 'yellow',
    unavailable: false,
    cancellableIds: [],
  };
}

/** Row A: 2 pictures. Row B: 3 — so B has a distinct first, MIDDLE and last. */
const ROW_A = entry('a', [A1, A2], ['Clickbait', 'Cinematic']);
const ROW_B = entry('b', [B1, B2, B3], ['Vlog', 'Minimal', 'Documentary']);

function renderSurface(entries: readonly HistoryEntry[]) {
  return render(
    <HistorySurface
      entries={entries}
      state="ready"
      loading={false}
      liveError={null}
      busyKey={null}
      note={null}
      saveNote={null}
      open
      onToggle={vi.fn()}
      onResume={vi.fn()}
      onCancel={vi.fn()}
      onSave={vi.fn()}
      onEdit={vi.fn()}
      onSignIn={vi.fn()}
      onRefresh={vi.fn()}
      pal={palette.dark}
    />,
  );
}

/** The tiles of the row at `rowIndex`, in render order. */
function tiles(rowIndex = 0) {
  const rows = screen.getAllByTestId('yt-history-row');
  return within(rows[rowIndex]!).getAllByTestId('yt-history-zoom');
}

const dialog = () => screen.queryByRole('dialog');
const shownSrc = () => screen.getByTestId('yt-lightbox-img').getAttribute('src');
const position = () => screen.getByTestId('yt-lightbox-position').textContent;

describe('the lightbox opens on the picture that was clicked', () => {
  it('🔴 shows the SRC of the clicked tile, not merely a dialog', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_A]);
    expect(dialog()).not.toBeInTheDocument();

    // 🔴 THE SECOND TILE, NOT THE FIRST. Clicking tile 0 would pass against an
    // implementation that hardcodes `urls[0]`, which is the obvious way to get this
    // wrong and the reason this case exists.
    await user.click(tiles()[1]!);

    expect(dialog()).toBeInTheDocument();
    expect(shownSrc()).toBe(A2);
    expect(shownSrc()).not.toBe(A1);
    expect(position()).toBe('2 of 2');
  });

  it('names the format in the dialog title and the image alt', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_A]);
    await user.click(tiles()[1]!);

    // `Modal` wires `aria-labelledby` from `title`, so this is the dialog's
    // accessible name as well as its visible heading.
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Cinematic');
    expect(screen.getByTestId('yt-lightbox-img')).toHaveAttribute(
      'alt',
      'Cinematic — generated result 2',
    );
  });

  it('the tile is a focusable button that says what it does', () => {
    renderSurface([ROW_A]);
    const tile = tiles()[0]!;
    // 🔴 A BUTTON, not a div with an onClick: the Tab order and Enter/Space come free,
    // and `Modal`'s restore-on-close has something to restore TO. Asserting the TAG
    // rather than "is focusable" because that is the property the restore depends on.
    expect(tile.tagName).toBe('BUTTON');
    expect(tile).toHaveAttribute('type', 'button');
    // The name describes the ACTION. The picture's own description is the img's `alt`.
    expect(tile).toHaveAttribute('aria-label', 'View Clickbait full size');
    expect(tile).toHaveAttribute('title', 'View full size');
  });
});

describe('closing', () => {
  it('🔴 Escape closes it', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_A]);
    await user.click(tiles()[0]!);
    expect(dialog()).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(dialog()).not.toBeInTheDocument();
  });

  it('🔴 a click on the overlay closes it', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_A]);
    await user.click(tiles()[0]!);

    // The overlay is `Modal`'s own element — reached by its data attribute because the
    // pack gives it no role. It closes on a mousedown whose target IS the overlay.
    const overlay = document.querySelector('[data-civitai-ui="modal-overlay"]');
    expect(overlay).not.toBeNull();
    await user.click(overlay as Element);
    expect(dialog()).not.toBeInTheDocument();
  });

  it('🔴 a click on the PICTURE does not close it', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_A]);
    await user.click(tiles()[0]!);

    // The counterpart to the overlay case: without it, "overlay click closes" would
    // also pass for an implementation that closed on any click anywhere.
    await user.click(screen.getByTestId('yt-lightbox-img'));
    expect(dialog()).toBeInTheDocument();
    expect(shownSrc()).toBe(A1);
  });

  it('🔴 the header close button closes it', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_A]);
    await user.click(tiles()[0]!);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(dialog()).not.toBeInTheDocument();
  });

  it('🔴 focus returns to the TILE THAT OPENED IT — the second one, not the first', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_A]);
    const second = tiles()[1]!;

    await user.click(second);
    // `Modal` focuses its own panel on open, so this is not vacuously true.
    expect(document.activeElement).not.toBe(second);

    await user.keyboard('{Escape}');

    // 🔴 THE SECOND TILE SPECIFICALLY. Restoring to tile 0 — or to `<body>`, which is
    // where a non-focusable `<img>` tile would leave it — both fail here.
    expect(document.activeElement).toBe(second);
    expect(document.activeElement).not.toBe(tiles()[0]!);
  });
});

describe('navigating within the batch', () => {
  it('🔴 Next and Prev move one picture, in the row that was opened', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_B]);
    await user.click(tiles()[0]!);
    expect(shownSrc()).toBe(B1);

    await user.click(screen.getByTestId('yt-lightbox-next'));
    expect(shownSrc()).toBe(B2);
    expect(position()).toBe('2 of 3');

    await user.click(screen.getByTestId('yt-lightbox-next'));
    expect(shownSrc()).toBe(B3);
    expect(position()).toBe('3 of 3');

    await user.click(screen.getByTestId('yt-lightbox-prev'));
    expect(shownSrc()).toBe(B2);
    expect(position()).toBe('2 of 3');
  });

  /**
   * 🔴 THE BOUNDARY DECISION IS **CLAMP**, NOT WRAP, AND IT IS ASSERTED AT BOTH ENDS.
   * Stated as behaviour a reader can check: at the first picture there is no previous
   * one and the Prev control is DISABLED; at the last there is no next one and Next is
   * DISABLED. The rejected alternative is named in each case so the test fails loudly
   * if someone switches to wrap-around rather than passing on a technicality.
   */
  it('🔴 CLAMPS at the first picture — Prev is disabled and does NOT wrap to the last', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_B]);
    await user.click(tiles()[0]!);

    const prev = screen.getByTestId('yt-lightbox-prev');
    expect(prev).toBeDisabled();
    // Next is live here, so `toBeDisabled` is not passing because everything is.
    expect(screen.getByTestId('yt-lightbox-next')).not.toBeDisabled();

    await user.click(prev);
    expect(shownSrc()).toBe(B1);
    expect(shownSrc()).not.toBe(B3); // wrap-around would land here
    expect(position()).toBe('1 of 3');
  });

  it('🔴 CLAMPS at the last picture — Next is disabled and does NOT wrap to the first', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_B]);
    await user.click(tiles()[2]!);

    const next = screen.getByTestId('yt-lightbox-next');
    expect(next).toBeDisabled();
    expect(screen.getByTestId('yt-lightbox-prev')).not.toBeDisabled();

    await user.click(next);
    expect(shownSrc()).toBe(B3);
    expect(shownSrc()).not.toBe(B1); // wrap-around would land here
    expect(position()).toBe('3 of 3');
  });

  it('a one-picture batch has both controls disabled', async () => {
    const user = userEvent.setup();
    renderSurface([entry('solo', [A1], ['Clickbait'])]);
    await user.click(tiles()[0]!);

    expect(screen.getByTestId('yt-lightbox-prev')).toBeDisabled();
    expect(screen.getByTestId('yt-lightbox-next')).toBeDisabled();
    expect(position()).toBe('1 of 1');
  });
});

describe('🔴 arrow-key navigation — a stated feature, so it is exercised as KEYS', () => {
  it('ArrowRight and ArrowLeft move one picture', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_B]);
    await user.click(tiles()[0]!);

    // 🔴 NOT a click on `yt-lightbox-next`. The buttons are covered above; if these
    // keys were never wired, every assertion in this block would still pass against
    // the button-only implementation if it used `user.click`.
    await user.keyboard('{ArrowRight}');
    expect(shownSrc()).toBe(B2);
    expect(position()).toBe('2 of 3');

    await user.keyboard('{ArrowRight}');
    expect(shownSrc()).toBe(B3);

    await user.keyboard('{ArrowLeft}');
    expect(shownSrc()).toBe(B2);

    await user.keyboard('{ArrowLeft}');
    expect(shownSrc()).toBe(B1);
    expect(position()).toBe('1 of 3');
  });

  it('🔴 the keys obey the SAME clamp as the buttons, at both ends', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_B]);
    await user.click(tiles()[0]!);

    await user.keyboard('{ArrowLeft}');
    expect(shownSrc()).toBe(B1);
    expect(shownSrc()).not.toBe(B3);

    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(shownSrc()).toBe(B3);
    expect(shownSrc()).not.toBe(B1);
    expect(position()).toBe('3 of 3');
  });

  it('🔴 the keys do nothing while the lightbox is CLOSED', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_B]);

    await user.keyboard('{ArrowRight}');
    // No dialog opened by a stray arrow key, and nothing threw.
    expect(dialog()).not.toBeInTheDocument();
  });

  it('🔴 the listener is REMOVED on close, not left on document', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_B]);
    await user.click(tiles()[0]!);
    await user.keyboard('{ArrowRight}');
    expect(shownSrc()).toBe(B2);

    await user.keyboard('{Escape}');
    expect(dialog()).not.toBeInTheDocument();

    // A leaked listener would advance the hidden index; reopening tile 0 would then
    // show something other than B1.
    await user.keyboard('{ArrowRight}{ArrowRight}');
    await user.click(tiles()[0]!);
    expect(shownSrc()).toBe(B1);
    expect(position()).toBe('1 of 3');
  });
});

describe('🔴 two rows: a batch may never show a SIBLING batch\'s picture', () => {
  it('opening row B navigates only inside row B', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_A, ROW_B]);
    expect(screen.getAllByTestId('yt-history-row')).toHaveLength(2);

    // Row index 1 is ROW_B. Its urls are pairwise distinct from row A's, so any leak
    // is a visible string mismatch rather than a coincidence.
    await user.click(tiles(1)[0]!);
    expect(shownSrc()).toBe(B1);
    expect(position()).toBe('1 of 3'); // 3, not 5 — the batch, not the whole surface

    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(shownSrc()).toBe(B3);
    expect(position()).toBe('3 of 3');

    // 🔴 THE END OF ROW B IS THE END. Walking past it must NOT continue into row A's
    // pictures, and must not wrap into them either.
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(shownSrc()).toBe(B3);
    expect(shownSrc()).not.toBe(A1);
    expect(shownSrc()).not.toBe(A2);

    // Walking back to the start of row B must not run off the front into row A.
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    expect(shownSrc()).toBe(B1);
    expect(shownSrc()).not.toBe(A1);
    expect(shownSrc()).not.toBe(A2);
    expect(position()).toBe('1 of 3');
  });

  it('opening row A shows row A, and only one dialog exists at a time', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_A, ROW_B]);

    await user.click(tiles(0)[1]!);
    expect(shownSrc()).toBe(A2);
    expect(position()).toBe('2 of 2'); // 2, not 3 and not 5
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    // Row A's own end, asserted against row B's pictures specifically.
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(shownSrc()).toBe(A2);
    expect([B1, B2, B3]).not.toContain(shownSrc());
  });

  it('🔴 focus returns to the tile in the row it was opened from', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_A, ROW_B]);
    const bSecond = tiles(1)[1]!;

    await user.click(bSecond);
    expect(shownSrc()).toBe(B2);
    await user.keyboard('{Escape}');

    expect(document.activeElement).toBe(bSecond);
    // Not the same-index tile of the other row, which is the plausible mix-up.
    expect(document.activeElement).not.toBe(tiles(0)[1]!);
  });
});

describe('🔴 it is a VIEWER — the money controls are not in it', () => {
  it('neither Save nor Edit appears inside the dialog', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_A]);
    await user.click(tiles()[0]!);

    const panel = screen.getByRole('dialog');
    // 🔴 Save goes through the host's SAVE_IMAGE bridge and was only just proven in
    // production; Edit opens the canvas editor. Both stay on the TILE, where they
    // work. This asserts the STATE — no such control inside the panel — rather than
    // the absence of a word, so a control added under a new testid still has to not
    // be here.
    expect(within(panel).queryByTestId('yt-history-save')).not.toBeInTheDocument();
    expect(within(panel).queryByTestId('yt-history-edit')).not.toBeInTheDocument();
    // The only controls in the panel are Close, Prev and Next.
    expect(within(panel).getAllByRole('button').map((b) => b.getAttribute('aria-label')).sort()).toEqual(
      ['Close', 'Next image', 'Previous image'],
    );

    // 🔴 AND NOTHING IN HERE IS AN `<a download>`. MEASURED in this block's sandbox:
    // `<a download>` + `a.click()` never delivers a file and the app still said
    // "Saved" — a silent lie. There is no anchor in this panel at all.
    expect(panel.querySelectorAll('a')).toHaveLength(0);
    expect(panel.querySelectorAll('[download]')).toHaveLength(0);
  });

  it('the tile keeps its own Save and Edit controls', async () => {
    renderSurface([ROW_A]);
    // The wrapper button must not have displaced them — this is the regression the
    // tile change could plausibly cause.
    const row = screen.getAllByTestId('yt-history-row')[0]!;
    expect(within(row).getAllByTestId('yt-history-save')).toHaveLength(2);
    expect(within(row).getAllByTestId('yt-history-edit')).toHaveLength(2);
    expect(within(row).getAllByTestId('yt-history-img')).toHaveLength(2);
  });
});

describe('the panel is sized for a picture, not for a confirm dialog', () => {
  /**
   * 🔴 STYLE-CONTRACT STRINGS, AND NOTHING MORE — jsdom computes no cascade. What
   * these prove: the inline override REACHES the panel and the image. What they
   * CANNOT prove: that it beats the pack's `[data-size]` rule (it must, since that
   * rule carries no `!important` and this is an inline style, but nothing here
   * measures it), or that the result fits a 1536×864 candidate on any real screen.
   */
  it('🔴 overrides the pack size preset on the panel, because lg is only 620px', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_A]);
    await user.click(tiles()[0]!);

    const panel = screen.getByRole('dialog');
    expect(panel.style.maxWidth).toBe('min(1536px, calc(100vw - 32px))');
    // The preset is left at its default; the width comes from the inline style, so a
    // future change to the presets cannot silently resize this dialog.
    expect(panel).toHaveAttribute('data-size', 'md');
  });

  it('🔴 the picture is CONTAINed, not cropped — the opposite of the tile', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_A]);
    await user.click(tiles()[0]!);

    const img = screen.getByTestId('yt-lightbox-img');
    // `cover` is what the TILE uses to keep the grid even. Cropping here would hide
    // the edges a thumbnail is judged on, which is the whole point of this surface.
    expect(img.style.objectFit).toBe('contain');
    expect(img.style.objectFit).not.toBe('cover');
    expect(img.style.maxHeight).toBe('max(200px, calc(100vh - 220px))');
  });

  it('🔴 carries no crossOrigin, matching the tile it magnifies', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_A]);
    await user.click(tiles()[0]!);

    // `editor.ts`'s `loadImageElement` sets it because it reads pixels back off a
    // canvas. This image is only displayed, so a second CORS contract here would be a
    // defensive workaround for a problem this path does not have.
    expect(screen.getByTestId('yt-lightbox-img')).not.toHaveAttribute('crossorigin');
    expect(screen.getAllByTestId('yt-history-img')[0]!).not.toHaveAttribute('crossorigin');
  });
});

describe('the position indicator', () => {
  it('🔴 is announced, because the picture swapping underneath is silent', async () => {
    const user = userEvent.setup();
    renderSurface([ROW_B]);
    await user.click(tiles()[0]!);

    // Without `aria-live` the Next button has no observable effect for a screen
    // reader: an `<img>` that was already in the tree is not re-announced when its
    // `src` and `alt` change.
    expect(screen.getByTestId('yt-lightbox-position')).toHaveAttribute('aria-live', 'polite');
  });
});
