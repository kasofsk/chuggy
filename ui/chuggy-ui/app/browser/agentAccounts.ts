/**
 * The reader's own agent accounts, as every screen that says so reads them:
 * the Usage page, and the pauses on the personal runners page.
 */

import type { QueryClient } from "@tanstack/react-query";

import type { AgentAccountsResponse } from "../../../../src/contract/responses.ts";
import type { PanelState } from "../core/freshness.ts";
import { agentAccountsQuery } from "../core/tenantQueries.ts";
import { usePanelState } from "./api.ts";

export function useAgentAccounts(): PanelState<AgentAccountsResponse> {
  return usePanelState(agentAccountsQuery());
}

export async function agentAccountsReread(client: QueryClient): Promise<void> {
  await client.invalidateQueries({
    queryKey: agentAccountsQuery().queryKey,
  });
}
