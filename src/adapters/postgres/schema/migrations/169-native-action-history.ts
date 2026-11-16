/**
 * A ticket's native actions are read after they settle.
 *
 * THE API READS AN ACTION'S RESOLUTION AND ITS ATTEMPT. A ticket's history of
 * actions names what each answered one was answered with and the finalization
 * attempt an approval asked about, beside the execution and the answerer it
 * already reads. The rest of the desk stays the writer's.
 */

import { apiRole, type Migration } from "../shared.ts";

export const migration169: Migration = {
  version: 169,
  name: "the API reads a native action's resolution and the attempt it asked about",
  statements: [
    `GRANT SELECT (resolution, attempt) ON TABLE public.native_action TO ${apiRole}`,
  ],
};
