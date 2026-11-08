/**
 * The composer's `/` commands where the box is the reader's own thread: what
 * each runs, and the line each says over the box.
 *
 * `/clear` CLOSES THE THREAD THE BOX SENDS TO, THEN OPENS ANOTHER, through the
 * start the pane's New control presses, so a start on its way is busy for
 * both. It is offered where the pane hands the box that start. While the
 * thread is answering, and in a box no thread is open behind, it closes
 * nothing, and that, or a close refused, is said over the box.
 *
 * WHAT A COMMAND SAYS IS DRAWN FROM LIVE READS. `/status` reads the thread
 * and the placement as they stand and `/usage` reads its turns again on the
 * frames that name the thread, so a line left open keeps saying what is true.
 * Neither is kept anywhere: a page drawn again has said nothing.
 */

import { Fragment, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ThreadResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  conversationCommandLabel,
  conversationCommandNames,
} from "../../core/conversationCommand.ts";
import type { ConversationCommandName } from "../../core/conversationCommand.ts";
import {
  threadClearedWord,
  threadClearWithheld,
  threadStatusFacts,
  threadUsageFigures,
  threadUsageSummed,
  threadUsageTurnsText,
} from "../../core/threadCommands.ts";
import type {
  ThreadCleared,
  ThreadClearedWords,
  ThreadUsage,
} from "../../core/threadCommands.ts";
import { copyOrDataText } from "../../core/copy.ts";
import { readFailedLine } from "../../core/failureWords.ts";
import { threadUsageQuery } from "../../core/sessionQueries.ts";
import { usePanelState } from "../api.ts";
import type { ConversationCommands } from "../conversation/ConversationComposer.tsx";
import { useSessionPlacement } from "../sessionPlacement.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";

/** Every command, where the pane hands the box a start. */
const threadCommandsEvery: readonly ConversationCommandName[] =
  conversationCommandNames;

/** The commands that only read, where nothing hands the box a start. */
const threadCommandsReading: readonly ConversationCommandName[] =
  conversationCommandNames.filter((name) => name !== "clear");

/** The command whose line is drawn over the box, and why `/clear` opened
 * nothing where that is what it says. */
type ThreadCommandSaying =
  | { readonly saying: "status" | "usage" }
  | { readonly saying: "clear"; readonly why: ThreadClearedWords };

/** One line a command says: its name, then each thing it says, a dot between. */
function ThreadCommandLine(props: {
  readonly name: ConversationCommandName;
  readonly children: readonly ReactNode[];
}): ReactNode {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="num text-ink-1">
        {conversationCommandLabel(props.name)}
      </span>
      {props.children.map((said, at) => (
        <Fragment key={at}>
          <span aria-hidden="true">·</span>
          {said}
        </Fragment>
      ))}
    </p>
  );
}

function ThreadStatusSaid(props: {
  readonly partition: PartitionIdentity;
  readonly thread: ThreadResponse | undefined;
}): ReactNode {
  const text = useCopyText();
  const placement = useSessionPlacement(props.partition);
  return (
    <ThreadCommandLine name="status">
      {threadStatusFacts(props.thread, placement).map((fact) => (
        <span key={fact.term.id}>
          <span className="text-ink-3">{text(fact.term)}</span>{" "}
          {copyOrDataText(text, fact.said)}
        </span>
      ))}
    </ThreadCommandLine>
  );
}

function ThreadUsageLine(props: { readonly usage: ThreadUsage }): ReactNode {
  const text = useCopyText();
  return (
    <ThreadCommandLine name="usage">
      {[
        <span key="turns">{text(threadUsageTurnsText(props.usage))}</span>,
        ...threadUsageFigures(props.usage).map((figure) => (
          <Figure key={figure.kind} figure={figure} />
        )),
      ]}
    </ThreadCommandLine>
  );
}

function ThreadUsageSaid(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
}): ReactNode {
  const text = useCopyText();
  const state = usePanelState(threadUsageQuery(props.partition, props.session));
  switch (state.state) {
    case "Pending":
      return (
        <ThreadCommandLine name="usage">
          {[<span key="reading">{text({ id: "chat-status-loading" })}</span>]}
        </ThreadCommandLine>
      );
    case "Absent":
      return (
        <ThreadCommandLine name="usage">
          {[<span key="refused">{text({ id: "chat-status-absent" })}</span>]}
        </ThreadCommandLine>
      );
    case "Failed":
      return (
        <ThreadCommandLine name="usage">
          {[
            <span key="refused">
              {readFailedLine(undefined, state.failure)}
            </span>,
          ]}
        </ThreadCommandLine>
      );
    case "Ready":
      return <ThreadUsageLine usage={state.value} />;
  }
}

function ThreadCommandSaid(props: {
  readonly partition: PartitionIdentity;
  readonly thread: ThreadResponse | undefined;
  readonly saying: ThreadCommandSaying;
}): ReactNode {
  const text = useCopyText();
  const saying = props.saying;
  switch (saying.saying) {
    case "status":
      return (
        <ThreadStatusSaid partition={props.partition} thread={props.thread} />
      );
    case "usage":
      return props.thread === undefined ? (
        <ThreadUsageLine usage={threadUsageSummed([], true)} />
      ) : (
        <ThreadUsageSaid
          partition={props.partition}
          session={props.thread.session}
        />
      );
    case "clear":
      return (
        <ThreadCommandLine name="clear">
          {[
            <Tooltip key="why" text={saying.why.detail}>
              <span>{copyOrDataText(text, saying.why.word)}</span>
            </Tooltip>,
          ]}
        </ThreadCommandLine>
      );
  }
}

/** The commands the reader's box offers and runs, where `thread` is the one
 * it sends to and nothing for a box whose first message opens one. */
export function useThreadCommands(props: {
  readonly partition: PartitionIdentity;
  readonly thread: ThreadResponse | undefined;
  /** The messages sent that no read of the thread lists yet. */
  readonly sending: number;
  /** Closes the thread `session` names and opens another, absent where
   * nothing can. */
  readonly clear: ((session: string) => Promise<ThreadCleared>) | undefined;
}): ConversationCommands {
  const [saying, setSaying] = useState<ThreadCommandSaying | undefined>(
    undefined,
  );
  const { thread, clear } = props;
  const said = (cleared: Parameters<typeof threadClearedWord>[0]): void => {
    const why = threadClearedWord(cleared);
    setSaying(why === undefined ? undefined : { saying: "clear", why });
  };
  return {
    offered: clear === undefined ? threadCommandsReading : threadCommandsEvery,
    onCommand: (name) => {
      if (name !== "clear") {
        setSaying({ saying: name });
        return;
      }
      if (clear === undefined) return;
      if (thread === undefined) {
        said("Unopened");
        return;
      }
      const withheld = threadClearWithheld(thread, props.sending);
      if (withheld !== undefined) {
        said(withheld);
        return;
      }
      setSaying(undefined);
      void clear(thread.session).then(said);
    },
    said:
      saying === undefined ? undefined : (
        <ThreadCommandSaid
          partition={props.partition}
          thread={thread}
          saying={saying}
        />
      ),
    onDismiss: () => {
      setSaying(undefined);
    },
  };
}
