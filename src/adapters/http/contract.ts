/**
 * The server's half of the public contract: it turns a parsed wire value into
 * the interpreter's own types, and a cursor payload into base64url.
 *
 * The wire itself — routes, bounds, request schemas and the document that
 * describes them — is `src/contract/`, which the browser imports too.
 */

import { z } from "zod";
import { nativeHttpEndpoints } from "../../contract/endpoints.ts";

import { revokeEvent, resumeTicketEvent } from "../../actor/decisionEvent.ts";
import type { ReleaseAuthoring } from "../../actor/decisionEvent.ts";
import {
  nativeHttpCursorCharsMax,
  nativeHttpVersion,
  textCodePointsCount,
} from "../../contract/http.ts";
import type { ReleaseAuthoringBody } from "../../contract/authoring.ts";
import type { TicketBriefBody } from "../../contract/brief.ts";
import {
  configurationCreationSchema,
  draftCreationSchema,
  draftRevisionSchema,
  publicMutationSchema,
  forgeCredentialRequestSchema,
  forgeInstallationClaimSchema,
  projectRepositoryBindSchema,
  projectRepositoryCreateSchema,
  projectRepositoryLandingSchema,
  projectRepositoryRetirementSchema,
  repositoryConfigurationImportSchema,
  selectorProjectSettingsSchema,
  type PublicMutation,
} from "../../contract/requests.ts";
import {
  asSessionId,
  asSessionTurnId,
  type SessionId,
  type SessionTurnId,
} from "../../interpreter/agentSession.ts";
import type {
  SelectorProjectLimitOverrides,
  SelectorProjectOverrides,
} from "../../interpreter/selector.ts";
import { asTaskId, asTicketId } from "../../domain/ids.ts";
import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
  type CanonicalConfiguration,
  type ConfigurationPageCursor,
  type ConfigurationRevisionId,
  type DraftPageCursor,
} from "../../interpreter/authoring.ts";
import { asPublicInstant } from "../../interpreter/publicResource.ts";
import type {
  NativeActionPosition,
  TicketActivityPosition,
} from "../../interpreter/nativeWeb.ts";
import { checkedSelectorDecisionReference } from "../../interpreter/dispatchView.ts";
import type { ForgeCredentialRequest } from "../../interpreter/forgeCredentials.ts";
import {
  asForgeAccount,
  asForgeApp,
  asForgeId,
  asForgeInstallationId,
  asForgeRepositoryName,
  type ForgeInstallationId,
} from "../../interpreter/forgeInstallation.ts";
import type {
  ForgeInstallationClaimRequest,
  ProjectRepositoryBindRequest,
  ProjectRepositoryCreateRequest,
} from "../../interpreter/repositoryOnboarding.ts";
import type { ExecutionPageCursor } from "../../interpreter/operationsView.ts";
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
  asRepositoryId,
  type GitObjectId,
  type RepositoryId,
} from "../../interpreter/finalizer.ts";
import {
  asDraftBrief,
  type DraftBrief,
} from "../../interpreter/ticketBrief.ts";
import {
  asRepositoryLanding,
  type RepositoryLanding,
} from "../../interpreter/repositoryBinding.ts";

/**
 * What a cursor carries once decoded. The reader is always the server that
 * issued it, which is why the shape is here and not in the contract.
 */
const inventoryCursorSchema = z.strictObject({
  version: z.literal(nativeHttpVersion),
  tenant: z.string(),
  project: z.string(),
});

const configurationCursorSchema = inventoryCursorSchema.extend({
  createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), {
    message: "Expected a timestamp",
  }),
  revision: z.string().min(1),
});

const ticketActivityCursorSchema = inventoryCursorSchema.extend({
  sequence: z.number().int().safe().nonnegative(),
  ticket: z.number().int().safe().positive(),
});

const draftCursorSchema = inventoryCursorSchema.extend({
  ticket: z.number().int().safe().positive(),
});

