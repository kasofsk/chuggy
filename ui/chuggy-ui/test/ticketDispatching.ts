/**
 * What a creation that goes on to dispatch is answered by: a draft created,
 * then a release, a dispatch view and a dispatch that each answer what the
 * case says. Left unsaid, the release is carried out, the view lists the
 * ticket as a candidate and the dispatch is carried out.
 */

import type { Answer, Sent } from "./answeringApi.ts";
import { creationDraft, creationPartition } from "./ticketCreationFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import {
  ticketDispatchViewOf,
  ticketPageCandidate,
} from "./ticketPageFixture.ts";

/** The ticket a creation makes, as the dispatch view lists a candidate. */
export const dispatchingCandidate = {
  ...ticketPageCandidate,
  ticket: creationDraft.ticket,
};

/** A dispatch view listing these candidates, the created ticket unless a case
 * says another. */
export function dispatchingView(
  candidates: readonly unknown[] = [dispatchingCandidate],
): Answer {
  return {
    status: 200,
    body: ticketDispatchViewOf(creationPartition, candidates),
  };
}

/** What the API answers a request with before deciding anything. */
export function dispatchingRefusal(status: number, code: string): Answer {
  return { status, body: { error: { code } } };
}

export interface TicketDispatching {
  /** What the actor decided of the release. */
  readonly released?: object;
  /** What the read of the dispatch view answers. */
  readonly view?: Answer;
  /** What the dispatch is answered with where the API does not accept it. */
  readonly declined?: Answer;
  /** What the actor decided of the dispatch. */
  readonly dispatched?: object;
}

/** A decision the actor refused, by the code it refused with. */
export function dispatchingRefused(code: string): object {
  return {
    state: "Refused",
    code,
    refusedHead: 42,
    refusedLifecycleGeneration: 1,
  };
}

interface Submission {
  readonly operation: string;
  readonly mutation: { readonly mutation: string };
}

/** The mutation a request submitted, and nothing for any other request. */
export function dispatchingMutation(one: Sent): string | undefined {
  return one.method === "POST" && one.path.endsWith("/operations")
    ? (one.body as Submission).mutation.mutation
    : undefined;
}

const dispatchingProject = {
  partition: creationPartition,
  sequence: 43,
  tickets: [
    {
      ticket: creationDraft.ticket,
      phase: "Pending",
      sequence: 42,
      ...ticketInstants,
    },
  ],
};

/**
 * The API over one creation. Each submission is accepted under the identity
 * it was sent with, and polled by it, so a case reads which of the two an
 * answer was to.
 */
export function ticketDispatching(
  said: TicketDispatching = {},
): (method: string, path: string, body: unknown) => Answer {
  const submitted = new Map<string, string>();
  const decided = (operation: string): object => {
    const carriedOut = { state: "Succeeded", decidedSequence: 43 };
    return submitted.get(operation) === "ManualDispatch"
      ? (said.dispatched ?? carriedOut)
      : (said.released ?? carriedOut);
  };
  return (method, path, body) => {
    if (method === "POST" && path.endsWith("/drafts"))
      return { status: 201, body: creationDraft };
    if (path.includes("/dispatch-view")) return said.view ?? dispatchingView();
    if (method === "POST" && path.endsWith("/operations")) {
      const { operation, mutation } = body as Submission;
      submitted.set(operation, mutation.mutation);
      return mutation.mutation === "ManualDispatch" &&
        said.declined !== undefined
        ? said.declined
        : { status: 202, body: { operation, state: "Pending" } };
    }
    if (!path.includes("/operations/"))
      return { status: 200, body: dispatchingProject };
    const operation = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
    return {
      status: 200,
      body: {
        operation,
        acceptedAt: "2026-08-26T00:00:00Z",
        ...decided(operation),
      },
    };
  };
}
