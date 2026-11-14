/**
 * The frames between a chat host and its supervisor, read as either side
 * reads them: each one as it is written, and what a line is refused for.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  chatProtocolFrameBytesMax,
  chatProtocolLine,
  chatProtocolSpoken,
  chatProtocolVersion,
  chatSupervisorRefusals,
  parseChatHostFrame,
  parseChatSupervisorFrame,
  type ChatHostCredential,
  type ChatHostFrame,
  type ChatSupervisorFrame,
} from "../../src/contract/chatHost.ts";
import { textUtf8Bytes } from "../../src/contract/http.ts";
import { sessionEndedSchema } from "../../src/contract/sessionPlane.ts";
import { workerContractRelease } from "../../src/contract/workerContract.ts";
import {
  workerPoolIdentityCharsMax,
  type WorkerPoolThreadClosed,
} from "../../src/contract/workerPool.ts";
import {
  contractVersionAccepted,
  workerContractChatHost,
} from "../../src/interpreter/workerPlane.ts";
import {
  workerContractReleaseExport,
  workerContractReleaseSchema,
  workerContractReplayed,
} from "./workerContractReleases.ts";

const bearer = "session-bearer-secret";

const start = {
  frame: "Start",
  assignment: "01HZ",
  envelope: {
    callbackUrl: "https://worker-plane.invalid/v1/session",
    bearer,
    timeoutSecsMax: 3_600,
    outputBytesMax: 1_048_576,
    providerCredentialFile: "/run/chuggy/provider-credential",
  },
} as const satisfies ChatHostFrame;

const credential = {
  agent: "Claude",
  type: "OAuth",
  name: "team-max_2",
} as const satisfies ChatHostCredential;

const thread = {
  project: "project-one",
  session: "thread-one",
} as const satisfies WorkerPoolThreadClosed;

/** Every frame version 2 wrote, each of which version 3 reads unchanged. */
const versionTwoHostFrames: readonly ChatHostFrame[] = [
  start,
  { ...start, credential },
  { frame: "Start", assignment: "01HZ", envelope: { ...start.envelope } },
  { frame: "Stop", assignment: "01HZ" },
  { frame: "Drain" },
];

/** The frames version 3 added to the host's. */
const versionThreeHostFrames: readonly ChatHostFrame[] = [
  { ...start, thread },
  { ...start, credential, thread },
  { frame: "Forget", thread },
];

const hostFrames: readonly ChatHostFrame[] = [
  ...versionTwoHostFrames,
  ...versionThreeHostFrames,
];

const versionTwoSupervisorFrames: readonly ChatSupervisorFrame[] = [
  {
    frame: "Ready",
    protocols: [chatProtocolVersion],
    sessionsMax: 4,
    contractRelease: workerContractRelease,
  },
  { frame: "Started", assignment: "01HZ" },
  ...chatSupervisorRefusals.map((reason): ChatSupervisorFrame => ({
    frame: "Refused",
    assignment: "01HZ",
    reason,
  })),
  { frame: "Ended", assignment: "01HZ", phase: "Succeeded" },
  { frame: "Drained" },
];

const supervisorFrames: readonly ChatSupervisorFrame[] = [
  ...versionTwoSupervisorFrames,
  { frame: "Forgotten", thread },
];

/** A line its writer wrote, as its reader takes it off the stream. */
function read(line: string): string {
  assert.ok(line.endsWith("\n"));
  assert.ok(!line.slice(0, -1).includes("\n"));
  return line.slice(0, -1);
}

test("every frame is read as it was written", () => {
  for (const frame of hostFrames)
    assert.deepEqual(parseChatHostFrame(read(chatProtocolLine(frame))), frame);
  for (const frame of supervisorFrames)
    assert.deepEqual(
      parseChatSupervisorFrame(read(chatProtocolLine(frame))),
      frame,
    );
});