const executionCursorSchema = inventoryCursorSchema.extend({
  ticket: z.number().int().safe().positive(),
  task: z.number().int().safe().positive(),
});

const nativeActionCursorSchema = inventoryCursorSchema.extend({
  authorizingSequence: z.number().int().safe().positive(),
  action: z.string().min(1),
});

import {
  workerPoolRedemptionSchema,
  workerPoolRegistrationTokenRequestSchema,
  type WorkerPoolRedemptionRequest,
  type WorkerPoolRegistrationTokenRequest,
} from "../../contract/workerPool.ts";
export interface ParsedConfigurationCreation {
  readonly revision: ConfigurationRevisionId;
  readonly parent?: ConfigurationRevisionId;
  readonly canonical: CanonicalConfiguration;
}

export interface ParsedRepositoryConfigurationImport {
  readonly repository: RepositoryId;
  readonly commit: GitObjectId;
}

/**
 * What an owner asks a registration token for, and what a machine redeems one
 * with. Both are the contract's own schemas: a pool is registered by a third
 * party's machine, so the shapes are where the wire is.
 */
export function parseWorkerPoolTokenRequest(
  body: unknown,
): WorkerPoolRegistrationTokenRequest {
  return workerPoolRegistrationTokenRequestSchema.parse(body);
}

export function parseWorkerPoolRedemption(
  body: unknown,
): WorkerPoolRedemptionRequest {
  return workerPoolRedemptionSchema.parse(body);
}

export function parseRepositoryConfigurationImport(
  body: unknown,
): ParsedRepositoryConfigurationImport {
  const parsed = repositoryConfigurationImportSchema.parse(body);
  return {
    repository: asRepositoryId(parsed.repository),
    commit: asGitObjectId(parsed.commit),
  };
}

/** One minting request as the wire carries it, both fields already narrowed. */
export function parseForgeCredentialRequest(
  body: unknown,
): ForgeCredentialRequest {
  const parsed = forgeCredentialRequestSchema.parse(body);
  return {
    repository: asRepositoryId(parsed.repository),
    permissions: parsed.permissions,
  };
}

/** One claim as the wire carries it, every field already narrowed. */
export function parseForgeInstallationClaim(
  body: unknown,
): ForgeInstallationClaimRequest {
  const parsed = forgeInstallationClaimSchema.parse(body);
  return {
    forge: asForgeId(parsed.forge),
    app: asForgeApp(parsed.app),
    installationId: asForgeInstallationId(parsed.installationId),
  };
}

/** One installation identity out of a path segment. */
export function parseForgeInstallationId(value: string): ForgeInstallationId {
  return asForgeInstallationId(value);
}

/** One binding as the wire carries it, the identity coming from the header rather than the body. */
export function parseProjectRepositoryBind(
  body: unknown,
  operation: string,
): ProjectRepositoryBindRequest {
  const parsed = projectRepositoryBindSchema.parse(body);
  return {
    repository: asRepositoryId(parsed.repository),
    operation: asOperationId(operation),
  };
}

/** One landing move as the wire carries it: the binding, the landing read, and the one wanted. */
export function parseProjectRepositoryLanding(body: unknown): {
  readonly repository: RepositoryId;
  readonly expected: RepositoryLanding;
  readonly landing: RepositoryLanding;
} {
  const parsed = projectRepositoryLandingSchema.parse(body);
  return {
    repository: asRepositoryId(parsed.repository),
    expected: asRepositoryLanding(parsed.expected.mode),
    landing: asRepositoryLanding(parsed.landing.mode),
  };
}

/** One retirement as the wire carries it, which is the binding and nothing else. */
export function parseProjectRepositoryRetirement(body: unknown): RepositoryId {
  return asRepositoryId(
    projectRepositoryRetirementSchema.parse(body).repository,
  );
}

/** One creation as the wire carries it, the identity coming from the header rather than the body. */
export function parseProjectRepositoryCreate(
  body: unknown,
  operation: string,
): ProjectRepositoryCreateRequest {
  const parsed = projectRepositoryCreateSchema.parse(body);
  return {
    account: asForgeAccount(parsed.account),
    name: asForgeRepositoryName(parsed.name),
    visibility: parsed.visibility,
    operation: asOperationId(operation),
  };
}

