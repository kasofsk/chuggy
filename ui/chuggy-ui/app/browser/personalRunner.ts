/**
 * The reader's own runners in a tenant, as every screen that says so reads
 * them: the My runners page, and a run of theirs waiting on them.
 */

import type { QueryClient } from "@tanstack/react-query";

import type { PersonalRunnerResponse } from "../../../../src/contract/responses.ts";
import { apiPersonalRunner } from "../core/apiRoutes.ts";
import type { PanelState } from "../core/freshness.ts";
import { tenantResourceKey } from "../core/projectQueryKeys.ts";
import { sessionPlacementPolledMs } from "../core/sessionRunners.ts";
import { usePanelTenantResource } from "./api.ts";

/** No frame says a runner polled, so the read is polled at the pace a session's standing is. */
export const personalRunnerResource = "personal-runner";

/** Answered as absent where the reader holds none. */
export function usePersonalRunner(
  tenant: string,
): PanelState<PersonalRunnerResponse> {
  return usePanelTenantResource(
    tenant,
    personalRunnerResource,
    (ports) => apiPersonalRunner(ports, tenant),
    sessionPlacementPolledMs,
  );
}

export async function personalRunnerReread(
  client: QueryClient,
  tenant: string,
): Promise<void> {
  await client.invalidateQueries({
    queryKey: tenantResourceKey(tenant, personalRunnerResource),
  });
}

/** The runners read afresh with nothing held, for the last of them taken off:
 * a polled read keeps its last answer through a failed one, and a member with
 * none is answered as absent. */
export async function personalRunnerForgotten(
  client: QueryClient,
  tenant: string,
): Promise<void> {
  await client.resetQueries({
    queryKey: tenantResourceKey(tenant, personalRunnerResource),
  });
}
