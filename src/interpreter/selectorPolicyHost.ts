/**
 * The host every selector policy runs under: one deadline over the run, one
 * retained run per decision, and a termination the caller can prove.
 *
 * THE DISCIPLINE WAS NEVER THE PROTOCOL. This module was written for a policy
 * reached over HTTP and named for it, but nothing it holds is transport: the
 * race against the control deadline, the map that makes a retried decision find
 * its own run, and the rule that a cancellation is worth nothing without a
 * proof are the same whether the policy is a wire away or a mailbox away. Only
 * the protocol was trusted over a wire.
 */

import type { Partition } from "./projectStore.ts";
import type { LeadAdmission } from "./sessionPlacement.ts";
import type {
  SelectorPolicyHost,
  SelectorPolicyRequest,
  SelectorPolicyRun,
  SelectorTerminationResult,
  SelectorTurnStanding,
} from "./selector.ts";

export interface SelectorPolicy {
  /** What the host answers `leadAdmission` with. */
  leadAdmission(partition: Partition): Promise<LeadAdmission>;
  execute(
    request: SelectorPolicyRequest,
    signal: AbortSignal,
  ): Promise<unknown>;
  cancel(
    attempt: string,
    signal: AbortSignal,
  ): Promise<SelectorTerminationResult>;
  inspect(
    attempt: string,
    signal: AbortSignal,
  ): Promise<SelectorTerminationResult>;
  /** Where the turn a decision offered stands, which reads and offers nothing. */
  standing(attempt: string, signal: AbortSignal): Promise<SelectorTurnStanding>;
  /** The turn a decision already offered, waited on and answered as `execute` answers it, offering nothing. */
  resume(request: SelectorPolicyRequest, signal: AbortSignal): Promise<unknown>;
}

export interface SelectorHostDeadline {
  after(milliseconds: number, signal: AbortSignal): Promise<never>;
}

export interface SelectorPolicyHostConfig {
  readonly controlDeadlineMs: number;
}

function checkedControlDeadline(milliseconds: number): number {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1)
    throw new RangeError("selector host control deadline must be positive");
  return milliseconds;
}

function boundedControl<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  deadline: SelectorHostDeadline,
  milliseconds: number,
): Promise<T> {
  const control = new AbortController();
  return Promise.race([
    operation(control.signal),
    deadline.after(milliseconds, control.signal),
  ]).finally(() => {
    control.abort();
  });
}

/**
 * One retained run per decision, whichever door began it: a retried decision
 * finds its own run, and its termination is a cancellation with proof.
 */
function selectorPolicyRun(
  runs: Map<string, SelectorPolicyRun>,
  attempt: string,
  execute: (signal: AbortSignal) => Promise<unknown>,
  cancel: () => Promise<SelectorTerminationResult>,
): SelectorPolicyRun {
  const retained = runs.get(attempt);
  if (retained !== undefined) return retained;
  const execution = new AbortController();
  const result = execute(execution.signal).finally(() => {
    runs.delete(attempt);
  });
  const run: SelectorPolicyRun = {
    result,
    terminate: () => {
      execution.abort();
      return cancel();
    },
  };
  runs.set(attempt, run);
  return run;
}

/** Runs policy code with only its request and an abort signal. */
export function selectorPolicyHost(
  policy: SelectorPolicy,
  deadline: SelectorHostDeadline,
  config: SelectorPolicyHostConfig,
): SelectorPolicyHost {
  const controlDeadlineMs = checkedControlDeadline(config.controlDeadlineMs);
  const runs = new Map<string, SelectorPolicyRun>();
  const bounded = async (
    attempt: string,
    door: (
      attempt: string,
      signal: AbortSignal,
    ) => Promise<SelectorTerminationResult>,
  ): Promise<SelectorTerminationResult> => {
    try {
      return await boundedControl(
        (signal) => door(attempt, signal),
        deadline,
        controlDeadlineMs,
      );
    } catch {
      return { status: "Unconfirmed" };
    }
  };
  const cancel = (attempt: string) =>
    bounded(attempt, (named, signal) => policy.cancel(named, signal));
  return {
    productionReady: true,
    leadAdmission: (partition) => policy.leadAdmission(partition),
    start: (request) =>
      selectorPolicyRun(
        runs,
        request.attempt,
        (signal) => policy.execute(request, signal),
        () => cancel(request.attempt),
      ),
    resume: (request) =>
      selectorPolicyRun(
        runs,
        request.attempt,
        (signal) => policy.resume(request, signal),
        () => cancel(request.attempt),
      ),
    turnStanding: (attempt) =>
      boundedControl(
        (signal) => policy.standing(attempt, signal),
        deadline,
        controlDeadlineMs,
      ),
    withdraw: cancel,
    reconcileQuarantined: (attempt) =>
      bounded(attempt, (named, signal) => policy.inspect(named, signal)),
  };
}
