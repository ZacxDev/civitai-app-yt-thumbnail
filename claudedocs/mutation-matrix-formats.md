# Mutation matrix — formats, storage, multi-workflow money path

Evidence that the guards added in the formats/storage batch actually bite.

**Why this file exists.** Almost every test added in this batch covers code that
did not exist at the base ref (`origin/main`, `e2c3108`). Running them there
fails on `Cannot find module './formats.js'` — an *import* error, not an
assertion. That is a **vacuous red** and proves nothing, so "red at base" is not
available as evidence for most of this work. Mutation testing is: break the
implementation on purpose, and confirm the *specific* assertion that claims to
cover it is the one that fails.

🔴 **THE SWEEP SCRIPT IS NOW COMMITTED: `scripts/mutation-sweep.mjs`, with its
mutant list in `scripts/mutants-formats.mjs`.** This file used to say "not
committed — re-derive it from the table below", twice, for two different batches.
The next round's re-verification cost exactly that re-derivation, twice. Run it:

```
node scripts/mutation-sweep.mjs                 # every mutant in the spec
node scripts/mutation-sweep.mjs --only M25      # one
node scripts/mutation-sweep.mjs --keep-going    # don't stop at the first survivor
```

Batch 1 and batch 2 below were run with the earlier throwaway scripts
(`scratchpad/mutate.sh`, `scratchpad/{mutants.mjs,sweep.sh}`), which no longer
exist; their rows are reproducible by porting the mutation into the spec file.
Batch 3 was run with the committed script.

## Method

- Each mutant edits the **narrowest expression** that can be wrong — never a
  guard together with its enclosing condition.
- The sweep reads the runner's **own per-test result lines** (`grep -cE '^\s+×'`),
  not an exit code: a wrapper's trailing command swallows the status.
- **Both controls were exercised.** Positive: the unmutated tree reports 0 red
  across all four files. Negative: every mutant reports a non-zero count, so the
  harness demonstrably *can* go red.
- Fixtures were chosen pairwise-distinct and distinct from any constant an
  assertion names, so no mutant can survive by arithmetic coincidence. Two
  fixture collisions were found and fixed this way (`upsertCustomFormat`'s cap
  case reused an id already in the list; the Generate-button price test used
  33/66 rather than a value a single-run mutant could also produce).

## Results — 10 mutants, 10 killed, 0 survived

> 🔴 **M2 IS WITHDRAWN, NOT RE-RUN.** It read "`aggregateSpend` falls back to the
> **estimate** when no actual cost is known", killed by `multiworkflow.test.ts`'s
> "🔴 NEVER falls back to the estimate when no run reported a cost". `aggregateSpend`
> was deleted with the `pm-spent` alert and that test was deleted with it, so the row
> certified a mutant against a test that no longer exists — a worse state than no row,
> because it reads as coverage. The RULE survived the deletion: `joinHistory` sums only
> finite `AppWorkflow.cost` values and renders `—` when nothing reported one, and
> `history.ts`'s `mergeLiveWorkflows` note states why an estimate may never stand in for
> a realized cost. That rule's own coverage is in `history.test.ts`, under
> `joinHistory`; it has NOT been mutation-graded, and this note does not claim it has.
> The count above is 10 because M2 is gone, not because a mutant was re-numbered.

