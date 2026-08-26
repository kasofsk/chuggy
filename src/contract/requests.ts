/**
 * Every request body the public wire accepts.
 *
 * The schemas parse into plain wire values; turning one into an interpreter
 * type is the server's own step. A cursor is not here: it is opaque to every
 * reader but the server that issued it, so its payload is that server's shape
 * rather than the wire's, and `cursorSchema` is all the wire says about one.
 */

import { z } from "zod";

import {
  countSchema,
  digestSchema,
  dispatchViewSchemaVersion,
  ticketNumberSchema,
} from "./http.ts";
import { authoringSchema } from "./authoring.ts";
import { briefSchema } from "./brief.ts";
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
  brief: briefSchema,
});

export const draftRevisionSchema = z.strictObject({
  expectedVersion: countSchema,
  configurationRevision: bodyIdentitySchema,
  authoring: authoringSchema,
  brief: briefSchema,
});

export const submissionSchema = z.strictObject({
  operation: bodyIdentitySchema,
  mutation: publicMutationSchema,
});
