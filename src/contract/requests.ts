/**
 * Every request body the public wire accepts, and the payloads its opaque
 * cursors carry.
 *
 * The schemas parse into plain wire values; turning one into an interpreter
 * type is the server's own step, and encoding a cursor payload into base64url
 * is too.
 */

import { z } from "zod";

import {
  countSchema,
  digestSchema,
  dispatchViewSchemaVersion,
  nativeHttpVersion,
  ticketNumberSchema,
} from "./http.ts";
import { authoringSchema } from "./authoring.ts";
import { nativeActionResolutions } from "./rosters.ts";

/** An identity a body may carry, bounded only by the body limit itself. */
const bodyIdentitySchema = z.string().min(1);

export const publicMutationSchema = z.discriminatedUnion("mutation", [
  z.strictObject({
    mutation: z.literal("RevokeTicket"),
    ticket: ticketNumberSchema,
  }),
  z.strictObject({
    mutation: z.literal("ResumeTicket"),
    ticket: ticketNumberSchema,
  }),
  z.strictObject({
    mutation: z.literal("ReleaseDraft"),
    ticket: ticketNumberSchema,
    authoringVersion: countSchema,
    configurationRevision: z.string(),
  }),
  z.strictObject({
    mutation: z.literal("ResolveNativeAction"),
    action: z.string(),
    authorizingSequence: countSchema,
    resolution: z.enum(nativeActionResolutions),
  }),
  z.strictObject({
    mutation: z.literal("ManualDispatch"),
    ticket: ticketNumberSchema,
    expectedTicketVersion: countSchema,
  }),
  z.strictObject({
    mutation: z.literal("ProposeDispatch"),
    ticket: ticketNumberSchema,
    expectedTicketVersion: countSchema,
    observedViewToken: z.strictObject({
      tenant: bodyIdentitySchema,
      project: bodyIdentitySchema,
      recoveryEpoch: bodyIdentitySchema,
      schemaVersion: z.literal(dispatchViewSchemaVersion),
      watermark: countSchema,
      digest: digestSchema,
    }),
    selectorDecisionReference: z.string(),
  }),
]);

export type PublicMutation = z.infer<typeof publicMutationSchema>;

export const configurationCreationSchema = z.strictObject({
  revision: bodyIdentitySchema,
  parent: bodyIdentitySchema.optional(),
  canonical: bodyIdentitySchema,
});

export const repositoryConfigurationImportSchema = z.strictObject({
  commit: bodyIdentitySchema,
});

export const draftCreationSchema = z.strictObject({
  configurationRevision: bodyIdentitySchema,
  configurationDigest: digestSchema,
  expectedProjectSequence: countSchema,
  authoring: authoringSchema,
});

export const draftRevisionSchema = z.strictObject({
  expectedVersion: countSchema,
  configurationRevision: bodyIdentitySchema,
  authoring: authoringSchema,
});

export const submissionSchema = z.strictObject({
  operation: bodyIdentitySchema,
  mutation: publicMutationSchema,
});

export const inventoryCursorSchema = z.strictObject({
  version: z.literal(nativeHttpVersion),
  tenant: z.string(),
  project: z.string(),
});

export const configurationCursorSchema = z.strictObject({
  version: z.literal(nativeHttpVersion),
  tenant: z.string(),
  project: z.string(),
  createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), {
    message: "Expected a timestamp",
  }),
  revision: z.string().min(1),
});

export const ticketActivityCursorSchema = z.strictObject({
  version: z.literal(nativeHttpVersion),
  tenant: z.string(),
  project: z.string(),
  sequence: countSchema,
  ticket: ticketNumberSchema,
});
