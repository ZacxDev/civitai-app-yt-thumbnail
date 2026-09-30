# Handoff: yt-thumbnail — 2026-09-27

## Run this first — the index, one command
```bash
cairn recall --repo /home/zach/workspace/civit/civitai-app-yt-thumbnail
```
Currently REFUSES: scope `civitai-app-yt-thumbnail` is not in
`~/.config/subsystem-store/routes.json` yet (nothing recorded for this repo).
Ordinary for a brand-new repo — register the scope or ignore until content exists.

## Goal
Ship **YT Thumbnail** — a Civitai page-money app that generates YouTube thumbnails: txt2img + img2img remix + multi-format generation + a canvas text-overlay editor with a YouTube-capped export.
- **closing-condition: check** — this is **ARC 3 (ship the taste pass)**, opened 2026-09-30 by the operator's direction to decide PR #8 and submit 0.1.4. It is MET when **0.1.4 is approved and live** AND the served bundle at `https://yt-thumbnail.civit.ai/` references `hero-banner` ≥1 alongside a known-present positive control, AND `curl -sSI https://yt-thumbnail.civit.ai/hero-banner.jpg` returns `200` with `content-type: image/jpeg`. Exact commands in *How to verify*. **NOT YET MET** — the hero-wire PR is unmerged and the manifest still reads `0.1.3`.
- **Arc 2 was MET 2026-09-29 and RE-VERIFIED green 2026-09-30** (listing `approved` with no moderator-review line; `doctor` → `✓ No problems`; live bundle `assets/index-BrzuzOdM.js` greps `yt-storage-anon` **1** with controls `yt-format-card` **1** / `pm-editor-canvas` **1** and negative control `pm-comfy-beta` **0**). Its line was: *listing status no longer under moderator review AND doctor reports no problems AND the live bundle greps `yt-storage-anon` ≥1 alongside a positive control.* **FROZEN — that arc is CLOSED**; kept as history.
- **Arc 1 ("ship it") was MET 2026-09-27** — `app_state.py yt-thumbnail` rc=0 and `https://yt-thumbnail.civit.ai/` returned 200. Frozen, kept as history.

## State now
- **No clawgate task.** `clawgate_handoff.sh resolve` exited **5** (NOTHING RESOLVED). An unknown session id also answers 200/empty, so this is **not** a clean bill of health — it cannot distinguish "touched no task" from "wrong id". No `clawgate-task:` field written, deliberately.
- **`main` is `b11523a`**, clean, ↑0↓0. Claim held: `yt-thumbnail-1` (`claim-work --release yt-thumbnail-1` when this item is done).
- 🔴 **THE TASTE PASS IS STILL NOT SHIPPED.** `block.manifest.json` reads **`0.1.3`** and the live app is **0.1.3**. Everything PR #7 and PR #8 landed is true of `main` and NOT of what a viewer sees. This has now been the blocking fact for two sessions.
- **PR #8 MERGED** — squash **`b11523a`**, verified by CONTENT not ancestry: `assets/hero/hero-candidate-2.jpg` exists on `origin/main` and `taste.json` carries seed `1418897043`. Both candidates were LOOKED AT, not taken on description — candidate 2 is the stronger render; candidate 1 has a stray cyan sliver artifact bottom-left.
- **Operator decision 2026-09-30, recorded:** the fork was *merge #8 and ship the taste pass alone* vs *merge #8 AND wire the hero into 0.1.4*. The operator chose **wire it into 0.1.4**, with the stated risk (an image nobody has seen render, in the same moderated release as the un-browser-verified layout) acknowledged.
- **Hero asset prepared and pushed** — `a74c0a9` on branch **`taste/hero-wire`** (worktree `/home/zach/workspace/civit/civitai-app-yt-thumbnail-hero`, based on `b11523a`). `public/hero-banner.jpg`, **1216×380, 29,607 B**: candidate 2 **mirrored horizontally**, cropped to the vertical centre, stripped, q82.
- 🔴 **IN FLIGHT — an implementation agent is wiring the hero into `src/App.tsx` on `taste/hero-wire`.** Its result is NOT in this doc. If you are resuming, read the branch and any PR against `main` before assuming the work is unstarted: `git -C <repo> log --oneline origin/taste/hero-wire` and `gh pr list --state open`.
- **Baseline re-run this session, not accepted from a report:** `npx tsc -p tsconfig.json --noEmit` rc 0; `npm test` → **548 passed / 22 files** in 18.4s.
- **The 4 live store screenshots are STALE** — they show the old 640px column. They cannot be re-shot until the redesign is live and through moderator review. There is still **no `app-capture` recipe for this slug**.
- **`cairn recall` still REFUSES** — `civitai-app-yt-thumbnail` is absent from `~/.config/subsystem-store/routes.json`. Fourth session blocked. Nothing is recorded for this repo, which is silence, not a clean bill of health.
- **Buzz spent this session: 0.** The 16 Buzz for the hero pair was the PREVIOUS session (workflow `8753561-20260930060406237-dxhg`, seed `1418897043`).
- **CARRIED FORWARD — end-to-end money path exercised in production** (2026-09-28). Still the ONLY live proof of it, and it predates the taste pass: two formats selected → two workflows, two separately-labelled candidates, **6 Buzz debited from Blue**, button read `Generate · 6 Buzz`, editor opened a 1280×720 canvas with no error. 🔴 Measured on **0.1.3**, which is still what is live — neither the taste pass nor the hero has been exercised against the money path in production at all.

