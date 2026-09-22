---
name: worker-must-run-ci
description: The selector taught itself to tell workers "Do NOT run ci.sh"; rev 31 of the chuggy standing rules forbids that. Check-stage reds were Prettier, lint, check-comments, never caught by the ticket's named gate.
metadata:
  type: project
---

From ticket 64 the author's briefs carried "Do NOT run just check or
.chug/tasks/ci.sh: the Check stage after you runs every gate". Not a rule
anywhere: the author invented it and copied it from its own open drafts.
Workers obeyed (ticket 77 said so three times), ran only the gate the brief
named (check-console.sh, which has no Prettier and no check-comments), and
the Check stage failed on format, lint and comment length. Since ticket 60,
every non-environmental check red was of that kind.

2026-09-21: selector settings rev 30 → 31 on the rig adds one rule under
"Acceptance checks": a chuggy work brief's Verify names ci.sh last, the
worker runs it before reporting, never tell a worker not to. Undo and body
in ~/claude/chuggy-effort/worker-runs-ci/ (undo-body-31.json).
Applied with /home/geoff/first-drive-call.sh on the node (client file
first-drive.json still there, still authorized). Geoff chose NOT to file a
chuggy ticket for the durable fix (render the Check stage's commands into
every agent Work briefing; `briefingTicketChecks` in
src/interpreter/taskBriefing.ts is where Work gets none).

**Why:** a worker that cannot see what judges it cannot pass it; the
failures were cheap static findings a five-minute ci.sh run shows.

**How to apply:** if check reds on the rig are format/lint/comment findings,
look at the ticket's Verify line before blaming the model. Tickets 78 and 81
were released with the old line; released briefs are not edited behind the
journal. Related: [[evaluation-is-the-review]], [[chuggy-rig]].