export interface ParsedDraftCreation {
  readonly configurationRevision: ConfigurationRevisionId;
  readonly configurationDigest: string;
  readonly expectedProjectSequence: number;
  readonly authoring: ReleaseAuthoring;
  readonly brief: DraftBrief;
}

export interface ParsedDraftRevision {
  readonly expectedVersion: number;
  readonly configurationRevision: ConfigurationRevisionId;
  readonly authoring: ReleaseAuthoring;
  readonly brief: DraftBrief;
}

function releaseAuthoring(value: ReleaseAuthoringBody): ReleaseAuthoring {
  return {
    deps: new Set(value.dependencies),
    prog: value.program,
    workFanout: value.workFanout,
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
    ...(value.title === undefined ? {} : { title: value.title }),
    intent: value.intent,
    links: value.links,
    ...(value.checks === undefined ? {} : { checks: value.checks }),
    ...(value.repository === undefined ? {} : { repository: value.repository }),
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

/**
 * Drops the keys the parsed body carries as undefined, because an optional
 * override the interpreter holds is absent rather than present-and-undefined.
 */
function withoutAbsentFields<T extends object>(
  value: T,
): Partial<{ [Key in keyof T]: Exclude<T[Key], undefined> }> {
  return Object.fromEntries(
    Object.entries(value).filter(([, held]) => held !== undefined),
  ) as Partial<{ [Key in keyof T]: Exclude<T[Key], undefined> }>;
}

/** The whole override set and the revision it was read at, as the interpreter takes them. */
export function parseSelectorProjectSettings(body: unknown): {
  readonly expectedRevision: number;
  readonly overrides: SelectorProjectOverrides;
} {
  const value = selectorProjectSettingsSchema.parse(body);
  const limits: SelectorProjectLimitOverrides | undefined =
    value.overrides.limits === undefined
      ? undefined
      : withoutAbsentFields(value.overrides.limits);
  return {
    expectedRevision: value.expectedRevision,
    overrides: withoutAbsentFields({ ...value.overrides, limits }),
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
    brief: releaseBrief(value.brief),
  };
}

export interface ParsedSubmission {
  readonly operation: OperationId;
  readonly key: IdempotencyKey;
  readonly command: TicketCommand;
}

/** Encodes only the fields selected by a cursor's payload projection. */
function cursorEncoded(partition: Partition, payload: object = {}): string {
  return Buffer.from(
    JSON.stringify({
      version: nativeHttpVersion,
      tenant: partition.tenant,
      project: partition.project,
      ...payload,
    }),
  ).toString("base64url");
}

function cursorDecoded(value: string, what: string): unknown {
  if (
    value.length === 0 ||
    textCodePointsCount(value) > nativeHttpCursorCharsMax
  )
    throw new RangeError(`${what} cursor is empty or too long`);
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString());
  } catch (cause) {
    throw new RangeError(`${what} cursor is not base64url JSON`, { cause });
  }
}

/** A project cursor binds its payload to the issuing partition and exact wire bytes. */
function projectCursorCodec<
  Payload extends { tenant: string; project: string },
  Value,
>(
  what: string,
  schema: z.ZodType<Payload>,
  read: (payload: Payload) => Value,
  write: (value: Value) => object,
) {
  const encode = (partition: Partition, value: Value): string =>
    cursorEncoded(partition, write(value));
  const parse = (value: string, expected: Partition): Value => {
    const cursor = schema.parse(cursorDecoded(value, what));
    const partition = parsePartition(cursor.tenant, cursor.project);
    if (
      partition.tenant !== expected.tenant ||
      partition.project !== expected.project
    )
      throw new RangeError(`${what} cursor belongs to another project`);
    const parsed = read(cursor);
    if (encode(partition, parsed) !== value)
      throw new RangeError(`${what} cursor is not canonically encoded`);
    return parsed;
  };
  return { encode, parse };
}

