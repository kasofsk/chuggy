/**
 * A workspace's display name, as its settings offer to change it: only to a
 * reader the plane says administers the workspace, and sent only where what
 * they typed is a display name the contract takes and is not the name it
 * already has.
 */

import type { AccessTenantAbilities } from "../../../../src/contract/accessPlane.ts";
import { projectDisplayNameSchema } from "../../../../src/contract/requests.ts";

export function tenantRenameOffered(
  abilities: AccessTenantAbilities | undefined,
): boolean {
  return abilities?.administerTenant === true;
}

/** The name `typed` sends, trimmed, or nothing where it would send none. */
export function tenantRenameSent(
  typed: string,
  current: string,
): string | undefined {
  const parsed = projectDisplayNameSchema.safeParse(typed);
  return parsed.success && parsed.data !== current ? parsed.data : undefined;
}
