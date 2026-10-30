/**
 * One frame for every screen: the bar across the top, and under it the pages
 * and the chat dividing what is left.
 *
 * THE BAR SPANS THE FRAME. The nav reaches every screen and the banner speaks
 * for all of them, so the bar is not something the chat pane takes width from,
 * and a reader who filled the frame with the chat still has every screen one
 * press away.
 *
 * The chat pane is where the reader talks to the project, so it outlives every
 * navigation between the pages: they change beneath the bar and the
 * conversation does not. It takes the body three ways and no fourth — a column
 * beside the pages, the whole body, or the strip its own control expands — and
 * a viewport too narrow to divide stacks the column or the strip under the
 * pages instead, starting over the whole body until the reader leaves it. A
 * thread's own page is drawn with no pane at all, since the thread is the page
 * there.
 *
 * THE READER DRAGS THE EDGE. The column is as wide as the reader leaves it,
 * or under the pages as great a share of the height, and dragging it past its
 * narrowest makes it the strip. So the pages are a column of whatever width is
 * left, and the details ask that column rather than the viewport whether they
 * fit beside a page.
 *
 * The banner is not decoration — it is the only place a reader learns that what
 * the screens below are showing is no longer arriving live.
 */

import { Outlet, useParams } from "@tanstack/react-router";
import { Separator } from "radix-ui";
import { memo, useLayoutEffect, useMemo, useState } from "react";
import type { ReactNode, RefObject } from "react";
import {
  Group,
  Panel,
  Separator as PanelSeparator,
  useDefaultLayout,
  useGroupRef,
  usePanelRef,
} from "react-resizable-panels";
import type {
  GroupImperativeHandle,
  Layout,
  LayoutChangedMeta,
  PanelImperativeHandle,
} from "react-resizable-panels";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import {
  chatPaneDragged,
  chatPaneKept,
  chatPaneLayoutId,
  chatPaneLayoutKept,
  chatPaneLayoutPanels,
  chatPaneLayoutShare,
  chatPaneLayoutStore,
  chatPaneNarrowed,
  chatPaneOnPage,
  chatPaneOrientation,
  chatPanePanels,
  chatPaneShareText,
  chatPaneSizes,
  chatPaneSizeStrip,
  chatPaneStripped,
} from "../core/chatPane.ts";
import type {
  ChatPaneLayout,
  ChatPaneSizes,
  ChatPaneState,
} from "../core/chatPane.ts";
import {
  projectStreamCarrying,
  projectStreamUnanswered,
} from "../core/projectStream.ts";
import {
  clipboardWritten,
  elapsedMs,
  persistentStore,
  syntaxWorkerOpened,
} from "./ports.ts";
import { ChatPane } from "./shell/ChatPane.tsx";
import { ChatPaneProvider, useChatPane } from "./shell/chatPaneHeld.tsx";
import { DetailsPane } from "./shell/DetailsPane.tsx";
import { TicketReferenceWiring } from "./ticket/TicketReferenceWiring.tsx";
import { ShellSlots } from "./shell/slots.tsx";
import { TopBar } from "./shell/TopBar.tsx";
import {
  useElementAtLeastEm,
  useViewportAtLeastEm,
  viewportColumnAsideEm,
  ViewportColumnAsideProvider,
  viewportTwoColumnEm,
} from "./shell/viewport.ts";
import {
  useProjectFallbackExhausted,
  useProjectStreamStatus,
} from "./stream.tsx";
import { CopyProvider } from "./ui/copyHeld.tsx";
import { MarkdownProvider } from "./ui/markdownHeld.ts";
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

/** The banner and the bar under it, across the whole frame: the banner speaks
 * for every screen and the nav reaches every one of them, so neither is a
 * thing the chat pane takes width from, nor one a full screen covers. */
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

/** The pages' panel, which says to every page under it whether its width holds
 * the details beside a page. Nothing it is handed changes while the edge is
 * dragged, so a drag does not draw the pages again. */
const ShellBodyPages = memo(function ShellBodyPages(props: {
  readonly sizes: ChatPaneSizes;
}): ReactNode {
  const [columnHeld, columnAside] = useElementAtLeastEm(viewportColumnAsideEm);
  return (
    <Panel
      id={chatPanePanels.pages}
      minSize={props.sizes.pagesMin}
      elementRef={columnHeld}
      className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)]"
    >
      <ViewportColumnAsideProvider value={columnAside}>
        <DetailsPane>
          <Outlet />
        </DetailsPane>
      </ViewportColumnAsideProvider>
    </Panel>
  );
});

