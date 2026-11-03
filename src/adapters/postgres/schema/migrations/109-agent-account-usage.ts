/**
 * A job attempt names the agent it spends, and the worker plane keeps what a
 * run said of the account it spent: the latest usage reading of each window,
 * and the latest limit a provider stopped one at.
 *
 * THE AGENT IS DERIVED FROM THE INVOCATION, as `invoked` is in 018:
 * `execution_attempt.agent` is a stored generated column naming the agent a
 * `SingleAgent` mode runs, Claude for the bare arguments that predate modes,
 * and nothing for `Commands`, for an invocation naming no worker, and for one
 * not written yet. The fence passes over it as it passes over `invoked`,
 * because a BEFORE trigger reads a generated column as null.
 *
 * THE ACCOUNT IS DERIVED FROM THE ATTEMPT'S OWN CLAIM, never named by the pod:
 * the owner a personal runner's claim writes into `pool`, or the member who
 * registered the pool whose name and principal a pool's claim wrote. An
 * attempt run in cluster, or on a pool no member registered, spends no account
 * here, and nothing it says of one is kept.
 *
 * BOTH RELATIONS ARE KEYED BY THE ACCOUNT'S PRINCIPAL, NOT BY A PROJECT, since
 * one login serves every workspace its owner works in. Each is written through
 * its door alone, in the transaction that stores the totals or the end it
 * arrived with.
 *
 * A READING IS KEPT ONLY OVER ONE OBSERVED EARLIER, and is dated no later than
 * the database's clock when it arrives, so a repeated post changes nothing and
 * a pod's clock running ahead cannot pin its reading in place. A limit is
 * written by the transaction that withdrew its attempt `RunRateLimited`, which
 * its door reads as the attempt's ending at that transaction's own `now()`.
 */

import {
  agentAccountFunction,
  boundaryOwnerRole,
  poolPlaneRole,
  workerPlaneRole,
  workerRunLimitFunction,
  workerRunUsageFunction,
  type Migration,
} from "../shared.ts";

const account = `public.${agentAccountFunction}(in_tenant text, in_project text, in_execution text, in_attempt text)`;

const usage = `public.${workerRunUsageFunction}(in_secret_digest text, in_generation bigint, in_usage jsonb)`;

const limit = `public.${workerRunLimitFunction}(in_secret_digest text, in_generation bigint, in_window text, in_resets_at bigint)`;

/** The fence 018 wrote, passing over `agent` as it does `invoked`. */
const finishedAttemptFence = `CREATE OR REPLACE FUNCTION public.execution_attempt_is_fenced() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
       BEGIN
         IF OLD.state NOT IN ('Placing', 'Running') THEN
           IF OLD.cleanup_completed_at IS NULL AND NEW.cleanup_completed_at IS NOT NULL
              AND (to_jsonb(NEW) - 'cleanup_completed_at' - 'invoked' - 'agent')
                  IS NOT DISTINCT FROM (to_jsonb(OLD) - 'cleanup_completed_at' - 'invoked' - 'agent') THEN
             RETURN NEW;
           END IF;
           RAISE EXCEPTION 'attempt % is already %, and a finished attempt is written once',
             OLD.attempt, OLD.state USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         IF (NEW.tenant, NEW.project, NEW.execution, NEW.attempt, NEW.attempt_number,
             NEW.recovery_epoch)
            IS DISTINCT FROM
            (OLD.tenant, OLD.project, OLD.execution, OLD.attempt, OLD.attempt_number,
             OLD.recovery_epoch) THEN
           RAISE EXCEPTION 'attempt % would change the identity or epoch it was issued under',
             OLD.attempt USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         IF NEW.generation < OLD.generation THEN
           RAISE EXCEPTION 'attempt % would move its generation backwards', OLD.attempt
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         IF OLD.state = 'Running' AND NEW.state = 'Placing' THEN
           RAISE EXCEPTION 'attempt % would return to placement after running', OLD.attempt
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         RETURN NEW;
       END $$`;

/** The columns both relations open with: whose account, which agent, and the attempt the fact came from. */
function accountColumns(relation: string): string {
  return `principal text NOT NULL
         CONSTRAINT ${relation}_principal_is_bounded
         CHECK (length(principal) BETWEEN 1 AND 256),
       agent text NOT NULL
         CONSTRAINT ${relation}_agent_is_known CHECK (agent IN ('Claude','Codex')),
       tenant text NOT NULL,
       project text NOT NULL,
       execution text NOT NULL,
       attempt text NOT NULL,
       CONSTRAINT ${relation}_has_its_attempt
         FOREIGN KEY (tenant,project,execution,attempt)
         REFERENCES public.execution_attempt(tenant,project,execution,attempt)`;
}

