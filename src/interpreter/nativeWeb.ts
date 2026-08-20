/**
 * The authenticated native-web application boundary.
 *
 * Authorization answers with the audited authority rather than a boolean, so
 * no transport can authorize one subject and record another. Reads and
 * cancellation deliberately share the same not-found result for absent and
 * inaccessible resources. This layer coordinates ports; it neither loads the
 * project actor nor owns a database transaction.
 */

import type { Phase } from "../domain/generated/modelTypes.ts";
import type { TicketId } from "../domain/ids.ts";
import type {
  Accepted,
  Authority,
  Cancelled,
  IdempotencyKey,
  OperationId,
  OperationState,
  Submission,
} from "./operationInbox.ts";
import type { OperationInbox } from "./operationInbox.ts";
import type { Partition } from "./projectStore.ts";
import type { TicketCommand } from "./ticketCommand.ts";
import type {
  AuthoringStore,
  CanonicalConfiguration,
  ConfigurationCreated,
  ConfigurationRevisionId,
  DraftCreated,
  DraftDeleted,
  DraftRevised,
} from "./authoring.ts";
import type { ReleaseAuthoring } from "../actor/decisionEvent.ts";

declare const principalBrand: unique symbol;
declare const instantBrand: unique symbol;

/** An authenticated session subject, opaque to the application boundary. */
export type Principal = string & { readonly [principalBrand]: true };

/** A database-authored RFC 3339 instant, used only for presentation. */
export type PublicInstant = string & { readonly [instantBrand]: true };

export function asPrincipal(value: string): Principal {
  if (value.length === 0)
    throw new RangeError("principal: an identity is empty");
  return value as Principal;
}

export function asPublicInstant(value: string): PublicInstant {
  if (value.length === 0)
    throw new RangeError("public instant: a value is empty");
  return value as PublicInstant;
}

export type ProjectAccessKind = "Read" | "Mutate";

/** Current project access and the non-reassignable authority it resolves to. */
export interface ProjectAccess {
  authorize(
    principal: Principal,
    partition: Partition,
    access: ProjectAccessKind,
  ): Promise<Authority | undefined>;
}

export type OperationRefusalCode =
  "NotEnabled" | "AuthoringChanged" | "CommandUnreadable";

interface OperationResourceBase {
  readonly operation: OperationId;
  readonly acceptedAt: PublicInstant;
  readonly state: OperationState;
}

/** The safe public operation shape; stored commands and authority never cross it. */
export type OperationResource =
  | (OperationResourceBase & { readonly state: "Pending" })
  | (OperationResourceBase & {
      readonly state: "Succeeded";
      readonly decidedSequence: number;
    })
  | (OperationResourceBase & {
      readonly state: "Refused";
      readonly code: OperationRefusalCode;
      readonly refusedHead: number;
      readonly refusedLifecycleGeneration: number;
    })
  | (OperationResourceBase & { readonly state: "Cancelled" });

export interface TicketResource {
  readonly ticket: TicketId;
  readonly phase: Phase;
  readonly sequence: number;
}

export interface ProjectResource {
  readonly partition: Partition;
  readonly sequence: number;
  readonly tickets: readonly TicketResource[];
  readonly nextAfter?: TicketId;
}

export interface ProjectReadQuery {
  readonly after?: TicketId;
  readonly limit: number;
  readonly minimumSequence?: number;
}

export type ProjectRead =
  | { readonly result: "NotFound" }
  | { readonly result: "Behind"; readonly observedSequence: number }
  | { readonly result: "Found"; readonly project: ProjectResource };

export const projectPageLimitMax = 100;

export function checkedProjectReadQuery(
  query: ProjectReadQuery,
): ProjectReadQuery {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > projectPageLimitMax
  )
    throw new RangeError(
      `project page limit must be between 1 and ${String(projectPageLimitMax)}`,
    );
  if (
    query.minimumSequence !== undefined &&
    (!Number.isSafeInteger(query.minimumSequence) || query.minimumSequence < 0)
  )
    throw new RangeError(
      "minimum project sequence must be a non-negative safe integer",
    );
  return query;
}

/** Projection and operation reads answered without activating a project writer. */
export interface NativeReadStore {
  operation(
    partition: Partition,
    operation: OperationId,
  ): Promise<OperationResource | undefined>;
  project(partition: Partition, query: ProjectReadQuery): Promise<ProjectRead>;
}

export interface NativeSubmission {
  readonly partition: Partition;
  readonly operation: OperationId;
  readonly key: IdempotencyKey;
  readonly command: TicketCommand;
}

export type NativeSubmissionResult =
  | { readonly result: "NotFound" }
  | { readonly result: "Authorized"; readonly acceptance: Accepted };

export type NativeCancellation =
  | { readonly result: "NotFound" }
  | { readonly result: "Found"; readonly cancellation: Cancelled };