/**
 * The pane's panel made to follow the stored presentation: collapsed to the
 * strip, or opened to the layout these panels were last laid open at, else to
 * the one stored for them, else to its default. A stored share the frame has
 * since grown too narrow for is laid as the strip, so it opens at its least
 * instead.
 */
function shellBodyFollowed(
  group: GroupImperativeHandle | null,
  panel: PanelImperativeHandle | null,
  along: {
    readonly stripped: boolean;
    readonly opened: ChatPaneLayout | undefined;
    readonly stored: ChatPaneLayout | undefined;
    readonly sizes: ChatPaneSizes;
  },
): void {
  if (group === null || panel === null) return;
  if (along.stripped === panel.isCollapsed()) return;
  if (along.stripped) {
    panel.collapse();
    return;
  }
  const open = along.opened ?? along.stored;
  if (open === undefined) panel.resize(along.sizes.chatDefault);
  else group.setLayout(open);
  if (panel.isCollapsed()) panel.resize(along.sizes.chatMin);
}

/** The pane's panel, which keeps the unit of the size it is held to as the
 * frame around it resizes and gives the pages what is left. It is named for
 * where it is drawn, and like the pages it is not drawn again by a drag. */
const ShellBodyChat = memo(function ShellBodyChat(props: {
  readonly id: string;
  readonly partition: PartitionIdentity;
  readonly chat: ChatPaneState;
  readonly sizes: ChatPaneSizes;
  readonly panelRef: RefObject<PanelImperativeHandle | null>;
}): ReactNode {
  return (
    <Panel
      id={props.id}
      panelRef={props.panelRef}
      collapsible
      collapsedSize={chatPaneSizeStrip}
      defaultSize={props.sizes.chatDefault}
      minSize={props.sizes.chatMin}
      groupResizeBehavior={chatPaneKept(
        props.sizes,
        chatPaneStripped(props.chat),
      )}
      className="@container grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)]"
    >
      <ChatPane partition={props.partition} chat={props.chat} />
    </Panel>
  );
});

/** The panels in the order drawn, with the edge between two of them. They are
 * keyed by what they are rather than by the names they are drawn under, so
 * the pane moving leaves every one of them mounted. */
function shellBodyDrawn(props: {
  readonly partition: PartitionIdentity;
  readonly chat: ChatPaneState | undefined;
  readonly sizes: ChatPaneSizes;
  readonly panelIds: readonly string[];
  readonly chatPanel: RefObject<PanelImperativeHandle | null>;
  readonly shareText: string | undefined;
}): readonly ReactNode[] {
  return props.panelIds.flatMap((id, index) => [
    ...(index === 0
      ? []
      : [
          <PanelSeparator
            key="separator"
            aria-label="Chat size"
            aria-valuetext={props.shareText}
            disableDoubleClick
            className="chat-separator"
          />,
        ]),
    id === chatPanePanels.pages || props.chat === undefined ? (
      <ShellBodyPages key="pages" sizes={props.sizes} />
    ) : (
      <ShellBodyChat
        key="chat"
        id={id}
        partition={props.partition}
        chat={props.chat}
        sizes={props.sizes}
        panelRef={props.chatPanel}
      />
    ),
  ]);
}

/**
 * The pane's panel kept to the stored presentation, once the group has laid
 * the panels drawn and again whenever a layout it finishes takes the pane into
 * the strip or out of it. It is told each layout the group lays and each one
 * it finishes.
 */
