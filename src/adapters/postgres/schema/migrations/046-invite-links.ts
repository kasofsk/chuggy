/**
 * A tenant's invite links, and the role of the access plane that keeps them.
 *
 * A LINK IS NOT A ROLE. Until it is redeemed nobody holds anything, and once
 * it is, what they hold is tuples in the authority, so nothing here is asked
 * who holds what. The plane's role reaches this table and nothing else.
 *
 * ONLY THE TOKEN'S DIGEST IS STORED, as a registration token's is.
 *
 * NO STATE IS STORED. Whether a link is open, used, revoked or expired is
 * derived from `used_at`, `revoked_at` and `expires_at` against the
 * database's own clock, in the statement that asks.
 *
 * `tenant` NAMES NO ROW. A tenant the plane makes has no `tenant` row until
 * its first project, so a key onto one would refuse that tenant's links.
 *
 * A ROLE IS KEPT AS THE CONTRACT SPELLS IT, and read back through its schema.
 * No constraint names the roster, because a roster grows and a landed
 * migration would hold it as literals.
 */

import { accessPlaneRole, roleStatement, type Migration } from "../shared.ts";

export const migration046: Migration = {
  version: 46,
  name: "a tenant keeps its invite links",
  statements: [
    roleStatement(accessPlaneRole),
    `GRANT USAGE ON SCHEMA public TO ${accessPlaneRole}`,
    `GRANT SELECT ON TABLE public.schema_migration TO ${accessPlaneRole}`,
    `CREATE TABLE public.invite_link (
       link text PRIMARY KEY DEFAULT gen_random_uuid()::text
         CHECK(length(link) BETWEEN 1 AND 256),
       tenant text NOT NULL CHECK(length(tenant) BETWEEN 1 AND 256),
       token_digest text NOT NULL UNIQUE CHECK(token_digest ~ '^[0-9a-f]{64}$'),
       role text NOT NULL CHECK(length(role) BETWEEN 1 AND 64),
       projects jsonb NOT NULL CHECK(jsonb_typeof(projects)='array'),
       new_accounts boolean NOT NULL,
       minted_by text NOT NULL CHECK(length(minted_by) BETWEEN 1 AND 256),
       minted_at timestamptz NOT NULL DEFAULT now(),
       expires_at timestamptz NOT NULL,
       used_by text CHECK(used_by IS NULL OR length(used_by) BETWEEN 1 AND 256),
       used_at timestamptz,
       revoked_at timestamptz,
       CONSTRAINT invite_link_use_is_whole CHECK((used_by IS NULL) = (used_at IS NULL)),
       CONSTRAINT invite_link_ends_once CHECK(used_at IS NULL OR revoked_at IS NULL),
       CONSTRAINT invite_link_expires_after_minting CHECK(expires_at > minted_at))`,
    `CREATE INDEX invite_link_tenant ON public.invite_link(tenant, minted_at)`,
    `GRANT SELECT,INSERT,DELETE ON TABLE public.invite_link TO ${accessPlaneRole}`,
    `GRANT UPDATE(used_by,used_at,revoked_at) ON TABLE public.invite_link TO ${accessPlaneRole}`,
  ],
};
