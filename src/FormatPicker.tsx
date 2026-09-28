import { Badge, Button, Stack } from '@civitai/blocks-react/ui';

import {
  LABEL_MAX,
  SUFFIX_MAX,
  isCustomId,
  type Format,
  type PublishedFormat,
} from './formats.js';

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
}) {
  const selected = new Set(selectedIds);
  const lastOne = selectedIds.length <= 1;

  return (
    <div style={gridStyle} role="group" aria-label="Thumbnail formats">
      {formats.map((fmt) => {
        const isOn = selected.has(fmt.id);
        const custom = isCustomId(fmt.id);
        return (
          <div key={fmt.id} style={cardStyle(isOn)} data-testid="yt-format-card">
            <button
              type="button"
              role="checkbox"
              aria-checked={isOn}
              // Deselecting the only selected format is refused by
              // `toggleFormat`; disabling the control says so up front instead
              // of swallowing the click silently.
              disabled={disabled || (isOn && lastOne)}
              onClick={() => onToggle(fmt.id)}
              style={cardButtonStyle}
              data-testid={`yt-format-${fmt.id}`}
              title={fmt.suffix}
            >
              <span style={previewWrapStyle}>
                {fmt.preview ? (
                  <img src={fmt.preview} alt="" loading="lazy" style={previewImgStyle} />
                ) : (
                  <span style={previewPlaceholderStyle} aria-hidden="true">
                    {fmt.label.slice(0, 1).toUpperCase()}
                  </span>
                )}
                {isOn && (
                  <span style={checkStyle} aria-hidden="true">
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
}: {
  draft: { id: string | null; label: string; suffix: string };
  error: string | null;
  busy: boolean;
  onChange: (next: { id: string | null; label: string; suffix: string }) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={editorStyle} data-testid="yt-format-editor">
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
            style={inputStyle}
            data-testid="yt-format-label"
            aria-label="Format name"
          />
        </label>

        <label style={labelStyle}>
          <span>
            Look — added to your prompt{' '}
            <span style={counterStyle}>
              {draft.suffix.length}/{SUFFIX_MAX}
            </span>
          </span>
          <textarea
            value={draft.suffix}
            maxLength={SUFFIX_MAX}
            rows={3}
            placeholder="analog vhs grain, chromatic aberration, 1987 camcorder"
            onChange={(e) => onChange({ ...draft, suffix: e.target.value })}
            style={{ ...inputStyle, resize: 'vertical' }}
            data-testid="yt-format-suffix"
            aria-label="Format look"
          />
        </label>

        {error && (
          <span style={errorStyle} data-testid="yt-format-error">
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
}) {
  return (
    <div style={boardStyle} data-testid="yt-published-board">
      <div style={boardHeadStyle}>
        <strong style={{ fontSize: 14 }}>Published formats</strong>
        <Button variant="subtle" size="sm" loading={loading} onClick={onRefresh}>
          Refresh
        </Button>
      </div>

      {error && (
        <span style={errorStyle} data-testid="yt-published-error">
          {error}
        </span>
      )}

      {!loading && !error && items.length === 0 && (
        <span style={dimStyle} data-testid="yt-published-empty">
          Nothing published yet. Make a format and hit Publish to be the first.
        </span>
      )}

      <Stack gap={8}>
        {items.map((fmt) => (
          <div key={fmt.sharedKey} style={boardRowStyle} data-testid="yt-published-row">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={boardTitleStyle}>
                {fmt.label}{' '}
                <Badge color="info" variant="light">
                  ▲ {fmt.votes}
                </Badge>
              </div>
              <div style={boardSuffixStyle}>{fmt.suffix}</div>
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
// Styles. Every colour reads a `--civitai-color-*` token published by the W6
// pack, so the whole control follows the host between light and dark with no
// second palette of our own to keep in sync.
// ---------------------------------------------------------------------------

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(124px, 1fr))',
  gap: 8,
};

function cardStyle(selected: boolean): React.CSSProperties {
  return {
    display: 'grid',
    gap: 4,
    padding: 4,
    borderRadius: 10,
    border: `1px solid ${selected ? 'var(--civitai-color-primary)' : 'var(--civitai-color-border)'}`,
    background: selected ? 'var(--civitai-color-primary-light)' : 'var(--civitai-color-surface)',
  };
}

const cardButtonStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: 0,
  border: 'none',
  background: 'none',
  color: 'var(--civitai-color-text)',
  cursor: 'pointer',
  textAlign: 'left',
  font: 'inherit',
};

const previewWrapStyle: React.CSSProperties = {
  position: 'relative',
  display: 'block',
  width: '100%',
  aspectRatio: '16 / 9',
  borderRadius: 6,
  overflow: 'hidden',
  background: 'var(--civitai-color-surface-2)',
};

const previewImgStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const previewPlaceholderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  fontSize: 22,
  fontWeight: 700,
  color: 'var(--civitai-color-text-dimmed)',
};

const checkStyle: React.CSSProperties = {
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
  background: 'var(--civitai-color-primary)',
  color: 'var(--civitai-color-primary-fg, #fff)',
};

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

const editorStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 10,
  border: '1px solid var(--civitai-color-border)',
  background: 'var(--civitai-color-surface)',
};

const labelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 13,
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--civitai-color-border)',
  background: 'var(--civitai-color-surface-2)',
  color: 'var(--civitai-color-text)',
  font: 'inherit',
  fontSize: 13,
  fontWeight: 400,
};

const counterStyle: React.CSSProperties = {
  fontWeight: 400,
  color: 'var(--civitai-color-text-dimmed)',
};

const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--civitai-color-error)',
};

const dimStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--civitai-color-text-dimmed)',
};

const boardStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  borderRadius: 10,
  border: '1px solid var(--civitai-color-border)',
  background: 'var(--civitai-color-surface)',
};

const boardHeadStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
};

const boardRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--civitai-color-border)',
  background: 'var(--civitai-color-surface-2)',
};

const boardTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const boardSuffixStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--civitai-color-text-dimmed)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
};
