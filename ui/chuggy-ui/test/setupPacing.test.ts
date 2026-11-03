/**
 * The text a run's pacing is read from: the program's own pacing wherever the
 * text names nothing it takes, and the quicker values it names otherwise.
 */

import { expect, test } from "vitest";

import { setupPacing, setupPacingRead } from "../app/core/setupPacing.ts";
import { setupRemoteWaitMs } from "../app/core/setupRemote.ts";
import { setupLivePollMs } from "../app/core/setupRunner.ts";
import { setupSignInPollMs } from "../app/core/setupSignIn.ts";

test("with no text, or text that names nothing, a run is paced as the program is", () => {
  expect(setupPacing).toEqual({
    signInPollMs: setupSignInPollMs,
    livePollMs: setupLivePollMs,
    remoteWaitMs: setupRemoteWaitMs,
  });
  for (const text of [undefined, "", "{}", "null"])
    expect(setupPacingRead(text)).toEqual(setupPacing);
});

test("each field named is taken, from one millisecond up to the value it replaces, and every field left out is the program's own", () => {
  expect(setupPacingRead('{"signInPollMs":1}')).toEqual({
    ...setupPacing,
    signInPollMs: 1,
  });
  expect(
    setupPacingRead(JSON.stringify({ livePollMs: setupLivePollMs })),
  ).toEqual(setupPacing);
  expect(
    setupPacingRead(
      JSON.stringify({ signInPollMs: 25, livePollMs: 100, remoteWaitMs: 700 }),
    ),
  ).toEqual({ signInPollMs: 25, livePollMs: 100, remoteWaitMs: 700 });
});

test("text that is not a pacing, or names a value no pacing takes, is read as naming nothing", () => {
  for (const text of [
    "fast",
    "{",
    "[25]",
    '{"signInPollMs":"25"}',
    '{"signInPollMs":0}',
    '{"signInPollMs":-25}',
    '{"signInPollMs":2.5}',
    JSON.stringify({ remoteWaitMs: setupRemoteWaitMs + 1 }),
    JSON.stringify({ livePollMs: 100, lockWaitMs: 1 }),
  ])
    expect(setupPacingRead(text)).toEqual(setupPacing);
});
