/**
 * What the epic page's layout reads once and hands every tab under it, so
 * switching tabs reads nothing again and one clock ticks the whole page.
 */

import { createContext, useContext } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  EpicGraphResponse,
  EpicHistoryResponse,
  EpicViewResponse,
} from "../../../../../src/contract/responses.ts";
import type { PanelState } from "../../core/freshness.ts";
import type { ProjectTicketRows } from "../../core/projectTicketPages.ts";

export interface EpicPageHeld {
  readonly partition: PartitionIdentity;
  readonly epic: number;
  readonly epicState: PanelState<EpicViewResponse>;
  readonly graphState: PanelState<EpicGraphResponse>;
  /** The newest page of the epic's revisions. */
  readonly historyState: PanelState<EpicHistoryResponse>;
  /** The rows the ticket list holds unfiltered, which a member's card and
   * row are drawn from where they hold it. */
  readonly rowsState: PanelState<ProjectTicketRows>;
  /** The emails a member row draws its creator by. */
  readonly creatorEmails: ReadonlyMap<string, string>;
  /** Whether this reader may revise the epic. */
  readonly writing: boolean;
  readonly nowMs: number;
}

const EpicPageContext = createContext<EpicPageHeld | undefined>(undefined);

export const EpicPageHeldProvider = EpicPageContext.Provider;

export function useEpicPageHeld(): EpicPageHeld {
  const held = useContext(EpicPageContext);
  if (held === undefined)
    throw new Error("an epic tab is drawn only under the epic page");
  return held;
}
