Fix for release ccbf0c38: **the ticket service may re-pin a ticket's configuration.**

On the rig, the first `UpdateTicket` wedged the partition: the writer's decision runs `decisionRepin`, which updates `ticket_projection.configuration_revision` and `configuration_digest`, and 016 granted the ticket service `UPDATE(revision)` only, so every activation failed with `permission denied for table ticket_projection`. **Migration 017** grants the two columns, with no guard, since nothing stored moves; a database already holding the grant by hand migrates the same.

No gate saw it because every durable suite decided on the owner pool, which holds every grant. The postgres harness now decides as `chuggy_ticket_service` and accepts as `chuggy_api` — the roles a deployment wires — across every suite that uses it, and without 017 four authoring cases fail with the rig's error. Paths still exercised as the owner are listed in the review, in the effort directory's `pr8/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
