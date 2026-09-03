/**
 * The project's member threads: whose each is, where it stands, and which one
 * is the reader's own.
 *
 * WHICH ONE IS MINE IS THE SERVER'S ANSWER. Nothing in this browser knows who
 * is signed in, so the listing's `mine` is what puts the reader's own thread at
 * the top and what decides whether this page offers to open one. A console that
 * worked it out from a token would be a second account of an identity it cannot
 * see.
 *
 * EVERY `Session` FRAME STALES THIS LIST. The frame is a pointer and carries no
 * body, so there is nothing to fold; and unlike a thread page, which watches one
 * session, a listing over every thread in the project is changed by any of them
 * — a thread opening, a turn landing, a session closing — so the kind is the
 * whole of the filter.
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
import { panelReason } from "../core/freshness.ts";
import { projectListReread } from "../core/projectQueryKeys.ts";
import { threadMine, threadsMineFirst } from "../core/threads.ts";
import { threadStandingTone } from "../core/tones.ts";
import { useApiPorts, usePanelList } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Identity } from "./ui/Identity.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Table } from "./ui/Table.tsx";

import "./thread/thread.css";

export const threadsListName = "threads";

function ThreadRow(props: {
  readonly partition: PartitionIdentity;
  readonly thread: ThreadEntryResponse;
}): ReactNode {
  const thread = props.thread;
  return (
    <tr>
      <td>
        <Link
          to="/$tenant/$project/threads/$session"
          params={{ ...props.partition, session: thread.session }}
        >
          <Identity label={{ text: thread.session, title: thread.session }} />
        </Link>
      </td>
      <td>{thread.mine ? <Pill tone="live">Mine</Pill> : null}</td>
      <td className={thread.owner === undefined ? "thread-absent" : undefined}>
        {thread.owner ?? "None"}
      </td>
      <td>
        <Pill tone={threadStandingTone(thread.state)}>{thread.state}</Pill>
      </td>
      <td className="num">{thread.turns}</td>
    </tr>
  );
}

/** The control a member with no thread gets, and nothing for one who has. The
 * route is idempotent, so a second press answers the thread the first opened
 * rather than a second thread. */
function ThreadOpen(props: {
  readonly partition: PartitionIdentity;
  readonly threads: readonly ThreadEntryResponse[];
}): ReactNode {
  const ports = useApiPorts();
  const navigate = useNavigate();
  const partition = props.partition;
  const [opening, setOpening] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  if (threadMine(props.threads) !== undefined) return null;
  return (
    <div className="thread-open">
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
  readonly threads: readonly ThreadEntryResponse[];
}): ReactNode {
  if (props.threads.length === 0) return <EmptyState label="No threads" />;
  return (
    <Table caption="Threads">
      <thead>
        <tr>
          <th scope="col">Thread</th>
          <th scope="col">Mine</th>
          <th scope="col">Owner</th>
          <th scope="col">State</th>
          <th scope="col">Turns</th>
        </tr>
      </thead>
      <tbody>
        {threadsMineFirst(props.threads).map((thread) => (
          <ThreadRow
            key={thread.session}
            partition={props.partition}
            thread={thread}
          />
        ))}
      </tbody>
    </Table>
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
  return (
    <div className="threads">
      <DataPanel title="Threads" state={state}>
        {(value) => (
          <>
            <ThreadOpen partition={partition} threads={value.threads} />
            <ThreadTable partition={partition} threads={value.threads} />
          </>
        )}
      </DataPanel>
    </div>
  );
}
