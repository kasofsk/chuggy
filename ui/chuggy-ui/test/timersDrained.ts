/**
 * A file's last zero-delay timers fire before its environment is taken away.
 *
 * Timers are Node's and not jsdom's, so one set by a file's last unmount
 * outlives the document it was set against: Radix's focus scope sets one to
 * return focus, and fired late it throws outside every test and fails a run
 * all of whose tests passed. One turn of the clock after the last test lets
 * it fire first. The clock is taken as the file loads, before a suite can
 * fake it.
 */

import { afterAll } from "vitest";

const turn = globalThis.setTimeout;

afterAll(
  () =>
    new Promise<void>((resolve) => {
      turn(resolve, 0);
    }),
);
