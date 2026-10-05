import { apiRole, type Migration } from "../shared.ts";

/**
 * The API reads which commits a ticket's merged change proposals landed and in
 * which repository: a proposal's commit and permit, the permit's attempt, that
 * attempt's repository, and the request's key and position beside the ticket
 * and sequence it already reads. It writes none of them.
 */
export const migration036: Migration = {
  version: 36,
  name: "the API reads the commits a ticket's merges landed",
  statements: [
    `GRANT SELECT(tenant,project,request,permit,merge_commit)
       ON TABLE public.finalization_change_proposal TO ${apiRole}`,
    `GRANT SELECT(tenant,project,permit,attempt)
       ON TABLE public.commit_permit TO ${apiRole}`,
    `GRANT SELECT(tenant,project,attempt,repository)
       ON TABLE public.finalization_attempt TO ${apiRole}`,
    `GRANT SELECT(request,effect_position)
       ON TABLE public.finalization_request TO ${apiRole}`,
  ],
};
