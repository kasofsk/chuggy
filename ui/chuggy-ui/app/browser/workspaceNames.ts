/** What each workspace is named to the reader, read from their own list. */

import { callerTenantsQuery } from "../core/tenantQueries.ts";
import { workspaceNames, type WorkspaceNamed } from "../core/workspaceNames.ts";
import { usePanelState } from "./api.ts";

export function useWorkspaceNames(): WorkspaceNamed {
  return workspaceNames(usePanelState(callerTenantsQuery()));
}
