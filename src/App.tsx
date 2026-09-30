import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  useAppStorage,
  useAppWorkflows,
  useBlockBreakpoint,
  useBlockContext,
  useBlockResize,
  useBlockToken,
  useBuzzBalance,
  useBuzzWorkflow,
  useImageUpload,
  useRequestConsent,
  useRequestSignIn,
  useResourcePicker,
  useSaveImage,
  useSharedStorage,
} from '@civitai/blocks-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  SegmentedControl,
  Slider,
  Stack,
  Textarea,
  TextInput,
  injectBlocksStyles,
} from '@civitai/blocks-react/ui';
import type { BlockWorkflowSnapshot, BuzzAccountType } from '@civitai/app-sdk/blocks';

import {
  ACCOUNT_CHOICES,
  PROMPT_MAX,
  QUANTITY_MAX,
  QUANTITY_MIN,
  accountLabel,
  aggregateEstimate,
  aggregateSpend,
  clampQuantity,
  clearPromptEdit,
  effectivePrompt,
  failedRuns,
  formatCost,
  hasBudgetedScope,
  imageUrlsFrom,
  initRuns,
  isBusyPhase,
  isPartialFailure,
  isPromptEdited,
  overallPhase,
  patchRun,
  phaseForError,
  phaseForSnapshot,
  pickDefaultAccount,
  promptFieldValue,
  promptWasTruncated,
  promptsReadyToSubmit,
  runCandidates,
  setPromptEdit,
  spentAccountLabel,
  submitErrorReason,
  isTerminalStatus,
  type AccountChoice,
  type FormatRun,
  type GenPhase,
  type PromptEdits,
  type SourceImage,
} from './generation.js';
import {
  CUSTOM_FORMATS_KEY,
  DEFAULT_FORMAT_ID,
  allFormats,
  customFormatId,
  customFormatsFull,
  deleteCustomFormat,
  formatsFromSharedItems,
  parseCustomFormats,
  reconcileSelection,
  resolveFormats,
  serializeCustomFormats,
  sharedValueForFormat,
  toggleFormat,
  upsertCustomFormat,
  validateCustomFormat,
  type CustomFormat,
  type Format,
  type PublishedFormat,
} from './formats.js';
import { FormatEditor, FormatPicker, PublishedBoard } from './FormatPicker.js';
import {
  DEFAULT_CHECKPOINT,
  LORA_STRENGTH_MAX,
  LORA_STRENGTH_MIN,
  MAX_LORAS,
  addLora,
  checkpointFromPick,
  familyHasLoras,
  loraFromPick,
  removeLora,
  setLoraWeight,
  type CheckpointOption,
  type LoraOption,
} from './models.js';
import {
  DEFAULT_TEXT_OVERLAY,
  YT_H,
  YT_W,
  downloadBlob,
  drawThumbnail,
  exportLadder,
  loadImageElement,
  thumbnailFileName,
  type TextOverlay,
} from './editor.js';
import {
  HISTORY_PAGE_SIZE,
  HISTORY_PREFIX,
  batchBodies,
  batchStatusColor,
  batchStatusLabel,
  candidateFileName,
  historyKey,
  joinHistory,
  oldestWorkflowTime,
  orphanedKeys,
  parseRecord,
  recordFits,
  type GenerationForm,
  type GenerationRecord,
  type HistoryEntry,
} from './history.js';
import { layoutForTier, type BlockLayout } from './layout.js';
import { BUZZ_TYPE_COLOR, paletteFor, parseHex, type Palette } from './palette.js';
import { useUltrawide } from './useUltrawide.js';

/**
 * Which generation path the page is driving:
 *  - `generate` — text-to-image from a prompt (16:9 1280×720), the primary path.
 *  - `remix`    — img2img: the user uploads a photo via the HOST's generationSource
 *                 upload bridge and the generation is seeded from it. PAGE-ONLY
 *                 (a model-slot token rejects `sourceImage` fail-closed); this app
 *                 is a page app.
 * Both share the same estimate -> (lazy consent) -> submit -> poll driver, the
 * checkpoint/LoRA picks, and the Buzz account picker; only the body differs.
 */
type GenMode = 'generate' | 'remix';

// Inject the W6 component pack's stylesheet at module init (before first paint)
// to avoid the documented one-frame FOUC (the pack's components also call
// useBlocksStyles() internally, but injecting up front means the first paint is
// already styled). Idempotent.
injectBlocksStyles();

/**
 * YT Thumbnail — a full-page (W10) money-path App that generates YouTube
 * thumbnails: 16:9 generations (1280×720), img2img remixes of the user's own
 * photo, a canvas text-overlay editor, and a YouTube-capped export. The entire
 * interface is built from the `@civitai/blocks-react/ui` W6 component pack
 * (Button, Textarea, TextInput, Slider, Card, Stack, Group, Alert, Badge). It
 * exercises the page money path end-to-end: estimate -> (lazy consent) ->
 * submit -> poll -> real Buzz spend, using the published SDK hooks (NEVER raw
 * postMessage to the parent with a wildcard origin — the SDK does the
 * origin-checked messaging safely).
 *
 * Page-native constraints:
 *  - slot = app.page (entity=none) via the top-level `page:{}` manifest object.
 *  - scopes = ['ai:write:budgeted'] ONLY. The viewer's per-pool balance is read
 *    via the host-mediated `useBuzzBalance()` bridge (GET_BUZZ_BALANCE) — the
 *    host resolves the viewer from the block token, so NO `buzz:read:self` scope
 *    is needed and the block never touches the balance API directly. The app does
 *    NOT render a balance readout: your app runs inside the Civitai chrome, which
 *    already shows the viewer's balance — duplicating it is noise. The balance is
 *    read only to annotate the "Spend from" account picker. (Insufficient Buzz is
 *    still ALSO surfaced from a `failed` snapshot, as a backstop.)
 *  - budget comes from manifest `page.buzzBudgetPerGen`; a page is stateless.
 *  - a page has no HOST model context (entity=none), so the app ships a curated
 *    default checkpoint (DEFAULT_CHECKPOINT) and lets the user change it via the
 *    HOST's resource picker (`useResourcePicker`). The
 *    block never browses a catalog itself — the host serves the picker (in
 *    dev:live AND on the real platform). A pick is DISCOVERY ONLY — the server
 *    re-validates + re-prices it at estimate/submit.
 *  - on top of the checkpoint the user can add up to MAX_LORAS LoRAs, each with
 *    an adjustable weight; they ride along as `additionalResources` in the body.
 *    LoRA picks + weights are ALSO discovery only — the server re-validates
 *    (LoRA-only? base-model compatible? entitled?) + re-prices before any spend.
 *  - `ai:write:budgeted` is consent-gated -> withheld at mint, requested lazily
 *    on first Generate via useRequestConsent; the grant arrives as a
 *    TOKEN_REFRESH carrying the scope, which we observe + retry.
 *  - the remix source image comes from the host's `useImageUpload({
 *    purpose: 'generationSource' })` bridge — an unscanned, Civitai-hosted
 *    private input the orchestrator scans at generation time. The app NEVER
 *    accepts an arbitrary URL here (the server rejects non-Civitai hosts).
 *
 * Per-account Buzz: the viewer can pick which pool (Blue/Green/Yellow) funds the
 * generation, or leave it on Auto (the default — host-chosen order, UNCHANGED
 * behavior: Auto threads no `accountType`). A pick is a *preference*: the server
 * clamps it to what the viewer holds + the app's content-rating domain, and
 * REJECTS a pool the domain forbids (handled gracefully -> a friendly note +
 * reset to Auto). After a gen, `snapshot.spentAccountType` tells you which pool
 * primarily funded it (can be blue/free).
 */
