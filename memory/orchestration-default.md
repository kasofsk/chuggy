---
name: orchestration-default
description: "2026-09-06 Geoff: default shape for any nontrivial implementation — orchestrator works through subagents; opus for big chunks (adversarially reviewed), sonnet for simple pieces (not reviewed alone, folded into a PR the orchestrator has reviewed as it sees fit)"
metadata:
  type: feedback
---

For any nontrivial implementation in chuggy, the orchestrator (the main
session) does principally all the work through subagents, not by hand:

- **Opus subagents** take the big chunks. Each big chunk is still
  **adversarially reviewed** ([[review-discipline]]).
- **Sonnet subagents** take anything sonnet can easily handle: granular,
  well-specified changes with a brief and a test to hit. Their work is **not
  adversarially reviewed on its own**: the orchestrator merges those branches
  into a batch branch as it sees fit (PRs against a non-main branch may merge
  unreviewed), then groups them into one PR against main.
- **Every PR against main gets an adversarial review**, without exception
  (Geoff, 2026-09-06, clarifying this rule). Discretion covers only how the
  sonnet pieces are grouped and batched before that.
- One PR per batch, not one per subagent (first run of the pattern: the
  Radix adoption batch, chuggy PR #593).

**Why:** Geoff (2026-09-06, after the Radix push) said this is "our sort of
default course of action" going forward. It replaced a flat "every subagent is
opus" rule from 2026-08-15, which dated from when every subagent was a builder
or reviewer of a whole PR.

**In a Workflow script** the same policy is per task, not per stage: the
task list carries `review: true` for opus chunks and `review: false` for
sonnet pieces, and the review-and-fix loop is entered only when the flag
says so; the sonnet pieces get their review as part of the whole-batch PR
review. Geoff noticed (2026-09-06, chat-shell stage two) that a uniform
loop gave every sonnet task its own opus reviewer — allowed, but not the
rule, and the point is that memory has to be translated into the script.

**How to apply:** before starting, split the work into opus-sized chunks and
sonnet-sized tasks; write a common brief plus one task file each
([[parallel-agent-worktrees]] for isolation); the orchestrator plans,
briefs, integrates, runs the gates and verifies — it does not write the
feature itself. Merge authority stays with [[merge-authority-2026-08-31]].

**Small fixes stay mine** (Geoff, 2026-09-21): he first asked for subagents
over my own background shells, then withdrew it the same hour: "small fixes
you should handle. i dont want you to stop fixing things yourself." So the
split above holds: nontrivial chunks go to subagents; a small fix, a gate run,
a release step I can drive in-line, I do.
