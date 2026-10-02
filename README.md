# YT Thumbnail

A Civitai **page money-path** App (Vite + React + TypeScript), wired to
the published App SDK (`@civitai/blocks-react` + `@civitai/app-sdk`). It mounts
as a full-page (W10) app at `/apps/run/yt-thumbnail` and spends Buzz to generate
YouTube thumbnails at 1280×720: pick a checkpoint, optionally layer on a few
LoRAs (each with a weight), choose 1–4 candidates → a **live** estimate → (lazy
consent) → submit → poll → one results/history surface → text-overlay editor →
download.

## What this is

A sandboxed static web app served in an iframe by the Civitai host. Its UI is
built from the **`@civitai/blocks-react/ui`** W6 component pack (Button, Textarea,
TextInput, Slider, Card, Stack, Group, Alert, Badge). The model + LoRA pickers
are the HOST's own — the app never browses a catalog; it calls the SDK's
`useCheckpointPicker` / `useResourcePicker` hooks and the host opens its native
resource modal. The remix source image comes from the host's
`useImageUpload({ purpose: 'generationSource' })` bridge the same way. The pack
ships its own theme-aware styles; `injectBlocksStyles()` is called at module init
in `src/App.tsx` so the first paint is already styled.

The platform
owns the build: it runs `npm ci` then the `buildCommand` from
`block.manifest.json` (`npm run build`), serving the static output from
`outputDir` (`dist/`). You do NOT commit `dist/` — the platform builds it.

**Commit your lockfile.** The platform installs *strictly* from it — `npm ci`,
with no registry re-resolve fallback — so builds are byte-reproducible. Without
a committed `package-lock.json` the build hard-fails. If you prefer pnpm or
yarn, set `"buildCommand"` to that package manager (plus the `"outputDir"` the
manifest schema requires alongside it) and commit *that* lockfile instead:
`"pnpm run build"` needs `pnpm-lock.yaml`, `"yarn run build"` needs `yarn.lock`.
A lockfile that disagrees with `buildCommand` is the most common build failure
there is — `civitai app validate` catches it before you submit.

The money path uses the SDK hooks — never raw `window.parent.postMessage`:

- `useBuzzWorkflow()` — `estimate` / `submit` / `poll` (the spend).
- `useBuzzBalance()` — the viewer's per-pool balance (`{ blue, green, yellow }`),
  read host-side via the `GET_BUZZ_BALANCE` bridge — **no `buzz:read:self` scope
  needed** (the host resolves the viewer from the block token). Use it to *reason*
  about spend (which account can fund this?), **not** to re-display the balance —
  the Civitai chrome around your app already shows it.
- `useCheckpointPicker()` / `useResourcePicker()` — open the HOST's native
  resource picker for the checkpoint + LoRAs (the app never browses a catalog).
- `useRequestConsent()` — lazy, on first Generate: `ai:write:budgeted` is
  consent-gated, so the token mints WITHOUT it; the grant arrives as a
  `TOKEN_REFRESH` and the app auto-resumes the click.
- `useBlockResize()` — the SDK reports height to the host safely.
- `useBlockBreakpoint()` — the width tier of your block's own box, for layout
  decisions. See below.

Page constraints: a page is `entity=none` — it carries no HOST model context (a
model slot would deliver `modelId`/`modelVersionId` via `BLOCK_INIT`; a page does
not). So this app ships its OWN initial model choice — a curated default
checkpoint (`DEFAULT_CHECKPOINT` in `src/models.ts`, so Generate works at first
paint) — and lets the user CHANGE it via the host picker. The viewer's Buzz
balance is read in-block via `useBuzzBalance()` (host-mediated, no scope) — an
insufficient-Buzz `failed` snapshot is still handled as a backstop. The budget
comes from `page.buzzBudgetPerGen` in the manifest.

### Width-adaptive layout (`useBlockBreakpoint`)

Your app renders inside whatever slot the host gave it, and **slot width is not
monotonic in viewport width** — the `model.sidebar_top` slot is about 360px next
to a 360px phone and only about 430px next to a 1440px desktop. So the useful
question is "how wide am **I**?", not "how wide is the browser window?".

`useBlockBreakpoint()` answers that. It observes your element with a
`ResizeObserver` (a container query, effectively) and returns the width **tier**:

```ts
const bp = useBlockBreakpoint(rootRef); // or no ref → the sandbox document
bp.tier;            // 'base' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
bp.below('sm');     // true when narrower than 768px
bp.atLeast('md');   // true at 1024px and up
bp.measured;        // false until the first measurement lands
```

The scale is **CSS pixels**: `xs 480 · sm 768 · md 1024 · lg 1184 · xl 1440`.
That is Civitai's own scale, and it is deliberately **not** Mantine's stock `em`
scale (576 / 768 / 992 / 1200 / 1408) — the two agree on `sm` and nowhere else,
so a check that only ever exercises 768 tells you nothing about the rest.

It re-renders you on a **tier change only**, never per pixel, so branching on it
is cheap. `src/App.tsx` uses it for exactly one decision — the Model row is a
`Group` when there is room and a `Stack` when there is not — and
`src/responsive.test.tsx` drives that at two widths. Keep the rest of your layout
in fluid CSS; reach for the hook when you need a genuinely **different element
tree**, not a different size.

> 🔴 **`--civitai-bp-*` cannot be used in a query condition.** The tokens exist,
> and putting one in the condition of a media or container query is the first
> thing most people try — but a query's condition is evaluated before custom
> properties are substituted, so the rule never matches. Nothing errors, nothing
> warns, the build stays green, and your layout is silently stuck on one branch.
> In CSS, write the pixel number out. In JS, use this hook.

Full guide: <https://developer.civitai.com/apps/responsive>

### Model picker (host-served, server-revalidated)

The **Change model** button calls `useCheckpointPicker().open({ baseModelGroup,
currentVersionId })`. The HOST opens its own native checkpoint picker (in
`dev:live` the SDK live host serves a protocol-identical in-harness catalog
overlay; on the real platform it's civitai's own modal); the app never sees a
catalog, a list, or any resource the user didn't pick. The picker resolves with a
`BlockCheckpointInfo`, which `checkpointFromPick` (`src/models.ts`) maps into the
selected checkpoint.

