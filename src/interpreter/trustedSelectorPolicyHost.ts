import type {
  SelectorPolicyHost,
  SelectorPolicyRequest,
  SelectorPolicyRun,
  SelectorTerminationResult,
} from "./selector.ts";

export interface TrustedSelectorPolicy {
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
}

export interface SelectorHostDeadline {
  after(milliseconds: number, signal: AbortSignal): Promise<never>;
}

export interface TrustedSelectorPolicyHostConfig {
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

/** Runs trusted policy code with only its request and an abort signal. */
export function trustedSelectorPolicyHost(
  policy: TrustedSelectorPolicy,
  deadline: SelectorHostDeadline,
  config: TrustedSelectorPolicyHostConfig,
): SelectorPolicyHost {
  const controlDeadlineMs = checkedControlDeadline(config.controlDeadlineMs);
  const runs = new Map<string, SelectorPolicyRun>();
  return {
    productionReady: true,
    start: (request) => {
      const retained = runs.get(request.attempt);
      if (retained !== undefined) return retained;
      const execution = new AbortController();
      const result = policy.execute(request, execution.signal).finally(() => {
        runs.delete(request.attempt);
      });
      const run: SelectorPolicyRun = {
        result,
        terminate: async () => {
          execution.abort();
          try {
            return await boundedControl(
              (signal) => policy.cancel(request.attempt, signal),
              deadline,
              controlDeadlineMs,
            );
          } catch {
            return { status: "Unconfirmed" };
          }
        },
      };
      runs.set(request.attempt, run);
      return run;
    },
    reconcileQuarantined: async (attempt) => {
      try {
        return await boundedControl(
          (signal) => policy.inspect(attempt, signal),
          deadline,
          controlDeadlineMs,
        );
      } catch {
        return { status: "Unconfirmed" };
      }
    },
  };
}
