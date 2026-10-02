import { Button, Group, Modal } from '@civitai/blocks-react/ui';
import { useEffect, useRef } from 'react';

import { lightboxView } from './lightbox.js';
import type { Palette } from './palette.js';
import { fieldDescStyle } from './ui-styles.js';

/**
 * THE FULL-SIZE VIEWER. A VIEWER, AND NOTHING ELSE.
 *
 * 🔴 THERE IS DELIBERATELY NO SAVE AND NO EDIT IN HERE, and that is a money rule
 * rather than a scope note. Save goes through the host's SAVE_IMAGE bridge and was
 * only just proven working in production; Edit opens the canvas editor. Both already
 * exist on the TILE, two clicks away, and both were left untouched by this feature.
 * Adding a second entry point to either would mean a second call site for a
 * money-adjacent path whose first one is the one that is known to work.
 *
 * 🔴 AND NOTHING IN HERE MAY EVER BECOME AN `<a download>`. MEASURED in this block's
 * sandbox: `<a download>` plus `a.click()` is INERT — the file never arrives — and
 * the app still reported "Saved". A silent lie about a file the viewer thinks they
 * have. The only sanctioned save path in this app is the host bridge, on the tile.
 *
 * WHAT THIS COMPONENT OWNS vs WHAT `Modal` ALREADY DOES, stated because half the
 * behaviour here is first-party and re-implementing it would be the mistake:
 *
 *   `Modal` (@civitai/blocks-react/ui) already provides — Escape-to-close,
 *   overlay-click-to-close (mousedown that both starts AND lands on the overlay, so a
 *   drag off the picture does not close it), the header × button, `role="dialog"` +
 *   `aria-modal`, `aria-labelledby` wired from `title`, focusing the panel on open,
 *   and RESTORING FOCUS to the previously-focused element on close.
 *
 *   This component adds — which image, the position indicator, prev/next, and
 *   ARROW-KEY navigation. That is the whole delta.
 *
 * 🔴 `Modal` DOES NOT TRAP FOCUS — its own doc comment says so ("v0 limitation …
 * Tab can still reach content behind the overlay"). That is a first-party gap, not
 * something this file papers over: hand-rolling a trap here would fork the
 * component's focus model and fight its restore-on-close effect. Left as-is — but
 * NOT ignored, because it is what made the arrow-key listener below a real bug: see
 * `keysBelongToThisDialog`.
 *
 * 🔴 THERE IS NO SCROLL LOCK, AND THAT IS AN ACCEPTED GAP RATHER THAN AN OVERSIGHT.
 * `Modal` does not set `overflow: hidden` on anything outside itself, so the history
 * panel behind the overlay still scrolls under a wheel or a trackpad swipe. This is
 * the app's FIRST use of `Modal`, so the gap is newly exposed here rather than new.
 * Not papered over for the same reason as the focus trap: a body-level `overflow`
 * write from a leaf component is a global side effect the component that owns the
 * overlay is the right place for, and two of them (this file and a later first-party
 * fix) would fight over restoring it. Carried as a `deferred[]` item in `taste.json`
 * for the browser check, because jsdom scrolls nothing and cannot tell anyone how bad
 * it looks.
 *
 * Narrow claim, stated narrowly: an arrow key THE DIALOG TAKES is `preventDefault`ed,
 * so it does not also scroll. An arrow key the dialog declines — one pressed on
 * something behind the overlay — is deliberately left alone and WILL scroll whatever
 * owns it. That is correct, and it is not a scroll lock. See
 * `keysBelongToThisDialog`.
 */
