import { apiRole, type Migration } from "../shared.ts";

/**
 * The API reads whether an execution may run on its owner's personal runner,
 * and whether that owner is the reader, so an execution waiting on the reader's
 * own runner can say so. It reads the columns that decide it and writes none.
 */
export const migration051: Migration = {
  version: 51,
  name: "the API reads an execution's route, owner and fallback",
  statements: [
    `GRANT SELECT(placement,owner,owner_fallback) ON TABLE public.execution TO ${apiRole}`,
  ],
};
