/**
 * The wake a thread's own attempt on its member's chat host offers its thread:
 * admitted on the checks the wake pass makes of a candidate, put through the
 * same door under a turn derived from the session and the attempt's event, and
 * carrying a document that names the reason and the job, watch or timer and
 * nothing else.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { threadBacklogMax } from "../../src/contract/http.ts";
import type {
  PlacementRoute,
  SessionRunnerStanding,
} from "../../src/contract/rosters.ts";
import {
  asSessionBearerSecret,
  asSessionId,
  type SessionId,
  type SessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  ProjectAccessUnavailable,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  allThreadJobWakeReasons,
  parseThreadWake,
} from "../../src/interpreter/thread.ts";
import {
  threadJobWake,
  threadJobWakeTurn,
  threadJobWakeTurnPrefix,
  threadWakeTurn,
  type ThreadJobWakeOffer,
  type ThreadJobWakeStore,
  type ThreadJobWakeUnbound,
  type ThreadJobWakeView,
  type ThreadWakeOffered,
} from "../../src/interpreter/threadWake.ts";
import { projectAccessSiteRefused } from "./projectAccessFixture.ts";

const partition = { tenant: "acme", project: "atlas" } as unknown as Partition;
const principal = asPrincipal("oidc:ada");
const session = asSessionId("session-ada");
const instant = "2026-11-14T12:00:00.000Z";
const bearer = {
  secret: asSessionBearerSecret(`chgs_${"a".repeat(43)}`),
  generation: 1,
};

function viewOf(
  route: PlacementRoute = "Pool",
  runner: SessionRunnerStanding = "Live",
): ThreadJobWakeView {
  return { partition, principal, session, route, runner };
}

/** What one door call was offered, so a case can read the turn and its input back. */
interface JobWakeOffer {
  readonly turn: SessionTurnId;
  readonly input: string;
  readonly route: PlacementRoute;
}

/** A mailbox behind a bearer, idempotent on the turn as `wake_member_thread` is. */
function jobWakeStore(
  options: {
    readonly view?: ThreadJobWakeView | ThreadJobWakeUnbound;
    readonly door?: ThreadJobWakeUnbound | "Closed";
  } = {},
): ThreadJobWakeStore & { readonly offers: readonly JobWakeOffer[] } {
  const offers: JobWakeOffer[] = [];
  const mailbox: SessionTurnId[] = [];
  return {
    offers,
    wakeView: () => Promise.resolve(options.view ?? viewOf()),
    wakeThread: (input) => {
      offers.push({ turn: input.turn, input: input.input, route: input.route });
      if (options.door === "Closed")
        return Promise.resolve({ woken: "Closed" } as ThreadWakeOffered);
      if (options.door !== undefined) return Promise.resolve(options.door);
      const already = mailbox.indexOf(input.turn);
      if (already >= 0)
        return Promise.resolve({
          woken: "AlreadyWoken",
          ordinal: already + 1,
        } as ThreadWakeOffered);
      if (mailbox.length >= threadBacklogMax)
        return Promise.resolve({ woken: "Backlogged" } as ThreadWakeOffered);
      mailbox.push(input.turn);
      return Promise.resolve({
        woken: "Woken",
        ordinal: mailbox.length,
      } as ThreadWakeOffered);
    },
  };
}

/** The authority, admitting the member to change the project and to hosted runs unless a case says otherwise. */
function access(
  options: {
    readonly reader?: boolean;
    readonly unhosted?: boolean;
    readonly undecided?: boolean;
  } = {},
): ProjectAccess {
  const answered = (refusing: boolean) =>
    options.undecided === true
      ? Promise.reject(new ProjectAccessUnavailable("no answer"))
      : Promise.resolve(refusing ? undefined : memberAuthority(principal));
  return {
    authorize: (_principal, _partition, kind) =>
      answered(kind !== "Read" && options.reader === true),
    authorizeTenant: () => answered(options.unhosted === true),
    authorizeSite: projectAccessSiteRefused,
  };
}

function serviceOf(store: ThreadJobWakeStore, authority = access()) {
  return { store, access: authority, clock: { nowIso: () => instant } };
}

const exited: ThreadJobWakeOffer = {
  wake: "JobExited",
  resource: "dispatcher",
  event: "dispatcher-exit-1",
};

