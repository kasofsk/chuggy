import { apiRole, type Migration } from "../shared.ts";

/**
 * The token an owner mints for a machine, and the one relation redeeming it
 * spends.
 *
 * ONLY ITS DIGEST IS STORED, which is what an attempt's bearer and nothing else
 * in this tree already does. A short life is `expires_at` and a single use is
 * `redeemed_at`, and the second is enforced by the update that sets it rather
 * than by anything a caller checks first: two machines redeeming one token are
 * separated by that write and by nothing else.
 *
 * THE ROLE THAT MAY SPEND ONE IS THE API'S, and the plane a pool polls is
 * granted nothing here at all. Redeeming creates a client at the issuer, which
 * is the privilege that must stay off the outward-facing process; an owner
 * authenticates and is authorized for the mint at the same door every other
 * project-scoped command uses.
 */
export const migration010: Migration = {
  version: 10,
  name: "worker-pool-registration-token",
  statements: [
    `CREATE TABLE worker_pool_registration_token (
       token_digest text PRIMARY KEY CHECK(token_digest ~ '^[0-9a-f]{64}$'),
       tenant text NOT NULL, project text NOT NULL,
       capabilities text[] NOT NULL DEFAULT '{}',
       expires_at timestamptz NOT NULL,
       redeemed_at timestamptz,
       minted_at timestamptz NOT NULL DEFAULT now(),
       FOREIGN KEY(tenant,project) REFERENCES project(tenant,project))`,
    `GRANT SELECT,INSERT ON worker_pool_registration_token TO ${apiRole}`,
    `GRANT UPDATE(redeemed_at) ON worker_pool_registration_token TO ${apiRole}`,
    `GRANT SELECT,INSERT,DELETE ON worker_pool TO ${apiRole}`,
  ],
};
