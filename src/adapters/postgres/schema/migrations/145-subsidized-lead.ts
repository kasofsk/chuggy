/**
 * A deployment may offer a project's lead a subsidized run, and a project's
 * row keeps whether its lead takes one.
 *
 * THE PROFILE IS ONE ROW, AND ONLY WHILE THE DEPLOYMENT OFFERS ONE. The
 * selector writes it as it starts from its own configuration, or deletes it
 * where that names none, so the API reads the selector's profile rather than a
 * copy of its own. The API reads it through `read_subsidized_lead` and holds no
 * grant on it, as it reads `selector_lead_refusal`. Its bounds are the ones
 * the selector's configuration holds it to, written out.
 *
 * THE OFFERING IS THE LEAD'S, ON ITS `InCluster` ROUTE. A project's row reads
 * `Own` until an administrator writes otherwise, so every lead runs as it did.
 * `set_project_session_placement` takes the offering, and one it is not named
 * is kept while the lead stays in cluster and is `Own` otherwise.
 * `session_lead_offering` answers `Subsidized` only where the lead's route is
 * the row's own and the profile stands, so an override, a default or a
 * withdrawn profile runs the lead as its own, and the row's choice holds again
 * once the profile does. `stored_lead_offering` answers the row's choice
 * itself, which is what a write naming no offering is held to.
 */

import {
  apiRole,
  boundaryOwnerRole,
  selectorServiceRole,
  sessionLeadOfferingFunction,
  sessionPlacementSetFunction,
  sessionRouteFunction,
  storedLeadOfferingFunction,
  subsidizedLeadReadFunction,
  type Migration,
} from "../shared.ts";

const placementSetBefore = `public.${sessionPlacementSetFunction}(in_tenant text, in_project text, in_thread text, in_lead text, in_authority_kind text, in_authority_subject text)`;

const placementSet = `public.${sessionPlacementSetFunction}(in_tenant text, in_project text, in_thread text, in_lead text, in_lead_offering text, in_authority_kind text, in_authority_subject text)`;

const offering = `public.${sessionLeadOfferingFunction}(in_tenant text, in_project text)`;

const stored = `public.${storedLeadOfferingFunction}(in_tenant text, in_project text)`;

const profileRead = `public.${subsidizedLeadReadFunction}()`;

/** The definer boilerplate every function this adds ends with, granted to `roles`. */
function owned(signature: string, roles: readonly string[]): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    ...roles.map((role) => `GRANT EXECUTE ON FUNCTION ${signature} TO ${role}`),
  ];
}

export const migration145: Migration = {
  version: 145,
  name: "a deployment may offer a subsidized lead, and a project may choose it",
  statements: [
    `CREATE TABLE public.subsidized_lead (
       singleton integer PRIMARY KEY DEFAULT 1
         CONSTRAINT subsidized_lead_is_one_row CHECK (singleton=1),
       credential_slot text NOT NULL
         CONSTRAINT subsidized_lead_credential_slot_is_bounded
         CHECK (length(credential_slot) BETWEEN 1 AND 256),
       model text NOT NULL
         CONSTRAINT subsidized_lead_model_is_bounded
         CHECK (length(model) BETWEEN 1 AND 128),
       effort text NOT NULL
         CONSTRAINT subsidized_lead_effort_is_known
         CHECK (effort IN ('low','medium','high','xhigh','max')),
       auto_compact_window bigint NOT NULL
         CONSTRAINT subsidized_lead_auto_compact_window_is_bounded
         CHECK (auto_compact_window BETWEEN 100000 AND 1000000),
       input_bytes_per_decision bigint NOT NULL
         CONSTRAINT subsidized_lead_input_bytes_per_decision_is_positive
         CHECK (input_bytes_per_decision >= 1),
       turn_tokens_max bigint NOT NULL
         CONSTRAINT subsidized_lead_turn_tokens_max_is_bounded
         CHECK (turn_tokens_max BETWEEN 1 AND 1000000),
       published_at timestamp with time zone DEFAULT now() NOT NULL)`,
    `GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.subsidized_lead TO ${selectorServiceRole}`,
    `GRANT SELECT ON TABLE public.subsidized_lead TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${profileRead} RETURNS TABLE(credential_slot text, model text, effort text, auto_compact_window bigint, input_bytes_per_decision bigint, turn_tokens_max bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT l.credential_slot,l.model,l.effort,l.auto_compact_window,
              l.input_bytes_per_decision,l.turn_tokens_max
         FROM subsidized_lead l
     $$`,
    ...owned(profileRead, [apiRole]),
    `ALTER TABLE public.project_session_placement
       ADD COLUMN lead_offering text NOT NULL DEFAULT 'Own'
         CONSTRAINT project_session_placement_lead_offering_is_known
         CHECK (lead_offering IN ('Own','Subsidized')),
       ADD CONSTRAINT project_session_placement_subsidized_lead_is_in_cluster
         CHECK (lead_offering='Own' OR lead_route='InCluster')`,
    `DROP FUNCTION ${placementSetBefore}`,
    `CREATE FUNCTION ${placementSet} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE standing project_session_placement%ROWTYPE; chosen text;
     BEGIN
       PERFORM 1 FROM project p
        WHERE p.tenant=in_tenant AND p.project=in_project;
       IF NOT FOUND THEN RETURN 'NotFound'; END IF;
       SELECT * INTO standing FROM project_session_placement x
        WHERE x.tenant=in_tenant AND x.project=in_project FOR UPDATE;
       chosen := coalesce(in_lead_offering,
                          CASE WHEN in_lead='InCluster'
                               THEN coalesce(standing.lead_offering,'Own')
                               ELSE 'Own' END);
       IF FOUND AND standing.thread_route=in_thread
          AND standing.lead_route=in_lead
          AND standing.lead_offering=chosen THEN
         RETURN 'Unchanged';
       END IF;
       INSERT INTO project_session_placement
         (tenant,project,thread_route,lead_route,lead_offering,
          set_by_kind,set_by_subject,set_at)
         VALUES (in_tenant,in_project,in_thread,in_lead,chosen,
                 in_authority_kind,in_authority_subject,now())
         ON CONFLICT (tenant,project) DO UPDATE
           SET thread_route=EXCLUDED.thread_route,
               lead_route=EXCLUDED.lead_route,
               lead_offering=EXCLUDED.lead_offering,
               set_by_kind=EXCLUDED.set_by_kind,
               set_by_subject=EXCLUDED.set_by_subject,
               set_at=EXCLUDED.set_at;
       RETURN 'Written';
     END $$`,
    ...owned(placementSet, [apiRole]),
    `CREATE FUNCTION ${offering} RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT CASE WHEN r.source='Project' AND p.lead_offering='Subsidized'
                        AND EXISTS (SELECT 1 FROM subsidized_lead)
                   THEN 'Subsidized' ELSE 'Own' END
         FROM ${sessionRouteFunction}(in_tenant,in_project,'Lead') r
         LEFT JOIN project_session_placement p
           ON p.tenant=in_tenant AND p.project=in_project
     $$`,
    ...owned(offering, [apiRole, selectorServiceRole]),
    `CREATE FUNCTION ${stored} RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT coalesce(
         (SELECT p.lead_offering FROM project_session_placement p
           WHERE p.tenant=in_tenant AND p.project=in_project),
         'Own')
     $$`,
    ...owned(stored, [apiRole]),
  ],
};
