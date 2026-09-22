---
name: durable-effort-scratchpad
description: The session scratchpad under /tmp is wiped by a reboot; long unattended efforts keep their ledger, briefs and plans under /home/geoff/claude/chuggy-effort instead
metadata:
  type: feedback
---

On 2026-09-03 the host locked up at 03:03 EDT during the agentic-selector run and the reboot
wiped `/tmp/claude-1000/…/scratchpad/effort/` — the ledger, DECISIONS, BRIEF-common, every
plan and every review file. Code was safe (draft PRs + worktrees); the coordination record was
not. It was rebuilt from the subagent transcripts (Read/Write tool payloads under
`~/.claude/projects/-home-geoff-claude-chuggy/<session>/subagents/*.jsonl`) and now lives at
`/home/geoff/claude/chuggy-effort/effort/` (design record beside it as `lead-and-threads.html`).

**Why:** subagents read the brief by absolute path; an unattended run of many hours is longer
than /tmp's guarantee, and memory checkpoints alone cannot re-brief an agent.

**How to apply:** for any multi-hour effort put the effort dir under `/home/geoff/claude/` (or
the project memory dir), never under the job/session scratchpad; brief agents with that path;
checkpoint the ledger there. If a scratchpad is lost, recover from transcripts before
relaunching. Related: [[parallel-agent-worktrees]].
