import { useCallback, useEffect, useRef, useState } from 'react';

import {
  useAppStorage,
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
  buildWorkflowBody,
  clampQuantity,
  composePrompt,
  failedRuns,
  formatCost,
  hasBudgetedScope,
  imageUrlsFrom,
  initRuns,
  isBusyPhase,
  isPartialFailure,
  overallPhase,
  patchRun,
  phaseForError,
  phaseForSnapshot,
  pickDefaultAccount,
  runCandidates,
  spentAccountLabel,
  submitErrorReason,
  isTerminalStatus,
  type AccountChoice,
  type FormatRun,
  type GenPhase,
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
import { layoutForTier, type BlockLayout } from './layout.js';
import { paletteFor, parseHex, type Palette } from './palette.js';
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

  const anon = ready && !viewer;
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
    storage
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
  }, [ready, viewer, storage]);

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
    const bodyFor = (fmt: Format, acct: AccountChoice) =>
      buildWorkflowBody(composePrompt(prompt, fmt.suffix), checkpoint, loras, acct, {
        quantity,
        sourceImage: mode === 'remix' ? sourceImage : null,
      });

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
        // A host can return an instant terminal snapshot (cached / instant-fail).
        applySnapshotToRun(fmt.id, snap);
        if (!isTerminalStatus(snap.status) && snap.workflowId) {
          runPollLoop(fmt.id, snap.workflowId, tok);
        }
      }),
    );
  }, [
    mode,
    prompt,
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
        await storage.set(CUSTOM_FORMATS_KEY, serializeCustomFormats(next));
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
    [storage],
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

  const promptError =
    touched && prompt.trim().length === 0 ? 'Enter a prompt to generate.' : undefined;
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
    if (prompt.trim().length === 0) return;
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
                              setExportNote(
                                res.oversized
                                  ? `Saved, but ${Math.round(res.bytes / 1024)} KB is over YouTube's 2 MB cap — trim the image.`
                                  : `Saved · ${Math.round(res.bytes / 1024)} KB · quality ${Math.round(res.quality * 100)}%`,
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

  // The in-app hero. Pure CSS — a gradient wash plus the app name — so it costs
  // no bytes and stays sharp at any block width. Under `brandDepth: "skin"` its
  // colours come from the app's own palette rather than pack tokens, which is why
  // both gradient stops AND both text colours are asserted in both themes.
  // (The STORE cover art is a different asset and ships in assets/.)
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

  // 🔴 The description deliberately does NOT claim a generation size. Measured
  // 2026-09-28: the platform IGNORES params.width/height — 1280x720 and 1344x768
  // requests, on SD XL 1.0 and on FLUX.1 [dev], all came back 1216x832. The old
  // string "It is generated at 1280×720 (16:9)" was therefore FALSE. What IS true
  // is the export: the canvas editor cover-crops to exactly 1280x720 on
  // download — which the hero states and the download button repeats, so the crop
  // no longer needs restating here (phase 2: delete copy that explains what the
  // UI already shows).
  const promptBlock = (
    <Textarea
      label="Prompt"
      description="Describe the thumbnail."
      placeholder="a serene mountain lake at golden hour, highly detailed"
      value={prompt}
      minRows={4}
      maxLength={PROMPT_MAX}
      required
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
        <Button
          fullWidth
          loading={busy}
          disabled={prompt.trim().length === 0 || remixIncomplete}
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
                <Button
                  size="sm"
                  variant="light"
                  onClick={() => setEditing(c.url)}
                  data-testid={`pm-edit-${i}`}
                >
                  Edit &amp; download
                </Button>
              </div>
            ))}
          </div>
        </Stack>
      )}
    </>
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
          </Stack>
        </Card>
      </div>
    </div>
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
  pickerBusy,
  onAdd,
  onRemove,
  onWeight,
  pal,
}: {
  selected: readonly LoraOption[];
  capReached: boolean;
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

      {/* Add a LoRA — opens the host's resource picker filtered to LoRAs. */}
      <span style={loraAddWrapStyle}>
        <Button
          variant="light"
          size="sm"
          disabled={capReached}
          loading={pickerBusy}
          onClick={onAdd}
          data-testid="pm-lora-add"
        >
          + Add LoRA
        </Button>
        {capReached && <span style={fieldDescStyle(pal)}>Max {MAX_LORAS} LoRAs selected.</span>}
      </span>
    </div>
  );
}

/**
 * Choose which Buzz pool funds the generation. Auto (default) omits `accountType`
 * from the submit body entirely — today's host-chosen behavior. Pools with a 0
 * balance are annotated but stay selectable (the server still preferred-first
 * falls back, and a picked-but-empty pool is harmless).
 */
function AccountPicker({
  value,
  onChange,
  balance,
  disabled,
  pal,
}: {
  value: AccountChoice;
  onChange: (v: AccountChoice) => void;
  balance: { blue: number; green: number; yellow: number } | null;
  disabled: boolean;
  pal: Palette;
}) {
  return (
    <div style={fieldStyle}>
      <span style={fieldLabelStyle}>Spend from</span>
      {/* Kept short, but the "preference, not a guarantee" half stays: this is
          the control that decides whose Buzz is debited. */}
      <span style={fieldDescStyle(pal)}>A preference — the server picks the final pool.</span>
      <div role="radiogroup" aria-label="Buzz account" style={pickerRowStyle}>
        {ACCOUNT_CHOICES.map((choice) => {
          const selected = value === choice;
          const zero = choice !== 'auto' && balance != null && balance[choice] === 0;
          return (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(choice)}
              data-testid={`pm-account-${choice}`}
              style={pickerBtnStyle(selected, disabled, pal)}
              title={zero ? 'You have 0 Buzz in this account' : undefined}
            >
              {accountLabel(choice)}
              {zero ? ' · 0' : ''}
            </button>
          );
        })}
      </div>
    </div>
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
 * frame. `100dvh` and not the frame's own height because the frame IS viewport-height
 * on the full-page surface (see above), and on the slot surface `clampBlockHeight`'s
 * ceiling is itself the viewport less host chrome, so `100dvh` is an over-estimate
 * there rather than an under-estimate — it can leave the rail taller than its
 * scrollport, never shorter than its content needs.
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
 * The in-app hero. A gradient wash plus the app name — no bytes, sharp at any
 * width.
 *
 * 🔴 BOTH GRADIENT STOPS COME FROM THE PALETTE, which is the part `skin` made our
 * problem. The old version read `--civitai-color-primary` → `-primary-hover` →
 * `-surface-2`, so the host flipped it for us; now the light theme's stops are a
 * separate pair of literals that a test has to check, because a gradient that
 * only works in dark is invisible until someone opens the other theme.
 *
 * The padding and the headline scale with the block, so the hero is a masthead on
 * a 1600px block rather than a banner that eats the fold.
 */
function heroStyle(pal: Palette, layout: BlockLayout): React.CSSProperties {
  return {
    display: 'grid',
    gap: 2,
    padding: layout.rail ? '22px 28px' : '18px 20px',
    borderRadius: 12,
    background: `linear-gradient(135deg, ${pal.heroFrom} 0%, ${pal.heroTo} 100%)`,
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

// The pill chrome (account picker, quantity).
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
