# Brief: formats, storage, multi-workflow money path, and a design pass

Single source of truth for this batch. **Read it whole before writing code.**
Written 2026-09-28 by the session that shipped 0.1.0–0.1.2.

## Where things stand

- Repo is now PUBLIC: `git@github.com:ZacxDev/civitai-app-yt-thumbnail.git`, `main` tracks `origin/main`. Every submitted source commit is on the remote.
- **0.1.2 is PENDING moderator review** (`pubreq_01M3K1PRF8Y0KXCT5RA6ZHDJWW`, source `cb6f661`). 0.1.1 is approved + live and keeps serving during review.
- 188/188 tests across 14 files; tsc clean; `civitai app validate` rc=0.
- 🔴 **Do not submit anything from this batch without being told to.** 0.1.2 is in flight; a second pending submit is the operator's call, not yours.

## The four decisions (already made — do not relitigate)

1. **One submit per format.** 3 formats × quantity 2 = **3 workflows of 2 images = 6 images**. Formats carry different prompt suffixes, so they genuinely cannot share one request.
2. **Persistence via `useAppStorage`**, not localStorage (it is impossible here — see Hard constraints). Costs `apps:storage:read` + `apps:storage:write`.
3. **Publishable formats ARE in this batch.** Adds `apps:storage:shared:read` + `apps:storage:shared:write`. Four new scopes total.
4. **Per-format previews are bundled static art**, ~6 built-in formats. Custom formats get a neutral placeholder.

## 🔴 Hard constraints — each was MEASURED this session, not assumed

