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
  // ONE structural decision, deliberately. `below('sm')` is the "am I in a narrow
  // slot?" question every block eventually asks; everything else here is fluid
  // CSS already. `measured` is not gated on because the fallback (`'base'`, i.e.
  // narrow) is the safe branch for a block — see the hook's own docs for when to
  // gate on it instead.
  const narrow = bp.below('sm');

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
      <span style={currentModelStyle} title={checkpoint.label} data-testid="pm-model-label">
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

  if (!ready) {
    return (
      // Theme the block's OWN root; that's what the pack's CSS reads.
      <div ref={rootRef} data-theme={theme} data-block-tier={bp.tier} style={shell}>
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
      <div ref={rootRef} data-theme={theme} data-block-tier={bp.tier} style={shell}>
        <Card padding="lg" style={cardStyle} data-testid="pm-editor">
          <Stack gap={12}>
            <Group justify="space-between" align="center" wrap={false}>
              <strong style={titleStyle}>Edit thumbnail</strong>
              <Button variant="light" onClick={() => setEditing(null)} data-testid="pm-editor-back">
                Back
              </Button>
            </Group>

            {editorStatus === 'loading' && <span style={fieldDescStyle}>Loading image…</span>}

            {editorStatus === 'error' && (
              <Alert
                color="warning"
                title="Couldn't open the image in the editor"
                data-testid="pm-editor-error"
              >
                The image host refused a cross-origin load, so the canvas editor can&apos;t run on
                it.{' '}
                <a href={editing ?? '#'} target="_blank" rel="noreferrer">
                  Open the image directly
                </a>{' '}
                to save it manually.
              </Alert>
            )}

            {editorStatus === 'ready' && (
              <>
                <canvas
                  ref={canvasRef}
                  width={YT_W}
                  height={YT_H}
                  style={canvasStyle}
                  data-testid="pm-editor-canvas"
                  aria-label="Thumbnail preview"
                />

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
                    <span style={fieldDescStyle}>Text</span>
                    <input
                      type="color"
                      value={overlay.color}
                      onChange={(e) => setOverlay((o) => ({ ...o, color: e.target.value }))}
                      data-testid="pm-editor-color"
                      aria-label="Text color"
                      style={colorInputStyle}
                    />
                  </label>
                  <label style={colorLabelStyle}>
                    <span style={fieldDescStyle}>Outline</span>
                    <input
                      type="color"
                      value={overlay.strokeColor}
                      onChange={(e) => setOverlay((o) => ({ ...o, strokeColor: e.target.value }))}
                      data-testid="pm-editor-strokecolor"
                      aria-label="Outline color"
                      style={colorInputStyle}
                    />
                  </label>
                </Group>

                {exportNote && (
                  <span style={fieldDescStyle} data-testid="pm-export-note">
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
              </>
            )}
          </Stack>
        </Card>
      </div>
    );
  }

  return (
    // `data-block-tier` is not required by anything — it is here so you can see
    // the tier in devtools (and assert it in a test) while you build a layout.
    <div ref={rootRef} data-theme={theme} data-block-tier={bp.tier} style={shell}>
      <Card padding="lg" style={cardStyle}>
        <Stack gap={16}>
          {/* The in-app hero. Pure CSS — a gradient wash plus the app name — so
              it costs no bytes, scales to any block width, and reads correctly
              in both host themes because every colour in it is a pack token.
              (The STORE cover art is a different asset and ships in assets/.) */}
          <div style={heroStyle} data-testid="yt-hero">
            <strong style={heroTitleStyle}>YT Thumbnail</strong>
            <span style={heroSubStyle}>Exports at 1280×720, ready to upload.</span>
          </div>

          {/* Mode toggle: Generate (txt2img) ⇄ Remix (img2img). Switching swaps
              the source control + the body-builder while REUSING the one
              estimate -> consent -> submit -> poll driver + the shared
              checkpoint/LoRA/account controls below. */}
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
                  <img src={sourceImage.url} alt="Remix source" style={sourceThumbStyle} />
                  <Button variant="light" size="sm" loading={uploadBusy} onClick={() => void onChooseSource()}>
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

          {/* 🔴 The description deliberately does NOT claim a generation size.
              Measured 2026-09-28: the platform IGNORES params.width/height —
              1280x720 and 1344x768 requests, on SD XL 1.0 and on FLUX.1 [dev],
              all came back 1216x832. The old string "It is generated at 1280×720
              (16:9)" was therefore FALSE. What IS true is the export: the canvas
              editor cover-crops to exactly 1280x720 on download. */}
          <Textarea
            label="Prompt"
            description="Describe the thumbnail. The download is cropped to 1280×720."
            placeholder="a serene mountain lake at golden hour, highly detailed"
            value={prompt}
            minRows={4}
            maxLength={PROMPT_MAX}
            required
            error={promptError}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={() => setTouched(true)}
          />

          {/* FORMATS. Multi-select, and the selection count IS the workflow
              count: each format runs its own generation with its own prompt
              suffix, so picking a second format is picking a second bill. That
              is stated once, here, and again as the summed price on Generate. */}
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
            <span style={fieldDescStyle} data-testid="yt-format-cost-note">
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
            />

            {/* 🔴 The anonymous path, said out loud. `useAppStorage` resolves
                null on read and REJECTS every write for an anonymous viewer, so
                a "New format" button that looked enabled would simply eat their
                work. */}
            {storageState === 'anon' && (
              <span style={fieldDescStyle} data-testid="yt-storage-anon">
                Sign in to make and save your own formats.
              </span>
            )}
            {storageState === 'error' && (
              <span style={fieldDescStyle} data-testid="yt-storage-error">
                Couldn&apos;t load your saved formats. The built-in ones still work.
              </span>
            )}
            {storageNote && (
              <span style={fieldDescStyle} data-testid="yt-storage-note">
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
              />
            )}
          </div>

          {/* Model control. A page carries no host model context, so the app
              starts on DEFAULT_CHECKPOINT and lets the user CHANGE it via the
              HOST's resource picker (useResourcePicker, type=Checkpoint,
              UNFILTERED so every ecosystem is reachable) — the block never
              browses a catalog. Every pick is DISCOVERY ONLY: the server
              re-validates + re-prices it at estimate/submit. */}
          <div style={fieldStyle}>
            <span style={fieldLabelStyle}>Model</span>
            {/* THE RESPONSIVE EXAMPLE. Side by side when the block has room;
                stacked, with a full-width button, when it doesn't. This is a
                STRUCTURAL swap (a different element), which is the kind of
                change CSS alone handles badly and `useBlockBreakpoint` is
                for — pure sizing/spacing should stay in fluid CSS. */}
            {narrow ? (
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

          {/* LoRA control. Add up to MAX_LORAS LoRAs on top of the checkpoint
              via the HOST's resource picker (useResourcePicker, type=LORA),
              each with an adjustable weight (the pack's Slider). Every LoRA +
              weight is DISCOVERY ONLY: the server re-validates (LoRA-only?
              base-model compatible? entitled?) + re-prices the whole body at
              estimate/submit. */}
          <LoraSelector
            selected={loras}
            capReached={loraCapReached}
            pickerBusy={pickerBusy}
            onAdd={() => void onAddLora()}
            onRemove={onRemoveLora}
            onWeight={onLoraWeight}
          />

          {/* Quantity — how many candidates per generation (server cap 4).
              Multiple candidates cost proportionally; the estimate reflects it. */}
          <div style={fieldStyle}>
            <span style={fieldLabelStyle}>Images per format</span>
            {/* 🔴 COST DISCLOSURE — kept deliberately while other copy was cut.
                Quantity and format count MULTIPLY: this is images per format,
                per run, and each one is charged. */}
            <span style={fieldDescStyle}>
              1–{QUANTITY_MAX} per format. Each image costs Buzz.
            </span>
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
                  style={pickerBtnStyle(clampQuantity(quantity) === n, busy)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {!anon && (
            <AccountPicker
              value={account}
              onChange={(v) => {
                // A manual pick freezes the blue -> green -> yellow default:
                // from here on the app never silently reassigns their pool.
                accountTouchedRef.current = true;
                setAccount(v);
              }}
              balance={balance}
              disabled={busy}
            />
          )}

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
              {/* The price on the button is the SUM across every selected
                  format. `estimatePartial` means some formats could not be
                  priced, so the figure is a floor, not the bill — say "from"
                  rather than quote a total we know is incomplete.
                  Unpriced at all -> no figure: `estimate()` 403s until the
                  viewer consents, so a fresh viewer legitimately sees none. */}
              {busy
                ? phaseLabel(phase)
                : estimatedCost != null
                  ? `Generate · ${estimatePartial ? 'from ' : ''}${formatCost(estimatedCost)} Buzz`
                  : 'Generate'}
            </Button>
          )}

          {remixIncomplete && (
            <span style={fieldDescStyle} data-testid="pm-remix-hint">
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
                  failure cannot inflate it into a bill for work that never
                  ran — `formatCost(null)` renders '—'. */}
              <Alert color="success" title="Done" data-testid="pm-spent">
                Spent <strong>{formatCost(actualCost)}</strong> Buzz
                <SpentAccountNote runs={runs} />.
              </Alert>
              <span style={fieldLabelStyle}>
                {candidates.length} candidate{candidates.length === 1 ? '' : 's'} — pick one to edit
              </span>
              <div style={galleryStyle}>
                {candidates.map((c, i) => (
                  <div key={c.url} style={galleryItemStyle}>
                    <div style={{ position: 'relative' }}>
                      <img
                        src={c.url}
                        alt={`Generated result — ${c.formatLabel}`}
                        style={imageStyle}
                        data-testid="pm-result-img"
                      />
                      {/* Each candidate carries the format that made it — with
                          N formats in one grid, an untagged image is unusable
                          for deciding which format to keep paying for. */}
                      <span style={candidateTagStyle} data-testid="pm-result-format">
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
        </Stack>
      </Card>
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
}: {
  selected: readonly LoraOption[];
  capReached: boolean;
  pickerBusy: boolean;
  onAdd: () => void;
  onRemove: (versionId: number) => void;
  onWeight: (versionId: number, weight: number) => void;
}) {
  return (
    <div style={fieldStyle}>
      <span style={fieldLabelStyle}>
        LoRAs{' '}
        <Badge color="info" variant="light">
          {selected.length}/{MAX_LORAS}
        </Badge>
      </span>
      <span style={fieldDescStyle}>Optional. Up to {MAX_LORAS}, each with a weight.</span>

      {/* Selected LoRAs, each with a weight control + remove. */}
      {selected.length > 0 && (
        <Stack gap={8} style={loraListStyle}>
          {selected.map((l) => (
            <div key={l.versionId} style={loraRowStyle} data-testid="pm-lora-row">
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
        {capReached && <span style={fieldDescStyle}>Max {MAX_LORAS} LoRAs selected.</span>}
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
}: {
  value: AccountChoice;
  onChange: (v: AccountChoice) => void;
  balance: { blue: number; green: number; yellow: number } | null;
  disabled: boolean;
}) {
  return (
    <div style={fieldStyle}>
      <span style={fieldLabelStyle}>Spend from</span>
      {/* Kept short, but the "preference, not a guarantee" half stays: this is
          the control that decides whose Buzz is debited. */}
      <span style={fieldDescStyle}>A preference — the server picks the final pool.</span>
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
              style={pickerBtnStyle(selected, disabled)}
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

// The pack themes everything via data-theme; the block root only needs layout +
// a themed page background so the iframe surface matches the card.
const shell: React.CSSProperties = {
  minHeight: '100dvh',
  width: '100%',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  padding: 24,
  boxSizing: 'border-box',
  background: 'var(--civitai-color-surface-2)',
  color: 'var(--civitai-color-text)',
};

const cardStyle: React.CSSProperties = { width: '100%', maxWidth: 640 };
const titleStyle: React.CSSProperties = { fontSize: 20 };

// The in-app hero. Every colour is a pack token, so it follows the host between
// light and dark without a second palette to keep in sync — and it is CSS, not
// an image, so it costs no bytes and stays sharp at any block width.
const heroStyle: React.CSSProperties = {
  display: 'grid',
  gap: 2,
  padding: '18px 20px',
  borderRadius: 12,
  background:
    'linear-gradient(135deg, var(--civitai-color-primary) 0%, var(--civitai-color-primary-hover) 55%, var(--civitai-color-surface-2) 100%)',
  color: 'var(--civitai-color-primary-fg, #fff)',
};
const heroTitleStyle: React.CSSProperties = {
  fontSize: 22,
  lineHeight: 1.15,
  letterSpacing: '-0.01em',
};
const heroSubStyle: React.CSSProperties = { fontSize: 13, opacity: 0.85 };

// The format tag overlaid on each candidate. With N formats in one grid, an
// untagged image cannot be traced back to the format that produced it.
const candidateTagStyle: React.CSSProperties = {
  position: 'absolute',
  left: 6,
  bottom: 6,
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  background: 'rgba(0, 0, 0, 0.62)',
  color: '#fff',
  pointerEvents: 'none',
};
const imageStyle: React.CSSProperties = {
  width: '100%',
  aspectRatio: '16 / 9',
  objectFit: 'cover',
  borderRadius: 8,
  display: 'block',
};
const canvasStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 8,
  display: 'block',
  background: 'var(--civitai-color-surface-2)',
};
const sourceThumbStyle: React.CSSProperties = {
  width: 96,
  height: 54,
  objectFit: 'cover',
  borderRadius: 6,
  border: '1px solid var(--civitai-color-border)',
};

// Field chrome — read the same pack CSS vars the pack's own inputs use, so the
// Model + LoRA controls match the Textarea/TextInput surface across themes.
const fieldStyle: React.CSSProperties = { display: 'grid', gap: 4 };
const fieldLabelStyle: React.CSSProperties = { fontSize: 14, fontWeight: 600 };
const fieldDescStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--civitai-color-text-dimmed, var(--civitai-color-text))',
  opacity: 0.8,
};
const currentModelStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--civitai-color-border)',
  background: 'var(--civitai-color-surface)',
  color: 'var(--civitai-color-text)',
  fontSize: 14,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

// The pill chrome (account picker, quantity, presets) reads the same pack CSS
// vars as the Model/LoRA controls so it matches the surface across themes.
const pickerRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginTop: 4,
};
function pickerBtnStyle(selected: boolean, disabled: boolean): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: 999,
    border: '1px solid ' + (selected ? 'var(--civitai-color-primary)' : 'var(--civitai-color-border)'),
    background: selected ? 'var(--civitai-color-primary)' : 'var(--civitai-color-surface)',
    color: selected ? 'var(--civitai-color-primary-fg, #fff)' : 'var(--civitai-color-text)',
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}

// Results gallery: 2-up on any width (thumbnails are wide; 2 columns keep each
// preview readable at the block's usual width).
const galleryStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 10,
};
const galleryItemStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
};

// Color inputs (editor) — native, themed minimally.
const colorLabelStyle: React.CSSProperties = { display: 'grid', gap: 2 };
const colorInputStyle: React.CSSProperties = {
  width: 42,
  height: 28,
  padding: 0,
  border: '1px solid var(--civitai-color-border)',
  borderRadius: 6,
  background: 'none',
  cursor: 'pointer',
};

// The LoRA list + rows read the same pack CSS vars so they match the surface.
const loraListStyle: React.CSSProperties = { marginTop: 4 };
const loraRowStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--civitai-color-border)',
  background: 'var(--civitai-color-surface)',
};
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
