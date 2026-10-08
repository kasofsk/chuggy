/**
 * The read of a ticket's landings over a doubled store and artifact port: what
 * each recorded request stands at, what of its conflict and its pull request
 * is answered, how many landings one read answers, and who is answered none.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  jsonTextBytes,
  ticketLandingConflictBytesMax,
  ticketLandingsAnsweredMax,
} from "../../src/contract/http.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  asFinalizationAttemptId,
  asGitObjectId,
  asGitRefName,
  type GitObjectId,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectArtifactId,
  conflictManifestText,
  type ProjectArtifactRead,
} from "../../src/interpreter/finalizerPreparation.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import {
  ticketLandingConflictBounded,
  ticketLandingReads,
  ticketLandingState,
  type TicketLandingRecord,
} from "../../src/interpreter/ticketLandings.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const ticket = asTicketId(7);
const reader = asPrincipal("issuer reader");

function commitOf(named: string): GitObjectId {
  return asGitObjectId(named.padEnd(40, "0"));
}

const prepared = {
  outcome: "Prepared" as const,
  targetRef: "refs/heads/main",
  targetCommit: commitOf("a"),
  candidateCommit: commitOf("b"),
  preparedAt: asPublicInstant("2026-10-07T12:00:00.000000Z"),
};

const conflicted = {
  outcome: "Failed" as const,
  failureKind: "MergeConflict" as const,
  targetRef: "refs/heads/main",
  targetCommit: commitOf("a"),
  preparedAt: asPublicInstant("2026-10-07T12:00:00.000000Z"),
};

const hold = {
  kind: "TargetUnreadable" as const,
  passes: 2,
  since: asPublicInstant("2026-10-07T11:00:00.000000Z"),
};

const proposal = { headRef: "refs/heads/chuggy/7", baseRef: "refs/heads/main" };

function recorded(
  fields: Partial<TicketLandingRecord> = {},
): TicketLandingRecord {
  return {
    cycle: 1,
    generation: 1,
    request: "Registered",
    attempts: 0,
    approvalOpen: false,
    ...fields,
  };
}

test("a live landing is awaiting its approval, else held at its recorded hold, else running", () => {
  for (const request of ["Open", "Registered"] as const) {
    assert.deepEqual(ticketLandingState(recorded({ request })), {
      state: "Running",
    });
    assert.deepEqual(ticketLandingState(recorded({ request, hold })), {
      state: "Held",
      hold,
    });
    assert.deepEqual(
      ticketLandingState(
        recorded({ request, hold, approvalOpen: true, attempt: prepared }),
      ),
      { state: "AwaitingApproval" },
      "an open approval is answered over a hold recorded beside it",
    );
  }
});

test("a concluded landing is what its event says, and answers no hold its columns still carry", () => {
  const fulfilled = (fields: Partial<TicketLandingRecord>) =>
    ticketLandingState(recorded({ request: "Fulfilled", hold, ...fields }));
  assert.deepEqual(fulfilled({ concluded: "NeedsWork" }), { state: "Failed" });
  assert.deepEqual(fulfilled({ concluded: "Unavailable" }), {
    state: "Unavailable",
  });
  assert.deepEqual(
    fulfilled({
      concluded: "Succeeded",
      landedCommit: commitOf("d"),
      proposal,
    }),
    { state: "Landed", landedCommit: commitOf("d") },
  );
  assert.deepEqual(fulfilled({ concluded: "Succeeded", proposal }), {
    state: "Proposed",
  });
  assert.deepEqual(
    ticketLandingState(recorded({ request: "Invalidated", hold })),
    { state: "Invalidated" },
  );
});

test("a concluded landing its rows cannot account for fails the read rather than answering a guess", () => {
  assert.throws(
    () => ticketLandingState(recorded({ request: "Fulfilled" })),
    (failure) => failure instanceof Error && !(failure instanceof RangeError),
  );
  assert.throws(
    () =>
      ticketLandingState(
        recorded({ request: "Fulfilled", concluded: "Succeeded", attempts: 1 }),
      ),
    (failure) => failure instanceof Error && !(failure instanceof RangeError),
  );
});

test("a conflict answers the paths that fit one landing's bound and says where it was cut", () => {
  const path = "src/".padEnd(100, "x");
  const fit = Math.floor(ticketLandingConflictBytesMax / jsonTextBytes(path));
  const many = Array.from({ length: fit + 1 }, () => path);
  assert.deepEqual(
    ticketLandingConflictBounded({ paths: many, truncated: false }),
    {
      paths: many.slice(0, fit),
      truncated: true,
    },
  );
  const few = many.slice(0, fit);
  for (const truncated of [false, true])
    assert.deepEqual(ticketLandingConflictBounded({ paths: few, truncated }), {
      paths: few,
      truncated,
    });
});

/** A manifest's stored bytes, naming the paths given. */
function manifestBytes(paths: readonly string[]): Uint8Array {
  return new TextEncoder().encode(
    conflictManifestText({
      request: "request",
      attempt: asFinalizationAttemptId("attempt"),
      strategy: "Merge",
      candidate: commitOf("b"),
      target: { ref: asGitRefName(prepared.targetRef), commit: commitOf("a") },
      conflict: { paths, truncated: false },
    }),
  );
}

