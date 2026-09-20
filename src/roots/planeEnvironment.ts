/**
 * The two reads a plane's process makes of its own environment.
 *
 * A PLANE IS COMPOSED FROM VARIABLES AND NOTHING ELSE. A missing required
 * value refuses the start rather than defaulting, and a bound that is not a
 * positive whole number refuses it too: a plane that started on a zero
 * interval is a loop with no wait in it.
 */

/** The value a process cannot start without, or the refusal naming what is absent. */
export function planeEnvironmentRequired(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

/** One bound as the environment states it, or the fallback the composition named. */
export function planeEnvironmentPositive(
  name: string,
  fallback: number,
): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(parsed))
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}
