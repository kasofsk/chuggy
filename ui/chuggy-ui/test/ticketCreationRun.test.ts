/**
 * The two motions a creation screen makes, over an API that answers whatever
 * this suite decides it answers.
 *
 * What is checked is where each motion stops: the walk for a ready revision,
 * the conflict that sends a reader back to the form, and the settlements that
 * are and are not a ticket to navigate to.
 */

import { expect, test } from "vitest";

import { nativeHttpBasePath } from "../../../src/contract/http.ts";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import {
  configurationPagesMax,
  createAndReleaseTicket,
  creationContextSentence,
  readCreationContext,
} from "../app/core/ticketCreationRun.ts";
import {
  creationDraft,
  creationInitialization,
  creationPartition,
  creationSummary,
} from "./ticketCreationFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

const partitionBase = `${nativeHttpBasePath}/tenants/acme/projects/atlas`;

function ok(body: unknown): Answer {
  return { status: 200, body };
}

function answering(answer: (method: string, path: string) => Answer): {
  readonly ports: ApiPorts;
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    ports: {
      fetch: (path, init) => {
        calls.push(`${init.method} ${path}`);
        const answered = answer(init.method, path);
        return Promise.resolve({
          status: answered.status,
          headers: { get: () => null },
          text: () => Promise.resolve(JSON.stringify(answered.body)),
        } as unknown as Response);
      },
      bearer: () => Promise.resolve("token"),
      sleepMs: () => Promise.resolve(),
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
  const held = answering((_method, path) =>
    path.includes("/configurations")
      ? ok(
          path.includes("cursor=next")
            ? configurationsPage
            : {
                configurations: [creationSummary("r4", "Incomplete")],
                nextCursor: "next",
              },
        )
      : ok(creationInitialization),
  );
  const read = await readCreationContext(held.ports, creationPartition);
  expect(read.outcome === "Ok" && read.value.context).toBe("Ready");
  expect(held.calls.at(-1)).toBe(
    `GET ${partitionBase}/draft-initializations/r3`,
  );
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