/** The read over a store answering `records` and a port answering `artifact`, recording what each was asked. */
function readsOver(
  records: readonly TicketLandingRecord[] | undefined,
  artifact: ProjectArtifactRead = { read: "NotFound" },
  allowed = true,
) {
  const asked: string[] = [];
  const reads = ticketLandingReads({
    access: {
      authorize: (who) =>
        Promise.resolve(allowed ? memberAuthority(who) : undefined),
      authorizeTenant: () => Promise.resolve(undefined),
    },
    store: {
      landings: (_partition, named, count) => {
        asked.push(`landings ${String(named)} ${String(count)}`);
        return Promise.resolve(records);
      },
    },
    artifacts: {
      readArtifact: (request) => {
        asked.push(`artifact ${request.artifact}`);
        return Promise.resolve(artifact);
      },
    },
  });
  return { asked, read: () => reads.read(reader, partition, ticket) };
}

test("one read asks the store for one landing more than it answers, and answers the newest of them oldest first", async () => {
  const records = Array.from(
    { length: ticketLandingsAnsweredMax + 1 },
    (_, at) => recorded({ cycle: at + 1, request: "Invalidated" }),
  );
  const over = readsOver(records);
  const read = await over.read();
  assert.equal(read?.truncated, true);
  assert.deepEqual(
    read?.landings.map((landing) => landing.cycle),
    records.slice(1).map((record) => record.cycle),
  );
  assert.deepEqual(over.asked, [
    `landings 7 ${String(ticketLandingsAnsweredMax + 1)}`,
  ]);
  const whole = await readsOver(records.slice(1)).read();
  assert.equal(whole?.truncated, false);
  assert.equal(whole?.landings.length, ticketLandingsAnsweredMax);
  assert.deepEqual(await readsOver([]).read(), {
    landings: [],
    truncated: false,
  });
});

test("a store answering more than it was asked for fails the read", async () => {
  const records = Array.from({ length: ticketLandingsAnsweredMax + 2 }, () =>
    recorded({ request: "Invalidated" }),
  );
  await assert.rejects(readsOver(records).read(), (failure) => {
    assert.ok(failure instanceof Error && !(failure instanceof RangeError));
    return true;
  });
});

test("a caller who may not read the project, and a ticket the project does not have, are answered nothing", async () => {
  const refused = readsOver([recorded()], undefined, false);
  assert.equal(await refused.read(), undefined);
  assert.deepEqual(refused.asked, []);
  assert.equal(await readsOver(undefined).read(), undefined);
});

test("a conflict is read from the newest attempt's manifest, and one not found or out of reach leaves the rest answered", async () => {
  const record = recorded({
    request: "Fulfilled",
    concluded: "NeedsWork",
    attempts: 1,
    attempt: conflicted,
    conflictManifest: asProjectArtifactId("conflict-1"),
  });
  const content = readsOver([record], {
    read: "Content",
    content: manifestBytes(["one.txt", "two.txt"]),
  });
  assert.deepEqual(await content.read(), {
    landings: [
      {
        state: "Failed",
        cycle: 1,
        generation: 1,
        attempts: 1,
        attempt: conflicted,
        conflict: { paths: ["one.txt", "two.txt"], truncated: false },
      },
    ],
    truncated: false,
  });
  assert.deepEqual(content.asked, [
    `landings 7 ${String(ticketLandingsAnsweredMax + 1)}`,
    "artifact conflict-1",
  ]);
  for (const artifact of [
    { read: "NotFound" },
    { read: "Unavailable", retryAfterSeconds: 1 },
  ] as const)
    assert.deepEqual(await readsOver([record], artifact).read(), {
      landings: [
        {
          state: "Failed",
          cycle: 1,
          generation: 1,
          attempts: 1,
          attempt: conflicted,
        },
      ],
      truncated: false,
    });
  await assert.rejects(
    readsOver([record], {
      read: "Content",
      content: new TextEncoder().encode("not a manifest"),
    }).read(),
  );
});

test("a pull request's link is answered only where a report could carry it", async () => {
  const landed = (url?: string) =>
    recorded({
      request: "Fulfilled",
      concluded: "Succeeded",
      attempts: 1,
      attempt: prepared,
      landedCommit: commitOf("d"),
      proposal: { ...proposal, ...(url === undefined ? {} : { url }) },
    });
  const answered = async (url?: string) =>
    (await readsOver([landed(url)]).read())?.landings[0]?.proposal;
  assert.deepEqual(await answered("https://forge.example/acme/atlas/pull/9"), {
    ...proposal,
    url: "https://forge.example/acme/atlas/pull/9",
  });
  for (const url of [
    undefined,
    "http://forge.example/acme/atlas/pull/9",
    "https://",
    "not a url",
    "https://user:secret@forge.example/acme/atlas/pull/9",
  ])
    assert.deepEqual(await answered(url), proposal, url ?? "none");
});
