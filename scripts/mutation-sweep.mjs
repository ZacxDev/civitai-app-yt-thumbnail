#!/usr/bin/env node
// Mutation sweep runner.
//
// WHY THIS IS COMMITTED. Two rounds of format work recorded their sweeps in
// claudedocs/mutation-matrix-formats.md with the note "sweep script not
// committed — re-derive it from the table". The next round's re-verification
// cost exactly that re-derivation, twice. The script is the cheap part; losing
// it makes every future round pay for it again. It lives here now.
//
// WHAT IT DOES. Breaks the implementation on purpose, one narrow edit at a time,
// and reports whether the test that CLAIMS to cover that behaviour is the one
// that fails. A mutant that survives is a guard that does not bite.
//
//   node scripts/mutation-sweep.mjs                        # every mutant in the spec
//   node scripts/mutation-sweep.mjs --only M31,M33         # just these
//   node scripts/mutation-sweep.mjs --spec scripts/mutants-other.mjs
//   node scripts/mutation-sweep.mjs --keep-going           # don't stop on a survivor
//
// 🔴 THE EIGHT THINGS THIS SCRIPT REFUSES TO GET WRONG, each of which has produced
// a confidently false sweep result somewhere before. 6–8 arrived with the lightbox
// set, which used to ship its OWN driver in a second language
// (`scripts/lightbox-mutants.py`, now deleted). Those three were the controls that
// driver had and this one did not — merging the two without them would have LOST
// coverage rather than tidied anything, which is the only interesting part of the
// consolidation.
//
//  1. IT NEVER READS AN EXIT CODE. A wrapper's trailing command swallows the
//     status, and a runner that never started exits 0. Red and green are counted
//     from the runner's OWN per-test result lines, and cross-checked against its
//     summary line — two parses that fail differently.
//  2. IT PROVES THE MUTANT WAS APPLIED. Every `find` must occur EXACTLY the
//     expected number of times, and the file must actually differ afterwards. A
//     `find` that silently matched nothing scores the mutant SURVIVED without
//     ever changing the code.
//  3. IT RUNS A CONTROL FIRST, and refuses to proceed unless the unmutated tree
//     is green with a NON-ZERO test count. A zero from a harness wired to nothing
//     is indistinguishable from a clean run.
//  4. IT DISTINGUISHES AN ASSERTION RED FROM NOISE. An import error, a timeout or
//     an unhandled rejection is NOT a kill — it is a broken mutant. Those are
//     reported separately and never counted.
//  5. IT RESTORES BY CONTENT, NOT BY VCS. Files are copied aside with `cp -a` and
//     copied back; `git checkout --` is never run, because it would also discard
//     uncommitted work this script did not touch. Restoration is verified by
//     hashing every file at the end against the hash taken at the start.
//  6. A KILL MUST BE BY THE INTENDED ASSERTION. A mutant may carry `expect`, a
//     substring of the test title that MUST be among the failures. Any other red
//     scores WRONG-REASON, never KILLED: a different guard's error killing your
//     mutant is green for the wrong reason and stays green with your guard
//     deleted. A mutant with no `expect` is graded on red alone, as before.
//  7. A SHRUNKEN RUN IS INVALID, NOT A KILL. If fewer tests RAN than the control
//     ran, the mutated tree probably did not compile and took the suite red —
//     which scores as a kill for a reason that has nothing to do with the guard.
//  8. A POSITIVE CONTROL CAN VOID THE WHOLE BATCH. A mutant marked
//     `positiveControl: true` is one known to be caught. If it is not KILLED, a
//     stale transform cache (or a runner wired to nothing) has voided every other
//     verdict in the run and NONE of them may be quoted — the report says so and
//     the exit code is non-zero.
//
// Mutants must be ISOLATED: edit the narrowest expression that can be wrong,
// never a guard together with its enclosing condition. Where a mutation would
// trip an unrelated lockstep guard as a side effect (e.g. `formats.ts` vs
// `public/formats/formats.json`), apply it to BOTH files so the guard under test
// is the one that fires — a mutant spec is a list of edits for exactly this.

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --- args -------------------------------------------------------------------

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const SPEC = resolve(ROOT, argOf('--spec', 'scripts/mutants-formats.mjs'));
const ONLY = argOf('--only', null)?.split(',').map((s) => s.trim());
const KEEP_GOING = argv.includes('--keep-going');

const { testFiles, mutants: allMutants } = await import(SPEC);
const mutants = ONLY ? allMutants.filter((m) => ONLY.includes(m.id)) : allMutants;
if (mutants.length === 0) {
  console.error(`no mutants selected (spec has ${allMutants.length})`);
  process.exit(2);
}