## Version history (server-confirmed, never from a CLI exit code)
| ver | pubreq | source | state |
|---|---|---|---|
| 0.1.0 | `pubreq_01M3JE62KDFVK17V8FWA95SEQF` | `17def4f` | approved, superseded |
| 0.1.1 | `pubreq_01M3JZB7TRZ6TMD1MX7H4M33VZ` | `c5e175d` | **approved + live** (listing copy) |
| 0.1.2 | `pubreq_01M3K1PRF8Y0KXCT5RA6ZHDJWW` | `cb6f661` | **approved + live** (checkpoint-picker fix) |
| 0.1.3 | `pubreq_01M3MY1W7XECTKKE8GTNGKEKJZ` | `b66ddaf` | **pending** (formats, storage, publishing, N-workflow) |

**Remote now EXISTS** (this was rank-1 for two sessions): `git@github.com:ZacxDev/civitai-app-yt-thumbnail.git`, PUBLIC, `main` tracks `origin/main`. Every submitted source commit is on it. Before publishing, every blob in every commit was scanned — JWT / Civitai-key / AWS+GitHub-token patterns all 0, with `tok123` hitting 9 blobs as the positive control, so those zeros are measurements rather than a dead grep.

0.1.2 live is confirmed by artifact, not just by status: served bundle moved to `assets/index-CfiTDCZc.js`, with `pm-editor-canvas` and `pm-change-model` at **1** and the not-yet-shipped `pm-format-row` at **0** — a pair, never a bare zero.

## 0.1.3 — what is in review
SUPERSEDED — 0.1.3 is **approved, live and verified** (see *State now*). Nothing is in review for the APP. The only thing pending is the **listing-media revision** `alpr_01M3N183249CTB062W288KMM5S`.

## RESOLVED — `description` is absent from the schema but DOES land
0.1.1 shipped `tagline`/`description`/`category` with an explicit unknown: `description` is in NO version of the published manifest schema (`v1.json` is the only one served; `v2`/`v1.1`/`latest` all 404), and the schema permits unknown keys, so `civitai app validate` returned rc=0 either way and proved nothing. **After 0.1.1 approved, `civitai app doctor` reports none of `empty-tagline` / `empty-description` / `empty-category`.** All three landed. The published schema is incomplete; the CLI's insistence was correct. Only `no-screenshots` remains (optional).

## Defect found + fixed this session — the checkpoint picker was SELF-TRAPPING
- **Reported:** the "Change model" picker listed only SDXL — no Z Image, no OpenAI, no Flux — while `ab-img-poster` listed everything.
- **Cause:** `App.tsx` passed `baseModelGroup: checkpoint.baseModel`, and `baseModelGroup` *"NARROWS the browse, never widens it"* (`blocks-react` `internal/catalog.d.ts`). `DEFAULT_CHECKPOINT` is SDXL 1.0, so the filter was derived from the very thing the control exists to change. 🔴 **Not merely restrictive — unreachable:** widening it required already holding a checkpoint from the family you were trying to reach, so no other ecosystem was reachable by ANY sequence of user actions. `ab-img-poster` passes no filter, hence unaffected.
- **Fix (`ea40598`):** `useResourcePicker({ resourceType: 'Checkpoint' })` with `baseModelGroup` OMITTED — documented as "an unconstrained pick of the type". Deliberately NOT `useCheckpointPicker` with `baseModelGroup: ''`: that field is required there, and `''` is only documented in the dev shim's `filterCardsByFamily`, unverified against prod. Cost: the picker no longer pre-highlights the current model (that option belongs to the dropped hook).
- **The LoRA picker KEEPS its family filter** on purpose — a LoRA really must match. Pinned by a test so an over-broad "drop every baseModelGroup" edit fails loudly.
- **Deliberately NOT built:** a client-side warning for a cross-family LoRA left over after an ecosystem switch (newly reachable). The server validates compatibility and rejects before any spend, and `submitErrorReason` surfaces its wording verbatim; a fuzzy client check would duplicate a server rule and misfire where the server is right (`SDXL 1.0` vs `SDXL Turbo` — one ecosystem, two strings).

## 🔴 OPEN PRODUCT DECISION — the platform ignores requested dimensions
Measured 2026-09-28 against the live backend. `params.width`/`params.height` are **inert**: every generation returned **1216×832** (aspect 1.46) whatever was asked — 1280×720 and 1344×768, on SD XL 1.0 **and** on FLUX.1 [dev]. Two ecosystems, three requests, one answer, so this is not SDXL bucketing.

