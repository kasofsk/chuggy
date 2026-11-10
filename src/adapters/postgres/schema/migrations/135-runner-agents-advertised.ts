/**
 * A personal runner whose poll advertises exactly the agents it takes is
 * offered a job only of an agent it names, or of none.
 *
 * `personal_runner.agents_advertised` IS WRITTEN BY EVERY POLL, true where the
 * poll named a release whose runner names among its capabilities exactly the
 * agents it takes now, and false otherwise, so a runner moved back to an
 * earlier release is read as one. It is false until a poll writes it.
 *
 * `worker_pool_agent_offered` IS THE MODEL'S `agentOffered`, as
 * `workerPoolAgentOffered` restates it: an attempt whose `agent` is NULL, a
 * command stage among them, is taken by any runner; one naming an agent is
 * taken by a runner advertising none, or by one whose capabilities name its
 * `Agent:` token. The pool plane's claims call it, and nothing else.
 */

import {
  boundaryOwnerRole,
  poolPlaneRole,
  workerPoolAgentFunction,
  type Migration,
} from "../shared.ts";

const offered = `public.${workerPoolAgentFunction}(in_agent text, in_capabilities text[], in_agents_advertised boolean)`;

export const migration135: Migration = {
  version: 135,
  name: "a personal runner advertising its agents is offered a job only of an agent it names",
  statements: [
    `ALTER TABLE public.personal_runner
       ADD COLUMN agents_advertised boolean NOT NULL DEFAULT false`,
    `GRANT SELECT(agents_advertised),UPDATE(agents_advertised)
       ON TABLE public.personal_runner TO ${poolPlaneRole}`,
    `CREATE FUNCTION ${offered} RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $$
       SELECT in_agent IS NULL OR NOT in_agents_advertised
         OR 'Agent:' || in_agent = ANY(in_capabilities)
     $$`,
    `ALTER FUNCTION ${offered} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${offered} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${offered} TO ${poolPlaneRole}`,
  ],
};
