import { z } from "zod";

import { revokeEvent, resumeTicketEvent } from "../../actor/decisionEvent.ts";
import type { ReleaseAuthoring } from "../../actor/decisionEvent.ts";
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
import {
  dispatchViewSchemaVersion,
  checkedSelectorDecisionReference,
} from "../../interpreter/dispatchView.ts";
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

export const nativeHttpVersion = 1;
export const nativeHttpBasePath = "/api/v1";
export const nativeHttpMediaType = "application/vnd.chuggy.v1+json";
export const nativeHttpBodyBytesMax = 65_536;
export const nativeHttpHeaderBytesMax = 16_384;
export const nativeHttpCursorCharsMax = 2_048;
export const nativeHttpPathSegmentCharsMax = 256;

export const nativeHttpRoutes = {
  contract: `${nativeHttpBasePath}/contract`,
  installation: `${nativeHttpBasePath}/installation`,
  projects: `${nativeHttpBasePath}/projects`,
  project: `${nativeHttpBasePath}/tenants/:tenant/projects/:project`,
  tickets: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/tickets`,
  ticket: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/tickets/:ticket`,
  operationalStatus: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/operational-status`,
  selectorContext: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/selector-context`,
  executions: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/executions`,
  execution: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/executions/:execution`,
  outputContent: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/executions/:execution/artifacts/:ordinal`,
  operations: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/operations`,
  operation: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/operations/:operation`,
  notifications: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/notifications`,
  configurations: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/configurations`,
  configurationImports: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/configurations/imports`,
  configuration: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/configurations/:revision`,
  drafts: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/drafts`,
  draftInitialization: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/draft-initializations/:revision`,
  draft: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/drafts/:ticket`,
  dispatchView: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/dispatch-view`,
} as const;

export function nativeHttpContractDocument(): unknown {
  return {
    version: nativeHttpVersion,
    basePath: nativeHttpBasePath,
    mediaType: nativeHttpMediaType,
    authentication: {
      scheme: "Bearer",
      format: "OIDC JWT",
      principal: "length-prefixed issuer and subject",
    },
    notifications: "bounded-polling",
    caching: "no-store",
    cors: "same-origin",
    credentials: "authorization bearer header; no cookies",
    ticketPhaseFilter: {
      query: "phase",
      all: "omit phase",
      nonTerminal: "phase=NonTerminal",
      selected: "repeat phase with one or more exact phase names",
    },
    identities: {
      installation: "canonical UUID authority identity",
      tenant: "percent-encoded opaque UTF-8 path segment",
      project: "percent-encoded opaque UTF-8 path segment",
      ticket: "canonical positive decimal integer",
      operation: "percent-encoded opaque UTF-8 path segment",
      cursor: "opaque canonical base64url",
    },
    routes: nativeHttpRoutes,
    schemas: {
      publicMutation: z.toJSONSchema(publicMutationSchema),
      configurationCreation: z.toJSONSchema(configurationCreationSchema),
      repositoryConfigurationImport: z.toJSONSchema(
        repositoryConfigurationImportSchema,
      ),
      draftCreation: z.toJSONSchema(draftCreationSchema),
      draftRevision: z.toJSONSchema(draftRevisionSchema),
    },
  };
}

const ticketSchema = z.number().int().safe().positive();
const versionSchema = z.number().int().safe().nonnegative();
const identitySchema = z.string().min(1);

const publicMutationSchema = z.discriminatedUnion("mutation", [
  z.strictObject({ mutation: z.literal("RevokeTicket"), ticket: ticketSchema }),
  z.strictObject({ mutation: z.literal("ResumeTicket"), ticket: ticketSchema }),
  z.strictObject({
    mutation: z.literal("ReleaseDraft"),
    ticket: ticketSchema,
    authoringVersion: versionSchema,
    configurationRevision: z.string(),
  }),
  z.strictObject({
    mutation: z.literal("ResolveNativeAction"),
    action: z.string(),
    authorizingSequence: versionSchema,
    resolution: z.enum(["Resume", "Revoke", "Approve", "Decline"]),
  }),
  z.strictObject({
    mutation: z.literal("ManualDispatch"),
    ticket: ticketSchema,
    expectedTicketVersion: versionSchema,
  }),
  z.strictObject({
    mutation: z.literal("ProposeDispatch"),
    ticket: ticketSchema,
    expectedTicketVersion: versionSchema,
    observedViewToken: z.strictObject({
      tenant: identitySchema,
      project: identitySchema,
      recoveryEpoch: identitySchema,
      schemaVersion: z.literal(dispatchViewSchemaVersion),
      watermark: versionSchema,
      digest: z.string().regex(/^[0-9a-f]{64}$/u),
    }),
    selectorDecisionReference: z.string(),
  }),
]);

export type PublicMutation = z.infer<typeof publicMutationSchema>;

export const nativeHttpDraftDependenciesMax = 100;
export const nativeHttpDraftStagesMax = 100;

const authoringSchema = z.strictObject({
  dependencies: z
    .array(ticketSchema)
    .max(nativeHttpDraftDependenciesMax)
    .refine((values) => new Set(values).size === values.length),
  program: z
    .array(
      z.strictObject({
        fanout: ticketSchema,
        combinator: z.enum(["UnanimousPass", "AnyPass"]),
      }),
    )
    .max(nativeHttpDraftStagesMax),
  workFanout: ticketSchema,
  reworkPolicy: z.strictObject({
    type: z.literal("BudgetedRework"),
    value: versionSchema,
  }),
  finalizationPricing: z.union([
    z.literal("DeadlineOnly"),
    z.strictObject({ type: z.literal("Budgeted"), value: versionSchema }),
  ]),
  resumePricing: z.enum(["RetryCharged", "RetryFree"]),
  finalizer: z.enum(["NoFinalizer", "ManagedFinalizer"]),
});

const configurationCreationSchema = z.strictObject({
  revision: identitySchema,
  parent: identitySchema.optional(),
  canonical: identitySchema,
});

const repositoryConfigurationImportSchema = z.strictObject({
  commit: identitySchema,
});

const draftCreationSchema = z.strictObject({
  configurationRevision: identitySchema,
  configurationDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  expectedProjectSequence: versionSchema,
  authoring: authoringSchema,
});

const draftRevisionSchema = z.strictObject({
  expectedVersion: versionSchema,
  configurationRevision: identitySchema,
  authoring: authoringSchema,
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
}

export interface ParsedDraftRevision {
  readonly expectedVersion: number;
  readonly configurationRevision: ConfigurationRevisionId;
  readonly authoring: ReleaseAuthoring;
}

function releaseAuthoring(
  value: z.infer<typeof authoringSchema>,
): ReleaseAuthoring {
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

export interface HttpErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

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
  ticket: ticketSchema,
});

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

export function nativeHttpError(
  code: string,
  message: string,
): HttpErrorEnvelope {
  return { error: { code, message } };
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
