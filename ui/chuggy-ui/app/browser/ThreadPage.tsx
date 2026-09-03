/**
 * One member's thread: whose it is, where it stands, what has been said in it,
 * and what its session has recorded.
 *
 * THIS PAGE RE-READS ON A `Session` FRAME AND FOLDS NOTHING. The frame is a
 * pointer: migration 059 writes a JSON object naming the session and the turn or
 * the batch that moved, and the change log answers no representation for the
 * kind. So there is no body to fold — a page that tried would keep the turn it
 * opened with while the thread went on answering — and what the frame supplies
 * is only which session to ask about again.
 *
 * A FRAME NAMING ANOTHER SESSION LEAVES THIS PAGE ALONE. A project holds a
 * session per member beside its lead, so a page that re-read on every `Session`
 * frame would re-read every thread's page on every other thread's turn.
 *
 * THE COMPOSER IS THE READ'S OWN `mine` AND NOTHING THIS BROWSER DECIDED.
 * Nothing under `ui/chuggy-ui/` names a principal or decodes a token, so whose
 * thread this is can only be the server's answer — and the message door refuses
 * another member's thread whatever this page draws.
 */

import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ThreadResponse } from "../../../../src/contract/responses.ts";
import { apiThread } from "../core/apiRoutes.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  leadSessionNamed,
  leadStreamBatches,
  leadStreamListed,
} from "../core/leadTranscript.ts";
import { projectListRereadNamed } from "../core/projectQueryKeys.ts";
import { threadStanding } from "../core/threads.ts";
import { threadStandingTone } from "../core/tones.ts";
import { usePanelList } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import {
  LeadHolding,
  LeadLog,
  useLeadTranscript,
} from "./lead/LeadTranscript.tsx";
import { ThreadComposer } from "./thread/ThreadComposer.tsx";
import { ThreadTurns } from "./thread/ThreadTurns.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Field, Fields } from "./ui/Fields.tsx";
import { Pill } from "./ui/Pill.tsx";

import "./lead/lead.css";
import "./thread/thread.css";

/** The list entry one thread page keeps, named by the session it draws so two
 * threads open in two tabs are two entries and not one. */
export function threadListName(session: string): string {
  return `thread-${session}`;
}

/** The thread read, re-read on the `Session` frames that name this session and
 * left alone by the rest. The session is the address bar's, so unlike the lead's
 * panel there is nothing to learn from the read and nothing to keep. */
export function useThread(
  partition: PartitionIdentity,
  session: string,
): PanelState<ThreadResponse> {
  return usePanelList(
    projectListRereadNamed<ThreadResponse>(
      partition,
      "Session",
      threadListName(session),
      (change) => leadSessionNamed(change.resource) === session,
    ),
    (ports) => apiThread(ports, partition, session),
  );
}

function ThreadHead(props: { readonly thread: ThreadResponse }): ReactNode {
  const thread = props.thread;
  const standing = threadStanding(thread);
  return (
    <div className="thread-head">
      <div className="thread-title">
        <h1>Thread</h1>
        <p className="thread-session">{thread.session}</p>
      </div>
      <div className="thread-state">
        <Pill tone={threadStandingTone(standing)} emphasis>
          {standing}
        </Pill>
        {thread.mine ? <Pill tone="live">Mine</Pill> : null}
      </div>
      <Fields variant="inline">
        <Field name="Owner" absent={thread.owner === undefined}>
          {thread.owner ?? "None"}
        </Field>
        <Field name="Reference" absent={thread.agentReference === undefined}>
          {thread.agentReference ?? "None"}
        </Field>
      </Fields>
    </div>
  );
}

function ThreadBody(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  readonly state: PanelState<ThreadResponse>;
  readonly nowMs: number;
}): ReactNode {
  const thread = props.state.state === "Ready" ? props.state.value : undefined;
  const listed = thread !== undefined && leadStreamListed(thread);
  const held = useLeadTranscript({
    partition: props.partition,
    session: props.session,
    stream: thread?.agentReference,
    highWaterBatch: thread === undefined ? 0 : leadStreamBatches(thread),
  });
  return (
    <>
      {thread === undefined ? null : <ThreadHead thread={thread} />}
      <DataPanel title="Turns" state={props.state}>
        {(value) => <ThreadTurns thread={value} />}
      </DataPanel>
      {thread?.mine === true ? (
        <ThreadComposer partition={props.partition} session={props.session} />
      ) : null}
      <LeadHolding
        held={held}
        note={undefined}
        stream={thread?.agentReference}
        listed={listed}
        nowMs={props.nowMs}
      />
      <LeadLog held={held} stream={thread?.agentReference} listed={listed} />
    </>
  );
}

export function ThreadPage(): ReactNode {
  const params = useParams({ from: "/$tenant/$project/threads/$session" });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const session = params.session;
  const nowMs = useNowMs();
  const state = useThread(partition, session);
  if (state.state === "Absent")
    return <EmptyState label="No thread" variant="page" />;
  return (
    <div className="thread">
      <ThreadBody
        key={session}
        partition={partition}
        session={session}
        state={state}
        nowMs={nowMs}
      />
    </div>
  );
}
