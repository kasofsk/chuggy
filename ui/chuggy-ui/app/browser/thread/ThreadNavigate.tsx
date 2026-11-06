/**
 * The console following a `navigate` of the reader's own project thread,
 * which the chat pane draws beside the pages it moves between. What is due is
 * the core's to decide; this asks it with the page the router stands on and
 * the calls this browser already followed, and records a call as followed
 * before it moves, so a tab reading the same mailbox after it does not move
 * as well.
 */

import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import type { ReactNode } from "react";

import type { ThreadResponse } from "../../../../../src/contract/responses.ts";
import type { ConversationExchange } from "../../core/conversation.ts";
import { consolePageHref } from "../../core/consolePage.ts";
import type { ThreadHome } from "../../core/threadHome.ts";
import {
  threadNavigateAppliedRead,
  threadNavigateAppliedWith,
  threadNavigateAppliedWrite,
  threadNavigateDue,
} from "../../core/threadOffers.ts";
import { useConsolePageNow } from "../consolePageNow.ts";
import { persistentStore } from "../ports.ts";

function useThreadNavigateFollowed(
  home: ThreadHome,
  thread: ThreadResponse,
  exchanges: readonly ConversationExchange[],
): void {
  const page = useConsolePageNow();
  const navigate = useNavigate();
  const due =
    home.scope === "Project"
      ? threadNavigateDue({
          mine: thread.mine,
          exchanges,
          page,
          applied: threadNavigateAppliedRead(persistentStore),
        })
      : undefined;
  const call = due?.call;
  const href =
    due === undefined || home.scope !== "Project"
      ? undefined
      : consolePageHref(home.partition, due.page);
  useEffect(() => {
    if (call === undefined || href === undefined) return;
    const applied = threadNavigateAppliedRead(persistentStore);
    if (applied.includes(call)) return;
    threadNavigateAppliedWrite(
      persistentStore,
      threadNavigateAppliedWith(applied, call),
    );
    void navigate({ href });
  }, [call, href, navigate]);
}

/** Draws nothing, and moves the console where the thread's newest exchange
 * asks it to. */
export function ThreadNavigateFollowed(props: {
  readonly home: ThreadHome;
  readonly thread: ThreadResponse;
  readonly exchanges: readonly ConversationExchange[];
}): ReactNode {
  useThreadNavigateFollowed(props.home, props.thread, props.exchanges);
  return null;
}
