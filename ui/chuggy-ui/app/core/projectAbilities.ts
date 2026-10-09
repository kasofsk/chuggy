/**
 * Which of a project's doors its reader may press, as the abilities read
 * answered, and the decisions every surface takes from it.
 *
 * A CONTROL IS HIDDEN ONLY ON A NO. A read that is unanswered, failed or
 * absent decides nothing, so a control is drawn as it would be had the read
 * never been made, and a reader the server would have let through is never
 * shown less for a read that went wrong.
 *
 * A READ THE SERVER WOULD REFUSE IS NOT SENT TO FIND THAT OUT. A read only one
 * door's holder is answered waits for the abilities read to settle, since a
 * page opened by its address mounts both at once, and is sent unless the
 * answer was no.
 */

import type { ProjectAbilitiesResponse } from "../../../../src/contract/responses.ts";

export type ProjectAbility = keyof ProjectAbilitiesResponse;

/** What a surface holds of the read: its answer, or nothing where it has none. */
export type ProjectAbilities = ProjectAbilitiesResponse | undefined;

/** Whether the read answered that the reader may not press this door. */
export function projectAbilityRefused(
  abilities: ProjectAbilities,
  ability: ProjectAbility,
): boolean {
  return abilities?.[ability] === false;
}

/** Where a read only one door's holder is answered stands. */
export type ProjectAbilityRead = "Held" | "Refused" | "Asked";

/** A read only this door's holder is answered: held until the abilities read
 * has `settled`, refused where it said no, and asked otherwise. */
export function projectAbilityRead(
  abilities: ProjectAbilities,
  settled: boolean,
  ability: ProjectAbility,
): ProjectAbilityRead {
  if (projectAbilityRefused(abilities, ability)) return "Refused";
  return settled ? "Asked" : "Held";
}