export function ImageLightbox({
  url,
  urls,
  labels,
  onUrlChange,
  onClose,
  pal,
}: {
  /**
   * THE PICTURE BEING SHOWN, BY URL, or `null` for closed.
   *
   * 🔴 A URL AND NOT AN INDEX, and `lightbox.ts` carries the measured defect that
   * made it one: an index is silently re-pointed at a DIFFERENT picture when the
   * row's list grows underneath it, which a two-format batch does every time its
   * second format resolves first.
   */
  url: string | null;
  /** THIS ROW's images. See `lightboxView` — rows stay apart because of this prop. */
  urls: readonly string[];
  /** Format labels, index-aligned with `urls` by the history join. */
  labels: readonly (string | null)[];
  onUrlChange: (next: string) => void;
  onClose: () => void;
  pal: Palette;
}) {
  const view = lightboxView(url, urls, labels);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Primitives, so the effects below have primitive deps only and re-bind exactly
  // when the position they close over actually moves.
  const shown = view !== null;
  const prevUrl = view?.prevUrl ?? null;
  const nextUrl = view?.nextUrl ?? null;
  // "The caller thinks this is open, and there is nothing left to show it." Either
  // the row's images went away entirely, or the one being looked at did.
  const orphaned = url !== null && view === null;

  // 🔴 AN EMPTIED VIEW CLOSES THE DIALOG INSTEAD OF RENDERING NOTHING WHILE STILL
  // CONSIDERING ITSELF OPEN. Without this the caller keeps its `url` state, so the
  // next render where that picture is back REMOUNTS `Modal` with no user input — the
  // dialog reopens by itself and `Modal`'s open effect re-steals focus to the panel.
  // MEASURED as a defect before this existed; `an emptied row CLOSES the dialog …`
  // in `History.lightbox.test.tsx` is the regression case.
  //
  // In an effect rather than during render because `onClose` is the PARENT's setter.
  useEffect(() => {
    if (orphaned) onClose();
  }, [orphaned, onClose]);

  // 🔴 ARROW KEYS ARE A STATED FEATURE, SO THEY GET A REAL LISTENER — not an
  // `onKeyDown` on the panel, which would stop working the moment focus moved to one
  // of the buttons inside it. Attached to `document` for the same reason `Modal`
  // attaches its own Escape handler there, and only while something is shown.
  //
  // The guard is the VIEW being absent, not `url` being null: a batch whose picture
  // went away under an open dialog shows nothing, and arrow keys over nothing must
  // not move anything.
  useEffect(() => {
    if (!shown) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (!keysBelongToThisDialog(e.target, bodyRef.current)) return;
      // The arrows scroll the overlay otherwise — it is `overflow-y: auto`.
      e.preventDefault();
      // 🔴 THE SAME NEIGHBOURS THE BUTTONS USE, read off the one view that computed
      // them. There is no index arithmetic here to disagree with theirs.
      const next = e.key === 'ArrowLeft' ? prevUrl : nextUrl;
      if (next !== null) onUrlChange(next);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // `shown` is the gate; the rest is what the handler reads. All primitives, so the
    // listener re-binds exactly when the position it closes over moves.
  }, [shown, prevUrl, nextUrl, onUrlChange]);

  // Nothing to show: closed, or the picture went away under an open dialog. The
  // effect above has already asked the caller to close in the second case.
  //
  // 🔴 PLAIN `null`, AND THE OBVIOUS-LOOKING ALTERNATIVE IS RECORDED BECAUSE IT WAS
  // WRONG. This was `<Modal opened={false} …/>` on the reasoning that `Modal` restores
  // focus to the triggering tile from the CLEANUP of its own `opened` effect, so the
  // component had to stay mounted to run it. That reasoning is false: React runs an
  // effect's cleanup on UNMOUNT as well as on a dep change, so the restore happens
  // either way. MEASURED — swapping the two forms leaves `focus returns to the TILE
  // THAT OPENED IT` green, which is how the mistake was found. The simpler form wins.
  if (view === null) return null;

  // The dialog's accessible name. The POSITION is deliberately not in here — it has
  // one home, the indicator below, which is `aria-live` so the move is announced.
  const title = view.label ?? 'Generated result';
  const alt = view.label
    ? `${view.label} — generated result ${view.index + 1}`
    : `Generated result ${view.index + 1}`;

  return (
    <Modal
      opened
      onClose={onClose}
      title={title}
      // 🔴 THE WIDTH ESCAPE HATCH, AND THE REASON THIS FEATURE DOES NOT FORK `Modal`.
      // `size` is a `sm|md|lg` PRESET and the presets are `max-width` 340 / 440 /
      // 620px (measured in the pack's own stylesheet, `dist/ui/styles.js`). A 1536×864
      // candidate inside `lg` is a ~584px-wide picture once the 18px body padding is
      // taken off — a dialog, not a lightbox.
      //
      // `style` is a documented first-party prop applied to the PANEL element, and
      // the pack's `max-width` rules carry NO `!important`, so this inline value wins
      // outright. `size` is therefore left at its default and overridden here.
      // `width: 100%` already comes from the pack's base rule; the overlay's own
      // horizontal padding is 16px a side, which is the 32px taken off below.
      //
      // There is no `data-testid` on `Modal`: `ModalProps` has no index signature and
      // the component destructures only the props it names, so an extra attribute is
      // dropped rather than forwarded. The panel is reached by `role="dialog"`, which
      // `Modal` sets itself.
      style={{ maxWidth: 'min(1536px, calc(100vw - 32px))' }}
    >
      {/* `bodyRef` is how the key handler finds its own panel — see
          `keysBelongToThisDialog`. `Modal` takes no ref of its own, so the panel is
          reached by walking UP from a child that does. */}
      <div style={{ display: 'grid', gap: 10 }} ref={bodyRef}>
        <img
          src={view.url}
          alt={alt}
          // 🔴 `objectFit: contain`, NOT `cover` — the opposite of the tile, on
          // purpose. A tile crops to keep the grid even; the whole point of this
          // surface is to show the WHOLE candidate, and cropping it here would hide
          // exactly the edges a thumbnail gets judged on. `maxHeight` keeps a 16:9
          // picture inside the viewport instead of pushing the controls below the
          // fold; the `max(…)` floor stops a short viewport computing a negative
          // height, and the overlay scrolls (`overflow-y: auto`) in that case.
          //
          // No `crossOrigin`, matching the tile. `editor.ts`'s `loadImageElement`
          // sets it because it reads the image back off a canvas, which is tainted
          // without it. This one is only DISPLAYED, so the attribute would buy
          // nothing and would add a second CORS contract to a path that does not
          // need one. Not guarded by a test: no shipped change has ever added the
          // attribute here and nothing would, so a test asserting its absence would
          // be a guard over a non-hazard.
          style={{
            width: '100%',
            maxHeight: 'max(200px, calc(100vh - 220px))',
            objectFit: 'contain',
            borderRadius: 8,
            display: 'block',
          }}
          data-testid="yt-lightbox-img"
        />

        <Group justify="space-between" align="center" gap={8}>
          {/* 🔴 DISABLED AT THE ENDS RATHER THAN WRAPPING — see `lightbox.ts` for the
              fork. A `null` neighbour IS the end, and `disabled` is what makes it
              VISIBLE: the viewer can see there is nothing further before they
              click. */}
          <Button
            size="sm"
            variant="light"
            disabled={view.prevUrl === null}
            aria-label="Previous image"
            title="Previous image"
            onClick={() => {
              if (view.prevUrl !== null) onUrlChange(view.prevUrl);
            }}
            data-testid="yt-lightbox-prev"
          >
            ‹ Prev
          </Button>
          {/* 🔴 `aria-live` BECAUSE THIS IS THE ONLY THING THAT CHANGES ON A MOVE.
              The picture swaps silently for a screen reader — `alt` on an `<img>`
              that was already there is not re-announced — so without this, Next is a
              button with no observable effect. */}
          <span
            style={fieldDescStyle(pal)}
            aria-live="polite"
            data-testid="yt-lightbox-position"
          >
            {view.position}
          </span>
          <Button
            size="sm"
            variant="light"
            disabled={view.nextUrl === null}
            aria-label="Next image"
            title="Next image"
            onClick={() => {
              if (view.nextUrl !== null) onUrlChange(view.nextUrl);
            }}
            data-testid="yt-lightbox-next"
          >
            Next ›
          </Button>
        </Group>
      </div>
    </Modal>
  );
}