A pick is **discovery only**. Nothing about a client-chosen checkpoint is trusted:
the server **re-validates** (public? generation-covered? SFW for the domain?) and
**re-prices** the body at every `estimate` AND `submit`. A client can POST any id
regardless of what the picker showed — `buildWorkflowBody` is not the enforcement
boundary; the spend path is.

### LoRA selector (host-served — and INVISIBLE on the default model)

🔴 **Read this first: the field is not on screen for a viewer who has not changed
the model.** `DEFAULT_CHECKPOINT.baseModel` is `'OpenAI'` and `'OpenAI'` is in
`LORA_FREE_BASE_MODELS`, so on first load **every** viewer sees no LoRA control at
all; it appears only once they pick a checkpoint from a family that has LoRAs. That
is a deliberate operator decision, reaffirmed after being shown exactly this
consequence — not an oversight, and not something to "fix". Everything below
describes what the control does **once it is visible**.

Once visible, the user can layer up to **5 LoRAs** on top of the checkpoint, each
with an adjustable **weight** (the LoRA's `strength`, clamped to the server's
`[-1, 2]` bound). **Add LoRA** calls `useResourcePicker().open({ resourceType:
'LORA', baseModelGroup })`, the host opens its LoRA picker, and the pick
(`BlockResourceInfo`) is appended via `loraFromPick` + `addLora`. LoRAs ride along
as `additionalResources` in the workflow body — one `{ modelVersionId, strength }`
entry per selected LoRA, emitted only when at least one is selected (a
checkpoint-only body stays backward compatible). `src/models.ts` holds the pure
selection helpers (`addLora` / `removeLora` / `setLoraWeight`) that enforce the
dedup, the 5-LoRA cap (`MAX_LORAS`) and the weight clamp, plus the pick→option
mappers.

LoRA picks + weights are **discovery only**, exactly like the checkpoint: the
server is LoRA-only for additional resources and **re-validates** base-model
compatibility + per-resource entitlement (early-access / Private) AND
**re-prices** the whole body **before any Buzz spend**.

🔴 **Hiding the field is only safe because the selection is CLEARED with it.**
Changing the checkpoint used to leave `loras` untouched, so an SDXL LoRA stayed
selected under an OpenAI checkpoint, rode into `additionalResources`, and the server
rejected the generation with nothing on screen naming the cause. Visible-but-stale is
survivable; invisible-and-stale is not — so a clear always comes with a note saying
what was removed. `lorasForCheckpoint` is the **one** rule and has three callers: the
model-change handler (so the viewer is told), the form snapshot every body is built
from (so no body can carry an impossible resource), and the price signature (so the
preview re-prices on exactly the changes that can reach the wire). The clear lives in
the **click handler**, not in an effect keyed on `checkpoint`: a resume restores a
checkpoint AND its LoRAs together, and an effect would fire on that restore and wipe
what it had just put back.

### Generation modes: Generate (txt2img) and Remix (img2img)

A **mode toggle** at the top switches between two paths that share the one
estimate → consent → submit → poll driver, the checkpoint/LoRA picks, and the
account picker — only the body differs:

- **Generate** — text-to-image at 1280×720 (16:9). The body always carries
  `params: { width: 1280, height: 720 }` (YouTube's recommended thumbnail size;
  the server enforces 64–2048 per side), a `quantity` when > 1, and any LoRAs.
- **Remix** — img2img. The user picks a photo through the HOST's
  `useImageUpload({ purpose: 'generationSource' })` bridge, and the body threads
  `sourceImage: { url, width, height }`. Two page-app-only rules apply, both
  server-enforced: the `url` must be **Civitai-hosted** (the upload bridge
  guarantees this; an arbitrary remote URL is rejected — SSRF guard), and
  `sourceImage` is rejected fail-closed on a model-slot token (this app is a
  page app, so it may send it). The SINGULAR `sourceImage` field is used on
  purpose: it works on every host; the plural `sourceImages` needs a newer host
  and would be byte-identical for one image anyway.

The body is built by `buildWorkflowBody` in `src/generation.ts` — the single
place the generate/remix difference lives, unit-tested for both shapes
(`params.quantity` is emitted only when > 1, `sourceImage` only when set).

### Formats (multi-select — and each one is a separate generation)

**Formats** replace the old style-preset chips. A format is a named prompt
suffix plus its preview art, and formats are **multi-selected** rather than
clicked to paste text into the prompt box.

🔴 **N selected formats ⇒ N workflows, hence N bills.** A workflow body carries
exactly one `params.prompt`, so two formats mean two different prompts and
cannot share a request. They compose with quantity: 3 formats × quantity 2 = 3
workflows of 2 images = **6 images**. `page.buzzBudgetPerGen` is enforced *per
workflow*, so N formats authorise N budgets, not one. The Generate button shows
the **summed** estimate.

Three tiers:

