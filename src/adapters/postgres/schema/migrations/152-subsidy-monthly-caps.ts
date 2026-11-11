/**
 * A subsidized lead stops at its tenant's monthly cap, and at the deployment's.
 *
 * THE PROFILE'S ROW CARRIES ITS CAPS, published with the rest of it: one per
 * tenant, one on every tenant's spend together, and what a turn on its slot
 * that failed or never settled is charged. They have no value to carry an old
 * row forward with, so the row is deleted and the selector's next start
 * publishes it again; until then a stored `Subsidized` reads `Own`, as 145
 * reads it while no row stands.
 *
 * `subsidized_lead_spend` ANSWERS ONE TENANT'S SPEND THIS MONTH AND THE
 * DEPLOYMENT'S, each beside its cap, and no row unless the project's lead
 * resolves `Subsidized`. A month is the calendar month in UTC, and a turn
 * counts toward the month it was enqueued in, the one its admission was
 * decided in. It sums the measured `cost_micros` of every Lead and Inquiry
 * turn on the profile's slot, and charges `unmeasured_turn_micros` for each
 * time an ended attempt left one in flight, which `attempts_spent` counts and
 * which a turn `AttemptLost` ends on, and once more where the plane recorded
 * it failed. A failure the plane never ran a turn to, a withdrawal or a
 * closed session, is charged nothing. Its scan starts from this month's
 * turns, so they are indexed by when they were enqueued.
 *
 * `SubsidyExhausted` IS A REFUSAL THE SELECTOR KEEPS, beside 130's codes, and
 * `read_lead_refusal` answers its end as the first instant of the next month,
 * read at the read rather than stored. Its arguments and its answer are 130's,
 * so it is replaced in place and keeps its grant.
 */

import {
  apiRole,
  boundaryOwnerRole,
  leadRefusalReadFunction,
  leadRunnerStandingFunction,
  selectorServiceRole,
  sessionLeadOfferingFunction,
  subsidizedLeadSpendFunction,
  type Migration,
} from "../shared.ts";

const spend = `public.${subsidizedLeadSpendFunction}(in_tenant text, in_project text)`;

const refusalRead = `public.${leadRefusalReadFunction}(in_tenant text, in_project text, in_polled_secs_max bigint)`;

/** The first instant of the calendar month in UTC after the one `now()` is in. */
const monthNext = `((date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC')`;

export const migration152: Migration = {
  version: 152,
  name: "a subsidized lead stops at its tenant's monthly cap, and at the deployment's",
  statements: [
    `DELETE FROM public.subsidized_lead`,
    `ALTER TABLE public.subsidized_lead
       ADD COLUMN tenant_monthly_micros bigint NOT NULL
         CONSTRAINT subsidized_lead_tenant_monthly_micros_is_positive
         CHECK (tenant_monthly_micros >= 1),
       ADD COLUMN deployment_monthly_micros bigint NOT NULL
         CONSTRAINT subsidized_lead_deployment_monthly_micros_is_positive
         CHECK (deployment_monthly_micros >= 1),
       ADD COLUMN unmeasured_turn_micros bigint NOT NULL
         CONSTRAINT subsidized_lead_unmeasured_turn_micros_is_positive
         CHECK (unmeasured_turn_micros >= 1)`,
    `CREATE INDEX session_turn_enqueued
       ON public.session_turn USING btree (enqueued_at)`,
    `CREATE FUNCTION ${spend}
       RETURNS TABLE(tenant_micros bigint, tenant_monthly_micros bigint,
                     deployment_micros bigint, deployment_monthly_micros bigint)
    LANGUAGE sql STABLE SECURITY DEFINER ROWS 1
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       WITH charged AS (
         SELECT s.tenant,
                coalesce(t.cost_micros,0)
                + l.unmeasured_turn_micros*(t.attempts_spent
                    + CASE WHEN t.state='Failed'
                            AND t.failure IN ('AgentFailed','AgentRateLimited',
                                              'AgentTurnsExhausted',
                                              'AgentBudgetExhausted',
                                              'StoreRefused')
                           THEN 1 ELSE 0 END) AS micros
           FROM subsidized_lead l
           JOIN session_turn t
             ON t.enqueued_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
                                   AT TIME ZONE 'UTC'
           JOIN agent_session s
             ON s.tenant=t.tenant AND s.project=t.project AND s.session=t.session
          WHERE s.kind IN ('Lead','Inquiry')
            AND s.credential_slot=l.credential_slot)
       SELECT coalesce((SELECT sum(c.micros) FROM charged c
                         WHERE c.tenant=in_tenant),0)::bigint,
              l.tenant_monthly_micros,
              coalesce((SELECT sum(c.micros) FROM charged c),0)::bigint,
              l.deployment_monthly_micros
         FROM subsidized_lead l
        WHERE ${sessionLeadOfferingFunction}(in_tenant,in_project)='Subsidized'
     $$`,
    `ALTER FUNCTION ${spend} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${spend} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${spend} TO ${apiRole}`,
    `GRANT EXECUTE ON FUNCTION ${spend} TO ${selectorServiceRole}`,
    `ALTER TABLE public.selector_lead_refusal
       DROP CONSTRAINT selector_lead_refusal_is_known,
       ADD CONSTRAINT selector_lead_refusal_is_known
         CHECK (refusal = ANY (ARRAY['HostedRunsNotGranted'::text, 'RunnerOffline'::text, 'UsagePaused'::text, 'SubsidyExhausted'::text]))`,
    `CREATE OR REPLACE FUNCTION ${refusalRead}
       RETURNS TABLE(refusal text, refused_since timestamp with time zone,
         paused_until timestamp with time zone)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       SELECT r.refusal,r.refused_since,
              CASE WHEN r.refusal='SubsidyExhausted' THEN ${monthNext}
                   ELSE s.paused_until END
         FROM selector_lead_refusal r
         LEFT JOIN LATERAL ${leadRunnerStandingFunction}(r.tenant,r.project,in_polled_secs_max) s
           ON r.refusal='UsagePaused'
        WHERE r.tenant=in_tenant AND r.project=in_project
     $$`,
  ],
};
