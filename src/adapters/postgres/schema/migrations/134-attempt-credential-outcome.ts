/**
 * A job attempt keeps the limit its run ended at, and a personal runner that
 * benches the credential it handed a job pauses no account over it.
 *
 * AN ATTEMPT'S OUTCOME IS ITS OWN ENDING, READ OFF ITS ROW. One withdrawn
 * `RunRateLimited` was stopped by a usage limit and one lost
 * `RunCreditsExhausted` ran out of credits, and a finished attempt is written
 * once, so neither is stored again. What the row cannot say is the limit the
 * run named, which `agent_account_limit` keeps only the latest of per
 * account: `execution_attempt_limit` keeps it per attempt, written by the
 * door that already keeps the account's, where the run named a window or a
 * reset. Its key is the attempt's, so it holds one row per attempt a limit
 * stopped, and it lives as long as that attempt.
 *
 * `execution_attempt.runner_benches_credential` IS WRITTEN BY A PERSONAL
 * RUNNER'S CLAIM, true where the poll that claimed it named a release reading
 * how a credential stopped a job. That runner handed the job a credential of
 * its owner's own and is told the outcome beside the job's stop, so it
 * benches that credential: such an attempt's limit is kept against the
 * attempt alone, and the owner's account is not paused by it. Every other
 * attempt keeps its limit on its account as 109 does, the body here being
 * 109's with both added.
 */

import {
  agentAccountFunction,
  boundaryOwnerRole,
  poolPlaneRole,
  workerPlaneRole,
  workerRunLimitFunction,
  type Migration,
} from "../shared.ts";

const limit = `public.${workerRunLimitFunction}(in_secret_digest text, in_generation bigint, in_window text, in_resets_at bigint)`;

export const migration134: Migration = {
  version: 134,
  name: "an attempt keeps the limit its run ended at, and a runner benching its credential pauses no account",
  statements: [
    `ALTER TABLE public.execution_attempt
       ADD COLUMN runner_benches_credential boolean NOT NULL DEFAULT false,
       ADD CONSTRAINT execution_attempt_benches_credential_is_personal
         CHECK (NOT runner_benches_credential OR personal)`,
    `GRANT SELECT(evidence,runner_benches_credential),UPDATE(runner_benches_credential)
       ON TABLE public.execution_attempt TO ${poolPlaneRole}`,
    `CREATE TABLE public.execution_attempt_limit (
       tenant text NOT NULL,
       project text NOT NULL,
       execution text NOT NULL,
       attempt text NOT NULL,
       usage_window text
         CONSTRAINT execution_attempt_limit_window_is_known
         CHECK (usage_window IS NULL OR usage_window IN ('five_hour','seven_day')),
       resets_at timestamp with time zone,
       CONSTRAINT execution_attempt_limit_names_something
         CHECK (usage_window IS NOT NULL OR resets_at IS NOT NULL),
       PRIMARY KEY (tenant,project,execution,attempt),
       CONSTRAINT execution_attempt_limit_has_its_attempt
         FOREIGN KEY (tenant,project,execution,attempt)
         REFERENCES public.execution_attempt(tenant,project,execution,attempt))`,
    `GRANT SELECT,INSERT ON TABLE public.execution_attempt_limit TO ${boundaryOwnerRole}`,
    `GRANT SELECT ON TABLE public.execution_attempt_limit TO ${poolPlaneRole}`,
    `CREATE OR REPLACE FUNCTION ${limit} RETURNS void
       LANGUAGE plpgsql SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         DECLARE ended record; spent record;
         BEGIN
           SELECT a.tenant,a.project,a.execution,a.attempt,a.runner_benches_credential
             INTO ended
             FROM execution_attempt a
            WHERE a.capability_secret_digest=in_secret_digest
              AND a.generation=in_generation AND a.state='Withdrawn'
              AND a.evidence='RunRateLimited' AND a.ended_at=now();
           IF NOT FOUND THEN RETURN; END IF;
           IF in_window IS NOT NULL OR in_resets_at IS NOT NULL THEN
             INSERT INTO execution_attempt_limit
                 (tenant,project,execution,attempt,usage_window,resets_at)
               VALUES(ended.tenant,ended.project,ended.execution,ended.attempt,
                      in_window,to_timestamp(in_resets_at));
           END IF;
           IF ended.runner_benches_credential THEN RETURN; END IF;
           SELECT * INTO spent
             FROM ${agentAccountFunction}(ended.tenant,ended.project,ended.execution,ended.attempt);
           IF spent.principal IS NULL OR spent.agent IS NULL THEN RETURN; END IF;
           INSERT INTO agent_account_limit AS kept
               (principal,agent,usage_window,resets_at,observed_at,
                tenant,project,execution,attempt)
             VALUES(spent.principal,spent.agent,in_window,to_timestamp(in_resets_at),now(),
                    ended.tenant,ended.project,ended.execution,ended.attempt)
           ON CONFLICT (principal,agent) DO UPDATE
             SET usage_window=EXCLUDED.usage_window,resets_at=EXCLUDED.resets_at,
                 observed_at=EXCLUDED.observed_at,tenant=EXCLUDED.tenant,
                 project=EXCLUDED.project,execution=EXCLUDED.execution,
                 attempt=EXCLUDED.attempt
             WHERE kept.observed_at <= EXCLUDED.observed_at;
         END $$`,
    `ALTER FUNCTION ${limit} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${limit} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${limit} TO ${workerPlaneRole}`,
  ],
};
