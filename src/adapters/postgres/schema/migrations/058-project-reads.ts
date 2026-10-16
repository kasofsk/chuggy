/**
 * A job reads every repository its project binds, and its pod may ask a read
 * of any of them.
 *
 * THE SCHEDULER MAY LIST ONE PROJECT'S BINDINGS, for telling a job which
 * repositories beside its own it may read, through the per-project door the API
 * answers the listing from; it holds no grant on the table behind it.
 *
 * THE WORKER PLANE READS A BINDING THROUGH THE DOOR THAT ANSWERS ITS
 * RETIREMENT, because a pod may name a repository of its project and the
 * point read in-flight work names its repository through answers a retired
 * binding as though it stood. The plane reads a binding through nothing else,
 * so the door it read through before is taken from it.
 */

import {
  repositoryBindingListFunction,
  repositoryBindingReadFunction,
  repositoryLandingReadFunction,
  schedulerRole,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

export const migration058: Migration = {
  version: 58,
  name: "a job reads every repository its project binds",
  statements: [
    `GRANT ALL ON FUNCTION public.${repositoryBindingListFunction}(in_tenant text, in_project text, in_max bigint) TO ${schedulerRole}`,
    `GRANT ALL ON FUNCTION public.${repositoryLandingReadFunction}(in_tenant text, in_project text, in_repository text) TO ${workerPlaneRole}`,
    `REVOKE ALL ON FUNCTION public.${repositoryBindingReadFunction}(in_tenant text, in_project text, in_repository text) FROM ${workerPlaneRole}`,
  ],
};
