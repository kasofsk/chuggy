import { poolPlaneRole, type Migration } from "../shared.ts";

/**
 * A registered pool records its class, the model's `RunnerClass`, which a
 * claim reads.
 *
 * THE CHECK ADMITS ONE CLASS, THE ONE EVERY POOL IS REGISTERED AS. A class the
 * registry does not yet serve is refused by the server rather than stored and
 * ignored. Admitting another is a change to this constraint.
 *
 * THE DEFAULT LIVES ONLY AS LONG AS THE BACKFILL. A row registered before this
 * migration is `Dedicated`, which is what every pool was. The default is then
 * dropped, so a registration that names no class is refused rather than given
 * one.
 *
 * The API's table-level grant already reaches the new column. The pool plane
 * is granted a read of it and nothing more.
 */
export const migration020: Migration = {
  version: 20,
  name: "a worker pool registers its class",
  statements: [
    `ALTER TABLE public.worker_pool
       ADD COLUMN class text NOT NULL DEFAULT 'Dedicated'
         CONSTRAINT worker_pool_class_is_known CHECK (class IN ('Dedicated'))`,
    `ALTER TABLE public.worker_pool ALTER COLUMN class DROP DEFAULT`,
    `GRANT SELECT(class) ON TABLE public.worker_pool TO ${poolPlaneRole}`,
  ],
};
