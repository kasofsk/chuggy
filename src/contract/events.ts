/**
 * The versioned project event stream, as server-sent events.
 *
 * A change frame names its kind in `event:`, the change log's global sequence
 * in `id:`, and carries in `data:` the resource identity together with the
 * representation the kind's GET route would have answered with — exactly that
 * body, parsed here by exactly that schema, which is what
 * `projectChangeRepresentationSchemas` pins kind by kind. A browser writes the
 * representation into its cache under that identity and does not refetch on a
 * live event; a null representation is a tombstone, meaning the resource is no
 * longer readable and the cache entry is dropped. `Project` is the one kind
 * that is not written: its representation is the inventory entry, which is less
 * than a project read returns, so a `Project` frame invalidates the project
 * head and the browser refetches it. `NativeAction` names a ticket as its
 * identity too, and carries what that ticket has open for a person to answer
 * rather than the ticket itself: an approval is opened and answered without the
 * ticket's own phase or sequence moving, so the two are separate resources
 * under one identity, and `AgenticRefusal` is the same arrangement for what the
 * lead declined to dispatch. `Session` names a session as its identity and
 * carries the lead read, so a page watching a lead sees a turn move without
 * polling for it. `ready` opens the stream, `reset` says the requested
 * `Last-Event-ID` is no longer retained and the client must reload from the GET
 * routes, and `source` reports whether the change log behind the stream is live
 * or degraded.
 */

import { z } from "zod";

import { changeResourceSchema, countSchema, partitionSchema } from "./http.ts";
import {
  configurationResponseSchema,
  draftResponseSchema,
  executionResponseSchema,
  leadResponseSchema,
  operationResponseSchema,
  ticketAgenticRefusalsResponseSchema,
  ticketNativeActionsResponseSchema,
  ticketResponseSchema,
} from "./responses.ts";

export const projectStreamVersion = 1;

export const projectChangeKinds = [
  "Operation",
  "Ticket",
  "Draft",
  "Configuration",
  "Project",
  "Execution",
  "NativeAction",
  "AgenticRefusal",
  "Session",
] as const;
export type ProjectChangeKind = (typeof projectChangeKinds)[number];

export const projectStreamControlEvents = ["ready", "reset", "source"] as const;
export type ProjectStreamControlEvent =
  (typeof projectStreamControlEvents)[number];

export const projectSourceStates = ["live", "degraded"] as const;
export type ProjectSourceState = (typeof projectSourceStates)[number];

const versionSchema = z.literal(projectStreamVersion);

/**
 * The body each kind's GET route answers with. `Project` is the entry
 * `GET /api/v1/projects` lists, which is the identity a project is addressed
 * by rather than the ticket page reading it returns.
 */
export const projectChangeRepresentationSchemas = {
  Operation: operationResponseSchema,
  Ticket: ticketResponseSchema,
  Draft: draftResponseSchema,
  Configuration: configurationResponseSchema,
  Project: partitionSchema,
  Execution: executionResponseSchema,
  NativeAction: ticketNativeActionsResponseSchema,
  AgenticRefusal: ticketAgenticRefusalsResponseSchema,
  Session: leadResponseSchema,
} as const satisfies Record<ProjectChangeKind, z.ZodType>;

export type ProjectChangeRepresentation<Kind extends ProjectChangeKind> =
  z.infer<(typeof projectChangeRepresentationSchemas)[Kind]>;

/** The identity the changed kind's GET route takes, as its own path segment. */
const changeDataSchema = <Representation extends z.ZodType>(
  representation: Representation,
) =>
  z.strictObject({
    version: versionSchema,
    resource: changeResourceSchema,
    representation: representation.nullable(),
  });

