/**
 * The frames between a chat host and its supervisor, read as either side
 * reads them: each one as it is written, and what a line is refused for.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  chatProtocolFrameBytesMax,
  chatProtocolLine,
  chatProtocolSpoken,
  chatProtocolVersion,
  chatSupervisorRefusals,
  parseChatHostFrame,
  parseChatSupervisorFrame,
  type ChatHostFrame,
  type ChatSupervisorFrame,
} from "../../src/contract/chatHost.ts";
import { textUtf8Bytes } from "../../src/contract/http.ts";
import { sessionEndedSchema } from "../../src/contract/sessionPlane.ts";
import { workerContractRelease } from "../../src/contract/workerContract.ts";
import { workerPoolIdentityCharsMax } from "../../src/contract/workerPool.ts";

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

const hostFrames: readonly ChatHostFrame[] = [
  start,
  { frame: "Start", assignment: "01HZ", envelope: { ...start.envelope } },
  { frame: "Stop", assignment: "01HZ" },
  { frame: "Drain" },
];

const supervisorFrames: readonly ChatSupervisorFrame[] = [
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
    assert.throws(() =>
      parseChatSupervisorFrame(JSON.stringify({ ...ready, ...wrong })),
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
