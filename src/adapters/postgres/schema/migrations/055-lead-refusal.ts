/**
 * The selector keeps what the last cycle that needed a project's lead was
 * refused admission for, and the API reads it for a project holding no lead.
 *
 * ONE ROW A PROJECT, AND ONLY WHILE A REFUSAL STANDS. The selector writes it
 * when a cycle's admission is refused and deletes it when a cycle of the
 * project is admitted or has nothing to decide, so a project with no row is one
 * no refusal stands for. `refused_since` is the database's clock when the
 * refusal kept began: the same refusal again moves nothing, and another
 * replaces it and starts again.
 *
 * THE CODES ARE THE CONTRACT'S `leadAdmissionRefusals` AS THEY STAND HERE,
 * written out rather than read from it, so this file goes on saying what it
 * installed when that roster grows. A new code is a new migration.
 *
 * THE API READS IT THROUGH `read_lead_refusal` AND HOLDS NO GRANT ON IT, as it
 * reads the lead's standing; the function answers one project's row by its own
 * arguments.
 */

import {
  apiRole,
  boundaryOwnerRole,
  leadRefusalReadFunction,
  selectorServiceRole,
  type Migration,
} from "../shared.ts";

const read = `public.${leadRefusalReadFunction}(in_tenant text, in_project text)`;

export const migration055: Migration = {
  version: 55,
  name: "the selector keeps why a project's lead was refused admission",
  statements: [
    `CREATE TABLE public.selector_lead_refusal (
       tenant text NOT NULL,
       project text NOT NULL,
       refusal text NOT NULL
         CONSTRAINT selector_lead_refusal_is_known
         CHECK (refusal = ANY (ARRAY['HostedRunsNotGranted'::text, 'RunnerOffline'::text])),
       refused_since timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (tenant, project),
       CONSTRAINT selector_lead_refusal_names_a_project
         FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project))`,
    `GRANT SELECT,INSERT,DELETE ON TABLE public.selector_lead_refusal TO ${selectorServiceRole}`,
    `GRANT UPDATE(refusal,refused_since) ON TABLE public.selector_lead_refusal TO ${selectorServiceRole}`,
    `GRANT SELECT ON TABLE public.selector_lead_refusal TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${read} RETURNS TABLE(refusal text, refused_since timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT r.refusal,r.refused_since
         FROM selector_lead_refusal r
        WHERE r.tenant=in_tenant AND r.project=in_project
     $$`,
    `ALTER FUNCTION ${read} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${read} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${read} TO ${apiRole}`,
  ],
};
