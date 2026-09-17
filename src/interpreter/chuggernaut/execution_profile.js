export const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function execution_profile(value) {
  if (!object(value)) throw new Error("execution profile must be a mapping");
  for (const key of Object.keys(value))
    if (
      !["required_capabilities", "runner_command", "cpu", "memory_mb"].includes(
        key,
      )
    )
      throw new Error(`unknown execution profile field: ${key}`);
  const caps = value.required_capabilities;
  if (
    !Array.isArray(caps) ||
    caps.some((c) => typeof c !== "string" || !PROFILE_NAME.test(c))
  )
    throw new Error(
      "required_capabilities must be a list of capability tokens (letters, digits, underscore, hyphen; 1–63 characters)",
    );
  const command = value.runner_command;
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    command.some(
      (c) => typeof c !== "string" || c.length === 0 || c.includes("\0"),
    )
  )
    throw new Error(
      "runner_command must be a nonempty argv of nonempty strings without NUL",
    );
  const cpu = value.cpu === undefined ? 1000 : value.cpu,
    memory = value.memory_mb === undefined ? 1024 : value.memory_mb;
  for (const [key, v] of [
    ["cpu", cpu],
    ["memory_mb", memory],
  ])
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1)
      throw new Error(`${key} must be a positive integer`);
  return Object.freeze({
    required_capabilities: Object.freeze([...new Set(caps)].sort()),
    runner_command: Object.freeze([...command]),
    cpu: cpu,
    memory_mb: memory,
  });
}
export function frozen_execution_profile(value) {
  if (
    !object(value) ||
    typeof value.name !== "string" ||
    !PROFILE_NAME.test(value.name)
  )
    throw new Error("frozen execution profile requires a valid name");
  const { name, ...configuration } = value;
  return Object.freeze({ name, ...execution_profile(configuration) });
}