| # | Mutation | Killed by |
|---|---|---|
| M1 | `sharedValueForFormat` puts the suffix in **`data`** instead of `body` | `formats.test.ts` "puts the suffix in \`body\`, NEVER in \`data\`"; `App.formats.test.tsx` "appends \`{title, body}\` … NO user text in \`data\`" (3 red) |
| ~~M2~~ | *withdrawn — see the note above. The function and its killing test were both deleted.* | — |
| M3 | `overallPhase` ranks **failure above success** | `multiworkflow.test.ts` "🔴 lets SUCCESS outrank FAILURE — the partial-failure contract" (1 red) |
| M4 | `ACCOUNT_DEFAULT_ORDER` reversed to yellow → green → blue | 5 ladder cases in `multiworkflow.test.ts` **plus** the e2e wire assertion "defaults to the first sufficient pool (blue) and threads it on the body" (6 red) |
| M5 | `composePrompt` clamps naively, dropping the paid-for suffix on overflow | `multiworkflow.test.ts` "🔴 RESERVES room for the suffix, trimming the USER prompt instead" (1 red) |
| M6 | `toggleFormat` allows deselecting the **last** format | `formats.test.ts` "🔴 REFUSES to deselect the last remaining format" (1 red) |
| M7 | `formatFromSharedItem` falls back to the unmoderated `data.suffix` | `formats.test.ts` "🔴 REJECTS an entry whose suffix is only in \`data\`"; `App.formats.test.tsx` "🔴 DROPS a published entry whose text is only in the unmoderated \`data\`" (3 red) |
| M8 | `aggregateEstimate` returns **one run's** cost instead of the sum | `multiworkflow.test.ts` "sums the per-run estimates"; `App.formats.test.tsx` "🔴 prices the Generate button with the SUM across formats" (2 red) |
| M9 | a failed run **discards every** run's candidates | `multiworkflow.test.ts` "🔴 keeps a failed run from discarding the other runs images"; `App.formats.test.tsx` "🔴 PARTIAL FAILURE …" (2 red) |
| M10 | `patchRun` writes **every** row, not just the addressed one | `multiworkflow.test.ts` "🔴 patches ONE run and leaves its siblings byte-identical"; `App.formats.test.tsx` "🔴 PARTIAL FAILURE …" (3 red) |
| M11 | `App` submits only the **first** selected format | `App.formats.test.tsx` "🔴 submits ONE workflow PER selected format" + 3 others (4 red) |

Separately, the `public/formats/formats.json` lockstep guard was mutation-checked
on its own: a one-character suffix drift and a broken preview path each failed
the intended assertion and nothing else, with the restored tree green.

## Second batch: 6 → 12 built-in formats — 13 mutants, 13 killed, 0 survived

Run 2026-10-01 at commit `f16b01b`, over `src/formats.test.ts` +
`src/App.formats.test.tsx` only (63 tests). Run with the throwaway
`scratchpad/{mutants.mjs,sweep.sh}`, which no longer exists — the committed
`scripts/mutation-sweep.mjs` replaced it; port a row into
`scripts/mutants-formats.mjs` to re-run it. Then as now: it rewrites `src/` and
`public/` and restores from a `cp -a` pristine copy, never `git checkout --`.

**Both controls exercised.**
- *Positive / negative control:* the unmutated tree reported **green=63 red=0**,
  and every one of the 13 mutants reported red ≥ 1 — so the harness demonstrably
  can go both ways. Counts come from the runner's **own per-test result lines**
  (`grep -cE '^ *× '`), not an exit code, and each run was also grepped for
  `Cannot find module` / `Test timed out` / `Unhandled Rejection` so an import
  error or a timeout could not be mis-read as an assertion red.
- *Restoration verified by content:* `md5sum -c` against a baseline taken before
  the sweep — all five touched files `OK` afterwards.
- *Isolation:* where a mutant would otherwise trip the `formats.ts` ↔
  `formats.json` lockstep guard as a side effect, it was applied to **both**
  files, so the guard under test is the one that fires.

