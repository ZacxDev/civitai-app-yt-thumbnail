#!/usr/bin/env python3
"""THE LIGHTBOX'S MUTANT SET, PLUS THE DRIVER THAT SCORES IT.

Run from anywhere:  python3 scripts/lightbox-mutants.py

🔴 WHY THIS IS IN THE REPO AT ALL. A review round for this feature quoted
per-mutant red counts in its PR body that an independent re-run could not
reproduce (it reported one mutant at 10 red; a second run of the same mutant got
5). A number nobody else can get is not evidence, so the set itself is committed
and the PR body quotes VERDICTS and KILLING TEST NAMES only — a red count is a
property of the whole suite on the day, not of the mutant.

🔴 IT GOES LOUD WHEN IT GOES STALE. Every mutant asserts its pattern occurs
EXACTLY ONCE in the named file. Edit the source and a stale mutant reports
PATTERN-NOT-UNIQUE rather than quietly scoring SURVIVED — which is the failure
mode that matters, because a mutant whose edit never landed looks exactly like a
guard that works.

The controls below are each here because a sweep went wrong without one:

  * md5 must CHANGE after the edit and MATCH the backup after the restore, so a
    SURVIVED verdict cannot mean "nothing was mutated" and a passing suite
    afterwards cannot mean "the mutant is still in the tree";
  * the parser is validated against an UNMUTATED run first. If it cannot see all
    of the baseline's tests and zero failures, no verdict below is readable and
    the run aborts — "only N of M tests ran" would otherwise be a fact about the
    regex;
  * verdicts come from the runner's own per-test result lines, never an exit
    code, which a wrapper swallows;
  * a mutant whose run has FEWER tests than the baseline is INVALID, not killed:
    a file that no longer compiles takes the whole suite red and scores as a kill
    for the wrong reason;
  * a kill is credited only when the EXPECTED test name is among the failures. A
    different guard's error killing your mutant is green for the wrong reason and
    stays green with your guard deleted;
  * a POSITIVE CONTROL known to be caught rides in the same batch and the same
    runs. If it ever reports SURVIVED, a stale transform cache has voided every
    other verdict in the batch and none of them may be quoted.

BASELINE_TOTAL has to be updated when the suite's size changes; the parser check
tells you immediately and by how much.
"""
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE_TOTAL = 884

FILES = ["src/lightbox.ts", "src/Lightbox.tsx"]

# (id, file, old, new, substring of the test name that MUST go red)
MUTANTS = [
    # ── THE ONE THIS SET EXISTS FOR. Before the url anchor, the key handler called
    # `stepIndex(at, count, delta)` and the buttons called it too; replacing the
    # handler's call with a bare `at + delta` passed the ENTIRE suite, because
    # `lightboxView` re-clamped the index at render and erased the difference. The
    # claim "one mover, so they cannot disagree" was therefore unguardable. This is
    # the same mutant against the current shape: the handler computes its own
    # neighbour from the index instead of reading the view's.
    (
        "M-A own-arithmetic in the key handler (the mutant that used to survive)",
        "src/Lightbox.tsx",
        """      const next = e.key === 'ArrowLeft' ? prevUrl : nextUrl;
      if (next !== null) onUrlChange(next);""",
        """      const i = urls.indexOf(view.url) + (e.key === 'ArrowLeft' ? -1 : 1);
      onUrlChange(urls[i]);""",
        "clamp as the buttons",
    ),
    # ── The CLAMP-vs-WRAP fork, flipped in the one place neighbours are computed.
    (
        "M-B wrap instead of clamp, both neighbours",
        "src/lightbox.ts",
        """    prevUrl: at > 0 ? urls[at - 1] : null,
    nextUrl: at < count - 1 ? urls[at + 1] : null,""",
        """    prevUrl: at > 0 ? urls[at - 1] : urls[count - 1],
    nextUrl: at < count - 1 ? urls[at + 1] : urls[0],""",
        "does NOT wrap",
    ),
    # ── Prev goes forward and Next goes back. A fixture whose positions were not
    # pairwise distinct would not see this.
    (
        "M-C the two neighbours swapped",
        "src/lightbox.ts",
        """    prevUrl: at > 0 ? urls[at - 1] : null,
    nextUrl: at < count - 1 ? urls[at + 1] : null,""",
        """    prevUrl: at < count - 1 ? urls[at + 1] : null,
    nextUrl: at > 0 ? urls[at - 1] : null,""",
        "ADJACENT pictures",
    ),
    # ── F1's fix undone: a departed picture falls back to a survivor, which is what
    # the index version did and is a different picture under a different heading.
    (
        "M-D a departed picture clamps to a survivor instead of closing",
        "src/lightbox.ts",
        """  if (at < 0) return null;
  const count = urls.length;""",
        """  const count = urls.length;
  if (count === 0) return null;
  if (at < 0) return lightboxView(urls[count - 1], urls, labels);""",
        "LEAVING the row",
    ),
    # ── F2's fix undone: render nothing but keep considering yourself open, so the
    # next non-empty snapshot remounts the dialog with no user input.
    (
        "M-E the emptied view no longer asks the caller to close",
        "src/Lightbox.tsx",
        "    if (orphaned) onClose();",
        "    if (false && orphaned) onClose();",
        "REFILL does not reopen",
    ),
    # ── M-F IS DELIBERATELY ABSENT, AND ITS RESULT IS THE REASON. It removed an
    # explicit "an editable target always keeps its keys" arm from
    # `keysBelongToThisDialog` and SURVIVED the whole suite — 884/884 green with the
    # arm gone. That was not a coverage gap: every editable element in this app sits
    # OUTSIDE the panel, where the containment rule already rejects it, so the arm
    # had no caller at all. The arm was DELETED rather than guarded, which is why its
    # pattern no longer exists to mutate. See the comment on
    # `keysBelongToThisDialog` for the forward hazard that replaced it.
    #
    # ── F3's fix removed entirely: the dialog takes every arrow key on the page.
    (
        "M-G keysBelongToThisDialog always says yes",
        "src/Lightbox.tsx",
        "function keysBelongToThisDialog(target: EventTarget | null, inside: Element | null): boolean {",
        "function keysBelongToThisDialog(target: EventTarget | null, inside: Element | null): boolean {\n  return true;",
        "behind the overlay",
    ),
    # ── Only the containment half removed. This asks whether the in-panel arm is
    # REACHED, not merely present — a guard that never executes is not a guard.
    (
        "M-H the in-panel arm removed, leaving only the unfocused case",
        "src/Lightbox.tsx",
        "  if (panel !== null && target instanceof Node && panel.contains(target)) return true;",
        "  if (false && panel !== null && target instanceof Node && panel.contains(target)) return true;",
        "POSITIVE CONTROL",
    ),
    # ── POSITIVE CONTROL. Known caught, in the same batch and the same runs.
    (
        "PC positive control: 0-based position indicator",
        "src/lightbox.ts",
        "    position: `${at + 1} of ${count}`,",
        "    position: `${at} of ${count}`,",
        "1-BASED",
    ),
]

