/**
 * A registration token permits registering and nothing about what the runner
 * declares, so neither token relation keeps the capabilities it was minted
 * with. A token standing when this runs keeps its digest, its scope, its
 * minter and its expiry, and registers whatever its runner declares.
 */

import type { Migration } from "../shared.ts";

export const migration077: Migration = {
  version: 77,
  name: "a registration token carries no capabilities",
  statements: [
    `ALTER TABLE public.worker_pool_registration_token DROP COLUMN capabilities`,
    `ALTER TABLE public.personal_runner_registration_token DROP COLUMN capabilities`,
  ],
};
