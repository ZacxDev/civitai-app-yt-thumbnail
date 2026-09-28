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
with a YouTube-capped export. v1 is built and SUBMITTED; the arc closes when
the platform serves it.
- **closing-condition:** check — `python3 ~/.config/opencode/skills/civitai-app-fleet/app_state.py yt-thumbnail` exits 0 (live), then `curl -sS -o /dev/null -w '%{http_code}' "https://yt-thumbnail.civit.ai/"` prints 200.

## State now
- Branch/PR: `main` @ `5faa9f8` (2 commits: `17def4f` app + `5faa9f8` chore). **No remote — commits exist only on this machine.** No PR (new repo).
- DONE this session (all committed in `17def4f`):
  - Scaffold `page-money` → full v1: `src/generation.ts` (always-16:9 params 1280×720, `quantity` clamp 1–4, `sourceImage` img2img threading, prompt presets; Comfy machinery removed), `src/editor.ts` NEW (cover-crop, wrap, overlay spec, drawThumbnail, JPEG quality ladder to YouTube 2MB cap, CORS-aware load), `src/App.tsx` rewritten (Generate/Remix tabs, candidates picker, gallery → editor, download; money-path driver untouched), `comfy.ts`+`comfy.test.ts` deleted, README rewritten to match code.
  - 180/180 tests green; tsc clean; `civitai app validate` ✓; `npm run build` ✓; harness smoke ✓. Mutation-checked: breaking quantity/sourceImage threading turns both e2e tests red.
- SUBMITTED 2026-09-27 17:01 CDT: **`pubreq_01M3JE62KDFVK17V8FWA95SEQF`, status `pending`**, source commit `17def4f` stamped server-side. Verified via `civitai app status` + fleet `app_state.py` (floor now 0.1.0), NOT from CLI exit code.
- Dev/live wiring: `.env.development.local` holds `VITE_LIVE_BLOCK_TOKEN` minted with `--spend --budget 250` (payload verified: `["ai:write:budgeted","user:read:self"], buzzBudget: 250`; ~4h TTL from ~15:35 CDT). CLI credential = OAuth `zachlowdenzx` (id 8753561), can spend (AI Services) + submit Apps; balance ~4.07M Buzz.
- IN FLIGHT: moderator review of the pending submission (external; not self-service).
- Deploy/verify status: NOT live (`yt-thumbnail.civit.ai` serves nothing until approved+deployed). No live generation has run — 1280×720 pricing, CORS-on-image-URLs, and budget-vs-quantity are unverified against the real backend (see Open investigations).
- Known gaps: icon+cover NOT set (BLOCKING publish — settable while in review); no git remote; opencode MCP `CIVITAI_TOKEN` unwired (CLI credential ≠ MCP env var); `CIVITAI_HOST_KEY` unset (dev:live nav shows name only — harmless); subsystem-index entry DRAFTED but unwritten (see item 4).

## Open investigations — live diagnosis state
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
1. Set icon + cover on the draft listing — BLOCKING publish (approval alone won't publish without them). Specs in `assets/README.md`; then `civitai app listing set-icon ./assets/icon.png && civitai app listing set-cover ./assets/cover.png` (files don't exist yet — generate first).
   forcing: gate
2. Push the repo to a remote — the submitted bundle's source exists only on this machine (submit warned: "HEAD is on no remote"). Needs the user's call on host/repo name; then `git remote add origin <url> && git push -u origin main`.
   forcing: user
3. Post-approval live verification + first real generation — run `app_state.py yt-thumbnail` until exit 0, then the fleet served-bundle grep (expect `pm-editor-canvas` present, `pm-comfy-beta` absent — backtick-quoted probes), one real gen (their Buzz), the CORS probe above, and budget sizing vs the manifest 300.
   forcing: gate
4. Complete the subsystem-index write + wire opencode MCP `CIVITAI_TOKEN` — the index entry is drafted at scope `civitai-app-yt-thumbnail`, ref `src` (kept at `/tmp/opencode/scratch/civitai-app-yt-thumbnail-src.md`); the write refused (`rc=11`: scope unregistered in `~/.config/subsystem-store/routes.json`, which is home-manager-managed READ-ONLY — unblocking means adding `"civitai-app-yt-thumbnail": "civitai"` to the devrc nix source + switching, then `cairn create --scope civitai-app-yt-thumbnail --ref src --file <draft>` + `cairn sync && cairn-validate --scope civitai-app-yt-thumbnail`). Route recommendation: `civitai` (fleet majority for generation apps: sensei/model-benchmarking/generate-from-model; playable-collections is the lone `personal`). Then: inject `CIVITAI_TOKEN` from `~/.config/civitai/config.yaml` via `~/.config/opencode/plugin/env.js` (opencode restart needed) so the two MCP servers stop 401ing.
   forcing: none

## Defects (batched)
- None this session.

## Gotchas / decisions / dead-ends
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
