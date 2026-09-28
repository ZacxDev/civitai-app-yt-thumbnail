# Handoff: yt-thumbnail — 2026-09-27

## Run this first — the index, one command
```bash
cairn recall --repo /home/zach/workspace/civit/civitai-app-yt-thumbnail
```
Currently REFUSES: scope `civitai-app-yt-thumbnail` is not in
`~/.config/subsystem-store/routes.json` yet (nothing recorded for this repo).
Ordinary for a brand-new repo — register the scope or ignore until content exists.

## Goal
Ship **YT Thumbnail** — a Civitai page-money app that generates YouTube
thumbnails at 1280×720: txt2img + img2img remix + canvas text-overlay editor
with a YouTube-capped export.
- **closing-condition: MET 2026-09-27 21:42** — `app_state.py yt-thumbnail` rc=0 **and** `curl -sS -o /dev/null -w '%{http_code}' "https://yt-thumbnail.civit.ai/"` printed **200**. v1 is approved, deployed and serving.
- Remaining arc is no longer "ship it": it is the store LISTING (revision under review) and the unremoved local-only-git risk. See Next steps.

## State now
- Branch/PR: `main` @ `5faa9f8` (2 commits: `17def4f` app + `5faa9f8` chore). **No remote — commits exist only on this machine.** No PR (new repo).
- DONE this session (all committed in `17def4f`):
  - Scaffold `page-money` → full v1: `src/generation.ts` (always-16:9 params 1280×720, `quantity` clamp 1–4, `sourceImage` img2img threading, prompt presets; Comfy machinery removed), `src/editor.ts` NEW (cover-crop, wrap, overlay spec, drawThumbnail, JPEG quality ladder to YouTube 2MB cap, CORS-aware load), `src/App.tsx` rewritten (Generate/Remix tabs, candidates picker, gallery → editor, download; money-path driver untouched), `comfy.ts`+`comfy.test.ts` deleted, README rewritten to match code.
  - 180/180 tests green; tsc clean; `civitai app validate` ✓; `npm run build` ✓; harness smoke ✓. Mutation-checked: breaking quantity/sourceImage threading turns both e2e tests red.
- **APPROVED + LIVE.** `pubreq_01M3JE62KDFVK17V8FWA95SEQF` submitted 2026-09-27 17:01 CDT, **reviewed 21:38, deploy `live` 21:39** (it flipped mid-session on 2026-09-27 — a `listing status` read at ~21:37 still said `draft`). Source commit `17def4f` stamped server-side.
  - Verified, not inferred: `app_state.py yt-thumbnail` rc=0; `curl` on `https://yt-thumbnail.civit.ai/` → **200**; served bundle `assets/index-BApQOvKD.js` greps **`pm-editor-canvas` 1 / `pm-comfy-beta` 0** — the 0 is meaningful because the positive control in the same grep, same file, same backtick quoting returned 1.
- **Listing media DONE (2026-09-27 ~21:42).** `assets/{icon,cover}.{svg,png}` committed on branch `listing-media` (`f597804`). icon 512×512/19.9 KiB, cover 1600×900/220.1 KiB, flat vector rendered by `rsvg-convert` (`nix-shell -p librsvg`). Both accepted; publish floor now MET.
  - 🔴 Because the listing was already LIVE, they did **not** attach directly — they staged on revision **`alpr_01M3JY8NMRA1PC6AJQFTJCFF8G`, pending moderator review**. The live listing is unchanged until that is approved. `set-icon` staged silently (below floor); `set-cover` **auto-submitted the revision** on meeting the floor, exactly as `set-icon --help` says ("it reuses this revision and submits it once the floor is met") — there is no separate `submit-revision` step to run, and running one now would be a no-op.
