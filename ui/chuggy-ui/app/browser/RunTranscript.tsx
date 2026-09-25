/**
 * One run's transcript: the walk that reads its batches, and the run's
 * conversation drawn from them with the prompt it was handed first — the one
 * way a run is drawn, whether from its ledger row or from the ticket's Now card.
 *
 * The walk opens on the newest batches, then fetches the batches above the
 * highest it holds when the high-water mark on the `Execution` frame the
 * browser already receives rises — there is no poll and no follow control,
 * because neither would learn anything the frame does not already carry.
 * Earlier batches are read only when a reader asks. The conversation is
 * read-only: no turn overlay and no composer, because a run's own mailbox is
 * not this pane's to send into.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ExecutionResponse,
  RunTranscriptResponse,
} from "../../../../src/contract/responses.ts";
import type { ApiResult } from "../core/apiRequest.ts";
import { apiRunConfiguration, apiRunTranscript } from "../core/apiRoutes.ts";
import { conversationExchanges } from "../core/conversation.ts";
import { panelReason } from "../core/freshness.ts";
import { runPromptOfPanel } from "../core/runConfiguration.ts";
import type { RunPrompt } from "../core/runConfiguration.ts";
import {
  runTranscriptEarlierMerged,
  runTranscriptEnded,
  runTranscriptFailed,
  runTranscriptFreshnessSentence,
  runTranscriptHeldEmpty,
  runTranscriptMerged,
  runTranscriptNextAfter,
  runTranscriptRead,
  runTranscriptReadsMax,
} from "../core/runTranscript.ts";
import type {
  RunTranscriptHeld,
  RunTranscriptReading,
} from "../core/runTranscript.ts";
import { useApiPorts, usePanelResource } from "./api.ts";
import { Conversation } from "./conversation/Conversation.tsx";
import { useNowMs } from "./Freshness.tsx";
import { Panel } from "./ui/Panel.tsx";

type ExecutionAttempt = ExecutionResponse["attempts"][number];

/** What a pane holds of a run's transcript, and the earlier read it may make. */
export interface RunTranscriptWalk {
  readonly held: RunTranscriptHeld;
  readonly reading: RunTranscriptReading;
  readonly readingEarlier: boolean;
  readonly readEarlier: (after: number) => void;
}

type RunTranscriptMerge = (
  held: RunTranscriptHeld,
  page: RunTranscriptResponse,
) => RunTranscriptHeld;

function runTranscriptAnswered(
  held: RunTranscriptHeld,
  answered: ApiResult<RunTranscriptResponse>,
  merge: RunTranscriptMerge,
): RunTranscriptHeld {
  return answered.outcome === "Ok"
    ? merge(held, answered.value)
    : runTranscriptFailed(held, panelReason(answered));
}

/** The read walk: the newest batches first, then those above what is held a
 * bounded number of pages at a time, abandoned when the pane goes away. A pane
 * follows one attempt for its whole life, so a caller keys it by the attempt. */
export function useRunTranscript(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly attempt: string;
  readonly highWaterBatch: number;
}): RunTranscriptWalk {
  const ports = useApiPorts();
  const [held, setHeld] = useState<RunTranscriptHeld>(runTranscriptHeldEmpty);
  const [readingEarlier, setReadingEarlier] = useState(false);
  const holding = useRef<RunTranscriptHeld>(runTranscriptHeldEmpty);
  const mounted = useRef(true);
  const { execution, attempt, highWaterBatch } = props;
  const { tenant, project } = props.partition;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  /** One page read and merged into what is held, unless the reader has gone;
   * whether it answered is whether a walk may read on. */
  const readPage = useCallback(
    async (
      after: number,
      merge: RunTranscriptMerge,
      gone: () => boolean,
    ): Promise<boolean> => {
      const partition = { tenant, project };
      const answered = await apiRunTranscript(
        ports,
        partition,
        execution,
        attempt,
        after,
      );
      if (gone()) return false;
      holding.current = runTranscriptAnswered(holding.current, answered, merge);
      setHeld(holding.current);
      return answered.outcome === "Ok";
    },
    [ports, tenant, project, execution, attempt],
  );
  useEffect(() => {
    let abandoned = false;
    const walk = async (): Promise<void> => {
      for (let read = 0; read < runTranscriptReadsMax; read += 1) {
        const after = runTranscriptNextAfter(holding.current, highWaterBatch);
        if (after === undefined || abandoned) return;
        if (!(await readPage(after, runTranscriptMerged, () => abandoned)))
          return;
      }
    };
    void walk();
    return () => {
      abandoned = true;
    };
  }, [readPage, highWaterBatch]);
  const readEarlier = useCallback(
    (after: number): void => {
      setReadingEarlier(true);
      const gone = (): boolean => !mounted.current;
      void readPage(after, runTranscriptEarlierMerged, gone).then(() => {
        if (!gone()) setReadingEarlier(false);
      });
    },
    [readPage],
  );
  const reading = useMemo(() => runTranscriptRead(held), [held]);
  return { held, reading, readingEarlier, readEarlier };
}

