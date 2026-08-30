/**
 * The server's half of the public contract: it turns a parsed wire value into
 * the interpreter's own types, and a cursor payload into base64url.
 *
 * The wire itself — routes, bounds, request schemas and the document that
 * describes them — is `src/contract/`, which the browser imports too.
 */

import { z } from "zod";

import { revokeEvent, resumeTicketEvent } from "../../actor/decisionEvent.ts";
import type { ReleaseAuthoring } from "../../actor/decisionEvent.ts";
import {
  nativeHttpCursorCharsMax,
  nativeHttpVersion,
} from "../../contract/http.ts";
import type { ReleaseAuthoringBody } from "../../contract/authoring.ts";
import type { TicketBriefBody } from "../../contract/brief.ts";
import {
  configurationCreationSchema,
  draftCreationSchema,
  draftRevisionSchema,
  publicMutationSchema,
  repositoryConfigurationImportSchema,
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
import type {
  NativeActionPosition,
  TicketActivityPosition,
} from "../../interpreter/nativeWeb.ts";
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
import {
  asBriefTitle,
  asDraftBrief,
  type BriefTitle,
  type DraftBrief,
} from "../../interpreter/ticketBrief.ts";

/**
 * What a cursor carries once decoded. The reader is always the server that
 * issued it, which is why the shape is here and not in the contract.
 */
const inventoryCursorSchema = z.strictObject({
  version: z.literal(nativeHttpVersion),
  tenant: z.string(),
  project: z.string(),
});

const configurationCursorSchema = z.strictObject({
  version: z.literal(nativeHttpVersion),
  tenant: z.string(),
  project: z.string(),
  createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), {
    message: "Expected a timestamp",
  }),
  revision: z.string().min(1),
});

const ticketActivityCursorSchema = z.strictObject({
  version: z.literal(nativeHttpVersion),
  tenant: z.string(),
  project: z.string(),
  sequence: z.number().int().safe().nonnegative(),
  ticket: z.number().int().safe().positive(),
});

const nativeActionCursorSchema = z.strictObject({
  version: z.literal(nativeHttpVersion),
  tenant: z.string(),
  project: z.string(),
  authorizingSequence: z.number().int().safe().positive(),
  action: z.string().min(1),
});

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
  readonly title?: BriefTitle;
  readonly brief: DraftBrief;
}

export interface ParsedDraftRevision {
  readonly expectedVersion: number;
  readonly configurationRevision: ConfigurationRevisionId;
  readonly authoring: ReleaseAuthoring;
  readonly title?: BriefTitle;
  readonly brief: DraftBrief;
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

/** Where the brief lands its work, as the unbranded shape the interpreter takes. */
function releaseBriefFinalization(
  value: NonNullable<TicketBriefBody["finalization"]>,
): { readonly mode: string; readonly target?: string } {
  return {
    mode: value.mode,
    ...(value.target === undefined ? {} : { target: value.target }),
  };
}

/** The brief beside it, branded through the rules the interpreter states once. */
function releaseBrief(value: TicketBriefBody): DraftBrief {
  return asDraftBrief({
    intent: value.intent,
    links: value.links,
    ...(value.branch === undefined ? {} : { branch: value.branch }),
    ...(value.finalization === undefined
      ? {}
      : { finalization: releaseBriefFinalization(value.finalization) }),
  });
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
    ...(value.title === undefined ? {} : { title: asBriefTitle(value.title) }),
    brief: releaseBrief(value.brief),
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
    ...(value.title === undefined ? {} : { title: asBriefTitle(value.title) }),
    brief: releaseBrief(value.brief),
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

/**
 * A cursor's payload, decoded from the base64url JSON every cursor is written
 * as. A value that is neither leaves here as the `RangeError` the error handler
 * already reads as the caller's fault, rather than as the `SyntaxError`
 * `JSON.parse` raises and no handler can tell from a corrupt stored document.
 */
function decodedCursor(value: string, what: string): unknown {
  if (value.length === 0 || value.length > nativeHttpCursorCharsMax)
    throw new RangeError(`${what} cursor is empty or too long`);
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString());
  } catch (cause) {
    throw new RangeError(`${what} cursor is not base64url JSON`, { cause });
  }
}

export function parseTicketActivityCursor(
  value: string,
  expected: Partition,
): TicketActivityPosition {
  const decoded: unknown = decodedCursor(value, "ticket activity");
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

export function encodeNativeActionCursor(
  partition: Partition,
  cursor: NativeActionPosition,
): string {
  return Buffer.from(
    JSON.stringify({
      version: nativeHttpVersion,
      tenant: partition.tenant,
      project: partition.project,
      authorizingSequence: cursor.authorizingSequence,
      action: cursor.action,
    }),
  ).toString("base64url");
}

export function parseNativeActionCursor(
  value: string,
  expected: Partition,
): NativeActionPosition {
  const decoded: unknown = decodedCursor(value, "native action");
  const cursor = nativeActionCursorSchema.parse(decoded);
  const partition = parsePartition(cursor.tenant, cursor.project);
  if (
    partition.tenant !== expected.tenant ||
    partition.project !== expected.project
  )
    throw new RangeError("native action cursor belongs to another project");
  const parsed = {
    authorizingSequence: cursor.authorizingSequence,
    action: cursor.action,
  };
  if (encodeNativeActionCursor(partition, parsed) !== value)
    throw new RangeError("native action cursor is not canonically encoded");
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
  const decoded: unknown = decodedCursor(value, "configuration");
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
  const decoded: unknown = decodedCursor(value, "inventory");
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
