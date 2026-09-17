export declare const PROFILE_NAME: RegExp;
export interface ExecutionProfile {
  readonly required_capabilities: readonly string[];
  readonly runner_command: readonly string[];
  readonly cpu: number;
  readonly memory_mb: number;
}
export interface FrozenExecutionProfile extends ExecutionProfile {
  readonly name: string;
}
export declare function execution_profile(value: unknown): ExecutionProfile;
export declare function frozen_execution_profile(
  value: unknown,
): FrozenExecutionProfile;
