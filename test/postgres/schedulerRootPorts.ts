import { sessionSchedulerDefaults } from "../../src/interpreter/sessionScheduler.ts";
import type { SessionSchedulerService } from "../../src/interpreter/sessionSchedulerRun.ts";

/** Everything `schedulerProcessRootSessions` takes but the ports it opens for itself. */
export const schedulerRootSessions: Omit<
  SessionSchedulerService,
  "store" | "bindings"
> = {
  placement: {
    place: () =>
      Promise.resolve({ placed: "Unavailable", retryAfterSeconds: 1 }),
    cancel: () => Promise.resolve({ cancelled: "Accepted" }),
    observe: () => Promise.resolve({ observed: "Unended" }),
  },
  bearers: {
    mint: () => {
      throw new Error("the scheduler root suite mints no session bearer");
    },
  },
  policy: {
    profile: { profile: "session", runtimeVersion: "1" },
    image: "registry.invalid/session:1",
    grant: {
      tools: [],
      credentials: [],
      network: false,
      filesystem: "None",
      mayCompleteTask: false,
    },
    mirrors: {},
  },
  config: sessionSchedulerDefaults,
};

/** The adopted ticket pass is inert while this suite exercises root preconditions. */
export function schedulerRootTickets(): { run(): Promise<void> } {
  return { run: () => Promise.resolve() };
}