export function App() {
  const { ready, viewer, theme } = useBlockContext();
  const token = useBlockToken();
  const { estimate, submit, poll } = useBuzzWorkflow();
  const { requestConsent } = useRequestConsent();
  const { requestSignIn } = useRequestSignIn();
  // The host-mediated pickers. `open(...)` asks the HOST to open its own native
  // resource modal; the block never sees a catalog, only the chosen resource.
  // Identical protocol in dev:harness (mock pick), dev:live (host-served
  // overlay), and on the real platform. A pick is DISCOVERY ONLY.
  const { open: openResourcePicker } = useResourcePicker();
  // The host's image-upload bridge for img2img sources. `open()` resolves with
  // the UNSCANNED private `{ url, width, height }` (Civitai-hosted by contract)
  // or `null` when the user dismisses the modal.
  const { open: openSourceUpload } = useImageUpload({ purpose: 'generationSource' });
  // The viewer's per-pool Buzz balance, read host-side (no scope needed). NOT
  // rendered as a balance readout — the surrounding Civitai chrome already shows
  // the viewer's balance, so an in-app copy is redundant. It is read for ONE
  // purpose: annotating which account can actually fund a generation in the
  // "Spend from" picker below. It NEVER blocks generation (a missing/errored
  // balance still lets the user generate; the server is the real gate).
  const { balance, refetch: refetchBalance } = useBuzzBalance();
  // Per-(block, viewer) private KV. Holds ONLY this viewer's own formats.
  // 🔴 There is no localStorage fallback and there cannot be one: the block's
  // iframe sandbox is `allow-scripts allow-forms` with no `allow-same-origin`
  // (the platform forces that for an unverified block), so the document has an
  // OPAQUE origin and `localStorage` throws on access. Host-mediated storage is
  // the only persistence available here.
  const storage = useAppStorage();
  // The app-wide, votable, MODERATED board of published formats.
  const shared = useSharedStorage();
  // 🔴 THE ONLY WAY A PAID OUTPUT CAN BE SAVED. This block's iframe is sandboxed
  // WITHOUT `allow-downloads` and cannot ask for it (an unverified block is
  // refused the token at submit — see manifest.test.ts), so an `<a download>`
  // click is silently inert. `saveImage` asks the HOST to fetch the blob in its
  // unsandboxed top frame and trigger the browser's own Save As. It works for a
  // url on the civitai image/blob CDN, which the orchestration URLs of our own
  // candidates are — and NOT for the editor's composited export, which is a
  // local canvas `blob:` the host's https-only allowlist explicitly drops.
  const { saveImage } = useSaveImage();
  // THE LIVE HALF OF HISTORY. Token-bound + tag-forced host-side: this app's own
  // generations for this viewer, newest-first. It carries status/images/cost and
  // a `cancel`, and DELIBERATELY carries no prompts or params — which is why the
  // other half lives in `useAppStorage`. See history.ts for the join.
  const {
    workflows,
    loading: historyLoading,
    error: historyError,
    refetch: refetchWorkflows,
    cancel: cancelWorkflow,
  } = useAppWorkflows({ limit: HISTORY_PAGE_SIZE });

  const anon = ready && !viewer;
  // The viewer's identity as a PRIMITIVE. `useBlockContext()` can hand back a
  // fresh `viewer` OBJECT on a render where nothing about the viewer changed, so
  // anything keying a callback or an effect on "which viewer is this" must read
  // this — see `loadHistory` for what depending on the object actually cost.
  const viewerId = viewer?.id ?? null;
  const granted = hasBudgetedScope(token.scopes);

  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  // WIDTH-ADAPTIVE LAYOUT. `useBlockBreakpoint` reports the width tier of THIS
  // BLOCK'S OWN BOX — a container query, not a viewport media query — because a
  // block renders inside whatever slot the host gave it and SLOT WIDTH IS NOT
  // MONOTONIC IN VIEWPORT WIDTH (the `model.sidebar_top` slot is ~360px on a
  // phone and only ~430px on a 1440px desktop). Any viewport-based test —
  // a viewport media query, or the window's own width read from JS — asks about
  // the browser window, which is a question nobody here needed answered.
  //
  // Scale (CSS px, Civitai's own — NOT Mantine's stock em scale, which agrees on
  // `sm` alone): xs 480 · sm 768 · md 1024 · lg 1184 · xl 1440. The same numbers
  // are published as the `--civitai-bp-*` custom properties.
  //
  // 🔴 THOSE TOKENS CANNOT BE USED IN A QUERY CONDITION. `@media (min-width:
  // var(--civitai-bp-sm))` is silently DEAD — a media/container query prelude is
  // evaluated before custom properties are substituted, so the rule simply never
  // applies: no error, no warning, no console noise. Write the pixel value out,
  // or branch in JS the way this component does. (An `internal/scaffold` guard in
  // the CLI repo fails on a `var()` inside any `@media`/`@container` prelude in
  // these templates, for exactly this reason.)
  //
  // Re-render safety: the hook stores the resolved TIER, not the width, so
  // dragging a window edge 200px inside one tier re-renders this block zero
  // times. Full guide: https://developer.civitai.com/apps/responsive
  const bp = useBlockBreakpoint(rootRef);
  // 🔴 THE TIER CANNOT ANSWER "ULTRAWIDE" AND NEVER WILL. `xl` is UNBOUNDED —
  // 1440px and 2560px resolve identically — and the SDK hook deliberately exposes
  // no raw width. So the fourth column needs a threshold this app owns. Same
  // observe/dedupe/seed discipline, resolved to a boolean; see `useUltrawide.ts`.
  const ultrawide = useUltrawide(rootRef);
  // ONE PLACE where width decides shape. Every layout decision below reads a
  // field off this object; none of them re-derives a breakpoint comparison. The
  // function is pure and unit-tested with literal expectations per tier
  // (`layout.test.ts`), which is what makes the 640px column this replaces
  // impossible to reintroduce by accident at one of six call sites.
  //
  // `measured` is not gated on: the fallback tier is `'base'`, whose branch is the
  // single-column layout, which is the safe answer for an unmeasured block.
  const layout = layoutForTier(bp.tier, ultrawide);
  // The app-owned palette for the theme the host reports (`brandDepth: "skin"`).
  const pal = paletteFor(theme);

  const [mode, setMode] = useState<GenMode>('generate');
  const [prompt, setPrompt] = useState('');
  /**
   * Per-format overrides of the composed prompt (see `generation.ts`'s
   * PromptEdits). Keyed by format id, session-only, never persisted.
   *
   * 🔴 DELIBERATELY NOT PRUNED ON DESELECT, and that is the persistence answer:
   * toggling a format's chip off and on again brings the row back with the
   * viewer's text intact. A chip is a one-click, easily mis-hit control; losing
   * a paragraph to a mis-click is a worse failure than carrying a few strings
   * nothing currently reads. `effectivePrompt` only ever looks up the formats
   * that are SELECTED, so a stale entry for a deleted format is inert.
   */
  const [promptEdits, setPromptEdits] = useState<PromptEdits>({});
  const [touched, setTouched] = useState(false);
  const [account, setAccount] = useState<AccountChoice>('auto');
  const [quantity, setQuantity] = useState(1);
  const [sourceImage, setSourceImage] = useState<SourceImage | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Formats ---
  // The viewer's own formats, hydrated from `useAppStorage` on mount. Empty for
  // an anonymous viewer (storage resolves null for them) — see `storageState`.
  const [customFormats, setCustomFormats] = useState<CustomFormat[]>([]);
  // Published formats the viewer has pulled in from the shared board.
  const [addedPublished, setAddedPublished] = useState<PublishedFormat[]>([]);
  const [selectedFormatIds, setSelectedFormatIds] = useState<string[]>([DEFAULT_FORMAT_ID]);
  const [formatDraft, setFormatDraft] = useState<{
    id: string | null;
    label: string;
    suffix: string;
  } | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [formatBusyId, setFormatBusyId] = useState<string | null>(null);
  const [storageState, setStorageState] = useState<'loading' | 'ready' | 'anon' | 'error'>(
    'loading',
  );
  const [storageNote, setStorageNote] = useState<string | null>(null);

  // --- Thumbnail history ---
  // The STORED half: batch records read back from useAppStorage, newest-first
  // (the key encodes an inverted timestamp precisely so the listing IS that
  // order — see history.ts historyKey).
  const [historyRecords, setHistoryRecords] = useState<
    Array<{ key: string; record: GenerationRecord }>
  >([]);
  // 🔴 A FIRST-CLASS STATE, NOT A SWALLOWED REJECTION. The apps:storage scopes
  // have never been consented in production — history is the first surface to
  // touch them — so a scope-denied read/write is a REALISTIC first run, not an
  // edge. It gets its own state and its own message rather than an empty panel
  // that looks like "you have no history".
  const [historyState, setHistoryState] = useState<
    'loading' | 'ready' | 'anon' | 'denied' | 'error'
  >('loading');
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBusyKey, setHistoryBusyKey] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  // --- The published board ---
  const [boardOpen, setBoardOpen] = useState(false);
  const [boardItems, setBoardItems] = useState<PublishedFormat[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardBusyKey, setBoardBusyKey] = useState<string | null>(null);

  // --- The money path ---
  // ONE RUN PER SELECTED FORMAT. This replaces the old single set of scalars
  // (phase / estimatedCost / actualCost / imageUrls): N formats mean N
  // independent workflows, each with its own price, its own poll loop and its
  // own way to fail. The page chrome is derived from the array, never stored
  // alongside it, so a partial failure cannot leave the two disagreeing.
  const [runs, setRuns] = useState<FormatRun[]>([]);
  // True once the viewer has picked a Buzz account themselves. Until then the
  // app is free to apply the blue -> green -> yellow default on their behalf;
  // after it, their choice is never silently overwritten.
  const accountTouchedRef = useRef(false);

  // The selected checkpoint. Starts on the curated DEFAULT (works at first paint,
  // before the user opens the picker); the host picker replaces it. A pick is
  // DISCOVERY ONLY — the server re-validates + re-prices it.
  const [checkpoint, setCheckpoint] = useState<CheckpointOption>(DEFAULT_CHECKPOINT);
  // The LoRAs the user has layered on top of the checkpoint, with their weights.
  // Drives `additionalResources` in the body. All mutations go through the pure
  // models.ts helpers (dedup, MAX_LORAS cap, weight clamp). DISCOVERY ONLY.
  const [loras, setLoras] = useState<LoraOption[]>([]);
  // True while a host picker modal is open, so the trigger button shows progress
  // and we don't fire a second open over the first.
  const [pickerBusy, setPickerBusy] = useState(false);

  // --- Editor state ---
  // The gallery image being edited (its URL) + the overlay spec. The overlay
  // persists across images so a tweak carries over; the loaded <img> element and
  // its load status are per-image.
  const [editing, setEditing] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<TextOverlay>(DEFAULT_TEXT_OVERLAY);
  const [editorImage, setEditorImage] = useState<HTMLImageElement | null>(null);
  const [editorStatus, setEditorStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [downloadCount, setDownloadCount] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // True once the user clicked Generate while the scope was missing — so when
  // the consent grant lands (granted flips true) we auto-resume the submit.
  const consentPendingRef = useRef(false);
  // Cancellation token for the in-flight poll loop.
  const pollCancelRef = useRef<{ cancelled: boolean } | null>(null);

  // Latest poll fn in a ref so the poll loop always calls the current hook
  // instance without re-subscribing.
  const pollRef = useRef(poll);
  pollRef.current = poll;

  /**
   * 🔴 THE STORAGE HANDLE, HELD IN A REF SO NOTHING DEPENDS ON ITS IDENTITY.
   *
   * `useAppStorage()` documents itself as "stable across renders", and the
   * shipped hook is. That promise is NOT a property of the seam, only of one
   * implementation of it: a mocked host (`useAppStorage: () => ({ … })`, which is
   * how three suites here wire it) hands back a FRESH object on every render, and
   * so could any future host build.
   *
   * An effect that lists `storage` in its dependency array then re-runs on every
   * render. If that effect sets state — which a load effect must, to show
   * "loading" — each run schedules a render, which changes the identity again.
   * The result is not a slow render or a warning: it is an unbounded async spin
   * that allocates on every cycle, and it took a test worker to an
   * out-of-memory KILL rather than to a failed assertion. It was already latent
   * in the formats loader below; adding a second storage-backed effect (history)
   * doubled the per-cycle allocation and made it fatal.
   *
   * A ref is read at CALL time and never appears in a dependency array, so the
   * whole class is gone regardless of what the host hands back.
   */
  const storageRef = useRef(storage);
  storageRef.current = storage;

  useEffect(() => {
    return () => {
      if (pollCancelRef.current) pollCancelRef.current.cancelled = true;
    };
  }, []);

  // --- DERIVED money-path state ---
  // All of it is computed from `runs`, never stored beside it, so the button
  // price, the spend line and the gallery can never disagree with each other
  // after a partial failure.
  const phase = overallPhase(runs);
  const { total: estimatedCost, partial: estimatePartial } = aggregateEstimate(runs);
  const actualCost = aggregateSpend(runs);
  const candidates = runCandidates(runs);
  const failed = failedRuns(runs);
  const partialFailure = isPartialFailure(runs);

  // The full selectable catalogue, and the formats this click will actually run.
  const availableFormats = allFormats(customFormats, addedPublished);
  const selectedFormats = resolveFormats(selectedFormatIds, availableFormats);

  // 🔴 ONE RULE, ONE PLACE. "Is there anything to send?" is asked in THREE
  // places — the Generate button's `disabled`, the click handler's own early
  // return, and the prompt field's validation message — and before this it was
  // open-coded as `prompt.trim().length === 0` at each of them. Widening only the
  // `disabled` attribute would have produced an ENABLED button whose handler
  // still returned immediately: a click that reports success and spends nothing,
  // which is indistinguishable from a swallowed event. All three now read this.
  //
  // It is EDIT-AWARE: `promptsReadyToSubmit` also refuses a click in which any
  // selected row has been edited to blank, which would otherwise submit an empty
  // `params.prompt` for that format and charge for it.
  const submittable = promptsReadyToSubmit(prompt, selectedFormats, promptEdits);

  // Refetch the balance after a successful generation debits it.
  useEffect(() => {
    if (phase === 'succeeded') refetchBalance();
  }, [phase, refetchBalance]);

  // --- Load the viewer's own formats ---
  // 🔴 ANONYMOUS VIEWERS GET NO PERSISTENCE. `useAppStorage().get()` resolves
  // `null` for them and `set()` REJECTS, so there is nothing to load and nothing
  // we could save. That is surfaced explicitly (a sign-in line under the picker)
  // rather than left to look like a bug: silently showing an empty, unsaveable
  // editor is how a viewer loses work they thought they had.
  useEffect(() => {
    if (!ready) return;
    if (!viewer) {
      setStorageState('anon');
      return;
    }
    let alive = true;
    setStorageState('loading');
    storageRef.current
      .get(CUSTOM_FORMATS_KEY)
      .then((raw) => {
        if (!alive) return;
        setCustomFormats(parseCustomFormats(raw));
        setStorageState('ready');
      })
      .catch(() => {
        if (!alive) return;
        // A read failure is NOT fatal: the built-ins still work, so degrade to
        // "your saved formats couldn't be loaded" rather than blocking the app.
        setStorageState('error');
      });
    return () => {
      alive = false;
    };
    // 🔴 `storage` is deliberately ABSENT from these deps and read through
    // `storageRef` instead — see the ref's own comment. Keyed on `viewerId` (a
    // primitive) rather than the `viewer` object for the same reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, viewerId]);

  // Keep the selection pointing only at formats that still exist, and keep the
  // at-least-one invariant, after a delete / withdraw / failed load.
  useEffect(() => {
    setSelectedFormatIds((cur) => {
      const next = reconcileSelection(cur, availableFormats);
      // Preserve identity when nothing changed so this never loops.
      return next.length === cur.length && next.every((id, i) => id === cur[i]) ? cur : next;
    });
    // `availableFormats` is rebuilt every render; its CONTENT is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customFormats, addedPublished]);

  // --- Editor load + draw ---
  // Load the edited image ONCE per edit target. crossOrigin='anonymous' keeps
  // the canvas un-tainted so toBlob can export; a CORS-hostile image URL fails
  // the LOAD (not silently taints) and we degrade to a plain-image fallback.
  useEffect(() => {
    if (!editing) {
      setEditorImage(null);
      setEditorStatus('idle');
      setExportNote(null);
      return;
    }
    let alive = true;
    setEditorStatus('loading');
    setExportNote(null);
    loadImageElement(editing)
      .then((img) => {
        if (!alive) return;
        setEditorImage(img);
        setEditorStatus('ready');
      })
      .catch(() => {
        if (!alive) return;
        setEditorImage(null);
        setEditorStatus('error');
      });
    return () => {
      alive = false;
    };
  }, [editing]);

  // Redraw on every overlay / image change. Skipped when no canvas/image — the
  // editor renders its controls only in the ready state.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !editorImage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = YT_W;
    canvas.height = YT_H;
    drawThumbnail(ctx, editorImage, overlay);
  }, [editorImage, overlay]);

  /**
   * Classify a storage rejection. `useAppStorage` rejects an anonymous write and
   * a scope-denied call with the host's free-text error, and those are DIFFERENT
   * problems with different fixes — "sign in" versus "grant this app storage
   * access" — so they must not collapse into one "couldn't save".
   *
   * 🔴 THIS IS A SUBSTRING HEURISTIC OVER FREE TEXT and it is labelled as one.
   * There is no structured error code on this bridge, so the honest fallback is
   * `'error'` — a generic, still-actionable message — rather than guessing.
   * Defined HERE, above `runGeneration`, because that callback lists it as a
   * dependency: a `const` referenced in a dependency array declared later in the
   * body is a TDZ ReferenceError at first render, not a lint nit.
   */
  const classifyStorageError = useCallback((err: unknown): 'anon' | 'denied' | 'error' => {
    const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
    if (msg.includes('anon') || msg.includes('sign in') || msg.includes('not signed in')) {
      return 'anon';
    }
    if (msg.includes('scope') || msg.includes('forbidden') || msg.includes('denied')) {
      return 'denied';
    }
    return 'error';
  }, []);

  // The server rejected the picked pool for this app's content-rating domain.
  // Surface a friendly note and fall back to Auto so the retry just works.
  const handleAccountRejected = useCallback(() => {
    setAccount('auto');
    setError(
      "That Buzz account can't be used for this app's content rating — switched back to Auto. Try again.",
    );
  }, []);

  // Apply a (submit- or poll-returned) snapshot to ONE run's row.
  //
  // Always a FUNCTIONAL setState keyed on formatId: N workflows reply
  // independently and out of order, so writing a whole precomputed array here
  // would let a slow run's reply revert a fast run's result.
  const applySnapshotToRun = useCallback(
    (formatId: string, snap: BlockWorkflowSnapshot) => {
      const next = phaseForSnapshot(snap);
      const urls = imageUrlsFrom(snap);
      setRuns((cur) =>
        patchRun(cur, formatId, {
          phase: next,
          workflowId: snap.workflowId ?? null,
          // Only WRITE a cost the server actually sent. A mid-flight `pending`
          // snapshot usually carries none, and blanket-assigning `?? null`
          // would erase a price we had already been told.
          ...(snap.cost?.total != null ? { actualCost: snap.cost.total } : {}),
          ...(urls.length > 0 ? { imageUrls: urls } : {}),
          ...(next === 'succeeded'
            ? // The pool that PRIMARILY funded this run (largest debit) — can be
              // blue (free/earned), not necessarily the paid account.
              { spentAccount: snap.spentAccountType ?? null }
            : {}),
          ...(next === 'failed' || next === 'insufficient'
            ? { error: snap.error ?? 'Generation failed.' }
            : {}),
        }),
      );
      if (next === 'account-rejected') handleAccountRejected();
    },
    [handleAccountRejected],
  );

  /**
   * Drive a single workflow to terminal with an adaptive-backoff poll loop.
   * `submit()` does NOT auto-poll (SDK contract) — the caller owns the loop.
   *
   * Robustness contract: a `poll()` THROW is a transport/infra blip (a network
   * hiccup, a not-yet-rolled-out backend pod 401ing for a few seconds, …) — NOT
   * a workflow failure. A workflow that the orchestrator actually failed comes
   * back as a 'failed'/'expired'/'canceled' SNAPSHOT, never a throw. So we retry
   * a throw with bounded backoff instead of failing the generation (which would
   * mark a server-side SUCCESS as FAILED — the round-5 dogfood bug). Only after
   * MAX_TRANSIENT_ERRORS consecutive failures (the backend is genuinely
   * unreachable, not just blipping) do we give up with a clear transport error.
   * The error counter resets on any successful poll, so a long generation that
   * hits the occasional blip never accumulates toward the cap.
   */
  const runPollLoop = useCallback(
    (formatId: string, workflowId: string, tok: { cancelled: boolean }) => {
      // 🔴 The cancel token is PASSED IN, one per BATCH, not minted here. The
      // single-workflow version replaced `pollCancelRef.current` on every call,
      // which with N concurrent runs would mean each new poll loop cancelled its
      // own siblings and only the last format ever finished.

      // Backoff between normal (snapshot-returning) polls.
      const SCHEDULE_MS = [2000, 2000, 3000, 5000, 8000];
      // Shorter backoff between retries of a transient transport error, so a
      // brief blip recovers fast.
      const RETRY_MS = [500, 1000, 2000, 4000];
      // Give up only after this many CONSECUTIVE transport failures (~30s of
      // retries) — a genuinely-down backend, not a transient blip.
      const MAX_TRANSIENT_ERRORS = 8;
      let attempt = 0;
      let consecutiveErrors = 0;

      const tick = async () => {
        if (tok.cancelled) return;
        let snap: BlockWorkflowSnapshot;
        try {
          snap = await pollRef.current(workflowId);
        } catch {
          // Transient hiccup — retry with bounded backoff. A real terminal
          // failure surfaces as a 'failed'/'expired' snapshot, not a throw.
          if (tok.cancelled) return;
          consecutiveErrors += 1;
          if (consecutiveErrors > MAX_TRANSIENT_ERRORS) {
            // Backend unreachable after repeated retries — surface a transport
            // error (distinct from a workflow failure) and stop. Scoped to THIS
            // run: the other formats' workflows are unaffected and may well
            // still be delivering.
            setRuns((cur) =>
              patchRun(cur, formatId, {
                phase: 'failed',
                error:
                  "Couldn't reach the generation service after several retries. " +
                  'This one may still be running — refresh to check.',
              }),
            );
            return;
          }
          const delay = RETRY_MS[Math.min(consecutiveErrors - 1, RETRY_MS.length - 1)];
          setTimeout(tick, delay);
          return;
        }
        if (tok.cancelled) return;
        // A successful poll clears the transient-error streak.
        consecutiveErrors = 0;
        applySnapshotToRun(formatId, snap);
        if (isTerminalStatus(snap.status)) return;
        const delay = SCHEDULE_MS[Math.min(attempt, SCHEDULE_MS.length - 1)];
        attempt += 1;
        setTimeout(tick, delay);
      };

      setTimeout(tick, 0);
    },
    [applySnapshotToRun],
  );

  /**
   * ONE Generate click -> N workflows, one per selected format.
   *
   * The shape is deliberately TWO PASSES rather than N independent pipelines:
   *
   *   pass 1  estimate every format
   *   ------  then, and only then, choose the Buzz account, because the
   *           blue -> green -> yellow ladder needs the TOTAL of all N estimates
   *           to know which pool can actually cover the click. Deciding per-run
   *           would let three formats each individually "fit" in blue while
   *           together they do not.
   *   pass 2  submit every still-viable format, then poll each to terminal.
   *
   * 🔴 PARTIAL FAILURE IS THE NORMAL CASE, NOT THE EDGE. Each run owns its own
   * phase/cost/images, every post-estimate write is a functional `patchRun`
   * keyed on formatId, and nothing here aborts the batch on a single run's
   * failure. A format that fails costs its siblings nothing — not their
   * submission, not their results, and not their reported spend.
   */
  const runGeneration = useCallback(async () => {
    setError(null);
    const formats = resolveFormats(selectedFormatIds, availableFormats);
    // `reconcileSelection` guarantees at least one, so this is a belt-and-braces
    // guard against a zero-workflow click that would "succeed" having spent 0.
    if (formats.length === 0) return;

    // One cancel token for the WHOLE batch. Starting a new batch (or switching
    // mode / unmounting) cancels every run's poll loop at once.
    if (pollCancelRef.current) pollCancelRef.current.cancelled = true;
    const tok = { cancelled: false };
    pollCancelRef.current = tok;

    // The ONLY difference between the two modes is the body: a remix threads the
    // uploaded sourceImage (img2img); generate does not. The FORMAT's difference
    // is the composed prompt — that is what makes these N requests rather than
    // one with a bigger quantity.
    //
    // 🔴 `effectivePrompt` IS THE SAME FUNCTION THE EDITABLE PREVIEW READS. It
    // returns the viewer's edited text for a row they took over, and
    // `composePrompt` byte-for-byte for a row they did not. There is no second
    // path by which a prompt can reach this body, which is what stops the field
    // and the wire from disagreeing about the string being paid for.
    //
    // 🔴 ONE RULE, ONE PLACE — AND IT IS WHAT MAKES RESUME EXACT. The form
    // snapshot below is not a parallel description of the click for history's
    // benefit; it IS the thing the bodies are built from. `bodyFor` asks
    // `batchBodies` for one format's body, the history record stores the same
    // snapshot, and a resume rebuilds bodies from that stored snapshot with the
    // same function. A second body-builder written "for history" is precisely
    // how a resume ends up reproducing something the original never sent.
    const formSnapshot = (fmts: readonly Format[], acct: AccountChoice): GenerationForm => ({
      mode,
      prompt,
      promptEdits: { ...promptEdits },
      formats: fmts.map((f) => ({
        id: f.id,
        label: f.label,
        suffix: f.suffix,
        prompt: effectivePrompt(prompt, f, promptEdits),
      })),
      checkpoint,
      loras: [...loras],
      quantity: clampQuantity(quantity),
      account: acct,
      sourceImage: mode === 'remix' ? sourceImage : null,
    });
    const bodyFor = (fmt: Format, acct: AccountChoice) => batchBodies(formSnapshot([fmt], acct))[0];

    setRuns(initRuns(formats).map((r) => ({ ...r, phase: 'estimating' as GenPhase })));

    // ---- Pass 1: estimate every format, in parallel ----
    // A THROWN estimate is not fatal (the server re-prices at submit anyway), so
    // it leaves the run priceless but still viable. A RETURNED failure is
    // classified: it terminates that one run.
    const estimates = await Promise.all(
      formats.map(async (fmt) => {
        try {
          const est = await estimate(bodyFor(fmt, account));
          if (est.status === 'failed' || est.error) {
            return { fmt, cost: null, phase: phaseForError(est.error), error: est.error ?? null };
          }
          return { fmt, cost: est.cost?.total ?? null, phase: null, error: null };
        } catch {
          return { fmt, cost: null, phase: null, error: null };
        }
      }),
    );
    if (tok.cancelled) return;

    let priced = initRuns(formats).map((r) => ({ ...r, phase: 'estimating' as GenPhase }));
    for (const e of estimates) {
      priced = patchRun(priced, e.fmt.id, {
        estimatedCost: e.cost,
        ...(e.phase ? { phase: e.phase, error: e.error } : {}),
      });
    }
    setRuns(priced);

    // A disallowed POOL is a property of the click, not of one format: every run
    // would reject the same way. Reset to Auto and stop rather than burn N
    // identical rejections.
    if (priced.some((r) => r.phase === 'account-rejected')) {
      handleAccountRejected();
      return;
    }

    // ---- The blue -> green -> yellow default ----
    // Applied only while the viewer has not picked a pool themselves. Setting
    // the state (rather than quietly submitting under a different account than
    // the picker shows) keeps the control honest about what is being spent.
    const { total } = aggregateEstimate(priced);
    let acct = account;
    if (!accountTouchedRef.current) {
      acct = pickDefaultAccount(balance, total);
      if (acct !== account) setAccount(acct);
    }

    // ---- Pass 2: submit + poll every run that survived the estimate ----
    const viable = priced.filter((r) => r.phase === 'estimating');
    setRuns((cur) =>
      cur.map((r) => (r.phase === 'estimating' ? { ...r, phase: 'submitting' as GenPhase } : r)),
    );

    // 🔴 THE GROUPING HAS TO BE COLLECTED HERE. The host drops `tags` from the
    // AppWorkflow projection, so nothing on the live side ties one click's N
    // workflows together — if we do not write down which ids this click
    // produced, a 3-format run reappears in history as three unrelated rows at
    // three unrelated prices. See history.ts's header.
    const submittedIds: string[] = [];

    await Promise.all(
      viable.map(async (r) => {
        const fmt = formats.find((f) => f.id === r.formatId);
        if (!fmt) return;
        let snap: BlockWorkflowSnapshot;
        try {
          snap = await submit(bodyFor(fmt, acct));
        } catch (err) {
          // NOT `err.message` — under blocks-react ^0.44 that is a generic
          // template and the server's reason rides on `.snapshot.error`.
          const msg = submitErrorReason(err);
          const failPhase = phaseForError(msg);
          if (tok.cancelled) return;
          setRuns((cur) => patchRun(cur, fmt.id, { phase: failPhase, error: msg }));
          if (failPhase === 'account-rejected') handleAccountRejected();
          return;
        }
        if (tok.cancelled) return;
        if (snap.workflowId) submittedIds.push(snap.workflowId);
        // A host can return an instant terminal snapshot (cached / instant-fail).
        applySnapshotToRun(fmt.id, snap);
        if (!isTerminalStatus(snap.status) && snap.workflowId) {
          runPollLoop(fmt.id, snap.workflowId, tok);
        }
      }),
    );

    // ---- Write the history record ----
    // Only once something actually submitted: a record with no workflowIds is a
    // row nothing can ever join to, and `orphanedKeys` would delete it on the
    // next render anyway.
    if (submittedIds.length > 0) {
      const createdAt = Date.now();
      const record: GenerationRecord = {
        v: 1,
        batchId: `${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt,
        workflowIds: submittedIds,
        // THE SAME SNAPSHOT the bodies above were built from, under the pool
        // ACTUALLY submitted with (`acct`, not `account` — which may still hold
        // the picker's pre-default value). Only the formats that actually
        // submitted are recorded, so resuming a partially-failed batch reproduces
        // what ran, not what was attempted.
        form: formSnapshot(
          formats.filter((f) => viable.some((r) => r.formatId === f.id)),
          acct,
        ),
      };
      const key = historyKey(createdAt, record.batchId);
      if (!recordFits(record)) {
        // Refused BEFORE the round trip, so the message names the cause rather
        // than surfacing an opaque PAYLOAD_TOO_LARGE. The generation itself is
        // unaffected — only its resume record is lost.
        setHistoryNote('This run was too large to save to history; it still generated normally.');
      } else {
        try {
          await storageRef.current.set(key, record);
          setHistoryRecords((cur) => [{ key, record }, ...cur]);
          setHistoryState('ready');
        } catch (err) {
          // A storage failure must NEVER look like a generation failure — the
          // Buzz is already spent and the images are already on screen.
          const kind = classifyStorageError(err);
          setHistoryState(kind);
          setHistoryNote(
            kind === 'denied'
              ? "This app doesn't have storage access yet, so this run wasn't saved to history. Your images are above."
              : kind === 'anon'
                ? "Sign in to keep a history of your generations. This run's images are above."
                : "Couldn't save this run to history. Your images are above.",
          );
        }
      }
      // The live half needs re-reading before the new workflows can be joined.
      refetchWorkflows();
    }
  }, [
    mode,
    prompt,
    promptEdits,
    checkpoint,
    loras,
    account,
    balance,
    quantity,
    sourceImage,
    selectedFormatIds,
    availableFormats,
    estimate,
    submit,
    applySnapshotToRun,
    runPollLoop,
    handleAccountRejected,
    refetchWorkflows,
    classifyStorageError,
  ]);

  // The actual gate: sign-in -> consent -> generate. Wired straight to the
  // Generate button — the cost is already shown on the button, so there's no
  // separate confirm step (consent is the real, host-driven spend gate).
  const proceed = useCallback(() => {
    // Anon: convert the click into a host login prompt. Generate is server-gated
    // anyway (an anon token carries no budgeted scope).
    if (!viewer) {
      requestSignIn();
      return;
    }
    // LAZY CONSENT, and it is not merely a preference: `estimate()` itself 403s
    // with "block lacks ai:write:budgeted scope" on an unconsented token
    // (measured against the live backend 2026-09-28 — a scoped control token
    // returned 200 on the same request shape). So there is no way to price the
    // button before consent, and no reason to prompt on page load. Ask on the
    // first Generate; the grant arrives as a TOKEN_REFRESH (granted flips true)
    // and the effect below auto-resumes.
    if (!granted) {
      consentPendingRef.current = true;
      const formats = resolveFormats(selectedFormatIds, availableFormats);
      setRuns(initRuns(formats).map((r) => ({ ...r, phase: 'needs-consent' as GenPhase })));
      requestConsent({ scopes: ['ai:write:budgeted'] });
      return;
    }
    void runGeneration();
  }, [
    viewer,
    granted,
    requestSignIn,
    requestConsent,
    runGeneration,
    selectedFormatIds,
    availableFormats,
  ]);

  // Auto-resume after a consent grant.
  useEffect(() => {
    if (granted && consentPendingRef.current) {
      consentPendingRef.current = false;
      void runGeneration();
    }
  }, [granted, runGeneration]);

  // Switch the generation path. Cancels every in-flight poll and clears the
  // run table so a stale failure never shows under the new mode. The remix
  // source is intentionally kept: it is harmless in the other mode (generate
  // never threads it).
  const switchMode = useCallback((next: GenMode) => {
    if (pollCancelRef.current) pollCancelRef.current.cancelled = true;
    consentPendingRef.current = false;
    setMode(next);
    setRuns([]);
    setError(null);
  }, []);

  // --- Formats: the viewer's own, persisted per-viewer ---

  /**
   * Write the whole custom-format list, then reflect it.
   *
   * OPTIMISTIC WITH A REAL ROLLBACK. The list is shown immediately so editing
   * feels instant, but a rejected write REVERTS to the previous list rather than
   * leaving the screen showing formats the store does not have. The host rejects
   * a value over 64KB, a write that would cross the per-app quota, and EVERY
   * write from an anonymous viewer — none of which the mock host enforces, so
   * this path is tested at the hook boundary, not through the harness.
   */
  const persistFormats = useCallback(
    async (next: CustomFormat[], previous: CustomFormat[]) => {
      setCustomFormats(next);
      setStorageNote(null);
      try {
        await storageRef.current.set(CUSTOM_FORMATS_KEY, serializeCustomFormats(next));
        return true;
      } catch (err) {
        setCustomFormats(previous);
        setStorageNote(
          err instanceof Error && err.message
            ? `Couldn't save: ${err.message}`
            : "Couldn't save your formats. They're unchanged.",
        );
        return false;
      }
    },
    [],
  );

  const onToggleFormat = useCallback((id: string) => {
    setSelectedFormatIds((cur) => toggleFormat(cur, id));
  }, []);

  const onNewFormat = useCallback(() => {
    setFormatError(null);
    setFormatDraft({ id: null, label: '', suffix: '' });
  }, []);

  const onEditFormat = useCallback((fmt: Format) => {
    setFormatError(null);
    setFormatDraft({ id: fmt.id, label: fmt.label, suffix: fmt.suffix });
  }, []);

  const onSaveFormat = useCallback(async () => {
    if (!formatDraft) return;
    const why = validateCustomFormat(formatDraft);
    if (why) {
      setFormatError(why);
      return;
    }
    const id = formatDraft.id ?? customFormatId(Date.now());
    const previous = customFormats;
    const next = upsertCustomFormat(previous, {
      id,
      label: formatDraft.label.trim(),
      suffix: formatDraft.suffix.trim(),
    });
    // `upsertCustomFormat` silently refuses an append past the cap; say so
    // rather than closing the editor as if it had saved.
    if (next.length === previous.length && !previous.some((f) => f.id === id)) {
      setFormatError('You have reached the maximum number of saved formats.');
      return;
    }
    setFormatBusyId(id);
    const ok = await persistFormats(next, previous);
    setFormatBusyId(null);
    if (ok) {
      setFormatDraft(null);
      // A newly created format is selected straight away — the viewer made it
      // in order to use it.
      if (!formatDraft.id) setSelectedFormatIds((cur) => (cur.includes(id) ? cur : [...cur, id]));
    }
  }, [formatDraft, customFormats, persistFormats]);

  const onDeleteFormat = useCallback(
    async (id: string) => {
      const previous = customFormats;
      await persistFormats(deleteCustomFormat(previous, id), previous);
      // The selection reconciler drops the now-missing id and restores the
      // at-least-one invariant.
    },
    [customFormats, persistFormats],
  );

  /**
   * Publish one of the viewer's formats to the app-wide board.
   *
   * 🔴 The value comes from `sharedValueForFormat`, which is the ONE place that
   * decides the suffix travels in the MODERATED `body` field. Do not inline a
   * literal object here — that decision must stay in one tested function.
   */
  const onPublishFormat = useCallback(
    async (fmt: Format) => {
      setFormatBusyId(fmt.id);
      setStorageNote(null);
      try {
        await shared.append(sharedValueForFormat(fmt));
        setStorageNote(`Published “${fmt.label}”. It is reviewed before others see it.`);
      } catch (err) {
        setStorageNote(
          err instanceof Error && err.message
            ? `Couldn't publish: ${err.message}`
            : "Couldn't publish that format.",
        );
      } finally {
        setFormatBusyId(null);
      }
    },
    [shared],
  );

  // --- The published board ---

  const loadBoard = useCallback(async () => {
    setBoardLoading(true);
    setBoardError(null);
    try {
      const res = await shared.list({ limit: 25 });
      setBoardItems(formatsFromSharedItems(res.items));
    } catch (err) {
      setBoardError(
        err instanceof Error && err.message
          ? `Couldn't load published formats: ${err.message}`
          : "Couldn't load published formats.",
      );
    } finally {
      setBoardLoading(false);
    }
  }, [shared]);

  const onOpenBoard = useCallback(() => {
    setBoardOpen((open) => {
      if (!open) void loadBoard();
      return !open;
    });
  }, [loadBoard]);

  // Pull a published format into this session's picker and select it. It is NOT
  // copied into the viewer's own storage: it stays someone else's format, so it
  // keeps its votes, its report affordance, and its author.
  const onAddPublished = useCallback((fmt: PublishedFormat) => {
    setAddedPublished((cur) => (cur.some((f) => f.id === fmt.id) ? cur : [...cur, fmt]));
    setSelectedFormatIds((cur) => (cur.includes(fmt.id) ? cur : [...cur, fmt.id]));
  }, []);

  const onVotePublished = useCallback(
    async (fmt: PublishedFormat) => {
      setBoardBusyKey(fmt.sharedKey);
      try {
        // `viewerVoted` is HYDRATED from the host, never guessed, so this
        // toggles correctly on the first click after a reload.
        const count = fmt.viewerVoted
          ? await shared.unvote(fmt.sharedKey)
          : await shared.vote(fmt.sharedKey);
        setBoardItems((cur) =>
          cur.map((f) =>
            f.sharedKey === fmt.sharedKey ? { ...f, votes: count, viewerVoted: !f.viewerVoted } : f,
          ),
        );
      } catch {
        setBoardError("Couldn't record that vote.");
      } finally {
        setBoardBusyKey(null);
      }
    },
    [shared],
  );

  // The abuse seam. A published format's text is injected into OTHER viewers'
  // PAID generations, so reporting has to be one click from where it is seen.
  // Filing does not hide the row — a moderator decides.
  const onReportPublished = useCallback(
    async (fmt: PublishedFormat) => {
      setBoardBusyKey(fmt.sharedKey);
      try {
        await shared.report(fmt.sharedKey, 'Reported from the YT Thumbnail format board.');
        setBoardError(null);
        setStorageNote(`Reported “${fmt.label}” for review.`);
      } catch {
        setBoardError("Couldn't file that report.");
      } finally {
        setBoardBusyKey(null);
      }
    },
    [shared],
  );

  // --- Thumbnail history: the stored half, the join, and the prune ---

  /**
   * Load the stored half of history: one `list()` for the keys (cheap — keys and
   * `updatedAt` only), then a `get()` per key for the values.
   *
   * The listing is already newest-first because the key encodes an INVERTED
   * timestamp; there is no sort option on `list()` and there does not need to be.
   * Rows that don't parse are dropped rather than rendered half-formed.
   */
  const loadHistory = useCallback(async () => {
    if (viewerId == null) {
      setHistoryState('anon');
      setHistoryRecords([]);
      return;
    }
    setHistoryState('loading');
    try {
      const store = storageRef.current;
      const { keys } = await store.list({ prefix: HISTORY_PREFIX, limit: HISTORY_PAGE_SIZE });
      const loaded = await Promise.all(
        keys.map(async (k) => {
          try {
            return { key: k.key, record: parseRecord(await store.get(k.key)) };
          } catch {
            return { key: k.key, record: null };
          }
        }),
      );
      setHistoryRecords(
        loaded.filter((e): e is { key: string; record: GenerationRecord } => e.record !== null),
      );
      setHistoryState('ready');
    } catch (err) {
      setHistoryState(classifyStorageError(err));
    }
    // \U0001f534 KEYED ON THE VIEWER *ID*, A PRIMITIVE \u2014 NOT ON THE `viewer`
    // OBJECT. `useBlockContext()` hands back a fresh object on some renders, so
    // depending on it makes this callback change identity every render, which
    // makes the mount effect below re-run every render, which calls
    // `setHistoryState('loading')`, which renders again. That is not a slow
    // render, it is an unbounded loop: it took the e2e suite's worker to an
    // out-of-memory kill rather than to a failed assertion. `storage` is
    // documented stable across renders and `classifyStorageError` is a
    // dependency-free useCallback, so with a primitive here the whole chain is
    // stable and the effect runs on mount and on a real viewer change only.
  }, [viewerId, classifyStorageError]);

  useEffect(() => {
    if (!ready) return;
    void loadHistory();
  }, [ready, loadHistory]);

  /**
   * THE JOIN (history.ts `joinHistory`): stored records × the live workflow page.
   * Recomputed on render rather than stored, so the two halves can never be left
   * disagreeing by a missed update.
   */
  const historyEntries = joinHistory(historyRecords, workflows);

  /**
   * Prune storage rows no live workflow matches, so the halves cannot drift.
   *
   * 🔴 BOUNDED BY THE OLDEST WORKFLOW WE ACTUALLY FETCHED — see
   * `orphanedKeys`. Without that bound this deletes every record past the first
   * page on the first render. A failed delete is deliberately silent: it is
   * hygiene, not a user-facing operation, and a noisy toast about it would be
   * worse than the stale row.
   */
  useEffect(() => {
    if (historyState !== 'ready' || historyLoading || workflows.length === 0) return;
    const stale = orphanedKeys(historyRecords, workflows, oldestWorkflowTime(workflows));
    if (stale.length === 0) return;
    let alive = true;
    void Promise.all(
      stale.map((k) => storageRef.current.delete(k).catch(() => undefined)),
    ).then(() => {
      if (!alive) return;
      setHistoryRecords((cur) => cur.filter((e) => !stale.includes(e.key)));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyState, historyLoading, workflows, historyRecords]);

  /**
   * 🔴 SAVE A RAW CANDIDATE — the real download, and the ONLY one this block has.
   * The host fetches the blob in its unsandboxed top frame; the block never
   * handles the bytes. Rejects on a disallowed origin / withheld image / oversize
   * blob, and that rejection is SHOWN: a save that silently did nothing is the
   * exact failure #15 shipped an honest right-click note for.
   */
  const onSaveCandidate = useCallback(
    async (url: string, index: number, label?: string) => {
      setSaveNote(null);
      try {
        await saveImage({ url, filename: candidateFileName(index, label) });
        setSaveNote('Saved — check your downloads.');
      } catch (err) {
        setSaveNote(
          err instanceof Error && err.message
            ? `Couldn't save that image: ${err.message}`
            : "Couldn't save that image.",
        );
      }
    },
    [saveImage],
  );

  /**
   * RESUME: refill the form from a stored record and STOP.
   *
   * 🔴 IT DOES NOT SUBMIT, AND THAT IS A DELIBERATE PRODUCT DECISION, not an
   * omission. At 209 Buzz an image, a one-click re-run on a money control is
   * exactly how Buzz gets spent by accident. Resume leaves a filled form with the
   * cost preview showing and the viewer's finger on the same Generate button
   * every other generation goes through.
   *
   * It restores EVERYTHING the record carries — prompt, per-format edited
   * prompts, selected formats, checkpoint, LoRAs, quantity, spend-from, and the
   * remix source — and it works for an `unavailable` entry too, because the form
   * half is OURS and does not expire with the images.
   */
  const onResume = useCallback(
    (entry: HistoryEntry) => {
      const f = entry.record.form;
      if (pollCancelRef.current) pollCancelRef.current.cancelled = true;
      consentPendingRef.current = false;
      setRuns([]);
      setError(null);
      setEditing(null);
      setMode(f.mode);
      setPrompt(f.prompt);
      setPromptEdits({ ...f.promptEdits });
      setCheckpoint(f.checkpoint);
      setLoras([...f.loras]);
      setQuantity(clampQuantity(f.quantity));
      setSourceImage(f.sourceImage ?? null);
      // A restored pool is the viewer's own past choice, so it must not be
      // silently reassigned by the blue -> green -> yellow default on the next
      // estimate — the same rule as a manual pick.
      accountTouchedRef.current = true;
      setAccount(f.account);
      // Formats the viewer no longer has (a deleted custom one, a withdrawn
      // published one) are carried back in as session formats so the selection
      // resolves and the prompts recompose exactly as they did.
      setAddedPublished((cur) => {
        const have = new Set([
          ...cur.map((x) => x.id),
          ...customFormats.map((x) => x.id),
          ...allFormats([], []).map((x) => x.id),
        ]);
        const missing = f.formats
          .filter((x) => !have.has(x.id))
          .map((x) => ({
            id: x.id,
            label: x.label,
            suffix: x.suffix,
            sharedKey: `resumed:${x.id}`,
            votes: 0,
            viewerVoted: false,
          })) as PublishedFormat[];
        return missing.length === 0 ? cur : [...cur, ...missing];
      });
      setSelectedFormatIds(f.formats.map((x) => x.id));
      setHistoryOpen(false);
      setHistoryNote('Form restored. Nothing was submitted — press Generate when you are ready.');
    },
    [customFormats],
  );

  /** Cancel one still-running workflow. A real money control at this price. */
  const onCancelWorkflow = useCallback(
    async (entry: HistoryEntry) => {
      setHistoryBusyKey(entry.key);
      setHistoryNote(null);
      try {
        await Promise.all(entry.cancellableIds.map((id) => cancelWorkflow(id)));
        setHistoryNote('Cancel requested.');
      } catch (err) {
        setHistoryNote(
          err instanceof Error && err.message
            ? `Couldn't cancel: ${err.message}`
            : "Couldn't cancel that generation.",
        );
      } finally {
        setHistoryBusyKey(null);
      }
    },
    [cancelWorkflow],
  );

  // --- Host pickers (checkpoint + LoRA + source upload) ---
  //
  // All three open the HOST's native modal via the SDK hooks. The block never
  // sees a catalog or a filesystem, only the chosen resource. Every pick is
  // DISCOVERY ONLY — the server re-validates + re-prices the id at
  // estimate/submit, so threading a pick into the body is money-safe.

  // Open the host's Checkpoint picker UNCONSTRAINED. On a selection, map it into
  // the checkpoint state. A dismissal (`null`) leaves the pick as-is.
  //
  // 🔴 Deliberately NO `baseModelGroup`. `baseModelGroup` "NARROWS the browse,
  // never widens it" (blocks-react internal/catalog.d.ts), so deriving it from
  // the CURRENT checkpoint made this control unable to do its job: the default
  // pick is SDXL 1.0, so the picker only ever listed SDXL, and every other
  // ecosystem — Z Image, OpenAI, Flux — was unreachable. Not "hard to find":
  // unreachable, because the only way to widen the filter was to already hold a
  // checkpoint from the family you were trying to reach. Changing the checkpoint
  // IS choosing a family, so the pick must not be filtered by the family you are
  // leaving.
  //
  // This uses `useResourcePicker` rather than `useCheckpointPicker` because
  // there `baseModelGroup` is OPTIONAL and omitting it is documented as "an
  // unconstrained pick of the type" — `useCheckpointPicker` REQUIRES the field,
  // so the only way to disable its filter would be to pass a value ('') whose
  // meaning is defined in the dev shim and unverified against the prod host.
  // The LoRA picker below keeps its filter, and should: a LoRA really must match
  // the checkpoint's family.
  const onChangeModel = useCallback(async () => {
    setPickerBusy(true);
    try {
      const picked = await openResourcePicker({ resourceType: 'Checkpoint' });
      if (picked) setCheckpoint(checkpointFromPick(picked));
    } finally {
      setPickerBusy(false);
    }
  }, [openResourcePicker]);

  // Open the host's resource picker filtered to LoRAs, in the checkpoint's
  // base-model family. Append the pick (deduped + MAX_LORAS-capped via addLora).
  // A dismissal (`null`) is a no-op.
  //
  // 🔴 THE FAMILY FILTER STAYS — a LoRA really must match its checkpoint's base
  // model, and the server enforces that before any spend. The consequence of the
  // OpenAI default is therefore NOT "loosen the filter" but "there are no LoRAs
  // in that family", which `familyHasLoras` reports and the selector explains
  // rather than offering a control that can only produce a rejection. See
  // models.ts LORA_FREE_BASE_MODELS for the two measured controls behind it.
  const onAddLora = useCallback(async () => {
    setPickerBusy(true);
    try {
      const picked = await openResourcePicker({
        resourceType: 'LORA',
        baseModelGroup: checkpoint.baseModel,
      });
      if (picked) setLoras((cur) => addLora(cur, loraFromPick(picked)));
    } finally {
      setPickerBusy(false);
    }
  }, [openResourcePicker, checkpoint.baseModel]);

  // Open the host's upload modal for a generationSource image (img2img seed).
  // A dismissal (`null`) keeps the current source; Clear removes it.
  const onChooseSource = useCallback(async () => {
    setUploadBusy(true);
    try {
      const src = await openSourceUpload();
      if (src) setSourceImage(src);
    } finally {
      setUploadBusy(false);
    }
  }, [openSourceUpload]);

  const onRemoveLora = (versionId: number) => setLoras((cur) => removeLora(cur, versionId));
  const onLoraWeight = (versionId: number, weight: number) =>
    setLoras((cur) => setLoraWeight(cur, versionId, weight));
  // Whether the LoRA list can still take another. (The picker can return a dup;
  // addLora drops it, but we also disable Add at the cap.)
  const loraCapReached = loras.length >= MAX_LORAS;

  // Only an error when there is genuinely nothing to send. An empty box beside a
  // selected format is a valid request, so calling it an error would be the same
  // false claim the disabled button used to make.
  const promptError = touched && !submittable ? 'Enter a prompt to generate.' : undefined;
  const busy = isBusyPhase(phase);
  const isRemix = mode === 'remix';
  const remixIncomplete = isRemix && !sourceImage;

  // The Model row's CONTENT, hoisted so the two layouts below share one copy of
  // it. Only the container differs between the wide and narrow branches.
  const modelRow = (
    <>
      <span style={currentModelStyle(pal)} title={checkpoint.label} data-testid="pm-model-label">
        {checkpoint.label}
        {checkpoint.baseModel ? ` (${checkpoint.baseModel})` : ''}
      </span>
      <Button
        variant="light"
        size="sm"
        loading={pickerBusy}
        onClick={() => void onChangeModel()}
        data-testid="pm-change-model"
      >
        Change model
      </Button>
    </>
  );

  // ---- Render ----

  // The block root, shared by all three returns below. `data-theme` is what the
  // W6 pack's CSS reads; the `data-*` layout attributes carry the numbers
  // `layoutForTier` produced so a jsdom test can assert the whole chain — tier in,
  // literal layout out, layout on the DOM — rather than only the pure function.
  const rootProps = {
    ref: rootRef,
    'data-theme': theme,
    'data-block-tier': bp.tier,
    'data-ultrawide': layout.ultrawide ? 'true' : 'false',
    style: shellStyle(pal),
  } as const;

  if (!ready) {
    return (
      <div {...rootProps}>
        <Card padding="lg">
          <Group gap={10}>
            <Badge color="info" variant="light">
              loading
            </Badge>
            <span>Connecting to host…</span>
          </Group>
        </Card>
      </div>
    );
  }

  // Generate is one click: validate the prompt, then run the gate
  // (sign-in -> consent -> spend). The button already shows the live cost, so
  // there's no separate confirm step — consent is the real host-driven gate.
  const onGenerateClick = () => {
    setTouched(true);
    if (!submittable) return;
    proceed();
  };

  // The editor is a REPLACEMENT view: while it is open, the generation surface
  // stays mounted-below (state intact) but visually swapped out.
  if (editing) {
    return (
      <div {...rootProps}>
        <div style={contentStyle(layout)} {...contentProps(layout)}>
          <Card padding="lg" style={fillStyle} data-testid="pm-editor">
            <Stack gap={12}>
              <Group justify="space-between" align="center" wrap={false}>
                <strong style={titleStyle}>Edit thumbnail</strong>
                <Button
                  variant="light"
                  onClick={() => setEditing(null)}
                  data-testid="pm-editor-back"
                >
                  Back
                </Button>
              </Group>

              {editorStatus === 'loading' && (
                <span style={fieldDescStyle(pal)}>Loading image…</span>
              )}

              {editorStatus === 'error' && (
                <Alert
                  color="warning"
                  title="Couldn't open the image in the editor"
                  data-testid="pm-editor-error"
                >
                  The image host refused a cross-origin load, so the canvas editor can&apos;t run
                  on it.{' '}
                  <a href={editing ?? '#'} target="_blank" rel="noreferrer">
                    Open the image directly
                  </a>{' '}
                  to save it manually.
                </Alert>
              )}

              {editorStatus === 'ready' && (
                /* 🔴 THE CANVAS IS 1280×720 AND USED TO RENDER ABOVE ITS OWN
                   CONTROLS IN A 640px COLUMN — half resolution, with the
                   sliders pushed off screen, while ~900px of the block sat
                   empty. At `lg`+ the canvas takes the wide half and its text
                   controls sit beside it, so a title tweak and its result are
                   visible at the same time. */
                <div
                  style={editorSplitStyle(layout)}
                  data-testid="pm-editor-split"
                  data-layout={layout.editorSideBySide ? 'side-by-side' : 'stacked'}
                >
                  <canvas
                    ref={canvasRef}
                    width={YT_W}
                    height={YT_H}
                    style={canvasStyle(pal)}
                    data-testid="pm-editor-canvas"
                    aria-label="Thumbnail preview"
                  />

                  <div style={editorControlsStyle} data-testid="pm-editor-controls">
                    <TextInput
                      label="Title text"
                      value={overlay.text}
                      onChange={(e) => setOverlay((o) => ({ ...o, text: e.target.value }))}
                      data-testid="pm-editor-text"
                      aria-label="Title text"
                    />

                    <Slider
                      label="Text size"
                      min={4}
                      max={60}
                      step={1}
                      showValue
                      value={overlay.sizePct}
                      onChange={(v) => setOverlay((o) => ({ ...o, sizePct: v }))}
                      data-testid="pm-editor-size"
                      aria-label="Text size"
                    />
                    <Slider
                      label="Horizontal position"
                      min={0}
                      max={100}
                      step={1}
                      showValue
                      value={overlay.xPct}
                      onChange={(v) => setOverlay((o) => ({ ...o, xPct: v }))}
                      data-testid="pm-editor-x"
                      aria-label="Horizontal position"
                    />
                    <Slider
                      label="Vertical position"
                      min={0}
                      max={100}
                      step={1}
                      showValue
                      value={overlay.yPct}
                      onChange={(v) => setOverlay((o) => ({ ...o, yPct: v }))}
                      data-testid="pm-editor-y"
                      aria-label="Vertical position"
                    />
                    <Slider
                      label="Outline width"
                      min={0}
                      max={50}
                      step={1}
                      showValue
                      value={overlay.strokePct}
                      onChange={(v) => setOverlay((o) => ({ ...o, strokePct: v }))}
                      data-testid="pm-editor-stroke"
                      aria-label="Outline width"
                    />

                    <Group gap={16} align="center">
                      <label style={colorLabelStyle}>
                        <span style={fieldDescStyle(pal)}>Text</span>
                        <input
                          type="color"
                          value={overlay.color}
                          onChange={(e) => setOverlay((o) => ({ ...o, color: e.target.value }))}
                          data-testid="pm-editor-color"
                          aria-label="Text color"
                          style={colorInputStyle(pal)}
                        />
                      </label>
                      <label style={colorLabelStyle}>
                        <span style={fieldDescStyle(pal)}>Outline</span>
                        <input
                          type="color"
                          value={overlay.strokeColor}
                          onChange={(e) => setOverlay((o) => ({ ...o, strokeColor: e.target.value }))}
                          data-testid="pm-editor-strokecolor"
                          aria-label="Outline color"
                          style={colorInputStyle(pal)}
                        />
                      </label>
                    </Group>

                    {exportNote && (
                      <span style={fieldDescStyle(pal)} data-testid="pm-export-note">
                        {exportNote}
                      </span>
                    )}

                    <Group gap={8}>
                      <Button
                        fullWidth
                        onClick={() => {
                          const canvas = canvasRef.current;
                          if (!canvas || !editing) return;
                          setExportNote('Exporting…');
                          const toBlob = (quality: number) =>
                            new Promise<Blob | null>((resolve) =>
                              canvas.toBlob(resolve, 'image/jpeg', quality),
                            );
                          void exportLadder(toBlob)
                            .then((res) => {
                              downloadBlob(res.blob, thumbnailFileName(downloadCount + 1));
                              setDownloadCount((n) => n + 1);
                              // 🔴 THIS PATH CANNOT SEE WHETHER A FILE ARRIVED,
                              // and on civitai.com it almost certainly did not.
                              // `downloadBlob` fires an <a download> click and
                              // returns; a sandboxed iframe without
                              // `allow-downloads` drops it in silence, and this
                              // block cannot request that token (an unverified
                              // block is refused it at submit — see
                              // `manifest.test.ts`). So the note reports only
                              // what was MEASURED — the encode, its size, its
                              // quality — and names the fallback that does not
                              // depend on the sandbox at all: the browser's own
                              // context menu on the canvas, which is user-agent
                              // UI rather than a page-initiated download. It
                              // must not say "Saved".
                              setExportNote(
                                res.oversized
                                  ? `Exported · ${Math.round(res.bytes / 1024)} KB — over YouTube's 2 MB cap even at the lowest quality; trim the image. If no file appeared, right-click the preview above and choose "Save image as…".`
                                  : `Exported · ${Math.round(res.bytes / 1024)} KB · quality ${Math.round(res.quality * 100)}%. If no file appeared, right-click the preview above and choose "Save image as…".`,
                              );
                            })
                            .catch(() => setExportNote('Export failed — try again.'));
                        }}
                        data-testid="pm-editor-download"
                      >
                        Download 1280×720 JPG
                      </Button>
                    </Group>
                  </div>
                </div>
              )}
            </Stack>
          </Card>
        </div>
      </div>
    );
  }

  // ---- Render pieces ----
  //
  // Each constant below is ONE surface, hoisted out of the return so the two
  // layouts (rail at `lg`+, single column below it) share ONE copy of it. Same
  // idiom `modelRow` above already used: only the CONTAINER differs between the
  // branches, never the content — which is what stops the two layouts drifting
  // into two different apps.

  // The in-app hero: the app name over a banner image, with a palette scrim in
  // front of it and the original gradient wash behind it — see `heroStyle` for why
  // the ORDER of those three is the legibility guarantee. It is no longer pure CSS,
  // but it is still correct with zero bytes: layer 3 is the old gradient, so a 404
  // on the banner degrades to exactly what shipped before. Under
  // `brandDepth: "skin"` its colours come from the app's own palette rather than
  // pack tokens, which is why the scrim, both gradient stops AND both text colours
  // are asserted in both themes.
  // (The STORE cover art is a different asset and ships in assets/, never bundled.)
  const hero = (
    <div style={heroStyle(pal, layout)} data-testid="yt-hero">
      <strong style={heroTitleStyle(layout)}>YT Thumbnail</strong>
      <span style={heroSubStyle(pal)}>Exports at 1280×720, ready to upload.</span>
    </div>
  );

  // Mode toggle: Generate (txt2img) ⇄ Remix (img2img). Switching swaps the source
  // control + the body-builder while REUSING the one estimate -> consent ->
  // submit -> poll driver + the shared checkpoint/LoRA/account controls.
  const modeBlock = (
    <>
      <SegmentedControl
        fullWidth
        aria-label="Generation mode"
        value={mode}
        onChange={(v) => switchMode(v as GenMode)}
        disabled={busy}
        data={[
          { value: 'generate', label: 'Generate' },
          { value: 'remix', label: 'Remix an image' },
        ]}
      />

      {isRemix && (
        <div style={fieldStyle}>
          <span style={fieldLabelStyle}>Source image</span>
          {sourceImage ? (
            <Group gap={8} align="center" data-testid="pm-remix-preview">
              <img src={sourceImage.url} alt="Remix source" style={sourceThumbStyle(pal)} />
              <Button
                variant="light"
                size="sm"
                loading={uploadBusy}
                onClick={() => void onChooseSource()}
              >
                Replace
              </Button>
              <Button
                variant="subtle"
                size="sm"
                color="error"
                onClick={() => setSourceImage(null)}
                data-testid="pm-remix-clear"
              >
                Clear
              </Button>
            </Group>
          ) : (
            <span>
              <Button
                variant="light"
                loading={uploadBusy}
                onClick={() => void onChooseSource()}
                data-testid="pm-remix-upload"
              >
                Choose an image
              </Button>
            </span>
          )}
        </div>
      )}
    </>
  );

  // 🔴 The description deliberately does NOT claim a generation size, and the
  // reason has CHANGED SHAPE — read this before restoring one.
  //
  // Measured 2026-09-28: SD XL 1.0 and FLUX.1 [dev] IGNORE params.width/height —
  // 1280x720 and 1344x768 both came back 1216x832 (~3:2). The old string "It is
  // generated at 1280×720 (16:9)" was FALSE on those.
  //
  // Measured 2026-09-30 on the NEW default (ChatGPT Images / baseModel OpenAI),
  // through this block's own route: a 1280x720 request came back 1536x864 —
  // exactly 16:9. So on OpenAI the ASPECT is honoured and only the exact PIXELS
  // are not; the free estimate moves 209 -> 287 when the requested shape goes
  // 16:9 -> 1:1, which is the control proving the fields are read rather than
  // dropped (see models.ts DEFAULT_CHECKPOINT for both arms).
  //
  // Net: "1280×720" is STILL not a true claim about a generation on ANY of them,
  // because nothing delivers those literal pixels — so the copy stays out. What
  // IS true on every checkpoint is the EXPORT: the canvas editor cover-crops to
  // exactly 1280x720 on download, which the hero states and the download button
  // repeats. That crop wording is also still honest on the new default even
  // though a 1536x864 source is already 16:9 and therefore loses nothing to the
  // crop: "cover-crop to 1280x720" describes what the canvas does, and the user
  // can still pick a 3:2 SD-family checkpoint where it genuinely crops.
  const promptBlock = (
    <Textarea
      label="Prompt"
      description="Describe the thumbnail."
      placeholder="a serene mountain lake at golden hour, highly detailed"
      value={prompt}
      minRows={4}
      maxLength={PROMPT_MAX}
      // 🔴 NOT `required` ANY MORE, AND THAT IS THE POINT. A selected format's
      // suffix is a complete prompt on its own, so `aria-required="true"` here
      // would tell a screen-reader user the field must be filled when it need
      // not be. `promptError` still fires for the state that IS empty.
      error={promptError}
      onChange={(e) => setPrompt(e.target.value)}
      onBlur={() => setTouched(true)}
    />
  );

  // FORMATS. Multi-select, and the selection count IS the workflow count: each
  // format runs its own generation with its own prompt suffix, so picking a
  // second format is picking a second bill. That is stated once, here, and again
  // as the summed price on Generate.
  const formatsBlock = (
    <div style={fieldStyle}>
      <Group justify="space-between" align="center" gap={8}>
        <span style={fieldLabelStyle}>
          Formats{' '}
          <Badge color="info" variant="light">
            {selectedFormats.length}
          </Badge>
        </span>
        <Group gap={6}>
          <Button
            variant="subtle"
            size="sm"
            disabled={busy || storageState === 'anon' || customFormatsFull(customFormats)}
            onClick={onNewFormat}
            data-testid="yt-format-new"
          >
            + New
          </Button>
          <Button
            variant="subtle"
            size="sm"
            disabled={busy}
            onClick={onOpenBoard}
            data-testid="yt-board-toggle"
          >
            {boardOpen ? 'Hide published' : 'Browse published'}
          </Button>
        </Group>
      </Group>
      {/* 🔴 COST DISCLOSURE — kept deliberately while other copy was cut. */}
      <span style={fieldDescStyle(pal)} data-testid="yt-format-cost-note">
        {selectedFormats.length === 1
          ? 'One generation. Costs Buzz.'
          : `${selectedFormats.length} separate generations — each one costs Buzz.`}
      </span>

      <FormatPicker
        formats={availableFormats}
        selectedIds={selectedFormatIds}
        onToggle={onToggleFormat}
        onEdit={onEditFormat}
        onDelete={(id) => void onDeleteFormat(id)}
        onPublish={(fmt) => void onPublishFormat(fmt)}
        busyId={formatBusyId}
        disabled={busy}
        pal={pal}
        minCardPx={layout.formatMinCardPx}
      />

      {/* 🔴 WHAT WILL ACTUALLY BE SENT, AND NOW ALSO WHERE YOU CHANGE IT. A
          format is a prompt SUFFIX composed at body-build time, deliberately
          never typed into the prompt box — which is what lets N formats be N
          different prompts. These boxes hold the REAL strings: `effectivePrompt`
          is the same function `bodyFor` calls, so the field cannot drift from
          the money path, and an edit stays scoped to its own workflow. */}
      <ComposedPromptPreview
        prompt={prompt}
        formats={selectedFormats}
        edits={promptEdits}
        disabled={busy}
        onEdit={(id, text) => setPromptEdits((cur) => setPromptEdit(cur, id, text))}
        onReset={(id) => setPromptEdits((cur) => clearPromptEdit(cur, id))}
        pal={pal}
      />

      {/* 🔴 The anonymous path, said out loud. `useAppStorage` resolves null on
          read and REJECTS every write for an anonymous viewer, so a "New format"
          button that looked enabled would simply eat their work. */}
      {storageState === 'anon' && (
        <span style={fieldDescStyle(pal)} data-testid="yt-storage-anon">
          Sign in to make and save your own formats.
        </span>
      )}
      {storageState === 'error' && (
        <span style={fieldDescStyle(pal)} data-testid="yt-storage-error">
          Couldn&apos;t load your saved formats. The built-in ones still work.
        </span>
      )}
      {storageNote && (
        <span style={fieldDescStyle(pal)} data-testid="yt-storage-note">
          {storageNote}
        </span>
      )}

      {formatDraft && (
        <FormatEditor
          draft={formatDraft}
          error={formatError}
          busy={formatBusyId != null}
          onChange={setFormatDraft}
          onSave={() => void onSaveFormat()}
          onCancel={() => {
            setFormatDraft(null);
            setFormatError(null);
          }}
          pal={pal}
        />
      )}

      {boardOpen && (
        <PublishedBoard
          items={boardItems}
          loading={boardLoading}
          error={boardError}
          addedIds={new Set(addedPublished.map((f) => f.id))}
          busyKey={boardBusyKey}
          onAdd={onAddPublished}
          onVote={(f) => void onVotePublished(f)}
          onReport={(f) => void onReportPublished(f)}
          onRefresh={() => void loadBoard()}
          pal={pal}
        />
      )}
    </div>
  );

  // Model control. A page carries no host model context, so the app starts on
  // DEFAULT_CHECKPOINT and lets the user CHANGE it via the HOST's resource picker
  // (useResourcePicker, type=Checkpoint, UNFILTERED so every ecosystem is
  // reachable) — the block never browses a catalog. Every pick is DISCOVERY ONLY:
  // the server re-validates + re-prices it at estimate/submit.
  const modelBlock = (
    <div style={fieldStyle}>
      <span style={fieldLabelStyle}>Model</span>
      {/* Side by side when the block has room; stacked, with a full-width
          button, when it doesn't. A STRUCTURAL swap (a different element) —
          the kind of change CSS alone handles badly. The decision comes from
          `layoutForTier`, not from a breakpoint comparison inlined here. */}
      {layout.modelRow === 'stacked' ? (
        <Stack gap={8} align="stretch" data-testid="pm-model-row" data-layout="stacked">
          {modelRow}
        </Stack>
      ) : (
        <Group
          justify="space-between"
          align="center"
          gap={8}
          wrap={false}
          data-testid="pm-model-row"
          data-layout="row"
        >
          {modelRow}
        </Group>
      )}
    </div>
  );

  // Quantity — how many candidates per generation (server cap 4). Multiple
  // candidates cost proportionally; the estimate reflects it.
  const quantityBlock = (
    <div style={fieldStyle}>
      <span style={fieldLabelStyle}>Images per format</span>
      {/* 🔴 COST DISCLOSURE — kept deliberately while other copy was cut.
          Quantity and format count MULTIPLY: this is images per format, per
          run, and each one is charged. */}
      <span style={fieldDescStyle(pal)}>1–{QUANTITY_MAX} per format. Each image costs Buzz.</span>
      <div role="radiogroup" aria-label="Number of images" style={pickerRowStyle}>
        {[1, 2, 3, 4].slice(0, QUANTITY_MAX - QUANTITY_MIN + 1).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={clampQuantity(quantity) === n}
            disabled={busy}
            onClick={() => setQuantity(n)}
            data-testid={`pm-quantity-${n}`}
            style={pickerBtnStyle(clampQuantity(quantity) === n, busy, pal)}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );

  // Sign in / Generate, plus the three PRE-SPEND gates. These stay next to the
  // button that triggers them; post-spend reporting lives with the results.
  const submitBlock = (
    <>
      {anon ? (
        <Button fullWidth onClick={() => requestSignIn()} data-testid="pm-signin">
          Sign in to generate
        </Button>
      ) : (
        // 🔴 AN EMPTY PROMPT BOX IS NOT AN EMPTY PROMPT. A format IS prompt
        // text — "show me this look across three models" is a real request — so
        // the `disabled` gate asks `composePrompt` itself (via
        // `hasSubmittablePrompt`) whether ANY selected format composes to
        // something non-empty. It still refuses the one state where a click
        // would spend on nothing: no formats selected, and nothing typed.
        <Button
          fullWidth
          loading={busy}
          disabled={!submittable || remixIncomplete}
          onClick={onGenerateClick}
          data-testid="pm-generate"
        >
          {/* The price on the button is the SUM across every selected format.
              `estimatePartial` means some formats could not be priced, so the
              figure is a floor, not the bill — say "from" rather than quote a
              total we know is incomplete. Unpriced at all -> no figure:
              `estimate()` 403s until the viewer consents, so a fresh viewer
              legitimately sees none. */}
          {busy
            ? phaseLabel(phase)
            : estimatedCost != null
              ? `Generate · ${estimatePartial ? 'from ' : ''}${formatCost(estimatedCost)} Buzz`
              : 'Generate'}
        </Button>
      )}

      {remixIncomplete && (
        <span style={fieldDescStyle(pal)} data-testid="pm-remix-hint">
          Choose a source image above to remix it.
        </span>
      )}

      {phase === 'needs-consent' && (
        <Alert color="info" title="Grant access to generate">
          Confirm in the Civitai dialog. If you dismissed it, click Generate again.
        </Alert>
      )}

      {phase === 'insufficient' && (
        <Alert color="warning" title="Not enough Buzz" data-testid="pm-insufficient">
          Top up your Buzz balance and try again.
        </Alert>
      )}

      {phase === 'account-rejected' && error && (
        <Alert
          color="warning"
          title="Buzz account not available"
          withCloseButton
          onClose={() => setError(null)}
          data-testid="pm-account-rejected"
        >
          {error}
        </Alert>
      )}
    </>
  );

  // What the run produced — the app's PRIMARY OBJECT, so it is the first thing
  // under the hero once it exists (phase 2), and it owns the post-spend
  // reporting: the server's spend figure and any per-format failure.
  const resultsBlock = (
    <>
      {/* A WHOLE-BATCH failure: nothing succeeded. Named per format, because
          with N runs "Generation failed" alone does not say which. */}
      {phase === 'failed' && failed.length > 0 && (
        <Alert color="error" title="Generation failed" data-testid="pm-failed">
          <Stack gap={4}>
            {failed.map((r) => (
              <span key={r.formatId}>
                <strong>{r.label}</strong>: {r.error ?? 'failed'}
              </span>
            ))}
          </Stack>
        </Alert>
      )}

      {/* 🔴 PARTIAL FAILURE. Some formats came back, some did not. The
          successes are rendered below exactly as usual — the failures are
          reported ALONGSIDE them, never instead of them. */}
      {partialFailure && (
        <Alert
          color="warning"
          title={`${failed.length} of ${runs.length} formats didn't finish`}
          data-testid="pm-partial"
        >
          <Stack gap={4}>
            {failed.map((r) => (
              <span key={r.formatId}>
                <strong>{r.label}</strong>: {r.error ?? 'failed'}
              </span>
            ))}
            <span>You were only charged for the ones that ran.</span>
          </Stack>
        </Alert>
      )}

      {candidates.length > 0 && (
        <Stack gap={8}>
          {/* 🔴 SPEND IS THE SERVER'S NUMBER, SUMMED OVER THE RUNS THAT
              REPORTED ONE. It never falls back to the estimate, so a partial
              failure cannot inflate it into a bill for work that never ran —
              `formatCost(null)` renders '—'. */}
          <Alert color="success" title="Done" data-testid="pm-spent">
            Spent <strong>{formatCost(actualCost)}</strong> Buzz
            <SpentAccountNote runs={runs} />.
          </Alert>
          <span style={fieldLabelStyle}>
            {candidates.length} candidate{candidates.length === 1 ? '' : 's'}
          </span>
          {/* 🔴 THE GRID IS THE POINT OF GENERATING FOUR. It used to be
              `repeat(2, …)` at EVERY width — two 170px thumbnails on a phone,
              and two of them in a 640px column on a 1600px block. The column
              count now comes from `layoutForTier`: 1 on a phone, 2 mid, 3 at
              `lg`/`xl`, 4 ultrawide, so candidates are actually comparable
              side by side. */}
          {/* No `data-columns` here: `galleryStyle`'s `gridTemplateColumns` already
              carries the count, in the form a browser acts on. */}
          <div style={galleryStyle(layout)} data-testid="yt-results-grid">
            {candidates.map((c, i) => (
              <div key={c.url} style={galleryItemStyle}>
                <div style={{ position: 'relative' }}>
                  <img
                    src={c.url}
                    alt={`Generated result — ${c.formatLabel}`}
                    style={imageStyle}
                    data-testid="pm-result-img"
                  />
                  {/* Each candidate carries the format that made it — with N
                      formats in one grid, an untagged image is unusable for
                      deciding which format to keep paying for. */}
                  <span style={candidateTagStyle(pal)} data-testid="pm-result-format">
                    {c.formatLabel}
                  </span>
                </div>
                {/* 🔴 TWO BUTTONS THAT DO GENUINELY DIFFERENT THINGS, LABELLED
                    SO. "Save image" is the RAW candidate going through the
                    host's SAVE_IMAGE bridge — a real file, every time. "Add
                    text" opens the canvas editor, whose export is a local
                    `blob:` the same bridge refuses (https-only allowlist), so
                    that path still ends in the honest right-click note. Two
                    buttons that looked alike and behaved differently is exactly
                    what #15 was cleaning up; this keeps them distinguishable. */}
                <Group gap={6} wrap={false}>
                  <Button
                    size="sm"
                    onClick={() => void onSaveCandidate(c.url, i + 1, c.formatLabel)}
                    data-testid={`pm-save-${i}`}
                  >
                    Save image
                  </Button>
                  <Button
                    size="sm"
                    variant="light"
                    onClick={() => setEditing(c.url)}
                    data-testid={`pm-edit-${i}`}
                  >
                    Add text
                  </Button>
                </Group>
              </div>
            ))}
          </div>
          {saveNote && (
            <span style={fieldDescStyle(pal)} data-testid="pm-save-note">
              {saveNote}
            </span>
          )}
        </Stack>
      )}
    </>
  );

  // THUMBNAIL HISTORY — past generations, their realized cost, a real save, and
  // Resume. Collapsed by default: it is a returning-visit surface, and expanding
  // it by default would push the generate form down for the common first run.
  const historyBlock = (
    <div style={fieldStyle} data-testid="yt-history">
      <Group justify="space-between" align="center" gap={8}>
        <span style={fieldLabelStyle}>
          History{' '}
          <Badge color="info" variant="light">
            {historyEntries.length}
          </Badge>
        </span>
        <Group gap={6}>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => {
              setHistoryOpen((open) => {
                if (!open) {
                  void loadHistory();
                  refetchWorkflows();
                }
                return !open;
              });
            }}
            data-testid="yt-history-toggle"
          >
            {historyOpen ? 'Hide' : 'Show'}
          </Button>
        </Group>
      </Group>

      {historyNote && (
        <span style={fieldDescStyle(pal)} data-testid="yt-history-note">
          {historyNote}
        </span>
      )}

      {historyOpen && (
        <HistoryPanel
          entries={historyEntries}
          state={historyState}
          loading={historyLoading}
          liveError={historyError}
          busyKey={historyBusyKey}
          onResume={onResume}
          onCancel={(e) => void onCancelWorkflow(e)}
          onSave={(url, i, label) => void onSaveCandidate(url, i, label)}
          onSignIn={() => requestSignIn()}
          onRefresh={() => {
            void loadHistory();
            refetchWorkflows();
          }}
          pal={pal}
          layout={layout}
        />
      )}
    </div>
  );

  // The inputs, in two halves. 🔴 SPLIT RATHER THAN ONE `controls` CONSTANT
  // BECAUSE THE FORMAT PICKER SITS BETWEEN THEM below `lg` — it is an input that
  // decides the bill, so it belongs next to the prompt, not after the Generate
  // button. At `lg`+ it moves to the main column instead, which is why the two
  // halves are joined there. Both layouts render the SAME block constants; only
  // the order and the containers differ.
  const inputsBeforeFormats = (
    <>
      {modeBlock}
      {promptBlock}
    </>
  );
  const inputsAfterFormats = (
    <>
      {modelBlock}
      <LoraSelector
        selected={loras}
        capReached={loraCapReached}
        familyHasLoras={familyHasLoras(checkpoint.baseModel)}
        baseModel={checkpoint.baseModel}
        pickerBusy={pickerBusy}
        onAdd={() => void onAddLora()}
        onRemove={onRemoveLora}
        onWeight={onLoraWeight}
        pal={pal}
      />
      {quantityBlock}
      {!anon && (
        <AccountPicker
          value={account}
          onChange={(v) => {
            // A manual pick freezes the blue -> green -> yellow default: from
            // here on the app never silently reassigns their pool.
            accountTouchedRef.current = true;
            setAccount(v);
          }}
          balance={balance}
          disabled={busy}
          cost={estimatedCost}
          costPartial={estimatePartial}
          portalTo={rootRef}
          pal={pal}
        />
      )}
      {submitBlock}
    </>
  );

  // ---- The two layouts ----

  // 🔴 AT `lg`+ THE CONTROLS BECOME A PERSISTENT RAIL. The whole point of a
  // 1600px block is that the inputs and the output can be on screen together: a
  // stacked layout pushes the candidate grid below the fold, so tweaking a prompt
  // and judging the result are two separate scroll positions. The persistence here
  // is the SIDE-BY-SIDE arrangement, not `position: sticky` — see `railStyle` for
  // why sticky is inert in a host-auto-sized iframe.
  if (layout.rail) {
    return (
      <div {...rootProps}>
        <div style={contentStyle(layout)} {...contentProps(layout)}>
          <Stack gap={16}>
            {hero}
            <div style={railGridStyle(layout)} data-testid="yt-rail-grid">
              <aside
                style={railStyle(pal)}
                data-testid="yt-rail"
                aria-label="Generation controls"
              >
                <Stack gap={16}>
                  {inputsBeforeFormats}
                  {inputsAfterFormats}
                </Stack>
              </aside>
              <main style={mainColumnStyle} data-testid="yt-main">
                <Stack gap={16}>
                  {resultsBlock}
                  {formatsBlock}
                  {historyBlock}
                </Stack>
              </main>
            </div>
          </Stack>
        </div>
      </div>
    );
  }

  // Below `lg` everything is one column, in the order it is used — except the
  // results, which jump to the top once they exist (phase 2: the app's primary
  // object is the first thing on screen).
  return (
    <div {...rootProps}>
      <div style={contentStyle(layout)} {...contentProps(layout)}>
        <Card padding="lg" style={fillStyle}>
          <Stack gap={16}>
            {hero}
            {resultsBlock}
            {inputsBeforeFormats}
            {formatsBlock}
            {inputsAfterFormats}
            {historyBlock}
          </Stack>
        </Card>
      </div>
    </div>
  );
}

/**
 * THUMBNAIL HISTORY — the rendered join.
 *
 * 🔴 EVERY NON-READY STATE IS EXPLICIT, because each has a DIFFERENT fix and
 * three of them would otherwise render as the same empty grid:
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
 * An `unavailable` ROW is none of those: it is a real past generation whose
 * images have aged out of the orchestrator. It STAYS VISIBLE, says so plainly,
 * and Resume still works — the form half is ours and does not expire.
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

  if (state === 'denied') {
    return (
      <Alert color="warning" title="History needs storage access" data-testid="yt-history-denied">
        This app hasn&apos;t been granted storage access, so it can&apos;t keep a record of your
        generations. Grant it from the Civitai permissions dialog and reopen this panel.
      </Alert>
    );
  }

  if (state === 'error') {
    return (
      <Stack gap={8}>
        <Alert color="warning" title="Couldn't load your history" data-testid="yt-history-error">
          Your generations still ran and were still charged — this is only the record of them.
        </Alert>
        <Button variant="light" size="sm" onClick={onRefresh}>
          Try again
        </Button>
      </Stack>
    );
  }

  if (state === 'loading' || loading) {
    return (
      <span style={fieldDescStyle(pal)} data-testid="yt-history-loading">
        Loading your generations…
      </span>
    );
  }

  return (
    <Stack gap={12}>
      {/* The LIVE half failing is reported SEPARATELY from the stored half. The
          rows below are still rendered from storage, and Resume still works on
          every one of them — saying "history is broken" would be false. */}
      {liveError && (
        <Alert color="warning" title="Couldn't reach the generation queue" data-testid="yt-history-live-error">
          Statuses, images and costs below may be missing or out of date. Resume still works.
        </Alert>
      )}

      {entries.length === 0 ? (
        <span style={fieldDescStyle(pal)} data-testid="yt-history-empty">
          Nothing here yet. Your generations will be listed here once you run one.
        </span>
      ) : (
        entries.map((entry) => (
          <div key={entry.key} style={loraRowStyle(pal)} data-testid="yt-history-row">
            <Group justify="space-between" align="center" gap={8}>
              <Group gap={6} align="center">
                <Badge color={batchStatusColor(entry.status)} variant="light">
                  {batchStatusLabel(entry.status)}
                </Badge>
                <span style={fieldDescStyle(pal)} data-testid="yt-history-when">
                  {new Date(entry.record.createdAt).toLocaleString()}
                </span>
              </Group>
              {/* 🔴 REALIZED COST, the server's number for the workflows that
                  reported one — never the estimate. At 209 Buzz an image this
                  is the figure people actually want from a history list. */}
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
                These images are no longer available, but the settings are — Resume refills the
                form.
              </span>
            )}

            {entry.imageUrls.length > 0 && (
              <div style={galleryStyle(layout)} data-testid="yt-history-images">
                {entry.imageUrls.map((url, i) => (
                  <div key={url} style={galleryItemStyle}>
                    <img
                      src={url}
                      alt={`Past generation ${i + 1}`}
                      style={imageStyle}
                      data-testid="yt-history-img"
                    />
                    <Button
                      size="sm"
                      variant="light"
                      onClick={() => onSave(url, i + 1, entry.record.form.formats[0]?.label)}
                      data-testid="yt-history-save"
                    >
                      Save image
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Group gap={6}>
              {/* 🔴 RESUME DOES NOT SUBMIT. It refills the form and stops, with
                  the cost preview showing — see the App's `onResume`. The label
                  says "Reuse settings" rather than "Run again" for exactly that
                  reason: a money control must not read like a re-run button. */}
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
                  loading={busyKey === entry.key}
                  onClick={() => onCancel(entry)}
                  data-testid="yt-history-cancel"
                >
                  Cancel
                </Button>
              )}
            </Group>
          </div>
        ))
      )}
    </Stack>
  );
}

/**
 * The LoRA selector: an "Add LoRA" button (opens the HOST resource picker) + the
 * selected rows, each with a weight control + Remove. Built from the W6 pack
 * (Group/Stack/Badge/Button) plus a Slider. Every pick + weight is DISCOVERY
 * ONLY — server-revalidated + re-priced.
 */
function LoraSelector({
  selected,
  capReached,
  familyHasLoras: familySupported,
  baseModel,
  pickerBusy,
  onAdd,
  onRemove,
  onWeight,
  pal,
}: {
  selected: readonly LoraOption[];
  capReached: boolean;
  /** Does the current checkpoint's base-model family have ANY LoRAs? */
  familyHasLoras: boolean;
  /** The current checkpoint's base-model family, named in the explanation. */
  baseModel: string;
  pickerBusy: boolean;
  onAdd: () => void;
  onRemove: (versionId: number) => void;
  onWeight: (versionId: number, weight: number) => void;
  pal: Palette;
}) {
  return (
    <div style={fieldStyle}>
      <span style={fieldLabelStyle}>
        LoRAs{' '}
        <Badge color="info" variant="light">
          {selected.length}/{MAX_LORAS}
        </Badge>
      </span>
      {/* Selected LoRAs, each with a weight control + remove. */}
      {selected.length > 0 && (
        <Stack gap={8} style={loraListStyle}>
          {selected.map((l) => (
            <div key={l.versionId} style={loraRowStyle(pal)} data-testid="pm-lora-row">
              <div style={loraRowHeadStyle}>
                <span style={loraNameStyle} title={l.label}>
                  {l.label}
                  {l.baseModel ? ` (${l.baseModel})` : ''}
                </span>
                <Button
                  variant="subtle"
                  size="sm"
                  color="error"
                  onClick={() => onRemove(l.versionId)}
                  aria-label={`Remove ${l.label}`}
                >
                  Remove
                </Button>
              </div>
              <Slider
                label="weight"
                min={LORA_STRENGTH_MIN}
                max={LORA_STRENGTH_MAX}
                step={0.05}
                showValue
                value={l.weight}
                onChange={(v) => onWeight(l.versionId, v)}
                aria-label={`${l.label} weight`}
                data-testid="pm-lora-weight"
              />
            </div>
          ))}
        </Stack>
      )}

      {/* Add a LoRA — opens the host's resource picker filtered to LoRAs.
          🔴 DISABLED, WITH A REASON, ON A FAMILY THAT HAS NONE. The alternative
          is a button that opens a grid of LoRAs from OTHER families (the catalog
          widens the browse rather than showing an empty result), every one of
          which the server rejects as incompatible after the viewer has picked
          it. An explained dead control beats a live one that can only fail. */}
      <span style={loraAddWrapStyle}>
        <Button
          variant="light"
          size="sm"
          disabled={capReached || !familySupported}
          loading={pickerBusy}
          onClick={onAdd}
          data-testid="pm-lora-add"
        >
          + Add LoRA
        </Button>
        {!familySupported && (
          <span style={fieldDescStyle(pal)} data-testid="pm-lora-unsupported">
            {baseModel} models don&apos;t take LoRAs. Switch to another model above to add them.
          </span>
        )}
        {familySupported && capReached && (
          <span style={fieldDescStyle(pal)}>Max {MAX_LORAS} LoRAs selected.</span>
        )}
      </span>
    </div>
  );
}

/**
 * The prompt each selected format will actually submit — EDITABLE.
 *
 * 🔴 IT CALLS `promptFieldValue` / `effectivePrompt`, IT DOES NOT RE-IMPLEMENT
 * THEM. A view that pasted `prompt + ', ' + suffix` together would be a second
 * copy of the composition rule, and the two would disagree at exactly the moment
 * it matters — the PROMPT_MAX boundary, where the suffix is reserved and the
 * USER's text is what gets clamped. Driving the same functions the submit body
 * drives means the string in the box is the string that gets priced and
 * generated, truncation included.
 *
 * 🔴 ONE ROW PER SELECTED FORMAT, BECAUSE THAT IS WHAT MULTI-SELECT MEANS. N
 * formats are N workflows with N different prompts; a single merged editor would
 * suggest one request carrying all of them — and would collapse the batch, which
 * is the one thing an edit must never do. Editing row A cannot touch row B.
 *
 * 🔴 EDITING DETACHES THE ROW FROM THE PROMPT BOX, PERMANENTLY AND VISIBLY.
 * Once a row carries an edit it stops recomposing: typing more into the prompt
 * box above leaves it alone. The alternative — rebasing the edit onto the new
 * base prompt — has no non-arbitrary definition and would silently overwrite
 * words the viewer is about to pay for. So the row wears an "Edited" badge and a
 * Reset control, and Reset is the only way back to following the box.
 *
 * The cap is enforced on the way in (`setPromptEdit` clamps, the field carries
 * `maxLength`, the count is live), so an over-long edit is never silently
 * truncated somewhere between here and the wire.
 */
function ComposedPromptPreview({
  prompt,
  formats,
  edits,
  disabled,
  onEdit,
  onReset,
  pal,
}: {
  prompt: string;
  formats: readonly Format[];
  edits: PromptEdits;
  disabled: boolean;
  onEdit: (formatId: string, text: string) => void;
  onReset: (formatId: string) => void;
  pal: Palette;
}) {
  if (formats.length === 0) return null;
  return (
    <div style={fieldStyle} data-testid="yt-prompt-preview">
      <span style={fieldLabelStyle}>What gets sent</span>
      <span style={fieldDescStyle(pal)} data-testid="yt-prompt-preview-note">
        {formats.length === 1
          ? 'The exact prompt this generation will carry — edit it here before you generate.'
          : `The exact prompt each of these ${formats.length} generations will carry — edit any of them before you generate.`}
      </span>
      <div style={previewListStyle}>
        {formats.map((fmt) => {
          const edited = isPromptEdited(edits, fmt.id);
          const value = promptFieldValue(prompt, fmt, edits);
          // The TRIM note belongs to composition only: an edited row has no
          // reserved suffix left to protect, it is simply the viewer's string.
          const trimmed = !edited && promptWasTruncated(prompt, fmt.suffix);
          const blank = edited && effectivePrompt(prompt, fmt, edits) === '';
          return (
            <div
              key={fmt.id}
              style={previewRowStyle(pal)}
              data-testid="yt-prompt-preview-row"
              data-format-id={fmt.id}
              data-edited={edited ? 'true' : 'false'}
            >
              <Group justify="space-between" align="center" gap={8} wrap={false}>
                <span style={previewRowLabelStyle(pal)}>{fmt.label}</span>
                {edited && (
                  <Group gap={6} align="center" wrap={false}>
                    <span
                      style={previewEditedStyle(pal)}
                      data-testid={`yt-prompt-edited-${fmt.id}`}
                    >
                      Edited — no longer following the prompt box
                    </span>
                    <Button
                      variant="subtle"
                      size="sm"
                      disabled={disabled}
                      onClick={() => onReset(fmt.id)}
                      data-testid={`yt-prompt-reset-${fmt.id}`}
                    >
                      Reset
                    </Button>
                  </Group>
                )}
              </Group>
              <textarea
                style={previewTextStyle(pal)}
                data-testid={`yt-prompt-preview-${fmt.id}`}
                // Deliberately does NOT contain the word "prompt": the page's
                // own Prompt field is queried by accessible name across the
                // suite, and N more fields answering to /prompt/i would make
                // that query ambiguous everywhere. The section heading above
                // ("What gets sent") supplies the context this name continues.
                aria-label={`Text sent for ${fmt.label}`}
                value={value}
                disabled={disabled}
                maxLength={PROMPT_MAX}
                rows={3}
                onChange={(e) => onEdit(fmt.id, e.target.value)}
              />
              <span style={previewCountStyle(pal)} data-testid={`yt-prompt-count-${fmt.id}`}>
                {value.length} / {PROMPT_MAX}
              </span>
              {/* The suffix is RESERVED by `composePrompt`, so an overflow always
                  costs the VIEWER's words. Saying so is the difference between a
                  trim they chose and one they only discover in the result. */}
              {trimmed && (
                <span
                  style={previewTrimStyle(pal)}
                  data-testid={`yt-prompt-trimmed-${fmt.id}`}
                >
                  Your prompt was trimmed to fit. The format text is kept in full.
                </span>
              )}
              {/* An emptied row would submit `params.prompt: ""` and be charged
                  for it, so `promptsReadyToSubmit` blocks the whole click. Name
                  the row that is blocking it. */}
              {blank && (
                <span style={previewTrimStyle(pal)} data-testid={`yt-prompt-empty-${fmt.id}`}>
                  This prompt is empty. Write something, or Reset it.
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The Buzz bolt.
 *
 * 🔴 ONE GLYPH FOR ALL THREE POOLS, COLOURED PER POOL — which is exactly what the
 * native generator does. `FormFooter.tsx`'s `BuzzTypeSelector` renders tabler's
 * generic `IconBolt` for every type and varies only the colour; there is no
 * per-type Buzz icon to import, `@tabler/icons-react` is not a dependency here,
 * and `@civitai/buzz` is `private: true`. So the path below is inline and the
 * colour comes from `BUZZ_TYPE_COLOR` (see `palette.ts` for its provenance).
 *
 * `auto` is not a Buzz type at all — it is the absence of a preference — so it
 * gets the palette's own `textDim` rather than borrowing a pool's colour.
 *
 * DECORATIVE: `aria-hidden`, and every place it renders it sits beside a text
 * label naming the same pool, so nothing here is carried by colour alone.
 */
function BuzzBolt({
  choice,
  pal,
  testId,
  size = 14,
}: {
  choice: AccountChoice;
  pal: Palette;
  testId: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={choice === 'auto' ? pal.textDim : BUZZ_TYPE_COLOR[choice]}
      aria-hidden="true"
      focusable="false"
      data-testid={testId}
      data-buzz-type={choice}
      style={previewIconStyle}
    >
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  );
}

/** The trigger's open/closed affordance. Decorative — `aria-expanded` is the claim. */
function Chevron({ pal }: { pal: Palette }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke={pal.textDim}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={previewIconStyle}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** The menu's element id, shared by `aria-controls` and the popup itself. */
const ACCOUNT_MENU_ID = 'yt-account-menu';
/** The description the trigger points `aria-describedby` at. */
const ACCOUNT_DESC_ID = 'yt-account-desc';

/**
 * Choose which Buzz pool funds the generation — a trigger showing the current
 * pool + this click's price, and a popup listing every pool with its balance.
 *
 * 🔴 WHY A HAND-BUILT MENU AND NOT THE PACK'S `Select`. `@civitai/blocks-react`'s
 * `Select` wraps a NATIVE `<select>`: its `SelectOption.label` is typed
 * `React.ReactNode`, but it renders into an `<option>`, and no browser renders an
 * SVG or an `<img>` inside one. A per-type Buzz bolt is the whole point of this
 * control, so the pack's Select structurally cannot deliver it. Buttons can.
 *
 * 🔴 THE SEMANTICS ARE UNCHANGED FROM THE RADIO ROW THIS REPLACES. `'auto'` still
 * omits `accountType` from the submit body ENTIRELY (see `buildWorkflowBody`); a
 * pick is still only a PREFERENCE that the server clamps, may fall back from, and
 * can reject outright; zero-balance pools are still SELECTABLE and merely
 * annotated. Only the presentation moved.
 *
 * A11Y MODEL: `aria-haspopup="menu"` + `aria-expanded` + `aria-controls` on the
 * trigger; `role="menu"` labelled "Pay with" on the popup; `role="menuitemradio"`
 * + `aria-checked` on each pool — deliberately the menu-radio role rather than
 * listbox/`aria-selected`, because "exactly one of these is chosen" is what
 * `aria-checked` says and it is the same state the radio row published. Keyboard:
 * ArrowDown/ArrowUp open the closed trigger onto the first/last pool; inside the
 * menu Arrow keys move (wrapping), Home/End jump, Enter/Space choose, Escape
 * closes and returns focus to the trigger, Tab closes. A pointer press outside the
 * control dismisses it.
 *
 * 🔴 THE POPUP IS PORTALLED OUT OF THE RAIL, AND THAT IS A BUG FIX, NOT A STYLE
 * CHOICE. It used to be `position: absolute` inside the field, i.e. a DESCENDANT
 * of `yt-rail`, which carries `overflowY: 'auto'` because it is a `position:
 * sticky` column capped at `calc(100dvh - 48px)` — a tall control list has to
 * scroll inside it. MEASURED in headless chromium at 1400x1000: the rail's box
 * bottom was 780 and the open menu ran to 863, so the last 83px was CLIPPED and
 * `document.elementFromPoint` at the centre of `pm-account-green` and
 * `pm-account-yellow` returned the rail, not the option. Two of the four Buzz
 * pools could not be clicked. `z-index` cannot fix it: the clip comes from an
 * ancestor's overflow, not from stacking.
 *
 * 🔴 WHY A PORTAL RATHER THAN A FLIP-UP. Flipping the menu above the trigger
 * keeps it inside the same scroll container, so it trades a clip at the bottom
 * for a clip at the top the moment the trigger sits near the rail's top edge —
 * and since the rail SCROLLS, the trigger's distance from either edge is not
 * constant, so no static direction is correct. Rendering into the block root
 * instead makes the menu a NON-DESCENDANT of every inner scroll container, which
 * is a structural property rather than an arithmetic one: there is no geometry
 * for a flip calculation to get wrong.
 *
 * Positioned `fixed` off `getBoundingClientRect()` of the trigger, recomputed on
 * scroll (CAPTURE phase, so the rail's own scroll is seen — scroll does not
 * bubble) and on resize. It flips ABOVE the trigger only when the viewport has no
 * room below, which is a viewport question with no clipping ancestor involved.
 *
 * It portals into the BLOCK ROOT, not `document.body`: the root carries
 * `data-theme` and `--yt-focus-ring`, and `theme-guard.test.tsx`'s Guard B walks
 * downward from it, so staying inside keeps both the pack's theming and that
 * contrast walk applicable. `rootRef` is `null` only before the first commit, and
 * the menu cannot be open then; it falls back to in-place rendering rather than
 * dropping the popup.
 */
function AccountPicker({
  value,
  onChange,
  balance,
  disabled,
  cost,
  costPartial,
  portalTo,
  pal,
}: {
  value: AccountChoice;
  onChange: (v: AccountChoice) => void;
  balance: { blue: number; green: number; yellow: number } | null;
  disabled: boolean;
  /** This click's summed estimate, or `null` while nothing has been priced. */
  cost: number | null;
  /** True when only SOME formats priced — the figure is a floor, not the bill. */
  costPartial: boolean;
  /** The block root the popup renders into — see the docblock's portal note. */
  portalTo: React.RefObject<HTMLDivElement | null>;
  pal: Palette;
}) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, ACCOUNT_CHOICES.indexOf(value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [menuBox, setMenuBox] = useState<MenuBox | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Dismiss on a pointer press anywhere outside the control.
  //
  // 🔴 BOTH HALVES, BECAUSE THE PORTAL SPLIT THEM. The popup is no longer a DOM
  // descendant of `wrapRef`, so a `wrapRef.contains(target)` test alone would
  // read a press ON AN OPTION as "outside" and close the menu before the click
  // landed — the option would be unclickable for a second, subtler reason than
  // the clipping this portal fixes. `mousedown` rather than `click` so a genuine
  // outside press is not swallowed by the dismissal.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the fixed popup pinned to the trigger. The CAPTURE phase is load-bearing:
  // a `scroll` event does not bubble, so a listener on `document` in the bubble
  // phase never hears the RAIL scrolling — only the window.
  useEffect(() => {
    if (!open) return;
    const place = () => setMenuBox(measureMenuBox(triggerRef.current, menuRef.current));
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  // Focus follows the active item while the menu is open, so the roving focus IS
  // the keyboard position rather than a second piece of state that can disagree.
  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  // A picker that goes disabled mid-generation must not leave a popup behind.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const openAt = (index: number) => {
    setActiveIndex(index);
    // Seed the position from the trigger BEFORE the popup paints, so its first
    // frame is already against the control. The effect above then re-places it
    // with the menu's measured height, which is what the flip decision needs.
    setMenuBox(measureMenuBox(triggerRef.current, null));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const choose = (choice: AccountChoice) => {
    onChange(choice);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const last = ACCOUNT_CHOICES.length - 1;
  const costText =
    cost != null ? `${costPartial ? 'from ' : ''}${formatCost(cost)} Buzz` : 'Not priced yet';

  const menu = (
    <div
      ref={menuRef}
      id={ACCOUNT_MENU_ID}
      role="menu"
      aria-label="Pay with"
      data-testid="pm-account-menu"
      style={accountMenuStyle(menuBox, pal)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        } else if (e.key === 'Tab') {
          setOpen(false);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % ACCOUNT_CHOICES.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveIndex((i) => (i + last) % ACCOUNT_CHOICES.length);
        } else if (e.key === 'Home') {
          e.preventDefault();
          setActiveIndex(0);
        } else if (e.key === 'End') {
          e.preventDefault();
          setActiveIndex(last);
        }
      }}
    >
      {ACCOUNT_CHOICES.map((choice, i) => {
        const selected = value === choice;
        const have = choice === 'auto' || balance == null ? null : balance[choice];
        const zero = have === 0;
        return (
          <button
            key={choice}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            tabIndex={i === activeIndex ? 0 : -1}
            onClick={() => choose(choice)}
            data-testid={`pm-account-${choice}`}
            style={accountItemStyle(selected, pal)}
            title={zero ? 'You have 0 Buzz in this account' : undefined}
          >
            <BuzzBolt choice={choice} pal={pal} testId={`pm-account-icon-${choice}`} />
            <span>{accountLabel(choice)}</span>
            {/* Each pool WITH ITS BALANCE, as the native "Pay with" menu lists
                them. `auto` has no pool of its own, so it says what it does
                instead. */}
            <span style={accountBalanceStyle(pal)}>
              {choice === 'auto' ? 'Host decides' : have == null ? '' : `· ${formatCost(have)}`}
            </span>
            {selected && <span aria-hidden="true">✓</span>}
          </button>
        );
      })}
    </div>
  );

  return (
    <div style={fieldStyle}>
      <span style={fieldLabelStyle}>Spend from</span>
      {/* Kept short, but the "preference, not a guarantee" half stays: this is
          the control that decides whose Buzz is debited. */}
      <span style={fieldDescStyle(pal)} id={ACCOUNT_DESC_ID}>
        A preference — the server picks the final pool.
      </span>
      <div ref={wrapRef} style={accountWrapStyle}>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? ACCOUNT_MENU_ID : undefined}
          aria-label={`Spend from ${accountLabel(value)}, ${costText}`}
          aria-describedby={ACCOUNT_DESC_ID}
          data-testid="pm-account-trigger"
          onClick={() => (open ? setOpen(false) : openAt(selectedIndex))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              openAt(open ? activeIndex : selectedIndex);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              openAt(open ? activeIndex : last);
            }
          }}
          style={accountTriggerStyle(disabled, pal)}
        >
          <BuzzBolt choice={value} pal={pal} testId="pm-account-trigger-icon" />
          <span data-testid="pm-account-trigger-label">{accountLabel(value)}</span>
          {/* The price, as the native control shows it. It is the SAME summed
              estimate the Generate button quotes — read off `runs`, never
              recomputed here — so the two can never disagree. */}
          <span style={accountCostStyle(pal)} data-testid="pm-account-trigger-cost">
            {costText}
          </span>
          <Chevron pal={pal} />
        </button>

        {/* 🔴 RENDERED OUT OF THE RAIL. `createPortal` moves the popup's DOM node
            under the block root while leaving it where it is in the REACT tree —
            so `onKeyDown` above and the handlers below still work exactly as
            written, but no scroll container between the field and the root can
            clip it. The `wrapRef` fallback covers the one frame before the root
            ref is attached, when the menu cannot be open anyway. */}
        {open && (portalTo.current ? createPortal(menu, portalTo.current) : menu)}
      </div>
    </div>
  );
}

/** Where the fixed popup sits: viewport coordinates + the trigger's width. */
export interface MenuBox {
  top: number;
  left: number;
  width: number;
}

/** The gap between the trigger and the popup, on whichever side it opens. */
export const MENU_GAP = 4;

/**
 * Place the popup against the trigger, in VIEWPORT coordinates.
 *
 * 🔴 THE ONLY GEOMETRY THIS CONTROL DOES, AND IT IS DELIBERATELY NOT A CLIPPING
 * CALCULATION. The clip the portal fixes was an ANCESTOR-OVERFLOW problem, which
 * this function cannot reintroduce: a `position: fixed` node under the block root
 * has no scrolling ancestor between it and the viewport. What is computed here is
 * only "is there room below the trigger before the VIEWPORT ends" — if not, and
 * there is room above, the menu sits above instead. Both answers are re-derived
 * on every scroll and resize, so a rail scrolled to a different offset gets a
 * fresh answer rather than a stale one.
 *
 * 🔴 PURE, AND TAKING NUMBERS RATHER THAN ELEMENTS, SO THE FLIP CAN BE TESTED.
 * jsdom reports every rect as 0×0, so a version of this that read the DOM itself
 * could only ever be exercised in a browser. Handing it a rect, a height and a
 * viewport makes the decision assertable with literal numbers; the component does
 * the measuring.
 *
 * `menuHeight` is 0 on the FIRST placement (the popup has not been measured yet),
 * which deliberately reads as "don't flip": the first frame opens downward and
 * the effect's second pass corrects it. `null` for a missing trigger leaves the
 * popup at its default corner rather than at a fabricated position.
 */
export function menuBoxFor(
  trigger: { top: number; bottom: number; left: number; width: number } | null,
  menuHeight: number,
  viewportHeight: number,
): MenuBox | null {
  if (!trigger) return null;
  const roomBelow = viewportHeight - trigger.bottom - MENU_GAP;
  const roomAbove = trigger.top - MENU_GAP;
  const flipUp = menuHeight > 0 && roomBelow < menuHeight && roomAbove > menuHeight;
  return {
    top: flipUp ? trigger.top - MENU_GAP - menuHeight : trigger.bottom + MENU_GAP,
    left: trigger.left,
    width: trigger.width,
  };
}

/** Measure the live trigger + popup and hand them to {@link menuBoxFor}. */
function measureMenuBox(
  triggerEl: HTMLButtonElement | null,
  menuEl: HTMLDivElement | null,
): MenuBox | null {
  if (!triggerEl) return null;
  return menuBoxFor(
    triggerEl.getBoundingClientRect(),
    menuEl ? menuEl.getBoundingClientRect().height : 0,
    window.innerHeight,
  );
}

/**
 * " from your Yellow account" — reads the succeeded runs' `spentAccountType`.
 *
 * With N workflows the pools CAN differ (the server clamps each submit
 * independently), so the note is only made when every run that reported a pool
 * agrees. Naming one pool while another was also debited would be a false
 * statement about where the viewer's money came from, and the honest fallback
 * is simply to say nothing.
 */
function SpentAccountNote({ runs }: { runs: readonly FormatRun[] }) {
  const pools = new Set(
    runs
      .filter((r) => r.phase === 'succeeded' && r.spentAccount != null)
      .map((r) => r.spentAccount as BuzzAccountType),
  );
  if (pools.size !== 1) return null;
  const label = spentAccountLabel([...pools][0]);
  if (!label) return null;
  return (
    <>
      {' '}
      from your <strong>{label}</strong> account
    </>
  );
}

function phaseLabel(phase: GenPhase): string {
  if (phase === 'estimating') return 'Estimating…';
  if (phase === 'submitting') return 'Submitting…';
  if (phase === 'polling') return 'Generating…';
  return 'Working…';
}

// ---------------------------------------------------------------------------
// Styles.
//
// 🔴 TWO THINGS CHANGED HERE AND THEY ARE INDEPENDENT.
//
// 1. COLOUR. These used to read `--civitai-color-*`, the W6 pack's own tokens, so
//    the HOST owned light/dark. Under `brandDepth: "skin"` the app owns its
//    palette, so every colour is a `Palette` field and every style that uses one
//    is a FUNCTION of `pal` rather than a constant. The pack's own components are
//    untouched and still theme themselves from `data-theme` on the block root.
//
// 2. WIDTH. `cardStyle = { width: '100%', maxWidth: 640 }` is gone. Anything the
//    block's width decides now reads a field off `layoutForTier(...)`; there is no
//    breakpoint comparison in this file.
// ---------------------------------------------------------------------------

/**
 * The shell's inset, in px — the gap between the block's edge and its content.
 *
 * 🔴 NAMED BECAUSE A SECOND SURFACE DERIVES FROM IT. `railStyle` needs both the
 * sticky offset and the rail's height bound expressed in terms of this inset, and
 * `index.html`'s boot skeleton mirrors it as a CSS literal. A bare `24` in
 * `shellStyle` made those three numbers three independent coincidences; asserted
 * against this constant they are one value with one reason.
 */
export const SHELL_PADDING = 24;

/** The block root: layout, plus the app's own page ground. */
function shellStyle(pal: Palette): React.CSSProperties {
  return {
    minHeight: '100dvh',
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: SHELL_PADDING,
    boxSizing: 'border-box',
    background: pal.page,
    color: pal.text,
    // 🔴 THE ONE PLACE THIS APP SHIPS A CUSTOM PROPERTY, AND IT IS DELIBERATE.
    // `index.css` paints the `:focus-visible` outline for raw textareas/buttons, and
    // a stylesheet rule cannot read a TS palette — it used to name the HOST's
    // `--civitai-color-primary`, which under `brandDepth: "skin"` is a colour that
    // appears nowhere else on the block. Handing the stylesheet the app's own
    // `brand` through an inherited property keeps the hex in `palette.ts` (still one
    // place, still asserted in both themes) instead of duplicating it into CSS with
    // a `prefers-color-scheme` branch that the host's `data-theme` would not agree
    // with. The cast is because `React.CSSProperties` has no index signature for
    // `--*`; React itself passes such keys through to `style.setProperty`.
    ['--yt-focus-ring' as string]: pal.brand,
  } as React.CSSProperties;
}

/**
 * The content column.
 *
 * 🔴 THIS IS THE LINE THAT WAS THE WHOLE DEFECT. It was
 * `{ width: '100%', maxWidth: 640 }` on every screen, so a ~1600px block rendered
 * a 640px column and left ~60% of itself empty. `maxWidth: null` means "fill the
 * block", which is what `lg`+ returns.
 */
function contentStyle(layout: BlockLayout): React.CSSProperties {
  return { width: '100%', maxWidth: layout.maxWidth ?? undefined };
}

/**
 * The layout numbers that reach the DOM in NO other form.
 *
 * jsdom lays nothing out, so these attributes are how a test asserts the App
 * actually THREADED the pure function's answer through to the render —
 * `layout.test.ts` pins the numbers `layoutForTier` produces, and these pin that
 * the component used them. Either half alone is a claim about one side of the seam.
 *
 * 🔴 ONLY THE NUMBERS WITH NO INLINE-STYLE TWIN ARE HERE, AND THE REST WERE
 * DELETED. `data-max-width`, `data-rail` and the results grid's `data-columns` each
 * restated a fact the inline style on the same element already carries
 * (`style.maxWidth`, the rail grid's `gridTemplateColumns` plus the rail element's
 * existence, and the results grid's `gridTemplateColumns`). The style is the
 * stronger witness of the two — a browser reads it, and it cannot be right while
 * the layout is wrong — so a duplicate attribute in the shipped DOM bought a second
 * assertion of the same thing and one more place to get out of step. What survives:
 * `resultColumns`, because the column count is decided at every tier but only
 * reaches a style once candidates exist, and `formatMinCardPx`, which the grid
 * carries as `minmax()` but is worth naming at the content box too.
 */
function contentProps(layout: BlockLayout) {
  return {
    'data-testid': 'yt-content',
    'data-result-columns': String(layout.resultColumns),
    'data-min-card': String(layout.formatMinCardPx),
  } as const;
}

/** A child that should simply fill the content column. */
const fillStyle: React.CSSProperties = { width: '100%' };

/** Rail + main, side by side. The rail is a fixed px column; main takes the rest. */
function railGridStyle(layout: BlockLayout): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: `${layout.railWidth}px minmax(0, 1fr)`,
    gap: 20,
    alignItems: 'start',
  };
}

/**
 * The persistent controls rail.
 *
 * 🔴 `position: sticky` IS LIVE ON BOTH HOST SURFACES — AND THE VERSION OF THIS
 * COMMENT THAT SHIPPED BEFORE THIS ROUND SAID THE OPPOSITE. It claimed the rail had
 * no scrolling ancestor because `useBlockResize(rootRef)` posts `RESIZE_IFRAME` and
 * the host therefore fits the iframe to content. That was reasoned, not measured,
 * and it is false on both surfaces a block can be mounted in (read off
 * `civitai@main`):
 *
 *  - FULL PAGE (`/apps/run/<slug>`) — the only surface wide enough to reach the
 *    `lg` rail in the first place. `PageBlockHost.tsx` handles NO `RESIZE_IFRAME`
 *    message at all; `IframeHost.tsx` is the only host component that does. It
 *    sizes the frame `height: 100%` with `min-height: calc(100dvh - <site header>)`,
 *    so the frame is viewport-height whatever the app reports and the app's own
 *    content scrolls INSIDE it.
 *  - SLOT (`IframeHost.tsx`) — `RESIZE_IFRAME` is honoured, but the height goes
 *    through `clampBlockHeight`, which takes the minimum of the requested height,
 *    the manifest's `maxHeight`, a hard ceiling, and the viewport less the host's
 *    own chrome. Past that clamp the frame stops growing and the app scrolls
 *    internally here too.
 *
 * So the rail genuinely stays on screen while the candidate grid scrolls past it.
 * `useBlockResize` is still called and still right — it is what lets a SHORT block
 * occupy only the height it needs in a slot — but "the host fits the iframe to
 * content" is not a property that survives either surface, and it was the wrong
 * reason to call sticky inert. `taste.json` carries the correction.
 *
 * Sticky is not the rail's only benefit: the inputs and the candidate grid are SIDE
 * BY SIDE, so neither is below the other's fold even before anything scrolls.
 *
 * `alignSelf: 'start'` keeps the grid item from stretching to the row height, which
 * sticky needs in order to have anywhere to travel.
 *
 * 🔴 THE HEIGHT BOUND IS WHAT KEEPS THE SPEND BUTTON ON SCREEN, AND WITHOUT IT
 * STICKY MADE THINGS WORSE. An unbounded sticky rail taller than the scrollport
 * cannot scroll its own overflow: the viewer sees its top, the frame's scroll moves
 * the MAIN column, and the rail's tail — quantity, spend-from, **Generate**, and the
 * `needs-consent` / `insufficient` / `account-rejected` alerts that gate the spend —
 * stays below the fold for the whole sticky range. That inverts the rail's purpose,
 * because the control that debits the viewer's Buzz is the one thing that must be
 * reachable from wherever the prompt is. At `lg`+ the rail carries mode toggle →
 * prompt → model → up to `MAX_LORAS` LoRA rows → quantity → spend-from → Generate →
 * alerts, so it exceeds a 1280x800 laptop's ~740px of scrollport well before the
 * LoRA cap. `maxHeight` + `overflowY: auto` give the rail its OWN scrollport, so its
 * tail is always one scroll away inside the rail rather than unreachable.
 *
 * BOTH NUMBERS ARE DERIVED FROM `SHELL_PADDING`, not picked. `top` is one inset, so
 * a stuck rail keeps the same gap to the frame's top edge that the shell gives every
 * other edge — `top: 0` sat flush against it. The bound is `100dvh` less TWO insets
 * (one above, one below), which is the height the shell's own box leaves inside the
 * frame.
 *
 * `dvh` IS EXACT HERE ON BOTH SURFACES, AND AN EARLIER VERSION OF THIS PARAGRAPH
 * HEDGED ABOUT AN OVER-ESTIMATE IT DOES NOT MAKE. This code runs inside the block's
 * own iframe, and a viewport unit resolves against THE IFRAME'S viewport, not the
 * top document's — so `100dvh` is the frame's own height by definition, whatever
 * height the host gave it. That is true on the full-page surface and equally true
 * on a slot surface sized by `clampBlockHeight`; the host chrome the old sentence
 * worried about is outside the frame and already excluded.
 *
 * 🔴 NOT VERIFIED IN PIXELS, AND THAT IS NOT A DETAIL. jsdom performs no layout, so
 * nothing here can observe a sticky rail actually travelling, overflowing, or
 * scrolling. What the suite asserts is that the bound and the overflow are PRESENT in
 * the emitted style and that both are expressed in terms of `SHELL_PADDING`. Whether
 * the tail is reachable on a real 1280x800 laptop is unmeasured and carried as a
 * `deferred[]` item in `taste.json` alongside the rest of the browser check.
 */
function railStyle(pal: Palette): React.CSSProperties {
  return {
    position: 'sticky',
    top: SHELL_PADDING,
    maxHeight: `calc(100dvh - ${SHELL_PADDING * 2}px)`,
    overflowY: 'auto',
    alignSelf: 'start',
    display: 'block',
    padding: 16,
    borderRadius: 12,
    border: `1px solid ${pal.borderStrong}`,
    background: pal.railBg,
    boxSizing: 'border-box',
  };
}

/** The main column beside the rail. `minWidth: 0` so a wide grid child can shrink. */
const mainColumnStyle: React.CSSProperties = { minWidth: 0 };

const titleStyle: React.CSSProperties = { fontSize: 20 };

/**
 * The path the hero's banner is fetched from, same-origin.
 *
 * `public/` is copied VERBATIM into the build output, so this is a root-relative
 * URL and not an `import`ed asset: Vite would otherwise hash and inline-or-emit it,
 * and the point of this one is that it is a plain file the page requests after
 * first paint. `vite.config.ts` sets `base: '/'`, so the leading slash is the built
 * app's own root on `https://yt-thumbnail.civit.ai/`.
 *
 * Exported so the seam between "the style asks for this path" and "a file is
 * actually at it" has something to assert on — two claims that are independently
 * true or false, and a 404 here is invisible on screen because layer 3 below
 * covers for it.
 */
export const HERO_BANNER_SRC = '/hero-banner.jpg';

/**
 * The in-app hero: THREE background layers, painted front to back.
 *
 * 🔴 THE ORDER IS THE LEGIBILITY GUARANTEE, NOT A STYLE CHOICE. CSS paints the
 * FIRST entry of a `background-image` list on TOP, so the list below reads
 * scrim → photo → fallback:
 *
 *   1. **Scrim.** A horizontal wash that is *literally* `pal.heroTo` — not a
 *      translucent black, not a tint — from 0% to 42%, fading out by 82%. Its whole
 *      job is that the headline and the sub-line sit on a REALIZED ground of
 *      exactly `heroTo`, so `['heroFg','heroTo']` and `['heroSubFg','heroTo']` in
 *      `palette.ts` — already graded in both themes, already in `TEXT_PAIRS` — stay
 *      true statements about what a viewer sees rather than about what the app
 *      would have painted without an image. No new token, no new contrast claim.
 *   2. **The photo**, `cover`, anchored `right center`. The banner's subject is a
 *      burst on its RIGHT, and the anchor is chosen for the case where it can
 *      actually be lost. Arithmetic, since jsdom cannot measure it: the source is
 *      1216×380, aspect 3.2. `cover` trims the LONG axis of the box, so the crop is
 *      horizontal exactly while the hero is narrower-per-height than 3.2 — i.e.
 *      below 333px of hero width at the 104px floor. A `base` block of 361px gives
 *      the hero 313px (the shell's 24px inset each side), so the phone case is
 *      precisely where the horizontal crop bites and `right` keeps the burst. Above
 *      that the crop turns vertical and `center` is what keeps the burst's middle.
 *   3. **The fallback**, the original `135deg` wash across both palette stops,
 *      UNCHANGED. It is what a viewer gets if layer 2 404s or is still in flight,
 *      which is why the hero costs zero bytes to be correct: the image is an
 *      upgrade on a surface that already worked.
 *
 * 🔴 BOTH GRADIENT STOPS COME FROM THE PALETTE, which is the part `skin` made our
 * problem. The old version read `--civitai-color-primary` → `-primary-hover` →
 * `-surface-2`, so the host flipped it for us; now the light theme's stops are a
 * separate pair of literals that a test has to check, because a gradient that
 * only works in dark is invisible until someone opens the other theme.
 *
 * 🔴 WHAT NO TEST HERE CAN SEE. jsdom performs no layout and fetches no image, so
 * nothing in this repo observes the crop, the scrim's realized width in px, or the
 * photo landing at all. What the suite asserts is that the three layers are present
 * IN THIS ORDER and that the scrim's opaque run is `heroTo` in both themes — the
 * structural facts the contrast argument rests on. The pixels are a `deferred[]`
 * item in `taste.json` alongside the rest of the browser check.
 *
 * The padding, the headline and now the height floor scale with the block, so the
 * hero is a masthead on a 1600px block rather than a banner that eats the fold.
 * `alignContent: 'start'` is what keeps the text where it already was: with a
 * `minHeight` there is free space for the first time, and grid's default
 * `stretch` would inflate both auto rows and open a gap between the two lines.
 */
function heroStyle(pal: Palette, layout: BlockLayout): React.CSSProperties {
  const scrim = `linear-gradient(90deg, ${pal.heroTo} 0%, ${pal.heroTo} 42%, transparent 82%)`;
  const photo = `url('${HERO_BANNER_SRC}')`;
  const fallback = `linear-gradient(135deg, ${pal.heroFrom} 0%, ${pal.heroTo} 100%)`;
  return {
    display: 'grid',
    gap: 2,
    alignContent: 'start',
    padding: layout.rail ? '22px 28px' : '18px 20px',
    minHeight: layout.heroMinHeight,
    borderRadius: 12,
    backgroundImage: `${scrim}, ${photo}, ${fallback}`,
    backgroundSize: 'cover',
    backgroundPosition: 'right center',
    backgroundRepeat: 'no-repeat',
    color: pal.heroFg,
  };
}
function heroTitleStyle(layout: BlockLayout): React.CSSProperties {
  return {
    fontSize: layout.rail ? 26 : 22,
    lineHeight: 1.15,
    letterSpacing: '-0.01em',
  };
}
function heroSubStyle(pal: Palette): React.CSSProperties {
  // 🔴 NOT `opacity`. The old hero dimmed its sub-line with `opacity: 0.85`, which
  // makes the realized contrast a value no test can read off the palette — and in
  // the light theme it pushed white-on-magenta under AA. An explicit token is
  // assertable: 4.86:1 dark, 4.65:1 light, both against `heroFrom`.
  return { fontSize: 13, color: pal.heroSubFg };
}

/**
 * The format tag overlaid on each candidate. With N formats in one grid, an
 * untagged image cannot be traced back to the format that produced it.
 *
 * The scrim is `overlay` at 78% rather than a flat colour, because it sits on an
 * arbitrary generated image — but the PAIR that is graded is `overlayFg` on a
 * fully opaque `overlay` (18.31:1 in both themes), which is the worst case for
 * legibility only if the image underneath is lighter, never darker.
 */
function candidateTagStyle(pal: Palette): React.CSSProperties {
  return {
    position: 'absolute',
    left: 6,
    bottom: 6,
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    background: withAlpha(pal.overlay, 0.78),
    color: pal.overlayFg,
    pointerEvents: 'none',
  };
}

const imageStyle: React.CSSProperties = {
  width: '100%',
  aspectRatio: '16 / 9',
  objectFit: 'cover',
  borderRadius: 8,
  display: 'block',
};

function canvasStyle(pal: Palette): React.CSSProperties {
  return {
    width: '100%',
    borderRadius: 8,
    display: 'block',
    background: pal.surfaceRaised,
  };
}

/**
 * The editor: canvas beside its controls at `lg`+, stacked below it.
 *
 * `minmax(0, 1fr)` on both tracks rather than `1fr`: a `<canvas>` carries an
 * intrinsic width of 1280px, and a bare `1fr` track refuses to shrink below its
 * content's intrinsic size, so the split would silently overflow the block.
 */
function editorSplitStyle(layout: BlockLayout): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: layout.editorSideBySide
      ? 'minmax(0, 3fr) minmax(0, 2fr)'
      : 'minmax(0, 1fr)',
    gap: 16,
    alignItems: 'start',
  };
}
const editorControlsStyle: React.CSSProperties = { display: 'grid', gap: 12, minWidth: 0 };

function sourceThumbStyle(pal: Palette): React.CSSProperties {
  return {
    width: 96,
    height: 54,
    objectFit: 'cover',
    borderRadius: 6,
    border: `1px solid ${pal.border}`,
  };
}

// Field chrome. The Model + LoRA controls match the pack's own input surface
// because both sit on the same app palette, not because they share a CSS var.
const fieldStyle: React.CSSProperties = { display: 'grid', gap: 4 };
const fieldLabelStyle: React.CSSProperties = { fontSize: 14, fontWeight: 600 };
function fieldDescStyle(pal: Palette): React.CSSProperties {
  // 🔴 NO `opacity` HERE EITHER. It used to be `text-dimmed` at `opacity: 0.8`,
  // i.e. a contrast ratio nothing could assert. `textDim` is a real token: 7.84:1
  // on `page` dark, 6.62:1 light.
  return { fontSize: 12, color: pal.textDim };
}
function currentModelStyle(pal: Palette): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    padding: '10px 12px',
    borderRadius: 8,
    border: `1px solid ${pal.border}`,
    background: pal.surface,
    color: pal.text,
    fontSize: 14,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

// The composed-prompt editor. A panel (`surfaceRaised` inside the field) holding
// one editable box per selected format.
const previewListStyle: React.CSSProperties = { display: 'grid', gap: 6, marginTop: 4 };
const previewIconStyle: React.CSSProperties = { flex: 'none', display: 'block' };
function previewRowStyle(pal: Palette): React.CSSProperties {
  return {
    display: 'grid',
    gap: 2,
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${pal.border}`,
    background: pal.surfaceRaised,
  };
}
function previewRowLabelStyle(pal: Palette): React.CSSProperties {
  return { fontSize: 11, fontWeight: 700, letterSpacing: 0.3, color: pal.textDim };
}
function previewTextStyle(pal: Palette): React.CSSProperties {
  return {
    // A real <textarea>: the string here IS the string submitted, so it is the
    // control, not a rendering of one.
    width: '100%',
    boxSizing: 'border-box',
    resize: 'vertical',
    padding: '6px 8px',
    borderRadius: 6,
    border: `1px solid ${pal.border}`,
    background: pal.surface,
    fontFamily: 'inherit',
    fontSize: 12,
    lineHeight: 1.45,
    color: pal.text,
    // The whole string, wrapped — never clipped with an ellipsis. A field that
    // hides its own tail cannot answer the question it exists to answer.
    overflowWrap: 'anywhere',
    // …but N of them must not push the picker off screen, so a long one scrolls
    // inside its own box.
    maxHeight: 160,
    overflowY: 'auto',
  };
}
function previewTrimStyle(pal: Palette): React.CSSProperties {
  return { fontSize: 11, fontWeight: 600, color: pal.danger };
}
function previewEditedStyle(pal: Palette): React.CSSProperties {
  return { fontSize: 10, fontWeight: 700, letterSpacing: 0.2, color: pal.textDim };
}
function previewCountStyle(pal: Palette): React.CSSProperties {
  return { fontSize: 10, color: pal.textDim, justifySelf: 'end' };
}

// The Buzz-account menu: a trigger + an absolutely positioned popup.
const accountWrapStyle: React.CSSProperties = { position: 'relative', marginTop: 4 };
function accountTriggerStyle(disabled: boolean, pal: Palette): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '8px 12px',
    borderRadius: 8,
    border: `1px solid ${pal.border}`,
    background: pal.surface,
    color: pal.text,
    fontSize: 13,
    fontWeight: 600,
    textAlign: 'left',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}
function accountCostStyle(pal: Palette): React.CSSProperties {
  return { marginLeft: 'auto', fontSize: 12, fontWeight: 500, color: pal.textDim };
}
function accountMenuStyle(box: MenuBox | null, pal: Palette): React.CSSProperties {
  return {
    // 🔴 `fixed`, NOT `absolute`. Absolute positioning resolves against the
    // nearest positioned ancestor and is still CLIPPED by any scrolling ancestor
    // in between — which is exactly how the rail cut Green and Yellow off. Fixed,
    // under the block root, has no such ancestor. `box` carries viewport
    // coordinates from `menuBoxFor`; `null` only for the frame before the trigger
    // has been measured.
    position: 'fixed',
    zIndex: 20,
    top: box?.top ?? 0,
    left: box?.left ?? 0,
    width: box?.width,
    display: 'grid',
    gap: 2,
    padding: 4,
    borderRadius: 8,
    border: `1px solid ${pal.borderStrong}`,
    background: pal.surface,
    boxShadow: `0 8px 24px ${withAlpha(pal.page, 0.55)}`,
  };
}
function accountItemStyle(selected: boolean, pal: Palette): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '8px 10px',
    borderRadius: 6,
    // 🔴 THE SELECTED STATE IS NOT CARRIED BY COLOUR ALONE. `aria-checked`, the
    // heavier weight and the ✓ all say it too — the tint is the fourth signal,
    // not the only one.
    border: `1px solid ${selected ? pal.brandTintBorder : 'transparent'}`,
    background: selected ? pal.brandTint : pal.surfaceRaised,
    color: pal.text,
    fontSize: 13,
    fontWeight: selected ? 700 : 500,
    textAlign: 'left',
    cursor: 'pointer',
  };
}
function accountBalanceStyle(pal: Palette): React.CSSProperties {
  return { marginLeft: 'auto', fontSize: 12, fontWeight: 500, color: pal.textDim };
}

// The pill chrome (the quantity row — the Buzz account moved to the menu above).
const pickerRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginTop: 4,
};
function pickerBtnStyle(
  selected: boolean,
  disabled: boolean,
  pal: Palette,
): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: 999,
    border: '1px solid ' + (selected ? pal.brand : pal.border),
    background: selected ? pal.brand : pal.surface,
    color: selected ? pal.brandFg : pal.text,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}

/**
 * The results grid.
 *
 * 🔴 IT USED TO BE `repeat(2, …)` AT EVERY WIDTH, with a comment claiming two
 * columns "keep each preview readable at the block's usual width". That was two
 * ~170px thumbnails on a phone and two ~300px ones inside a 640px column on a
 * 1600px block. The count is now `layoutForTier`'s, so generating four candidates
 * produces four comparable ones.
 */
function galleryStyle(layout: BlockLayout): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${layout.resultColumns}, minmax(0, 1fr))`,
    gap: 10,
  };
}
const galleryItemStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
};

// Color inputs (editor) — native, themed minimally.
const colorLabelStyle: React.CSSProperties = { display: 'grid', gap: 2 };
function colorInputStyle(pal: Palette): React.CSSProperties {
  return {
    width: 42,
    height: 28,
    padding: 0,
    border: `1px solid ${pal.border}`,
    borderRadius: 6,
    background: 'none',
    cursor: 'pointer',
  };
}

// The LoRA list + rows.
const loraListStyle: React.CSSProperties = { marginTop: 4 };
function loraRowStyle(pal: Palette): React.CSSProperties {
  return {
    display: 'grid',
    gap: 6,
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${pal.border}`,
    background: pal.surface,
  };
}
const loraRowHeadStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
};
const loraNameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const loraAddWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  alignItems: 'center',
  marginTop: 4,
};

/**
 * `#RRGGBB` + alpha → `rgba(...)`, so a scrim can be derived FROM a palette token
 * instead of being a second hardcoded colour beside it. Kept here rather than in
 * `palette.ts` because the palette is the set of solid colours the theme defines;
 * this is one surface's compositing choice.
 */
function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