The downloaded file is still a true 1280×720 because the editor cover-crops — but ~18% of the model's composition is trimmed away unseen, which for a *thumbnail* app means framing the model chose is silently discarded. The app's UI copy was corrected in 0.1.3 to describe the **exported** file; the underlying framing loss is untouched and needs a call: correct the copy further, show the crop so users can reframe, or find whether any host parameter actually controls output size.

⚠ Scope: `blocks.submitWorkflow`, txt2img only. NOT tested on img2img (`sourceImage` has a source aspect to honour) or `quantity > 1`.

Cost data from the same run: SD XL 1.0 = **3 Buzz** per image, FLUX.1 [dev] = **33** — an 11× spread. Total spent generating previews + probes: **57 Buzz** across 9 workflows.

## RESOLVED — CORS on generated images; the canvas editor export works
Generated images serve from `orchestration-new.civitai.com`, which **reflects any Origin**. The decisive case is `Origin: null`, because the block's sandbox has no `allow-same-origin` and its origin is therefore opaque — and both hops of the redirect carry the header (a chain fails CORS if any single hop omits it):
```
Origin: null → 301 access-control-allow-origin: null
             → 200 access-control-allow-origin: null   content-type: image/jpeg
```
No taint, `toBlob` works. **Do not add defensive workarounds for this.**

