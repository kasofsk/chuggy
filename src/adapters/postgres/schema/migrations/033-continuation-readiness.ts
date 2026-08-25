import {
  boundaryOwnerRole,
  continuationFunction,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

/** Publishes continuation inputs and their discovery wake-up through one boundary. */
export const migration033: Migration = {
  version: 33,
  name: "continuation readiness boundary",
  statements: [
    `CREATE OR REPLACE FUNCTION ${continuationFunction}(
       in_tenant text, in_project text, in_ordinal bigint, in_continuation text)
       RETURNS void
       LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
       BEGIN
         INSERT INTO decision_input
           (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
         SELECT in_tenant, in_project, in_ordinal, 'Continuation', in_continuation,
                'Continuation', lifecycle_generation
           FROM project WHERE tenant=in_tenant AND project=in_project;
         INSERT INTO project_readiness (tenant, project, ready, generation)
         VALUES (in_tenant, in_project, true, 1)
         ON CONFLICT (tenant, project) DO UPDATE
           SET ready=true, generation=project_readiness.generation+1;
       END $$`,
    `ALTER FUNCTION ${continuationFunction}(text,text,bigint,text)
       OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${continuationFunction}(text,text,bigint,text) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${continuationFunction}(text,text,bigint,text)
       TO ${ticketServiceRole}`,
  ],
};
