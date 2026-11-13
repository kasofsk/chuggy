/**
 * The caller's own account, answered to any caller signed in about them
 * alone: their subject, their principal, and who the directory says they are.
 *
 * WHO THEY ARE IS ASKED AS A PEOPLE LIST ASKS IT, through
 * `accessAccountsNamed`, so the caller is named exactly as a list naming them
 * would: no directory's fields on a plane with none, `account: false` for a
 * subject the directory holds no account under, and a directory that could
 * not answer thrown as it is there.
 *
 * A PRINCIPAL UNDER ANOTHER ISSUER IS ANSWERED ABSENT, because the plane names
 * a person by the subject its own issuer gives them and such a caller has none.
 */

import type { AccessCallerAccount } from "../contract/accessPlane.ts";
import type { AccessDirectory } from "./accessDirectory.ts";
import { accessAccountsNamed } from "./accessPlane.ts";
import { oidcPrincipalSubject, type Principal } from "./principal.ts";

export interface AccessCallerAccountPorts {
  readonly directory?: AccessDirectory | undefined;
}

export interface AccessCallerAccountSettings {
  readonly issuer: string;
}

export interface AccessCallerAccountRead {
  callerAccount(caller: Principal): Promise<AccessCallerAccount | undefined>;
}

async function accessCallerAccountNamed(
  ports: AccessCallerAccountPorts,
  settings: AccessCallerAccountSettings,
  caller: Principal,
): Promise<AccessCallerAccount | undefined> {
  const subject = oidcPrincipalSubject(settings.issuer, caller);
  if (subject === undefined) return undefined;
  const [named] = await accessAccountsNamed(ports.directory, [
    { subject, principal: caller },
  ]);
  return named;
}

export function accessCallerAccount(
  ports: AccessCallerAccountPorts,
  settings: AccessCallerAccountSettings,
): AccessCallerAccountRead {
  return {
    callerAccount: (caller) =>
      accessCallerAccountNamed(ports, settings, caller),
  };
}