test("a frame of the other side, an unknown kind, and a field no frame names are refused", () => {
  for (const frame of supervisorFrames)
    assert.throws(() => parseChatHostFrame(JSON.stringify(frame)));
  for (const frame of hostFrames)
    assert.throws(() => parseChatSupervisorFrame(JSON.stringify(frame)));
  for (const line of [
    JSON.stringify({ frame: "Pause", assignment: "01HZ" }),
    JSON.stringify({ assignment: "01HZ" }),
    JSON.stringify({ frame: "Stop", assignment: "01HZ", ticket: 1 }),
    JSON.stringify({
      ...start,
      envelope: { ...start.envelope, workspace: "/w" },
    }),
  ])
    assert.throws(() => parseChatHostFrame(line));
  assert.throws(() =>
    parseChatSupervisorFrame(JSON.stringify({ frame: "Paused" })),
  );
});

test("a line that is not JSON is refused without being quoted", () => {
  const line = JSON.stringify(start).slice(0, -1);
  assert.throws(
    () => parseChatHostFrame(line),
    (error: unknown) =>
      error instanceof SyntaxError &&
      error.message === "a chat frame is not JSON",
  );
});

test("a frame is read at its bound and refused past it, weighed in UTF-8", () => {
  const withPath = (providerCredentialFile: string) =>
    JSON.stringify({
      ...start,
      envelope: { ...start.envelope, providerCredentialFile },
    });
  const sized = (bytes: number, pad: string) => {
    const room = bytes - textUtf8Bytes(withPath(""));
    const pads = Math.floor(room / textUtf8Bytes(pad));
    return withPath(
      pad.repeat(pads) + "a".repeat(room - pads * textUtf8Bytes(pad)),
    );
  };
  for (const pad of ["a", "é", "€", "🦀"]) {
    const atBound = sized(chatProtocolFrameBytesMax, pad);
    assert.equal(textUtf8Bytes(atBound), chatProtocolFrameBytesMax);
    assert.equal(parseChatHostFrame(atBound).frame, "Start");
    const past = sized(chatProtocolFrameBytesMax + 1, pad);
    assert.throws(() => parseChatHostFrame(past), RangeError);
    assert.throws(
      () => chatProtocolLine(JSON.parse(past) as ChatHostFrame),
      RangeError,
    );
  }
});

test("a bearer of the wrong shape is refused, and no refusal repeats it", () => {
  for (const wrong of ["", "b".repeat(workerPoolIdentityCharsMax + 1), 7, null])
    assert.throws(() =>
      parseChatHostFrame(
        JSON.stringify({
          ...start,
          envelope: { ...start.envelope, bearer: wrong },
        }),
      ),
    );
  for (const line of [
    JSON.stringify({ ...start, frame: "Begin" }),
    JSON.stringify({ ...start, assignment: "" }),
    JSON.stringify({
      ...start,
      envelope: { ...start.envelope, callbackUrl: "not a url" },
    }),
    JSON.stringify({ ...start, extra: true }),
    `${JSON.stringify(start)}}`,
    JSON.stringify(start).replace(`"${bearer}"`, bearer),
    JSON.stringify(start).padEnd(chatProtocolFrameBytesMax + 1, " "),
  ])
    assert.throws(
      () => parseChatHostFrame(line),
      (error: unknown) =>
        error instanceof Error &&
        !error.message.includes(bearer.slice(0, 8)) &&
        !String(error.stack).includes(bearer.slice(0, 8)),
    );
});

test("`Ended` reads exactly the phases a session's end is reported in", () => {
  const phases = sessionEndedSchema.shape.phase.options;
  for (const phase of phases)
    assert.deepEqual(
      parseChatSupervisorFrame(
        JSON.stringify({ frame: "Ended", assignment: "01HZ", phase }),
      ),
      { frame: "Ended", assignment: "01HZ", phase },
    );
  for (const phase of ["Stopped", "succeeded", "", 0])
    assert.throws(() =>
      parseChatSupervisorFrame(
        JSON.stringify({ frame: "Ended", assignment: "01HZ", phase }),
      ),
    );
});

test("a refusal names one of the closed reasons", () => {
  assert.throws(() =>
    parseChatSupervisorFrame(
      JSON.stringify({ frame: "Refused", assignment: "01HZ", reason: "Busy" }),
    ),
  );
});

