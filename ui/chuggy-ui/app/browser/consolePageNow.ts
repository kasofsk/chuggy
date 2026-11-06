/** The console page the reader is on now, read off the route the router
 * matched last, as the contract names it. */

import { useRouterState } from "@tanstack/react-router";

import type { ConsolePage } from "../../../../src/contract/consolePage.ts";
import { consolePageOf } from "../core/consolePage.ts";

export function useConsolePageNow(): ConsolePage | undefined {
  return useRouterState({
    select: (state) => {
      const leaf = state.matches.at(-1);
      return leaf === undefined
        ? undefined
        : consolePageOf({
            routeId: leaf.routeId,
            params: leaf.params,
            search: state.location.search,
          });
    },
    structuralSharing: true,
  });
}
