/**
 * The two motions a creation screen makes, over an API that answers whatever
 * this suite decides it answers.
 *
 * What is checked is where each motion stops: the walk for what a ticket may
 * be drawn under, the conflict that sends a reader back to the form, and the
 * settlements that are and are not a ticket to navigate to — for a creation,
 * and for an edit, whose revision and update are two requests in that order.
 */

import { expect, test } from "vitest";

import { nativeHttpBasePath } from "../../../src/contract/http.ts";
import type { ProjectRepositoryListedResponse } from "../../../src/contract/responses.ts";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import { configurationPagesMax } from "../app/core/apiRoutes.ts";
import {
  createAndReleaseTicket,
  creationContextSentence,
  creationOffersMax,
  readCreationContext,
  reviseAndUpdateTicket,
} from "../app/core/ticketCreationRun.ts";
import {
  creationBinding,
  creationDeclared,
  creationDraft,
  creationInitialization,
  creationListed,
  creationPartition,
  creationSummary,
} from "./ticketCreationFixture.ts";
import { answeringApi } from "./answeringApi.ts";
import type { Answer, Sent } from "./answeringApi.ts";
import { ticketInstants } from "./ticketInstants.ts";

const partitionBase = `${nativeHttpBasePath}/tenants/acme/projects/atlas`;

function ok(body: unknown): Answer {
  return { status: 200, body };
}

/** The double's traffic as the request lines each case compares, and the
 * bodies beside them for the one that reads what was sent. */
function answering(answer: (method: string, path: string) => Answer): {
  readonly ports: ApiPorts;
  readonly calls: readonly string[];
  readonly sent: readonly Sent[];
} {
  const held = answeringApi(answer);
  return {
    ports: held.ports,
    sent: held.sent,
    get calls(): readonly string[] {
      return held.sent.map((one) => `${one.method} ${one.path}`);
    },
  };
}

const configurationsPage = {
  configurations: [creationSummary("r3", "Ready")],
};

const releaseSubmission = {
  body: {
    configurationRevision: "r3",
    configurationDigest: creationInitialization.fence.configurationDigest,
    expectedProjectSequence: 41,
    authoring: creationInitialization.defaults,
    brief: { intent: "ship it", links: [] },
  },
  operation: "op-1",
};

function creationAnswers(
  release: (path: string) => Answer,
): (method: string, path: string) => Answer {
  return (method, path) => {
    if (method === "POST" && path.endsWith("/drafts"))
      return { status: 201, body: creationDraft };
    if (method === "POST" && path.endsWith("/operations"))
      return { status: 202, body: { operation: "op-1", state: "Pending" } };
    return release(path);
  };
}

const chuggy = "https://forge.test/kasofsk/chuggy";
const scratch = "https://forge.test/gdoteof/scratch";

/** A binding whose repository declared names into the project. */
function imported(repository: string): ProjectRepositoryListedResponse {
  return creationListed(creationBinding(repository), "Imported");
}

/** A binding whose repository declares nothing, bound when the case says. */
function bootstrapped(
  repository: string,
  boundAt: string,
): ProjectRepositoryListedResponse {
  return {
    ...creationListed(creationBinding(repository), "Bootstrapped"),
    boundAt,
  };
}

function bindings(
  ...repositories: readonly ProjectRepositoryListedResponse[]
): Answer {
  return ok({ repositories });
}

/** The initialization of whichever revision the path names. */
function initialization(path: string): Answer {
  return ok({
    ...creationInitialization,
    configuration: {
      ...creationInitialization.configuration,
      revision: decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)),
    },
  });
}

/** A project answering one listing, page by page, and the bindings given. */
function project(
  pages: (path: string) => unknown,
  bound: Answer = bindings(),
): ReturnType<typeof answering> {
  return answering((_method, path) => {
    if (path.endsWith("/repositories")) return bound;
    if (path.includes("/configurations")) return ok(pages(path));
    return initialization(path);
  });
}