test("`Ready` names at least one protocol, a ceiling, and a release", () => {
  const ready = {
    frame: "Ready",
    protocols: [chatProtocolVersion],
    sessionsMax: 1,
    contractRelease: workerContractRelease,
  };
  for (const wrong of [
    { protocols: [] },
    { protocols: [0] },
    { sessionsMax: 0 },
    { sessionsMax: 1.5 },
    { contractRelease: "1.21" },
    { contractRelease: "v1.21.0" },
  ])
    for (const read of [ready, { ...ready, later: true }])
      assert.throws(() =>
        parseChatSupervisorFrame(JSON.stringify({ ...read, ...wrong })),
      );
});

test("a later supervisor's `Ready` is read without the fields this version does not name", () => {
  const ready = {
    frame: "Ready",
    protocols: [chatProtocolVersion, chatProtocolVersion + 1],
    sessionsMax: 2,
    contractRelease: workerContractRelease,
  } as const;
  assert.deepEqual(
    parseChatSupervisorFrame(
      JSON.stringify({ ...ready, models: ["later"], sessionsIdle: 1 }),
    ),
    ready,
  );
  for (const frame of [
    { frame: "Started", assignment: "01HZ", later: true },
    { frame: "Drained", later: true },
  ])
    assert.throws(() => parseChatSupervisorFrame(JSON.stringify(frame)));
});

test("a `Stop` that came while a session was being prepared is refused as `Stopped`", () => {
  assert.deepEqual(
    parseChatSupervisorFrame(
      JSON.stringify({
        frame: "Refused",
        assignment: "01HZ",
        reason: "Stopped",
      }),
    ),
    { frame: "Refused", assignment: "01HZ", reason: "Stopped" },
  );
});

test("a host speaks to a supervisor only where its `Ready` names this version", () => {
  const ready = (protocols: number[]) => ({
    frame: "Ready" as const,
    protocols,
    sessionsMax: 1,
    contractRelease: workerContractRelease,
  });
  assert.equal(chatProtocolSpoken(ready([chatProtocolVersion])), true);
  assert.equal(
    chatProtocolSpoken(ready([chatProtocolVersion + 1, chatProtocolVersion])),
    true,
  );
  assert.equal(chatProtocolSpoken(ready([chatProtocolVersion + 1])), false);
});

test("a version-1 `Start`, naming no credential, is read as it was written", () => {
  const line = JSON.stringify(start);
  assert.deepEqual(parseChatHostFrame(line), start);
  assert.equal("credential" in parseChatHostFrame(line), false);
});

test("a `Start` names its credential by agent, type and name, and nothing else", () => {
  for (const agent of ["Claude", "Codex"] as const)
    for (const type of [
      "OAuth",
      "ApiKey",
      "Bedrock",
      "Vertex",
      "Foundry",
    ] as const) {
      const frame = { ...start, credential: { agent, type, name: "a" } };
      assert.deepEqual(parseChatHostFrame(JSON.stringify(frame)), frame);
    }
  const named = "n".repeat(64);
  assert.equal(
    parseChatHostFrame(
      JSON.stringify({ ...start, credential: { ...credential, name: named } }),
    ).frame,
    "Start",
  );
  for (const wrong of [
    { ...credential, name: "" },
    { ...credential, name: "n".repeat(65) },
    { ...credential, name: "team max" },
    { ...credential, name: "../provider" },
    { ...credential, agent: "Gemini" },
    { ...credential, type: "Subscription" },
    { agent: "Claude", type: "OAuth" },
    { ...credential, file: "/run/chuggy/provider-credential" },
    { ...credential, secret: "sk-ant-secret" },
    "team-max_2",
    null,
  ])
    assert.throws(() =>
      parseChatHostFrame(JSON.stringify({ ...start, credential: wrong })),
    );
});

test("a host of version 3 speaks to a supervisor of its window, and not to one of version 2 alone", () => {
  const ready = (protocols: number[]) => ({
    frame: "Ready" as const,
    protocols,
    sessionsMax: 1,
    contractRelease: workerContractRelease,
  });
  assert.equal(chatProtocolVersion, 3);
  assert.equal(chatProtocolSpoken(ready([2, 3])), true);
  assert.equal(chatProtocolSpoken(ready([2])), false);
});

