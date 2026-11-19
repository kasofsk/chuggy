/**
 * A project's connectors as the API reads, writes and removes them, and the
 * history of those changes.
 *
 * EVERY WRITE IS FENCED ON THE REVISION ITS WRITER READ. A create names none, a
 * replace or a removal the one it read, and any other is refused with the
 * revision that stands, so two administrators cannot overwrite each other
 * unseen.
 */

import { z } from "zod";

import {
  connectorChangesPageMax,
  connectorNameSchema,
  connectorVariants,
  connectorsProjectMax,
} from "./connectors.ts";
import { errorEnvelopeSchema, identitySchema, instantSchema } from "./http.ts";

/** A connector's revision, which a write against it names. */
export const connectorRevisionSchema = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER);

/** One write: the connector's kind and settings, and the revision it replaces where it replaces one. */
export const connectorWriteRequestSchema = connectorVariants({
  expectedRevision: connectorRevisionSchema.exactOptional(),
});
export type ConnectorWriteRequest = z.infer<typeof connectorWriteRequestSchema>;

/** One connector as it stands. */
export const connectorStandingSchema = connectorVariants({
  name: connectorNameSchema,
  revision: connectorRevisionSchema,
});
export type ConnectorStandingResponse = z.infer<typeof connectorStandingSchema>;

/** A project's connectors, ordered by name. */
export const connectorsResponseSchema = z.strictObject({
  connectors: z.array(connectorStandingSchema).max(connectorsProjectMax),
});
export type ConnectorsResponse = z.infer<typeof connectorsResponseSchema>;

/** Answered where a write's or a removal's revision is not the one standing. */
export const connectorStaleCode = "ConnectorStale";

/** Answered where a create would hold the project past `connectorsProjectMax`. */
export const connectorLimitReachedCode = "ConnectorLimitReached";

/** Answered where a removal names a connector the project does not hold. */
export const connectorNotFoundCode = "ConnectorNotFound";

/** A stale write or removal: the revision that stands, absent where none does. */
export const connectorStaleResponseSchema = errorEnvelopeSchema.extend({
  standing: connectorRevisionSchema.exactOptional(),
});
export type ConnectorStaleResponse = z.infer<
  typeof connectorStaleResponseSchema
>;

const connectorChangeShape = {
  change: connectorRevisionSchema,
  changedAt: instantSchema,
  /** Whose authority made the change. */
  author: z.strictObject({ kind: identitySchema, subject: identitySchema }),
  name: connectorNameSchema,
};

/** One change: the connector after it, or its name alone where it removed it. */
export const connectorChangeSchema = z.union([
  connectorVariants({
    ...connectorChangeShape,
    action: z.enum(["Created", "Changed"]),
  }),
  z.strictObject({ ...connectorChangeShape, action: z.literal("Removed") }),
]);
export type ConnectorChangeResponse = z.infer<typeof connectorChangeSchema>;

/** One page of a project's changes, newest first, and the cursor of the next where there may be one. */
export const connectorHistoryResponseSchema = z.strictObject({
  changes: z.array(connectorChangeSchema).max(connectorChangesPageMax),
  next: connectorRevisionSchema.exactOptional(),
});
export type ConnectorHistoryResponse = z.infer<
  typeof connectorHistoryResponseSchema
>;
