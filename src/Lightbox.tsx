import { Button, Group, Modal } from '@civitai/blocks-react/ui';
import { useEffect } from 'react';

import { lightboxView, stepIndex } from './lightbox.js';
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
 * component's focus model and fight its restore-on-close effect. Left as-is and
 * recorded.
 */
export function ImageLightbox({
  index,
  urls,
  labels,
  onIndexChange,
  onClose,
  pal,
}: {
  /** The image to show, or `null` for closed. Indexes `urls` and nothing else. */
  index: number | null;
  /** THIS ROW's images. See `lightboxView` — rows stay apart because of this prop. */
  urls: readonly string[];
  /** Format labels, index-aligned with `urls` by the history join. */
  labels: readonly (string | null)[];
  onIndexChange: (next: number) => void;
  onClose: () => void;
  pal: Palette;
}) {
  const view = lightboxView(index, urls, labels);
  const count = urls.length;
  // `-1` stands for "nothing shown", so the effect below has primitive deps only and
  // re-binds exactly when the position it closes over changes.
  const at = view === null ? -1 : view.index;

  // 🔴 ARROW KEYS ARE A STATED FEATURE, SO THEY GET A REAL LISTENER — not an
  // `onKeyDown` on the panel, which would stop working the moment focus moved to one
  // of the buttons inside it. Attached to `document` for the same reason `Modal`
  // attaches its own Escape handler there, and only while something is shown.
  //
  // The guard is the VIEW being absent, not `index` being null: a batch whose images
  // went away under an open dialog shows nothing, and arrow keys over nothing must
  // not call `onIndexChange` with an index into an empty list.
  useEffect(() => {
    if (at < 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      if (delta === 0) return;
      // The arrows scroll the overlay otherwise — it is `overflow-y: auto`.
      e.preventDefault();
      // 🔴 THE SAME `stepIndex` THE BUTTONS USE. Two movers would be two boundary
      // rules, and the clamp is the thing this feature had to decide.
      onIndexChange(stepIndex(at, count, delta));
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [at, count, onIndexChange]);

  // Nothing to show: closed, or the batch's pictures went away under an open dialog.
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
      <div style={{ display: 'grid', gap: 10 }}>
        <img
          src={view.url}
          alt={alt}
          // 🔴 NO `crossOrigin` HERE, MATCHING THE TILE. `editor.ts`'s
          // `loadImageElement` sets it because it reads the image back off a canvas,
          // which is tainted without it. This one is only DISPLAYED, so the attribute
          // would buy nothing and would add a second CORS contract to a path that
          // does not need one.
          //
          // 🔴 `objectFit: contain`, NOT `cover` — the opposite of the tile, on
          // purpose. A tile crops to keep the grid even; the whole point of this
          // surface is to show the WHOLE candidate, and cropping it here would hide
          // exactly the edges a thumbnail gets judged on. `maxHeight` keeps a 16:9
          // picture inside the viewport instead of pushing the controls below the
          // fold; the `max(…)` floor stops a short viewport computing a negative
          // height, and the overlay scrolls (`overflow-y: auto`) in that case.
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
              fork. `disabled` is what makes the clamp VISIBLE: the viewer can see
              there is nothing further before they click. */}
          <Button
            size="sm"
            variant="light"
            disabled={!view.hasPrev}
            aria-label="Previous image"
            title="Previous image"
            onClick={() => onIndexChange(stepIndex(view.index, urls.length, -1))}
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
            disabled={!view.hasNext}
            aria-label="Next image"
            title="Next image"
            onClick={() => onIndexChange(stepIndex(view.index, urls.length, 1))}
            data-testid="yt-lightbox-next"
          >
            Next ›
          </Button>
        </Group>
      </div>
    </Modal>
  );
}
