/**
 * Administrative binding of a repository to a project.
 *
 * This is installation administration, not journalled project state. It adds a
 * binding without changing any binding or work that already exists, and without
 * privileging the repository it names, so it belongs beside project membership
 * rather than in Core.
 */

import {
  briefFinalizationModes,
  type BriefFinalizationMode,
} from "../contract/rosters.ts";
import { asRepositoryId, type RepositoryId } from "./finalizer.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  asOperationId,
  type Authority,
  type OperationId,
} from "./operationInbox.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type Partition,
  type RecoveryEpoch,
} from "./projectStore.ts";

export interface RepositoryBindingRequest {
  readonly tenant: string;
  readonly project: string;
  readonly repository: string;
  readonly recoveryEpoch: string;
  readonly operation: string;
  readonly authorityKind: string;
  readonly authoritySubject: string;
}

export interface RepositoryBindingCommand {
  readonly partition: Partition;
  readonly repository: RepositoryId;
  readonly recoveryEpoch: RecoveryEpoch;
  readonly operation: OperationId;
  readonly authority: Authority;
}

/**
 * What binding came to. `ProjectAbsent` is the one the door raises rather than
 * returns, because a project that is not there is not a refusal an operator may
 * retry into, and the adapter turns that raise into this outcome so a caller
 * reads one roster rather than a roster and a fault.
 */
export type RepositoryBindingOutcome =
  | "Bound"
  | "AlreadyBound"
  | "OperationConflict"
  | "RecoveryEpochMismatch"
  | "RepositoryBoundElsewhere"
  | "ProjectAbsent";

/** Narrows every operator-supplied identity before the adapter sees it. */
export function checkedRepositoryBindingCommand(
  request: RepositoryBindingRequest,
): RepositoryBindingCommand {
  return {
    partition: {
      tenant: asTenantId(request.tenant),
      project: asProjectId(request.project),
    },
    repository: asRepositoryId(request.repository),
    recoveryEpoch: asRecoveryEpoch(request.recoveryEpoch),
    operation: asOperationId(request.operation),
    authority: {
      kind: asAuthorityKind(request.authorityKind),
      subject: asAuthoritySubject(request.authoritySubject),
    },
  };
}

export interface RepositoryBindingWriter {
  readonly role: string;
  readonly canExecute: boolean;
}

/**
 * Binding a repository, and the epoch one is bound under. THE EPOCH IS READ
 * HERE RATHER THAN SUPPLIED: the door refuses a binding made under an epoch
 * that is not current, which is a fence an operator typing one at a command
 * line needs and a route has no way to ask a caller for, since a caller has no
 * reason to know an epoch and one it did supply would be a value it could get
 * wrong in the only direction that matters.
 */
export interface ProjectRepositoryBindingWrite {
  currentRecoveryEpoch(): Promise<RecoveryEpoch>;
  bind(command: RepositoryBindingCommand): Promise<RepositoryBindingOutcome>;
}

export interface RepositoryBindingAdministration extends ProjectRepositoryBindingWrite {
  writer(): Promise<RepositoryBindingWriter>;
}

/**
 * How a finished ticket in one repository lands when its brief names no
 * landing of its own. The mode alone: which reference a proposal is opened
 * into stays the ticket's, because stacked work names a different one per
 * ticket.
 */
export interface RepositoryLanding {
  readonly mode: BriefFinalizationMode;
}

/** Narrows one landing mode, whatever door or wire it arrived by. */
export function asRepositoryLanding(mode: string): RepositoryLanding {
  const known = briefFinalizationModes.find((each) => each === mode);
  if (known === undefined)
    throw new RangeError(
      "repository landing: the mode is not one this tree lands under",
    );
  return { mode: known };
}

/** One of a project's bindings, as a reader choosing between them sees it. */
export interface ProjectRepositoryBound {
  readonly repository: RepositoryId;
  readonly boundAt: string;
  readonly landing: RepositoryLanding;
}

/**
 * Every repository one project binds, oldest first — the order
 * `read_project_repository_binding` already elects by, so the head of this list
 * is the binding every caller naming no repository works against.
 */
export interface ProjectRepositoryBindings {
  bindings(partition: Partition): Promise<readonly ProjectRepositoryBound[]>;
}

/** One landing move, against the landing the writer read. */
export interface ProjectRepositoryLandingCommand {
  readonly partition: Partition;
  readonly repository: RepositoryId;
  readonly expected: RepositoryLanding;
  readonly landing: RepositoryLanding;
}

/**
 * What moving one repository's landing came to. `LandingMoved` answers the row
 * standing at neither the landing the writer read nor the one it asked for,
 * because the writer's next act is to read it again, and `Unavailable` is a
 * write that did not complete under its lock and can be made again.
 */
export type ProjectRepositoryLandingOutcome =
  | { readonly outcome: "Written"; readonly binding: ProjectRepositoryBound }
  | {
      readonly outcome: "LandingMoved";
      readonly binding: ProjectRepositoryBound;
    }
  | { readonly outcome: "NotBound" }
  | { readonly outcome: "Unavailable" };

/**
 * One binding's landing, read and moved. It is a port of its own rather than a
 * pair of methods on the bind, because binding is an administration a project
 * does once and a landing is a setting it edits.
 */
export interface ProjectRepositoryLandingStore {
  landing(
    partition: Partition,
    repository: RepositoryId,
  ): Promise<ProjectRepositoryBound | undefined>;

  setLanding(
    command: ProjectRepositoryLandingCommand,
  ): Promise<ProjectRepositoryLandingOutcome>;
}
