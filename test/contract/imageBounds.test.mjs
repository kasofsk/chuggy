/**
 * The bounds the worker image writes a second time, held against the contract's
 * own.
 *
 * `images/worker/` is plain JavaScript that reaches nothing under `src/`, so
 * every bound the pod posts a body against is written twice; this suite is what
 * makes the second copy a checked claim rather than a comment. Drift is not a
 * lint: a pod that cuts a tool name to a longer bound than the door accepts
 * posts a body the door refuses, the answer throws, and the turn stays claimed
 * by a pod that has exited.
 *
 * IT IS A `.mjs` SUITE FOR A REASON. A TypeScript suite importing the image
 * would pull the whole image tree under `checkJs`, which is a compiler verdict
 * on plain JavaScript nobody wrote for one. Node strips the types off the
 * contract at run time instead, so both sides are read as the modules they are
 * rather than as text.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  sessionTurnModelCharsMax,
  sessionTurnResultCharsMax,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
} from "../../src/contract/http.ts";
import * as pod from "../../images/worker/session.mjs";

test("every bound the session pod copies is the contract's own value", () => {
  assert.deepEqual(
    {
      sessionTurnModelCharsMax: pod.sessionTurnModelCharsMax,
      sessionTurnResultCharsMax: pod.sessionTurnResultCharsMax,
      sessionTurnToolNameCharsMax: pod.sessionTurnToolNameCharsMax,
      sessionTurnToolsMax: pod.sessionTurnToolsMax,
    },
    {
      sessionTurnModelCharsMax,
      sessionTurnResultCharsMax,
      sessionTurnToolNameCharsMax,
      sessionTurnToolsMax,
    },
  );
});
