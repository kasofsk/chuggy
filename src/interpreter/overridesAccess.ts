/**
 * What a principal must hold to make a ticket run something other than the
 * configuration a repository checked in: the project's `OverrideTicketConfig`
 * where the ticket names overrides, and `Mutate` where it names none.
 *
 * A REVISION ASKS ONLY FOR WHAT IT CHANGES. One carrying exactly the overrides
 * the draft it is fenced on already holds sets nothing, so whoever may revise
 * a draft may revise one someone else overrode, and one carrying none
 * moves the draft back onto what was checked in.
 */

import { isDeepStrictEqual } from "node:util";

import type { ConfigurationOverrides } from "../contract/configurationOverrides.ts";
import type { DraftResource } from "./authoring.ts";
import type { ProjectAccessKind } from "./projectAccess.ts";

/** Whether overrides name any field, an empty set naming none. */
export function overridesNamed(
  overrides: ConfigurationOverrides | undefined,
): boolean {
  return (
    overrides !== undefined &&
    Object.values(overrides).some((field) => field !== undefined)
  );
}

/** What writing these overrides onto a ticket asks of its writer. */
export function overridesAccess(
  overrides: ConfigurationOverrides | undefined,
): ProjectAccessKind {
  return overridesNamed(overrides) ? "OverrideTicketConfig" : "Mutate";
}

/** What a revision asks of its writer, against the draft as it stood when it was read. */
export function overridesRevisionAccess(
  stored: DraftResource | undefined,
  input: {
    readonly expectedVersion: number;
    readonly overrides?: ConfigurationOverrides | undefined;
  },
): ProjectAccessKind {
  if (!overridesNamed(input.overrides)) return "Mutate";
  return stored?.authoringVersion === input.expectedVersion &&
    isDeepStrictEqual(stored.overrides, input.overrides)
    ? "Mutate"
    : "OverrideTicketConfig";
}
