/**
 * The server-sent-events transport for the project stream: the frame encoding,
 * the socket a hub writes through, and the read that turns a change row into the
 * representation the changed kind's own GET route would have answered with.
 *
 * THE RESPONSE HEAD IS WRITTEN BY THE FIRST FRAME, not by the handler. Every
 * refusal a stream can be given — no bearer, no access, no capacity, or a read
 * that failed — is decided before the reply is hijacked, and a socket that is
 * handed over has frames waiting for it already; a refusal that had sent a 200
 * first would be a refusal a browser reads as a stream.
 *
 * A REPRESENTATION IS THE GET'S OWN BODY, and the reads are handed in rather
 * than assembled here: `ProjectStreamReads` is answered by the same builders
 * the routes answer with, so a route whose body changes moves the stream with
 * it. A status that is not a 200 is the tombstone — the resource the row named
 * is no longer readable — which is the one rule this module keeps for itself,
 * so that every kind spells it the same way.
 *
 * A SESSION ROW NAMES ITS OWN KIND, and the three kinds are three routes: a
 * lead, a thread and an inquiry are separate resources that happen to share a
 * change kind, because the triggers that append them sit on the session tables
 * that all three use.
 */

import type { FastifyReply } from "fastify";

import {
  projectStreamHeaders,
  type ProjectStreamEvent,
} from "../../contract/events.ts";
import { sessionChangeResourceSchema } from "../../contract/sessionEvents.ts";
import { assertNever } from "../../domain/assertNever.ts";
import { asSessionId, type SessionId } from "../../interpreter/agentSession.ts";
import type { Principal } from "../../interpreter/nativeWeb.ts";
import type {
  ProjectResourceReader,
  ProjectStreamSink,
} from "../../interpreter/projectStream.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type { NativeHttpResponse } from "./outcomes.ts";

/** One read per route a change row can name, each answering that route's own body. */
export interface ProjectStreamReads {
  ticket(
    principal: Principal,
    partition: Partition,
    ticket: number,
  ): Promise<NativeHttpResponse>;
  execution(
    principal: Principal,
    partition: Partition,
    task: string,
  ): Promise<NativeHttpResponse>;
  lead(principal: Principal, partition: Partition): Promise<NativeHttpResponse>;
  thread(
    principal: Principal,
    partition: Partition,
    session: SessionId,
  ): Promise<NativeHttpResponse>;
  inquiry(
    principal: Principal,
    partition: Partition,
    session: SessionId,
  ): Promise<NativeHttpResponse>;
}

function representationOf(
  found: NativeHttpResponse,
): Readonly<Record<string, unknown>> | null {
  return found.status === 200
    ? (found.body as Readonly<Record<string, unknown>>)
    : null;
}

function ticketOf(resource: string): number {
  if (!/^[1-9][0-9]*$/u.test(resource))
    throw new RangeError("a change row names an unreadable ticket");
  return Number(resource);
}

/** Which session route the row means, which the resource itself says. */
function sessionRead(
  reads: ProjectStreamReads,
  principal: Principal,
  partition: Partition,
  resource: string,
): Promise<NativeHttpResponse> {
  const named = sessionChangeResourceSchema.parse(JSON.parse(resource));
  const session = asSessionId(named.session);
  switch (named.kind) {
    case "Lead":
      return reads.lead(principal, partition);
    case "Thread":
      return reads.thread(principal, partition, session);
    case "Inquiry":
      return reads.inquiry(principal, partition, session);
    default:
      throw new RangeError("a change row names an unknown session kind");
  }
}

export function projectResourceReader(
  reads: ProjectStreamReads,
): ProjectResourceReader {
  return {
    read: async (principal, partition, kind, resource) => {
      switch (kind) {
        case "Ticket":
          return representationOf(
            await reads.ticket(principal, partition, ticketOf(resource)),
          );
        case "Execution":
          return representationOf(
            await reads.execution(principal, partition, resource),
          );
        case "Session":
          return representationOf(
            await sessionRead(reads, principal, partition, resource),
          );
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