| # | Mutation | Killed by — and the assertion message that proves it |
|---|---|---|
| M12 | a **13th** built-in appended to both files | ledger comparison + mirror + previewless-set (3 red) |
| M13 | `magic` **deleted** from both files | same three (3 red) — the ledger fails on shrink as well as growth, which is the claim |
| M14 | `DEFAULT_FORMAT_ID = BUILTIN_FORMATS[**1**].id` | "the default format is still \`clickbait\`, and still FIRST" → **`expected 'cinematic' to be 'clickbait'`** (6 red) |
| M15 | `abstract`'s suffix set equal to `chaos`'s | "no two built-ins share a suffix" → **`two built-ins share a suffix`** (1 red, isolated) |
| M16 | `magic`'s suffix blanked to `'   '` | "non-empty suffix" → **`magic has a blank suffix`** (1 red, isolated) |
| M17 | a `#` inserted into `abstract`'s suffix | "no built-in suffix contains a character the generator eats" → **`…suffix contains a wildcard character`** (1 red, isolated) |
| M18 | `magic` declares `/formats/magic.webp` — **art that does not exist** | "every DECLARED preview path resolves to a file that is actually shipped" → **`missing preview file for magic`** (3 red) |
| M19 | `magic` given a **fabricated** `sourceWorkflowId`, no preview | provenance triple → **`magic declares a workflow id but no preview`** (1 red, isolated) |
| M20 | `gaming`'s `sourceWorkflowId` removed, art kept | provenance triple → **`gaming has art but no sourceWorkflowId`** (1 red, isolated) |
| M21 | `gaming`'s art silently **lost** (preview + provenance removed from both files) | preview-exists loop's own count → **`expected 5 to be 6`**, plus provenance and previewless-set (**3 red** — see the correction below) |
| M22 | `FormatPicker`: `fmt.preview ?` → `fmt.preview !== null ?` (so `undefined` renders `<img src={undefined}>`) | "a format with NO preview renders a placeholder, never an \<img\>" → **`minimalist has no art but rendered an <img>`** (1 red, isolated) |
| M23 | `aspectRatio: '16 / 9'` deleted from `previewWrapStyle` | "the preview box reserves 16/9 whether or not there is art" (1 red, isolated) |
| M24 | `FormatPicker` renders `formats.slice(0, 6)` | "renders one chip per built-in, found by its own exact id" + 5 others (6 red) |

**The preview-file-exists guard was demonstrated in BOTH directions, which is the
whole reason it exists.** It passes today with six formats declaring art (all
present) and six declaring none; M18 is the other direction — a format that
declares art which is *not* on disk, and the guard names it. The in-test positive
control (`/formats/clickbait.webp` → true, `/formats/no-such-format.webp` →
false) covers the third failure mode: the loop is now conditional, so a loop that
iterates zero times would otherwise pass while checking nothing. M21 is the
control for that specific hazard and it fires on the `checked` count, not on a
path.

### Honest notes on this batch

- 🔴 **M21's count was WRONG: 3 red, not 4.** An adversarial audit reproduced the
  mutant and got three. The row had counted the `formats.ts` ↔ `formats.json`
  **mirror** guard among the firing assertions, and the mirror **cannot** fire for
  this mutant: M21 removes the art from **both** files, so the two sides still
  agree with each other — agreement is the only thing the mirror checks. Corrected
  in the table above. Independently corroborated by **M34** in batch 3, which is
  the same mutation re-run at the twelve-with-art tree: four assertions fire there
  and the mirror is **not** among them.
  The lesson is the one that keeps recurring in this file: **a mutant that fires N
  guards is not evidence about any ONE of them**, and a count copied from a
  reading-of-the-output rather than from the output is a claim, not a measurement.
- **M14 produced one collateral timeout.** `App.formats.test.tsx`'s
  partial-failure case timed out at 5000ms rather than asserting, because moving
  the default selection invalidates that test's fixture. That red is **not** the
  kill being claimed; the kill is the unit assertion quoted in the table. A
  timeout is not evidence, so it is named here rather than counted.
- **M12/M13 each fire three guards, not one.** `BUILTIN_LEDGER` and
  `WITH_PREVIEW_ART` are both literal lists, so changing the set disagrees with
  both of them plus the JSON mirror. That is over-coverage, not a defect — but it
  means none of those three rows is independently graded by M12/M13 alone. M19,
  M20 and M21 grade the provenance and previewless guards in isolation.