function useShellBodyFollowed(along: {
  readonly group: RefObject<GroupImperativeHandle | null>;
  readonly chatPanel: RefObject<PanelImperativeHandle | null>;
  readonly panelIds: readonly string[];
  readonly stripped: boolean;
  readonly stored: ChatPaneLayout | undefined;
  readonly sizes: ChatPaneSizes;
}): {
  readonly laid: (next: Layout) => void;
  readonly finished: (next: Layout, collapsed: boolean) => void;
} {
  const { group, chatPanel, panelIds, stripped, stored, sizes } = along;
  const [laid, laidAs] = useState<string>();
  /** Whether the last layout the group finished left the pane at the strip,
   * which a frame resized can change with no reader's move. */
  const [laidStripped, laidStrippedAs] = useState<boolean>();
  /** The layout each set of panels was last laid at with the pane open, which
   * the strip forgets, so a pane the frame alone takes into the strip opens
   * again where it was. */
  const [opened] = useState(() => new Map<string, Layout>());
  useLayoutEffect(() => {
    const drawn = panelIds.join();
    if (laid !== drawn) return;
    if (stripped) opened.delete(drawn);
    shellBodyFollowed(group.current, chatPanel.current, {
      stripped,
      opened: opened.get(drawn),
      stored,
      sizes,
    });
  }, [
    group,
    chatPanel,
    laid,
    laidStripped,
    opened,
    panelIds,
    stripped,
    stored,
    sizes,
  ]);
  return {
    laid: (next) => {
      laidAs(Object.keys(next).join());
    },
    finished: (next, collapsed) => {
      laidStrippedAs(collapsed);
      if (!collapsed) opened.set(Object.keys(next).join(), next);
    },
  };
}

/**
 * The pages, the pane and the edge between them, laid by a library that keeps
 * and stores each set of panels' layout under their names. The stored
 * presentation decides whether the pane is the strip: a layout the reader made
 * by the edge moves it as the pane's own control does, the panel follows it,
 * and the edge says the pane's share as each layout is laid.
 */
function ShellBody(props: {
  readonly partition: PartitionIdentity;
  readonly chat: ChatPaneState | undefined;
}): ReactNode {
  const held = useChatPane();
  const group = useGroupRef();
  const chatPanel = usePanelRef();
  const orientation = chatPaneOrientation(props.chat);
  const sizes = chatPaneSizes[orientation];
  const panelIds = chatPaneLayoutPanels(props.chat);
  const [storage] = useState(() => chatPaneLayoutStore(persistentStore));
  const layout = useDefaultLayout({
    id: chatPaneLayoutId,
    panelIds: useMemo(() => [...panelIds], [panelIds]),
    storage,
  });
  const stored = chatPaneLayoutKept(layout.defaultLayout, panelIds);
  const followed = useShellBodyFollowed({
    group,
    chatPanel,
    panelIds,
    stripped: props.chat !== undefined && chatPaneStripped(props.chat),
    stored,
    sizes,
  });
  const [shareText, sharedAs] = useState<string>();
  const change = (next: Layout): void => {
    followed.laid(next);
    sharedAs(chatPaneShareText(chatPaneLayoutShare(next)));
  };
  const changed = (next: Layout, meta: LayoutChangedMeta): void => {
    const panel = chatPanel.current;
    if (panel === null) return;
    const collapsed = panel.isCollapsed();
    followed.finished(next, collapsed);
    if (!meta.isUserInteraction) return;
    if (!collapsed) layout.onLayoutChanged(next, meta);
    const moved = chatPaneDragged(held.state, collapsed);
    if (moved !== held.state) held.moveTo(moved);
  };
  return (
    <Group
      id={chatPaneLayoutId}
      groupRef={group}
      orientation={orientation}
      defaultLayout={stored}
      onLayoutChange={change}
      onLayoutChanged={changed}
      data-chat={props.chat?.presentation.toLowerCase() ?? "none"}
      className="min-h-0 min-w-0"
    >
      {shellBodyDrawn({
        partition: props.partition,
        chat: props.chat,
        sizes,
        panelIds,
        chatPanel,
        shareText,
      })}
    </Group>
  );
}

function ShellDrawn(props: {
  readonly partition: PartitionIdentity;
  readonly twoColumn: boolean;
}): ReactNode {
  const chat = chatPaneOnPage(
    chatPaneNarrowed(useChatPane().state, props.twoColumn),
    useParams({ strict: false }),
  );
  return (
    <ShellFrame>
      <ShellHeader partition={props.partition} />
      <ShellBody partition={props.partition} chat={chat} />
    </ShellFrame>
  );
}

export function Shell(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const twoColumn = useViewportAtLeastEm(viewportTwoColumnEm);
  return (
    <ShellSlots>
      <CopyProvider write={clipboardWritten}>
        <MarkdownProvider clock={elapsedMs} syntax={syntaxWorkerOpened}>
          <TicketReferenceWiring partition={props.partition}>
            <ChatPaneProvider twoColumn={twoColumn}>
              <ShellDrawn partition={props.partition} twoColumn={twoColumn} />
            </ChatPaneProvider>
          </TicketReferenceWiring>
        </MarkdownProvider>
      </CopyProvider>
    </ShellSlots>
  );
}