// --- the runner, and how its output is read ---------------------------------

const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/**
 * Run the suite over `testFiles` and return what the RUNNER ITSELF said.
 *
 * 🔴 TWO INDEPENDENT PARSES OF THE SAME OUTPUT, and the SPLIT BETWEEN THEM IS
 * NOT SYMMETRIC — which this script learned the hard way, from its own control.
 *
 * vitest's default reporter prints a `× <title>` line for every FAILING test but
 * prints NO `✓` line for a passing one unless it is attached to a TTY. So:
 *   - RED is available twice: counted from the `×` lines AND read off the summary.
 *     Those two are cross-checked, and red is the number that decides
 *     KILLED vs SURVIVED, so it is the one that needs two witnesses.
 *   - GREEN is available only from the summary line. Counting `✓` markers in a
 *     piped run yields a confident ZERO for a fully passing suite — exactly the
 *     "instrument wired to nothing" reading this script exists to refuse. The
 *     first version of this function did that and its own control aborted the run.
 * Never an exit code, in either case.
 */
function runSuite() {
  // 🔴 `--no-cache` IS NOT OPTIONAL, AND LEAVING IT OFF ONCE ALREADY COST A CONTROL.
  // `claude/RULES.md`'s positive-control bullet has TWO halves: a cache keyed on a
  // coarse mtime can serve the ORIGINAL module to a run that believes it is testing
  // a mutant — scoring SURVIVED without the mutant ever executing — so you sweep
  // with the cache off AND keep a known-caught mutant as the control. The first
  // consolidation of this driver kept the detector (control #8) and dropped the
  // preventer, in a PR whose title said no control was lost. Both halves live here
  // now: this flag, and `positiveControl` below.
  //
  // An EMPTY `testFiles` means the WHOLE SUITE, which is what the lightbox set
  // needs — see its own header. `...[]` spreads to nothing, so vitest selects
  // everything, which is exactly the intent.
  const r = spawnSync('npx', ['vitest', 'run', '--no-cache', ...testFiles], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
  });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const count = (re) => (out.match(re) ?? []).length;

  // `Tests  3 failed | 60 passed (63)` — either half may be absent.
  const m = out.match(/^\s*Tests\s+(?:(\d+) failed)?(?:\s*\|\s*)?(?:(\d+) passed)?/m);
  const summary = m ? { red: Number(m[1] ?? 0), green: Number(m[2] ?? 0) } : null;

  // 🔴 Proof the runner REACHED ITS OWN SUMMARY. Without this, a crash before the
  // summary parses as `summary === null` and could be mistaken for a format change
  // rather than for a run that never finished.
  const finished = /^\s*Test Files\s+/m.test(out);

  const lines = { red: count(/^\s*× /gm), green: summary?.green ?? 0 };

  // Noise that is NOT an assertion failure. A mutant "killed" by one of these is
  // not graded — it is a broken mutant, and counting it is how a sweep certifies
  // coverage that does not exist.
  const noise = [];
  if (/Cannot find module|Failed to resolve import/.test(out)) noise.push('import-error');
  if (/Test timed out/.test(out)) noise.push('timeout');
  if (/Unhandled (Rejection|Error)/.test(out)) noise.push('unhandled');
  if (/No .* export is defined on the mock/.test(out)) noise.push('mock-missing-export');

  return { lines, summary, noise, finished, out };
}

/**
 * Is this run's output internally consistent enough to read a verdict from?
 * The summary must exist, the runner must have reached it, and the two RED counts
 * must agree. Anything else is UNREADABLE, never SURVIVED.
 */
const readable = (r) => r.finished && r.summary !== null && r.summary.red === r.lines.red;

/** The per-test titles that went red, so a row can quote the assertion that bit. */
function redTitles(out) {
  return [...out.matchAll(/^\s*× (.+?)(?: \d+ms)?$/gm)].map((m) => m[1].trim());
}

// --- pristine copies --------------------------------------------------------

const touched = [...new Set(mutants.flatMap((m) => m.edits.map((e) => e.file)))];
const stash = mkdtempSync(resolve(tmpdir(), 'mutation-sweep-'));
// 🔴 Individual FILES, never a directory — copying a worktree's root with `cp -a`
// would carry its `.git` FILE along and make the copy share the real git dir.
const saved = new Map();
for (const rel of touched) {
  const from = resolve(ROOT, rel);
  const to = resolve(stash, `${basename(rel)}.${createHash('sha1').update(rel).digest('hex').slice(0, 8)}`);
  execFileSync('cp', ['-a', from, to]);
  saved.set(rel, { to, sha: hash(from) });
}

