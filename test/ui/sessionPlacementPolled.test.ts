/**
 * The console's poll of a project's session placement, held to the window the
 * server keeps a runner live for: no frame says a runner polled, so the poll is
 * all that moves a standing on screen, and one as long as the window would draw
 * a runner that came back as offline for as long again.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { sessionRunnerPolledSecsMax } from "../../src/interpreter/sessionPlacement.ts";
import { sessionPlacementPolledMs } from "../../ui/chuggy-ui/app/core/sessionRunners.ts";

/** How many of the console's reads fit in one window at the fewest. */
const sessionPlacementReadsPerWindowMin = 4;

test("the console reads a project's session placement several times inside a runner's liveness window", () => {
  assert.ok(sessionPlacementPolledMs > 0);
  assert.ok(
    sessionPlacementPolledMs * sessionPlacementReadsPerWindowMin <=
      sessionRunnerPolledSecsMax * 1000,
  );
});
