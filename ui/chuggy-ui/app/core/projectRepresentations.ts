/**
 * The schema each written change kind's representation is read by.
 *
 * A change frame carries what the kind's GET route would have answered with,
 * so the schema is that route's and not a second description of it. `Project`
 * is absent because its frame carries the inventory entry rather than a project
 * body, and `projectCacheCommands` invalidates on it instead of writing; the
 * record is total over what is left, so a kind the contract gains is a compile
 * error here rather than a representation nothing reads.
 */

import type { ProjectChangeKind } from "../../../../src/contract/events.ts";
import {
  configurationResponseSchema,
  draftResponseSchema,
  executionResponseSchema,
  operationResponseSchema,
  ticketResponseSchema,
} from "../../../../src/contract/responses.ts";

export type ProjectWrittenKind = Exclude<ProjectChangeKind, "Project">;

export type ProjectRepresentationParser = (value: unknown) => unknown;

export const projectChangeRepresentationParsers: Readonly<
  Record<ProjectWrittenKind, ProjectRepresentationParser>
> = {
  Ticket: (value) => ticketResponseSchema.parse(value),
  Execution: (value) => executionResponseSchema.parse(value),
  Operation: (value) => operationResponseSchema.parse(value),
  Draft: (value) => draftResponseSchema.parse(value),
  Configuration: (value) => configurationResponseSchema.parse(value),
};