- Dev/live wiring: `.env.development.local` holds `VITE_LIVE_BLOCK_TOKEN` minted with `--spend --budget 250` (payload verified: `["ai:write:budgeted","user:read:self"], buzzBudget: 250`; ~4h TTL from ~15:35 CDT — **expired ~19:35, re-mint before any dev:live run**). CLI credential = OAuth `zachlowdenzx` (id 8753561), can spend (AI Services) + submit Apps; balance ~4.07M Buzz.
- IN FLIGHT: moderator review of listing revision `alpr_01M3JY8NMRA1PC6AJQFTJCFF8G` (external; not self-service). The APP is live regardless — the revision gates only the store listing's media.
- Still unverified against the real backend: no live generation has run, so 1280×720 pricing, CORS-on-image-URLs, and budget-vs-quantity remain open (see Open investigations). Now actually runnable — the app is live.
- Known gaps: **no git remote** (the submitted bundle's source still exists only on this machine); branch `listing-media` is unmerged (no remote ⇒ no PR was possible); opencode MCP `CIVITAI_TOKEN` unwired (CLI credential ≠ MCP env var); `CIVITAI_HOST_KEY` unset (dev:live nav shows name only — harmless); subsystem-index entry DRAFTED but unwritten (see item 4); listing has 0 screenshots (optional, up to 8).

## Version history (server-confirmed, never from a CLI exit code)
| ver | pubreq | source | state |
|---|---|---|---|
| 0.1.0 | `pubreq_01M3JE62KDFVK17V8FWA95SEQF` | `17def4f` | approved, superseded |
| 0.1.1 | `pubreq_01M3JZB7TRZ6TMD1MX7H4M33VZ` | `c5e175d` | **approved + live** (listing copy) |
| 0.1.2 | `pubreq_01M3K1PRF8Y0KXCT5RA6ZHDJWW` | `cb6f661` | **pending** (checkpoint-picker fix) |

Live 0.1.1 keeps serving while 0.1.2 is in review — confirmed HTTP 200 after the submit. Branch `fix-checkpoint-picker-family-lock` is the tip and CONTAINS `listing-media`; merging it into `main` brings everything. Still **no git remote** — every submit has warned that the source exists only on this machine.

## RESOLVED — `description` is absent from the schema but DOES land
0.1.1 shipped `tagline`/`description`/`category` with an explicit unknown: `description` is in NO version of the published manifest schema (`v1.json` is the only one served; `v2`/`v1.1`/`latest` all 404), and the schema permits unknown keys, so `civitai app validate` returned rc=0 either way and proved nothing. **After 0.1.1 approved, `civitai app doctor` reports none of `empty-tagline` / `empty-description` / `empty-category`.** All three landed. The published schema is incomplete; the CLI's insistence was correct. Only `no-screenshots` remains (optional).

## Defect found + fixed this session — the checkpoint picker was SELF-TRAPPING
- **Reported:** the "Change model" picker listed only SDXL — no Z Image, no OpenAI, no Flux — while `ab-img-poster` listed everything.
- **Cause:** `App.tsx` passed `baseModelGroup: checkpoint.baseModel`, and `baseModelGroup` *"NARROWS the browse, never widens it"* (`blocks-react` `internal/catalog.d.ts`). `DEFAULT_CHECKPOINT` is SDXL 1.0, so the filter was derived from the very thing the control exists to change. 🔴 **Not merely restrictive — unreachable:** widening it required already holding a checkpoint from the family you were trying to reach, so no other ecosystem was reachable by ANY sequence of user actions. `ab-img-poster` passes no filter, hence unaffected.
- **Fix (`ea40598`):** `useResourcePicker({ resourceType: 'Checkpoint' })` with `baseModelGroup` OMITTED — documented as "an unconstrained pick of the type". Deliberately NOT `useCheckpointPicker` with `baseModelGroup: ''`: that field is required there, and `''` is only documented in the dev shim's `filterCardsByFamily`, unverified against prod. Cost: the picker no longer pre-highlights the current model (that option belongs to the dropped hook).
- **The LoRA picker KEEPS its family filter** on purpose — a LoRA really must match. Pinned by a test so an over-broad "drop every baseModelGroup" edit fails loudly.
- **Deliberately NOT built:** a client-side warning for a cross-family LoRA left over after an ecosystem switch (newly reachable). The server validates compatibility and rejects before any spend, and `submitErrorReason` surfaces its wording verbatim; a fuzzy client check would duplicate a server rule and misfire where the server is right (`SDXL 1.0` vs `SDXL Turbo` — one ecosystem, two strings).

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

## Next steps (ranked)
1. Merge `listing-media` into `main` and push the repo to a remote — the submitted bundle's source, and now the listing assets, exist only on this machine (submit warned: "HEAD is on no remote"). Needs the user's call on host/repo name; then `git checkout main && git merge --ff-only listing-media && git remote add origin <url> && git push -u origin main`.
   forcing: user
2. First real generation + close the two open investigations — the app is live, so these are finally runnable. Re-mint the dev token (the old one has expired), then one real gen (**spends the viewer's Buzz**), the CORS probe below, and budget sizing vs the manifest 300.
   forcing: none
3. Watch listing revision `alpr_01M3JY8NMRA1PC6AJQFTJCFF8G` to approval — `civitai app listing status` reports it. External moderator action; nothing to do but check. Optionally add screenshots (≤8) BEFORE it clears, so they ride the same review cycle rather than opening a second one.
   forcing: gate
4. Complete the subsystem-index write + wire opencode MCP `CIVITAI_TOKEN` — the index entry is drafted at scope `civitai-app-yt-thumbnail`, ref `src` (kept at `/tmp/opencode/scratch/civitai-app-yt-thumbnail-src.md`); the write refused (`rc=11`: scope unregistered in `~/.config/subsystem-store/routes.json`, which is home-manager-managed READ-ONLY — unblocking means adding `"civitai-app-yt-thumbnail": "civitai"` to the devrc nix source + switching, then `cairn create --scope civitai-app-yt-thumbnail --ref src --file <draft>` + `cairn sync && cairn-validate --scope civitai-app-yt-thumbnail`). Route recommendation: `civitai` (fleet majority for generation apps: sensei/model-benchmarking/generate-from-model; playable-collections is the lone `personal`). Then: inject `CIVITAI_TOKEN` from `~/.config/civitai/config.yaml` via `~/.config/opencode/plugin/env.js` (opencode restart needed) so the two MCP servers stop 401ing.
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

## How to verify
```bash
cd /home/zach/workspace/civit/civitai-app-yt-thumbnail
npx tsc -p tsconfig.json --noEmit && npm test   # expect 180/180 across 12 files
npm run build                                    # platform's build command
civitai app validate .
civitai app status yt-thumbnail                  # pending → approved (pubreq_01M3JE62KDFVK17V8FWA95SEQF)
python3 ~/.config/opencode/skills/civitai-app-fleet/app_state.py yt-thumbnail   # exit 0 iff live
npm run dev:harness                              # mock host at :5186 (mock banner visible)
# live (spends YOUR Buzz):
civitai app dev-token yt-thumbnail --spend --budget 250 --env > .env.development.local
npm run dev:live
```