- **Nothing here touches the live backend, and no Buzz was spent.** The six new
  formats ship with no preview art precisely because generating it is a separate
  gated step.

## Third batch: the audit fix round — 11 mutants, 11 killed, 0 survived

Run 2026-10-02 with the **committed** `scripts/mutation-sweep.mjs` over
`src/formats.test.ts` + `src/App.formats.test.tsx` (**71 tests**, up from 63).
Mutant definitions: `scripts/mutants-formats.mjs`.

**Both controls exercised, and the script enforces them rather than trusting the
operator.** The unmutated tree reported `green=71 red=0` and the run refuses to
proceed on a red control *or* a zero-test control. Every one of the 11 mutants
reported red ≥ 1. Restoration verified by **SHA-256 per file** against hashes taken
before the sweep — all four touched files `OK`; `git checkout --` is never used.

🔴 **THE SCRIPT'S OWN CONTROL CAUGHT A DEFECT IN THE SCRIPT, on its first run.**
The first version counted green from the runner's `✓` per-test lines. vitest's
default reporter prints `×` for every failing test but prints **no `✓` line at all
unless attached to a TTY**, so a fully passing suite scored `green=0` — and the
control aborted with "the control ran ZERO tests", which is exactly right. Had the
script read an exit code instead, it would have sailed on and scored every mutant
against a harness it could not actually read. Red is now counted **twice** (the `×`
lines *and* the summary line, which must agree); green comes from the summary only,
because in a piped run it is the sole witness.

| # | Mutation | Killed by — and the assertion message that proves it |
|---|---|---|
| **M25** | 🔴 **THE AUDITOR'S EXACT PROBE.** `magic` keeps its real art, gets `sourceWorkflowId: 'TOTALLY-MADE-UP-NEVER-RAN'` **and** `costBuzz: 0` | provenance triple → **`magic's sourceWorkflowId is not shaped like a real workflow id: expected 'TOTALLY-MADE-UP-NEVER-RAN' to match /^\d{7}-\d{17}-[a-z0-9]{4}$/`** (1 red, isolated) |
| M26 | **only** a fabricated `sourceWorkflowId` on `magic`, `costBuzz` left correct | same assertion, same message (1 red) — isolates the SHAPE half |
| M27 | **only** `costBuzz: 0` on `magic`, id left real | provenance triple → **`magic has art but claims it cost nothing to generate: expected 0 to be greater than 0`** (1 red, isolated) — isolates the COST half |
| M28 | `WORKFLOW_ID_SHAPE` loosened to `/^.*$/` | "the workflow-id shape check can REJECT" (1 red, isolated) — grades the regex's own negative control, so the shape check cannot be silently widened |
| M29 | `suffixWildcardReason` made inert (`if (true) return null`) | 5 red: the four unit cases in `formats.test.ts` **plus** `App.formats.test.tsx`'s "REFUSES to publish a suffix carrying the wildcard `#`" |
| M30 | `validateCustomFormat` stops calling the predicate — the SAVE path loses the rule | 4 red (same minus the direct predicate test) |
| M31 | the **PUBLISH** gate in `App.tsx` disabled (`if (false && why)`) — save still guarded | **1 red, isolated**: only "REFUSES to publish a suffix carrying the wildcard `#`". This is what proves publish is covered *separately* from save |
| M32 | 🔴 **THE INVERSION**: `parseCustomFormats` starts REJECTING a stored `#` suffix — i.e. validating on LOAD | 2 red, led by "the `#` rule is checked on SAVE and NOT on LOAD — a stored format stays loadable". This is the mutant that proves the save-vs-load **direction** is asserted and not merely described in a comment |
| M33 | `hasPreviewArt` reverted to the old test predicate `fmt.preview !== undefined` | "`hasPreviewArt` is ONE predicate, and it rejects the placeholder values" (1 red, isolated) — the `''`/`null` split that test and component used to disagree about |
| **M34** | 🔴 `gaming`'s art silently **lost** — preview + provenance removed from both files (**M21 re-run at twelve-with-art**) | 4 red: provenance triple, preview-path-exists, "EVERY built-in has art now", and the App-level `<img>`-per-built-in test. 🔴 **The mirror guard is NOT among them**, which is the independent corroboration of the M21 correction above |
| M35 | `magic` loses only its `preview`, provenance kept — a provenance line for a file that is not there | same 4 (4 red) |

