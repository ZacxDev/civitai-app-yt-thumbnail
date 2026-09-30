import { Alert, Badge, Button, Group, Stack } from '@civitai/blocks-react/ui';

import { formatCost } from './generation.js';
import {
  batchStatusColor,
  batchStatusLabel,
  showHistory,
  skeletonCount,
  type HistoryEntry,
} from './history.js';
import type { BlockLayout } from './layout.js';
import type { Palette } from './palette.js';
import {
  fieldDescStyle,
  fieldLabelStyle,
  fieldStyle,
  galleryItemStyle,
  galleryStyle,
  imageStyle,
  panelRowStyle,
  skeletonTileStyle,
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
 *  - it may not let a STORAGE problem hide generated images. `denied`/`error` are
 *    BANNERS over the rows, never replacements for them, because on those paths
 *    the Buzz is already spent and the pictures are already in hand.
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
  layout,
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
  layout: BlockLayout;
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
            layout={layout}
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
 * 🔴 'denied' AND 'error' ARE BANNERS, NOT REPLACEMENTS, WHENEVER THERE ARE ROWS —
 * and that is a money rule, not a layout preference. Since the batch record is
 * written at submit time, a REJECTED storage write is the common way to reach
 * those states while a generation the viewer has ALREADY PAID FOR is on screen.
 * Returning early there would delete those pictures from the page and report a
 * storage problem as though the generation had produced nothing.
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
  layout,
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
  layout: BlockLayout;
}) {
  if (state === 'anon') {
    return (
      <Stack gap={8} data-testid="yt-history-anon">
        <span style={fieldDescStyle(pal)}>
          Sign in to see your past generations, save their images and reuse their settings.
        </span>
        <Button variant="light" size="sm" onClick={onSignIn} data-testid="yt-history-signin">
          Sign in
        </Button>
      </Stack>
    );
  }

  if (state === 'loading' || (loading && entries.length === 0)) {
    return (
      <span style={fieldDescStyle(pal)} data-testid="yt-history-loading">
        Loading your generations…
      </span>
    );
  }

  const rows = entries.map((entry) => (
    <HistoryRow
      key={entry.key}
      entry={entry}
      busy={busyKey === entry.key}
      onResume={onResume}
      onCancel={onCancel}
      onSave={onSave}
      onEdit={onEdit}
      pal={pal}
      layout={layout}
    />
  ));

  return (
    <Stack gap={12}>
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
        /* 🔴 THE ROWS ARE A GRID, from the SAME `layoutForTier` column count the
           images use. They were full-width list items at every width, so a
           1600px block showed one batch per screenful of horizontal nothing. */
        <div style={galleryStyle(layout)} data-testid="yt-history-grid">
          {rows}
        </div>
      )}
    </Stack>
  );
}

/** One batch: its badge, its realized cost, its pictures (or their skeletons). */
function HistoryRow({
  entry,
  busy,
  onResume,
  onCancel,
  onSave,
  onEdit,
  pal,
  layout,
}: {
  entry: HistoryEntry;
  busy: boolean;
  onResume: (entry: HistoryEntry) => void;
  onCancel: (entry: HistoryEntry) => void;
  onSave: (url: string, index: number, label?: string) => void;
  onEdit: (url: string) => void;
  pal: Palette;
  layout: BlockLayout;
}) {
  const label = entry.record.form.formats[0]?.label;
  const pending = entry.status === 'running' ? skeletonCount(entry.record, entry.imageUrls.length) : 0;

  return (
    <div style={panelRowStyle(pal)} data-testid="yt-history-row">
      <Group justify="space-between" align="center" gap={8}>
        <Group gap={6} align="center">
          <Badge color={batchStatusColor(entry.status)} variant="light">
            {batchStatusLabel(entry.status)}
          </Badge>
          <span style={fieldDescStyle(pal)} data-testid="yt-history-when">
            {new Date(entry.record.createdAt).toLocaleString()}
          </span>
        </Group>
        {/* 🔴 REALIZED COST, the server's number for the workflows that reported
            one — never the estimate. At 209 Buzz an image this is the figure
            people actually want from a history list. */}
        <span style={fieldDescStyle(pal)} data-testid="yt-history-cost">
          {entry.cost == null ? '—' : `${formatCost(entry.cost)} Buzz`}
        </span>
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
      {entry.imageUrls.length > 0 && (
        <div style={galleryStyle(layout)} data-testid="yt-history-images">
          {entry.imageUrls.map((url, i) => (
            <div key={url} style={galleryItemStyle}>
              <img
                src={url}
                alt={`Generated result ${i + 1}`}
                style={imageStyle}
                data-testid="yt-history-img"
              />
              {/* 🔴 TWO BUTTONS THAT DO GENUINELY DIFFERENT THINGS, LABELLED SO.
                  "Save image" is the RAW candidate going through the host's
                  SAVE_IMAGE bridge — a real file, every time. "Add text" opens the
                  canvas editor, whose export is a local `blob:` that same bridge
                  refuses (https-only allowlist), so that path ends in the honest
                  right-click note. */}
              <Group gap={6} wrap={false}>
                <Button
                  size="sm"
                  onClick={() => onSave(url, i + 1, label)}
                  data-testid="yt-history-save"
                >
                  Save image
                </Button>
                <Button
                  size="sm"
                  variant="light"
                  onClick={() => onEdit(url)}
                  data-testid="yt-history-edit"
                >
                  Add text
                </Button>
              </Group>
            </div>
          ))}
        </div>
      )}

      {pending > 0 && (
        <div style={galleryStyle(layout)} data-testid="yt-history-skeleton">
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
          <Button
            size="sm"
            variant="subtle"
            color="error"
            loading={busy}
            onClick={() => onCancel(entry)}
            data-testid="yt-history-cancel"
          >
            Cancel
          </Button>
        )}
      </Group>
    </div>
  );
}
