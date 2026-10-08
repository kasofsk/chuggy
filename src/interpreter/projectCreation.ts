/**
 * A signed-in principal creating a project: the service the API's creation
 * route answers from.
 *
 * A TENANT NAME IS FIRST-COME. A tenant is held by its row, by any tuple on its
 * own object and by any project whose `tenant` it is. Any principal may create a
 * tenant nothing holds and becomes its administrator; a held tenant takes a project
 * only from a principal the authority says administers it, and anyone else is
 * told the name is taken rather than that it was not found, because a tenant
 * name is not a secret. Tuples hold it because an operator may grant access
 * before any row exists, and a wiped database leaves tuples behind. The door
 * decides the race between two creators of one new tenant, so the loser is
 * `TenantTaken` and never a project in the winner's tenant, and it refuses a
 * name another path begins with only for a tenant that is new.
 *
 * ACCESS IS WRITTEN AFTER THE ROW COMMITS, AS ONE REQUEST, AND A REPEAT WRITES
 * IT AGAIN UNTIL THE WRITE IS RECORDED. The authority takes the whole list or
 * none of it, so a failure leaves no tenant held by a tuple and administered by
 * nobody, and no object with some of its defaults. A tuple written again changes
 * no answer, so an authority that failed after the commit is repaired by the
 * creator asking again for the same tenant and project, under any idempotency
 * key; once recorded, a repeat writes nothing, so it cannot restore a grant or
 * a default anyone has since removed.
 */

import { assertNever } from "../domain/assertNever.ts";
import { projectNameSchema, tenantNameReserved } from "../contract/requests.ts";
import type { OperationId, Authority } from "./operationInbox.ts";
import { memberAuthority, type ProjectAccess } from "./projectAccess.ts";
import {
  projectAuthorityDefaults,
  projectRelationGrant,
  projectTenantGrant,
  tenantAdministratorGrant,
  tenantAuthorityDefaults,
  type ProjectGrant,
  type ProjectGrantWriter,
} from "./projectGrant.ts";
import type { Principal } from "./principal.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
  type TenantId,
} from "./projectStore.ts";

/** One creation as the wire names it, before either name is held to the rule. */
export interface ProjectCreationRequest {
  readonly tenant: string;
  readonly project: string;
  readonly operation: OperationId;
}

/** The name a refusal is about. */
export type ProjectCreationField = "tenant" | "project";

/** Every answer the door gives. */
export const allProjectCreationOutcomes = [
  "Created",
  "AlreadyCreated",
  "ProjectExists",
  "TenantTaken",
  "TenantReserved",
  "OperationConflict",
] as const;

export type ProjectCreationOutcome =
  (typeof allProjectCreationOutcomes)[number];

/** What the door answered and, for a creation, the operation that made the project, whether it made the tenant and whether its grants are recorded as written. */
export interface ProjectCreationAnswer {
  readonly outcome: ProjectCreationOutcome;
  readonly tenantCreated: boolean;
  readonly grantsWritten: boolean;
  readonly operation: OperationId;
}

/** Whether the caller administers the tenant, and otherwise whether any tuple holds it. */
export type TenantStanding = "Administers" | "Claimed" | "Unclaimed";

/** One creation as the door takes it, with what the authority says of the tenant. */
export interface ProjectCreationWrite {
  readonly partition: Partition;
  readonly standing: TenantStanding;
  readonly reserved: boolean;
  readonly operation: OperationId;
  readonly authority: Authority;
}

/** Whether any tuple holds a tenant: on the tenant's object, or as the tenant a project inherits from. */
export interface TenantClaims {
  claimed(tenant: TenantId): Promise<boolean>;
}

/** The durable side: the tenant, the project and the operation in one transaction, and later the record that its grants were written. */
export interface ProjectCreationStore {
  create(write: ProjectCreationWrite): Promise<ProjectCreationAnswer>;
  recordGrants(operation: OperationId): Promise<void>;
}

/**
 * What creation reaches, with no grant writer on a deployment that names no
 * authority to write to, and no selector on one whose selector is granted each
 * project by hand.
 */
