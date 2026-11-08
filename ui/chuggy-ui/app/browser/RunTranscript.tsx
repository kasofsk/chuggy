/**
 * One run's transcript: the walk that reads its batches, and the run's
 * conversation drawn from them with the prompt it was handed first — the one
 * way a run is drawn, whether on its own page or on the ticket's Now card.
 *
 * The walk opens on the newest batches, then fetches the batches above the
 * highest it holds when the high-water mark on the `Execution` frame the
 * browser already receives rises — there is no poll and no follow control,
 * because neither would learn anything the frame does not already carry.
 * Earlier batches are read when a reader asks, or while nothing held draws.
 * The conversation is read-only: no turn overlay and no composer, because a
 * run's own mailbox is not this pane's to send into.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ExecutionResponse,
  RunTranscriptResponse,
} from "../../../../src/contract/responses.ts";
import type { ApiResult } from "../core/apiRequest.ts";
import { apiRunTranscript } from "../core/apiRoutes.ts";
import type { CopyText } from "../core/copy.ts";
import { runConfigurationQuery } from "../core/executionQueries.ts";
import {
  conversationExchanges,
  conversationExchangesHoldCall,
} from "../core/conversation.ts";
import { runPromptOfPanel } from "../core/runConfiguration.ts";
import type { ConversationExchange } from "../core/conversation.ts";
import type { RunPrompt } from "../core/runConfiguration.ts";
import {
  runTranscriptEarlierMerged,
  runTranscriptEnded,
  runTranscriptFailed,
  runTranscriptHeldEmpty,
  runTranscriptMerged,
  runTranscriptNextAfter,
  runTranscriptQuietAfter,
  runTranscriptRawText,
  runTranscriptRead,
  runTranscriptReadsMax,
  runTranscriptStepsCut,
  runTranscriptStepsFirst,
} from "../core/runTranscript.ts";
import type {
  RunTranscriptHeld,
  RunTranscriptReading,
} from "../core/runTranscript.ts";
import { useApiPorts, usePanelState } from "./api.ts";
import { Conversation } from "./conversation/Conversation.tsx";
import { ConversationCallAsked } from "./conversation/ConversationWorkCard.tsx";
import { ReadFailed } from "./DataPanel.tsx";
import { Button } from "./ui/Button.tsx";
import { Disclosure } from "./ui/Disclosure.tsx";
import { useCopyText } from "../copy/CopyProvider.tsx";

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
  text: CopyText,
) => RunTranscriptHeld;

function runTranscriptAnswered(
  held: RunTranscriptHeld,
  answered: ApiResult<RunTranscriptResponse>,
  merge: RunTranscriptMerge,
  text: CopyText,
): RunTranscriptHeld {
  return answered.outcome === "Ok"
    ? merge(held, answered.value, text)
    : runTranscriptFailed(held, answered);
}

type RunTranscriptReadPage = (
  after: number,
  merge: RunTranscriptMerge,
  gone: () => boolean,
) => Promise<boolean>;

/** The walk itself: the newest batches first, then those above what is held a
 * bounded number of pages at a time, then, while nothing held draws, the pages
 * beneath it, abandoned when the pane goes away. */
function useRunTranscriptWalk(
  holding: { current: RunTranscriptHeld },
  highWaterBatch: number,
  readPage: RunTranscriptReadPage,
  text: CopyText,
): void {
  useEffect(() => {
    let abandoned = false;
    const walk = async (): Promise<void> => {
      for (let read = 0; read < runTranscriptReadsMax; read += 1) {
        const after =
          runTranscriptNextAfter(holding.current, highWaterBatch) ??
          runTranscriptQuietAfter(holding.current, text);
        if (after === undefined || abandoned) return;
        if (!(await readPage(after, runTranscriptMerged, () => abandoned)))
          return;
      }
    };
    void walk();
    return () => {
      abandoned = true;
    };
  }, [holding, readPage, highWaterBatch, text]);
}

/** The read walk: the newest batches first, then those above what is held a
 * bounded number of pages at a time, then, while nothing held draws, the pages
 * beneath it, abandoned when the pane goes away. A pane follows one attempt for
 * its whole life, so a caller keys it by the attempt. */
export function useRunTranscript(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly attempt: string;
  readonly highWaterBatch: number;
}): RunTranscriptWalk {
  const ports = useApiPorts();
  const text = useCopyText();
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
      holding.current = runTranscriptAnswered(
        holding.current,
        answered,
        merge,
        text,
      );
      setHeld(holding.current);
      return answered.outcome === "Ok";
    },
    [ports, tenant, project, execution, attempt, text],
  );
  useRunTranscriptWalk(holding, highWaterBatch, readPage, text);
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
  const reading = useMemo(() => runTranscriptRead(held, text), [held, text]);
  return { held, reading, readingEarlier, readEarlier };
}

/** Whether a run's page draws only its first steps, and how it asks for every one. */
export interface RunConversationCut {
  readonly every: boolean;
  readonly onEvery: () => void;
}

