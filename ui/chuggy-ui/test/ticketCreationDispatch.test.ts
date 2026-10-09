/**
 * The dispatch a creation's submit goes on to, over an API that answers what
 * each case says of the release, the dispatch view and the dispatch.
 *
 * What is checked is when the dispatch is sent and what it names, that a
 * reader who may not dispatch asks for none of it, and that a submit whose
 * release made a ticket ends at that ticket whatever its dispatch met.
 */

import { expect, test } from "vitest";

import { nativeHttpBasePath } from "../../../src/contract/http.ts";
import { apiAttemptsMax } from "../app/core/apiRequest.ts";
import { operationAttemptsMax } from "../app/core/operationFollow.ts";
import { createAndReleaseTicket } from "../app/core/ticketCreationRun.ts";
import type {
  TicketCreationEnded,
  TicketCreationRequest,
} from "../app/core/ticketCreationRun.ts";
import { answeringApi } from "./answeringApi.ts";
import type { Sent } from "./answeringApi.ts";
import {
  creationBody,
  creationDraft,
  creationPartition,
} from "./ticketCreationFixture.ts";
import {
  dispatchingCandidate,
  dispatchingMutation,
  dispatchingRefusal,
  dispatchingRefused,
  dispatchingView,
  ticketDispatching,
} from "./ticketDispatching.ts";
import type { TicketDispatching } from "./ticketDispatching.ts";

const partitionBase = `${nativeHttpBasePath}/tenants/acme/projects/atlas`;

/** A submit by a reader who may not dispatch, and the same by one who may. */
const releasing: TicketCreationRequest = {
  body: creationBody,
  operation: "op-1",
};
const dispatching: TicketCreationRequest = {
  ...releasing,
  dispatchOperation: "op-2",
};

/** One request as a case compares it: its route, and for a submission the
 * identity it went under and the mutation it asked for. */
function line(one: Sent): string {
  const said = `${one.method} ${one.path.slice(partitionBase.length)}`;
  const mutation = dispatchingMutation(one);
  if (mutation === undefined) return said;
  const { operation } = one.body as { readonly operation: string };
  return `${said} ${operation} ${mutation}`;
}

interface Submitted {
  readonly ended: TicketCreationEnded;
  readonly sent: readonly Sent[];
  /** The traffic, a run of the same request being one line: a poll repeats
   * until it is answered. */
  readonly lines: readonly string[];
}

async function submitted(
  said: TicketDispatching,
  request = dispatching,
): Promise<Submitted> {
  const api = answeringApi(ticketDispatching(said));
  const ended = await createAndReleaseTicket(
    api.ports,
    creationPartition,
    request,
    () => undefined,
  );
  return {
    ended,
    sent: api.sent,
    lines: api.sent.map(line).filter((said, at, all) => said !== all[at - 1]),
  };
}

const created: TicketCreationEnded = {
  created: "Created",
  ticket: creationDraft.ticket,
};

/** What a release alone sends, which is all a submit that dispatches nothing
 * and reads no dispatch view does. */
const releaseLines = [
  "POST /drafts",
  "POST /operations op-1 ReleaseDraft",
  "GET /operations/op-1",
  "GET ?after=11&limit=1&minimumSequence=43",
];

const viewLine = "GET /dispatch-view?after=11&limit=1";

function dispatches(sent: readonly Sent[]): readonly Sent[] {
  return sent.filter((one) => dispatchingMutation(one) === "ManualDispatch");
}

test("a creation dispatches its ticket once the release has settled, at the version the view gives it", async () => {
  const { ended, sent, lines } = await submitted({});
  expect(ended).toStrictEqual(created);
  expect(lines).toStrictEqual([
    ...releaseLines,
    viewLine,
    "POST /operations op-2 ManualDispatch",
    "GET /operations/op-2",
    "GET ?after=11&limit=1&minimumSequence=43",
  ]);
  expect(dispatches(sent).map((one) => one.body)).toStrictEqual([
    {
      operation: "op-2",
      mutation: {
        mutation: "ManualDispatch",
        ticket: creationDraft.ticket,
        expectedTicketVersion: dispatchingCandidate.ticketVersion,
      },
    },
  ]);
});

test("a reader who may not dispatch reads no dispatch view and submits none", async () => {
  const { ended, lines } = await submitted({}, releasing);
  expect(ended).toStrictEqual(created);
  expect(lines).toStrictEqual(releaseLines);
});

