/**
 * The shell every screen is drawn inside: the partition it is looking at, the
 * switcher that changes it, the stream's own state, and the session.
 *
 * The banner is not decoration — it is the only place a reader learns that what
 * the screens below are showing is no longer arriving live.
 */

import { Link, Outlet, useNavigate } from "@tanstack/react-router";
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
    (status.source === "degraded"
      ? "the change log behind the stream is degraded"
      : "the stream is not open");
  return (
    <div className="banner" role="status">
      <strong>not live</strong> — {detail}
      {exhausted ? " — the fallback refetches have run out" : ""}
    </div>
  );
}

function ProjectSwitcher(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const navigate = useNavigate();
  const state = usePanelInventory((ports) => apiProjectInventoryAll(ports));
  if (state.state !== "Ready")
    return <span className="switcher-note">projects unavailable</span>;
  return (
    <select
      className="switcher"
      aria-label="project"
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
    <span className="nav-count" aria-label="tickets needing you">
      {label}
    </span>
  );
}

/**
 * The shell states whether the stream is carrying, because the banner no longer
 * answers that: it is silent both when the stream is live and when a first
 * connection has not opened yet. A reader has the banner; anything watching the
 * console from outside has this.
 */
export function Shell(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const holder = useSessionHolder();
  const carrying = projectStreamCarrying(useProjectStreamStatus());
  const params = {
    tenant: props.partition.tenant,
    project: props.partition.project,
  };
  return (
    <div className="shell" data-stream={carrying ? "live" : "not-live"}>
      <header className="shell-head">
        <span className="brand">chuggy</span>
        <ProjectSwitcher partition={props.partition} />
        <nav className="shell-nav">
          <Link
            to="/$tenant/$project"
            params={params}
            activeProps={{ className: "here" }}
          >
            project
          </Link>
          <Link
            to="/$tenant/$project/inbox"
            params={params}
            activeProps={{ className: "here" }}
          >
            inbox <InboxCount partition={props.partition} />
          </Link>
          <Link
            to="/$tenant/$project/tickets/new"
            params={params}
            activeProps={{ className: "here" }}
          >
            new ticket
          </Link>
        </nav>
        <button
          type="button"
          className="sign-out"
          onClick={() => {
            void holder.signOut();
          }}
        >
          sign out
        </button>
      </header>
      <StreamBanner />
      <main className="shell-body">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
