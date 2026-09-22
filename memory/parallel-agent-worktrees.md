---
name: parallel-agent-worktrees
description: Parallel subagents need their own git worktree AND their own scratchpad subdirectory
metadata:
  type: feedback
---

When running chuggy subagents in parallel, give each one an isolated git worktree (`isolation: "worktree"` on the Agent tool, or brief them to `git worktree add` before any git operation). Never let two agents work in `/home/geoff/claude/chuggy` at once.

**Why:** observed 2026-08-20. Two agents shared that directory; one checked out its branch while the other was mid-work, and the second agent's `git push` silently created its branch at `main` instead of its own commit. It caught the error with `git ls-remote` and recovered, and it also had to unstage the other agent's untracked file that `git add -A` had swept into its commit. Neither agent did anything wrong — the shared checkout is the defect.

**How to apply:** spawn parallel agents with worktree isolation. Where an agent is already running in a shared tree, tell it to move to its own worktree, to add files by explicit path rather than `git add -A`, and to push with an explicit refspec (`git push origin HEAD:refs/heads/<branch>`) then verify with `git ls-remote`. Related: [[orchestration-default]], [[merge-authority-2026-08-31]].

**The scratchpad collides the same way.** On the same night, one agent found another's `probe.sh` in the shared scratchpad root, could not account for a script targeting the cloud metadata IP, the API server and kube-dns, and — correctly — refused to run it, deleted it, and reported it as a possible intrusion. It was a colleague's isolation probe. Benign in origin, but it destroyed another agent's working file and cost a security scare.

So brief agents to work inside their own named subdirectory of the scratchpad, never its root, and to **never delete or execute a scratchpad file they did not create** — leave it, do not run it, and say so in the report. That refusal instinct is right and should be kept; what needs fixing is the collision that triggers it.

