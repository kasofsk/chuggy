/**
 * The two refusals every checked configuration in this layer owes, driven from
 * a deployment's defaults rather than from a list.
 *
 * READING THE DEFAULTS IS WHAT MAKES THE COVERAGE FOLLOW THE INTERFACE. A bound
 * added to a configuration arrives in its defaults, so it is varied and dropped
 * here without being named — where a listed set of bounds would quietly stop
 * covering the newest one.
 */

import assert from "node:assert/strict";

/** The values no bound may take, each of which a checker must refuse by name. */
const refusedValues: readonly number[] = [
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
];

/** Asserts that the checker refuses the named bound at the named value, and says which by name. */
function assertBoundIsRefused<Config extends object>(
  checked: (config: Config) => Config,
  offered: Config,
  name: string,
  why: string,
): void {
  assert.throws(
    () => checked(offered),
    (error: unknown) => {
      assert.ok(error instanceof RangeError);
      assert.match(error.message, new RegExp(`\\b${name}\\b`, "u"));
      return true;
    },
    why,
  );
}

/** Drives one checker over every bound its defaults name, at each value and with each one absent. */
export function assertBoundsAreRefused<Config extends object>(
  defaults: Config,
  checked: (config: Config) => Config,
): void {
  const bounds = Object.keys(defaults);
  assert.ok(
    bounds.length > 0,
    "the defaults name no bound, so this proves nothing",
  );
  for (const name of bounds) {
    for (const value of refusedValues) {
      assertBoundIsRefused(
        checked,
        { ...defaults, [name]: value },
        name,
        `${name} accepted ${String(value)}`,
      );
    }
    assertBoundIsRefused(
      checked,
      Object.fromEntries(
        Object.entries(defaults).filter(([named]) => named !== name),
      ) as Config,
      name,
      `a configuration naming no ${name} was accepted`,
    );
  }
}