- **Built-in** — twelve, defined canonically in `public/formats/formats.json`
  (which also records each preview's `sourceWorkflowId`) and mirrored as
  `BUILTIN_FORMATS` in `src/formats.ts`. A test pins the two in lockstep, and a
  second pins the exact ledger of twelve ids so the set cannot grow *or* shrink
  unnoticed. **All twelve carry generated preview art** (two batches: six on
  SD XL 1.0 at 3 Buzz, six on ChatGPT Images at 209 — provenance in
  `claudedocs/format-previews.md`), pinned as a hand-written SET of ids rather
  than a count, because a count cannot tell *"we added art for `magic`"* from
  *"we lost the art for `gaming`"*. `Format.preview` stays optional, and the
  picker's letter-placeholder branch stays live code: every **custom** and
  **published** format has no art, so that branch is the one they take. The
  provenance triple — `preview`, `sourceWorkflowId`, `costBuzz` — travels together
  or not at all, and the `sourceWorkflowId` is checked **by shape** with
  `costBuzz > 0` required, because co-presence alone let a fabricated id through.
- **Custom** — the viewer's own, **private by default**, persisted per-viewer
  via `useAppStorage` under `formats:custom:v1`. Anonymous viewers get no
  persistence at all (`get` resolves `null`, `set` rejects) and are told so
  rather than handed an editor that silently eats their work.
- **Published** — a custom format the viewer explicitly pushed to the app-wide
  `useSharedStorage` board, where others can browse, use, up-vote and report it.

🔴 **A published format's suffix travels in `body`, never in `data`.**
`title`/`body` are the *moderated*, user-visible text; `data` is *unmoderated*
app state. The suffix is prompt text that gets injected into other viewers'
**paid** generations in a `contentRating: "g"` app, so it has to pass the content
belt. `sharedValueForFormat` is the one place that decision lives, and reading a
published format back deliberately has **no** `data` fallback — an entry whose
text is only in `data` is dropped.

Selection carries an invariant: **at least one format is always selected**, so
Generate can never submit zero workflows and report success having spent
nothing.

🔴 **A suffix may not contain `#`, and that is checked on SAVE — never on LOAD.**
The generator consumes `#name` **server-side** as a wildcard reference, so it never
reaches the model: measured, a suffix containing `#FF49BD` came back with
`targets.prompt[0].category = "FF49BD"` — the `#` and the word after it lifted
straight out of the paid prompt, with nothing erroring. A format's suffix is
appended to *every* prompt made with that format, so one `#` corrupts every
generation it will ever produce, and **publishing** such a format carries that into
other viewers' paid generations. `suffixWildcardReason` is the single place the rule
lives; it is reached from `validateCustomFormat` (save) and from the publish
handler, and the built-in literals are checked by the same predicate as a
byproduct. It is deliberately **not** applied in `parseCustomFormats`: a viewer who
stored a `#` suffix before the rule existed keeps their format and is told why on
the next save or publish, rather than watching it disappear from their own picker.

### Images per format (quantity 1–4)

A **dropdown** (the pack's `Select`, over `QUANTITY_MIN..QUANTITY_MAX`) requests
1–4 images *per format*, per run, and shares one wrapping line with the Buzz
picker. It threads `params.quantity` (clamped by `clampQuantity` on the way in
*and* out, then again server-side to [1, 4]); the estimate reflects the multiplied
cost before any spend.

> The pack's `Select` wraps a **native `<select>`** and therefore cannot render
> icons — fine for the digits 1–4, and the reason the Buzz picker beside it is
> still a custom listbox.

Each returned image is listed under its **batch**, which names every format that
produced it. There is deliberately **no VISIBLE per-image format tag**: the old
candidate grid had one, but in the unified list an image belongs to a batch, and the
batch already names its formats once.

The attribution itself is not dropped, though — it is just not a chip. Each image's
**filename** and **alt text** carry its own format, from `HistoryEntry.imageLabels`,
which the join builds by pairing `workflowIds[i]` with `form.formats[i]` *before*
dropping workflows the live page does not carry. Getting this from the render site
instead is what made a 2-format batch save its Cinematic picture as
`yt-thumbnail-clickbait-3.jpg`.

One caveat, stated rather than ranked: **records written before this change cannot be
labelled reliably at all.** The earlier writer recorded `workflowIds` in *completion*
order and `form.formats` as the formats that survived *estimation*, so an old row can
pair a multi-format batch the wrong way round (whichever format replied first takes the
first format's name) and can also carry more formats than ids (one submit failure shifts
every later label by one). Nothing in such a row says which format each id came from, so
this is not repairable — only stated. It is **not** a claim that those rows are labelled
better or worse than they were before: over a random reply order the two are a wash, and
on a 2-format row whose second format replied first the new pairing mislabels both while
the old one — which named every image after `formats[0]` — happened to get the first
format's images right. Those rows age out with the orchestrator's images.

### Partial failure

With N workflows, some can fail while others succeed — the normal case, not an
edge. A failed format does not discard its siblings' results, and the realized cost is
summed **from what the server actually reported**, never from the estimate (which would
cover workflows that never ran).

That figure used to live in a "Spent X Buzz" alert (`pm-spent`) beside the Generate
button; it is now the history row's own cost cell, where `joinHistory` applies the
identical rule to the identical server figures (only finite `AppWorkflow.cost` values
are summed; nothing reported ⇒ `—`). `aggregateSpend` and `runCandidates` were deleted
with the alert rather than left as a second, uncalled answer to one money question.

### The live cost estimate (priced before anything is at stake)

The price is on the Generate button **on mount** and again whenever anything
price-relevant changes — checkpoint, LoRAs (including a LoRA's *weight*), quantity,
selected formats. Before this the price only existed *after* a Generate click had
already committed the viewer to spending: "estimate first, then submit" was true of
the code and invisible to the user.

🔴 **It is gated on the `ai:write:budgeted` scope, and it must not prompt for it.**
`estimate()` itself 403s with *"block lacks ai:write:budgeted scope"* on an
unconsented token (measured against the live backend 2026-09-28). Asking for consent
on page *load* so a price can be shown is exactly what this app refuses to do — the
scope authorises **spending**, and a permission dialog before the viewer has typed
anything is how a page-money app gets declined. An unconsented viewer therefore keeps
the old behaviour: no price until their first Generate, which is where the consent
round trip already lives.

The preview is **debounced**, **out-of-order safe** (a monotonic sequence number, which
is not the debounce — it discards a slow earlier response the `clearTimeout` cannot
reach), **never stale** (an input change drops the old figure immediately) and **never
blocking** (a thrown or failed estimate leaves the run priceless, not terminal). Each
has a test asserting a call **count** or **order** rather than a rendered number, since
every defect this feature can have is invisible on screen. *Why* each property is
load-bearing is on the effect itself in `src/App.tsx` — it is not restated here, because
a second copy of a money rule is a second thing to get out of date.

`estimateSignature` (`src/generation.ts`) is the **one** definition of
"price-relevant". The prompt is deliberately **out** — it does not price a generation
(the CLI's own dry-run says the prompt is not even sent with the estimate) and
including it would fire a request per keystroke to learn nothing. The Buzz account is
out too: it decides *whose* Buzz is debited, not *how much*.

The Generate button and the Buzz picker read **one expression** (`estimatedCost`),
sourced from the in-flight run's `runs` while a click is still being **placed** and from
the preview otherwise — so changing an input after a finished run, *or during a poll*,
re-prices the button instead of leaving the last run's bill on it.

### The form stays live while a generation runs

🔴 **Only the window in which a click is still being PLACED is locked.** The gate is
`isSubmittingPhase` — `estimating | submitting` — not the old `isBusyPhase`, which also
covered `polling` and therefore froze the mode toggle, the format controls, the composed-
prompt boxes, the quantity dropdown, the Buzz picker **and** Generate for the entire
30–90s a generation takes. That bought no safety: `runGeneration` builds every wire body
from **one** `formSnapshot` closure taken at click time, and the history record is written
from that same closure, so nothing the form does afterwards can reach a workflow that has
already been submitted. `overallPhase` ranks `submitting` above `polling`, so a
multi-format batch does not re-open the form until every one of its workflows is placed.

🔴 **And that gate is only shut if nothing else can re-open it.** `yt-history-resume`
("Reuse settings") is never disabled and clears the run table, which dropped
`overallPhase` to `idle` and re-enabled Generate while the first batch's `submit()` was
still open — a measured double submit, both batches charged. `onResume` now **refuses**
while `isSubmittingPhase` holds, reading the same predicate the button does, and says so
in the history note. It stays live through `polling`, which is the window the operator
deliberately left clickable.

🔴 **What makes a SECOND batch safe is not that gate — it is the batch-token split.** The
old single `{ cancelled }` token answered two different questions with "stop", which was
only correct because the form was dead through `polling` and so neither was reachable.
They are now separate:

| question | mechanism | who sets it |
|---|---|---|
| is this the **current** batch — may it still submit, and does `runs` belong to it? | the token's `cancelled`, and `currentBatchRef.current === tok` | `switchMode` and `onResume` cancel (neither has spent anything yet); every new `runGeneration` takes ownership |
| is the component mounted? | `unmountedRef` | the mount effect, which **resets it on setup as well as setting it in cleanup** — without the reset it latches under `<StrictMode>`, which is what `main.tsx` mounts |

A separate `batchAbortRef` used to hold the token for the first question. It was assigned
the same token on the same two lines and its only two readers nulled `currentBatchRef` on
the very next line, so the pair could never disagree about anything observable; it is
deleted rather than kept as a second name for one fact.

A **superseded** batch therefore keeps polling and keeps folding its snapshots into
`ownWorkflows` (keyed by workflowId, monotonic, collision-free), so its own history row
still fills in with the pictures and the price the viewer **already paid for** — while
only the current batch may write `runs`, which is keyed by *formatId* and which two
batches can both hold. Starting a second batch used to set `cancelled` on the first: an
invisible data-loss bug before, because a second Generate was impossible.

### One results + history surface

🔴 **There used to be two, and that was a defect, not a layout choice.** A
"candidates" grid built from the in-flight `runs`, and a collapsed History panel
built from storage × the live queue, showing the same images from two sources.
`initRuns` resets `runs` on every Generate, so **starting a second run blanked the
first run's images** — output the viewer had already paid for, gone from the page with
no way back until a reload.

The fix is structural rather than a longer-lived `runs`: the batch record is inserted
into the history list **as soon as workflow ids exist** (before the storage round
trip), so an in-flight batch *is* the newest history row and fills in from skeleton to
pictures where it stands. A running batch renders `skeletonCount` tiles (`formats ×
quantity` minus what has landed), and the editor entry point ("Add text") moved onto the
row with the images — as an **icon button** carrying its wording in `title` +
`aria-label`, because the UI pack ships no `Tooltip` and no icon set, so those two
attributes are the only hover affordance and the only accessible name an icon-only
control has. `src/history.ts` and `src/History.tsx` carry the reasoning for each rule; it
is **not** restated here.

🔴 **The row layout REVERSED, and the old rule was a real compounding bug.** This
paragraph used to say "rows are a responsive grid on the same `layoutForTier` column
count the images use". They were — and because `History.tsx` applied that count at BOTH
levels (a grid of batch rows, and a grid of images inside each row) the counts
**multiplied**: 3 × 3 at `lg` made every thumbnail a ninth of the main column, and 4 × 4
on an ultrawide block made it a sixteenth — about an 85px-wide 16:9 tile on a 1920px
screen. Each level was individually correct, which is why a per-tier assertion could not
see it. Now: rows are **full width at every tier**, and the thumbnail grid is
**intrinsically sized** — `repeat(auto-fill, minmax(min(IMAGE_MIN_PX, 100%), 1fr))`, the
same shape the format grid already used — so there is no tier arithmetic left to get
wrong, including at a tier the SDK adds above `xl` later. `layout.resultColumns` is gone
with it: nothing laid out from a column count any more. The skeleton grid shares the
**same** helper call, so a landing picture cannot reflow its own row.

🔴 **The `min(…, 100%)` on that floor is the narrow-tier fix, and the sentence it
replaces was wrong in the useful direction.** This paragraph used to claim "no width at
which a tile can be narrower than the floor" — which is exactly the bug: a bare
`minmax(300px, 1fr)` is a HARD lower bound, so `auto-fill` drops to one column and then
stops, and a container narrower than 300px gets a 300px track plus a horizontal
overflow. Content width here is blockWidth − 68 (two 24px shell insets, two 10px panel
insets), so a 360px phone has ~292px and the suite's own 361px base fixture has 293px.
Clamping the floor to the container is the standard spelling. **Not visually verified:**
jsdom lays nothing out, so the tests assert the style string and no test has seen the
grid render inside 293px.

🔴 **The per-row status badge is gone, in ALL states, by an explicit product decision —
and it has a cost worth knowing.** A FAILED batch now looks much like a succeeded one at
a glance. What distinguishes them: the cost cell renders `—` for a batch that never
reported a realized price, the `yt-history-unavailable` line names a batch whose images
aged out, and the `pm-partial` alert beside Generate still names each format that failed
and why. `batchStatusLabel`/`batchStatusColor` were deleted with the badge;
`batchStatus` itself stays, because it decides skeletons and the unavailable line.

🔴 **The realized cost carries its funding pool, and the `pm-spent` alert is gone.**
The row shows the server's number, a bolt tinted by the Buzz pool that primarily funded
the batch (`BUZZ_TYPE_COLOR` — the same component the Buzz picker uses), and a
screen-reader sentence spelling out "N Buzz from your &lt;pool&gt; balance" so the number is
never read bare. The pool cannot be known at write time — the record is written the
moment workflow ids exist, while `spentAccountType` arrives on a succeeded snapshot — and
`AppWorkflow` carries no funding field at all, so it is **patched onto the record**
afterwards (`spendPatches`). That is what makes removing the alert an information MOVE
rather than a loss: the alert lived in `runs` and died on the next click, the record
survives a reload. A record written before the field existed renders a **neutral** bolt,
never a guessed pool.

Three consequences of making this the results surface are worth stating once, because
each of them was a bug first:

- **It is OPEN whenever there are rows**, not only after a submit. Generated images
  live here now, so a collapsed panel hides output the viewer paid for — on a returning
  visit as much as after a Generate. An explicit Hide is still honoured.
- 🔴 **No storage state may REPLACE a row.** `anon` / `denied` / `error` and a reload
  in flight are all banners **over** the rows — the reload one is
  `yt-history-reloading`, added because narrowing the early return alone left a reload
  over an existing list with no indication at all. The record is written at submit time, so
  a rejected write is the *common* way to reach those states while paid-for images are
  on screen; an early return there deletes the pictures and reports a storage problem
  as though the generation had produced nothing. The whole block hides in exactly one
  state — ready, empty and noteless (`showHistory`).
- 🔴 **A row that EXISTS survives a reload** (`mergeUnsavedRecords`, called inside a
  functional `setHistoryRecords`). A record whose write failed exists in memory only,
  and a reload used to replace the list with what storage holds — so the "Try again"
  button the error state offers *deleted* the run it was meant to recover. A reload is
  now a merge: over the unsaved map **and** over the list as it stands when the read
  resolves, because a batch saved *while* the read was in flight is in neither the
  listing (taken earlier) nor the unsaved map (its write succeeded). The reload also
  retries the writes that failed, and the state it lands on is gated on whether any of
  them is still unsaved — a `set()` that keeps rejecting must not withdraw the banner
  and the retry button while the record is still only in memory.

### What the platform does with `params.width`/`height`

🔴 **It ignores them.** Measured 2026-09-28: 1280×720 and 1344×768 requests, on
SD XL 1.0 and on FLUX.1 [dev], all returned **1216×832**. The app therefore does
not claim a generation size anywhere in its copy. What *is* true is the export —
the canvas editor cover-crops to exactly 1280×720 on download.

> **`page.buzzBudgetPerGen` is a CEILING — not an estimate.** It is the safety
> ceiling on what a SINGLE generation may cost, so a bug or a compromised bundle
> can't drain the viewer's Buzz. The server re-prices every submit and charges
> the REAL price, so a generous ceiling never costs anyone more — but a submit
> priced ABOVE the budget is rejected outright (`insufficient buzz budget`):
> nothing charged, nothing delivered, and it stays broken for every user until
> you ship a new manifest version. **Raise it; don't lower it.** Pick several
> times your worst case (the server clamps at 1000 anyway); cumulative spend is
> separately capped per viewer per day. The scaffold ships **300**.

### The editor (`src/editor.ts`) — text overlay + export

Clicking **Edit & download** on a gallery image opens a canvas editor:

- The image is **cover-fit** into a 1280×720 canvas (`coverCrop` — a centered
  crop, no letterboxing; handles any source aspect).
- The title text is drawn `Impact`-first (`THUMB_FONT_STACK`), multi-line
  (greedy word wrap with hard-break for over-long words), stroke-then-fill per
  line, with size / position / outline width / colors all live-adjustable.
- **Download** re-encodes the canvas as JPEG through a quality ladder
  (`exportLadder`, 0.92 → 0.30) until the blob fits **YouTube's 2 MB cap**
  (`YT_MAX_BYTES`); the note under the button reports the saved size + quality,
  and says so honestly if even the smallest quality stayed over cap.

One honest caveat: the editor needs the generated image to load
**CORS-anonymously** (`loadImageElement` sets `crossOrigin='anonymous'`), or the
canvas would be tainted and `toBlob()` impossible. If the image host refuses
that, the load FAILS (it never silently taints) and the editor degrades to an
alert with a plain link to the image. Whether civitai's image CDN sends the
CORS headers must be verified against the live host — the mock harness uses
data/placeholder URLs where it works regardless.

### Buzz balance + account picker (per-account spend)

🔴 **Don't render a Buzz balance readout in your app.** Your app runs inside the
Civitai chrome, which **already shows the viewer's balance** — a second copy
inside the iframe is redundant, and it competes with the real one whenever the
two are momentarily out of sync. This scaffold deliberately ships **no** balance
panel; if you're tempted to add one, that's the signal you want a *host* surface,
not an app surface.

The app still *reads* the balance via `useBuzzBalance()` — for exactly one
purpose: annotating **which account can actually fund this generation** in the
picker below. That's app-specific context the chrome can't provide, so it earns
its place. It's additive: if the balance is loading, errored, or unavailable the
annotation just doesn't render and generation is **never blocked**.

Beside the images-per-format dropdown, a picker **labelled "Buzz"** lets the viewer
choose which pool funds the generation. Its *accessible* name is longer on purpose —
`aria-label="Spend from <account>, <cost>"` — because a screen-reader user gets no
layout to tell them this dropdown decides which wallet pays, so shortening the
accessible name to the visible word would remove the only thing that said so.

The pools:

- **Auto** (the default) — omits `accountType` from the workflow body entirely.
  This is the pre-existing behavior byte-for-byte: the host drains its default
  domain-allowed order.
- **Blue / Green / Yellow** — threads that pool as `body.accountType`, a
  *preference*. The server clamps it to what you actually hold + the app's
  content-rating domain (preferred-first, then falls back). A pool with a 0
  balance is annotated but stays selectable (the server falls back).

A pick the app's content-rating domain forbids is rejected server-side
(`BAD_REQUEST`, `"buzz account '<type>' is not spendable for this app's content
rating"`); the app catches that, shows a friendly "switched back to Auto" note,
and resets the picker to Auto so the retry just works.

After a successful generation, the success note reports **which pool primarily
funded it** — read from `snapshot.spentAccountType` (the account with the LARGEST
debit). Note this can be **blue** even when you paid: a gen covered mostly by
free/earned Buzz reports `blue`. It's informational only.

`accountType` / `spentAccountType` / `useBuzzBalance` require
`@civitai/app-sdk@^0.39.0` + `@civitai/blocks-react@^0.49.0` (already pinned in
`package.json`).

## Develop

```bash
npm install
npm run dev:harness   # http://localhost:5186 — mounts a MOCK host so you see something
```

`npm run dev` alone shows a blank screen — there's no host to send `BLOCK_INIT`.
Use `dev:harness`.

`npm run dev:harness` mounts the published SDK mock host
(`@civitai/blocks-react/testing`) — no hand-rolled simulator to maintain. A loud
**🧪 MOCK HOST · no real Buzz spent** banner is always on screen so you never
mistake it for the real thing.

### Mock vs live

There are two harness modes, selected by `VITE_HARNESS_MODE` (the npm scripts
set it for you):

| Script | Mode | What it does |
|---|---|---|
| `npm run dev:harness` | **mock** (default) | The SDK mock host. Synthetic — **no real Buzz, no compute, no network.** Safe to spam. |
| `npm run dev:live` | **live** | The SDK **live host** (`createLiveHost`) — forwards the protocol to the **real Civitai backend** with a real dev token. **Spends REAL Buzz / real compute.** |

**How `dev:live` reaches the backend.** `dev:live` mounts `createLiveHost` from
`@civitai/blocks-react/testing`, which forwards the App postMessage
protocol to the real backend using a pasted dev token (Bearer). The live host's
backend calls go through the **vite dev proxy** (`server.proxy['/api']` in
`vite.config.ts`), NOT straight to `civitai.com`: `createLiveHost` is configured
with an empty `backendBaseUrl`, so it fetches `/api/...` SAME-ORIGIN against the
dev server (`localhost:5186`), and vite proxies that server-side to civitai with
the `Origin` header rewritten to an allowlisted host. That's load-bearing — a
direct cross-origin fetch from `localhost` would (1) be blocked by CORS preflight
and (2) be rejected by civitai's tRPC origin gate ("Please use the public API
instead"). The same-origin proxy + Origin rewrite fixes both. Override the proxy
target with `VITE_LIVE_HOST_ORIGIN` (default `https://civitai.com`).

**Live mode setup.**

> ⚠️ **`dev:live` works WITHOUT submitting first.** The dev-token mint
> (`POST /api/v1/blocks/dev-token`) accepts a brand-new slug with **no app row
> yet** — it mints from the `scopes` in your local `block.manifest.json` (clamped
> server-side), so `create → dev-token → dev:live` works directly. (A pending
> slug after `civitai app submit` is accepted too.) You do **not** need to submit
> or wait for approval to dev:live-test — submit when you're ready to publish.
> For **real generation** you must mint with a credential carrying the **AI
> Services** scopes: a **full-scope personal API key**, or an OAuth login that
> opted in via **`civitai login --scopes generate`**. A **default** `civitai
> login` token mints read-only (`user:read:self`) and **cannot spend**. Use
> `civitai buzz` / `civitai whoami` to confirm your credential can spend. With no `VITE_LIVE_BLOCK_TOKEN` `dev:live` fails safe (renders a notice,
> never spends), and `dev:harness` (the mock host) needs no token at all.

To use it:

1. Mint a short-lived dev block token (a ~4-hour RS256 JWT; re-mint + restart
   when it expires). The friendly path is the CLI — it calls the invite-gated
   mint route with your stored credential and writes a paste-ready line:
   ```bash
   civitai app dev-token yt-thumbnail --env >> .env.development.local
   ```
   (drop `--env >> …` to just print the token). **Auth — the credential you mint
   with decides what the dev token can do:**
   - The mint needs a credential carrying the **Apps submit** scope.
   - **Real generation (spends real Buzz) needs the AI Services scopes.** Two
     routes: run **`civitai login --scopes generate`** (a browser login that
     additively opts into generation), or create a **full-scope personal API
     key** at `https://civitai.com/user/account` (a personal key carries every
     scope, including AI Services) and store it with `civitai login --token
     <key>`. Either way `civitai app dev-token` then mints a spendable token —
     a **default** `civitai login` (no `--scopes`) cannot spend. Or pass a
     personal key as the Bearer to the raw route directly:
     ```bash
     curl -s -X POST https://civitai.com/api/v1/blocks/dev-token \
       -H "Authorization: Bearer $CIVITAI_TOKEN" \
       -H 'Content-Type: application/json' \
       -d '{"slug":"yt-thumbnail","scopes":["ai:write:budgeted"]}'   # → { token, expiresAt, scopes, buzzBudget }
     ```
   - **A DEFAULT `civitai login` mints a read/identity-only dev token for this
     app.** The default device-login scope set carries Apps submit but NOT AI
     Services (by design — a plain login shouldn't grant general Buzz spend). A
     page-money app's manifest declares only `ai:write:budgeted`, and the server
     strips that budgeted-spend scope from a token minted by a bearer without AI
     Services, so what's left is **read/identity only**: `dev:live` shows your
     **viewer** plus catalog/storage, but **estimate → submit → real generation
     does NOT work**. Fix it by re-running **`civitai login --scopes generate`**
     (the login is re-runnable and additive — you keep submit + dev-tunnel), or
     by using the full-scope **personal API key** above.
2. If you printed the token instead of using `--env >> …`, paste it into
   `.env.development.local` as `VITE_LIVE_BLOCK_TOKEN=<token>`. Keep the secret in
   `.env.development.local` (git-ignored), NOT the committed `.env.development`.
   (Never commit it. `submit` excludes every `.env`-prefixed file but
   `.env.example`, `.env.sample` and `.env.production` — and those three it
   UPLOADS, so keep the token out of them too. See "Validate & submit".)
3. `npm run dev:live` — a minimal **host nav** sits at the top (your profile name,
   Buzz balance, and a persistent **LIVE · spends real Buzz** pill); a successful
   Generate spends your own real Buzz.

### The dev:live host nav + your Buzz balance (the credential split)

On the real platform the nav above the app is civitai's OWN chrome (outside the
iframe). In `dev:live` the harness IS the host, so it renders a minimal
equivalent: your **profile name**, your **Buzz balance**, and the LIVE safety
pill. Both reads go same-origin through the vite dev proxy.

The two reads use **different credentials** — by design, and security-critical:

- **Profile name** — `/api/v1/blocks/me`, authed with the page-scoped
  **block token** (`VITE_LIVE_BLOCK_TOKEN`). Faithful to prod: a page app can
  read its own viewer.
- **Buzz balance** — `/api/trpc/buzz.getBuzzAccount`. The page block token can't
  read Buzz (no `buzz:read:self`), so the balance needs a buzz-read credential:
  your **personal key**. There is **no public REST Buzz endpoint**; the balance
  lives behind this tRPC procedure.

  > 💡 From a terminal, don't hand-roll that tRPC call — run **`civitai buzz`**
  > (it reads the same route with your stored personal key). Use
  > **`civitai buzz --json`** before and after a `dev:live` generation to diff
  > the spend, e.g.:
  > ```bash
  > civitai buzz --json > before.json   # { "blue":…, "green":…, "yellow":…, "total":… }
  > # …run a dev:live generation…
  > civitai buzz --json > after.json     # compare total to confirm the debit
  > ```
  > (An OAuth `civitai login` token can't read balance — `civitai buzz` will tell
  > you to switch to a personal key; confirm your credential with `civitai whoami`.)

  > 🔐 The personal key is set as **`CIVITAI_HOST_KEY`** (note: **NO `VITE_`
  > prefix**) in the git-ignored **`.env.development.local`**. Vite reads it
  > **server-side** and the dev proxy injects it as the `Authorization` header on
  > the balance route **only** — it is **NEVER bundled into client JS** (Vite only
  > exposes `VITE_*` to the client). Client code never references the key; it just
  > fetches the same-origin route. If `CIVITAI_HOST_KEY` is unset the nav
  > gracefully shows your name only (no balance, no error). Dev-only — never
  > commit it.

  ```bash
  # In .env.development.local (git-ignored), NOT committed:
  echo 'CIVITAI_HOST_KEY=<your-personal-api-key>' >> .env.development.local
  ```

> ⚠️ With no `VITE_LIVE_BLOCK_TOKEN`, `dev:live` **fails safe**: it renders a
> notice telling you to mint a token, and never silently spends.
>
> **Live v1 scope:** `createLiveHost` supports the money path
> (`estimate`/`submit`/`poll`/`cancel`) AND the resource pickers — it serves a
> protocol-identical in-harness picker overlay, so `useCheckpointPicker` /
> `useResourcePicker` work in `dev:live`. It does **not** support
> `SET_USER_CHECKPOINT` persistence, the App-Storage KV protocol, in-band Buzz
> purchase, or the `GET_BUZZ_BALANCE` read (`useBuzzBalance`) — those reply "not
> supported in live v1" (use mock mode for them). So in `dev:live` the balance
> reads as unavailable and the "Buzz" account picker simply drops its 0-Buzz
> annotations — nothing else changes, and the host nav's own balance total (read
> via your personal key through the proxy) still works. The balance resolves in
> **`dev:harness`** (synthetic, wired to the `balance` scenario) and on the **real
> platform** (the civitai host answers `GET_BUZZ_BALANCE` natively).

### Scenarios (exercise the money / error / storage UX for free)

The mock host is configurable, so you can test the full spend / failure /
insufficient-Buzz UX without spending anything. Drive it two ways:

- **On-screen scenario panel** (top-left, collapsed): buttons + inputs to flip
  *force insufficient Buzz*, *fail next generation*, *50% failure rate*, a
  simulated *balance*, and *latency* live — no reload.
- **URL query params** (read once on load):

  | Param | Effect |
  |---|---|
  | `?viewer=anon` | anonymous viewer (sign-in CTA) |
  | `?consent=granted` | start with the budgeted scope granted |
  | `?theme=light` | light theme (default dark) |
  | `?balance=0` | simulate a Buzz balance — a gen over it returns insufficient-Buzz, AND the 3-pool balance panel shows the split (mostly yellow + a little blue) |
  | `?fail=insufficient` | force every submit down the insufficient path |
  | `?latency=2000` | 2s synthetic gen latency (`?latency=500-2000` for a range) |
  | `?costPerGen=12` | cost reported per generation |
  | `?failNext=1` | fail the next N submits (generic gen error) |
  | `?failRate=0.5` | probabilistic submit failures |

  e.g. `http://localhost:5186/?balance=0&fail=insufficient` to land straight in
  the insufficient-Buzz / top-up flow.

These map to the `createMockHost` scenario options
(`generation` / `buzz` / `storage`) from `@civitai/blocks-react`.

```bash
npm test              # all tests (vitest run), two suites:
                      #   node : pure-logic units    (src/*.test.ts)
                      #   dom  : component + e2e      (src/*.test.tsx, jsdom)
npm run build         # what the platform produces (tsc typecheck + vite build)
```

### Tests

`npm test` runs both vitest projects in one go (split in `vite.config.ts`):

- **`src/generation.test.ts`** — pure-logic units (node env): cost formatting,
  the scope check, the error sniffs + phase classification, and the workflow
  body builder (16:9 params, quantity clamp, `sourceImage` for remix, LoRA
  entries, the Buzz pool).
- **`src/editor.test.ts`** — the editor cores against recording fakes (no real
  canvas needed): `coverCrop` geometry, `wrapLines`, `clampOverlay`,
  `drawThumbnail` (what was drawn, in which order, with which numbers), the
  export quality ladder, and the file-name helper.
- **`src/models.test.ts`** — the default checkpoint + the pick→option helpers
  (`checkpointFromPick` / `loraFromPick` from the SDK's `BlockCheckpointInfo` /
  `BlockResourceInfo`, with missing-field tolerance), the LoRA selection
  helpers (`addLora`/`removeLora`/`setLoraWeight`, the dedup + 5-LoRA cap + the
  weight clamp), and `lorasForCheckpoint` — the one rule that drops LoRAs a
  base-model family cannot use, in both arms.
- **`src/nav.test.ts`** — the dev:live host nav's pure logic: the balance-response
  parser (`parseBuzzBalance`: tRPC envelope / bare / malformed / empty → safe),
  the viewer-name parser, and `navDisplay` (name present, balance present/absent).
- **`src/App.test.tsx`** — component tests: render `<App/>` against the mock host
  and assert the UI (anon → sign-in, signed-in → prompt + the Change model / Add
  LoRA picker buttons, the Auto-default account picker with balance
  annotations, and the graceful balance-error state).
- **`src/e2e.test.tsx`** — the money-path proof: drives the FULL
  estimate → consent → submit → poll → succeeded flow through the REAL SDK
  transport against the mock host (no hook mocking) — plus: Auto omits
  `accountType`, a pick threads it, `spentAccountType` renders, a disallowed
  pool resets to Auto, the quantity dropdown threads `params.quantity`, Remix mode
  threads the uploaded `sourceImage`, and a gallery image opens/closes the
  editor view. This is what tells you the spend wiring still works after you
  edit the app.
- **`src/mock-buzz.ts`** — dev/test-only glue (NOT shipped in prod). The SDK
  mock host natively answers the balance read + stamps `spentAccountType`; this
  wrapper only adds the two behaviours it doesn't model — a balance-read ERROR
  and the domain-clamp rejection rewrite.
- **`src/App.pollretry.test.tsx`** — poll-loop robustness: a transient poll
  error (a transport blip, e.g. a not-yet-rolled-out pod) is retried, not turned
  into a terminal failure, while a genuine `failed` status stays terminal. Keep
  this if you customize `runPollLoop`.
- **`src/App.estimate.test.tsx`** — the live cost preview. Every case asserts a call
  **count** or a call **order**, because the defects here are invisible on screen: an
  estimate per keystroke looks identical to one per change, and a stale response
  overwriting a newer one shows a *wrong* number rather than a missing one. Covers
  firing on mount and on each price-relevant change; **not** firing without the
  budgeted scope and **not** asking for consent (with a positive control in the same
  case, because a reassuring zero is indistinguishable from a harness wired to
  nothing); not firing on a prompt change; the debounce; two hand-deferred in-flight
  requests where the stale one must be discarded; the stale-price window; and that
  the Generate button and the Buzz picker are one number — pinned as the
  *relationship* at two different values, not as two literals.
- **`src/App.historyvis.test.tsx`** — when the history surface exists at all (hides
  only in ready+empty; still renders for anon / denied / error / live-error) and what
  a still-running batch looks like (`formats × quantity` skeleton tiles; images and
  skeletons together on a partly-delivered batch).

> 🔴 **The preview races any suite whose token carries `ai:write:budgeted`.** Such a
> suite prices the form on mount and on every price-relevant change, so a test that
> clicks Generate before the debounce fires counts N estimates and one a few
> milliseconds slower counts N+1. `App.formats.test.tsx`'s `settlePreview()` waits for
> the price to *appear* and then zeroes the counter, which pins the boundary instead
> of hoping for it. A suite that does not care about pricing should mint a token with
> **no** budgeted scope (as `App.historyvis.test.tsx` does) so no estimate traffic
> exists at all.

## Allowed parent origins

The SDK drops any inbound message whose origin isn't allowlisted and refuses to
mount with an empty list. Set `VITE_BLOCK_ALLOWED_PARENT_ORIGINS` per environment
(`.env.development` for the harness, `.env.production` for the civitai.com host).
See `.env.example`.

## Validate & submit

```bash
civitai app validate
civitai login        # once, to store your API token
civitai app submit
```

`submit` packages the SOURCE tree (manifest + src + build config), excluding
`.git`, `node_modules`, and `dist` — the platform rebuilds from source. It also
excludes build artifacts (`*.zip`) and, as a **catch-all**, every file whose base
name starts with `.env` — dotted or not, so `.env.development`,
`.env.development.local`, `.env.staging` and `.envrc` all stay out. That is what
keeps a `VITE_LIVE_BLOCK_TOKEN` you pasted into `.env.development.local` from
being uploaded.

Three names are **allow-listed and ARE uploaded**: `.env.example`, `.env.sample`
and `.env.production` (the production build reads the last one).

> 🔴 **The allow-list is by FILE NAME — nothing reads what is inside.** Whatever
> you put in those three is packaged and uploaded verbatim, to the platform and
> to a human moderator reviewer. That includes a `VITE_`-prefixed value (Vite
> inlines those into the client bundle, so they are public the moment your app
> loads) *and* a plain unprefixed one (Vite leaves that out of the bundle, but
> the CLI still ships the file). Put nothing in them you would not paste into a
> public page — a real `VITE_LIVE_BLOCK_TOKEN` belongs in the git-ignored
> `.env.development.local`, which the catch-all above excludes.

## Store-listing media (`assets/`)

Your store listing **cannot publish without an icon and a cover**, and both are
settable while the app is in review. `assets/` is scaffolded for them and ships
with no images on purpose — see [`assets/README.md`](assets/README.md) for the
size, format and aspect requirements, then:

```bash
civitai app listing set-icon  ./assets/icon.png
civitai app listing set-cover ./assets/cover.png
civitai app listing status
```

## Submission lifecycle

After `civitai app submit`, your publish request is `pending` review — a
Civitai-side **moderator** approves (or rejects) it. **This is not self-service
today**; you cannot approve your own app. Track it with `civitai app status`.

- **`dev:live` works before you submit** — the dev-token mint accepts a brand-new
  slug with no app row yet (minting from your local manifest scopes) as well as a
  pending slug, so you can real-spend-test before submit/approval. Real generation
  needs the **AI Services** scopes — `civitai login --scopes generate`, or a
  **full-scope personal API key** (a **default** `civitai login` token mints
  read-only and can't spend); confirm with
  `civitai buzz` / `civitai whoami`. See the live-mode prerequisite above.
- Need to change the bundle while a request is still `pending`? **Withdraw your
  own pending submission** and resubmit a different one:

  ```bash
  civitai app withdraw <pubreq-id>   # the pubreq id from `civitai app status`
  ```

  Only a `pending` request can be withdrawn (an already-approved/rejected one
  cannot). Withdrawing is idempotent and frees the slug so a fresh
  `civitai app submit` can take its place.
