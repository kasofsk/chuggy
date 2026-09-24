/**
 * The two motions a creation screen makes, over an API that answers whatever
 * this suite decides it answers.
 *
 * What is checked is where each motion stops: the walk for a ready revision,
 * the conflict that sends a reader back to the form, and the settlements that
 * are and are not a ticket to navigate to — for a creation, and for an edit,
 * whose revision and update are two requests in that order.
 */

import { expect, test } from "vitest";

import { nativeHttpBasePath } from "../../../src/contract/http.ts";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import { configurationPagesMax } from "../app/core/apiRoutes.ts";
import {
  createAndReleaseTicket,
  creationContextSentence,
  readCreationContext,
  reviseAndUpdateTicket,
} from "../app/core/ticketCreationRun.ts";
import {
  creationDraft,
  creationInitialization,
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

test("the configuration is walked for, newest first, until one is ready", async () => {
  const held = answering((_method, path) => {
    if (path.includes("/configurations"))
      return ok(
        path.includes("cursor=next")
          ? configurationsPage
          : {
              configurations: [creationSummary("r4", "Incomplete")],
              nextCursor: "next",
            },
      );
    return path.endsWith("/repositories")
      ? ok({ repositories: [] })
      : ok(creationInitialization);
  });
  const read = await readCreationContext(held.ports, creationPartition);
  expect(read.outcome === "Ok" && read.value.context).toBe("Ready");
  expect(held.calls).toContain(`GET ${partitionBase}/draft-initializations/r3`);
  expect(held.calls.at(-1)).toBe(`GET ${partitionBase}/repositories`);
});

/** The bindings are read in the same motion, and whole: whether the form asks
 * for a repository and what landing it starts on are both theirs to say, and
 * neither is the initialization's. */
test("the context carries what the project binds", async () => {
  const held = answering((_method, path) => {
    if (path.includes("/configurations")) return ok(configurationsPage);
    return path.endsWith("/repositories")
      ? ok({
          repositories: [
            {
              repository: "https://forge.test/kasofsk/chuggy",
              boundAt: "2026-08-26T00:00:00Z",
              landing: { mode: "Push" },
            },
          ],
        })
      : ok(creationInitialization);
  });
  const read = await readCreationContext(held.ports, creationPartition);
  expect(
    read.outcome === "Ok" && read.value.context === "Ready"
      ? read.value.repositories
      : undefined,
  ).toStrictEqual([
    {
      repository: "https://forge.test/kasofsk/chuggy",
      boundAt: "2026-08-26T00:00:00Z",
      landing: { mode: "Push" },
    },
  ]);
});

test("a project whose revisions run out with none ready says exactly that", async () => {
  const held = answering(() =>
    ok({ configurations: [creationSummary("r4", "Incomplete")] }),
  );
  const read = await readCreationContext(held.ports, creationPartition);
  expect(read.outcome === "Ok" && read.value.context).toBe(
    "NoReadyConfiguration",
  );
  expect(held.calls.length).toBe(1);
});

test("a walk that runs out of budget knows nothing about the project", async () => {
  const held = answering(() =>
    ok({
      configurations: [creationSummary("r4", "Incomplete")],
      nextCursor: "next",
    }),
  );
  const read = await readCreationContext(held.ports, creationPartition);
  expect(read.outcome === "Ok" && read.value).toStrictEqual({
    context: "ReadyConfigurationUnknown",
    pagesRead: configurationPagesMax,
  });
  expect(held.calls.length).toBe(configurationPagesMax);
});

test("not knowing and there being none are not drawn as the same sentence", () => {
  const none = creationContextSentence({ context: "NoReadyConfiguration" });
  const unknown = creationContextSentence({
    context: "ReadyConfigurationUnknown",
    pagesRead: configurationPagesMax,
  });
  expect(none).not.toBe(unknown);
  expect(none).toContain("no ready configuration");
  expect(unknown).toContain(String(configurationPagesMax));
});

test("an initialization that cannot be read is the outcome, not a blank form", async () => {
  const held = answering((_method, path) =>
    path.includes("/configurations")
      ? ok(configurationsPage)
      : { status: 503, body: { error: { code: "Unavailable" } } },
  );
  const read = await readCreationContext(held.ports, creationPartition);
  expect(read.outcome).toBe("Retryable");
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

test("a release the actor refuses is drawn by its code, holding the draft", async () => {
  const held = answering(
    creationAnswers(() =>
      ok({
        operation: "op-1",
        acceptedAt: "2026-08-26T00:00:00Z",
        state: "Refused",
        code: "AuthoringChanged",
        refusedHead: 41,
        refusedLifecycleGeneration: 1,
      }),
    ),
  );
  const created = await createAndReleaseTicket(
    held.ports,
    creationPartition,
    releaseSubmission,
    () => undefined,
  );
  expect(created.created).toBe("Refused");
  expect(created.created === "Refused" && created.draft).toStrictEqual(
    creationDraft,
  );
  expect(created.created === "Refused" && created.reason).toContain(
    "authoring changed",
  );
});

test("a draft already created is released again rather than created twice", async () => {
  const held = answering(
    creationAnswers(() =>
      ok({
        operation: "op-2",
        acceptedAt: "2026-08-26T00:00:00Z",
        state: "Cancelled",
      }),
    ),
  );
  const created = await createAndReleaseTicket(
    held.ports,
    creationPartition,
    { ...releaseSubmission, draft: creationDraft },
    () => undefined,
  );
  expect(created.created).toBe("Refused");
  expect(held.calls.some((call) => call.endsWith("/drafts"))).toBe(false);
});

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
    draft: undefined,
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
    draft: revisedDraft,
  });
});