export type AuthorizedResult<Value> =
  | { readonly result: "NotFound" }
  | { readonly result: "Authorized"; readonly value: Value };

export interface NativeWeb {
  submit(
    principal: Principal,
    submission: NativeSubmission,
  ): Promise<NativeSubmissionResult>;
  operation(
    principal: Principal,
    partition: Partition,
    operation: OperationId,
  ): Promise<OperationResource | undefined>;
  project(
    principal: Principal,
    partition: Partition,
    query: ProjectReadQuery,
  ): Promise<ProjectRead>;
  cancel(
    principal: Principal,
    partition: Partition,
    operation: OperationId,
  ): Promise<NativeCancellation>;
  createConfiguration(
    principal: Principal,
    input: {
      readonly partition: Partition;
      readonly revision: ConfigurationRevisionId;
      readonly parent?: ConfigurationRevisionId;
      readonly canonical: CanonicalConfiguration;
    },
  ): Promise<AuthorizedResult<ConfigurationCreated>>;
  createDraft(
    principal: Principal,
    input: {
      readonly partition: Partition;
      readonly configurationRevision: ConfigurationRevisionId;
      readonly authoring: ReleaseAuthoring;
    },
  ): Promise<AuthorizedResult<DraftCreated>>;
  reviseDraft(
    principal: Principal,
    input: {
      readonly partition: Partition;
      readonly ticket: TicketId;
      readonly expectedVersion: number;
      readonly configurationRevision: ConfigurationRevisionId;
      readonly authoring: ReleaseAuthoring;
    },
  ): Promise<AuthorizedResult<DraftRevised>>;
  deleteDraft(
    principal: Principal,
    input: {
      readonly partition: Partition;
      readonly ticket: TicketId;
      readonly expectedVersion: number;
    },
  ): Promise<AuthorizedResult<DraftDeleted>>;
}

type NativeAuthoringMethods = Pick<
  NativeWeb,
  "createConfiguration" | "createDraft" | "reviseDraft" | "deleteDraft"
>;

function nativeAuthoringMethods(
  access: ProjectAccess,
  authoring: AuthoringStore,
): NativeAuthoringMethods {
  return {
    createConfiguration: async (principal, input) => {
      const authority = await access.authorize(
        principal,
        input.partition,
        "Mutate",
      );
      return authority === undefined
        ? { result: "NotFound" }
        : {
            result: "Authorized",
            value: await authoring.createConfiguration({ ...input, authority }),
          };
    },
    createDraft: async (principal, input) => {
      const authority = await access.authorize(
        principal,
        input.partition,
        "Mutate",
      );
      return authority === undefined
        ? { result: "NotFound" }
        : {
            result: "Authorized",
            value: await authoring.createDraft({ ...input, authority }),
          };
    },
    reviseDraft: async (principal, input) => {
      const authority = await access.authorize(
        principal,
        input.partition,
        "Mutate",
      );
      return authority === undefined
        ? { result: "NotFound" }
        : {
            result: "Authorized",
            value: await authoring.reviseDraft({ ...input, authority }),
          };
    },
    deleteDraft: async (principal, input) => {
      const authority = await access.authorize(
        principal,
        input.partition,
        "Mutate",
      );
      return authority === undefined
        ? { result: "NotFound" }
        : {
            result: "Authorized",
            value: await authoring.deleteDraft({ ...input, authority }),
          };
    },
  };
}

/** Builds the application boundary from authorization, read, and inbox ports. */
export function nativeWeb(
  access: ProjectAccess,
  reads: NativeReadStore,
  inbox: OperationInbox,
  authoring: AuthoringStore,
): NativeWeb {
  return {
    ...nativeAuthoringMethods(access, authoring),
    submit: async (principal, submission) => {
      const authority = await access.authorize(
        principal,
        submission.partition,
        "Mutate",
      );
      if (authority === undefined) return { result: "NotFound" };
      if (
        submission.command.command === "Decide" &&
        submission.command.event.type === "ReleaseTicket"
      ) {
        return {
          result: "Authorized",
          acceptance: { accepted: "InvalidCommand" },
        };
      }
      const accepted: Submission = { ...submission, authority };
      return { result: "Authorized", acceptance: await inbox.accept(accepted) };
    },
    operation: async (principal, partition, operation) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? undefined
        : reads.operation(partition, operation),
    project: async (principal, partition, query) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? { result: "NotFound" }
        : reads.project(partition, checkedProjectReadQuery(query)),
    cancel: async (principal, partition, operation) => {
      const authority = await access.authorize(principal, partition, "Mutate");
      if (authority === undefined) return { result: "NotFound" };
      const resource = await reads.operation(partition, operation);
      if (resource === undefined) return { result: "NotFound" };
      return {
        result: "Found",
        cancellation: await inbox.cancel({ partition, operation, authority }),
      };
    },
  };
}
