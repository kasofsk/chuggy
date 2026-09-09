/**
 * Administrative binding of a repository to a project.
 *
 * This is installation administration, not journalled project state. It adds a
 * binding without changing any binding or work that already exists, and without
 * privileging the repository it names, so it belongs beside project membership
 * rather than in Core.
 */

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

export type RepositoryBindingOutcome =
  | "Bound"
  | "AlreadyBound"
  | "OperationConflict"
  | "RecoveryEpochMismatch"
  | "RepositoryBoundElsewhere";

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

export interface RepositoryBindingAdministration {
  writer(): Promise<RepositoryBindingWriter>;
  bind(command: RepositoryBindingCommand): Promise<RepositoryBindingOutcome>;
}
