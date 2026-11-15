/** What the console calls a project to a reader, read from the inventory. */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { projectNamed } from "../core/projectNaming.ts";
import { projectsInventoryQuery } from "../core/tenantQueries.ts";
import { usePanelState } from "./api.ts";

export function useProjectNamed(): (partition: PartitionIdentity) => string {
  const inventory = usePanelState(projectsInventoryQuery());
  const held = inventory.state === "Ready" ? inventory.value : undefined;
  return (partition) => projectNamed(held, partition);
}
