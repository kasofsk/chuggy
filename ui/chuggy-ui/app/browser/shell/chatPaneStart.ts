/**
 * Starting a thread from the chat pane, which the header's New control and the
 * composer's `/clear` share one write of: a start on its way is busy for both,
 * and what refused an open is said once, under the header.
 *
 * NEW OPENS ANOTHER THREAD BESIDE THE READER'S AND CLOSES NONE. Each open is
 * asked under the key the project's record holds until an open answers, so a
 * press after one that failed reaches the thread that one may have opened.
 *
 * `/clear` CLOSES THE THREAD IT IS TYPED IN, THEN OPENS ANOTHER as New does,
 * in the same write and only once the close has answered `Ok`: a close
 * refused opens nothing, and its refusal is the command's to say.
 *
 * Whether a press is on its way is held in a ref as well as in the write, so a
 * second press in the same render as the first finds it busy.
 */

import type { QueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ApiFailure, ApiPorts, ApiResult } from "../../core/apiRequest.ts";
import { apiOpenThread } from "../../core/apiRoutes.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type {
  ConsoleWrite,
  ConsoleWriteRefused,
} from "../../core/consoleWrite.ts";
import { failureWords } from "../../core/failureWords.ts";
import { sessionPlacementQuery } from "../../core/projectQueries.ts";
import { sessionRefusedNoRunner } from "../../core/sessionRunners.ts";
import { threadClearedThenOpened } from "../../core/threadCommands.ts";
import type { ThreadCleared } from "../../core/threadCommands.ts";
import { apiCloseThreadAt, threadHomeOf } from "../../core/threadHome.ts";
import {
  threadLimitWord,
  threadOpenAtLimit,
  threadUnhosted,
} from "../../core/threads.ts";
import type { ThreadSend } from "../../core/threads.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { useConsoleDispatch } from "../store.ts";
import type { ConsoleDispatch } from "../store.ts";
import { threadDoorGranted, threadDoorOpened } from "../thread/threadSends.ts";
import { chatPaneOpenedAt, chatPaneOpenPressed } from "./chatPanes.ts";

/** One press of the pane's start: the open key it asks under, and for
 * `/clear` the thread it closes first. */
interface ChatPaneOpenPress {
  readonly key: string;
  readonly closing?: string;
}

/** What a press answered that the pane acts on: the thread it opened, the door
 * it met, counting the placement reads before a refusal over the hosted
 * grant, or the close `/clear` asked first refused, so nothing opened. */
type ChatPaneOpened =
  | { readonly opened: "Opened"; readonly session: string }
  | { readonly opened: "Unhosted"; readonly readsAt: number }
  | { readonly opened: "NoRunner" }
  | { readonly opened: "CloseRefused"; readonly failure: ApiFailure };

/** What an open changed of the door's reads: a refusal over the grant writes
 * it ungranted, either refusal reads the placement again, and an open on a
 * route read as hosted writes the grant given. */
async function chatPaneOpenLanded(
  client: QueryClient,
  partition: PartitionIdentity,
  opened: ChatPaneOpened,
): Promise<void> {
  const placement = sessionPlacementQuery(partition).queryKey;
  switch (opened.opened) {
    case "Opened":
      threadDoorOpened(client, partition);
      return;
    case "Unhosted":
      threadDoorGranted(client, partition, false);
      await client.invalidateQueries({ queryKey: placement });
      return;
    case "NoRunner":
      await client.invalidateQueries({ queryKey: placement });
      return;
    case "CloseRefused":
      return;
  }
}

/** One open, as the door answered it. */
async function chatPaneOpenAnswered(
  ports: ApiPorts,
  partition: PartitionIdentity,
  key: string,
  client: QueryClient,
): Promise<ApiResult<ChatPaneOpened>> {
  const answer = await apiOpenThread(ports, partition, key);
  if (threadUnhosted(answer)) {
    const placement = sessionPlacementQuery(partition).queryKey;
    const readsAt = client.getQueryState(placement)?.dataUpdateCount ?? 0;
    return { outcome: "Ok", value: { opened: "Unhosted", readsAt } };
  }
  if (sessionRefusedNoRunner(answer))
    return { outcome: "Ok", value: { opened: "NoRunner" } };
  if (answer.outcome !== "Ok") return answer;
  return {
    outcome: "Ok",
    value: { opened: "Opened", session: answer.value.session },
  };
}

