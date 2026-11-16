import { schedulerRole, type Migration } from "../shared.ts";

/**
 * Every job's briefing carries its project's North Star, and the scheduler is
 * what composes a briefing, so its role reads that column beside the thread
 * standing rules it was already granted.
 */
export const migration194: Migration = {
  version: 194,
  name: "the scheduler reads a project's north star",
  statements: [
    `GRANT SELECT(north_star) ON TABLE public.selector_project_settings TO ${schedulerRole}`,
  ],
};
