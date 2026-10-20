/**
 * The runner a pool's or a member's newest poll named: the package it is
 * installed as and the version it runs.
 *
 * WHAT THE NEWEST POLL NAMED, AND NOTHING WHERE IT NAMED NONE. The pool plane
 * writes both on every poll whose answer differs from what is kept, so a
 * machine moved back to a runner that names none is kept as naming none rather
 * than as the version it ran before. A registration starts with neither.
 *
 * THE GRAMMAR IS THE WORKER CONTRACT'S HEADER AS IT STANDS HERE, written out
 * rather than read from it, so this file goes on saying what it installed.
 */

import { apiRole, poolPlaneRole, type Migration } from "../shared.ts";

/** A runner's package and version on `table`, both or neither, each held to the header's grammar. */
function runnerColumns(table: string): string {
  return `ALTER TABLE public.${table}
       ADD COLUMN runner_package text
         CONSTRAINT ${table}_runner_package_is_a_package
         CHECK (runner_package ~ '^[a-z][a-z0-9-]{0,62}$'),
       ADD COLUMN runner_version text
         CONSTRAINT ${table}_runner_version_is_a_release
         CHECK (runner_version
           ~ '^(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})$'),
       ADD CONSTRAINT ${table}_runner_is_named_whole
         CHECK ((runner_package IS NULL) = (runner_version IS NULL))`;
}

export const migration069: Migration = {
  version: 69,
  name: "a pool and a member's runner keep the runner their poll names",
  statements: [
    runnerColumns("worker_pool"),
    runnerColumns("personal_runner"),
    `GRANT SELECT(runner_package,runner_version),UPDATE(runner_package,runner_version)
       ON TABLE public.worker_pool TO ${poolPlaneRole}`,
    `GRANT SELECT(runner_package,runner_version),UPDATE(runner_package,runner_version)
       ON TABLE public.personal_runner TO ${poolPlaneRole}`,
    `GRANT UPDATE(runner_package,runner_version) ON TABLE public.personal_runner TO ${apiRole}`,
  ],
};
