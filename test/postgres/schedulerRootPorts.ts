/**
 * The ports the scheduler root's suite hands its process, declared where the
 * type checker can hold them to what the composition root takes.
 *
 * A STRING PROGRAM IS NOT TYPECHECKED. The suite drives the root in a child
 * process because nothing may import one, so a service composed inside that
 * string may name a field or a method the root does not have and stay green
 * for as long as nothing dereferences it. Declared here instead, every field
 * and every method is `ExecutionSchedulerService`'s own, checked by the
 * compiler rather than by whether a run reaches it.
 *
 * NOTHING HERE ANSWERS. Each port refuses or reports itself unavailable, which
 * is what keeps the suite's database as it was found however far a pass gets.
 */

import {
  executionSchedulerDefaults,
  silentSchedulerTelemetry,
} from "../../src/interpreter/executionScheduler.ts";
import type { ExecutionSchedulerService } from "../../src/interpreter/executionSchedulerRun.ts";
import { finalizerDefaults } from "../../src/interpreter/finalizer.ts";
import { blessedPracticeCatalog } from "../../src/interpreter/taskBriefing.ts";
import { ticketServiceDefaults } from "../../src/interpreter/ticketService.ts";

/** Everything `schedulerProcessRoot` takes but the store it opens for itself. */
export const schedulerRootService: Omit<
  ExecutionSchedulerService,
  "store" | "configurations"
> = {
  placement: {
    place: () =>
      Promise.resolve({ placed: "Unavailable", retryAfterSeconds: 1 }),
    cancel: () => Promise.resolve({ cancelled: "Accepted" }),
  },
  policy: {
    profileFor: () =>
      Promise.resolve({
        resolved: "Denied",
        reason: "ExecutionProfileUnavailable",
      }),
  },
  runtimeFacts: { facts: () => Promise.resolve({ read: "Unavailable" }) },
  practices: blessedPracticeCatalog,
  config: executionSchedulerDefaults,
  ticketService: ticketServiceDefaults,
  finalizer: finalizerDefaults,
  metrics: silentSchedulerTelemetry,
};
