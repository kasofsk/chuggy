import { apiRole, type Migration } from "../shared.ts";

/**
 * The API reads which artifacts an attempt's worker uploaded, which is how a
 * run that ended without a result is found to have left its worker's own text
 * saying why. It reads and never writes: a reservation is the worker plane's,
 * made through `reserve_worker_artifact` alone.
 */
export const migration030: Migration = {
  version: 30,
  name: "the API reads the artifacts an attempt's worker uploaded",
  statements: [
    `GRANT SELECT(tenant,project,execution,attempt,path,digest,bytes)
       ON TABLE public.worker_artifact_reservation TO ${apiRole}`,
  ],
};
