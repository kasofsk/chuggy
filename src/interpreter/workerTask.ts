/**
 * The task a work attempt's worker or a session attempt's pod is handed, each
 * built by one function whether a launcher pushes it into a pod or the worker
 * plane answers a fetch with it.
 */

import type {
  SessionTaskDocument,
  WorkTaskDocument,
} from "../contract/workerTask.ts";
import type {
  AttemptPlacement,
  ExecutionProfile,
  WorkTaskInvocation,
} from "./executionScheduler.ts";
import type {
  SessionPlacement,
  SessionTaskInvocation,
} from "./sessionScheduler.ts";
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

/** What a session attempt's rows say of the task its pod runs, none of which the session can change. */
export type SessionTaskIdentity = Pick<
  SessionPlacement,
  "partition" | "session" | "attempt" | "generation" | "kind" | "credentialSlot"
>;

/** A session task without the site data its launcher adds. */
export type SessionTask = Omit<
  SessionTaskDocument,
  "workerPlane" | "api" | "bounds"
>;

/** What a session placement is invoked with, in the shape it is recorded and handed over in. */
export function sessionTaskInvocation(
  placing: Pick<
    SessionPlacement,
    "capabilities" | "agentReference" | "authority" | "repository"
  >,
): SessionTaskInvocation {
  return {
    capabilities: placing.capabilities,
    ...(placing.agentReference === undefined
      ? {}
      : { agentReference: placing.agentReference }),
    authority: placing.authority,
    ...(placing.repository === undefined
      ? {}
      : { repository: { reference: placing.repository } }),
  };
}

/** One session task, its keys in the order the pod document carries them. */
export function sessionTask(
  identity: SessionTaskIdentity,
  invocation: SessionTaskInvocation,
): SessionTask {
  return {
    tenant: identity.partition.tenant,
    project: identity.partition.project,
    session: identity.session,
    kind: identity.kind,
    attempt: identity.attempt,
    generation: identity.generation,
    capabilities: invocation.capabilities,
    credentialSlot: identity.credentialSlot,
    ...(invocation.agentReference === undefined
      ? {}
      : { agentReference: invocation.agentReference }),
    authority: invocation.authority,
    ...(invocation.repository === undefined
      ? {}
      : { repository: invocation.repository }),
  };
}