/** One press of the pane's start, under the key the project's record holds,
 * an open's refusal said as the header's row says it. The thread it opened is
 * picked and the key spent in the store, which outlives the pane, whether or
 * not the pane is still drawn. */
function chatPaneOpenWrite(
  partition: PartitionIdentity,
  dispatch: ConsoleDispatch,
): ConsoleWrite<ChatPaneOpenPress, ChatPaneOpened> {
  return {
    mutationKey: consoleWriteKey(
      "thread-open",
      partition.tenant,
      partition.project,
    ),
    write: async (ports, press, client) => {
      const open = () =>
        chatPaneOpenAnswered(ports, partition, press.key, client);
      const { closing } = press;
      if (closing === undefined) return open();
      const cleared = await threadClearedThenOpened(
        () => apiCloseThreadAt(ports, threadHomeOf(partition), closing),
        open,
      );
      if (cleared.cleared === "Closed") return cleared.opened;
      return {
        outcome: "Ok",
        value: { opened: "CloseRefused", failure: cleared.failure },
      };
    },
    refusal: (failure) =>
      threadOpenAtLimit(failure)
        ? `Refused · ${threadLimitWord}`
        : failureWords(failure).word,
    landed: (client, opened) => {
      if (opened.opened === "Opened")
        dispatch(chatPaneOpenedAt({ partition, session: opened.session }));
      return chatPaneOpenLanded(client, partition, opened);
    },
  };
}

export interface ChatPaneStarting {
  readonly busy: boolean;
  /** Why the last open was refused, which the header draws. */
  readonly refused: ConsoleWriteRefused | null;
  /** Opens another thread; a press already on its way is the one this asks
   * for, so it asks again for nothing. */
  readonly started: () => void;
  /** Closes the thread `session` names and then opens another; a press
   * already on its way leaves both alone. */
  readonly cleared: (session: string) => Promise<ThreadCleared>;
}

export function useChatPaneStart(props: {
  readonly partition: PartitionIdentity;
  /** Whether the header that draws an open's refusal is drawn. */
  readonly drawn: boolean;
  readonly onOpened: (session: string) => void;
  /** What the door met, newer than the reads of it. */
  readonly onRefused: (refusal: ThreadSend) => void;
}): ChatPaneStarting {
  const { partition } = props;
  const dispatch = useConsoleDispatch();
  const opening = useConsoleWrite(chatPaneOpenWrite(partition, dispatch), {
    drawn: props.drawn,
  });
  const pressing = useRef(false);
  const answered = (opened: ChatPaneOpened): void => {
    switch (opened.opened) {
      case "Opened":
        props.onOpened(opened.session);
        return;
      case "Unhosted":
        props.onRefused({ send: "Unhosted", readsAt: opened.readsAt });
        return;
      case "NoRunner":
        props.onRefused({ send: "Idle" });
        return;
      case "CloseRefused":
        return;
    }
  };
  const pressed = (
    closing: string | undefined,
  ): Promise<ChatPaneOpened | undefined> | undefined => {
    if (pressing.current || opening.isPending) return undefined;
    pressing.current = true;
    const key = dispatch(chatPaneOpenPressed(partition));
    return new Promise((resolve) => {
      opening.mutate(closing === undefined ? { key } : { key, closing }, {
        onSuccess: (opened) => {
          answered(opened);
          resolve(opened);
        },
        onError: () => {
          resolve(undefined);
        },
        onSettled: () => {
          pressing.current = false;
        },
      });
    });
  };
  return {
    busy: opening.isPending,
    refused: opening.error,
    started: () => {
      void pressed(undefined);
    },
    cleared: async (session) => {
      const press = pressed(session);
      if (press === undefined) return { cleared: "Busy" };
      const opened = await press;
      return opened?.opened === "CloseRefused"
        ? { cleared: "Refused", failure: opened.failure }
        : { cleared: "Closed" };
    },
  };
}