const restoreAll = () => {
  for (const [rel, { to }] of saved) copyFileSync(to, resolve(ROOT, rel));
};

process.on('exit', () => {
  try {
    restoreAll();
  } catch {
    /* best effort — the hash check below is the real verification */
  }
});

// --- control ----------------------------------------------------------------

console.log(`spec: ${SPEC}`);
// Say WHICH it is out loud: an empty list is the whole suite, and a blank after
// "files under test:" would read as a harness selecting nothing.
console.log(
  `files under test: ${testFiles.length === 0 ? '(THE WHOLE SUITE — no selection)' : testFiles.join(' ')}`,
);
console.log(`files this sweep rewrites: ${touched.join(' ')}`);
console.log(`pristine copies: ${stash}\n`);

console.log('--- CONTROL (unmutated tree) ---');
const control = runSuite();
console.log(
  `  per-test lines: green=${control.lines.green} red=${control.lines.red}` +
    `   summary: green=${control.summary?.green} red=${control.summary?.red}` +
    `   noise: ${control.noise.join(',') || 'none'}`,
);
if (!readable(control)) {
  console.error(
    '\n🔴 ABORT: the control run is UNREADABLE — it did not reach its own summary, ' +
      'or the two RED parses disagree. The output format changed, so no count from ' +
      'this script can be trusted. Fix the parse first.',
  );
  process.exit(3);
}
if (control.lines.red !== 0) {
  // 🔴 NAME THE RED TESTS. This branch used to abort with the count alone, and the
  // first whole-suite sweep hit it — one red out of 933, with no way to tell WHICH,
  // so the failure could not be reproduced or even looked up. An abort the operator
  // cannot act on is barely better than no abort. The titles are already parsed for
  // the per-mutant report; print them here too.
  console.error(
    `\n🔴 ABORT: the UNMUTATED tree is red — ${control.lines.red} of ${
      control.lines.green + control.lines.red
    } test(s). Fix that before sweeping. The red test(s):`,
  );
  for (const t of redTitles(control.out)) console.error(`    × ${t}`);
  console.error(
    '  If this does not reproduce on a plain `npx vitest run`, it is a FLAKE, and a\n' +
      '  flake here voids a whole sweep rather than one test — fix the timing\n' +
      '  dependency, do not re-run until it passes.',
  );
  process.exit(3);
}
if (control.lines.green === 0) {
  console.error(
    '\n🔴 ABORT: the control ran ZERO tests. A harness wired to nothing reports the ' +
      'same clean zero as a passing one — that is not a green, it is an absence.',
  );
  process.exit(3);
}
const EXPECTED_GREEN = control.lines.green;
// 🔴 The control's TOTAL, which is what a later run is measured against. A mutated
// run with fewer tests than this did not merely fail — fewer tests EXECUTED, which
// is what a file that no longer compiles looks like, and it would otherwise score
// as a kill. Red is 0 here (asserted above), so the total is the green count.
const EXPECTED_TOTAL = control.summary.green + control.summary.red;
console.log(`  control OK — ${EXPECTED_GREEN} tests, 0 red. The harness can be read.\n`);

// --- the sweep --------------------------------------------------------------

const results = [];
for (const mut of mutants) {
  console.log(`--- ${mut.id}: ${mut.desc} ---`);

  // Apply, proving each edit actually landed.
  let applied = true;
  for (const e of mut.edits) {
    const path = resolve(ROOT, e.file);
    const before = readFileSync(path, 'utf8');
    const want = e.count ?? 1;
    const got = before.split(e.find).length - 1;
    if (got !== want) {
      console.error(`  🔴 SKIPPED: "${e.find.slice(0, 60)}" occurs ${got}× in ${e.file}, expected ${want}×`);
      applied = false;
      break;
    }
    const after = before.split(e.find).join(e.replace);
    if (after === before) {
      console.error(`  🔴 SKIPPED: the edit to ${e.file} changed nothing`);
      applied = false;
      break;
    }
    writeFileSync(path, after);
  }
  if (!applied) {
    restoreAll();
    results.push({ ...mut, verdict: 'NOT-APPLIED' });
    continue;
  }

  const r = runSuite();
  restoreAll();

  const titles = redTitles(r.out);
  const ran = r.summary ? r.summary.green + r.summary.red : 0;
  // The failing title that the mutant SAID would catch it, if any did.
  const hit = mut.expect ? (titles.find((t) => t.includes(mut.expect)) ?? null) : null;

  const verdict =
    !readable(r) ? 'UNREADABLE'
    : r.noise.length > 0 ? `NOISE(${r.noise.join(',')})`
    : ran < EXPECTED_TOTAL ? `INVALID(${ran}/${EXPECTED_TOTAL})`
    : r.lines.red === 0 ? 'SURVIVED'
    : mut.expect && hit === null ? 'WRONG-REASON'
    : 'KILLED';

  console.log(`  red=${r.lines.red} green=${r.lines.green} ran=${ran}  →  ${verdict}`);
  if (mut.expect) {
    console.log(`    expected killer: "${mut.expect}"  →  ${hit ? `matched: ${hit}` : 'NOT among the failures'}`);
  }
  for (const t of titles.slice(0, 6)) console.log(`    × ${t}`);
  if (titles.length > 6) console.log(`    … and ${titles.length - 6} more`);
  if (verdict === 'NOISE' || r.noise.length > 0) {
    console.log(`  ⚠ noise present (${r.noise.join(',')}) — NOT counted as a kill`);
  }
  console.log();

  results.push({ ...mut, verdict, red: r.lines.red, titles, hit });
  if (verdict === 'SURVIVED' && !KEEP_GOING) {
    console.error('🔴 a mutant SURVIVED — stopping. Pass --keep-going to sweep the rest anyway.');
    break;
  }
}

