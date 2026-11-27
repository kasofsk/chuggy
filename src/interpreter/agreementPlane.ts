/**
 * The agreement plane: the deployment's current policies, a person's standing
 * against them, and a signed-in caller agreeing.
 *
 * THE POLICIES ARE THE DEPLOYMENT'S, read whole at start and never fetched:
 * the plane carries each version's url and digest and checks neither. A
 * deployment naming none asks nobody for anything, and its store is never
 * asked who agreed to what.
 *
 * A CALLER IS NAMED BY THE PRINCIPAL THEIR BEARER CARRIES, and one under
 * another issuer than the plane's is answered absent, as the access plane's
 * account read answers one. A person asked about by another process is named
 * by principal alone: the plane keeps no list of people and does not judge who
 * is one, so a principal it has never seen has agreed to nothing.
 *
 * AN AGREEMENT IS CHECKED WHOLE BEFORE ANYTHING IS WRITTEN. Every policy it
 * names must be current at exactly that version and digest, or it is refused
 * with the current policies and no row is written.
 */

import {
  agreementPlanePoliciesSchema,
  type AgreementPolicies,
  type AgreementPolicyEntry,
  type AgreementRequest,
  type AgreementStanding,
} from "../contract/agreementPlane.ts";
import { oidcPrincipalSubject, type Principal } from "./principal.ts";

/** What a request carried as evidence of who agreed, each absent where it carried none the plane takes. */
export interface AgreementEvidence {
  readonly clientAddress?: string | undefined;
  readonly userAgent?: string | undefined;
}

/** One policy at one version as a person agreed to it, and the instant they did. */
export interface AgreementRecorded {
  readonly policy: string;
  readonly version: string;
  readonly digest: string;
  readonly agreedAt: string;
}

/** Where agreements are kept. */
export interface AgreementStore {
  /** The rows of `principal` agreeing to any of `policies` at its version and digest. */
  agreed(
    principal: string,
    policies: readonly AgreementPolicyEntry[],
  ): Promise<readonly AgreementRecorded[]>;
  /** Records `principal` agreeing to each of `policies`, all in one statement, a row they already hold left as it stands. */
  record(
    principal: string,
    policies: readonly AgreementPolicyEntry[],
    evidence: AgreementEvidence,
  ): Promise<void>;
}

export interface AgreementPlaneSettings {
  readonly issuer: string;
  readonly policies: readonly AgreementPolicyEntry[];
}

/** What an agreement came to. */
export type AgreementOutcome =
  | { readonly outcome: "Absent" }
  | { readonly outcome: "PoliciesChanged"; readonly current: AgreementPolicies }
  | { readonly outcome: "Agreed"; readonly standing: AgreementStanding };

export interface AgreementPlane {
  policies(): AgreementPolicies;
  standing(caller: Principal): Promise<AgreementStanding | undefined>;
  agreed(
    caller: Principal,
    request: AgreementRequest,
    evidence: AgreementEvidence,
  ): Promise<AgreementOutcome>;
  personStanding(principal: string): Promise<AgreementStanding>;
}

/** The deployment's policies as its setting names them, unset or empty naming none. */
export function agreementPlanePoliciesRead(
  value: string | undefined,
): readonly AgreementPolicyEntry[] {
  if (value === undefined || value.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new RangeError("is not JSON");
  }
  const read = agreementPlanePoliciesSchema.safeParse(parsed);
  if (!read.success)
    throw new RangeError(
      `is not a list of policies: ${read.error.issues[0]?.message ?? "malformed"}`,
    );
  return read.data;
}

/** The key one policy at one version and digest is matched by. */
function agreementPlaneKey(entry: {
  readonly policy: string;
  readonly version: string;
  readonly digest: string;
}): string {
  return JSON.stringify([entry.policy, entry.version, entry.digest]);
}

async function agreementPlaneStanding(
  store: AgreementStore,
  settings: AgreementPlaneSettings,
  principal: string,
): Promise<AgreementStanding> {
  if (settings.policies.length === 0) return { policies: [] };
  const rows = await store.agreed(principal, settings.policies);
  const agreedAt = new Map(
    rows.map((row) => [agreementPlaneKey(row), row.agreedAt]),
  );
  return {
    policies: settings.policies.map((entry) => {
      const at = agreedAt.get(agreementPlaneKey(entry));
      return at === undefined ? { ...entry } : { ...entry, agreedAt: at };
    }),
  };
}

/** The current entries `request` names, or nothing where any it names is not current at its version and digest. */
function agreementPlaneCurrent(
  settings: AgreementPlaneSettings,
  request: AgreementRequest,
): readonly AgreementPolicyEntry[] | undefined {
  const current = new Map(
    settings.policies.map((entry) => [agreementPlaneKey(entry), entry]),
  );
  const named = request.agreements.flatMap((agreement) => {
    const entry = current.get(agreementPlaneKey(agreement));
    return entry === undefined ? [] : [entry];
  });
  return named.length === request.agreements.length ? named : undefined;
}

async function agreementPlaneAgreed(
  store: AgreementStore,
  settings: AgreementPlaneSettings,
  caller: Principal,
  request: AgreementRequest,
  evidence: AgreementEvidence,
): Promise<AgreementOutcome> {
  if (oidcPrincipalSubject(settings.issuer, caller) === undefined)
    return { outcome: "Absent" };
  const named = agreementPlaneCurrent(settings, request);
  if (named === undefined)
    return {
      outcome: "PoliciesChanged",
      current: { policies: [...settings.policies] },
    };
  await store.record(caller, named, evidence);
  return {
    outcome: "Agreed",
    standing: await agreementPlaneStanding(store, settings, caller),
  };
}

export function agreementPlane(
  store: AgreementStore,
  settings: AgreementPlaneSettings,
): AgreementPlane {
  return {
    policies: () => ({ policies: [...settings.policies] }),
    standing: async (caller) =>
      oidcPrincipalSubject(settings.issuer, caller) === undefined
        ? undefined
        : agreementPlaneStanding(store, settings, caller),
    agreed: (caller, request, evidence) =>
      agreementPlaneAgreed(store, settings, caller, request, evidence),
    personStanding: (principal) =>
      agreementPlaneStanding(store, settings, principal),
  };
}
