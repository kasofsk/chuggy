import {
  apiRole,
  boundaryOwnerRole,
  executionPlacementSetFunction,
  schedulerRole,
  type Migration,
} from "../shared.ts";

const signature = `public.${executionPlacementSetFunction}(in_tenant text, in_project text, in_work text, in_evaluation text, in_authority_kind text, in_authority_subject text)`;

/**
 * Where a project's executions run is the project's own row, and the scheduler
 * publishes its routing beside it so the API can say which of the two decides.
 * Every existing project is backfilled in cluster with no setter, because
 * nobody chose it; a write that changes nothing keeps the setter it had.
 */
export const migration027: Migration = {
  version: 27,
  name: "where a project's work runs is the project's own row",
  statements: [
    `CREATE TABLE public.project_execution_placement (
       tenant text NOT NULL,
       project text NOT NULL,
       work_route text NOT NULL
         CONSTRAINT project_execution_placement_work_is_known
         CHECK (work_route IN ('InCluster','Pool')),
       evaluation_route text NOT NULL
         CONSTRAINT project_execution_placement_evaluation_is_known
         CHECK (evaluation_route IN ('InCluster','Pool')),
       set_by_kind text,
       set_by_subject text,
       set_at timestamp with time zone,
       CONSTRAINT project_execution_placement_setter_is_whole CHECK (
         (set_by_kind IS NULL AND set_by_subject IS NULL AND set_at IS NULL)
         OR (length(set_by_kind) BETWEEN 1 AND 256
             AND length(set_by_subject) BETWEEN 1 AND 256
             AND set_at IS NOT NULL)),
       PRIMARY KEY (tenant,project),
       CONSTRAINT project_execution_placement_names_a_project
         FOREIGN KEY (tenant,project) REFERENCES public.project(tenant,project))`,
    `INSERT INTO public.project_execution_placement
       (tenant,project,work_route,evaluation_route)
       SELECT tenant,project,'InCluster','InCluster' FROM public.project`,
    `CREATE TABLE public.execution_routing (
       singleton integer PRIMARY KEY DEFAULT 1
         CONSTRAINT execution_routing_is_one_row CHECK (singleton=1),
       work_route text NOT NULL
         CONSTRAINT execution_routing_work_is_known
         CHECK (work_route IN ('InCluster','Pool')),
       evaluation_route text NOT NULL
         CONSTRAINT execution_routing_evaluation_is_known
         CHECK (evaluation_route IN ('InCluster','Pool')),
       project_routes jsonb NOT NULL
         CONSTRAINT execution_routing_overrides_are_an_object
         CHECK (jsonb_typeof(project_routes)='object'),
       published_at timestamp with time zone DEFAULT now() NOT NULL)`,
    `INSERT INTO public.execution_routing
       (singleton,work_route,evaluation_route,project_routes)
       VALUES (1,'InCluster','InCluster','{}'::jsonb)`,
    `GRANT SELECT,INSERT,UPDATE ON TABLE public.project_execution_placement TO ${boundaryOwnerRole}`,
    `GRANT SELECT ON TABLE public.project_execution_placement TO ${schedulerRole}`,
    `GRANT SELECT ON TABLE public.project_execution_placement TO ${apiRole}`,
    `GRANT SELECT,INSERT,UPDATE ON TABLE public.execution_routing TO ${schedulerRole}`,
    `GRANT SELECT ON TABLE public.execution_routing TO ${apiRole}`,
    `CREATE FUNCTION ${signature} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE standing project_execution_placement%ROWTYPE;
     BEGIN
       PERFORM 1 FROM project p
        WHERE p.tenant=in_tenant AND p.project=in_project;
       IF NOT FOUND THEN RETURN 'NotFound'; END IF;
       SELECT * INTO standing FROM project_execution_placement x
        WHERE x.tenant=in_tenant AND x.project=in_project FOR UPDATE;
       IF FOUND AND standing.work_route=in_work
          AND standing.evaluation_route=in_evaluation THEN
         RETURN 'Unchanged';
       END IF;
       INSERT INTO project_execution_placement
         (tenant,project,work_route,evaluation_route,
          set_by_kind,set_by_subject,set_at)
         VALUES (in_tenant,in_project,in_work,in_evaluation,
                 in_authority_kind,in_authority_subject,now())
         ON CONFLICT (tenant,project) DO UPDATE
           SET work_route=EXCLUDED.work_route,
               evaluation_route=EXCLUDED.evaluation_route,
               set_by_kind=EXCLUDED.set_by_kind,
               set_by_subject=EXCLUDED.set_by_subject,
               set_at=EXCLUDED.set_at;
       RETURN 'Written';
     END $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
  ],
};
