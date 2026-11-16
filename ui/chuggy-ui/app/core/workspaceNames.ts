/**
 * What the console names a workspace to its reader: the display name the
 * reader's own list of workspaces answers, and the workspace's id wherever it
 * answers none — a read not yet answered or failed, or a workspace the reader
 * sees only a project of. The id stays what every address names.
 */

import type {
  AccessCallerTenant,
  AccessCallerTenants,
} from "../../../../src/contract/accessPlane.ts";

import type { PanelState } from "./freshness.ts";

export type WorkspaceNamed = (tenant: string) => string;

/** The names a list of the reader's own workspaces gives, the id for any it leaves out. */
export function workspaceNamesListed(
  tenants: readonly AccessCallerTenant[],
): WorkspaceNamed {
  const named = new Map(
    tenants.map((listed) => [listed.tenant, listed.displayName]),
  );
  return (tenant) => named.get(tenant) ?? tenant;
}

export function workspaceNames(
  held: PanelState<AccessCallerTenants>,
): WorkspaceNamed {
  return workspaceNamesListed(held.state === "Ready" ? held.value.tenants : []);
}
