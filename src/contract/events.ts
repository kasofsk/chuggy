/**
 * The versioned project event stream, as server-sent events.
 *
 * A change frame names its kind in `event:`, the change log's global sequence
 * in `id:`, and carries in `data:` the resource identity together with the
 * representation the kind's GET route would have answered with. A browser
 * writes that representation into its cache under that identity and does not
 * refetch on a live event; a null representation is a tombstone, meaning the
 * resource is no longer readable and the cache entry is dropped. `ready` opens
 * the stream, `reset` says the requested `Last-Event-ID` is no longer retained
 * and the client must reload from the GET routes, and `source` reports whether
 * the change log behind the stream is live or degraded.
 */

import { z } from "zod";

import { countSchema, identitySchema } from "./http.ts";

export const projectStreamVersion = 1;

export const projectChangeKinds = [
  "Operation",
  "Ticket",
  "Draft",
  "Configuration",
  "Project",
  "Execution",
] as const;
export type ProjectChangeKind = (typeof projectChangeKinds)[number];

export const projectStreamControlEvents = ["ready", "reset", "source"] as const;
export type ProjectStreamControlEvent =
  (typeof projectStreamControlEvents)[number];

export const projectSourceStates = ["live", "degraded"] as const;
export type ProjectSourceState = (typeof projectSourceStates)[number];

const versionSchema = z.literal(projectStreamVersion);

/** The identity the changed kind's GET route takes, as its own path segment. */
export const projectChangeDataSchema = z.strictObject({
  version: versionSchema,
  resource: identitySchema,
  representation: z.record(z.string(), z.unknown()).nullable(),
});
export type ProjectChangeData = z.infer<typeof projectChangeDataSchema>;

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

export type ProjectStreamEvent =
  | {
      readonly event: ProjectChangeKind;
      readonly sequence: number;
      readonly data: ProjectChangeData;
    }
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

function projectChangeEvent(
  kind: ProjectChangeKind,
  frame: ProjectStreamFrame,
): ProjectStreamEvent {
  if (frame.id === undefined)
    throw new RangeError("a project change frame carries no sequence");
  return {
    event: kind,
    sequence: sequenceSchema.parse(frame.id),
    data: projectChangeDataSchema.parse(frame.data),
  };
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
