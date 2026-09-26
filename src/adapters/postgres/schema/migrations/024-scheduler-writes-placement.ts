import { schedulerRole, type Migration } from "../shared.ts";

/**
 * The scheduler writes an execution's route when it registers one, and only
 * then: the grant is on the INSERT, so a route policy that moves later cannot
 * move an execution already registered, and its column-scoped UPDATE still
 * names no `placement`.
 */
export const migration024: Migration = {
  version: 24,
  name: "the scheduler writes the route it registers",
  statements: [
    `GRANT INSERT(placement) ON TABLE public.execution TO ${schedulerRole}`,
  ],
};
