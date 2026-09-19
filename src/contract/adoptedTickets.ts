import { z } from "zod";

export const adoptedTicketStateSchema = z.enum([
  "Pending",
  "Work",
  "Evaluation",
  "Finalization",
  "Escalated",
  "Done",
  "Revoked",
]);

export const adoptedTicketSchema = z.strictObject({
  ticket: z.number().int().positive().safe(),
  revision: z.number().int().positive().safe(),
  workCyclesStarted: z.number().int().nonnegative().safe(),
  state: adoptedTicketStateSchema,
  dependencies: z.array(z.number().int().positive().safe()),
});

export const adoptedTicketsSchema = z.strictObject({
  tickets: z.array(adoptedTicketSchema),
});

export const adoptedTicketDefinitionSchema = adoptedTicketSchema.extend({
  source: z.string().nullable(),
});

/** A finding names where it is, so an editor can draw it on that line. */
export const adoptedTicketFindingSchema = z.strictObject({
  /** A JSON pointer into the document; empty names the document itself. */
  path: z.string(),
  message: z.string().min(1),
});

export const adoptedTicketValidationSchema = z.strictObject({
  valid: z.boolean(),
  findings: z.array(adoptedTicketFindingSchema),
  /** What the server resolved against, which a write sends back as its guard. */
  commit: z.string().min(1),
});

export const adoptedCatalogOriginSchema = z.enum(["Git", "Runtime"]);

export const adoptedCatalogEntrySchema = z.strictObject({
  path: z.string().min(1),
  origin: adoptedCatalogOriginSchema,
});

export const adoptedCatalogEntriesSchema = z.strictObject({
  entries: z.array(adoptedCatalogEntrySchema),
});

export const adoptedCatalogFileSchema = adoptedCatalogEntrySchema.extend({
  content: z.string(),
});

export const adoptedCatalogWriteSchema = z.strictObject({
  written: z.enum(["Written", "Removed", "NotHeld"]),
});

export const adoptedOperationAcceptanceSchema = z.strictObject({
  identity: z.string().min(1).max(256),
  accepted: z.enum(["Accepted", "AlreadyAccepted"]),
});

const adoptedTicketRefusalSchema = z
  .object({ type: z.string().min(1) })
  .passthrough();

export const adoptedTicketDecisionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("TicketRefused"),
    reason: adoptedTicketRefusalSchema,
  }),
  z
    .object({
      type: z.literal("TicketDecided"),
      event: z.unknown(),
      obligations: z.array(z.unknown()),
    })
    .passthrough(),
]);

export const adoptedOperationOutcomeSchema = z.strictObject({
  sequence: z.number().int().positive().safe(),
  decision: adoptedTicketDecisionSchema,
});

export type AdoptedTicket = z.infer<typeof adoptedTicketSchema>;
export type AdoptedTickets = z.infer<typeof adoptedTicketsSchema>;
export type AdoptedTicketDefinition = z.infer<
  typeof adoptedTicketDefinitionSchema
>;
export type AdoptedTicketFinding = z.infer<typeof adoptedTicketFindingSchema>;
export type AdoptedTicketValidation = z.infer<
  typeof adoptedTicketValidationSchema
>;
export type AdoptedCatalogEntry = z.infer<typeof adoptedCatalogEntrySchema>;
export type AdoptedCatalogEntries = z.infer<typeof adoptedCatalogEntriesSchema>;
export type AdoptedCatalogFile = z.infer<typeof adoptedCatalogFileSchema>;
export type AdoptedCatalogWrite = z.infer<typeof adoptedCatalogWriteSchema>;
export type AdoptedOperationAcceptance = z.infer<
  typeof adoptedOperationAcceptanceSchema
>;
export type AdoptedOperationOutcome = z.infer<
  typeof adoptedOperationOutcomeSchema
>;
export type AdoptedTicketDecision = z.infer<typeof adoptedTicketDecisionSchema>;
