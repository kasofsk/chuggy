/**
 * The versioned project event stream, as server-sent events.
 *
 * A change frame names its kind in `event:`, the change log's global sequence in
 * `id:`, and carries in `data:` the resource identity together with the body the
 * kind's own GET route would have answered with. A consumer writes that body
 * into its cache under that identity and does not refetch; a null representation
 * is the tombstone, meaning the resource is no longer readable and the cache
 * entry is dropped.
 *
 * THE REPRESENTATION IS CARRIED, NOT RE-PARSED, and that is a departure from
 * the arrangement this stream had before the adopted machine replaced the
 * selector. Then, every streamed kind had a response schema the route's own
 * body was built through, so parsing a frame by that schema restated a
 * guarantee the route already met. Here the routes answer bodies they do not
 * parse themselves — the ticket read composes its object in the handler, and the
 * execution read sends the store's summary as it stands — so a schema applied
 * here would be a second, stricter account of a shape nothing else checks, and
 * the first body it disagreed with would fault a stream over a resource the GET
 * serves happily. What the contract pins is the envelope: the event names, the
 * version, the sequence, the resource, and which routes the kinds mean. The
 * representation is parsed where it is stored, by the schema the consumer
 * already reads that route's own response with.
 *
 * THE KINDS ARE THE ONES THIS INSTALLATION WRITES. `Ticket` and `Execution` are
 * the adopted machine's, `Session` is the lead's and the threads' liveness. The
 * log's roster is wider, because it is shared with the publication log and still
 * carries the kinds the selector, the drafts and the configuration revisions
 * wrote; none of those is written any more, and a row of one is not a frame.
 * `Project` is written — a provisioning appends one — and is not carried either:
 * no surviving route answers one project's inventory entry on its own, and a
 * stream is opened on a partition, so the only append a project gets is one made
 * before any stream could be watching for it.
 */

import { z } from "zod";

import { changeResourceSchema, countSchema } from "./http.ts";

export const projectStreamVersion = 1;

export const projectStreamMediaType = "text/event-stream";

/** The kinds a frame carries, which is narrower than the durable log's roster. */
export const projectStreamKinds = ["Ticket", "Execution", "Session"] as const;
export type ProjectStreamKind = (typeof projectStreamKinds)[number];

export const projectStreamControlEvents = ["ready", "reset", "source"] as const;
export type ProjectStreamControlEvent =
  (typeof projectStreamControlEvents)[number];

/** Whether the change log behind the stream is reachable, or only being polled. */
export const projectSourceStates = ["live", "degraded"] as const;
export type ProjectSourceState = (typeof projectSourceStates)[number];

const versionSchema = z.literal(projectStreamVersion);

/**
 * One kind's body as its route answered it, or null once the resource is no
 * longer readable. An object rather than an unconstrained value, because every
 * route this stream names answers a JSON object.
 */
const representationSchema = z
  .record(z.string(), z.unknown())
  .nullable() satisfies z.ZodType;

export const projectChangeDataSchema = z.strictObject({
  version: versionSchema,
  resource: changeResourceSchema,
  representation: representationSchema,
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

export type ProjectChangeEvent = {
  readonly event: ProjectStreamKind;
  readonly sequence: number;
  readonly data: ProjectChangeData;
};

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
      const kind = projectStreamKinds.find((known) => known === frame.event);
      if (kind === undefined)
        throw new RangeError("a project stream frame names an unknown event");
      if (frame.id === undefined)
        throw new RangeError("a project change frame carries no sequence");
      return {
        event: kind,
        sequence: sequenceSchema.parse(frame.id),
        data: projectChangeDataSchema.parse(frame.data),
      };
    }
  }
}

/** The header a consumer resumes with, and the head a stream is answered with. */
export const projectStreamCursorHeader = "last-event-id";

export const projectStreamHeaders: Readonly<Record<string, string>> = {
  "content-type": projectStreamMediaType,
  "cache-control": "no-store",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};
