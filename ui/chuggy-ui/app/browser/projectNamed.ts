/** What the console calls a project to a reader, and the icon it names, read
 * from the inventory. */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { projectIcon, projectNamed } from "../core/projectNaming.ts";
import { projectsInventoryQuery } from "../core/tenantQueries.ts";
import type { InventoryProject } from "../../../../src/contract/responses.ts";
import { usePanelState } from "./api.ts";

function useProjectsHeld(): readonly InventoryProject[] | undefined {
  const inventory = usePanelState(projectsInventoryQuery());
  return inventory.state === "Ready" ? inventory.value : undefined;
}

export function useProjectNamed(): (partition: PartitionIdentity) => string {
  const held = useProjectsHeld();
  return (partition) => projectNamed(held, partition);
}

export function useProjectIcon(): (
  partition: PartitionIdentity,
) => string | undefined {
  const held = useProjectsHeld();
  return (partition) => projectIcon(held, partition);
}
