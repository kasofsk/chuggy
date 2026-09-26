/**
 * The task a work attempt's worker is handed, built by one function whether a
 * launcher pushes it into a pod or the worker plane answers a fetch with it.
 */

import type { WorkTaskDocument } from "../contract/workerTask.ts";
import type {
  AttemptPlacement,
  ExecutionProfile,
  WorkTaskInvocation,
} from "./executionScheduler.ts";
import { taskAuthorityGrant } from "./taskAuthority.ts";
import type { TaskInvocation } from "./taskBriefing.ts";

/** What an attempt's rows say of the task it runs, which the scheduler never records twice. */
export type WorkTaskIdentity = Pick<
  AttemptPlacement,
  | "partition"
  | "execution"
  | "attempt"
  | "generation"
  | "ticket"
  | "task"
  | "taskKind"
  | "stage"
  | "sourceRequest"
  | "inputBundle"
  | "inputBundleDigest"
  | "configurationRevision"
  | "configurationDigest"
  | "requirementIdentity"
  | "requirementDigest"
>;

/** A work task without the plane that serves it. */
export type WorkTask = Omit<WorkTaskDocument, "workerPlane">;

/** What a launch is invoked with, in the shape it is recorded and handed over in. */
export function workTaskInvocation(launch: {
  readonly profile: ExecutionProfile;
  readonly invocation: TaskInvocation;
}): WorkTaskInvocation {
  const { briefing, authority, worker } = launch.invocation;
  return {
    profile: {
      profile: launch.profile.profile,
      runtimeVersion: launch.profile.runtimeVersion,
    },
    briefing: {
      templateVersion: briefing.templateVersion,
      purpose: briefing.purpose,
      text: briefing.text,
    },
    authority: taskAuthorityGrant(authority),
    ...(worker === undefined ? {} : { worker }),
  };
}

/** One work task, its keys in the order the pod document carries them. */
export function workTask(
  identity: WorkTaskIdentity,
  invocation: WorkTaskInvocation,
): WorkTask {
  return {
    tenant: identity.partition.tenant,
    project: identity.partition.project,
    execution: identity.execution,
    attempt: identity.attempt,
    generation: identity.generation,
    ticket: identity.ticket,
    task: identity.task,
    taskKind: identity.taskKind,
    ...(identity.stage === undefined ? {} : { stage: identity.stage }),
    sourceRequest: identity.sourceRequest,
    inputBundle: identity.inputBundle,
    inputBundleDigest: identity.inputBundleDigest,
    configurationRevision: identity.configurationRevision,
    configurationDigest: identity.configurationDigest,
    profile: invocation.profile,
    requirementIdentity: identity.requirementIdentity,
    requirementDigest: identity.requirementDigest,
    briefing: invocation.briefing,
    authority: invocation.authority,
    ...(invocation.worker === undefined ? {} : { worker: invocation.worker }),
  };
}