### What batch 3 establishes, and what it does not

- **The 🟡1 acceptance criterion is met by measurement.** The exact tree the audit
  used to pass all 63 tests with rc 0 — real art, fabricated id, `costBuzz: 0` —
  now fails on the new assertion's **own message**, quoted verbatim in the M25 row.
  M26 and M27 split that into its two halves so neither is riding on the other.
- 🔴 **A SHAPE CHECK IS NOT PROOF THE WORKFLOW RAN.** `^\d{7}-\d{17}-[a-z0-9]{4}$`
  rejects a hand-typed placeholder; it would accept a *well-formed* fabrication
  (`1111111-11111111111111111-aaaa`). Only the backend can confirm a generation
  existed, and nothing in this repo queries it. The claim is exactly as narrow as
  that, and the guard's own comment says so.
- **M31's isolation is the load-bearing one for 🟡2.** The save path and the
  publish path are two call sites of one predicate, and M31 disables *only* the
  publish site. A single red there is what distinguishes "both paths are covered"
  from "the save test happens to also fail".
- **Nothing here touched the live backend and no Buzz was spent.** The six
  generations that produced this batch's art were a separate step, recorded in
  `claudedocs/format-previews.md`.

## Honest note on M2

M2 produced **one** red, not two. The App-level partial-failure test does not see
it, because in that scenario the surviving run *does* report an actual cost, so
the mutant's fallback branch is never reached. The unit test is the only thing
covering "no run reported a cost at all". That is a real gap in the App-level
test's reach and is recorded here rather than papered over.

## What this does NOT establish

- It says nothing about the **live backend**. Only the `estimate()` scope probe
  (below) touched production.
- It says nothing about **anonymous storage rejection in production**. The mock
  host does not enforce it and no anonymous live session was run; the app's
  behaviour is asserted at the hook boundary only.
- The consent-gated scopes (`apps:storage:*`) have **never been granted on any
  account** — declaring them in the manifest does not grant them. First real use
  will hit a consent prompt, and a 403 before that is expected, not a bug.

## The `estimate()` scope probe (2026-09-28)

Measured directly against `https://civitai.com/api/trpc/blocks.estimateWorkflow`,
the same procedure `blocks-react`'s live host calls.

| token | scopes | result |
|---|---|---|
| control, `--spend --budget 250` | `ai:write:budgeted`, `user:read:self` | **HTTP 200**, `cost.total: 3`, `spentAccountType: "blue"` |
| probe, no `--spend` | `user:read:self` | **HTTP 403** `block lacks ai:write:budgeted scope` (`FORBIDDEN`) |

**`estimate()` requires the budgeted scope.** There is no way to price the
Generate button before the viewer consents, so the app keeps consent-on-first-
Generate and shows no price until then.

Instrument validation matters here: the *first* attempt at this probe returned
Cloudflare `error code: 1010` for **both** tokens — the control failed, so the
verdict was unreadable. Re-running with browser-shaped headers (`user-agent`,
`origin`, `referer`) produced the split above. A 403 read without the passing
control would have been indistinguishable from a malformed request.

Incidental pricing measured on the same run (SD XL 1.0, 1280×720 requested):
quantity 1 → 3 Buzz, 2 → 6, 4 → 10. All far below the manifest's per-workflow
`buzzBudgetPerGen: 300`.
