/**
 * One frame for every screen: the rail beside the page or over it, the bar
 * above it, the page scrolling between them, and the slot under it a composer
 * is pinned to. A page without a composer leaves that slot empty and scrolls in
 * the same middle a conversation does, which is what makes a ticket page and a
 * thread page the same frame.
 *
 * The banner is not decoration — it is the only place a reader learns that what
 * the screens below are showing is no longer arriving live.
 */

import { Outlet } from "@tanstack/react-router";
import { Dialog, Separator } from "radix-ui";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import {
  projectStreamCarrying,
  projectStreamUnanswered,
} from "../core/projectStream.ts";
import { DetailsPane } from "./shell/DetailsPane.tsx";
import { Rail } from "./shell/Rail.tsx";
import { ShellSlots, useShellSlotHolder } from "./shell/slots.tsx";
import { TopBar } from "./shell/TopBar.tsx";
import { useViewportAtLeastEm, viewportTwoColumnEm } from "./shell/viewport.ts";
import {
  useProjectFallbackExhausted,
  useProjectStreamStatus,
} from "./stream.tsx";
import { Notice } from "./ui/Notice.tsx";
import "./shell/shell.css";

export { ThemeControl } from "./shell/Rail.tsx";

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
 * live and silent again when a first connection has not been answered. A reader
 * has the banner; anything watching the console from outside has this.
 */
export function ShellFrame(props: {
  readonly children: ReactNode;
  readonly twoColumn?: boolean | undefined;
}): ReactNode {
  const carrying = projectStreamCarrying(useProjectStreamStatus());
  const columns =
    props.twoColumn === true
      ? "grid-cols-[var(--width-rail)_auto_minmax(0,1fr)]"
      : "grid-cols-1";
  return (
    <div
      data-stream={carrying ? "live" : "not-live"}
      className={`grid h-dvh overflow-hidden bg-surface-0 ${columns}`}
    >
      {props.children}
    </div>
  );
}

function ShellMain(props: {
  readonly narrow: boolean;
  readonly title: string;
}): ReactNode {
  const holdBottom = useShellSlotHolder("bottom");
  return (
    <div className="grid min-h-0 grid-rows-[auto_auto_auto_minmax(0,1fr)_auto]">
      <div className="shell-banner">
        <StreamBanner />
      </div>
      <TopBar narrow={props.narrow} title={props.title} />
      <Separator.Root decorative className="h-px bg-edge" />
      <DetailsPane>
        <Outlet />
      </DetailsPane>
      <div ref={holdBottom} />
    </div>
  );
}

/**
 * The rail as a drawer. Radix's dialog in its non-modal form, which is the one
 * that mounts no `<style>` element: the modal form's scroll lock appends one
 * and the served `style-src 'self'` refuses it. The scrim is this component's
 * because the non-modal overlay draws nothing.
 */
function ShellDrawer(props: {
  readonly partition: PartitionIdentity;
  readonly onNavigate: () => void;
}): ReactNode {
  return (
    <Dialog.Portal>
      <div aria-hidden="true" className="fixed inset-0 z-10 bg-scrim" />
      <Dialog.Content
        aria-describedby={undefined}
        className="fixed inset-y-0 left-0 z-20 w-rail outline-none"
      >
        <Dialog.Title className="visually-hidden">Console</Dialog.Title>
        <Rail partition={props.partition} onNavigate={props.onNavigate} />
      </Dialog.Content>
    </Dialog.Portal>
  );
}

function ShellDrawn(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const twoColumn = useViewportAtLeastEm(viewportTwoColumnEm);
  const [railOpen, setRailOpen] = useState(false);
  const partition = props.partition;
  return (
    <Dialog.Root open={railOpen} onOpenChange={setRailOpen} modal={false}>
      <ShellFrame twoColumn={twoColumn}>
        {twoColumn ? (
          <>
            <Rail partition={partition} />
            <Separator.Root
              decorative
              orientation="vertical"
              className="w-px bg-edge"
            />
          </>
        ) : (
          <ShellDrawer
            partition={partition}
            onNavigate={() => {
              setRailOpen(false);
            }}
          />
        )}
        <ShellMain
          narrow={!twoColumn}
          title={`${partition.tenant} / ${partition.project}`}
        />
      </ShellFrame>
    </Dialog.Root>
  );
}

export function Shell(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  return (
    <ShellSlots>
      <ShellDrawn partition={props.partition} />
    </ShellSlots>
  );
}
