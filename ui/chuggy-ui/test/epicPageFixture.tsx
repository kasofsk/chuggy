/**
 * One epic as its page reads it: the epic, its graph, its history, the
 * project's ticket list and its people, each a value a case may move as
 * another's write would, and the page drawn over them with the tab a case
 * names.
 */

import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";
import type { ReactNode } from "react";

import { EpicPage } from "../app/browser/EpicPage.tsx";
import { EpicOverviewTab } from "../app/browser/epic/EpicPageTabs.tsx";
import { renderCopied } from "./copied.tsx";
import { leadPartition } from "./leadFixture.ts";
import { abilitiesFetch } from "./projectAbilitiesFixture.ts";
import type { AbilitiesAnswer } from "./projectAbilitiesFixture.ts";
import {
  answer,
  openedStream,
  scriptedFetch,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";

export const epicView = {
  number: 7,
  revision: 3,
  title: "Billing",
  summary: "All of billing",
  description: "The **whole** of billing",
  visibility: "Active",
  progress: {
    byPhase: {
      Pending: 1,
      Work: 0,
      Evaluation: 0,
      Finalization: 0,
      Done: 1,
      Escalated: 0,
      Revoked: 0,
    },
    drafts: 0,
    done: 1,
    total: 2,
  },
  status: "in_progress",
  waitingOnOutside: [2],
  tickets: [4, 5],
};

/** Another epic at the same revision, whose content only its own form may send. */
export const epicOtherView = {
  ...epicView,
  number: 8,
  title: "Search",
  summary: "All of search",
  tickets: [6],
};

export const epicGraph = {
  nodes: [
    { ticket: 2, title: "Schema", phase: "Work", member: false },
    { ticket: 4, title: "Charge", phase: "Done", member: true },
    { ticket: 5, title: "Refund", phase: "Pending", member: true },
  ],
  edges: [
    { from: 2, to: 5 },
    { from: 4, to: 5 },
  ],
};

function epicRevision(revision: number) {
  return {
    revision,
    changedAt: "2026-10-01T00:00:00Z",
    actor: { kind: "user", subject: "dana" },
    title: `Billing ${String(revision)}`,
    visibility: "Active",
    changes:
      revision === 1
        ? { kind: "Created" }
        : { kind: "Revised", fields: ["title"], added: [], removed: [] },
  };
}

export const epicHistory = { revisions: [epicRevision(3)] };

/** The history's first page with an older one after it, and that older page. */
export const epicHistoryPaged = {
  first: { revisions: [epicRevision(3), epicRevision(2)], nextAfter: 2 },
  older: { revisions: [epicRevision(1)] },
};

/** A row of the project's ticket list, with the run it last had if any. */
export function epicRow(
  ticket: number,
  phase: string,
  run?: { readonly status: string; readonly cycle: number },
): unknown {
  return {
    ticket,
    title: `Row ${String(ticket)}`,
    phase,
    sequence: 40 + ticket,
    ...ticketInstants,
    ...(run === undefined
      ? {}
      : {
          latestExecution: {
            execution: `execution-${String(ticket)}`,
            task: ticket,
            identity: { type: "WorkTask", value: { ticket, cycle: run.cycle } },
            status: run.status,
            requirement: {
              mode: "Container",
              operatingSystem: "Linux",
              architecture: "Amd64",
              image: "chuggy/worker",
            },
            registeredAt: "2026-08-27T00:00:00Z",
          },
        }),
  };
}

/** What the API answers now; a case moves a value as another's write would. */
export const epicServing = {
  view: epicView as unknown,
  graph: epicGraph as unknown,
  graphStatus: 200,
  history: epicHistory as unknown,
  older: { revisions: [] } as unknown,
  rows: [] as readonly unknown[],
};

export function epicServingReset(): void {
  epicServing.view = epicView;
  epicServing.graph = epicGraph;
  epicServing.graphStatus = 200;
  epicServing.history = epicHistory;
  epicServing.older = { revisions: [] };
  epicServing.rows = [];
}

function epicServed(
  written: (request: SentRequest) => Response,
): (request: SentRequest) => Response {
  return (request) => {
    const { url } = request;
    if (request.method !== "GET") return written(request);
    if (url.endsWith("/graph"))
      return answer(epicServing.graph, epicServing.graphStatus);
    if (url.includes("/history"))
      return answer(
        url.includes("after=") ? epicServing.older : epicServing.history,
      );
    if (url.endsWith("/epics/8")) return answer(epicOtherView);
    if (url.endsWith("/people"))
      return answer({
        ...leadPartition,
        people: [],
        otherIssuers: 0,
        truncated: false,
      });
    if (url.includes("/projects/atlas?"))
      return answer({
        partition: leadPartition,
        sequence: 900,
        tickets: epicServing.rows,
      });
    return answer(epicServing.view);
  };
}

export function epicQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** The page under a harness, its address's tab inside it. */
export function EpicPageHarness(props: {
  readonly client: QueryClient;
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <ScreenHarness
      partition={leadPartition}
      client={props.client}
      transport={openedStream().ports.fetch}
    >
      <EpicPage>{props.children ?? <EpicOverviewTab />}</EpicPage>
    </ScreenHarness>
  );
}

/** The page drawn and settled, every request it sends recorded. */
export async function epicPageDrawn(
  abilities: AbilitiesAnswer,
  options: {
    readonly written?: (request: SentRequest) => Response;
    readonly client?: QueryClient;
    readonly tab?: ReactNode;
    /** Whether the reader takes motion; a case stating nothing takes none. */
    readonly motion?: boolean;
  } = {},
): Promise<{
  readonly sent: readonly SentRequest[];
  readonly client: QueryClient;
  readonly rerender: (tab: ReactNode) => void;
}> {
  const client = options.client ?? epicQueryClient();
  const scripted = scriptedFetch(
    epicServed(options.written ?? (() => answer({}, 503))),
  );
  vi.stubGlobal("fetch", abilitiesFetch(abilities, scripted.fetch));
  viewportAtEm(
    viewportDeskEm,
    options.motion === undefined ? undefined : { motion: options.motion },
  );
  const drawn = renderCopied(
    <EpicPageHarness client={client}>{options.tab}</EpicPageHarness>,
  );
  await settled();
  return {
    sent: scripted.sent,
    client,
    rerender: (tab) => {
      drawn.rerender(<EpicPageHarness client={client}>{tab}</EpicPageHarness>);
    },
  };
}
