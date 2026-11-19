/**
 * The identity token a job is issued: the claims every target shares, the
 * shape a target adds, the discovery document, and the port that signs.
 *
 * A TARGET IS ITS SHAPE AND NOTHING ELSE. Its audience, the longest `sub` it
 * takes and its further claims are handed in; no provider is named here.
 *
 * THE ISSUER AND `sub` ARE WRITTEN INTO TENANTS' TRUST POLICIES, so neither
 * may hold anything that varies per run. An issuer is per tenant, so a policy
 * that forgets to pin the tenant still admits no other tenant's jobs. Every
 * name either holds is a safe name, and an unsafe one is refused rather than
 * encoded.
 */

import { textCodePointsCount } from "../contract/http.ts";
import type { JsonValue } from "./sessionTranscript.ts";

/** What one target needs of a token. */
export interface JobIdentityTarget {
  readonly audience: string;
  readonly subjectBytesMax: number;
  /** Claims added beside the core's, never in place of one. */
  readonly claims: Readonly<Record<string, JsonValue>>;
}

/** Who a token is for. */
export interface JobIdentitySubject {
  readonly tenant: string;
  readonly project: string;
  readonly workload: string;
  readonly task:
    | { readonly taskKind: "Work" }
    | { readonly taskKind: "Evaluation"; readonly evaluator: number };
  readonly ticket: number;
  /** Present only where the job has exactly one repository. */
  readonly repository?: string;
}

declare const jobIdentityIssuerBrand: unique symbol;

/** A tenant's issuer, as `jobIdentityIssuer` alone builds it. */
export type JobIdentityIssuer = string & {
  readonly [jobIdentityIssuerBrand]: true;
};

/** The longest issuer any target admits, so one issuer serves them all. */
export const jobIdentityIssuerCharsMax = 255;

/** How long a token is good for after it is issued. */
export const jobIdentityLifetimeSecs = 3600;

/** Every claim the core sets, which a target may not name. */
export const jobIdentityCoreClaims = [
  "iss",
  "sub",
  "aud",
  "iat",
  "exp",
  "tenant",
  "project",
  "workload",
  "task_kind",
  "evaluator",
  "ticket",
  "repository",
] as const;

const jobIdentitySafeName = /^[A-Za-z0-9._-]+$/u;

/** Whether a name may stand in an issuer or a `sub` as it is. */
export function isJobIdentitySafeName(value: string): boolean {
  return jobIdentitySafeName.test(value);
}

/** Why no token's claims could be built. */
export type JobIdentityRefusal =
  | { readonly reason: "TenantUnsafe" }
  | { readonly reason: "IssuerTooLong" }
  | { readonly reason: "ProjectUnsafe" }
  | { readonly reason: "WorkloadUnsafe" }
  | { readonly reason: "SubjectTooLong" }
  | { readonly reason: "ClaimReserved"; readonly claim: string };

export type JobIdentityIssuerBuilt =
  | { readonly result: "Issuer"; readonly issuer: JobIdentityIssuer }
  | {
      readonly result: "Refused";
      readonly refusal: Extract<
        JobIdentityRefusal,
        { readonly reason: "TenantUnsafe" | "IssuerTooLong" }
      >;
    };

/** A tenant's issuer: the base, a `/`, and the tenant. */
export function jobIdentityIssuer(
  issuerBaseUrl: string,
  tenant: string,
): JobIdentityIssuerBuilt {
  if (!isJobIdentitySafeName(tenant))
    return { result: "Refused", refusal: { reason: "TenantUnsafe" } };
  const issuer = `${issuerBaseUrl}/${tenant}`;
  if (textCodePointsCount(issuer) > jobIdentityIssuerCharsMax)
    return { result: "Refused", refusal: { reason: "IssuerTooLong" } };
  return { result: "Issuer", issuer: issuer as JobIdentityIssuer };
}

export type JobIdentityClaims = Readonly<Record<string, JsonValue>>;

export type JobIdentityClaimsBuilt =
  | { readonly result: "Claims"; readonly claims: JobIdentityClaims }
  | { readonly result: "Refused"; readonly refusal: JobIdentityRefusal };

