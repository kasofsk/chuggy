/**
 * One epic, as a header over three tabs: its title, where its tickets stand
 * and what may be done to it, and under the tabs its overview with the graph
 * first, its tickets as the ticket list draws them, and its revisions.
 *
 * Every read is made here, once, and handed to whichever tab is drawn, so a
 * tab switch reads nothing again, and one clock ticks the whole page. The
 * graph is read again whenever the epic's revision moves or the ticket list's
 * rows do, which is how a card's state and its train keep up with the tickets.
 * The figures are the API's and nothing here derives them.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { epicGraphQuery, epicHistoryQuery, epicQuery } from "../core/epics.ts";
import { projectAbilityRefused } from "../core/projectAbilities.ts";
import { ticketListAskDefault } from "../core/projectTableFilters.ts";
import type { ProjectTicketRows } from "../core/projectTicketPages.ts";
import { ticketRowsQuery } from "../core/ticketQueries.ts";
import { usePanelState } from "./api.ts";
import { useCreatorEmails } from "./creatorEmails.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { EpicHeader } from "./epic/EpicHeader.tsx";
import { EpicPageHeldProvider } from "./epic/EpicPageHeld.tsx";
import type { EpicPageHeld } from "./epic/EpicPageHeld.tsx";
import { EpicTabs } from "./epic/EpicTabs.tsx";
import { FreshnessInstants, useNowMs } from "./Freshness.tsx";
import { useProjectAbilities } from "./projectAbilities.tsx";
import { ScreenTitle } from "./shell/slots.tsx";
import { readValue } from "./ticket/TicketPageHeld.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";

/** The graph read again once the epic's revision or the ticket list's rows
 * move past what this page last drew, and never for the first of either. */
function useEpicGraphLive(
  partition: PartitionIdentity,
  epic: number,
  revision: number | undefined,
  rows: ProjectTicketRows | undefined,
): void {
  const client = useQueryClient();
  const seen = useRef({ revision, rows });
  useEffect(() => {
    const before = seen.current;
    seen.current = { revision, rows };
    const moved =
      (before.revision !== undefined && before.revision !== revision) ||
      (before.rows !== undefined && before.rows !== rows);
    if (moved)
      void client.invalidateQueries({
        queryKey: epicGraphQuery(partition, epic).queryKey,
        exact: true,
      });
  }, [client, partition, epic, revision, rows]);
}

function EpicPageOf(props: {
  readonly partition: PartitionIdentity;
  readonly epic: number;
  readonly children: ReactNode;
}): ReactNode {
  const { partition, epic } = props;
  const text = useCopyText();
  const nowMs = useNowMs();
  const epicState = usePanelState(epicQuery(partition, epic));
  const graphState = usePanelState(epicGraphQuery(partition, epic));
  const historyState = usePanelState(
    epicHistoryQuery(partition, epic, undefined),
  );
  const rowsState = usePanelState(
    ticketRowsQuery(partition, ticketListAskDefault),
  );
  const creatorEmails = useCreatorEmails(partition);
  const writing = !projectAbilityRefused(
    useProjectAbilities(partition),
    "writeEpic",
  );
  useEpicGraphLive(
    partition,
    epic,
    readValue(epicState)?.revision,
    readValue(rowsState),
  );
  if (!Number.isSafeInteger(epic) || epic <= 0)
    return (
      <EmptyState label={text({ id: "epics-not-found" })} variant="page" />
    );
  const held: EpicPageHeld = {
    partition,
    epic,
    epicState,
    graphState,
    historyState,
    rowsState,
    creatorEmails,
    writing,
    nowMs,
  };
  const view = readValue(epicState);
  return (
    <FreshnessInstants>
      <div className="grid min-w-0 gap-4" data-fills-width>
        <ScreenTitle>{text({ id: "epics-page-title" })}</ScreenTitle>
        {view === undefined ? (
          <PanelUnready state={epicState} />
        ) : (
          <EpicHeader held={held} view={view} />
        )}
        <EpicTabs
          partition={partition}
          epic={epic}
          memberCount={view?.tickets.length}
        />
        <EpicPageHeldProvider value={held}>
          {props.children}
        </EpicPageHeldProvider>
      </div>
    </FreshnessInstants>
  );
}

/** The layout every tab is drawn in, handed the tab its address names, and
 * drawn afresh for each epic it names, so that nothing it holds of one epic
 * is drawn at another's address. */
export function EpicPage(props: { readonly children: ReactNode }): ReactNode {
  const params = useParams({ from: "/$tenant/$project/epics/$epic" });
  return (
    <EpicPageOf
      key={`${params.tenant}/${params.project}/${params.epic}`}
      partition={{ tenant: params.tenant, project: params.project }}
      epic={Number(params.epic)}
    >
      {props.children}
    </EpicPageOf>
  );
}