// --- restoration verified by CONTENT ----------------------------------------

console.log('--- restoration (hashed, not assumed) ---');
let drift = 0;
for (const [rel, { sha }] of saved) {
  const now = hash(resolve(ROOT, rel));
  const ok = now === sha;
  if (!ok) drift += 1;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${rel}`);
}
rmSync(stash, { recursive: true, force: true });

// --- report -----------------------------------------------------------------

const killed = results.filter((r) => r.verdict === 'KILLED').length;
const survived = results.filter((r) => r.verdict === 'SURVIVED');
const wrongReason = results.filter((r) => r.verdict === 'WRONG-REASON');
const invalid = results.filter((r) => r.verdict.startsWith('INVALID'));
console.log(`\n=== ${results.length} mutants: ${killed} killed, ${survived.length} survived ===`);
for (const r of results) {
  const by = r.hit ? `  ← ${r.hit}` : '';
  console.log(`  ${r.id.padEnd(5)} ${r.verdict.padEnd(14)} red=${r.red ?? '-'}  ${r.desc}${by}`);
}
if (survived.length > 0) {
  console.log('\n🔴 SURVIVORS — these guards do not bite:');
  for (const r of survived) console.log(`  ${r.id}: ${r.desc}`);
}
if (wrongReason.length > 0) {
  console.log(
    '\n🔴 WRONG REASON — something went red, but NOT the assertion that claims this\n' +
      '   behaviour. That is green for the wrong reason: it would stay red with the\n' +
      '   intended guard deleted, so it is not evidence the guard bites.',
  );
  for (const r of wrongReason) console.log(`  ${r.id}: expected "${r.expect}" — ${r.desc}`);
}
if (invalid.length > 0) {
  console.log(
    '\n🔴 INVALID — fewer tests RAN than the control ran, so the mutated tree likely\n' +
      '   did not compile. A suite taken red by a build error is not a kill.',
  );
  for (const r of invalid) console.log(`  ${r.id}: ${r.verdict} — ${r.desc}`);
}

// 🔴 THE POSITIVE CONTROL IS GRADED LAST AND CAN VOID EVERYTHING ABOVE. It is a
// mutant known to be caught; if it was not, the runner was not observing the tree
// this run claims to have swept — a stale transform cache does exactly that — and
// every verdict here is unquotable rather than merely suspect.
const controls = results.filter((r) => r.positiveControl);
const brokenControls = controls.filter((r) => r.verdict !== 'KILLED');
if (controls.length === 0) {
  console.log(
    '\n⚠ this spec declares NO positive control. A batch reporting all-survived is\n' +
      '  then indistinguishable from a batch whose runner never executed. Mark one\n' +
      '  known-caught mutant `positiveControl: true`.',
  );
} else if (brokenControls.length > 0) {
  console.log(
    `\n🔴 THE POSITIVE CONTROL DID NOT DIE (${brokenControls.map((r) => `${r.id}=${r.verdict}`).join(', ')}).\n` +
      '   NONE of the verdicts above may be quoted — not the kills and not the\n' +
      '   survivors. Re-run with a cold cache before reading anything from this run.',
  );
} else {
  console.log(`\n✅ positive control(s) died as expected: ${controls.map((r) => r.id).join(', ')}`);
}

if (drift > 0) console.error(`\n🔴 ${drift} file(s) NOT restored. Fix before committing.`);

process.exitCode =
  survived.length > 0 || wrongReason.length > 0 || invalid.length > 0 ||
  brokenControls.length > 0 || drift > 0
    ? 1
    : 0;
