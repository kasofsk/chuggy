/**
 * What the worker plane needs to mint a pod's git credential for it: the kind of
 * task an attempt is, the claim its repository's owner is held under, and the
 * bindings a session's project stands on.
 *
 * THE PERMISSION SET FOLLOWS FROM THE ROW AND NEVER FROM THE POD. A work
 * attempt pushes its branch and an evaluation attempt reads, so the plane mints
 * a different token for each; the pod is the thing being controlled, so the kind
 * comes from the scheduler's own row through the read the plane already
 * authenticates by rather than from the task document the pod was launched with.
 * The attempt read gains a column, so it is dropped and created for 078's
 * reasons, with its owner and its grant restated.
 *
 * THE PLANE LEARNS NO TENANT IT WAS NOT ALREADY SERVING. 084 kept every runtime
 * role but the API off `forge_installation`, because nothing else minted; the
 * plane mints now, and the read it is granted is the same one the API holds —
 * keyed by forge, app, account and tenant together, so a row another tenant
 * claimed does not match. The tenant it asks under is the authenticated
 * attempt's or session's own partition, which the plane already holds and
 * already answers input, artifacts and turns under.
 *
 * A SESSION IS HELD TO ITS PROJECT'S BINDINGS. A session names the repository it
 * wants a credential for, because its placement bound one and the site may have
 * substituted a mirror for it; the binding read is what stops that name being
 * any repository the claiming tenant owns, so the plane is granted the same
 * EXECUTE the scheduler that placed the session holds.
 */

import {
  boundaryOwnerRole,
  repositoryBindingReadFunction,
  workerAttemptReadFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

/** The binding read's signature since 082, which this only grants against. */
const bindingReadSignature = "text,text,text";

const attemptRead = [
  `DROP FUNCTION ${workerAttemptReadFunction}(text)`,
  `CREATE FUNCTION ${workerAttemptReadFunction}(in_secret_digest text)
     RETURNS TABLE(tenant text,project text,execution text,attempt text,generation bigint,
                   task_kind text,manifest text,input_bundle text,input_bundle_digest text,
                   live boolean,inputs jsonb)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT a.tenant,a.project,a.execution,a.attempt,a.generation,t.kind,a.manifest,
              q.input_bundle,q.input_bundle_digest,
              (a.state IN ('Placing','Running') AND e.status IN ('Launching','Running')),
              coalesce((SELECT jsonb_agg(jsonb_build_object(
                'ordinal',r.ordinal,'kind',r.reference_kind,'reference',r.reference_id,
                'digest',r.reference_digest) ORDER BY r.ordinal)
                FROM input_bundle_reference r
               WHERE r.tenant=a.tenant AND r.project=a.project
                 AND r.bundle=q.input_bundle),'[]'::jsonb)
         FROM execution_attempt a
         JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                         AND e.execution=a.execution
         JOIN execution_request q ON q.tenant=e.tenant AND q.project=e.project
                                 AND q.request=e.source_request
         JOIN execution_request_task t ON t.tenant=e.tenant AND t.project=e.project
                                      AND t.request=e.source_request AND t.task=e.task
        WHERE a.capability_secret_digest=in_secret_digest
          AND ((a.state IN ('Placing','Running') AND e.status IN ('Launching','Running'))
            OR (a.state='Reported' AND e.status='Terminal'))
          AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                 ORDER BY ordinal DESC LIMIT 1)
     $$`,
  `ALTER FUNCTION ${workerAttemptReadFunction}(text) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${workerAttemptReadFunction}(text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${workerAttemptReadFunction}(text) TO ${workerPlaneRole}`,
];

const mintingReads = [
  `GRANT SELECT ON forge_installation TO ${workerPlaneRole}`,
  `GRANT EXECUTE ON FUNCTION ${repositoryBindingReadFunction}(${bindingReadSignature})
     TO ${workerPlaneRole}`,
];

/** The plane mints a pod's credential, so it reads the task kind, the claim and the binding. */
export const migration086: Migration = {
  version: 86,
  name: "the worker plane mints pod credentials",
  statements: [...attemptRead, ...mintingReads],
};