function RunConversationEvery(props: {
  readonly hidden: number;
  readonly cut: RunConversationCut | undefined;
}): ReactNode {
  const text = useCopyText();
  if (props.cut === undefined || props.hidden === 0) return null;
  return (
    <div className="flex justify-center">
      <Button variant="quiet" size="sm" onClick={props.cut.onEvery}>
        {text({ id: "ticket-transcript-show-every-turn" })}
      </Button>
    </div>
  );
}

/** While the call a pane was opened at is not among what it holds, the batches
 * beneath are read, a bounded number of times, until it is or none are left. */
function useRunTranscriptCallSought(
  walk: RunTranscriptWalk,
  exchanges: readonly ConversationExchange[],
  call: string | undefined,
): void {
  const sought = useRef(0);
  const earlier = walk.reading.earlier;
  const missing =
    call !== undefined && !conversationExchangesHoldCall(exchanges, call);
  const { readingEarlier, readEarlier } = walk;
  useEffect(() => {
    if (!missing || earlier === undefined || readingEarlier) return;
    if (sought.current >= runTranscriptReadsMax) return;
    sought.current += 1;
    readEarlier(earlier.after);
  }, [missing, earlier, readingEarlier, readEarlier]);
}

function RunConversationDrawn(props: {
  readonly walk: RunTranscriptWalk;
  readonly attempt: ExecutionAttempt;
  readonly prompt: RunPrompt | undefined;
  readonly cut?: RunConversationCut | undefined;
  readonly call?: string | undefined;
}): ReactNode {
  const { walk, prompt, cut } = props;
  const text = useCopyText();
  const state = props.attempt.state;
  const ended = useMemo(
    () => runTranscriptEnded(conversationExchanges(walk.reading.items), state),
    [walk.reading, state],
  );
  useRunTranscriptCallSought(walk, ended, props.call);
  const { exchanges, hidden } =
    cut === undefined || cut.every
      ? { exchanges: ended, hidden: 0 }
      : runTranscriptStepsCut(ended, runTranscriptStepsFirst);
  const earlier = walk.reading.earlier;
  return (
    <ConversationCallAsked.Provider value={props.call}>
      <Conversation
        exchanges={exchanges}
        empty={text({ id: "ticket-transcript-empty" })}
        workOpen
        {...(prompt === undefined ? {} : { prompt })}
        {...(earlier === undefined
          ? {}
          : {
              earlier: {
                busy: walk.readingEarlier,
                onRead: () => {
                  walk.readEarlier(earlier.after);
                },
              },
            })}
      />
      <RunConversationEvery hidden={hidden} cut={cut} />
    </ConversationCallAsked.Provider>
  );
}

/** The snapshot is read only once the conversation is drawn, and under the
 * key the run's own configuration pane reads it by. */
function RunConversationPrompted(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly attempt: ExecutionAttempt;
  readonly walk: RunTranscriptWalk;
  readonly cut?: RunConversationCut | undefined;
  readonly call?: string | undefined;
}): ReactNode {
  const { partition, execution } = props;
  const attempt = props.attempt.attempt;
  const state = usePanelState(
    runConfigurationQuery(partition, execution, attempt),
  );
  return (
    <RunConversationDrawn
      walk={props.walk}
      attempt={props.attempt}
      prompt={runPromptOfPanel(state)}
      cut={props.cut}
      call={props.call}
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
  readonly cut?: RunConversationCut | undefined;
  /** The tool call it is opened at, by the call's own identity. */
  readonly call?: string | undefined;
}): ReactNode {
  const failure = props.walk.held.failure;
  const text = useCopyText();
  const subject = text({ id: "ticket-transcript-subject" });
  return (
    <>
      {failure === undefined ? null : (
        <ReadFailed subject={subject} failure={failure} />
      )}
      <div
        role="group"
        aria-label={subject}
        className="flex max-h-(--height-run-conversation) min-h-0 flex-col"
      >
        {props.attempt.run?.configuration === undefined ? (
          <RunConversationDrawn
            walk={props.walk}
            attempt={props.attempt}
            prompt={{ prompt: "NotKept" }}
            cut={props.cut}
            call={props.call}
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

/** A run's transcript as its own page draws it: how many turns it took, the
 * records it wrote as they were read, and its first steps until a reader asks
 * for every one — or every step, opened at the call an address names. */
export function RunTranscriptOfRun(
  props: RunTranscriptProps & {
    readonly turns: number | undefined;
    readonly call?: string | undefined;
  },
): ReactNode {
  const walk = useRunTranscriptOf(props);
  const [every, setEvery] = useState(props.call !== undefined);
  const [raw, setRaw] = useState(false);
  const text = useCopyText();
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-ink-3 text-sm">
          {props.turns === undefined
            ? null
            : text({ id: "ticket-turn-count", args: { count: props.turns } })}
        </span>
        <Disclosure
          open={raw}
          onOpenChange={setRaw}
          label={text({ id: "ticket-transcript-raw-json" })}
          look={{ variant: "quiet", size: "sm" }}
        >
          <pre className="preview basis-full">
            {runTranscriptRawText(walk.held)}
          </pre>
        </Disclosure>
      </div>
      <RunConversation
        partition={props.partition}
        execution={props.execution}
        attempt={props.attempt}
        walk={walk}
        call={props.call}
        cut={{
          every,
          onEvery: () => {
            setEvery(true);
          },
        }}
      />
    </div>
  );
}
