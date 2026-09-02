/**
 * The server-sent-events transport for the project stream: the frame encoding,
 * the socket a hub writes through, and the read that turns a change row into
 * the representation the changed kind's own GET route would have answered with.
 *
 * THE RESPONSE HEAD IS WRITTEN BY THE FIRST FRAME, not by the handler. Every
 * refusal a stream can be given — no bearer, no access, no capacity, or a read
 * that failed — is decided before the reply is hijacked, and a socket that is
 * handed over has frames waiting for it already; a refusal that had sent a 200
 * first would be a refusal a browser reads as a stream.
 *
 * A REPRESENTATION IS THE GET'S OWN BODY, taken from the same builder the route
 * takes it from rather than assembled again here, and a status that is not a
 * 200 is the tombstone: the resource the row named is no longer readable.
 */

import type { FastifyReply } from "fastify";

import { assertNever } from "../../domain/assertNever.ts";
import { asTicketId, type TicketId } from "../../domain/ids.ts";
import type { ProjectStreamEvent } from "../../contract/events.ts";
import { asConfigurationRevisionId } from "../../interpreter/authoring.ts";
import type { NativeWeb, Principal } from "../../interpreter/nativeWeb.ts";
import { asOperationId } from "../../interpreter/operationInbox.ts";
import type {
  ProjectResourceReader,
  ProjectStreamSink,
} from "../../interpreter/projectStream.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { asExecutionId } from "../../interpreter/schedulerIdentity.ts";
import {
  configurationResponse,
  draftResponse,
  executionResponse,
  operationResponse,
  projectEntryResponse,
  ticketNativeActionsResponse,
  ticketResponse,
  type NativeHttpResponse,
} from "./outcomes.ts";

export const projectStreamMediaType = "text/event-stream";

/** What a change row's identity means to the kind that named it. */
export type StreamedNativeWeb = Pick<
  NativeWeb,
  | "configuration"
  | "draft"
  | "execution"
  | "operation"
  | "project"
  | "ticket"
  | "ticketNativeActions"
>;

const projectEntryLimit = 1;

function ticketOf(resource: string): TicketId {
  if (!/^[1-9][0-9]*$/u.test(resource))
    throw new RangeError("a change row names an unreadable ticket");
  return asTicketId(Number(resource));
}

function representationOf(
  found: NativeHttpResponse,
): Readonly<Record<string, unknown>> | null {
  return found.status === 200
    ? (found.body as Readonly<Record<string, unknown>>)
    : null;
}

/** The three kinds a change row names by ticket number, each its own resource. */
async function ticketKeyedRead(
  web: StreamedNativeWeb,
  kind: "Ticket" | "Draft" | "NativeAction",
  principal: Principal,
  partition: Partition,
  ticket: TicketId,
): Promise<NativeHttpResponse> {
  switch (kind) {
    case "Ticket":
      return ticketResponse(await web.ticket(principal, partition, ticket));
    case "Draft":
      return draftResponse(await web.draft(principal, partition, ticket));
    case "NativeAction":
      return ticketNativeActionsResponse(
        await web.ticketNativeActions(principal, partition, ticket),
      );
  }
}

/**
 * Every kind's read, through the builder its own route answers with. The two
 * kinds no route answers yet are read as tombstones: a frame carrying none of
 * the resource is what the contract already means by a cache entry to drop, and
 * a read that raised would reset every open stream on the project instead.
 */
export function projectResourceReader(
  web: StreamedNativeWeb,
): ProjectResourceReader {
  return {
    read: async (principal, partition, kind, resource) => {
      switch (kind) {
        case "Ticket":
        case "Draft":
        case "NativeAction":
          return representationOf(
            await ticketKeyedRead(
              web,
              kind,
              principal,
              partition,
              ticketOf(resource),
            ),
          );
        case "Operation":
          return representationOf(
            operationResponse(
              await web.operation(
                principal,
                partition,
                asOperationId(resource),
              ),
            ),
          );
        case "Execution":
          return representationOf(
            executionResponse(
              await web.execution(
                principal,
                partition,
                asExecutionId(resource),
              ),
            ),
          );
        case "Configuration":
          return representationOf(
            configurationResponse(
              await web.configuration(
                principal,
                partition,
                asConfigurationRevisionId(resource),
              ),
            ),
          );
        case "Project":
          return representationOf(
            projectEntryResponse(
              await web.project(principal, partition, {
                limit: projectEntryLimit,
              }),
            ),
          );
        case "AgenticRefusal":
        case "Session":
          return null;
        default:
          return assertNever(kind);
      }
    },
  };
}

function frameOf(event: ProjectStreamEvent): string {
  const identity =
    event.event === "ready" ||
    event.event === "reset" ||
    event.event === "source"
      ? ""
      : `id: ${String(event.sequence)}\n`;
  return `event: ${event.event}\n${identity}data: ${JSON.stringify(event.data)}\n\n`;
}

/** The head a stream answers with, and the one an intermediary must not buffer. */
export const projectStreamHeaders: Readonly<Record<string, string>> = {
  "content-type": projectStreamMediaType,
  "cache-control": "no-store",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

export function projectStreamSocket(reply: FastifyReply): ProjectStreamSink {
  const raw = reply.raw;
  let answered = false;
  let ended = false;
  const write = (text: string): boolean => {
    if (ended || raw.writableEnded) return true;
    if (!answered) {
      answered = true;
      raw.writeHead(200, projectStreamHeaders);
    }
    return raw.write(text);
  };
  return {
    send: (event) => write(frameOf(event)),
    beat: () => write(":\n\n"),
    whenDrained: (drained) => {
      raw.once("drain", drained);
    },
    end: () => {
      if (ended) return;
      ended = true;
      raw.end();
    },
  };
}
