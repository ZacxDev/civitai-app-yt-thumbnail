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
- **closing-condition: check** — `civitai app listing status` no longer prints "A revision is currently under moderator review" **and** `civitai app doctor` reports `yt-thumbnail ✓ No problems` **and** the live bundle greps `yt-storage-anon` ≥1 alongside a known-present positive control. Two of the three already hold; the pending listing-media revision is the open one.
- Arc 1 ("ship it") was MET 2026-09-27 — `app_state.py yt-thumbnail` rc=0 and `https://yt-thumbnail.civit.ai/` returned 200. That line was frozen and is kept here as history; the field above is THIS arc's, opened by the formats/storage/listing work rather than extending the old one.

## State now
- **App: 0.1.3 APPROVED + LIVE.** `pubreq_01M3K1PRF8Y0KXCT5RA6ZHDJWW`… superseded — current live row is **0.1.3 / `b66ddaf`**, deploy `live`, `HTTP 200`, `app_state.py` rc=0, floor 0.1.3.
- **Repo is PUBLIC with a remote:** `git@github.com:ZacxDev/civitai-app-yt-thumbnail.git`. `main` @ `ca3bddb`, clean, tracking `origin/main`. Five PRs merged (#1 features, #2 bump, #3 handoff, #4 screenshots, #5 AI media). **No open PRs in this repo.**
- **Verified live, not inferred:** served bundle `assets/index-BrzuzOdM.js` carries `yt-hero`/`yt-format-card`/`yt-format-new`/`yt-published-board`/`yt-storage-anon`/`pm-result-format`/`pm-partial` each at **1**, with `pm-editor-canvas` 1 as positive control and retired `pm-comfy-beta` 0. Preview art serves `200 image/webp` from `/formats/<id>.webp`.
- **End-to-end money path exercised in production** (2026-09-28): two formats selected → **two workflows**, two separately-labelled candidates, **6 Buzz debited from Blue**, button read `Generate · 6 Buzz`, editor opened a **1280×720 canvas with no error**. Multi-format, cost preview and the CORS-dependent editor export are all confirmed working live.
- **Listing:** `approved`, icon ✓, cover ✓, **4 screenshots LIVE** (approved revision). **IN FLIGHT:** a revision carrying the new AI-generated icon+cover — `alpr_01M3N183249CTB062W288KMM5S`, pending moderator review. The live listing keeps the old art until it clears.
- **devrc `flow-yt-thumbnail` / PR #1904 is OPEN** (2 commits: the per-app flow, and the retraction below). The devrc checkout is currently **on that branch**, which is how the corrected flow docs are live for the bridge.
- Buzz spent this session: **~81** (57 previews+probes, 6 live UI generation, 18+6 listing art).

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

## Next steps (ranked)
1. Watch listing-media revision `alpr_01M3N183249CTB062W288KMM5S` to approval — `civitai app listing status` stops printing "A revision is currently under moderator review". External moderator action; nothing to do but check. Repo: none.
   forcing: gate
2. Merge devrc PR #1904 (`innovation-upstream/devrc`) — carries the per-app browser flow AND the 🔴 retraction below. Until it lands, every other session still reads "a synthetic in-frame click does nothing on a billing control", which is false and unsafe. Files: `scripts/browser-bridge/flows/{civit.ai,yt-thumbnail.civit.ai}.md`, `flows/_index.json`. **Also: the devrc checkout is parked on `flow-yt-thumbnail`** — return it to `main` after merging.
   forcing: user
3. Exercise the storage + publish path once (see Open investigations) — it is the only part of 0.1.3 with zero production evidence. Repo: none (live app).
   forcing: none
4. Decide the 1216×832 framing question (below) — correct the copy further, show the crop so users can reframe, or find a parameter that controls output size. Repo: `civitai-app-yt-thumbnail`, `src/generation.ts`.
   forcing: user
5. Register the `civitai-app-yt-thumbnail` cairn scope, then land the DRAFTED index entry — `cairn create` still REFUSES verbatim: *"scope `civitai-app-yt-thumbnail` is not in the routing table `/home/zach/.config/subsystem-store/routes.json`"* (configured instances: `personal`, `civitai`). That file is home-manager-managed READ-ONLY, so unblocking means adding `"civitai-app-yt-thumbnail": "civitai"` to the devrc nix source + `home-manager switch`, then `cairn create --scope civitai-app-yt-thumbnail --ref src --file <entry>`. **The entry is written and VALIDATES clean** (`cairn-validate --validate` → `OK — 1 of 1 parse`); it is parked at `<scratchpad>/src.md` and **will be lost when the scratchpad is cleared** — re-derive from this doc's Gotchas if so. Route `civitai` is the fleet majority for generation apps. This has now blocked twice.
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

## How to verify
```bash
cd /home/zach/workspace/civit/civitai-app-yt-thumbnail
npx tsc -p tsconfig.json --noEmit && npm test    # expect 284/284 across 17 files
npm run build && civitai app validate .
python3 ~/.claude/skills/civitai-app-fleet/app_state.py yt-thumbnail   # rc=0 iff live
civitai app doctor | sed -n '/^yt-thumbnail/,/^$/p'                    # expect "✓ No problems"
civitai app listing status                       # revision pending -> approved
# served-bundle proof (ALWAYS report a pair, never a bare zero):
B=$(curl -sS https://yt-thumbnail.civit.ai/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
curl -sS "https://yt-thumbnail.civit.ai/$B" > /tmp/b.js
for t in yt-format-card yt-storage-anon pm-editor-canvas pm-comfy-beta; do
  printf '%-20s %s\n' "$t" "$(grep -oF -- "\`$t\`" /tmp/b.js | wc -l)"   # last must be 0, others 1
done
```
