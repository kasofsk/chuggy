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
import type { ProjectAccessSettings } from "../../src/interpreter/projectAccess.ts";
import { sessionSchedulerDefaults } from "../../src/interpreter/sessionScheduler.ts";
import type { SessionSchedulerService } from "../../src/interpreter/sessionSchedulerRun.ts";
import { blessedPracticeCatalog } from "../../src/interpreter/taskBriefing.ts";
import type { SessionLaunchFacts } from "../../src/interpreter/workerPoolSessions.ts";
import { ticketServiceDefaults } from "../../src/interpreter/ticketService.ts";

/** Everything `schedulerProcessRoot` takes but the store it opens for itself. */
export const schedulerRootService: Omit<
  ExecutionSchedulerService,
  | "store"
  | "configurations"
  | "priorWorkReports"
  | "priorEvaluationReports"
  | "ticketBriefs"
  | "workerPools"
  | "access"
> = {
  placement: {
    place: () => Promise.resolve({ placed: "Unavailable" }),
    cancel: () => Promise.resolve({ cancelled: "Accepted" }),
  },
  policy: {
    routing: {
      routes: { Work: "InCluster", Evaluation: "InCluster" },
      projectRoutes: new Map(),
    },
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

/** Everything `schedulerProcessRootSessions` takes but the ports it opens for itself. */
export const schedulerRootSessions: Omit<
  SessionSchedulerService,
  "store" | "bindings"
> = {
  placement: {
    place: () => Promise.resolve({ placed: "Unavailable" }),
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

/** What the root publishes of a session's launch beyond its policy. */
export const schedulerRootSessionLaunch: Pick<
  SessionLaunchFacts,
  "bounds" | "model" | "deadlineSecs"
> = {
  bounds: {
    mailboxPollMs: 1_000,
    idleMs: 2_000,
    resultDrainMs: 3_000,
    loadTimeoutMs: 4_000,
    turnsMax: 5,
    budgetUsd: 6,
  },
  model: "scheduler-root-model",
  deadlineSecs: 600,
};

/** A project authority nothing listens at, which is what the root's own access adapter is asked of. */
export const schedulerRootAccess: ProjectAccessSettings = {
  readUrl: "http://127.0.0.1:1/",
  requestTimeoutMs: 1_000,
};