export interface ProjectCreationPorts {
  readonly access: ProjectAccess;
  readonly claims: TenantClaims;
  readonly store: ProjectCreationStore;
  readonly grants?: ProjectGrantWriter;
  readonly selector?: Principal;
}

export type ProjectCreationResult =
  | { readonly result: "Created"; readonly partition: Partition }
  | { readonly result: "AlreadyCreated"; readonly partition: Partition }
  | { readonly result: "ProjectExists" }
  | { readonly result: "TenantTaken" }
  | { readonly result: "OperationConflict" }
  | { readonly result: "NameInvalid"; readonly field: ProjectCreationField }
  | { readonly result: "TenantReserved" }
  | { readonly result: "NotConfigured" };

export interface ProjectCreation {
  create(
    principal: Principal,
    request: ProjectCreationRequest,
  ): Promise<ProjectCreationResult>;
}

/** The first name the rule refuses, tenant before project. */
export function projectCreationNameFault(
  request: Pick<ProjectCreationRequest, "tenant" | "project">,
): ProjectCreationField | undefined {
  if (!projectNameSchema.safeParse(request.tenant).success) return "tenant";
  if (!projectNameSchema.safeParse(request.project).success) return "project";
  return undefined;
}

/**
 * The grants an accepted creation writes: the tenant's administrator and
 * defaults only where it made the tenant, the project's link and defaults, and
 * the site's selector as a developer where the site names one.
 */
export function projectCreationGrants(
  principal: Principal,
  partition: Partition,
  tenantCreated: boolean,
  selector?: Principal,
): readonly ProjectGrant[] {
  return [
    ...(tenantCreated
      ? [
          tenantAdministratorGrant(principal, partition.tenant),
          ...tenantAuthorityDefaults(partition.tenant),
        ]
      : []),
    projectTenantGrant(partition),
    ...projectAuthorityDefaults(partition),
    ...(selector === undefined
      ? []
      : [projectRelationGrant(selector, partition, "developers")]),
  ];
}

/** The caller's standing on the tenant, asking whether any tuple holds it only of a caller that does not administer it. */
async function projectCreationStanding(
  ports: ProjectCreationPorts,
  principal: Principal,
  partition: Partition,
): Promise<TenantStanding> {
  const administers = await ports.access.authorizeTenant(
    principal,
    partition.tenant,
    "AdministerTenant",
  );
  if (administers !== undefined) return "Administers";
  return (await ports.claims.claimed(partition.tenant))
    ? "Claimed"
    : "Unclaimed";
}

async function projectCreationCreate(
  ports: ProjectCreationPorts,
  grants: ProjectGrantWriter,
  principal: Principal,
  request: ProjectCreationRequest,
): Promise<ProjectCreationResult> {
  const field = projectCreationNameFault(request);
  if (field !== undefined) return { result: "NameInvalid", field };
  const partition: Partition = {
    tenant: asTenantId(request.tenant),
    project: asProjectId(request.project),
  };
  const standing = await projectCreationStanding(ports, principal, partition);
  const answer = await ports.store.create({
    partition,
    standing,
    reserved: tenantNameReserved(partition.tenant),
    operation: request.operation,
    authority: memberAuthority(principal),
  });
  switch (answer.outcome) {
    case "Created":
    case "AlreadyCreated":
      if (!answer.grantsWritten) {
        await grants.writeAll(
          projectCreationGrants(
            principal,
            partition,
            answer.tenantCreated,
            ports.selector,
          ),
        );
        await ports.store.recordGrants(answer.operation);
      }
      return { result: answer.outcome, partition };
    case "ProjectExists":
    case "TenantTaken":
    case "TenantReserved":
    case "OperationConflict":
      return { result: answer.outcome };
    default:
      return assertNever(answer.outcome);
  }
}

export function projectCreation(ports: ProjectCreationPorts): ProjectCreation {
  return {
    create: (principal, request) => {
      const grants = ports.grants;
      if (grants === undefined)
        return Promise.resolve({ result: "NotConfigured" });
      return projectCreationCreate(ports, grants, principal, request);
    },
  };
}
