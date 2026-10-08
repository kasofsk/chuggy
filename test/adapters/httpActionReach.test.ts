/**
 * The action reach route over its real service and the real project access,
 * with the store and the ancestry port beneath them doubled: what a reader is
 * answered for each mark, what a ticket that landed nowhere answers, and who
 * is answered nothing.
 *
 * EVERY BODY IS READ THROUGH THE SCHEMA THE ENDPOINT PUBLISHES, since that
 * schema is what a console is typed from, and then held whole, so a field the
 * schema would let through and the route should not send fails a case.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { nativeHttpEndpoints } from "../../src/contract/endpoints.ts";
import { nativeHttpRoutes } from "../../src/contract/http.ts";
import type {
  ActionReachEarlierSuccess,
  ActionReachNewest,
  ActionReachObservation,
} from "../../src/interpreter/actionReach.ts";
import { actionReachAncestry } from "../../src/interpreter/actionReachAncestry.ts";
import type { CommitAncestry } from "../../src/interpreter/commitAncestry.ts";
import {
  asGitObjectId,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectAccessKind } from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import type {
  RepositoryActionId,
  RepositoryActionName,
} from "../../src/interpreter/repositoryAction.ts";
import {
  asTicketLandedStamp,
  ticketActionReaches,
  type ActionReachDeclared,
  type TicketLanded,
} from "../../src/interpreter/ticketActionReach.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import {
  ticketReadApp,
  ticketReadRefusesWhatTheTicketDoes,
} from "./ticketReadFixtures.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
const caller = asPrincipal("issuer geoff");
const url = "/api/v1/tenants/acme/projects/atlas/tickets/7/action-reach";
const authorized = { authorization: "Bearer valid" };
const repository = asRepositoryId("https://forge.example/acme/atlas.git");
const landedCommit = asGitObjectId("c".repeat(40));

const landedAt: TicketLanded = {
  landed: "At",
  repository: {
    partition,
    repository,
    recoveryEpoch: asRecoveryEpoch("epoch"),
  },
  retired: false,
  commit: landedCommit,
  since: asTicketLandedStamp("2026-10-05 22:00:00+00"),
};

/** One report, its commit named by a hex digit, saying no more than a report must. */
function reported(
  ordinal: number,
  outcome: ActionReachObservation["outcome"],
  digit: string,
): ActionReachObservation {
  return {
    ordinal,
    outcome,
    commit: asGitObjectId(digit.repeat(40)),
    receivedAt: asPublicInstant("2026-10-05T22:45:51.000000Z"),
  };
}

function declares(action: string, newest: ActionReachNewest) {
  return {
    action: action as RepositoryActionId,
    name: `Run ${action}` as RepositoryActionName,
    newest,
  };
}

/** What the store and the port beneath one app are, and what a case reads back of them. */
interface Beneath {
  readonly landed: TicketLanded | undefined;
  readonly declared?: readonly ActionReachDeclared[];
  readonly earlier?: readonly ActionReachEarlierSuccess[];
  /** What the port answers of a tip, by its digit; a tip it does not name is not an ancestor. */
  readonly answers?: Readonly<Record<string, CommitAncestry | Error>>;
  readonly read: string[];
}

/** The app with the reach route over its real service, the caller holding the kinds of access given. */
function appOver(access: readonly ProjectAccessKind[], beneath: Beneath) {
  const project = memoryProjectAccess();
  project.grant({ partition, principal: caller, access: new Set(access) });
  const reach = ticketActionReaches({
    access: project,
    store: {
      landed: (_partition, ticket) => {
        beneath.read.push(`landed ${String(ticket)}`);
        return Promise.resolve(beneath.landed);
      },
      declared: () => {
        beneath.read.push("declared");
        return Promise.resolve(beneath.declared ?? []);
      },
      earlier: () => {
        beneath.read.push("earlier");
        return Promise.resolve(beneath.earlier ?? []);
      },
    },
    ancestry: actionReachAncestry({
      port: {
        ancestry: (question) => {
          const answer = beneath.answers?.[question.tip.slice(0, 1)];
          beneath.read.push(`asked ${question.tip.slice(0, 1)}`);
          return answer instanceof Error
            ? Promise.reject(answer)
            : Promise.resolve(answer ?? "NotAncestor");
        },
      },
      monotonicNowMs: () => 0,
    }),
    pacing: { wait: () => new Promise(() => undefined) },
  });
  return ticketReadApp(caller, { actionReach: reach });
}

