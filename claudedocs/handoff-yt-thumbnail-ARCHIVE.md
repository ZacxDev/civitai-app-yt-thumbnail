# yt-thumbnail — handoff ARCHIVE (closed arcs)

Evicted from `handoff-yt-thumbnail.md` on 2026-10-01 to keep it under its size
ceiling. Nothing here was deleted — it is CLOSED, not wrong. Read it for the *why*
behind a decision, or to check what was already tried; never to decide whether a
rule still applies (re-verify against live state for that).

## Closed sections (arcs 1–3: first submits, the checkpoint picker, CORS, dimensions)

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

## Closed gotchas — the hero image, the taste/brand pass, and the dev-harness probing

All shipped in 0.1.4/0.1.5. Kept for the reasoning, not as live constraints.

- **A generated hero should be TEXTLESS; keep the words in the DOM.** They stay crisp at any width, follow the theme through the palette, and are readable by assistive tech — none of which a baked-in headline can do — and it sidesteps the suite's measured text-volume failure class entirely. Ban `play button` in the negative prompt here specifically: the icon's play mark is a vector composite and a generated one fights it.
- **The hue still fails the brand wheel's own gate and this is unresolved, not accepted.** `#FF49BD` sits 11.8° from `gen-matrix` against a ≥40° bar, on a wheel `listing-media` documents as FULL at seven apps; this is the eighth. It was shipped because the hue was derived by measurement from the icon that is already approved and live — re-skinning the app away from its own published mark to satisfy a full wheel is the worse trade. Fleet-level decision, recorded in `taste.json`.
- **The hero image had to be MIRRORED, and that is a composition fact, not a preference.** The render puts its burst left-of-centre with the dark field on the right — the `heroPrompt` asked for "generous empty dark space across the right two thirds" — but the hero's DOM text is **left**-aligned. Flipping horizontally puts the near-black field under the words and the burst in the empty space. Free with `magick -flop`; nothing else about the render changes.
- **`assets/` and `public/` are different shipping lanes.** `assets/` is the LISTING-media directory (icon, cover, screenshots) and Vite **never** bundles it — a hero left there would be invisible to the app. `public/` is copied verbatim into the build output and served same-origin. PR #8's candidates are correctly in `assets/` as *evidence*; the file the app reads is `public/hero-banner.jpg`. `cmp public/… dist/…` after a build is the check that they are one lane apart, not two claims.
- 🔴 **Layering an image under hero text without breaking an ALREADY-GRADED contrast claim.** `palette.ts` grades `heroFg`/`heroSubFg` against both `heroFrom` and `heroTo`. An arbitrary image behind the text makes those assertions false statements while the tests stay green. The shipped design keeps them literally true with a three-layer `background-image` stack: (1) scrim `linear-gradient(90deg, heroTo 0%, heroTo 42%, transparent 82%)`, opaque under the text, so the realized background there **is** `heroTo`; (2) the image, `cover`, `right center`; (3) the original `linear-gradient(135deg, heroFrom, heroTo)` untouched, so a 404 still leaves a correct hero in both themes with zero bytes. No new palette token, no new contrast claim.
- 🔴 **The pack's `Select` CANNOT render icons — it wraps a NATIVE `<select>`.** Its `SelectOption.label` is typed `React.ReactNode`, but it renders into `<option>`, and browsers show text only there. An icon dropdown needs a custom listbox.
- 🔴 **There is no per-type Buzz icon to import, and no upstream PR is warranted.** The native site uses tabler's **generic `IconBolt` — the SAME glyph for all three types**; only the COLOUR differs (blue `#4dabf7`, green `#40c057`, yellow `#f59f00`, from `civitai/src/shared/constants/currency-theme.constants.ts`). `blocks-react` is NOT in the civitai monorepo (`packages/` holds `civitai-ui`, `civitai-buzz`, `civitai-brand` — no blocks-react) and `@civitai/buzz` is `private: true`, so a block app cannot consume either. The shape to mirror is `BuzzTypeSelector` at `civitai/src/components/generation_v2/FormFooter.tsx:241` — a menu whose trigger carries icon + cost + chevron, with a "Pay with" dropdown listing balances.
- 🔴 **A `position: absolute` popup inside `aside[data-testid="yt-rail"]` IS CLIPPED — the rail carries `overflow-y: auto`.** Measured: rail bottom 780, menu bottom 863, the last 83px gone, Green and Yellow unreachable. `z-index` does not help; the clip is an ancestor's overflow, not stacking. Fixed by portalling into the block root with `fixed` positioning recomputed from the trigger's rect on a **capture-phase** scroll listener (scroll does not bubble, so a bubble listener hears only the window, never the rail). ⚠ A `transform`/`filter`/`perspective`/`will-change`/`contain` on any ancestor would make it a containing block for `fixed` and silently re-enable the clip.
- 🔴 **Portalling a popup out of its wrapper breaks outside-click dismissal.** Once the menu is no longer a DOM descendant of the trigger's wrapper, the dismissal handler reads a press ON AN OPTION as "outside" and closes before the click lands — every option unclickable, for a subtler reason than the clip it just fixed. The handler must consult the menu's own ref too.
- 🔴 **`elementFromPoint` reachability: `top.contains(o)` is a FALSE-POSITIVE GENERATOR.** Scoring an ANCESTOR being returned as a hit makes a clipped element read as reachable — it scored the clipped menu as fine and the screenshot disagreed. The correct predicate is `o === top || o.contains(top)`. **Carry a positive control** (a known-visible element) in the same probe, or a reassuring result means nothing.
- 🔴 **When probing the app in the dev harness, the harness's OWN chrome can overlap app DOM and read as a defect.** At 700px a Buzz option reported blocked — the blocker was `SUMMARY`, the harness's `<details data-harness-scenario-panel>` from `Harness.tsx`. **The app renders no `<details>` at all**, so that overlap ships to nobody. Report what `elementFromPoint` actually RETURNS, not just that something blocked.
- 🔴 **You CANNOT probe the block inside a host iframe locally with what exists.** Attempted: the dev server sends `frame-ancestors 'self'`, so a same-origin parent was synthesised via a route interception and the block loaded sandboxed — but it never became interactive, because nothing sends `BLOCK_INIT`. The mock host is **same-document by construction** (`installHarnessTransport` fires from `window.location.origin` in the same window), so there is no iframe-hosting mode. The real routes are `civitai app dev-tunnel` or the live app.