/** The host's and the supervisor's frame schemas of each release a chat host still polls in that speaks version 2. */
async function chatHostVersionTwoReleases(): Promise<
  readonly {
    readonly release: string;
    readonly host: ReturnType<typeof workerContractReleaseSchema.parse>;
    readonly supervisor: ReturnType<typeof workerContractReleaseSchema.parse>;
  }[]
> {
  const releases = [];
  for (const release of workerContractReplayed("pool").filter((replayed) =>
    contractVersionAccepted(workerContractChatHost, replayed),
  )) {
    const exported = (name: string) =>
      workerContractReleaseExport(
        release,
        "chatHost",
        name,
        workerContractReleaseSchema,
      );
    const version = await workerContractReleaseExport(
      release,
      "chatHost",
      "chatProtocolVersion",
      z.number().optional(),
    );
    if (version === 2)
      releases.push({
        release,
        host: await exported("chatHostFrameSchema"),
        supervisor: await exported("chatSupervisorFrameSchema"),
      });
  }
  return releases;
}

test("every frame a release of version 2 writes reads unchanged in version 3, and none version 3 added reads in version 2", async () => {
  const releases = await chatHostVersionTwoReleases();
  assert.ok(releases.length > 0);
  for (const { release, host, supervisor } of releases) {
    for (const frame of versionTwoHostFrames) {
      const line = read(chatProtocolLine(frame));
      assert.deepEqual(host.parse(JSON.parse(line)), frame, release);
      assert.deepEqual(parseChatHostFrame(line), frame, release);
    }
    for (const frame of versionTwoSupervisorFrames) {
      const line = read(chatProtocolLine(frame));
      assert.deepEqual(supervisor.parse(JSON.parse(line)), frame, release);
      assert.deepEqual(parseChatSupervisorFrame(line), frame, release);
    }
    for (const frame of versionThreeHostFrames)
      assert.equal(host.safeParse(frame).success, false, release);
    assert.equal(
      supervisor.safeParse({ frame: "Forgotten", thread }).success,
      false,
      release,
    );
  }
});

test("a `Start` naming no thread is read without one, and one naming a thread names its project and its session and nothing else", () => {
  assert.equal("thread" in parseChatHostFrame(JSON.stringify(start)), false);
  assert.deepEqual(parseChatHostFrame(JSON.stringify({ ...start, thread })), {
    ...start,
    thread,
  });
  const long = "t".repeat(workerPoolIdentityCharsMax);
  assert.deepEqual(
    parseChatHostFrame(
      JSON.stringify({ ...start, thread: { project: long, session: long } }),
    ),
    { ...start, thread: { project: long, session: long } },
  );
  for (const wrong of [
    { project: "project-one" },
    { session: "thread-one" },
    { ...thread, project: "" },
    { ...thread, session: "" },
    { ...thread, session: "t".repeat(workerPoolIdentityCharsMax + 1) },
    { ...thread, directory: "/sessions/thread-one" },
    "thread-one",
    null,
  ])
    assert.throws(() =>
      parseChatHostFrame(JSON.stringify({ ...start, thread: wrong })),
    );
});

test("`Forget` and `Forgotten` each name one thread, and nothing else", () => {
  for (const [frame, parse] of [
    ["Forget", parseChatHostFrame],
    ["Forgotten", parseChatSupervisorFrame],
  ] as const) {
    assert.deepEqual(parse(JSON.stringify({ frame, thread })), {
      frame,
      thread,
    });
    for (const wrong of [
      { frame },
      { frame, thread: [thread] },
      { frame, thread: { project: "project-one" } },
      { frame, thread, assignment: "01HZ" },
    ])
      assert.throws(() => parse(JSON.stringify(wrong)));
  }
});

test("a `Forget` naming the longest thread fits in a frame", () => {
  const long = "\u{10FFFF}".repeat(workerPoolIdentityCharsMax / 2);
  const line = chatProtocolLine({
    frame: "Forget",
    thread: { project: long, session: long },
  });
  assert.ok(textUtf8Bytes(line) <= chatProtocolFrameBytesMax + 1);
});
