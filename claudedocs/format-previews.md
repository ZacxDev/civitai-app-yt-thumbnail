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

🔴 **SUPERSEDED 2026-10-02 — this section describes the ART THAT IS NO LONGER
SHIPPED.** All six were regenerated on ChatGPT Images; see §"The first six,
REGENERATED". The `sourceWorkflowId`s recorded here are not the ones in
`formats.json` any more, and the cover-crop paragraph below is no longer how
these previews are made. Kept because it is the provenance of the SD XL art and
the origin of the held-fixed subject, not because it is current.

One shared subject across all six — *"a person at a desk with a glowing laptop,
looking at the camera"* — because a format IS a prompt suffix, so holding the
subject fixed is the only honest way to show what the suffix does. The second
batch of six (below) reuses this exact subject for the same reason.

`public/formats/formats.json` carries the canonical `{label, suffix, preview,
sourceWorkflowId, costBuzz}` for each. The SD XL previews were the generated
image cover-cropped to 16:9 and resized to 480×270 WebP (89 KB for all six) —
cropped deliberately, so the preview showed what the user actually receives
rather than the uncropped frame. **That crop step is gone**: ChatGPT Images
delivers a true 16:9 frame, so the current art is resized and not cropped.

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

### 🔴 Two batches, two models, a 70× price difference — CLOSED 2026-10-02

🔴 **THIS IS NOW HISTORY, NOT THE STATE.** The mixed-model picker described here
lasted one day: the operator took the alternative this section's last sentence
said was "not taken". All twelve previews are now ChatGPT Images at 209 Buzz.
The table is kept because the 70× spread is a real pricing fact worth having.

| batch | model | delivered | Buzz each |
|---|---|---|---|
| original six (2026-09-28, **replaced**) | SD XL 1.0 | 1216×832 (asked for 1280×720 — see the finding above) | **3** |
| second six (2026-10-02) | ChatGPT Images | **1536×864** (true 16:9) | **209** |
| original six, REGENERATED (2026-10-02) | ChatGPT Images | **1536×864** (true 16:9) | **209** |

The ChatGPT Images batches need **no crop** — 1536×864 is exactly 16:9, unlike
the SD XL art, which was cover-cropped from 1216×832. All twelve are stored at
the repo's convention: **480×270 WebP**, verified on disk.

## The first six, REGENERATED (2026-10-02, 1254 Buzz) — the picker is now ONE model

`clickbait`, `cinematic`, `bold-simple`, `tech-review`, `tutorial` and `gaming`
were re-drawn on ChatGPT Images so that all twelve cards come from one model.
**Operator decision, taken after seeing the twelve-card picker live on 0.1.10.**
The suffixes are UNCHANGED — only the art moved — so the cards still show what
each suffix does; what changed is that comparing two cards now compares two
*formats* rather than two *models*.

| format | sourceWorkflowId | Buzz |
|---|---|---|
| `clickbait` | `8753561-20261002054934746-1qkg` | 209 |
| `cinematic` | `8753561-20261002055520845-z42s` | 209 |
| `bold-simple` | `8753561-20261002055707344-6gjt` | 209 |
| `tech-review` | `8753561-20261002055750302-g93k` | 209 |
| `tutorial` | `8753561-20261002055858829-by21` | 209 |
| `gaming` | `8753561-20261002060045425-9p8h` | 209 |

Same subject, same composition as both earlier batches: the prompt submitted was
`"<subject>, <suffix>"`, matching the app's own `composePrompt()` joiner, with the
subject held at *"a person at a desk with a glowing laptop, looking at the
camera"*.

**Measured, not assumed:**

- 🔴 **The price was verified by a CONTROL PAIR before spending**, because an
  ecosystem spelling the server does not recognise is billed silently at the
  default model's price. `--ecosystem OpenAI` → **209**; the identical request
  with **no** `--ecosystem` → **8**. The 209 is therefore ChatGPT Images and not
  a typo that fell through to the default. All six dry-ran at 209.
- **The spend reconciles exactly.** Balance **4,061,060 → 4,059,806**, a delta of
  **1,254** = 6 × 209. Read before and after with `civitai buzz`.
- **All six delivered 1536×864**, by `magick identify`, so none was cropped —
  only resized to 480×270 WebP.
- **All six passed moderation and the prompt parser**: six submits, six images,
  no rejection and no retry. A rejected submit does not bill, so the reconciled
  1254 is itself the evidence.

⚠ **Two things to LOOK at rather than infer, both a consequence of the model
rendering legible text where SD XL could not:** the `clickbait` draw carries a
baked-in headline (*"$10,000 A DAY?!"*) and a YouTube play-button mark, and the
`gaming` draw carries several garbled text fragments. Both are honest output of
their own suffix — `clickbait`'s suffix literally begins *"youtube thumbnail"* —
but a third-party mark in shipped app art is a judgement call, not a fact, and it
is recorded here so the next reader does not have to re-derive why it is there.

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