/**
 * Is this keydown the DIALOG's to take?
 *
 * 🔴 THIS EXISTS BECAUSE THE UNCONDITIONAL VERSION WAS A MEASURED BUG, AND THE
 * MECHANISM IS `Modal`'s DOCUMENTED LACK OF A FOCUS TRAP. The handler listens on
 * `document`, so it sees every keydown on the page; Tab out of the panel reaches the
 * app's own prompt textarea, which is still behind the overlay. Pressing ArrowLeft
 * there used to `preventDefault()` — CANCELLING THE CARET MOVE — and advance the
 * lightbox instead, with focus still in the textarea. Measured: `defaultPrevented`
 * true, the dialog's `src` moved, the caret did not.
 *
 * THE RULE IS CONTAINMENT, AND IT IS THE WHOLE RULE:
 *
 *  1. The dialog takes the key if the target is INSIDE ITS OWN PANEL — the normal
 *     case, since `Modal` focuses the panel on open and Prev/Next are in it.
 *  2. …or if nothing on the page holds focus at all (`<body>` or the root element is
 *     the target). The open dialog is then the only thing the arrows could mean, and
 *     this arm is REACHED: a focused button that becomes `disabled` at an end drops
 *     focus to `<body>`.
 *
 * Anything else — a textarea, an input, a button, a link, a scroller, a slider behind
 * the overlay — keeps its own arrow keys. The dialog is not entitled to them: it is
 * not trapping focus, so it does not get to act as though it had.
 *
 * 🔴 AN EXPLICIT "AN EDITABLE TARGET ALWAYS KEEPS ITS KEYS" ARM WAS WRITTEN HERE AND
 * THEN DELETED, BECAUSE IT WAS MEASURED UNREACHABLE. `scripts/mutants-lightbox.mjs`'s
 * M-F removes it and the whole suite stays green — 884/884 at the time — and that is not a
 * coverage gap to fill but the arm having no caller: every editable element in this
 * app is OUTSIDE the panel, where rule 1 already rejects it, and there is no editable
 * control inside the panel for the arm to protect. A guard that cannot execute reads
 * as cover while providing none.
 *
 * SO THE FORWARD HAZARD IS NAMED INSTEAD: if an editable control is ever added INSIDE
 * this panel, rule 1 hands it to the dialog and its caret keys break. That is a
 * decision for whoever adds it — with a test that can fail — not a branch kept warm
 * for years on the chance.
 *
 * `inside` is any element within the panel; the panel itself is found by walking up
 * to `role="dialog"`, which `Modal` sets. Reaching for the panel through
 * `document.querySelector` instead would bind this to "the only dialog on the page",
 * which is true today and is exactly the kind of claim that stops being true.
 */
function keysBelongToThisDialog(target: EventTarget | null, inside: Element | null): boolean {
  const panel = inside?.closest('[role="dialog"]') ?? null;
  if (panel !== null && target instanceof Node && panel.contains(target)) return true;
  return target === null || target === document.body || target === document.documentElement;
}
