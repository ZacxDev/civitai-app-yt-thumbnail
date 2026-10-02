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
// 🔴 THE FIVE THINGS THIS SCRIPT REFUSES TO GET WRONG, each of which has produced
// a confidently false sweep result somewhere before:
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
 * 🔴 Two independent parses of the same output. `lines` counts the per-test
 * result markers; `summary` reads the "Tests N failed | M passed" line. They are
 * cross-checked by the caller: if they disagree, the output format changed and no
 * verdict from this run may be trusted. Never an exit code.
 */
function runSuite() {
  const r = spawnSync('npx', ['vitest', 'run', ...testFiles], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
  });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const count = (re) => (out.match(re) ?? []).length;

  const lines = { red: count(/^\s*× /gm), green: count(/^\s*✓ /gm) };

  // `Tests  3 failed | 60 passed (63)` — either half may be absent.
  const m = out.match(/^\s*Tests\s+(?:(\d+) failed)?(?:\s*\|\s*)?(?:(\d+) passed)?/m);
  const summary = m ? { red: Number(m[1] ?? 0), green: Number(m[2] ?? 0) } : null;

  // Noise that is NOT an assertion failure. A mutant "killed" by one of these is
  // not graded — it is a broken mutant, and counting it is how a sweep certifies
  // coverage that does not exist.
  const noise = [];
  if (/Cannot find module|Failed to resolve import/.test(out)) noise.push('import-error');
  if (/Test timed out/.test(out)) noise.push('timeout');
  if (/Unhandled (Rejection|Error)/.test(out)) noise.push('unhandled');
  if (/No .* export is defined on the mock/.test(out)) noise.push('mock-missing-export');

  return { lines, summary, noise, out };
}

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
console.log(`files under test: ${testFiles.join(' ')}`);
console.log(`files this sweep rewrites: ${touched.join(' ')}`);
console.log(`pristine copies: ${stash}\n`);

console.log('--- CONTROL (unmutated tree) ---');
const control = runSuite();
console.log(
  `  per-test lines: green=${control.lines.green} red=${control.lines.red}` +
    `   summary: green=${control.summary?.green} red=${control.summary?.red}` +
    `   noise: ${control.noise.join(',') || 'none'}`,
);
if (!control.summary || control.summary.red !== control.lines.red) {
  console.error(
    '\n🔴 ABORT: the two parses of the runner output DISAGREE. The output format ' +
      'changed, so no count from this script can be trusted. Fix the parse first.',
  );
  process.exit(3);
}
if (control.lines.red !== 0) {
  console.error('\n🔴 ABORT: the UNMUTATED tree is red. Fix that before sweeping.');
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

  const agree = r.summary && r.summary.red === r.lines.red;
  const verdict =
    !agree ? 'UNREADABLE'
    : r.noise.length > 0 ? `NOISE(${r.noise.join(',')})`
    : r.lines.red > 0 ? 'KILLED'
    : 'SURVIVED';

  const titles = redTitles(r.out);
  console.log(`  red=${r.lines.red} green=${r.lines.green}  →  ${verdict}`);
  for (const t of titles.slice(0, 6)) console.log(`    × ${t}`);
  if (titles.length > 6) console.log(`    … and ${titles.length - 6} more`);
  if (verdict === 'NOISE' || r.noise.length > 0) {
    console.log(`  ⚠ noise present (${r.noise.join(',')}) — NOT counted as a kill`);
  }
  console.log();

  results.push({ ...mut, verdict, red: r.lines.red, titles });
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
console.log(`\n=== ${results.length} mutants: ${killed} killed, ${survived.length} survived ===`);
for (const r of results) {
  console.log(`  ${r.id.padEnd(5)} ${r.verdict.padEnd(12)} red=${r.red ?? '-'}  ${r.desc}`);
}
if (survived.length > 0) {
  console.log('\n🔴 SURVIVORS — these guards do not bite:');
  for (const r of survived) console.log(`  ${r.id}: ${r.desc}`);
}
if (drift > 0) console.error(`\n🔴 ${drift} file(s) NOT restored. Fix before committing.`);

process.exitCode = survived.length > 0 || drift > 0 ? 1 : 0;