function jobIdentityClaimsAsserted(
  subject: JobIdentitySubject,
  target: JobIdentityTarget,
  issuedAtEpochMs: number,
): void {
  if (
    !Number.isSafeInteger(target.subjectBytesMax) ||
    target.subjectBytesMax < 1
  )
    throw new RangeError(
      "job identity: a target's subject bound is no positive integer",
    );
  if (target.audience === "")
    throw new RangeError("job identity: a target's audience is empty");
  if (!Number.isSafeInteger(subject.ticket) || subject.ticket < 0)
    throw new RangeError("job identity: a ticket number is no natural number");
  if (
    subject.task.taskKind === "Evaluation" &&
    (!Number.isSafeInteger(subject.task.evaluator) ||
      subject.task.evaluator < 0)
  )
    throw new RangeError(
      "job identity: an evaluator's key is no natural number",
    );
  if (!Number.isFinite(issuedAtEpochMs) || issuedAtEpochMs < 0)
    throw new RangeError("job identity: the issue time is no instant");
}

function jobIdentityClaimsRefusal(
  subject: JobIdentitySubject,
  target: JobIdentityTarget,
  sub: string,
): JobIdentityRefusal | undefined {
  if (!isJobIdentitySafeName(subject.project))
    return { reason: "ProjectUnsafe" };
  if (!isJobIdentitySafeName(subject.workload))
    return { reason: "WorkloadUnsafe" };
  if (new TextEncoder().encode(sub).byteLength > target.subjectBytesMax)
    return { reason: "SubjectTooLong" };
  const reserved: readonly string[] = jobIdentityCoreClaims;
  const claim = Object.keys(target.claims).find((name) =>
    reserved.includes(name),
  );
  if (claim !== undefined) return { reason: "ClaimReserved", claim };
  return undefined;
}

/**
 * One token's claims for one target, issued at the given instant. Built by
 * `fromEntries`, which defines each claim, so a target's `__proto__` is a
 * claim rather than a prototype.
 */
export function jobIdentityClaims(
  subject: JobIdentitySubject,
  issuerBaseUrl: string,
  target: JobIdentityTarget,
  issuedAtEpochMs: number,
): JobIdentityClaimsBuilt {
  jobIdentityClaimsAsserted(subject, target, issuedAtEpochMs);
  const issuer = jobIdentityIssuer(issuerBaseUrl, subject.tenant);
  if (issuer.result === "Refused") return issuer;
  const taskKind = subject.task.taskKind === "Work" ? "work" : "evaluation";
  const sub = `project:${subject.project}:workload:${subject.workload}:task:${taskKind}`;
  const refusal = jobIdentityClaimsRefusal(subject, target, sub);
  if (refusal !== undefined) return { result: "Refused", refusal };
  const iat = Math.floor(issuedAtEpochMs / 1000);
  const core: [string, JsonValue][] = [
    ["iss", issuer.issuer],
    ["sub", sub],
    ["aud", target.audience],
    ["iat", iat],
    ["exp", iat + jobIdentityLifetimeSecs],
    ["tenant", subject.tenant],
    ["project", subject.project],
    ["workload", subject.workload],
    ["task_kind", taskKind],
  ];
  if (subject.task.taskKind === "Evaluation")
    core.push(["evaluator", subject.task.evaluator]);
  core.push(["ticket", subject.ticket]);
  if (subject.repository !== undefined)
    core.push(["repository", subject.repository]);
  return {
    result: "Claims",
    claims: Object.fromEntries([...core, ...Object.entries(target.claims)]),
  };
}

/** What a tenant's issuer publishes at its discovery address. */
export interface JobIdentityDiscovery {
  readonly issuer: JobIdentityIssuer;
  readonly jwks_uri: string;
  readonly response_types_supported: readonly ["id_token"];
  readonly subject_types_supported: readonly ["public"];
  readonly id_token_signing_alg_values_supported: readonly ["RS256"];
  readonly claims_supported: readonly string[];
}

export function jobIdentityDiscovery(
  issuer: JobIdentityIssuer,
): JobIdentityDiscovery {
  return {
    issuer,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ["id_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    claims_supported: [...jobIdentityCoreClaims],
  };
}

/** One published public key. */
export interface JobIdentityPublicKey {
  readonly kty: "RSA";
  readonly n: string;
  readonly e: string;
  readonly kid: string;
  readonly alg: "RS256";
  readonly use: "sig";
}

export interface JobIdentityKeySet {
  readonly keys: readonly JobIdentityPublicKey[];
}

/** Signs a claim set into a compact JWT, and answers the keys a verifier may select from. */
export interface JobIdentitySigner {
  sign(claims: JobIdentityClaims): Promise<string>;
  keySet(): JobIdentityKeySet;
}
