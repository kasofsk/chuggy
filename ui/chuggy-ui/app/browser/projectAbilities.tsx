/**
 * The reader's abilities in a project, read once however many surfaces ask,
 * and the one line drawn where a reader who can change nothing would have
 * typed.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { apiProjectAbilities } from "../core/apiRoutes.ts";
import type { ApiPorts } from "../core/apiRequest.ts";
import { projectAbilityRead } from "../core/projectAbilities.ts";
import type {
  ProjectAbilities,
  ProjectAbility,
  ProjectAbilityRead,
} from "../core/projectAbilities.ts";
import { usePanelResource, usePanelResourceSettled } from "./api.ts";
import { Notice } from "./ui/Notice.tsx";

/** No frame names the abilities, so the partition's own refetch reaches them. */
export const projectAbilitiesResource = "abilities";

function abilitiesRead(partition: PartitionIdentity) {
  return (ports: ApiPorts) => apiProjectAbilities(ports, partition);
}

/** What the abilities read answered, and nothing where it has not. */
export function useProjectAbilities(
  partition: PartitionIdentity,
): ProjectAbilities {
  const state = usePanelResource(
    partition,
    "Project",
    projectAbilitiesResource,
    abilitiesRead(partition),
  );
  return state.state === "Ready" ? state.value : undefined;
}

/** Where a read only `ability`'s holder is answered stands for this reader,
 * held until the abilities read first comes back and never again after. */
export function useProjectAbilityRead(
  partition: PartitionIdentity,
  ability: ProjectAbility,
): ProjectAbilityRead {
  const { state, settled } = usePanelResourceSettled(
    partition,
    "Project",
    projectAbilitiesResource,
    abilitiesRead(partition),
  );
  return projectAbilityRead(
    state.state === "Ready" ? state.value : undefined,
    settled,
    ability,
  );
}

/** The line drawn in place of a composer or a form the reader may not send. */
export function ViewOnlyNotice(): ReactNode {
  return <Notice tone="parked" inline detail="View only" />;
}
