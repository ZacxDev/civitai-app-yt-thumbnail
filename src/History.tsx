import { Alert, Badge, Button, Group, Stack } from '@civitai/blocks-react/ui';
import { useCallback, useState } from 'react';

import { accountLabel, formatCost } from './generation.js';
import { showHistory, skeletonCount, type HistoryEntry } from './history.js';
import { AddTextIcon, BuzzBolt, DownloadIcon } from './icons.js';
import { ImageLightbox } from './Lightbox.js';
import type { Palette } from './palette.js';
import { absoluteTime, relativeTime } from './relative-time.js';
import {
  fieldDescStyle,
  fieldLabelStyle,
  fieldStyle,
  galleryItemStyle,
  historyRowsStyle,
  imageGridStyle,
  imageStyle,
  panelRowStyle,
  skeletonTileStyle,
  srOnlyStyle,
} from './ui-styles.js';

/**
 * THE UNIFIED RESULTS + HISTORY SURFACE.
 *
 * 🔴 IT IS ONE SURFACE BECAUSE IT IS ONE LIST. There used to be two: a
 * "candidates" grid built from the in-flight `runs`, and a collapsed History panel
 * built from storage × the live queue. They showed the same images from two
 * sources, and the consequence was not cosmetic — `initRuns` resets `runs` on
 * every Generate, so the moment a viewer started a second run the first run's
 * images VANISHED from the page. The fix is structural rather than a longer-lived
 * `runs`: the batch record is written as soon as workflow ids exist, so an
 * in-flight batch IS the newest history row, and it fills in from skeleton to
 * pictures where it stands. One list, one reduction rule, nothing to clear.
 *
 * What this component is NOT allowed to do, each pinned by a test:
 *  - it may not show an ESTIMATE as a realized cost. `entry.cost` is the server's
 *    number summed over the workflows that reported one; `null` renders '—'.
 *  - it may not render an `unavailable` row as a failure. Those images aged out of
 *    the orchestrator; the stored form half is ours, does not expire, and still
 *    resumes.
 *  - it may not let a STORAGE problem hide generated images. `anon`/`denied`/`error`
 *    and a reload-in-progress are all BANNERS over the rows (`yt-history-reloading`
 *    for the reload), never replacements for them, because on those paths the Buzz is
 *    already spent and the pictures are already in hand.
 */
