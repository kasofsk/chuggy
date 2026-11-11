/**
 * The API reads which execution a carried one carried its verdict from.
 *
 * `execution_verdict_carry` is opened to the API on the four columns that name
 * a carry and nothing else, so an execution's read can say it was settled on
 * an earlier verdict rather than run, and name that earlier execution. The API
 * writes none of it.
 */

import { apiRole, type Migration } from "../shared.ts";

export const migration158: Migration = {
  version: 158,
  name: "the API reads which execution a carried one carried from",
  statements: [
    `GRANT SELECT(tenant,project,execution,source_execution) ON TABLE public.execution_verdict_carry TO ${apiRole}`,
  ],
};
