/**
 * The server's half of the public contract: it turns a parsed wire value into
 * the interpreter's own types, and a cursor payload into base64url.
 *
 * The wire itself — routes, bounds, request schemas and the document that
 * describes them — is `src/contract/`, which the browser imports too.
 */

import { revokeEvent, resumeTicketEvent } from "../../actor/decisionEvent.ts";
import type { ReleaseAuthoring } from "../../actor/decisionEvent.ts";
import {
  nativeHttpCursorCharsMax,
  nativeHttpVersion,
} from "../../contract/http.ts";
import type { ReleaseAuthoringBody } from "../../contract/authoring.ts";
import {
  configurationCreationSchema,
  configurationCursorSchema,
  draftCreationSchema,
  draftRevisionSchema,
  inventoryCursorSchema,
  publicMutationSchema,
  repositoryConfigurationImportSchema,
  ticketActivityCursorSchema,
  type PublicMutation,
} from "../../contract/requests.ts";
import { asTicketId } from "../../domain/ids.ts";
import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
  type CanonicalConfiguration,
  type ConfigurationPageCursor,
  type ConfigurationRevisionId,
} from "../../interpreter/authoring.ts";
import { asPublicInstant } from "../../interpreter/publicResource.ts";
import type { TicketActivityPosition } from "../../interpreter/nativeWeb.ts";
import { checkedSelectorDecisionReference } from "../../interpreter/dispatchView.ts";
import {
  asIdempotencyKey,
  asOperationDecisionEvent,
  asOperationId,
  type IdempotencyKey,
  type OperationId,
  type TicketCommand,
} from "../../interpreter/operationInbox.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import {
  asGitObjectId,
  type GitObjectId,
} from "../../interpreter/finalizer.ts";

export interface ParsedConfigurationCreation {
  readonly revision: ConfigurationRevisionId;
  readonly parent?: ConfigurationRevisionId;
  readonly canonical: CanonicalConfiguration;
}

export function parseRepositoryConfigurationImport(body: unknown): GitObjectId {
  return asGitObjectId(repositoryConfigurationImportSchema.parse(body).commit);
}

export interface ParsedDraftCreation {
  readonly configurationRevision: ConfigurationRevisionId;
  readonly configurationDigest: string;
  readonly expectedProjectSequence: number;
  readonly authoring: ReleaseAuthoring;
}

export interface ParsedDraftRevision {
  readonly expectedVersion: number;
  readonly configurationRevision: ConfigurationRevisionId;
  readonly authoring: ReleaseAuthoring;
}

function releaseAuthoring(value: ReleaseAuthoringBody): ReleaseAuthoring {
  return {
    deps: new Set(value.dependencies),
    prog: value.program,
    workFanout: value.workFanout,
    reworkPolicy: value.reworkPolicy,
    finalizationPricing: value.finalizationPricing,
    resumePricing: value.resumePricing,
    finalizer: value.finalizer,
  };
}

export function parseConfigurationCreation(
  body: unknown,
): ParsedConfigurationCreation {
  const value = configurationCreationSchema.parse(body);
  return {
    revision: asConfigurationRevisionId(value.revision),
    ...(value.parent === undefined
      ? {}
      : { parent: asConfigurationRevisionId(value.parent) }),
    canonical: asCanonicalConfiguration(value.canonical),
  };
}

export function parseDraftCreation(body: unknown): ParsedDraftCreation {
  const value = draftCreationSchema.parse(body);
  return {
    configurationRevision: asConfigurationRevisionId(
      value.configurationRevision,
    ),
    configurationDigest: value.configurationDigest,
    expectedProjectSequence: value.expectedProjectSequence,
    authoring: releaseAuthoring(value.authoring),
  };
}

export function parseDraftRevision(body: unknown): ParsedDraftRevision {
  const value = draftRevisionSchema.parse(body);
  return {
    expectedVersion: value.expectedVersion,
    configurationRevision: asConfigurationRevisionId(
      value.configurationRevision,
    ),
    authoring: releaseAuthoring(value.authoring),
  };
}

export interface ParsedSubmission {
  readonly operation: OperationId;
  readonly key: IdempotencyKey;
  readonly command: TicketCommand;
}

export function encodeTicketActivityCursor(
  partition: Partition,
  cursor: TicketActivityPosition,
): string {
  return Buffer.from(
    JSON.stringify({
      version: nativeHttpVersion,
      tenant: partition.tenant,
      project: partition.project,
      sequence: cursor.sequence,
      ticket: cursor.ticket,
    }),
  ).toString("base64url");
}