test("a project binding nothing is walked, newest first, until a revision is ready", async () => {
  const held = project((path) =>
    path.includes("cursor=next")
      ? configurationsPage
      : {
          configurations: [creationSummary("r4", "Incomplete")],
          nextCursor: "next",
        },
  );
  const read = await readCreationContext(held.ports, creationPartition);
  expect(
    read.outcome === "Ok" && read.value.context === "Ready"
      ? read.value.offers.map((offer) => offer.name)
      : undefined,
  ).toStrictEqual(["r3"]);
  expect(held.calls).toStrictEqual([
    `GET ${partitionBase}/repositories`,
    `GET ${partitionBase}/configurations`,
    `GET ${partitionBase}/configurations?cursor=next`,
    `GET ${partitionBase}/draft-initializations/r3`,
  ]);
});

/** The listing a repository declaring several answers with: the newest commit
 * by name descending, then the commit before it. */
const declaredPage = {
  configurations: [
    creationDeclared("n-sonnet", chuggy, "development-sonnet"),
    creationDeclared("n-development", chuggy, "development"),
    creationDeclared("o-opus", chuggy, "development-opus", "Ready", "0b5c1d0"),
    creationDeclared(
      "o-development",
      chuggy,
      "development",
      "Ready",
      "0b5c1d0",
    ),
  ],
  nextCursor: "next",
};

/**
 * The first ready row of this listing is the name sorting last, which is the
 * one a context holding a single configuration took for every ticket.
 */
test("a repository declaring several is read as each of them, with its own initialization", async () => {
  const held = project(() => declaredPage, bindings(imported(chuggy)));
  const read = await readCreationContext(held.ports, creationPartition);
  if (read.outcome !== "Ok" || read.value.context !== "Ready")
    throw new Error("the context was not ready");
  expect(
    read.value.offers.map((offer) => [
      offer.name,
      offer.initialization.configuration.revision,
    ]),
  ).toStrictEqual([
    ["development", "n-development"],
    ["development-sonnet", "n-sonnet"],
  ]);
  expect(read.value.partial).toBe(false);
  expect(held.calls).toStrictEqual([
    `GET ${partitionBase}/repositories`,
    `GET ${partitionBase}/configurations`,
    `GET ${partitionBase}/draft-initializations/n-development`,
    `GET ${partitionBase}/draft-initializations/n-sonnet`,
  ]);
});

/** The bindings are read in the same motion, and whole: whether the form asks
 * for a repository and what landing it starts on are both theirs to say, and
 * neither is the initialization's. */
test("the context carries what the project binds", async () => {
  const held = project(() => declaredPage, bindings(imported(chuggy)));
  const read = await readCreationContext(held.ports, creationPartition);
  expect(
    read.outcome === "Ok" && read.value.context === "Ready"
      ? read.value.repositories
      : undefined,
  ).toStrictEqual([imported(chuggy)]);
});

test("a project with a repository and no ready revision says exactly that", async () => {
  const held = project(
    () => ({ configurations: [creationSummary("r4", "Incomplete")] }),
    bindings(imported(chuggy)),
  );
  const read = await readCreationContext(held.ports, creationPartition);
  expect(read.outcome === "Ok" && read.value.context).toBe(
    "NoReadyConfiguration",
  );
});

test("a project that binds no repository says so rather than that nothing is ready", async () => {
  const held = project(() => ({
    configurations: [creationSummary("r4", "Incomplete")],
  }));
  const read = await readCreationContext(held.ports, creationPartition);
  expect(read.outcome === "Ok" && read.value.context).toBe("NoRepository");
});

test("a walk that runs out of budget knows nothing about the project", async () => {
  const held = project(() => ({
    configurations: [creationSummary("r4", "Incomplete")],
    nextCursor: "next",
  }));
  const read = await readCreationContext(held.ports, creationPartition);
  expect(read.outcome === "Ok" && read.value).toStrictEqual({
    context: "ReadyConfigurationUnknown",
    pagesRead: configurationPagesMax,
  });
  expect(
    held.calls.filter((call) => call.includes("/configurations")).length,
  ).toBe(configurationPagesMax);
});