test.each([
  ["the actor refused", dispatchingRefused("ConfigurationInvalid")],
  ["nobody saw settle", { state: "Pending" }],
])(
  "a release that %s made no ticket, and nothing is dispatched",
  async (_ending, released) => {
    const { ended, lines } = await submitted({ released });
    expect(ended.created).toBe("Refused");
    expect(lines).toStrictEqual(releaseLines.slice(0, 3));
  },
);

/** The page read starts just before the ticket and holds one candidate, so
 * where the ticket is none it lists the next one, which is not dispatched in
 * its place. */
test.each([
  ["lists no candidate", dispatchingView([])],
  [
    "lists the next ticket in its place",
    dispatchingView([{ ...dispatchingCandidate, ticket: 13 }]),
  ],
  ["was reset", { status: 200, body: { result: "Reset" } }],
])(
  "a view that %s ends at the ticket, undispatched",
  async (_listing, view) => {
    const { ended, lines } = await submitted({ view });
    expect(ended).toStrictEqual(created);
    expect(lines).toStrictEqual([...releaseLines, viewLine]);
  },
);

test.each([
  ["is refused", dispatchingRefusal(403, "Forbidden")],
  ["is not there", dispatchingRefusal(404, "NotFound")],
  ["answers nothing a view is", { status: 200, body: {} }],
])(
  "a dispatch view that %s ends at the ticket, undispatched",
  async (_failure, view) => {
    const { ended, sent } = await submitted({ view });
    expect(ended).toStrictEqual(created);
    expect(dispatches(sent)).toStrictEqual([]);
  },
);

test.each([
  ["the API refuses", { declined: dispatchingRefusal(403, "Forbidden") }],
  [
    "the API does not admit",
    { declined: dispatchingRefusal(409, "MutationNotAdmitted") },
  ],
  [
    "the actor refuses as changed",
    { dispatched: dispatchingRefused("TicketChanged") },
  ],
  [
    "the actor refuses otherwise",
    { dispatched: dispatchingRefused("SelectionChanged") },
  ],
  ["the actor cancels", { dispatched: { state: "Cancelled" } }],
  ["nobody saw settle", { dispatched: { state: "Pending" } }],
])("a dispatch %s ends at the ticket, sent once", async (_ending, said) => {
  const { ended, sent } = await submitted(said);
  expect(ended).toStrictEqual(created);
  expect(dispatches(sent).length).toBe(1);
});

/**
 * A deferral is the API saying not now. The one request that met it, sent as
 * often as the request layer honours a retry, is the last the run makes: the
 * follow does not submit it again after the wait the API asked for, the
 * ticket's page being where a deferred dispatch is pressed again.
 */
test("a dispatch the API defers is not waited on, and ends at the ticket", async () => {
  const { ended, sent, lines } = await submitted({
    declined: dispatchingRefusal(429, "DispatchBacklog"),
  });
  expect(ended).toStrictEqual(created);
  expect(dispatches(sent).length).toBe(apiAttemptsMax);
  expect(lines.at(-1)).toBe("POST /operations op-2 ManualDispatch");
});

/**
 * The release and the dispatch are followed out of one attempts budget: an
 * attempt the release spent is not there for the dispatch to spend again.
 */
test.each([0, 1, operationAttemptsMax - 1])(
  "after a release that waited %i times, a dispatch is waited on for the rest of the one budget",
  async (waited) => {
    const answers = ticketDispatching({ dispatched: { state: "Pending" } });
    const polled = { release: 0 };
    const pending = {
      operation: "op-1",
      acceptedAt: "2026-08-26T00:00:00Z",
      state: "Pending",
    };
    const api = answeringApi((method, path, body) => {
      if (!path.endsWith("/operations/op-1"))
        return answers(method, path, body);
      polled.release += 1;
      return polled.release > waited
        ? answers(method, path, body)
        : { status: 200, body: pending };
    });
    const ended = await createAndReleaseTicket(
      api.ports,
      creationPartition,
      dispatching,
      () => undefined,
    );
    expect(ended).toStrictEqual(created);
    expect(
      api.sent.filter((one) => one.path.endsWith("/operations/op-2")).length,
    ).toBe(operationAttemptsMax - waited);
  },
);
