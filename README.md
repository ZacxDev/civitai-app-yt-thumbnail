# YT Thumbnail

A Civitai **page money-path** App (Vite + React + TypeScript), wired to
the published App SDK (`@civitai/blocks-react` + `@civitai/app-sdk`). It mounts
as a full-page (W10) app at `/apps/run/yt-thumbnail` and spends Buzz to generate
YouTube thumbnails at 1280×720: pick a checkpoint, optionally layer on a few
LoRAs (each with a weight), choose 1–4 candidates → estimate → (lazy consent)
→ submit → poll → gallery → text-overlay editor → download.

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

### LoRA selector (host-served, server-revalidated)

On top of the checkpoint the user can layer up to **5 LoRAs**, each with an
adjustable **weight** (the LoRA's `strength`, clamped to the server's `[-1, 2]`
bound). The **Add LoRA** button calls `useResourcePicker().open({ resourceType:
'LORA', baseModelGroup })`, the host opens its LoRA picker, and the pick
(`BlockResourceInfo`) is appended via `loraFromPick` + `addLora`. LoRAs ride along
as `additionalResources` in the workflow body — one `{ modelVersionId, strength }`
entry per selected LoRA, emitted only when at least one is selected (a
checkpoint-only body stays backward compatible).

- **`src/models.ts`** — the LoRA types + the pure selection helpers (`addLora` /
  `removeLora` / `setLoraWeight`) that enforce the dedup, the 5-LoRA cap
  (`MAX_LORAS`), and the weight clamp, plus the pick→option mappers.

LoRA picks + weights are **discovery only**, exactly like the checkpoint: the
server is LoRA-only for additional resources and **re-validates** base-model
compatibility + per-resource entitlement (early-access / Private) AND
**re-prices** the whole body **before any Buzz spend**.

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

**Style presets** under the prompt append a thumbnail-tuned suffix
(`THUMB_PROMPT_STYLES` in `src/generation.ts`) — clickbait, cinematic, bold &
simple. They are prompt text only; nothing else about them is special.

### Candidates (quantity 1–4)

The **Candidates** picker requests 1–4 images per generation. It threads
`params.quantity` (clamped server-side to [1, 4]); the estimate reflects the
multiplied cost before any spend, and every returned image lands in the gallery.

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

Below the LoRA selector, a **"Spend from"** picker lets the viewer choose which
pool funds the generation:

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
> reads as unavailable and the "Spend from" picker simply drops its 0-Buzz
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
  `BlockResourceInfo`, with missing-field tolerance), AND the LoRA selection
  helpers (`addLora`/`removeLora`/`setLoraWeight`, the dedup + 5-LoRA cap + the
  weight clamp).
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
  pool resets to Auto, a quantity pill threads `params.quantity`, Remix mode
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