function offeredOf(
  read: Awaited<ReturnType<typeof readCreationContext>>,
): unknown {
  return read.outcome === "Ok" && read.value.context === "Ready"
    ? [read.value.partial, read.value.offers.map((offer) => offer.name)]
    : read;
}

/**
 * A second bound repository that declares, whose rows the budget never
 * reached, may declare anything: the offers drawn from the first are handed
 * over with the walk's shortfall beside them.
 */
test("a declaring binding the budget never reached leaves the read short, and says so", async () => {
  const held = project(
    (path) =>
      path.includes("cursor=")
        ? { configurations: [], nextCursor: "next" }
        : declaredPage,
    bindings(imported(chuggy), imported(scratch)),
  );
  const read = await readCreationContext(held.ports, creationPartition);
  expect(offeredOf(read)).toStrictEqual([
    true,
    ["development", "development-sonnet"],
  ]);
  expect(
    held.calls.filter((call) => call.includes("/configurations")).length,
  ).toBe(configurationPagesMax);
});

const fabric = "https://forge.test/gdoteof/chuggy-fabric";

/**
 * One project's listing, whose first page is the declaring repository's two
 * newest imports, written when the case says, and whose bootstrap is its
 * oldest row, pages on. Nothing here reads past the first page, so the pages
 * after it are not written.
 */
function declaringProject(
  bound: readonly ProjectRepositoryListedResponse[],
  createdAt: string,
  bootstrap: Answer | undefined = undefined,
): ReturnType<typeof answering> {
  const page = {
    configurations: declaredPage.configurations.map((row) => ({
      ...row,
      createdAt,
    })),
    nextCursor: "next",
  };
  return answering((_method, path) => {
    if (path.endsWith("/repositories")) return bindings(...bound);
    if (path.includes("/configurations")) return ok(page);
    return path.endsWith("/bootstrap") && bootstrap !== undefined
      ? bootstrap
      : initialization(path);
  });
}

const firstPageAndOffers = [
  `GET ${partitionBase}/repositories`,
  `GET ${partitionBase}/configurations`,
  `GET ${partitionBase}/draft-initializations/bootstrap`,
  `GET ${partitionBase}/draft-initializations/n-development`,
  `GET ${partitionBase}/draft-initializations/n-sonnet`,
];

/**
 * One repository declaring, one bound declaring nothing long before any row
 * the first page holds, and three bound today. None that declares nothing is
 * waited on, so the walk is one page, and the bootstrap they share is read once.
 */
test("bindings that declare nothing, however old, cost the walk nothing and are offered the bootstrap", async () => {
  const today = "2026-10-07 08:00:00.5+00";
  const held = declaringProject(
    [
      imported(chuggy),
      bootstrapped(fabric, "2026-09-10 00:00:00+00"),
      bootstrapped(scratch, today),
      bootstrapped("https://forge.test/kasofsk/chuggy-common", today),
      bootstrapped("https://forge.test/kasofsk/chuggy-linux", today),
    ],
    "2026-10-07 09:00:00.123456+00",
  );
  const read = await readCreationContext(held.ports, creationPartition);
  expect(offeredOf(read)).toStrictEqual([
    false,
    ["bootstrap", "development", "development-sonnet"],
  ]);
  expect(held.calls).toStrictEqual(firstPageAndOffers);
});

/**
 * A project whose first repository was bound declaring nothing, so that its
 * bootstrap was authored then, and declares now; a second is bound declaring
 * nothing. The bootstrap is older than every row the walk reads, and is read
 * by the revision the second binding's answer names and not looked for.
 */
