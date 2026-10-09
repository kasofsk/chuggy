/**
 * One press that sends a person to the forge, as both transactions held in tab
 * storage carry it: the tenant it claims for, the page it returns to, and the
 * apps whose install it has been sent on to. A landing reads that list and
 * never works it out, so a press is sent on to one app's install at most once.
 */

import { forgeApps } from "../../../../src/contract/rosters.ts";
import type { ForgeAppName } from "../../../../src/contract/rosters.ts";

export interface ForgePress {
  readonly tenant: string;
  readonly returnPath: string;
  readonly installs: readonly ForgeAppName[];
}

/** A stored list read back in the roster's order, and as none where it holds
 * anything but the roster's apps or holds one twice. */
function forgePressInstallsOf(
  value: unknown,
): readonly ForgeAppName[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const members: readonly unknown[] = value;
  const installs = forgeApps.filter((app) => members.includes(app));
  return installs.length === members.length ? installs : undefined;
}

/** The press a stored transaction carries, which is none where it lacks a field
 * of one. */
export function forgePressOf(
  fields: Readonly<Record<string, unknown>>,
): ForgePress | undefined {
  const { tenant, returnPath } = fields;
  if (typeof tenant !== "string" || typeof returnPath !== "string")
    return undefined;
  const installs = forgePressInstallsOf(fields["installs"]);
  return installs === undefined ? undefined : { tenant, returnPath, installs };
}

/** The press as it leaves for an app's install, carrying nothing else of the
 * transaction it was read from. */
export function forgePressSentOn(
  press: ForgePress,
  app: ForgeAppName,
): ForgePress {
  return {
    tenant: press.tenant,
    returnPath: press.returnPath,
    installs: [...press.installs, app],
  };
}
