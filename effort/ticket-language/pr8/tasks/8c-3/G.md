# G — migration 017: the ticket service may re-pin (branch `model/repin-grant` off main ccbf0c38)

Setup: `tasks/8c-2/_setup.md` (part of this brief), except: branch `model/repin-grant` from `origin/main` (ccbf0c38); push `HEAD:refs/heads/model/repin-grant`.

**The production failure.** Release ccbf0c38 is on the rig. The first `UpdateTicket` wedged the partition: the ticket service's activation fails forever with `permission denied for table ticket_projection`. `decisionRepin` (`src/adapters/postgres/decision.ts` ~216-235) runs `UPDATE ticket_projection SET configuration_revision, configuration_digest` on every Update. Migration 016 (applied on the rig, so immutable) grants `chuggy_ticket_service` only `UPDATE(revision)` (016 ~529). The rig has been hotfixed by hand with `GRANT UPDATE(configuration_revision, configuration_digest) ON TABLE public.ticket_projection TO chuggy_ticket_service`, so 017 must be idempotent against a database that already holds the grant.

Do:
1. **Migration 017** in the house pattern (read 013–016 and `schema/README.md`): that grant, using the role variables the others use; no guard, since no stored data changes. Render-diff 001–016 against ccbf0c38 must be empty.
2. **Why no gate caught it — fix that, not only this instance.** Find the role under which `test/postgres/authoring.test.ts`'s re-pin case (added in 5ba2994f) and the other writer tests run the decision path. If they run as the owner or superuser, the privilege model goes unexercised. Make the writer's durable tests (at least the decision/journal path, and ideally every service's) run under that service's own login role as deployed, so that 016's missing grant turns red. Red-prove it: drop 017's grant and the re-pin case fails with the rig's error. If that is too wide for one change, do the narrowest version that makes this failure class red for the ticket service, and name what is still unexercised in your report.
3. `migration.test.ts` privilege assertions for the new grant (and that `configuration_digest` stays closed to the API role).

Run at the end, one at a time: check-source (test/rig playwright baseline), check-postgres, check-queries, check-boundaries, check-paths, check-comments, check-figures, check-duplication. Final message: commits, red-proofs, gate exits, anything still unexercised, under 35 lines.
