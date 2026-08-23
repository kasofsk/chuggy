import { z } from "zod";

import { asTicketId } from "../../domain/ids.ts";
import type { DispatchViewPage } from "../../interpreter/dispatchView.ts";
import { dispatchViewSchemaVersion } from "../../interpreter/dispatchView.ts";
import type {
  OperationResource,
  ProjectInventoryPage,
} from "../../interpreter/nativeWeb.ts";
import { asPublicInstant } from "../../interpreter/publicResource.ts";
import type { NotificationBatch } from "../../interpreter/notifications.ts";
import { asOperationId } from "../../interpreter/operationInbox.ts";
import { asProjectId, asTenantId } from "../../interpreter/projectStore.ts";
import { parseInventoryCursor } from "./contract.ts";

const identitySchema = z.string().min(1).max(256);
const countSchema = z.number().int().safe().nonnegative();
const ticketSchema = z.number().int().safe().positive();
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);

const partitionSchema = z
  .strictObject({ tenant: identitySchema, project: identitySchema })
  .transform((value) => ({
    tenant: asTenantId(value.tenant),
    project: asProjectId(value.project),
  }));

const projectInventoryWireSchema = z.strictObject({
  projects: z.array(partitionSchema).max(100),
  nextCursor: z.string().optional(),
});

export const projectInventoryResponseSchema =
  projectInventoryWireSchema.transform((value): ProjectInventoryPage => ({
    projects: value.projects,
    ...(value.nextCursor === undefined
      ? {}
      : { nextAfter: parseInventoryCursor(value.nextCursor) }),
  }));

const notificationSchema = z.strictObject({
  ordinal: countSchema,
  kind: z.enum(["Operation", "Ticket", "Draft", "Configuration", "Project"]),
  resource: identitySchema,
  projectSequence: countSchema.optional(),
  authoringVersion: countSchema.optional(),
});

export const notificationsResponseSchema = z
  .discriminatedUnion("result", [
    z.strictObject({ result: z.literal("Reset"), cursor: countSchema }),
    z.strictObject({
      result: z.literal("Events"),
      cursor: countSchema,
      events: z.array(notificationSchema).max(100),
    }),
  ])
  .transform((value): NotificationBatch => {
    if (value.result === "Reset") return value;
    return {
      result: "Events",
      cursor: value.cursor,
      events: value.events.map((event) => ({
        ordinal: event.ordinal,
        kind: event.kind,
        resource: event.resource,
        ...(event.projectSequence === undefined
          ? {}
          : { projectSequence: event.projectSequence }),
        ...(event.authoringVersion === undefined
          ? {}
          : { authoringVersion: event.authoringVersion }),
      })),
    };
  });

const stageSchema = z.strictObject({
  fanout: ticketSchema,
  combinator: z.enum(["UnanimousPass", "AnyPass"]),
});
const dispatchTokenSchema = z.strictObject({
  tenant: identitySchema,
  project: identitySchema,
  recoveryEpoch: identitySchema,
  schemaVersion: z.literal(dispatchViewSchemaVersion),
  watermark: countSchema,
  digest: digestSchema,
});
const dispatchCandidateSchema = z.strictObject({
  ticket: ticketSchema.transform(asTicketId),
  ticketVersion: countSchema,
  dependencies: z.array(ticketSchema).max(100),
  workFanout: ticketSchema,
  program: z.array(stageSchema).max(100),
  reworkPolicy: z.strictObject({
    type: z.literal("BudgetedRework"),
    value: countSchema,
  }),
  finalizationPricing: z.union([
    z.literal("DeadlineOnly"),
    z.strictObject({ type: z.literal("Budgeted"), value: countSchema }),
  ]),
  resumePricing: z.enum(["RetryCharged", "RetryFree"]),
  finalizer: z.enum(["NoFinalizer", "ManagedFinalizer"]),
  configurationRevision: identitySchema,
  configurationDigest: digestSchema,
  configurationCanonical: z.string().min(1),
});

export const dispatchViewResponseSchema = z
  .discriminatedUnion("result", [
    z.strictObject({ result: z.literal("Reset") }),
    z.strictObject({
      result: z.literal("Page"),
      token: dispatchTokenSchema,
      candidates: z.array(dispatchCandidateSchema).max(100),
      nextAfter: ticketSchema.transform(asTicketId).optional(),
      notificationCursor: countSchema,
    }),
  ])
  .transform((value): DispatchViewPage =>
    value.result === "Reset"
      ? value
      : {
          result: "Page",
          token: value.token,
          candidates: value.candidates,
          ...(value.nextAfter === undefined
            ? {}
            : { nextAfter: value.nextAfter }),
          notificationCursor: value.notificationCursor,
        },
  );

const operationBaseSchema = {
  operation: identitySchema.transform(asOperationId),
  acceptedAt: z.iso.datetime({ offset: true }).transform(asPublicInstant),
};

export const operationResponseSchema: z.ZodType<OperationResource> =
  z.discriminatedUnion("state", [
    z.strictObject({ ...operationBaseSchema, state: z.literal("Pending") }),
    z.strictObject({
      ...operationBaseSchema,
      state: z.literal("Succeeded"),
      decidedSequence: countSchema,
    }),
    z.strictObject({
      ...operationBaseSchema,
      state: z.literal("Refused"),
      code: z.enum([
        "NotEnabled",
        "AuthoringChanged",
        "ConfigurationInvalid",
        "TicketChanged",
        "SelectionChanged",
        "CommandUnreadable",
      ]),
      refusedHead: countSchema,
      refusedLifecycleGeneration: countSchema,
    }),
    z.strictObject({ ...operationBaseSchema, state: z.literal("Answered") }),
    z.strictObject({ ...operationBaseSchema, state: z.literal("Cancelled") }),
  ]);

export const proposalSubmissionResponseSchema = z.strictObject({
  operation: identitySchema.transform(asOperationId),
  state: z.enum(["Pending", "Succeeded", "Answered", "Refused", "Cancelled"]),
});

export const errorResponseSchema = z.strictObject({
  error: z.strictObject({ code: identitySchema, message: z.string() }),
});

export function encodeProjectInventoryResponse(value: unknown): unknown {
  return projectInventoryWireSchema.parse(value);
}

export function encodeNotificationsResponse(value: NotificationBatch): unknown {
  return notificationsResponseSchema.parse(value);
}

export function encodeDispatchViewResponse(value: DispatchViewPage): unknown {
  return dispatchViewResponseSchema.parse(value);
}

export function encodeOperationResponse(value: OperationResource): unknown {
  return operationResponseSchema.parse(value);
}

export function encodeProposalSubmissionResponse(value: unknown): unknown {
  return proposalSubmissionResponseSchema.parse(value);
}
