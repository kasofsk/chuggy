/**
 * The binding read narrowed to a repository the caller names, which is how work
 * is observed against the ticket's repository rather than against the
 * project's oldest, and a one-time repair of every brief 081 left silent about
 * which repository that is.
 *
 * THE SIGNATURE GAINS A PARAMETER RATHER THAN THE TREE GAINING A FUNCTION. The
 * question is the one 027 wrote — which binding row a caller works against —
 * and what changed is that a caller now knows which repository it means. A
 * second function answering it would be a second place a binding's standing is
 * read from, which is what 080 retired the activation ledger to stop.
 *
 * THE BACKFILL IS A HISTORICAL REPAIR AND NOT A DEFAULT. 081 refuses release to
 * a brief naming no repository, so nothing released from here on ever needs it;
 * what it closes is every brief left null, not every ticket released before
 * that refusal existed — a ticket released before 042 created `draft_brief`
 * holds no brief row for this backfill to reach, and stays as it was. Each
 * brief it does reach is set to its project's oldest binding — `ORDER BY
 * bound_at,repository LIMIT 1`, the same election the narrowed read below
 * makes for a caller naming none — so a project holding one binding elects the
 * one it already would have, and the two reads that used to disagree now agree
 * because the row itself changed. A draft is left alone: 081 already leaves it
 * revisable and the lead fills it at release. Where the ticket's own project
 * binds nothing at all, there is no binding to elect and the row stays null,
 * which leaves that ticket's hold standing — honestly, because there truly is
 * nothing to name.
 *
 * NAMING NO REPOSITORY STILL ANSWERS THE OLDEST BINDING, for every caller that
 * holds no ticket to take one from: the configuration importer's binding read,
 * the API's configuration-snapshot read, and session placement, which is a
 * project's own and names no ticket. The finalizer's durable view is
 * deliberately not among them — it called this function until this migration
 * and does not now; it resolves a request's repository through its own
 * ticket's brief, which is exactly the row the backfill above repairs.
 *
 * DROPPED AND CREATED, for 78's reasons: a parameter added is a new signature,
 * and a dropped function takes its owner and every grant with it, so all of
 * them are restated here.
 */

import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  repositoryBindingReadFunction,
  schedulerRole,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

/**
 * Repairs every brief a ticket released before 081 left silent, electing each
 * one's project's oldest binding exactly as the narrowed read below would for
 * a caller naming none. A draft stays untouched, and a brief whose project
 * binds nothing keeps its null.
 */
const briefBackfill = [
  `UPDATE draft_brief b
     SET repository = (
       SELECT p.repository FROM project_repository p
        WHERE p.tenant = b.tenant AND p.project = b.project
        ORDER BY p.bound_at, p.repository LIMIT 1)
    FROM draft d
    WHERE d.tenant = b.tenant AND d.project = b.project AND d.ticket = b.ticket
      AND d.state <> 'Draft' AND b.repository IS NULL`,
];

const bindingReadSignatureBefore = "text,text";
const bindingReadSignature = "text,text,text";

const bindingRead = [
  `DROP FUNCTION ${repositoryBindingReadFunction}(${bindingReadSignatureBefore})`,
  `CREATE FUNCTION ${repositoryBindingReadFunction}(
     in_tenant text,in_project text,in_repository text)
     RETURNS TABLE(repository text,recovery_epoch text)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     SELECT b.repository,b.recovery_epoch FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND (in_repository IS NULL OR b.repository=in_repository)
      ORDER BY b.bound_at,b.repository LIMIT 1
     $$`,
  `ALTER FUNCTION ${repositoryBindingReadFunction}(${bindingReadSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${repositoryBindingReadFunction}(${bindingReadSignature})
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${repositoryBindingReadFunction}(${bindingReadSignature})
     TO ${apiRole},${ticketServiceRole},${schedulerRole},${configurationImporterRole}`,
];

/** A caller that knows its repository asks for that one, the rest ask as they did, and a released ticket's own brief is repaired to agree. */
export const migration082: Migration = {
  version: 82,
  name: "the binding read names its repository",
  statements: [...briefBackfill, ...bindingRead],
};
