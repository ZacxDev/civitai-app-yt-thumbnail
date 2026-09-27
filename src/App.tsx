import { useCallback, useEffect, useRef, useState } from 'react';

import {
  useBlockBreakpoint,
  useBlockContext,
  useBlockResize,
  useBlockToken,
  useBuzzBalance,
  useBuzzWorkflow,
  useCheckpointPicker,
  useImageUpload,
  useRequestConsent,
  useRequestSignIn,
  useResourcePicker,
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
  THUMB_PROMPT_STYLES,
  accountLabel,
  buildWorkflowBody,
  clampQuantity,
  formatCost,
  hasBudgetedScope,
  imageUrlsFrom,
  isBusyPhase,
  phaseForError,
  phaseForSnapshot,
  spentAccountLabel,
  submitErrorReason,
  isTerminalStatus,
  type AccountChoice,
  type GenPhase,
  type SourceImage,
} from './generation.js';
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
 *    HOST's resource picker (`useCheckpointPicker` / `useResourcePicker`). The
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
  const { open: openCheckpointPicker } = useCheckpointPicker();
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
  const [phase, setPhase] = useState<GenPhase>('idle');
  const [estimatedCost, setEstimatedCost] = useState<number | null>(null);
  const [actualCost, setActualCost] = useState<number | null>(null);
  const [spentAccount, setSpentAccount] = useState<BuzzAccountType | null>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  // Refetch the balance after a successful generation debits it.
  useEffect(() => {
    if (phase === 'succeeded') refetchBalance();
  }, [phase, refetchBalance]);

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

  // Apply a (submit- or poll-returned) snapshot to UI state.
  const applySnapshot = useCallback(
    (snap: BlockWorkflowSnapshot) => {
      setActualCost(snap.cost?.total ?? null);
      const urls = imageUrlsFrom(snap);
      if (urls.length > 0) setImageUrls(urls);
      const next = phaseForSnapshot(snap);
      setPhase(next);
      if (next === 'succeeded') {
        // The pool that PRIMARILY funded the gen (largest debit) — can be blue
        // (free/earned), not necessarily the paid account. Informational only.
        setSpentAccount(snap.spentAccountType ?? null);
      }
      if (next === 'failed' || next === 'insufficient') {
        setError(snap.error ?? 'Generation failed.');
      }
      if (next === 'account-rejected') {
        handleAccountRejected();
      }
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
    (workflowId: string) => {
      if (pollCancelRef.current) pollCancelRef.current.cancelled = true;
      const tok = { cancelled: false };
      pollCancelRef.current = tok;

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
            // error (distinct from a workflow failure) and stop.
            setPhase('failed');
            setError(
              "Couldn't reach the generation service after several retries. " +
                'Your generation may still be running — refresh to check.',
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
        applySnapshot(snap);
        if (isTerminalStatus(snap.status)) return;
        const delay = SCHEDULE_MS[Math.min(attempt, SCHEDULE_MS.length - 1)];
        attempt += 1;
        setTimeout(tick, delay);
      };

      setTimeout(tick, 0);
    },
    [applySnapshot],
  );

  // The estimate->submit->poll sequence, factored out so both the direct click
  // and the post-consent auto-resume can call it.
  const runGeneration = useCallback(async () => {
    setError(null);
    setActualCost(null);
    setSpentAccount(null);
    // The ONLY difference between the two modes is the body: a remix threads the
    // uploaded sourceImage (img2img); generate does not. Everything downstream —
    // estimate/consent/submit/poll — is shared. Auto ('auto') threads NO
    // accountType — the default host funding order.
    const body = buildWorkflowBody(prompt, checkpoint, loras, account, {
      quantity,
      sourceImage: mode === 'remix' ? sourceImage : null,
    });
    const classifyError = phaseForError;

    // 1) Estimate (best-effort — a failed estimate doesn't block submit; the
    //    host re-prices at submit anyway). A disallowed-account / insufficient
    //    estimate DOES short-circuit (submitting would fail-closed).
    setPhase('estimating');
    try {
      const est = await estimate(body);
      if (est.status === 'failed' || est.error) {
        const estPhase = classifyError(est.error);
        if (estPhase === 'account-rejected') {
          setPhase('account-rejected');
          handleAccountRejected();
          return;
        }
        if (estPhase === 'insufficient') {
          setPhase('insufficient');
          setError(est.error ?? 'Not enough Buzz.');
          return;
        }
        setEstimatedCost(null);
      } else {
        setEstimatedCost(est.cost?.total ?? null);
      }
    } catch {
      setEstimatedCost(null);
    }

    // 2) Submit (the real spend).
    setPhase('submitting');
    let snap: BlockWorkflowSnapshot;
    try {
      snap = await submit(body);
    } catch (err) {
      // NOT `err.message` — under blocks-react ^0.44 that is a generic template
      // and the server's reason rides on `.snapshot.error`. See submitErrorReason.
      const msg = submitErrorReason(err);
      const failPhase = classifyError(msg);
      setPhase(failPhase);
      if (failPhase === 'account-rejected') handleAccountRejected();
      else setError(msg);
      return;
    }

    // A host can return an instant terminal snapshot (cached / instant-fail).
    applySnapshot(snap);
    if (isTerminalStatus(snap.status)) return;

    // 3) Poll to terminal.
    setPhase('polling');
    if (snap.workflowId) runPollLoop(snap.workflowId);
  }, [
    mode,
    prompt,
    checkpoint,
    loras,
    account,
    quantity,
    sourceImage,
    estimate,
    submit,
    applySnapshot,
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
    // Lazy consent: if the budgeted scope isn't granted yet, ask the host to
    // open its consent UI and remember the intent. The grant arrives as a
    // TOKEN_REFRESH (granted flips true) -> the effect below auto-resumes.
    if (!granted) {
      consentPendingRef.current = true;
      setPhase('needs-consent');
      requestConsent({ scopes: ['ai:write:budgeted'] });
      return;
    }
    void runGeneration();
  }, [viewer, granted, requestSignIn, requestConsent, runGeneration]);

  // Auto-resume after a consent grant.
  useEffect(() => {
    if (granted && consentPendingRef.current) {
      consentPendingRef.current = false;
      void runGeneration();
    }
  }, [granted, runGeneration]);

  // Switch the generation path. Cancels any in-flight poll and clears the
  // transient error/phase state so a stale failure never shows under the new
  // mode. Results and the remix source are intentionally kept: results belong
  // to the user's session, and a chosen source image is harmless in the other
  // mode (generate never threads it).
  const switchMode = useCallback((next: GenMode) => {
    if (pollCancelRef.current) pollCancelRef.current.cancelled = true;
    consentPendingRef.current = false;
    setMode(next);
    setPhase('idle');
    setError(null);
    setEstimatedCost(null);
    setActualCost(null);
    setSpentAccount(null);
  }, []);

  // --- Host pickers (checkpoint + LoRA + source upload) ---
  //
  // All three open the HOST's native modal via the SDK hooks. The block never
  // sees a catalog or a filesystem, only the chosen resource. Every pick is
  // DISCOVERY ONLY — the server re-validates + re-prices the id at
  // estimate/submit, so threading a pick into the body is money-safe.

  // Open the host's Checkpoint picker, pre-filtered to the current base-model
  // family + pre-highlighting the current pick. On a selection, map it into the
  // checkpoint state. A dismissal (`selected` undefined) leaves the pick as-is.
  const onChangeModel = useCallback(async () => {
    setPickerBusy(true);
    try {
      const { selected } = await openCheckpointPicker({
        baseModelGroup: checkpoint.baseModel,
        currentVersionId: checkpoint.versionId,
      });
      if (selected) setCheckpoint(checkpointFromPick(selected));
    } finally {
      setPickerBusy(false);
    }
  }, [openCheckpointPicker, checkpoint.baseModel, checkpoint.versionId]);

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

  // Append a preset style suffix to the prompt (comma-joined, never duplicated
  // blindly — a click re-appends, the user can edit the text freely after).
  const applyPreset = (suffix: string) => {
    setPrompt((cur) => {
      const base = cur.trim();
      return base ? `${base}, ${suffix}` : suffix;
    });
    setTouched(false);
  };

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
          <strong style={titleStyle}>YT Thumbnail</strong>

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
              <span style={fieldDescStyle}>
                The generation is seeded from this image (img2img). Uploaded through Civitai&apos;s
                private upload bridge — it is scanned server-side at generation time.
              </span>
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

          <Textarea
            label="Prompt"
            description="Describe the thumbnail scene. It is generated at 1280×720 (16:9)."
            placeholder="a serene mountain lake at golden hour, highly detailed"
            value={prompt}
            minRows={4}
            maxLength={PROMPT_MAX}
            required
            error={promptError}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={() => setTouched(true)}
          />

          {/* Prompt presets — thumbnail-tuned style suffixes, one click to append. */}
          <div style={fieldStyle}>
            <span style={fieldLabelStyle}>Style presets</span>
            <div style={pickerRowStyle}>
              {THUMB_PROMPT_STYLES.map((p, i) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p.suffix)}
                  data-testid={`pm-preset-${i}`}
                  style={presetBtnStyle}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Model control. A page carries no host model context, so the app
              starts on DEFAULT_CHECKPOINT and lets the user CHANGE it via the
              HOST's checkpoint picker (useCheckpointPicker) — the block never
              browses a catalog. Every pick is DISCOVERY ONLY: the server
              re-validates + re-prices it at estimate/submit. */}
          <div style={fieldStyle}>
            <span style={fieldLabelStyle}>Model</span>
            <span style={fieldDescStyle}>
              The checkpoint to generate with. The server validates + prices every generation.
            </span>
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
            <span style={fieldLabelStyle}>Candidates</span>
            <span style={fieldDescStyle}>
              How many images to generate per run (1–{QUANTITY_MAX}). Each one costs Buzz.
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
            <AccountPicker value={account} onChange={setAccount} balance={balance} disabled={busy} />
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
              {busy
                ? phaseLabel(phase)
                : estimatedCost != null
                  ? `Generate · ${formatCost(estimatedCost)} Buzz`
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

          {phase === 'failed' && error && (
            <Alert
              color="error"
              title="Generation failed"
              withCloseButton
              onClose={() => setError(null)}
            >
              {error}
            </Alert>
          )}

          {phase === 'succeeded' && imageUrls.length > 0 && (
            <Stack gap={8}>
              <Alert color="success" title="Done" data-testid="pm-spent">
                Spent <strong>{formatCost(actualCost)}</strong> Buzz
                <SpentAccountNote spentAccount={spentAccount} />.
              </Alert>
              <span style={fieldLabelStyle}>
                {imageUrls.length} candidate{imageUrls.length === 1 ? '' : 's'} — pick one to edit
              </span>
              <div style={galleryStyle}>
                {imageUrls.map((url, i) => (
                  <div key={url} style={galleryItemStyle}>
                    <img src={url} alt="Generated result" style={imageStyle} data-testid="pm-result-img" />
                    <Button
                      size="sm"
                      variant="light"
                      onClick={() => setEditing(url)}
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
      <span style={fieldDescStyle}>
        Optional. Layer up to {MAX_LORAS} LoRAs on the checkpoint, each with a weight. The server
        validates compatibility + prices every generation.
      </span>

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
      <span style={fieldDescStyle}>
        Which Buzz account to fund this generation. Auto lets the server choose; a pick is a
        preference the server clamps to what you hold + this app's rating.
      </span>
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

/** " from your Yellow account" — reads the succeeded snapshot's spentAccountType. */
function SpentAccountNote({ spentAccount }: { spentAccount: BuzzAccountType | null }) {
  const label = spentAccountLabel(spentAccount ?? undefined);
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
const presetBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: 999,
  border: '1px solid var(--civitai-color-border)',
  background: 'var(--civitai-color-surface)',
  color: 'var(--civitai-color-text)',
  fontSize: 12,
  cursor: 'pointer',
};

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
