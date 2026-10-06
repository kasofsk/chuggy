/**
 * What each declared action was reported to have done, in the order the
 * reports arrived, and the one door that writes it.
 *
 * A ROW IS WRITTEN ONCE. A failure and the success after it are two rows, and
 * neither is ever moved or removed.
 *
 * THE NEWEST ROW IS THE ONE WITH THE GREATEST ORDINAL, and a report repeating
 * its commit and outcome stores nothing. That is the whole of idempotency: a
 * retried delivery and a reporter saying again what it last said both find
 * their own row newest. Every report of one action takes one advisory lock, so
 * two arriving together are weighed one after the other, and the ordinal is
 * the order they were weighed in. `received_at` is not: it is when a
 * transaction began, which under the lock is not when it was let through.
 *
 * AN ACTION IS DECLARED BY A REPOSITORY THE PROJECT STILL BINDS. The importer
 * never reads a retired binding again, so its rows are what a repository last
 * declared and not what it declares, and a report for one is answered as a
 * report for an action nobody declares. Binding the repository again makes
 * them declarations again.
 *
 * WHAT IS DECLARED IS READ AND NEVER HELD. An import replaces a repository's
 * rows by removing and inserting them, so a key onto one would refuse the next
 * import, and a read that locked one would find none while an import was
 * replacing it. A plain read sees the set as it stood or as it stands.
 */

import {
  actionObservationRecordFunction,
  apiRole,
  boundaryOwnerRole,
  type Migration,
} from "../shared.ts";

const signature = `public.${actionObservationRecordFunction}(in_tenant text, in_project text, in_action text, in_commit text, in_outcome text, in_observed_at timestamp with time zone, in_reporter text, in_detail text, in_link text)`;

export const migration037: Migration = {
  version: 37,
  name: "what a declared action was reported to have done is recorded",
  statements: [
    `CREATE TABLE public.action_observation (
       tenant text NOT NULL,
       project text NOT NULL,
       action text NOT NULL,
       ordinal bigint NOT NULL,
       repository_commit text NOT NULL
         CONSTRAINT action_observation_commit_is_git_object
         CHECK (repository_commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
       outcome text NOT NULL
         CONSTRAINT action_observation_outcome_is_known
         CHECK (outcome IN ('Succeeded','Failed')),
       observed_at timestamp with time zone,
       received_at timestamp with time zone DEFAULT now() NOT NULL,
       reporter text NOT NULL
         CONSTRAINT action_observation_reporter_is_bounded
         CHECK (length(reporter) BETWEEN 1 AND 128),
       detail text
         CONSTRAINT action_observation_detail_is_bounded
         CHECK (length(detail) BETWEEN 1 AND 1024),
       link text
         CONSTRAINT action_observation_link_is_https
         CHECK (length(link) <= 2048 AND link ~ '^[!-~]+$'
                AND link ~ '^https://[^/\\\\?#@]+([/?#]|$)'),
       PRIMARY KEY (tenant,project,action,ordinal),
       CONSTRAINT action_observation_names_a_project
         FOREIGN KEY (tenant,project) REFERENCES public.project(tenant,project))`,
    `CREATE TRIGGER action_observation_is_written_once
       BEFORE DELETE OR UPDATE ON public.action_observation
       FOR EACH ROW EXECUTE FUNCTION public.durable_row_is_written_once()`,
    `GRANT SELECT,INSERT ON TABLE public.action_observation TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${signature} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE newest action_observation%ROWTYPE;
     BEGIN
       PERFORM 1 FROM repository_action a
          JOIN project_repository b
            ON b.tenant=a.tenant AND b.project=a.project
           AND b.repository=a.repository
        WHERE a.tenant=in_tenant AND a.project=in_project
          AND a.action=in_action AND b.retired_at IS NULL;
       IF NOT FOUND THEN RETURN 'Undeclared'; END IF;
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'action-observation:'||in_tenant||'/'||in_project||'/'||in_action,0));
       SELECT * INTO newest FROM action_observation o
        WHERE o.tenant=in_tenant AND o.project=in_project
          AND o.action=in_action
        ORDER BY o.ordinal DESC LIMIT 1;
       IF newest.repository_commit=in_commit AND newest.outcome=in_outcome THEN
         RETURN 'Repeated';
       END IF;
       INSERT INTO action_observation
         (tenant,project,action,ordinal,repository_commit,outcome,
          observed_at,reporter,detail,link)
       VALUES(in_tenant,in_project,in_action,coalesce(newest.ordinal,0)+1,
              in_commit,in_outcome,in_observed_at,in_reporter,in_detail,
              in_link);
       RETURN 'Recorded';
     END $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
  ],
};
