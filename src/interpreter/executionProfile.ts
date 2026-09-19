export const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;

export interface ExecutionProfile {
  readonly required_capabilities: readonly string[];
  readonly cpu: number;
  readonly memory_mb: number;
}
export interface FrozenExecutionProfile extends ExecutionProfile {
  readonly name: string;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function execution_profile(value: unknown): ExecutionProfile {
  if (!object(value)) throw new Error("execution profile must be a mapping");
  for (const key of Object.keys(value))
    if (!["required_capabilities", "cpu", "memory_mb"].includes(key))
      throw new Error(`unknown execution profile field: ${key}`);
  const caps = value["required_capabilities"];
  if (
    !Array.isArray(caps) ||
    caps.some((c) => typeof c !== "string" || !PROFILE_NAME.test(c))
  )
    throw new Error(
      "required_capabilities must be a list of capability tokens (letters, digits, underscore, hyphen; 1–63 characters)",
    );
  const cpu = value["cpu"] === undefined ? 1000 : value["cpu"],
    memory = value["memory_mb"] === undefined ? 1024 : value["memory_mb"];
  for (const [key, v] of [
    ["cpu", cpu],
    ["memory_mb", memory],
  ] as const)
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1)
      throw new Error(`${key} must be a positive integer`);
  return Object.freeze({
    required_capabilities: Object.freeze([...new Set(caps as string[])].sort()),
    cpu: cpu as number,
    memory_mb: memory as number,
  });
}
export function frozen_execution_profile(
  value: unknown,
): FrozenExecutionProfile {
  if (
    !object(value) ||
    typeof value["name"] !== "string" ||
    !PROFILE_NAME.test(value["name"])
  )
    throw new Error("frozen execution profile requires a valid name");
  const { name, ...configuration } = value;
  return Object.freeze({ name, ...execution_profile(configuration) });
}
