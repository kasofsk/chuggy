---
name: review-discipline
description: "How much review a change gets on chuggy: running code gets a fresh context-free reviewer every fix round; docs get one factual review; hypothetical findings get no round at all"
metadata:
  type: feedback
---

**Running code: every fix round is reviewed as new work.** Measured over the
2026-08-30 selector-prerequisites effort (#436 #437 #438): every adversarial
review found real defects, and **every fix round introduced at least one new
one** — #436's invalidate-on-401 fix created an issuer-outage amplifier (20
refused reads → 20 grants) and its floor fix then stranded the client for 7131
reads across a backwards clock step; #437's per-project pause clamp made one
project's edit stop the whole sweep *and* advance the cursor past an unscanned
project. Scope the re-review to the fix commit and tell the reviewer explicitly
that fix rounds are where defects get in, because the author is working down a
list believing the hard thinking is done.

Scope (Geoff, 2026-09-06): `src/`, `test/`, migrations, `cluster/` manifests,
gate scripts. Merge only on a review that came back clean on its own merits.

**No planted defects (Geoff, 2026-09-04).** The reviewer stays a fresh subagent
with no shared context — never a fork — and MAY be told what the code is
supposed to do: the issue, the intended behaviour, the acceptance criteria. It
must NOT get the implementor's context: the reasoning, the argument for why the
change is correct, the notes. Telling the reviewer the spec is fine; telling it
the argument is what makes it agree with the author. Planting (9/9 caught
2026-08-30) was a calibration device, now retired.

**Docs get ONE factual review, then land.** It checks every claim against
artefacts — registry, rig rows, logs. Shape (wrap, markers, wording) is the
author's own check and never a review round. Six rounds on fabric #163's README
entry is the failure this rule answers; Geoff: *"did we just have like 4 rounds
nitting on some readme file? what is going on?"* — and two of the six were
catching defects my own rewrap script had introduced. Diff and eyeball any
scripted edit before sending it to a reviewer.

**Two nit-only FIX verdicts in a row end the reviewing.** Leftover nits go in a
follow-up or are dropped.

**A finding must name a failure that actually happens.** Geoff, 2026-09-06: a
principal engineer keeps the system beautiful, idiomatic and well designed AND
*"they need a ship. and they're not gonna spend a bunch of time in engineering
cycles on edge cases, which are not relevant."* Brief reviewers that a finding
must name a failure reachable from the actual reads and doors — not a shape the
wire cannot produce, a race the single writer rules out, or a bound nothing
reaches. When triaging a CHANGES verdict, drop those in the ledger rather than
fix them; ship on a clean-enough review and file residuals as issues. Real
defects still get their fresh re-review; hypothetical ones get no round.

**Delete the comment rather than reword it.** After round 3 of #591 turned on a
header paragraph disagreeing with the preface it described, Geoff: *"i am very
skeptical of these types of comments even existing. i feel like we spend so much
time editing them to be correct when the agents are just groking the code
directly and notice when the comments are wrong anyway."* So: when a review round
churns on a comment, delete it. Write no new thesis-style header paragraphs; keep
a comment to what the code cannot say (a bound's origin, a non-obvious
constraint), one or two sentences. A comment-consistency finding is a nit unless
the text is agent-facing (a briefing preface, a role instruction) — and it counts
toward the two that end reviewing.

**An open real problem leads the report.** Its fix and its ask are the first
line, and no optional work — docs PRs, cleanup — starts while a known real
problem waits on one action.

**How to apply:** builder → fresh reviewer given issue + intended behaviour +
diff, no builder notes → fix round → re-review the fix → merge. Related:
[[guards-fail-open]], [[orchestration-default]], [[merge-authority-2026-08-31]],
[[rollout-prs-no-adversarial-review]], [[evaluation-is-the-review]].
