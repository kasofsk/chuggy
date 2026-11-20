/**
 * A project's access tokens, read as one resource of the project and read
 * again after a token is made or deleted.
 */

import type { QueryClient } from "@tanstack/react-query";

import type { AccessTokensResponse } from "../../../../../src/contract/accessToken.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { PanelState } from "../../core/freshness.ts";
import { accessTokensQuery } from "../../core/projectQueries.ts";
import { usePanelState } from "../api.ts";

export function useAccessTokens(
  partition: PartitionIdentity,
): PanelState<AccessTokensResponse> {
  return usePanelState(accessTokensQuery(partition));
}

export async function accessTokensReread(
  client: QueryClient,
  partition: PartitionIdentity,
): Promise<void> {
  await client.invalidateQueries({
    queryKey: accessTokensQuery(partition).queryKey,
  });
}
