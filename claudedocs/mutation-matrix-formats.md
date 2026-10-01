# Mutation matrix — formats, storage, multi-workflow money path

Evidence that the guards added in the formats/storage batch actually bite.

**Why this file exists.** Almost every test added in this batch covers code that
did not exist at the base ref (`origin/main`, `e2c3108`). Running them there
fails on `Cannot find module './formats.js'` — an *import* error, not an
assertion. That is a **vacuous red** and proves nothing, so "red at base" is not
available as evidence for most of this work. Mutation testing is: break the
implementation on purpose, and confirm the *specific* assertion that claims to
cover it is the one that fails.

Sweep script: `scratchpad/mutate.sh` (not committed — it rewrites `src/` and
restores from a pristine copy). Re-derive it from the table below if needed.

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