- **localStorage cannot work.** `iframe.sandbox` is `allow-scripts allow-forms`, and it cannot be widened: adding `allow-same-origin` fails validate with *"not allowed for unverified blocks (trustTier is server-forced to unverified at submit; only allow-scripts and allow-forms are permitted)"*. Opaque origin ⇒ `localStorage` throws. **Any design that reaches for it is wrong.**
- **`useAppStorage` returns `null` / rejects for ANONYMOUS viewers.** Anonymous users get NO persistence. Do not build UI that silently appears broken for them — degrade explicitly.
- **Storage limits:** 64KB per value, 50MB per app, ~1M rows. `list()` is cursor-paginated. Surface `limitBytes` from the quota API rather than hard-coding 50MB.
- **A newly declared scope is consent-gated.** Adding the four scopes does not grant them: they are dropped from the token until the viewer consents, so you get a 403 while manifest and runtime both look correct. Plan the consent UX; do not treat a 403 as a bug.
- **`useSharedStorage` has a moderation split and you MUST use it correctly:** `title`/`body` are **moderated, user-visible text**; `data` is **UNMODERATED** app state. 🔴 **The published format's prompt suffix goes in `body`, never `data`.** A published format injects its author's text into other viewers' PAID generations in a `contentRating: "g"` app — `data` routes that around moderation entirely. It also has `report()`, votes, `viewerVoted`, and never leaks withdrawn/moderated rows.
- **Server caps quantity at 1–4 PER request** (`QUANTITY_MIN`/`QUANTITY_MAX`), and manifest `page.buzzBudgetPerGen: 300` applies **per workflow**, not per click. N formats = N budgets.
- **Consent currently precedes estimate.** `App.tsx` gates `if (!granted) { requestConsent(); return; }` before `runGeneration`, so estimate has NEVER run unconsented. Whether it CAN is **UNKNOWN** — see Probe below.
- **`useBlockTheme` only REPORTS host light/dark.** It is not a theming API. A custom theme is your own layer and must work in BOTH modes; `index.html` is deliberately dark-first (read its comments before touching it).
- **`estimate()` REJECTS on an unusable price** by design (civitai/civitai#4159) — a failed estimate is not a quote you may spend against. Keep every caller's try/catch.

## Probe to run FIRST, before designing the cost-in-button

Mint a token and find out whether `estimate()` works without the budgeted scope:

```bash
civitai app dev-token yt-thumbnail --spend --budget 250 --env > .env.development.local   # `>` not `>>` — dotenv is FIRST-wins
npm run dev:live
```

- If estimate works **unscoped** → show live cost in the Generate button immediately, no consent prompt until they actually generate. Preferred.
- If it **403s** → do NOT force a consent prompt on page load just to price a button. Show the button without a price, request consent on first Generate as today, and show the price from then on. Say which branch you measured.

## Workstreams

Land them in this order; each is independently reviewable.

### 1. Manifest + scopes
Add the four storage scopes with honest `scopeJustifications`. Do NOT bump the version — the operator decides when to submit. `src/manifest.test.ts` already guards version lockstep, tagline ≤140, description ≤2000 and the category enum; extend it to assert the scope set and that every scope has a justification (validate does NOT check that).

### 2. Formats model (replaces presets)
- Rename `THUMB_PROMPT_STYLES` → formats throughout. ~6 built-ins, each `{ id, label, suffix, preview }`.
- **Multi-select**, at least one always selected.
- Custom formats: create / edit / delete, **private by default**, stored via `useAppStorage`.
- Publish: writes to `useSharedStorage` with the suffix in `body`. Browse published formats, vote, report.
- Keep the pure logic in `models.ts`/`generation.ts` style — pure, total, tested — and out of the component.

### 3. Multi-workflow money path
- N selected formats ⇒ N estimates and N submits, each with that format's suffix.
- Poll N workflows; merge results into one candidate grid, each tagged with its format.
- Aggregate cost = sum of the N estimates; show the TOTAL in the Generate button.
- 🔴 Partial failure is the interesting case: one workflow failing must not discard the others' results, and must not misreport spend. Test it explicitly.

### 4. Buzz account default
Default to the **first sufficient** balance in order **blue → green → yellow**, falling back to Auto when none is sufficient or the cost is unknown. Today the default is Auto (threads no `accountType`). Note an explicit pick is a *preference* the server clamps and may reject on content-rating grounds — the app already handles that rejection by resetting to Auto; keep it working.

### 5. Design pass
- In-app banner/hero image (NOT the store cover — that already ships in `assets/`).
- Custom theme: simple, delightful, intuitive. Must work in host light AND dark.
- **Strip copy to the minimum** — but 🔴 KEEP cost and consent disclosure. This is a money app; "Each one costs Buzz" and the estimate/confirm affordance stay. Cut the server-revalidation explanations and field descriptions.
- Preview art: ~6 bundled 16:9 images, optimized (WebP), watch the bundle (currently 334 kB JS).

## Test coverage — the standard this repo already holds

Non-negotiable, because this repo has been bitten by each of these:

- **Watch every new guard FAIL before you trust it.** Report a red-at-base matrix per test: which ref, which assertion, what message. A test that only ever passed proves nothing.
- **Label honestly.** If a test would pass on pre-change code it is an INVARIANT or BEHAVIOUR guard, not regression coverage. `src/picker.test.tsx` and `src/manifest.test.ts` both carry such labels — follow that format.
- 🔴 **The wholesale `vi.mock('@civitai/blocks-react')` trap.** Every hook `App` imports must be listed or vitest fails on a missing export — which looks exactly like an assertion failure. This session produced three reds that proved nothing that way. When you red-at-base, mock the OLD code's hooks too, so the failure is your assertion and not a missing export.
- **The mock host does not enforce filters.** It answered a checkpoint pick regardless of `baseModelGroup`, which is why 185 tests passed while the picker was broken in production. Assert at the **hook boundary** (the options object you pass) for anything the mock won't police.
- New areas needing real coverage: storage round-trip incl. the anonymous-viewer path; quota/size rejection; multi-workflow partial failure; cost aggregation; the blue→green→yellow selection ladder incl. "none sufficient"; shared-format publish putting the suffix in `body`.

## Gotchas that cost time here

- **zsh does not word-split unquoted vars** — `T="--a --b"; cmd $T` passes ONE argument. Write flags out.
- `civitai app submit` non-interactive REQUIRES `--yes`; `validate` is manifest-shape only and accepts any unknown top-level key at rc=0, `--strict` included.
- `description` is absent from the published schema yet DOES land (verified after 0.1.1 approved) — do not "fix" it by deleting the field.
- Never `git stash` in this repo. Copy files aside and restore by copying back.
- bash-guard blocks `pkill -f`; kill background vite by recorded PID.
- The credential warning on `src/setup-dev-live.test.ts:25` is a FALSE POSITIVE (`tok123`/`key456` fixtures).

## Definition of done

`npx tsc --noEmit` clean · full suite green with counts reported before/after · `npm run build` ok · `civitai app validate .` rc=0 · `npm run dev:harness` smoke · a red-at-base matrix for every new guard · **no submit**.
