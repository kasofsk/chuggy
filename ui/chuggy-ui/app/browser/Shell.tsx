/**
 * The shell every screen is drawn inside: the partition it is looking at, the
 * switcher that changes it, the primary nav, the theme, the session, and the
 * stream's own state.
 *
 * The banner is not decoration — it is the only place a reader learns that what
 * the screens below are showing is no longer arriving live.
 */

import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { apiProjectInventoryAll } from "../core/apiRoutes.ts";
import { inboxCountLabel } from "../core/inboxList.ts";
import { lastProjectWrite } from "../core/lastProject.ts";
import {
  projectStreamCarrying,
  projectStreamUnanswered,
} from "../core/projectStream.ts";
import { usePanelInventory } from "./api.ts";
import { Footer } from "./Footer.tsx";
import { useInboxRows } from "./Inbox.tsx";
import { persistentStore } from "./ports.ts";
import { useSessionHolder } from "./session.tsx";
import {
  useProjectFallbackExhausted,
  useProjectStreamStatus,
} from "./stream.tsx";
import {
  themeChoiceApply,
  themeChoiceRead,
  themeChoiceWrite,
  themeChoices,
} from "./theme.ts";
import type { ThemeChoice } from "./theme.ts";
import { Button } from "./ui/Button.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Pill } from "./ui/Pill.tsx";
import "./shell.css";

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

function ProjectSwitcher(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const navigate = useNavigate();
  const state = usePanelInventory((ports) => apiProjectInventoryAll(ports));
  if (state.state !== "Ready")
    return <Notice tone="parked" inline detail="Projects unavailable" />;
  return (
    <select
      aria-label="Project"
      value={`${props.partition.tenant}/${props.partition.project}`}
      onChange={(event) => {
        const chosen = state.value.find(
          (candidate) =>
            `${candidate.tenant}/${candidate.project}` === event.target.value,
        );
        if (chosen === undefined) return;
        lastProjectWrite(persistentStore, chosen);
        void navigate({
          to: "/$tenant/$project",
          params: { tenant: chosen.tenant, project: chosen.project },
        });
      }}
    >
      {state.value.map((candidate) => (
        <option
          key={`${candidate.tenant}/${candidate.project}`}
          value={`${candidate.tenant}/${candidate.project}`}
        >
          {candidate.tenant} / {candidate.project}
        </option>
      ))}
    </select>
  );
}

/** The same union the inbox draws, so the count and the list are one value. */
function InboxCount(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const label = inboxCountLabel(useInboxRows(props.partition).union);
  return label === undefined ? null : (
    <span aria-label="Tickets needing you">
      <Pill tone="parked">{label}</Pill>
    </span>
  );
}

/** The choice is applied before it is stored, so a store a browser refuses
 * still leaves the operator looking at the theme they asked for. */
export function ThemeControl(): ReactNode {
  const [chosen, setChosen] = useState<ThemeChoice>(() =>
    themeChoiceRead(persistentStore),
  );
  return (
    <span className="shell-theme" role="group" aria-label="Theme">
      {themeChoices.map((candidate) => (
        <Button
          key={candidate}
          size="sm"
          pressed={candidate === chosen}
          onClick={() => {
            themeChoiceApply(document.documentElement, candidate);
            themeChoiceWrite(persistentStore, candidate);
            setChosen(candidate);
          }}
        >
          {candidate}
        </Button>
      ))}
    </span>
  );
}

/**
 * The shell's own element, which states whether the stream is carrying because
 * the banner no longer answers that: the banner is silent when the stream is
 * live and silent again when a first connection has not been answered. A reader
 * has the banner; anything watching the console from outside has this.
 */
export function ShellFrame(props: { readonly children: ReactNode }): ReactNode {
  const carrying = projectStreamCarrying(useProjectStreamStatus());
  return (
    <div className="shell" data-stream={carrying ? "live" : "not-live"}>
      {props.children}
    </div>
  );
}

function ShellNav(props: { readonly partition: PartitionIdentity }): ReactNode {
  const params = {
    tenant: props.partition.tenant,
    project: props.partition.project,
  };
  const here = { className: "here" };
  return (
    <nav className="shell-nav" aria-label="Primary">
      <Link to="/$tenant/$project" params={params} activeProps={here}>
        Project
      </Link>
      <Link to="/$tenant/$project/inbox" params={params} activeProps={here}>
        Inbox <InboxCount partition={props.partition} />
      </Link>
      <Link to="/$tenant/$project/lead" params={params} activeProps={here}>
        Lead
      </Link>
      <Link to="/$tenant/$project/threads" params={params} activeProps={here}>
        Threads
      </Link>
      <Link to="/$tenant/$project/selector" params={params} activeProps={here}>
        Selector
      </Link>
      <Link
        to="/$tenant/$project/tickets/new"
        params={params}
        activeProps={here}
      >
        New ticket
      </Link>
    </nav>
  );
}

export function Shell(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const holder = useSessionHolder();
  return (
    <ShellFrame>
      <header className="shell-head">
        <Link className="brand" to="/">
          chuggy
        </Link>
        <ProjectSwitcher partition={props.partition} />
        <ShellNav partition={props.partition} />
        <div className="shell-tools">
          <ThemeControl />
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              void holder.signOut();
            }}
          >
            Sign out
          </Button>
        </div>
      </header>
      <StreamBanner />
      <main className="shell-body">
        <Outlet />
      </main>
      <Footer />
    </ShellFrame>
  );
}
