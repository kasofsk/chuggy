---
name: parallelism-cap
description: Geoff (2026-09-14) asked to reduce subagent parallelism — eleven parallel authors was too many; run about three at a time
metadata:
  type: feedback
---

Geoff, 2026-09-14, after I launched eleven parallel authoring subagents on
the simplify effort: "can we reduce parallelism we are going to kill the
session too fast."

**Why:** each running subagent's notifications and reports land in the main
session's context, and eleven at once burns the session's budget long before
the effort finishes. The box also has one postgres, one model gate and
limited memory (see [[chuggy-false-reds]]).

**How to apply:** run about three authoring subagents at a time; queue the
rest and launch one as one finishes. Reviewers count toward the cap. State
the cap in the effort ledger. Related: [[orchestration-default]],
[[simplify-effort-2026-09-14]].