/** What a reader is answered by the route, held to be a success whose body the endpoint's own schema reads back whole. */
async function answered(app: ReturnType<typeof appOver>): Promise<unknown> {
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 200);
  const body: unknown = found.json();
  assert.deepEqual(
    nativeHttpEndpoints.ticketActionReach.response.parse(body),
    body,
  );
  return body;
}

const notFound = {
  error: { code: "NotFound", message: "Resource not found." },
};

test("the route is the one the route table names", () => {
  assert.equal(
    nativeHttpRoutes.ticketActionReach.replace(/:([a-z]+)/gu, (_whole, name) =>
      name === "tenant" ? "acme" : name === "project" ? "atlas" : "7",
    ),
    url,
  );
  assert.equal(nativeHttpEndpoints.ticketActionReach.method, "GET");
  assert.equal(
    nativeHttpEndpoints.ticketActionReach.path,
    nativeHttpRoutes.ticketActionReach,
  );
});

/** A report saying everything a report may. */
const full: ActionReachObservation = {
  ...reported(4, "Succeeded", "a"),
  observedAt: asPublicInstant("2026-10-05T22:45:50.250000Z"),
  detail: "run chuggy-release-x7k2p",
  link: "https://grafana.example.test/d/release?var-run=x7k2p",
};

/** One action for each mark a read of the newest reports alone comes to, in the order of their identities. */
const declaredEach = [
  declares("build", { success: full, report: full }),
  declares("deploy", {
    success: reported(1, "Succeeded", "b"),
    report: reported(2, "Failed", "d"),
  }),
  declares("idle", {}),
  declares("publish", {
    success: reported(3, "Succeeded", "e"),
    report: reported(3, "Succeeded", "e"),
  }),
  declares("rig", { report: reported(1, "Failed", "f") }),
];

/** What a reader is answered of `declaredEach` where `a` and `d` hold the commit and `e` could not be found out. */
const answeredEach = [
  {
    action: "build",
    name: "Run build",
    reach: "Reached",
    observation: {
      outcome: "Succeeded",
      commit: "a".repeat(40),
      observedAt: "2026-10-05T22:45:50.250000Z",
      receivedAt: "2026-10-05T22:45:51.000000Z",
      detail: "run chuggy-release-x7k2p",
      link: "https://grafana.example.test/d/release?var-run=x7k2p",
    },
  },
  {
    action: "deploy",
    name: "Run deploy",
    reach: "Failed",
    observation: {
      outcome: "Failed",
      commit: "d".repeat(40),
      receivedAt: "2026-10-05T22:45:51.000000Z",
    },
  },
  { action: "idle", name: "Run idle", reach: "NotYet", observation: null },
  {
    action: "publish",
    name: "Run publish",
    reach: "Unknown",
    observation: null,
  },
  { action: "rig", name: "Run rig", reach: "NotYet", observation: null },
];

test("a reader is answered the repository, the commit the ticket landed at and each action's mark, a mark read from a report showing it", async () => {
  const read: string[] = [];
  await using app = appOver(["Read"], {
    landed: landedAt,
    declared: declaredEach,
    answers: { a: "Ancestor", d: "Ancestor", e: "Unknown" },
    read,
  });
  assert.deepEqual(await answered(app), {
    repository,
    commit: landedCommit,
    actions: answeredEach,
  });
  assert.deepEqual(read.slice(0, 2), ["landed 7", "declared"]);
});