export function parseTicketActivityCursor(
  value: string,
  expected: Partition,
): TicketActivityPosition {
  if (value.length === 0 || value.length > nativeHttpCursorCharsMax)
    throw new RangeError("ticket activity cursor is empty or too long");
  const decoded: unknown = JSON.parse(
    Buffer.from(value, "base64url").toString(),
  );
  const cursor = ticketActivityCursorSchema.parse(decoded);
  const partition = parsePartition(cursor.tenant, cursor.project);
  if (
    partition.tenant !== expected.tenant ||
    partition.project !== expected.project
  )
    throw new RangeError("ticket activity cursor belongs to another project");
  const parsed = {
    sequence: cursor.sequence,
    ticket: asTicketId(cursor.ticket),
  };
  if (encodeTicketActivityCursor(partition, parsed) !== value)
    throw new RangeError("ticket activity cursor is not canonically encoded");
  return parsed;
}

export function encodeConfigurationCursor(
  partition: Partition,
  cursor: ConfigurationPageCursor,
): string {
  return Buffer.from(
    JSON.stringify({
      version: nativeHttpVersion,
      tenant: partition.tenant,
      project: partition.project,
      createdAt: cursor.createdAt,
      revision: cursor.revision,
    }),
  ).toString("base64url");
}

export function parseConfigurationCursor(
  value: string,
  expected: Partition,
): ConfigurationPageCursor {
  if (value.length === 0 || value.length > nativeHttpCursorCharsMax)
    throw new RangeError("configuration cursor is empty or too long");
  const decoded: unknown = JSON.parse(
    Buffer.from(value, "base64url").toString(),
  );
  const cursor = configurationCursorSchema.parse(decoded);
  const partition = parsePartition(cursor.tenant, cursor.project);
  if (
    partition.tenant !== expected.tenant ||
    partition.project !== expected.project
  )
    throw new RangeError("configuration cursor belongs to another project");
  const parsed = {
    createdAt: asPublicInstant(cursor.createdAt),
    revision: asConfigurationRevisionId(cursor.revision),
  };
  if (encodeConfigurationCursor(partition, parsed) !== value)
    throw new RangeError("configuration cursor is not canonically encoded");
  return parsed;
}

export function encodeInventoryCursor(partition: Partition): string {
  return Buffer.from(
    JSON.stringify({
      version: nativeHttpVersion,
      tenant: partition.tenant,
      project: partition.project,
    }),
  ).toString("base64url");
}

export function parseInventoryCursor(value: string): Partition {
  if (value.length === 0 || value.length > nativeHttpCursorCharsMax)
    throw new RangeError("inventory cursor is empty or too long");
  const decoded: unknown = JSON.parse(
    Buffer.from(value, "base64url").toString(),
  );
  const cursor = inventoryCursorSchema.parse(decoded);
  const partition = parsePartition(cursor.tenant, cursor.project);
  if (encodeInventoryCursor(partition) !== value)
    throw new RangeError("inventory cursor is not canonically encoded");
  return partition;
}

export function parsePartition(tenant: string, project: string): Partition {
  return { tenant: asTenantId(tenant), project: asProjectId(project) };
}

function publicMutationCommand(mutation: PublicMutation): TicketCommand {
  switch (mutation.mutation) {
    case "RevokeTicket":
      return {
        version: 1,
        command: "Decide",
        event: asOperationDecisionEvent(
          revokeEvent(asTicketId(mutation.ticket)),
        ),
      };
    case "ResumeTicket":
      return {
        version: 1,
        command: "Decide",
        event: asOperationDecisionEvent(
          resumeTicketEvent(asTicketId(mutation.ticket)),
        ),
      };
    case "ReleaseDraft":
      return {
        version: 1,
        command: "ReleaseDraft",
        ticket: asTicketId(mutation.ticket),
        authoringVersion: mutation.authoringVersion,
        configurationRevision: mutation.configurationRevision,
      };
    case "ResolveNativeAction":
      return {
        version: 1,
        command: "ResolveNativeAction",
        action: mutation.action,
        authorizingSeq: mutation.authorizingSequence,
        resolution: mutation.resolution,
      };
    case "ManualDispatch":
      return {
        version: 1,
        command: "ManualDispatch",
        ticket: asTicketId(mutation.ticket),
        expectedTicketVersion: mutation.expectedTicketVersion,
      };
    case "ProposeDispatch":
      return {
        version: 1,
        command: "ProposeDispatch",
        ticket: asTicketId(mutation.ticket),
        expectedTicketVersion: mutation.expectedTicketVersion,
        observedViewToken: mutation.observedViewToken,
        selectorDecisionReference: checkedSelectorDecisionReference(
          mutation.selectorDecisionReference,
        ),
      };
  }
}

export function parseSubmission(
  operation: string,
  idempotencyKey: string,
  body: unknown,
): ParsedSubmission {
  return {
    operation: asOperationId(operation),
    key: asIdempotencyKey(idempotencyKey),
    command: publicMutationCommand(publicMutationSchema.parse(body)),
  };
}
