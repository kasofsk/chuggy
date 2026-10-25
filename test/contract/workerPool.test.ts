/**
 * The worker-pool wire shapes, read as a third party's implementation would
 * read them: what is admitted, what is refused, and what carries no field it
 * was not given.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { sessionBearerPattern } from "../../src/contract/sessionPlane.ts";
import { workerImageFaults } from "../../src/contract/workerEnvironment.ts";
import {
  assignmentOutcomeSchema,
  workerPoolAssignmentSchema,
  workerPoolCapabilitiesMax,
  workerPoolIdentityCharsMax,
  workerPoolPollQuerySchema,
  workerPoolPollRoute,
  workerPoolReconciliationSchema,
  workerPoolRegistrationSchema,
  workerPoolSessionAssignmentSchema,
  workerPoolSettlementPath,
  workerPoolSettlementRoutes,
  workerImageCharsMax,
  workerPoolTokenCharsMax,
  workerRunnerCapabilitiesOf,
  workerRunnerCapabilitiesSchema,
  workerRunnerOf,
  workerRunnerReleaseSchema,
  workerRunnerReleaseUrlCharsMax,
} from "../../src/contract/workerPool.ts";
import { workerContractRelease } from "../../src/contract/workerContract.ts";
import {
  contractVersionAccepted,
  workerContractRunnerProjects,
  workerContractRunnerReleases,
} from "../../src/interpreter/workerPlane.ts";
import {
  workerContractReleasePool,
  workerContractReplayed,
} from "./workerContractReleases.ts";

const assignment = {
  assignment: "01HZ",
  capabilities: ["linux", "containers"],
  cpuMillis: 1_000,
  memoryMib: 1_024,
  deadlineSecs: 3_600,
  callbackUrl: "https://worker-plane.invalid/v1/ticket-execution/attempt/01HZ",
  bearer: "attempt-secret",
};

test("an assignment carries the placement fields and nothing beside them", () => {
  assert.deepEqual(workerPoolAssignmentSchema.parse(assignment), assignment);
  const pinned = {
    ...assignment,
    image: `registry.invalid/worker@sha256:${"a".repeat(64)}`,
  };
  assert.deepEqual(workerPoolAssignmentSchema.parse(pinned), pinned);
  for (const extra of ["taskKey", "ticket", "repository", "obligation"])
    assert.equal(
      workerPoolAssignmentSchema.safeParse({ ...assignment, [extra]: "x" })
        .success,
      false,
    );
});

test("an assignment is bounded in every member a pool could grow", () => {
  for (const invalid of [
    { ...assignment, cpuMillis: 0 },
    { ...assignment, memoryMib: 1.5 },
    { ...assignment, deadlineSecs: -1 },
    { ...assignment, callbackUrl: "not-a-url" },
    { ...assignment, bearer: "" },
    { ...assignment, image: "" },
    { ...assignment, image: "i".repeat(workerImageCharsMax + 1) },
    { ...assignment, capabilities: ["has space"] },
    {
      ...assignment,
      capabilities: Array.from(
        { length: workerPoolCapabilitiesMax + 1 },
        (_value, index) => `c${String(index)}`,
      ),
    },
  ])
    assert.equal(workerPoolAssignmentSchema.safeParse(invalid).success, false);
});

test("an assignment's runtime is a reference bounded as its image is, and an assignment without one is read as before", () => {
  const image = `registry.invalid/project@sha256:${"a".repeat(64)}`;
  const runtime = `registry.invalid/chuggy/runtime@sha256:${"b".repeat(64)}`;
  const injected = { ...assignment, image, runtime };
  assert.deepEqual(workerPoolAssignmentSchema.parse(injected), injected);
  assert.deepEqual(workerPoolAssignmentSchema.parse({ ...assignment, image }), {
    ...assignment,
    image,
  });
  for (const invalid of [
    { ...injected, runtime: "" },
    { ...injected, runtime: "r".repeat(workerImageCharsMax + 1) },
    { ...injected, runtime: 1 },
  ])
    assert.equal(
      workerPoolAssignmentSchema.safeParse(invalid).success,
      false,
      JSON.stringify(invalid).slice(0, 80),
    );
  assert.equal(
    workerPoolAssignmentSchema.safeParse({
      ...injected,
      runtime: "r".repeat(workerImageCharsMax),
    }).success,
    true,
  );
});

test("a job assignment may name its project, held to the bound of every other name on the wire", () => {
  const named = { ...assignment, project: "chuggy" };
  assert.deepEqual(workerPoolAssignmentSchema.parse(named), named);
  const longest = {
    ...assignment,
    project: "p".repeat(workerPoolIdentityCharsMax),
  };
  assert.deepEqual(workerPoolAssignmentSchema.parse(longest), longest);
  for (const project of ["", "p".repeat(workerPoolIdentityCharsMax + 1), 7])
    assert.equal(
      workerPoolAssignmentSchema.safeParse({ ...assignment, project }).success,
      false,
      String(project).slice(0, 20),
    );
});

test("a pool of a release the runner-projects range accepts reads a job assignment naming its project, and one of any earlier refuses the whole answer", async () => {
  const answer = {
    assignments: [{ ...assignment, project: "chuggy" }],
    sessions: [],
    stop: [],
  };
  assert.ok(
    contractVersionAccepted(
      workerContractRunnerProjects,
      workerContractRelease,
    ),
  );
  assert.ok(workerPoolReconciliationSchema.safeParse(answer).success);
  for (const older of workerContractReplayed("pool")) {
    const { reconciliation } = await workerContractReleasePool(older);
    assert.equal(
      reconciliation.safeParse(answer).success,
      contractVersionAccepted(workerContractRunnerProjects, older),
      older,
    );
  }
});

test("a session assignment is an assignment that always names its image, under a session's own bearer", () => {
  const session = {
    ...assignment,
    image: "registry.invalid/worker:1",
    bearer: `chgs_${"a".repeat(240)}`,
  };
  assert.match(session.bearer, sessionBearerPattern);
  assert.deepEqual(workerPoolSessionAssignmentSchema.parse(session), session);
  assert.deepEqual(workerPoolAssignmentSchema.parse(session), session);
  for (const invalid of [
    { ...session, image: undefined },
    { ...session, image: "" },
    { ...session, lease: 30 },
    { ...session, runtime: "registry.invalid/chuggy/runtime:1" },
    { ...session, project: "chuggy" },
  ])
    assert.equal(
      workerPoolSessionAssignmentSchema.safeParse(invalid).success,
      false,
      JSON.stringify(invalid),
    );
});

test("an outcome tells a settled no from an unavailable one, which carries nothing", () => {
  assert.deepEqual(assignmentOutcomeSchema.parse({ outcome: "Accepted" }), {
    outcome: "Accepted",
  });
  assert.equal(
    assignmentOutcomeSchema.safeParse({ outcome: "Refused" }).success,
    false,
  );
  assert.deepEqual(assignmentOutcomeSchema.parse({ outcome: "Unavailable" }), {
    outcome: "Unavailable",
  });
  for (const extra of [{ evidence: "busy" }, { retryAfterSecs: 30 }])
    assert.equal(
      assignmentOutcomeSchema.safeParse({ outcome: "Unavailable", ...extra })
        .success,
      false,
      JSON.stringify(extra),
    );
});

test("a refusal may name the image fault that caused it, from the contract's roster alone, and still carries its evidence", () => {
  for (const fault of workerImageFaults) {
    const refused = { outcome: "Refused", evidence: "no git", fault } as const;
    assert.deepEqual(assignmentOutcomeSchema.parse(refused), refused);
  }
  assert.deepEqual(
    assignmentOutcomeSchema.parse({ outcome: "Refused", evidence: "busy" }),
    { outcome: "Refused", evidence: "busy" },
  );
  for (const invalid of [
    { outcome: "Refused", fault: "ImageLacksGit" },
    { outcome: "Refused", evidence: "no git", fault: "ImageLacksSed" },
    { outcome: "Refused", evidence: "no git", fault: "" },
    { outcome: "Unavailable", fault: "ImageLacksGit" },
    { outcome: "Accepted", fault: "ImageLacksGit" },
  ])
    assert.equal(
      assignmentOutcomeSchema.safeParse(invalid).success,
      false,
      JSON.stringify(invalid),
    );
});

test("a reconciliation carries what to place of each kind and what to stop, each name bounded", () => {
  const answer = {
    assignments: [assignment],
    sessions: [{ ...assignment, image: "registry.invalid/worker:1" }],
    stop: ["01HY"],
  };
  assert.deepEqual(workerPoolReconciliationSchema.parse(answer), answer);
  for (const invalid of [
    { ...answer, stop: ["x".repeat(workerPoolIdentityCharsMax + 1)] },
    { ...answer, stop: [""] },
    { ...answer, assignments: [{ ...assignment, deadlineSecs: 0 }] },
    { ...answer, sessions: [assignment] },
    { ...answer, lease: 30 },
    { assignments: [], stop: [] },
    { assignments: [], sessions: [] },
  ])
    assert.equal(
      workerPoolReconciliationSchema.safeParse(invalid).success,
      false,
    );
});

const release = {
  package: "chuggy-linux",
  version: "0.14.0",
  url: "https://github.com/kasofsk/chuggy-linux/releases/download/v0.14.0/chuggy-linux-0.14.0.tgz",
  integrity: `sha512-${"A".repeat(85)}g==`,
};

test("a reconciliation may name a runner's release, which is its package, a plain version, an https address and a sha512 integrity", () => {
  const answer = { assignments: [], sessions: [], stop: [], release };
  assert.deepEqual(workerPoolReconciliationSchema.parse(answer), answer);
  assert.deepEqual(workerRunnerReleaseSchema.parse(release), release);
  for (const invalid of [
    { ...release, package: "Chuggy-linux" },
    { ...release, package: "@kasofsk/chuggy-linux" },
    { ...release, package: "c".repeat(64) },
    { ...release, version: "0.14" },
    { ...release, version: "0.14.0-rc.1" },
    { ...release, version: "0.14.0+build" },
    { ...release, version: "0.014.0" },
    { ...release, url: "http://github.com/a.tgz" },
    { ...release, url: "file:///a.tgz" },
    { ...release, url: "not-a-url" },
    {
      ...release,
      url: `https://github.com/${"a".repeat(workerRunnerReleaseUrlCharsMax)}`,
    },
    { ...release, integrity: `sha256-${"A".repeat(43)}=` },
    { ...release, integrity: `sha512-${"A".repeat(86)}=` },
    { ...release, integrity: `sha512-${"-".repeat(86)}==` },
    { ...release, latest: true },
    { package: release.package, version: release.version },
  ])
    assert.equal(
      workerRunnerReleaseSchema.safeParse(invalid).success,
      false,
      JSON.stringify(invalid).slice(0, 120),
    );
});

test("a runner is named as its package and its version, and anything else names none", () => {
  assert.deepEqual(workerRunnerOf("chuggy-linux/0.14.0"), {
    package: "chuggy-linux",
    version: "0.14.0",
  });
  assert.deepEqual(workerRunnerOf(`a${"-".repeat(62)}/0.0.0`), {
    package: `a${"-".repeat(62)}`,
    version: "0.0.0",
  });
  for (const unread of [
    undefined,
    "",
    "chuggy-linux",
    "chuggy-linux/",
    "/0.14.0",
    "chuggy-linux/0.14",
    "chuggy-linux/v0.14.0",
    "chuggy-linux/0.14.0-rc.1",
    "Chuggy-linux/0.14.0",
    "@kasofsk/chuggy-linux/0.14.0",
    "chuggy-linux/0.14.0, chuggy-linux/0.14.0",
    `a${"-".repeat(63)}/0.0.0`,
    "chuggy-linux/1234567890.0.0",
  ])
    assert.equal(workerRunnerOf(unread), undefined, String(unread));
});

test("a poll's capabilities are tokens separated by commas, an absent header names none and an empty one the empty set", () => {
  const longest = `9${"a".repeat(workerPoolTokenCharsMax - 1)}`;
  const most = Array.from(
    { length: workerPoolCapabilitiesMax },
    (_, index) => `Tool:${String(index)}`,
  );
  for (const [header, capabilities] of [
    ["Platform:Linux:Amd64", ["Platform:Linux:Amd64"]],
    ["Platform:Linux:Amd64,Tool:Bazel", ["Platform:Linux:Amd64", "Tool:Bazel"]],
    [" Tool:Bazel ,\tAgent:Claude\t", ["Tool:Bazel", "Agent:Claude"]],
    ["Tool:Bazel, , Agent:Claude,", ["Tool:Bazel", "Agent:Claude"]],
    [longest, [longest]],
    [most.join(", "), most],
    ["", []],
    [" , ", []],
  ] as const)
    assert.deepEqual(
      workerRunnerCapabilitiesOf(header),
      { named: "Set", capabilities },
      JSON.stringify(header),
    );
  assert.deepEqual(workerRunnerCapabilitiesOf(undefined), { named: "None" });
});

test("a poll's capabilities header naming a token outside the grammar, one twice, or more than a pool declares is unread", () => {
  for (const header of [
    "Tool Bazel",
    "Tool:Bazel;Agent:Claude",
    "-Tool",
    ":Tool",
    "Tool/Bazel",
    '"Tool:Bazel"',
    "Tool:Bazel\nAgent:Claude",
    "a".repeat(workerPoolTokenCharsMax + 1),
    "Tool:Bazel, Tool:Bazel",
    Array.from(
      { length: workerPoolCapabilitiesMax + 1 },
      (_, index) => `Tool:${String(index)}`,
    ).join(","),
  ])
    assert.deepEqual(
      workerRunnerCapabilitiesOf(header),
      { named: "Unread" },
      JSON.stringify(header).slice(0, 120),
    );
  assert.equal(
    workerRunnerCapabilitiesSchema.safeParse(["Tool:Bazel", "Tool:Bazel"])
      .success,
    false,
  );
});

test("a pool of a release the runner-release range accepts reads an answer naming a release, and one of any earlier refuses it", async () => {
  const answer = { assignments: [], sessions: [], stop: [], release };
  assert.ok(
    contractVersionAccepted(
      workerContractRunnerReleases,
      workerContractRelease,
    ),
  );
  for (const older of workerContractReplayed("pool")) {
    const { reconciliation } = await workerContractReleasePool(older);
    assert.equal(
      reconciliation.safeParse(answer).success,
      contractVersionAccepted(workerContractRunnerReleases, older),
      older,
    );
  }
});

test("a poll's query is the held list as a query carries one, bounded by the plane, and each room", () => {
  const query = workerPoolPollQuerySchema(2);
  assert.deepEqual(query.parse({ wanted: "0" }), {
    held: [],
    wanted: 0,
    wantedSessions: 0,
  });
  assert.deepEqual(query.parse({ held: "a", wanted: "3" }), {
    held: ["a"],
    wanted: 3,
    wantedSessions: 0,
  });
  assert.deepEqual(
    query.parse({ held: ["a", "b"], wanted: "1", wantedSessions: "2" }),
    { held: ["a", "b"], wanted: 1, wantedSessions: 2 },
  );
  for (const invalid of [
    { held: ["a", "b", "c"], wanted: "0" },
    { held: "x".repeat(workerPoolIdentityCharsMax + 1), wanted: "0" },
    { held: "", wanted: "0" },
    { held: "a" },
    { held: "a", wanted: "-1" },
    { held: "a", wanted: "01" },
    { held: "a", wanted: "1.5" },
    { held: "a", wanted: ["1", "2"] },
    { held: "a", wanted: "0", capacity: "4" },
    { held: "a", wanted: "0", wantedSessions: "-1" },
    { held: "a", wanted: "0", wantedSessions: "01" },
    { held: "a", wanted: "0", wantedSessions: ["1", "2"] },
  ])
    assert.equal(query.safeParse(invalid).success, false);
});

test("each settlement route is the poll route, the assignment and the outcome", () => {
  for (const outcome of ["Accepted", "Refused", "Unavailable"] as const)
    assert.equal(
      workerPoolSettlementRoutes[outcome],
      `${workerPoolPollRoute}/:assignment/${outcome.toLowerCase()}`,
    );
  assert.equal(
    workerPoolSettlementPath("Refused", "a/b c"),
    `${workerPoolPollRoute}/a%2Fb%20c/refused`,
  );
});

test("a registration declares what a pool can do and no capacity", () => {
  assert.deepEqual(
    workerPoolRegistrationSchema.parse({
      pool: "gumbo",
      capabilities: ["linux"],
    }),
    { pool: "gumbo", capabilities: ["linux"] },
  );
  assert.equal(
    workerPoolRegistrationSchema.safeParse({
      pool: "gumbo",
      capabilities: ["linux"],
      concurrency: 4,
    }).success,
    false,
  );
});
