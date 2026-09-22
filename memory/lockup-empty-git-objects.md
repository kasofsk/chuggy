---
name: lockup-empty-git-objects
description: A machine lockup mid-commit leaves zero-byte loose objects and a ref pointing at a missing commit; recover from the worktree files, the reflog and the effort .keep snapshots
metadata:
  type: project
---

On 2026-09-07 the box locked up seconds after a fix-round commit on
`console/draw-once` (the ci run's log was zero bytes). On reboot eight loose
objects under `.git/objects` were zero-byte files, the branch ref and the
worktree HEAD pointed at the commit among them, and its reflog line was a run
of NUL bytes. Every other ref was intact.

**Why:** the object files were created but never flushed. The working tree
was untouched, so the commit's content was all still on disk, and the effort
dir held `fix2-*.keep` snapshots of the changed sources to confirm it against.

**How to apply:** `find .git/objects -type f -empty` names the damage and
`git fsck --no-dangling` names what pointed at it. Delete the empty files,
write the last good sha from the reflog into the ref and the worktree HEAD,
strip NULs from both reflogs (`tr -d '\000'`), `git reset` then `git add -A`
in the worktree to rebuild an index whose cache-tree named a lost tree, and
re-commit the working tree. Keep taking `.keep` snapshots of fix-round
sources in the effort dir ([[durable-effort-scratchpad]]); they are what made
"is the recovered diff the whole fix" a `cmp` rather than a guess.

**2026-09-11 variant, git intact.** The lockup landed between commands, not
mid-commit, so no object was damaged; the losses were the in-flight subagent
tasks and a red-proof mutation left applied in a worktree. Find what was
running from `~/.claude/projects/<project>/<session>/subagents/*.jsonl` by
mtime (the last `tool_use` of each is the command that never returned), and
treat any uncommitted worktree diff as a possible mutation: match it against
the review's mutation list before restoring it. Docker check containers come
back `Exited (255)`; `docker start` the postgres ones, and `docker rm -f` a
`chuggy-check-keto` whose bind mount named a worktree since removed.
