# Handoff branch — ticket-language convergence, paused 2026-09-22

An orphan branch, never merged. It carries the two things that lived only on Geoff's machine:

- `effort/ticket-language/` — the effort directory this convergence is run from (`~/claude/chuggy-effort/ticket-language/` on Geoff's box): `SPIKE.md`, one directory per PR with survey, decisions (`GOAL.md`), subagent briefs and reports, review briefs, reviews, ledgers, gate logs, rig release logs. **Start at `effort/ticket-language/pr8/HANDOFF-2026-09-22.md`.** Excluded: `package/` (a clone of https://github.com/kasofsk/chug-ticket-domain at 76c95a9 — clone it to that path), two rig database rehearsal dumps and their globals files.
- `memory/` — the orchestrating agent's persistent memory for this repo (`~/.claude/projects/-home-geoff-claude-chuggy/memory/` on Geoff's box; `MEMORY.md` is the index). Working rules, the traps in this tree, the rig runbook, release history. Written for an agent; paths in it are Geoff's. Excluded: one file pointing at a DNS token on disk.

Every brief and memory that names `~/claude/chuggy-effort/ticket-language/...` means `effort/ticket-language/...` here. Nothing in this branch is a secret; the rig identity files it mentions live on the rig itself.