test("a bootstrap older than everything the walk reads is still what a later binding is offered", async () => {
  const held = declaringProject(
    [
      { ...imported(chuggy), boundAt: "2026-08-01 00:00:00+00" },
      bootstrapped(scratch, "2026-10-07 00:00:00+00"),
    ],
    "2026-09-10 00:00:00+00",
  );
  const read = await readCreationContext(held.ports, creationPartition);
  expect(offeredOf(read)).toStrictEqual([
    false,
    ["bootstrap", "development", "development-sonnet"],
  ]);
  expect(held.calls).toStrictEqual(firstPageAndOffers);
});

/** Every offer is a request, so a repository declaring more than one read
 * draws is offered the first of them by name and told that is not all. */
test("a read draws no more offers than its bound, and says so past it", async () => {
  const names = Array.from(
    { length: creationOffersMax + 1 },
    (_, index) => `name-${String(index).padStart(3, "0")}`,
  );
  const held = project(
    () => ({
      configurations: names
        .toReversed()
        .map((name) => creationDeclared(`n-${name}`, chuggy, name)),
    }),
    bindings(imported(chuggy)),
  );
  const read = await readCreationContext(held.ports, creationPartition);
  if (read.outcome !== "Ok" || read.value.context !== "Ready")
    throw new Error("the context was not ready");
  expect(read.value.offers.map((offer) => offer.name)).toStrictEqual(
    names.slice(0, creationOffersMax),
  );
  expect(read.value.partial).toBe(true);
  expect(
    held.calls.filter((call) => call.includes("/draft-initializations/"))
      .length,
  ).toBe(creationOffersMax);
});

test("not knowing, there being none and there being nowhere are drawn as three words", () => {
  const sentences = [
    creationContextSentence({ context: "NoRepository" }),
    creationContextSentence({ context: "NoReadyConfiguration" }),
    creationContextSentence({
      context: "ReadyConfigurationUnknown",
      pagesRead: configurationPagesMax,
    }),
  ];
  expect(new Set(sentences).size).toBe(3);
  expect(sentences[0]).toBe("No repository bound");
  expect(sentences[1]).toBe("No configuration");
  expect(sentences[2]).toContain(String(configurationPagesMax));
});

const refusal = (status: number, code: string): Answer => ({
  status,
  body: { error: { code } },
});

const unavailable = refusal(503, "Unavailable");

/** A form is as drawable under the offers that were read as under all of
 * them, so one that was not is left out and the shortfall said. */
test("an offer whose initialization cannot be read is left out, and the read says so", async () => {
  const held = answering((_method, path) => {
    if (path.endsWith("/repositories")) return bindings(imported(chuggy));
    if (path.includes("/configurations")) return ok(declaredPage);
    return path.endsWith("/n-sonnet") ? unavailable : initialization(path);
  });
  const read = await readCreationContext(held.ports, creationPartition);
  expect(offeredOf(read)).toStrictEqual([true, ["development"]]);
});

/** The listing of bindings said the project holds a bootstrap, so one that
 * cannot be read is an offer left out like any other, whatever the refusal. */
test.each([
  ["is unavailable", unavailable],
  ["is not found", refusal(404, "NotFound")],
])(
  "a bootstrap whose read %s is left out, and the read says so",
  async (_ending, answered) => {
    const held = declaringProject(
      [imported(chuggy), bootstrapped(scratch, "2026-10-07 00:00:00+00")],
      "2026-09-10 00:00:00+00",
      answered,
    );
    const read = await readCreationContext(held.ports, creationPartition);
    expect(offeredOf(read)).toStrictEqual([
      true,
      ["development", "development-sonnet"],
    ]);
  },
);

/** With nothing to draw a form under, why is the first offer's to say: the
 * offers are read in name order, and so is what went wrong with them. */
