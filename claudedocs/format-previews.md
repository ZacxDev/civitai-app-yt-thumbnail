# Format previews — provenance, and the 1216×832 finding

Generated 2026-09-28 against the LIVE backend with a `--spend --budget 250` dev
token. Real generations, real Buzz: **57 Buzz total** across 9 workflows (6
previews at 3 each, 2 dimension probes at 3, 1 Flux probe at 33).

## 🔴 The platform IGNORES `params.width` / `params.height`

This app's central claim is that it generates at 1280×720. **It does not.**
Every generation came back **1216×832** (aspect 1.46), whatever was asked for:

| checkpoint | requested | returned |
|---|---|---|
| SD XL 1.0 (default) | 1280×720 | **1216×832** |
| SD XL 1.0 | 1344×768 (a real 16:9-ish SDXL bucket) | **1216×832** |
| FLUX.1 [dev] | 1280×720 | **1216×832** |

Two checkpoints in different ecosystems, three requested sizes, one answer. So
this is not SDXL bucketing — `width`/`height` in the submit body are **inert**.

**What is still true:** the editor cover-crops to 1280×720, so the *downloaded
file* is genuinely 16:9 at the right size. **What is false:** the app's own copy
— "Describe the thumbnail scene. It is generated at 1280×720 (16:9)." It is
generated at 1216×832 and then ~18% of its height is cropped away (1216×832 →
1216×684). The model composes for a frame the user never sees.

That is a real quality issue for a *thumbnail* app — framing decided by the
model gets trimmed top and bottom — and a copy-accuracy issue in the UI, the
manifest `tagline`/`description`, and the store cover art. **Not fixed here;
raised for a decision.** Options: correct the copy to describe the crop, crop
visibly in the UI so the user can reframe, or chase whether any host parameter
actually controls output size.

⚠ Scope of the claim: measured on 2 checkpoints × 3 size requests via
`blocks.submitWorkflow`. Not tested on img2img (`sourceImage` may behave
differently — it has a source aspect to honour) or with `quantity > 1`.

## Cost data (useful for the budget work)

SD XL 1.0 priced at **3 Buzz** per 1280×720 image; FLUX.1 [dev] at **33** — an
11× spread on the same request. Quantity 4 on Flux ≈ 132, still inside the
250 dev-token cap, but a pricier checkpoint could cross it.

## RESOLVED: CORS on generated images — the canvas editor works

The open question was whether `canvas.toBlob` can export a generated image. It
can. Generated images serve from `orchestration-new.civitai.com`, which
**reflects any Origin**, and the 🔴 decisive case is `Origin: null` — because
the block's sandbox has no `allow-same-origin`, its real origin is opaque:

```
Origin: null → 301 access-control-allow-origin: null
             → 200 access-control-allow-origin: null   content-type: image/jpeg
```

Both hops of the redirect carry the header, which matters: a chain fails CORS if
any single hop omits it. So `crossOrigin='anonymous'` loads clean, the canvas is
not tainted, and export works.

## The six built-in formats

One shared subject across all six — *"a person at a desk with a glowing laptop,
looking at the camera"* — because a format IS a prompt suffix, so holding the
subject fixed is the only honest way to show what the suffix does.

`public/formats/formats.json` carries the canonical `{label, suffix, preview,
sourceWorkflowId, costBuzz}` for each. Previews are the generated image
cover-cropped to 16:9 and resized to 480×270 WebP (89 KB for all six) — cropped
deliberately, so the preview shows what the user actually receives rather than
the uncropped frame.

Served from `public/`, so they are real build output at `/formats/<id>.webp`.
Note `assets/` at the repo root is STORE-LISTING media and is NOT served to the
app — these two directories are not interchangeable.

## The second batch of six — NO ART, and that is the shipped state

`minimalist`, `educational`, `professional`, `abstract`, `chaos` and `magic` were
added as **code and copy only**. They carry a `label` and a `suffix` and nothing
else: no `preview`, no `sourceWorkflowId`, no `costBuzz`. `Format.preview` is
optional and `FormatPicker` branches on it, so they render the letter placeholder
inside the same 16/9 box — no broken-image icon, no layout jump. That is asserted
in `App.formats.test.tsx` ("the picker renders EVERY built-in, with or without
preview art") in both directions, with a positive control that proves the
`<img>`-present assertion can actually see an image.

🔴 **Do not fill in a `sourceWorkflowId` for these.** It is a provenance field
naming a generation that really ran; a made-up one is a false record, and the
guard in `formats.test.ts` ("the JSON provenance triple travels TOGETHER")
rejects a `sourceWorkflowId` without a `preview` *and* a `preview` without a
`sourceWorkflowId` for exactly that reason.

Art for these six is a separate, operator-gated step: ChatGPT Images, ~209 Buzz
each, delivering 1536×864 (true 16:9, so no crop needed — unlike the first six).
Nothing in this change generated anything or spent anything. When the art lands,
add all three fields per format in one edit and the guard goes green on its own.