export function HistorySurface({
  entries,
  state,
  loading,
  liveError,
  busyKey,
  note,
  saveNote,
  open,
  onToggle,
  onResume,
  onCancel,
  onSave,
  onEdit,
  onSignIn,
  onRefresh,
  pal,
}: {
  entries: readonly HistoryEntry[];
  state: 'loading' | 'ready' | 'anon' | 'denied' | 'error';
  loading: boolean;
  liveError: Error | null;
  busyKey: string | null;
  note: string | null;
  saveNote: string | null;
  open: boolean;
  onToggle: () => void;
  onResume: (entry: HistoryEntry) => void;
  onCancel: (entry: HistoryEntry) => void;
  onSave: (url: string, index: number, label?: string) => void;
  onEdit: (url: string) => void;
  onSignIn: () => void;
  onRefresh: () => void;
  pal: Palette;
}) {
  // 🔴 THE WHOLE BLOCK — HEADER, BADGE AND ALL — GOES AWAY IN EXACTLY ONE CASE:
  // ready with nothing in it. A first-time viewer got a "History 0 / Show" affordance
  // whose only content was a sentence saying there was nothing there. Every OTHER
  // state stays, because every other state is actionable and says something a blank
  // space does not. The rule lives in `showHistory` so it can be asserted without a
  // render.
  if (!showHistory({ state, entryCount: entries.length, note })) return null;

  return (
    <div style={fieldStyle} data-testid="yt-history">
      <Group justify="space-between" align="center" gap={8}>
        <span style={fieldLabelStyle}>
          Thumbnails{' '}
          <Badge color="info" variant="light">
            {entries.length}
          </Badge>
        </span>
        <Group gap={6}>
          <Button variant="subtle" size="sm" onClick={onToggle} data-testid="yt-history-toggle">
            {open ? 'Hide' : 'Show'}
          </Button>
        </Group>
      </Group>

      {note && (
        <span style={fieldDescStyle(pal)} data-testid="yt-history-note">
          {note}
        </span>
      )}

      {open && (
        <>
          <HistoryPanel
            entries={entries}
            state={state}
            loading={loading}
            liveError={liveError}
            busyKey={busyKey}
            onResume={onResume}
            onCancel={onCancel}
            onSave={onSave}
            onEdit={onEdit}
            onSignIn={onSignIn}
            onRefresh={onRefresh}
            pal={pal}
          />
          {/* The outcome of a Save. It lives out here rather than inside a row:
              the host's Save As either happened or it didn't, and a note pinned
              to whichever row was clicked would move around under the viewer. */}
          {saveNote && (
            <span style={fieldDescStyle(pal)} data-testid="pm-save-note">
              {saveNote}
            </span>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The rendered join.
 *
 * 🔴 EVERY NON-READY STATE IS EXPLICIT, because each has a DIFFERENT fix and three
 * of them would otherwise render as the same empty grid:
 *
 *   'anon'    `useAppWorkflows` ERRORS for an anonymous viewer and `useAppStorage`
 *             REJECTS their writes, so there is no history and there never could
 *             be one. That is a sign-in prompt, not an empty list — an
 *             empty-looking grid here reads as "you have no generations", which
 *             is a false statement about someone who may have plenty.
 *   'denied'  The apps:storage scopes are consent-gated and have NEVER been
 *             consented in production — this feature is the first thing to touch
 *             them — so "the app was not granted storage" is a realistic FIRST
 *             RUN, not an edge case. It gets its own message naming the grant.
 *   'error'   Everything else, still actionable (a retry).
 *
 * 🔴 NONE OF THEM MAY REPLACE A ROW THAT EXISTS — they are BANNERS OVER the rows,
 * and that is a money rule, not a layout preference. Since the batch record is
 * written at submit time, a REJECTED storage write is the common way to reach
 * those states while a generation the viewer has ALREADY PAID FOR is on screen.
 * Returning early there would delete those pictures from the page and report a
 * storage problem as though the generation had produced nothing.
 *
 * 🔴 THE RULE IS ABOUT THIS COMPONENT, AND IT USED TO BE WRITTEN AS IF IT HELD AT THE
 * DATA LAYER TOO. It does not, and nothing here can make it: `loadHistory` decides
 * which records exist, so a row it drops never reaches this function and there is
 * nothing to put a banner over. Keeping an existing row across a reload is enforced
 * there — `mergeUnsavedRecords` called inside a functional `setHistoryRecords`, over
 * the list as it stands when the read resolves.
 *
 * 🔴 THAT INCLUDES 'anon' AND 'loading', WHICH IS WHERE THIS WENT WRONG. `anon` was
 * an unconditional early return, so a mid-run token expiry — `classifyStorageError`
 * matches 'anon'/'sign in'/'not signed in' on a failed `set` — replaced the row with
 * a sign-in prompt, while the note written on that path said "This run's images are
 * above". `loading` was the same shape: every reload (the Show toggle and the error
 * banner's own Try again both call one) blanked the images even when rows existed.
 * Both are now gated on there being nothing to hide, like the `loading` FLAG beside
 * them already was — and `loading` now has a BANNER of its own below
 * (`yt-history-reloading`), which it did NOT have when this paragraph first claimed
 * one: narrowing the early return alone left a reload over an existing list with no
 * indication at all, presenting the previous list as current.
 *
 * An `unavailable` ROW is none of those: it is a real past generation whose images
 * have aged out of the orchestrator. It STAYS VISIBLE, says so plainly, and Resume
 * still works — the form half is ours and does not expire.
 */
function HistoryPanel({
  entries,
  state,
  loading,
  liveError,
  busyKey,
  onResume,
  onCancel,
  onSave,
  onEdit,
  onSignIn,
  onRefresh,
  pal,
}: {
  entries: readonly HistoryEntry[];
  state: 'loading' | 'ready' | 'anon' | 'denied' | 'error';
  loading: boolean;
  liveError: Error | null;
  busyKey: string | null;
  onResume: (entry: HistoryEntry) => void;
  onCancel: (entry: HistoryEntry) => void;
  onSave: (url: string, index: number, label?: string) => void;
  onEdit: (url: string) => void;
  onSignIn: () => void;
  onRefresh: () => void;
  pal: Palette;
}) {
  const signIn = (
    <Stack gap={8} data-testid="yt-history-anon">
      <span style={fieldDescStyle(pal)}>
        Sign in to see your past generations, save their images and reuse their settings.
      </span>
      <Button variant="light" size="sm" onClick={onSignIn} data-testid="yt-history-signin">
        Sign in
      </Button>
    </Stack>
  );

  // Nothing to hide, so the state CAN be the whole panel — and should be, because
  // each of these is the only thing that explains the emptiness.
  if (entries.length === 0) {
    if (state === 'anon') return signIn;
    if (state === 'loading' || loading) {
      return (
        <span style={fieldDescStyle(pal)} data-testid="yt-history-loading">
          Loading your generations…
        </span>
      );
    }
  }

  // 🔴 ONE `now` FOR THE WHOLE RENDER, READ HERE RATHER THAN PER ROW. Every row's
  // relative timestamp is measured against the same instant, so two batches a minute
  // apart can never both read "3m ago" because the clock moved between two `Date.now()`
  // calls in the same paint. `relativeTime` itself takes it as an argument and has no
  // clock of its own — that is what makes its ladder testable (see relative-time.ts).
  //
  // 🔴 AND THERE IS DELIBERATELY NO TICKING TIMER. This surface already re-renders on
  // every poll snapshot, every refetch and every storage reload, so "3m ago" refreshes
  // as a side effect of the thing the viewer is watching. An interval would be a second
  // render driver for one cosmetic string.
  const nowMs = Date.now();

  const rows = entries.map((entry) => (
    <HistoryRow
      key={entry.key}
      entry={entry}
      cancelPending={busyKey === entry.key}
      nowMs={nowMs}
      onResume={onResume}
      onCancel={onCancel}
      onSave={onSave}
      onEdit={onEdit}
      pal={pal}
    />
  ));

  return (
    <Stack gap={12}>
      {/* Same prompt, now ABOVE the rows: a token that expired mid-run leaves images
          the viewer paid for on screen, and replacing them with this would be the
          exact deletion the header forbids. */}
      {state === 'anon' && signIn}

      {/* 🔴 THE RELOAD INDICATOR THAT THE HEADERS ABOVE PROMISED AND THE CODE DID NOT
          HAVE. Every other non-ready state had a banner here; `loading` had only the
          full-panel replacement above, which is correctly gated on there being no
          rows — so a reload over an EXISTING list said nothing at all and presented
          the previous list as current. Not an Alert: nothing is wrong, and a warning
          colour over images the viewer already owns would say otherwise. */}
      {(state === 'loading' || loading) && (
        <span style={fieldDescStyle(pal)} data-testid="yt-history-reloading">
          Refreshing your generations…
        </span>
      )}

      {state === 'denied' && (
        <Alert color="warning" title="History needs storage access" data-testid="yt-history-denied">
          This app hasn&apos;t been granted storage access, so it can&apos;t keep a record of your
          generations. Grant it from the Civitai permissions dialog and reopen this panel.
        </Alert>
      )}

      {state === 'error' && (
        <>
          <Alert color="warning" title="Couldn't load your history" data-testid="yt-history-error">
            Your generations still ran and were still charged — this is only the record of them.
          </Alert>
          <Button variant="light" size="sm" onClick={onRefresh}>
            Try again
          </Button>
        </>
      )}

      {/* The LIVE half failing is reported SEPARATELY from the stored half. The
          rows below are still rendered from storage, and Resume still works on
          every one of them — saying "history is broken" would be false. */}
      {liveError && (
        <Alert
          color="warning"
          title="Couldn't reach the generation queue"
          data-testid="yt-history-live-error"
        >
          Statuses, images and costs below may be missing or out of date. Resume still works.
        </Alert>
      )}

      {entries.length === 0 ? (
        state === 'ready' && (
          <span style={fieldDescStyle(pal)} data-testid="yt-history-empty">
            Nothing here yet. Your generations will be listed here once you run one.
          </span>
        )
      ) : (
        /* 🔴 ONE BATCH PER LINE, AT EVERY WIDTH — and this REVERSES an earlier
           decision, so the reason is recorded rather than left as a mystery. The
           rows were a `resultColumns`-wide grid (3 across at `lg`, 4 on an
           ultrawide block) on the argument that a full-width row wasted horizontal
           space. What that actually did was MULTIPLY with the image grid INSIDE
           each row, which used the same count: 3 × 3 made every thumbnail a ninth
           of the column, 4 × 4 made it a sixteenth — about 85px wide on a 1920px
           screen. The pictures are the point of this surface, so the row gives
           them the whole width and `imageGridStyle` fits as many as actually fit.
           See `ui-styles.ts` for the full arithmetic. */
        <div style={historyRowsStyle} data-testid="yt-history-grid">
          {rows}
        </div>
      )}
    </Stack>
  );
}

/** One batch: when it ran, what it cost, its pictures (or their skeletons). */
function HistoryRow({
  entry,
  cancelPending,
  nowMs,
  onResume,
  onCancel,
  onSave,
  onEdit,
  pal,
}: {
  entry: HistoryEntry;
  /** THIS row's cancel request is in flight. Not a global generation flag — see Cancel. */
  cancelPending: boolean;
  /** The instant every row in this render measures its age against. */
  nowMs: number;
  onResume: (entry: HistoryEntry) => void;
  onCancel: (entry: HistoryEntry) => void;
  onSave: (url: string, index: number, label?: string) => void;
  onEdit: (url: string) => void;
  pal: Palette;
}) {
  /**
   * WHICH OF **THIS ROW'S** IMAGES THE LIGHTBOX IS SHOWING; `null` for closed.
   *
   * 🔴 THE STATE LIVES PER ROW ON PURPOSE, AND THAT IS WHAT KEEPS BATCHES APART.
   * Prev/next are scoped to "the images in the same batch", and the cheapest way to
   * guarantee that is for the only array in scope to be `entry.imageUrls` — a row
   * cannot leak a sibling's picture because it never holds one. The alternative, one
   * lightbox state in the panel holding `{ rowKey, index }`, would put a lookup
   * between the click and the picture, and a wrong lookup is exactly the defect
   * ("opened row B, got row A's image") that this shape makes unrepresentable.
   *
   * Only one can ever be open, because opening one requires clicking a tile in it.
   */
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Stable, so the lightbox's arrow-key listener re-binds only when the POSITION it
  // closes over actually moves. `setLightboxIndex` is already stable by React's
  // contract, which is why `onIndexChange` gets it directly.
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);

  const pending = entry.status === 'running' ? skeletonCount(entry.record, entry.imageUrls.length) : 0;
  const when = relativeTime(entry.record.createdAt, nowMs);
  const whenAbsolute = absoluteTime(entry.record.createdAt);

  return (
    <div style={panelRowStyle(pal)} data-testid="yt-history-row">
      <Group justify="space-between" align="center" gap={8}>
        {/* 🔴 THE STATUS BADGE USED TO BE HERE AND IS DELIBERATELY GONE — IN EVERY
            STATE, not only on success. The operator was shown the tradeoff and
            chose this, so it is recorded here rather than argued again:
            A FAILED BATCH NOW LOOKS MUCH LIKE A SUCCEEDED ONE AT A GLANCE. What is
            left to distinguish them is (a) the cost cell, which renders '—' for a
            batch that never reported a realized price, and (b) the
            `yt-history-unavailable` line for a batch whose images have aged out —
            plus, for the run the viewer is actually watching, the `pm-partial`
            alert beside the Generate button, which names each format that failed
            and why. Do NOT re-add a badge under another name: if this proves too
            thin in practice the fix is to make the FAILED case say something
            specific, not to put the five-way badge back.

            🔴 `batchStatusLabel`/`batchStatusColor` were deleted with it (they had
            no other caller). `entry.status` is still read, two lines up, to decide
            whether this row shows skeletons. */}
        <span style={fieldDescStyle(pal)} data-testid="yt-history-when" title={whenAbsolute ?? ''}>
          {/* 🔴 RELATIVE, WITH THE ABSOLUTE TIME IN `title` SO NO PRECISION IS LOST.
              "2m ago" is what a viewer wants from the row they just generated; a
              full `toLocaleString()` was the only thing on the line and read as
              noise. The `??` fallbacks catch a non-finite `createdAt`, which renders
              '—' rather than the string "Invalid Date" — `parseRecord` refuses such a
              record today, so this is one character of defence rather than a path with
              a known caller; see `toEpochMs`, which is where the finite check lives and
              why it is not deleted with the rest of the widened signature. */}
          {when ?? '—'}
        </span>
        {/* 🔴 REALIZED COST, the server's number for the workflows that reported
            one — never the estimate. At 209 Buzz an image this is the figure
            people actually want from a history list. */}
        <CostCell cost={entry.cost} pool={entry.spentAccount} pal={pal} />
      </Group>

      <span style={fieldDescStyle(pal)} data-testid="yt-history-formats">
        {entry.record.form.formats.map((f) => f.label).join(' · ')} ·{' '}
        {entry.record.form.checkpoint.label} · {entry.record.form.quantity}×
      </span>

      {entry.unavailable && (
        <span style={fieldDescStyle(pal)} data-testid="yt-history-unavailable">
          These images are no longer available, but the settings are — Resume refills the form.
        </span>
      )}

      {/* 🔴 IMAGES AND SKELETONS CAN BOTH BE PRESENT, and that is the honest
          rendering of a multi-format batch: two formats delivered, one is still
          generating. Showing only one or the other would either hide finished
          output or claim the batch is done. */}
      {/* 🔴 THE PER-IMAGE FORMAT LABEL COMES FROM `entry.imageLabels`, index-aligned
          with `imageUrls` by the join. It used to be `formats[0].label` for EVERY
          image, so a 2-format batch SAVED A CINEMATIC PICTURE AS
          `yt-thumbnail-clickbait-3.jpg` — a wrong filename on the only real
          download this block has — and the alt text named no format at all. There
          is still deliberately no VISUAL per-image tag (see the README): an image
          belongs to its batch on screen, and the batch names its formats once. */}
      {entry.imageUrls.length > 0 && (
        <div style={imageGridStyle()} data-testid="yt-history-images">
          {entry.imageUrls.map((url, i) => (
            <div key={url} style={galleryItemStyle}>
              {/* 🔴 THE TILE IS A REAL `<button>`, AND THAT IS NOT DECORATION — IT IS
                  WHAT MAKES CLOSING THE LIGHTBOX RETURN FOCUS HERE. `Modal` restores
                  focus to `document.activeElement` as it was at open time; an `<img>`
                  is not focusable, so clicking a bare image leaves `activeElement` on
                  `<body>` and the restore has nothing to go back to. A button also
                  makes the tile reachable by Tab and operable by Enter/Space for free,
                  which an `onClick` on a `<div>` or an `<img>` does not.
                  🔴 IT MUST STAY VISUALLY INERT. `imageGridStyle` owns this grid's
                  sizing contract and a parallel change is reworking it, so the wrapper
                  contributes NO box of its own: no padding, no border, no background,
                  `display: block` and `width: 100%`, so the tile measures exactly what
                  the bare `<img>` measured. */}
              <button
                type="button"
                onClick={() => setLightboxIndex(i)}
                style={imageButtonStyle}
                // Both attributes, for the same reason the Save/Edit buttons below
                // carry both: `title` is the only hover affordance this UI pack
                // offers. The name says what the control DOES — the `<img>`'s own
                // `alt` describes the picture, which is not the same sentence.
                aria-label={`View ${entry.imageLabels[i] ?? `result ${i + 1}`} full size`}
                title="View full size"
                data-testid="yt-history-zoom"
              >
                <img
                  src={url}
                  alt={
                    entry.imageLabels[i]
                      ? `${entry.imageLabels[i]} — generated result ${i + 1}`
                      : `Generated result ${i + 1}`
                  }
                  style={imageStyle}
                  data-testid="yt-history-img"
                />
              </button>
              {/* 🔴 TWO BUTTONS THAT DO GENUINELY DIFFERENT THINGS, AND THE
                  DISTINCTION IS NOW CARRIED BY THE ICON PLUS `aria-label`/`title`
                  RATHER THAN BY VISIBLE TEXT. The previous version of this comment
                  argued the opposite — that they had to be LABELLED because the
                  difference matters — and the operator has reversed that to buy the
                  width back for the pictures. The difference it was protecting is
                  real and unchanged: "Save image" (the download icon) is the RAW
                  candidate going through the host's SAVE_IMAGE bridge — a real file,
                  every time. "Add text" (the text icon) opens the canvas editor,
                  whose export is a local `blob:` that same bridge REFUSES
                  (https-only allowlist), so that path ends in the honest
                  right-click note.

                  🔴 SO BOTH ATTRIBUTES ARE MANDATORY ON BOTH BUTTONS, and that is
                  not style: `title` is the only hover affordance this UI pack
                  offers (there is no `Tooltip` in `@civitai/blocks-react/ui`) and
                  `aria-label` is the ONLY accessible name an icon-only control has.
                  An icon with neither is not a tidier button, it is a button nobody
                  on a screen reader can identify — a regression in accessibility,
                  not a visual change. The guard is
                  `src/App.inflight.test.tsx`'s "🔴 the icon-only controls carry BOTH a
                  title and an aria-label", which asserts the exact wording on both
                  controls here — not merely that the attributes exist. (This pointer
                  previously named a `pm-icon-labels` testid in `App.history.test.tsx`;
                  no such testid exists anywhere in the tree and the file was wrong
                  too. The coverage was real; only the reference was not.)
                  The testids and
                  both `onClick` payloads — including the `i + 1` index and the
                  per-image `imageLabels[i]` that stop a cinematic picture being
                  saved as `…-clickbait-3.jpg` — are byte-for-byte what they were. */}
              <Group gap={6} wrap={false}>
                <Button
                  size="sm"
                  aria-label="Save image"
                  title="Save image"
                  onClick={() => onSave(url, i + 1, entry.imageLabels[i] ?? undefined)}
                  data-testid="yt-history-save"
                >
                  <DownloadIcon />
                </Button>
                <Button
                  size="sm"
                  variant="light"
                  aria-label="Add text"
                  title="Add text"
                  onClick={() => onEdit(url)}
                  data-testid="yt-history-edit"
                >
                  <AddTextIcon />
                </Button>
              </Group>
            </div>
          ))}
        </div>
      )}

      {/* 🔴 THE SAME `imageGridStyle()` THE IMAGES USE, so a running batch does not
          reflow when its pictures land. One function, no argument, both call sites —
          which is stronger than the two `galleryStyle(layout)` calls it replaces,
          because there is no longer a value they could be passed differently. */}
      {pending > 0 && (
        <div style={imageGridStyle()} data-testid="yt-history-skeleton">
          {Array.from({ length: pending }, (_, i) => (
            <div
              key={i}
              className="yt-skeleton"
              style={skeletonTileStyle(pal)}
              data-testid="yt-history-skeleton-tile"
              role="img"
              aria-label="Generating…"
            />
          ))}
        </div>
      )}

      <Group gap={6}>
        {/* 🔴 RESUME DOES NOT SUBMIT. It refills the form and stops, with the cost
            preview showing — see the App's `onResume`. The label says "Reuse
            settings" rather than "Run again" for exactly that reason: a money
            control must not read like a re-run button. */}
        <Button
          size="sm"
          variant="light"
          onClick={() => onResume(entry)}
          data-testid="yt-history-resume"
        >
          Reuse settings
        </Button>
        {entry.cancellableIds.length > 0 && (
          /* 🔴 `loading` HERE IS THIS ROW'S OWN CANCEL REQUEST, NOT A GLOBAL BUSY
              FLAG, AND THE DIFFERENCE DECIDES WHETHER THIS BUTTON WORKS AT ALL.
              `Button`'s `loading` prop DISABLES the button and swallows `onClick`
              (its own d.ts says so), so wiring it to anything that is true while a
              generation is in flight would render Cancel exactly when it cannot be
              clicked — and this button only ever EXISTS while something is in
              flight (`cancellableIds` is non-empty only for pending/processing
              workflows). It is instead `busyKey === entry.key`, which the App sets
              only inside `onCancelWorkflow` and clears in its `finally`: so Cancel
              is live for the whole time it is on screen, and goes into its spinner
              for the duration of the cancel round trip it started itself.
              `App.history.test.tsx` pins the reachability directly — it clicks this
              button on a running batch and asserts `cancelWorkflow` was called with
              that batch's id — and separately asserts that a SECOND row's Cancel
              stays live while this one's request is pending. */
          <Button
            size="sm"
            variant="subtle"
            color="error"
            loading={cancelPending}
            onClick={() => onCancel(entry)}
            data-testid="yt-history-cancel"
          >
            Cancel
          </Button>
        )}
      </Group>

      {/* 🔴 ONE PER ROW, AND HANDED **THIS** ROW'S ARRAYS. A VIEWER ONLY — no Save,
          no Edit; see `Lightbox.tsx` for why that is a money rule and not a scope
          note. It is rendered unconditionally (closed when `lightboxIndex` is null)
          because `Modal` restores focus to the tile from the cleanup of its own
          `opened` effect, which never runs if the component unmounts instead. */}
      <ImageLightbox
        index={lightboxIndex}
        urls={entry.imageUrls}
        labels={entry.imageLabels}
        onIndexChange={setLightboxIndex}
        onClose={closeLightbox}
        pal={pal}
      />
    </div>
  );
}

/**
 * The tile's click target: a button that is not allowed to look like one.
 *
 * Every property here is a NEUTRALISER. The tile's size is owned by
 * `imageGridStyle` + `imageStyle`, so this wrapper must contribute no box of its
 * own — otherwise a button's default padding and border would shrink the picture
 * inside a grid cell whose width was computed for the bare image.
 *
 * `cursor: zoom-in` is the affordance, which is the honest one: this control
 * magnifies, it does not save or edit.
 *
 * 🔴 NO COLOUR TOKEN IS NEEDED AND NONE IS NAMED. `background: 'none'` and
 * `border: 'none'` remove the UA's, rather than painting over them, so this style
 * cannot drift from the palette — there is nothing in it to drift.
 */
const imageButtonStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: 0,
  margin: 0,
  border: 'none',
  background: 'none',
  cursor: 'zoom-in',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'inherit',
};

/**
 * The realized cost: a number, a BOLT, and the pool that funded it.
 *
 * 🔴 THE BOLT IS THE SAME COMPONENT THE BUZZ PICKER USES — `icons.tsx`'s
 * `BuzzBolt`, painted from `BUZZ_TYPE_COLOR`, which is `palette.ts`'s verbatim
 * mirror of civitai's own `currency-theme.constants.ts`. It is deliberately NOT a
 * second glyph with a second pool→colour lookup: two renderings of one visual rule
 * are how the picker and this row end up disagreeing about what "yellow Buzz"
 * looks like. One rule, one place — `BuzzBolt` moved OUT of `App.tsx` for this.
 *
 * 🔴 AN UNKNOWN POOL IS NEUTRAL, NEVER A GUESS. `pool` is `null` for a record
 * written before the field existed, for a batch still running, for a batch whose
 * workflows were funded from DIFFERENT pools, and — until every one of a batch's
 * workflows has reported — for a batch that has only PART of the answer. All four map to
 * `BuzzBolt`'s `'auto'` arm — `pal.textDim`, a bolt that does not claim a pool — because
 * a wrong colour here is a false statement about where the viewer's money came from.
 * `agreedSpentPool` decides agreement and `spendPatches` decides when there is enough of
 * an answer to write down; the fourth case is the one that used to LATCH, stamping the
 * row from whichever format replied first.
 *
 * 🔴 AND COLOUR IS NEVER THE ONLY CARRIER. The bolt is `aria-hidden`; the
 * accessible name beside it spells out "Buzz" and, when known, the pool — so a
 * screen reader reads "836 Buzz from your blue balance", never a bare number, and
 * a viewer who cannot distinguish the three hues still has the `title` and the
 * read-out. This is the same WCAG 1.4.1 rule `palette.ts` states for the picker.
 */
function CostCell({
  cost,
  pool,
  pal,
}: {
  cost: number | null;
  pool: HistoryEntry['spentAccount'];
  pal: Palette;
}) {
  // No realized number yet: '—' and NOTHING else. A bolt beside an em dash would
  // suggest a price of nothing was charged; the honest claim is that the server has
  // not told us one.
  if (cost == null) {
    return (
      <span style={fieldDescStyle(pal)} data-testid="yt-history-cost">
        —
      </span>
    );
  }
  const amount = formatCost(cost);
  const poolLabel = pool === null ? null : accountLabel(pool);
  const sentence =
    poolLabel === null
      ? `${amount} Buzz`
      : `${amount} Buzz from your ${poolLabel.toLowerCase()} balance`;
  return (
    <span
      style={{ ...fieldDescStyle(pal), display: 'inline-flex', alignItems: 'center', gap: 3 }}
      data-testid="yt-history-cost"
      // The whole sentence on hover, so the pool is discoverable without colour
      // vision and the number keeps its unit even when the row is scanned fast.
      title={sentence}
    >
      {amount}
      <BuzzBolt choice={pool ?? 'auto'} pal={pal} testId="yt-history-bolt" size={12} />
      {/* 🔴 THE NUMBER NEVER GOES OUT ALONE. The bolt is `aria-hidden`, so without
          this the row would read as "836" on a surface about money — a bare number
          with no unit and no pool. The visible glyph and this text say the same
          thing to two different readers. */}
      <span style={srOnlyStyle}>
        {poolLabel === null ? ' Buzz' : ` Buzz from your ${poolLabel.toLowerCase()} balance`}
      </span>
    </span>
  );
}