RESULT = re.compile(r"^\s*(✓|×|✗|↓)\s+\|(node|dom)\|\s+(\S+)\s*>\s*(.*?)\s+\d+ms\s*$")
TESTS_LINE = re.compile(r"^\s*Tests\s+(.*)$")
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def md5(path):
    with open(path, "rb") as fh:
        return hashlib.md5(fh.read()).hexdigest()


def run_suite():
    """The whole suite, both tiers, parsed from its per-test lines."""
    proc = subprocess.run(
        ["npx", "vitest", "run", "--reporter=verbose", "--no-cache"],
        cwd=ROOT, capture_output=True, text=True, timeout=1800,
    )
    out = ANSI.sub("", proc.stdout + proc.stderr)
    passed, failed = [], []
    for line in out.splitlines():
        m = RESULT.match(line)
        if m:
            (passed if m.group(1) == "✓" else failed).append(m.group(4))
    runner_said = ""
    for line in out.splitlines():
        m = TESTS_LINE.match(line)
        if m:
            runner_said = m.group(1).strip()
    return passed, failed, runner_said


def main():
    backup = tempfile.mkdtemp(prefix="lightbox-mutants-")
    base = {}
    for rel in FILES:
        shutil.copy2(os.path.join(ROOT, rel), os.path.join(backup, os.path.basename(rel)))
        base[rel] = md5(os.path.join(ROOT, rel))
    print(f"backup: {backup}\nmd5: {base}\n", flush=True)

    passed0, failed0, said0 = run_suite()
    print(f"-- parser check, UNMUTATED tree: {len(passed0)} passed / {len(failed0)} failed "
          f"(runner said '{said0}')", flush=True)
    if len(passed0) != BASELINE_TOTAL or failed0:
        print("!! the parser disagrees with the runner, or the tree is not green.\n"
              "!! No verdict below would be readable. Aborting.", flush=True)
        return 1

    report = []
    for mid, rel, old, new, expect in MUTANTS:
        path = os.path.join(ROOT, rel)
        src = open(path).read()
        n = src.count(old)
        if n != 1:
            report.append((mid, f"PATTERN-NOT-UNIQUE ({n} occurrences)", "", ""))
            print(f"!! {mid}: pattern occurs {n}x — the set is stale for this file", flush=True)
            continue

        open(path, "w").write(src.replace(old, new))
        if md5(path) == base[rel]:
            report.append((mid, "EDIT-DID-NOT-LAND (md5 unchanged)", "", ""))
            shutil.copy2(os.path.join(backup, os.path.basename(rel)), path)
            continue

        passed, failed, said = run_suite()
        ran = len(passed) + len(failed)
        if ran < BASELINE_TOTAL:
            verdict, hit = f"INVALID (only {ran} of {BASELINE_TOTAL} ran — did it compile?)", ""
        elif not failed:
            verdict, hit = "SURVIVED", ""
        else:
            hit = next((t for t in failed if expect in t), "")
            verdict = "KILLED" if hit else "WRONG-REASON (expected name absent from the failures)"
        report.append((mid, verdict, said, hit or str(failed[:3])))
        print(f"== {mid}\n   {verdict} | runner: {said}\n   killed by: {hit or failed[:3]}\n", flush=True)

        shutil.copy2(os.path.join(backup, os.path.basename(rel)), path)
        if md5(path) != base[rel]:
            print(f"!! RESTORE FAILED for {rel} — the backup is at {backup}", flush=True)
            return 2

    for rel in FILES:
        if md5(os.path.join(ROOT, rel)) != base[rel]:
            print(f"!! final restore check failed for {rel} — backup at {backup}", flush=True)
            return 2
    print("all files restored, md5 verified against the backup\n", flush=True)

    print("ID | VERDICT | runner | killed by")
    for row in report:
        print(" | ".join(str(c) for c in row))
    shutil.rmtree(backup, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
