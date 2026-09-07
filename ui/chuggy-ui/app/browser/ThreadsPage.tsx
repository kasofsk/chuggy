/**
 * The full list of the project's threads: filtered by owner and standing,
 * each row offering the same rename, close and hide the rail offers its own.
 *
 * THE `Open` CONTROL IS OFFERED FROM THE LISTING'S OWN `mine` AND NOTHING ELSE.
 * A page that worked out whose thread was whose in the browser would offer a
 * second thread to a member who has one, and the route — which is idempotent —
 * would answer with the thread they already had while the page said it had
 * opened one. So both arms are cases: offered where the listing carries no
 * thread of theirs, and absent where it does.
 */

import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ThreadEntryResponse,
  ThreadsResponse,
} from "../../../../src/contract/responses.ts";
import { apiOpenThread, apiThreads } from "../core/apiRoutes.ts";
import { instantFigure } from "../core/figures.ts";
import { panelReason } from "../core/freshness.ts";
import { projectListReread } from "../core/projectQueryKeys.ts";
import {
  threadLabel,
  threadOwnerFilters,
  threadPageRows,
  threadStandingFilters,
} from "../core/threads.ts";
import type {
  ThreadOwnerFilter,
  ThreadStandingFilter,
} from "../core/threads.ts";
import { threadStandingTone } from "../core/tones.ts";
import { useApiPorts, usePanelList } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import { TopBarSlot } from "./shell/slots.tsx";
import {
  ThreadEntryMenu,
  ThreadEntryRename,
  useThreadEntryActions,
} from "./thread/ThreadEntryLabel.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Table } from "./ui/Table.tsx";
import { ToggleGroup } from "./ui/ToggleGroup.tsx";

export const threadsListName = "threads";

function ThreadRow(props: {
  readonly partition: PartitionIdentity;
  readonly thread: ThreadEntryResponse;
  readonly nowMs: number;
}): ReactNode {
  const thread = props.thread;
  const actions = useThreadEntryActions(props.partition, thread);
  return (
    <tr className="group">
      <td>
        {actions.renaming ? (
          <ThreadEntryRename initial={thread.title ?? ""} actions={actions} />
        ) : (
          <Link
            to="/$tenant/$project/threads/$session"
            params={{ ...props.partition, session: thread.session }}
          >
            {threadLabel(thread)}
          </Link>
        )}
      </td>
      <td className={thread.owner === undefined ? "text-ink-3" : undefined}>
        {thread.owner ?? "None"}
      </td>
      <td>
        <Pill tone={threadStandingTone(thread.state)}>{thread.state}</Pill>
      </td>
      <td>
        <Figure figure={instantFigure(thread.lastActivityAt, props.nowMs)} />
      </td>
      <td className="num">{thread.turns}</td>
      <td>
        <div className="flex flex-col items-end gap-1">
          <ThreadEntryMenu actions={actions} />
          {actions.refused === undefined ? null : (
            <Notice
              tone="danger"
              inline
              detail={`Refused · ${actions.refused}`}
            />
          )}
        </div>
      </td>
    </tr>
  );
}

/** The control a member with no thread gets, and nothing for one who has. The
 * route is idempotent, so a second press answers the thread the first opened
 * rather than a second thread. */
function ThreadOpen(props: {
  readonly partition: PartitionIdentity;
  readonly offered: boolean;
}): ReactNode {
  const ports = useApiPorts();
  const navigate = useNavigate();
  const partition = props.partition;
  const [opening, setOpening] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  if (!props.offered) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 pb-3">
      <Button
        variant="primary"
        busy={opening}
        disabled={opening}
        onClick={() => {
          setOpening(true);
          void apiOpenThread(ports, partition).then((opened) => {
            setOpening(false);
            if (opened.outcome !== "Ok") {
              setRefused(panelReason(opened));
              return;
            }
            void navigate({
              to: "/$tenant/$project/threads/$session",
              params: { ...partition, session: opened.value.session },
            });
          });
        }}
      >
        Open
      </Button>
      {refused === undefined ? null : (
        <Notice tone="danger" inline detail={`Refused · ${refused}`} />
      )}
    </div>
  );
}

function ThreadTable(props: {
  readonly partition: PartitionIdentity;
  readonly rows: readonly ThreadEntryResponse[];
  readonly nowMs: number;
}): ReactNode {
  if (props.rows.length === 0) return <EmptyState label="No threads" />;
  return (
    <Table caption="Threads">
      <thead>
        <tr>
          <th scope="col">Thread</th>
          <th scope="col">Owner</th>
          <th scope="col">Standing</th>
          <th scope="col">Last activity</th>
          <th scope="col">Turns</th>
          <th scope="col">Menu</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((thread) => (
          <ThreadRow
            key={thread.session}
            partition={props.partition}
            thread={thread}
            nowMs={props.nowMs}
          />
        ))}
      </tbody>
    </Table>
  );
}

function ThreadFilters(props: {
  readonly owner: ThreadOwnerFilter;
  readonly onOwner: (owner: ThreadOwnerFilter) => void;
  readonly standing: ThreadStandingFilter;
  readonly onStanding: (standing: ThreadStandingFilter) => void;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ToggleGroup
        label="Owner"
        options={threadOwnerFilters}
        value={props.owner}
        onChange={(value) => {
          const owner = threadOwnerFilters.find(
            (candidate) => candidate === value,
          );
          if (owner !== undefined) props.onOwner(owner);
        }}
      />
      <ToggleGroup
        label="Standing"
        options={threadStandingFilters}
        value={props.standing}
        onChange={(value) => {
          const standing = threadStandingFilters.find(
            (candidate) => candidate === value,
          );
          if (standing !== undefined) props.onStanding(standing);
        }}
      />
    </div>
  );
}

export function ThreadsPage(): ReactNode {
  const params = useParams({ from: "/$tenant/$project" });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const state = usePanelList(
    projectListReread<ThreadsResponse>(partition, "Session", threadsListName),
    (ports) => apiThreads(ports, partition),
  );
  const nowMs = useNowMs();
  const [owner, setOwner] = useState<ThreadOwnerFilter>("Mine");
  const [standing, setStanding] = useState<ThreadStandingFilter>("Open");
  return (
    <div className="grid min-w-0 gap-4">
      <TopBarSlot>
        <h1 className="text-md font-strong text-ink-1 truncate">Threads</h1>
      </TopBarSlot>
      <PanelUnready state={state} />
      {state.state === "Ready" ? (
        <>
          <ThreadOpen
            partition={partition}
            offered={
              !state.value.threads.some(
                (thread) => thread.mine && thread.state !== "Closed",
              )
            }
          />
          <ThreadFilters
            owner={owner}
            onOwner={setOwner}
            standing={standing}
            onStanding={setStanding}
          />
          <ThreadTable
            partition={partition}
            rows={threadPageRows(state.value.threads, owner, standing)}
            nowMs={nowMs}
          />
        </>
      ) : null}
    </div>
  );
}