## Open investigations — live diagnosis state
### 🔴 The app's scope is UNCONSENTED on this account — a generation would 403
**UPDATE 2026-09-27:** the operator consented and ran a generation, which is how the picker defect above surfaced. The banner finding below is retained as the *pre-consent* state; the open half is unchanged — whether a NEW user gets a clean consent prompt is still untested.
- as-of: 2026-09-27 (first live browser observation of the deployed app)
- **Symptom + exact repro:** at `https://civitai.com/apps/run/yt-thumbnail`, logged in as `zachlowdenzx` (8753561), the HOST renders a banner: *"YT Thumbnail is missing permissions it needs to work fully."* with a `Review permissions` **button** (a button, no href). This is AGENTS.md's consent gate: `ai:write:budgeted` is declared in the manifest, but a declared scope is dropped from the token until the user consents, so a submit 403s while manifest and runtime both look correct.
- **Observed (with values):** app booted fine — `pm-generate` present, `pm-signin` absent, model `SD XL 1.0 (SDXL 1.0)`. Present: `pm-generate pm-model-label pm-model-row pm-change-model pm-lora-add pm-remix-upload pm-remix-hint`. Absent: every `pm-nav-*`/`pm-setup-*` (those are `src/main.tsx` harness-only, confirmed by the declaring file, not just by absence).
- **Ruled out:** a broken deploy, and a bad slug/suspension — the block booted and answered reads; `via: browser`.
- 🔴 **NOT established:** whether a NEW user gets a clean consent prompt. This is one account's state, not a claim about the app being broken for everyone — do not report it as an outage. Consenting is an **account action** and was deliberately NOT clicked.
- **Next probe:** click `Review permissions`, consent, then re-read the banner and run one generation; or check the host's consent record server-side.
### CORS on generated image URLs — canvas editor export unverified live
- as-of: 2026-09-27
- **Symptom + exact repro:** the editor loads a returned `imageUrls` entry via `loadImageElement` (`crossOrigin='anonymous'`, src/editor.ts) and exports via `canvas.toBlob`. If civitai's image CDN refuses CORS on the generated-image host, the load FAILS (by design — never silent taint) and the editor degrades to an alert + plain link. Question: does the live CDN send `Access-Control-Allow-Origin` for generated images?
- **Observed (with values):** mock harness returns placeholder URLs that answer nothing about the real CDN (mock host canned source: `https://image.civitai.com/mock/original=true/dev-generation-source.jpeg`, display: `.../dev-upload.jpeg`). App behavior in the failure branch is tested (e2e: editor entry/exit; unit: `loadImageElement` rejects on error).
- **Ruled out:** silent canvas taint as the failure mode — `loadImageElement` fails the LOAD loudly instead; `via: code`.
- **Leading hypothesis:** civitai's image CDN serves CORS for public asset URLs (unverified).
- **Next probe:** after one dev:live generation: `curl -sSI -H 'Origin: https://civitai.com' '<returned imageUrl>' | grep -i access-control` (or watch the editor's network tab in dev:live).
### Dev-token budget 250 vs multi-candidate pricing
- as-of: 2026-09-27
- **Symptom + exact repro:** a `--spend` dev token with no `--budget` gets a flat **50** (unsubmitted slug; manifest `page.buzzBudgetPerGen: 300` does NOT apply pre-approval). A quantity-3/4 gen at 1280×720 on a pricier checkpoint may price above 250 → submit rejected `insufficient buzz budget`.
- **Observed (with values):** minted payload `buzzBudget: 250` (the max, `--budget 1-250`); manifest 300; balance 4.07M Buzz. CLI help states the 50-default and the 1–250 bound verbatim.
- **Ruled out:** not a code bug — documented mint-route constraint; resolved server-side at approval. `via: doc` + `via: command` (JWT payload decode).
- **Leading hypothesis:** quantity 1–2 fits 250; quantity 4 on some checkpoints won't.
- **Next probe:** dev:live, quantity 4 → read the estimate response's `cost.total`; if rejected, note the price and cap the picker hint or wait for approval (real budget applies then).

### The four storage scopes have never been granted — publish/persist is UNEXERCISED in production
- as-of: 2026-09-28
- **Symptom + exact repro:** 0.1.3 declares `apps:storage:read`, `apps:storage:write`, `apps:storage:shared:read`, `apps:storage:shared:write`. A newly declared scope is dropped from the token until the viewer consents, so the first real storage call 403s while manifest and runtime both look correct.
- **Observed (with values):** on the live app as `zachlowdenzx`, `yt-storage-anon` is absent (signed in) and `yt-published-board` renders only behind `yt-board-toggle`; **no storage or publish call has ever been made against this code**, in production or in dev. The custom-format draft was filled in and then **cancelled deliberately** rather than saved, precisely to avoid a write on an unconsented scope. `via: measurement`.
- **Ruled out:** that the scopes are missing from the manifest — all four are present with justifications and `civitai app validate` rc=0; `via: command`.
- **Leading hypothesis:** the consent prompt appears on first Save/Publish and everything works after it; entirely untested.
- **Next probe:** on the live app, click `yt-format-new` → fill → **Save**, and record whether a consent prompt appears, then whether the format survives a reload (`useAppStorage` round-trip). Then `yt-board-toggle` → Publish → confirm the suffix lands in the MODERATED `body`, not `data`.

### The platform ignores requested output dimensions — confirmed through a THIRD independent route
- as-of: 2026-09-30
- **Symptom + exact repro:** every generation returns **1216×832** (aspect 1.46) whatever size is asked for. `civitai generate "<prompt>" --aspect-ratio 16:9 --quantity 2` → both files `1216x832`, measured with `magick identify`, not assumed.
- **Observed (with values):** three routes now agree. (1) `params.width`/`params.height` 1280×720 and 1344×768 on **SD XL 1.0** → 1216×832. (2) same on **FLUX.1 [dev]** → 1216×832. (3) `--aspect-ratio 16:9` on the **default ecosystem**, a different session and a different code path → 1216×832. Requested 16:9 is 1.778; delivered is 1.462. `via: measurement`
- **Ruled out:** SDXL bucketing — it reproduces on two other ecosystems. `via: measurement` · A per-route quirk — the flag route and the explicit-dimension route give the identical number. `via: measurement` · That `--dry-run` would warn: it **echoes the requested ratio back**, which is not acceptance, and the CLI states the prompt is not even sent with the estimate. `via: command`
- **Leading hypothesis:** the orchestrator resolves every request onto a fixed bucket and no client-side parameter reaches that decision. Untested against `sourceImage` (img2img has a source aspect to honour) and against `quantity > 1` at other sizes.
- **Next probe:** ask the platform side whether ANY parameter controls output size, or measure an img2img run (`--ecosystem Flux1Kontext --image <file>`) and see whether a source aspect survives — that is the one case that could distinguish "fixed bucket" from "ignored parameter".

## Next steps (ranked)
1. **Land the hero wire, then bump and submit 0.1.4.** The in-flight agent's PR against `main` must be reviewed and merged, then `block.manifest.json` `0.1.3` → `0.1.4`, then `civitai app submit --yes`. This is the gate on every item below — the re-shoot, the store copy and any browser verification all need the new version LIVE. Files: `block.manifest.json`, `src/App.tsx`, `src/layout.ts`, `public/hero-banner.jpg`. Repo: `civitai-app-yt-thumbnail`.
   forcing: user
2. **Verify the layout in a real browser — nothing has ever been rendered.** Every layout claim in this pass, the new hero included, is jsdom plus arithmetic: the CSS the app emits, never pixels. Specifically unobserved: the rail's sticky travel and whether its `maxHeight`/`overflowY` bound holds; the boot→app frame sequence; whether the new focus ring wins over the W6 pack's own focus styling (jsdom performs no cascade); and now **whether the hero scrim actually keeps the headline legible over the image at every width**. `taste.json` `deferred[]` carries these with closing conditions. Use `browser` against the live app once 0.1.4 is approved. Repo: none (live app).
   forcing: user
3. **Re-shoot the 4 store screenshots and author an `app-capture` recipe for this slug** — only possible once 0.1.4 is live. Keep the before/after pair: that diff is the only part of an app-taste pass that produces evidence rather than opinion. Repo: `civitai` (the recipe), `civitai-app-yt-thumbnail` (the shots).
   forcing: gate
4. **Two pieces of housekeeping in OTHER repos, both blocked here.** (a) **Prune the app-taste `decisions[]` prose — `taste.json` is +61% since round 0** (26,543 → 42,541 B); round 0's D3 disposition was to route the near-verbatim docblock duplication to `/prune-skill` on the app-taste skill in the **civitai** repo, and it has not run. (b) **Register the cairn scope** — `civitai-app-yt-thumbnail` is still absent from `~/.config/subsystem-store/routes.json`, so `cairn recall`/`create` REFUSE verbatim and this session could not write a subsystem entry either. That file is home-manager-managed READ-ONLY; the fix is one line in the devrc nix source + `home-manager switch`. The table already carries `civitai-app-model-benchmarking`, `civitai-app-playable-collections` and `civitai-app-sensei`, so this slug fits the established `civitai-app-<slug>` pattern exactly, and devrc PR #1862 is the same change for a sibling scope — copy its shape. Blocked five times now. Repo: `civitai` (a), `devrc` (b).
   forcing: none
5. **Decide the 1216×832 framing question** — confirmed by a THIRD route (see the investigation below), and now with a fourth data point: the hero itself was requested at `--aspect-ratio 16:9` and came back 1216×832, which is why it had to be cropped by hand. Correct the copy further, show the crop so users can reframe, or find a parameter that genuinely controls output size. Repo: `civitai-app-yt-thumbnail`, `src/generation.ts`.
   forcing: user
6. Exercise the storage + publish path once — still the only part of 0.1.3 with zero production evidence. Repo: none (live app).
   forcing: none

## Defects (batched)
- None this session.

## Gotchas / decisions / dead-ends
- 🔴 **`civitai app listing status` is a snapshot, and approval moves under you.** Two reads ~5 min apart this session returned `draft` then `approved`; `set-icon` refused in between with "this listing is live". **Re-read listing state immediately before an attach, not at the top of the task** — the attach path is materially different on each side of that line (direct edit vs. moderator-reviewed revision).
- **The listing attach commands auto-submit the revision when the publish floor is met.** On a LIVE listing, an attach that still leaves the listing below the floor STAGES and exits 0 saying so; the attach that COMPLETES the floor submits the whole revision to a moderator with whatever `--changelog` that last command carried. So: stage everything you want reviewed together, and put the real changelog on **every** attach, because you cannot tell in advance which one will be last. `submit-revision` is then a no-op (it refuses when there is no open revision).
- Non-interactive attaches need `--yes` (or `--changelog`) once the listing is live, else they refuse with rc=1.
- **Icon sizing is a dimensions problem, not a compression one.** The CLI's 2 MiB check is on your source file; the platform re-encodes the icon to PNG (≤1024px longer side) and caps the image IT makes at 1 MiB. 512×512 flat vector → 19.9 KiB, nowhere near either bound. A detailed 1024×1024 photo passes the CLI and gets refused at attach.
- **This host has no image tooling installed** — no rsvg-convert/magick/inkscape/chromium, no PIL/cairosvg. Use `nix-shell -p librsvg imagemagick --run '...'`. Fonts available to it are DejaVu / Liberation / **Noto Sans** / JetBrainsMono — no Inter, no Roboto; the cover SVG asks for `Noto Sans, DejaVu Sans, sans-serif` for that reason.
- `civitai app dev-token`: WITHOUT `--spend` the token is READ-ONLY (CLI filters `ai:write:budgeted` from the request) — dev:live then refuses to generate. WITHOUT `--budget` the server defaults to 50 pre-approval; `--budget` caps at 250. Re-mint: `civitai app dev-token yt-thumbnail --spend --budget 250 --env > .env.development.local`.
- dotenv is FIRST-wins: appending a second `VITE_LIVE_BLOCK_TOKEN` line with `>>` does NOT override the first. Mint with `>` (overwrite) or dedupe.
- Submit: non-interactive REQUIRES `--yes` (without it, refuses); `validate` is manifest-shape only (fleet skill §"what validate does NOT check"); the credential-shape warning on `src/setup-dev-live.test.ts:25` is a false positive (fake `tok123`/`key456` fixtures).
- This host has NO global git identity — fleet repos commit as `ZacxDev <zachlowden1@gmail.com>`; set repo-locally.
- bash-guard blocks `pkill -f` — background vite servers are killed via `$!`-pid files.
- Scaffold's `phaseForSubmitError`/`isFeatureGated`/`'gated'` phase were DELETED with the comfy mode; don't re-add tests referencing them.
- README/docs match the code as of `17def4f` (comfy section deleted; "pack ships no Slider" claim fixed — it ships `Slider` and `TextInput`).

- 🔴 **RETRACTED, and it is the most dangerous thing in this doc's history: "a synthetic in-frame `--frame` click does nothing on a billing control" is FALSE.** Measured 2026-09-28: a framed `click` on `[data-testid=pm-generate]` submitted two workflows and **spent 6 real Buzz**. Both `flows/civit.ai.md` and `flows/yt-thumbnail.civit.ai.md` asserted it; both are corrected in devrc PR #1904. **Never fire an in-frame click at a money control to see whether it works.**
- 🔴 **Why that false claim survived as a "reproducible observation" — the trap that produced it:** `pm-generate` is `disabled` until the prompt is non-empty, **and the prompt field renders a placeholder that reads exactly like a filled-in value** (`a serene mountain lake at golden hour, highly detailed`). A click on a disabled button reports `ok: true` and changes nothing — indistinguishable from a swallowed untrusted event. **`type` a real prompt, then read `.disabled`, before drawing any conclusion about trust.**
- 🔴 **`xargs` cannot exec a shell builtin, so `... | xargs -0 command grep ...` exits 127 with EMPTY output — indistinguishable from a clean zero.** This produced a confident "no format testids exist" that was simply a broken pipeline. Use plain `grep` inside `xargs` (the `grep` function does not apply there anyway).
- 🔴 **A bundle-grep zero is worthless if you invented the token.** `pm-format-row` returned 0 and nearly became "the formats work did not deploy" — the real ids use a **`yt-` prefix**. Derive probe names from source, and always report a pair with a known-present control.
- **The LSP lags branch switches; `tsc` is the arbiter.** Three separate waves of diagnostics this session (`selectedFormats` unused, `THUMB_PROMPT_STYLES` missing, whole-module "cannot find") were all stale — `tsc --noEmit` was clean each time, with `noUnusedLocals` ON.
- **Listing media auto-submits the revision once the publish floor is met**, and batched attaches join ONE revision (measured: 4 screenshots all landed on `alpr_01M3MZECSN49QVBT5WG1TYZA5B`). Put the real `--changelog` on every attach — you cannot tell in advance which one is last.
- **The icon's YouTube-mark hazard.** The best generated icon was a red rounded square with a play triangle — essentially the YouTube logo. The app's NAME is nominative descriptive use and is fine; reproducing the MARK on a public listing for an unaffiliated app is not. Final icon uses a magenta/cyan burst with no red, and a VECTOR play mark composited over generated art (generated play symbols are mushy and die at 32px).
- **The `civitai` CLI commit guard blocks heredocs**: `git commit -F <file>` (write the message with the Write tool). A compound `checkout -b && commit` is also refused because the guard reads the branch at parse time — split them.

- 🔴 **A `<slug>.civit.ai` App Block host trips devrc's `test_no_client_subdomain_literal_is_committed`, and the fix is a PIN, never a wider regex.** Every per-app browser flow file will hit this. **Widening the pattern is a SECURITY REGRESSION, measured:** require ≥2 labels before the apex so a single-label tenant host stops being a finding, and `grafana-staging.civit.ai` — the gate's OWN planted positive control — also stops being a finding. Current pattern: both FOUND. Widened: both **not found**. A tenant host and an internal host are the same shape; nothing in the string separates them. So: one pinned, justified `ALLOWLIST` entry per host, and the per-app recurrence is the feature — a human deciding "this one is public" each time.
- **The justification a pin needs, and how to measure it.** The scanner's docstring allows a pin for "a subdomain that is genuinely public and genuinely not topology". GENUINELY PUBLIC is measurable: `env -i curl https://civitai.com/api/v1/apps/<slug>` returns `kindData.liveUrl` with **no cookie and no token** for an `approved` listing. `env -i` matters — a probe carrying ambient auth proves nothing about what a stranger can see. GENUINELY NOT TOPOLOGY: the scanner catalogues what leaks as `grafana-new.` / `auth.` / `sish.` / `review-<hash>.` / `<unreleased product>.` — a RELEASED, publicly-listed product is none of those. devrc `CLAUDE.md:498` also qualifies its ban with "used as an **example**", which an operational flow target is not.
- 🔴 **`test_no_client_hostnames.py` is scanned BY ITS OWN GATE — assemble every host, never spell one.** The first draft of the pin block spelled both hosts in the `ALLOWLIST` keys AND in the prose explaining them, and `test_this_guards_own_sources_are_clean` failed on that very block. Build from a shared `_APEX = ".".join(("civit","ai"))`. ⚠ A host followed by `.md` (a *filename*) does NOT trip it — the right lookahead `(?!\.[A-Za-z0-9])` blocks the match — which is why the flow file's own NAME is tolerated while its CONTENT is not.
- 🔴 **`git checkout -- <file>` with uncommitted work in it destroys that work.** Done this session mid-mutation-battery, intending to undo a mutant; the file was actually at HEAD + my unlanded edits, and all of it went. Nothing was lost only because the diff was still in the transcript. **Commit before running a mutation battery**, not after.
- **Mutation batteries on Python must run under `PYTHONDONTWRITEBYTECODE=1`.** CPython validates a cached module on mtime-in-whole-SECONDS + size, so a same-length edit landing in the same second imports the ORIGINAL bytecode and the mutant scores SURVIVED without ever executing.
- **A mutant "killed" is only evidence if the NAMED test went red.** M4 (repoint a pin at a nonexistent path) kills two tests at once; scoring on "something failed" would have credited the wrong guard. Match the expected test name, and keep one mutant — here M5 — that only the NEW test can catch, to prove the new test is reachable rather than riding another guard's failure.
- **This host has no `pytest` in PATH and devrc's `.envrc` is `use opencode`** (no direnv-provided pytest either). Run devrc's python gates via `nix-shell -p python3Packages.pytest --run "..."`.
- **`civitai app listing status` cannot distinguish an APPROVED revision from a REJECTED one** — both stop printing "A revision is currently under moderator review". To tell them apart, read `updatedAt` plus the served `iconUrl`/`coverUrl` from `https://civitai.com/api/v1/apps/<slug>` and actually LOOK at the image.
- **`image.civitai.com` answers `301` to a `blobs-b2.civitai.com` URL** — `curl` without `-L` writes a 0-byte file and ImageMagick then reports "insufficient image data", which reads like a corrupt asset rather than a missing redirect flag. Use `curl -sSL`.
- **There is no `civitai app listing` subcommand that inspects a revision** — `status` is the only read, and it is a snapshot.

- 🔴 **devrc's Tekton gates fail `NO CAPACITY: the gate never started (queued past its deadline)` — and that is NOT a code failure.** All four go red together, which is the tell: a change to one Python file cannot break `gotests` and `nodetests`. **Read the check DESCRIPTION, not just the red.** Consequence: a red devrc gate right now says nothing about your code, and neither does a green one that never ran.
- 🔴 **`browser-bridge/SKILL.md` had only 148 B of slack under its ENFORCED budget** (12,038 B = 12,288 ceiling − 250 B `MIN_HEADROOM`). A 15-line note put it 693 B over and broke 3 gates. **Put detail in `reference/<topic>.md` and keep SKILL.md to the imperative** — reference files cost nothing until loaded. `test_prune_skill_size` pins the claim "browser-bridge MEETS it" as a WHOLE NORMALISED SENTENCE and says explicitly: *"Fix browser-bridge or rewrite the argument — do NOT restate the new number."* Restating the measurement is the defect, not the fix.
- 🔴 **Attributing a failure in a red tree REQUIRES a pinned control.** `main` carries ~124 pre-existing failures, so a raw count from one run is meaningless. Run the suite at the commit AND its parent, in **detached worktrees pinned by sha**, then diff failure sets by test id. ⚠ **Never run a long suite in the base clone while anything may switch its branch** — one run was voided exactly that way and its failures were pure noise.
- 🔴 **`git checkout -- <file>` with uncommitted work in it destroys that work.** Done mid-mutation-battery intending to undo a mutant; the file was at HEAD + unlanded edits and all of it went. **Commit before a mutation battery, not after.**
- **A squash merge NEVER makes the branch head an ancestor of the base** — verify it landed by CONTENT (`git cat-file -e origin/main:<path>`, grep the actual text) plus `gh pr view --json mergedAt,mergeCommit`. Ancestry checks return a confident, wrong "not merged".
- **The harness caps a foreground `Bash` timeout at 10 minutes** — a 50-minute suite must run with `run_in_background`, not a large `timeout` value.
- **devrc python tests need deps this host lacks**: `nix-shell -p python3Packages.pytest python3Packages.pyyaml python3Packages.requests`. Bare `pytest` is absent, and `.envrc` is `use opencode` (no pytest from direnv either).

- 🔴 **`civitai generate` takes the prompt POSITIONALLY — there is no `--prompt` flag**, and there is no `--output` either (`--out-dir` + `--out-name '{n}{ext}'`). In a non-interactive shell it **refuses without `--yes`** and says so with the estimate attached, which is a safe failure: nothing is charged. `--max-cost` is an ESTIMATE check refused locally, **not a spending cap** — the server enforces no ceiling and the realized charge can exceed it.
- 🔴 **`--dry-run` does NOT check the prompt.** The CLI says so verbatim: the prompt is not sent with the estimate, so a submit can still be refused on content. A clean dry-run prices the request and validates nothing about what you asked for.
- **Model choice is worth pricing every time: 208 vs 16 Buzz for the identical request.** The listing-media suite pins NanoBanana for two reasons — reliable headline text, and img2img composition preservation. Neither applies to a textless txt2img hero, so the premium bought nothing. Dry-run BOTH and read the pair before spending.
- **A generated hero should be TEXTLESS; keep the words in the DOM.** They stay crisp at any width, follow the theme through the palette, and are readable by assistive tech — none of which a baked-in headline can do — and it sidesteps the suite's measured text-volume failure class entirely. Ban `play button` in the negative prompt here specifically: the icon's play mark is a vector composite and a generated one fights it.
- 🔴 **The bash guard judges `git -C $VAR` against the CALLER's directory** when the variable's value is not in the command text — so a legitimate commit in a worktree on a feature branch is refused as "commit on main". Pass `-C` an **absolute path**, or assign the variable in the same command.
- **`git config --local` inside a worktree writes the COMMON config** — it is repo-global, not worktree-local. The base clone now carries `ZacxDev <zachlowden1@gmail.com>` because an agent set it in a worktree.
- **Two agents were killed mid-work by a session limit, both holding UNCOMMITTED work** that survived only by luck. Brief every implementation agent to **commit and push before the long verification tail**, not after.
- ⚠ **`--reporter=basic` does not exist in this vitest** — it fails with `ERR_LOAD_URL` and reads exactly like a broken suite. The new guards `readFileSync` relative to cwd, so **run vitest from the repo ROOT**; a `--root` invocation reports ~15 spurious failures that are a harness artifact, not the code.
- **The hue still fails the brand wheel's own gate and this is unresolved, not accepted.** `#FF49BD` sits 11.8° from `gen-matrix` against a ≥40° bar, on a wheel `listing-media` documents as FULL at seven apps; this is the eighth. It was shipped because the hue was derived by measurement from the icon that is already approved and live — re-skinning the app away from its own published mark to satisfy a full wheel is the worse trade. Fleet-level decision, recorded in `taste.json`.

- 🔴 **`node_modules` is NOT gitignored when it is a SYMLINK.** `.gitignore` here has `node_modules/` — a trailing slash matches **directories only**, and git does not see a symlink as one. In the `taste/hero-wire` worktree (where `node_modules` is symlinked to the base clone so vitest can run) `git status` shows it as `?? node_modules` and `git check-ignore` exits **1**. A `git add -A` would commit the symlink. Stage explicit paths — which the bash-guard hook enforces anyway.
- **`assets/` and `public/` are different shipping lanes and it is easy to put a file in the wrong one.** `assets/` is the LISTING-media directory (icon, cover, the 4 screenshots) and Vite **never** bundles it — a hero left there would be invisible to the app. `public/` is copied verbatim into the build output and served same-origin from the app's own subdomain. PR #8's candidates are correctly in `assets/` as *evidence*; the file the app reads is `public/hero-banner.jpg`.
- **The hero image had to be MIRRORED, and that is a composition fact, not a preference.** The render puts its burst left-of-centre with the dark field on the right — the `heroPrompt` asked for "generous empty dark space across the right two thirds" — but the hero's DOM text is **left**-aligned. Flipping horizontally puts the near-black field under the words and the burst in the empty space. Free with `magick -flop`; nothing else about the render changes.
- 🔴 **Layering the image under the hero text without breaking an ALREADY-GRADED contrast claim.** `palette.ts` grades `heroFg`/`heroSubFg` against both `heroFrom` and `heroTo`. Putting an arbitrary image behind the text makes those assertions false statements while the tests stay green. The design that keeps them literally true is a three-layer `background-image` stack: (1) a horizontal scrim `heroTo → transparent`, opaque under the text, so the realized background there **is** `heroTo`; (2) the image, `cover`; (3) the existing `linear-gradient(135deg, heroFrom, heroTo)` untouched, so a 404 on the image still leaves a correct hero in both themes with zero bytes. No new palette token and no new contrast claim.
- **`handoff_search --exclude-slug` can print `excluded=<slug>` while matching nothing.** This session passed `--exclude-slug handoff-yt-thumbnail.md`; the run printed `excluded=yt-thumbnail` but `in_scope_docs == indexed_docs` (516 = 516) and `in_scope_sections == indexed_sections` — so the flag PARSED but did not MATCH, most likely because this doc is not in the index. Read the pair, never the `excluded=` line alone.
- **`resume-state.sh` reports `gh answered for 0 of N referenced PR(s)` for CROSS-REPO PR references.** This doc cites devrc PRs #1904/#1917; the reconciler queries them against *this* repo and gets nothing. `gh` was working fine — checked by hand. The gap banner is real but the cause is attribution, not access.
- **`civitai generate` ignores `--aspect-ratio` — a FOURTH confirmation.** The hero was requested at 16:9 and both candidates came back 1216×832 (1.46). Crop by hand; never trust the dry-run's echo of the requested ratio.

## How to verify
```bash
cd /home/zach/workspace/civit/civitai-app-yt-thumbnail
npx tsc -p tsconfig.json --noEmit && npm test    # baseline at b11523a: 548/548 across 22 files
npm run build && civitai app validate .
python3 ~/.claude/skills/civitai-app-fleet/app_state.py yt-thumbnail   # rc=0 iff live
civitai app doctor | sed -n '/^yt-thumbnail/,/^$/p'                    # expect "✓ No problems"
civitai app listing status                       # expect approved, NO "under moderator review"
# ARC 3's closing condition — the live app must actually be 0.1.4 WITH the hero:
B=$(curl -sS https://yt-thumbnail.civit.ai/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
curl -sS "https://yt-thumbnail.civit.ai/$B" > /tmp/b.js
for t in hero-banner yt-format-card yt-storage-anon pm-editor-canvas pm-comfy-beta; do
  printf '%-20s %s\n' "$t" "$(grep -oF -- "$t" /tmp/b.js | wc -l)"   # last must be 0, others ≥1
done
curl -sSI https://yt-thumbnail.civit.ai/hero-banner.jpg | head -3     # expect 200 + image/jpeg
# the listing revision APPROVED (not rejected) — status alone cannot tell them apart:
curl -sS https://civitai.com/api/v1/apps/yt-thumbnail | python3 -m json.tool | grep -E 'iconUrl|coverUrl|updatedAt'
```