test("every job host reason becomes a turn whose document names the reason and the resource alone", async () => {
  for (const wake of allThreadJobWakeReasons) {
    const store = jobWakeStore();
    const woken = await threadJobWake(serviceOf(store), bearer, {
      wake,
      resource: "dispatcher",
      event: `event-${wake}`,
    });
    assert.deepEqual(woken, { woken: "Woken", ordinal: 1 });
    const offer = store.offers[0];
    assert.ok(offer !== undefined);
    const document = parseThreadWake(offer.input);
    assert.equal(document.wake, wake);
    assert.equal(document.resource, "dispatcher");
    assert.equal(document.at, instant);
    assert.deepEqual(Object.keys(JSON.parse(offer.input) as object).sort(), [
      "at",
      "resource",
      "standing",
      "version",
      "wake",
    ]);
    assert.equal(offer.turn, threadJobWakeTurn(session, `event-${wake}`));
    assert.equal(offer.route, "Pool");
  }
});

test("the same event offered again is the same turn, and the mailbox answers it already woken", async () => {
  const store = jobWakeStore();
  const service = serviceOf(store);
  assert.deepEqual(await threadJobWake(service, bearer, exited), {
    woken: "Woken",
    ordinal: 1,
  });
  assert.deepEqual(await threadJobWake(service, bearer, exited), {
    woken: "AlreadyWoken",
    ordinal: 1,
  });
  assert.deepEqual(
    await threadJobWake(service, bearer, { ...exited, event: "other" }),
    { woken: "Woken", ordinal: 2 },
  );
});

test("a job wake's turn is derived from the session and the event together, and no ticket wake's can equal it", () => {
  const other: SessionId = asSessionId("session-grace");
  const turn = threadJobWakeTurn(session, "e");
  assert.equal(turn, threadJobWakeTurn(session, "e"));
  assert.notEqual(turn, threadJobWakeTurn(other, "e"));
  assert.notEqual(turn, threadJobWakeTurn(session, "f"));
  assert.notEqual(
    threadJobWakeTurn(asSessionId("a"), "b-c"),
    threadJobWakeTurn(asSessionId("a-b"), "c"),
  );
  assert.ok(turn.startsWith(`${threadJobWakeTurnPrefix}-`));
  const ticketTurn = threadWakeTurn({
    sequence: 1,
    partition,
    reason: "TicketRefused",
    resource: "1",
    principal,
    session,
    route: "Pool",
    runner: "Live",
  });
  assert.ok(!ticketTurn.startsWith(`${threadJobWakeTurnPrefix}-`));
  assert.throws(() => threadJobWakeTurn(session, ""), RangeError);
});

test("a bearer no live chat-host thread attempt holds reaches no door", async () => {
  for (const view of ["Fenced", "NotChatHostThread"] as const) {
    const store = jobWakeStore({ view });
    assert.deepEqual(await threadJobWake(serviceOf(store), bearer, exited), {
      refused: view,
    });
    assert.deepEqual(store.offers, []);
  }
});

test("a thread the pass would skip is refused not admitted, and reaches no door", async () => {
  const cases = [
    {
      name: "a member who may only read",
      store: {},
      authority: { reader: true },
    },
    {
      name: "a pool route where the member has no chat host",
      store: { view: viewOf("Pool", "Unregistered") },
      authority: {},
    },
    {
      name: "a hosted route without the hosted grant",
      store: { view: viewOf("InCluster", "Live") },
      authority: { unhosted: true },
    },
  ];
  for (const { name, store: options, authority } of cases) {
    const store = jobWakeStore(options);
    assert.deepEqual(
      await threadJobWake(serviceOf(store, access(authority)), bearer, exited),
      { refused: "NotAdmitted" },
      name,
    );
    assert.deepEqual(store.offers, [], name);
  }
});

test("an authority that could not answer is the one refusal worth offering again", async () => {
  const store = jobWakeStore();
  assert.deepEqual(
    await threadJobWake(
      serviceOf(store, access({ undecided: true })),
      bearer,
      exited,
    ),
    { refused: "AccessUnavailable" },
  );
  assert.deepEqual(store.offers, []);
});

test("the door's own answers are the wake's, an attempt fenced since its view included", async () => {
  for (const door of ["Fenced", "NotChatHostThread"] as const)
    assert.deepEqual(
      await threadJobWake(serviceOf(jobWakeStore({ door })), bearer, exited),
      { refused: door },
    );
  assert.deepEqual(
    await threadJobWake(
      serviceOf(jobWakeStore({ door: "Closed" })),
      bearer,
      exited,
    ),
    { woken: "Closed" },
  );
});

test("the project's standing rules ride on the document as on a ticket wake's", async () => {
  const store = jobWakeStore({
    view: { ...viewOf(), standingRules: "Ask before you dispatch." },
  });
  await threadJobWake(serviceOf(store), bearer, exited);
  const offer = store.offers[0];
  assert.ok(offer !== undefined);
  assert.match(
    parseThreadWake(offer.input).standing,
    /Ask before you dispatch\./,
  );
});