export const projectChangeDataSchemas = {
  Operation: changeDataSchema(projectChangeRepresentationSchemas.Operation),
  Ticket: changeDataSchema(projectChangeRepresentationSchemas.Ticket),
  Draft: changeDataSchema(projectChangeRepresentationSchemas.Draft),
  Configuration: changeDataSchema(
    projectChangeRepresentationSchemas.Configuration,
  ),
  Project: changeDataSchema(projectChangeRepresentationSchemas.Project),
  Execution: changeDataSchema(projectChangeRepresentationSchemas.Execution),
  NativeAction: changeDataSchema(
    projectChangeRepresentationSchemas.NativeAction,
  ),
  AgenticRefusal: changeDataSchema(
    projectChangeRepresentationSchemas.AgenticRefusal,
  ),
  Session: changeDataSchema(projectChangeRepresentationSchemas.Session),
} as const;

export type ProjectChangeData<Kind extends ProjectChangeKind> = z.infer<
  (typeof projectChangeDataSchemas)[Kind]
>;

export const projectReadyDataSchema = z.strictObject({
  version: versionSchema,
});
export type ProjectReadyData = z.infer<typeof projectReadyDataSchema>;

export const projectResetDataSchema = z.strictObject({
  version: versionSchema,
});
export type ProjectResetData = z.infer<typeof projectResetDataSchema>;

export const projectSourceDataSchema = z.strictObject({
  version: versionSchema,
  state: z.enum(projectSourceStates),
});
export type ProjectSourceData = z.infer<typeof projectSourceDataSchema>;

export type ProjectChangeEvent = {
  [Kind in ProjectChangeKind]: {
    readonly event: Kind;
    readonly sequence: number;
    readonly data: ProjectChangeData<Kind>;
  };
}[ProjectChangeKind];

export type ProjectStreamEvent =
  | ProjectChangeEvent
  | { readonly event: "ready"; readonly data: ProjectReadyData }
  | { readonly event: "reset"; readonly data: ProjectResetData }
  | { readonly event: "source"; readonly data: ProjectSourceData };

/** One frame as a transport hands it over, before its `data:` is understood. */
export interface ProjectStreamFrame {
  readonly event: string;
  readonly id?: string | undefined;
  readonly data: unknown;
}

const sequenceSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)$/u)
  .transform(Number)
  .pipe(countSchema);

/** Each arm parses with its own kind's schema, so the member is typed by it. */
function projectChangeEvent(
  kind: ProjectChangeKind,
  frame: ProjectStreamFrame,
): ProjectChangeEvent {
  if (frame.id === undefined)
    throw new RangeError("a project change frame carries no sequence");
  const sequence = sequenceSchema.parse(frame.id);
  const body: unknown = frame.data;
  const schemas = projectChangeDataSchemas;
  switch (kind) {
    case "Operation":
      return { event: kind, sequence, data: schemas.Operation.parse(body) };
    case "Ticket":
      return { event: kind, sequence, data: schemas.Ticket.parse(body) };
    case "Draft":
      return { event: kind, sequence, data: schemas.Draft.parse(body) };
    case "Configuration":
      return { event: kind, sequence, data: schemas.Configuration.parse(body) };
    case "Project":
      return { event: kind, sequence, data: schemas.Project.parse(body) };
    case "Execution":
      return { event: kind, sequence, data: schemas.Execution.parse(body) };
    case "NativeAction":
      return { event: kind, sequence, data: schemas.NativeAction.parse(body) };
    case "AgenticRefusal":
      return {
        event: kind,
        sequence,
        data: schemas.AgenticRefusal.parse(body),
      };
    case "Session":
      return { event: kind, sequence, data: schemas.Session.parse(body) };
  }
}

export function parseProjectStreamEvent(
  frame: ProjectStreamFrame,
): ProjectStreamEvent {
  switch (frame.event) {
    case "ready":
      return { event: "ready", data: projectReadyDataSchema.parse(frame.data) };
    case "reset":
      return { event: "reset", data: projectResetDataSchema.parse(frame.data) };
    case "source":
      return {
        event: "source",
        data: projectSourceDataSchema.parse(frame.data),
      };
    default: {
      const kind = projectChangeKinds.find((known) => known === frame.event);
      if (kind === undefined)
        throw new RangeError("a project stream frame names an unknown event");
      return projectChangeEvent(kind, frame);
    }
  }
}
