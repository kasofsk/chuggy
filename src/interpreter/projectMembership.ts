/**
 * The write side of project access: the membership rows
 * `authorize_project_access` reads, and the contract an administrator reaches
 * them through.
 *
 * THE PRINCIPAL IS DERIVED, NEVER TYPED. An administrator supplies the issuer
 * and subject a token carries and nothing else, so the encoding an
 * authenticated request arrives with and the encoding a grant is stored under
 * are the same call. A second encoder is the failure this contract exists to
 * make impossible, and `oidcPrincipal` is the one it calls.
 *
 * A MEMBERSHIP IS NOT JOURNALLED STATE. It records who may address a project
 * rather than anything the project decided, so granting one takes no lease and
 * produces no entry; the single-writer commitment is about the journal, which
 * no membership row is part of.
 */

import {
  asProjectAccessKind,
  oidcPrincipal,
  type Principal,
  type ProjectAccessKind,
} from "./nativeWeb.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  type Authority,
} from "./operationInbox.ts";
import { asProjectId, asTenantId, type Partition } from "./projectStore.ts";

/** The access kinds a membership carries, which the stored row's own CHECK also requires to be non-empty. */
export type ProjectAccessGrant = ReadonlySet<ProjectAccessKind>;

/** Which principal on which project, which is the whole of what a membership is keyed by. */
export interface ProjectMembershipTarget {
  readonly principal: Principal;
  readonly partition: Partition;
}

/** A target's access, and the authority its submissions are audited to. */
export interface ProjectMembership extends ProjectMembershipTarget {
  readonly authority: Authority;
  readonly access: ProjectAccessGrant;
}

/** The identity an administrator names, before any of it has been narrowed. */
export interface ProjectMembershipTargetRequest {
  readonly issuer: string;
  readonly subject: string;
  readonly tenant: string;
  readonly project: string;
}

/** That identity, plus the access and audited authority a grant also carries. */
export interface ProjectMembershipRequest extends ProjectMembershipTargetRequest {
  readonly authorityKind: string;
  readonly authoritySubject: string;
  readonly access: readonly string[];
}

/** Narrows supplied kinds, refusing an unknown one and a grant that carries none. */
export function asProjectAccessGrant(
  values: readonly string[],
): ProjectAccessGrant {
  const kinds = new Set(values.map(asProjectAccessKind));
  if (kinds.size === 0)
    throw new RangeError("project access grant: no access kind is granted");
  return kinds;
}

/** Derives the principal rather than accepting one, and narrows the partition it names. */
export function checkedProjectMembershipTarget(
  request: ProjectMembershipTargetRequest,
): ProjectMembershipTarget {
  return {
    principal: oidcPrincipal(request.issuer, request.subject),
    partition: {
      tenant: asTenantId(request.tenant),
      project: asProjectId(request.project),
    },
  };
}

/** Narrows a whole grant through the constructor that owns each part of it. */
export function checkedProjectMembership(
  request: ProjectMembershipRequest,
): ProjectMembership {
  return {
    ...checkedProjectMembershipTarget(request),
    authority: {
      kind: asAuthorityKind(request.authorityKind),
      subject: asAuthoritySubject(request.authoritySubject),
    },
    access: asProjectAccessGrant(request.access),
  };
}

/**
 * Writes what `ProjectAccess` reads. No runtime role answers this port: the
 * membership table refuses every privilege the API process holds, so an
 * implementation connects as the identity that owns the table.
 */
export interface ProjectMembershipAdministration {
  /** Grants exactly `membership.access`, replacing whatever that principal held on that project. */
  grant(membership: ProjectMembership): Promise<void>;

  /** Withdraws every access, answering whether there was a membership to withdraw. */
  revoke(target: ProjectMembershipTarget): Promise<boolean>;
}
