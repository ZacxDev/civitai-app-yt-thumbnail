import { Badge, Button, Stack } from '@civitai/blocks-react/ui';

import {
  LABEL_MAX,
  SUFFIX_MAX,
  isCustomId,
  type Format,
  type PublishedFormat,
} from './formats.js';
import type { Palette } from './palette.js';

/**
 * The FORMAT picker — a multi-select grid of thumbnail looks.
 *
 * Every selected format becomes its own workflow at Generate time, so this
 * control is directly load-bearing on spend: selecting a third format is
 * selecting a third bill. The count and the per-card selected state are
 * therefore the loudest things on it, and the Generate button carries the
 * summed price (see App.tsx).
 *
 * Presentation only — all the list logic (toggling, the at-least-one invariant,
 * validation, the shared-storage mapping) lives in `formats.ts` and is unit
 * tested there.
 */
export function FormatPicker({
  formats,
  selectedIds,
  onToggle,
  onEdit,
  onDelete,
  onPublish,
  busyId,
  disabled,
  pal,
  minCardPx,
}: {
  formats: readonly Format[];
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
  onEdit: (fmt: Format) => void;
  onDelete: (id: string) => void;
  onPublish: (fmt: Format) => void;
  /** Id of a format with a storage/publish request in flight. */
  busyId: string | null;
  disabled: boolean;
  /** The app-owned palette for the current theme (`brandDepth: skin`). */
  pal: Palette;
  /**
   * Minimum card width, from `layoutForTier(...).formatMinCardPx`. The grid is
   * `auto-fill`, so this is what decides how big a preview gets — see the field's
   * own note in `layout.ts` for why this is a size and not a column count.
   */
  minCardPx: number;
}) {
  const selected = new Set(selectedIds);
  const lastOne = selectedIds.length <= 1;

  return (
    <div
      style={gridStyle(minCardPx)}
      role="group"
      aria-label="Thumbnail formats"
      data-testid="yt-format-grid"
      data-min-card={minCardPx}
    >
      {formats.map((fmt) => {
        const isOn = selected.has(fmt.id);
        const custom = isCustomId(fmt.id);
        return (
          <div key={fmt.id} style={cardStyle(isOn, pal)} data-testid="yt-format-card">
            <button
              type="button"
              role="checkbox"
              aria-checked={isOn}
              // Deselecting the only selected format is refused by
              // `toggleFormat`; disabling the control says so up front instead
              // of swallowing the click silently.
              disabled={disabled || (isOn && lastOne)}
              onClick={() => onToggle(fmt.id)}
              style={cardButtonStyle(pal)}
              data-testid={`yt-format-${fmt.id}`}
              title={fmt.suffix}
            >
              <span style={previewWrapStyle(pal)}>
                {fmt.preview ? (
                  <img src={fmt.preview} alt="" loading="lazy" style={previewImgStyle} />
                ) : (
                  <span style={previewPlaceholderStyle(pal)} aria-hidden="true">
                    {fmt.label.slice(0, 1).toUpperCase()}
                  </span>
                )}
                {/* 🔴 NOT DECORATION — the non-colour half of the selected state.
                    The tint behind a selected card is a ~1.1:1 shift on a light
                    ground, well under WCAG 1.4.11, so the state has to be carried
                    by something else: this badge (brandFg on brand, 6.55:1 dark /
                    4.90:1 light) plus `aria-checked` above. */}
                {isOn && (
                  <span style={checkStyle(pal)} aria-hidden="true">
                    ✓
                  </span>
                )}
              </span>
              <span style={cardLabelStyle}>{fmt.label}</span>
            </button>

            {custom && (
              <div style={cardActionsStyle}>
                <Button
                  variant="subtle"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onEdit(fmt)}
                  aria-label={`Edit ${fmt.label}`}
                >
                  Edit
                </Button>
                <Button
                  variant="subtle"
                  size="sm"
                  loading={busyId === fmt.id}
                  disabled={disabled}
                  onClick={() => onPublish(fmt)}
                  aria-label={`Publish ${fmt.label}`}
                  data-testid={`yt-format-publish-${fmt.id}`}
                >
                  Publish
                </Button>
                <Button
                  variant="subtle"
                  size="sm"
                  color="error"
                  disabled={disabled}
                  onClick={() => onDelete(fmt.id)}
                  aria-label={`Delete ${fmt.label}`}
                  data-testid={`yt-format-delete-${fmt.id}`}
                >
                  Delete
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The create/edit form for one of the viewer's OWN formats.
 *
 * Raw inputs rather than the pack's TextInput/Textarea so the character
 * counters can sit inline with the labels; the pack's own controls are used
 * everywhere a counter isn't needed.
 */
export function FormatEditor({
  draft,
  error,
  busy,
  onChange,
  onSave,
  onCancel,
  pal,
}: {
  draft: { id: string | null; label: string; suffix: string };
  error: string | null;
  busy: boolean;
  onChange: (next: { id: string | null; label: string; suffix: string }) => void;
  onSave: () => void;
  onCancel: () => void;
  pal: Palette;
}) {
  return (
    <div style={editorStyle(pal)} data-testid="yt-format-editor">
      <Stack gap={10}>
        <strong style={{ fontSize: 14 }}>
          {draft.id ? 'Edit format' : 'New format'}
        </strong>

        <label style={labelStyle}>
          <span>Name</span>
          <input
            value={draft.label}
            maxLength={LABEL_MAX}
            placeholder="Retro VHS"
            onChange={(e) => onChange({ ...draft, label: e.target.value })}
            style={inputStyle(pal)}
            data-testid="yt-format-label"
            aria-label="Format name"
          />
        </label>

        <label style={labelStyle}>
          <span>
            Look — added to your prompt{' '}
            <span style={counterStyle(pal)}>
              {draft.suffix.length}/{SUFFIX_MAX}
            </span>
          </span>
          <textarea
            value={draft.suffix}
            maxLength={SUFFIX_MAX}
            rows={3}
            placeholder="analog vhs grain, chromatic aberration, 1987 camcorder"
            onChange={(e) => onChange({ ...draft, suffix: e.target.value })}
            style={{ ...inputStyle(pal), resize: 'vertical' }}
            data-testid="yt-format-suffix"
            aria-label="Format look"
          />
        </label>

        {error && (
          <span style={errorStyle(pal)} data-testid="yt-format-error">
            {error}
          </span>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" loading={busy} onClick={onSave} data-testid="yt-format-save">
            Save
          </Button>
          <Button size="sm" variant="subtle" onClick={onCancel} data-testid="yt-format-cancel">
            Cancel
          </Button>
        </div>
      </Stack>
    </div>
  );
}

/**
 * The published-format board: what other viewers chose to share.
 *
 * Each row carries the actions the shared store gives us — add it to your own
 * picker, up/down-vote it, or report it. `report` is the abuse seam: a published
 * format's text is injected into OTHER people's paid generations, so a viewer
 * who sees something wrong needs a one-click way to escalate it.
 */
export function PublishedBoard({
  items,
  loading,
  error,
  addedIds,
  busyKey,
  onAdd,
  onVote,
  onReport,
  onRefresh,
  pal,
}: {
  items: readonly PublishedFormat[];
  loading: boolean;
  error: string | null;
  addedIds: ReadonlySet<string>;
  busyKey: string | null;
  onAdd: (fmt: PublishedFormat) => void;
  onVote: (fmt: PublishedFormat) => void;
  onReport: (fmt: PublishedFormat) => void;
  onRefresh: () => void;
  pal: Palette;
}) {
  return (
    <div style={boardStyle(pal)} data-testid="yt-published-board">
      <div style={boardHeadStyle}>
        <strong style={{ fontSize: 14 }}>Published formats</strong>
        <Button variant="subtle" size="sm" loading={loading} onClick={onRefresh}>
          Refresh
        </Button>
      </div>

      {error && (
        <span style={errorStyle(pal)} data-testid="yt-published-error">
          {error}
        </span>
      )}

      {!loading && !error && items.length === 0 && (
        <span style={dimStyle(pal)} data-testid="yt-published-empty">
          Nothing published yet. Make a format and hit Publish to be the first.
        </span>
      )}

      <Stack gap={8}>
        {items.map((fmt) => (
          <div key={fmt.sharedKey} style={boardRowStyle(pal)} data-testid="yt-published-row">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={boardTitleStyle}>
                {fmt.label}{' '}
                <Badge color="info" variant="light">
                  ▲ {fmt.votes}
                </Badge>
              </div>
              <div style={boardSuffixStyle(pal)}>{fmt.suffix}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button
                size="sm"
                variant={addedIds.has(fmt.id) ? 'subtle' : 'light'}
                disabled={addedIds.has(fmt.id)}
                onClick={() => onAdd(fmt)}
                data-testid={`yt-published-add-${fmt.sharedKey}`}
              >
                {addedIds.has(fmt.id) ? 'Added' : 'Use'}
              </Button>
              <Button
                size="sm"
                variant="subtle"
                loading={busyKey === fmt.sharedKey}
                onClick={() => onVote(fmt)}
                aria-label={fmt.viewerVoted ? `Remove vote from ${fmt.label}` : `Vote for ${fmt.label}`}
                data-testid={`yt-published-vote-${fmt.sharedKey}`}
              >
                {fmt.viewerVoted ? 'Voted' : 'Vote'}
              </Button>
              <Button
                size="sm"
                variant="subtle"
                color="error"
                onClick={() => onReport(fmt)}
                aria-label={`Report ${fmt.label}`}
                data-testid={`yt-published-report-${fmt.sharedKey}`}
              >
                Report
              </Button>
            </div>
          </div>
        ))}
      </Stack>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles.
//
// 🔴 THESE USED TO READ `--civitai-color-*` — the pack's tokens — and no longer
// do. `brandDepth: "skin"` means the app owns its own palette, so every colour
// below comes from `palette.ts`, keyed by the theme the host reports. That moved
// light/dark correctness for these surfaces from the platform onto us, which is
// why `palette.test.ts` asserts every pair in BOTH themes.
//
// The pack's own components (Button, Badge, Stack) still theme themselves, from
// the same `data-theme` on the block root — they are not restyled here.
// ---------------------------------------------------------------------------

function gridStyle(minCardPx: number): React.CSSProperties {
  return {
    display: 'grid',
    // `auto-fill` with a MINIMUM, not a fixed count — see `formatMinCardPx` in
    // `layout.ts` for why the format grid is sized and the results grid counted.
    gridTemplateColumns: `repeat(auto-fill, minmax(${minCardPx}px, 1fr))`,
    gap: 8,
  };
}

function cardStyle(selected: boolean, pal: Palette): React.CSSProperties {
  return {
    display: 'grid',
    gap: 4,
    padding: 4,
    borderRadius: 10,
    border: `1px solid ${selected ? pal.brandTintBorder : pal.border}`,
    background: selected ? pal.brandTint : pal.surface,
  };
}

function cardButtonStyle(pal: Palette): React.CSSProperties {
  return {
    display: 'grid',
    gap: 4,
    padding: 0,
    border: 'none',
    background: 'none',
    color: pal.text,
    cursor: 'pointer',
    textAlign: 'left',
    font: 'inherit',
  };
}

function previewWrapStyle(pal: Palette): React.CSSProperties {
  return {
    position: 'relative',
    display: 'block',
    width: '100%',
    aspectRatio: '16 / 9',
    borderRadius: 6,
    overflow: 'hidden',
    background: pal.surfaceRaised,
  };
}

const previewImgStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

function previewPlaceholderStyle(pal: Palette): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    fontSize: 22,
    fontWeight: 700,
    color: pal.textDim,
  };
}

function checkStyle(pal: Palette): React.CSSProperties {
  return {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
    background: pal.brand,
    color: pal.brandFg,
  };
}

const cardLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: '0 4px 2px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const cardActionsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 2,
  padding: '0 2px 2px',
};

function editorStyle(pal: Palette): React.CSSProperties {
  return {
    padding: 12,
    borderRadius: 10,
    border: `1px solid ${pal.border}`,
    background: pal.surface,
  };
}

const labelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 13,
  fontWeight: 600,
};

function inputStyle(pal: Palette): React.CSSProperties {
  return {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${pal.border}`,
    background: pal.surfaceRaised,
    color: pal.text,
    font: 'inherit',
    fontSize: 13,
    fontWeight: 400,
  };
}

function counterStyle(pal: Palette): React.CSSProperties {
  return { fontWeight: 400, color: pal.textDim };
}

function errorStyle(pal: Palette): React.CSSProperties {
  return { fontSize: 12, color: pal.danger };
}

function dimStyle(pal: Palette): React.CSSProperties {
  return { fontSize: 12, color: pal.textDim };
}

function boardStyle(pal: Palette): React.CSSProperties {
  return {
    display: 'grid',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    border: `1px solid ${pal.border}`,
    background: pal.surface,
  };
}

const boardHeadStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
};

function boardRowStyle(pal: Palette): React.CSSProperties {
  return {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${pal.border}`,
    background: pal.surfaceRaised,
  };
}

const boardTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

function boardSuffixStyle(pal: Palette): React.CSSProperties {
  return {
    fontSize: 12,
    color: pal.textDim,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  };
}
