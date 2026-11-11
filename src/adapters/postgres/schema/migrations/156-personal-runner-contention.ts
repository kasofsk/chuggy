/**
 * The API reads what each of a member's runners holds and how many attempts
 * wait for them, which is its owner's runners page.
 *
 * A HELD ATTEMPT IS NAMED BY WHO CLAIMED IT. The API reads `pool`, `personal`
 * and `pool_principal` of `execution_attempt`, which name the member and the
 * registration that claimed an attempt: a principal is a public name, and a
 * pool's name is answered on its project's listing already. It reads
 * `invoked` and `recovery_epoch`, which a waiting attempt is held to by the
 * personal claim's predicate, and executes the two pure functions that
 * predicate matches a runner by. It reads neither `capability_secret_digest`
 * nor `assignment`, the bearer's digest and the identity a runner holds an
 * attempt under, and writes nothing.
 */

import {
  apiRole,
  workerPoolAgentFunction,
  workerPoolInventoryFunction,
  type Migration,
} from "../shared.ts";

export const migration156: Migration = {
  version: 156,
  name: "the API reads what a member's runners hold and what waits for them",
  statements: [
    `GRANT SELECT(pool,personal,pool_principal,invoked,recovery_epoch)
       ON TABLE public.execution_attempt TO ${apiRole}`,
    `GRANT EXECUTE ON FUNCTION public.${workerPoolInventoryFunction}(in_requirement jsonb, in_capabilities text[]) TO ${apiRole}`,
    `GRANT EXECUTE ON FUNCTION public.${workerPoolAgentFunction}(in_agent text, in_capabilities text[], in_agents_advertised boolean) TO ${apiRole}`,
  ],
};