export const {
  encode: encodeTicketActivityCursor,
  parse: parseTicketActivityCursor,
} = projectCursorCodec(
  "ticket activity",
  ticketActivityCursorSchema,
  (cursor): TicketActivityPosition => ({
    sequence: cursor.sequence,
    ticket: asTicketId(cursor.ticket),
  }),
  (cursor) => ({ sequence: cursor.sequence, ticket: cursor.ticket }),
);

export const { encode: encodeExecutionCursor, parse: parseExecutionCursor } =
  projectCursorCodec(
    "execution",
    executionCursorSchema,
    (cursor): ExecutionPageCursor => ({
      ticket: asTicketId(cursor.ticket),
      task: asTaskId(cursor.task),
    }),
    (cursor) => ({ ticket: cursor.ticket, task: cursor.task }),
  );

export const {
  encode: encodeNativeActionCursor,
  parse: parseNativeActionCursor,
} = projectCursorCodec(
  "native action",
  nativeActionCursorSchema,
  (cursor): NativeActionPosition => ({
    authorizingSequence: cursor.authorizingSequence,
    action: cursor.action,
  }),
  (cursor) => ({
    authorizingSequence: cursor.authorizingSequence,
    action: cursor.action,
  }),
);

export const {
  encode: encodeConfigurationCursor,
  parse: parseConfigurationCursor,
} = projectCursorCodec(
  "configuration",
  configurationCursorSchema,
  (cursor): ConfigurationPageCursor => ({
    createdAt: asPublicInstant(cursor.createdAt),
    revision: asConfigurationRevisionId(cursor.revision),
  }),
  (cursor) => ({ createdAt: cursor.createdAt, revision: cursor.revision }),
);

export const { encode: encodeDraftCursor, parse: parseDraftCursor } =
  projectCursorCodec(
    "draft",
    draftCursorSchema,
    (cursor): DraftPageCursor => asTicketId(cursor.ticket),
    (cursor) => ({ ticket: cursor }),
  );

export function encodeInventoryCursor(partition: Partition): string {
  return cursorEncoded(partition);
}

export function parseInventoryCursor(value: string): Partition {
  const cursor = inventoryCursorSchema.parse(cursorDecoded(value, "inventory"));
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

/**
 * What a member put in their own thread: the turn identity they minted and the
 * text they typed. The turn is the idempotency, exactly as `operation` is on a
 * submission, so a retried post answers the ordinal it already has.
 */
export function parseThreadMessage(body: unknown): {
  readonly turn: SessionTurnId;
  readonly message: string;
} {
  const value = nativeHttpEndpoints.sendThreadMessage.body.parse(body);
  return { turn: asSessionTurnId(value.turn), message: value.message };
}

/**
 * What a member called their own thread. The schema is strict, so a body
 * carrying anything but `title` is an `InvalidRequest` rather than a rename
 * that quietly ignored half of what was sent.
 */
export function parseThreadRename(body: unknown): { readonly title: string } {
  return { title: nativeHttpEndpoints.renameThread.body.parse(body).title };
}

/** Which side of its owner's rail this thread is on, strictly as `hidden`. */
export function parseThreadHide(body: unknown): { readonly hidden: boolean } {
  return { hidden: nativeHttpEndpoints.hideThread.body.parse(body).hidden };
}

/**
 * What a member asked the lead aside: the two identities they minted and the
 * question they typed. BOTH are the idempotency, because opening a fork and
 * enqueuing its one turn are one write — so a retried post is answered the
 * ordinal it already has rather than forking the lead a second time.
 */
export function parseLeadInquiry(body: unknown): {
  readonly session: SessionId;
  readonly turn: SessionTurnId;
  readonly question: string;
} {
  const value = nativeHttpEndpoints.askLead.body.parse(body);
  return {
    session: asSessionId(value.session),
    turn: asSessionTurnId(value.turn),
    question: value.question,
  };
}
