/**
 * What a principal may do in one project, the port that answers it, and the
 * relation model the answer is asked of.
 *
 * IT STANDS APART FROM THE BOUNDARY THAT USES IT because every project-scoped
 * service takes it, and several of those are composed into the boundary itself.
 * Declared inside the boundary, a service that gates its own reads would import
 * the module that imports it, and the layer each of them belongs to would stop
 * being answerable.
 *
 * AUTHORIZATION ANSWERS WITH THE AUDITED AUTHORITY RATHER THAN A BOOLEAN, so no
 * transport can authorize one subject and record another.
 *
 * THE AUTHORITY IS DERIVED FROM THE PRINCIPAL AND STORED NOWHERE. Standing rule
 * 3 rejects the stored copy, and no row keeps one: an authorization answers a
 * permit and nothing else, so what a submission is audited to has to be a total
 * function of who made it. `memberAuthority` is that function and it is the
 * only one — the SQL that used to join a membership for an owner, an asker or
 * the wake bridge derives the same value, and a second encoder is what would
 * let one side record what the other cannot find.
 *
 * ONE KIND NAMES EVERY PRINCIPAL THIS PORT AUTHORIZES. A session bearer
 * resolves to its own row's principal and is authorized as that principal, so a
 * kind that varied by the route a request arrived on would give one person two
 * authorities and two idempotency scopes. It is neither of the two boundary
 * kinds `operation_completion_authority_is_its_boundary` reserves, which is
 * what keeps a member from submitting a boundary's completion.
 *
 * AN OUTAGE IS THROWN AND NEVER RETURNED. `undefined` is a decided refusal that
 * a caller turns into `NotFound`; a fault this side could not decide is
 * `ProjectAccessUnavailable`, which the boundary answers 503 with. Merging the
 * two would report an unreachable authority as a settled denial.
 */

import {
  asAuthorityKind,
  asAuthoritySubject,
  type Authority,
} from "./operationInbox.ts";
import type { Principal } from "./principal.ts";
import type { Partition } from "./projectStore.ts";

/** Every project access kind, and the declaration `ProjectAccessKind` derives from, so narrowing a supplied kind has one list to check. */
export const allProjectAccessKinds = [
  "Read",
  "Mutate",
  "DispatchTicket",
  "ProposeDispatch",
  "ManageProjectSelector",
] as const;

export type ProjectAccessKind = (typeof allProjectAccessKinds)[number];

/** Narrows text to the access kind it names, refusing anything the relation model would not know. */
export function asProjectAccessKind(value: string): ProjectAccessKind {
  const kind = allProjectAccessKinds.find((known) => known === value);
  if (kind === undefined)
    throw new RangeError(`project access kind: ${value} is not a known kind`);
  return kind;
}

/** The namespace one project is an object in. */
export const projectAccessNamespace = "Project";

/** The namespace one tenant is an object in, which a project's `tenant` relation names. */
export const projectAccessTenantNamespace = "Tenant";

/**
 * The permit each access kind asks the project namespace for. The record is
 * exhaustive over `ProjectAccessKind`, so a kind added to the roster without a
 * permit here is a compile error rather than a check that is always refused.
 */
export const projectAccessPermits: Readonly<Record<ProjectAccessKind, string>> =
  {
    Read: "read",
    Mutate: "develop",
    DispatchTicket: "dispatch",
    ProposeDispatch: "propose",
    ManageProjectSelector: "manage_selector",
  };

/**
 * The object string one partition is addressed by, length-prefixed for
 * `./principal.ts`'s reason: a tenant and a project are both arbitrary text
 * that may contain any separator, so a joined encoding would let one partition
 * name another's object.
 */
export function projectAccessObject(partition: Partition): string {
  return `${projectAccessTenantObject(partition.tenant)}${partition.project}`;
}

/** The object string one tenant is addressed by, under the encoding a partition uses. */
export function projectAccessTenantObject(tenant: string): string {
  return `${String(tenant.length)}:${tenant}`;
}

/**
 * The object and the subject a readiness probe names, which no partition and no
 * principal encode to: both of those carry a decimal length and a colon before
 * their first half. It lets a probe ask whether a permit is declared without
 * naming anything a grant could have been written for.
 */
export const projectAccessProbe = "readiness";

/** The kind every authority this port derives carries, naming what the principal is. */
export const memberAuthorityKind = asAuthorityKind("Member");

/**
 * The authority a principal acts under, which is the principal itself under
 * that kind. A principal too wide to be an authority subject is refused rather
 * than authorized as one no row could record.
 */
export function memberAuthority(principal: Principal): Authority {
  return { kind: memberAuthorityKind, subject: asAuthoritySubject(principal) };
}

/**
 * A fault that left the question undecided: the authority could not be
 * reached, would not answer, or answered something this side cannot read.
 */
export class ProjectAccessUnavailable extends Error {
  constructor(why: string) {
    super(`project access: ${why}`);
    this.name = "ProjectAccessUnavailable";
  }
}

/** Where the authority is and how long one question may take, all of it plain data. */
export interface ProjectAccessSettings {
  readonly readUrl: string;
  readonly requestTimeoutMs: number;
}

/** The bound one request runs under where a deployment names none. */
export const projectAccessTimeoutMsDefault = 5_000;

/** Narrows one of the authority's URLs, refusing what no adapter could act on. */
export function checkedProjectAccessUrl(value: string, what: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new RangeError(`${what} must be HTTP or HTTPS`);
  if (url.username !== "" || url.password !== "")
    throw new RangeError(`${what} must carry no credentials`);
  return url.toString();
}

/** Narrows a supplied bound, the default standing where a deployment names none. */
export function checkedProjectAccessTimeoutMs(
  value: number | undefined,
  what: string,
): number {
  const timeout = value ?? projectAccessTimeoutMsDefault;
  if (!Number.isSafeInteger(timeout) || timeout < 1)
    throw new RangeError(`${what} must be a positive integer`);
  return timeout;
}

/** What one process reads the authority with, all of it plain data. */
export function checkedProjectAccessSettings(input: {
  readonly readUrl: string;
  readonly requestTimeoutMs?: number | undefined;
}): ProjectAccessSettings {
  return {
    readUrl: checkedProjectAccessUrl(input.readUrl, "project access read URL"),
    requestTimeoutMs: checkedProjectAccessTimeoutMs(
      input.requestTimeoutMs,
      "project access timeout",
    ),
  };
}

/** Current project access and the non-reassignable authority it resolves to. */
export interface ProjectAccess {
  authorize(
    principal: Principal,
    partition: Partition,
    access: ProjectAccessKind,
  ): Promise<Authority | undefined>;
}

/**
 * The authority each principal named on one page acts under, and nothing for
 * the ones the project no longer admits. One question is asked per DISTINCT
 * principal, so a page of many rows owned by few people costs few questions,
 * and the caller's own page bound is what bounds them.
 */
export async function memberAuthorities(
  access: ProjectAccess,
  partition: Partition,
  principals: readonly Principal[],
  principalsMax: number,
): Promise<ReadonlyMap<Principal, Authority>> {
  const distinct = [...new Set(principals)];
  if (distinct.length > principalsMax)
    throw new RangeError(
      `project access: a page naming ${String(distinct.length)} principals is past the ${String(principalsMax)} one may ask about`,
    );
  const admitted = new Map<Principal, Authority>();
  for (const principal of distinct) {
    const authority = await access.authorize(principal, partition, "Read");
    if (authority !== undefined) admitted.set(principal, authority);
  }
  return admitted;
}