function RunConversationDrawn(props: {
  readonly walk: RunTranscriptWalk;
  readonly attempt: ExecutionAttempt;
  readonly prompt: RunPrompt | undefined;
}): ReactNode {
  const { walk, prompt } = props;
  const state = props.attempt.state;
  const exchanges = useMemo(
    () => runTranscriptEnded(conversationExchanges(walk.reading.items), state),
    [walk.reading, state],
  );
  const earlier = walk.reading.earlier;
  return (
    <Conversation
      exchanges={exchanges}
      empty="no transcript has been recorded yet"
      workOpen
      {...(prompt === undefined ? {} : { prompt })}
      {...(earlier === undefined
        ? {}
        : {
            earlier: {
              batches: earlier.batches,
              busy: walk.readingEarlier,
              onRead: () => {
                walk.readEarlier(earlier.after);
              },
            },
          })}
    />
  );
}

/** The snapshot is read only once the conversation is drawn, and under the
 * key the run's own configuration pane reads it by. */
function RunConversationPrompted(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly attempt: ExecutionAttempt;
  readonly walk: RunTranscriptWalk;
}): ReactNode {
  const { partition, execution } = props;
  const attempt = props.attempt.attempt;
  const state = usePanelResource(
    partition,
    "Execution",
    `${execution}/attempts/${attempt}/configuration`,
    (ports) => apiRunConfiguration(ports, partition, execution, attempt),
  );
  return (
    <RunConversationDrawn
      walk={props.walk}
      attempt={props.attempt}
      prompt={runPromptOfPanel(state)}
    />
  );
}

/** A run's conversation, the prompt it was handed first, in a bounded height
 * that scrolls itself: a live run's grows at the foot and stays on its newest
 * entry, and a settled run's is the same view with nothing arriving. */
export function RunConversation(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly attempt: ExecutionAttempt;
  readonly walk: RunTranscriptWalk;
}): ReactNode {
  const failure = props.walk.held.failure;
  return (
    <>
      {failure === undefined ? null : (
        <p className="panel-failed">could not be read — {failure}</p>
      )}
      <div
        role="group"
        aria-label="Conversation"
        className="flex max-h-(--height-run-conversation) min-h-0 flex-col"
      >
        {props.attempt.run?.configuration === undefined ? (
          <RunConversationDrawn
            walk={props.walk}
            attempt={props.attempt}
            prompt={{ prompt: "NotKept" }}
          />
        ) : (
          <RunConversationPrompted {...props} />
        )}
      </div>
    </>
  );
}

interface RunTranscriptProps {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly attempt: ExecutionAttempt;
  readonly highWaterBatch: number;
}

function useRunTranscriptOf(props: RunTranscriptProps): RunTranscriptWalk {
  return useRunTranscript({
    partition: props.partition,
    execution: props.execution,
    attempt: props.attempt.attempt,
    highWaterBatch: props.highWaterBatch,
  });
}

/** A run's conversation reading its own walk, which is what a ledger row opens
 * in one press. */
export function RunConversationFollowed(props: RunTranscriptProps): ReactNode {
  const walk = useRunTranscriptOf(props);
  return (
    <RunConversation
      partition={props.partition}
      execution={props.execution}
      attempt={props.attempt}
      walk={walk}
    />
  );
}

/** The run's transcript among its evidence: a panel saying how fresh it is,
 * round the run's conversation. */
export function RunTranscript(props: RunTranscriptProps): ReactNode {
  const walk = useRunTranscriptOf(props);
  const now = useNowMs();
  return (
    <Panel
      title="transcript"
      meta={
        <span className="freshness">
          {runTranscriptFreshnessSentence(walk.held, now)}
        </span>
      }
    >
      <RunConversation
        partition={props.partition}
        execution={props.execution}
        attempt={props.attempt}
        walk={walk}
      />
    </Panel>
  );
}
