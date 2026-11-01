/**
 * The reader's own runners in a tenant, as every screen that says so reads
 * them: the My runners page, and a run of theirs waiting on them.
 */

import type { QueryClient } from "@tanstack/react-query";

import type { PersonalRunnerResponse } from "../../../../src/contract/responses.ts";
import type { PanelState } from "../core/freshness.ts";
import { personalRunnerQuery } from "../core/tenantQueries.ts";
import { usePanelState } from "./api.ts";

/** Answered as absent where the reader holds none. */
export function usePersonalRunner(
  tenant: string,
): PanelState<PersonalRunnerResponse> {
  return usePanelState(personalRunnerQuery(tenant));
}

export async function personalRunnerReread(
  client: QueryClient,
  tenant: string,
): Promise<void> {
  await client.invalidateQueries({
    queryKey: personalRunnerQuery(tenant).queryKey,
  });
}