test("offers of which none can be read are the first one's failure, not a form with nothing to choose", async () => {
  const held = answering((_method, path) => {
    if (path.endsWith("/repositories")) return bindings(imported(chuggy));
    if (path.includes("/configurations")) return ok(declaredPage);
    return path.endsWith("/n-development")
      ? refusal(500, "InternalError")
      : refusal(404, "NotFound");
  });
  const read = await readCreationContext(held.ports, creationPartition);
  expect(read.outcome).toBe("Fault");
});

/** A project whose bindings went unread is not one that binds nothing: read
 * as that, it would be offered its first ready row, whatever declared it. */
test("bindings that cannot be read are the outcome, and nothing is offered without them", async () => {
  const held = answering((_method, path) =>
    path.endsWith("/repositories") ? unavailable : ok(declaredPage),
  );
  const read = await readCreationContext(held.ports, creationPartition);
  expect(read.outcome).toBe("Retryable");
  expect(
    held.calls.filter((call) => !call.endsWith("/repositories")),
  ).toStrictEqual([]);
});

test("an initialization that cannot be read is the outcome, not a blank form", async () => {
  const held = answering((_method, path) => {
    if (path.endsWith("/repositories")) return bindings();
    return path.includes("/configurations")
      ? ok(configurationsPage)
      : unavailable;
  });
  const read = await readCreationContext(held.ports, creationPartition);
  expect(read.outcome).toBe("Retryable");
  expect(held.calls).toContain(`GET ${partitionBase}/draft-initializations/r3`);
});

test("a fence the API refuses returns the reader to the form, unreleased", async () => {
  const held = answering(() => ({
    status: 409,
    body: { error: { code: "DraftInitializationStale" } },
  }));
  const created = await createAndReleaseTicket(
    held.ports,
    creationPartition,
    releaseSubmission,
    () => undefined,
  );
  expect(created.created).toBe("Stale");
  expect(held.calls).toStrictEqual([`POST ${partitionBase}/drafts`]);
});

test("a release that settles as succeeded is the one ticket to navigate to", async () => {
  const held = answering(
    creationAnswers((path) =>
      path.includes("/operations")
        ? ok({
            operation: "op-1",
            acceptedAt: "2026-08-26T00:00:00Z",
            state: "Succeeded",
            decidedSequence: 42,
          })
        : ok({
            partition: creationPartition,
            sequence: 42,
            tickets: [
              { ticket: 12, phase: "Pending", sequence: 42, ...ticketInstants },
            ],
          }),
    ),
  );
  const created = await createAndReleaseTicket(
    held.ports,
    creationPartition,
    releaseSubmission,
    () => undefined,
  );
  expect(created).toStrictEqual({ created: "Created", ticket: 12 });
});

/** What a draft left held is, and what the submit after it does, is
 * `ticketCreationHeld.test.ts`. */
test("a follow that never settles ends in a reason, not in a navigation", async () => {
  const held = answering(
    creationAnswers(() =>
      ok({
        operation: "op-1",
        acceptedAt: "2026-08-26T00:00:00Z",
        state: "Pending",
      }),
    ),
  );
  const steps: string[] = [];
  const created = await createAndReleaseTicket(
    held.ports,
    creationPartition,
    releaseSubmission,
    (step) => steps.push(step.step),
  );
  expect(created.created).toBe("Refused");
  expect(steps.at(-1)).toBe("Abandoned");
});

/** A Pending ticket at its second revision, and the revision its edit sends. */
const pendingTicket = {
  ticket: 12,
  phase: "Pending" as const,
  sequence: 42,
  ...ticketInstants,
  revision: 2,
};

const updateSubmission = {
  ticket: pendingTicket,
  body: {
    expectedVersion: 3,
    configurationRevision: "r3",
    authoring: creationInitialization.defaults,
    brief: { intent: "ship it again", links: [] },
  },
  operation: "op-3",
};

const revisedDraft = {
  ...creationDraft,
  state: "Released",
  authoringVersion: 4,
  releasedAuthoringVersion: 3,
};

/** The door answers the revision, the operation route takes the update, and
 * the poll answers whatever the case says the actor decided. */
