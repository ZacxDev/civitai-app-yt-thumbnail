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

## The FIRST six built-in formats (2026-09-28, SD XL 1.0, 3 Buzz each)

One shared subject across all six — *"a person at a desk with a glowing laptop,
looking at the camera"* — because a format IS a prompt suffix, so holding the
subject fixed is the only honest way to show what the suffix does. The second
batch of six (below) reuses this exact subject for the same reason.

`public/formats/formats.json` carries the canonical `{label, suffix, preview,
sourceWorkflowId, costBuzz}` for each. Previews are the generated image
cover-cropped to 16:9 and resized to 480×270 WebP (89 KB for all six) — cropped
deliberately, so the preview shows what the user actually receives rather than
the uncropped frame.

Served from `public/`, so they are real build output at `/formats/<id>.webp`.
Note `assets/` at the repo root is STORE-LISTING media and is NOT served to the
app — these two directories are not interchangeable.

## The second batch of six — ART LANDED (2026-10-02, 1254 Buzz)

`minimalist`, `educational`, `professional`, `abstract`, `chaos` and `magic`
shipped first as **code and copy only** — no `preview`, no `sourceWorkflowId`, no
`costBuzz` — and rendered the picker's letter placeholder. That is no longer the
state: **all twelve built-ins now carry generated art.**

Generated **2026-10-02** against the **LIVE backend**: ChatGPT Images
(`civitai generate --ecosystem OpenAI`), quantity 1, `--aspect-ratio 16:9`,
delivered **1536×864**. **209 Buzz each, 1254 Buzz total.**

| format | sourceWorkflowId | Buzz |
|---|---|---|
| `minimalist` | `8753561-20261002022355308-shv0` | 209 |
| `educational` | `8753561-20261002022542859-9ttw` | 209 |
| `professional` | `8753561-20261002022730779-hwuy` | 209 |
| `abstract` | `8753561-20261002022918481-stya` | 209 |
| `chaos` | `8753561-20261002023028233-ydt4` | 209 |
| `magic` | `8753561-20261002023313073-mpt8` | 209 |

**The subject was held fixed** at *"a person at a desk with a glowing laptop,
looking at the camera"* — the **same subject the original six used** (above).
That is not a convenience: a format IS a prompt suffix, so holding the subject
constant is the only honest way to show what the suffix does. A preview generated
from a different subject would advertise the subject, not the format.

### 🔴 Two batches, two models, a 70× price difference

| batch | model | delivered | Buzz each |
|---|---|---|---|
| original six | SD XL 1.0 | 1216×832 (asked for 1280×720 — see the finding above) | **3** |
| second six | ChatGPT Images | **1536×864** (true 16:9) | **209** |

The second batch needed **no crop** — 1536×864 is exactly 16:9, unlike the first
six, which were cover-cropped from 1216×832. All twelve are stored at the repo's
convention: **480×270 WebP**, verified on disk.

Mixing models across one picker is a deliberate trade and worth stating plainly:
the twelve previews are not a controlled comparison *between formats*, because
six were drawn by one model and six by another. They are each an honest sample of
*that* format's suffix. The alternative — regenerating the first six on ChatGPT
Images for consistency — costs another 1254 Buzz and was not taken.

### Evidence: all six passed moderation and the prompt parser

An audit raised that these six suffixes had never faced **content moderation** or
the **server-side prompt parser**, and singled out `minimalist` (its suffix leans
on negation-adjacent phrasing: *"no recognizable objects"* in `abstract`,
*"understated and quiet"* in `minimalist`).

**Answered by measurement: all six generated successfully.** No moderation
rejection, no parse error, no retry on any of the six. Six submits, six images,
1254 Buzz debited — which is itself the proof, since a rejected submit does not
bill. That closes the concern for these exact suffix strings.

⚠ Scope: this is evidence about **these twelve suffix strings as submitted**, at
contentRating `g`, on 2026-10-02. It says nothing about a *viewer's* custom suffix,
which is arbitrary text and faces the same belt with no such evidence.

### Now moot: the placeholder-letter collision

The audit also flagged that `Minimalist` and `Magic` both rendered the
placeholder letter **"M"**, so two cards in the picker were visually identical.
Landing art for all six removes that state entirely — **no previewless built-in
remains**, so no two cards can collide on an initial. No guard was added for it:
a guard for a state that cannot occur is a guard that can never go red.

The placeholder branch itself is **still live code**, and that matters — every
**custom** and every **published** format has no art, permanently, because there
is nowhere for a viewer's own format to get a bundled image from. So
`App.formats.test.tsx` still proves the branch is taken in the real DOM; it just
drives it from a **custom** format now instead of a built-in. The old version
filtered `BUILTIN_FORMATS` for `preview === undefined`, which after this change
selects nothing — it would have passed vacuously rather than failing.

🔴 **Do not fill in a `sourceWorkflowId` for a format whose art has not been
generated.** It is a provenance field naming a generation that really ran; a
made-up one is a false record. `formats.test.ts` now rejects a fabricated id **by
shape** (`^\d{7}-\d{17}-[a-z0-9]{4}$`) and requires `costBuzz > 0`, not merely
co-presence — see the mutation matrix for why that distinction was not academic.