test("an action whose newest success does not hold the commit and an earlier one since does is rolled back, and shows the earlier one", async () => {
  const read: string[] = [];
  await using app = appOver(["Read"], {
    landed: landedAt,
    declared: [
      declares("build", {
        success: reported(5, "Succeeded", "b"),
        report: reported(5, "Succeeded", "b"),
      }),
    ],
    earlier: [
      { observation: reported(3, "Succeeded", "a"), sinceLanded: true },
    ],
    answers: { a: "Ancestor" },
    read,
  });
  assert.deepEqual(await answered(app), {
    repository,
    commit: landedCommit,
    actions: [
      {
        action: "build",
        name: "Run build",
        reach: "RolledBack",
        observation: {
          outcome: "Succeeded",
          commit: "a".repeat(40),
          receivedAt: "2026-10-05T22:45:51.000000Z",
        },
      },
    ],
  });
  assert.deepEqual(read, [
    "landed 7",
    "declared",
    "asked b",
    "earlier",
    "asked a",
  ]);
});

test("a ticket that landed nowhere answers no repository, no commit and no actions, and nothing is read of what its project declares", async () => {
  const read: string[] = [];
  await using app = appOver(["Read"], { landed: { landed: "Nowhere" }, read });
  assert.deepEqual(await answered(app), {
    repository: null,
    commit: null,
    actions: [],
  });
  assert.deepEqual(read, ["landed 7"]);
});

test("a ticket landed in a repository since retired answers where it landed and no actions", async () => {
  const read: string[] = [];
  await using app = appOver(["Read"], {
    landed: { ...landedAt, retired: true },
    declared: [declares("build", {})],
    read,
  });
  const found = await app.inject({ url, headers: authorized });
  assert.deepEqual(found.json(), {
    repository,
    commit: landedCommit,
    actions: [],
  });
  assert.deepEqual(read, ["landed 7"]);
});

test("a caller who may not read the project is not found, as one asking after a ticket it does not have is, and nothing is read for the first", async () => {
  for (const held of [
    [],
    ["Administer"],
    ["Mutate", "Execute"],
  ] as readonly ProjectAccessKind[][]) {
    const read: string[] = [];
    await using app = appOver(held, { landed: landedAt, read });
    const found = await app.inject({ url, headers: authorized });
    assert.equal(found.statusCode, 404, held.join());
    assert.deepEqual(found.json(), notFound);
    assert.deepEqual(read, [], held.join());
  }
  const read: string[] = [];
  await using app = appOver(["Read"], { landed: undefined, read });
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 404);
  assert.deepEqual(found.json(), notFound);
  assert.deepEqual(read, ["landed 7"]);
});

test("a caller who presents no bearer, or one that is not valid, is answered before anything is read", async () => {
  for (const headers of [{}, { authorization: "Bearer other" }]) {
    const read: string[] = [];
    await using app = appOver(["Read"], { landed: landedAt, read });
    const found = await app.inject({ url, headers });
    assert.equal(found.statusCode, 401);
    assert.deepEqual(read, []);
  }
});

test("a ticket named by something other than its number is refused as the ticket's own read refuses it", async () => {
  await ticketReadRefusesWhatTheTicketDoes(
    (read) => appOver(["Read"], { landed: landedAt, read }),
    "action-reach",
  );
});

test("a port that raises is a mark that could not be found out, and the read is still answered", async () => {
  const read: string[] = [];
  await using app = appOver(["Read"], {
    landed: landedAt,
    declared: [
      declares("build", {
        success: reported(1, "Succeeded", "a"),
        report: reported(1, "Succeeded", "a"),
      }),
    ],
    answers: { a: new Error("no credential") },
    read,
  });
  for (let again = 0; again < 3; again += 1) {
    const found = await app.inject({ url, headers: authorized });
    assert.equal(found.statusCode, 200);
    assert.deepEqual(found.json(), {
      repository,
      commit: landedCommit,
      actions: [
        {
          action: "build",
          name: "Run build",
          reach: "Unknown",
          observation: null,
        },
      ],
    });
  }
  assert.deepEqual(
    read.filter((each) => each.startsWith("asked")),
    ["asked a"],
    "the polls after the first put nothing to the port",
  );
});

test("the route takes no write", async () => {
  await using app = appOver(["Read", "Mutate", "Administer"], {
    landed: landedAt,
    read: [],
  });
  for (const method of ["POST", "PUT", "DELETE", "PATCH"] as const)
    assert.equal(
      (await app.inject({ method, url, headers: authorized })).statusCode,
      404,
      method,
    );
});