function updateAnswers(
  decided: unknown,
): (method: string, path: string) => Answer {
  return (method, path) => {
    if (method === "PUT") return ok(revisedDraft);
    if (method === "POST")
      return { status: 202, body: { operation: "op-3", state: "Pending" } };
    return path.includes("/operations/")
      ? ok(decided)
      : ok({
          partition: creationPartition,
          sequence: 43,
          tickets: [{ ...pendingTicket, sequence: 43, revision: 3 }],
        });
  };
}

test("an edit revises the draft, then releases it against the revision read", async () => {
  const held = answering(
    updateAnswers({
      operation: "op-3",
      acceptedAt: "2026-08-26T00:00:00Z",
      state: "Succeeded",
      decidedSequence: 43,
    }),
  );
  const updated = await reviseAndUpdateTicket(
    held.ports,
    creationPartition,
    updateSubmission,
    () => undefined,
  );
  expect(updated).toStrictEqual({ created: "Created", ticket: 12 });
  expect(held.calls.slice(0, 2)).toStrictEqual([
    `PUT ${partitionBase}/drafts/12`,
    `POST ${partitionBase}/operations`,
  ]);
  expect(held.sent.slice(0, 2).map((one) => one.body)).toStrictEqual([
    updateSubmission.body,
    {
      operation: "op-3",
      mutation: {
        mutation: "UpdateTicket",
        ticket: 12,
        expectedRevision: 2,
        authoringVersion: 4,
        configurationRevision: "r3",
      },
    },
  ]);
});

test("a revision that moves the dependencies is refused at the door, and nothing is released", async () => {
  const held = answering(() => ({
    status: 409,
    body: {
      error: {
        code: "DependenciesLocked",
        message: "A released ticket's dependencies cannot change.",
      },
    },
  }));
  const updated = await reviseAndUpdateTicket(
    held.ports,
    creationPartition,
    updateSubmission,
    () => undefined,
  );
  expect(updated).toStrictEqual({
    created: "Refused",
    reason: "what this ticket depends on cannot change once it is released",
    held: undefined,
  });
  expect(held.calls).toStrictEqual([`PUT ${partitionBase}/drafts/12`]);
});

test("a draft revised under the form is the stale ending, not a refusal", async () => {
  const held = answering(() => ({
    status: 409,
    body: { error: { code: "DraftChanged" }, currentVersion: 4 },
  }));
  const updated = await reviseAndUpdateTicket(
    held.ports,
    creationPartition,
    updateSubmission,
    () => undefined,
  );
  expect(updated.created).toBe("Stale");
});

test("an update nobody saw settle says so, holding the revised draft", async () => {
  const held = answering(
    updateAnswers({
      operation: "op-3",
      acceptedAt: "2026-08-26T00:00:00Z",
      state: "Pending",
    }),
  );
  const updated = await reviseAndUpdateTicket(
    held.ports,
    creationPartition,
    updateSubmission,
    () => undefined,
  );
  expect(updated).toStrictEqual({
    created: "Refused",
    reason: "the operation is still pending after the attempt budget",
    held: { draft: revisedDraft },
  });
});

test("an update the machine refuses says which refusal, holding the revised draft", async () => {
  const held = answering(
    updateAnswers({
      operation: "op-3",
      acceptedAt: "2026-08-26T00:00:00Z",
      state: "Refused",
      code: "TicketRevisionStale",
      refusedHead: 43,
      refusedLifecycleGeneration: 1,
      refusal: {
        type: "TicketRevisionStale",
        value: { ticket: 12, expected: 2, current: 3 },
      },
    }),
  );
  const updated = await reviseAndUpdateTicket(
    held.ports,
    creationPartition,
    updateSubmission,
    () => undefined,
  );
  expect(updated).toStrictEqual({
    created: "Refused",
    reason:
      "this was written against revision 2 of #12, which is at revision 3 now",
    held: { draft: revisedDraft },
  });
});
