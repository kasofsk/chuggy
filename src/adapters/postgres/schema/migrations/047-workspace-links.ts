/**
 * The site's workspace links, kept beside a tenant's invite links.
 *
 * A WORKSPACE LINK NAMES NO TENANT. Its `tenant` is empty, so no statement
 * keyed by a tenant reaches one, and so are `role` and `projects`, which only
 * a tenant's link grants. It keeps instead whether the workspace's
 * administrators may make accounts, and its maker's note.
 *
 * THE NAME A USE CHOSE IS `workspace`, NEVER `tenant`, so the plane's role is
 * never given the power to move a tenant's link to another tenant. The spend
 * writes it and a give-back clears it, and no two links hold one name. The
 * index is over used links rather than open ones, because an index cannot ask
 * the clock.
 *
 * 046's rules still bind: only the token's digest is stored, no state is
 * stored, a name names no row, and no constraint spells a roster.
 */

import { accessPlaneRole, type Migration } from "../shared.ts";

export const migration047: Migration = {
  version: 47,
  name: "the site keeps its workspace links",
  statements: [
    `ALTER TABLE public.invite_link
       ALTER COLUMN tenant DROP NOT NULL,
       ALTER COLUMN role DROP NOT NULL,
       ALTER COLUMN projects DROP NOT NULL,
       ADD COLUMN create_accounts boolean,
       ADD COLUMN note text CHECK(note IS NULL OR length(note) BETWEEN 1 AND 1024),
       ADD COLUMN workspace text
         CHECK(workspace IS NULL OR length(workspace) BETWEEN 1 AND 256),
       ADD CONSTRAINT invite_link_is_one_kind CHECK(
         CASE WHEN tenant IS NULL
           THEN role IS NULL AND projects IS NULL AND create_accounts IS NOT NULL
             AND (workspace IS NULL) = (used_at IS NULL)
           ELSE role IS NOT NULL AND projects IS NOT NULL
             AND create_accounts IS NULL AND note IS NULL AND workspace IS NULL
         END)`,
    `CREATE UNIQUE INDEX invite_link_workspace_once
       ON public.invite_link(workspace) WHERE workspace IS NOT NULL`,
    `CREATE INDEX invite_link_site
       ON public.invite_link(minted_at) WHERE tenant IS NULL`,
    `GRANT UPDATE(workspace) ON TABLE public.invite_link TO ${accessPlaneRole}`,
  ],
};