/** The owner and the one grant a door ends with, `role` the only caller. */
function owned(signature: string, role: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${signature} TO ${role}`,
  ];
}

export const migration109: Migration = {
  version: 109,
  name: "an attempt names the agent it spends, and a run keeps its account's usage and limit",
  statements: [
    `ALTER TABLE public.execution_attempt
       ADD COLUMN agent text GENERATED ALWAYS AS (
         CASE
           WHEN invocation->'worker'->'mode'->>'type' = 'SingleAgent'
             THEN invocation->'worker'->'mode'->>'agent'
           WHEN invocation->'worker'->'mode' IS NULL
                AND jsonb_typeof(invocation->'worker'->'arguments') = 'array'
             THEN 'Claude'
         END) STORED
         CONSTRAINT execution_attempt_agent_is_known
         CHECK (agent IS NULL OR agent IN ('Claude','Codex'))`,
    finishedAttemptFence,
    `GRANT SELECT(agent) ON TABLE public.execution_attempt TO ${poolPlaneRole}`,
    `CREATE TABLE public.agent_account_usage (
       ${accountColumns("agent_account_usage")},
       usage_window text NOT NULL
         CONSTRAINT agent_account_usage_window_is_known
         CHECK (usage_window IN ('five_hour','seven_day')),
       utilization double precision NOT NULL
         CONSTRAINT agent_account_usage_utilization_is_bounded
         CHECK (utilization >= 0 AND utilization <= 100),
       resets_at timestamp with time zone NOT NULL,
       observed_at timestamp with time zone NOT NULL,
       PRIMARY KEY (principal,agent,usage_window))`,
    `CREATE TABLE public.agent_account_limit (
       ${accountColumns("agent_account_limit")},
       usage_window text
         CONSTRAINT agent_account_limit_window_is_known
         CHECK (usage_window IS NULL OR usage_window IN ('five_hour','seven_day')),
       resets_at timestamp with time zone,
       observed_at timestamp with time zone NOT NULL,
       PRIMARY KEY (principal,agent))`,
    `GRANT SELECT,INSERT,UPDATE ON TABLE public.agent_account_usage TO ${boundaryOwnerRole}`,
    `GRANT SELECT,INSERT,UPDATE ON TABLE public.agent_account_limit TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${account}
       RETURNS TABLE(principal text, agent text)
       LANGUAGE sql STABLE
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT CASE WHEN a.personal THEN a.pool ELSE w.registered_by END, a.agent
           FROM execution_attempt a
           LEFT JOIN worker_pool w
             ON NOT a.personal AND w.tenant=a.tenant AND w.project=a.project
            AND w.pool=a.pool AND w.principal=a.pool_principal
          WHERE a.tenant=in_tenant AND a.project=in_project
            AND a.execution=in_execution AND a.attempt=in_attempt
       $$`,
    `ALTER FUNCTION ${account} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${account} FROM PUBLIC`,
    `CREATE FUNCTION ${usage} RETURNS void
       LANGUAGE plpgsql SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         DECLARE bound record; spent record;
         BEGIN
           SELECT * INTO bound FROM worker_run_binding(in_secret_digest,in_generation);
           IF NOT FOUND THEN RETURN; END IF;
           SELECT * INTO spent
             FROM ${agentAccountFunction}(bound.tenant,bound.project,bound.execution,bound.attempt);
           IF spent.principal IS NULL OR spent.agent IS NULL THEN RETURN; END IF;
           INSERT INTO agent_account_usage AS kept
               (principal,agent,usage_window,utilization,resets_at,observed_at,
                tenant,project,execution,attempt)
             SELECT spent.principal,spent.agent,offered.key,
                    (offered.value->>'utilization')::double precision,
                    to_timestamp((offered.value->>'resetsAt')::double precision),
                    least(to_timestamp((offered.value->>'observedAt')::double precision),now()),
                    bound.tenant,bound.project,bound.execution,bound.attempt
               FROM jsonb_each(in_usage) offered
           ON CONFLICT (principal,agent,usage_window) DO UPDATE
             SET utilization=EXCLUDED.utilization,resets_at=EXCLUDED.resets_at,
                 observed_at=EXCLUDED.observed_at,tenant=EXCLUDED.tenant,
                 project=EXCLUDED.project,execution=EXCLUDED.execution,
                 attempt=EXCLUDED.attempt
             WHERE kept.observed_at < EXCLUDED.observed_at;
         END $$`,
    ...owned(usage, workerPlaneRole),
    `CREATE FUNCTION ${limit} RETURNS void
       LANGUAGE plpgsql SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         DECLARE ended record; spent record;
         BEGIN
           SELECT a.tenant,a.project,a.execution,a.attempt INTO ended
             FROM execution_attempt a
            WHERE a.capability_secret_digest=in_secret_digest
              AND a.generation=in_generation AND a.state='Withdrawn'
              AND a.evidence='RunRateLimited' AND a.ended_at=now();
           IF NOT FOUND THEN RETURN; END IF;
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
    ...owned(limit, workerPlaneRole),
  ],
};
