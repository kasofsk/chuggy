/**
 * One frame for every screen: the bar across the top, and under it the pages
 * and the chat dividing what is left.
 *
 * THE BAR SPANS THE FRAME AND OUTLIVES EVERY STATE OF IT. The nav reaches every
 * screen and the banner speaks for all of them, so the bar is neither something
 * the chat pane takes width from nor something a full screen covers — a reader
 * who filled the frame with the chat still has every screen one press away.
 *
 * The chat pane is where the reader talks to the project, so it outlives every
 * navigation under it: the pages change beneath the bar and the conversation
 * does not. It takes the body three ways and no fourth — a column beside the
 * pages, the whole body, or the strip its own control expands — and a viewport
 * too narrow to divide stacks that column under the pages instead.
 *
 * The banner is not decoration — it is the only place a reader learns that what
 * the screens below are showing is no longer arriving live.
 */

import { Outlet } from "@tanstack/react-router";
import { Separator } from "radix-ui";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import {
  chatPaneContentDrawn,
  chatPaneNarrowed,
  chatPaneStripped,
} from "../core/chatPane.ts";
import type { ChatPanePlacement, ChatPaneState } from "../core/chatPane.ts";
import {
  projectStreamCarrying,
  projectStreamUnanswered,
} from "../core/projectStream.ts";
import { ChatPane } from "./shell/ChatPane.tsx";
import { ChatPaneProvider, useChatPane } from "./shell/chatPaneHeld.tsx";
import { DetailsPane } from "./shell/DetailsPane.tsx";
import { TicketReferenceWiring } from "./ticket/TicketReferenceWiring.tsx";
import { ShellSlots } from "./shell/slots.tsx";
import { TopBar } from "./shell/TopBar.tsx";
import { useViewportAtLeastEm, viewportTwoColumnEm } from "./shell/viewport.ts";
import {
  useProjectFallbackExhausted,
  useProjectStreamStatus,
} from "./stream.tsx";
import { Notice } from "./ui/Notice.tsx";
import "./shell/shell.css";

/**
 * What the reader is told, which is the other half of what `useStreamFallback`
 * reads on: the fallback runs while the stream is not carrying, and this speaks
 * while it is not carrying and has opened at least once. So a reopen is drawn —
 * the screen is stale and the reader should know it — and a first paint is not,
 * because nothing has stopped arriving yet.
 */
export function StreamBanner(): ReactNode {
  const status = useProjectStreamStatus();
  const exhausted = useProjectFallbackExhausted();
  if (projectStreamCarrying(status) || projectStreamUnanswered(status))
    return null;
  const detail =
    status.reason ??
    (status.source === "degraded" ? "Change log degraded" : "Stream not open");
  return (
    <Notice
      tone="parked"
      role="status"
      heading="Not live"
      detail={exhausted ? "Stream closed · fallback exhausted" : detail}
    />
  );
}

/** The tracks the body below the bar takes, total over the placements so a
 * placement the roster grows stops compiling rather than drawing one column. */
const shellBodyTracks: Readonly<Record<ChatPanePlacement, string>> = {
  Right: "grid-cols-[minmax(0,1fr)_var(--width-chat)]",
  Left: "grid-cols-[var(--width-chat)_minmax(0,1fr)]",
  Bottom: "grid-rows-[minmax(0,1fr)_var(--height-chat)]",
};

/** The same tracks for a collapsed pane, which is a strip of its own width
 * rather than a share of the frame. */
const shellStripTracks: Readonly<Record<ChatPanePlacement, string>> = {
  Right: "grid-cols-[minmax(0,1fr)_var(--width-chat-strip)]",
  Left: "grid-cols-[var(--width-chat-strip)_minmax(0,1fr)]",
  Bottom: "grid-rows-[minmax(0,1fr)_var(--width-chat-strip)]",
};

/** The edge the pane draws against the pages, which is the side the pages are
 * on. */
const shellPaneEdges: Readonly<Record<ChatPanePlacement, string>> = {
  Right: "border-l border-edge",
  Left: "border-r border-edge",
  Bottom: "border-t border-edge",
};

function shellBodyTracksDrawn(chat: ChatPaneState): string {
  if (!chatPaneContentDrawn(chat)) return "grid-cols-1";
  return chatPaneStripped(chat)
    ? shellStripTracks[chat.placement]
    : shellBodyTracks[chat.placement];
}

/**
 * The shell's own element, which states whether the stream is carrying because
 * the banner no longer answers that: the banner is silent when the stream is
 * live and silent again when a first connection has not been answered.
 *
 * It is also the containing block for anything positioned inside it, so a
 * hidden caption placed absolutely is clipped with the frame rather than
 * lengthening the document below it.
 */
export function ShellFrame(props: { readonly children: ReactNode }): ReactNode {
  const carrying = projectStreamCarrying(useProjectStreamStatus());
  return (
    <div
      data-stream={carrying ? "live" : "not-live"}
      className="bg-surface-0 relative grid h-dvh grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
    >
      {props.children}
    </div>
  );
}

/** The bar and what stands above it, across the whole frame and through every
 * state of it: the banner speaks for every screen and the nav reaches every one
 * of them, so neither is a thing the chat pane takes width from or covers. */
function ShellHeader(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)]">
      <div className="shell-banner">
        <StreamBanner />
      </div>
      <TopBar partition={props.partition} />
      <Separator.Root decorative className="h-px bg-edge" />
    </div>
  );
}

/** Everything under the bar, which is what the pages and the pane divide
 * between them. */
function ShellBody(props: {
  readonly children: ReactNode;
  readonly chat: ChatPaneState;
}): ReactNode {
  return (
    <div
      data-chat={props.chat.presentation.toLowerCase()}
      className={`grid min-h-0 min-w-0 ${shellBodyTracksDrawn(props.chat)}`}
    >
      {props.children}
    </div>
  );
}

function ShellDrawn(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const twoColumn = useViewportAtLeastEm(viewportTwoColumnEm);
  const chat = chatPaneNarrowed(useChatPane().state, twoColumn);
  const drawn = chatPaneContentDrawn(chat);
  const pages = drawn ? (
    <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)]">
      <DetailsPane>
        <Outlet />
      </DetailsPane>
    </div>
  ) : null;
  const pane = (
    <div
      className={`grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] ${
        pages === null ? "" : shellPaneEdges[chat.placement]
      }`}
    >
      <ChatPane partition={props.partition} chat={chat} />
    </div>
  );
  return (
    <ShellFrame>
      <ShellHeader partition={props.partition} />
      <ShellBody chat={chat}>
        {chat.placement === "Left" ? (
          <>
            {pane}
            {pages}
          </>
        ) : (
          <>
            {pages}
            {pane}
          </>
        )}
      </ShellBody>
    </ShellFrame>
  );
}

export function Shell(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  return (
    <ShellSlots>
      <TicketReferenceWiring partition={props.partition}>
        <ChatPaneProvider>
          <ShellDrawn partition={props.partition} />
        </ChatPaneProvider>
      </TicketReferenceWiring>
    </ShellSlots>
  );
}
