/**
 * The schema each change kind's representation is read by.
 *
 * A change frame carries what the kind's GET route would have answered with,
 * so the schema is that route's and not a second description of it. The record
 * is total over the kind roster, so a kind the contract gains is a compile
 * error here rather than a representation nothing reads.
 */

import { partitionSchema } from "../../../../src/contract/http.ts";
import type { ProjectChangeKind } from "../../../../src/contract/events.ts";
import {
  configurationResponseSchema,
  draftResponseSchema,
  executionResponseSchema,
  operationResponseSchema,
  ticketResponseSchema,
} from "../../../../src/contract/responses.ts";

export type ProjectRepresentationParser = (value: unknown) => unknown;

export const projectChangeRepresentationParsers: Readonly<
  Record<ProjectChangeKind, ProjectRepresentationParser>
> = {
  Ticket: (value) => ticketResponseSchema.parse(value),
  Execution: (value) => executionResponseSchema.parse(value),
  Operation: (value) => operationResponseSchema.parse(value),
  Draft: (value) => draftResponseSchema.parse(value),
  Configuration: (value) => configurationResponseSchema.parse(value),
  Project: (value) => partitionSchema.parse(value),
};
