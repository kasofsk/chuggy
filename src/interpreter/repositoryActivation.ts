/**
 * Administrative activation of one of a project's immutable repository bindings.
 *
 * This is installation administration, not journalled project state. It changes
 * which binding future work discovers without changing any binding or work that
 * already exists, so it belongs beside project membership rather than in Core.
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

export interface RepositoryActivationRequest {
  readonly tenant: string;
  readonly project: string;
  readonly expectedRepository: string;
  readonly repository: string;
  readonly recoveryEpoch: string;
  readonly operation: string;
  readonly authorityKind: string;
  readonly authoritySubject: string;
}

export interface RepositoryActivation {
  readonly partition: Partition;
  readonly expectedRepository: RepositoryId;
  readonly repository: RepositoryId;
  readonly recoveryEpoch: RecoveryEpoch;
  readonly operation: OperationId;
  readonly authority: Authority;
}

export type RepositoryActivationOutcome =
  | "Activated"
  | "AlreadyActivated"
  | "OperationConflict"
  | "ExpectedRepositoryMismatch"
  | "RecoveryEpochMismatch"
  | "RepositoryBoundElsewhere";

/** Narrows every operator-supplied identity before the adapter sees it. */
export function checkedRepositoryActivation(
  request: RepositoryActivationRequest,
): RepositoryActivation {
  return {
    partition: {
      tenant: asTenantId(request.tenant),
      project: asProjectId(request.project),
    },
    expectedRepository: asRepositoryId(request.expectedRepository),
    repository: asRepositoryId(request.repository),
    recoveryEpoch: asRecoveryEpoch(request.recoveryEpoch),
    operation: asOperationId(request.operation),
    authority: {
      kind: asAuthorityKind(request.authorityKind),
      subject: asAuthoritySubject(request.authoritySubject),
    },
  };
}

export interface RepositoryActivationWriter {
  readonly role: string;
  readonly canExecute: boolean;
}

export interface RepositoryActivationAdministration {
  writer(): Promise<RepositoryActivationWriter>;
  activate(
    activation: RepositoryActivation,
  ): Promise<RepositoryActivationOutcome>;
}
